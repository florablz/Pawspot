/**
 * Emprises (bbox) et tuiles « slippy map » (schéma OSM / Leaflet, EPSG:3857).
 * Fonctions pures, client et serveur.
 */

/** Emprise en degrés WGS84. On ne gère pas le passage de l'antiméridien (minLon ≤ maxLon). */
export interface Bbox {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

export interface Tile {
  z: number
  x: number
  y: number
}

/** Plage de tuiles (bornes incluses) à un zoom donné. */
export interface TileRange {
  z: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Zoom de la grille du cache (`fetched_tiles`). */
export const CACHE_TILE_ZOOM = 12

/** Latitude maximale de la projection Web Mercator. */
export const MAX_MERCATOR_LAT = 85.05112878

/** Vrai si l'emprise est finie, dans les bornes lat/lon et non inversée. */
export function isValidBbox(b: Bbox): boolean {
  const { minLon, minLat, maxLon, maxLat } = b
  return [minLon, minLat, maxLon, maxLat].every(Number.isFinite)
    && minLon >= -180 && maxLon <= 180 && minLat >= -90 && maxLat <= 90
    && minLon <= maxLon && minLat <= maxLat
}

/**
 * Lit `minLon,minLat,maxLon,maxLat` (ordre de Leaflet `toBBoxString()`).
 * `null` si le format ou les bornes sont invalides.
 */
export function parseBbox(value: string | null | undefined): Bbox | null {
  if (typeof value !== 'string') return null
  const parts = value.split(',')
  if (parts.length !== 4) return null
  // Number('') vaut 0 : on refuse explicitement les morceaux vides.
  if (parts.some(p => p.trim() === '')) return null
  const [minLon, minLat, maxLon, maxLat] = parts.map(Number) as [number, number, number, number]
  const bbox = { minLon, minLat, maxLon, maxLat }
  return isValidBbox(bbox) ? bbox : null
}

/** Inverse de `parseBbox`. */
export function formatBbox(b: Bbox): string {
  return `${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}`
}

export function bboxCenter(b: Bbox): { lat: number; lon: number } {
  return { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 }
}

function clampLat(lat: number): number {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat))
}

/** Colonne de la tuile contenant `lon` (bornée à [0, 2^z − 1]). */
export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  return Math.max(0, Math.min(n - 1, x))
}

/** Ligne de la tuile contenant `lat` (y = 0 au nord, bornée à [0, 2^z − 1]). */
export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z
  const rad = (clampLat(lat) * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  return Math.max(0, Math.min(n - 1, y))
}

function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(Math.sinh(n))
}

/** Plage des tuiles de zoom `z` qui recouvrent l'emprise (calcul en O(1)). */
export function tileRangeForBbox(b: Bbox, z: number = CACHE_TILE_ZOOM): TileRange {
  return {
    z,
    minX: lonToTileX(b.minLon, z),
    maxX: lonToTileX(b.maxLon, z),
    // Le nord (maxLat) donne le plus petit y.
    minY: latToTileY(b.maxLat, z),
    maxY: latToTileY(b.minLat, z),
  }
}

export function tileRangeSize(r: TileRange): number {
  return (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1)
}

export function tilesInRange(r: TileRange): Tile[] {
  const tiles: Tile[] = []
  for (let x = r.minX; x <= r.maxX; x++) {
    for (let y = r.minY; y <= r.maxY; y++) tiles.push({ z: r.z, x, y })
  }
  return tiles
}

/**
 * Tuiles de zoom `z` (12 par défaut) qui recouvrent l'emprise.
 * Attention au nombre : vérifier `tileRangeSize(tileRangeForBbox(b))` avant
 * d'appeler cette fonction sur une grande emprise.
 */
export function tilesForBbox(b: Bbox, z: number = CACHE_TILE_ZOOM): Tile[] {
  return tilesInRange(tileRangeForBbox(b, z))
}

/** Emprise d'une tuile. */
export function tileToBbox(t: Tile): Bbox {
  return {
    minLon: tileXToLon(t.x, t.z),
    maxLon: tileXToLon(t.x + 1, t.z),
    maxLat: tileYToLat(t.y, t.z),
    minLat: tileYToLat(t.y + 1, t.z),
  }
}

/** Emprise d'une plage de tuiles. */
export function tileRangeToBbox(r: TileRange): Bbox {
  const nw = tileToBbox({ z: r.z, x: r.minX, y: r.minY })
  const se = tileToBbox({ z: r.z, x: r.maxX, y: r.maxY })
  return { minLon: nw.minLon, maxLat: nw.maxLat, maxLon: se.maxLon, minLat: se.minLat }
}

/** Plus petite plage contenant toutes les tuiles (même zoom). `null` si la liste est vide. */
export function tilesToRange(tiles: readonly Tile[]): TileRange | null {
  if (!tiles.length) return null
  const z = tiles[0]!.z
  return {
    z,
    minX: Math.min(...tiles.map(t => t.x)),
    maxX: Math.max(...tiles.map(t => t.x)),
    minY: Math.min(...tiles.map(t => t.y)),
    maxY: Math.max(...tiles.map(t => t.y)),
  }
}

export function tileKey(t: Tile): string {
  return `${t.z}/${t.x}/${t.y}`
}
