/** Une instance de chargement des lieux par application Nuxt (pas de partage entre requêtes SSR). */
const instances = new WeakMap<object, ReturnType<typeof usePlacesSearch>>()

/**
 * Lieux chargés pour la zone de la carte, partagés entre la carte et la fiche
 * (`/lieu/[id]` affiche tout de suite un lieu déjà chargé, sans attendre l'API).
 */
export function usePlaces() {
  const nuxtApp = useNuxtApp()
  let instance = instances.get(nuxtApp)
  if (!instance) {
    instance = usePlacesSearch()
    instances.set(nuxtApp, instance)
  }
  return instance
}
