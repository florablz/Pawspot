import { defineConfig } from '@playwright/test'

/**
 * Parcours de bout en bout (CAHIER_DES_CHARGES.md §6) sur le build de production.
 *
 * Aucun appel réseau réel :
 * - navigateur : toute résolution DNS hors localhost échoue (`--host-resolver-rules`) ;
 *   les tuiles et autres ressources externes sont servies par `page.route()` dans les specs ;
 * - serveur : Overpass pointe vers un port local fermé, et toute requête sortante de Node
 *   (Nominatim, dont l'URL n'est pas configurable) passe par un proxy inexistant
 *   (`NODE_USE_ENV_PROXY`, Node ≥ 24) : elle échoue tout de suite au lieu de partir sur Internet.
 *
 * Base de test : fichier SQLite neuf à chaque lancement du serveur (migrations appliquées
 * au démarrage, base locale), jamais `pawspot.db`.
 */
const PORT = 3100
const BASE_URL = `http://127.0.0.1:${PORT}`
const E2E_DB = '.data/e2e/pawspot-e2e.db'
/** Port local sans serveur : connexion refusée immédiatement. */
const DEAD_ENDPOINT = 'http://127.0.0.1:9'

/** Paris, place de l'Hôtel-de-Ville : position simulée par défaut. */
const PARIS = { latitude: 48.8566, longitude: 2.3522 }

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',

  use: {
    baseURL: BASE_URL,
    channel: 'chrome',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    geolocation: PARIS,
    permissions: ['geolocation'],
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
    },
  },

  projects: [
    {
      // Par défaut : mobile (375×812, tactile).
      name: 'mobile',
      use: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],

  webServer: {
    command: [
      `node -e "const fs=require('node:fs');fs.rmSync('.data/e2e',{recursive:true,force:true});fs.mkdirSync('.data/e2e',{recursive:true})"`,
      'npm run build',
      'node .output/server/index.mjs',
    ].join(' && '),
    url: `${BASE_URL}/`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      NITRO_PORT: String(PORT),
      APP_URL: BASE_URL,
      DATABASE_URL: `file:${E2E_DB}`,
      DATABASE_AUTH_TOKEN: '',
      OVERPASS_ENDPOINTS: `${DEAD_ENDPOINT}/api/interpreter`,
      NODE_USE_ENV_PROXY: '1',
      HTTP_PROXY: DEAD_ENDPOINT,
      HTTPS_PROXY: DEAD_ENDPOINT,
      NO_PROXY: 'localhost,127.0.0.1',
    },
  },
})
