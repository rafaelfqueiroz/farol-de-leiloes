// AR-17 / AR-34: the edge conversions of money in DTOs, run through class-transformer and
// class-validator the way the global ValidationPipe runs them (transform, then validate).
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { IsOptional, validateSync } from 'class-validator';
import { IsMoneyString, moneyToJson } from './money-dto.js';
import { Decimal } from './money.js';

class PriceQuery {
  @IsOptional()
  @IsMoneyString()
  price?: Decimal;

  @IsOptional()
  @IsMoneyString({ positive: true })
  discount?: Decimal;
}

function parse(plain: Record<string, unknown>) {
  const dto = plainToInstance(PriceQuery, plain);
  const failed = validateSync(dto).map((error) => error.property);
  return { dto, failed };
}

describe('IsMoneyString', () => {
  it('turns a money string into a Decimal, digit for digit', () => {
    const { dto, failed } = parse({ price: '1234.56', discount: '0.01' });

    expect(failed).toEqual([]);
    expect(dto.price).toBeInstanceOf(Decimal);
    expect(dto.price?.toFixed()).toBe('1234.56');
    expect(dto.discount?.toFixed()).toBe('0.01');
  });

  it.each([
    ['a JSON number', 1234.56],
    ['a pt-BR string', '1.234,56'],
    ['a third decimal', '1.005'],
    ['a negative', '-1'],
    ['an exponent', '1e3'],
    ['an empty string', ''],
    ['a repeated query key', ['1', '2']],
    ['an operator object', { $gt: '' }],
    ['a boolean', true],
    ['an object forged to look like a Decimal (SC-10)', { toStringTag: '[object Decimal]' }],
  ])('refuses %s', (_label, value) => {
    expect(parse({ price: value }).failed).toEqual(['price']);
  });

  it('SC-10: the transform leaves every non-string untouched for the validator to refuse', () => {
    const forged = { toStringTag: '[object Decimal]' };
    const list = ['1', '2'];

    const dto = plainToInstance(PriceQuery, { price: forged, discount: list });

    expect(dto.price).toEqual(forged);
    expect(dto.price).not.toBeInstanceOf(Decimal);
    expect(dto.discount).toEqual(list);
    expect(validateSync(dto).map((error) => error.property)).toEqual(['price', 'discount']);
  });

  it('SC-10: the validator requires a genuine Decimal, so a forged one never reaches greaterThan', () => {
    const dto = new PriceQuery();
    dto.discount = { toStringTag: '[object Decimal]' } as unknown as Decimal;

    expect(validateSync(dto).map((error) => error.property)).toEqual(['discount']);
  });

  it('leaves null to @IsOptional, as class-validator does: the caller must drop it', () => {
    const { dto, failed } = parse({ price: null });

    expect(failed).toEqual([]);
    expect(dto.price).toBeNull();
  });

  it('positive refuses zero but accepts one centavo', () => {
    expect(parse({ discount: '0' }).failed).toEqual(['discount']);
    expect(parse({ discount: '0.00' }).failed).toEqual(['discount']);
    expect(parse({ discount: '0.01' }).failed).toEqual([]);
  });

  it('names the expected shape in its message, never the value', () => {
    const [error] = validateSync(plainToInstance(PriceQuery, { discount: 'R$ 5' }));

    expect(Object.values(error?.constraints ?? {})).toEqual([
      'discount must be a positive amount of reais as a decimal string, e.g. "1234.56"',
    ]);
  });
});

describe('moneyToJson', () => {
  it('AR-19: two places, half-even, as a string', () => {
    expect(moneyToJson(new Decimal('1234.5'))).toBe('1234.50');
    expect(moneyToJson(new Decimal('0.125'))).toBe('0.12');
    expect(moneyToJson(new Decimal('300000'))).toBe('300000.00');
  });

  it('keeps an absent amount absent', () => {
    expect(moneyToJson(null)).toBeNull();
    expect(moneyToJson(undefined)).toBeUndefined();
  });
});
