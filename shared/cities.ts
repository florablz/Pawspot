/**
 * Grandes villes pré-remplies par `npm run places:prefetch` (§4.1, P2) :
 * métropole, Corse et chefs-lieux des DROM. Fonctions pures, client et serveur.
 *
 * L'emprise de chaque ville est un carré centré sur le centre-ville, de
 * ± `radiusKm` : elle couvre le cœur de la ville (là où se trouvent la plupart
 * des lieux), pas toute l'agglomération. Le reste se remplit à la demande.
 * Avec des tuiles z12 (~6,5 km en métropole), une ville de rayon 3 km fait 1 à
 * 4 tuiles, Paris (6 km) 9 à 12.
 */
import { CACHE_TILE_ZOOM, tileRangeForBbox, tileRangeSize } from './geo'
import type { Bbox, TileRange } from './geo'
import { normalizeName } from './text'

export interface PrefetchCity {
  /** Identifiant stable (minuscules, sans accent). */
  key: string
  /** Nom affiché. */
  name: string
  /** Centre-ville (WGS84). */
  lat: number
  lon: number
  /** Demi-côté de l'emprise, en km. */
  radiusKm: number
}

export const PREFETCH_CITIES: readonly PrefetchCity[] = [
  // Métropole, par population décroissante (approximative).
  { key: 'paris', name: 'Paris', lat: 48.8566, lon: 2.3522, radiusKm: 6 },
  { key: 'marseille', name: 'Marseille', lat: 43.2965, lon: 5.3698, radiusKm: 5 },
  { key: 'lyon', name: 'Lyon', lat: 45.7640, lon: 4.8357, radiusKm: 5 },
  { key: 'toulouse', name: 'Toulouse', lat: 43.6047, lon: 1.4442, radiusKm: 5 },
  { key: 'nice', name: 'Nice', lat: 43.7102, lon: 7.2620, radiusKm: 4 },
  { key: 'nantes', name: 'Nantes', lat: 47.2184, lon: -1.5536, radiusKm: 4 },
  { key: 'montpellier', name: 'Montpellier', lat: 43.6108, lon: 3.8767, radiusKm: 4 },
  { key: 'strasbourg', name: 'Strasbourg', lat: 48.5734, lon: 7.7521, radiusKm: 4 },
  { key: 'bordeaux', name: 'Bordeaux', lat: 44.8378, lon: -0.5792, radiusKm: 4 },
  { key: 'lille', name: 'Lille', lat: 50.6292, lon: 3.0573, radiusKm: 4 },
  { key: 'rennes', name: 'Rennes', lat: 48.1173, lon: -1.6778, radiusKm: 4 },
  { key: 'reims', name: 'Reims', lat: 49.2583, lon: 4.0317, radiusKm: 3 },
  { key: 'toulon', name: 'Toulon', lat: 43.1242, lon: 5.9280, radiusKm: 3 },
  { key: 'saint-etienne', name: 'Saint-Étienne', lat: 45.4397, lon: 4.3872, radiusKm: 3 },
  { key: 'le-havre', name: 'Le Havre', lat: 49.4944, lon: 0.1079, radiusKm: 3 },
  { key: 'grenoble', name: 'Grenoble', lat: 45.1885, lon: 5.7245, radiusKm: 3 },
  { key: 'dijon', name: 'Dijon', lat: 47.3220, lon: 5.0415, radiusKm: 3 },
  { key: 'angers', name: 'Angers', lat: 47.4784, lon: -0.5632, radiusKm: 3 },
  { key: 'nimes', name: 'Nîmes', lat: 43.8367, lon: 4.3601, radiusKm: 3 },
  { key: 'aix-en-provence', name: 'Aix-en-Provence', lat: 43.5297, lon: 5.4474, radiusKm: 3 },
  { key: 'clermont-ferrand', name: 'Clermont-Ferrand', lat: 45.7772, lon: 3.0870, radiusKm: 3 },
  { key: 'brest', name: 'Brest', lat: 48.3904, lon: -4.4861, radiusKm: 3 },
  { key: 'tours', name: 'Tours', lat: 47.3941, lon: 0.6848, radiusKm: 3 },
  { key: 'le-mans', name: 'Le Mans', lat: 48.0061, lon: 0.1996, radiusKm: 3 },
  { key: 'amiens', name: 'Amiens', lat: 49.8941, lon: 2.2958, radiusKm: 3 },
  { key: 'limoges', name: 'Limoges', lat: 45.8336, lon: 1.2611, radiusKm: 3 },
  { key: 'annecy', name: 'Annecy', lat: 45.8992, lon: 6.1294, radiusKm: 3 },
  { key: 'perpignan', name: 'Perpignan', lat: 42.6887, lon: 2.8948, radiusKm: 3 },
  { key: 'metz', name: 'Metz', lat: 49.1193, lon: 6.1757, radiusKm: 3 },
  { key: 'besancon', name: 'Besançon', lat: 47.2378, lon: 6.0241, radiusKm: 3 },
  { key: 'orleans', name: 'Orléans', lat: 47.9030, lon: 1.9093, radiusKm: 3 },
  { key: 'rouen', name: 'Rouen', lat: 49.4432, lon: 1.0999, radiusKm: 3 },
  { key: 'mulhouse', name: 'Mulhouse', lat: 47.7508, lon: 7.3359, radiusKm: 3 },
  { key: 'caen', name: 'Caen', lat: 49.1829, lon: -0.3707, radiusKm: 3 },
  { key: 'nancy', name: 'Nancy', lat: 48.6921, lon: 6.1844, radiusKm: 3 },
  { key: 'avignon', name: 'Avignon', lat: 43.9493, lon: 4.8055, radiusKm: 3 },
  { key: 'poitiers', name: 'Poitiers', lat: 46.5802, lon: 0.3404, radiusKm: 3 },
  { key: 'la-rochelle', name: 'La Rochelle', lat: 46.1603, lon: -1.1511, radiusKm: 3 },
  { key: 'pau', name: 'Pau', lat: 43.2951, lon: -0.3708, radiusKm: 3 },
  // Corse.
  { key: 'ajaccio', name: 'Ajaccio', lat: 41.9192, lon: 8.7386, radiusKm: 3 },
  { key: 'bastia', name: 'Bastia', lat: 42.6977, lon: 9.4508, radiusKm: 3 },
  // DROM.
  { key: 'saint-denis-reunion', name: 'Saint-Denis (La Réunion)', lat: -20.8823, lon: 55.4504, radiusKm: 3 },
  { key: 'fort-de-france', name: 'Fort-de-France', lat: 14.6161, lon: -61.0588, radiusKm: 3 },
  { key: 'pointe-a-pitre', name: 'Pointe-à-Pitre', lat: 16.2411, lon: -61.5331, radiusKm: 3 },
  { key: 'cayenne', name: 'Cayenne', lat: 4.9224, lon: -52.3135, radiusKm: 3 },
  { key: 'mamoudzou', name: 'Mamoudzou', lat: -12.7806, lon: 45.2279, radiusKm: 3 },
]

