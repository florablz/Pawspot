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
      // Modèle d'URL des tuiles Leaflet ({z}/{x}/{y}, éventuellement {s} et {r}).
      // Lue depuis TILE_URL au build ; surchargeable via NUXT_PUBLIC_TILE_URL.
      // En production : fournisseur avec offre gratuite (OpenFreeMap…), le serveur
      // de tuiles OSM interdisant l'usage intensif.
      tileUrl: process.env.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      // Attribution affichée par Leaflet (HTML). À adapter au fournisseur de tuiles.
      // Lue depuis TILE_ATTRIBUTION au build ; surchargeable via NUXT_PUBLIC_TILE_ATTRIBUTION.
      tileAttribution:
        process.env.TILE_ATTRIBUTION
        || '&copy; les contributeurs d\'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    },
  },
  typescript: {
    strict: true,
  },
})
