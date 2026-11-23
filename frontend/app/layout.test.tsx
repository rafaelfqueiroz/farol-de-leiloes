// @vitest-environment node
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import RootLayout, { generateMetadata } from './layout';

// DS-07, SC-17, DS-20: the root layout sets the document language from the locale, hands the
// request's CSP nonce to the colour-scheme script and the style cache, and mounts the providers.
const env = vi.hoisted(() => ({ nonce: null as string | null }));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(env.nonce ? { 'x-nonce': env.nonce } : {}),
}));
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'pt-BR',
  getTimeZone: async () => 'America/Sao_Paulo',
  getMessages: async () => messages,
  getTranslations: async () => (key: string) => (messages.meta as Record<string, string>)[key],
}));
vi.mock('./theme/fonts', () => ({ inter: { variable: 'inter-variable-class' } }));

beforeEach(() => {
  env.nonce = null;
});

type Props = Record<string, unknown>;

function find(
  node: ReactNode,
  predicate: (element: ReactElement<Props>) => boolean,
): ReactElement<Props> | undefined {
  if (!isValidElement<Props>(node)) return undefined;
  if (predicate(node)) return node;
  const children = node.props.children as ReactNode;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return undefined;
}

const named = (name: string) => (element: ReactElement<Props>) =>
  typeof element.type === 'function' && element.type.name === name;

describe('generateMetadata', () => {
  it('takes the title and description from the pt-BR catalogue', async () => {
    expect(await generateMetadata()).toEqual({
      title: 'Farol dos Leilões',
      description: 'Encontre imóveis em leilão da Caixa Econômica Federal',
    });
  });
});

describe('RootLayout', () => {
  it('declares the document language and the font variable on <html>', async () => {
    const layout = await RootLayout({ children: <p>conteúdo</p> });

    expect(layout.type).toBe('html');
    expect(layout.props).toMatchObject({ lang: 'pt-BR', className: 'inter-variable-class' });
  });

  it('hands the request nonce to the colour-scheme script and the theme provider', async () => {
    env.nonce = 'nonce-123';

    const layout = await RootLayout({ children: <p>conteúdo</p> });

    expect(find(layout, named('InitColorSchemeScript'))?.props.nonce).toBe('nonce-123');
    expect(find(layout, named('AppThemeProvider'))?.props.nonce).toBe('nonce-123');
  });

  it('works without a nonce header', async () => {
    const layout = await RootLayout({ children: <p>conteúdo</p> });

    expect(find(layout, named('AppThemeProvider'))?.props.nonce).toBeUndefined();
  });

  it('gives the theme provider the locale, zone and catalogue', async () => {
    const layout = await RootLayout({ children: <p>conteúdo</p> });

    expect(find(layout, named('AppThemeProvider'))?.props).toMatchObject({
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo',
      messages,
    });
  });

  it('mounts the page inside the auth, favourites and reminders providers, in that order', async () => {
    const page = <p>conteúdo</p>;

    const layout = await RootLayout({ children: page });

    const auth = find(layout, named('AuthProvider'));
    const favorites = find(auth?.props.children as ReactNode, named('FavoritesProvider'));
    const reminders = find(favorites?.props.children as ReactNode, named('RemindersProvider'));
    expect(auth).toBeDefined();
    expect(favorites).toBeDefined();
    const inside = reminders?.props.children as ReactNode[];
    expect(inside[0]).toBe(page);
    // SPEC-010: the consent dialogs are decided in one place, inside the providers, after the page
    expect(find(reminders, named('AccountConsentGate'))).toBeDefined();
  });
});
