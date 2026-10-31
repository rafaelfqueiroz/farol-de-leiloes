import { getRequestConfig } from 'next-intl/server';
import messages from '@/messages/pt-BR.json';
import { LOCALE, TIME_ZONE } from './config';

// Single locale, no i18n routing: every request gets the pt-BR catalogue.
export default getRequestConfig(async () => ({
  locale: LOCALE,
  timeZone: TIME_ZONE,
  messages,
}));
