import { Auction } from '../interfaces/auction.interface';
import { PhaseModality } from '../schemas/auction.schema';

/**
 * Checks if an auction is currently active (not closed).
 *
 * An auction is considered active if:
 * - It is available (available !== false)
 * - AND one of:
 *   - Its current phase is ONLINE_SALES (always active, no date required)
 *   - Its current phase has a future date in phaseDates
 */
export function isAuctionActive(auction: Auction): boolean {
  if (auction.available === false) {
    return false;
  }

  const currentPhase = auction.currentPhase;
  if (!currentPhase) {
    return false;
  }

  // Online Sales auctions are always active (they're like real estate listings)
  if (currentPhase.modality === PhaseModality.ONLINE_SALES) {
    return true;
  }

  // Check if any phase date is in the future
  const phaseDates = currentPhase.phaseDates ?? [];
  if (phaseDates.length === 0) {
    return false;
  }

  const now = new Date();
  return phaseDates.some(date => new Date(date) >= now);
}

/**
 * Filters a list of auctions to return only active ones.
 */
export function filterActiveAuctions(auctions: Auction[]): Auction[] {
  return auctions.filter(isAuctionActive);
}
