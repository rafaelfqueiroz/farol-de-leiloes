// SPEC-010 BR-010-26: the script's use case writes one insert-only record with the Clock's instant,
// and writes nothing when the rules refuse.
import { describe, expect, it } from 'vitest';
import { aLegalDocument } from '../../../../test/builders/legal-document.builder.js';
import { FakeClock } from '../../../../test/fakes/fake-clock.js';
import { FakeLegalValidationsRepository } from '../../../../test/fakes/fake-privacy-repositories.js';
import { RecordValidationCommand } from './record-validation.command.js';

const NOW = new Date('2026-08-10T15:30:00.000Z');
const REGISTRY = [
  aLegalDocument({ type: 'terms', version: '0.1', draft: true }),
  aLegalDocument({ type: 'terms', version: '1.0', draft: false }),
  aLegalDocument({ type: 'privacy', version: '1.0', draft: false }),
];

function build() {
  const repo = new FakeLegalValidationsRepository();
  return {
    repo,
    command: new RecordValidationCommand(repo as never, new FakeClock(NOW), REGISTRY),
  };
}

describe('RecordValidationCommand', () => {
  it('records the validation with the instant of the Clock', async () => {
    const { command, repo } = build();

    const outcome = await command.run({
      scope: 'privacy-policy',
      validator: 'Dra. Fulana',
      versions: ['privacy:1.0'],
      reference: 'parecer-3',
    });

    expect(outcome).toEqual({
      result: 'recorded',
      scope: 'privacy-policy',
      documentVersions: ['privacy:1.0'],
    });
    expect(repo.rows).toEqual([
      {
        scope: 'privacy-policy',
        validatedAt: NOW,
        validatorName: 'Dra. Fulana',
        documentVersions: ['privacy:1.0'],
        reference: 'parecer-3',
      },
    ]);
    expect(JSON.stringify(outcome)).not.toContain('Fulana');
  });

  it('records the retention period reviewed', async () => {
    const { command, repo } = build();

    await command.run({
      scope: 'retention-periods',
      validator: 'Ana',
      versions: [],
      retentionYears: 6,
    });

    expect(repo.rows[0]).toMatchObject({ scope: 'retention-periods', retentionYears: 6 });
    expect(repo.rows[0]).not.toHaveProperty('reference');
  });

  it('writes nothing when a draft is named', async () => {
    const { command, repo } = build();

    const outcome = await command.run({
      scope: 'terms',
      validator: 'Ana Lima',
      versions: ['terms:0.1'],
    });

    expect(outcome).toMatchObject({ result: 'refused' });
    expect(repo.rows).toEqual([]);
  });
});
