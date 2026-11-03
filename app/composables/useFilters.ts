import type { CategoryKey } from '#shared/categories'

/**
 * Filtres de la carte (§3.3), partagés entre la barre du haut, la carte et la
 * barre d'état. Catégories et « Confirmés » sont initialisés depuis l'URL
 * (`?cat=park,cafe&confirmes=1`) puis y sont recopiés par `useMapUrlSync`.
 * La recherche par nom n'est plus un filtre : c'est la barre de recherche unifiée
 * (`SearchBox`), qui propose des lieux sans masquer les autres.
 */
export function useFilters() {
  const route = useRoute()
  const categories = useState<CategoryKey[]>('filters-categories', () => parseFiltersQuery(route.query).categories)
  const confirmedOnly = useState<boolean>('filters-confirmed', () => parseFiltersQuery(route.query).confirmedOnly)

  const filtersActive = computed(() => categories.value.length > 0 || confirmedOnly.value)

  function clearFilters() {
    categories.value = []
    confirmedOnly.value = false
  }

  return { categories, confirmedOnly, filtersActive, clearFilters }
}
