/**
 * Critère §9 : « Lyon », « Brest », « 12 rue de Rivoli, Paris » recherchés à la suite,
 * sans recharger la page ni « Reset » : la carte se déplace à chaque fois.
 * Photon (géocodeur par défaut) simulé par `e2e/fixture-server.ts` (fixtures `tests/fixtures/photon/`).
 */
import { expect, expectViewNear, test, waitForPlaces } from './_helpers'

test.use({ contextOptions: { reducedMotion: 'reduce' } })

test('« Lyon », « Brest » puis « 12 rue de Rivoli, Paris » : la carte suit chaque recherche', async ({ page }) => {
  await page.goto('/')
  await waitForPlaces(page)
  const search = page.getByRole('combobox', { name: 'Rechercher un lieu, une adresse ou une ville' })
  let navigations = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++
  })

  // Lyon : vue « ville » (zoom 11 à 13).
  await search.fill('Lyon')
  await expect(page.getByTestId('search-option-address').first()).toContainText('Lyon (69)')
  await search.press('Enter')
  const lyon = await expectViewNear(page, 45.7578, 4.832, 0.08)
  expect(lyon.z).toBeGreaterThanOrEqual(11)
  expect(lyon.z).toBeLessThanOrEqual(13)
  await expect(search).toHaveValue('Lyon (69)')

  // Brest, sans rien effacer d'autre que le texte.
  await search.fill('Brest')
  await expect(page.getByTestId('search-option-address').first()).toContainText('Brest (29)')
  await search.press('Enter')
  const brest = await expectViewNear(page, 48.3905, -4.486, 0.08)
  expect(brest.z).toBeGreaterThanOrEqual(11)

  // Adresse précise : zoom de rue, plus serré que celui d'une ville.
  await search.fill('12 rue de Rivoli, Paris')
  // Suggestion sur deux lignes : la rue, puis « Adresse · 75004 Paris ».
  const address = page.getByTestId('search-option-address').first()
  await expect(address).toContainText('12 Rue de Rivoli')
  await expect(address).toContainText('75004 Paris')
  await search.press('Enter')
  const rivoli = await expectViewNear(page, 48.8556, 2.3593, 0.01)
  expect(rivoli.z).toBeGreaterThanOrEqual(16)
  expect(rivoli.z).toBeGreaterThan(lyon.z)

  // Jamais de rechargement complet de la page (les changements d'URL sont des `replace`).
  expect(navigations).toBeLessThanOrEqual(3)
  await expect(page.getByTestId('search-status-error')).toHaveCount(0)
})

test('choisir une suggestion à la souris déplace aussi la carte', async ({ page }) => {
  await page.goto('/')
  await waitForPlaces(page)
  const search = page.getByRole('combobox', { name: 'Rechercher un lieu, une adresse ou une ville' })

  await search.fill('Brest')
  await page.getByTestId('search-option-address').filter({ hasText: 'Brest (29)' }).click()
  await expectViewNear(page, 48.3905, -4.486, 0.08)
})
