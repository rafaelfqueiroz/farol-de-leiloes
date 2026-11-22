'use client';

import Box from '@mui/material/Box';
import MuiLink from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@mui/utils';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import DateText from '@/app/components/patterns/DateText';
import { LEGAL_PATHS, type CurrentLegal } from '@/lib/legal';
import type { Acceptance } from './privacy-api';
import PrivacySection from './PrivacySection';

export interface AcceptancesSectionProps {
  /** Newest first, as the API answers (BR-010-04). */
  acceptances: readonly Acceptance[];
  /** The versions in force: the API says which of THEM is a draft (older ones carry no flag). */
  current: CurrentLegal | null;
}

// SPEC-010 BR-010-04 (frame "Aceites"): which versions of which document the account accepted, when
// and how. Dates are in Brasília time, stated once in the column header and the section line
// (BR-003-23). A table from `sm` up, cards on a phone (DS-13): no horizontal scroll at 360 px.
export default function AcceptancesSection({ acceptances, current }: AcceptancesSectionProps) {
  const t = useTranslations('privacy.acceptances');

  const isDraft = (acceptance: Acceptance): boolean => {
    const document = current?.[acceptance.documentType];
    return document !== undefined && document.version === acceptance.version && document.draft;
  };
  const row = (acceptance: Acceptance) => ({
    key: `${acceptance.documentType}-${acceptance.version}-${acceptance.acceptedAt}`,
    document: t(`documents.${acceptance.documentType}`),
    version: t('version', { version: acceptance.version, draft: String(isDraft(acceptance)) }),
    method: t(`methods.${acceptance.method}`),
    acceptedAt: acceptance.acceptedAt,
  });
  const rows = acceptances.map(row);

  return (
    <PrivacySection title={t('title')} description={t('description')}>
      {rows.length === 0 ? (
        <Typography variant="body2">{t('empty')}</Typography>
      ) : (
        <>
          <Box
            sx={{
              display: { xs: 'none', sm: 'block' },
              overflowX: 'auto',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            <Table size="small">
              <Box component="caption" sx={visuallyHidden}>
                {t('caption')}
              </Box>
              <TableHead>
                <TableRow>
                  <TableCell scope="col">{t('columns.document')}</TableCell>
                  <TableCell scope="col">{t('columns.version')}</TableCell>
                  <TableCell scope="col">{t('columns.acceptedAt')}</TableCell>
                  <TableCell scope="col">{t('columns.method')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.key}>
                    <TableCell>{item.document}</TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {item.version}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <DateText value={item.acceptedAt} withTime zoneMarker={false} />
                    </TableCell>
                    <TableCell>{item.method}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Stack
            component="ul"
            spacing={1}
            sx={{ display: { xs: 'flex', sm: 'none' }, m: 0, p: 0, listStyle: 'none' }}
          >
            {rows.map((item) => (
              <Box
                component="li"
                key={item.key}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  px: 2,
                  py: 1.5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                }}
              >
                <Stack
                  direction="row"
                  sx={{ justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
                >
                  <Typography variant="subtitle2" component="span">
                    {item.document}
                  </Typography>
                  <Typography variant="caption" component="span" sx={{ color: 'text.secondary' }}>
                    {item.version}
                  </Typography>
                </Stack>
                <Stack
                  direction="row"
                  sx={{ justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
                >
                  <Typography variant="body2" component="span">
                    <DateText value={item.acceptedAt} withTime zoneMarker={false} />
                  </Typography>
                  <Typography variant="caption" component="span" sx={{ color: 'text.secondary' }}>
                    {item.method}
                  </Typography>
                </Stack>
              </Box>
            ))}
          </Stack>
        </>
      )}
      <Stack
        component="nav"
        aria-label={t('links')}
        direction="row"
        useFlexGap
        sx={{ flexWrap: 'wrap', columnGap: 2 }}
      >
        <MuiLink component={Link} href={LEGAL_PATHS.terms} underline="always" variant="caption">
          {t('documents.terms')}
        </MuiLink>
        <MuiLink component={Link} href={LEGAL_PATHS.privacy} underline="always" variant="caption">
          {t('documents.privacy')}
        </MuiLink>
      </Stack>
    </PrivacySection>
  );
}
