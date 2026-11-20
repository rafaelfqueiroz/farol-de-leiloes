// SPEC-010 BR-010-08: the account sees the personal data the platform holds for it, in the product,
// at once. It is the SAME collection the export file is made of (the registry's providers, read under
// the request's own AccessContext), without the wait for a file.
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../../access/access-context.js';
import { Clock } from '../../common/clock/clock.js';
import {
  type ExportDocument,
  MY_DATA_LIST_LIMIT,
  buildExportDocument,
  capSections,
} from '../domain/export-document.js';
import { PersonalDataRegistry } from '../registry/personal-data-registry.js';

@Injectable()
export class MyDataService {
  constructor(
    private readonly registry: PersonalDataRegistry,
    private readonly clock: Clock, // AR-24
  ) {}

  /**
   * What every provider holds about the account of `ctx`, under the export's envelope, with each
   * list bounded to MY_DATA_LIST_LIMIT records: a section that was cut says `truncated: true` and
   * the `totals`, and the interface points to the export, which is complete (BR-010-09). The
   * providers read only that many (`limit`); `capSections` is the net for any that do not. SC-15:
   * never logged.
   */
  async view(ctx: AccessContext): Promise<ExportDocument> {
    const sections = await this.registry.collect(ctx, { limit: MY_DATA_LIST_LIMIT });
    return buildExportDocument(this.clock.now(), capSections(sections, MY_DATA_LIST_LIMIT));
  }
}
