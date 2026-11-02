import { clearSessionCookie, deleteSession, getSessionToken } from '../../utils/auth'

/** `POST /api/auth/logout` → `{ ok: true }` : supprime la session (s'il y en a une) et efface le cookie. */
export default defineEventHandler(async (event) => {
  const token = getSessionToken(event)
  if (token) {
    await deleteSession(token)
  }
  clearSessionCookie(event)
  return { ok: true }
})
