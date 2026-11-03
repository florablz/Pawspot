import { describe, expect, it } from 'vitest'
import {
  CACHE_TILE_ZOOM,
  COVERAGE_AREAS,
  bboxIntersects,
  bboxTouchesCoverage,
  isInCoverage,
  isValidBbox,
  bboxCenter,
  formatBbox,
  latToTileY,
  lonToTileX,
  parseBbox,
  tileKey,
  tileRangeForBbox,
  tileRangeSize,
  tileRangeToBbox,
  tileToBbox,
  tilesForBbox,
  tilesToRange,
} from '../../../../shared/geo'

describe('parseBbox', () => {
  it('lit minLon,minLat,maxLon,maxLat', () => {
    expect(parseBbox('2.30,48.85,2.35,48.88')).toEqual({ minLon: 2.3, minLat: 48.85, maxLon: 2.35, maxLat: 48.88 })
    expect(parseBbox(' 2.3 , 48.85 , 2.35 , 48.88 ')).toEqual({ minLon: 2.3, minLat: 48.85, maxLon: 2.35, maxLat: 48.88 })
  })

  it.each([
    ['vide', ''],
    ['undefined', undefined],
    ['null', null],
    ['3 nombres', '2.3,48.85,2.35'],
    ['5 nombres', '2.3,48.85,2.35,48.88,1'],
    ['un morceau vide', '2.3,,2.35,48.88'],
    ['du texte', 'a,b,c,d'],
    ['NaN / Infinity', 'NaN,48,2,49'],
    ['minLon > maxLon', '2.35,48.85,2.30,48.88'],
    ['minLat > maxLat', '2.30,48.88,2.35,48.85'],
    ['latitude 98', '2.3,48.85,2.35,98'],
    ['longitude 181', '2.3,48.85,181,48.88'],
    ['antiméridien (170 → -170)', '170,-20,-170,-10'],
  ])('refuse %s', (_label, value) => {
    expect(parseBbox(value as string | null | undefined)).toBeNull()
  })

  it('accepte les bornes extrêmes', () => {
    expect(parseBbox('-180,-90,180,90')).toEqual({ minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 })
  })

  it('formatBbox est l\'inverse de parseBbox', () => {
    const b = { minLon: 2.3, minLat: 48.85, maxLon: 2.35, maxLat: 48.88 }
    expect(parseBbox(formatBbox(b))).toEqual(b)
    expect(bboxCenter(b).lat).toBeCloseTo(48.865)
    expect(bboxCenter(b).lon).toBeCloseTo(2.325)
  })
})

describe('tuiles de zoom 12', () => {
  it('le cache utilise le zoom 12', () => {
    expect(CACHE_TILE_ZOOM).toBe(12)
  })

  it('place Notre-Dame de Paris dans la tuile 12/2074/1409', () => {
    // Valeur de référence OSM : https://tile.openstreetmap.org/12/2074/1409.png couvre l'île de la Cité.
    expect(lonToTileX(2.3499, 12)).toBe(2074)
    expect(latToTileY(48.8530, 12)).toBe(1409)
  })

  it('borne les tuiles aux extrêmes (±180, ±90)', () => {
    expect(lonToTileX(-180, 12)).toBe(0)
    expect(lonToTileX(180, 12)).toBe(4095)
    expect(latToTileY(90, 12)).toBe(0)
    expect(latToTileY(-90, 12)).toBe(4095)
    expect(latToTileY(85.0511, 12)).toBe(0)
    expect(latToTileY(0, 12)).toBe(2048)
  })

  it('le monde entier fait 4096 × 4096 tuiles (calcul en O(1))', () => {
    const range = tileRangeForBbox({ minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 })
    expect(range).toEqual({ z: 12, minX: 0, maxX: 4095, minY: 0, maxY: 4095 })
    expect(tileRangeSize(range)).toBe(4096 * 4096)
  })

  it('une petite emprise dans une tuile donne une seule tuile', () => {
    expect(tilesForBbox({ minLon: 2.345, minLat: 48.851, maxLon: 2.350, maxLat: 48.853 })).toEqual([{ z: 12, x: 2074, y: 1409 }])
  })

  it('tileToBbox et tilesForBbox sont cohérents', () => {
    for (const tile of [{ z: 12, x: 2074, y: 1409 }, { z: 12, x: 0, y: 0 }, { z: 12, x: 4095, y: 4095 }, { z: 10, x: 518, y: 352 }]) {
      const b = tileToBbox(tile)
      expect(b.minLon).toBeLessThan(b.maxLon)
      expect(b.minLat).toBeLessThan(b.maxLat)
      // Une emprise strictement intérieure à la tuile ne couvre qu'elle.
      const eps = 1e-6
      const inner = { minLon: b.minLon + eps, minLat: b.minLat + eps, maxLon: b.maxLon - eps, maxLat: b.maxLat - eps }
      expect(tilesForBbox(inner, tile.z)).toEqual([tile])
    }
  })

  it('les tuiles voisines se touchent sans se chevaucher', () => {
    const a = tileToBbox({ z: 12, x: 2074, y: 1409 })
    const right = tileToBbox({ z: 12, x: 2075, y: 1409 })
    const below = tileToBbox({ z: 12, x: 2074, y: 1410 })
    expect(right.minLon).toBeCloseTo(a.maxLon, 10)
    expect(below.maxLat).toBeCloseTo(a.minLat, 10)
  })

  it('tileRangeToBbox ↔ tileRangeForBbox, et tilesToRange', () => {
    const range = { z: 12, minX: 2072, maxX: 2075, minY: 1408, maxY: 1410 }
    const b = tileRangeToBbox(range)
    const eps = 1e-6
    const back = tileRangeForBbox({ minLon: b.minLon + eps, minLat: b.minLat + eps, maxLon: b.maxLon - eps, maxLat: b.maxLat - eps })
    expect(back).toEqual(range)
    const tiles = tilesForBbox(b)
    expect(tilesToRange(tiles.filter(t => t.x >= 2072 && t.x <= 2075 && t.y >= 1408 && t.y <= 1410))).toEqual(range)
    expect(tilesToRange([])).toBeNull()
    expect(tileKey({ z: 12, x: 2074, y: 1409 })).toBe('12/2074/1409')
  })
})

