import type { Place } from '#shared/types'

// Formes des réponses JSON des routes `server/api/**` (dates sérialisées en chaîne ISO)
// qui n'ont pas encore de type dans `shared/`.

/** Types d'alerte acceptés par `POST /api/alerts` ; `change` est l'ancien type, encore lisible. */
export type AlertType = 'closed' | 'temporarily_closed' | 'dogs_not_allowed' | 'info_change' | 'change'

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

/** Élément de `GET /api/favorites` : le lieu complet et la date d'ajout. */
export type FavoritePlace = Place & { favoritedAt: string }

/** Réponse de `POST /api/favorites` et `DELETE /api/favorites/:placeId`. */
export interface FavoriteToggleResponse {
  placeId: string
  favorited: boolean
}
