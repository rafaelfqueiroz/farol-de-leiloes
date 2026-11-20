// SPEC-010 BR-010-28: the stable pseudonym of a person inside one journey. The label is what the
// journey history and the office records show for a person who deleted their account or left the
// office ("usuário removido" and the label), so that the actions of the same person stay
// distinguishable from those of others without naming them. Exported for SPEC-011 and SPEC-016.
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PSEUDONYM_MIN_BYTES, pseudonymFromBytes } from '../domain/pseudonym.js';
import { ActorPseudonymRepository } from './actor-pseudonym.repository.js';

/** A clash of two 128-bit random labels in one journey is a fault; this many tries is plenty. */
const MAX_ATTEMPTS = 5;

@Injectable()
export class ActorPseudonymService {
  constructor(private readonly pseudonyms: ActorPseudonymRepository) {}

  /**
   * The person's pseudonym in the journey: the same one every time, different for another person in
   * the same journey and for the same person in another journey. Created on first use, from 128
   * random bits and nothing about the person (domain/pseudonym.ts). Two calls at the same moment end
   * with ONE row, and both answer it: the unique index decides, the loser reads the winner's.
   */
  async forPerson(journeyId: string, userId: string): Promise<string> {
    const existing = await this.pseudonyms.find(journeyId, userId);
    if (existing !== null) return existing;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const candidate = pseudonymFromBytes(randomBytes(PSEUDONYM_MIN_BYTES));
      if (await this.pseudonyms.insert(journeyId, userId, candidate)) return candidate;
      // Refused: another call created this person's label meanwhile (the usual reason), or the
      // random label clashed with another person's in this journey (not expected).
      const winner = await this.pseudonyms.find(journeyId, userId);
      if (winner !== null) return winner;
    }
    throw new Error('A pseudonym could not be created');
  }

  /**
   * BR-010-28, BR-010-15: after the purge no row references the person any more: every label they
   * have keeps its text and loses its link (`userId` null), so it can no longer be traced to them.
   * Idempotent. Answers how many rows it detached.
   */
  detachUser(userId: string): Promise<number> {
    return this.pseudonyms.detachUser(userId);
  }
}
