export default defineEventHandler((event) => {
  const token = getCookie(event, 'pawspot-session')
  if (token) {
    deleteSession(token)
  }
  clearSessionCookie(event)
  return { ok: true }
})
