/**
 * Statut « chien » d'un lieu (CAHIER_DES_CHARGES.md §3.8 bis) et lecture des
 * tags OSM `dog` / `dog:conditional`. Fonctions pures, client et serveur.
 *
 * `access:conditional` n'est PAS lu ici : il décrit l'accès général au lieu
 * (ex. parc fermé la nuit), pas les chiens. Il reste disponible dans les tags
 * du lieu pour un affichage d'horaires.
 */

// ---------------------------------------------------------------------------
// Statuts
// ---------------------------------------------------------------------------

export const DOG_STATUSES = [
  'refused',
  'confirmed',
  'confirmed_outside_only',
  'osm_yes',
  'osm_conditional',
  'likely_terrace',
  'unknown',
] as const

export type DogStatus = (typeof DOG_STATUSES)[number]

/** Libellés d'affichage (tableau §3.8 bis). */
export const DOG_STATUS_LABELS: Record<DogStatus, { emoji: string; label: string }> = {
  refused: { emoji: '🔴', label: 'Chiens refusés (signalé par la communauté)' },
  confirmed: { emoji: '🟢', label: 'Accepté, y compris à l\'intérieur' },
  confirmed_outside_only: { emoji: '🟢', label: 'Accepté en terrasse / extérieur' },
  osm_yes: { emoji: '🟢', label: 'Accepté (source OpenStreetMap)' },
  osm_conditional: { emoji: '🟠', label: 'Sous conditions' },
  likely_terrace: { emoji: '🟡', label: 'Probablement accepté en terrasse — non confirmé' },
  unknown: { emoji: '⚪', label: 'Info non disponible — « Soyez le premier à nous dire ! »' },
}

/** Statuts gardés par le filtre « Chiens acceptés confirmés uniquement » (§3.3). */
export function isDogStatusConfirmed(status: DogStatus): boolean {
  return status === 'confirmed' || status === 'confirmed_outside_only'
}

// ---------------------------------------------------------------------------
// Lecture de `dog` et `dog:conditional`
// ---------------------------------------------------------------------------

/**
 * Valeur OSM normalisée. `designated` / `permissive` → `yes`.
 * `other` : valeur présente mais non reconnue (traitée comme absente).
 */
export type OsmDogValue = 'yes' | 'leashed' | 'unleashed' | 'outside' | 'no' | 'other'

/**
 * Résumé de la politique OSM (même vocabulaire que l'ancienne `parseDogPolicy`) :
 * - `all_day` : autorisé (éventuellement selon la saison, sans restriction connue) ;
 * - `night_only` : autorisé seulement sur des plages de nuit (voir `isNightCondition`) ;
 * - `restricted` : interdit à certains moments, ou autorisé seulement à certains moments (hors nuit) ;
 * - `no` : interdit, sans exception connue ;
 * - `unknown` : aucune information exploitable.
 */
export type OsmDogPolicyKind = 'all_day' | 'night_only' | 'restricted' | 'no' | 'unknown'

/** Plage horaire en minutes depuis minuit ; `end` > `start` (une plage qui passe minuit a `end` > 1440). */
export interface TimeRange {
  start: number
  end: number
}

export interface DogConditionalRule {
  /** Valeur avant le `@`. */
  value: OsmDogValue
  /** Condition après le `@`, sans parenthèses extérieures. */
  condition: string
  timeRanges: TimeRange[]
  /** Condition de nuit (voir `isNightCondition`). */
  night: boolean
}

export interface OsmDogPolicy {
  policy: OsmDogPolicyKind
  /** Valeur de `dog` normalisée, si présente. */
  value?: OsmDogValue
  /** Règles lues dans `dog:conditional` (vide si absent ou illisible). */
  rules: DogConditionalRule[]
  /** Texte brut `dog:conditional`, pour l'affichage du détail. */
  conditional?: string
  /** Accepté uniquement à l'extérieur (`dog=outside`). */
  outsideOnly: boolean
  /** Phrase française courte décrivant la politique, si utile à afficher. */
  detail?: string
}

const YES_LIKE = new Set<OsmDogValue>(['yes', 'leashed', 'unleashed', 'outside'])

/** Normalise une valeur de `dog` (ou d'une règle conditionnelle). */
export function normalizeDogValue(raw: string | null | undefined): OsmDogValue | undefined {
  const v = raw?.trim().toLowerCase()
  if (!v) return undefined
  switch (v) {
    case 'yes':
    case 'designated':
    case 'permissive':
      return 'yes'
    case 'leashed':
    case 'unleashed':
    case 'outside':
    case 'no':
      return v
    default:
      return 'other'
  }
}

