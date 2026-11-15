// Every route of the app (TS-23, BR-003-14, BR-003-17), with who can open it. A new page adds
// itself here, so axe and the 360 px check cover it from its first PR.
import { BRASILIA_TEN_AM_AUCTION } from './accounts';

export type Audience = 'public' | 'investor' | 'admin';

export interface AppRoute {
  /** The path opened. */
  path: string;
  /** Who is signed in when it is opened. */
  as: Audience;
  /** Shown in the test name. */
  name: string;
}

export const ROUTES: readonly AppRoute[] = [
  { name: 'landing', path: '/', as: 'public' },
  { name: 'login', path: '/login', as: 'public' },
  { name: 'register', path: '/register', as: 'public' },
  { name: 'reset-password request', path: '/reset-password', as: 'public' },
  { name: 'reset-password with token', path: '/reset-password/e2e-invalid-token', as: 'public' },
  { name: 'verify-email with token', path: '/verify-email/e2e-invalid-token', as: 'public' },
  // Google sign-in's landing: with no token it sends the visitor to /login.
  { name: 'auth callback', path: '/auth/callback', as: 'public' },
  { name: 'plans success', path: '/plans/success', as: 'public' },
  { name: 'plans cancel', path: '/plans/cancel', as: 'public' },
  { name: 'property page', path: `/auction/${BRASILIA_TEN_AM_AUCTION}`, as: 'public' },
  { name: 'property not found', path: '/auction/0000000000000', as: 'public' },
  { name: 'not found', path: '/pagina-que-nao-existe', as: 'public' },
  // /search is signed-in only today; SPEC-005 (#5) opens it to the public.
  { name: 'search', path: '/search', as: 'investor' },
  { name: 'plans', path: '/plans', as: 'investor' },
  { name: 'profile', path: '/profile', as: 'investor' },
  { name: 'reminders', path: '/reminders', as: 'investor' },
  { name: 'support', path: '/support', as: 'investor' },
  { name: 'verify-email (signed in, verified)', path: '/verify-email', as: 'investor' },
  { name: 'admin coupons', path: '/admin/coupons', as: 'admin' },
];
