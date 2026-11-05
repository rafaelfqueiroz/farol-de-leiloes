// Integration: SC-10 against a real MongoDB (Testcontainers, TESTING §2). A request value never
// becomes a MongoDB operator: an operator object ({ $ne: null }, { $gt: '' }) sent where a
// string is expected matches nothing and leaks nothing, and the operators the server itself
// writes ($in, $gte, $lte, $exists ...) still work with sanitizeFilter on, as in production.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Model, Types } from 'mongoose';
import { AuctionsService } from '../../src/auctions/auctions.service';
import {
  AuctionEntity,
  AuctionSchema,
  PhaseModality,
} from '../../src/auctions/schemas/auction.schema';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety';
import { Clock } from '../../src/common/clock/clock';
import { Decimal } from '../../src/common/money/money';
import { FakeClock } from '../fakes/fake-clock';
import { FavoritesService } from '../../src/favorites/favorites.service';
import { FavoriteEntity, FavoriteSchema } from '../../src/favorites/schemas/favorite.schema';
import { RemindersService } from '../../src/reminders/reminders.service';
import {
  ReminderChannel,
  ReminderEntity,
  ReminderSchema,
  ReminderStatus,
} from '../../src/reminders/schemas/reminder.schema';
import {
  NotificationLog,
  NotificationLogSchema,
} from '../../src/reminders/schemas/notification-log.schema';
import { SavedFiltersService } from '../../src/saved-filters/saved-filters.service';
import {
  SavedFilterEntity,
  SavedFilterSchema,
} from '../../src/saved-filters/schemas/saved-filter.schema';
import { UserEntity, UserSchema } from '../../src/users/schemas/user.schema';
import { UsersService } from '../../src/users/users.service';
import { useTestDatabase } from '../support/test-database';
import { testConfigService } from '../support/test-env';

const USER_A = new Types.ObjectId('64b7f0000000000000000a01');
const USER_B = new Types.ObjectId('64b7f0000000000000000b01');
const FAR_FUTURE = new Date('2999-01-01T00:00:00.000Z');

// What a hostile client sends in place of a string. The services are typed `string`, so the
// operators arrive through a cast, as they would from an unvalidated body or query.
const NE_NULL = { $ne: null } as unknown as string;
const GT_EMPTY = { $gt: '' } as unknown as string;
const REGEX_ALL = { $regex: '.*' } as unknown as string;

function auction(code: string, overrides: Record<string, unknown> = {}) {
  const phase = {
    modality: PhaseModality.ONLINE_SALES,
    minimumPrice: Types.Decimal128.fromString('100000'),
  };
  return {
    code,
    available: true,
    phases: [phase],
    currentPhase: phase,
    address: { state: 'SP', city: 'Campinas', neighborhood: 'Centro' },
    updatedAt: FAR_FUTURE,
    ...overrides,
  };
}