describe('couverture : France métropolitaine, Corse, DROM et COM', () => {
  it('chaque boîte est valide et ne traverse pas l\'antiméridien', () => {
    for (const area of COVERAGE_AREAS) {
      expect(isValidBbox(area.bbox), area.key).toBe(true)
      expect(area.bbox.minLon).toBeLessThanOrEqual(area.bbox.maxLon)
    }
  })

  it.each([
    ['Paris', 48.8566, 2.3522],
    ['Ajaccio (Corse)', 41.9192, 8.7386],
    ['Brest', 48.3904, -4.4861],
    ['Strasbourg', 48.5734, 7.7521],
    ['Pointe-à-Pitre (Guadeloupe)', 16.2411, -61.5331],
    ['Fort-de-France (Martinique)', 14.6161, -61.0588],
    ['Cayenne (Guyane)', 4.9224, -52.3135],
    ['Saint-Denis (La Réunion)', -20.8821, 55.4507],
    ['Mamoudzou (Mayotte)', -12.7806, 45.2279],
    ['Saint-Pierre', 46.7811, -56.1764],
    ['Gustavia (Saint-Barthélemy)', 17.8962, -62.8498],
    ['Marigot (Saint-Martin)', 18.0679, -63.0822],
    ['Papeete (Polynésie)', -17.5516, -149.5585],
    ['Nouméa (Nouvelle-Calédonie)', -22.2758, 166.458],
    ['Mata-Utu (Wallis)', -13.2825, -176.1736],
    ['Futuna', -14.2938, -178.1165],
  ])('%s est couvert', (_name, lat, lon) => {
    expect(isInCoverage(lat, lon)).toBe(true)
  })

  it.each([
    ['New York', 40.7128, -74.006],
    ['Tokyo', 35.6762, 139.6503],
    ['Madrid', 40.4168, -3.7038],
    ['Fidji, de l\'autre côté de l\'antiméridien', -17.7134, 178.065],
    ['Samoa (à l\'est de Wallis)', -13.759, -172.1046],
    ['îles Cook (à l\'ouest de la Polynésie)', -21.2367, -159.7777],
  ])('%s n\'est pas couvert', (_name, lat, lon) => {
    expect(isInCoverage(lat, lon)).toBe(false)
  })

  it('coordonnées non finies → hors couverture', () => {
    expect(isInCoverage(Number.NaN, 2.35)).toBe(false)
    expect(isInCoverage(48.85, Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('bboxIntersects : bords compris, disjointes sinon', () => {
    const a = { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 }
    expect(bboxIntersects(a, { minLon: 1, minLat: 1, maxLon: 2, maxLat: 2 })).toBe(true)
    expect(bboxIntersects(a, { minLon: 0.2, minLat: 0.2, maxLon: 0.3, maxLat: 0.3 })).toBe(true)
    expect(bboxIntersects(a, { minLon: 1.01, minLat: 0, maxLon: 2, maxLat: 1 })).toBe(false)
    expect(bboxIntersects(a, { minLon: 0, minLat: -2, maxLon: 1, maxLat: -0.01 })).toBe(false)
  })

  it('emprise qui chevauche la frontière (Genève, Bâle) : touche la couverture', () => {
    expect(bboxTouchesCoverage({ minLon: 5.9, minLat: 46.1, maxLon: 6.3, maxLat: 46.3 })).toBe(true)
    // Emprise entièrement en Allemagne, juste à l'est de la boîte métropolitaine.
    expect(bboxTouchesCoverage({ minLon: 10.05, minLat: 48.0, maxLon: 10.3, maxLat: 48.2 })).toBe(false)
  })

  it('près de l\'antiméridien : Wallis touché depuis -180, rien côté +180 (Fidji)', () => {
    expect(bboxTouchesCoverage({ minLon: -180, minLat: -14.6, maxLon: -178.2, maxLat: -14 })).toBe(true)
    expect(bboxTouchesCoverage({ minLon: 178, minLat: -14.6, maxLon: 180, maxLat: -13 })).toBe(false)
  })

  it('emprise sur toute la largeur du Pacifique Sud : touche Wallis, la Polynésie et la Nouvelle-Calédonie', () => {
    expect(bboxTouchesCoverage({ minLon: -180, minLat: -25, maxLon: 180, maxLat: -10 })).toBe(true)
  })

  it('emprise en plein océan → hors couverture', () => {
    expect(bboxTouchesCoverage({ minLon: -40, minLat: 30, maxLon: -35, maxLat: 35 })).toBe(false)
  })
})
