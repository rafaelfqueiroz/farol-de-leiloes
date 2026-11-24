import { Injectable, Logger } from '@nestjs/common';

/** What the day's detail-collection pass did (BR-004-18..21, BR-004-27). Counts and a flag. */
export interface CollectionResult {
  collected: number;
  failed: number;
  /** Caixa answered with a block or challenge: collection stopped for the run (BR-004-20). */
  blocked: boolean;
}

/** The pass for one applied Import Run. */
export interface EnrichmentPassInput {
  importRunId: string;
  brasiliaDate: string;
}

/**
 * AR-10: the seam between the daily list apply (SPEC-004 part 3) and the detail-page collection
 * (part 4, `auctions/enrichment/`). The orchestrator runs the pass once the list is applied, stores
 * its result on the Import Run, and only then completes the daily update (BR-004-23): "finished,
 * either completed or out of budget".
 *
 * Contract for implementations: the pass is IDEMPOTENT (a run whose process died between the apply
 * and the end of the pass is resumed and the pass runs again), it stays within the daily budget, it
 * stops on a block without trying to get around it (BR-004-20, SC-24) and reports `blocked`, and
 * it never throws for a single property's failure (BR-004-21: counted in `failed`). An error that
 * does escape is logged by its code and the update still completes: the Radar and the digest do
 * not wait on an enrichment fault.
 */
export abstract class EnrichmentPass {
  abstract run(input: EnrichmentPassInput): Promise<CollectionResult>;
}

/** The default until part 4: nothing is collected, nothing is blocked. */
@Injectable()
export class NoopEnrichmentPass extends EnrichmentPass {
  private readonly logger = new Logger(NoopEnrichmentPass.name);

  run(): Promise<CollectionResult> {
    this.logger.log('No detail collection is configured: the pass collects nothing');
    return Promise.resolve({ collected: 0, failed: 0, blocked: false });
  }
}
