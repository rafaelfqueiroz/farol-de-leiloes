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
  // SPEC-012 BR-012-09: returning from the checkout grants nothing and the page never leaves by
  // itself. Without a `ref` it says it cannot find the payment; with a ref no account owns, the
  // status call is the shared 404 and the page says it could not verify (its error state). The
  // waiting and confirmed states need a checkout the provider confirmed, which the stack's fake
  // gateway never produces: they are the component tests' (page.test.tsx).
  {
    name: 'plans success without a ref',
    path: '/plans/success',
    as: 'public',
    heading: 'Não encontramos este pagamento',
  },
  {
    name: 'plans success with a ref nobody owns',
    path: '/plans/success?ref=64b7f0000000000000000fff',
    as: 'investor',
    heading: 'Não foi possível verificar o pagamento',
    landsOn: '/plans/success',
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
  // SPEC-012 owner decision 11: the plans page is public (a visitor sees the catalogue, seeded in
  // the stack) and the same page serves a signed-in account without an office.
  { name: 'plans (visitor)', path: '/plans', as: 'public', heading: 'Planos' },
  { name: 'plans (signed in)', path: '/plans', as: 'investor', heading: 'Planos' },
  // The office plan needs an account that is an office member, and offices exist only once SPEC-011
  // lands (nothing in the stack may invent one). The seeded investor has none, so the route is
  // checked in its empty state ("Você ainda não tem um escritório", the API's FORBIDDEN); every
  // state with a plan is covered by the component tests (OfficePlanPage.test.tsx).
  {
    name: 'office plan (no office)',
    path: '/office/plan',
    as: 'investor',
    heading: 'Plano do escritório',
  },
  { name: 'profile', path: '/profile', as: 'investor', heading: 'Meu perfil' },
  // SPEC-010: the rights page of the signed-in account, and the two public documents (the title is
  // the API's own) and the screen the account lands on once it is closed.
  {
    name: 'privacy and data',
    path: '/profile/privacidade',
    as: 'investor',
    heading: 'Privacidade e dados',
  },
  { name: 'terms of use', path: '/termos', as: 'public', heading: 'Termos de Uso' },
  {
    name: 'privacy policy',
    path: '/privacidade',
    as: 'public',
    heading: 'Política de Privacidade',
  },
  {
    name: 'account closed',
    path: '/conta-encerrada',
    as: 'public',
    heading: 'Sua conta foi encerrada',
  },
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
