export default defineNuxtConfig({
  compatibilityDate: '2026-03-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
    },
  },
  runtimeConfig: {
    public: {
      // URL publique de référence (og:url, og:image, canonique, liens d'emails).
      // Ne jamais la déduire de l'en-tête Host, qui peut être forgé derrière un proxy.
      // Lue depuis APP_URL au build ; surchargeable à l'exécution via NUXT_PUBLIC_APP_URL.
      appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    },
  },
  typescript: {
    strict: true,
  },
})
