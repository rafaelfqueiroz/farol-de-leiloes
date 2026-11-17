// SC-19: the CI `audit` gate. `npm audit --audit-level=high` has no ignore list, so this wraps it:
// any high or critical advisory fails, unless `.github/audit-waivers.json` waives it. A waiver
//   - names an advisory id, the issue that records the exposure (SC-19) and an expiry date;
//   - covers dev and build tooling only: the same advisory in the runtime tree
//     (`npm audit --omit=dev`) still fails, unless the waiver lists that package in
//     `runtimeAllowed`. That key exists because npm files build-time packages that a runtime
//     dependency pulls in (e.g. @sentry/nextjs -> @rollup/plugin-commonjs) under "prod"; the
//     issue named by the waiver must record why each such path is build-time only;
//   - lapses on its own: it is valid THROUGH its `expires` day (UTC, inclusive) and the gate
//     fails from the next day on, even if the advisory is gone, so stale entries get removed.
// Moderate and low advisories never fail (same as `--audit-level=high`). Anything unexpected
// (npm audit errors, unparseable output, a malformed waiver file) fails: the gate never fails open.
// Plain Node ESM with no dependency, so the CI job needs no install. Output is limited to advisory
// ids, package names, titles, severities and the waiver's own text.
//
// CLI: node audit-gate.mjs [package-dir] [--waivers <file>]
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BLOCKING = new Set(["high", "critical"]);
const WAIVER_KEYS = ["id", "issue", "expires", "scope", "reason"];
const OPTIONAL_KEYS = ["runtimeAllowed"];
const GHSA = /^GHSA(-[2-9cfghjmpqrvwx]{4}){3}$/;
const GHSA_IN_URL = /GHSA(?:-[2-9cfghjmpqrvwx]{4}){3}/;

/** Today's date in UTC as YYYY-MM-DD. */
export const utcDate = (now) => now.toISOString().slice(0, 10);

function isRealDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text))
    return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && utcDate(parsed) === text;
}

