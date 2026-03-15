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
}

export type CategoryKey = 'park' | 'dog_park' | 'restaurant' | 'bar' | 'cafe' | 'vet'

export interface MapCenter {
  lat: number
  lng: number
}

export interface CategoryFilter {
  key: 'all' | CategoryKey
  label: string
  icon: string
  color: string
}
