/**
 * Parcours 1 (CAHIER_DES_CHARGES.md §6) : ouvrir l'app → voir des lieux → filtrer →
 * ouvrir une fiche → la fermer. Géolocalisation simulée sur Paris (playwright.config.ts),
 * Overpass simulé (`tests/fixtures/overpass/paris-centre.json`), tuiles grises.
 */
import { expect, mapMarkers, placesCount, test, urlView, waitForPlaces } from './_helpers'

test.use({ contextOptions: { reducedMotion: 'reduce' } })

test('ouvre la carte sur Paris, filtre les cafés, ouvre puis ferme une fiche', async ({ page, external }) => {
  await page.goto('/')

  // 1. Des lieux apparaissent autour de la position simulée.
  const before = await waitForPlaces(page)
  expect(before.shown).toBeGreaterThan(2)
  await expect(mapMarkers(page).first()).toBeVisible()
  expect(await mapMarkers(page).count()).toBeGreaterThan(0)
  expect(external.tiles).toBeGreaterThan(0)
  // Vue centrée sur la position simulée : jamais dans l'URL (lien partagé, journaux).
  expect(urlView(page)).toBeNull()
  expect(page.url()).not.toMatch(/48\.85|2\.35/)

  // 2. Filtre « Cafés » : compteur mis à jour et URL partageable (`cat=cafe`).
  const cafes = page.getByRole('button', { name: 'Cafés', exact: true })
  await cafes.click()
  await expect(cafes).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('places-count')).toHaveText(/^\d+ lieux affichés sur \d+$/)
  const after = await placesCount(page)
  // Au moins les deux cafés du centre (le desktop, plus large, voit aussi le Café de Flore).
  expect(after.shown).toBeGreaterThanOrEqual(2)
  expect(after.shown).toBeLessThan(before.shown)
  expect(after.loaded).toBe(before.loaded)
  await expect(page).toHaveURL(/[?&]cat=cafe(&|$)/)
  expect(urlView(page)).toBeNull()
  // Seuls les cafés restent sur la carte, chacun avec son marqueur (assez éloignés pour ne pas être groupés).
  await expect(mapMarkers(page)).toHaveCount(after.shown)
  const labels = await mapMarkers(page).evaluateAll(els => els.map(el => el.getAttribute('aria-label') ?? ''))
  expect(labels).toEqual(expect.arrayContaining([expect.stringMatching(/^Café Saint-Jacques\./), expect.stringMatching(/^Le Pick-Clops\./)]))

  // 3. Ouvrir la fiche « Le Pick-Clops » depuis son marqueur.
  await page.getByRole('button', { name: /^Le Pick-Clops\./ }).click()
  await expect(page).toHaveURL(/\/lieu\/osm%3Anode%3A1102(\?|$)/)
  const sheet = page.getByTestId('place-sheet')
  await expect(sheet).toBeVisible()
  const title = sheet.getByRole('heading', { level: 2, name: 'Le Pick-Clops' })
  await expect(title).toBeFocused()
  const badge = sheet.getByTestId('dog-status-badge').first()
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('data-status', 'osm_yes')
  await expect(badge).toContainText('Source : OpenStreetMap')
  // Le filtre suit la fiche dans l'URL.
  await expect(page).toHaveURL(/[?&]cat=cafe(&|$)/)

  // 4. Fermer : retour à la carte, filtres conservés.
  await sheet.getByTestId('sheet-close').click()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:3100\/\?/)
  await expect(page).toHaveURL(/[?&]cat=cafe(&|$)/)
  await expect(page.getByTestId('places-count')).toHaveText(`${after.shown} lieux affichés sur ${after.loaded}`)
})

test('retirer le filtre rend tous les lieux', async ({ page }) => {
  await page.goto('/?cat=cafe')
  await expect(page.getByTestId('places-count')).toHaveText(/^\d+ lieux affichés sur \d+$/, { timeout: 15_000 })
  const { loaded } = await placesCount(page)

  await page.getByRole('button', { name: 'Effacer les filtres' }).click()
  await expect(page.getByTestId('places-count')).toHaveText(`${loaded} lieux affichés`)
  await expect(page).not.toHaveURL(/[?&]cat=/)
})

test('lieu sans nom : marqueur nommé d\'après sa catégorie, jamais vide', async ({ page }) => {
  await page.goto('/?cat=bar')
  await waitForPlaces(page)
  const labels = await mapMarkers(page).evaluateAll(els => els.map(el => el.getAttribute('aria-label') ?? ''))
  expect(labels.length).toBeGreaterThan(0)
  for (const label of labels) expect(label.trim()).not.toBe('')
  expect(labels.some(l => /^Bar\b/.test(l))).toBe(true)
})
