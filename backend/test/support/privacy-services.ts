// The real privacy services over in-memory repositories, a fake clock and a registry (TS-03, TS-06),
// for the unit specs of the code that records or reads acceptances (AuthService, the terms guard).
import type { Clock } from '../../src/common/clock/clock.js';
import { ConsentsService } from '../../src/privacy/consents.service.js';
import { LegalDocumentsService } from '../../src/privacy/legal-documents.service.js';
import type { PublishedLegalDocument } from '../../src/privacy/legal/legal-document.js';
import { WhatsappConsentService } from '../../src/privacy/whatsapp-consent.service.js';
import type { UsersService } from '../../src/users/users.service.js';
import {
  FakeConsentsRepository,
  FakeWhatsappConsentRepository,
} from '../fakes/fake-privacy-repositories.js';
import { aLegalRegistry } from '../builders/legal-document.builder.js';

export function wirePrivacy(
  clock: Clock,
  users: Pick<UsersService, 'markWhatsappPromptAnswered' | 'findById'>,
  registry: readonly PublishedLegalDocument[] = aLegalRegistry(),
) {
  const legal = new LegalDocumentsService(registry, clock);
  const consentsRepo = new FakeConsentsRepository();
  const whatsappRepo = new FakeWhatsappConsentRepository();
  return {
    legal,
    consentsRepo,
    whatsappRepo,
    consents: new ConsentsService(consentsRepo as never, legal, clock),
    whatsapp: new WhatsappConsentService(whatsappRepo as never, users as UsersService, clock),
  };
}
