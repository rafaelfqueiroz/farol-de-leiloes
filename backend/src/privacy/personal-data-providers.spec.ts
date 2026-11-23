// SPEC-010 BR-010-08, BR-010-15 / SC-27: what each module's provider collects and purges, over
// hand-written repositories and services (TS-03). That the whole registry covers every model, and what
// is really stored and deleted, are the registry meta-test and test/integration/account-purge.spec.ts.
import { Types } from 'mongoose';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../access/access-context.js';
import { AccountTokensPersonalData, SessionsPersonalData } from '../auth/auth.personal-data.js';
import { FavoritesPersonalData } from '../favorites/favorites.personal-data.js';
import {
  NotificationLogsPersonalData,
  RemindersPersonalData,
} from '../reminders/reminders.personal-data.js';
import { SavedFiltersPersonalData } from '../saved-filters/saved-filters.personal-data.js';
import { UsersPersonalData } from '../users/users.personal-data.js';
import { AcceptancesPersonalData } from './acceptances.personal-data.js';
import { PersonalDataRegistry } from './registry/personal-data-registry.js';
import { ActorPseudonymsPersonalData } from './rights/actor-pseudonym.personal-data.js';
import { DataExportsPersonalData } from './rights/data-exports.personal-data.js';

const ID = '64b000000000000000000001';
const ctx = { accountId: ID } as unknown as AccessContext;
const AT = new Date('2026-03-10T15:00:00.000Z');

describe('favorites, saved filters, reminders and delivery logs', () => {
  it('favorites: the codes and when they were added; purge deletes by account', async () => {
    const repo = {
      findAllForExport: async () => ({
        items: [{ auctionCode: 'A1', createdAt: AT }, { auctionCode: 'A2' }],
        total: 2,
      }),
      purgeAccountByJob: vi.fn().mockResolvedValue(2),
    };
    const provider = new FavoritesPersonalData(new PersonalDataRegistry(), repo as never);

    expect(await provider.collect(ctx)).toEqual({
      items: [
        { auctionCode: 'A1', addedAt: AT },
        { auctionCode: 'A2', addedAt: null },
      ],
    });
    expect(await provider.purge(ID)).toEqual({ deleted: 2 });
    expect(repo.purgeAccountByJob).toHaveBeenCalledWith(ID);
  });

  it('saved filters: the criteria with prices as strings (AR-17), and a filter saved with none', async () => {
    const repo = {
      findAllForExport: async () => ({
        items: [
          {
            name: 'Natal',
            createdAt: AT,
            filters: {
              state: 'RN',
              city: ['Natal'],
              minPrice: Types.Decimal128.fromString('120000.50'),
              maxPrice: null,
            },
          },
          { name: 'Vazio', createdAt: AT, filters: undefined },
        ],
        total: 2,
      }),
      purgeAccountByJob: vi.fn().mockResolvedValue(2),
    };
    const provider = new SavedFiltersPersonalData(new PersonalDataRegistry(), repo as never);

    const { items } = (await provider.collect(ctx)) as { items: { filters: object }[] };

    expect(items[0]?.filters).toMatchObject({
      state: 'RN',
      city: ['Natal'],
      minPrice: '120000.50',
      maxPrice: null,
    });
    expect(items[1]?.filters).toMatchObject({ minPrice: null, maxPrice: null });
    expect(await provider.purge(ID)).toEqual({ deleted: 2 });
  });

  it('reminders: the auction code (null when the auction is gone), the channel and the note', async () => {
    const repo = {
      findAllForExport: async () => ({
        items: [
          {
            auction: { code: 'A1' },
            channel: 'EMAIL',
            scheduledAt: AT,
            description: 'n',
            status: 'PENDING',
            createdAt: AT,
          },
          { auction: null, channel: 'SMS', scheduledAt: AT, status: 'SENT', createdAt: AT },
        ],
        total: 2,
      }),
      purgeAccountByJob: vi.fn().mockResolvedValue(2),
    };
    const provider = new RemindersPersonalData(new PersonalDataRegistry(), repo as never);

    const { items } = (await provider.collect(ctx)) as { items: Record<string, unknown>[] };

    expect(items.map((i) => [i['auctionCode'], i['description']])).toEqual([
      ['A1', 'n'],
      [null, null],
    ]);
    expect(await provider.purge(ID)).toEqual({ deleted: 2 });
  });

  it('delivery logs: the recipient the message went to is the account’s own data', async () => {
    const repo = {
      findAllForExport: async () => ({
        items: [
          {
            reminderId: new Types.ObjectId(ID),
            channel: 'EMAIL',
            recipient: 'a@example.test',
            success: false,
            errorMessage: 'x',
            createdAt: AT,
          },
          { reminderId: new Types.ObjectId(ID), channel: 'SMS', recipient: '+5511', success: true },
        ],
        total: 2,
      }),
      purgeAccountByJob: vi.fn().mockResolvedValue(2),
    };
    const provider = new NotificationLogsPersonalData(new PersonalDataRegistry(), repo as never);

    const { items } = (await provider.collect(ctx)) as { items: Record<string, unknown>[] };

    expect(items[0]).toEqual({
      reminderId: ID,
      channel: 'EMAIL',
      recipient: 'a@example.test',
      success: false,
      errorMessage: 'x',
      sentAt: AT,
    });
    expect(items[1]).toMatchObject({ errorMessage: null, sentAt: null });
    expect(await provider.purge(ID)).toEqual({ deleted: 2 });
  });
});

