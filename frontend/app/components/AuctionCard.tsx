'use client';

import { Card, CardContent, Box, Typography, Chip, IconButton } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import { useTranslations } from 'next-intl';
import ReminderButton from './ReminderButton';
import Money from './patterns/Money';
import DateText from './patterns/DateText';
import type { Auction, AuctionPhase } from '@/lib/auction';
import { instantToWallClock, parseDate, relativeParts, wallClockToCalendar } from '@/lib/dates';

interface AuctionCardProps {
  auction: Auction;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  detailUrl: string;
  showDate?: boolean;
  /** The clock for the countdown chip; injectable so tests do not depend on today. */
  now?: Date;
}

const MODALITIES = ['SFI_AUCTION', 'OPEN_BIDDING', 'DIRECT_ONLINE_SALES', 'ONLINE_SALES'] as const;
const PAYMENT_METHODS = ['OWN_RESOURCES', 'FGTS', 'FINANCING'] as const;

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

/**
 * DS-28: one wording for the modalidade and the payment methods, shared by the card and the
 * detail page. A code the catalogue does not know shows as it came from Caixa.
 */
export function useAuctionLabels() {
  const t = useTranslations('auctionCard');
  return {
    modality: (value: string) => (isOneOf(MODALITIES, value) ? t(`modality.${value}`) : value),
    paymentMethod: (value: string) =>
      isOneOf(PAYMENT_METHODS, value) ? t(`paymentMethod.${value}`) : value,
  };
}

// decoration, not copy (DS-20): hidden from assistive technology
const APPRAISAL_ICON = '💰';
const MINIMUM_BID_ICON = '🏷️';
const DATE_ICON = '📅';
const PHASES_ICON = '📊';
const OPENS_ICON = '↗';

export type Countdown = { kind: 'today' } | { kind: 'tomorrow' } | { kind: 'days'; count: number };

/** The Brasília calendar day (YYYY-MM-DD) an ISO instant falls on (AR-23). */
function brasiliaDay(value: string): string {
  return parseDate(value).kind === 'calendar'
    ? value
    : wallClockToCalendar(instantToWallClock(value));
}

/**
 * Days from `now` to the nearest phase date that is today or later, counted in Brasília calendar
 * days (AR-23) through `relativeParts`. A date that cannot be read is skipped.
 */
export function getCountdown(currentPhase: AuctionPhase | undefined, now: Date): Countdown | null {
  if (!currentPhase) return null;
  if (currentPhase.modality === 'DIRECT_ONLINE_SALES') return null;

  let nearest: number | null = null;
  for (const value of currentPhase.phaseDates ?? []) {
    let parts;
    try {
      parts = relativeParts(brasiliaDay(value), now);
    } catch (error: unknown) {
      if (error instanceof RangeError) continue;
      throw error;
    }
    if (parts.direction === 'past') continue;
    if (nearest === null || parts.count < nearest) nearest = parts.count;
  }

  if (nearest === null) return null;
  if (nearest === 0) return { kind: 'today' };
  if (nearest === 1) return { kind: 'tomorrow' };
  return { kind: 'days', count: nearest };
}

