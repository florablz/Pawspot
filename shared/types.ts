/**
 * Types des réponses de l'API des lieux (source de vérité client + serveur).
 * Dates sérialisées en chaînes ISO. Champs optionnels absents du JSON quand vides.
 */
import type { CategoryKey } from './categories'
import type { DogStatus, DogStatusInfo, OsmDogPolicyKind } from './dogStatus'

/**
 * Identifiant d'un lieu :
 * - `osm:node:123`, `osm:way:456`, `osm:relation:789` (lieux OpenStreetMap) ;
 * - `user:<nanoid>` (lieux ajoutés par la communauté, P2 ; les lieux de démo
 *   du seed sont `user:demo-1`…).
 */
export type PlaceId = string

export type PlaceSource = 'osm' | 'user'

/**
 * - `active` : affiché ;
 * - `closed` : fermé (alertes confirmées, Phase 3) ;
 * - `hidden` : masqué par la modération (P2) ;
 * - `merged` : doublon fusionné dans `mergedInto` (P2) ;
 * - `removed` : disparu d'OSM ou plus éligible (ex. passé à `dog=no`) lors d'un
 *   rafraîchissement ; redevient `active` s'il réapparaît. Gardé en base pour ne
 *   pas casser les favoris / avis / alertes qui le référencent.
 */
export type PlaceStatus = 'active' | 'closed' | 'hidden' | 'merged' | 'removed'

export const PLACE_STATUSES = ['active', 'closed', 'hidden', 'merged', 'removed'] as const satisfies readonly PlaceStatus[]

export interface Place {
  id: PlaceId
  source: PlaceSource
  /** Nom OSM, ou à défaut le libellé singulier de la catégorie (« Parc », « Café »…). */
  name: string
  /** Faux si `name` est le libellé de repli. */
  hasName: boolean
  lat: number
  lon: number
  category: CategoryKey
  address?: string
  phone?: string
  /** Toujours http(s), passé par `sanitizeWebsite`. */
  website?: string
  /** Valeur brute `opening_hours` d'OSM. */
  openingHours?: string
  /** URL http(s) d'une image (OSM `image` / `wikimedia_commons`). */
  image?: string
  cuisine?: string
  description?: string
  /** Statut chien calculé (§3.8 bis), stocké dénormalisé dans `places.dog_status`. */
  dogStatus: DogStatus
  /** Données brutes de la source du statut (décomptes, dates…). */
  dogStatusInfo: DogStatusInfo
  /** Texte de la source, prêt à afficher (« OpenStreetMap », « terrasse », « 3 membres, dernier retour il y a 12 jours »). */
  dogStatusSource?: string
  /** Résumé de la politique OSM (`dog` / `dog:conditional`). */
  osmDogPolicy: OsmDogPolicyKind
  /** Détail de la politique OSM, quand utile (« Uniquement la nuit (yes @ (19:00-08:00)) »). */
  osmDogDetail?: string
  /** `outdoor_seating=yes`. */
  hasTerrace: boolean
  /** `access:conditional` brut (horaires d'accès au lieu, pas les chiens). */
  accessConditional?: string
  status: PlaceStatus
  /** Lieu confirmé (toujours vrai pour OSM ; vote d'existence pour les lieux `user`, P2). */
  verified: boolean
  mergedInto?: PlaceId
  /** Dernière mise à jour de la ligne (ISO). */
  updatedAt: string
}

/** Réponse de `GET /api/places?bbox=minLon,minLat,maxLon,maxLat&zoom=Z`. */
export interface PlacesResponse {
  /** Lieux `active` de l'emprise (au plus `truncated` → limite atteinte). */
  places: Place[]
  /** Overpass n'a pas répondu : données en base renvoyées telles quelles, peut-être anciennes ou incomplètes. */
  stale: boolean
  /** Zoom < 11 ou emprise trop grande : Overpass non interrogé ; inviter à zoomer. */
  zoomTooLow: boolean
  /** Une partie des tuiles reste à rafraîchir (limite de tuiles par requête) : relancer la même requête complétera. */
  incomplete: boolean
  /** Trop de lieux dans l'emprise : liste tronquée à la limite du serveur. */
  truncated: boolean
}
