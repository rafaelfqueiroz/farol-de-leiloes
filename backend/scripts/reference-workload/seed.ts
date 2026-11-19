// SPEC-003 BR-003-08: writes the reference workload into a throwaway MongoDB. Documents go
// through the application's own schemas (AuctionSchema, UserSchema), whose indexes are built
// first, so the search is measured with the indexes production has (AR-35).
//
// Idempotent: auctions are upserted by code and the seeded accounts by email, so a second run
// leaves the same data (a stack reused for the performance run can be re-seeded safely).
import * as bcrypt from 'bcrypt';
import { createConnection, type Model, Types } from 'mongoose';
import { Logger } from '@nestjs/common';
import { AuctionEntity, AuctionSchema } from '../../src/auctions/schemas/auction.schema.js';
import { PlanEntity, PlanSchema } from '../../src/plans/schemas/plan.schema.js';
import { UserEntity, UserSchema } from '../../src/users/schemas/user.schema.js';
import { SEED_ACCOUNTS } from './accounts.js';
import { referenceCatalog, type SeededAuction } from './catalog.js';
import { SEED_PLANS } from './plans.js';
import { SeedConfigError, seedTargetProblem } from './target.js';

export interface SeedOptions {
  /** The target database; refused unless it is a throwaway test database (target.ts, DV-19). */
  uri: string;
  /** Generated auctions besides the fixtures (FULL_CATALOG_SIZE for the performance run). */
  auctions: number;
  /** PRNG seed of the catalog. */
  seed: number;
  /** The day the catalog's phase dates are spread around (catalog.ts). */
  referenceDate: Date;
  /** Hosts besides the E2E stack's MongoDB that are known throwaway databases. */
  allowHosts?: readonly string[];
}

export interface SeedResult {
  auctions: number;
  accounts: number;
  plans: number;
}

/** Upserts per bulkWrite: big enough to be fast, small enough to stay under the 16 MB batch. */
const BATCH_SIZE = 1_000;
/** The cost UsersService hashes with, so a seeded password verifies exactly as a real one. */
const BCRYPT_ROUNDS = 10;

const logger = new Logger('ReferenceWorkloadSeed');

export async function seedReferenceWorkload(options: SeedOptions): Promise<SeedResult> {
  const problem = seedTargetProblem(options.uri, options.allowHosts);
  if (problem) {
    throw new SeedConfigError(`Refusing to seed: ${problem}`);
  }

  const connection = await createConnection(options.uri).asPromise();
  try {
    const auctions = connection.model<AuctionEntity>(AuctionEntity.name, AuctionSchema);
    const users = connection.model<UserEntity>(UserEntity.name, UserSchema);
    const plans = connection.model<PlanEntity>(PlanEntity.name, PlanSchema);
    // The schemas' indexes, before the data, as production has them.
    await Promise.all([auctions.init(), users.init(), plans.init()]);

    const auctionCount = await upsertCatalog(auctions, options);
    const accountCount = await upsertAccounts(users);
    const planCount = await upsertPlans(plans);
    // SC-15: counts only.
    logger.log(`Seeded ${auctionCount} auctions, ${accountCount} accounts and ${planCount} plans`);

    // Extension point (BR-003-08): the journey part of the reference workload — an office with
    // 100 in-progress and 500 closed journeys, and an investor with 20 journeys across 3 offices
    // — is seeded here once offices, journeys and the investor portal exist: SPEC-011 (#11),
    // SPEC-016 (#16) and SPEC-021 (#21). Each lands its own seeding step, through its own
    // schemas, after the catalog.

    return { auctions: auctionCount, accounts: accountCount, plans: planCount };
  } finally {
    await connection.close();
  }
}

async function upsertCatalog(model: Model<AuctionEntity>, options: SeedOptions): Promise<number> {
  let count = 0;
  let batch: SeededAuction[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    await model.bulkWrite(
      batch.map((auction) => ({
        updateOne: {
          filter: { code: auction.code },
          update: { $set: auction, $setOnInsert: { createdAt: options.referenceDate } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    count += batch.length;
    batch = [];
  };

  for (const auction of referenceCatalog({
    size: options.auctions,
    seed: options.seed,
    referenceDate: options.referenceDate,
  })) {
    batch.push(auction);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return count;
}

async function upsertAccounts(model: Model<UserEntity>): Promise<number> {
  const accounts = Object.values(SEED_ACCOUNTS);
  for (const account of accounts) {
    await model.updateOne(
      { email: account.email },
      {
        $set: {
          email: account.email,
          name: account.name,
          password: await bcrypt.hash(account.password, BCRYPT_ROUNDS),
          providers: ['local'],
          emailVerified: account.emailVerified,
          role: account.role,
          isAdmin: account.isAdmin, // SPEC-002: the capability, not the plan tier
          // The top plan without Stripe: no customer or subscription id (TS-07, TS-22).
          subscriptionStatus: account.role === 'premium' ? 'active' : null,
        },
      },
      { upsert: true, runValidators: true },
    );
  }
  return accounts.length;
}

/** SPEC-012: the offered plans of the stack, upserted by code (AR-17: the price is a Decimal128). */
async function upsertPlans(model: Model<PlanEntity>): Promise<number> {
  await model.bulkWrite(
    SEED_PLANS.map((plan) => ({
      updateOne: {
        filter: { code: plan.code },
        update: {
          $set: {
            ...plan,
            price: Types.Decimal128.fromString(plan.price),
            audience: 'ADVISOR_OFFICE',
            status: 'OFFERED',
          },
        },
        upsert: true,
      },
    })),
  );
  return SEED_PLANS.length;
}
