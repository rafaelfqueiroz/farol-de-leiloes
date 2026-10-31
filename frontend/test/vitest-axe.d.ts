import 'vitest';
import type { AxeMatchers } from 'vitest-axe/matchers';

// vitest-axe 0.1 types the legacy `Vi` namespace; register its matcher on vitest's own types.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- must match vitest's declaration
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
