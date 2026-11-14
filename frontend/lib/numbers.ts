import Decimal from 'decimal.js';
import { groupPtBr } from '@/lib/money';

// DS-29, AR-21: counts and areas are rendered here and nowhere else, never with an inline
// toLocaleString/Intl. Same pt-BR grouping and half-even rounding as the money formatters.
const D = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });
const NBSP = ' ';

/** `1.250 m²` (BR-003-19): square metres, pt-BR grouping, no decimals by default. */
export function formatArea(value: string | Decimal, places = 0): string {
  const decimal = new D(value);
  if (!decimal.isFinite()) throw new RangeError('Area must be a finite decimal');
  const rounded = decimal.toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN);
  const sign = rounded.isNegative() && !rounded.isZero() ? '-' : '';
  return `${sign}${groupPtBr(rounded.abs().toFixed(places))}${NBSP}m²`;
}

/** `1.250`: a whole count with pt-BR thousands grouping. */
export function formatCount(value: number): string {
  if (!Number.isSafeInteger(value)) throw new RangeError('Count must be a safe integer');
  return `${value < 0 ? '-' : ''}${groupPtBr(String(Math.abs(value)))}`;
}
