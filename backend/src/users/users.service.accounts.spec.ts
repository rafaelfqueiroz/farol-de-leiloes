import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { DomainError } from '../common/errors/domain-error.js';
import { UsersService } from './users.service.js';
import { FakeQuery } from '../../test/fakes/fake-query.js';
import type { CreateUserDto } from './dto/create-user.dto.js';

type Deps = ConstructorParameters<typeof UsersService>;

vi.mock('bcrypt', () => ({
  // Not a port: bcrypt is a library call and a real round costs ~70 ms per case. "Hashing" here
  // is a reversible prefix, so a spec can tell a stored hash from a plain value and a comparison
  // is true only for the matching plain text.
  hash: vi.fn(async (plain: string) => `hashed:${plain}`),
  compare: vi.fn(async (plain: string, hashed: string) => hashed === `hashed:${plain}`),
}));

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
    static findOneAndUpdate = vi
      .fn()
      .mockReturnValue(new FakeQuery(returns['findOneAndUpdate'] ?? null));
    static updateOne = vi
      .fn()
      .mockReturnValue(new FakeQuery(returns['updateOne'] ?? { matchedCount: 1 }));
    static deleteOne = vi
      .fn()
      .mockReturnValue(new FakeQuery(returns['deleteOne'] ?? { deletedCount: 1 }));
  }
  return { Model, created };
}

