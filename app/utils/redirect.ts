import type { LocationQueryValue } from 'vue-router'

/** Pages d'où l'on ne revient pas après connexion (on garderait sinon une boucle). */
export const AUTH_PATHS: readonly string[] = ['/login', '/register']

/**
 * Chemin de retour après connexion / inscription, lu dans `?redirect=`.
 * Accepté seulement si c'est un chemin interne : commence par `/`, mais pas par
 * `//` ni `/\` (URL externe pour le navigateur), sans caractère de contrôle.
 * Sinon : `/`.
 */
export function safeRedirect(value: LocationQueryValue | LocationQueryValue[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/'
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(raw)) return '/'
  const path = raw.split(/[?#]/)[0]
  if (AUTH_PATHS.includes(path ?? '')) return '/'
  return raw
}
