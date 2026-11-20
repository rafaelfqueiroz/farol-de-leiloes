import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { DomainError } from '../common/errors/domain-error.js';
import { UsersService } from './users.service.js';
import { FakeQuery } from '../../test/fakes/fake-query.js';

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

/** Drops the symbol `serverOperators` marks an operator object with, so a spec can compare it. */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function aService(model: unknown) {
  return new UsersService(model as Deps[0]);
}

beforeEach(() => {
  vi.mocked(bcrypt.hash).mockClear();
  vi.mocked(bcrypt.compare).mockClear();
});

describe('UsersService.createGoogleAccount', () => {
  it('BR-001-09, BR-001-03, BR-001-31: a confirmed Google-only account with exactly these fields', async () => {
    const { Model, created } = aModel();

    await aService(Model).createGoogleAccount({
      googleId: 'g-1',
      email: ' Ana@Example.test ',
      name: ' Ana ',
    });

    // No password, no role, no plan, no status: the schema defaults make it a free searcher.
    expect(created).toEqual([
      {
        email: 'ana@example.test',
        name: 'Ana',
        googleId: 'g-1',
        providers: ['google'],
        emailVerified: true,
      },
    ]);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('BR-001-01: refuses an e-mail that is already registered, without saving', async () => {
    const { Model, created } = aModel({ findOne: { _id: 'u1' } });

    await expect(
      aService(Model).createGoogleAccount({
        googleId: 'g-1',
        email: 'Ana@Example.test',
        name: 'Ana',
      }),
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

const NOW = new Date('2026-06-01T12:00:00.000Z');

describe('UsersService.linkGoogleIdentity (BR-001-10, BR-001-11, BR-001-16)', () => {
  /** Queues what the update returns (the account as it was), then the account read after it. */
  function link(before: unknown, after: unknown = { _id: 'u1' }) {
    const { Model } = aModel();
    Model.findOneAndUpdate.mockReturnValueOnce(new FakeQuery(before));
    Model.findById.mockReturnValue(new FakeQuery(after));
    return { Model, service: aService(Model) };
  }

  it('writes one conditional pipeline update keyed by the account, active status and free identity', async () => {
    const { Model, service } = link({ emailVerified: true });

    await service.linkGoogleIdentity('u1', 'g-1', NOW);

    expect(Model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = Model.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      unknown[],
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({
      _id: { $eq: 'u1' },
      $or: [{ googleId: null }, { googleId: { $eq: 'g-1' } }],
    });
    expect(Array.isArray(update)).toBe(true);
    expect(options).toMatchObject({ returnDocument: 'before', updatePipeline: true });
  });

  it('SPEC-010 DL-001-02: the same update moves consentResetAt to the Clock instant and clears the WhatsApp answer, only for an unconfirmed account', async () => {
    const { Model, service } = link({ emailVerified: false });

    await service.linkGoogleIdentity('u1', 'g-1', NOW);

    const [, pipeline] = Model.findOneAndUpdate.mock.calls[0] as [
      unknown,
      [{ $set: Record<string, unknown> }],
    ];
    expect(pipeline).toHaveLength(1); // one atomic stage: nothing can fall between the writes
    const set = pipeline[0].$set;
    const confirmed = { $eq: ['$emailVerified', true] };
    expect(set['consentResetAt']).toEqual({
      $cond: [confirmed, '$consentResetAt', { $literal: NOW }],
    });
    expect(set['whatsappPromptAnsweredAt']).toEqual({
      $cond: [confirmed, '$whatsappPromptAnsweredAt', '$$REMOVE'],
    });
    // The takeover's other effects are in the very same stage (DL-001-02 atomicity).
    expect(Object.keys(set)).toEqual(
      expect.arrayContaining(['credentialVersion', 'password', 'providers', 'emailVerified']),
    );
  });

  it('a confirmed account is linked and the password stays (linked_confirmed)', async () => {
    const { service } = link(
      { emailVerified: true },
      { _id: 'u1', providers: ['local', 'google'] },
    );

    await expect(service.linkGoogleIdentity('u1', 'g-1', NOW)).resolves.toEqual({
      result: 'linked_confirmed',
      account: { _id: 'u1', providers: ['local', 'google'] },
    });
  });

  it.each([{ emailVerified: false }, {}])(
    'an account whose email was not confirmed (%j) is taken over (linked_unconfirmed)',
    async (before) => {
      const { service } = link(before);

      await expect(service.linkGoogleIdentity('u1', 'g-1', NOW)).resolves.toMatchObject({
        result: 'linked_unconfirmed',
      });
    },
  );

  it.each([
    ['is deactivated', { status: 'deactivated' }, 'inactive'],
    ['is closed', { status: 'closed' }, 'inactive'],
    ['is linked to another Google identity', { googleId: 'g-other' }, 'google_conflict'],
  ])('refuses without writing when the account %s', async (_label, current, result) => {
    const { Model } = aModel({ findOne: current });
    Model.findOneAndUpdate.mockReturnValue(new FakeQuery(null));

    await expect(aService(Model).linkGoogleIdentity('u1', 'g-1', NOW)).resolves.toEqual({ result });
    expect(Model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('answers not_found when the account is gone', async () => {
    const { Model } = aModel();
    Model.findOneAndUpdate.mockReturnValue(new FakeQuery(null));

    await expect(aService(Model).linkGoogleIdentity('u1', 'g-1', NOW)).resolves.toEqual({
      result: 'not_found',
    });
  });

  it('tries once more when the account became linkable between the update and the explanation', async () => {
    const { Model } = aModel({ findOne: { status: 'active' } });
    Model.findOneAndUpdate
      .mockReturnValueOnce(new FakeQuery(null))
      .mockReturnValueOnce(new FakeQuery({ emailVerified: true }));
    Model.findById.mockReturnValue(new FakeQuery({ _id: 'u1' }));

    await expect(aService(Model).linkGoogleIdentity('u1', 'g-1', NOW)).resolves.toMatchObject({
      result: 'linked_confirmed',
    });
    expect(Model.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('gives up as a conflict when the account keeps slipping away', async () => {
    const { Model } = aModel({ findOne: { status: 'active' } });
    Model.findOneAndUpdate.mockReturnValue(new FakeQuery(null));

    await expect(aService(Model).linkGoogleIdentity('u1', 'g-1', NOW)).resolves.toEqual({
      result: 'google_conflict',
    });
  });

  it('BR-001-11: the unique index makes an identity taken by another account a conflict', async () => {
    const { Model } = aModel();
    Model.findOneAndUpdate.mockReturnValue(
      new FakeQuery(Object.assign(new Error('dup'), { code: 11000 })),
    );

    await expect(aService(Model).linkGoogleIdentity('u1', 'g-1', NOW)).resolves.toEqual({
      result: 'google_conflict',
    });
  });

  it('rethrows any other database failure', async () => {
    const { Model } = aModel();
    Model.findOneAndUpdate.mockReturnValue(new FakeQuery(new Error('network')));

    await expect(aService(Model).linkGoogleIdentity('u1', 'g-1', NOW)).rejects.toThrow('network');
  });

  it('answers not_found when the account disappears after the update', async () => {
    const { service } = link({ emailVerified: true }, null);

    await expect(service.linkGoogleIdentity('u1', 'g-1', NOW)).resolves.toEqual({
      result: 'not_found',
    });
  });
});

describe('UsersService.setPassword and changePassword', () => {
  it('DL-001-02: setPassword by recovery stores a hashed password, adds the local provider and bumps the credential version in the same write', async () => {
    const query = new FakeQuery({ _id: 'u1' });
    const { Model } = aModel();
    Model.findOneAndUpdate.mockReturnValue(query);

    await aService(Model).setPassword('u1', 'newsecret');

    const [filter, update, options] = plain(Model.findOneAndUpdate.mock.calls[0]) as unknown[];
    // Unfenced on the version (a spent recovery token is the authority), but only an ACTIVE account's
    // credentials are ever rewritten (SPEC-010 BR-010-14).
    expect(filter).toEqual({ _id: { $eq: 'u1' }, status: { $in: ['active', null] } });
    expect([update, options]).toEqual([
      {
        $set: { password: 'hashed:newsecret' },
        $inc: { credentialVersion: 1 },
        $addToSet: { providers: 'local' },
      },
      { returnDocument: 'after' },
    ]);
    expect(query.calls['select']).toEqual([['-password']]);
  });

  it.each([
    [0, [0, null]], // an account without the field is at 0
    [3, [3]],
  ])('DL-001-02: setPassword fenced on version %i matches %j', async (expected, accepted) => {
    const { Model } = aModel();
    Model.findOneAndUpdate.mockReturnValue(new FakeQuery({ _id: 'u1' }));

    await aService(Model).setPassword('u1', 'newsecret', expected);

    const filter = plain(Model.findOneAndUpdate.mock.calls[0]?.[0]) as Record<string, unknown>;
    expect(filter['_id']).toEqual({ $eq: 'u1' });
    expect(filter['credentialVersion']).toEqual({ $in: accepted });
  });

  it('BR-001-28, DL-001-02: changePassword is fenced on the version and on the local provider, and bumps the version', async () => {
    const { Model } = aModel();
    Model.findOneAndUpdate.mockReturnValue(new FakeQuery({ _id: 'u1' }));

    await aService(Model).changePassword('u1', 'newsecret', 2);

    const [filter, update, options] = plain(Model.findOneAndUpdate.mock.calls[0]) as unknown[];
    expect(filter).toEqual({
      _id: { $eq: 'u1' },
      status: { $in: ['active', null] },
      credentialVersion: { $in: [2] },
      providers: { $eq: 'local' },
    });
    expect(update).toEqual({
      $set: { password: 'hashed:newsecret' },
      $inc: { credentialVersion: 1 },
    });
    expect(options).toEqual({ returnDocument: 'after' });
  });

  it('DL-001-02: a fenced write that matches nothing is UNAUTHENTICATED, an unfenced one USER_NOT_FOUND', async () => {
    const { Model } = aModel();
    const service = aService(Model);

    await expect(service.setPassword('u1', 'newsecret')).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
    await expect(service.setPassword('u1', 'newsecret', 0)).rejects.toEqual(
      new DomainError('UNAUTHENTICATED'),
    );
    await expect(service.changePassword('u1', 'newsecret', 0)).rejects.toEqual(
      new DomainError('UNAUTHENTICATED'),
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
  it('BR-001-24, DL-001-02: the lookup requires the local provider and a stored hash', async () => {
    const { Model } = aModel();

    await aService(Model).validatePassword(' A@Example.test ', 'x');

    // An account that lost `local`, or has no hash, is not found: as unknown as a missing email.
    expect(plain(Model.findOne.mock.calls[0]?.[0])).toEqual({
      email: { $eq: 'a@example.test' },
      providers: { $eq: 'local' },
      password: { $type: 'string' },
    });
  });

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

describe('UsersService.confirmEmail and isEmailVerified', () => {
  it('confirms the address only while it is still the account email (matched in the update)', async () => {
    const { Model } = aModel();
    await expect(aService(Model).confirmEmail('u1', ' Ana@Example.TEST ')).resolves.toBe(true);
    expect(Model.updateOne).toHaveBeenCalledWith(
      { _id: { $eq: 'u1' }, email: { $eq: 'ana@example.test' } },
      { $set: { emailVerified: true } },
    );
  });

  it('answers false when no account has that id and email any more', async () => {
    const { Model } = aModel({ updateOne: { matchedCount: 0 } });
    await expect(aService(Model).confirmEmail('u1', 'ana@example.test')).resolves.toBe(false);
  });

  it('isEmailVerified is true for a verified user and false for an unverified or unknown one', async () => {
    const verified = aModel({ findById: { emailVerified: true } }).Model;
    const unverified = aModel({ findById: { emailVerified: false } }).Model;

    await expect(aService(verified).isEmailVerified('u1')).resolves.toBe(true);
    await expect(aService(unverified).isEmailVerified('u1')).resolves.toBe(false);
    await expect(aService(aModel().Model).isEmailVerified('u1')).resolves.toBe(false);
  });
});

describe('UsersService.markWhatsappPromptAnswered (SPEC-010 BR-010-27, DL-001-02)', () => {
  it('sets the flag once, and only under the consent generation the answer was given under', async () => {
    const { Model } = aModel();
    const reset = new Date('2026-06-02T09:00:00.000Z');

    await aService(Model).markWhatsappPromptAnswered('u1', NOW, reset);

    const [filter, update] = Model.updateOne.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(filter).toMatchObject({
      _id: { $eq: 'u1' },
      consentResetAt: { $eq: reset },
    });
    expect(Object.keys(filter['whatsappPromptAnsweredAt'] as object)).toEqual(['$exists']);
    expect(update).toEqual({ $set: { whatsappPromptAnsweredAt: NOW } });
  });

  it('a never-reset account is matched by a null generation', async () => {
    const { Model } = aModel();

    await aService(Model).markWhatsappPromptAnswered('u1', NOW, null);

    expect(Model.updateOne.mock.calls[0]?.[0]).toMatchObject({ consentResetAt: { $eq: null } });
  });
});

describe('UsersService.discardUnfinishedSignup (SPEC-010 BR-010-01)', () => {
  it('deletes only an account still at credential version 0, and says whether it did', async () => {
    const { Model } = aModel();

    await expect(aService(Model).discardUnfinishedSignup('u1')).resolves.toBe(true);

    const [filter] = Model.deleteOne.mock.calls[0] as [Record<string, unknown>];
    expect(filter['_id']).toEqual({ $eq: 'u1' });
    // An account that was taken over or had its password changed (version above 0) is never deleted.
    expect(Object.keys(filter['credentialVersion'] as object)).toEqual(['$in']);
  });

  it('answers false when nothing matched (the account moved on, DL-001-02)', async () => {
    const { Model } = aModel({ deleteOne: { deletedCount: 0 } });
    await expect(aService(Model).discardUnfinishedSignup('u1')).resolves.toBe(false);
  });
});

describe('SPEC-010 BR-010-15: no account under the reserved .invalid domain', () => {
  it.each(['purged-64b7f00000000000000ffff1@removed.invalid', 'x@Removed.INVALID', 'x@a.invalid.'])(
    'createLocalAccount and createGoogleAccount refuse %s, and nothing is looked up or stored',
    async (email) => {
      const { Model, created } = aModel();
      const service = aService(Model);

      await expect(
        service.createLocalAccount({ email, name: 'N', password: 'password-1234' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', context: { fields: ['email'] } });
      await expect(
        service.createGoogleAccount({ email, name: 'N', googleId: 'g-1' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', context: { fields: ['email'] } });

      expect(created).toEqual([]);
      expect(Model.findOne).not.toHaveBeenCalled();
    },
  );
});
