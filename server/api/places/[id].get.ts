import type { Place } from '~~/shared/types'
import { getPlaceById } from '~~/server/services/places'
import { apiError, getPlaceIdParam, requirePlace } from '../../utils/api'

/**
 * `GET /api/places/:id` (id encodé : `osm%3Anode%3A123`) → `Place`.
 * Lieu absent de la base : lu sur Overpass (404 s'il n'existe pas, 503 si Overpass est injoignable).
 */
export default defineEventHandler(async (event): Promise<Place> => {
  const id = getPlaceIdParam(event, 'id')
  const place = await getPlaceById(id)
  if (place) {
    if (place.status === 'hidden') throw apiError(404, 'Lieu introuvable')
    return place
  }
  return await requirePlace(id)
})
