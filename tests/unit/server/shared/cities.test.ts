import { describe, expect, it } from 'vitest'
import { MAX_COVERING_TILES } from '../../../../server/services/places'
import { cityBbox, cityTileCount, findPrefetchCity, PREFETCH_CITIES } from '../../../../shared/cities'
import { isInCoverage } from '../../../../shared/geo'

describe('PREFETCH_CITIES', () => {
  it('clés uniques', () => {
    const keys = PREFETCH_CITIES.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each(PREFETCH_CITIES.map(c => [c.name, c] as const))('%s : centre couvert par PawSpot et emprise sous MAX_COVERING_TILES', (_name, city) => {
    expect(isInCoverage(city.lat, city.lon)).toBe(true)
    const count = cityTileCount(city)
    expect(count).toBeGreaterThanOrEqual(1)
    expect(count).toBeLessThanOrEqual(MAX_COVERING_TILES)
    const b = cityBbox(city)
    expect(b.minLat).toBeLessThan(city.lat)
    expect(b.maxLon).toBeGreaterThan(city.lon)
  })
})

describe('findPrefetchCity', () => {
  it.each([
    ['saint etienne', 'saint-etienne'],
    ['Saint-Étienne', 'saint-etienne'],
    ['SAINT-ETIENNE', 'saint-etienne'],
    ['paris', 'paris'],
    ['Nîmes', 'nimes'],
    ['nimes', 'nimes'],
    ['aix-en-provence', 'aix-en-provence'],
  ])('« %s » → %s', (query, key) => {
    expect(findPrefetchCity(query)?.key).toBe(key)
  })

  it('préfixe unique : « Saint-Denis » → Saint-Denis (La Réunion)', () => {
    expect(findPrefetchCity('Saint-Denis')?.key).toBe('saint-denis-reunion')
  })

  it.each([
    ['préfixe ambigu « Saint »', 'Saint'],
    ['préfixe ambigu « Le »', 'Le'],
    ['ville inconnue', 'Londres'],
    ['chaîne vide', ''],
    ['espaces seuls', '   '],
    ['ponctuation seule', '--'],
  ])('%s → null', (_label, query) => {
    expect(findPrefetchCity(query)).toBeNull()
  })
})
