import { PLACE_ID_PATTERN } from '#shared/schemas'

/** Chemin partageable d'une fiche : `/lieu/osm%3Anode%3A123` (id encodé). */
export function placePath(id: string): string {
  return `/lieu/${encodeURIComponent(id)}`
}

/** URL de l'API d'un lieu (`GET /api/places/:id`, id encodé). */
export function placeApiUrl(id: string): string {
  return `/api/places/${encodeURIComponent(id)}`
}

/** Identifiant de lieu bien formé (`osm:node:123`, `user:abc`) : sinon inutile d'appeler l'API. */
export function isValidPlaceId(id: string): boolean {
  return PLACE_ID_PATTERN.test(id)
}
