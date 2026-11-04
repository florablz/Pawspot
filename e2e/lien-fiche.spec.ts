/**
 * Critère §9 : le lien partagé d'une fiche (`/lieu/<id encodé>`) ouvre la bonne fiche,
 * avec ses balises Open Graph dans le HTML rendu côté serveur ; id inconnu → message.
 */
import { expect, fixtureStats, test } from './_helpers'

const ID = 'osm:node:1101'
const PATH = `/lieu/${encodeURIComponent(ID)}`

// Un lien partagé désigne un lieu déjà vu sur la carte, donc en base : on charge la zone
// (comme l'aurait fait la carte de la personne qui partage) avant chaque test.
test.beforeEach(async ({ request }) => {
  const res = await request.get('/api/places', { params: { bbox: '2.340,48.850,2.365,48.865', zoom: 14 } })
  expect(res.status()).toBe(200)
  expect(JSON.stringify(await res.json())).toContain(ID)
})

/** Contenu d'une balise `<meta property|name="…" content="…">` (entités HTML décodées). */
function meta(html: string, key: string): string | undefined {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]*>`))?.[0]
  const raw = tag?.match(/content="([^"]*)"/)?.[1]
  return raw?.replace(/&#x27;|&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

test('ouvrir directement /lieu/<id> : la bonne fiche, titre focus, carte autour', async ({ page }) => {
  await page.goto(PATH)
  const sheet = page.getByTestId('place-sheet')
  await expect(sheet.getByRole('heading', { level: 2, name: 'Café Saint-Jacques' })).toBeFocused({ timeout: 15_000 })
  await expect(sheet.getByTestId('dog-status-badge').first()).toContainText('Source : OpenStreetMap')
  await expect(page).toHaveTitle('Café Saint-Jacques — PawSpot')
  // Bouton « Partager » et « Itinéraire » présents sur la fiche ouverte par lien.
  await expect(sheet.getByTestId('share-button')).toBeVisible()
  await expect(sheet.getByTestId('itinerary-button')).toBeVisible()
})

test('le HTML de /lieu/<id> contient les balises Open Graph du lieu', async ({ request, baseURL }) => {
  const res = await request.get(PATH)
  expect(res.status()).toBe(200)
  const html = await res.text()

  expect(meta(html, 'og:title')).toBe('Café Saint-Jacques — PawSpot')
  expect(meta(html, 'og:description')).toContain('Café')
  expect(meta(html, 'og:description')).toContain('source : OpenStreetMap')
  expect(meta(html, 'og:url')).toBe(`${baseURL}${PATH}`)
  expect(meta(html, 'og:image')).toBe(`${baseURL}/logo.png`)
  expect(meta(html, 'og:type')).toBe('website')
  expect(html).toContain(`<link rel="canonical" href="${baseURL}${PATH}">`)
  // Aucune position d'utilisateur ni vue de carte dans le lien partagé.
  expect(meta(html, 'og:url')).not.toMatch(/[?&](lat|lon|z)=/)
})

test('lien partagé : le bouton « Partager » copie l\'URL publique de la fiche', async ({ page, context, baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'Permissions du presse-papier propres à Chromium')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    // Pas de feuille de partage du système en test : repli presse-papier.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })
  await page.goto(PATH)
  const sheet = page.getByTestId('place-sheet')
  await sheet.getByTestId('share-button').click()
  await expect(sheet.getByTestId('share-feedback')).toHaveText('Lien copié')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}${PATH}`)
})

test('id inconnu : message « introuvable », réponse 404, la carte reste utilisable', async ({ page, request }) => {
  const unknown = `/lieu/${encodeURIComponent('osm:node:987654321')}`
  const res = await request.get(unknown)
  expect(res.status()).toBe(404)
  expect(meta(await res.text(), 'robots')).toBe('noindex')

  await page.goto(unknown)
  await expect(page.getByTestId('place-load-notice')).toContainText('Ce lieu n\'existe plus ou est introuvable.', { timeout: 15_000 })
  await expect(page.getByTestId('place-sheet')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Carte des lieux' })).toBeVisible()
})

test('lieu OSM existant mais jamais chargé (plage à Nice), visiteur anonyme : 404 sans appeler Overpass', async ({ request }) => {
  const before = (await fixtureStats()).overpass
  const res = await request.get(`/api/places/${encodeURIComponent('osm:node:1005')}`)
  expect(res.status()).toBe(404)
  expect((await fixtureStats()).overpass).toBe(before)
})

test('id mal formé : même message, sans appeler l\'API', async ({ page }) => {
  const apiCalls: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/places/')) apiCalls.push(r.url())
  })
  await page.goto('/lieu/pas-un-id')
  await expect(page.getByTestId('place-load-notice')).toContainText('introuvable')
  expect(apiCalls).toEqual([])
})
