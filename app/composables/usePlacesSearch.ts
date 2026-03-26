import type { PawspotPlace, MapCenter } from '~/types/places'

export const usePlacesSearch = () => {
  const places = ref<PawspotPlace[]>([])
  const fetching = ref(false)
  const searchCenter = ref<MapCenter | null>(null)

  async function fetchPlaces(lat: number, lng: number, radius = 3000) {
    fetching.value = true
    try {
      const data = await $fetch<{ places: PawspotPlace[] }>('/api/places', {
        query: { lat, lon: lng, radius },
      })
      places.value = data.places
      searchCenter.value = { lat, lng }
    } finally {
      fetching.value = false
    }
  }

  async function searchByName(query: string, lat: number, lng: number) {
    fetching.value = true
    try {
      const data = await $fetch<{ places: PawspotPlace[] }>('/api/places', {
        query: { lat, lon: lng, radius: 15000 },
      })
      const q = query.toLowerCase()
      places.value = data.places.filter(p => p.name.toLowerCase().includes(q))
    } finally {
      fetching.value = false
    }
  }

  function shouldShowSearchHere(currentCenter: MapCenter | null): boolean {
    if (!searchCenter.value || !currentCenter) return false
    const dlat = currentCenter.lat - searchCenter.value.lat
    const dlng = currentCenter.lng - searchCenter.value.lng
    const dist = Math.sqrt(dlat * dlat + dlng * dlng)
    return dist > 0.005
  }

  return {
    places,
    fetching,
    searchCenter,
    fetchPlaces,
    searchByName,
    shouldShowSearchHere,
  }
}
