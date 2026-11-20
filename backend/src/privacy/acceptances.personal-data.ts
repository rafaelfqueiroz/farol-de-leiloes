// SPEC-010 BR-010-08, BR-010-09 / SC-27: the acceptance records and the WhatsApp consent answers are
// part of the export ("acceptance records", BR-010-09) and of the "my data" view. They are NOT purged
// with the account: they are the proof the account accepted what it accepted, kept until the lawyer
// sets a period (Q-21, SECURITY §9) and declared in `RETAINED_MODELS`. Holding only ids, versions,
// hashes and instants, they leave no name, address or phone behind.
//
// Registered with no model (`models` is empty): a model a provider claims is a model it purges, and
// the registry refuses to register one that the retained list names.
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../access/access-context.js';
import { DomainError } from '../common/errors/domain-error.js';
import { UsersService } from '../users/users.service.js';
import { ConsentsService } from './consents.service.js';
import { PersonalDataRegistry } from './registry/personal-data-registry.js';
import type { PersonalDataProvider } from './registry/personal-data-provider.js';
import { WhatsappConsentService } from './whatsapp-consent.service.js';

@Injectable()
export class AcceptancesPersonalData implements PersonalDataProvider {
  readonly name = 'acceptances';
  readonly models: readonly string[] = [];

  constructor(
    registry: PersonalDataRegistry,
    private readonly consents: ConsentsService,
    private readonly whatsapp: WhatsappConsentService,
    private readonly users: UsersService,
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext): Promise<Record<string, unknown>> {
    const account = await this.users.findById(ctx.accountId);
    if (!account) throw new DomainError('USER_NOT_FOUND');
    // Only the records of the account's current consent generation are the account's (DL-001-02).
    const generation = account.consentResetAt ?? null;
    const [acceptances, answers] = await Promise.all([
      this.consents.listFor(ctx.accountId, generation),
      this.whatsapp.historyFor(ctx.accountId, generation),
    ]);
    return {
      items: acceptances.map((acceptance) => ({
        documentType: acceptance.documentType,
        version: acceptance.version,
        acceptedAt: acceptance.acceptedAt,
        method: acceptance.method,
      })),
      whatsappConsent: {
        answers: answers.map((answer) => ({
          action: answer.action,
          method: answer.method,
          textVersion: answer.textVersion,
          at: answer.at,
        })),
      },
    };
  }

  /** Retained on purpose (see the header): nothing is deleted. */
  purge(): Promise<{ deleted: number }> {
    return Promise.resolve({ deleted: 0 });
  }
}
