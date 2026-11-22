// SPEC-010 BR-010-08, BR-010-15 / SC-27: the registry's rules and its two walks (collect, purge),
// with hand-written providers (TS-03).
import { describe, expect, it } from 'vitest';
import type { AccessContext } from '../../access/access-context.js';
import type { PersonalDataProvider } from './personal-data-provider.js';
import { PersonalDataRegistry } from './personal-data-registry.js';

const ctx = { accountId: 'account-1' } as unknown as AccessContext;

function provider(
  name: string,
  models: string[] = [],
  overrides: Partial<PersonalDataProvider> = {},
): PersonalDataProvider & { purged: string[] } {
  const purged: string[] = [];
  return {
    name,
    models,
    purged,
    collect: (context) => Promise.resolve({ items: [`${name}:${context.accountId}`] }),
    purge: (userId) => {
      purged.push(userId);
      return Promise.resolve({ deleted: models.length });
    },
    ...overrides,
  };
}

describe('registering a provider', () => {
  it('keeps the order of registration', () => {
    const registry = new PersonalDataRegistry();
    registry.register(provider('favorites', ['FavoriteEntity']));
    registry.register(provider('reminders', ['ReminderEntity']));

    expect(registry.providers().map((p) => p.name)).toEqual(['favorites', 'reminders']);
    expect(registry.coveredModels()).toEqual(['FavoriteEntity', 'ReminderEntity']);
  });

  it.each(['', 'Upper', '1abc', 'with space', '__proto__', 'a.b', 'a'.repeat(65)])(
    'refuses the name %j (it is a key of the export)',
    (name) => {
      expect(() => new PersonalDataRegistry().register(provider(name))).toThrow(
        'is not a plain identifier',
      );
    },
  );

  it.each(['schemaVersion', 'generatedAt'])('refuses %s: the envelope owns it', (name) => {
    // `generatedAt` and `schemaVersion` start in lower case, so the identifier rule passes them.
    expect(() => new PersonalDataRegistry().register(provider(name))).toThrow('is reserved');
  });

  it('refuses a name that is taken', () => {
    const registry = new PersonalDataRegistry();
    registry.register(provider('favorites'));

    expect(() => registry.register(provider('favorites'))).toThrow('already registered');
  });

  it('refuses a model two providers both claim, naming both', () => {
    const registry = new PersonalDataRegistry();
    registry.register(provider('first', ['SharedEntity']));

    expect(() => registry.register(provider('second', ['SharedEntity']))).toThrow(
      'Model SharedEntity is claimed by both "first" and "second"',
    );
  });

  it('refuses a model the retained list keeps: it cannot be both purged and retained', () => {
    expect(() =>
      new PersonalDataRegistry().register(provider('billing', ['SubscriptionEntity'])),
    ).toThrow('SubscriptionEntity is declared retained');
  });

  it('lets a provider with no model register (the retained acceptances are only exported)', () => {
    const registry = new PersonalDataRegistry();

    expect(() => registry.register(provider('acceptances', []))).not.toThrow();
  });
});

describe('BR-010-08: collecting', () => {
  it('answers one section per provider, keyed by its name, read under the context', async () => {
    const registry = new PersonalDataRegistry();
    registry.register(provider('favorites'));
    registry.register(provider('reminders'));

    expect(await registry.collect(ctx)).toEqual({
      favorites: { items: ['favorites:account-1'] },
      reminders: { items: ['reminders:account-1'] },
    });
  });

  it('fails as a whole when one provider fails: an incomplete export is never handed out', async () => {
    const registry = new PersonalDataRegistry();
    registry.register(provider('favorites'));
    registry.register(provider('broken', [], { collect: () => Promise.reject(new Error('down')) }));
    registry.register(provider('reminders'));

    await expect(registry.collect(ctx)).rejects.toThrow('down');
  });

  it('is empty with no provider', async () => {
    expect(await new PersonalDataRegistry().collect(ctx)).toEqual({});
  });
});

describe('BR-010-15: purging', () => {
  it('runs every provider for the account, in order, and answers the counts per provider', async () => {
    const registry = new PersonalDataRegistry();
    const favorites = provider('favorites', ['FavoriteEntity']);
    const sessions = provider('sessions', ['SessionEntity', 'LoginAttemptEntity']);
    registry.register(favorites);
    registry.register(sessions);

    expect(await registry.purge('closed-user')).toEqual({ favorites: 1, sessions: 2 });
    expect(favorites.purged).toEqual(['closed-user']);
    expect(sessions.purged).toEqual(['closed-user']);
  });

  it('stops at the first failing provider and rethrows, so nothing after it runs and no tombstone follows', async () => {
    const registry = new PersonalDataRegistry();
    const after = provider('after');
    registry.register(provider('before'));
    registry.register(
      provider('broken', [], { purge: () => Promise.reject(new Error('storage down')) }),
    );
    registry.register(after);

    await expect(registry.purge('closed-user')).rejects.toThrow('storage down');
    expect(after.purged).toEqual([]);
  });
});
