import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'off-white': '#FAFAF9',
        'warm-beige': '#E8DCC8',
        'dark-charcoal': '#2D3436',
        'cool-gray': '#6B7280',
        'steel-blue': '#5A6C7D',
        'concrete': '#95A5A6',
        'medium-gray': '#B8BEBD',
      },
      animation: {
        'bounce': 'bounce-delay 1.4s infinite ease-in-out both',
      },
    },
  },
  plugins: [],
};
export default config;
