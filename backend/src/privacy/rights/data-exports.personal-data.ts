// SPEC-010 BR-010-08, BR-010-15 / SC-27: the account's export requests are listed in its own export
// ("my data") and deleted, FILES FIRST, by the purge: a row is removed only after the file it names is
// gone, so a failing storage leaves the row (and the key) for the next run instead of an orphan file.
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../../access/access-context.js';
import { Clock } from '../../common/clock/clock.js';
import { StorageService } from '../../storage/storage.service.js';
import { isClaimLive } from '../domain/account-purge.js';
import { PersonalDataRegistry } from '../registry/personal-data-registry.js';
import type { PersonalDataProvider } from '../registry/personal-data-provider.js';
import { DataExportEntity } from '../schemas/data-export.schema.js';
import { DataExportsRepository } from './data-exports.repository.js';

/** Thrown by the purge while an export is being built; its name is the code the job logs. */
export class ExportBuildInProgressError extends Error {
  constructor() {
    super('A data export is still being built');
    this.name = 'ExportBuildInProgressError';
  }
}

@Injectable()
export class DataExportsPersonalData implements PersonalDataProvider {
  readonly name = 'dataExports';
  readonly models = [DataExportEntity.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly exports: DataExportsRepository,
    private readonly storage: StorageService,
    private readonly clock: Clock, // AR-24
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext): Promise<Record<string, unknown>> {
    const found = await this.exports.allOf(ctx.accountId);
    return {
      items: found.map((entry) => ({
        status: entry.status,
        requestedAt: entry.requestedAt,
        readyAt: entry.readyAt ?? null,
        expiresAt: entry.expiresAt ?? null,
      })),
    };
  }

  async purge(userId: string): Promise<{ deleted: number }> {
    let deleted = 0;
    // Two passes: a request that passed the session guard just before the closure may insert a row
    // while the first pass runs. (One that lands after both holds ids and a status only, no file.)
    for (let pass = 0; pass < 2; pass += 1) {
      const entries = await this.exports.allOf(userId);
      if (entries.length === 0) break;
      // A worker is still building one of them (its lease has not run out): deleting the row now
      // would leave the file it is about to finish writing with nothing pointing at it. The purge of
      // this account fails for now (the claim is released) and the next run finishes it.
      const now = this.clock.now();
      if (entries.some((entry) => isClaimLive(entry.claimUntil, now))) {
        throw new ExportBuildInProgressError();
      }
      for (const entry of entries) {
        // Delete the file, then the row. `deleteFile` answers true for an object already gone and
        // false when storage is unavailable: then the row stays and the purge fails for this run.
        if (entry.fileKey && !(await this.storage.deleteFile(entry.fileKey))) {
          throw new Error('EXPORT_FILE_DELETE_FAILED');
        }
        await this.exports.deleteOne(entry.id);
        deleted += 1;
      }
    }
    return { deleted };
  }
}
