// SC-24 / SPEC-004 D-50, BR-004-20, DL-004-11: scraping Caixa is polite and undisguised, so "a
// review of the collection code must find none" of: a stealth plugin or fingerprint patch, a
// spoofed browser identity, a CAPTCHA-solving service, a rotating-proxy library, or a shell that
// works around the site's protection. This is that review as a test: it fails the build if one
// comes back. The rules themselves are in docs/guidelines/SECURITY.md; changing them takes a new
// ADR (ADR-003 is only Proposed). Scope: backend/src, backend/scripts, deploy/ and
// .github/workflows/ (the specs are exempt: they name these things to prove the detectors).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const BACKEND = join(import.meta.dirname, '..', '..');
const REPO = join(BACKEND, '..');
const SRC = join(BACKEND, 'src');

const SCANNED = [
  { dir: SRC, prefix: 'backend/src' },
  { dir: join(BACKEND, 'scripts'), prefix: 'backend/scripts' },
  { dir: join(REPO, 'deploy'), prefix: 'deploy' },
  { dir: join(REPO, '.github', 'workflows'), prefix: '.github/workflows' },
];
const EXTENSIONS = /\.(ts|js|mjs|cjs|sh|ya?ml)$/;

interface ScannedFile {
  /** Path from the repository root. */
  file: string;
  source: string;
}

function scannedFiles(): ScannedFile[] {
  return SCANNED.filter(({ dir }) => existsSync(dir)).flatMap(({ dir, prefix }) =>
    (readdirSync(dir, { recursive: true }) as string[])
      .filter((file) => EXTENSIONS.test(file) && !/\.spec\.ts$/.test(file))
      .map((file) => {
        const path = join(dir, file);
        return {
          file: `${prefix}/${relative(dir, path).split('\\').join('/')}`,
          source: readFileSync(path, 'utf8'),
        };
      }),
  );
}

// --- Dependencies -----------------------------------------------------------------------------

// Packages that patch headless traces, fake a fingerprint, solve the challenge, or rotate
// addresses for us.
const EVASION_PACKAGE = new RegExp(
  [
    '^puppeteer-extra(-.*)?$',
    '^playwright-extra(-.*)?$',
    '^rebrowser-.*$',
    '^patchright(-.*)?$',
    '^undetected-.*$',
    '^proxy-chain$',
    '^proxy-pool$',
    '^got-scraping$',
    'stealth',
    'fingerprint',
    '2captcha',
    'anti-?captcha',
    'capsolver',
    'capmonster',
  ].join('|'),
  'i',
);

/** The banned dependencies a package.json declares, in any dependency section. */
export function evasionDependencies(packageJson: string): string[] {
  const pkg = JSON.parse(packageJson) as Record<string, Record<string, string> | undefined>;
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((section) => Object.keys(pkg[section] ?? {}))
    .filter((name) => EVASION_PACKAGE.test(name));
}

// --- Identity ---------------------------------------------------------------------------------

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#)/;

/**
 * A line that mentions a user agent in any spelling (`User-Agent`, `user-agent`, `userAgent`,
 * `USER_AGENT`, in any quote style or as a flag, `set(`, `append(`, `setHeader(`, `new Headers`,
 * `setUserAgent`, `--user-agent`) must be carrying the product's constant. Comments are skipped.
 */
export function setsForeignUserAgent(source: string): boolean {
  return source
    .split('\n')
    .some(
      (line) =>
        !COMMENT_LINE.test(line) &&
        /user[-_]?agent/i.test(line) &&
        !line.includes('CAIXA_USER_AGENT'),
    );
}

/** Strings and calls whose only use is to look like a person's browser, or to hide the robot. */
const BROWSER_DISGUISE = new RegExp(
  [
    'Mozilla\\/\\d',
    'AppleWebKit',
    'Chrome\\/\\d',
    'Safari\\/\\d',
    'Gecko\\/\\d',
    'navigator\\.webdriver',
    'evaluateOnNewDocument',
    'setExtraHTTPHeaders',
    'AutomationControlled',
    'disable-blink-features',
    'puppeteer\\.use\\s*\\(',
  ].join('|'),
);

export function disguisesBrowser(source: string): boolean {
  return BROWSER_DISGUISE.test(source);
}

