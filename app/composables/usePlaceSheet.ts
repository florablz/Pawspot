import type { Place } from '#shared/types'

/** Hauteur de la fiche sur mobile : aperçu (≈ 40 %) ou dépliée (≈ 88 %). */
export type SheetSnap = 'peek' | 'full'

/**
 * Fiche lieu ouverte sur la carte (§3.5). Ouvrir une fiche pousse
 * `/lieu/<id>` (en gardant la vue et les filtres dans la query) ; la fermer
 * revient à `/` : retour arrière dans l'historique si la fiche a été ouverte
 * depuis la carte, sinon remplacement (lien partagé ouvert directement).
 */
export function usePlaceSheet() {
  const route = useRoute()
  const router = useRouter()

  /** Lieu affiché dans la fiche (mis à jour par la page `/lieu/[id]`). */
  const selected = useState<Place | null>('sheet-place', () => null)
  const snap = useState<SheetSnap>('sheet-snap', () => 'peek')
  /** Hauteur mesurée de l'aperçu (px), pour remonter la barre d'état au-dessus. */
  const peekHeight = useState<number | null>('sheet-peek-height', () => null)
  /** L'entrée précédente de l'historique est la carte (`/`) : fermer = retour arrière. */
  const openedFromMap = useState<boolean>('sheet-opened-from-map', () => false)

  function open(place: Place) {
    selected.value = place
    snap.value = 'peek'
    const target = { path: placePath(place.id), query: pickMapQuery(route.query) }
    if (route.path.startsWith('/lieu/')) {
      // D'une fiche à l'autre : on remplace, « Retour » ferme la fiche en une fois.
      router.replace(target)
    }
    else {
      openedFromMap.value = true
      router.push(target)
    }
  }

  function close() {
    const back = import.meta.client ? (window.history.state as { back?: unknown } | null)?.back : null
    const backIsMap = typeof back === 'string' && (back === '/' || back.startsWith('/?'))
    if (openedFromMap.value && backIsMap) router.back()
    else router.replace({ path: '/', query: pickMapQuery(route.query) })
    openedFromMap.value = false
  }

  return { selected, snap, peekHeight, open, close }
}
