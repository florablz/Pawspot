import type { Place } from '~~/shared/types'
import { getPlaceById } from '~~/server/services/places'
import { apiError, getPlaceIdParam, requirePlace } from '../../utils/api'
import { getUserFromSession } from '../../utils/auth'

/**
 * `GET /api/places/:id` (id encodé : `osm%3Anode%3A123`) → `Place`.
 * Lieu absent de la base : lu sur Overpass pour un utilisateur connecté seulement
 * (404 s'il n'existe pas, 503 si Overpass est injoignable) ; en anonyme → 404.
 */
export default defineEventHandler(async (event): Promise<Place> => {
  const id = getPlaceIdParam(event, 'id')
  const place = await getPlaceById(id)
  if (place) {
    if (place.status === 'hidden') throw apiError(404, 'Lieu introuvable')
    return place
  }
  const user = await getUserFromSession(event)
  return await requirePlace(id, { allowOverpass: Boolean(user) })
})
