export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'pawspot-session')
  if (token) {
    await deleteSession(token)
  }
  clearSessionCookie(event)
  return { ok: true }
})
