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

/**
 * Forme canonique d'une recherche de géocodage : c'est CETTE chaîne qui est
 * envoyée au fournisseur (Nominatim / Photon), qui sert de clé au cache
 * `geocode_cache` et de clé de dédoublonnage des requêtes en cours. Ainsi, deux
 * requêtes qui partagent une entrée de cache sont exactement la même requête pour
 * le fournisseur.
 *
 * Unicode NFC, caractères de contrôle remplacés par un espace, minuscules, espaces
 * réduits et retirés aux bords. Accents, caractères non latins et ponctuation sont
 * conservés : « Saint-Étienne » → « saint-étienne », « Lyon 東京 » → « lyon 東京 ».
 * Fonction pure, client et serveur.
 */
export function normalizeGeocodeQuery(q: string): string {
  return q
    .normalize('NFC')
    .replace(/\p{Cc}/gu, ' ')
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
}
