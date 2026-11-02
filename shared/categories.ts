/**
 * Configuration UNIQUE des catégories de lieux (CAHIER_DES_CHARGES.md §3.4) :
 * clé, libellés, icône, couleur du marqueur, sélecteurs OSM.
 * Utilisée par le client (filtres, marqueurs) et le serveur (requête Overpass,
 * classement des éléments OSM).
 */
import { normalizeDogValue, parseOsmDogPolicy } from './dogStatus'

/**
 * Condition sur un tag OSM :
 * - `equals` : la valeur (en minuscules, sans espaces autour) est l'une de celles-ci ;
 * - `listContains` : la valeur est une liste OSM séparée par `;` qui contient cet élément
 *   (ex. `waste=dog_excrement;trash`).
 */
export type OsmTagFilter =
  | { key: string; equals: readonly string[] }
  | { key: string; listContains: string }

/** Toutes les conditions doivent être vraies (ET). */
export type OsmSelector = readonly OsmTagFilter[]

export interface CategoryConfig {
  /** Libellé court au pluriel (puces de filtre). */
  label: string
  /** Libellé au singulier (fiche, nom de repli d'un lieu sans nom). */
  singular: string
  /** Emoji du marqueur et des puces. */
  icon: string
  /** Couleur du marqueur (hex, palette `paw-*` de tailwind.config.ts). */
  color: string
  priority: 'P1' | 'P2' | 'P3'
  /** Un élément OSM appartient à la catégorie s'il vérifie AU MOINS UN sélecteur (OU). */
  osm: readonly OsmSelector[]
}

const DOG_ALLOWED: OsmTagFilter = { key: 'dog', equals: ['yes', 'leashed', 'outside'] }
const TERRACE: OsmTagFilter = { key: 'outdoor_seating', equals: ['yes'] }

function foodCategory(amenity: string): readonly OsmSelector[] {
  const a: OsmTagFilter = { key: 'amenity', equals: [amenity] }
  return [[a, DOG_ALLOWED], [a, TERRACE]]
}

/** Ordre = ordre d'affichage des filtres ET ordre de priorité pour classer un élément OSM. */
export const CATEGORIES = {
  park: {
    label: 'Parcs',
    singular: 'Parc',
    icon: '\u{1F333}',
    color: '#66BB6A',
    priority: 'P1',
    osm: [[{ key: 'leisure', equals: ['park'] }]],
  },
  dog_park: {
    label: 'Parcs à chiens',
    singular: 'Parc à chiens',
    icon: '\u{1F43E}',
    color: '#43A047',
    priority: 'P1',
    osm: [[{ key: 'leisure', equals: ['dog_park'] }]],
  },
  beach: {
    label: 'Plages',
    singular: 'Plage',
    icon: '\u{1F30A}',
    color: '#4FC3F7',
    priority: 'P1',
    osm: [[{ key: 'natural', equals: ['beach'] }], [{ key: 'leisure', equals: ['beach'] }]],
  },
  restaurant: {
    label: 'Restos',
    singular: 'Restaurant',
    icon: '\u{1F37D}️',
    color: '#FF9100',
    priority: 'P1',
    osm: foodCategory('restaurant'),
  },
  bar: {
    label: 'Bars',
    singular: 'Bar',
    icon: '\u{1F37A}',
    color: '#FF6D00',
    priority: 'P1',
    osm: foodCategory('bar'),
  },
  cafe: {
    label: 'Cafés',
    singular: 'Café',
    icon: '☕',
    color: '#FFB74D',
    priority: 'P1',
    osm: foodCategory('cafe'),
  },
  vet: {
    label: 'Vétos',
    singular: 'Vétérinaire',
    icon: '\u{1FA7A}',
    color: '#E65100',
    priority: 'P1',
    osm: [[{ key: 'amenity', equals: ['veterinary'] }]],
  },
  pet_shop: {
    label: 'Animaleries',
    singular: 'Animalerie',
    icon: '\u{1F9B4}',
    color: '#A1887F',
    priority: 'P2',
    osm: [[{ key: 'shop', equals: ['pet'] }]],
  },
  groomer: {
    label: 'Toiletteurs',
    singular: 'Toiletteur',
    icon: '✂️',
    color: '#FF9E40',
    priority: 'P2',
    osm: [[{ key: 'shop', equals: ['pet_grooming'] }]],
  },
  dog_bin: {
    label: 'Sacs et poubelles',
    singular: 'Distributeur de sacs / poubelle canine',
    icon: '\u{1F6AE}',
    color: '#0288D1',
    priority: 'P2',
    osm: [[{ key: 'vending', listContains: 'excrement_bags' }], [{ key: 'waste', listContains: 'dog_excrement' }]],
  },
} as const satisfies Record<string, CategoryConfig>

