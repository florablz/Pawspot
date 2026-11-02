import { describe, expect, it } from 'vitest'
import { filterPlaces } from '~/utils/placeFilters'
import type { PlaceFilters } from '~/utils/placeFilters'
import { makePlace } from '../_helpers'

const PLACES = [
  makePlace({ id: 'osm:node:1', name: 'Café de l\'Église', category: 'cafe', dogStatus: 'confirmed' }),
  makePlace({ id: 'osm:node:2', name: 'Parc Monceau', category: 'park', dogStatus: 'osm_yes' }),
  makePlace({ id: 'osm:node:3', name: 'Bar du Parc', category: 'bar', dogStatus: 'confirmed_outside_only' }),
  makePlace({ id: 'osm:node:4', name: 'Bœuf à la mode', category: 'restaurant', dogStatus: 'likely_terrace' }),
  makePlace({ id: 'osm:node:5', name: 'Clinique vétérinaire', category: 'vet', dogStatus: 'refused' }),
]

const NONE: PlaceFilters = { query: '', categories: [], confirmedOnly: false }
const ids = (filters: Partial<PlaceFilters>) => filterPlaces(PLACES, { ...NONE, ...filters }).map(p => p.id.slice(9))

describe('filterPlaces', () => {
  it('sans filtre : tous les lieux, dans l\'ordre, sans modifier la liste', () => {
    const result = filterPlaces(PLACES, NONE)
    expect(result).toEqual(PLACES)
    expect(result).not.toBe(PLACES)
  })

  it('liste de catégories vide = toutes les catégories', () => {
    expect(ids({ categories: [] })).toEqual(['1', '2', '3', '4', '5'])
  })

  it.each([
    ['casse', 'PARC', ['2', '3']],
    ['accents dans le nom', 'eglise', ['1']],
    ['accents dans la recherche', 'CAFÉ', ['1']],
    ['accents dans la recherche (présents)', 'vétérinaire', ['5']],
    ['ligature œ', 'boeuf', ['4']],
    ['apostrophe et espaces', '  de l eglise ', ['1']],
  ])('recherche par nom sans tenir compte de la %s', (_label, query, expected) => {
    expect(ids({ query })).toEqual(expected)
  })

  it('une recherche faite seulement de ponctuation ne filtre rien', () => {
    expect(ids({ query: ' \' - ' })).toEqual(['1', '2', '3', '4', '5'])
  })

  it('plusieurs catégories : garde l\'union', () => {
    expect(ids({ categories: ['cafe', 'bar'] })).toEqual(['1', '3'])
    expect(ids({ categories: ['beach'] })).toEqual([])
  })

  it('confirmedOnly : seulement confirmed et confirmed_outside_only', () => {
    expect(ids({ confirmedOnly: true })).toEqual(['1', '3'])
  })

  it('combine nom, catégories et confirmedOnly', () => {
    expect(ids({ query: 'parc', categories: ['park', 'bar'], confirmedOnly: true })).toEqual(['3'])
    expect(ids({ query: 'parc', categories: ['park'], confirmedOnly: true })).toEqual([])
  })
})
