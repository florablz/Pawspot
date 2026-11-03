/** Largeur à partir de laquelle la fiche devient un panneau latéral (Tailwind `lg`). */
export const DESKTOP_QUERY = '(min-width: 1024px)'
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** Lecture ponctuelle (hors composant, ex. au moment d'un déplacement de carte). */
export function matchesMedia(query: string): boolean {
  return import.meta.client && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

/** Media query réactive (faux côté serveur, mis à jour au montage). */
export function useMediaQuery(query: string) {
  const matches = ref(false)
  let mql: MediaQueryList | null = null
  const update = () => {
    matches.value = !!mql?.matches
  }
  onMounted(() => {
    if (typeof window.matchMedia !== 'function') return
    mql = window.matchMedia(query)
    update()
    mql.addEventListener('change', update)
  })
  onBeforeUnmount(() => mql?.removeEventListener('change', update))
  return matches
}