const KM_PER_DEGREE_LAT = 111.32

/** Emprise carrée de ± `radiusKm` autour du centre de la ville. */
export function cityBbox(city: Pick<PrefetchCity, 'lat' | 'lon' | 'radiusKm'>): Bbox {
  const dLat = city.radiusKm / KM_PER_DEGREE_LAT
  const dLon = city.radiusKm / (KM_PER_DEGREE_LAT * Math.cos((city.lat * Math.PI) / 180))
  return { minLon: city.lon - dLon, minLat: city.lat - dLat, maxLon: city.lon + dLon, maxLat: city.lat + dLat }
}

/** Tuiles du cache (z12) qui recouvrent l'emprise de la ville. */
export function cityTileRange(city: Pick<PrefetchCity, 'lat' | 'lon' | 'radiusKm'>): TileRange {
  return tileRangeForBbox(cityBbox(city), CACHE_TILE_ZOOM)
}

export function cityTileCount(city: Pick<PrefetchCity, 'lat' | 'lon' | 'radiusKm'>): number {
  return tileRangeSize(cityTileRange(city))
}

/**
 * Ville désignée par `query` : clé ou nom, sans tenir compte de la casse, des
 * accents ni des tirets (« saint etienne », « Saint-Étienne », « saint-etienne »).
 * À défaut, la seule ville dont le nom commence par la requête (« Saint-Denis »).
 * `null` si aucune ou plusieurs villes correspondent.
 */
export function findPrefetchCity(query: string, cities: readonly PrefetchCity[] = PREFETCH_CITIES): PrefetchCity | null {
  const q = normalizeName(query)
  if (!q) return null
  const exact = cities.find(c => normalizeName(c.key) === q || normalizeName(c.name) === q)
  if (exact) return exact
  const prefixed = cities.filter(c => normalizeName(c.name).startsWith(q))
  return prefixed.length === 1 ? prefixed[0]! : null
}
