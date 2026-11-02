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
            700: '#C43E00',
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
          // Statut « chiens la nuit uniquement » + catégorie plage (même bleu que le marqueur plage).
          blue: {
            700: '#0288D1',
            500: '#03A9F4',
            300: '#4FC3F7',
          },
          // Statut « chiens interdits ».
          red: {
            700: '#D32F2F',
            300: '#E57373',
          },
          white: '#FFFFFF',
          cream: '#FFF8E1',
        },
      },
    },
  },
} satisfies Config
