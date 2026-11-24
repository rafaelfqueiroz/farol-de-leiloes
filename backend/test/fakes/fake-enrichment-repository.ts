// TS-03 / TS-07: a hand-written, in-memory fake of `EnrichmentRepository` (the detail collection's
// one door to the auction model, AR-08), so the services of `auctions/enrichment/` run in plain
// unit specs. It implements the real signatures and records what was written; the real queries
// are exercised against MongoDB by test/integration/detail-collection.spec.ts.
import type { QueueCandidate } from '../../src/auctions/domain/enrichment-queue.js';
import type {
  ClockCandidate,
  CollectionWrite,
  EnrichmentRepository,
  StoredForCollection,
} from '../../src/auctions/enrichment/enrichment.repository.js';

type Port = Pick<
  EnrichmentRepository,
  | 'findCandidates'
  | 'findForCollection'
  | 'applyCollection'
  | 'markVersionChecked'
  | 'recordFailure'
  | 'findClockCandidates'
  | 'setCurrentRoundLabel'
>;

export function aStoredProperty(
  code: string,
  overrides: Partial<StoredForCollection> = {},
): StoredForCollection {
  return {
    code,
    detailsUrl: `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=${code}`,
    available: true,
    modality: null,
    phaseCount: 1,
    rounds: [],
    paymentMethods: null,
    expenseRules: null,
    propertyType: null,
    occupancy: null,
    photos: [],
    documentVersions: [],
    detailsFailures: 0,
    detailsCollectedAt: null,
    currentRoundLabel: undefined,
    ...overrides,
  };
}

export function aCandidate(code: string, overrides: Partial<QueueCandidate> = {}): QueueCandidate {
  return {
    code,
    available: true,
    active: true,
    hasDetailsUrl: true,
    fulfilled: false,
    detailsCollectedAt: null,
    lastChangedRunId: null,
    detailsRetryAfter: null,
    detailsFailures: 0,
    ...overrides,
  };
}

export class FakeEnrichmentRepository implements Port {
  /** What `findCandidates` answers. */
  candidates: QueueCandidate[] = [];
  /** The stored properties by code (what `findForCollection` answers). */
  readonly stored = new Map<string, StoredForCollection>();
  /** The clock's candidates, by code order. */
  clockCandidates: ClockCandidate[] = [];
  readonly queries: { limit: number }[] = [];
  readonly applied: { code: string; write: CollectionWrite }[] = [];
  readonly checked: { code: string; kind: string; contentHash: string }[] = [];
  readonly failures: { code: string; failures: number; retryAfter: Date }[] = [];
  readonly labelMoves: {
    code: string;
    expected: string | null | undefined;
    label: string | null;
  }[] = [];
  /** The order things were written in, across methods. */
  readonly calls: string[] = [];
  /** Makes `applyCollection` fail, as a database that went away. */
  failApply: Error | null = null;

  async findCandidates(input: { limit: number }): Promise<QueueCandidate[]> {
    this.queries.push({ limit: input.limit });
    return this.candidates;
  }

  async findForCollection(code: string): Promise<StoredForCollection | null> {
    return this.stored.get(code) ?? null;
  }

  async applyCollection(code: string, write: CollectionWrite): Promise<void> {
    this.calls.push('applyCollection');
    if (this.failApply) throw this.failApply;
    this.applied.push({ code, write });
  }

  async markVersionChecked(
    code: string,
    check: { kind: 'MATRICULA' | 'EDITAL'; contentHash: string },
  ): Promise<void> {
    this.checked.push({ code, kind: check.kind, contentHash: check.contentHash });
  }

  async recordFailure(code: string, failures: number, retryAfter: Date): Promise<void> {
    this.failures.push({ code, failures, retryAfter });
  }

  async findClockCandidates(
    _now: Date,
    afterCode: string | null,
    limit: number,
  ): Promise<ClockCandidate[]> {
    return this.clockCandidates
      .filter((candidate) => afterCode === null || candidate.code > afterCode)
      .slice(0, limit);
  }

  async setCurrentRoundLabel(
    code: string,
    expected: string | null | undefined,
    label: string | null,
  ): Promise<void> {
    this.labelMoves.push({ code, expected, label });
  }
}
