import { defineConfig } from '@playwright/test'

/**
 * Parcours de bout en bout sur le build de production.
 *
 * Aucun appel réseau réel :
 * - navigateur : toute résolution DNS hors localhost échoue (`--host-resolver-rules`) ;
 *   les tuiles (image grise) et autres ressources externes sont interceptées par
 *   `page.route()` (fixture automatique de `e2e/_helpers.ts`) ;
 * - serveur : Overpass (`OVERPASS_ENDPOINTS`), Photon (`PHOTON_URL`, géocodeur par défaut)
 *   et Nominatim (`NOMINATIM_URL`) pointent vers le serveur de fixtures local (`e2e/fixture-server.ts`, port 3101) ; toute autre requête
 *   sortante de Node passe par un proxy inexistant (`NODE_USE_ENV_PROXY`, Node ≥ 24) :
 *   elle échoue tout de suite au lieu de partir sur Internet.
 *
 * Ordre : projets `mobile` et `desktop`, puis `mobile-panne` et `desktop-panne`
 * (Overpass en 504 : le disjoncteur du serveur met l'instance en pause 2 min, ce qui
 * fausserait des parcours lancés ensuite).
 *
 * Base de test : fichier SQLite neuf à chaque lancement du serveur (migrations appliquées
 * au démarrage, base locale), jamais `pawspot.db`.
 */
const PORT = 3100
const BASE_URL = `http://127.0.0.1:${PORT}`
/** Faux Overpass, Photon et Nominatim (e2e/fixture-server.ts). Jamais 3920 (revue ux-a11y). */
const FIXTURE_PORT = 3101
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`
const PANNE = '**/panne-*.spec.ts'
const E2E_DB = '.data/e2e/pawspot-e2e.db'
/** Port local sans serveur : connexion refusée immédiatement. */
const DEAD_ENDPOINT = 'http://127.0.0.1:9'

/** Paris, place de l'Hôtel-de-Ville : position simulée par défaut. */
const PARIS = { latitude: 48.8566, longitude: 2.3522 }

const MOBILE = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const DESKTOP = { viewport: { width: 1280, height: 800 } }

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
      testIgnore: PANNE,
      use: MOBILE,
    },
    {
      name: 'desktop',
      testIgnore: PANNE,
      use: DESKTOP,
    },
    { name: 'mobile-panne', testMatch: PANNE, dependencies: ['mobile', 'desktop'], use: MOBILE },
    { name: 'desktop-panne', testMatch: PANNE, dependencies: ['mobile-panne'], use: DESKTOP },
  ],

  webServer: [
    {
      command: 'npx tsx e2e/fixture-server.ts',
      url: `${FIXTURE_URL}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { FIXTURE_PORT: String(FIXTURE_PORT) },
    },
    {
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
        OVERPASS_ENDPOINTS: `${FIXTURE_URL}/api/interpreter`,
        PHOTON_URL: FIXTURE_URL,
        NOMINATIM_URL: FIXTURE_URL,
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: DEAD_ENDPOINT,
        HTTPS_PROXY: DEAD_ENDPOINT,
        NO_PROXY: 'localhost,127.0.0.1',
      },
    },
  ],
})
