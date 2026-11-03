/**
 * Service des lieux : cache en base des lieux OSM, rafraîchi par tuiles de zoom 12
 * et accès aux lieux pour les routes.
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
  bboxCenter, bboxTouchesCoverage, CACHE_TILE_ZOOM, isInCoverage, latToTileY, lonToTileX, tileKey, tileRangeForBbox,
  tileRangeSize, tileRangeToBbox, tilesInRange, tilesToRange,
} from '../../../shared/geo'
import type { Bbox, Tile, TileRange } from '../../../shared/geo'
import { osmPlaceId, parsePlaceId } from '../../../shared/schemas'
import type { Place, PlacesResponse } from '../../../shared/types'
import type { Database } from '../../database'
import { alerts, fetchedTiles, osmLookupMisses, places } from '../../database/schema'
import type { NewPlaceRow, PlaceRow } from '../../database/schema'
import { elementToPlaceRow, rowToPlace } from './mapping'
import type { CommunitySignals } from './mapping'
import { buildOverpassBboxQuery, buildOverpassElementQuery, OverpassError, runOverpassQuery } from './overpass'
import type { OverpassDeps, OverpassElement } from './overpass'

export {
  OverpassCircuit, OverpassError, OVERPASS_CIRCUIT_PAUSE_MS, OVERPASS_DEADLINE_MS, OVERPASS_ENDPOINTS, OVERPASS_MIN_ATTEMPT_MS,
  OVERPASS_SERVER_TIMEOUT_S, OVERPASS_TIMEOUT_MS, buildOverpassBboxQuery, configuredOverpassEndpoints, defaultOverpassCircuit,
  parseOverpassEndpoints, parseRetryAfter, resetOverpassCircuit, runOverpassQuery, withServerTimeout,
} from './overpass'
export type { OverpassElement, OverpassDeps } from './overpass'
export { elementToPlaceRow, rowToPlace, buildAddress } from './mapping'

/** En dessous de ce zoom, Overpass n'est jamais interrogé. */
export const MIN_OVERPASS_ZOOM = 11
/** Une tuile chargée il y a plus de 7 jours est rafraîchie. */
export const TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/**
 * Tuiles rafraîchies au plus par requête (rectangle de tuiles, une seule requête Overpass).
 * Seules les tuiles qui touchent la vue sont candidates, les plus proches du centre
 * d'abord. Mesuré à Paris : une vue au zoom 15 touche 2 tuiles z12 (mobile, ou
 * l'emprise 2.33,48.84,2.37,48.87) à 4 (bureau 1440 × 900) ; zoom 14 : 4 ; zoom 13 :
 * 8 ; zoom 12 : ~20 à 28. 8 tuiles (~26 × 13 km) : une vue au zoom 13 tient en une
 * requête, une vue au zoom 12 en 3 (le client relance 3 fois sur `incomplete`), et
 * la requête reste deux fois plus légère qu'avec 16 pour une instance chargée.
 */
export const MAX_REFRESH_TILES = 8
/** Au-delà de ce nombre de tuiles couvrant l'emprise, on la traite comme « zoom trop bas ». */
export const MAX_COVERING_TILES = 64
/** Nombre maximal de lieux renvoyés par `getPlacesInBbox`. */
export const MAX_PLACES_PER_RESPONSE = 2000
/**
 * Délai total du rafraîchissement quand toutes les tuiles à rafraîchir ont déjà été
 * chargées une fois (des lieux, même anciens, sont en base) : mieux vaut afficher
 * vite le cache en `stale` que faire attendre. Le temps restant passe d'instance
 * en instance ; une instance qui expire est ensuite sautée pendant 2 minutes.
 */
export const REFRESH_DEADLINE_CACHED_MS = 10_000
/**
 * Délai total quand au moins une tuile n'a jamais été chargée : sans Overpass la
 * carte resterait vide à cet endroit (l'utilisateur voit « Chargement… »), on attend
 * donc plus longtemps. 40 s = 20 s au plus par instance : même si une instance ne
 * répond jamais, la suivante garde ~20 s (une instance chargée met ~17 s).
 * L'hébergeur doit autoriser une durée d'exécution d'au moins 45 s pour `/api/places`.
 */
export const REFRESH_DEADLINE_EMPTY_MS = 40_000
/**
 * Délai total de la lecture d'un seul élément (`ensurePlace`, lieu absent de la base :
 * rare, la carte l'a normalement déjà mis en cache). 20 s : quand l'instance principale
 * est saturée, la suivante met ~17 s même pour une petite requête.
 */
