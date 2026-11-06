import mongoose, { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMongooseDefaults, decimalFilter, serverOperators } from './query-safety';
import { DomainError } from '../errors/domain-error';
import { Decimal } from '../money/money';

describe('applyMongooseDefaults', () => {
  afterEach(() => {
    mongoose.set('sanitizeFilter', false);
    mongoose.set('strictQuery', false);
  });

  it('SC-10: turns sanitizeFilter and strictQuery on for every model', () => {
    mongoose.set('sanitizeFilter', false);
    mongoose.set('strictQuery', false);

    applyMongooseDefaults();

    expect(mongoose.get('sanitizeFilter')).toBe(true);
    expect(mongoose.get('strictQuery')).toBe(true);
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

describe('decimalFilter', () => {
  it('AR-17: turns a finite Decimal into the Decimal128 bound stored prices compare with', () => {
    expect(decimalFilter(new Decimal('300000.50'), 'maxPrice')).toEqual(
      Types.Decimal128.fromString('300000.5'),
    );
    expect(decimalFilter(new Decimal('0'), 'minPrice')).toEqual(Types.Decimal128.fromString('0'));
  });

  it.each([
    ['a number', 10],
    ['a string', '10'],
    ['an operator object', { $gt: 0 }],
    ['an object forged to look like a Decimal', { toStringTag: '[object Decimal]' }],
    ['NaN', new Decimal(Number.NaN)],
    ['Infinity', new Decimal(Number.POSITIVE_INFINITY)],
    ['undefined', undefined],
  ])('SC-10: refuses %s with VALIDATION_FAILED naming the field', (_label, value) => {
    expect(() => decimalFilter(value, 'minPrice')).toThrow(
      new DomainError('VALIDATION_FAILED', { fields: ['minPrice'] }),
    );
  });
});
