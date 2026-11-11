import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { DomainError } from '../common/errors/domain-error';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import { FakeClock, HOUR } from '../../test/fakes/fake-clock';
import { serverOperators } from '../common/mongo/query-safety';

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
  const service = new UsersService(model as unknown as ServiceDeps[0], new FakeClock());
  return { service, model, selectExec };
}

/** The `$set` the update sent to Mongo. */
function setOf(model: ReturnType<typeof build>['model']): Record<string, unknown> {
  const update = model.findOneAndUpdate.mock.calls[0]?.[1] as { $set: Record<string, unknown> };
  return update.$set;
}

describe('UsersService finders (SC-10)', () => {
  const operator = { $ne: null } as unknown as string;

  it('findByEmail compares the lower-cased e-mail by equality', async () => {
    const { service, model } = build();

    await service.findByEmail('Ana@Example.com');
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

  it('ignores an empty password and still lets other empty strings through', async () => {
    const { service, model } = build();

    await service.update('u1', { password: '', name: '' } as UpdateUserDto);

    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(setOf(model)).toEqual({ name: '' });
  });

  it('hashes the password without mutating the DTO', async () => {
    const { service, model } = build();
    const dto = { password: 'secret-123' } as UpdateUserDto;

    await service.update('u1', dto);

    expect(bcrypt.hash).toHaveBeenCalledWith('secret-123', 10);
    expect(setOf(model)).toEqual({ password: 'hashed:secret-123' });
    expect(dto.password).toBe('secret-123');
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

  it('copies only the string address fields it knows', async () => {
    const { service, model } = build();
    const address = { street: 'Rua A', city: { $ne: null }, state: 'SP', extra: 'x' };

    await service.update('u1', { address } as unknown as UpdateUserDto);

    expect(setOf(model)).toEqual({ address: { street: 'Rua A', state: 'SP' } });
  });

  it('ignores an address that is not an object', async () => {
    const { service, model } = build();

    await service.update('u1', { address: null } as unknown as UpdateUserDto);

    expect(setOf(model)).toEqual({});
  });

  it('refuses an e-mail that belongs to another user and allows the user own e-mail', async () => {
    const taken = build({ _id: { toString: () => 'other' } });
    await expect(taken.service.update('u1', { email: 'a@b.com' } as UpdateUserDto)).rejects.toEqual(
      new DomainError('EMAIL_ALREADY_REGISTERED'),
    );
    expect(taken.model.findOneAndUpdate).not.toHaveBeenCalled();

    const own = build({ _id: { toString: () => 'u1' } });
    await own.service.update('u1', { email: 'a@b.com' } as UpdateUserDto);
    expect(own.model.findOneAndUpdate).toHaveBeenCalled();
  });

  it('reports USER_NOT_FOUND when nothing matched', async () => {
    const { service, selectExec } = build();
    selectExec.mockResolvedValue(null);

    await expect(service.update('u1', { name: 'Ana' } as UpdateUserDto)).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });
});

// AR-24 / TS-06: token lifetimes are measured from the injected clock, so expiry is testable.
describe('UsersService token expiry (AR-24)', () => {
  const NOW = new Date('2026-01-31T23:30:00.000Z');

  function buildTokens(user: unknown) {
    const model = {
      findOne: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(user) }),
      findById: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(user) }),
      findByIdAndUpdate: vi.fn().mockResolvedValue({}),
      find: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
    };
    const service = new UsersService(model as unknown as ServiceDeps[0], new FakeClock(NOW));
    return { service, model };
  }

  it('a reset-password token expires one hour after it is issued', async () => {
    const { service, model } = buildTokens({ _id: 'u1' });

    await service.setResetPasswordToken('ana@example.test');

    expect(model.findByIdAndUpdate).toHaveBeenCalledWith('u1', {
      resetPasswordToken: expect.any(String),
      resetPasswordExpires: new Date(NOW.getTime() + HOUR), // 2026-02-01T00:30Z
    });
  });

  it('an e-mail verification token expires 24 hours after it is issued', async () => {
    const { service, model } = buildTokens({ _id: 'u1' });

    await service.setEmailVerificationToken('u1');

    expect(model.findByIdAndUpdate).toHaveBeenCalledWith('u1', {
      emailVerificationToken: expect.any(String),
      emailVerificationExpires: new Date('2026-02-01T23:30:00.000Z'),
    });
  });

  it('looks for unexpired tokens against the clock', async () => {
    const { service, model } = buildTokens(null);

    await expect(service.resetPassword('t', 'new-password')).rejects.toEqual(
      new DomainError('INVALID_RESET_TOKEN'),
    );
    expect(model.find).toHaveBeenCalledWith({
      resetPasswordExpires: serverOperators({ $gt: NOW }),
    });
  });
});
