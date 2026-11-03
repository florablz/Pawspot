/** Délai avant de recopier la vue dans l'URL après un déplacement (ms). */
const VIEW_SYNC_DELAY = 400

/**
 * Recopie la vue de la carte et les filtres dans la query de l'URL actuelle
 * (`router.replace` : aucune entrée d'historique ajoutée). À appeler une fois,
 * dans le composant qui affiche la carte.
 */
export function useMapUrlSync() {
  const route = useRoute()
  const router = useRouter()
  const { view, settled } = useMapView()
  const { categories, confirmedOnly } = useFilters()

  let timer: ReturnType<typeof setTimeout> | undefined
  /** Ne jamais remplacer l'URL pendant une navigation (on l'annulerait). */
  let navigating = false
  const removeBefore = router.beforeEach(() => {
    navigating = true
  })
  const removeAfter = router.afterEach(() => {
    navigating = false
  })

  function sync() {
    if (navigating) {
      schedule(VIEW_SYNC_DELAY)
      return
    }
    const v = settled.value ? view.value : null
    const patch = {
      ...(v ? viewToQuery({ lat: v.center.lat, lng: v.center.lng, zoom: v.zoom }) : {}),
      ...filtersToQuery({ categories: categories.value, confirmedOnly: confirmedOnly.value }),
    }
    const next = mergeMapQuery(route.query, patch)
    if (sameQuery(route.query, next)) return
    router.replace({ path: route.path, query: next, hash: route.hash })
  }

  function schedule(delay: number) {
    if (!import.meta.client) return
    clearTimeout(timer)
    timer = setTimeout(sync, delay)
  }

  watch([view, settled], () => schedule(VIEW_SYNC_DELAY))
  watch([categories, confirmedOnly], () => schedule(0), { deep: true })
  // Après un changement de page (fiche ouverte / fermée, « Retour »), la query
  // de la nouvelle entrée peut dater : on y remet la vue actuelle.
  watch(() => route.path, () => schedule(0))

  onBeforeUnmount(() => {
    clearTimeout(timer)
    removeBefore()
    removeAfter()
  })
}
