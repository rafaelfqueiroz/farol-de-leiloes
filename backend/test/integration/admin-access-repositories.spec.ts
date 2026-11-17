// SPEC-002 BR-002-24..BR-002-27 / AR-30 / TS-02: the admin-access repositories and schemas against
// a real MongoDB. One open grant per support request (the partial unique index), the end
// transition happening once, a grant found only with its own admin; and the admin access log
// accepting inserts and refusing every update, replace, delete and bulk write, even through the
// model (its middleware), the repository exposing none.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Model, Types } from 'mongoose';
import { AdminAccessLogRepository } from '../../src/admin-access/admin-access-log.repository.js';
import {
  type AdminAccessLogDocument,
  AdminAccessLogEntity,
  AdminAccessLogSchema,
} from '../../src/admin-access/schemas/admin-access-log.schema.js';
import {
  type SupportAccessGrantDocument,
  SupportAccessGrantEntity,
  SupportAccessGrantSchema,
} from '../../src/admin-access/schemas/support-access-grant.schema.js';
import { SupportAccessGrantRepository } from '../../src/admin-access/support-access-grant.repository.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { useTestDatabase } from '../support/test-database.js';

const ADMIN = '64b7f0000000000000000a01';
const OTHER_ADMIN = '64b7f0000000000000000a02';
const REQUESTER = '64b7f0000000000000000b01';
const OFFICE = '64b7f0000000000000000d01';
const RECORD = '64b7f0000000000000000f01';
const OPENED = new Date('2026-05-04T10:00:00.000Z');
const EXPIRES = new Date('2026-05-11T10:00:00.000Z');

const newId = () => new Types.ObjectId().toHexString();

