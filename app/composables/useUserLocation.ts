// Codes de GeolocationPositionError (le message du navigateur n'est pas en français).
const GEOLOCATION_ERRORS: Record<number, string> = {
  1: 'Géolocalisation refusée.',
  2: 'Position indisponible.',
  3: 'La localisation a pris trop de temps.',
}

/**
 * Position de l'utilisateur, partagée entre la carte et la fiche (itinéraire).
 * Jamais envoyée au serveur (§5 RGPD).
 */
export const useUserLocation = () => {
  const latitude = useState<number | null>('user-location-lat', () => null)
  const longitude = useState<number | null>('user-location-lon', () => null)
  const loading = useState('user-location-loading', () => false)
  const error = useState<string | null>('user-location-error', () => null)

  const getLocation = () =>
    new Promise<void>((resolve, reject) => {
      if (!navigator.geolocation) {
        error.value = 'La géolocalisation n\'est pas prise en charge par ce navigateur.'
        reject(error.value)
        return
      }

      loading.value = true
      error.value = null

      navigator.geolocation.getCurrentPosition(
        (position) => {
          latitude.value = position.coords.latitude
          longitude.value = position.coords.longitude
          loading.value = false
          resolve()
        },
        (err) => {
          error.value = GEOLOCATION_ERRORS[err.code] ?? 'Position indisponible.'
          loading.value = false
          reject(err)
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      )
    })

  return {
    latitude,
    longitude,
    loading,
    error,
    getLocation,
  }
}
