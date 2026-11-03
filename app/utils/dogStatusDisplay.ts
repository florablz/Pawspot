import { DOG_STATUS_LABELS, type DogStatus } from '#shared/dogStatus'

/**
 * Teinte d'affichage du statut chien dans le badge. Jamais utilisée seule :
 * le badge porte toujours l'emoji et le texte.
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

/** Pastille d'un marqueur Leaflet : couleur, symbole et bordure. */
export interface DogStatusMarker {
  color: string
  /** Symbole propre au statut : la pastille ne repose jamais sur la couleur seule. */
  glyph: string
  glyphColor: string
  /** Bordure en pointillés : statut « probable », non confirmé. */
  dashed: boolean
}

/**
 * Pastille des marqueurs Leaflet (HTML brut, pas de classes Tailwind) : un
 * symbole distinct par niveau de certitude. Les couleurs reprennent les jetons
 * `paw-*` de tailwind.config.ts ; contraste du symbole ≥ 4,5:1.
 */
export const DOG_STATUS_MARKER: Record<DogStatus, DogStatusMarker> = {
  // Confirmé par la communauté (intérieur ou terrasse) : double coche.
  confirmed: { color: '#2E7D32', glyph: '✓✓', glyphColor: '#FFFFFF', dashed: false }, // paw-green-700, 5,13:1
  confirmed_outside_only: { color: '#2E7D32', glyph: '✓✓', glyphColor: '#FFFFFF', dashed: false },
  // Accepté d'après OpenStreetMap : coche simple.
  osm_yes: { color: '#2E7D32', glyph: '✓', glyphColor: '#FFFFFF', dashed: false },
  osm_conditional: { color: '#FF6D00', glyph: '!', glyphColor: '#2C1810', dashed: false }, // paw-orange-500 / brown-900, 5,97:1
  likely_terrace: { color: '#FDD835', glyph: '~', glyphColor: '#2C1810', dashed: true }, // paw-yellow-400, 12,1:1
  unknown: { color: '#9E9E9E', glyph: '?', glyphColor: '#2C1810', dashed: false }, // paw-gray-400, 6,29:1
  refused: { color: '#D32F2F', glyph: '✕', glyphColor: '#FFFFFF', dashed: false }, // paw-red-700, 4,98:1
}

/** Phrase complète lue par les lecteurs d'écran (« Statut chien : … »). */
export function dogStatusAccessibleText(status: DogStatus, source?: string, detail?: string): string {
  const parts = [`Statut chien : ${DOG_STATUS_LABELS[status].label}`]
  if (detail) parts.push(detail)
  if (source) parts.push(`Source : ${source}`)
  return parts.join('. ')
}
