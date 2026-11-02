import { describe, expect, it } from 'vitest'
import {
  convertLegacyPlaceId,
  favoriteBodySchema,
  osmPlaceId,
  parsePlaceId,
  placeIdSchema,
  placesQuerySchema,
} from '../../../../shared/schemas'
import { normalizeName } from '../../../../shared/text'

describe('normalizeName', () => {
  it.each([
    ['Café de l\'Église', 'cafe de l eglise'],
    ['  BAR   DU  Coin ', 'bar du coin'],
    ['Œuf & Bœuf', 'oeuf boeuf'],
    ['Ex-æquo', 'ex aequo'],
    ['Château-d\'Œx n°2', 'chateau d oex n 2'],
    ['Crêperie « La Bretonne »', 'creperie la bretonne'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeName(input)).toBe(expected)
  })

  it('renvoie une chaîne vide pour une valeur absente', () => {
    expect(normalizeName(undefined)).toBe('')
    expect(normalizeName(null)).toBe('')
    expect(normalizeName('')).toBe('')
    expect(normalizeName('!!!')).toBe('')
  })
})

describe('placeIdSchema', () => {
  it.each(['osm:node:1', 'osm:way:123456', 'osm:relation:9876543210', 'user:demo-1', 'user:V1StGXR8_Z5jdHi6B-myT'])('accepte %s', (id) => {
    expect(placeIdSchema.parse(id)).toBe(id)
  })

  it('retire les espaces autour', () => {
    expect(placeIdSchema.parse('  osm:node:42 ')).toBe('osm:node:42')
  })

  it.each([
    'node-1',
    'osm:node:0',
    'osm:node:012',
    'osm:point:1',
    'osm:node:1a',
    'osm:node:12345678901234567',
    'user:',
    `user:${'a'.repeat(65)}`,
    'user:a b',
    'user:../etc',
    '',
  ])('refuse %s avec un message en français', (id) => {
    const result = placeIdSchema.safeParse(id)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Identifiant de lieu invalide')
  })

  it('refuse une valeur qui n\'est pas une chaîne', () => {
    const result = placeIdSchema.safeParse(42)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Identifiant de lieu requis')
  })

  it('favoriteBodySchema valide placeId', () => {
    expect(favoriteBodySchema.safeParse({ placeId: 'osm:node:1' }).success).toBe(true)
    expect(favoriteBodySchema.safeParse({ placeId: 'node-1' }).success).toBe(false)
    expect(favoriteBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('placesQuerySchema', () => {
  it('convertit bbox et zoom (chaînes de getQuery)', () => {
    expect(placesQuerySchema.parse({ bbox: '2.30,48.85,2.35,48.88', zoom: '14' })).toEqual({
      bbox: { minLon: 2.3, minLat: 48.85, maxLon: 2.35, maxLat: 48.88 },
      zoom: 14,
    })
  })

  it.each([
    [{ zoom: '14' }, 'Emprise (bbox) requise'],
    [{ bbox: '2.3,48.85,2.35', zoom: '14' }, 'Emprise invalide : attendu minLon,minLat,maxLon,maxLat'],
    [{ bbox: '2.3,48.85,2.35,98', zoom: '14' }, 'Emprise invalide : attendu minLon,minLat,maxLon,maxLat'],
    [{ bbox: '2.3,48.85,2.35,48.88', zoom: '14.5' }, 'Le zoom doit être un entier'],
    [{ bbox: '2.3,48.85,2.35,48.88', zoom: '23' }, 'Zoom invalide'],
    [{ bbox: '2.3,48.85,2.35,48.88', zoom: '-1' }, 'Zoom invalide'],
    [{ bbox: '2.3,48.85,2.35,48.88', zoom: 'abc' }, 'Zoom invalide'],
  ])('refuse %o', (query, message) => {
    const result = placesQuerySchema.safeParse(query)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(i => i.message)).toContain(message)
  })
})

describe('identifiants de lieux', () => {
  it.each([
    ['node-1', 'osm:node:1'],
    ['way-2', 'osm:way:2'],
    ['relation-345', 'osm:relation:345'],
    ['demo-1', 'user:demo-1'],
    ['osm:node:1', 'osm:node:1'],
    ['user:abc', 'user:abc'],
  ])('convertLegacyPlaceId(%s) → %s', (legacy, expected) => {
    expect(convertLegacyPlaceId(legacy)).toBe(expected)
  })

  it.each(['node-0', 'node-01', 'node-1a', 'point-1', 'demo-', 'n\'importe quoi', ''])('convertLegacyPlaceId(%s) → null', (legacy) => {
    expect(convertLegacyPlaceId(legacy)).toBeNull()
  })

  it('parsePlaceId et osmPlaceId', () => {
    expect(parsePlaceId('osm:way:42')).toEqual({ source: 'osm', osmType: 'way', osmId: 42 })
    expect(parsePlaceId('user:demo-1')).toEqual({ source: 'user', key: 'demo-1' })
    expect(parsePlaceId('way-42')).toBeNull()
    expect(osmPlaceId('relation', 7)).toBe('osm:relation:7')
  })
})
