import type { PawspotPlace } from '~/types/places'

export const useFavorites = () => {
  const favoritedIds = useState<Set<string>>('favorite-ids', () => new Set())

  async function checkFavorite(placeId: string) {
    try {
      const data = await $fetch<{ favorited: boolean }>(`/api/favorites/check/${placeId}`)
      if (data.favorited) {
        favoritedIds.value.add(placeId)
      } else {
        favoritedIds.value.delete(placeId)
      }
    } catch { /* ignore */ }
  }

  async function toggleFavorite(place: PawspotPlace) {
    try {
      const data = await $fetch<{ favorited: boolean }>('/api/favorites', {
        method: 'POST',
        body: {
          placeId: place.id,
          placeName: place.name,
          placeLat: place.lat,
          placeLon: place.lon,
          placeCategory: place.category,
        },
      })
      if (data.favorited) {
        favoritedIds.value.add(place.id)
      } else {
        favoritedIds.value.delete(place.id)
      }
      // Force reactivity on the Set
      favoritedIds.value = new Set(favoritedIds.value)
      return data.favorited
    } catch {
      return false
    }
  }

  function isFavorited(placeId: string) {
    return favoritedIds.value.has(placeId)
  }

  return { favoritedIds, checkFavorite, toggleFavorite, isFavorited }
}
