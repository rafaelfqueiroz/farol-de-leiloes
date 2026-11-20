// SPEC-010 BR-010-08, BR-010-15 / SC-27: what the sign-in machinery holds about an account: its
// sessions (instants only), its outstanding one-time links (purpose and instants only) and the
// sign-in attempt counter keyed by its address. Registered when AuthModule is built (AR-09: through
// the module's own services).
//
// SC-06 / SC-15: neither a session id nor a token hash is ever collected.
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../access/access-context.js';
import { PersonalDataRegistry } from '../privacy/registry/personal-data-registry.js';
import type { PersonalDataProvider } from '../privacy/registry/personal-data-provider.js';
import { UsersService } from '../users/users.service.js';
import { LoginAttemptEntity } from './login-attempts/login-attempt.schema.js';
import { LoginAttemptsService } from './login-attempts/login-attempts.service.js';
import { SessionEntity } from './sessions/session.schema.js';
import { SessionsService } from './sessions/sessions.service.js';
import { AccountTokenEntity } from './tokens/account-token.schema.js';
import { AccountTokenService } from './tokens/account-token.service.js';

@Injectable()
export class SessionsPersonalData implements PersonalDataProvider {
  readonly name = 'sessions';
  // The sign-in attempt counter has no account path (it is keyed by the address), but belongs to
  // the same purpose and is removed with the account.
  readonly models = [SessionEntity.name, LoginAttemptEntity.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly sessions: SessionsService,
    private readonly attempts: LoginAttemptsService,
    private readonly users: UsersService,
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext): Promise<Record<string, unknown>> {
    return { items: await this.sessions.listForAccount(ctx.accountId) };
  }

  async purge(userId: string): Promise<{ deleted: number }> {
    const deleted = await this.sessions.purgeAllForUser(userId);
    // The address is still the real one until the tombstone (the purge's last step), so a crashed
    // run repeats this with the address in place (the delete is idempotent).
    const user = await this.users.findById(userId);
    if (user?.email) await this.attempts.forgetEmail(user.email);
    return { deleted };
  }
}

@Injectable()
export class AccountTokensPersonalData implements PersonalDataProvider {
  readonly name = 'accountTokens';
  readonly models = [AccountTokenEntity.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly tokens: AccountTokenService,
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext): Promise<Record<string, unknown>> {
    return { pending: await this.tokens.pendingFor(ctx.accountId) };
  }

  async purge(userId: string): Promise<{ deleted: number }> {
    return { deleted: await this.tokens.purgeAllForUser(userId) };
  }
}
