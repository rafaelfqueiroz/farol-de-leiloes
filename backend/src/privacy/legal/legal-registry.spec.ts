// SPEC-010 BR-010-04, BR-010-06, BR-010-26 (TS-08): the published legal texts. A published version is
// never edited: every version in the registry is pinned below with its effective instant and the
// sha256 of its text, so an edit fails here and the fix is a NEW version (a new file, a new entry
// here), never a changed pin. The pins are literals on purpose (TS-04): they are what the version
// WAS when it was published, not what the code computes now.
import { describe, expect, it } from 'vitest';
import { getMetadataStorage } from 'class-validator';
import { PROFILE_EDITABLE } from '../../../test/support/profile-fields.js';
import { RegisterDto } from '../../auth/dto/register.dto.js';
import { VERSION_PATTERN } from '../domain/legal-versions.js';
import { contentHashOf, DRAFT_BANNER, publish } from './legal-document.js';
import { LEGAL_REGISTRY } from './registry.js';

/** type@version → the instant it takes effect and the sha256 (hex) of its text. */
const PINNED: Record<string, { effectiveAt: string; contentHash: string }> = {
  'terms@0.1': {
    effectiveAt: '2026-11-19T03:00:00.000Z',
    contentHash: 'e3564cd1706729ac3ce14b58f7024c8e8b0377a5c7db071ed68d9c18a3292ce9',
  },
  'privacy@0.1': {
    effectiveAt: '2026-11-19T03:00:00.000Z',
    contentHash: '7a51bfbd0cf9cf21ebd96aaadbaf34291101ac880163166c29960b8760072e14',
  },
};

const keyOf = (document: { type: string; version: string }) =>
  `${document.type}@${document.version}`;

describe('BR-010-04: a published legal text is never edited', () => {
  it('pins the effective instant and the hash of every published version', () => {
    const published = Object.fromEntries(
      LEGAL_REGISTRY.map((document) => [
        keyOf(document),
        { effectiveAt: document.effectiveAt.toISOString(), contentHash: document.contentHash },
      ]),
    );
    expect(published).toEqual(PINNED);
  });

  it('has no version that is not pinned, and no pin without its version', () => {
    expect(LEGAL_REGISTRY.map(keyOf).sort()).toEqual(Object.keys(PINNED).sort());
  });

  it('publishes each version once, with a dotted numeric version number', () => {
    const keys = LEGAL_REGISTRY.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
    for (const document of LEGAL_REGISTRY) expect(document.version).toMatch(VERSION_PATTERN);
  });

  it('hashes everything the reader sees: the title, the banner and the content each change it', () => {
    const base = LEGAL_REGISTRY[0];
    if (!base) throw new Error('empty registry');
    const hash = (changes: Partial<typeof base>) => contentHashOf({ ...base, ...changes });
    expect(hash({})).toBe(base.contentHash);
    expect(hash({ title: `${base.title}!` })).not.toBe(base.contentHash);
    expect(hash({ banner: null })).not.toBe(base.contentHash);
    expect(hash({ content: `${base.content} ` })).not.toBe(base.contentHash);
    expect(hash({ version: '9.9' })).not.toBe(base.contentHash);
    expect(base.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is frozen: publishing yields an immutable record', () => {
    const published = publish({ ...(LEGAL_REGISTRY[0] as (typeof LEGAL_REGISTRY)[number]) });
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(LEGAL_REGISTRY)).toBe(true);
  });
});

describe('BR-010-26: the placeholder texts say so', () => {
  it.each(LEGAL_REGISTRY.map((document) => [keyOf(document), document] as const))(
    '%s is marked as a draft pending legal review, in the banner and in the text',
    (_key, document) => {
      expect(document.draft).toBe(true);
      expect(document.banner).toBe('RASCUNHO — pendente de revisão jurídica');
      expect(DRAFT_BANNER).toBe(document.banner);
      expect(document.content).toContain(`**${DRAFT_BANNER}.**`);
    },
  );

  it('is an outline of topics, not legal prose: every bullet is a topic', () => {
    for (const document of LEGAL_REGISTRY) {
      const bullets = document.content.split('\n').filter((line) => line.startsWith('- '));
      expect(bullets.length).toBeGreaterThan(5);
      for (const bullet of bullets) expect(bullet.startsWith('- Tópico:')).toBe(true);
    }
  });
});

describe('BR-010-07: what the terms state (as topics)', () => {
  const terms = LEGAL_REGISTRY.find((document) => document.type === 'terms')?.content ?? '';

  it.each([
    ['the isolation guarantee between advisors', /isolamento entre assessores/i],
    [
      'platform-linked advisors getting no extra access (BR-002-22)',
      /vinculados à plataforma[^\n]*acesso adicional/,
    ],
    [
      'the roles of the platform, the advisor and the AI',
      /papel da plataforma[\s\S]*papel do assessor[\s\S]*inteligência artificial/i,
    ],
    ['that the platform does not place bids', /não dá lances/],
    ['that the platform does not make payments', /não realiza pagamentos/],
  ])('mentions %s', (_what, pattern) => {
    expect(terms).toMatch(pattern);
  });
});

describe('BR-010-02: the purposes the privacy policy lists (SECURITY.md §9)', () => {
  const privacy = LEGAL_REGISTRY.find((document) => document.type === 'privacy')?.content ?? '';

  it.each([
    'conta e acesso',
    'comprovação de aceite e de consentimentos',
    'funcionalidades usadas pela conta',
    'perfil de investidor',
    'gestão de aquisições',
    'documentos e fotos de jornadas',
    'terceiros presentes em documentos',
    'assinaturas de escritórios',
    'suporte',
    'registro de acesso administrativo',
    'sessões e segurança',
  ])('lists the purpose "%s"', (purpose) => {
    expect(privacy.toLowerCase()).toContain(purpose);
  });

  it('BR-010-27: states the WhatsApp consent as separate, optional, unticked and revocable', () => {
    expect(privacy).toMatch(/separado dos termos e não marcado por padrão/);
    expect(privacy).toMatch(/retirar o consentimento a qualquer momento/);
  });
});

describe('BR-010-06: every field collected at sign-up and in the profile has a purpose', () => {
  const privacy = LEGAL_REGISTRY.find((document) => document.type === 'privacy')?.content ?? '';
  /** The fields named in the first column of the policy's field-to-purpose table. */
  const tableFields = [...privacy.matchAll(/^\| `(\w+)` \|/gm)].map((match) => match[1]);

  /** What a sign-up request carries that is not data about the person (consent artefacts). */
  const CONSENT_ARTEFACTS = ['acceptTerms', 'termsVersion', 'privacyVersion', 'whatsappConsent'];

  const signUpFields = [
    ...new Set(
      getMetadataStorage()
        .getTargetValidationMetadatas(RegisterDto, '', true, false)
        .map((metadata) => metadata.propertyName),
    ),
  ].filter((field) => !CONSENT_ARTEFACTS.includes(field));

  it('maps every field of the sign-up request to a row of the table', () => {
    expect(signUpFields.sort()).toEqual(['email', 'name', 'password']);
    for (const field of signUpFields) expect(tableFields).toContain(field);
  });

  it('maps every field the account holder edits in the profile to a row of the table', () => {
    for (const field of PROFILE_EDITABLE) expect(tableFields).toContain(field);
  });

  it('has no row for a field that is not collected, and each field once', () => {
    expect([...tableFields].sort()).toEqual(['email', 'name', 'password', 'phone']);
  });
});
