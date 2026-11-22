import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privacyFetch } from '@/app/components/privacy/privacy-test-support';
import { renderWithProviders } from '@/test/render';
import Page from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { providers: ['local'] } }),
}));

beforeEach(() => vi.stubGlobal('fetch', vi.fn(privacyFetch())));
afterEach(() => vi.unstubAllGlobals());

describe('/profile/privacidade', () => {
  it('renders the privacy page', async () => {
    renderWithProviders(<Page />);

    expect(await screen.findByRole('heading', { level: 2, name: 'Aceites' })).toBeVisible();
  });

  it('lives under the authentication guard of the (shell) group, not in the public part', () => {
    const app = resolve(import.meta.dirname, '../../../..');
    expect(existsSync(resolve(app, '(shell)/(authenticated)/profile/privacidade/page.tsx'))).toBe(
      true,
    );
    expect(existsSync(resolve(app, '(shell)/profile/privacidade/page.tsx'))).toBe(false);
  });
});
