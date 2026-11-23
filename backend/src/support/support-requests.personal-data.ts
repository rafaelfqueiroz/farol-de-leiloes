// SPEC-010 BR-010-08, BR-010-09, BR-010-15 / SC-27, SPEC-009 decision 4 of #9: the support requests
// are the account's own data. They are in its export and its "my data" view (what it wrote, its
// protocol, the status and the permission), and the purge deletes them with the account (AR-31): the
// subject and the message are free text and may hold anything the person wrote. The outbox state
// (claim token, attempts) is the platform's, not the person's, and is not exported.
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../access/access-context.js';
import { listSection } from '../privacy/domain/export-document.js';
import type {
  CollectOptions,
  PersonalDataProvider,
} from '../privacy/registry/personal-data-provider.js';
import { PersonalDataRegistry } from '../privacy/registry/personal-data-registry.js';
import { dataAccessState } from './domain/support-request.js';
import { SupportRequestEntity } from './schemas/support-request.schema.js';
import { SupportRequestsRepository } from './support-requests.repository.js';

@Injectable()
export class SupportRequestsPersonalData implements PersonalDataProvider {
  readonly name = 'supportRequests';
  readonly models = [SupportRequestEntity.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly requests: SupportRequestsRepository,
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext, options?: CollectOptions): Promise<Record<string, unknown>> {
    const { items, total } = await this.requests.findAllForExport(ctx, options?.limit);
    return listSection(
      items.map((request) => ({
        protocol: request.protocol,
        subject: request.subject,
        message: request.message,
        status: request.status,
        dataAccess: dataAccessState(request),
        dataAccessWithdrawnAt: request.dataAccessWithdrawnAt ?? null,
        openedAt: request.createdAt,
        closedAt: request.closedAt ?? null,
      })),
      total,
    );
  }

  async purge(userId: string): Promise<{ deleted: number }> {
    return { deleted: await this.requests.purgeAccountByJob(userId) };
  }
}