export function isDogAllowedValue(v: OsmDogValue | undefined): boolean {
  return v !== undefined && YES_LIKE.has(v)
}

/** Découpe sur `sep` en ignorant les séparateurs entre parenthèses. */
function splitTopLevel(value: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === sep && depth === 0) {
      parts.push(current)
      current = ''
    }
    else {
      current += ch
    }
  }
  parts.push(current)
  return parts
}

function stripOuterParens(value: string): string {
  let v = value.trim()
  while (v.startsWith('(') && v.endsWith(')')) {
    // Ne retire que si la paire extérieure se correspond (« (a) et (b) » reste tel quel).
    let depth = 0
    let matched = true
    for (let i = 0; i < v.length; i++) {
      if (v[i] === '(') depth++
      else if (v[i] === ')') depth--
      if (depth === 0 && i < v.length - 1) {
        matched = false
        break
      }
    }
    if (!matched) break
    v = v.slice(1, -1).trim()
  }
  return v
}

const TIME_RANGE = /(?<![\d:])(\d{1,2}):([0-5]\d)\s*-\s*(\d{1,2}):([0-5]\d)(?![\d:])/g

/** Plages `HH:MM-HH:MM` d'une condition (analyse numérique, pas de recherche de sous-chaîne). */
export function parseTimeRanges(condition: string): TimeRange[] {
  const ranges: TimeRange[] = []
  for (const m of condition.matchAll(TIME_RANGE)) {
    const start = Number(m[1]) * 60 + Number(m[2])
    let end = Number(m[3]) * 60 + Number(m[4])
    if (start > 24 * 60 || end > 24 * 60) continue
    if (end <= start) end += 24 * 60 // passe minuit (22:00-06:00)
    ranges.push({ start, end })
  }
  return ranges
}

/** Fenêtre de nuit : 20:00 → 08:00 (en minutes, sur deux jours pour gérer minuit). */
const NIGHT_WINDOWS: TimeRange[] = [
  { start: 0, end: 8 * 60 },
  { start: 20 * 60, end: 32 * 60 },
  { start: 44 * 60, end: 48 * 60 },
]

function overlap(a: TimeRange, b: TimeRange): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

const NIGHT_WORDS = /\b(night|sunset|sunrise|dusk|dawn)\b/i

/**
 * Définition de « nuit » retenue :
 * - la condition contient `night`, `sunset`, `sunrise`, `dusk` ou `dawn` ; ou
 * - ses plages horaires, cumulées, tombent pour PLUS DE LA MOITIÉ de leur durée
 *   dans la fenêtre 20:00 → 08:00.
 * Exemples : 22:00-07:00, 19:30-06:00, 00:00-09:00, 19:00-09:00 → nuit ;
 * 09:00-21:00, 12:00-14:00, 06:00-10:00 (moitié pile) → pas nuit.
 */
export function isNightCondition(condition: string, ranges = parseTimeRanges(condition)): boolean {
  if (NIGHT_WORDS.test(condition)) return true
  if (!ranges.length) return false
  let total = 0
  let night = 0
  for (const r of ranges) {
    total += r.end - r.start
    for (const w of NIGHT_WINDOWS) night += overlap(r, w)
  }
  return night * 2 > total
}

/**
 * Lit `dog:conditional` : règles `valeur @ condition` séparées par `;`
 * (hors parenthèses). Les règles sans `@` ou sans valeur sont ignorées.
 */
export function parseDogConditional(raw: string | null | undefined): DogConditionalRule[] {
  if (!raw?.trim()) return []
  const rules: DogConditionalRule[] = []
  for (const part of splitTopLevel(raw, ';')) {
    const at = part.indexOf('@')
    if (at < 0) continue
    const value = normalizeDogValue(part.slice(0, at))
    const condition = stripOuterParens(part.slice(at + 1))
    if (!value || !condition) continue
    const timeRanges = parseTimeRanges(condition)
    rules.push({ value, condition, timeRanges, night: isNightCondition(condition, timeRanges) })
  }
  return rules
}

/**
 * Politique « chien » d'après les tags OSM (`dog`, `dog:conditional` seulement).
 *
 * Règles (une règle conditionnelle s'applique « par-dessus » la valeur de base, comme dans OSM) :
 * | `dog`            | `dog:conditional`                        | résultat      |
 * |------------------|------------------------------------------|---------------|
 * | absent           | absent                                   | `unknown`     |
 * | yes/leashed/…    | absent ou seulement des autorisations    | `all_day`     |
 * | yes/leashed/…    | au moins une interdiction (`no @ …`)     | `restricted`  |
 * | no               | absent ou seulement des interdictions    | `no`          |
 * | no ou absent     | autorisations toutes « de nuit »         | `night_only`  |
 * | no               | autorisation hors nuit (`yes @ Oct-May`) | `restricted`  |
 * | absent           | autorisation hors nuit                   | `all_day`     |
 * | absent           | seulement des interdictions              | `restricted`  |
 */
