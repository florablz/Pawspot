/**
 * Normalisation des noms de lieux (recherche, index `places.name_normalized`,
 * future détection de doublons). Fonction pure, client et serveur.
 *
 * « Café de l'Église » → « cafe de l eglise »
 */
export function normalizeName(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
