// SPEC-004 BR-004-29: `UsersService.findAdminEmails` answers exactly the accounts an import alert
// may go to: the admin capability, a confirmed email and an active account (the same bar as
// AdminGuard, SC-09). Each excluded kind has its own row, so dropping any of the three conditions
// fails here. Real MongoDB under the production query setting (SC-10); fake addresses (TS-27).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { UserEntity, UserSchema, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { UsersService } from '../../src/users/users.service.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { useTestDatabase } from '../support/test-database.js';

interface Row {
  email: string;
  isAdmin?: boolean;
  emailVerified?: boolean;
  status?: string | null;
}

describe('UsersService.findAdminEmails (integration, SPEC-004 BR-004-29)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let model: Model<UserDocument>;
  let service: UsersService;

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]),
      ],
      providers: [UsersService],
    }).compile();
    model = moduleRef.get(getModelToken(UserEntity.name));
    service = moduleRef.get(UsersService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  const insert = (rows: Row[]) =>
    model.collection.insertMany(rows.map((row) => ({ name: 'Admin Teste', ...row })));

  it('answers the addresses of active, confirmed admins, and only those', async () => {
    await insert([
      { email: 'ativo@example.test', isAdmin: true, emailVerified: true, status: 'active' },
      // A missing status is active (AR-28): accounts older than the status field.
      { email: 'antigo@example.test', isAdmin: true, emailVerified: true },
      { email: 'nulo@example.test', isAdmin: true, emailVerified: true, status: null },
      { email: 'comum@example.test', isAdmin: false, emailVerified: true, status: 'active' },
      { email: 'semflag@example.test', emailVerified: true, status: 'active' },
      {
        email: 'naoconfirmado@example.test',
        isAdmin: true,
        emailVerified: false,
        status: 'active',
      },
      { email: 'semconfirmacao@example.test', isAdmin: true, status: 'active' },
      { email: 'encerrado@example.test', isAdmin: true, emailVerified: true, status: 'closed' },
      {
        email: 'desativado@example.test',
        isAdmin: true,
        emailVerified: true,
        status: 'deactivated',
      },
      { email: 'pendente@example.test', isAdmin: true, emailVerified: true, status: 'pending' },
    ]);

    const emails = await service.findAdminEmails();

    expect(emails.sort()).toEqual([
      'antigo@example.test',
      'ativo@example.test',
      'nulo@example.test',
    ]);
  });

  it('answers nothing when there is no admin', async () => {
    await insert([{ email: 'comum@example.test', isAdmin: false, emailVerified: true }]);

    expect(await service.findAdminEmails()).toEqual([]);
  });
});
