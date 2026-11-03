import { describe, expect, it } from 'vitest'
import { isValidPlaceId, placeApiUrl, placePath } from '~/utils/placeUrl'

describe('placePath / placeApiUrl — encodage des identifiants', () => {
  it('encode les deux-points d\'un id OSM', () => {
    expect(placePath('osm:node:123')).toBe('/lieu/osm%3Anode%3A123')
    expect(placeApiUrl('osm:way:42')).toBe('/api/places/osm%3Away%3A42')
  })

  it('encode un id saisi de travers sans casser le chemin', () => {
    expect(placePath('../admin')).toBe('/lieu/..%2Fadmin')
    expect(placeApiUrl('a?b#c')).toBe('/api/places/a%3Fb%23c')
  })

  it('le chemin décodé redonne l\'id', () => {
    const id = 'user:Ab_c-12'
    expect(decodeURIComponent(placePath(id).slice('/lieu/'.length))).toBe(id)
  })
})

describe('isValidPlaceId', () => {
  it.each(['osm:node:123', 'osm:way:1', 'osm:relation:9999999999999999', 'user:abc', 'user:Ab_c-12'])('accepte %s', (id) => {
    expect(isValidPlaceId(id)).toBe(true)
  })

  it.each([
    '',
    'osm:node:',
    'osm:node:0',
    'osm:node:0123',
    'osm:node:12a',
    'osm:area:12',
    'osm:node:12345678901234567',
    'user:',
    'user:a b',
    `user:${'a'.repeat(65)}`,
    'osm%3Anode%3A123',
    ' osm:node:123',
    'node:123',
  ])('refuse « %s »', (id) => {
    expect(isValidPlaceId(id)).toBe(false)
  })
})