export function parseOsmDogPolicy(tags: Record<string, string | undefined>): OsmDogPolicy {
  const value = normalizeDogValue(tags.dog)
  const base = value === 'other' ? undefined : value
  const conditional = tags['dog:conditional']?.trim() || undefined
  const rules = parseDogConditional(conditional)
  const allowRules = rules.filter(r => isDogAllowedValue(r.value))
  const denyRules = rules.filter(r => r.value === 'no')
  const outsideOnly = base === 'outside'

  let policy: OsmDogPolicyKind
  if (!allowRules.length && !denyRules.length) {
    policy = base === 'no' ? 'no' : isDogAllowedValue(base) ? 'all_day' : 'unknown'
  }
  else if (isDogAllowedValue(base)) {
    policy = denyRules.length ? 'restricted' : 'all_day'
  }
  else if (allowRules.length) {
    if (allowRules.every(r => r.night)) policy = 'night_only'
    else policy = base === 'no' ? 'restricted' : 'all_day'
  }
  else {
    policy = base === 'no' ? 'no' : 'restricted'
  }

  return {
    policy,
    ...(value ? { value } : {}),
    rules,
    ...(conditional ? { conditional } : {}),
    outsideOnly,
    ...describeOsmPolicy(policy, outsideOnly, isDogAllowedValue(base), conditional),
  }
}

function describeOsmPolicy(policy: OsmDogPolicyKind, outsideOnly: boolean, baseAllowed: boolean, conditional?: string): { detail?: string } {
  const suffix = conditional ? ` (${conditional})` : ''
  switch (policy) {
    case 'night_only':
      return { detail: `Uniquement la nuit${suffix}` }
    case 'restricted':
      return { detail: `Selon les horaires ou la saison${suffix}` }
    case 'all_day':
      if (outsideOnly) return { detail: 'Uniquement à l\'extérieur' }
      // Autorisation conditionnelle sans `dog` (« yes @ (Oct-May) ») : à préciser.
      return conditional && !baseAllowed ? { detail: `Selon les horaires ou la saison${suffix}` } : {}
    default:
      return {}
  }
}

/**
 * Compatibilité avec l'ancienne `parseDogPolicy` de `server/utils/dogPolicy.ts`
 * (même forme de retour). `source` : valeur de `dog` en minuscules, sinon le
 * texte de `dog:conditional`.
 */
export function parseDogPolicy(tags: Record<string, string | undefined>): { policy: OsmDogPolicyKind; source: string | undefined } {
  const p = parseOsmDogPolicy(tags)
  if (p.policy === 'unknown') return { policy: 'unknown', source: undefined }
  const dog = tags.dog?.trim().toLowerCase()
  return { policy: p.policy, source: dog || p.conditional }
}

// ---------------------------------------------------------------------------
// Alertes (§3.10)
// ---------------------------------------------------------------------------

/** Une alerte n'est plus affichée (ni comptée) après 90 jours. */
export const ALERT_VISIBILITY_DAYS = 90
/** Nombre d'utilisateurs distincts à partir duquel une alerte `closed` / `dogs_not_allowed` est confirmée. */
export const ALERT_CONFIRMATION_USERS = 3

export interface AlertSignal {
  userId: number
  type: string
  createdAt: Date | number | string
}

export interface AlertFlags {
  /** ≥ 3 utilisateurs distincts ont signalé `closed` dans les 90 derniers jours. */
  closed: boolean
  /** ≥ 3 utilisateurs distincts ont signalé `dogs_not_allowed` dans les 90 derniers jours. */
  dogsNotAllowed: boolean
  /** Nombre d'utilisateurs distincts par type (alertes de moins de 90 jours). */
  distinctUsers: Record<string, number>
}

const DAY_MS = 24 * 60 * 60 * 1000

function toMs(d: Date | number | string): number {
  return d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d)
}

