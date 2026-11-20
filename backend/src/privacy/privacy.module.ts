import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../common/common.module.js';
import { UsersModule } from '../users/users.module.js';
import { ConsentsRepository } from './consents.repository.js';
import { ConsentsService } from './consents.service.js';
import { LegalController } from './legal.controller.js';
import { LegalDocumentsService } from './legal-documents.service.js';
import { LEGAL_DOCUMENTS, LEGAL_REGISTRY } from './legal/registry.js';
import { PrivacyController } from './privacy.controller.js';
import {
  PrivacyAccountThrottlerGuard,
  PrivacyThrottlerModule,
} from './privacy-throttler.module.js';
import { ConsentEntity, ConsentSchema } from './schemas/consent.schema.js';
import { WhatsappConsentEntity, WhatsappConsentSchema } from './schemas/whatsapp-consent.schema.js';
import { WhatsappConsentRepository } from './whatsapp-consent.repository.js';
import { WhatsappConsentService } from './whatsapp-consent.service.js';
import { AcceptancesPersonalData } from './acceptances.personal-data.js';
import { PersonalDataRegistryModule } from './registry/personal-data-registry.module.js';

/**
 * SPEC-010 (#10) consent part: the legal documents, the acceptances of the terms and the privacy
 * policy, and the WhatsApp consent (BR-010-01..05, BR-010-27). AuthModule imports this module
 * (sign-up records the acceptance; the CurrentTermsGuard it registers asks `ConsentsService`);
 * this module must NOT import AuthModule (AR-09, no cycle). It reaches the account only through
 * `UsersService`.
 *
 * Exported for the other specs: `ConsentsService.recordAcceptance` (SPEC-011's invitation),
 * `WhatsappConsentService.hasConsent` (SPEC-008, SPEC-025) and `LegalDocumentsService`. The
 * indexes of both collections are built by migration 0008-consent-indexes (AR-29).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ConsentEntity.name, schema: ConsentSchema },
      { name: WhatsappConsentEntity.name, schema: WhatsappConsentSchema },
    ]),
    CommonModule, // AR-24: the Clock
    UsersModule, // the one-time WhatsApp request is answered on the account
    PrivacyThrottlerModule, // SC-04: a per-account limit on the consent write routes
    PersonalDataRegistryModule, // SPEC-010: the acceptances are exported (and retained, not purged)
  ],
  controllers: [LegalController, PrivacyController],
  providers: [
    { provide: LEGAL_DOCUMENTS, useValue: LEGAL_REGISTRY },
    LegalDocumentsService,
    ConsentsRepository,
    ConsentsService,
    WhatsappConsentRepository,
    WhatsappConsentService,
    PrivacyAccountThrottlerGuard,
    AcceptancesPersonalData,
  ],
  exports: [LegalDocumentsService, ConsentsService, WhatsappConsentService],
})
export class PrivacyModule {}
