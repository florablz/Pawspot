import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { configDefaults, defineConfig } from 'vitest/config'

// Deux projets sans démarrer Nuxt : les auto-imports utilisés par le code testé
// (ref, $fetch, getApiErrorMessage, defineEventHandler…) sont fournis par
// vi.stubGlobal dans chaque test, ce qui reste rapide et sans réseau.
// Le projet app compile aussi les composants `.vue` (plugin Vue, déjà fourni par
// Nuxt) pour les monter avec @vue/test-utils.
// Les parcours Playwright (`e2e/**`, `*.spec.ts`) ne passent jamais par Vitest.
const exclude = [...configDefaults.exclude, 'e2e/**', '**/*.spec.ts']

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
          // Scripts (fonctions pures de scripts/*-lib.ts) : environnement node, comme le serveur.
          include: ['tests/unit/server/**/*.test.ts', 'tests/unit/scripts/**/*.test.ts'],
          exclude,
        },
      },
      {
        plugins: [vue()],
        resolve: { alias },
        // Code côté client (happy-dom) : `import.meta.client` vaut true comme dans le
        // navigateur sous Nuxt (sinon `undefined` et les écouteurs ne sont jamais posés).
        define: { 'import.meta.client': 'true', 'import.meta.server': 'false' },
        test: {
          name: 'app',
          environment: 'happy-dom',
          include: ['tests/unit/app/**/*.test.ts'],
          exclude,
        },
      },
    ],
  },
})
