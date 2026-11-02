/** Date relative courte en français (« à l'instant », « il y a 3 h », « il y a 2 j », puis la date). */
export function formatTimeAgo(date: string | Date, now: number = Date.now()): string {
  const d = new Date(date)
  const mins = Math.floor((now - d.getTime()) / 60000)
  if (mins < 1) return 'à l\'instant'
  if (mins < 60) return `il y a ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `il y a ${days} j`
  return d.toLocaleDateString('fr-FR')
}
