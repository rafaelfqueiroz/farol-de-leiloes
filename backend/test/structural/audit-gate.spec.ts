// SC-19: the CI audit gate (.github/scripts/audit-gate.mjs) and its waiver file. The decision is a
// pure function, tested here with trimmed `npm audit --json` (report v2) fixtures; the committed
// waiver file is checked as it stands, so a malformed or lapsed entry fails the structural job too.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateAudit, parseWaivers } from '../../../.github/scripts/audit-gate.mjs';

const ID = 'GHSA-fc5q-39xc-vjpf';
const advisory = (name: string, id: string, severity: string) => ({
  source: 1247710,
  name,
  dependency: name,
  title: `${name} test advisory`,
  url: `https://github.com/advisories/${id}`,
  severity,
  cwe: ['CWE-1333'],
  cvss: { score: 7.5, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' },
  range: '<=4.0.7',
});
/** npm audit v2 shape: the advisory sits in the package's `via`; dependents list it by name. */
const report = (...advisories: ReturnType<typeof advisory>[]): string =>
  JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {
      ...Object.fromEntries(
        advisories.map((a) => [
          a.name,
          {
            name: a.name,
            severity: a.severity,
            isDirect: false,
            via: [a],
            effects: ['vite'],
            range: '*',
            nodes: [`node_modules/${a.name}`],
            fixAvailable: false,
          },
        ]),
      ),
      vite: {
        name: 'vite',
        severity: 'high',
        isDirect: false,
        via: advisories.map((a) => a.name),
        effects: [],
        range: '>=6',
        nodes: ['node_modules/vite'],
        fixAvailable: true,
      },
    },
    metadata: { vulnerabilities: { total: advisories.length } },
  });
const clean = report();

const waiver = (over: Record<string, unknown> = {}) => ({
  id: ID,
  issue: 162,
  expires: '2026-12-01',
  scope: 'dev',
  reason: 'no patched version; dev tooling only',
  ...over,
});
const NOW = new Date('2026-11-17T12:00:00Z');
const run = (over: Partial<Parameters<typeof evaluateAudit>[0]> = {}) =>
  evaluateAudit({
    waiversText: JSON.stringify([waiver()]),
    allAuditText: report(advisory('picomatch', ID, 'high')),
    runtimeAuditText: clean,
    now: NOW,
    ...over,
  });

describe('audit gate (SC-19)', () => {
  it('passes a waived dev-only advisory and says which waiver was applied', () => {
    const result = run();
    expect(result.ok).toBe(true);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]).toContain(ID);
    expect(result.applied[0]).toContain('#162');
  });

  it('fails an expired waiver', () => {
    const result = run({ now: new Date('2026-12-02T00:00:00Z') });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain(`waiver for ${ID} expired on 2026-12-01`);
  });

  it('keeps the waiver valid through its whole expiry day (UTC) and lapses the next day', () => {
    expect(run({ now: new Date('2026-12-01T23:59:59Z') }).ok).toBe(true);
    expect(run({ now: new Date('2026-12-02T00:00:00Z') }).ok).toBe(false);
  });

  it('fails an expired waiver even when the advisory is gone', () => {
    const result = run({ allAuditText: clean, now: new Date('2027-01-01T00:00:00Z') });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('expired');
  });

  it('fails a high advisory that has no waiver, naming id and package', () => {
    const other = advisory('minimist', 'GHSA-xvch-5gv4-984h', 'high');
    const result = run({ allAuditText: report(advisory('picomatch', ID, 'high'), other) });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('GHSA-xvch-5gv4-984h');
    expect(result.failures[0]).toContain('minimist');
  });

  it('counts a critical advisory', () => {
    const result = run({
      allAuditText: report(advisory('evil', 'GHSA-aaaa-bbbb-cccc', 'critical')),
    });
    expect(result.ok).toBe(false);
  });

  it('ignores moderate and low advisories', () => {
    const result = run({
      waiversText: '[]',
      allAuditText: report(
        advisory('a', 'GHSA-aaaa-bbbb-cccc', 'moderate'),
        advisory('b', 'GHSA-dddd-eeee-ffff', 'low'),
      ),
    });
    expect(result).toEqual({ ok: true, failures: [], applied: [] });
  });

  it('fails a waived id that appears in the runtime results', () => {
    const present = report(advisory('picomatch', ID, 'high'));
    const result = run({ runtimeAuditText: present });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('RUNTIME');
  });

  it('allows a waived runtime path only for the package the waiver lists in runtimeAllowed', () => {
    const present = report(advisory('picomatch', ID, 'high'));
    const allowed = JSON.stringify([waiver({ runtimeAllowed: ['picomatch'] })]);
    expect(run({ runtimeAuditText: present, waiversText: allowed }).ok).toBe(true);
    const otherPackage = report(advisory('micromatch', ID, 'high'));
    expect(
      run({ runtimeAuditText: otherPackage, allAuditText: otherPackage, waiversText: allowed }).ok,
    ).toBe(false);
  });

  it('fails when the waiver file is malformed', () => {
    for (const text of [
      'not json',
      '{}',
      JSON.stringify([waiver({ extra: 1 })]),
      JSON.stringify([waiver({ id: 'CVE-2026-1' })]),
      JSON.stringify([waiver({ expires: '2026-02-30' })]),
      JSON.stringify([waiver({ expires: '01/12/2026' })]),
      JSON.stringify([waiver({ issue: undefined })]),
      JSON.stringify([waiver({ issue: 0 })]),
      JSON.stringify([waiver({ scope: 'runtime' })]),
      JSON.stringify([waiver({ reason: ' ' })]),
      JSON.stringify([waiver({ runtimeAllowed: 'picomatch' })]),
      '',
    ]) {
      const result = run({ waiversText: text, allAuditText: clean });
      expect(result.ok, text).toBe(false);
      expect(result.failures.join('\n'), text).toContain('waiver file');
    }
  });

  it('fails closed when npm audit errors or its output is unusable', () => {
    for (const text of [
      '',
      'npm ERR! audit endpoint returned an error',
      JSON.stringify({ error: { code: 'ENOAUDIT', summary: 'boom' } }),
      JSON.stringify({ auditReportVersion: 2 }),
    ]) {
      expect(run({ allAuditText: text }).ok, text).toBe(false);
      expect(run({ runtimeAuditText: text }).ok, text).toBe(false);
    }
  });
});

describe('committed waiver file', () => {
  const text = readFileSync(
    join(import.meta.dirname, '..', '..', '..', '.github', 'audit-waivers.json'),
    'utf8',
  );

  it('is well formed', () => {
    expect(parseWaivers(text).problems).toEqual([]);
  });

  it('waives only GHSA-fc5q-39xc-vjpf, through issue 162', () => {
    expect(parseWaivers(text).waivers).toMatchObject([
      { id: ID, issue: 162, expires: '2026-12-01' },
    ]);
  });
});
