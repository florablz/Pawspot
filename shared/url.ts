/**
 * Nettoyage des URL venant d'OpenStreetMap (ou des utilisateurs) avant de les
 * rendre dans un `href` / `src`. Fonctions pures, client et serveur.
 */

const MAX_URL_LENGTH = 2048

/** Schéma explicite (`javascript:`, `mailto:`, `https:`…) : lettres puis `:`, sans point avant. */
const EXPLICIT_SCHEME = /^([a-z][a-z0-9+-]*):/i

/**
 * Ne garde que les URL `http:` / `https:`.
 * - `www.exemple.fr` ou `exemple.fr/menu` → `https://www.exemple.fr/` (schéma ajouté) ;
 * - `//exemple.fr` → `https://exemple.fr/` ;
 * - plusieurs valeurs séparées par `;` (usage OSM) → la première seulement ;
 * - `javascript:`, `data:`, `mailto:`, URL avec identifiants (`user@hôte`),
 *   hôte sans point, espaces, valeur vide ou trop longue → `undefined`.
 * Renvoie l'URL normalisée (`URL.href`).
 */
export function sanitizeWebsite(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  let v = value.split(';')[0]!.trim()
  if (!v || v.length > MAX_URL_LENGTH) return undefined
  // Espaces ou caractères de contrôle au milieu : pas une URL.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001F\u007F]/.test(v)) return undefined

  if (v.startsWith('//')) {
    v = `https:${v}`
  }
  else {
    const scheme = EXPLICIT_SCHEME.exec(v)?.[1]?.toLowerCase()
    if (scheme === undefined) {
      v = `https://${v}`
    }
    else if (scheme !== 'http' && scheme !== 'https') {
      // `localhost:3000` est aussi rejeté ici : pas de point dans l'hôte de toute façon.
      return undefined
    }
  }
  return toSafeHttpUrl(v)
}

/** Valide une URL absolue http(s) sans rien ajouter. `undefined` sinon. */
export function sanitizeHttpUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  if (!v || v.length > MAX_URL_LENGTH || !/^https?:\/\//i.test(v)) return undefined
  return toSafeHttpUrl(v)
}

function toSafeHttpUrl(v: string): string | undefined {
  let url: URL
  try {
    url = new URL(v)
  }
  catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username || url.password) return undefined
  if (!url.hostname.includes('.') || url.hostname.endsWith('.')) return undefined
  return url.href
}

/**
 * URL d'image affichable dans un `src` : absolue, `https:` UNIQUEMENT (pas de
 * `http:`, pour éviter le contenu mixte et le pistage en clair), mêmes règles
 * que `sanitizeHttpUrl` pour le reste. `undefined` sinon.
 */
export function sanitizeImageUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  if (!/^https:\/\//i.test(v)) return undefined
  const safe = sanitizeHttpUrl(v)
  return safe?.startsWith('https:') ? safe : undefined
}

/**
 * Image d'un lieu à partir de ses tags OSM (`image`, `wikimedia_commons`).
 * N'accepte que du `https:` (voir `sanitizeImageUrl`).
 */
export function resolveImage(tags: Record<string, string | undefined>): string | undefined {
  const image = tags.image?.trim()
  if (image && /^https:\/\//i.test(image)) {
    // Lien vers la page commons wiki/File: → URL directe du fichier.
    const wikiFileMatch = image.match(/commons\.wikimedia\.org\/wiki\/File:(.+)/)
    if (wikiFileMatch) {
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(wikiFileMatch[1]!)}?width=600`
    }
    const safe = sanitizeImageUrl(image)
    if (safe) return safe
  }

  // Wikimedia Commons : seulement « File:xxx » (pas « Category: »).
  const commons = tags.wikimedia_commons?.trim()
  if (commons?.startsWith('File:')) {
    const file = commons.slice(5).replace(/ /g, '_')
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=600`
  }

  return undefined
}
