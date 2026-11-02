import { placesQuerySchema } from '~~/shared/schemas'
import type { PlacesResponse } from '~~/shared/types'
import { getPlacesInBbox } from '~~/server/services/places'
import { getValidatedQueryOr400 } from '../utils/api'

/**
 * `GET /api/places?bbox=minLon,minLat,maxLon,maxLat&zoom=Z` → `PlacesResponse`.
 * Overpass injoignable : données en base avec `stale: true` (pas d'erreur).
 */
export default defineEventHandler(async (event): Promise<PlacesResponse> => {
  const query = getValidatedQueryOr400(event, placesQuerySchema)
  return await getPlacesInBbox(query)
})
