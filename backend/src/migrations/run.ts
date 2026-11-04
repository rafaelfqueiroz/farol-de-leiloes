// `npm run migrate` (node dist/migrations/run.js): applies the pending migrations to the database
// MONGODB_URI names, then exits — 0 when every migration is applied, 1 otherwise, so the gated
// deploy step that runs it aborts the deploy on failure (DV-34). ADR-001; DEVELOPMENT §6.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Clock } from '../common/clock/clock';
import { errorMessage } from '../common/error-message';
import { mongoMigrationLog } from './migration-log';
import { MigrationFailedError, runMigrations } from './migration-runner';
import { MigrationsModule } from './migrations.module';
import { MIGRATIONS } from './registry';

async function migrate(): Promise<void> {
  const app = await NestFactory.createApplicationContext(MigrationsModule);
  try {
    const db = app.get<Connection>(getConnectionToken()).db;
    await runMigrations(db, MIGRATIONS, mongoMigrationLog(db), app.get(Clock));
  } finally {
    await app.close();
  }
}

migrate().catch((error: unknown) => {
  const cause = error instanceof MigrationFailedError ? error.failure : error;
  new Logger('Migrations').error(
    `Migrations aborted: ${errorMessage(error)}`,
    cause instanceof Error ? cause.stack : undefined,
  );
  process.exit(1);
});
