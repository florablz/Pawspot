/**
 * Critère §9 : Overpass en panne → les lieux déjà en base s'affichent, avec le bandeau
 * « Lieux affichés depuis notre sauvegarde… ».
 *
 * Exécuté dans les projets `mobile-panne` / `desktop-panne`, APRÈS les autres parcours
 * (voir playwright.config.ts) : un 504 met l'instance Overpass en pause 2 min côté serveur
 * (disjoncteur), ce qui fausserait les parcours suivants.
 */
import { e2eSql, expect, fixtureStats, setOverpass, test, waitForPlaces } from './_helpers'

test.use({ contextOptions: { reducedMotion: 'reduce' } })

test.afterEach(async () => {
  // Remet les tuiles « fraîches » et Overpass en service pour la suite.
  await e2eSql('UPDATE fetched_tiles SET fetched_at = ?', [Math.floor(Date.now() / 1000)])
  await setOverpass('ok')
})

test('Overpass en 504 : lieux de la sauvegarde affichés et bandeau d\'avertissement', async ({ page }) => {
  // Lieux de Paris en base (chargés maintenant si besoin, Overpass répondant).
  await setOverpass('ok')
  await page.goto('/')
  const fresh = await waitForPlaces(page)
  await expect(page.getByTestId('notice-stale')).toHaveCount(0)

  // Les tuiles deviennent périmées (plus de 7 jours) et Overpass tombe en panne.
  await e2eSql('UPDATE fetched_tiles SET fetched_at = 0')
  await setOverpass('down')
  await page.reload()

  const stale = page.getByTestId('notice-stale')
  await expect(stale).toBeVisible({ timeout: 20_000 })
  await expect(stale).toContainText('Lieux affichés depuis notre sauvegarde')
  await expect(stale.getByRole('button', { name: 'Réessayer' })).toBeVisible()
  const fromBackup = await waitForPlaces(page)
  expect(fromBackup.shown).toBe(fresh.shown)
  // Pas de message d'erreur bloquant en plus du bandeau.
  await expect(page.getByRole('alert')).toHaveCount(0)
  // Le serveur a bien reçu des 504 (au 2e projet, le disjoncteur déjà ouvert répond sans appel).
  expect((await fixtureStats()).overpass504).toBeGreaterThan(0)
})
