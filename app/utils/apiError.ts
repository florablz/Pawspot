/**
 * Extrait un message lisible d'une erreur levée par `$fetch` (FetchError de ofetch),
 * sans supposer sa forme : `data.message` du corps renvoyé par `createError`,
 * puis `statusMessage`, sinon le message de repli.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (typeof err !== 'object' || err === null) return fallback
  const { data, statusMessage } = err as { data?: unknown, statusMessage?: unknown }
  if (typeof data === 'object' && data !== null) {
    const message = (data as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  if (typeof statusMessage === 'string' && statusMessage) return statusMessage
  return fallback
}
