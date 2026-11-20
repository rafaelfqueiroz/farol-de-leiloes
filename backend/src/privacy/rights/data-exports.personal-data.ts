// SPEC-010 BR-010-08, BR-010-15 / SC-27: the account's export requests are listed in its own export
// ("my data") and deleted, FILES FIRST, by the purge: a row is removed only after the file it names is
// gone, so a failing storage leaves the row (and the key) for the next run instead of an orphan file.
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../../access/access-context.js';
import { StorageService } from '../../storage/storage.service.js';
import { PersonalDataRegistry } from '../registry/personal-data-registry.js';
import type { PersonalDataProvider } from '../registry/personal-data-provider.js';
import { DataExportEntity } from '../schemas/data-export.schema.js';
import { DataExportsRepository } from './data-exports.repository.js';

@Injectable()
export class DataExportsPersonalData implements PersonalDataProvider {
  readonly name = 'dataExports';
  readonly models = [DataExportEntity.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly exports: DataExportsRepository,
    private readonly storage: StorageService,
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
