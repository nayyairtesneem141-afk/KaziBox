import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    './platform/app/**/*.{js,ts,jsx,tsx,mdx}',
    './platform/lib/**/*.{js,ts,jsx,tsx,mdx}',
    '../packages/ui/src/**/*.{js,ts,jsx,tsx}',
    './packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        kazibox: {
          primary: 'var(--kazibox-primary, #6D28D9)',
          'primary-hover': 'var(--kazibox-primary-hover, #5B21B6)',
          'primary-soft': 'var(--kazibox-primary-soft, #F3E8FF)',
          accent: 'var(--kazibox-accent, #FACC15)',
          dark: '#1F2937',
          muted: '#6B7280',
          border: '#E5E7EB',
          bg: '#FFFFFF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
