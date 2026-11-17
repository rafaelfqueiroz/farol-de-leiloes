// `npm run grant-admin -- --email <address> [--revoke]` (node dist/access/grant-admin/run.js):
// gives or takes the admin capability of one account (SPEC-002 DL-002-05, BR-002-21), against the
// database MONGODB_URI names, with the API's validated environment (AR-41). Like `npm run
// migrate`, it runs from the compiled output (`npm run build` first), so it also runs inside the
// production image. Exit code 0 when the account ends up as asked, 1 otherwise.
//
// SC-15: it prints the outcome only, never the address it was given or any account data.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import { exitCodeOf, parseGrantAdminArgs } from './grant-admin.js';
import { GrantAdminCommand } from './grant-admin.command.js';
import { GrantAdminModule } from './grant-admin.module.js';

const logger = new Logger('GrantAdmin');

async function main(): Promise<number> {
  const args = parseGrantAdminArgs(process.argv.slice(2));
  if (!args.ok) {
    logger.error(args.error);
    return 1;
  }
  const app = await NestFactory.createApplicationContext(GrantAdminModule);
  try {
    const outcome = await app.get(GrantAdminCommand).run(args.email, args.change);
    const code = exitCodeOf(outcome);
    if (code === 0) logger.log(`grant-admin: ${outcome}`);
    else logger.error(`grant-admin: ${outcome}`);
    return code;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // A driver error may quote the connection string: only its stable code is printed (SC-15).
    logger.error(`grant-admin failed: ${jobErrorCode(error)}`);
    process.exit(1);
  },
);
