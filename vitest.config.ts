import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// Deux projets sans démarrer Nuxt : les auto-imports utilisés par le code testé
// (ref, $fetch, getApiErrorMessage, defineEventHandler…) sont fournis par
// vi.stubGlobal dans chaque test, ce qui reste rapide et sans réseau.
// Le projet app compile aussi les composants `.vue` (plugin Vue, déjà fourni par
// Nuxt) pour les monter avec @vue/test-utils.
const alias = {
  '~': fileURLToPath(new URL('./app', import.meta.url)),
  '~~': fileURLToPath(new URL('.', import.meta.url)),
  '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/unit/server/**/*.test.ts'],
        },
      },
      {
        plugins: [vue()],
        resolve: { alias },
        test: {
          name: 'app',
          environment: 'happy-dom',
          include: ['tests/unit/app/**/*.test.ts'],
        },
      },
    ],
  },
})
