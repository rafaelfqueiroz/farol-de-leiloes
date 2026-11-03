import Decimal from 'decimal.js';

// AR-17: money is a Decimal or a string, never a JS number. AR-19: ROUND_HALF_EVEN at display.
// A private clone keeps this module from reading or changing decimal.js's global config.
const D = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });

const NBSP = '\u00a0';
const SYMBOL = `R$${NBSP}`;

export type MoneyInput = string | Decimal;

function toDecimal(value: MoneyInput): Decimal {
  const decimal = new D(value);
  if (!decimal.isFinite()) {
    throw new RangeError('Money value must be a finite decimal');
  }
  return decimal;
}

// "1234567.5" -> "1.234.567,5"; the input is a plain fixed-point string from Decimal#toFixed.
function groupPtBr(fixed: string): string {
  const [integer = '', fraction] = fixed.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

/** AR-21: `R$ 1.234,56` (non-breaking space), two decimals, pt-BR grouping. */
export function formatMoney(value: MoneyInput): string {
  const rounded = toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  // -0.001 rounds to zero: show R$ 0,00, never "-R$ 0,00"
  const sign = rounded.isNegative() && !rounded.isZero() ? '-' : '';
  return `${sign}${SYMBOL}${groupPtBr(rounded.abs().toFixed(2))}`;
}

const COMPACT_UNITS = [
  { divisor: new D(1_000), label: 'mil' },
  { divisor: new D(1_000_000), label: 'mi' },
  { divisor: new D(1_000_000_000), label: 'bi' },
] as const;

// COMPACT_UNITS is a fixed table and every index below is derived from its length, so a miss is a bug
function unitAt(index: number) {
  const unit = COMPACT_UNITS[index];
  if (!unit) throw new RangeError(`No compact unit at index ${index}`);
  return unit;
}

/**
 * `R$ 2,4 mi` / `R$ 380 mil` for tiles and phone cards. One decimal below 100 of the unit, none
 * from 100; a trailing `,0` is dropped. Below R$ 1.000 there is nothing to abbreviate, so the
 * full format is returned. The caller keeps the full value for the accessible name.
 */
export function formatMoneyCompact(value: MoneyInput): string {
  const decimal = toDecimal(value);
  const abs = decimal.abs();
  if (abs.lt(unitAt(0).divisor)) return formatMoney(decimal);

  let index = COMPACT_UNITS.length - 1;
  while (index > 0 && abs.lt(unitAt(index).divisor)) index -= 1;

  const scale = (unitIndex: number) => {
    const scaled = abs.div(unitAt(unitIndex).divisor);
    const places = scaled.gte(100) ? 0 : 1;
    return { rounded: scaled.toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN), places };
  };

  let { rounded, places } = scale(index);
  // 999.96 mil rounds to 1000 mil: promote to 1 mi instead of printing "1.000 mil"
  if (rounded.gte(1_000) && index < COMPACT_UNITS.length - 1) {
    index += 1;
    ({ rounded, places } = scale(index));
  }

  const text = groupPtBr(rounded.toFixed(places)).replace(/,0$/, '');
  const sign = decimal.isNegative() ? '-' : '';
  return `${sign}${SYMBOL}${text}${NBSP}${unitAt(index).label}`;
}

// The API's money format (AR-17, AR-18): a plain decimal string of reais, dot decimal, at most two
// places, no grouping and no sign: "1234.56".
const MONEY_STRING = /^\d+(\.\d{1,2})?$/;

export function isMoneyString(value: string): boolean {
  return MONEY_STRING.test(value);
}

/**
 * Reads an amount a person typed ("10", "10,5", "1234.56") into the API's money string with two
 * places ("10.00"). Returns null for anything that is not a non-negative amount in reais with at
 * most two decimals, so a typo is refused instead of rounded. Grouping separators are not accepted.
 */
export function parseMoneyInput(raw: string): string | null {
  const normalised = raw.trim().replace(',', '.');
  if (!MONEY_STRING.test(normalised)) return null;
  return new D(normalised).toFixed(2);
}

// A <Slider> holds a JS number for its thumbs; that is its API, not a money amount. These two
// functions are the only crossing between the slider and money strings (AR-17): the number lives
// in component state while the thumb moves, and leaves it as a string at the API boundary.

/** Slider thumb position (whole reais) -> the API's money string. */
export function moneyFromSlider(value: number): string {
  return new D(value).toFixed(2);
}

/** The API's money string -> a slider thumb position (whole reais). */
export function moneyToSlider(value: string): number {
  return new D(value).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber();
}

/**
 * How far below the appraisal the minimum bid is, in percent ((appraisal - minimum) / appraisal).
 * Null when either amount is missing or the appraisal is not positive. Decimal arithmetic (AR-17).
 */
export function discountPercent(
  appraisal: MoneyInput | null,
  minimum: MoneyInput | null,
): Decimal | null {
  if (appraisal === null || minimum === null) return null;
  const base = toDecimal(appraisal);
  if (!base.gt(0)) return null;
  return base.minus(toDecimal(minimum)).div(base).times(100);
}

/** `12,5%` (BR-003-21): pt-BR decimal comma, one place by default, rounded half to even. */
export function formatPercent(value: MoneyInput, places = 1): string {
  const rounded = toDecimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN);
  const sign = rounded.isNegative() && !rounded.isZero() ? '-' : '';
  return `${sign}${groupPtBr(rounded.abs().toFixed(places))}%`;
}
