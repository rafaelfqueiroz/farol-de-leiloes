import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import MyDataSection from './MyDataSection';
import { summarizeMyData } from './privacy-api';
import { MY_DATA } from './privacy-test-support';

const facts = () =>
  Object.fromEntries(
    screen
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
  );

// TS-19. BR-010-08, BR-010-12.
describe('MyDataSection', () => {
  it.each(['light', 'dark'] as const)(
    'shows what the account holds, with counts (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<MyDataSection data={summarizeMyData(MY_DATA)} />, {
        scheme,
      });

      expect(screen.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
      expect(facts()).toEqual({
        Nome: 'Ana Souza',
        'E-mail (identidade da conta, não muda)': 'ana@exemplo.com.br',
        Telefone: '(11) 91234-5678',
        'Formas de entrar': 'E-mail e senha, Google',
        Favoritos: '24',
        'Filtros salvos': '3',
        'Lembretes e alertas': '5',
        'Registros de avisos enviados': '18',
      });
      expect(container).toHaveTextContent(
        'pertencem ao escritório e não aparecem aqui nem na exportação',
      );
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('points to the profile for name and phone and to support for anything else', () => {
    renderWithProviders(<MyDataSection data={summarizeMyData(MY_DATA)} />);

    const section = screen.getByRole('region', { name: 'Seus dados' });
    expect(within(section).getByRole('link', { name: 'perfil' })).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(within(section).getByRole('link', { name: 'suporte' })).toHaveAttribute(
      'href',
      '/support',
    );
  });

  it('says "Não informado" for what the account does not have', () => {
    renderWithProviders(
      <MyDataSection
        data={summarizeMyData({ account: { name: 'Ana', signIn: { methods: [] } } })}
      />,
    );

    expect(facts()).toMatchObject({
      Telefone: 'Não informado',
      'E-mail (identidade da conta, não muda)': 'Não informado',
      'Formas de entrar': 'Não informado',
      Favoritos: '0',
    });
  });

  it('BR-010-08: a list that was cut says how many are shown of how many, and the export has the rest', () => {
    renderWithProviders(
      <MyDataSection
        data={summarizeMyData({
          ...MY_DATA,
          favorites: {
            items: Array.from({ length: 200 }),
            truncated: true,
            totals: { items: 1340 },
          },
        })}
      />,
    );

    expect(facts().Favoritos).toBe('200 de 1.340: o arquivo de exportação traz tudo.');
  });
});

describe('summarizeMyData', () => {
  it('reads sections it was not promised without failing', () => {
    expect(summarizeMyData({})).toEqual({
      name: null,
      email: null,
      phone: null,
      signInMethods: [],
      favorites: { shown: 0, total: 0, truncated: false },
      savedFilters: { shown: 0, total: 0, truncated: false },
      reminders: { shown: 0, total: 0, truncated: false },
      notificationLogs: { shown: 0, total: 0, truncated: false },
    });
    expect(
      summarizeMyData({ account: 'x', favorites: [], reminders: { items: 'x', truncated: 1 } }),
    ).toMatchObject({
      name: null,
      favorites: { total: 0 },
      reminders: { total: 0, truncated: false },
    });
  });

  it('never reports fewer than it shows, whatever the total says', () => {
    expect(
      summarizeMyData({ favorites: { items: [1, 2, 3], truncated: true, totals: { items: 1 } } })
        .favorites,
    ).toEqual({ shown: 3, total: 3, truncated: true });
  });

  it('keeps only text for the sign-in methods', () => {
    expect(
      summarizeMyData({ account: { signIn: { methods: ['password', 4, null, 'google'] } } })
        .signInMethods,
    ).toEqual(['password', 'google']);
  });
});