/** Comments or strings that describe getting around the site's bot protection as a goal. */
const BYPASS_TALK =
  /\b(bypass(ing|es)?|circumvent(ing|s)?|evad(e|es|ing)|defeat(ing|s)?|get(ting)?\s+(around|past))\s+(the\s+|its\s+|a\s+)?(bot[- ]?(protection|detection|manager|check)|captcha|radware|shield\s*square|waf|anti-?bot)/i;

export function talksOfBypassingProtection(source: string): boolean {
  return BYPASS_TALK.test(source);
}

// --- Reaching out -----------------------------------------------------------------------------

const QUOTE = '[\'"`]';

/** A module specifier in any import form and any quote style, type-only imports excluded. */
function importsModule(source: string, modules: string): boolean {
  const withoutTypeImports = source.replace(/import\s+type\s[^;]*;/g, '');
  const specifier = `${QUOTE}(?:node:)?(?:${modules})(?:\\/[^'"\`]*)?${QUOTE}`;
  return new RegExp(`(?:from\\s+|require\\(\\s*|import\\(\\s*|import\\s+)${specifier}`).test(
    withoutTypeImports,
  );
}

/** Code that opens a connection of its own: an HTTP client, node:http(s), a browser, `fetch`. */
export function reachesOut(source: string): boolean {
  return (
    importsModule(
      source,
      'undici|axios|node-fetch|got|superagent|request|http|https|http2|net|tls|puppeteer(?:-core)?|playwright(?:-core)?',
    ) ||
    source.split('\n').some((line) => !COMMENT_LINE.test(line) && /(?<![\w.])fetch\s*\(/.test(line))
  );
}

/** The shell: a child process is how `curl | iconv` got around what Node's client could not. */
export function spawnsProcess(source: string): boolean {
  return importsModule(source, 'child_process|execa|shelljs|cross-spawn');
}

// The files that reach out on their own: the Caixa adapter (the ONLY one that reaches Caixa) and the
// LLM adapter (the model provider). The detail scraper no longer drives a browser and the storage
// copies no longer fetch a Caixa URL (SPEC-004 part 4): the pages, the photos and the documents all
// go through `CaixaAccess`. This list is exact and may only shrink: a new file that reaches out
// fails until it is added here on purpose.
const KNOWN_REACHING_OUT = [
  'backend/src/ai/adapters/llm.adapter.ts',
  'backend/src/auctions/caixa/http-caixa-access.ts',
];

describe('SC-24: the collection code carries no evasion', () => {
  const files = scannedFiles();
  const src = files.filter(({ file }) => file.startsWith('backend/src/'));
  const names = (found: ScannedFile[]) => found.map((f) => f.file);

  it('scans the code it claims to (a guard that finds no files guards nothing)', () => {
    expect(names(files)).toEqual(
      expect.arrayContaining([
        'backend/src/auctions/caixa/http-caixa-access.ts',
        'deploy/render-env.sh',
        '.github/workflows/deploy.yml',
      ]),
    );
  });

  it('has no stealth plugin, fingerprint patch, CAPTCHA solver or proxy pool among the dependencies', () => {
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

  it('sets a user agent only from CAIXA_USER_AGENT', () => {
    expect(names(files.filter(({ source }) => setsForeignUserAgent(source)))).toEqual([]);
  });

  it('presents no browser identity and hides no automation', () => {
    expect(names(files.filter(({ source }) => disguisesBrowser(source)))).toEqual([]);
  });

  it('never describes getting around bot protection', () => {
    expect(names(files.filter(({ source }) => talksOfBypassingProtection(source)))).toEqual([]);
  });

  it('runs no shell command and spawns no process anywhere in src', () => {
    expect(names(src.filter(({ source }) => spawnsProcess(source)))).toEqual([]);
  });

  it('keeps outbound requests in known places: only these files reach out on their own', () => {
    expect(names(src.filter(({ source }) => reachesOut(source))).sort()).toEqual(
      KNOWN_REACHING_OUT,
    );
  });
});

describe('the detectors', () => {
  it('see a stealth, fingerprint, solver or proxy-pool package, in any section', () => {
    const json = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });
    for (const name of [
      'puppeteer-extra-plugin-stealth',
      'puppeteer-extra',
      'playwright-extra',
      'rebrowser-puppeteer',
      'patchright',
      'undetected-chromedriver',
      'fingerprint-generator',
      'proxy-chain',
      'proxy-pool',
      '2captcha',
      'capsolver',
    ]) {
      expect(evasionDependencies(json({ [name]: '1.0.0' }))).toEqual([name]);
    }
    expect(
      evasionDependencies(JSON.stringify({ devDependencies: { 'puppeteer-extra': '3' } })),
    ).toEqual(['puppeteer-extra']);
    expect(
      evasionDependencies(json({ puppeteer: '^25', cheerio: '^1', undici: '7.30.1' })),
    ).toEqual([]);
    expect(evasionDependencies('{}')).toEqual([]);
  });

  it.each([
    "headers: { 'User-Agent': 'FarolDosLeiloes/1.0' }",
    'headers: { "user-agent": ua }',
    'headers: { `User-Agent`: ua }',
    'headers: { userAgent: ua }',
    "headers.set('User-Agent', ua);",
    "headers.append('user-agent', ua);",
    "response.setHeader('User-Agent', ua);",
    "new Headers({ 'User-Agent': ua })",
    "await page.setUserAgent('x');",
    "args: ['--user-agent=Foo']",
    'curl --user-agent "$UA" https://example.test',
    'USER_AGENT: ${{ secrets.UA }}',
  ])('see a user agent set from anything but the constant in %s', (line) => {
    expect(setsForeignUserAgent(line)).toBe(true);
  });

  it.each([
    "headers: { 'User-Agent': CAIXA_USER_AGENT }",
    "import { CAIXA_USER_AGENT } from '../common/caixa-user-agent.js';",
    '// SC-24: no user-agent spoofing, an honest user agent',
    ' * the user agent the product presents',
    '# a user-agent in a shell comment',
  ])('let %s pass', (line) => {
    expect(setsForeignUserAgent(line)).toBe(false);
  });

  it.each([
    "'Mozilla/5.0 (X11; Linux x86_64)'",
    'Mozilla/5.0',
    'Chrome/120.0.0.0',
    'AppleWebKit/537.36',
    'Safari/537.36',
    'Object.defineProperty(navigator.webdriver, 1)',
    'await page.evaluateOnNewDocument(() => {});',
    'await page.setExtraHTTPHeaders({});',
    "args: ['--disable-blink-features=AutomationControlled']",
    'puppeteer.use(StealthPlugin());',
  ])('see a browser disguise in %s', (line) => {
    expect(disguisesBrowser(line)).toBe(true);
  });

  it('does not take the honest identity for a disguise', () => {
    expect(disguisesBrowser("{ 'User-Agent': CAIXA_USER_AGENT }")).toBe(false);
    expect(disguisesBrowser('FarolDosLeiloes/1.0')).toBe(false);
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

  it.each([
    "import { exec } from 'child_process';",
    "import { exec } from 'node:child_process';",
    'import { exec } from "child_process";',
    'import { exec } from `child_process`;',
    "const cp = require('node:child_process');",
    "const cp = await import('child_process');",
    "import { execa } from 'execa';",
    "import shell from 'shelljs';",
    "import spawn from 'cross-spawn';",
  ])('see a process spawned in %s', (line) => {
    expect(spawnsProcess(line)).toBe(true);
  });

  it('does not take a lookalike for a spawn', () => {
    expect(spawnsProcess("import { x } from './process.js';")).toBe(false);
    expect(spawnsProcess("import type { ChildProcess } from 'child_process';")).toBe(false);
  });

  it.each([
    "import { fetch } from 'undici';",
    'import axios from "axios";',
    "import got from 'got';",
    "import fetch from 'node-fetch';",
    "import superagent from 'superagent';",
    "import https from 'node:https';",
    "import http from 'http';",
    "const https = require('https');",
    "const lib = await import('node:http');",
    'import axios from `axios`;',
    "import puppeteer from 'puppeteer';",
    "const response = await fetch('https://example.test');",
    'const response = await fetch(url, { headers });',
  ])('see an outbound request in %s', (line) => {
    expect(reachesOut(line)).toBe(true);
  });

  it.each([
    "import type { IncomingMessage } from 'node:http';",
    "import { HttpException } from '@nestjs/common';",
    "import { gotoPage } from './got-helper.js';",
    'const prefetch = 1; refetch();',
    'client.fetch();',
    '// a failed fetch (DV-03) is retried',
    "import { x } from './http-caixa-access.js';",
  ])('let %s pass', (line) => {
    expect(reachesOut(line)).toBe(false);
  });
});
