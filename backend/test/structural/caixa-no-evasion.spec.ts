// SC-24 / SPEC-004 D-50, BR-004-20, DL-004-11: scraping Caixa is polite and undisguised, so "a
// review of the collection code must find none" of: a stealth plugin, a spoofed browser identity,
// a CAPTCHA-solving service, or a shell that works around the site's protection. This is that
// review as a test: it fails the build if one comes back. The rules themselves are in
// docs/guidelines/SECURITY.md; changing them takes a new ADR (ADR-003 is only Proposed).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const BACKEND = join(import.meta.dirname, '..', '..');
const SRC = join(BACKEND, 'src');

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => relative(SRC, join(SRC, file)).split('\\').join('/'));
}

// Packages that patch headless traces or solve the challenge for us.
const EVASION_PACKAGE =
  /^(puppeteer-extra(-.*)?|playwright-extra|.*stealth.*|.*2captcha.*|.*anti-?captcha.*|.*capsolver.*|.*capmonster.*)$/i;

/** The banned dependencies a package.json declares, in any dependency section. */
export function evasionDependencies(packageJson: string): string[] {
  const pkg = JSON.parse(packageJson) as Record<string, Record<string, string> | undefined>;
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((section) => Object.keys(pkg[section] ?? {}))
    .filter((name) => EVASION_PACKAGE.test(name));
}

