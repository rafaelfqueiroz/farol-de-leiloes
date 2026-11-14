// AR-17: over JSON, money is a string ("1234.56"). The DTO layer converts at the edge, in both
// directions: request DTOs turn a money string into a Decimal (IsMoneyString), response DTOs
// turn a Decimal into a two-decimal string in their constructor (moneyToJson, AR-36).
import { Transform, type TransformFnParams } from 'class-transformer';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import { Decimal, isMoneyString, MONEY_PATTERN, toMoneyString } from './money.js';

/**
 * AR-33: spread into `@ApiProperty` / `@ApiPropertyOptional` of every money field, request or
 * response, so the OpenAPI document says "string of reais" the same way everywhere.
 */
export const MONEY_API_PROPERTY = {
  type: String,
  pattern: MONEY_PATTERN,
  example: '1234.56',
} as const;

export interface IsMoneyStringOptions {
  /** Refuse zero: the amount must be at least R$ 0,01. */
  positive?: boolean;
}

/**
 * SC-10 / AR-34: only a `string` is ever turned into a Decimal, and only a valid money string at
 * that. An object (including one forged to look like a Decimal), an array, a boolean or a number
 * is left untouched, so the validator refuses it.
 */
function toDecimalWhenMoney({ value }: TransformFnParams): unknown {
  return isMoneyString(value) ? new Decimal(value) : value;
}

/**
 * AR-17 / AR-34: a request field holding reais. The raw value must be a money string
 * (MONEY_PATTERN): it is transformed into a `Decimal` before validation, so the handler receives
 * a `Decimal` and never a float; a number, an array (a repeated query key), an object or a
 * malformed string fails as VALIDATION_FAILED naming the field. Works on bodies and query
 * strings alike (the global ValidationPipe runs with `transform: true`).
 *
 *   @ApiPropertyOptional({ ...MONEY_API_PROPERTY, description: 'BRL' })
 *   @IsOptional()
 *   @IsMoneyString()
 *   maxPrice?: Decimal;
 */
export function IsMoneyString(
  options: IsMoneyStringOptions = {},
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    Transform(toDecimalWhenMoney)(target, propertyKey);
    registerDecorator({
      name: 'isMoneyString',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: {
        // `instanceof`, never `Decimal.isDecimal`: isDecimal also accepts any object carrying a
        // `toStringTag` of "[object Decimal]", which a JSON body can forge (SC-10). Only the
        // transform above makes a Decimal, so a real instance proves the string passed the pattern.
        validate: (value: unknown) =>
          value instanceof Decimal && (!options.positive || value.greaterThan(0)),
        defaultMessage: () =>
          `$property must be ${options.positive ? 'a positive' : 'an'} amount of reais as a decimal string, e.g. "1234.56"`,
      },
    });
  };
}

/** AR-17 / AR-19: a Decimal leaves the API as a string rounded to two places, half-even. */
export function moneyToJson(value: Decimal): string;
export function moneyToJson(value: Decimal | null): string | null;
export function moneyToJson(value: Decimal | undefined): string | undefined;
export function moneyToJson(value: Decimal | null | undefined): string | null | undefined;
export function moneyToJson(value: Decimal | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  return toMoneyString(value);
}
