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
        'maroon': '#5E0006',
        'red': '#9B0F06',
        'beige': '#EED9B9',
        'black': '#091413',
        'white': '#FFFFFF',
      },
      animation: {
        'bounce': 'bounce-delay 1.4s infinite ease-in-out both',
      },
    },
  },
  plugins: [],
};
export default config;
