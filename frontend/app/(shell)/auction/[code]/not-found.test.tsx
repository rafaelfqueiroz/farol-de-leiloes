import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import AuctionNotFound from './not-found';

const env = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));

beforeEach(() => env.push.mockReset());

describe('AuctionNotFound', () => {
  it('says the property is unavailable', async () => {
    const { container } = render(<AuctionNotFound />);

    expect(screen.getByRole('heading', { name: 'Imóvel indisponível' })).toBeVisible();
    expect(
      screen.getByText('Este imóvel não foi encontrado ou não está mais disponível para leilão.'),
    ).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('takes the visitor to the search', async () => {
    const user = userEvent.setup();
    render(<AuctionNotFound />);

    await user.click(screen.getByRole('button', { name: 'Buscar imóveis' }));

    expect(env.push).toHaveBeenCalledWith('/search');
  });
});
