// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '@/messages/pt-BR.json';

// DS-28, BR-003-18: one wording per concept. Each entry names a variant that must not come back
// and the wording that replaces it; add a line here when a review settles a new concept.
const BANNED_WORDING: { variant: RegExp; use: string }[] = [
  { variant: /\bemail\b/i, use: 'E-mail (with the hyphen)' },
  { variant: /\bLogin\b/, use: 'Entrar for the action; "o login" only as a noun in a sentence' },
  { variant: /\bpre[cç]o m[ií]nimo\b/i, use: 'lance mínimo' },
  { variant: /\bLance M[ií]nimo\b/, use: 'lance mínimo (sentence case)' },
  { variant: /\bValor de Avalia/, use: 'valor de avaliação (sentence case)' },
  { variant: /\bmatricula\b/i, use: 'matrícula' },
];

function leaves(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      leaves(value, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

const entries = leaves(messages);

describe('pt-BR catalogue vocabulary (DS-28)', () => {
  it('has strings to check', () => {
    expect(entries.length).toBeGreaterThan(200);
  });

  it.each(BANNED_WORDING)('never says $variant (use $use)', ({ variant }) => {
    const hits = entries
      // "E-mail" is the allowed spelling and ICU placeholders / rich tags are not copy
      .map(([path, text]) => [path, text.replace(/e-mail|\{[^}]*\}|<[^>]*>/gi, '')] as const)
      .filter(([, text]) => variant.test(text))
      .map(([path]) => path);
    expect(hits).toEqual([]);
  });

  it('has no accent-less Portuguese from the legacy literals', () => {
    const accentless = /\b(voce|nao|sera|pagina|invalido|verificacao|descricao|codigo|ate)\b/i;
    const hits = entries.filter(([, text]) => accentless.test(text)).map(([path]) => path);
    expect(hits).toEqual([]);
  });
});

describe('literal debt (DS-20)', () => {
  it('has no react/jsx-no-literals entry left in the bulk suppressions', () => {
    const file = resolve(import.meta.dirname, '../../eslint-suppressions.json');
    expect(readFileSync(file, 'utf8')).not.toContain('react/jsx-no-literals');
  });
});
