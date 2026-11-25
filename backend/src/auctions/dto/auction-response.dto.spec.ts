// SPEC-004 BR-004-14, BR-004-16, AR-17, AR-36: the read-time fields leave the API as the additive
// `available`, `active`, `currentMinimumPrice` and `discountPercent`, money and percent as strings.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toAuction } from '../auction.mapper.js';
import { AuctionResponseDto } from './auction-response.dto.js';

const d128 = (value: string) => Types.Decimal128.fromString(value);
const phase = { modality: 'SFI_AUCTION' as never, minimumPrice: d128('150000') };
const stored = {
  code: 'A1',
  appraisalPrice: d128('200000'),
  phases: [phase],
  currentPhase: phase,
  rounds: [
    { label: '1º Leilão', minimumPrice: d128('150000'), date: new Date('2026-03-10T13:00:00Z') },
    { label: '2º Leilão', minimumPrice: d128('120000.5'), date: new Date('2026-03-16T13:00:00Z') },
  ],
  propertyType: 'Casa',
  updatedAt: new Date('2026-03-01T00:00:00Z'),
};

describe('AuctionResponseDto read-time fields', () => {
  it('answers the current price and discount as strings with two places, and the flags', () => {
    const dto = new AuctionResponseDto(toAuction(stored, new Date('2026-03-10T13:00:00Z')));

    expect(dto).toMatchObject({
      available: true,
      active: true,
      currentMinimumPrice: '120000.50',
      discountPercent: '40.00', // (200000 - 120000.5) / 200000 = 39.99975%, half-even to 2 places (AR-19)
      propertyType: 'Casa',
    });
  });

  it('answers a negative discount as it is, and null for what is unknown', () => {
    const dear = new AuctionResponseDto(
      toAuction({ ...stored, rounds: undefined, appraisalPrice: d128('100000') }, new Date()),
    );
    const bare = new AuctionResponseDto(
      toAuction({ code: 'A2', updatedAt: stored.updatedAt }, new Date()),
    );

    expect(dear.discountPercent).toBe('-50.00');
    expect(bare).toMatchObject({ currentMinimumPrice: null, discountPercent: null, active: true });
  });

  it('says a gone property is not available and not active', () => {
    const dto = new AuctionResponseDto(
      toAuction({ ...stored, available: false }, new Date('2026-03-01T00:00:00Z')),
    );

    expect(dto).toMatchObject({ available: false, active: false });
  });
});
