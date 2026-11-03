/**
 * Types des réponses de l'API des lieux (source de vérité client + serveur).
 * Dates sérialisées en chaînes ISO. Champs optionnels absents du JSON quand vides.
 */
import type { CategoryKey } from './categories'
import type { DogStatus, DogStatusInfo, OsmDogPolicyKind } from './dogStatus'
import type { Bbox } from './geo'

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
  /** URL `https:` d'une image (OSM `image` / `wikimedia_commons`), passée par `sanitizeImageUrl`. */
  image?: string
  cuisine?: string
  description?: string
  /** Statut chien calculé (§3.8 bis), stocké dénormalisé dans `places.dog_status`. */
  dogStatus: DogStatus
  /** Données brutes de la source du statut (décomptes, dates…). */
  dogStatusInfo: DogStatusInfo
  /**
   * Texte de la source, prêt à afficher après « Source : » (« OpenStreetMap »,
   * « terrasse indiquée sur OpenStreetMap, aucune info sur les chiens »,
   * « 3 membres, dernier retour il y a 12 jours »).
   */
  dogStatusSource?: string
  /** Résumé de la politique OSM (`dog` / `dog:conditional`). */
  osmDogPolicy: OsmDogPolicyKind
  /**
   * Détail lisible de la politique OSM, quand utile, sans syntaxe OSM
   * (« Chiens interdits de 12 h à 14 h », « Chiens acceptés la nuit seulement »).
   */
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
  /**
   * Présent (et vrai) seulement si l'emprise ne touche aucun territoire couvert
   * (France métropolitaine, Corse, DROM, COM : `COVERAGE_AREAS` de shared/geo.ts) :
   * Overpass non interrogé, seul le cache est renvoyé. Absent = emprise couverte.
   */
  outsideCoverage?: boolean
}

/** Élément de `GET /api/favorites` : le lieu complet et la date d'ajout (ISO). */
export type FavoritePlace = Place & { favoritedAt: string }

// ---------------------------------------------------------------------------
// Géocodage (`GET /api/geocode?q=`, §3.2 / §4.3)
// ---------------------------------------------------------------------------

/**
 * Nature d'un résultat de géocodage (le front choisit le zoom et l'icône) :
 * - `city` : commune, ville, village ;
 * - `postcode` : code postal ;
 * - `street` : rue sans numéro ;
 * - `address` : adresse précise (numéro + rue) ;
 * - `place` : lieu nommé (gare, monument, quartier…) ;
 * - `region` : département, région, territoire (DROM / COM).
 */
export const GEOCODE_RESULT_TYPES = ['city', 'postcode', 'street', 'address', 'place', 'region'] as const
export type GeocodeResultType = (typeof GEOCODE_RESULT_TYPES)[number]

/**
 * Résultat de géocodage renvoyé par `GET /api/geocode?q=` (proxy Nominatim / Photon),
 * déjà converti par le serveur : le front ne voit jamais le format du fournisseur.
 */
export interface GeocodeResult {
  /** Libellé affiché dans les suggestions (ex. « 8 Rue de Rivoli, 75004 Paris »). */
  label: string
  /** Point où centrer la carte (WGS84). */
  lat: number
  lon: number
  /**
   * Emprise à afficher si le fournisseur en donne une (ville, région…), au format
   * `Bbox` de shared/geo.ts (`minLon, minLat, maxLon, maxLat`, pas l'ordre de Nominatim).
   */
  bbox?: Bbox
  type: GeocodeResultType
  postcode?: string
  /** Commune (absente pour une région). */
  city?: string
}

/** Réponse de `GET /api/geocode?q=` : résultats dans l'ordre de pertinence (liste vide si rien). */
export interface GeocodeResponse {
  results: GeocodeResult[]
}
