/**
 * Service des lieux : cache en base des lieux OSM, rafraîchi par tuiles de zoom 12
 * (CAHIER_DES_CHARGES.md §4.1), et accès aux lieux pour les routes.
 *
 * Toutes les fonctions acceptent des dépendances injectables (`db`, `fetch`,
 * `now`…) pour les tests : aucun appel réseau réel n'est nécessaire.
 */
import type { BatchItem } from 'drizzle-orm/batch'
import { and, between, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { computeDogStatus, ALERT_VISIBILITY_DAYS } from '../../../shared/dogStatus'
import type { DogStatusResult } from '../../../shared/dogStatus'
import {
  bboxCenter, CACHE_TILE_ZOOM, latToTileY, lonToTileX, tileKey, tileRangeForBbox,
  tileRangeSize, tileRangeToBbox, tilesInRange, tilesToRange,
} from '../../../shared/geo'
import type { Bbox, Tile, TileRange } from '../../../shared/geo'
import { osmPlaceId, parsePlaceId } from '../../../shared/schemas'
import type { Place, PlacesResponse } from '../../../shared/types'
import type { Database } from '../../database'
import { alerts, fetchedTiles, places } from '../../database/schema'
import type { NewPlaceRow, PlaceRow } from '../../database/schema'
import { elementToPlaceRow, rowToPlace } from './mapping'
import type { CommunitySignals } from './mapping'
import { buildOverpassBboxQuery, buildOverpassElementQuery, runOverpassQuery } from './overpass'
import type { OverpassDeps, OverpassElement } from './overpass'

export { OverpassError, OVERPASS_ENDPOINTS, OVERPASS_TIMEOUT_MS, buildOverpassBboxQuery, runOverpassQuery } from './overpass'
export type { OverpassElement, OverpassDeps } from './overpass'
export { elementToPlaceRow, rowToPlace, buildAddress } from './mapping'

/** En dessous de ce zoom, Overpass n'est jamais interrogé. */
export const MIN_OVERPASS_ZOOM = 11
/** Une tuile chargée il y a plus de 7 jours est rafraîchie. */
export const TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Tuiles rafraîchies au plus par requête (rectangle de tuiles, une seule requête Overpass). */
export const MAX_REFRESH_TILES = 16
/** Au-delà de ce nombre de tuiles couvrant l'emprise, on la traite comme « zoom trop bas ». */
export const MAX_COVERING_TILES = 64
/** Nombre maximal de lieux renvoyés par `getPlacesInBbox`. */
export const MAX_PLACES_PER_RESPONSE = 2000

export interface PlacesDeps extends OverpassDeps {
  db?: Database
  now?: () => Date
}

async function getDb(deps: PlacesDeps): Promise<Database> {
  // Import paresseux : un test qui injecte `db` n'ouvre pas la base par défaut.
  return deps.db ?? (await import('../../database')).db
}

const CHUNK = 100

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------------------
// Signaux communautaires (alertes en Phase 1, retours `dog_reports` en Phase 3)
// ---------------------------------------------------------------------------

/**
 * Alertes récentes (< 90 jours) et retours chien des lieux donnés.
 * Phase 3 : ajouter ici la lecture de `dog_reports`.
 */
export async function loadCommunitySignals(db: Database, placeIds: readonly string[], now: Date): Promise<Map<string, CommunitySignals>> {
  const result = new Map<string, CommunitySignals>()
  const since = new Date(now.getTime() - ALERT_VISIBILITY_DAYS * 24 * 60 * 60 * 1000)
  for (const ids of chunks(placeIds, 500)) {
    const rows = await db.select({ placeId: alerts.placeId, userId: alerts.userId, type: alerts.type, createdAt: alerts.createdAt })
      .from(alerts)
      .where(and(inArray(alerts.placeId, ids), gte(alerts.createdAt, since)))
    for (const r of rows) {
      let s = result.get(r.placeId)
      if (!s) result.set(r.placeId, (s = { reports: [], alerts: [] }))
      s.alerts.push({ userId: r.userId, type: r.type, createdAt: r.createdAt })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

/** Colonnes mises à jour quand un lieu OSM déjà en base est relu depuis Overpass. */
const OSM_UPDATED_COLUMNS = [
  'name', 'nameNormalized', 'lat', 'lon', 'category', 'osmDogPolicy', 'hasTerrace',
  'dogStatus', 'dogStatusInfo', 'tags', 'address', 'phone', 'website', 'openingHours',
  'image', 'cuisine', 'description', 'fetchedAt', 'updatedAt',
] as const satisfies readonly (keyof NewPlaceRow)[]

function upsertStatements(db: Database, rows: readonly NewPlaceRow[]) {
  const set: Record<string, unknown> = {}
  for (const key of OSM_UPDATED_COLUMNS) set[key] = sql.raw(`excluded."${places[key].name}"`)
  // Un lieu « disparu » qui réapparaît redevient actif ; closed / hidden / merged sont gardés.
  set.status = sql`CASE WHEN ${places.status} = 'removed' THEN 'active' ELSE ${places.status} END`
  return chunks(rows).map(chunk => db.insert(places).values(chunk).onConflictDoUpdate({ target: places.id, set }))
}

function elementsToRows(elements: readonly OverpassElement[], signals: Map<string, CommunitySignals>, now: Date): NewPlaceRow[] {
  const rows = new Map<string, NewPlaceRow>()
  for (const el of elements) {
    const row = elementToPlaceRow(el, now, signals.get(osmPlaceId(el.type, el.id)))
    if (row) rows.set(row.id, row)
  }
  return [...rows.values()]
}

/**
 * Insère ou met à jour des lieux OSM (sans toucher aux tuiles). Renvoie les lignes écrites.
 * Le statut chien tient compte des alertes déjà en base.
 */
export async function upsertOsmElements(elements: readonly OverpassElement[], deps: PlacesDeps = {}): Promise<NewPlaceRow[]> {
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const signals = await loadCommunitySignals(db, elements.map(el => osmPlaceId(el.type, el.id)), now)
  const rows = elementsToRows(elements, signals, now)
  const statements: BatchItem<'sqlite'>[] = upsertStatements(db, rows)
  if (statements.length) await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  return rows
}

// ---------------------------------------------------------------------------
// Rafraîchissement par tuiles
// ---------------------------------------------------------------------------

interface RefreshResult {
  /** Overpass a échoué : rien n'a été rafraîchi. */
  failed: boolean
  /** Tuiles périmées laissées pour une prochaine requête. */
  remaining: number
}

/**
 * Choisit le rectangle de tuiles à rafraîchir : toutes les tuiles périmées si elles
 * tiennent dans `MAX_REFRESH_TILES`, sinon les plus proches du centre de la carte.
 * Toutes les tuiles du rectangle seront marquées chargées (la requête les couvre).
 */
export function pickRefreshRange(staleTiles: readonly Tile[], center: { lat: number; lon: number }, max = MAX_REFRESH_TILES): TileRange | null {
  const all = tilesToRange(staleTiles)
  if (!all || tileRangeSize(all) <= max) return all
  const z = staleTiles[0]!.z
  const cx = lonToTileX(center.lon, z)
  const cy = latToTileY(center.lat, z)
  const sorted = [...staleTiles].sort((a, b) =>
    Math.max(Math.abs(a.x - cx), Math.abs(a.y - cy)) - Math.max(Math.abs(b.x - cx), Math.abs(b.y - cy))
    || Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
  let range: TileRange | null = null
  for (const t of sorted) {
    const candidate: TileRange = range
      ? { z, minX: Math.min(range.minX, t.x), maxX: Math.max(range.maxX, t.x), minY: Math.min(range.minY, t.y), maxY: Math.max(range.maxY, t.y) }
      : { z, minX: t.x, maxX: t.x, minY: t.y, maxY: t.y }
    if (tileRangeSize(candidate) <= max) range = candidate
  }
  return range
}

/** Requêtes Overpass en cours, par base et par rectangle de tuiles (évite de lancer deux fois la même). */
const inflightByDb = new WeakMap<Database, Map<string, Promise<boolean>>>()

async function refreshRange(db: Database, range: TileRange, deps: PlacesDeps): Promise<boolean> {
  const queryBbox = tileRangeToBbox(range)
  let elements: OverpassElement[]
  try {
    elements = await runOverpassQuery(buildOverpassBboxQuery(queryBbox), deps)
  }
  catch {
    return false
  }
  const now = deps.now?.() ?? new Date()
  const signals = await loadCommunitySignals(db, elements.map(el => osmPlaceId(el.type, el.id)), now)
  const rows = elementsToRows(elements, signals, now)

  const sweep = db.update(places)
    .set({ status: 'removed', updatedAt: now })
    .where(and(
      eq(places.source, 'osm'),
      eq(places.status, 'active'),
      between(places.lat, queryBbox.minLat, queryBbox.maxLat),
      between(places.lon, queryBbox.minLon, queryBbox.maxLon),
      or(isNull(places.fetchedAt), lt(places.fetchedAt, now)),
    ))
  const tiles = tilesInRange(range).map(t => ({ ...t, fetchedAt: now }))
  const tileStatements = chunks(tiles).map(chunk => db.insert(fetchedTiles).values(chunk)
    .onConflictDoUpdate({ target: [fetchedTiles.z, fetchedTiles.x, fetchedTiles.y], set: { fetchedAt: now } }))

  // Une seule transaction : lieux, lieux disparus, tuiles.
  const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [sweep, ...tileStatements]
  statements.unshift(...upsertStatements(db, rows))
  await db.batch(statements)
  return true
}

async function refreshTiles(db: Database, covering: TileRange, center: { lat: number; lon: number }, now: Date, deps: PlacesDeps): Promise<RefreshResult> {
  const fresh = await db.select({ x: fetchedTiles.x, y: fetchedTiles.y, fetchedAt: fetchedTiles.fetchedAt })
    .from(fetchedTiles)
    .where(and(
      eq(fetchedTiles.z, covering.z),
      between(fetchedTiles.x, covering.minX, covering.maxX),
      between(fetchedTiles.y, covering.minY, covering.maxY),
      gte(fetchedTiles.fetchedAt, new Date(now.getTime() - TILE_TTL_MS)),
    ))
  const freshKeys = new Set(fresh.map(t => tileKey({ z: covering.z, x: t.x, y: t.y })))
  const stale = tilesInRange(covering).filter(t => !freshKeys.has(tileKey(t)))
  const range = pickRefreshRange(stale, center)
  if (!range) return { failed: false, remaining: 0 }

  const key = `${range.z}/${range.minX}-${range.maxX}/${range.minY}-${range.maxY}`
  let inflight = inflightByDb.get(db)
  if (!inflight) inflightByDb.set(db, (inflight = new Map()))
  const running = inflight
  let pending = running.get(key)
  if (!pending) {
    pending = refreshRange(db, range, deps).finally(() => running.delete(key))
    running.set(key, pending)
  }
  const ok = await pending
  const remaining = stale.filter(t => t.x < range.minX || t.x > range.maxX || t.y < range.minY || t.y > range.maxY).length
  return { failed: !ok, remaining }
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Lieux `active` de l'emprise, au plus `limit`. */
export async function selectPlacesInBbox(bbox: Bbox, deps: PlacesDeps = {}, limit = MAX_PLACES_PER_RESPONSE): Promise<{ places: Place[]; truncated: boolean }> {
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const rows = await db.select().from(places)
    .where(and(
      eq(places.status, 'active'),
      between(places.lat, bbox.minLat, bbox.maxLat),
      between(places.lon, bbox.minLon, bbox.maxLon),
    ))
    .limit(limit + 1)
  return { places: rows.slice(0, limit).map(r => rowToPlace(r, now)), truncated: rows.length > limit }
}

/**
 * Lieux d'une emprise pour `GET /api/places` :
 * - zoom < 11, ou plus de 64 tuiles z12 couvrant l'emprise → pas d'Overpass, `zoomTooLow: true` ;
 * - sinon, les tuiles z12 absentes ou chargées il y a plus de 7 jours sont rafraîchies
 *   (au plus 16 par appel, les plus proches du centre ; `incomplete: true` s'il en reste) ;
 * - échec d'Overpass sur les deux instances → données en base + `stale: true` (pas d'exception).
 * Une erreur de base de données, elle, est propagée.
 */
export async function getPlacesInBbox(params: { bbox: Bbox; zoom: number }, deps: PlacesDeps = {}): Promise<PlacesResponse> {
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const covering = tileRangeForBbox(params.bbox, CACHE_TILE_ZOOM)
  let stale = false
  let incomplete = false
  const zoomTooLow = params.zoom < MIN_OVERPASS_ZOOM || tileRangeSize(covering) > MAX_COVERING_TILES
  if (!zoomTooLow) {
    const result = await refreshTiles(db, covering, bboxCenter(params.bbox), now, { ...deps, db, now: () => now })
    stale = result.failed
    incomplete = result.remaining > 0
  }
  const { places: list, truncated } = await selectPlacesInBbox(params.bbox, { ...deps, db, now: () => now })
  return { places: list, stale, zoomTooLow, incomplete, truncated }
}

export async function getPlaceRow(id: string, deps: PlacesDeps = {}): Promise<PlaceRow | null> {
  const db = await getDb(deps)
  return (await db.select().from(places).where(eq(places.id, id)).get()) ?? null
}

/** Lieu en base, quel que soit son statut (à la route de décider pour closed / merged…). */
export async function getPlaceById(id: string, deps: PlacesDeps = {}): Promise<Place | null> {
  const row = await getPlaceRow(id, deps)
  return row ? rowToPlace(row, deps.now?.() ?? new Date()) : null
}

/**
 * Garantit qu'un lieu existe en base avant d'y rattacher un favori, un avis ou une alerte.
 * - présent en base → renvoyé ;
 * - id OSM absent → lu sur Overpass (un seul élément), mis en cache s'il est éligible ;
 * - sinon (id `user:` inconnu, élément introuvable ou non éligible) → `null` (404 côté route).
 * @throws OverpassError si Overpass est injoignable (503 côté route).
 */
export async function ensurePlace(id: string, deps: PlacesDeps = {}): Promise<Place | null> {
  const existing = await getPlaceById(id, deps)
  if (existing) return existing
  const parsed = parsePlaceId(id)
  if (!parsed || parsed.source !== 'osm') return null
  const elements = await runOverpassQuery(buildOverpassElementQuery(parsed.osmType, parsed.osmId), deps)
  const rows = await upsertOsmElements(elements.filter(el => osmPlaceId(el.type, el.id) === id), deps)
  return rows.length ? getPlaceById(id, deps) : null
}

/**
 * Recalcule et enregistre `dog_status` / `dog_status_info` d'un lieu à partir de ses
 * tags OSM, de sa terrasse et des signaux communautaires (alertes ; retours en Phase 3).
 * À appeler après chaque nouvelle alerte (et chaque retour / vote en Phase 3).
 * `null` si le lieu n'existe pas.
 */
export async function recomputeDogStatus(placeId: string, deps: PlacesDeps = {}): Promise<DogStatusResult | null> {
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const row = await getPlaceRow(placeId, { ...deps, db })
  if (!row) return null
  const signals = (await loadCommunitySignals(db, [placeId], now)).get(placeId)
  const result = computeDogStatus({ tags: row.tags, hasTerrace: row.hasTerrace, reports: signals?.reports, alerts: signals?.alerts, now })
  await db.update(places)
    .set({ dogStatus: result.status, dogStatusInfo: result.info, updatedAt: now })
    .where(eq(places.id, placeId))
  return result
}

/** Nouvel identifiant de lieu communautaire (P2). */
export function newUserPlaceId(): string {
  return `user:${nanoid()}`
}
