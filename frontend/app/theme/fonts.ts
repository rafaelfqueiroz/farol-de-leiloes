import { Inter } from 'next/font/google';

// DESIGN.md §5: Inter only. Exposed as a CSS variable the theme's font stack reads, so the theme
// itself never imports next/font (and stays usable in tests).
export const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});
