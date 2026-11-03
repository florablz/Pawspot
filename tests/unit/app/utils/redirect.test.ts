import { describe, expect, it } from 'vitest'
import { AUTH_PATHS, safeRedirect } from '~/utils/redirect'

describe('safeRedirect', () => {
  it.each([
    '/favorites',
    '/favorites?x=1',
    '/?place=osm%3Anode%3A1',
    '/favorites#haut',
    '/loginette',
  ])('accepte le chemin interne %s', (value) => {
    expect(safeRedirect(value)).toBe(value)
  })

  it.each([
    ['//exemple.fr', 'URL relative au protocole'],
    ['//exemple.fr/favorites', 'URL relative au protocole avec chemin'],
    ['/\\exemple.fr', 'barre inverse, lue comme // par les navigateurs'],
    ['http://exemple.fr/favorites', 'URL absolue http'],
    ['https://exemple.fr', 'URL absolue https'],
    ['javascript:alert(1)', 'schéma javascript:'],
    ['favorites', 'chemin sans / initial'],
    ['', 'chaîne vide'],
    ['/fav\norites', 'saut de ligne'],
    ['/fav\torites', 'tabulation'],
    ['/\u0000x', 'caractère nul'],
  ])('refuse « %s » (%s) → /', (value) => {
    expect(safeRedirect(value)).toBe('/')
  })

  it.each(['/login', '/register', '/login?redirect=/favorites', '/register#x'])('pas de retour vers %s (boucle) → /', (value) => {
    expect(safeRedirect(value)).toBe('/')
  })

  // BUG (front, app/utils/redirect.ts) : la comparaison avec AUTH_PATHS est exacte, alors que
  // vue-router (strict: false, sensitive: false) sert aussi /login/ et /LOGIN par la page de
  // connexion. `?redirect=/login/` renvoie donc, après connexion, vers le formulaire de connexion.
  // Sans risque de sécurité (chemin interne), mais boucle visible. Retirer `.fails` une fois corrigé.
  it.fails.each(['/login/', '/LOGIN', '/Register?x=1'])('variante de page d\'authentification %s → /', (value) => {
    expect(safeRedirect(value)).toBe('/')
  })

  it('tableau (?redirect=a&redirect=b) : seule la première valeur compte', () => {
    expect(safeRedirect(['/favorites', '/autre'])).toBe('/favorites')
    expect(safeRedirect(['//exemple.fr', '/favorites'])).toBe('/')
    expect(safeRedirect([])).toBe('/')
  })

  it('absent ou null → /', () => {
    expect(safeRedirect(undefined)).toBe('/')
    expect(safeRedirect(null)).toBe('/')
    expect(safeRedirect([null])).toBe('/')
  })

  it('AUTH_PATHS liste les pages de connexion et d\'inscription', () => {
    expect([...AUTH_PATHS].sort()).toEqual(['/login', '/register'])
  })
})
