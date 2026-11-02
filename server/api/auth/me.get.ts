import { getUserFromSession } from '../../utils/auth'

/** `GET /api/auth/me` → `{ user }` : l'utilisateur connecté, ou `null`. */
export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)
  return { user }
})
