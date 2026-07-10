/** @type {import('tailwindcss').Config} */
// Los colores apuntan a CSS variables (--color-*) para soportar white-label en
// runtime (el ThemeProvider las sobreescribe por empresa). El fallback es el
// token base de FitCore (ver src/theme/tokens.js — fuente única de verdad).
const v = (name, fallback) => `var(--color-${name}, ${fallback})`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: v('primary', '#FF6B35'),
          hover: v('primary-hover', '#F05E28'),
          soft: v('primary-soft', '#FFA37D'),
          tint: v('primary-tint', '#FFD9C6'),
          bg: v('primary-bg', '#FFF0E8'),
        },
        // Alias 'orange' para compatibilidad con el markup ya escrito
        orange: {
          DEFAULT: v('primary', '#FF6B35'),
          600: v('primary-hover', '#F05E28'),
          300: v('primary-soft', '#FFA37D'),
          100: v('primary-tint', '#FFD9C6'),
          50: v('primary-bg', '#FFF0E8'),
        },
        navy: {
          DEFAULT: v('navy', '#141B2E'),
          700: v('navy-soft', '#1D2740'),
        },
        green: {
          DEFAULT: v('success', '#1D9E75'),
          600: v('success-dark', '#116B4E'),
          400: v('success-soft', '#3FCB9C'),
          50: v('success-bg', '#E6F5EF'),
        },
        red: {
          DEFAULT: v('danger', '#E24B4A'),
          50: v('danger-bg', '#FCEAEA'),
          100: v('danger-tint', '#F5CFCF'),
        },
        // Aviso / atención. Alias 'amber' (ya usado en el markup) + 'warning',
        // ambos apuntan al token del tema en vez del ámbar default de Tailwind.
        amber: {
          DEFAULT: v('warning', '#B45309'),
          50: v('warning-bg', '#FEF3C7'),
          100: v('warning-bg', '#FEF3C7'),
          200: v('warning-border', '#FDE68A'),
          300: v('warning-border', '#FDE68A'),
          400: v('warning-soft', '#F59E0B'),
          500: v('warning-soft', '#F59E0B'),
          600: v('warning', '#B45309'),
          700: v('warning', '#B45309'),
          800: v('warning-strong', '#92400E'),
        },
        warning: {
          DEFAULT: v('warning', '#B45309'),
          bg: v('warning-bg', '#FEF3C7'),
          soft: v('warning-soft', '#F59E0B'),
          strong: v('warning-strong', '#92400E'),
          border: v('warning-border', '#FDE68A'),
        },
        ink: v('ink', '#141B2E'),
        muted: v('muted', '#5B6472'),
        faint: v('faint', '#9AA3B5'),
        line: v('line', '#E5E7EB'),
        line2: v('line2', '#F0F1F4'),
        surface: v('surface', '#F5F6F8'),
        canvas: v('canvas', '#E9EBF0'),
        chipnavy: v('chip-navy', '#EDF0F7'),
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
      },
      keyframes: {
        fadeSlide: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        pulseDot: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        fadeSlide: 'fadeSlide 0.25s ease',
        pulseDot: 'pulseDot 1.4s ease infinite',
      },
    },
  },
  plugins: [],
}