export const ELEMENT_DEADLINE_MS = 20_000
/** Un id OSM trouvé introuvable / non éligible / hors couverture n'est pas redemandé à Overpass pendant 24 h. */
export const OSM_MISS_TTL_MS = 24 * 60 * 60 * 1000

export interface PlacesDeps extends OverpassDeps {
  db?: Database
  now?: () => Date
  /** Remplace `REFRESH_DEADLINE_CACHED_MS`. */
  refreshDeadlineCachedMs?: number
  /** Remplace `REFRESH_DEADLINE_EMPTY_MS`. */
  refreshDeadlineEmptyMs?: number
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

/**
 * Lit le rectangle de tuiles sur Overpass puis, en une transaction : lieux mis à jour,
 * lieux OSM absents de la réponse marqués `removed`, tuiles marquées chargées.
 * Renvoie le nombre de lieux écrits.
 * @throws OverpassError si Overpass échoue (rien n'est écrit) ; les erreurs de base sont propagées.
 */
async function fetchAndStoreRange(db: Database, range: TileRange, deps: PlacesDeps, serverTimeoutS?: number): Promise<number> {
  const queryBbox = tileRangeToBbox(range)
  let elements: OverpassElement[]
  try {
    elements = await runOverpassQuery(buildOverpassBboxQuery(queryBbox, undefined, serverTimeoutS), deps)
  }
  catch (error) {
    // Toute erreur côté Overpass (même inattendue) est un échec d'Overpass, pas de la base.
    if (error instanceof OverpassError) throw error
    throw new OverpassError([error instanceof Error ? error.message : String(error)])
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
  return rows.length
}

async function refreshRange(db: Database, range: TileRange, deps: PlacesDeps): Promise<boolean> {
  try {
    await fetchAndStoreRange(db, range, deps)
    return true
  }
  catch (error) {
    if (error instanceof OverpassError) return false
    throw error
  }
}

async function refreshTiles(db: Database, covering: TileRange, center: { lat: number; lon: number }, now: Date, deps: PlacesDeps): Promise<RefreshResult> {
  const known = await db.select({ x: fetchedTiles.x, y: fetchedTiles.y, fetchedAt: fetchedTiles.fetchedAt })
    .from(fetchedTiles)
    .where(and(
      eq(fetchedTiles.z, covering.z),
      between(fetchedTiles.x, covering.minX, covering.maxX),
      between(fetchedTiles.y, covering.minY, covering.maxY),
    ))
  const freshSince = now.getTime() - TILE_TTL_MS
  const knownKeys = new Set(known.map(t => tileKey({ z: covering.z, x: t.x, y: t.y })))
  const freshKeys = new Set(known.filter(t => t.fetchedAt.getTime() >= freshSince).map(t => tileKey({ z: covering.z, x: t.x, y: t.y })))
  const stale = tilesInRange(covering).filter(t => !freshKeys.has(tileKey(t)))
  const range = pickRefreshRange(stale, center)
  if (!range) return { failed: false, remaining: 0 }
  const cached = tilesInRange(range).every(t => knownKeys.has(tileKey(t)))
  const deadlineMs = cached
    ? deps.refreshDeadlineCachedMs ?? REFRESH_DEADLINE_CACHED_MS
    : deps.refreshDeadlineEmptyMs ?? REFRESH_DEADLINE_EMPTY_MS

  const key = `${range.z}/${range.minX}-${range.maxX}/${range.minY}-${range.maxY}`
  let inflight = inflightByDb.get(db)
  if (!inflight) inflightByDb.set(db, (inflight = new Map()))
  const running = inflight
  let pending = running.get(key)
  if (!pending) {
    pending = refreshRange(db, range, { ...deps, overpassDeadlineMs: deadlineMs }).finally(() => running.delete(key))
    running.set(key, pending)
  }
  const ok = await pending
  const remaining = stale.filter(t => t.x < range.minX || t.x > range.maxX || t.y < range.minY || t.y > range.maxY).length
  return { failed: !ok, remaining }
}

// ---------------------------------------------------------------------------
// Pré-remplissage (`npm run places:prefetch`, scripts/places-prefetch.ts)
// ---------------------------------------------------------------------------

/** Tuiles d'un rectangle, réparties entre fraîches (chargées il y a moins de 7 jours) et à charger. */
export interface TileRefreshPlan {
  range: TileRange
  fresh: Tile[]
  stale: Tile[]
}

/**
 * État du cache pour un rectangle de tuiles (lecture seule, aucun appel Overpass).
 * `force` : toutes les tuiles sont à charger, même fraîches.
 */
export async function planTileRefresh(range: TileRange, deps: PlacesDeps = {}, options: { force?: boolean } = {}): Promise<TileRefreshPlan> {
  const all = tilesInRange(range)
  if (options.force) return { range, fresh: [], stale: all }
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const freshSince = new Date(now.getTime() - TILE_TTL_MS)
  const known = await db.select({ x: fetchedTiles.x, y: fetchedTiles.y })
    .from(fetchedTiles)
    .where(and(
      eq(fetchedTiles.z, range.z),
      between(fetchedTiles.x, range.minX, range.maxX),
      between(fetchedTiles.y, range.minY, range.maxY),
      gte(fetchedTiles.fetchedAt, freshSince),
    ))
  const freshKeys = new Set(known.map(t => tileKey({ z: range.z, x: t.x, y: t.y })))
  return { range, fresh: all.filter(t => freshKeys.has(tileKey(t))), stale: all.filter(t => !freshKeys.has(tileKey(t))) }
}

/**
 * Découpe des tuiles à charger en rectangles disjoints d'au plus `max` tuiles (une
 * requête Overpass chacun), du centre vers l'extérieur. Chaque tuile de `tiles` est
 * dans exactement un rectangle, et un rectangle ne contient que des tuiles de
 * `tiles` (aucune tuile fraîche rechargée). Fonction pure.
 */
export function splitIntoRefreshRanges(tiles: readonly Tile[], center: { lat: number; lon: number }, max = MAX_REFRESH_TILES): TileRange[] {
  if (!tiles.length) return []
  const z = tiles[0]!.z
  const limit = Math.max(1, Math.floor(max))
  const cx = lonToTileX(center.lon, z)
  const cy = latToTileY(center.lat, z)
  const byDistance = (a: Tile, b: Tile) =>
    Math.max(Math.abs(a.x - cx), Math.abs(a.y - cy)) - Math.max(Math.abs(b.x - cx), Math.abs(b.y - cy))
    || Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)
    || a.x - b.x || a.y - b.y
  const left = new Map(tiles.map(t => [tileKey(t), t]))
  const ranges: TileRange[] = []
  while (left.size) {
    const sorted = [...left.values()].sort(byDistance)
    const first = sorted[0]!
    let range: TileRange = { z, minX: first.x, maxX: first.x, minY: first.y, maxY: first.y }
    for (const t of sorted.slice(1)) {
      const candidate: TileRange = { z, minX: Math.min(range.minX, t.x), maxX: Math.max(range.maxX, t.x), minY: Math.min(range.minY, t.y), maxY: Math.max(range.maxY, t.y) }
      if (tileRangeSize(candidate) <= limit && tilesInRange(candidate).every(c => left.has(tileKey(c)))) range = candidate
    }
    for (const t of tilesInRange(range)) left.delete(tileKey(t))
    ranges.push(range)
  }
  return ranges
}

/**
 * Charge un rectangle de tuiles depuis Overpass et l'enregistre (même écriture que
 * `getPlacesInBbox` : lieux, lieux disparus, tuiles), sans vérifier la fraîcheur.
 * Pour le pré-remplissage : délais fournis par l'appelant (`overpassTimeoutMs`,
 * `overpassDeadlineMs`), `serverTimeoutS` pour le `[timeout:N]` annoncé.
 * Renvoie le nombre de lieux lus.
 * @throws OverpassError si toutes les instances échouent ou sont en pause.
 */
export async function refreshTileRange(range: TileRange, deps: PlacesDeps = {}, options: { serverTimeoutS?: number } = {}): Promise<{ places: number }> {
  const db = await getDb(deps)
  return { places: await fetchAndStoreRange(db, range, { ...deps, db }, options.serverTimeoutS) }
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
 * - emprise qui ne touche aucun territoire couvert (`COVERAGE_AREAS` de shared/geo.ts :
 *   France métropolitaine, Corse, DROM, COM) → pas d'Overpass, cache seulement,
 *   `outsideCoverage: true` (champ absent sinon) ;
 * - sinon, les tuiles z12 de la vue absentes ou chargées il y a plus de 7 jours sont
 *   rafraîchies (au plus `MAX_REFRESH_TILES` par appel, les plus proches du centre ;
 *   `incomplete: true` s'il en reste) ;
 * - échec d'Overpass sur toutes les instances → données en base + `stale: true` (pas d'exception) ;
 *   délai total borné à 10 s si les tuiles ont déjà été chargées une fois, 40 s sinon ;
 *   juste après un échec, le disjoncteur répond `stale` sans attendre (voir `overpass.ts`).
 * Une erreur de base de données, elle, est propagée.
 */
export async function getPlacesInBbox(params: { bbox: Bbox; zoom: number }, deps: PlacesDeps = {}): Promise<PlacesResponse> {
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const covering = tileRangeForBbox(params.bbox, CACHE_TILE_ZOOM)
  let stale = false
  let incomplete = false
  const zoomTooLow = params.zoom < MIN_OVERPASS_ZOOM || tileRangeSize(covering) > MAX_COVERING_TILES
  const outsideCoverage = !bboxTouchesCoverage(params.bbox)
  if (!zoomTooLow && !outsideCoverage) {
    const result = await refreshTiles(db, covering, bboxCenter(params.bbox), now, { ...deps, db, now: () => now })
    stale = result.failed
    incomplete = result.remaining > 0
  }
  const { places: list, truncated } = await selectPlacesInBbox(params.bbox, { ...deps, db, now: () => now })
  return { places: list, stale, zoomTooLow, incomplete, truncated, ...(outsideCoverage ? { outsideCoverage: true } : {}) }
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

export interface EnsurePlaceOptions {
  /**
   * `false` : ne jamais interroger Overpass (ex. visiteur non connecté) ; un id OSM
   * absent de la base donne alors `null`. Par défaut `true`.
   */
  allowOverpass?: boolean
}

/** L'id OSM a-t-il été trouvé introuvable il y a moins de `OSM_MISS_TTL_MS` ? */
export async function isRecentOsmMiss(id: string, deps: PlacesDeps = {}): Promise<boolean> {
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const row = await db.select({ checkedAt: osmLookupMisses.checkedAt }).from(osmLookupMisses)
    .where(eq(osmLookupMisses.id, id)).get()
  return Boolean(row && row.checkedAt.getTime() > now.getTime() - OSM_MISS_TTL_MS)
}

/** Mémorise un id OSM introuvable (et purge les entrées de plus de 24 h). */
export async function recordOsmMiss(id: string, deps: PlacesDeps = {}): Promise<void> {
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  await db.batch([
    db.delete(osmLookupMisses).where(lt(osmLookupMisses.checkedAt, new Date(now.getTime() - OSM_MISS_TTL_MS))),
    db.insert(osmLookupMisses).values({ id, checkedAt: now })
      .onConflictDoUpdate({ target: osmLookupMisses.id, set: { checkedAt: now } }),
  ])
}

/**
 * Garantit qu'un lieu existe en base avant d'y rattacher un favori, un avis ou une alerte.
 * - présent en base → renvoyé ;
 * - id OSM absent → lu sur Overpass (un seul élément), mis en cache s'il est éligible
 *   et dans un territoire couvert (`isInCoverage`) ;
 * - sinon (id `user:` inconnu, élément introuvable, non éligible ou hors couverture) →
 *   `null` (404 côté route). Un id OSM introuvable est mémorisé 24 h
 *   (`osm_lookup_misses`) : pendant ce délai, `null` sans rappeler Overpass ;
 * - `options.allowOverpass === false` → jamais d'appel Overpass (`null` si absent).
 * @throws OverpassError si Overpass est injoignable ou en pause après un échec récent
 *   (immédiat dans ce cas ; 503 côté route). Délai total : `ELEMENT_DEADLINE_MS`.
 *   Un échec n'est pas mémorisé comme « introuvable ».
 */
export async function ensurePlace(id: string, deps: PlacesDeps = {}, options: EnsurePlaceOptions = {}): Promise<Place | null> {
  const db = await getDb(deps)
  const local = { ...deps, db }
  const existing = await getPlaceById(id, local)
  if (existing) return existing
  const parsed = parsePlaceId(id)
  if (!parsed || parsed.source !== 'osm') return null
  if (options.allowOverpass === false) return null
  if (await isRecentOsmMiss(id, local)) return null
  const elements = await runOverpassQuery(buildOverpassElementQuery(parsed.osmType, parsed.osmId), {
    ...deps,
    overpassDeadlineMs: deps.overpassDeadlineMs ?? ELEMENT_DEADLINE_MS,
  })
  const found = elements.filter(el => osmPlaceId(el.type, el.id) === id)
    .filter((el) => {
      const lat = el.lat ?? el.center?.lat
      const lon = el.lon ?? el.center?.lon
      return typeof lat === 'number' && typeof lon === 'number' && isInCoverage(lat, lon)
    })
  const rows = await upsertOsmElements(found, local)
  if (rows.length) return getPlaceById(id, local)
  await recordOsmMiss(id, local)
  return null
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
