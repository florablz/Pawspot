export default defineEventHandler((event) => {
  const user = getUserFromSession(event)
  return { user }
})
