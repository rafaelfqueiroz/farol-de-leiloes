// SPEC-010 BR-010-24..26: what the F1 launch still waits on, as plain values. Pure (AR-05): the gate
// statuses, the current documents and the settings come in as arguments. The words in `blocks` and
// `note` are the operator's checklist, not user-facing product text.
import type { LegalDocumentType } from './legal-versions.js';
import type { LegalValidationScope } from './legal-validation.js';

/** What stays blocked while the scope's validation is missing (BR-010-25: the F1 launch waits on all). */
export const GATE_BLOCKS: Readonly<Record<LegalValidationScope, readonly string[]>> = {
  'third-party-processing': [
    'SPEC-015 manual legal analysis',
    'SPEC-024 AI document analysis',
    'F1 launch (RNF-23)',
  ],
  'retention-periods': ['F1 launch (RNF-24): the retention periods stay provisional'],
  'privacy-policy': ['F1 launch: the privacy policy text'],
  terms: ['F1 launch: the terms of use text'],
};

/** BR-010-22, BR-010-23: periods only the lawyer sets (Q-21); until then nothing is deleted. */
export const LAWYER_SET_PERIODS: readonly { readonly item: string; readonly note: string }[] = [
  {
    item: 'Billing records of subscriptions (BR-010-22)',
    note: 'kept until the lawyer sets the period (Q-21)',
  },
  { item: 'Admin access log (BR-010-23)', note: 'kept until the lawyer sets the period (Q-21)' },
  {
    item: 'Account status records (BR-010-23)',
    note: 'kept until the lawyer sets the period (Q-21)',
  },
];

export interface ChecklistGate {
  readonly scope: LegalValidationScope;
  readonly validated: boolean;
  readonly validatedAt: Date | null;
  readonly documentVersions: readonly string[] | null;
}

export interface ChecklistSettings {
  readonly termsEnforcementEnabled: boolean;
  readonly accountPurgeEnabled: boolean;
  readonly dataExportEnabled: boolean;
  readonly documentRetentionEnabled: boolean;
  readonly privateBucketConfigured: boolean;
  readonly legalGateEnforced: boolean;
}

export interface LaunchChecklist {
  readonly gates: readonly (ChecklistGate & { readonly blocks: readonly string[] })[];
  readonly drafts: readonly { readonly type: LegalDocumentType; readonly version: string }[];
  readonly retention: { readonly documentYears: number; readonly provisional: boolean };
  readonly lawyerSetPeriods: readonly {
    readonly item: string;
    readonly deleted: false;
    readonly note: string;
  }[];
  readonly settings: ChecklistSettings;
  readonly launchReady: boolean;
}

export interface ChecklistInput {
  readonly gates: readonly ChecklistGate[];
  /** The current legal documents with their draft flag. */
  readonly current: readonly { type: LegalDocumentType; version: string; draft: boolean }[];
  readonly documentRetentionYears: number;
  readonly settings: ChecklistSettings;
}

/**
 * The checklist: a gate is blocking until validated; a current document still marked draft blocks;
 * the retention periods are provisional until their gate is validated (BR-010-24). `launchReady` is
 * every gate validated, no draft and not provisional (BR-010-26, DL-010-07).
 */
export function buildLaunchChecklist(input: ChecklistInput): LaunchChecklist {
  const drafts = input.current
    .filter((document) => document.draft)
    .map(({ type, version }) => ({ type, version }));
  const provisional = !input.gates.some(
    (gate) => gate.scope === 'retention-periods' && gate.validated,
  );
  return {
    gates: input.gates.map((gate) => ({ ...gate, blocks: GATE_BLOCKS[gate.scope] })),
    drafts,
    retention: { documentYears: input.documentRetentionYears, provisional },
    lawyerSetPeriods: LAWYER_SET_PERIODS.map((period) => ({ ...period, deleted: false as const })),
    settings: input.settings,
    launchReady: input.gates.every((gate) => gate.validated) && drafts.length === 0 && !provisional,
  };
}
