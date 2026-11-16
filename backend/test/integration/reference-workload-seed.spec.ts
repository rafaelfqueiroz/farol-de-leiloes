// SPEC-003 BR-003-08: the reference-workload seed on a real MongoDB — the schemas' indexes are
// built, the documents are what the API reads, the seeded accounts sign in, and a second run
// changes nothing.
import * as bcrypt from 'bcrypt';
import { createConnection, type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_ACCOUNTS } from '../../scripts/reference-workload/accounts.js';
import { FIXTURE_AUCTIONS } from '../../scripts/reference-workload/catalog.js';
import { seedReferenceWorkload } from '../../scripts/reference-workload/seed.js';
import { toAuction } from '../../src/auctions/auction.mapper.js';
import type { AuctionRecord } from '../../src/auctions/interfaces/auction.interface.js';
import { useTestDatabase } from '../support/test-database.js';

const db = useTestDatabase();
const host = new URL(db.uri).hostname;
const options = {
  uri: db.uri,
  auctions: 300,
  seed: 3,
  referenceDate: new Date('2026-03-02T12:00:00Z'),
  allowHosts: [host], // the Testcontainers MongoDB of this run, named explicitly (DV-19)
};

let connection: Connection;

beforeAll(async () => {
  await seedReferenceWorkload(options);
  connection = await createConnection(db.uri).asPromise();
});

afterAll(async () => {
  await connection.close();
});

describe('BR-003-08: seedReferenceWorkload', () => {
  it('writes the fixtures and the generated catalog', async () => {
    expect(await connection.collection('auctions').countDocuments()).toBe(301);
  });

  it('builds the auction indexes the schema declares before writing (AR-35)', async () => {
    const names = (await connection.collection('auctions').indexes()).map((index) => index.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'code_1',
        'address.state_1_address.city_1',
        'currentPhase.modality_1',
        'currentPhase.minimumPrice_1',
      ]),
    );
  });

  it('stores an auction the API reads back: 26/01/2026 10h00 Brasília is 13:00 UTC', async () => {
    const stored = await connection
      .collection<AuctionRecord>('auctions')
      .findOne({ code: FIXTURE_AUCTIONS.BRASILIA_TEN_AM });
    if (!stored) throw new Error('fixture auction missing');
    const auction = toAuction(stored);
    expect(auction.currentPhase?.phaseDates).toEqual([new Date('2026-01-26T13:00:00.000Z')]);
    expect(auction.currentPhase?.minimumPrice?.toFixed(2)).toBe('180000.00');
    expect(auction.available).toBe(true);
  });

  it('seeds the accounts, verified or not as stated, with passwords that verify as UsersService hashes them', async () => {
    for (const account of Object.values(SEED_ACCOUNTS)) {
      const user = await connection.collection('users').findOne({ email: account.email });
      expect(user?.emailVerified).toBe(account.emailVerified);
      expect(user?.role).toBe(account.role);
      expect(await bcrypt.compare(account.password, String(user?.password))).toBe(true);
    }
  });

  it('is idempotent: a second run leaves the same counts', async () => {
    await seedReferenceWorkload(options);
    expect(await connection.collection('auctions').countDocuments()).toBe(301);
    expect(await connection.collection('users').countDocuments()).toBe(3);
  });

  it('refuses a host it was not told is a test database (DV-19)', async () => {
    await expect(seedReferenceWorkload({ ...options, allowHosts: [] })).rejects.toThrow(
      'Refusing to seed',
    );
  });
});
