/**
 * Cache en base des réponses de géocodage (table `geocode_cache`), pour le proxy
 * `GET /api/geocode?q=` (Nominatim / Photon, écrit par `back`). Ce module ne fait
 * aucun appel réseau : il lit et écrit le cache.
 *
 * Clé : `normalizeGeocodeQuery(query)`, c'est-à-dire exactement la chaîne envoyée
 * au fournisseur : « Paris », « paris » et «  PARIS  » partagent la même entrée,
 * mais « Lyon 東京 » n'est jamais servi sous « lyon ».
 *
 * Durées : 30 jours pour une réponse non vide, 24 h pour `[]` (« aucun résultat »).
 * Le nombre de lignes est plafonné (`GEOCODE_CACHE_MAX_ROWS`) : une écriture sur
 * `GEOCODE_CACHE_PRUNE_EVERY` vérifie le total et supprime les plus anciennes.
 *
 * Dépendances injectables (`db`, `now`, durées, plafond) pour les tests.
 */
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { geocodeResultSchema } from '../../../shared/schemas'
import { normalizeGeocodeQuery } from '../../../shared/text'
import type { GeocodeResult } from '../../../shared/types'
import type { Database } from '../../database'
import { geocodeCache } from '../../database/schema'

export { normalizeGeocodeQuery }

/** Durée de validité d'une réponse non vide : 30 jours (les adresses changent peu). */
export const GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Durée de validité d'une réponse vide (`[]`) : 24 h. */
export const GEOCODE_EMPTY_CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** Nombre maximal de lignes dans `geocode_cache`. */
export const GEOCODE_CACHE_MAX_ROWS = 50_000
/** Le plafond de lignes est vérifié une écriture sur N (la première comprise). */
export const GEOCODE_CACHE_PRUNE_EVERY = 100
/** Résultats gardés au plus par entrée (le reste est ignoré à l'écriture). */
export const GEOCODE_CACHE_MAX_RESULTS = 10
/** Longueur maximale de la clé (la requête validée fait au plus 100 caractères). */
const MAX_KEY_LENGTH = 200

export interface GeocodeCacheDeps {
  db?: Database
  now?: () => Date
  /** Remplace `GEOCODE_CACHE_TTL_MS`. */
  ttlMs?: number
  /** Remplace `GEOCODE_EMPTY_CACHE_TTL_MS`. */
  emptyTtlMs?: number
  /** Remplace `GEOCODE_CACHE_MAX_ROWS`. */
  maxRows?: number
  /** Remplace `GEOCODE_CACHE_PRUNE_EVERY` (1 = vérification à chaque écriture). */
  pruneEvery?: number
}

/** Écritures depuis le démarrage du processus (cadence de la vérification du plafond). */
let writeCount = 0

async function getDb(deps: GeocodeCacheDeps): Promise<Database> {
  return deps.db ?? (await import('../../database')).db
}

/**
 * Clé de cache d'une requête : `normalizeGeocodeQuery(query)`, identique à la
 * chaîne envoyée au fournisseur. Chaîne vide (rien n'est alors lu ni écrit) si la
 * requête ne contient ni lettre ni chiffre, ou si sa forme normalisée dépasse
 * 200 caractères : tronquer ferait partager une entrée à deux requêtes différentes.
 */
export function geocodeCacheKey(query: string): string {
  const key = normalizeGeocodeQuery(query)
  if (key.length > MAX_KEY_LENGTH || !/[\p{L}\p{N}]/u.test(key)) return ''
  return key
}

/** Condition « entrée expirée » : non vide depuis `ttl`, ou `[]` depuis `emptyTtl`. */
function expiredCondition(deps: GeocodeCacheDeps, now: Date) {
  const ttl = deps.ttlMs ?? GEOCODE_CACHE_TTL_MS
  const emptyTtl = deps.emptyTtlMs ?? GEOCODE_EMPTY_CACHE_TTL_MS
  return or(
    lte(geocodeCache.createdAt, new Date(now.getTime() - ttl)),
    and(
      eq(sql`${geocodeCache.results}`, '[]'),
      lte(geocodeCache.createdAt, new Date(now.getTime() - emptyTtl)),
    ),
  )
}

const cachedResultsSchema = z.array(geocodeResultSchema)

