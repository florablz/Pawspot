import type { CategoryKey } from '#shared/categories'
import { isDogStatusConfirmed } from '#shared/dogStatus'
import { normalizeName } from '#shared/text'
import type { Place } from '#shared/types'

export interface PlaceFilters {
  /** Texte recherché dans le nom (sans tenir compte des accents ni de la casse). */
  query: string
  /** Catégories gardées ; liste vide = toutes. */
  categories: readonly CategoryKey[]
  /** Ne garder que les statuts `confirmed` et `confirmed_outside_only`. */
  confirmedOnly: boolean
}

/** Filtre les lieux déjà chargés (recherche par nom, catégories, statut chien). */
export function filterPlaces(places: readonly Place[], filters: PlaceFilters): Place[] {
  const q = normalizeName(filters.query)
  const categories = filters.categories.length ? new Set(filters.categories) : null
  return places.filter(p =>
    (!categories || categories.has(p.category))
    && (!filters.confirmedOnly || isDogStatusConfirmed(p.dogStatus))
    && (!q || normalizeName(p.name).includes(q)),
  )
}
