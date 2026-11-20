// SPEC-010 BR-010-01, BR-010-03, BR-010-05 (TS-08, TS-06): recording acceptances and telling what is
// pending, over an in-memory repository and the Clock. The unique index that makes concurrent
// accepts end with one row is proven on MongoDB in test/integration/privacy.spec.ts (TS-02).
import { describe, expect, it } from 'vitest';
import { aLegalDocument, aLegalRegistry } from '../../test/builders/legal-document.builder.js';
import { FakeClock, MINUTE } from '../../test/fakes/fake-clock.js';
import { FakeConsentsRepository } from '../../test/fakes/fake-privacy-repositories.js';
import { DomainError } from '../common/errors/domain-error.js';
import { ConsentsService } from './consents.service.js';
import { LegalDocumentsService } from './legal-documents.service.js';

const USER = '64b7f0000000000000000001';
const OTHER = '64b7f0000000000000000002';
const T0 = new Date('2026-06-01T12:00:00.000Z');
const V2_AT = new Date('2026-07-01T03:00:00.000Z');

function build() {
  const clock = new FakeClock(T0);
  const repo = new FakeConsentsRepository();
  const legal = new LegalDocumentsService(
    [
      ...aLegalRegistry('0.1'),
      aLegalDocument({ type: 'terms', version: '0.2', effectiveAt: V2_AT }),
      aLegalDocument({ type: 'privacy', version: '0.2', effectiveAt: V2_AT }),
    ],
    clock,
  );
  return { clock, repo, legal, service: new ConsentsService(repo as never, legal, clock) };
}

const OUTDATED_V1 = new DomainError('TERMS_VERSION_OUTDATED', {
  documents: [
    { type: 'terms', version: '0.1' },
    { type: 'privacy', version: '0.1' },
  ],
});

describe('BR-010-01: which versions a request is for', () => {
  it('is the current ones when the request names none', () => {
    expect(build().service.resolveVersions({})).toEqual({ terms: '0.1', privacy: '0.1' });
  });

  it('is the ones named when they are the current ones', () => {
    expect(build().service.resolveVersions({ terms: '0.1', privacy: '0.1' })).toEqual({
      terms: '0.1',
      privacy: '0.1',
    });
  });

  it('refuses a version that is not the current one, listing the current ones (nothing else)', () => {
    const { clock, service } = build();
    clock.set(V2_AT);
    expect(() => service.resolveVersions({ terms: '0.1', privacy: '0.2' })).toThrow(
      new DomainError('TERMS_VERSION_OUTDATED', {
        documents: [
          { type: 'terms', version: '0.2' },
          { type: 'privacy', version: '0.2' },
        ],
      }),
    );
  });

  it('refuses when only one of the two is stale', () => {
    expect(() => build().service.resolveVersions({ terms: '0.1', privacy: '0.0' })).toThrow(
      OUTDATED_V1,
    );
  });
});

describe('BR-010-03: recording an acceptance', () => {
  it('records both documents with the version, the hash of the text, the time and the method', async () => {
    const { repo, legal, service } = build();

    await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, 'signup_email');

    expect(repo.rows).toEqual([
      {
        userId: USER,
        documentType: 'terms',
        version: '0.1',
        contentHash: legal.find('terms', '0.1')?.contentHash,
        acceptedAt: T0,
        method: 'signup_email',
        consentResetAt: null,
      },
      {
        userId: USER,
        documentType: 'privacy',
        version: '0.1',
        contentHash: legal.find('privacy', '0.1')?.contentHash,
        acceptedAt: T0,
        method: 'signup_email',
        consentResetAt: null,
      },
    ]);
    expect(repo.rows[0]?.contentHash).not.toBe(repo.rows[1]?.contentHash);
  });

  it.each(['signup_email', 'signup_google', 'invitation', 'reacceptance'] as const)(
    'records the method %s',
    async (method) => {
      const { repo, service } = build();
      await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, method);
      expect(repo.rows.map((row) => row.method)).toEqual([method, method]);
    },
  );

  it('leaves what was already accepted as it is: a repeat adds nothing and keeps the first time', async () => {
    const { clock, repo, service } = build();
    await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, 'signup_email');
    clock.advance(5 * MINUTE);

    await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, 'reacceptance');

    expect(repo.rows).toHaveLength(2);
    expect(repo.rows.every((row) => row.acceptedAt.getTime() === T0.getTime())).toBe(true);
    expect(repo.rows.every((row) => row.method === 'signup_email')).toBe(true);
  });

  it('refuses a version that was never published, recording nothing', async () => {
    const { repo, service } = build();
    await expect(
      service.recordAcceptance(USER, { terms: '0.1', privacy: '7.7' }, 'invitation'),
    ).rejects.toMatchObject({ code: 'TERMS_VERSION_OUTDATED' });
    // The check happens before any insert: neither document is half recorded.
    expect(repo.rows).toEqual([]);
  });

  it('refuses a version that is not in force yet: nobody could have been shown it', async () => {
    const { repo, service } = build();
    await expect(
      service.recordAcceptance(USER, { terms: '0.2', privacy: '0.2' }, 'invitation'),
    ).rejects.toMatchObject({ code: 'TERMS_VERSION_OUTDATED' });
    expect(repo.rows).toEqual([]);
  });
});