/**
 * Résultats en cache pour la requête, ou `null` si absents, expirés (30 jours,
 * ou 24 h pour `[]`) ou illisibles. `[]` = « aucun résultat » mis en cache.
 */
export async function getCachedGeocode(query: string, deps: GeocodeCacheDeps = {}): Promise<GeocodeResult[] | null> {
  const key = geocodeCacheKey(query)
  if (!key) return null
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  // `results` relu en texte brut (sans le `JSON.parse` de la colonne en mode `json`,
  // qui lèverait sur une valeur corrompue) puis décodé ici, de façon protégée.
  const row = await db.select({ results: sql<unknown>`${geocodeCache.results}`, createdAt: geocodeCache.createdAt })
    .from(geocodeCache).where(eq(geocodeCache.query, key)).get()
  if (!row) return null
  const parsed = cachedResultsSchema.safeParse(parseJsonText(row.results))
  if (!parsed.success) return null
  const ttl = parsed.data.length === 0
    ? deps.emptyTtlMs ?? GEOCODE_EMPTY_CACHE_TTL_MS
    : deps.ttlMs ?? GEOCODE_CACHE_TTL_MS
  if (row.createdAt.getTime() <= now.getTime() - ttl) return null
  return parsed.data as GeocodeResult[]
}

/** `JSON.parse` d'une valeur lue en base ; `undefined` si ce n'est pas une chaîne JSON valide. */
function parseJsonText(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value)
  }
  catch {
    return undefined
  }
}

/**
 * Enregistre (ou remplace) les résultats d'une requête, au plus
 * `GEOCODE_CACHE_MAX_RESULTS`, et purge au passage les entrées expirées. Une
 * écriture sur `GEOCODE_CACHE_PRUNE_EVERY` applique aussi le plafond de lignes.
 * Sans effet si la clé est vide. Les résultats invalides sont refusés.
 * @throws ZodError si `results` ne respecte pas `geocodeResultSchema`.
 */
export async function setCachedGeocode(query: string, results: readonly GeocodeResult[], deps: GeocodeCacheDeps = {}): Promise<void> {
  const key = geocodeCacheKey(query)
  if (!key) return
  const value = cachedResultsSchema.parse(results.slice(0, GEOCODE_CACHE_MAX_RESULTS)) as GeocodeResult[]
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  await db.batch([
    db.delete(geocodeCache).where(expiredCondition(deps, now)),
    db.insert(geocodeCache).values({ query: key, results: value, createdAt: now })
      .onConflictDoUpdate({ target: geocodeCache.query, set: { results: value, createdAt: now } }),
  ])
  const every = Math.max(1, deps.pruneEvery ?? GEOCODE_CACHE_PRUNE_EVERY)
  if (writeCount++ % every === 0) await enforceGeocodeCacheMaxRows(deps)
}

/**
 * Supprime les entrées expirées (30 jours, ou 24 h pour `[]`). Renvoie le nombre
 * de lignes supprimées.
 */
export async function purgeGeocodeCache(deps: GeocodeCacheDeps = {}): Promise<number> {
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const result = await db.delete(geocodeCache).where(expiredCondition(deps, now))
  return result.rowsAffected
}

/**
 * Ramène `geocode_cache` à `GEOCODE_CACHE_MAX_ROWS` lignes au plus en supprimant
 * les plus anciennes (`created_at`, index dédié). Renvoie le nombre de lignes
 * supprimées. Appelée automatiquement une écriture sur `GEOCODE_CACHE_PRUNE_EVERY`.
 */
export async function enforceGeocodeCacheMaxRows(deps: GeocodeCacheDeps = {}): Promise<number> {
  const db = await getDb(deps)
  const max = Math.max(0, deps.maxRows ?? GEOCODE_CACHE_MAX_ROWS)
  const row = await db.select({ n: sql<number>`count(*)` }).from(geocodeCache).get()
  const excess = Number(row?.n ?? 0) - max
  if (excess <= 0) return 0
  const oldest = db.select({ query: geocodeCache.query }).from(geocodeCache)
    .orderBy(asc(geocodeCache.createdAt), asc(geocodeCache.query)).limit(excess)
  const result = await db.delete(geocodeCache).where(inArray(geocodeCache.query, oldest))
  return result.rowsAffected
}
