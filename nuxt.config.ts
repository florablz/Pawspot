export default defineNuxtConfig({
  compatibilityDate: '2026-03-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  typescript: {
    strict: true,
  },
})