/** Seuils des alertes (§3.10). Les alertes datées dans le futur comptent comme récentes. */
export function computeAlertFlags(alerts: readonly AlertSignal[], now: Date | number = Date.now()): AlertFlags {
  const nowMs = toMs(now)
  const minMs = nowMs - ALERT_VISIBILITY_DAYS * DAY_MS
  const users = new Map<string, Set<number>>()
  for (const a of alerts) {
    const t = toMs(a.createdAt)
    if (!Number.isFinite(t) || t < minMs) continue
    let set = users.get(a.type)
    if (!set) users.set(a.type, (set = new Set()))
    set.add(a.userId)
  }
  const distinctUsers = Object.fromEntries([...users].map(([type, set]) => [type, set.size]))
  return {
    closed: (distinctUsers.closed ?? 0) >= ALERT_CONFIRMATION_USERS,
    dogsNotAllowed: (distinctUsers.dogs_not_allowed ?? 0) >= ALERT_CONFIRMATION_USERS,
    distinctUsers,
  }
}

// ---------------------------------------------------------------------------
// Calcul du statut (§3.8 bis)
// ---------------------------------------------------------------------------

/** Au-delà de 18 mois (548 jours), un retour est « ancien ». */
export const DOG_REPORT_RECENT_DAYS = 548
/** Poids d'un retour ancien dans la majorité Oui / Non (un retour récent pèse 1). */
export const OLD_DOG_REPORT_WEIGHT = 0.25
/** Nombre minimal de retours RÉCENTS pour afficher `refused`. */
export const MIN_RECENT_REPORTS_FOR_REFUSED = 2

export type DogReportLocation = 'inside' | 'outside' | 'both'

/** Retour « mon chien a-t-il été accepté ? » (table `dog_reports`, Phase 3). */
export interface DogReportInput {
  userId: number
  accepted: boolean
  location?: DogReportLocation | null
  /** Date de dernière mise à jour du retour (c'est elle qui compte pour l'ancienneté). */
  updatedAt: Date | number | string
}

export interface DogStatusInput {
  /** Tags OSM du lieu (seuls `dog`, `dog:conditional` et `outdoor_seating` sont lus). */
  tags?: Record<string, string | undefined> | null
  /** Terrasse ; par défaut `tags.outdoor_seating === 'yes'`. */
  hasTerrace?: boolean
  reports?: readonly DogReportInput[]
  alerts?: readonly AlertSignal[]
  now?: Date | number
}

export type DogStatusSourceKind = 'community' | 'alerts' | 'osm' | 'terrace' | 'none'

/** Ce qu'il faut pour afficher la source du statut ; stocké en JSON dans `places.dog_status_info`. */
export interface DogStatusInfo {
  source: DogStatusSourceKind
  reports: {
    /** Retours pris en compte (un par utilisateur, le plus récent). */
    total: number
    accepted: number
    refused: number
    /** Parmi les « Oui » : intérieur ou les deux. */
    inside: number
    /** Retours de moins de 18 mois. */
    recent: number
  }
  /** Date ISO du retour le plus récent. */
  lastReportAt?: string
  /** Utilisateurs distincts ayant signalé `dogs_not_allowed` (si ≥ 1). */
  dogsNotAllowedAlerts?: number
  /** Détail de la politique OSM (« Uniquement la nuit (yes @ (19:00-08:00)) »). */
  osmDetail?: string
}

export interface DogStatusResult {
  status: DogStatus
  info: DogStatusInfo
}

/**
 * Statut chien affiché, du plus fort au plus faible (§3.8 bis) :
 *
 * 1. `refused` si alerte `dogs_not_allowed` confirmée (≥ 3 utilisateurs distincts, < 90 jours),
 *    ou si, parmi les retours RÉCENTS (≤ 18 mois), il y en a au moins 2 et strictement plus de
 *    « Non » que de « Oui ». Les retours anciens ne comptent pas pour `refused`.
 * 2. Majorité pondérée de « Oui » : poids 1 pour un retour récent, 0,25 pour un retour ancien ;
 *    il faut poidsOui > poidsNon (strict).
 *    - `confirmed` si au moins un « Oui » dit « intérieur » ou « les deux » ;
 *    - sinon `confirmed_outside_only` (y compris « Oui » sans lieu précisé : on ne
 *      promet pas l'intérieur).
 * 3. Sinon (aucun retour, égalité, ou « Non » minoritaires/insuffisants), on retombe sur OSM ;
 *    `info.reports` garde le décompte pour l'affichage (« 1 ❌ ») :
 *    - `osm_yes` : `dog=yes|leashed|unleashed|designated|permissive` sans restriction ;
 *    - `osm_conditional` : `dog=outside`, nuit seulement, restrictions horaires/saisonnières,
 *      ou `dog=no` assoupli par un `dog:conditional` ;
 *    - `likely_terrace` : pas d'info chien exploitable mais `outdoor_seating=yes` ;
 *    - `unknown` : le reste (y compris `dog=no` sans retour : de tels lieux sont exclus
 *      du cache, voir `isPlaceEligible`).
 */
