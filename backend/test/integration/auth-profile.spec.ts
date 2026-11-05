// AR-09 / SC-01: public auth profiles detach real hydrated account values and omit credentials.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { AuthService } from '../../src/auth/auth.service';
import { UserEntity, UserSchema, type UserDocument } from '../../src/users/schemas/user.schema';
import { useTestDatabase } from '../support/test-database';

type AuthDeps = ConstructorParameters<typeof AuthService>;
const CREATED = new Date('2026-01-01T12:00:00.000Z');
const UPDATED = new Date('2026-01-02T12:00:00.000Z');
const BIRTH_DATE = new Date('1990-01-01T00:00:00.000Z');

describe('AuthService hydrated account profiles (integration)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let users: Model<UserDocument>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]),
      ],
    }).compile();
    users = moduleRef.get(getModelToken(UserEntity.name));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('returns plain nested values with mutation independence in both directions', async () => {
    const saved = await users.create({
      email: 'profile-detachment@example.test',
      name: 'Profile Test Account',
      providers: ['local', 'google'],
      address: { street: 'Test Street', city: 'Test City', state: 'SP', zipCode: '00000000' },
      password: 'fake-password-hash',
      resetPasswordToken: 'fake-reset-token',
      emailVerificationToken: 'fake-verification-token',
      dateOfBirth: BIRTH_DATE,
      createdAt: CREATED,
    });
    // Mongoose initializes both timestamps to createdAt on insert; seed a distinct later update.
    await users
      .updateOne({ _id: saved._id }, { $set: { updatedAt: UPDATED } }, { timestamps: false })
      .exec();
    const user = await users.findById(saved._id).orFail().exec();
    expect(user.createdAt.toISOString()).toBe('2026-01-01T12:00:00.000Z');
    expect(user.updatedAt.toISOString()).toBe('2026-01-02T12:00:00.000Z');
    const service = new AuthService(
      {} as AuthDeps[0],
      { sign: () => 'signed-token' } as unknown as AuthDeps[1],
      {} as AuthDeps[2],
    );

    const { user: profile } = await service.googleLogin(user);

    expect(profile._id).toBe(saved._id.toHexString());
    expect(Object.getPrototypeOf(profile)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(profile.providers)).toBe(Array.prototype);
    expect(Object.getPrototypeOf(profile.address)).toBe(Object.prototype);
    expect(profile.providers).toEqual(['local', 'google']);
    expect(profile.address).toEqual({
      street: 'Test Street',
      city: 'Test City',
      state: 'SP',
      zipCode: '00000000',
    });
    expect(profile.providers).not.toBe(user.providers);
    expect(profile.address).not.toBe(user.address);
    expect(profile.dateOfBirth).not.toBe(user.dateOfBirth);
    expect(profile.createdAt).not.toBe(user.createdAt);
    expect(profile.updatedAt).not.toBe(user.updatedAt);
    for (const privateField of [
      'password',
      'resetPasswordToken',
      'emailVerificationToken',
      '$__',
    ]) {
      expect(profile).not.toHaveProperty(privateField);
    }

    if (!user.address || !profile.address || !user.dateOfBirth || !profile.dateOfBirth) {
      throw new Error('The test account must have an address and birth date');
    }
    profile.providers.push('profile-only');
    profile.address.city = 'Profile City';
    profile.dateOfBirth.setUTCFullYear(1991);
    profile.createdAt.setUTCFullYear(2027);
    expect(Array.from(user.providers)).toEqual(['local', 'google']);
    expect(user.address.city).toBe('Test City');
    expect(user.dateOfBirth.toISOString()).toBe('1990-01-01T00:00:00.000Z');
    expect(user.createdAt.toISOString()).toBe('2026-01-01T12:00:00.000Z');

    user.providers.push('document-only');
    user.address.state = 'RJ';
    user.updatedAt.setUTCFullYear(2028);
    expect(profile.providers).toEqual(['local', 'google', 'profile-only']);
    expect(profile.address.state).toBe('SP');
    expect(profile.updatedAt.toISOString()).toBe('2026-01-02T12:00:00.000Z');
  });
});
