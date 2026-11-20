// SPEC-010 BR-010-08, BR-010-15, AR-09: the one list of who holds personal data. Providers register
// themselves when their module is built (the constructor of the provider, so a compiled-but-not-
// started app, the isolation gate's, has the complete registry too). Dependency-free: no module,
// repository or schema is imported here (only the type of the access context).
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../../access/access-context.js';
import type { PersonalDataProvider } from './personal-data-provider.js';
import { EXPORT_RESERVED_KEYS } from '../domain/export-document.js';
import { RETAINED_MODELS } from './retained-models.js';

/** A provider's name is a key of the export: a plain identifier, never `__proto__` or a path. */
const PROVIDER_NAME = /^[a-z][A-Za-z0-9]{0,63}$/;

@Injectable()
export class PersonalDataRegistry {
  private readonly registered: PersonalDataProvider[] = [];

  /**
   * Adds a provider. Refuses what would make the registry lie: a name that is not a plain
   * identifier or is taken, a model two providers both claim, and a model the retained list says
   * is kept (it cannot be both purged and retained). A programming error, found at boot.
   */
  register(provider: PersonalDataProvider): void {
    if (!PROVIDER_NAME.test(provider.name)) {
      throw new Error(`Personal data provider name "${provider.name}" is not a plain identifier`);
    }
    if ((EXPORT_RESERVED_KEYS as readonly string[]).includes(provider.name)) {
      throw new Error(`Personal data provider name "${provider.name}" is reserved by the export`);
    }
    if (this.registered.some((existing) => existing.name === provider.name)) {
      throw new Error(`Personal data provider "${provider.name}" is already registered`);
    }
    for (const model of provider.models) {
      const claimedBy = this.registered.find((existing) => existing.models.includes(model));
      if (claimedBy) {
        throw new Error(
          `Model ${model} is claimed by both "${claimedBy.name}" and "${provider.name}"`,
        );
      }
      if (RETAINED_MODELS.some((retained) => retained.model === model)) {
        throw new Error(`Model ${model} is declared retained (BR-010-22/23); it cannot be purged`);
      }
    }
    this.registered.push(provider);
  }

  /** The providers in the order they registered (the purge runs them in this order). */
  providers(): readonly PersonalDataProvider[] {
    return [...this.registered];
  }

  /** Every model some provider covers. */
  coveredModels(): string[] {
    return this.registered.flatMap((provider) => [...provider.models]);
  }

  /**
   * What every provider holds about the account of `ctx`, keyed by provider name. One provider
   * failing fails the whole collection: an incomplete export is never handed out as complete.
   */
  async collect(ctx: AccessContext): Promise<Record<string, unknown>> {
    const collected: Record<string, unknown> = {};
    for (const provider of this.registered) {
      collected[provider.name] = await provider.collect(ctx);
    }
    return collected;
  }

  /**
   * Runs every provider's `purge` for the closed account, in registration order, and answers the
   * number of records each deleted (counts only, SC-15). A provider failing stops the run and
   * rethrows, so the caller does NOT write the tombstone: the next run repeats every step.
   */
  async purge(userId: string): Promise<Record<string, number>> {
    const deleted: Record<string, number> = {};
    for (const provider of this.registered) {
      deleted[provider.name] = (await provider.purge(userId)).deleted;
    }
    return deleted;
  }
}
