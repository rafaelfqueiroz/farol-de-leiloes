// SPEC-010 BR-010-28 (TS-08): the stable per-journey pseudonym, on a real MongoDB (the unique indexes
// decide the races). Two people in one journey differ; one person is stable; the same person has
// another label in another journey; twenty calls at once end with one row; after the purge's detach no
// row references the person and the labels stay in the journey.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnectionToken } from '@nestjs/mongoose';
import { type Connection, Types } from 'mongoose';
import { ActorPseudonymService } from '../../src/privacy/rights/actor-pseudonym.service.js';
import { createRightsApp, oid, type RightsApp } from '../support/privacy-rights-app.js';
import { useTestDatabase } from '../support/test-database.js';

const LABEL = /^p-[0-9a-f]{32}$/;

describe('SPEC-010 BR-010-28: stable pseudonyms of people inside a journey', () => {
  const db = useTestDatabase();
  let app: RightsApp;
  let service: ActorPseudonymService;

  const id = () => new Types.ObjectId().toHexString();
  const rows = (filter: Record<string, unknown> = {}) =>
    app.collection('actorPseudonyms').find(filter).toArray();

  beforeAll(async () => {
    app = await createRightsApp(db);
    service = app.get(ActorPseudonymService);
    // The unique indexes are built by migration 0009 in production (its own spec proves they equal
    // the schema's); here Mongoose builds them, and they must exist before the first write.
    await app.harness.moduleRef.get<Connection>(getConnectionToken()).syncIndexes();
  });

  afterAll(async () => {
    await app.close();
  });

  it('BR-010-28: the same person keeps the same pseudonym in a journey, whenever it is asked', async () => {
    const [journey, ana] = [id(), id()];

    const first = await service.forPerson(journey, ana);
    const again = await service.forPerson(journey, ana);

    expect(first).toMatch(LABEL);
    expect(again).toBe(first);
    expect(await rows({ journeyId: oid(journey) })).toHaveLength(1);
  });

  it('BR-010-28: two people of one journey have different pseudonyms', async () => {
    const [journey, ana, beto] = [id(), id(), id()];

    const [forAna, forBeto] = [
      await service.forPerson(journey, ana),
      await service.forPerson(journey, beto),
    ];

    expect(forAna).not.toBe(forBeto);
  });

  it('BR-010-28: the same person has another pseudonym in another journey', async () => {
    const [one, two, ana] = [id(), id(), id()];

    expect(await service.forPerson(one, ana)).not.toBe(await service.forPerson(two, ana));
  });

  it('is random: nothing of the person or the journey is in the label', async () => {
    const [journey, ana] = [id(), id()];

    const label = await service.forPerson(journey, ana);

    expect(label).not.toContain(ana);
    expect(label).not.toContain(journey);
    expect(label.length).toBe(34); // p- and 16 random bytes (128 bits) as hex
  });

  it('twenty calls at once for one person end with ONE row, and all answer the same label', async () => {
    const [journey, ana] = [id(), id()];

    const labels = await Promise.all(
      Array.from({ length: 20 }, () => service.forPerson(journey, ana)),
    );

    expect(new Set(labels).size).toBe(1);
    expect(await rows({ journeyId: oid(journey), userId: oid(ana) })).toHaveLength(1);
  });

  it('calls at once for several people each end with their own label', async () => {
    const journey = id();
    const people = Array.from({ length: 8 }, id);

    const labels = await Promise.all(
      people.flatMap((person) => [
        service.forPerson(journey, person),
        service.forPerson(journey, person),
      ]),
    );

    expect(new Set(labels).size).toBe(8);
    expect(await rows({ journeyId: oid(journey) })).toHaveLength(8);
  });

  it('BR-010-15: after detachUser no row references the person, and the labels stay in their journeys', async () => {
    const [one, two, ana, beto] = [id(), id(), id(), id()];
    const labelOfAnaInOne = await service.forPerson(one, ana);
    await service.forPerson(two, ana);
    const labelOfBeto = await service.forPerson(one, beto);

    expect(await service.detachUser(ana)).toBe(2);

    expect(await rows({ userId: oid(ana) })).toEqual([]);
    expect(JSON.stringify(await rows())).not.toContain(ana);
    // The journey still shows "someone removed" with the same label...
    expect(await rows({ journeyId: oid(one), pseudonym: labelOfAnaInOne })).toHaveLength(1);
    // ...and another person's label is untouched.
    expect(
      await rows({ journeyId: oid(one), userId: oid(beto), pseudonym: labelOfBeto }),
    ).toHaveLength(1);
    // Idempotent: nothing left to detach.
    expect(await service.detachUser(ana)).toBe(0);
  });

  it('two detached people of one journey coexist (userId null is not a key)', async () => {
    const [journey, ana, beto] = [id(), id(), id()];
    await service.forPerson(journey, ana);
    await service.forPerson(journey, beto);

    expect(await service.detachUser(ana)).toBe(1);
    expect(await service.detachUser(beto)).toBe(1);

    expect(await rows({ journeyId: oid(journey), userId: null })).toHaveLength(2);
  });
});
