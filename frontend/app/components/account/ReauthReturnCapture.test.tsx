import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PrivacyPage from '@/app/components/privacy/PrivacyPage';
import { privacyFetch } from '@/app/components/privacy/privacy-test-support';
import RequireAuthentication from '@/app/components/RequireAuthentication';
import { clearReauthReturn, currentReauthReturn } from '@/lib/reauth-return';
import { renderWithProviders } from '@/test/render';
import ReauthReturnCapture from './ReauthReturnCapture';

const env = vi.hoisted(() => ({
  authenticated: true,
  loading: false,
  push: vi.fn(),
  report: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push, replace: vi.fn() }) }));
vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: env.authenticated,
    loading: env.loading,
    user: { providers: ['google'] },
  }),
}));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

const CODE = 'one-time-code-9f3a';
const fetchMock = vi.fn();

beforeEach(() => {
  env.authenticated = true;
  env.loading = false;
  env.push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', `/profile/privacidade?reauth=${CODE}`);
});
afterEach(() => {
  clearReauthReturn();
  vi.unstubAllGlobals();
});

// SPEC-010 BR-010-13: the code is out of the address whatever happens next.
describe('ReauthReturnCapture', () => {
  it('takes the code out of the address and the history entry on mount, and keeps it in memory', () => {
    render(<ReauthReturnCapture />);

    expect(window.location.search).toBe('');
    expect(window.location.href).not.toContain(CODE);
    expect(currentReauthReturn()).toEqual({ code: CODE, error: null });
  });

  it('renders nothing', () => {
    const { container } = render(<ReauthReturnCapture />);

    expect(container).toBeEmptyDOMElement();
  });

  it('the privacy snapshot failing does not leave the code in the address', async () => {
    fetchMock.mockImplementation(
      privacyFetch({}, () =>
        Promise.resolve(
          new Response(JSON.stringify({ code: 'BACKEND_UNAVAILABLE', context: {} }), {
            status: 502,
          }),
        ),
      ),
    );
    const { findByRole } = renderWithProviders(
      <>
        <ReauthReturnCapture />
        <PrivacyPage />
      </>,
    );

    expect(await findByRole('alert')).toBeVisible();
    expect(window.location.href).not.toContain(CODE);
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it('the session being gone sends the visitor to the plain /login: the code is in neither the address nor the redirect', () => {
    env.authenticated = false;
    renderWithProviders(
      <>
        <ReauthReturnCapture />
        <RequireAuthentication>
          <p>privada</p>
        </RequireAuthentication>
      </>,
    );

    expect(env.push).toHaveBeenCalledWith('/login');
    expect(JSON.stringify(env.push.mock.calls)).not.toContain(CODE);
    expect(window.location.href).not.toContain(CODE);
  });
});
