import { setResponseHeader } from 'h3'
import { geocodeQuerySchema } from '~~/shared/schemas'
import type { GeocodeResponse } from '~~/shared/types'
import { geocodeCacheKey, getCachedGeocode, setCachedGeocode } from '~~/server/services/geocode'
import { apiError, getValidatedQueryOr400 } from '../utils/api'
import { GEOCODER_RETRY_AFTER_S, GEOCODE_UNAVAILABLE_MESSAGE, GeocodeServiceError } from '../utils/geocoding/core'
import { configuredGeocoder, geocoderName, searchGeocoder } from '../utils/geocoder'

/**
 * `GET /api/geocode?q=…` → `GeocodeResponse` (`{ results }`, liste vide si rien).
 * `q` : 2 à 100 caractères après trim (400 sinon). Cache en base (30 jours, 24 h
 * pour « aucun résultat »), sinon le fournisseur choisi par `GEOCODER` (Photon par
 * défaut, ou Nominatim : server/utils/geocoder.ts), limité à la France, aux DROM
 * et aux COM. Fournisseur en panne, trop lent ou file d'attente pleine → 503
 * (`Retry-After`).
 *
 * Une seule chaîne pour tout : `key = normalizeGeocodeQuery(q)` (via
 * `geocodeCacheKey`) est la clé du cache, la clé de dédoublonnage des requêtes en
 * cours et la requête envoyée au fournisseur.
 *
 * Phase 3 : ajouter la limitation de débit par client stockée en base (§4.5).
 */
export default defineEventHandler(async (event): Promise<GeocodeResponse> => {
  const { q } = getValidatedQueryOr400(event, geocodeQuerySchema)

  // Ni lettre ni chiffre (« !! ») : rien à chercher, et rien à mettre en cache.
  const key = geocodeCacheKey(q)
  if (!key) return { results: [] }

  const cached = await getCachedGeocode(key)
  if (cached) {
    setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
    return { results: cached }
  }

  const geocoder = configuredGeocoder()
  let results
  try {
    results = await searchGeocoder(key, { geocoder })
  }
  catch (error) {
    if (error instanceof GeocodeServiceError) {
      if (error.reason !== 'queue') console.warn(`[geocode] ${geocoderName(geocoder)} indisponible (${error.reason})`)
      setResponseHeader(event, 'Retry-After', GEOCODER_RETRY_AFTER_S)
      throw apiError(503, GEOCODE_UNAVAILABLE_MESSAGE)
    }
    throw error
  }

  try {
    await setCachedGeocode(key, results)
  }
  catch {
    // Cache indisponible : on renvoie quand même les résultats.
    console.warn('[geocode] écriture du cache impossible')
  }
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return { results }
})
