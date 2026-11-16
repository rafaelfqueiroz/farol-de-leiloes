import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import GoogleSignInButton from './GoogleSignInButton';

vi.mock('@/lib/env', () => ({ publicEnv: { apiUrl: 'http://api.example.test' } }));

describe('GoogleSignInButton', () => {
  it.each(['light', 'dark'] as const)('is a named button that passes axe (%s)', async (scheme) => {
    const { container } = renderWithProviders(<GoogleSignInButton />, { scheme });

    expect(screen.getByRole('button', { name: 'Entrar com Google' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('navigates to the API, which starts the Google flow', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { value: { ...original, assign }, writable: true });
    const user = userEvent.setup();
    renderWithProviders(<GoogleSignInButton />);

    await user.click(screen.getByRole('button', { name: 'Entrar com Google' }));

    expect(assign).toHaveBeenCalledWith('http://api.example.test/api/auth/google');
    Object.defineProperty(window, 'location', { value: original, writable: true });
  });
});
