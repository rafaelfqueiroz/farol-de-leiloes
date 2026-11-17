// `npm run plans:upsert -- --file <catalog.json>` (node dist/plans/upsert/run.js): writes the plan
// catalog (SPEC-012 BR-012-02) into the database MONGODB_URI names, with the API's validated
// environment (AR-41). Like `npm run grant-admin`, it runs from the compiled output (`npm run
// build` first), so it also runs inside the production image. Idempotent: the same file twice
// changes nothing the second time. It never touches a subscription (BR-012-04), refuses a provider
// price that belongs to another plan, and refuses to change the price id of an existing code.
//
// SC-15: it prints counts only, never the file's content.
import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import { parsePlanCatalog, parsePlansUpsertArgs } from './plan-catalog-file.js';
import { exitCodeOf, PlansUpsertCommand, summaryOf } from './plans-upsert.command.js';
import { PlansUpsertModule } from './plans-upsert.module.js';

const logger = new Logger('PlansUpsert');

async function main(): Promise<number> {
  const args = parsePlansUpsertArgs(process.argv.slice(2));
  if (!args.ok) {
    logger.error(args.error);
    return 1;
  }
  let json: unknown;
  try {
    json = JSON.parse(await readFile(args.file, 'utf8'));
  } catch {
    // The path and the parser's message may quote the file: only the fact is reported.
    logger.error('the catalog file could not be read as JSON');
    return 1;
  }
  const catalog = parsePlanCatalog(json);
  if (!catalog.ok) {
    logger.error(catalog.error);
    return 1;
  }
  const app = await NestFactory.createApplicationContext(PlansUpsertModule);
  try {
    const outcome = await app.get(PlansUpsertCommand).run(catalog.plans);
    const code = exitCodeOf(outcome);
    if (code === 0) logger.log(summaryOf(outcome));
    else logger.error(summaryOf(outcome));
    return code;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // A driver error may quote the connection string: only its stable code is printed (SC-15).
    logger.error(`plans:upsert failed: ${jobErrorCode(error)}`);
    process.exit(1);
  },
);
