import type messages from '@/messages/pt-BR.json';
import type { LOCALE } from './config';

// Typed catalogue: a key missing from pt-BR.json is a compile error (DS-20).
declare module 'next-intl' {
  interface AppConfig {
    Locale: typeof LOCALE;
    Messages: typeof messages;
  }
}
