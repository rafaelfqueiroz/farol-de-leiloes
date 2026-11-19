// SPEC-002 DL-002-05 (part 1 security review): `npm run grant-admin`'s command over the real
// UsersService and a real MongoDB (Testcontainers, TESTING §2), with the production query defaults
// (SC-10). The access sources are the AccessModule defaults bound the way the script binds them;
// relationships are fakes (TS-03). Proves the refusals of an unconfirmed or inactive account (SC-09),
// that the grant write itself is conditional (TOCTOU), and that a revoke resets the legacy
// `role: 'admin'` so a re-run of migration 0004 cannot re-grant it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { AccessModule } from '../../src/access/access.module.js';
import { GrantAdminCommand } from '../../src/access/grant-admin/grant-admin.command.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { copyAdminRoleToFlag } from '../../src/migrations/0004-admin-capability.migration.js';
import { UserEntity, UserSchema, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { UsersService } from '../../src/users/users.service.js';
import { useTestDatabase } from '../support/test-database.js';
import { testEnv } from '../support/test-env.js';

describe('grant-admin (integration, SPEC-002 DL-002-05)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let command: GrantAdminCommand;
  let service: UsersService;
  let users: Model<UserDocument>;
  let counter = 0;

  async function seed(fields: Record<string, unknown>): Promise<{ id: string; email: string }> {
    counter += 1;
    const email = `grant-${counter}@example.test`;
    const { insertedId } = await users.collection.insertOne({
      email,
      name: 'Ana Teste',
      providers: ['local'],
      role: 'free',
      ...fields,
    });
    return { id: insertedId.toHexString(), email };
  }

  const stored = (email: string) => users.collection.findOne({ email });

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        // The shape of GrantAdminModule (src/access/grant-admin/grant-admin.module.ts): the
        // validated configuration and the connection, UsersModule's models and AccessModule. Since
        // SPEC-012 AccessModule loads the subscriptions module (the real OFFICE_PLAN_SOURCE),
        // which needs both, so this also proves it resolves in the script's context.
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: () => testEnv() }),
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]),
        AccessModule,
      ],
      providers: [UsersService, GrantAdminCommand],
    }).compile();
    command = moduleRef.get(GrantAdminCommand);
    service = moduleRef.get(UsersService);
    users = moduleRef.get(getModelToken(UserEntity.name));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('grants a confirmed, active account (a document without a status is active, AR-28)', async () => {
    const { email } = await seed({ emailVerified: true });

    await expect(command.run(email, 'grant')).resolves.toBe('granted');

    expect(await stored(email)).toMatchObject({ isAdmin: true });
  });

  it.each([
    ['refused_unconfirmed_email', { emailVerified: false }],
    ['refused_unconfirmed_email', {}],
    ['refused_inactive', { emailVerified: true, status: 'deactivated' }],
    ['refused_inactive', { emailVerified: true, status: 'closed' }],
  ])('SC-09: answers %s for %j and writes nothing', async (outcome, fields) => {
    const { email } = await seed(fields);

    await expect(command.run(email, 'grant')).resolves.toBe(outcome);

    expect((await stored(email))?.isAdmin).toBeUndefined();
  });

  it('TOCTOU: the grant write matches nothing when the account changed after it was read', async () => {
    const unconfirmed = await seed({ emailVerified: false });
    const deactivated = await seed({ emailVerified: true, status: 'deactivated' });
    const alreadyAdmin = await seed({ emailVerified: true, isAdmin: true });

    for (const { id, email } of [unconfirmed, deactivated, alreadyAdmin]) {
      const before = await stored(email);
      await expect(service.setAdminCapability(id, true)).resolves.toBe(false);
      expect(await stored(email)).toEqual(before);
    }
  });

  it("revokes and resets the legacy role 'admin', so a re-run of migration 0004 cannot re-grant", async () => {
    const { email } = await seed({ emailVerified: true, role: 'admin', isAdmin: true });

    await expect(command.run(email, 'revoke')).resolves.toBe('revoked');
    expect(await stored(email)).toMatchObject({ isAdmin: false, role: 'free' });

    if (!users.db.db) throw new Error('connection has no db');
    await copyAdminRoleToFlag(users.db.db);
    expect(await stored(email)).toMatchObject({ isAdmin: false, role: 'free' });
  });

  it("revokes an account holding only the legacy role 'admin' (the migration has not run)", async () => {
    const { email } = await seed({ emailVerified: true, role: 'admin' });

    await expect(command.run(email, 'revoke')).resolves.toBe('revoked');
    expect(await stored(email)).toMatchObject({ isAdmin: false, role: 'free' });
  });

  it('revokes without touching a plan tier', async () => {
    const { email } = await seed({ emailVerified: true, role: 'premium', isAdmin: true });

    await expect(command.run(email, 'revoke')).resolves.toBe('revoked');
    expect(await stored(email)).toMatchObject({ isAdmin: false, role: 'premium' });
  });
});
