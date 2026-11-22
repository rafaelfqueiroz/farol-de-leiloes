// `npm run legal:record-validation -- --scope <scope> --validator "<name>" [--versions terms:1.0,...]
// [--reference <id>] [--retention-years <n>]` (node dist/privacy/legal-validation/record/run.js):
// records a lawyer's validation (SPEC-010 BR-010-26) in the database MONGODB_URI names, with the API's
// validated environment (AR-41). Like `npm run grant-admin`, it runs from the compiled output (`npm
// run build` first), so it also runs inside the production image. Exit code 0 when the validation
// was recorded, 1 otherwise.
//
// SC-15: it prints the outcome only, never the validator's name or the reference.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { jobErrorCode } from '../../../common/services/job-error-code.js';
import { RecordValidationCommand } from './record-validation.command.js';
import { RecordValidationModule } from './record-validation.module.js';
import { exitCodeOf, parseRecordValidationArgs, summaryOf } from './record-validation.js';

const logger = new Logger('LegalRecordValidation');

async function main(): Promise<number> {
  const args = parseRecordValidationArgs(process.argv.slice(2));
  if (!args.ok) {
    logger.error(args.error);
    return 1;
  }
  const app = await NestFactory.createApplicationContext(RecordValidationModule);
  try {
    const outcome = await app.get(RecordValidationCommand).run(args.input);
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
    logger.error(`legal:record-validation failed: ${jobErrorCode(error)}`);
    process.exit(1);
  },
);
