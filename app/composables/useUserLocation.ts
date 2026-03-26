export const useUserLocation = () => {
  const latitude = ref<number | null>(null)
  const longitude = ref<number | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const getLocation = () =>
    new Promise<void>((resolve, reject) => {
      if (!navigator.geolocation) {
        error.value = "La geolocalisation n'est pas supportee par ce navigateur."
        reject(error.value)
        return
      }

      loading.value = true

      navigator.geolocation.getCurrentPosition(
        (position) => {
          latitude.value = position.coords.latitude
          longitude.value = position.coords.longitude
          loading.value = false
          resolve()
        },
        (err) => {
          error.value = err.message
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
