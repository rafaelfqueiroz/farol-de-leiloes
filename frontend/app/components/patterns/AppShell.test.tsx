import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import RequireAuthentication from '@/app/components/RequireAuthentication';
import AppShell, { MAIN_CONTENT_ID, RAIL_PINNED_STORAGE_KEY } from './AppShell';

// Next's router and the app's contexts have no port to fake (TS-03); these mocks stand in for
// them. The theme and the pt-BR catalogue are the real ones (TS-19).
const env = vi.hoisted(() => ({
  pathname: '/search',
  search: '',
  push: vi.fn(),
  auth: {} as Record<string, unknown>,
  // a tiny store, so a change of auth (sign-out) re-renders like the real context does
  listeners: new Set<() => void>(),
  setAuth(next: Record<string, unknown>) {
    this.auth = next;
    this.listeners.forEach((listener) => listener());
  },
  favorites: { favorites: [] as unknown[], loading: false },
  reminders: { reminders: [] as { status: string }[], loading: false },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => env.pathname,
  useSearchParams: () => new URLSearchParams(env.search),
  useRouter: () => ({ push: env.push }),
}));

// a plain anchor: jsdom cannot navigate, and the shell only needs the href and the click
vi.mock('next/link', async () => {
  const { createElement, forwardRef } = await import('react');
  type AnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
  const MockLink = forwardRef<HTMLAnchorElement, AnchorProps>(function MockLink(
    { onClick, ...props },
    ref,
  ) {
    return createElement('a', {
      ...props,
      ref,
      onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onClick?.(event);
      },
    });
  });
  return { default: MockLink };
});

vi.mock('@/app/contexts/AuthContext', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    env.listeners.add(listener);
    return () => env.listeners.delete(listener);
  };
  return { useAuth: () => useSyncExternalStore(subscribe, () => env.auth) };
});
vi.mock('@/app/contexts/FavoritesContext', () => ({ useFavorites: () => env.favorites }));
vi.mock('@/app/contexts/RemindersContext', () => ({ useReminders: () => env.reminders }));

type Role = 'free' | 'standard' | 'premium' | 'admin';

const logout = vi.fn(async () => signOut());

// TS-27: obviously fake people
function signIn(role: Role) {
  env.setAuth({
    user: { _id: 'user-1', name: 'Ana Teste', email: 'ana@exemplo.test', role },
    loading: false,
    isAuthenticated: true,
    role,
    hasSubscription: role !== 'free',
    logout,
  });
}

function signOut() {
  env.setAuth({
    user: null,
    loading: false,
    isAuthenticated: false,
    role: '',
    hasSubscription: false,
    logout,
  });
}

function setCounts({
  favorites = 0,
  reminders = 0,
  loading = false,
}: {
  favorites?: number;
  reminders?: number;
  loading?: boolean;
}) {
  env.favorites = { favorites: Array.from({ length: favorites }, () => ({})), loading };
  env.reminders = {
    // only PENDING ones are upcoming
    reminders: [
      ...Array.from({ length: reminders }, () => ({ status: 'PENDING' })),
      { status: 'SENT' },
    ],
    loading,
  };
}

// Breakpoints (tokens): md 900, lg 1200. useMediaQuery reads matchMedia.
const originalMatchMedia = window.matchMedia;
function setViewport(width: number) {
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const matches =
      (min !== null || max !== null) &&
      (min === null || width >= Number(min[1])) &&
      (max === null || width <= Number(max[1]));
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}

const DESKTOP = 1280;
const RAIL = 1000;
const PHONE = 360;

function renderShell(scheme: 'light' | 'dark' = 'light') {
  return renderWithProviders(
    <AppShell>
      <h1>Conteúdo da página</h1>
    </AppShell>,
    { scheme },
  );
}

const mainNav = () => screen.getByRole('navigation', { name: 'Principal' });
const groupLabels = (scope: HTMLElement) =>
  within(scope)
    .queryAllByText(/^(Busca|Acompanhamento|Escritório|Conta|Administração)$/)
    .map((element) => element.textContent);
