import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { DomainError } from '../common/errors/domain-error.js';
import { UsersService } from './users.service.js';
import { FakeClock, HOUR } from '../../test/fakes/fake-clock.js';
import { FakeQuery } from '../../test/fakes/fake-query.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import type { CreateUserDto } from './dto/create-user.dto.js';

type Deps = ConstructorParameters<typeof UsersService>;

vi.mock('bcrypt', () => ({
  // Not a port: bcrypt is a library call and a real round costs ~70 ms per case. "Hashing" here
  // is a reversible prefix, so a spec can tell a stored hash from a plain value and a comparison
  // is true only for the matching plain text.
  hash: vi.fn(async (plain: string) => `hashed:${plain}`),
  compare: vi.fn(async (plain: string, hashed: string) => hashed === `hashed:${plain}`),
}));

const NOW = new Date('2026-01-15T12:00:00.000Z');

/** A user document stand-in for the model's constructor; `save` resolves to the document itself. */
function aModel(returns: Record<string, unknown> = {}) {
  const created: Record<string, unknown>[] = [];
  class Model {
    constructor(fields: Record<string, unknown>) {
      Object.assign(this, fields);
      created.push(fields);
    }
    save() {
      return Promise.resolve(this);
    }
    static findOne = vi.fn().mockReturnValue(new FakeQuery(returns['findOne'] ?? null));
    static find = vi.fn().mockReturnValue(new FakeQuery(returns['find'] ?? []));
    static findById = vi.fn().mockReturnValue(new FakeQuery(returns['findById'] ?? null));
    static findByIdAndUpdate = vi
      .fn()
      .mockReturnValue(new FakeQuery(returns['findByIdAndUpdate'] ?? null));
    static deleteOne = vi
      .fn()
      .mockReturnValue(new FakeQuery(returns['deleteOne'] ?? { deletedCount: 1 }));
  }
  return { Model, created };
}

function aService(model: unknown, clock = new FakeClock(NOW)) {
  return new UsersService(model as Deps[0], clock);
}

beforeEach(() => {
  vi.mocked(bcrypt.hash).mockClear();
  vi.mocked(bcrypt.compare).mockClear();
});

