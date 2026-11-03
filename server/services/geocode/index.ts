/**
 * Cache en base des réponses de géocodage (table `geocode_cache`), pour le proxy
 * `GET /api/geocode?q=` (Nominatim / Photon, écrit par `back`). Ce module ne fait
 * aucun appel réseau : il lit et écrit le cache.
 *
 * Clé : la requête normalisée (`normalizeName`) : « Paris », « paris » et « PARIS »
 * partagent la même entrée. Une liste vide (aucun résultat) est mise en cache
 * comme une autre : on ne redemande pas au fournisseur une recherche sans réponse.
 *
 * Dépendances injectables (`db`, `now`) pour les tests.
 */
import { eq, lte } from 'drizzle-orm'
import { z } from 'zod'
import { geocodeResultSchema } from '../../../shared/schemas'
import { normalizeName } from '../../../shared/text'
import type { GeocodeResult } from '../../../shared/types'
import type { Database } from '../../database'
import { geocodeCache } from '../../database/schema'

/** Durée de validité d'une entrée : 30 jours (les adresses changent peu). */
export const GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Résultats gardés au plus par entrée (le reste est ignoré à l'écriture). */
export const GEOCODE_CACHE_MAX_RESULTS = 10
/** Longueur maximale de la clé (la requête validée fait au plus 100 caractères). */
const MAX_KEY_LENGTH = 200

export interface GeocodeCacheDeps {
  db?: Database
  now?: () => Date
  /** Remplace `GEOCODE_CACHE_TTL_MS`. */
  ttlMs?: number
}

async function getDb(deps: GeocodeCacheDeps): Promise<Database> {
  return deps.db ?? (await import('../../database')).db
}

/**
 * Clé de cache d'une requête : `normalizeName(query)` (minuscules, sans accents ni
 * ponctuation, espaces réduits), tronquée à 200 caractères. Chaîne vide si la
 * requête ne contient ni lettre ni chiffre : rien n'est alors lu ni écrit.
 */
export function geocodeCacheKey(query: string): string {
  return normalizeName(query).slice(0, MAX_KEY_LENGTH).trim()
}

const cachedResultsSchema = z.array(geocodeResultSchema)

/**
 * Résultats en cache pour la requête, ou `null` si absents, expirés (plus de
 * 30 jours) ou illisibles. `[]` = « aucun résultat » mis en cache.
 */
export async function getCachedGeocode(query: string, deps: GeocodeCacheDeps = {}): Promise<GeocodeResult[] | null> {
  const key = geocodeCacheKey(query)
  if (!key) return null
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const ttl = deps.ttlMs ?? GEOCODE_CACHE_TTL_MS
  const row = await db.select().from(geocodeCache).where(eq(geocodeCache.query, key)).get()
  if (!row || row.createdAt.getTime() <= now.getTime() - ttl) return null
  const parsed = cachedResultsSchema.safeParse(row.results)
  return parsed.success ? parsed.data as GeocodeResult[] : null
}

/**
 * Enregistre (ou remplace) les résultats d'une requête, au plus
 * `GEOCODE_CACHE_MAX_RESULTS`, et purge au passage les entrées expirées.
 * Sans effet si la clé est vide. Les résultats invalides sont refusés.
 * @throws ZodError si `results` ne respecte pas `geocodeResultSchema`.
 */
export async function setCachedGeocode(query: string, results: readonly GeocodeResult[], deps: GeocodeCacheDeps = {}): Promise<void> {
  const key = geocodeCacheKey(query)
  if (!key) return
  const value = cachedResultsSchema.parse(results.slice(0, GEOCODE_CACHE_MAX_RESULTS)) as GeocodeResult[]
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const ttl = deps.ttlMs ?? GEOCODE_CACHE_TTL_MS
  await db.batch([
    db.delete(geocodeCache).where(lte(geocodeCache.createdAt, new Date(now.getTime() - ttl))),
    db.insert(geocodeCache).values({ query: key, results: value, createdAt: now })
      .onConflictDoUpdate({ target: geocodeCache.query, set: { results: value, createdAt: now } }),
  ])
}

/** Supprime les entrées expirées (30 jours ou plus). Renvoie le nombre de lignes supprimées. */
export async function purgeGeocodeCache(deps: GeocodeCacheDeps = {}): Promise<number> {
  const db = await getDb(deps)
  const now = deps.now?.() ?? new Date()
  const ttl = deps.ttlMs ?? GEOCODE_CACHE_TTL_MS
  const result = await db.delete(geocodeCache).where(lte(geocodeCache.createdAt, new Date(now.getTime() - ttl)))
  return result.rowsAffected
}
