// SPEC-001 issue #1 "Key details", RNF-13: the schema walk, against a real MongoDB. Every path of
// UserSchema is tried through the services a request can reach; only the paths classified as
// editable may change. A new schema field fails src/users/profile-fields.spec.ts until it is
// classified, and then this test proves it cannot be written (BR-001-29, BR-001-31).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { UserEntity, UserSchema, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { UsersService } from '../../src/users/users.service.js';
import {
  BOOKKEEPING,
  EMAIL_READ_ONLY,
  HOSTILE_VALUES,
  LEGACY_UNUSED,
  PROFILE_EDITABLE,
  PROTECTED,
} from '../support/profile-fields.js';
import { useTestDatabase } from '../support/test-database.js';

type Raw = Record<string, unknown>;

describe('profile allowlist over the user schema (integration)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let service: UsersService;
  let users: Model<UserDocument>;
  let counter = 0;

  async function seed(): Promise<{ id: string; email: string }> {
    counter += 1;
    const email = `walk-${counter}@example.test`;
    const user = await service.createLocalAccount(
      {
        email,
        name: 'Ana Original',
        password: 'a password for the walk',
      },
      new Date(),
    );
    // Sign-up leaves the account `pending` until its consent records exist (SPEC-010 BR-010-01);
    // the walk is about an account that lives, so it is activated as the sign-up flow does.
    await service.activateAccount(user._id.toString());
    return { id: user._id.toString(), email };
  }

  const raw = async (id: string): Promise<Raw> =>
    (await users.collection.findOne({ _id: new users.base.Types.ObjectId(id) })) as Raw;

  /** The keys whose stored value differs (updatedAt aside, it moves with any real write). */
  function changedKeys(before: Raw, after: Raw): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    keys.delete('updatedAt');
    return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  }

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]),
      ],
      providers: [UsersService],
    }).compile();
    service = moduleRef.get(UsersService);
    users = moduleRef.get(getModelToken(UserEntity.name));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const NOT_PROFILE = [...EMAIL_READ_ONLY, ...LEGACY_UNUSED, ...PROTECTED];

  it.each(NOT_PROFILE)(
    'updateProfile cannot change %s, even when the input carries it',
    async (path) => {
      const { id } = await seed();
      const before = await raw(id);
      const hostile = { [path]: HOSTILE_VALUES[path] } as unknown as Parameters<
        UsersService['updateProfile']
      >[1];

      await service.updateProfile(id, hostile);
      expect(await raw(id)).toEqual(before); // nothing was written at all

      await service.updateProfile(id, { ...hostile, name: 'Ana Renomeada' });
      const after = await raw(id);
      expect(changedKeys(before, after)).toEqual(['name']);
      expect(after['name']).toBe('Ana Renomeada');
    },
  );

  it('updateProfile changes name and phone, and only those', async () => {
    const { id } = await seed();
    const before = await raw(id);

    await service.updateProfile(id, { name: 'Ana Nova', phone: '+5584999991234' });

    const after = await raw(id);
    expect(changedKeys(before, after).sort()).toEqual([...PROFILE_EDITABLE].sort());
    expect(after).toMatchObject({ name: 'Ana Nova', phone: '+5584999991234' });

    await service.updateProfile(id, { phone: null });
    expect(await raw(id)).not.toHaveProperty('phone');
  });

  // `update` is the server-flow write. Since SPEC-012 (BR-012-14) it writes the name and the phone
  // and nothing else: not the email (D-63), not the legacy details, not the admin capability
  // (SPEC-002 BR-002-21), not a credential, and no plan or subscription field (`role`,
  // `subscriptionStatus`, the Stripe ids), which follow the provider through the office's
  // subscription.
  it.each(NOT_PROFILE)('update (the server flow) cannot change %s either', async (path) => {
    const { id } = await seed();
    const before = await raw(id);
    const hostile = { [path]: HOSTILE_VALUES[path] } as unknown as Parameters<
      UsersService['update']
    >[1];

    await service.update(id, hostile);

    // an empty `$set` still moves updatedAt, which changedKeys leaves out
    expect(changedKeys(before, await raw(id))).toEqual([]);
  });

  it.each(LEGACY_UNUSED)(
    'stored %s survives every write path untouched and is never returned by them',
    async (path) => {
      const { id } = await seed();
      await users.collection.updateOne(
        { _id: new users.base.Types.ObjectId(id) },
        { $set: { [path]: HOSTILE_VALUES[path] } },
      );
      const before = await raw(id);

      await service.updateProfile(id, { name: 'Ana Nova', phone: '+5584999991234' });
      await service.update(id, { name: 'Ana Servidor' });

      const after = await raw(id);
      expect(after[path]).toEqual(before[path]);
      expect(changedKeys(before, after).sort()).toEqual(['name', 'phone']);
    },
  );

  it('the walk covers every non-bookkeeping schema path', () => {
    const covered: string[] = [...PROFILE_EDITABLE, ...NOT_PROFILE, ...BOOKKEEPING];
    expect(Object.keys(UserSchema.paths).filter((path) => !covered.includes(path))).toEqual([]);
  });
});