function aService(model: unknown) {
  return new UsersService(model as Deps[0]);
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

  it('findByIdFull leaves out the password', async () => {
    const query = new FakeQuery({ _id: 'u1' });
    const { Model } = aModel();
    Model.findById.mockReturnValue(query);

    await aService(Model).findByIdFull('u1');

    expect(query.calls['select']).toEqual([['-password']]);
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
    Model.findOneAndUpdate.mockReturnValue(query);

    await aService(Model).setPassword('u1', 'newsecret');

    expect(Model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: { $eq: 'u1' } },
      { $set: { password: 'hashed:newsecret' }, $addToSet: { providers: 'local' } },
      { returnDocument: 'after' },
    );
    expect(query.calls['select']).toEqual([['-password']]);
  });

  it('BR-001-28: changePassword stores the new hash and leaves the providers alone', async () => {
    const { Model } = aModel();
    Model.findOneAndUpdate.mockReturnValue(new FakeQuery({ _id: 'u1' }));

    await aService(Model).changePassword('u1', 'newsecret');

    expect(Model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: { $eq: 'u1' } },
      { $set: { password: 'hashed:newsecret' } },
      { returnDocument: 'after' },
    );
  });

  it('reports USER_NOT_FOUND when the account to set a password on is gone', async () => {
    const { Model } = aModel();
    await expect(aService(Model).setPassword('u1', 'newsecret')).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
    await expect(aService(Model).changePassword('u1', 'newsecret')).rejects.toEqual(
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

describe('UsersService.validatePassword (BR-001-14, BR-001-16, SC-05)', () => {
  it('returns the user when the password matches the stored hash', async () => {
    const user = { _id: 'u1', password: 'hashed:secret1' };
    const { Model } = aModel({ findOne: user });
    await expect(aService(Model).validatePassword('a@example.test', 'secret1')).resolves.toBe(user);
  });

  it('returns null for a wrong password', async () => {
    const { Model } = aModel({ findOne: { _id: 'u1', password: 'hashed:secret1' } });
    await expect(aService(Model).validatePassword('a@example.test', 'nope')).resolves.toBeNull();
  });

  it.each([
    ['an unknown e-mail', null],
    ['an account without a password (Google only)', { _id: 'u1' }],
    ['a wrong password', { _id: 'u1', password: 'hashed:secret1' }],
    ['a deactivated account', { _id: 'u1', password: 'hashed:right', status: 'deactivated' }],
  ])('BR-001-14: %s costs exactly one bcrypt comparison and answers null', async (_l, found) => {
    const { Model } = aModel({ findOne: found });

    await expect(aService(Model).validatePassword('a@example.test', 'right')).resolves.toBeNull();

    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
  });

  it('BR-001-16: a closed account is refused even with the right password', async () => {
    const { Model } = aModel({
      findOne: { _id: 'u1', password: 'hashed:right', status: 'closed' },
    });
    await expect(aService(Model).validatePassword('a@example.test', 'right')).resolves.toBeNull();
  });

  it('an account with no status counts as active (AR-28)', async () => {
    const user = { _id: 'u1', password: 'hashed:right' };
    const { Model } = aModel({ findOne: user });
    await expect(aService(Model).validatePassword('a@example.test', 'right')).resolves.toBe(user);
  });

  it('never signs in an unknown e-mail, whatever the dummy hash is compared with', async () => {
    // The throwaway hash is of this very text; matching it must not authenticate nobody.
    await expect(
      aService(aModel().Model).validatePassword('a@example.test', 'not-a-real-password'),
    ).resolves.toBeNull();
  });

  it('hashes the throwaway password once and reuses it', async () => {
    const service = aService(aModel().Model);
    await service.validatePassword('a@example.test', 'x');
    await service.validatePassword('b@example.test', 'x');
    expect(bcrypt.hash).toHaveBeenCalledTimes(1);
  });
});

describe('UsersService.createLocalAccount (BR-001-01, BR-001-03, BR-001-31)', () => {
  it('normalises the email, hashes the password and fixes provider and confirmation', async () => {
    const { Model, created } = aModel();

    await aService(Model).createLocalAccount({
      email: '  Ana@Example.TEST ',
      name: '  Ana  ',
      password: 'secret12',
    });

    expect(created).toEqual([
      {
        email: 'ana@example.test',
        name: 'Ana',
        password: 'hashed:secret12',
        providers: ['local'],
        emailVerified: false,
      },
    ]);
  });

  it('BR-001-01: refuses an email that exists in another case, without hashing', async () => {
    const { Model, created } = aModel({ findOne: { _id: 'u1' } });

    await expect(
      aService(Model).createLocalAccount({ email: 'ANA@example.test', name: 'Ana', password: 'x' }),
    ).rejects.toEqual(new DomainError('EMAIL_ALREADY_REGISTERED'));
    expect(Model.findOne).toHaveBeenCalledWith({ email: { $eq: 'ana@example.test' } });
    expect(created).toEqual([]);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('BR-001-01: a duplicate-key error from a racing sign-up is the same refusal', async () => {
    const { Model } = aModel();
    Model.prototype.save = () => Promise.reject(Object.assign(new Error('dup'), { code: 11000 }));

    await expect(
      aService(Model).createLocalAccount({ email: 'a@example.test', name: 'Ana', password: 'x' }),
    ).rejects.toEqual(new DomainError('EMAIL_ALREADY_REGISTERED'));
  });

  it('lets any other save error through', async () => {
    const { Model } = aModel();
    const failure = new Error('disk full');
    Model.prototype.save = () => Promise.reject(failure);

    await expect(
      aService(Model).createLocalAccount({ email: 'a@example.test', name: 'Ana', password: 'x' }),
    ).rejects.toBe(failure);
  });
});

describe('UsersService.markEmailVerified and isEmailVerified', () => {
  it('confirms the address of the user', async () => {
    const { Model } = aModel();
    await aService(Model).markEmailVerified('u1');
    expect(Model.updateOne).toHaveBeenCalledWith(
      { _id: { $eq: 'u1' } },
      { $set: { emailVerified: true } },
    );
  });

  it('reports USER_NOT_FOUND when nobody matched', async () => {
    const { Model } = aModel({ updateOne: { matchedCount: 0 } });
    await expect(aService(Model).markEmailVerified('u1')).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });

  it('isEmailVerified is true for a verified user and false for an unverified or unknown one', async () => {
    const verified = aModel({ findById: { emailVerified: true } }).Model;
    const unverified = aModel({ findById: { emailVerified: false } }).Model;

    await expect(aService(verified).isEmailVerified('u1')).resolves.toBe(true);
    await expect(aService(unverified).isEmailVerified('u1')).resolves.toBe(false);
    await expect(aService(aModel().Model).isEmailVerified('u1')).resolves.toBe(false);
  });
});
