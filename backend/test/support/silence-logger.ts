// Vitest setup file of every backend project (vitest.config.mts, `setupFiles`): the Nest Logger
// prints nothing during a test run. Specs that exercise error paths (RemindersScheduler,
// PaymentsService, AuctionCleanupService...) would otherwise bury real failures and the
// pre-push hook output (DV-37) under expected ERROR/WARN lines.
//
// Two things print Nest logs, so two things are silenced. Vitest isolates module state per spec
// file, so this runs once per file.
//   1. `Logger.overrideLogger(false)` replaces the static logger every `new Logger(Name)`
//      delegates to (AR-45), which silences the instance loggers of services.
//   2. `Test.createTestingModule()` installs @nestjs/testing's own logger on `compile()`, which
//      still prints every `error` and would undo (1). The builder is wrapped to start with a
//      logger that has every level off; a spec may still call `.setLogger()` itself to replace it.
//
// A spec that asserts on logging spies on the logger explicitly, with
// `vi.spyOn(Logger.prototype, 'error')`: the spy sees every call and stays silent.
import { ConsoleLogger, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

Logger.overrideLogger(false);

const createTestingModule = Test.createTestingModule.bind(Test);
Test.createTestingModule = (...args) =>
  createTestingModule(...args).setLogger(new ConsoleLogger({ logLevels: [] }));