describe('BR-010-08: the bounded "my data" view', () => {
  it('a list cut at the limit says so and how many there are; a complete one does not', async () => {
    const repo = {
      findAllForExport: vi.fn(async (_ctx: unknown, limit?: number) => ({
        items: [{ auctionCode: 'A1' }].slice(0, limit ?? 1),
        total: 900,
      })),
    };
    const provider = new FavoritesPersonalData(new PersonalDataRegistry(), repo as never);

    expect(await provider.collect(ctx, { limit: 1 })).toEqual({
      items: [{ auctionCode: 'A1', addedAt: null }],
      truncated: true,
      totals: { items: 900 },
    });
    expect(repo.findAllForExport).toHaveBeenCalledWith(ctx, 1);
    repo.findAllForExport.mockResolvedValue({ items: [{ auctionCode: 'A1' }], total: 1 });
    expect(await provider.collect(ctx)).toEqual({ items: [{ auctionCode: 'A1', addedAt: null }] });
    expect(repo.findAllForExport).toHaveBeenLastCalledWith(ctx, undefined);
  });
});

describe('the account document', () => {
  const user = (overrides: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(ID),
    email: 'a@example.test',
    name: 'Ana',
    providers: ['local', 'google'],
    googleId: 'g-1',
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  });

  it('shows the profile, how it signs in and the legacy billing fields, never the hash', async () => {
    const provider = new UsersPersonalData(new PersonalDataRegistry(), {
      findByIdFull: async () => user({ password: '$2b$10$hash', role: 'free' }),
    } as never);

    const data = await provider.collect(ctx);

    expect(data).toMatchObject({
      id: ID,
      email: 'a@example.test',
      status: 'active',
      emailVerified: false,
      phone: null,
      signIn: { methods: ['password', 'google'], googleId: 'g-1' },
      legacyBilling: { role: 'free', stripeCustomerId: null },
    });
    expect(JSON.stringify(data)).not.toContain('$2b$');
  });

  it('SC-26: holds no cpf, date of birth, sex or address any more, so the export carries none', async () => {
    const provider = new UsersPersonalData(new PersonalDataRegistry(), {
      findByIdFull: async () => user({ role: 'free' }),
    } as never);

    const data = await provider.collect(ctx);

    expect(data).not.toHaveProperty('legacyProfile');
    for (const erased of ['cpf', 'dateOfBirth', 'sex', 'address']) {
      expect(JSON.stringify(data)).not.toContain(erased);
    }
  });

  it('a Google-only account lists only Google; an unknown account is USER_NOT_FOUND', async () => {
    const googleOnly = new UsersPersonalData(new PersonalDataRegistry(), {
      findByIdFull: async () => user({ providers: ['google'] }),
    } as never);
    const missing = new UsersPersonalData(new PersonalDataRegistry(), {
      findByIdFull: async () => null,
    } as never);

    expect(await googleOnly.collect(ctx)).toMatchObject({ signIn: { methods: ['google'] } });
    await expect(missing.collect(ctx)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('does not delete the document: the tombstone is the purge job’s last step', async () => {
    const provider = new UsersPersonalData(new PersonalDataRegistry(), {} as never);

    expect(await provider.purge()).toEqual({ deleted: 0 });
  });
});

describe('sign-in records', () => {
  it('sessions: instants only; purge deletes the sessions and the counter keyed by the address', async () => {
    const sessions = {
      listForAccount: async () => [{ startedAt: AT, expiresAt: AT }],
      purgeAllForUser: vi.fn().mockResolvedValue(3),
    };
    const attempts = { forgetEmail: vi.fn().mockResolvedValue(undefined) };
    const users = { findById: vi.fn().mockResolvedValue({ email: 'a@example.test' }) };
    const provider = new SessionsPersonalData(
      new PersonalDataRegistry(),
      sessions as never,
      attempts as never,
      users as never,
    );

    expect(await provider.collect(ctx)).toEqual({ items: [{ startedAt: AT, expiresAt: AT }] });
    expect(await provider.purge(ID)).toEqual({ deleted: 3 });
    expect(attempts.forgetEmail).toHaveBeenCalledWith('a@example.test');
  });

  it('sessions: with no account left there is no counter to forget', async () => {
    const attempts = { forgetEmail: vi.fn() };
    const provider = new SessionsPersonalData(
      new PersonalDataRegistry(),
      { purgeAllForUser: async () => 0 } as never,
      attempts as never,
      { findById: async () => null } as never,
    );

    await provider.purge(ID);

    expect(attempts.forgetEmail).not.toHaveBeenCalled();
  });

  it('account tokens: the pending links as purpose and instants; purge deletes every record', async () => {
    const tokens = {
      pendingFor: async () => [{ purpose: 'email_confirmation', issuedAt: AT, expiresAt: AT }],
      purgeAllForUser: vi.fn().mockResolvedValue(4),
    };
    const provider = new AccountTokensPersonalData(new PersonalDataRegistry(), tokens as never);

    expect(await provider.collect(ctx)).toEqual({
      pending: [{ purpose: 'email_confirmation', issuedAt: AT, expiresAt: AT }],
    });
    expect(await provider.purge(ID)).toEqual({ deleted: 4 });
  });
});

describe('acceptances, exports and pseudonyms', () => {
  it('acceptances: those of the current consent generation, retained (nothing is purged)', async () => {
    const reset = new Date('2026-01-01T00:00:00.000Z');
    const consents = {
      listFor: vi.fn().mockResolvedValue([
        {
          documentType: 'terms',
          version: '0.1',
          acceptedAt: AT,
          method: 'signup_email',
          extra: 'x',
        },
      ]),
    };
    const whatsapp = {
      historyFor: vi
        .fn()
        .mockResolvedValue([
          { action: 'granted', method: 'privacy_page', textVersion: '0.1', at: AT },
        ]),
    };
    const users = { findById: async () => ({ consentResetAt: reset }) };
    const provider = new AcceptancesPersonalData(
      new PersonalDataRegistry(),
      consents as never,
      whatsapp as never,
      users as never,
    );

    expect(await provider.collect(ctx)).toEqual({
      items: [{ documentType: 'terms', version: '0.1', acceptedAt: AT, method: 'signup_email' }],
      whatsappConsent: {
        answers: [{ action: 'granted', method: 'privacy_page', textVersion: '0.1', at: AT }],
      },
    });
    expect(consents.listFor).toHaveBeenCalledWith(ID, reset);
    expect(provider.models).toEqual([]);
    expect(await provider.purge()).toEqual({ deleted: 0 });
  });

  it('acceptances: an account never reset reads generation null; an unknown account fails', async () => {
    const consents = { listFor: vi.fn().mockResolvedValue([]) };
    const whatsapp = { historyFor: vi.fn().mockResolvedValue([]) };
    const ok = new AcceptancesPersonalData(
      new PersonalDataRegistry(),
      consents as never,
      whatsapp as never,
      { findById: async () => ({}) } as never,
    );
    const missing = new AcceptancesPersonalData(
      new PersonalDataRegistry(),
      consents as never,
      whatsapp as never,
      { findById: async () => null } as never,
    );

    await ok.collect(ctx);
    expect(consents.listFor).toHaveBeenCalledWith(ID, null);
    await expect(missing.collect(ctx)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('exports: lists them without the file key; purge deletes each file before its row', async () => {
    const order: string[] = [];
    const entries = [
      {
        id: 'e1',
        userId: ID,
        status: 'ready',
        requestedAt: AT,
        readyAt: AT,
        expiresAt: AT,
        fileKey: 'private/exports/x.json',
      },
      { id: 'e2', userId: ID, status: 'failed', requestedAt: AT },
    ];
    const repo = {
      allOf: vi.fn().mockResolvedValueOnce(entries).mockResolvedValueOnce([]),
      deleteOne: vi.fn(async (id: string) => void order.push(`row:${id}`)),
    };
    const storage = { deleteFile: vi.fn(async (key: string) => (order.push(`file:${key}`), true)) };
    const provider = new DataExportsPersonalData(
      new PersonalDataRegistry(),
      repo as never,
      storage as never,
      new FakeClock(AT),
    );

    expect(JSON.stringify(await provider.collect(ctx))).not.toContain('private/');
    repo.allOf.mockReset().mockResolvedValueOnce(entries).mockResolvedValueOnce([]);
    expect(await provider.purge(ID)).toEqual({ deleted: 2 });
    expect(order).toEqual(['file:private/exports/x.json', 'row:e1', 'row:e2']);
  });

  it('exports: a file that cannot be deleted fails the purge and keeps its row', async () => {
    const repo = {
      allOf: async () => [
        {
          id: 'e1',
          userId: ID,
          status: 'ready',
          requestedAt: AT,
          fileKey: 'private/exports/x.json',
        },
      ],
      deleteOne: vi.fn(),
    };
    const provider = new DataExportsPersonalData(
      new PersonalDataRegistry(),
      repo as never,
      { deleteFile: async () => false } as never,
      new FakeClock(AT),
    );

    await expect(provider.purge(ID)).rejects.toThrow('EXPORT_FILE_DELETE_FAILED');
    expect(repo.deleteOne).not.toHaveBeenCalled();
  });

  it('exports: while a worker is still building one (its lease is live) the purge waits and deletes nothing', async () => {
    const repo = {
      allOf: async () => [
        {
          id: 'e1',
          userId: ID,
          status: 'cancelled',
          requestedAt: AT,
          fileKey: 'private/exports/x.json',
          claimUntil: new Date(AT.getTime() + 60_000),
        },
      ],
      deleteOne: vi.fn(),
    };
    const storage = { deleteFile: vi.fn() };
    const provider = new DataExportsPersonalData(
      new PersonalDataRegistry(),
      repo as never,
      storage as never,
      new FakeClock(AT),
    );

    await expect(provider.purge(ID)).rejects.toMatchObject({ name: 'ExportBuildInProgressError' });
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(repo.deleteOne).not.toHaveBeenCalled();
  });

  it('pseudonyms: lists the labels; purge detaches, it does not delete', async () => {
    const service = { detachUser: vi.fn().mockResolvedValue(2) };
    const repository = { labelsOf: async () => [{ journeyId: 'j1', pseudonym: 'p-aa' }] };
    const provider = new ActorPseudonymsPersonalData(
      new PersonalDataRegistry(),
      service as never,
      repository as never,
    );

    expect(await provider.collect(ctx)).toEqual({
      items: [{ journeyId: 'j1', pseudonym: 'p-aa' }],
    });
    expect(await provider.purge(ID)).toEqual({ deleted: 2 });
  });
});

describe('registering', () => {
  it('each provider registers itself under its own name when built', () => {
    const registry = new PersonalDataRegistry();
    new FavoritesPersonalData(registry, {} as never);
    new SavedFiltersPersonalData(registry, {} as never);
    new UsersPersonalData(registry, {} as never);

    expect(registry.providers().map((p) => p.name)).toEqual([
      'favorites',
      'savedFilters',
      'account',
    ]);
    expect(registry.coveredModels()).toEqual(['FavoriteEntity', 'SavedFilterEntity', 'UserEntity']);
  });
});