describe('admin-access repositories (integration, SPEC-002 BR-002-24..BR-002-27)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let grants: SupportAccessGrantRepository;
  let logs: AdminAccessLogRepository;
  let grantModel: Model<SupportAccessGrantDocument>;
  let logModel: Model<AdminAccessLogDocument>;

  const grantFor = (supportRequestId: string, adminUserId = ADMIN) =>
    grants.insertOpen({
      supportRequestId,
      adminUserId,
      requesterUserId: REQUESTER,
      openedAt: OPENED,
      expiresAt: EXPIRES,
    });

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([
          { name: SupportAccessGrantEntity.name, schema: SupportAccessGrantSchema },
          { name: AdminAccessLogEntity.name, schema: AdminAccessLogSchema },
        ]),
      ],
      providers: [SupportAccessGrantRepository, AdminAccessLogRepository],
    }).compile();
    grants = moduleRef.get(SupportAccessGrantRepository);
    logs = moduleRef.get(AdminAccessLogRepository);
    grantModel = moduleRef.get(getModelToken(SupportAccessGrantEntity.name));
    logModel = moduleRef.get(getModelToken(AdminAccessLogEntity.name));
    await grantModel.syncIndexes(); // the one-open-grant-per-request index
    await logModel.syncIndexes();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('SupportAccessGrantRepository', () => {
    it('BR-002-24: one open grant per request — concurrent inserts give one grant, the rest null', async () => {
      const supportRequestId = newId();

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          grantFor(supportRequestId, i % 2 ? ADMIN : OTHER_ADMIN),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await grantModel.countDocuments({ supportRequestId })).toBe(1);
    });

    it('stores the grant open, and finds it only with its own admin', async () => {
      const grant = await grantFor(newId());
      if (!grant) throw new Error('not inserted');

      expect(grant).toMatchObject({
        adminUserId: ADMIN,
        requesterUserId: REQUESTER,
        openedAt: OPENED,
        expiresAt: EXPIRES,
        status: 'open',
      });
      expect(await grants.findForAdmin(grant.id, ADMIN)).toEqual(grant);
      expect(await grants.findForAdmin(grant.id, OTHER_ADMIN)).toBeNull();
      expect(await grants.findForAdmin('not-an-id', ADMIN)).toBeNull();
      expect(await grants.findForAdmin(grant.id, 'not-an-id')).toBeNull();
      expect(await grants.findOpenForSupportRequest(grant.supportRequestId)).toEqual(grant);
      expect(await grants.findOpenForSupportRequest('not-an-id')).toBeNull();
    });

    it('BR-002-26: ends a grant once (first reason kept), and an ended grant frees the request', async () => {
      const supportRequestId = newId();
      const grant = await grantFor(supportRequestId);
      if (!grant) throw new Error('not inserted');
      const endedAt = new Date('2026-05-05T10:00:00.000Z');

      expect(await grants.endIfOpen(grant.id, endedAt, 'withdrawn')).toBe(true);
      expect(await grants.endIfOpen(grant.id, new Date(), 'expired')).toBe(false);
      expect(await grants.endIfOpen('not-an-id', endedAt, 'closed')).toBe(false);
      expect(await grants.findForAdmin(grant.id, ADMIN)).toMatchObject({
        status: 'ended',
        endedAt,
        endReason: 'withdrawn',
      });
      expect(await grants.findOpenForSupportRequest(supportRequestId)).toBeNull();

      const next = await grantFor(supportRequestId, OTHER_ADMIN);
      expect(next?.id).not.toBe(grant.id);
      expect(await grants.endOpenForSupportRequest(supportRequestId, endedAt, 'closed')).toBe(true);
      expect(await grants.endOpenForSupportRequest(supportRequestId, endedAt, 'closed')).toBe(
        false,
      );
      expect(await grants.endOpenForSupportRequest('not-an-id', endedAt, 'closed')).toBe(false);
    });
  });

  describe('AdminAccessLogRepository (BR-002-27, AR-30)', () => {
    const entry = (overrides = {}) => ({
      adminUserId: ADMIN,
      action: 'grant_read' as const,
      grantId: newId(),
      supportRequestId: newId(),
      owner: { type: 'office' as const, id: OFFICE },
      resource: { type: 'probe', id: RECORD },
      at: OPENED,
      ...overrides,
    });

    it('appends entries with every field, and an empty batch writes nothing', async () => {
      const first = entry();
      await logs.append([first, entry({ resource: { type: 'probe', id: newId() } })]);
      await logs.append([]);
      await logs.append([{ adminUserId: ADMIN, action: 'account_view', at: OPENED }]);

      const stored = await logModel.find({ grantId: first.grantId }).lean().exec();
      expect(stored).toEqual([
        expect.objectContaining({
          adminUserId: new Types.ObjectId(ADMIN),
          action: 'grant_read',
          supportRequestId: new Types.ObjectId(first.supportRequestId),
          owner: { type: 'office', id: new Types.ObjectId(OFFICE) },
          resource: { type: 'probe', id: new Types.ObjectId(RECORD) },
          at: OPENED,
        }),
      ]);
      expect(await logModel.countDocuments({ adminUserId: ADMIN })).toBe(3);
    });

    it('rejects an entry the schema refuses (the caller then refuses the read)', async () => {
      await expect(
        logs.append([entry({ action: 'something_else' as unknown as 'grant_read' })]),
      ).rejects.toThrow();
    });

    it('refuses every update, replace, delete and bulk write through the model', async () => {
      await logs.append([entry()]);
      const [stored] = await logModel.find().limit(1).exec();
      if (!stored) throw new Error('nothing stored');
      const count = await logModel.countDocuments();
      const filter = { _id: stored._id };
      const change = { $set: { action: 'account_view' } };

      for (const attempt of [
        () => logModel.updateOne(filter, change).exec(),
        () => logModel.updateMany({}, change).exec(),
        () => logModel.findOneAndUpdate(filter, change).exec(),
        () =>
          logModel
            .findOneAndReplace(filter, { adminUserId: ADMIN, action: 'x', at: OPENED })
            .exec(),
        () => logModel.replaceOne(filter, { adminUserId: ADMIN, action: 'x', at: OPENED }).exec(),
        () => logModel.findOneAndDelete(filter).exec(),
        () => logModel.deleteOne(filter).exec(),
        () => logModel.deleteMany({}).exec(),
        () => logModel.bulkWrite([{ deleteOne: { filter } }]),
        () => {
          stored.set('action', 'account_view');
          return stored.save();
        },
      ]) {
        await expect(attempt()).rejects.toThrow('append-only');
      }
      expect(await logModel.countDocuments()).toBe(count);
      expect(await logModel.findById(stored._id).lean().exec()).toMatchObject({
        action: 'grant_read',
      });
    });
  });
});
