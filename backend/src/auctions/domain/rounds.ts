// SPEC-004 BR-004-13, BR-004-14: the sale rounds of a property, its current round and discount.
// Pure (AR-05): "now" is an argument (AR-24), money is a Decimal (AR-17).
import { Decimal } from '../../common/money/money.js';
import type { RoundPrices } from './detail-data.js';
import { PhaseModality } from './modality.js';

/**
 * One sale round. `date` is the instant the round ends (Brasília wall clock read by the collector,
 * BR-004-12); null means the round is open-ended (BR-004-13): the collector writes it only for a
 * modality without a published end date. A property whose rounds have not been collected has NO
 * rounds at all (empty), which is unknown, never a default (BR-004-15).
 */
export interface Round {
  label: string;
  /** Reais; null when the page gave none. */
  minimumPrice: Decimal | null;
  date: Date | null;
}

/**
 * BR-004-13: the earliest round whose date has not passed at `now`, or the open-ended round. A
 * round whose date is exactly `now` has passed: the 2nd round of an SFI auction starts at the
 * instant the 1st one ends. Null when there are no rounds (unknown) or all have passed.
 */
export function currentRound(rounds: readonly Round[], now: Date): Round | null {
  let current: Round | null = null;
  for (const round of rounds) {
    if (round.date !== null && round.date.getTime() <= now.getTime()) continue;
    // An open-ended round has no end: it is after every dated one.
    if (current === null || endOf(round) < endOf(current)) current = round;
  }
  return current;
}

function endOf(round: Round): number {
  return round.date === null ? Number.POSITIVE_INFINITY : round.date.getTime();
}

/**
 * BR-004-13: the current round's minimum price. When the round gave none, or no round was
 * collected yet, the list's own price (`listPrice`, the daily list's "Preço") stands: it is the
 * price Caixa published for the round running when the list was made.
 */
export function currentMinimumPrice(
  rounds: readonly Round[],
  listPrice: Decimal | null,
  now: Date,
): Decimal | null {
  return currentRound(rounds, now)?.minimumPrice ?? listPrice;
}

/**
 * BR-004-14 / DL-004-07: (appraisal - minimum price) / appraisal, as a percentage, computed by
 * the platform. Zero or negative when the price reaches or passes the appraisal, and stored and
 * shown as computed, never clamped. Full precision (AR-19: rounding happens at display). Null when
 * either figure is unknown or the appraisal is zero.
 *
 *   discountPercent(200000, 150000) -> 25;  discountPercent(100000, 120000) -> -20
 */
export function discountPercent(
  appraisalPrice: Decimal | null,
  minimumPrice: Decimal | null,
): Decimal | null {
  if (appraisalPrice === null || minimumPrice === null || appraisalPrice.isZero()) return null;
  return appraisalPrice.minus(minimumPrice).div(appraisalPrice).times(100);
}

const NO_PRICES: RoundPrices = { first: null, second: null, single: null };

/**
 * The rounds a detail page's dates and prices make, by modality (BR-004-13). An SFI auction has a
 * 1st and a 2nd round, each with the price the page states for it; open bidding and online sale one
 * dated round each, with the page's single price; a direct online sale has no end date, so one
 * open-ended round. No dates for a modality that needs them is unknown: no rounds (BR-004-15).
 *
 *   roundsFromPhaseDates(SFI_AUCTION, [d1, d2], { first: 192622, second: 170201.84, single: null })
 *     -> [{ '1º Leilão', 192622, d1 }, { '2º Leilão', 170201.84, d2 }]
 */
export function roundsFromPhaseDates(
  modality: PhaseModality,
  dates: readonly Date[],
  prices: RoundPrices = NO_PRICES,
): Round[] {
  switch (modality) {
    case PhaseModality.SFI_AUCTION:
      return dates.slice(0, 2).map((date, index) => ({
        label: `${index + 1}º Leilão`,
        minimumPrice: index === 0 ? (prices.first ?? prices.single) : prices.second,
        date,
      }));
    case PhaseModality.OPEN_BIDDING:
      return dates.slice(0, 1).map((date) => ({
        label: 'Licitação',
        minimumPrice: prices.single ?? prices.first,
        date,
      }));
    case PhaseModality.ONLINE_SALES:
      return dates.slice(0, 1).map((date) => ({
        label: 'Venda Online',
        minimumPrice: prices.single ?? prices.first,
        date,
      }));
    case PhaseModality.DIRECT_ONLINE_SALES:
      return [{ label: 'Venda Direta', minimumPrice: prices.single ?? prices.first, date: null }];
  }
}