/** Parses and validates the waiver file text. Returns { waivers, problems }. */
export function parseWaivers(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { waivers: [], problems: ["waiver file is not valid JSON"] };
  }
  if (!Array.isArray(data))
    return { waivers: [], problems: ["waiver file must be a JSON array"] };
  const problems = [];
  const waivers = [];
  data.forEach((entry, index) => {
    const label = `waiver #${index + 1}`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${label} is not an object`);
      return;
    }
    const before = problems.length;
    for (const key of Object.keys(entry)) {
      if (!WAIVER_KEYS.includes(key) && !OPTIONAL_KEYS.includes(key))
        problems.push(`${label} has an unknown key "${key}"`);
    }
    for (const key of WAIVER_KEYS) {
      if (!(key in entry)) problems.push(`${label} is missing "${key}"`);
    }
    if (
      "id" in entry &&
      !(typeof entry.id === "string" && GHSA.test(entry.id))
    ) {
      problems.push(`${label} has a bad id (expected GHSA-xxxx-xxxx-xxxx)`);
    }
    if (
      "issue" in entry &&
      !(Number.isInteger(entry.issue) && entry.issue > 0)
    ) {
      problems.push(`${label} needs "issue" to be a positive issue number`);
    }
    if ("expires" in entry && !isRealDate(entry.expires)) {
      problems.push(
        `${label} has a bad "expires" (expected a real YYYY-MM-DD date)`,
      );
    }
    if ("scope" in entry && entry.scope !== "dev") {
      problems.push(
        `${label} has scope other than "dev" (waivers cover dev and build paths only)`,
      );
    }
    if (
      "reason" in entry &&
      !(typeof entry.reason === "string" && entry.reason.trim() !== "")
    ) {
      problems.push(`${label} needs a non-empty "reason"`);
    }
    if (
      "runtimeAllowed" in entry &&
      !(
        Array.isArray(entry.runtimeAllowed) &&
        entry.runtimeAllowed.every(
          (name) => typeof name === "string" && name !== "",
        )
      )
    ) {
      problems.push(
        `${label} needs "runtimeAllowed" to be a list of package names`,
      );
    }
    if (problems.length === before) waivers.push(entry);
  });
  return { waivers, problems };
}

/**
 * High and critical advisories in `npm audit --json` text (audit report v2), one per
 * advisory and package. Throws when the text is not a usable audit report.
 */
export function blockingAdvisories(auditText) {
  let report;
  try {
    report = JSON.parse(auditText);
  } catch {
    throw new Error("npm audit output is not valid JSON");
  }
  if (report === null || typeof report !== "object")
    throw new Error("npm audit output is not an object");
  if (report.error !== undefined)
    throw new Error("npm audit reported an error");
  if (
    report.vulnerabilities === null ||
    typeof report.vulnerabilities !== "object"
  ) {
    throw new Error('npm audit output has no "vulnerabilities"');
  }
  const found = new Map();
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    for (const via of vulnerability?.via ?? []) {
      if (
        via === null ||
        typeof via !== "object" ||
        !BLOCKING.has(via.severity)
      )
        continue;
      const url = typeof via.url === "string" ? via.url : "";
      const id =
        GHSA_IN_URL.exec(url)?.[0] ??
        (url || `source ${via.source ?? "unknown"}`);
      const pkg = typeof via.name === "string" ? via.name : name;
      found.set(`${id}|${pkg}`, {
        id,
        package: pkg,
        severity: via.severity,
        title: via.title ?? "",
      });
    }
  }
  return [...found.values()];
}

/**
 * The gate decision. `waiversText`, `allAuditText` (`npm audit --json`) and `runtimeAuditText`
 * (`npm audit --omit=dev --json`) are raw texts; `now` is a Date. Pure: no I/O, no clock.
 * Returns { ok, failures, applied } where each entry is one printable line.
 */
export function evaluateAudit({
  waiversText,
  allAuditText,
  runtimeAuditText,
  now,
}) {
  const failures = [];
  const applied = [];

  const { waivers, problems } = parseWaivers(waiversText);
  for (const problem of problems) failures.push(`waiver file: ${problem}`);

  const today = utcDate(now);
  const live = [];
  for (const waiver of waivers) {
    if (today > waiver.expires) {
      failures.push(
        `waiver for ${waiver.id} expired on ${waiver.expires} (today ${today} UTC): recheck #${waiver.issue}, then renew or remove the entry`,
      );
    } else {
      live.push(waiver);
    }
  }

  let all = [];
  let runtime = [];
  try {
    all = blockingAdvisories(allAuditText);
    runtime = blockingAdvisories(runtimeAuditText);
  } catch (error) {
    failures.push(`cannot trust the audit: ${error.message}`);
    return { ok: false, failures, applied };
  }

  const waived = new Map(live.map((waiver) => [waiver.id, waiver]));
  for (const advisory of runtime) {
    const waiver = waived.get(advisory.id);
    if (waiver && !(waiver.runtimeAllowed ?? []).includes(advisory.package)) {
      failures.push(
        `${advisory.id} (${advisory.package}, ${advisory.severity}) is in the RUNTIME dependencies: its waiver covers dev and build paths only (runtimeAllowed does not list ${advisory.package})`,
      );
    }
  }
  for (const advisory of all) {
    const waiver = waived.get(advisory.id);
    const line = `${advisory.id} (${advisory.package}, ${advisory.severity}) ${advisory.title}`;
    if (!waiver) {
      failures.push(`${line}: no waiver`);
    } else {
      applied.push(
        `${line}: waived by #${waiver.issue} until ${waiver.expires} (${waiver.reason})`,
      );
    }
  }
  return { ok: failures.length === 0, failures, applied };
}

function runAudit(cwd, omitDev) {
  const args = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
  const result = spawnSync("npm", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // npm exits 1 when it finds vulnerabilities; the JSON on stdout is what matters, and the
  // evaluation rejects error reports and unparseable output.
  return result.error || result.stdout === undefined ? "" : result.stdout;
}

function main(argv) {
  const args = argv.slice(2);
  let dir = ".";
  let waiversFile = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "audit-waivers.json",
  );
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--waivers") waiversFile = args[++i] ?? "";
    else dir = args[i];
  }
  let waiversText;
  try {
    waiversText = readFileSync(waiversFile, "utf8");
  } catch {
    waiversText = "";
  }
  const result = evaluateAudit({
    waiversText,
    allAuditText: runAudit(dir, false),
    runtimeAuditText: runAudit(dir, true),
    now: new Date(),
  });
  for (const line of result.applied) console.log(`audit: ${line}`);
  for (const line of result.failures) console.error(`audit FAILED: ${line}`);
  if (result.ok) console.log(`audit: passed (${dir})`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv);
}