/** A browser's user agent in code: `Mozilla/5.0`, or a call that overrides the browser's own. */
const SPOOFED_IDENTITY = /Mozilla\/\d|setUserAgent\s*\(|--user-agent|userAgent\s*:/;

export function spoofsBrowserIdentity(source: string): boolean {
  return SPOOFED_IDENTITY.test(source);
}

/** A `User-Agent` header must carry the product's own constant, never a literal. */
export function setsForeignUserAgentHeader(source: string): boolean {
  return source
    .split('\n')
    .some((line) => /['"]user-agent['"]\s*:/i.test(line) && !line.includes('CAIXA_USER_AGENT'));
}

/** Comments or strings that describe getting around the site's bot protection as a goal. */
const BYPASS_TALK =
  /\b(bypass(ing|es)?|circumvent(ing|s)?|evad(e|es|ing)|defeat(ing|s)?|get(ting)?\s+(around|past))\s+(the\s+|its\s+|a\s+)?(bot[- ]?(protection|detection|manager|check)|captcha|radware|shield\s*square|waf|anti-?bot)/i;

export function talksOfBypassingProtection(source: string): boolean {
  return BYPASS_TALK.test(source);
}

/** The shell: a child process is how `curl | iconv` got around what Node's client could not. */
const SPAWNS_PROCESS = /(?:from\s+|require\(\s*|import\(\s*)['"](?:node:)?child_process['"]/;

export function spawnsProcess(source: string): boolean {
  return SPAWNS_PROCESS.test(source);
}

describe('SC-24: the collection code carries no evasion', () => {
  const files = sourceFiles().map((file) => ({
    file,
    source: readFileSync(join(SRC, file), 'utf8'),
  }));

  it('has no stealth plugin or CAPTCHA solver among the dependencies', () => {
    expect(evasionDependencies(readFileSync(join(BACKEND, 'package.json'), 'utf8'))).toEqual([]);
  });

  it('has none installed either (the lockfile)', () => {
    const lock = JSON.parse(readFileSync(join(BACKEND, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, unknown>;
    };
    const installed = Object.keys(lock.packages)
      .map((path) => path.replace(/^.*node_modules\//, ''))
      .filter((name) => name !== '' && EVASION_PACKAGE.test(name));

    expect(installed).toEqual([]);
  });

  it('presents no browser identity in any source file', () => {
    expect(files.filter(({ source }) => spoofsBrowserIdentity(source)).map((f) => f.file)).toEqual(
      [],
    );
  });

  it('sets a User-Agent header only from CAIXA_USER_AGENT', () => {
    expect(
      files.filter(({ source }) => setsForeignUserAgentHeader(source)).map((f) => f.file),
    ).toEqual([]);
  });

  it('never describes getting around bot protection', () => {
    expect(
      files.filter(({ source }) => talksOfBypassingProtection(source)).map((f) => f.file),
    ).toEqual([]);
  });

  it('runs no shell command in the Caixa modules (no curl, no child_process)', () => {
    expect(
      files
        .filter(({ file }) => file.startsWith('auctions/') || file.startsWith('storage/'))
        .filter(({ source }) => spawnsProcess(source))
        .map((f) => f.file),
    ).toEqual([]);
  });

  it('keeps Caixa requests in the port: only known files still reach Caixa on their own', () => {
    // The detail scraper (puppeteer) and the storage copies (fetch of a Caixa URL) are the two
    // that predate the CaixaAccess port; they move behind it with SPEC-004 part 3. This list may
    // only shrink. The LLM adapter's fetch goes to the model provider, not to Caixa.
    const KNOWN_DIRECT = [
      'ai/adapters/llm.adapter.ts',
      'auctions/scraper/details-scraper.ts',
      'storage/storage.service.ts',
    ];
    const reachingOut = files
      .filter(({ file }) => !file.startsWith('auctions/caixa/'))
      .filter(({ source }) => /\bfetch\(|from 'puppeteer'|from 'undici'|from 'axios'/.test(source))
      .map((f) => f.file)
      .sort();

    expect(reachingOut).toEqual(KNOWN_DIRECT);
  });
});

describe('the detectors', () => {
  it('see a stealth or CAPTCHA package', () => {
    const json = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });
    expect(evasionDependencies(json({ 'puppeteer-extra-plugin-stealth': '^2.0.0' }))).toEqual([
      'puppeteer-extra-plugin-stealth',
    ]);
    expect(evasionDependencies(json({ '2captcha': '1.0.0', puppeteer: '^25' }))).toEqual([
      '2captcha',
    ]);
    expect(
      evasionDependencies(JSON.stringify({ devDependencies: { 'puppeteer-extra': '3' } })),
    ).toEqual(['puppeteer-extra']);
    expect(evasionDependencies(json({ puppeteer: '^25', cheerio: '^1' }))).toEqual([]);
    expect(evasionDependencies('{}')).toEqual([]);
  });

  it.each([
    "headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' }",
    "await page.setUserAgent('whatever');",
    "args: ['--user-agent=Foo']",
    "{ userAgent: 'x' }",
  ])('see a browser identity in %s', (line) => {
    expect(spoofsBrowserIdentity(line)).toBe(true);
  });

  it('see the honest identity as honest', () => {
    expect(spoofsBrowserIdentity("headers: { 'User-Agent': CAIXA_USER_AGENT }")).toBe(false);
    expect(setsForeignUserAgentHeader("headers: { 'User-Agent': CAIXA_USER_AGENT }")).toBe(false);
    expect(setsForeignUserAgentHeader("headers: { 'User-Agent': 'FarolDosLeiloes/1.0' }")).toBe(
      true,
    );
    expect(setsForeignUserAgentHeader("headers: { 'user-agent': ua }")).toBe(true);
  });

  it.each([
    '// Use curl to bypass bot protection - it works while Node.js https does not',
    '// getting around the Radware challenge',
    '// circumvent captcha',
    '// evade anti-bot checks',
    '// Bypassing the bot manager',
  ])('hear a goal of defeating protection in %s', (line) => {
    expect(talksOfBypassingProtection(line)).toBe(true);
  });

  it.each([
    '// the run stops on a challenge and never tries to get past it',
    '// a guard that is bypassed or raced',
    '// .lean() bypasses casting',
    '// never answers the Radware page',
  ])('let %s pass', (line) => {
    expect(talksOfBypassingProtection(line)).toBe(false);
  });

  it('see a child_process import', () => {
    expect(spawnsProcess("import { exec } from 'child_process';")).toBe(true);
    expect(spawnsProcess("const cp = require('node:child_process');")).toBe(true);
    expect(spawnsProcess("import { x } from './process.js';")).toBe(false);
  });
});
