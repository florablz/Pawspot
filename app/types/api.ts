import type { AlertType } from '#shared/schemas'

// Formes des réponses JSON des routes `server/api/**` (dates sérialisées en chaîne ISO)
// qui n'ont pas encore de type dans `shared/`.

export interface PlaceAlert {
  id: number
  placeId: string
  type: AlertType
  description: string | null
  username: string
  createdAt: string
}

export interface PlaceReview {
  id: number
  placeId: string
  rating: number
  comment: string | null
  photos: string[]
  userId?: number
  username: string
  avatarUrl?: string | null
  createdAt: string
}

/** Réponse de `POST /api/favorites` et `DELETE /api/favorites/:placeId`. */
export interface FavoriteToggleResponse {
  placeId: string
  favorited: boolean
}
