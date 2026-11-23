import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { ChangeDraft, ChangeType } from '../domain/change-types.js';
import {
  PropertyChangeRepository,
  type PropertyChangeRecord,
} from './property-change.repository.js';

/**
 * SPEC-004 BR-004-25, BR-004-26, DL-004-08: the one place property changes are written and read.
 * The Radar (SPEC-013) and the digest (SPEC-008) read these entries and never compare property
 * data themselves.
 *
 * An entry of a run that did not end SUCCESS describes writes that may not all have happened;
 * readers take the entries of a run they know succeeded (ImportRunService).
 */
@Injectable()
export class PropertyChangeService {
  constructor(private readonly changes: PropertyChangeRepository) {}

  /** Idempotent (unique run + property + field): the same entries again change nothing. */
  async record(runId: string, drafts: readonly ChangeDraft[], now: Date): Promise<void> {
    await this.changes.upsertMany(new Types.ObjectId(runId), drafts, now);
  }

  countByType(runId: string, type: ChangeType): Promise<number> {
    return this.changes.countByRunAndType(new Types.ObjectId(runId), type);
  }

  /** Every entry of a run, by property and field. */
  findByRun(runId: string): Promise<PropertyChangeRecord[]> {
    return this.changes.findByRun(new Types.ObjectId(runId));
  }

  /** The newest entries of one property, newest first. */
  findByCode(code: string, limit = 50): Promise<PropertyChangeRecord[]> {
    return this.changes.findByCode(code, limit);
  }
}
