// SPEC-010 BR-010-24..26: assembles the launch checklist from the live state: the gates
// (LegalValidationService), the documents in force (LegalDocumentsService), the retention setting and
// the flags. Platform state only.
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService, type ConfigType } from '@nestjs/config';
import businessConfig from '../../config/business.config.js';
import { type Env, legalGateEnforced } from '../../config/env.js';
import schedulerConfig, { type SchedulerConfig } from '../../config/scheduler.config.js';
import { LegalDocumentsService } from '../legal-documents.service.js';
import { buildLaunchChecklist, type LaunchChecklist } from '../domain/launch-checklist.js';
import { LegalValidationService } from './legal-validation.service.js';

@Injectable()
export class LaunchChecklistService {
  constructor(
    private readonly validation: LegalValidationService,
    private readonly documents: LegalDocumentsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(businessConfig.KEY) private readonly business: ConfigType<typeof businessConfig>,
    @Inject(schedulerConfig.KEY) private readonly scheduler: SchedulerConfig,
  ) {}

  async checklist(): Promise<LaunchChecklist> {
    const gates = await this.validation.statusOfAll();
    const current = this.documents.current();
    return buildLaunchChecklist({
      gates,
      current: [current.terms, current.privacy].map(({ type, version, draft }) => ({
        type,
        version,
        draft,
      })),
      documentRetentionYears: this.business.privacy.documentRetentionYears,
      settings: {
        termsEnforcementEnabled: this.config.get('TERMS_ENFORCEMENT_ENABLED', { infer: true }),
        accountPurgeEnabled: this.scheduler.accountPurge.enabled,
        dataExportEnabled: this.scheduler.dataExport.enabled,
        documentRetentionEnabled: this.scheduler.documentRetention.enabled,
        privateBucketConfigured:
          this.config.get('R2_PRIVATE_BUCKET', { infer: true }) !== undefined,
        legalGateEnforced: legalGateEnforced({
          NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
          LEGAL_GATE_ENFORCED: this.config.get('LEGAL_GATE_ENFORCED', { infer: true }),
        }),
      },
    });
  }
}