describe('BR-010-05: re-acceptance and what is pending', () => {
  it('an account that accepted nothing has both current documents pending', async () => {
    expect(await build().service.pendingFor(USER, null)).toEqual([
      { type: 'terms', version: '0.1' },
      { type: 'privacy', version: '0.1' },
    ]);
  });

  it('an up-to-date account has nothing pending, with one query whatever the answer', async () => {
    const { repo, service } = build();
    await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, 'signup_email');

    expect(await service.pendingFor(USER, null)).toEqual([]);
    expect(repo.finds).toBe(1);
    await service.pendingFor(OTHER, null);
    expect(repo.finds).toBe(2);
  });

  it('BR-010-05: duplicate rows of one document cannot make an account look up to date', async () => {
    // Should the unique index ever be missing, two rows of `terms` must not stand in for `privacy`:
    // the decision compares distinct (type, version) pairs, not the number of rows.
    const { repo, service } = build();
    const row = {
      userId: USER,
      documentType: 'terms' as const,
      version: '0.1',
      contentHash: 'a'.repeat(64),
      acceptedAt: T0,
      method: 'signup_email' as const,
      consentResetAt: null,
    };
    repo.insertUnchecked(row);
    repo.insertUnchecked(row);

    expect(await service.pendingFor(USER, null)).toEqual([{ type: 'privacy', version: '0.1' }]);
  });

  it('a newly published version makes both documents pending again, until accepted', async () => {
    const { clock, repo, service } = build();
    await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, 'signup_email');
    clock.set(V2_AT);

    expect(await service.pendingFor(USER, null)).toEqual([
      { type: 'terms', version: '0.2' },
      { type: 'privacy', version: '0.2' },
    ]);

    const accepted = await service.accept(USER, { terms: '0.2', privacy: '0.2' }, null);

    expect(await service.pendingFor(USER, null)).toEqual([]);
    // The older acceptances stay, and the account sees all of them, newest first (BR-010-04).
    expect(accepted.map((a) => [a.documentType, a.version, a.method])).toEqual([
      ['privacy', '0.2', 'reacceptance'],
      ['terms', '0.2', 'reacceptance'],
      ['privacy', '0.1', 'signup_email'],
      ['terms', '0.1', 'signup_email'],
    ]);
    expect(repo.rows).toHaveLength(4);
  });

  it('an accept naming one stale version is refused whole and records nothing', async () => {
    const { clock, service } = build();
    await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, 'signup_email');
    clock.set(V2_AT);
    // An accept of the stale versions is refused whole, and changes nothing.
    await expect(
      service.accept(USER, { terms: '0.2', privacy: '0.1' }, null),
    ).rejects.toMatchObject({
      code: 'TERMS_VERSION_OUTDATED',
    });
    expect(await service.pendingFor(USER, null)).toHaveLength(2);
  });

  it("BR-002-11: one account's acceptance counts for nobody else", async () => {
    const { service } = build();
    await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, 'signup_email');

    expect(await service.pendingFor(OTHER, null)).toHaveLength(2);
    expect(await service.listFor(OTHER, null)).toEqual([]);
    expect(await service.listFor(USER, null)).toHaveLength(2);
  });

  it('refuses a stale accept without recording anything', async () => {
    const { clock, repo, service } = build();
    clock.set(V2_AT);
    await expect(
      service.accept(USER, { terms: '0.1', privacy: '0.1' }, null),
    ).rejects.toMatchObject({
      code: 'TERMS_VERSION_OUTDATED',
    });
    expect(repo.rows).toEqual([]);
  });
});

describe('DL-001-02: consent generations (a takeover starts a new one)', () => {
  const RESET = new Date('2026-06-02T09:00:00.000Z');

  it('an acceptance made before the account was taken over does not count for its owner', async () => {
    const { service } = build();
    // The registrant of the address accepted under generation null.
    await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, 'signup_email', null);

    expect(await service.pendingFor(USER, null)).toEqual([]);
    expect(await service.pendingFor(USER, RESET)).toEqual([
      { type: 'terms', version: '0.1' },
      { type: 'privacy', version: '0.1' },
    ]);
    expect(await service.listFor(USER, RESET)).toEqual([]);
  });

  it('the owner can accept a version the registrant already accepted, and then counts as up to date', async () => {
    const { repo, service } = build();
    await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, 'signup_email', null);

    await service.accept(USER, { terms: '0.1', privacy: '0.1' }, RESET);

    expect(await service.pendingFor(USER, RESET)).toEqual([]);
    expect(repo.rows).toHaveLength(4); // both generations kept: the proof is never rewritten
    expect((await service.listFor(USER, RESET)).map((r) => r.method)).toEqual([
      'reacceptance',
      'reacceptance',
    ]);
  });

  it('a row written under the old generation after the takeover still counts for nobody', async () => {
    // The registrant's request finished writing its consents after the owner took the account over.
    const { service } = build();
    await service.recordAcceptance(USER, { terms: '0.1', privacy: '0.1' }, 'signup_email'); // default: null

    expect(await service.pendingFor(USER, RESET)).toHaveLength(2);
  });
});
