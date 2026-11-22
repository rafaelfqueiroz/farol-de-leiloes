// SPEC-010 BR-010-04, BR-010-05 (TS-08, TS-06): the registry and the Clock decide which version is in
// force; a future-dated version is not current and is not served.
import { describe, expect, it } from 'vitest';
import { aLegalDocument, aLegalRegistry } from '../../test/builders/legal-document.builder.js';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { LegalDocumentsService } from './legal-documents.service.js';

const T0 = new Date('2026-06-01T12:00:00.000Z');
const FUTURE = new Date('2026-07-01T03:00:00.000Z');

function build(now = T0) {
  const clock = new FakeClock(now);
  const registry = [
    ...aLegalRegistry('0.1'),
    aLegalDocument({ type: 'terms', version: '0.2', effectiveAt: FUTURE }),
    aLegalDocument({ type: 'privacy', version: '0.2', effectiveAt: FUTURE }),
  ];
  return { clock, service: new LegalDocumentsService(registry, clock) };
}

describe('BR-010-05: the current versions', () => {
  it('are the latest not in the future; a future-dated version is not current', () => {
    const { service } = build();
    expect(service.currentVersions()).toEqual({ terms: '0.1', privacy: '0.1' });
    expect(service.currentRefs()).toEqual([
      { type: 'terms', version: '0.1' },
      { type: 'privacy', version: '0.1' },
    ]);
  });

  it('switch at exactly effectiveAt of the new version, following the Clock', () => {
    const { clock, service } = build();
    clock.set(new Date(FUTURE.getTime() - 1));
    expect(service.currentVersions().terms).toBe('0.1');
    clock.set(FUTURE);
    expect(service.currentVersions()).toEqual({ terms: '0.2', privacy: '0.2' });
    expect(service.current().terms.version).toBe('0.2');
  });

  it('are a fault, not a silent default, when a document has no version in force', () => {
    const service = new LegalDocumentsService(
      [aLegalDocument({ type: 'terms' })],
      new FakeClock(T0),
    );
    expect(() => service.current()).toThrow('No privacy version is in force');
    const early = new LegalDocumentsService(aLegalRegistry('0.1', FUTURE), new FakeClock(T0));
    expect(() => early.currentVersions()).toThrow('No terms version is in force');
  });
});

describe('BR-010-04: published versions', () => {
  it('serves a version in force or past, and never one not in force yet', () => {
    const { clock, service } = build();
    expect(service.find('terms', '0.1')?.version).toBe('0.1');
    expect(service.find('terms', '0.2')).toBeNull(); // future-dated
    clock.set(FUTURE);
    expect(service.find('terms', '0.2')?.version).toBe('0.2');
    expect(service.find('terms', '0.1')?.version).toBe('0.1'); // old versions stay available
  });

  it('answers null for an unknown version, and does not cross the document types', () => {
    const { service } = build();
    expect(service.find('terms', '9.9')).toBeNull();
    expect(service.find('terms', '0.10')).toBeNull(); // 0.10 is not 0.1
    expect(service.find('privacy', '0.1')?.type).toBe('privacy');
  });

  it('lists every version in force or past, by document, newest first, flagging the current', () => {
    const { clock, service } = build();
    expect(service.list().map((l) => [l.document.type, l.document.version, l.current])).toEqual([
      ['terms', '0.1', true],
      ['privacy', '0.1', true],
    ]);
    clock.set(FUTURE);
    expect(service.list().map((l) => [l.document.type, l.document.version, l.current])).toEqual([
      ['terms', '0.2', true],
      ['terms', '0.1', false],
      ['privacy', '0.2', true],
      ['privacy', '0.1', false],
    ]);
  });

  it('orders versions of equal effective instant by the higher version first', () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    const service = new LegalDocumentsService(
      [
        aLegalDocument({ type: 'terms', version: '0.9', effectiveAt: at }),
        aLegalDocument({ type: 'terms', version: '0.10', effectiveAt: at }),
        aLegalDocument({ type: 'privacy', version: '1', effectiveAt: at }),
      ],
      new FakeClock(T0),
    );
    expect(service.list().map((l) => l.document.version)).toEqual(['0.10', '0.9', '1']);
  });
});

describe('a malformed registry stops the boot (AR-41)', () => {
  it('refuses a duplicated version', () => {
    expect(
      () =>
        new LegalDocumentsService(
          [aLegalDocument({ version: '0.1' }), aLegalDocument({ version: '0.1' })],
          new FakeClock(T0),
        ),
    ).toThrow('Invalid legal document registry: terms@0.1');
  });

  it('refuses a version that is not dotted numeric', () => {
    expect(
      () => new LegalDocumentsService([aLegalDocument({ version: 'v1' })], new FakeClock(T0)),
    ).toThrow('Invalid legal document registry: terms@v1');
  });

  it('accepts the same version number under the two document types', () => {
    expect(() => new LegalDocumentsService(aLegalRegistry('0.1'), new FakeClock(T0))).not.toThrow();
  });
});
