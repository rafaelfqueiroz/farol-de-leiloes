// SPEC-002 BR-002-27: the seal on a support grant's view. A SupportGrantRead does not carry its
// AccessContext as a property: the context lives here, keyed by the read, so a handler holding a
// SupportGrantRead has nothing to read with — the only way to the data is GrantReadLogger's
// `readOne` / `readMany` / `readCount`, which log before they return.
//
// Two functions, two callers, held by test/structural/admin-access-append-only.spec.ts:
//   sealGrantContext    SupportGrantRead's constructor (support-grant.service.ts) only;
//   grantContextOf      GrantReadLogger (grant-read-logger.ts) only.
// Any other reference in src/ fails the build.
import type { AccessContext } from '../access/access-context.js';

const sealed = new WeakMap<object, AccessContext>();

/** Seals `context` as the view of `read`, once; only a support grant's view is sealed. */
export function sealGrantContext(read: object, context: AccessContext): void {
  if (!context.viaSupportGrant || !context.readOnly) {
    throw new Error('Only a support grant view is sealed in a grant read (BR-002-25)');
  }
  if (sealed.has(read)) throw new Error('A grant read is sealed once (BR-002-27)');
  sealed.set(read, context);
}

/** The view sealed in `read`; throws for anything SupportGrantService did not build. */
export function grantContextOf(read: object): AccessContext {
  const context = sealed.get(read);
  if (!context) {
    throw new Error('A grant read comes from SupportGrantService.contextForRead (BR-002-27)');
  }
  return context;
}
