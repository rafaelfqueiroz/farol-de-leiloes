import Button from '@mui/material/Button';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LOCALE, TIME_ZONE } from '@/i18n/config';
import messages from '@/messages/pt-BR.json';
import { axe } from '@/test/render';
import AppThemeProvider from './AppThemeProvider';

describe('SC-17 AppThemeProvider', () => {
  it.each(['light', 'dark'])(
    'nonces Emotion styles and renders accessible controls (%s)',
    async (scheme) => {
      document.documentElement.className = scheme;
      const { container } = render(
        <AppThemeProvider
          locale={LOCALE}
          timeZone={TIME_ZONE}
          messages={messages}
          nonce="page-nonce"
        >
          <Button>{messages.patterns.confirmDialog.cancel}</Button>
        </AppThemeProvider>,
      );
      expect(
        screen.getByRole('button', { name: messages.patterns.confirmDialog.cancel }),
      ).toBeEnabled();
      const styles = document.querySelectorAll('style[data-emotion^="mui"]');
      expect(styles.length).toBeGreaterThan(0);
      for (const style of styles) expect(style).toHaveAttribute('nonce', 'page-nonce');
      expect(await axe(container)).toHaveNoViolations();
      document.documentElement.className = '';
    },
  );
});
