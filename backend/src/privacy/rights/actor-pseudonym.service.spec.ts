// SPEC-010 BR-010-28: the pseudonym service's rules over a hand-written in-memory repository (TS-03):
// a stable label per (journey, person), the retry when a label clashes, and the detach. The unique
// indexes that decide real races are proven on MongoDB in test/integration/actor-pseudonyms.spec.ts.
import { describe, expect, it } from 'vitest';
import { ActorPseudonymService } from './actor-pseudonym.service.js';
import type { ActorPseudonymRepository } from './actor-pseudonym.repository.js';

type Port<T> = { [K in keyof T]: T[K] };

class FakePseudonymRepository implements Port<ActorPseudonymRepository> {
  readonly rows: { journeyId: string; userId: string | null; pseudonym: string }[] = [];

  async find(journeyId: string, userId: string): Promise<string | null> {
    return (
      this.rows.find((r) => r.journeyId === journeyId && r.userId === userId)?.pseudonym ?? null
    );
  }

  async insert(journeyId: string, userId: string, pseudonym: string): Promise<boolean> {
    const taken = this.rows.some(
      (r) => r.journeyId === journeyId && (r.userId === userId || r.pseudonym === pseudonym),
    );
    if (taken) return false;
    this.rows.push({ journeyId, userId, pseudonym });
    return true;
  }

  async detachUser(userId: string): Promise<number> {
    const mine = this.rows.filter((r) => r.userId === userId);
    for (const row of mine) row.userId = null;
    return mine.length;
  }

  async labelsOf(): Promise<{ journeyId: string; pseudonym: string }[]> {
    return [];
  }
}

const build = () => {
  const repository = new FakePseudonymRepository();
  return { repository, service: new ActorPseudonymService(repository as never) };
};

describe('BR-010-28: forPerson', () => {
  it('creates a 128-bit label on first use and answers it afterwards', async () => {
    const { service, repository } = build();

    const first = await service.forPerson('journey-1', 'ana');

    expect(first).toMatch(/^p-[0-9a-f]{32}$/);
    expect(await service.forPerson('journey-1', 'ana')).toBe(first);
    expect(repository.rows).toHaveLength(1);
  });

  it('gives two people of a journey, and one person in two journeys, different labels', async () => {
    const { service } = build();

    const labels = [
      await service.forPerson('journey-1', 'ana'),
      await service.forPerson('journey-1', 'beto'),
      await service.forPerson('journey-2', 'ana'),
    ];

    expect(new Set(labels).size).toBe(3);
  });

  it('answers the label another caller created meanwhile, never a second one (the index decided)', async () => {
    const { service, repository } = build();
    // `find` says nobody has one yet, then the other caller's row is there when we insert.
    const originalFind = repository.find.bind(repository);
    let calls = 0;
    repository.find = async (journeyId, userId) => {
      calls += 1;
      if (calls === 1) return null; // our first look: nothing yet
      return originalFind(journeyId, userId);
    };
    repository.rows.push({ journeyId: 'journey-1', userId: 'ana', pseudonym: 'p-winner' });

    expect(await service.forPerson('journey-1', 'ana')).toBe('p-winner');
    expect(repository.rows).toHaveLength(1);
  });

  it('tries again with a new label when a label clashes with another person’s (not expected, never fatal)', async () => {
    const { service, repository } = build();
    // The first random label is refused: whatever label is tried first, mark the next call to clash once.
    let refused = false;
    const insert = repository.insert.bind(repository);
    repository.insert = async (journeyId, userId, pseudonym) => {
      if (!refused) {
        refused = true;
        return false;
      }
      return insert(journeyId, userId, pseudonym);
    };

    const label = await service.forPerson('journey-1', 'ana');

    expect(label).toMatch(/^p-[0-9a-f]{32}$/);
    expect(repository.rows).toHaveLength(1);
  });

  it('gives up with an error after five clashes in a row (a fault, not a chance)', async () => {
    const { service, repository } = build();
    repository.insert = async () => false;

    await expect(service.forPerson('journey-1', 'ana')).rejects.toThrow(
      'A pseudonym could not be created',
    );
  });
});

describe('BR-010-28 / BR-010-15: detachUser', () => {
  it('cuts the link of every label of the person and only theirs, and counts them', async () => {
    const { service, repository } = build();
    await service.forPerson('journey-1', 'ana');
    await service.forPerson('journey-2', 'ana');
    await service.forPerson('journey-1', 'beto');

    expect(await service.detachUser('ana')).toBe(2);

    expect(repository.rows.filter((r) => r.userId === 'ana')).toEqual([]);
    expect(repository.rows.filter((r) => r.userId === null)).toHaveLength(2);
    expect(repository.rows.filter((r) => r.userId === 'beto')).toHaveLength(1);
    expect(await service.detachUser('ana')).toBe(0);
  });
});
