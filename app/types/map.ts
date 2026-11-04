import type { Bbox } from '#shared/geo'

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

/** Position de départ de la carte (lue dans l'URL ou reprise de la dernière vue). */
export interface MapStartView {
  lat: number
  lng: number
  zoom: number
}

/** Marges (px) de la carte masquées par la fiche : le lieu ouvert reste visible. */
export interface MapInsets {
  bottom: number
  right: number
}

/** Zone à montrer après une recherche d'adresse ou de ville. */
export interface MapArea {
  lat: number
  lng: number
  /** Emprise à cadrer si connue ; sinon centrage sur le point au zoom `maxZoom`. */
  bbox?: Bbox
  /** Zoom au plus (une emprise minuscule ne zoome pas au-delà). */
  maxZoom: number
  /** Zoom au moins (une grande commune reste au zoom où les lieux se chargent). */
  minZoom: number
}

/** Méthodes exposées par `PawspotMap` (`ref` de template). */
export interface PawspotMapApi {
  /** `false` si la carte n'est pas encore prête. */
  flyTo: (lat: number, lng: number, zoom?: number) => boolean
  getView: () => MapView | null
  /**
   * Montre un lieu : centré au `zoom` donné (en tenant compte des marges), ou,
   * sans zoom, déplacement minimal pour qu'il sorte de sous la fiche.
   */
  reveal: (lat: number, lng: number, insets: MapInsets, zoom?: number) => boolean
  /** Le point est-il dans la zone visible (hors marges) ? */
  isVisible: (lat: number, lng: number, insets: MapInsets) => boolean
  /** Cadre une zone (recherche) en tenant compte des barres du haut et des marges. */
  showArea: (area: MapArea, insets: MapInsets) => boolean
  /** Rend le focus clavier au marqueur d'un lieu (fermeture de la fiche). */
  focusMarker: (placeId: string) => boolean
  /** Focus sur le premier marqueur ou la première bulle visible (lien d'évitement) ; faux s'il n'y en a pas. */
  focusFirstMarker: () => boolean
}