export default function AuctionCard({
  auction,
  isFavorite,
  onToggleFavorite,
  detailUrl,
  showDate = false,
  now,
}: AuctionCardProps) {
  const t = useTranslations('auctionCard');
  const labels = useAuctionLabels();
  const lastPhase = auction.phases[auction.phases.length - 1];
  const countdown = getCountdown(auction.currentPhase ?? lastPhase, now ?? new Date());
  const address = [
    auction.address.street,
    auction.address.neighborhood,
    auction.address.city,
    auction.address.state,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card
      sx={{
        transition: 'all 0.3s',
        '&:hover': {
          boxShadow: 4,
          transform: 'translateY(-2px)',
        },
      }}
    >
      {/* Property Image */}
      <Box
        sx={{
          width: '100%',
          height: 200,
          overflow: 'hidden',
          backgroundColor: 'background.muted',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {countdown && (
          <Chip
            label={
              countdown.kind === 'days'
                ? t('countdown.days', { count: countdown.count })
                : t(`countdown.${countdown.kind}`)
            }
            size="small"
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 1,
              fontWeight: 600,
              fontSize: '0.75rem',
              backgroundColor: countdown.kind === 'today' ? 'success.soft' : 'background.muted',
              color: countdown.kind === 'today' ? 'success.main' : 'text.primary',
            }}
          />
        )}
        {auction.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Caixa-hosted photos on hosts we do not control: next/image would route them through our optimizer (SC-24) and needs every host allow-listed
          <img
            src={auction.imageUrl}
            alt={auction.title || t('property')}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const parent = e.currentTarget.parentElement;
              if (parent) {
                const placeholder = parent.querySelector('.placeholder-text');
                if (placeholder) {
                  (placeholder as HTMLElement).style.display = 'flex';
                }
              }
            }}
          />
        ) : null}
        <Box
          className="placeholder-text"
          sx={{
            display: auction.imageUrl ? 'none' : 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
            position: 'absolute',
            inset: 0,
          }}
        >
          <HomeIcon sx={{ fontSize: 48, mb: 1, opacity: 0.7 }} />
          <Typography variant="body2" color="text.secondary">
            {t('noImage')}
          </Typography>
        </Box>
      </Box>

      <CardContent>
        {/* Header with Title, Modality and Actions */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5, fontSize: '1rem' }}>
              {auction.title || t('untitled')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('code', { code: auction.code })}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {lastPhase && (
              <Chip label={labels.modality(lastPhase.modality)} size="small" color="primary" />
            )}
            <IconButton
              onClick={onToggleFavorite}
              size="small"
              sx={{
                color: isFavorite ? 'error.main' : 'action.active',
                '&:hover': {
                  color: 'error.main',
                },
              }}
              title={isFavorite ? t('favorite.remove') : t('favorite.add')}
            >
              {isFavorite ? <FavoriteIcon /> : <FavoriteBorderIcon />}
            </IconButton>
            <ReminderButton
              auctionCode={auction.code}
              auctionTitle={auction.title}
              auctionDate={lastPhase?.date}
            />
          </Box>
        </Box>

        {/* Property Details */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <HomeIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.25 }} />
            <Typography variant="body2" color="text.primary">
              {address || t('addressMissing')}
            </Typography>
          </Box>

          {auction.appraisalPrice !== null && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                <span aria-hidden>{APPRAISAL_ICON}</span> {t('labelled', { label: t('appraisal') })}
              </Typography>
              <Typography variant="body2" fontWeight={600} color="text.primary">
                <Money value={auction.appraisalPrice} />
              </Typography>
            </Box>
          )}

          {lastPhase?.minimumPrice != null && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                <span aria-hidden>{MINIMUM_BID_ICON}</span>{' '}
                {t('labelled', { label: t('minimumBid') })}
              </Typography>
              <Typography variant="body2" fontWeight={600} color="text.primary">
                <Money value={lastPhase.minimumPrice} />
              </Typography>
            </Box>
          )}

          {showDate && lastPhase?.date && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                <span aria-hidden>{DATE_ICON}</span> {t('labelled', { label: t('date') })}
              </Typography>
              <Typography variant="body2" fontWeight={600} color="text.primary">
                <DateText value={lastPhase.date} />
              </Typography>
            </Box>
          )}

          {auction.phases.length > 1 && (
            <Typography variant="caption" color="text.secondary">
              <span aria-hidden>{PHASES_ICON}</span>{' '}
              {t('phasesRegistered', { count: auction.phases.length })}
            </Typography>
          )}
        </Box>

        {/* Details Link */}
        <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Typography
            component="a"
            href={detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            fontWeight={500}
            sx={{
              color: 'primary.main',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              '&:hover': {
                color: 'primary.dark',
                textDecoration: 'underline',
              },
            }}
          >
            {t('viewDetails')}
            <span aria-hidden style={{ fontSize: '0.75rem' }}>
              {OPENS_ICON}
            </span>
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
