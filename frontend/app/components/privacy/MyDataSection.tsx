'use client';

import Box from '@mui/material/Box';
import MuiLink from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import KeyFactsGrid, { type KeyFact } from '@/app/components/patterns/KeyFactsGrid';
import { formatCount } from '@/lib/numbers';
import { formatPhone } from '@/lib/phone';
import type { CountedSection, MyDataSummary } from './privacy-api';
import PrivacySection from './PrivacySection';

// SPEC-010 BR-010-08, BR-010-12 (frame "Seus dados"): what the platform holds about the account,
// with counts. The view is bounded: a list that was cut says so and points to the export, which has
// everything (BR-010-09). Corrections: name and phone in the profile; anything else by a support
// request (the e-mail never changes, D-63). SC-15: this page renders the data and logs none of it.
export default function MyDataSection({ data }: { data: MyDataSummary }) {
  const t = useTranslations('privacy.myData');
  const tCommon = useTranslations('common');

  const count = (section: CountedSection) =>
    section.truncated
      ? t('truncated', { shown: formatCount(section.shown), total: formatCount(section.total) })
      : formatCount(section.total);

  const facts: KeyFact[] = [
    { id: 'name', label: t('name'), value: data.name ?? tCommon('notInformed') },
    { id: 'email', label: t('email'), value: data.email ?? tCommon('notInformed') },
    {
      id: 'phone',
      label: t('phone'),
      value: data.phone ? formatPhone(data.phone) : tCommon('notInformed'),
    },
    {
      id: 'signIn',
      label: t('signIn'),
      value:
        data.signInMethods.length > 0
          ? data.signInMethods
              .map((method) => t(`methods.${method === 'google' ? 'google' : 'password'}`))
              .join(', ')
          : tCommon('notInformed'),
    },
    { id: 'favorites', label: t('favorites'), value: count(data.favorites) },
    { id: 'savedFilters', label: t('savedFilters'), value: count(data.savedFilters) },
    { id: 'reminders', label: t('reminders'), value: count(data.reminders) },
    { id: 'notificationLogs', label: t('notificationLogs'), value: count(data.notificationLogs) },
  ];

  return (
    <PrivacySection
      title={t('title')}
      description={t.rich('description', {
        profile: (chunks) => (
          <MuiLink component={Link} href="/profile" underline="always">
            {chunks}
          </MuiLink>
        ),
        support: (chunks) => (
          <MuiLink component={Link} href="/support" underline="always">
            {chunks}
          </MuiLink>
        ),
      })}
    >
      <KeyFactsGrid facts={facts} />
      <Box>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('footnote')}
        </Typography>
      </Box>
    </PrivacySection>
  );
}
