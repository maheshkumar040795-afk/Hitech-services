/** @type {import('tailwindcss').Config} */
// "Midnight Sapphire" — deep ink navy, sapphire → indigo accent, a touch of gold
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"DM Sans"', 'sans-serif'],
        heading: ['"Plus Jakarta Sans"', '"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        brand: {
          50:  '#edf4ff',
          100: '#dbe8ff',
          200: '#bcd4ff',
          300: '#8db6ff',
          400: '#5a8cfa',
          500: '#2f6bf2',
          600: '#1d55e0',
          700: '#1846d6',
          800: '#1a39a6',
          900: '#1b3383',
        },
        ink: {
          700: '#1a2440',
          800: '#121a30',
          900: '#0b1122',
          950: '#070b17',
        },
        gold: { 300: '#fcd98a', 400: '#f6c35b', 500: '#eaa92e' },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,.04), 0 6px 20px -8px rgba(15,23,42,.10)',
        lift: '0 2px 4px rgba(15,23,42,.05), 0 18px 40px -16px rgba(30,41,90,.28)',
        glow: '0 8px 24px -6px rgba(29,85,224,.55)',
      },
      animation: {
        'fade-in':  'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(.2,.8,.2,1) both',
        'scale-in': 'scaleIn 0.28s cubic-bezier(.2,.8,.2,1) both',
        'aurora':   'aurora 18s ease-in-out infinite alternate',
        'aurora-2': 'aurora 24s ease-in-out infinite alternate-reverse',
        'pulse-dot': 'pulseDot 2s ease-out infinite',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideUp: { '0%': { opacity: 0, transform: 'translateY(14px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        scaleIn: { '0%': { opacity: 0, transform: 'translateY(8px) scale(.97)' }, '100%': { opacity: 1, transform: 'translateY(0) scale(1)' } },
        aurora:  { '0%': { transform: 'translate3d(0,0,0) scale(1)' }, '50%': { transform: 'translate3d(6%,-8%,0) scale(1.15)' }, '100%': { transform: 'translate3d(-6%,6%,0) scale(.95)' } },
        pulseDot: { '0%': { boxShadow: '0 0 0 0 rgba(16,185,129,.55)' }, '100%': { boxShadow: '0 0 0 8px rgba(16,185,129,0)' } },
      },
    },
  },
  plugins: [],
}
