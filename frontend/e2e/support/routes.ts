// Every route of the app (TS-23, BR-003-14, BR-003-17), with who opens it and what must be on
// screen when the checks run. A new page adds itself here, so axe and the 360 px check cover it
// from its first PR.
//
// `heading` and `landsOn` make a silent redirect fail the case (TS-21): a page that sends the
// visitor elsewhere would otherwise have axe and the 360 px check run on the wrong page.
import { BRASILIA_TEN_AM_AUCTION } from './accounts';

export type Audience = 'public' | 'investor' | 'admin' | 'unverified';

export interface AppRoute {
  /** The path opened. */
  path: string;
  /** Who is signed in when it is opened. */
  as: Audience;
  /** Shown in the test name. */
  name: string;
  /** The accessible name of the intended page's heading (pt-BR catalogue). */
  heading: string;
  /** The pathname the checks must run on; `path` unless the route redirects by design. */
  landsOn?: string;
  /** Hold the page's timers while it loads, for a page that moves on by itself after a delay. */
  pauseClock?: boolean;
}

export const ROUTES: readonly AppRoute[] = [
  {
    name: 'landing',
    path: '/',
    as: 'public',
    heading: 'Encontre o imóvel dos seus sonhos com até 70% de desconto',
  },
  { name: 'login', path: '/login', as: 'public', heading: 'Entrar' },
  { name: 'register', path: '/register', as: 'public', heading: 'Criar conta' },
  {
    name: 'reset-password request',
    path: '/reset-password',
    as: 'public',
    heading: 'Redefinir Senha',
  },
  {
    name: 'reset-password with token',
    path: '/reset-password/e2e-invalid-token',
    as: 'public',
    heading: 'Nova Senha',
  },
  // An unknown token: the error state of the confirmation page.
  {
    name: 'verify-email with token',
    path: '/verify-email/e2e-invalid-token',
    as: 'public',
    heading: 'Erro na verificação',
  },
  // Google sign-in's landing: with no token it sends the visitor to /login, by design.
  {
    name: 'auth callback without token',
    path: '/auth/callback',
    as: 'public',
    heading: 'Entrar',
    landsOn: '/login',
  },
  // Sends the visitor to /search after 5 s, so its timers are frozen until it has loaded.
  {
    name: 'plans success',
    path: '/plans/success',
    as: 'public',
    heading: 'Assinatura realizada com sucesso!',
    pauseClock: true,
  },
  { name: 'plans cancel', path: '/plans/cancel', as: 'public', heading: 'Pagamento cancelado' },
  {
    name: 'property page',
    path: `/auction/${BRASILIA_TEN_AM_AUCTION}`,
    as: 'public',
    heading: 'Casa de referência E2E em Bairro 1, Rio de Janeiro/RJ',
  },
  {
    name: 'property not found',
    path: '/auction/0000000000000',
    as: 'public',
    heading: 'Imóvel indisponível',
  },
  {
    name: 'not found',
    path: '/pagina-que-nao-existe',
    as: 'public',
    heading: 'Página não encontrada',
  },
  // /search is signed-in only today; SPEC-005 (#5) opens it to the public.
  { name: 'search', path: '/search', as: 'investor', heading: 'Busca de imóveis' },
  { name: 'plans', path: '/plans', as: 'investor', heading: 'Planos' },
  { name: 'profile', path: '/profile', as: 'investor', heading: 'Meu Perfil' },
  { name: 'reminders', path: '/reminders', as: 'investor', heading: 'Meus Lembretes' },
  { name: 'support', path: '/support', as: 'investor', heading: 'Suporte' },
  // A verified account is sent to /, so this one is the seeded unverified account.
  {
    name: 'verify-email (signed in, unverified)',
    path: '/verify-email',
    as: 'unverified',
    heading: 'Verifique seu e-mail',
  },
  { name: 'admin coupons', path: '/admin/coupons', as: 'admin', heading: 'Gerenciar Cupons' },
];
