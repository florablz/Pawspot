import type { CategoryKey } from './places'

// Formes des réponses JSON des routes `server/api/**` (dates sérialisées en chaîne ISO).
// Provisoire : à remplacer par les types de `shared/` quand ils existeront.

export interface PlaceAlert {
  id: number
  placeId: string
  type: 'closed' | 'change'
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

export interface Favorite {
  id: number
  userId: number
  placeId: string
  placeName: string
  placeLat: number
  placeLon: number
  placeCategory: CategoryKey
  createdAt: string
}
