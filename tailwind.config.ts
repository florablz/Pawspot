import type { Config } from 'tailwindcss'

export default {
  content: [],
  theme: {
    extend: {
      colors: {
        paw: {
          brown: {
            900: '#2C1810',
            800: '#3E2723',
            700: '#4E342E',
            600: '#5D4037',
            500: '#6D4C41',
            400: '#8D6E63',
            300: '#A1887F',
          },
          orange: {
            600: '#E65100',
            500: '#FF6D00',
            400: '#FF9100',
            300: '#FF9E40',
            200: '#FFB74D',
          },
          green: {
            800: '#1B5E20',
            700: '#2E7D32',
            600: '#388E3C',
            500: '#43A047',
            400: '#66BB6A',
            300: '#81C784',
          },
          cream: '#FFF8E1',
        },
      },
    },
  },
} satisfies Config
