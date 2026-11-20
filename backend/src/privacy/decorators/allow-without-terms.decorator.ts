import { SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

export const ALLOW_WITHOUT_TERMS = 'privacy:allow-without-terms';

/**
 * SPEC-010 BR-010-05, DL-010-03: exempts a handler or a whole controller from the current-terms
 * guard. A route is exempt when the account must be able to reach it without having accepted the
 * newest version: who am I and sign out (`/auth/me`, `/auth/logout`), the legal texts themselves
 * and the privacy routes (accepting, the account's acceptances and consent). The data rights
 * (export, deletion) of SPEC-010's next part live under `/privacy` too. It is an explicit
 * decision a reviewer reads, like `@Public()`; it authenticates nothing (the JWT guard still runs).
 */
export const AllowWithoutTerms = () => SetMetadata(ALLOW_WITHOUT_TERMS, true);

/** True when the handler, or its controller, carries `@AllowWithoutTerms()`. */
export function isTermsExempt(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_TERMS, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
