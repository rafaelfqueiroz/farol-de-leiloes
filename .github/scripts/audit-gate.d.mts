// Types for the plain-ESM audit gate, so the structural spec can import it under `strict`.
export interface AuditGateInput {
  waiversText: string;
  allAuditText: string;
  runtimeAuditText: string;
  /** The package directory name, e.g. "backend". */
  packageName: string;
  now: Date;
}
export interface AuditGateResult {
  ok: boolean;
  failures: string[];
  applied: string[];
}
export function evaluateAudit(input: AuditGateInput): AuditGateResult;
export function parseWaivers(text: string): {
  waivers: unknown[];
  problems: string[];
};
export function blockingAdvisories(
  auditText: string,
): { id: string; package: string; severity: string; title: string }[];
export function utcDate(now: Date): string;
export function consumersOf(auditText: string, id: string): string[];