describe('SC-10: Mongo operator injection (integration)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let auctions: AuctionsService;
  let favorites: FavoritesService;
  let savedFilters: SavedFiltersService;
  let users: UsersService;
  let reminders: RemindersService;

  beforeAll(async () => {
    // The same setting the AppModule applies before its first query.
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([
          { name: AuctionEntity.name, schema: AuctionSchema },
          { name: FavoriteEntity.name, schema: FavoriteSchema },
          { name: SavedFilterEntity.name, schema: SavedFilterSchema },
          { name: UserEntity.name, schema: UserSchema },
          { name: ReminderEntity.name, schema: ReminderSchema },
          { name: NotificationLog.name, schema: NotificationLogSchema },
        ]),
      ],
      providers: [
        AuctionsService,
        FavoritesService,
        SavedFiltersService,
        UsersService,
        RemindersService,
        { provide: Clock, useValue: new FakeClock() },
        { provide: CACHE_MANAGER, useValue: {} },
        { provide: ConfigService, useValue: testConfigService() },
      ],
    }).compile();
    auctions = moduleRef.get(AuctionsService);
    favorites = moduleRef.get(FavoritesService);
    savedFilters = moduleRef.get(SavedFiltersService);
    users = moduleRef.get(UsersService);
    reminders = moduleRef.get(RemindersService);

    const auctionModel = moduleRef.get<Model<AuctionEntity>>(getModelToken(AuctionEntity.name));
    // AR-17: prices are stored as Decimal128.
    const modality = (value: PhaseModality, minimumPrice: string) => {
      const phase = { modality: value, minimumPrice: Types.Decimal128.fromString(minimumPrice) };
      return { phases: [phase], currentPhase: phase };
    };
    await auctionModel.collection.insertMany([
      auction('A1', modality(PhaseModality.ONLINE_SALES, '100000')),
      auction('A2', {
        ...modality(PhaseModality.SFI_AUCTION, '250000.00'),
        address: { state: 'SP', city: 'Santos', neighborhood: 'Gonzaga' },
      }),
      auction('A3', {
        ...modality(PhaseModality.OPEN_BIDDING, '400000'),
        address: { state: 'RJ', city: 'Niteroi', neighborhood: 'Icarai' },
      }),
      auction('A4-unavailable', { available: false }),
    ]);

    const favoriteModel = moduleRef.get<Model<FavoriteEntity>>(getModelToken(FavoriteEntity.name));
    await favoriteModel.collection.insertMany([
      { userId: USER_A, auctionCode: 'A1', createdAt: FAR_FUTURE, updatedAt: FAR_FUTURE },
      { userId: USER_B, auctionCode: 'A2', createdAt: FAR_FUTURE, updatedAt: FAR_FUTURE },
    ]);

    const savedFilterModel = moduleRef.get<Model<SavedFilterEntity>>(
      getModelToken(SavedFilterEntity.name),
    );
    await savedFilterModel.collection.insertOne({
      userId: USER_B,
      name: 'Casas em SP',
      filters: {},
      createdAt: FAR_FUTURE,
      updatedAt: FAR_FUTURE,
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('AuctionsService', () => {
    it('findByCode finds nothing for an operator object, and the auction for its code', async () => {
      await expect(auctions.findByCode(NE_NULL)).resolves.toBeNull();
      await expect(auctions.findByCode(REGEX_ALL)).resolves.toBeNull();
      await expect(auctions.findByCode('A1')).resolves.toMatchObject({ code: 'A1' });
      await expect(auctions.findByCode('A4-unavailable')).resolves.toBeNull();
    });

    it('findDocumentByCode finds nothing for an operator object', async () => {
      await expect(auctions.findDocumentByCode(NE_NULL)).resolves.toBeNull();
      await expect(auctions.findDocumentByCode(GT_EMPTY)).resolves.toBeNull();
      await expect(auctions.findDocumentByCode('A1')).resolves.toMatchObject({ code: 'A1' });
    });

    it('findDocumentById accepts exact ids and rejects missing, invalid and operator ids', async () => {
      const auctionModel = moduleRef.get<Model<AuctionEntity>>(getModelToken(AuctionEntity.name));
      const id = new Types.ObjectId('64b7f0000000000000000d01');
      await auctionModel.collection.insertOne(auction('id-lookup', { _id: id, available: false }));

      // AR-09: the service owns the legacy reminder lookup, including unavailable auctions.
      await expect(auctions.findDocumentById(id.toString())).resolves.toMatchObject({
        code: 'id-lookup',
        available: false,
      });
      await expect(auctions.findDocumentById('64b7f0000000000000000d02')).resolves.toBeNull();
      await expect(auctions.findDocumentById('not-an-id')).resolves.toBeNull();
      await expect(auctions.findDocumentById('abcdefghijkl')).resolves.toBeNull();
      await expect(auctions.findDocumentById(NE_NULL)).resolves.toBeNull();
      await expect(auctions.findDocumentById(GT_EMPTY)).resolves.toBeNull();
    });

    it('query refuses an operator object in any filter, leaking no auction', async () => {
      const page = { page: 1, pageSize: 20 };
      const refused = { code: 'VALIDATION_FAILED' };

      await expect(auctions.query({ state: NE_NULL }, page)).rejects.toMatchObject(refused);
      await expect(auctions.query({ city: REGEX_ALL }, page)).rejects.toMatchObject(refused);
      await expect(auctions.query({ city: ['Campinas', NE_NULL] }, page)).rejects.toMatchObject(
        refused,
      );
      await expect(auctions.query({ neighborhood: GT_EMPTY }, page)).rejects.toMatchObject(refused);
      await expect(auctions.query({ modality: NE_NULL }, page)).rejects.toMatchObject(refused);
      await expect(
        auctions.query({ minPrice: NE_NULL as unknown as Decimal }, page),
      ).rejects.toMatchObject(refused);
      await expect(
        auctions.query({ maxPrice: new Decimal(Number.NaN) }, page),
      ).rejects.toMatchObject(refused);
    });

    it('query keeps the server-built operators working with sanitizeFilter on', async () => {
      const codes = async (filters: Parameters<AuctionsService['query']>[0]) =>
        (await auctions.query(filters, { page: 1, pageSize: 20 })).items
          .map((item) => item.code)
          .sort();

      await expect(codes({})).resolves.toEqual(['A1', 'A2', 'A3']);
      await expect(codes({ state: 'sp' })).resolves.toEqual(['A1', 'A2']);
      await expect(codes({ city: 'camp' })).resolves.toEqual(['A1']);
      await expect(codes({ city: ['Campinas', 'Santos'] })).resolves.toEqual(['A1', 'A2']);
      await expect(codes({ neighborhood: ['Centro', 'Icarai'] })).resolves.toEqual(['A1', 'A3']);
      await expect(codes({ modality: PhaseModality.SFI_AUCTION })).resolves.toEqual(['A2']);
      await expect(
        codes({ modality: [PhaseModality.SFI_AUCTION, PhaseModality.OPEN_BIDDING] }),
      ).resolves.toEqual(['A2', 'A3']);
      const reais = (value: string) => new Decimal(value);
      await expect(
        codes({ minPrice: reais('200000'), maxPrice: reais('300000') }),
      ).resolves.toEqual(['A2']);
      await expect(codes({ minPrice: reais('300000') })).resolves.toEqual(['A3']);
      await expect(codes({ maxPrice: reais('100000') })).resolves.toEqual(['A1']);
      // Inclusive bounds, compared by value: 100000.00 equals a stored 100000.
      await expect(
        codes({ minPrice: reais('100000.00'), maxPrice: reais('250000') }),
      ).resolves.toEqual(['A1', 'A2']);
      await expect(codes({ minPrice: reais('250000.01') })).resolves.toEqual(['A3']);
    });

    it('treats a city with regex metacharacters as literal text', async () => {
      const page = await auctions.query({ city: '.*' }, { page: 1, pageSize: 20 });

      expect(page.total).toBe(0);
    });

    it('findAvailableByCodes and findActiveCodes keep their $in lookups', async () => {
      const found = await auctions.findAvailableByCodes(['A1', 'A2', 'A4-unavailable']);

      expect(found.map((item) => item.code).sort()).toEqual(['A1', 'A2']);
      await expect(auctions.findActiveCodes(['A1', 'A4-unavailable'])).resolves.toEqual(
        new Set(['A1']),
      );
    });

    it('markAvailable keeps its $in and $ne update filter', async () => {
      await expect(auctions.markAvailable(['A4-unavailable', 'A1'])).resolves.toBe(1);
    });
  });

  describe('FavoritesService.findOne', () => {
    it('matches an exact pair and never an operator object (AR-12)', async () => {
      await expect(favorites.findOne(USER_A.toString(), 'A1')).resolves.toMatchObject({
        auctionCode: 'A1',
      });
      await expect(favorites.findOne(USER_A.toString(), NE_NULL)).resolves.toBeNull();
      await expect(favorites.findOne(USER_A.toString(), REGEX_ALL)).resolves.toBeNull();
      await expect(favorites.findOne(NE_NULL, 'A1')).resolves.toBeNull();
      // Another user's favorite is not reachable by widening either value.
      await expect(favorites.findOne(USER_A.toString(), 'A2')).resolves.toBeNull();
    });
  });

  describe('SavedFiltersService', () => {
    it('does not read another user as a duplicate through an operator name (AR-12)', async () => {
      // A's name is an operator object: with sanitizeFilter it equals nothing, so the save goes
      // on instead of tripping over B's "Casas em SP". Mongoose then refuses the non-string name.
      await expect(savedFilters.create(USER_A.toString(), GT_EMPTY, {})).rejects.not.toMatchObject({
        code: 'SAVED_FILTER_NAME_TAKEN',
      });
    });

    it('counts and lists only the caller, and still detects a real duplicate', async () => {
      const own = await savedFilters.findPage(USER_B.toString(), { page: 1, pageSize: 20 });
      const other = await savedFilters.findPage(USER_A.toString(), { page: 1, pageSize: 20 });

      expect(own.total).toBe(1);
      expect(other.total).toBe(0);
      await expect(savedFilters.create(USER_B.toString(), 'Casas em SP', {})).rejects.toMatchObject(
        { code: 'SAVED_FILTER_NAME_TAKEN' },
      );
    });
  });

  describe('RemindersService', () => {
    const REMINDER_ID = new Types.ObjectId('64b7f0000000000000000c01');

    it('creates by code or document id and reschedules through AuctionsService (AR-09)', async () => {
      const userId = new Types.ObjectId('64b7f0000000000000000e01');
      const auctionId = new Types.ObjectId('64b7f0000000000000000e02');
      const userModel = moduleRef.get<Model<UserEntity>>(getModelToken(UserEntity.name));
      const auctionModel = moduleRef.get<Model<AuctionEntity>>(getModelToken(AuctionEntity.name));
      await userModel.collection.insertOne({
        _id: userId,
        name: 'Reminder Test Account',
        email: 'reminder@example.test',
        emailVerified: true,
        role: 'free',
        providers: ['local'],
      });
      await auctionModel.collection.insertOne(
        auction('reminder-lookup', {
          _id: auctionId,
          available: false,
          phases: [{ modality: PhaseModality.SFI_AUCTION, phaseDates: [FAR_FUTURE] }],
        }),
      );
      const dto = {
        auctionId: 'reminder-lookup',
        channel: ReminderChannel.EMAIL,
        scheduledAt: '2026-01-16T12:00:00.000Z',
      };

      const byCode = await reminders.create(userId.toString(), dto);
      const byId = await reminders.create(userId.toString(), {
        ...dto,
        auctionId: auctionId.toString(),
      });
      expect(byCode.auction).toMatchObject({ _id: auctionId, code: 'reminder-lookup' });
      expect(byId.auction).toMatchObject({ _id: auctionId, code: 'reminder-lookup' });

      const updated = await reminders.update(userId.toString(), byId._id.toString(), {
        scheduledAt: '2026-01-17T12:00:00.000Z',
      });
      expect(updated.scheduledAt).toEqual(new Date('2026-01-17T12:00:00.000Z'));
      for (const invalid of ['not-an-id', NE_NULL]) {
        await expect(
          reminders.create(userId.toString(), { ...dto, auctionId: invalid }),
        ).rejects.toMatchObject({ code: 'AUCTION_NOT_FOUND' });
      }
    });

    it('getDueReminders keeps its $lte filter; findOne never reads an operator id', async () => {
      const reminderModel = moduleRef.get<Model<ReminderEntity>>(
        getModelToken(ReminderEntity.name),
      );
      await reminderModel.collection.insertMany([
        {
          _id: REMINDER_ID,
          userId: USER_A,
          auction: new Types.ObjectId(),
          channel: ReminderChannel.EMAIL,
          scheduledAt: new Date('2000-01-01T00:00:00.000Z'),
          status: ReminderStatus.PENDING,
        },
        {
          userId: USER_A,
          auction: new Types.ObjectId(),
          channel: ReminderChannel.EMAIL,
          scheduledAt: FAR_FUTURE,
          status: ReminderStatus.PENDING,
        },
      ]);

      const due = await reminders.getDueReminders();

      expect(due.map((reminder) => reminder._id.toString())).toEqual([REMINDER_ID.toString()]);
      await expect(reminders.findOne(USER_A.toString(), NE_NULL)).rejects.toThrow();
      await expect(
        reminders.findOne(USER_B.toString(), REMINDER_ID.toString()),
      ).rejects.toMatchObject({ code: 'REMINDER_NOT_FOUND' });
    });
  });

  describe('UsersService', () => {
    it('findByEmail, findByGoogleId and findByStripeCustomerId never match an operator object', async () => {
      await users.create({
        email: 'ana.teste@example.test',
        name: 'Ana Teste',
        password: 'senha-de-teste-1',
        providers: ['local'],
      } as Parameters<UsersService['create']>[0]);

      await expect(users.findByGoogleId(NE_NULL)).resolves.toBeNull();
      await expect(users.findByStripeCustomerId(NE_NULL)).resolves.toBeNull();
      await expect(users.findByEmail('ana.teste@example.test')).resolves.toMatchObject({
        name: 'Ana Teste',
      });
    });

    it('update writes only the whitelisted fields and never an operator from the body', async () => {
      const user = await users.findByEmail('ana.teste@example.test');
      const id = user?._id.toString() ?? '';

      // A body carrying operators and a field the DTO does not name: none of it is applied.
      const hostile = {
        name: 'Ana Souza',
        $unset: { email: '' },
        $set: { role: 'admin' },
        emailVerificationToken: 'planted',
      } as unknown as Parameters<UsersService['update']>[1];
      const updated = await users.update(id, hostile);

      expect(updated.name).toBe('Ana Souza');
      expect(updated.email).toBe('ana.teste@example.test');
      expect(updated.role).toBe('free');
      expect(updated.emailVerificationToken).toBeUndefined();
    });

    it('update ignores a field whose value is an object instead of text', async () => {
      const user = await users.findByEmail('ana.teste@example.test');
      const id = user?._id.toString() ?? '';

      const updated = await users.update(id, {
        phone: { $ne: null } as unknown as string,
      });

      expect(updated.phone).toBeUndefined();
    });

    it('update keeps hashing a new password and clears the status with an explicit null', async () => {
      const user = await users.findByEmail('ana.teste@example.test');
      const id = user?._id.toString() ?? '';

      await users.update(id, { password: 'outra-senha-de-teste', subscriptionStatus: null });

      await expect(
        users.validatePassword('ana.teste@example.test', 'outra-senha-de-teste'),
      ).resolves.toMatchObject({ subscriptionStatus: null });
    });

    it('update answers USER_NOT_FOUND for an id that matches no one', async () => {
      await expect(
        users.update(new Types.ObjectId().toString(), { name: 'Ninguem' }),
      ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    });
  });
});
