import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { DomainError } from '../common/errors/domain-error.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UsersService } from './users.service.js';

type ServiceDeps = ConstructorParameters<typeof UsersService>;

vi.mock('bcrypt', () => ({
  // Not a port: the hash function is a library call, and a real bcrypt round costs ~70 ms per
  // case. The spec asserts what is hashed and that the result is what is stored.
  hash: vi.fn(async (plain: string) => `hashed:${plain}`),
}));

function build(found: unknown = null) {
  const findOne = vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(found) });
  const selectExec = vi.fn().mockResolvedValue({ _id: 'u1' });
  const findOneAndUpdate = vi
    .fn()
    .mockReturnValue({ select: vi.fn().mockReturnValue({ exec: selectExec }) });
  const model = { findOne, findOneAndUpdate };
  const service = new UsersService(model as unknown as ServiceDeps[0]);
  return { service, model, selectExec };
}

/** The `$set` the update sent to Mongo. */
function setOf(model: ReturnType<typeof build>['model']): Record<string, unknown> {
  const update = model.findOneAndUpdate.mock.calls[0]?.[1] as { $set: Record<string, unknown> };
  return update.$set;
}

describe('UsersService finders (SC-10)', () => {
  const operator = { $ne: null } as unknown as string;

  it('BR-001-01: findByEmail compares the trimmed, lower-cased e-mail by equality', async () => {
    const { service, model } = build();

    await service.findByEmail(' Ana@Example.com ');
    expect(model.findOne).toHaveBeenCalledWith({ email: { $eq: 'ana@example.com' } });
  });

  it('findByGoogleId compares by equality and finds nobody for a non-string', async () => {
    const { service, model } = build({ id: 1 });

    await service.findByGoogleId('g-1');
    expect(model.findOne).toHaveBeenCalledWith({ googleId: { $eq: 'g-1' } });

    model.findOne.mockClear();
    await expect(service.findByGoogleId(operator)).resolves.toBeNull();
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('findByStripeCustomerId compares by equality and finds nobody for a non-string', async () => {
    const { service, model } = build({ id: 1 });

    await service.findByStripeCustomerId('cus_1');
    expect(model.findOne).toHaveBeenCalledWith({ stripeCustomerId: { $eq: 'cus_1' } });

    model.findOne.mockClear();
    await expect(service.findByStripeCustomerId(operator)).resolves.toBeNull();
    expect(model.findOne).not.toHaveBeenCalled();
  });
});

describe('UsersService.update (SC-10)', () => {
  beforeEach(() => {
    vi.mocked(bcrypt.hash).mockClear();
  });

  it('writes a $set of the whitelisted text fields, matched by equality on the id', async () => {
    const { service, model } = build();

    await service.update('u1', {
      name: 'Ana',
      phone: '11999999999',
      role: 'user',
    } as UpdateUserDto);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: { $eq: 'u1' } },
      { $set: { name: 'Ana', phone: '11999999999', role: 'user' } },
      { returnDocument: 'after' },
    );
  });

  it('drops keys the DTO does not name, operator keys and wrongly typed values', async () => {
    const { service, model } = build();
    const body = {
      name: 'Ana',
      phone: { $ne: null },
      cpf: 12345,
      $unset: { password: 1 },
      isAdmin: true,
      emailVerified: true,
    } as unknown as UpdateUserDto;

    await service.update('u1', body);

    expect(setOf(model)).toEqual({ name: 'Ana' });
  });

  it('BR-001-31: update no longer carries a password, so it cannot reach the hash', async () => {
    const { service, model } = build();

    await service.update('u1', { password: 'secret-123', name: '' } as unknown as UpdateUserDto);

    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(setOf(model)).toEqual({ name: '' });
  });

  it('BR-001-26 / D-63: update has no email: an email in the body is dropped, never written', async () => {
    const { service, model } = build();

    await service.update('u1', { name: 'Ana', email: 'other@example.test' } as UpdateUserDto);

    expect(setOf(model)).toEqual({ name: 'Ana' });
  });

  it('keeps an explicit null subscriptionStatus and a string one, and drops other types', async () => {
    const cleared = build();
    await cleared.service.update('u1', { subscriptionStatus: null } as unknown as UpdateUserDto);
    expect(setOf(cleared.model)).toEqual({ subscriptionStatus: null });

    const active = build();
    await active.service.update('u1', { subscriptionStatus: 'active' } as UpdateUserDto);
    expect(setOf(active.model)).toEqual({ subscriptionStatus: 'active' });

    const bad = build();
    await bad.service.update('u1', { subscriptionStatus: { $ne: 1 } } as unknown as UpdateUserDto);
    expect(setOf(bad.model)).toEqual({});
  });

  it('keeps providers only when every entry is a string', async () => {
    const good = build();
    await good.service.update('u1', { providers: ['local', 'google'] } as UpdateUserDto);
    expect(setOf(good.model)).toEqual({ providers: ['local', 'google'] });

    const bad = build();
    await bad.service.update('u1', {
      providers: ['local', { $ne: 1 }],
    } as unknown as UpdateUserDto);
    expect(setOf(bad.model)).toEqual({});

    const notAnArray = build();
    await notAnArray.service.update('u1', { providers: 'local' } as unknown as UpdateUserDto);
    expect(setOf(notAnArray.model)).toEqual({});
  });

  it('SC-26: update no longer writes the legacy cpf, date of birth, sex and address', async () => {
    const { service, model } = build();
    const legacy = {
      name: 'Ana',
      cpf: '00000000000',
      dateOfBirth: '1990-05-06',
      sex: 'female',
      address: { street: 'Rua A', city: 'Santos', state: 'SP', zipCode: '11000000' },
    } as unknown as UpdateUserDto;

    await service.update('u1', legacy);

    expect(setOf(model)).toEqual({ name: 'Ana' });
  });

  it('reports USER_NOT_FOUND when nothing matched', async () => {
    const { service, selectExec } = build();
    selectExec.mockResolvedValue(null);

    await expect(service.update('u1', { name: 'Ana' } as UpdateUserDto)).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });
});

