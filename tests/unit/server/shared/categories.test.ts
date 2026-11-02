import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  CATEGORY_KEYS,
  categoryFromTags,
  isCategoryKey,
  isPlaceEligible,
  overpassStatements,
} from '../../../../shared/categories'
import type { CategoryKey } from '../../../../shared/categories'

describe('categoryFromTags', () => {
  it.each<[CategoryKey, Record<string, string>]>([
    ['dog_park', { leisure: 'dog_park' }],
    ['park', { leisure: 'park' }],
    ['beach', { natural: 'beach' }],
    ['beach', { leisure: 'beach' }],
    ['restaurant', { amenity: 'restaurant', outdoor_seating: 'yes' }],
    ['restaurant', { amenity: 'restaurant', dog: 'yes' }],
    ['bar', { amenity: 'bar', dog: 'leashed' }],
    ['cafe', { amenity: 'cafe', dog: 'outside' }],
    ['cafe', { amenity: 'CAFE', outdoor_seating: ' Yes ' }],
    ['vet', { amenity: 'veterinary' }],
    ['pet_shop', { shop: 'pet' }],
    ['groomer', { shop: 'pet_grooming' }],
    ['dog_bin', { vending: 'excrement_bags' }],
    ['dog_bin', { amenity: 'waste_basket', waste: 'trash;dog_excrement' }],
    ['dog_bin', { amenity: 'vending_machine', vending: 'drinks; excrement_bags' }],
  ])('classe en %s : %o', (expected, tags) => {
    expect(categoryFromTags(tags)).toBe(expected)
  })

  it('un resto sans terrasse ni tag chien n\'a pas de catégorie', () => {
    expect(categoryFromTags({ amenity: 'restaurant', name: 'Chez Paul' })).toBeNull()
    expect(categoryFromTags({ amenity: 'bar', outdoor_seating: 'no' })).toBeNull()
    expect(categoryFromTags({ amenity: 'cafe', dog: 'no' })).toBeNull()
  })

  it('un resto dog=no avec terrasse a une catégorie mais est exclu', () => {
    const tags = { amenity: 'restaurant', outdoor_seating: 'yes', dog: 'no' }
    expect(categoryFromTags(tags)).toBe('restaurant')
    expect(isPlaceEligible('restaurant', tags)).toBe(false)
  })

  it('ignore les éléments hors catégories', () => {
    expect(categoryFromTags({})).toBeNull()
    expect(categoryFromTags({ amenity: 'bank' })).toBeNull()
    expect(categoryFromTags({ waste: 'dog_excrements' })).toBeNull()
  })
})

describe('isPlaceEligible', () => {
  it.each(['restaurant', 'bar', 'cafe'] as const)('%s : exclu dès que dog=no, même avec un dog:conditional', (cat) => {
    expect(isPlaceEligible(cat, { dog: 'no', outdoor_seating: 'yes' })).toBe(false)
    expect(isPlaceEligible(cat, { 'dog': 'no', 'dog:conditional': 'yes @ (Oct-May)' })).toBe(false)
    expect(isPlaceEligible(cat, { outdoor_seating: 'yes' })).toBe(true)
  })

  it('autres catégories : exclues si dog=no sans exception', () => {
    expect(isPlaceEligible('park', { dog: 'no' })).toBe(false)
    expect(isPlaceEligible('beach', { 'dog': 'no', 'dog:conditional': 'no @ (Jun-Sep)' })).toBe(false)
  })

  it('autres catégories : gardées si un dog:conditional autorise à certains moments', () => {
    expect(isPlaceEligible('beach', { 'dog': 'no', 'dog:conditional': 'yes @ (19:00-09:00)' })).toBe(true)
    expect(isPlaceEligible('park', { 'dog:conditional': 'no @ (Jun-Sep)' })).toBe(true)
    expect(isPlaceEligible('park', {})).toBe(true)
  })
})

describe('configuration des catégories', () => {
  it('chaque catégorie a libellés, icône, couleur hexadécimale et au moins un sélecteur', () => {
    for (const key of CATEGORY_KEYS) {
      const c = CATEGORIES[key]
      expect(c.label).toBeTruthy()
      expect(c.singular).toBeTruthy()
      expect(c.icon).toBeTruthy()
      expect(c.color).toMatch(/^#[0-9A-F]{6}$/i)
      expect(c.osm.length).toBeGreaterThan(0)
    }
    expect(isCategoryKey('park')).toBe(true)
    expect(isCategoryKey('toString')).toBe(false)
    expect(isCategoryKey(42)).toBe(false)
  })
})

describe('overpassStatements', () => {
  it('produit une instruction par sélecteur pour toutes les catégories', () => {
    const statements = overpassStatements()
    expect(statements).toContain('nwr["leisure"="park"];')
    expect(statements).toContain('nwr["leisure"="dog_park"];')
    expect(statements).toContain('nwr["natural"="beach"];')
    expect(statements).toContain('nwr["amenity"="veterinary"];')
    expect(statements).toContain('nwr["amenity"="cafe"]["outdoor_seating"="yes"];')
    expect(statements).toContain('nwr["amenity"="restaurant"]["dog"~"^(yes|leashed|outside)$",i];')
    expect(statements).toContain('nwr["waste"~"(^|;) *dog_excrement *(;|$)"];')
    const expected = CATEGORY_KEYS.reduce((n, k) => n + CATEGORIES[k].osm.length, 0)
    expect(statements).toHaveLength(expected)
    expect(new Set(statements).size).toBe(statements.length)
    for (const s of statements) expect(s).toMatch(/^nwr(\[[^\]]+\])+;$/)
  })

  it('limite aux catégories demandées', () => {
    expect(overpassStatements(['vet'])).toEqual(['nwr["amenity"="veterinary"];'])
    expect(overpassStatements(['bar'])).toHaveLength(2)
  })
})
