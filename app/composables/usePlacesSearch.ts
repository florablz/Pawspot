import type { PawspotPlace, MapCenter } from '~/types/places'

// Rayon utilisé par la recherche par nom (filtre côté client).
const NAME_SEARCH_RADIUS = 15000
// Écart (en degrés, ~1 km) en deçà duquel on réutilise les lieux déjà chargés pour la recherche par nom.
const NAME_SEARCH_REUSE_DISTANCE = 0.01

function distance(a: MapCenter, b: MapCenter): number {
  const dlat = a.lat - b.lat
  const dlng = a.lng - b.lng
  return Math.sqrt(dlat * dlat + dlng * dlng)
}

export const usePlacesSearch = () => {
  const places = ref<PawspotPlace[]>([])
  const fetching = ref(false)
  const searchError = ref<string | null>(null)
  const searchCenter = ref<MapCenter | null>(null)

  // Seule la dernière requête lancée a le droit d'écrire le résultat :
  // une réponse plus ancienne (ou une erreur plus ancienne) est ignorée.
  let latestRequest = 0
  let controller: AbortController | null = null
  // Lieux chargés dans un rayon de 15 km pour la recherche par nom, réutilisés tant que la carte ne bouge pas.
  let namePool: { center: MapCenter, places: PawspotPlace[] } | null = null
  let lastAction: (() => Promise<void>) | null = null

  async function request(lat: number, lng: number, radius: number, apply: (data: PawspotPlace[]) => void) {
    const id = ++latestRequest
    controller?.abort()
    controller = new AbortController()
    fetching.value = true
    searchError.value = null
    try {
      const data = await $fetch<{ places: PawspotPlace[] }>('/api/places', {
        query: { lat, lon: lng, radius },
        signal: controller.signal,
      })
      if (id !== latestRequest) return
      apply(data.places)
    } catch (err: unknown) {
      if (id !== latestRequest) return
      searchError.value = getApiErrorMessage(err, 'Impossible de charger les lieux.')
    } finally {
      if (id === latestRequest) fetching.value = false
    }
  }

  async function fetchPlaces(lat: number, lng: number, radius = 3000) {
    lastAction = () => fetchPlaces(lat, lng, radius)
    await request(lat, lng, radius, (data) => {
      places.value = data
      searchCenter.value = { lat, lng }
    })
  }

  async function searchByName(query: string, lat: number, lng: number) {
    lastAction = () => searchByName(query, lat, lng)
    const q = query.toLowerCase()
    const filter = (pool: PawspotPlace[]) => pool.filter(p => p.name.toLowerCase().includes(q))

    if (namePool && distance(namePool.center, { lat, lng }) < NAME_SEARCH_REUSE_DISTANCE) {
      // Annule une éventuelle requête en cours : le résultat local est le plus récent.
      latestRequest++
      controller?.abort()
      fetching.value = false
      searchError.value = null
      places.value = filter(namePool.places)
      return
    }

    await request(lat, lng, NAME_SEARCH_RADIUS, (data) => {
      namePool = { center: { lat, lng }, places: data }
      places.value = filter(data)
    })
  }

  async function retry() {
    if (lastAction) await lastAction()
  }

  function shouldShowSearchHere(currentCenter: MapCenter | null): boolean {
    if (!searchCenter.value || !currentCenter) return false
    return distance(currentCenter, searchCenter.value) > 0.005
  }

  return {
    places,
    fetching,
    searchError,
    searchCenter,
    fetchPlaces,
    searchByName,
    retry,
    shouldShowSearchHere,
  }
}
