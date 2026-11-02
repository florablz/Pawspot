export interface MapCenter {
  lat: number
  lng: number
}

/** Vue courante de la carte, émise par `PawspotMap` à chaque fin de déplacement. */
export interface MapView {
  center: MapCenter
  /** Zoom entier. */
  zoom: number
  /** `minLon,minLat,maxLon,maxLat` (`map.getBounds().toBBoxString()`). */
  bbox: string
}