// BR-001-25, BR-001-29, BR-001-31: the profile is written from an explicit allowlist.
describe('UsersService.updateProfile', () => {
  function buildWrites(found: unknown = { _id: 'u1' }) {
    const exec = vi.fn().mockResolvedValue(found);
    const select = vi.fn().mockReturnValue({ exec });
    const findOneAndUpdate = vi.fn().mockReturnValue({ select });
    const findOne = vi.fn().mockReturnValue({ select });
    const model = { findOneAndUpdate, findOne };
    return { service: new UsersService(model as unknown as ServiceDeps[0]), model, exec };
  }
  const update = (model: ReturnType<typeof buildWrites>['model']) =>
    model.findOneAndUpdate.mock.calls[0]?.[1] as Record<string, unknown>;

  it('writes name (trimmed) and phone under $set, matched by equality on the id', async () => {
    const { service, model } = buildWrites();

    await service.updateProfile('u1', { name: '  Ana Teste ', phone: '+5584999991234' });

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: { $eq: 'u1' } },
      { $set: { name: 'Ana Teste', phone: '+5584999991234' } },
      { returnDocument: 'after' },
    );
  });

  it('removes the phone with $unset when it is null, and writes nothing else', async () => {
    const { service, model } = buildWrites();

    await service.updateProfile('u1', { phone: null });

    expect(update(model)).toEqual({ $unset: { phone: '' } });
  });

  it('BR-001-29: carries nothing but name and phone, whatever the input object holds', async () => {
    const { service, model } = buildWrites();
    const hostile = {
      name: 'Ana',
      role: 'admin',
      status: 'closed',
      providers: ['google'],
      emailVerified: true,
      $set: { role: 'admin' },
      $unset: { password: '' },
    } as unknown as Parameters<UsersService['updateProfile']>[1];

    await service.updateProfile('u1', hostile);

    expect(update(model)).toEqual({ $set: { name: 'Ana' } });
  });

  it('ignores a name or phone that is not text', async () => {
    const { service, model } = buildWrites();
    const odd = { name: { $ne: null }, phone: 5584999991234 } as unknown as Parameters<
      UsersService['updateProfile']
    >[1];

    await service.updateProfile('u1', odd);

    expect(model.findOneAndUpdate).not.toHaveBeenCalled(); // nothing to write: a read only
    expect(model.findOne).toHaveBeenCalledWith({ _id: { $eq: 'u1' } });
  });

  it('reports USER_NOT_FOUND when the account is gone', async () => {
    const { service } = buildWrites(null);

    await expect(service.updateProfile('u1', { name: 'Ana' })).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });
});
