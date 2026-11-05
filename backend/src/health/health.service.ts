// AR-48: database reachability and the outcome and age of the last Caixa import.
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Clock } from '../common/clock/clock';
import { JobExecutionService } from '../common/services/job-execution.service';
import type { JobOutcome } from '../common/job-execution';
import { AUCTIONS_IMPORT_JOB } from '../auctions/importer/import-job';
import {
  assessLastImport,
  healthReport,
  type DatabaseStatus,
  type HealthReport,
} from './domain/health-report';

/** A probe answers within seconds: a ping slower than this counts as the database being down. */
export const DB_PING_TIMEOUT_MS = 2000;

const CONNECTED = 1; // mongoose ConnectionStates.connected

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly jobExecutions: JobExecutionService,
    private readonly clock: Clock, // AR-24
  ) {}

  async check(): Promise<HealthReport> {
    let database = await this.databaseStatus();
    let last: JobOutcome | null = null;
    // With the database down there is no import record to read; a read that fails after a
    // successful ping means it is not serving either.
    if (database === 'up') {
      try {
        last = await this.jobExecutions.getLastOutcome(AUCTIONS_IMPORT_JOB);
      } catch {
        database = 'down';
      }
    }
    if (database === 'down') {
      // AR-45: someone must look at it. A fixed line: the driver's error text may name the host
      // or the user of the connection string.
      this.logger.warn('Database unreachable: health reports down');
    }
    return healthReport(database, assessLastImport(last, this.clock.now()));
  }

  /** Up when connected and a ping answers in time. The reason it is down is not reported. */
  private async databaseStatus(): Promise<DatabaseStatus> {
    const db = this.connection.db;
    if (this.connection.readyState !== CONNECTED || !db) return 'down';
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('ping timed out')), DB_PING_TIMEOUT_MS);
    });
    try {
      await Promise.race([db.admin().ping(), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
