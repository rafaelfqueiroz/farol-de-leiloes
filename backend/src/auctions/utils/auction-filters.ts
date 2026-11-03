import { Auction } from '../interfaces/auction.interface';
import { PhaseModality } from '../schemas/auction.schema';

/**
 * Checks if an auction is currently active (not closed) at `now`.
 *
 * AR-24: the current time is an argument, never read here, so the check is a pure function a
 * spec drives with any instant (TS-06).
 *
 * An auction is considered active if:
 * - It is available (available !== false)
 * - AND one of:
 *   - Its current phase is ONLINE_SALES (always active, no date required)
 *   - Its current phase has a date in phaseDates at or after `now`
 */
export function isAuctionActive(auction: Auction, now: Date): boolean {
  if (auction.available === false) {
    return false;
  }

  const currentPhase = auction.currentPhase;
  if (!currentPhase) {
    return false;
  }

  // Online Sales and Direct Online Sales auctions are always active (they're like real estate listings)
  if (
    currentPhase.modality === PhaseModality.ONLINE_SALES ||
    currentPhase.modality === PhaseModality.DIRECT_ONLINE_SALES
  ) {
    return true;
  }

  // Check if any phase date is still ahead
  const phaseDates = currentPhase.phaseDates ?? [];
  return phaseDates.some((date) => new Date(date).getTime() >= now.getTime());
}
