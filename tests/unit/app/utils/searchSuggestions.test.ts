import { describe, expect, it } from 'vitest'
import type { GeocodeResult, Place } from '#shared/types'
import {
  isExactPlaceMatch,
  isSearchable,
  MAX_PLACE_SUGGESTIONS,
  matchPlaces,
  splitGeocodeLabel,
  suggestionsAnnouncement,
} from '~/utils/searchSuggestions'
import { geocodeOfType, GEOCODE_RIVOLI } from '../_geocode'
import { makePlace } from '../_helpers'

/** Recherche unifiée (§3.2) : suggestions de lieux déjà chargés, libellés d'adresses, annonce. */

let n = 0
const place = (name: string, extra: Partial<Place> = {}) =>
  makePlace({ id: `osm:node:${++n}`, name, ...extra })
const names = (list: ReturnType<typeof matchPlaces>) => list.map(p => p.name)

describe('matchPlaces', () => {
  it('classe : nom identique > début du nom > début d\'un mot > reste', () => {
    const places = [
      place('Le Grand Parc'), // début d'un mot
      place('Comparateur'), // contient « par » au milieu d'un mot
      place('Jardin des Parcs'), // début d'un mot
      place('Parc'), // identique
      place('Parc Monceau'), // début du nom
    ]
    expect(names(matchPlaces(places, 'Parc'))).toEqual(['Parc', 'Parc Monceau', 'Le Grand Parc', 'Jardin des Parcs'])
    expect(names(matchPlaces(places, 'par'))).toEqual(['Parc', 'Parc Monceau', 'Le Grand Parc', 'Jardin des Parcs', 'Comparateur'])
  })

  it('à rang égal, le nom le plus court passe devant', () => {
    const places = [place('Café de la Gare de Lyon'), place('Café de la Paix'), place('Café du Port')]
    expect(names(matchPlaces(places, 'café'))).toEqual(['Café du Port', 'Café de la Paix', 'Café de la Gare de Lyon'])
  })

  it('ignore les accents et la casse dans les deux sens', () => {
    const places = [place('Café de l\'Église'), place('Bistrot Saint-Étienne')]
    expect(names(matchPlaces(places, 'EGLISE'))).toEqual(['Café de l\'Église'])
    expect(names(matchPlaces(places, 'étienne'))).toEqual(['Bistrot Saint-Étienne'])
    expect(names(matchPlaces(places, 'saint etienne'))).toEqual(['Bistrot Saint-Étienne'])
  })

  it('traite les ligatures œ et æ comme « oe » et « ae »', () => {
    const places = [place('Le Cœur de Lyon'), place('Ætna Bar')]
    expect(names(matchPlaces(places, 'coeur'))).toEqual(['Le Cœur de Lyon'])
    expect(names(matchPlaces(places, 'Cœur'))).toEqual(['Le Cœur de Lyon'])
    expect(names(matchPlaces(places, 'aetna'))).toEqual(['Ætna Bar'])
  })

  it('ignore les lieux sans nom (nom de repli « Parc »)', () => {
    const places = [place('Parc', { hasName: false }), place('Parc Borély')]
    expect(names(matchPlaces(places, 'parc'))).toEqual(['Parc Borély'])
  })

  it(`limite à ${MAX_PLACE_SUGGESTIONS} suggestions (les plus pertinentes)`, () => {
    const places = ['Parc 1', 'Parc 2', 'Parc 3', 'Parc 4', 'Parc 5', 'Parc 6', 'Parc'].map(x => place(x))
    const result = matchPlaces(places, 'parc')
    expect(result).toHaveLength(MAX_PLACE_SUGGESTIONS)
    expect(result[0]!.name).toBe('Parc')
  })

  it('ne masque ni ne filtre par catégorie ou statut chien', () => {
    const places = [place('Plage du Prado', { category: 'beach', dogStatus: 'refused' }), place('Prado Café', { category: 'cafe' })]
    expect(names(matchPlaces(places, 'prado'))).toEqual(['Prado Café', 'Plage du Prado'])
  })

  it.each([
    ['vide', ''],
    ['un seul caractère', 'p'],
    ['un caractère entouré d\'espaces', '  p  '],
    ['uniquement de la ponctuation', '!?'],
    ['ponctuation et espaces', ' - \' . '],
  ])('ne propose rien si la saisie est %s', (_label, query) => {
    expect(matchPlaces([place('Parc'), place('P!?')], query)).toEqual([])
    expect(isSearchable(query)).toBe(false)
  })

  it('accepte deux caractères', () => {
    expect(names(matchPlaces([place('Le Lavoir')], 'la'))).toEqual(['Le Lavoir'])
  })
})

describe('isExactPlaceMatch', () => {
  it('vrai pour le même nom aux accents, à la casse et à la ponctuation près', () => {
    const p = place('Café de l\'Église')
    expect(isExactPlaceMatch(p, 'cafe de l eglise')).toBe(true)
    expect(isExactPlaceMatch(p, '  CAFÉ DE L\'ÉGLISE ')).toBe(true)
  })

  it('faux pour un début de nom', () => {
    expect(isExactPlaceMatch(place('Parc Monceau'), 'Parc')).toBe(false)
  })
})

describe('splitGeocodeLabel', () => {
  it('sépare au premier « , » : titre puis détail', () => {
    expect(splitGeocodeLabel(GEOCODE_RIVOLI.results[0]!)).toEqual({ title: '12 Rue de Rivoli', detail: '75004 Paris' })
    expect(splitGeocodeLabel(geocodeOfType('city'))).toEqual({ title: 'Annecy', detail: 'Haute-Savoie' })
  })

  it('garde le reste entier après la première virgule', () => {
    const r: GeocodeResult = { label: 'Lyon, Métropole de Lyon, Rhône', lat: 45.76, lon: 4.83, type: 'city' }
    expect(splitGeocodeLabel(r)).toEqual({ title: 'Lyon', detail: 'Métropole de Lyon, Rhône' })
  })

  it('sans virgule : tout dans le titre, détail vide', () => {
    expect(splitGeocodeLabel(geocodeOfType('region'))).toEqual({ title: 'Bretagne', detail: '' })
  })
})

describe('suggestionsAnnouncement', () => {
  it('0 résultat : « Aucun résultat. »', () => {
    expect(suggestionsAnnouncement(0, 0)).toBe('Aucun résultat.')
  })

  it.each([
    [1, 0, '1 lieu PawSpot.'],
    [3, 0, '3 lieux PawSpot.'],
    [0, 1, '1 adresse ou ville.'],
    [0, 4, '4 adresses ou villes.'],
    [1, 1, '1 lieu PawSpot et 1 adresse ou ville.'],
    [2, 5, '2 lieux PawSpot et 5 adresses ou villes.'],
  ])('%i lieu(x), %i adresse(s) → « %s … »', (places, addresses, start) => {
    const text = suggestionsAnnouncement(places, addresses)
    expect(text.startsWith(start)).toBe(true)
    expect(text).toContain('Flèches haut et bas pour parcourir, Entrée pour choisir.')
  })
})