const linkNames = (scope: HTMLElement) =>
  within(scope)
    .getAllByRole('link')
    .map((link) => link.getAttribute('aria-label') ?? link.textContent);

beforeEach(() => {
  env.pathname = '/search';
  env.search = '';
  env.push.mockReset();
  env.listeners.clear();
  logout.mockClear();
  setCounts({});
  signIn('admin');
  window.localStorage.clear();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('AppShell — accessibility (TS-19, DS-22)', () => {
  it.each(['light', 'dark'] as const)('passes axe with the desktop sidebar (%s)', async (scheme) => {
    setViewport(DESKTOP);
    setCounts({ favorites: 24, reminders: 3 });
    const { container } = renderShell(scheme);

    expect(mainNav()).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(['light', 'dark'] as const)('passes axe with the md–lg rail (%s)', async (scheme) => {
    setViewport(RAIL);
    setCounts({ favorites: 24, reminders: 3 });
    const { container } = renderShell(scheme);

    expect(screen.getByRole('button', { name: 'Expandir menu' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(['light', 'dark'] as const)('passes axe with the phone drawer open (%s)', async (scheme) => {
    setViewport(PHONE);
    const user = userEvent.setup();
    renderShell(scheme);

    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(await screen.findByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it.each([
    ['light', DESKTOP],
    ['dark', DESKTOP],
    ['light', PHONE],
    ['dark', PHONE],
  ] as const)('passes axe in guest mode (%s, %ipx)', async (scheme, width) => {
    setViewport(width);
    signOut();
    const { container } = renderShell(scheme);

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('AppShell — frame', () => {
  it('starts with the skip link and puts the page in the one <main>', async () => {
    setViewport(DESKTOP);
    const user = userEvent.setup();
    renderShell();

    await user.tab();
    const skip = screen.getByRole('link', { name: 'Pular para o conteúdo' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`);
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', MAIN_CONTENT_ID);
    expect(within(main).getByRole('heading', { name: 'Conteúdo da página' })).toBeInTheDocument();
  });

  it('links the logo home, with mark and lockup both in the markup (no swap after mount)', () => {
    setViewport(DESKTOP);
    renderShell();

    // a theme-breakpoint display shows one of them in the browser (not measurable in jsdom)
    const links = screen.getAllByRole('link', { name: 'Farol dos Leilões, início', hidden: true });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/');
  });

  it('opens the theme control from the top bar', async () => {
    setViewport(DESKTOP);
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Tema' }));
    const group = await screen.findByRole('group', { name: 'Tema' });
    for (const name of ['Claro', 'Escuro', 'Sistema']) {
      expect(within(group).getByRole('button', { name })).toBeInTheDocument();
    }
  });
});

describe('AppShell — navigation by role', () => {
  it.each([
    ['free', ['Busca', 'Conta'], ['Buscar imóveis', 'Perfil', 'Assinatura', 'Suporte']],
    [
      'standard',
      ['Busca', 'Acompanhamento', 'Conta'],
      ['Buscar imóveis', 'Favoritos', 'Lembretes', 'Perfil', 'Assinatura', 'Suporte'],
    ],
    [
      'premium',
      ['Busca', 'Acompanhamento', 'Conta'],
      ['Buscar imóveis', 'Favoritos', 'Lembretes', 'Perfil', 'Assinatura', 'Suporte'],
    ],
    [
      'admin',
      ['Busca', 'Acompanhamento', 'Conta', 'Administração'],
      ['Buscar imóveis', 'Favoritos', 'Lembretes', 'Perfil', 'Assinatura', 'Suporte', 'Cupons'],
    ],
  ] as const)('shows %s its groups and destinations in the fixed order', (role, groups, links) => {
    setViewport(DESKTOP);
    signIn(role);
    renderShell();

    const nav = mainNav();
    // Escritório has no destination yet, so its label never renders
    expect(groupLabels(nav)).toEqual(groups);
    expect(linkNames(nav)).toEqual(links);
  });

  it('shows the reminders shortcut in the top bar only from standard', () => {
    setViewport(DESKTOP);
    signIn('free');
    const { unmount } = renderShell();
    const banner = () => screen.getByRole('banner');
    expect(within(banner()).queryByRole('link', { name: /^Lembretes/ })).not.toBeInTheDocument();
    unmount();

    signIn('standard');
    renderShell();
    expect(within(banner()).getByRole('link', { name: /^Lembretes/ })).toHaveAttribute(
      'href',
      '/reminders',
    );
  });

  it.each([
    ['/search', '', 'Buscar imóveis'],
    ['/search', 'view=favorites', 'Favoritos'],
    ['/admin/coupons/novo', '', 'Cupons'],
    ['/auction/1444419920935', '', 'Buscar imóveis'],
    ['/plans', '', 'Assinatura'],
  ])('marks the current item for %s?%s', (pathname, search, current) => {
    setViewport(DESKTOP);
    env.pathname = pathname;
    env.search = search;
    renderShell();

    const links = within(mainNav()).getAllByRole('link');
    const marked = links.filter((link) => link.getAttribute('aria-current') === 'page');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent(current);
  });
});

describe('AppShell — counts', () => {
  it('shows no pill while the counts load', () => {
    setViewport(DESKTOP);
    setCounts({ favorites: 5, reminders: 2, loading: true });
    renderShell();

    const favorites = within(mainNav()).getByRole('link', { name: 'Favoritos' });
    expect(favorites).toHaveTextContent(/^Favoritos$/);
    expect(within(mainNav()).getByRole('link', { name: 'Lembretes' })).toHaveTextContent(
      /^Lembretes$/,
    );
  });

  it('shows neutral pills, with 99+ above 99, and names the count', () => {
    setViewport(DESKTOP);
    setCounts({ favorites: 24, reminders: 150 });
    renderShell();

    const nav = mainNav();
    expect(within(nav).getByRole('link', { name: 'Favoritos, 24' })).toHaveTextContent('24');
    const reminders = within(nav).getByRole('link', { name: 'Lembretes, 150 próximos' });
    expect(within(reminders).getByText('99+')).toBeInTheDocument();
  });

  it('shows no pill for zero (also what a failed load leaves)', () => {
    setViewport(DESKTOP);
    setCounts({ favorites: 0, reminders: 0 });
    renderShell();

    expect(within(mainNav()).getByRole('link', { name: 'Favoritos' })).toHaveTextContent(
      /^Favoritos$/,
    );
  });
});

describe('AppShell — rail (md–lg)', () => {
  it('shows icons named by aria-label, with no group labels, and a tooltip on hover', async () => {
    setViewport(RAIL);
    setCounts({ favorites: 3 });
    const user = userEvent.setup();
    renderShell();

    const nav = mainNav();
    expect(groupLabels(nav)).toEqual([]);
    const favorites = within(nav).getByRole('link', { name: 'Favoritos, 3' });
    expect(within(nav).getByRole('link', { name: 'Buscar imóveis' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await user.hover(favorites);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Favoritos');
  });

  it('pins the full sidebar open, persists the choice and collapses again', async () => {
    setViewport(RAIL);
    const user = userEvent.setup();
    const { unmount } = renderShell();

    // the label carries the state: no aria-pressed on a button whose name changes
    const expand = screen.getByRole('button', { name: 'Expandir menu' });
    expect(expand).not.toHaveAttribute('aria-pressed');
    await user.click(expand);

    const collapse = screen.getByRole('button', { name: 'Recolher menu' });
    expect(collapse).not.toHaveAttribute('aria-pressed');
    expect(groupLabels(mainNav())).toEqual(['Busca', 'Acompanhamento', 'Conta', 'Administração']);
    expect(window.localStorage.getItem(RAIL_PINNED_STORAGE_KEY)).toBe('true');

    unmount();
    renderShell();
    expect(await screen.findByRole('button', { name: 'Recolher menu' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Recolher menu' }));
    expect(screen.getByRole('button', { name: 'Expandir menu' })).toBeInTheDocument();
    expect(window.localStorage.getItem(RAIL_PINNED_STORAGE_KEY)).toBe('false');
  });

  it('still pins when storage throws', async () => {
    setViewport(RAIL);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Expandir menu' }));
    expect(screen.getByRole('button', { name: 'Recolher menu' })).toBeInTheDocument();
  });

  it('has no pin control from lg: the sidebar is always open', () => {
    setViewport(DESKTOP);
    renderShell();

    expect(screen.queryByRole('button', { name: 'Expandir menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recolher menu' })).not.toBeInTheDocument();
  });
});

describe('AppShell — phone drawer', () => {
  it('opens the same list, focuses "Fechar menu", closes on Esc and returns focus', async () => {
    setViewport(PHONE);
    const user = userEvent.setup();
    renderShell();

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    const menuButton = screen.getByRole('button', { name: 'Abrir menu' });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton).toHaveAttribute('aria-controls', 'app-shell-drawer');

    await user.click(menuButton);
    const dialog = await screen.findByRole('dialog', { name: 'Menu' });
    expect(dialog).toHaveAttribute('id', 'app-shell-drawer');
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Fechar menu' })).toHaveFocus());
    const nav = within(dialog).getByRole('navigation', { name: 'Principal' });
    expect(groupLabels(nav)).toEqual(['Busca', 'Acompanhamento', 'Conta', 'Administração']);

    // focus stays inside: Shift+Tab from the first control wraps within the drawer
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(menuButton).toHaveFocus();
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when a destination is chosen', async () => {
    setViewport(PHONE);
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Menu' });
    await user.click(within(dialog).getByRole('link', { name: 'Perfil' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the free role no reminders shortcut and no Favoritos', async () => {
    setViewport(PHONE);
    signIn('free');
    const user = userEvent.setup();
    renderShell();

    expect(screen.queryByRole('link', { name: /^Lembretes/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Menu' });
    expect(linkNames(within(dialog).getByRole('navigation'))).toEqual([
      'Buscar imóveis',
      'Perfil',
      'Assinatura',
      'Suporte',
    ]);
  });
});

describe('AppShell — account menu', () => {
  it('shows name, email and plan, then Perfil, Assinatura and Sair', async () => {
    setViewport(DESKTOP);
    signIn('premium');
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Conta de Ana Teste' }));
    const menu = await screen.findByRole('menu', { name: 'Conta de Ana Teste' });
    expect(screen.getByText('ana@exemplo.test')).toBeInTheDocument();
    expect(screen.getByText('Plano Premium')).toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Perfil',
      'Assinatura',
      'Sair',
    ]);

    await user.click(within(menu).getByRole('menuitem', { name: 'Sair' }));
    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/'));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('signs out to / without racing the guard to /login', async () => {
    setViewport(DESKTOP);
    const user = userEvent.setup();
    renderWithProviders(
      <AppShell>
        <RequireAuthentication>
          <h1>Página protegida</h1>
        </RequireAuthentication>
      </AppShell>,
    );

    await user.click(screen.getByRole('button', { name: 'Conta de Ana Teste' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sair' }));

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/'));
    // the page unmounted before the user was cleared, so the guard never redirected
    expect(env.push.mock.calls).toEqual([['/']]);
    expect(screen.queryByRole('heading', { name: 'Página protegida' })).not.toBeInTheDocument();
  });
});

describe('AppShell — guest', () => {
  it.each([DESKTOP, PHONE])('shows logo, theme and Entrar with no navigation (%ipx)', (width) => {
    setViewport(width);
    signOut();
    renderShell();

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir menu' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tema' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('main')).toHaveTextContent('Conteúdo da página');
  });

  it('shows neither navigation nor Entrar while auth is loading', () => {
    setViewport(DESKTOP);
    env.setAuth({ ...env.auth, user: null, isAuthenticated: false, loading: true });
    renderShell();

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Entrar' })).not.toBeInTheDocument();
  });
});
