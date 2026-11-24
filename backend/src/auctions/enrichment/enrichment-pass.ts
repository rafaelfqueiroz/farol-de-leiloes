import { Injectable, Logger } from '@nestjs/common';

/**
 * What the day's detail-collection passes did (BR-004-18..21, BR-004-27). Counts and a flag, for the
 * whole day: a pass that resumes a run starts from what the earlier ones did (`previous`).
 */
export interface CollectionResult {
  collected: number;
  failed: number;
  /** Caixa answered with a block or challenge: collection stopped for the run (BR-004-20). */
  blocked: boolean;
  /** Detail pages requested today, across the day's passes: what the daily budget counts. */
  pages: number;
}

/** The pass for one applied Import Run. */
export interface EnrichmentPassInput {
  importRunId: string;
  brasiliaDate: string;
  /** What earlier passes of this run already did (all zero for the first); the budget is what is left. */
  previous: CollectionResult;
  /**
   * Called BEFORE EVERY request to Caixa (a page, a photo, a document): it renews the run's lease
   * and throws when this worker no longer holds it, so a stalled pass stops quietly and the next
   * tick resumes (the throw must not be caught, BR-004-07, AR-24).
   */
  assertHeld(): Promise<void>;
  /** Persists the day's totals after each property, so a resumed pass keeps the budget (fenced). */
  saveProgress(progress: CollectionResult): Promise<void>;
}

/**
 * AR-10: the seam between the daily list apply (SPEC-004 part 3) and the detail-page collection
 * (part 4, `auctions/enrichment/`). The orchestrator runs the pass once the list is applied, stores
 * its result on the Import Run, and only then completes the daily update (BR-004-23): "finished,
 * either completed or out of budget".
 *
 * Contract for implementations: the pass is IDEMPOTENT (a run whose process died between the apply
 * and the end of the pass is resumed and the pass runs again, from `previous`), it stays within the
 * daily budget, it checks the lease before every request to Caixa (`assertHeld`), it stops on a
 * block without trying to get around it (BR-004-20, SC-24) and reports `blocked`, and it never
 * throws for a single property's failure (BR-004-21: counted in `failed`). An error that does
 * escape is logged by its code and the update still completes: the Radar and the digest do not
 * wait on an enrichment fault. The one exception is the lease loss `assertHeld` throws: it ends the
 * pass quietly and the new holder carries on.
 */
export abstract class EnrichmentPass {
  abstract run(input: EnrichmentPassInput): Promise<CollectionResult>;
}

/** What the orchestrator runs when no real pass is provided (specs): nothing is collected. */
@Injectable()
export class NoopEnrichmentPass extends EnrichmentPass {
  private readonly logger = new Logger(NoopEnrichmentPass.name);

  run(input: EnrichmentPassInput): Promise<CollectionResult> {
    this.logger.log('No detail collection is configured: the pass collects nothing');
    return Promise.resolve(input.previous);
  }
}
