import 'vitest';
import type { AxeMatchers } from 'vitest-axe/matchers';

// vitest-axe 0.1 types the legacy `Vi` namespace; register its matcher on vitest's own types.
// Declaration merging needs the same name and type parameters as vitest's declaration, and an
// interface that only extends AxeMatchers adds the matchers without restating them.
declare module 'vitest' {
  /* eslint-disable @typescript-eslint/no-empty-object-type -- merges AxeMatchers into vitest's interface */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- type parameter must match vitest's declaration
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
  /* eslint-enable @typescript-eslint/no-empty-object-type */
}
