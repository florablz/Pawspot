import type { CategoryKey } from '#shared/categories'

/**
 * Filtres de la carte (§3.3), partagés entre la barre du haut, la carte et la
 * barre d'état. Catégories et « Confirmés » sont initialisés depuis l'URL
 * (`?cat=park,cafe&confirmes=1`) puis y sont recopiés par `useMapUrlSync`.
 * Le filtre par nom reste local à la session (la recherche unifiée viendra ensuite).
 */
export function useFilters() {
  const route = useRoute()
  const categories = useState<CategoryKey[]>('filters-categories', () => parseFiltersQuery(route.query).categories)
  const confirmedOnly = useState<boolean>('filters-confirmed', () => parseFiltersQuery(route.query).confirmedOnly)
  const nameQuery = useState<string>('filters-name', () => '')

  const filtersActive = computed(() => !!nameQuery.value.trim() || categories.value.length > 0 || confirmedOnly.value)

  function clearFilters() {
    nameQuery.value = ''
    categories.value = []
    confirmedOnly.value = false
  }

  return { categories, confirmedOnly, nameQuery, filtersActive, clearFilters }
}
