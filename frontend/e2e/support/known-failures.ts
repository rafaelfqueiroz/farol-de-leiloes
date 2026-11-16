// Known failures, each tracked by an issue (DV-23). The matching case is skipped with
// test.fixme until the issue lands; then its entry is removed here. Checks are never relaxed to
// pass instead (TS-23).
import type { TestInfo } from '@playwright/test';

export type Check = 'axe' | 'viewport';

interface KnownFailure {
  path: string;
  issue: string;
  /** Only these checks; all when absent. */
  checks?: readonly Check[];
  /** Only this colour scheme (axe); both when absent. */
  scheme?: 'light' | 'dark';
  /** Only this Playwright project; all when absent. */
  project?: string;
}

const KNOWN_FAILURES: readonly KnownFailure[] = [
  // color-contrast: dimmed "coming soon" plan cards (opacity 0.7), light only.
  { path: '/', issue: '#139', checks: ['axe'], scheme: 'light' },
  { path: '/plans', issue: '#139', checks: ['axe'], scheme: 'light' },
  // The 380 px filter drawer squeezes the page to 0 width at 360 px: its heading is not visible.
  { path: '/search', issue: '#149', project: 'phone-360' },
];

/** The issue tracking a known failure of this case, or undefined. */
export function knownFailure(
  path: string,
  check: Check,
  testInfo: TestInfo,
  scheme?: 'light' | 'dark',
): string | undefined {
  return KNOWN_FAILURES.find(
    (failure) =>
      failure.path === path &&
      (!failure.checks || failure.checks.includes(check)) &&
      (!failure.scheme || failure.scheme === scheme) &&
      (!failure.project || failure.project === testInfo.project.name),
  )?.issue;
}
