import { setResponseHeader } from 'h3'
import { geocodeQuerySchema } from '~~/shared/schemas'
import type { GeocodeResponse } from '~~/shared/types'
import { geocodeCacheKey, getCachedGeocode, setCachedGeocode } from '~~/server/services/geocode'
import { apiError, getValidatedQueryOr400 } from '../utils/api'
import { GEOCODE_UNAVAILABLE_MESSAGE, GeocodeServiceError, NOMINATIM_MIN_INTERVAL_MS, searchNominatim } from '../utils/nominatim'

/**
 * `GET /api/geocode?q=…` → `GeocodeResponse` (`{ results }`, liste vide si rien).
 * `q` : 2 à 100 caractères après trim (400 sinon). Cache en base de 30 jours
 * (« aucun résultat » compris), sinon Nominatim, limité à la France, aux DROM et
 * aux COM (voir server/utils/nominatim.ts). Nominatim en panne, trop lent ou file
 * d'attente pleine → 503 (`Retry-After`).
 *
 * Phase 3 : ajouter la limitation de débit par client stockée en base (§4.5).
 */
export default defineEventHandler(async (event): Promise<GeocodeResponse> => {
  const { q } = getValidatedQueryOr400(event, geocodeQuerySchema)

  // Ni lettre ni chiffre (« !! ») : rien à chercher, et rien à mettre en cache.
  if (!geocodeCacheKey(q)) return { results: [] }

  const cached = await getCachedGeocode(q)
  if (cached) {
    setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
    return { results: cached }
  }

  let results
  try {
    results = await searchNominatim(q)
  }
  catch (error) {
    if (error instanceof GeocodeServiceError) {
      if (error.reason !== 'queue') console.warn(`[geocode] Nominatim indisponible (${error.reason})`)
      setResponseHeader(event, 'Retry-After', Math.ceil((NOMINATIM_MIN_INTERVAL_MS * 2) / 1000))
      throw apiError(503, GEOCODE_UNAVAILABLE_MESSAGE)
    }
    throw error
  }

  try {
    await setCachedGeocode(q, results)
  }
  catch {
    // Cache indisponible : on renvoie quand même les résultats.
    console.warn('[geocode] écriture du cache impossible')
  }
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return { results }
})
