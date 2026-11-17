// TEST-ONLY: the view a SupportGrantRead seals (SPEC-002 BR-002-25), for specs that prove at the
// repository level what that view may and may not do. It goes through the production surface only
// — GrantReadLogger.readOne, whose load is handed the view — and loads nothing, so nothing is read
// and nothing is logged (BR-002-27). Production code has no way to the view outside GrantReadLogger
// (test/structural/admin-access-append-only.spec.ts); this helper adds none.
import type { AccessContext } from '../../src/access/access-context.js';
import type { GrantReadLogger } from '../../src/admin-access/grant-read-logger.js';
import type { SupportGrantRead } from '../../src/admin-access/support-grant.service.js';

export async function grantViewOf(
  logger: GrantReadLogger,
  read: SupportGrantRead,
): Promise<AccessContext> {
  let view: AccessContext | undefined;
  await logger.readOne(
    read,
    (ctx) => {
      view = ctx;
      return Promise.resolve(null);
    },
    () => {
      throw new Error('grantViewOf reads nothing');
    },
  );
  if (!view) throw new Error('GrantReadLogger handed no view');
  return view;
}
