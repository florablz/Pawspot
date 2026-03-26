export interface PawspotPlace {
  id: string
  name: string
  lat: number
  lon: number
  category: CategoryKey
  address?: string
  phone?: string
  website?: string
  openingHours?: string
  dog?: string
  description?: string
  cuisine?: string
  image?: string
  dog?: string
  dogPolicy?: 'all_day' | 'night_only' | 'no' | 'restricted' | 'unknown'
  dogPolicySource?: string
}

export type CategoryKey = 'park' | 'dog_park' | 'beach' | 'restaurant' | 'bar' | 'cafe' | 'vet'

export interface MapCenter {
  lat: number
  lng: number
}

export interface CategoryFilter {
  key: CategoryKey
  label: string
  icon: string
  color: string
}
