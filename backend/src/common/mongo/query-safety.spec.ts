import mongoose from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMongooseDefaults, serverOperators } from './query-safety';

describe('applyMongooseDefaults', () => {
  afterEach(() => {
    mongoose.set('sanitizeFilter', false);
  });

  it('SC-10: turns sanitizeFilter on for every model', () => {
    mongoose.set('sanitizeFilter', false);

    applyMongooseDefaults();

    expect(mongoose.get('sanitizeFilter')).toBe(true);
  });
});

describe('serverOperators', () => {
  it('SC-10: marks the operators as server-built and returns the same object', () => {
    const operators = { $in: ['A1'] };

    const marked = serverOperators(operators);

    expect(marked).toBe(operators);
    expect(Object.getOwnPropertySymbols(marked)).toHaveLength(1);
  });

  it('SC-10: sanitizeFilter leaves marked operators alone and wraps unmarked ones in $eq', () => {
    const sanitize = (filter: Record<string, unknown>) =>
      mongoose.sanitizeFilter(filter) as Record<string, unknown>;

    expect(sanitize({ code: serverOperators({ $in: ['A1'] }) }).code).toEqual(
      expect.objectContaining({ $in: ['A1'] }),
    );
    expect(sanitize({ code: { $ne: null } })).toEqual({ code: { $eq: { $ne: null } } });
  });
});