export function computeDogStatus(input: DogStatusInput): DogStatusResult {
  const nowMs = toMs(input.now ?? Date.now())
  const tags = input.tags ?? {}

  // Un retour par utilisateur : le plus récent.
  const byUser = new Map<number, DogReportInput>()
  for (const r of input.reports ?? []) {
    const prev = byUser.get(r.userId)
    if (!prev || toMs(r.updatedAt) > toMs(prev.updatedAt)) byUser.set(r.userId, r)
  }
  const reports = [...byUser.values()].filter(r => Number.isFinite(toMs(r.updatedAt)))
  const recentMin = nowMs - DOG_REPORT_RECENT_DAYS * DAY_MS

  let yesWeight = 0
  let noWeight = 0
  let recentYes = 0
  let recentNo = 0
  let lastMs = -Infinity
  const summary = { total: reports.length, accepted: 0, refused: 0, inside: 0, recent: 0 }
  for (const r of reports) {
    const t = toMs(r.updatedAt)
    const recent = t >= recentMin
    const w = recent ? 1 : OLD_DOG_REPORT_WEIGHT
    lastMs = Math.max(lastMs, t)
    if (recent) summary.recent++
    if (r.accepted) {
      summary.accepted++
      yesWeight += w
      if (recent) recentYes++
      if (r.location === 'inside' || r.location === 'both') summary.inside++
    }
    else {
      summary.refused++
      noWeight += w
      if (recent) recentNo++
    }
  }

  const flags = computeAlertFlags(input.alerts ?? [], nowMs)
  const dogsNotAllowed = flags.distinctUsers.dogs_not_allowed ?? 0

  const info: DogStatusInfo = {
    source: 'none',
    reports: summary,
    ...(reports.length ? { lastReportAt: new Date(lastMs).toISOString() } : {}),
    ...(dogsNotAllowed ? { dogsNotAllowedAlerts: dogsNotAllowed } : {}),
  }

  if (flags.dogsNotAllowed) {
    return { status: 'refused', info: { ...info, source: 'alerts' } }
  }
  if (recentYes + recentNo >= MIN_RECENT_REPORTS_FOR_REFUSED && recentNo > recentYes) {
    return { status: 'refused', info: { ...info, source: 'community' } }
  }
  if (reports.length && yesWeight > noWeight) {
    return {
      status: summary.inside > 0 ? 'confirmed' : 'confirmed_outside_only',
      info: { ...info, source: 'community' },
    }
  }

  const osm = parseOsmDogPolicy(tags)
  const osmDetail = osm.detail ? { osmDetail: osm.detail } : {}
  if (osm.policy === 'all_day' && !osm.outsideOnly && isDogAllowedValue(osm.value)) {
    return { status: 'osm_yes', info: { ...info, source: 'osm' } }
  }
  if (osm.policy === 'all_day' || osm.policy === 'night_only' || osm.policy === 'restricted') {
    // Autorisation conditionnelle sans `dog` (« yes @ (Oct-May) ») ou `dog=outside` :
    // c'est sous condition, pas un oui franc.
    return { status: 'osm_conditional', info: { ...info, ...osmDetail, source: 'osm' } }
  }
  const hasTerrace = input.hasTerrace ?? tags.outdoor_seating?.trim().toLowerCase() === 'yes'
  if (osm.policy === 'unknown' && hasTerrace) {
    return { status: 'likely_terrace', info: { ...info, source: 'terrace' } }
  }
  return { status: 'unknown', info }
}

/**
 * Texte de la source du statut, à afficher sous le badge (§3.5) :
 * « OpenStreetMap », « terrasse », « 3 membres, dernier retour il y a 12 jours »,
 * « signalé par 3 membres ». `undefined` pour `unknown`.
 */
export function describeDogStatusSource(info: DogStatusInfo, now: Date | number = Date.now()): string | undefined {
  switch (info.source) {
    case 'osm':
      return 'OpenStreetMap'
    case 'terrace':
      return 'terrasse'
    case 'alerts': {
      const n = info.dogsNotAllowedAlerts ?? 0
      return `signalé par ${n} membre${n > 1 ? 's' : ''}`
    }
    case 'community': {
      const n = info.reports.total
      const members = `${n} membre${n > 1 ? 's' : ''}`
      if (!info.lastReportAt) return members
      const days = Math.max(0, Math.floor((toMs(now) - Date.parse(info.lastReportAt)) / DAY_MS))
      const ago = days === 0 ? 'aujourd\'hui' : days === 1 ? 'il y a 1 jour' : `il y a ${days} jours`
      return `${members}, dernier retour ${ago}`
    }
    default:
      return undefined
  }
}
