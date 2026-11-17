// The saved-filter plan limit is a typed setting (AR-43), not a constant in the service. The
// repository is stubbed: what is under test is which number the service compares the count against.
import { describe, expect, it, vi } from 'vitest';
import { SavedFiltersService } from './saved-filters.service.js';
import { testBusinessConfig } from '../../test/support/test-env.js';
import { anAccessContext } from '../../test/fakes/fake-access-sources.js';

const ctx = await anAccessContext('64b7f0000000000000000001');

type ServiceDeps = ConstructorParameters<typeof SavedFiltersService>;

describe('SavedFiltersService.create plan limit (AR-43)', () => {
  function build(count: number, overrides: Record<string, string | undefined> = {}) {
    const save = vi.fn().mockImplementation((_ctx: unknown, doc: object) =>
      Promise.resolve({
        ...doc,
        _id: { toString: () => 'new-id' },
        createdAt: new Date('2026-01-15T12:00:00.000Z'),
      }),
    );
    const repository = {
      count: vi.fn().mockResolvedValue(count),
      findByName: vi.fn().mockResolvedValue(null),
      create: save,
    };
    const service = new SavedFiltersService(
      repository as unknown as ServiceDeps[0],
      testBusinessConfig(overrides),
    );
    return { service, save };
  }

  it('refuses at the default limit of 10, with the limit in the error context', async () => {
    const { service, save } = build(10);

    await expect(service.create(ctx, 'Natal', {})).rejects.toMatchObject({
      code: 'SAVED_FILTER_LIMIT_REACHED',
      context: { limit: 10 },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('allows the last slot under the default limit', async () => {
    const { service, save } = build(9);

    await expect(service.create(ctx, 'Natal', {})).resolves.toMatchObject({ name: 'Natal' });
    expect(save).toHaveBeenCalledOnce();
  });

  it('follows SAVED_FILTERS_MAX_PER_USER with no code change', async () => {
    const lower = build(3, { SAVED_FILTERS_MAX_PER_USER: '3' });
    await expect(lower.service.create(ctx, 'Natal', {})).rejects.toMatchObject({
      code: 'SAVED_FILTER_LIMIT_REACHED',
      context: { limit: 3 },
    });

    const higher = build(10, { SAVED_FILTERS_MAX_PER_USER: '25' });
    await expect(higher.service.create(ctx, 'Natal', {})).resolves.toMatchObject({
      name: 'Natal',
    });
  });
});
