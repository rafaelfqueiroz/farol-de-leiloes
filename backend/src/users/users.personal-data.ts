// SPEC-010 BR-010-08, BR-010-09, BR-010-15 / SC-27: what the account document holds about the person,
// for the export, the "my data" view and the purge.
//
// collect: the profile, how the account signs in and the legacy fields still stored (CPF, date of
// birth, sex, address, the legacy billing ids: nothing reads them, but they ARE personal data held
// about the person, so the access right shows them, SECURITY §9). Never the password hash. It reads
// the account of `ctx.accountId` only.
//
// purge: the document is not deleted by a provider: its tombstone is the purge job's LAST step,
// conditional on the claim it holds (UsersService.completePurge), so a crash never leaves a
// half-erased account that a later step cannot tell from a live one. The provider answers 0.
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../access/access-context.js';
import { DomainError } from '../common/errors/domain-error.js';
import { PersonalDataRegistry } from '../privacy/registry/personal-data-registry.js';
import type { PersonalDataProvider } from '../privacy/registry/personal-data-provider.js';
import { UserEntity } from './schemas/user.schema.js';
import { UsersService } from './users.service.js';

@Injectable()
export class UsersPersonalData implements PersonalDataProvider {
  readonly name = 'account';
  readonly models = [UserEntity.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly users: UsersService,
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext): Promise<Record<string, unknown>> {
    const user = await this.users.findByIdFull(ctx.accountId);
    if (!user) throw new DomainError('USER_NOT_FOUND');
    const providers = Array.from(user.providers ?? []);
    return {
      id: user._id.toHexString(),
      email: user.email,
      name: user.name,
      phone: user.phone ?? null,
      emailVerified: user.emailVerified === true,
      status: user.status ?? 'active',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      signIn: {
        // How the account can sign in; the password itself, hashed or not, is never exported.
        methods: [
          ...(providers.includes('local') ? ['password'] : []),
          ...(providers.includes('google') ? ['google'] : []),
        ],
        googleId: user.googleId ?? null,
      },
      // BR-010-27, DL-001-02: instants about the consent records, not their content.
      whatsappPromptAnsweredAt: user.whatsappPromptAnsweredAt ?? null,
      consentResetAt: user.consentResetAt ?? null,
      // Stored and unused since SPEC-001 BR-001-25 (SECURITY §9): shown because they are held.
      legacyProfile: {
        cpf: user.cpf ?? null,
        dateOfBirth: user.dateOfBirth ?? null,
        sex: user.sex ?? null,
        address: user.address ?? null,
      },
      // Superseded by the office subscription (SPEC-012 BR-012-14); stored, never written now.
      legacyBilling: {
        role: user.role ?? null,
        subscriptionStatus: user.subscriptionStatus ?? null,
        stripeCustomerId: user.stripeCustomerId ?? null,
        stripeSubscriptionId: user.stripeSubscriptionId ?? null,
      },
    };
  }

  purge(): Promise<{ deleted: number }> {
    return Promise.resolve({ deleted: 0 });
  }
}
