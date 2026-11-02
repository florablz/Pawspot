import { DOG_STATUS_LABELS, type DogStatus } from '#shared/dogStatus'

/**
 * Teinte d'affichage du statut chien : pastille des marqueurs et badge.
 * Jamais utilisée seule : le badge porte toujours l'emoji et le texte, la
 * pastille du marqueur un symbole.
 */
export type DogStatusTone = 'green' | 'orange' | 'yellow' | 'gray' | 'red'

export const DOG_STATUS_TONE: Record<DogStatus, DogStatusTone> = {
  refused: 'red',
  confirmed: 'green',
  confirmed_outside_only: 'green',
  osm_yes: 'green',
  osm_conditional: 'orange',
  likely_terrace: 'yellow',
  unknown: 'gray',
}

/**
 * Pastille des marqueurs Leaflet (HTML brut, pas de classes Tailwind) :
 * les couleurs reprennent les jetons `paw-*` de tailwind.config.ts.
 */
export const DOG_STATUS_MARKER_DOT: Record<DogStatusTone, { color: string, glyph: string }> = {
  green: { color: '#43A047', glyph: '✓' }, // paw-green-500
  orange: { color: '#FF6D00', glyph: '!' }, // paw-orange-500
  yellow: { color: '#FDD835', glyph: '?' }, // paw-yellow-400
  gray: { color: '#9E9E9E', glyph: '?' }, // paw-gray-400
  red: { color: '#D32F2F', glyph: '✕' }, // paw-red-700
}

/** Couleur du symbole sur la pastille (contraste suffisant sur fond clair ou foncé). */
export const DOG_STATUS_MARKER_GLYPH_COLOR: Record<DogStatusTone, string> = {
  green: '#FFFFFF',
  orange: '#FFFFFF',
  yellow: '#2C1810', // paw-brown-900
  gray: '#2C1810',
  red: '#FFFFFF',
}

/** Phrase complète lue par les lecteurs d'écran (« Statut chien : … »). */
export function dogStatusAccessibleText(status: DogStatus, source?: string, detail?: string): string {
  const parts = [`Statut chien : ${DOG_STATUS_LABELS[status].label}`]
  if (detail) parts.push(detail)
  if (source) parts.push(`Source : ${source}`)
  return parts.join('. ')
}
