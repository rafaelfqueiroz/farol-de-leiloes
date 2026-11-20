// SPEC-010 BR-010-24..26: the launch checklist, from the gates, the documents in force and the
// settings. Platform state only: nothing here can carry a validator's name (it never receives one).
import { describe, expect, it } from 'vitest';
import {
  buildLaunchChecklist,
  type ChecklistGate,
  type ChecklistInput,
  type ChecklistSettings,
  GATE_BLOCKS,
  LAWYER_SET_PERIODS,
} from './launch-checklist.js';
import { LEGAL_VALIDATION_SCOPES, type LegalValidationScope } from './legal-validation.js';

const SETTINGS: ChecklistSettings = {
  termsEnforcementEnabled: true,
  accountPurgeEnabled: true,
  dataExportEnabled: true,
  documentRetentionEnabled: true,
  privateBucketConfigured: true,
  legalGateEnforced: true,
};
const FINAL = [
  { type: 'terms' as const, version: '1.0', draft: false },
  { type: 'privacy' as const, version: '1.0', draft: false },
];
const AT = new Date('2026-06-01T12:00:00.000Z');

const gate = (scope: LegalValidationScope, validated: boolean): ChecklistGate => ({
  scope,
  validated,
  validatedAt: validated ? AT : null,
  documentVersions: validated ? ['terms:1.0'] : null,
});
const input = (overrides: Partial<ChecklistInput> = {}): ChecklistInput => ({
  gates: LEGAL_VALIDATION_SCOPES.map((scope) => gate(scope, false)),
  current: FINAL,
  documentRetentionYears: 5,
  settings: SETTINGS,
  ...overrides,
});

describe('buildLaunchChecklist', () => {
  it('without any validation every gate blocks, the periods are provisional and the launch is not ready', () => {
    const checklist = buildLaunchChecklist(input());

    expect(checklist.launchReady).toBe(false);
    expect(checklist.retention).toEqual({ documentYears: 5, provisional: true });
    expect(checklist.gates.map((g) => [g.scope, g.validated])).toEqual([
      ['third-party-processing', false],
      ['retention-periods', false],
      ['privacy-policy', false],
      ['terms', false],
    ]);
    expect(checklist.gates[0]?.blocks).toEqual([
      'SPEC-015 manual legal analysis',
      'SPEC-024 AI document analysis',
      'F1 launch (RNF-23)',
    ]);
  });

  it('is ready only with all four validations, no draft and the periods validated', () => {
    const ready = buildLaunchChecklist(
      input({ gates: LEGAL_VALIDATION_SCOPES.map((scope) => gate(scope, true)) }),
    );
    expect(ready.launchReady).toBe(true);
    expect(ready.retention.provisional).toBe(false);
    expect(ready.drafts).toEqual([]);
  });

  it.each(LEGAL_VALIDATION_SCOPES)('is not ready while only %s is missing', (missing) => {
    const checklist = buildLaunchChecklist(
      input({ gates: LEGAL_VALIDATION_SCOPES.map((scope) => gate(scope, scope !== missing)) }),
    );
    expect(checklist.launchReady).toBe(false);
    expect(checklist.retention.provisional).toBe(missing === 'retention-periods');
  });

  it('is not ready while a current document is still a draft, and lists it', () => {
    const checklist = buildLaunchChecklist(
      input({
        gates: LEGAL_VALIDATION_SCOPES.map((scope) => gate(scope, true)),
        current: [
          { type: 'terms', version: '0.1', draft: true },
          { type: 'privacy', version: '1.0', draft: false },
        ],
      }),
    );
    expect(checklist.drafts).toEqual([{ type: 'terms', version: '0.1' }]);
    expect(checklist.launchReady).toBe(false);
  });

  it('shows the lawyer-set periods as kept, not deleted', () => {
    const checklist = buildLaunchChecklist(input());
    expect(checklist.lawyerSetPeriods).toHaveLength(3);
    for (const period of checklist.lawyerSetPeriods) {
      expect(period.deleted).toBe(false);
      expect(period.note).toBe('kept until the lawyer sets the period (Q-21)');
    }
    expect(checklist.lawyerSetPeriods.map((p) => p.item)).toEqual(
      LAWYER_SET_PERIODS.map((p) => p.item),
    );
  });

  it('passes the settings and the document period on', () => {
    const checklist = buildLaunchChecklist(
      input({ documentRetentionYears: 6, settings: { ...SETTINGS, legalGateEnforced: false } }),
    );
    expect(checklist.retention.documentYears).toBe(6);
    expect(checklist.settings.legalGateEnforced).toBe(false);
  });

  it('every scope says what it blocks', () => {
    for (const scope of LEGAL_VALIDATION_SCOPES)
      expect(GATE_BLOCKS[scope].length).toBeGreaterThan(0);
  });
});
