import type { FavoriteToggleResponse } from '~/types/api'

/** Ids de lieux à mettre dans une URL (`osm:node:123` → `osm%3Anode%3A123`). */
export function favoriteUrl(placeId: string): string {
  return `/api/favorites/${encodeURIComponent(placeId)}`
}

export const useFavorites = () => {
  const favoritedIds = useState<Set<string>>('favorite-ids', () => new Set())

  function setLocal(placeId: string, favorited: boolean) {
    const next = new Set(favoritedIds.value)
    if (favorited) next.add(placeId)
    else next.delete(placeId)
    favoritedIds.value = next
  }

  async function checkFavorite(placeId: string) {
    try {
      const data = await $fetch<{ favorited: boolean }>(`/api/favorites/check/${encodeURIComponent(placeId)}`)
      setLocal(placeId, data.favorited)
    }
    catch { /* l'étoile garde son état actuel */ }
  }

  /** Ajoute (POST) ou retire (DELETE) un favori. Lève l'erreur de l'API en cas d'échec. */
  async function setFavorite(placeId: string, favorited: boolean): Promise<boolean> {
    const data = favorited
      ? await $fetch<FavoriteToggleResponse>('/api/favorites', { method: 'POST', body: { placeId } })
      : await $fetch<FavoriteToggleResponse>(favoriteUrl(placeId), { method: 'DELETE' })
    setLocal(placeId, data.favorited)
    return data.favorited
  }

  function toggleFavorite(placeId: string): Promise<boolean> {
    return setFavorite(placeId, !favoritedIds.value.has(placeId))
  }

  function isFavorited(placeId: string) {
    return favoritedIds.value.has(placeId)
  }

  return { favoritedIds, checkFavorite, setFavorite, toggleFavorite, isFavorited }
}