export type CategoryKey = keyof typeof CATEGORIES

/** Clés dans l'ordre d'affichage (tuple non vide, utilisable par `z.enum`). */
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as [CategoryKey, ...CategoryKey[]]

/** Liste prête pour l'affichage : `{ key, label, singular, icon, color, priority, osm }`. */
export const CATEGORY_LIST: ReadonlyArray<CategoryConfig & { key: CategoryKey }> = CATEGORY_KEYS.map(key => ({ key, ...CATEGORIES[key] }))

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATEGORIES, value)
}

/** Repli d'affichage pour une catégorie inconnue. */
export const DEFAULT_CATEGORY_ICON = '\u{1F4CD}'
export const DEFAULT_CATEGORY_COLOR = '#8D6E63'

function tagValue(tags: Record<string, string | undefined>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase() || undefined
}

export function matchesTagFilter(tags: Record<string, string | undefined>, f: OsmTagFilter): boolean {
  const v = tagValue(tags, f.key)
  if (v === undefined) return false
  if ('equals' in f) return f.equals.includes(v)
  return v.split(';').some(part => part.trim() === f.listContains)
}

export function matchesSelector(tags: Record<string, string | undefined>, selector: OsmSelector): boolean {
  return selector.every(f => matchesTagFilter(tags, f))
}

/**
 * Catégorie d'un élément OSM d'après ses tags (première catégorie de `CATEGORIES`
 * dont un sélecteur correspond), ou `null`. Un resto sans terrasse ni `dog=yes`
 * n'a pas de catégorie.
 */
export function categoryFromTags(tags: Record<string, string | undefined>): CategoryKey | null {
  for (const key of CATEGORY_KEYS) {
    if (CATEGORIES[key].osm.some(sel => matchesSelector(tags, sel))) return key
  }
  return null
}

const FOOD_CATEGORIES: ReadonlySet<CategoryKey> = new Set<CategoryKey>(['restaurant', 'bar', 'cafe'])

/**
 * Le lieu doit-il apparaître dans PawSpot (et donc être mis en cache) ?
 * - restos / bars / cafés : exclus dès que `dog=no` (§3.4), même avec une terrasse ;
 * - autres catégories : exclus quand la politique OSM est `no`, c.-à-d. `dog=no` sans
 *   `dog:conditional` qui autorise à certains moments. C'est le comportement de la
 *   Phase 0 (qui excluait tout `dog=no`), sauf qu'une plage « chiens la nuit »
 *   (`dog=no` + `dog:conditional=yes @ (19:00-09:00)`) est désormais gardée.
 */
export function isPlaceEligible(category: CategoryKey, tags: Record<string, string | undefined>): boolean {
  if (FOOD_CATEGORIES.has(category)) return normalizeDogValue(tags.dog) !== 'no'
  return parseOsmDogPolicy(tags).policy !== 'no'
}

// ---------------------------------------------------------------------------
// Requête Overpass
// ---------------------------------------------------------------------------

function escapeOverpass(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tagFilterToOverpass(f: OsmTagFilter): string {
  const key = escapeOverpass(f.key)
  if ('equals' in f) {
    if (f.equals.length === 1) return `["${key}"="${escapeOverpass(f.equals[0]!)}"]`
    const alternatives = f.equals.map(escapeRegex).join('|')
    return `["${key}"~"${escapeOverpass(`^(${alternatives})$`)}",i]`
  }
  const item = escapeRegex(f.listContains)
  return `["${key}"~"${escapeOverpass(`(^|;) *${item} *(;|$)`)}"]`
}

/** Instructions Overpass QL (une par sélecteur) pour une liste de catégories. */
export function overpassStatements(keys: readonly CategoryKey[] = CATEGORY_KEYS): string[] {
  const statements: string[] = []
  for (const key of keys) {
    for (const selector of CATEGORIES[key].osm) {
      statements.push(`nwr${selector.map(tagFilterToOverpass).join('')};`)
    }
  }
  return [...new Set(statements)]
}