describe('UsersService.create', () => {
  it('stores a hashed password and a local account as unverified', async () => {
    const { Model, created } = aModel();

    await aService(Model).create({
      email: 'ana@example.test',
      name: 'Ana',
      password: 'secret1',
    } as CreateUserDto);

    expect(created).toEqual([
      { email: 'ana@example.test', name: 'Ana', password: 'hashed:secret1', emailVerified: false },
    ]);
  });

  it('marks a Google sign-up as verified and stores no password', async () => {
    const { Model, created } = aModel();

    await aService(Model).create({
      email: 'ana@example.test',
      name: 'Ana',
      googleId: 'g-1',
      providers: ['google'],
    } as CreateUserDto);

    expect(created[0]).toMatchObject({ password: undefined, emailVerified: true });
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('refuses an e-mail that is already registered, without hashing or saving', async () => {
    const { Model, created } = aModel({ findOne: { _id: 'u1' } });

    await expect(
      aService(Model).create({ email: 'Ana@Example.test', name: 'Ana' } as CreateUserDto),
    ).rejects.toEqual(new DomainError('EMAIL_ALREADY_REGISTERED'));
    expect(Model.findOne).toHaveBeenCalledWith({ email: { $eq: 'ana@example.test' } });
    expect(created).toEqual([]);
  });
});

describe('UsersService finders', () => {
  it('findAll and findById never select the password hash', async () => {
    const all = new FakeQuery([{ _id: 'u1' }]);
    const one = new FakeQuery({ _id: 'u1' });
    const { Model } = aModel();
    Model.find.mockReturnValue(all);
    Model.findById.mockReturnValue(one);
    const service = aService(Model);

    await expect(service.findAll()).resolves.toEqual([{ _id: 'u1' }]);
    await expect(service.findById('u1')).resolves.toEqual({ _id: 'u1' });

    expect(all.calls['select']).toEqual([['-password']]);
    expect(one.calls['select']).toEqual([['-password']]);
  });

  it('findByIdFull leaves out the password and every token', async () => {
    const query = new FakeQuery({ _id: 'u1' });
    const { Model } = aModel();
    Model.findById.mockReturnValue(query);

    await aService(Model).findByIdFull('u1');

    expect(query.calls['select']).toEqual([
      [
        '-password -resetPasswordToken -resetPasswordExpires -emailVerificationToken -emailVerificationExpires',
      ],
    ]);
  });
});

describe('UsersService.linkGoogleAccount and setPassword', () => {
  it('links Google, verifies the e-mail and adds the provider once', async () => {
    const { Model } = aModel({ findByIdAndUpdate: { _id: 'u1' } });

    await expect(aService(Model).linkGoogleAccount('u1', 'g-1')).resolves.toEqual({ _id: 'u1' });

    expect(Model.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { googleId: 'g-1', emailVerified: true, $addToSet: { providers: 'google' } },
      { returnDocument: 'after' },
    );
  });

  it('reports USER_NOT_FOUND when the account to link is gone', async () => {
    const { Model } = aModel();
    await expect(aService(Model).linkGoogleAccount('u1', 'g-1')).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });

  it('sets a hashed password, adds the local provider and does not return the hash', async () => {
    const query = new FakeQuery({ _id: 'u1' });
    const { Model } = aModel();
    Model.findByIdAndUpdate.mockReturnValue(query);

    await aService(Model).setPassword('u1', 'newsecret');

    expect(Model.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { password: 'hashed:newsecret', $addToSet: { providers: 'local' } },
      { returnDocument: 'after' },
    );
    expect(query.calls['select']).toEqual([['-password']]);
  });

  it('reports USER_NOT_FOUND when the account to set a password on is gone', async () => {
    const { Model } = aModel();
    await expect(aService(Model).setPassword('u1', 'newsecret')).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });
});

describe('UsersService.remove', () => {
  it('deletes the account', async () => {
    const { Model } = aModel();
    await aService(Model).remove('u1');
    expect(Model.deleteOne).toHaveBeenCalledWith({ _id: 'u1' });
  });

  it('reports USER_NOT_FOUND when nothing was deleted', async () => {
    const { Model } = aModel({ deleteOne: { deletedCount: 0 } });
    await expect(aService(Model).remove('u1')).rejects.toEqual(new DomainError('USER_NOT_FOUND'));
  });
});

describe('UsersService.validatePassword', () => {
  it('returns the user when the password matches the stored hash', async () => {
    const user = { _id: 'u1', password: 'hashed:secret1' };
    const { Model } = aModel({ findOne: user });
    await expect(aService(Model).validatePassword('a@example.test', 'secret1')).resolves.toBe(user);
  });

  it('returns null for a wrong password', async () => {
    const { Model } = aModel({ findOne: { _id: 'u1', password: 'hashed:secret1' } });
    await expect(aService(Model).validatePassword('a@example.test', 'nope')).resolves.toBeNull();
  });

  it('returns null for an unknown e-mail and for an account without a password (Google only)', async () => {
    await expect(
      aService(aModel().Model).validatePassword('a@example.test', 'secret1'),
    ).resolves.toBeNull();
    const googleOnly = aModel({ findOne: { _id: 'u1' } }).Model;
    await expect(aService(googleOnly).validatePassword('a@example.test', 'x')).resolves.toBeNull();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});

describe('UsersService reset-password flow', () => {
  it('setResetPasswordToken refuses an unknown e-mail', async () => {
    await expect(aService(aModel().Model).setResetPasswordToken('x@example.test')).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });

  it('setResetPasswordToken stores only the hash of the token it returns', async () => {
    const { Model } = aModel({ findOne: { _id: 'u1' } });

    const token = await aService(Model).setResetPasswordToken('a@example.test');

    expect(token).not.toBe('');
    const [id, update] = Model.findByIdAndUpdate.mock.calls[0] ?? [];
    expect(id).toBe('u1');
    expect(update).toEqual({
      resetPasswordToken: `hashed:${token}`,
      resetPasswordExpires: new Date(NOW.getTime() + HOUR),
    });
  });

  it('resetPassword sets the new password for the user whose token matches and clears the token', async () => {
    const users = [
      { _id: 'u0', resetPasswordToken: undefined },
      { _id: 'u1', resetPasswordToken: 'hashed:other' },
      { _id: 'u2', resetPasswordToken: 'hashed:tok' },
      { _id: 'u3', resetPasswordToken: 'hashed:tok' },
    ];
    const { Model } = aModel({ find: users });

    await aService(Model).resetPassword('tok', 'brandnew');

    expect(Model.find).toHaveBeenCalledWith({
      resetPasswordExpires: serverOperators({ $gt: NOW }),
    });
    // The first match wins; users without a token are not compared.
    expect(bcrypt.compare).toHaveBeenCalledTimes(2);
    expect(Model.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(Model.findByIdAndUpdate).toHaveBeenCalledWith('u2', {
      password: 'hashed:brandnew',
      resetPasswordToken: undefined,
      resetPasswordExpires: undefined,
      $addToSet: { providers: 'local' },
    });
  });

  it('resetPassword refuses a token no unexpired user holds', async () => {
    const { Model } = aModel({ find: [{ _id: 'u1', resetPasswordToken: 'hashed:other' }] });

    await expect(aService(Model).resetPassword('tok', 'brandnew')).rejects.toEqual(
      new DomainError('INVALID_RESET_TOKEN'),
    );
    expect(Model.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('UsersService e-mail verification flow', () => {
  it('setEmailVerificationToken refuses an unknown user', async () => {
    await expect(aService(aModel().Model).setEmailVerificationToken('u1')).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });

  it('setEmailVerificationToken returns a 64-hex-character token and stores only its hash', async () => {
    const { Model } = aModel({ findById: { _id: 'u1' } });

    const token = await aService(Model).setEmailVerificationToken('u1');

    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes in hex
    expect(Model.findByIdAndUpdate).toHaveBeenCalledWith('u1', {
      emailVerificationToken: `hashed:${token}`,
      emailVerificationExpires: new Date(NOW.getTime() + 24 * HOUR),
    });
  });

  it('verifyEmail verifies the user whose token matches, among unverified unexpired ones', async () => {
    const match = { _id: 'u2', emailVerificationToken: 'hashed:tok' };
    const { Model } = aModel({
      find: [{ _id: 'u0' }, { _id: 'u1', emailVerificationToken: 'hashed:other' }, match],
    });

    await expect(aService(Model).verifyEmail('tok')).resolves.toBe(match);

    expect(Model.find).toHaveBeenCalledWith({
      emailVerificationExpires: serverOperators({ $gt: NOW }),
      emailVerified: false,
    });
    expect(Model.findByIdAndUpdate).toHaveBeenCalledWith('u2', {
      emailVerified: true,
      emailVerificationToken: undefined,
      emailVerificationExpires: undefined,
    });
  });

  it('verifyEmail refuses a token nobody holds', async () => {
    const { Model } = aModel({ find: [{ _id: 'u1', emailVerificationToken: 'hashed:other' }] });

    await expect(aService(Model).verifyEmail('tok')).rejects.toEqual(
      new DomainError('INVALID_VERIFICATION_TOKEN'),
    );
    expect(Model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('isEmailVerified is true for a verified user and false for an unverified or unknown one', async () => {
    const verified = aModel({ findById: { emailVerified: true } }).Model;
    const unverified = aModel({ findById: { emailVerified: false } }).Model;

    await expect(aService(verified).isEmailVerified('u1')).resolves.toBe(true);
    await expect(aService(unverified).isEmailVerified('u1')).resolves.toBe(false);
    await expect(aService(aModel().Model).isEmailVerified('u1')).resolves.toBe(false);
  });
});
