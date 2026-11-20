// SPEC-010 BR-010-08, BR-010-15, BR-010-28 / SC-27: the pseudonyms of the account are listed in the
// export and detached, not deleted, by the purge: the label stays inside the journey record as
// "usuário removido" and loses its link to the person.
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../../access/access-context.js';
import { PersonalDataRegistry } from '../registry/personal-data-registry.js';
import type { PersonalDataProvider } from '../registry/personal-data-provider.js';
import { ActorPseudonymEntity } from '../schemas/actor-pseudonym.schema.js';
import { ActorPseudonymRepository } from './actor-pseudonym.repository.js';
import { ActorPseudonymService } from './actor-pseudonym.service.js';

@Injectable()
export class ActorPseudonymsPersonalData implements PersonalDataProvider {
  readonly name = 'actorPseudonyms';
  readonly models = [ActorPseudonymEntity.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly pseudonyms: ActorPseudonymService,
    private readonly repository: ActorPseudonymRepository,
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext): Promise<Record<string, unknown>> {
    return { items: await this.repository.labelsOf(ctx.accountId) };
  }

  async purge(userId: string): Promise<{ deleted: number }> {
    // Detached, not deleted: the journey record keeps the label (BR-010-28), never the person.
    return { deleted: await this.pseudonyms.detachUser(userId) };
  }
}
