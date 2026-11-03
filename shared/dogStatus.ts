/**
 * Statut « chien » d'un lieu et lecture des
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
  refused: { emoji: '🔴', label: 'Chiens refusés' },
  confirmed: { emoji: '🟢', label: 'Accepté, y compris à l\'intérieur' },
  confirmed_outside_only: { emoji: '🟢', label: 'Accepté en terrasse / extérieur' },
  osm_yes: { emoji: '🟢', label: 'Accepté' },
  osm_conditional: { emoji: '🟠', label: 'Sous conditions' },
  likely_terrace: { emoji: '🟡', label: 'Probablement accepté en terrasse — non confirmé' },
  unknown: { emoji: '⚪', label: 'Info non disponible : soyez le premier à nous le dire !' },
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
  /**
   * Phrase française courte et lisible décrivant la politique, si utile à afficher,
   * SANS syntaxe OSM (« Chiens interdits de 12 h à 14 h », « Chiens acceptés la nuit
   * seulement »). Le texte brut reste dans `conditional`.
   */
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
    ...describeOsmPolicy(policy, outsideOnly, base, rules),
  }
}

// ---------------------------------------------------------------------------
// Traduction en français des conditions OSM (`dog:conditional`)
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, string> = {
  jan: 'janvier', feb: 'février', mar: 'mars', apr: 'avril', may: 'mai', jun: 'juin',
  jul: 'juillet', aug: 'août', sep: 'septembre', oct: 'octobre', nov: 'novembre', dec: 'décembre',
}

const DAY_NAMES: Record<string, string> = {
  mo: 'lundi', tu: 'mardi', we: 'mercredi', th: 'jeudi', fr: 'vendredi', sa: 'samedi', su: 'dimanche',
}

/** « de » devant une voyelle → « d' » (« d'octobre », « d'avril »). */
function de(word: string): string {
  return /^[aeiouyàâéèêîôû]/i.test(word) ? `d'${word}` : `de ${word}`
}

/** « a, b et c ». */
function joinFr(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`
}

/** `HH:MM` → « 12 h », « 12 h 30 », « minuit ». `undefined` si invalide. */
function formatClock(hours: string, minutes: string): string | undefined {
  const h = Number(hours)
  const m = Number(minutes)
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 24 || m > 59 || (h === 24 && m > 0)) return undefined
  if ((h === 0 || h === 24) && m === 0) return 'minuit'
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

const SUN_EVENTS: Record<string, { from: string; to: string }> = {
  sunrise: { from: 'du lever du soleil', to: 'au lever du soleil' },
  sunset: { from: 'du coucher du soleil', to: 'au coucher du soleil' },
  dawn: { from: 'de l\'aube', to: 'à l\'aube' },
  dusk: { from: 'du crépuscule', to: 'au crépuscule' },
}

function formatTimeItem(item: string): string | undefined {
  const clock = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(item)
  if (clock) {
    const from = formatClock(clock[1]!, clock[2]!)
    const to = formatClock(clock[3]!, clock[4]!)
    if (!from || !to) return undefined
    return `${from === 'minuit' ? 'de minuit' : de(from)} à ${to}`
  }
  const sun = /^(sunrise|sunset|dawn|dusk)-(sunrise|sunset|dawn|dusk)$/.exec(item)
  if (sun && sun[1] !== sun[2]) {
    // « du coucher du soleil au lever du soleil » → « du coucher au lever du soleil ».
    const from = SUN_EVENTS[sun[1]!]!.from
    const to = SUN_EVENTS[sun[2]!]!.to
    if (from.endsWith(' du soleil') && to.endsWith(' du soleil')) return `${from.slice(0, -' du soleil'.length)} ${to}`
    return `${from} ${to}`
  }
  return undefined
}

function formatDayOfMonth(day: string): string | undefined {
  const d = Number(day)
  if (!Number.isInteger(d) || d < 1 || d > 31) return undefined
  return d === 1 ? '1er' : String(d)
}

/** `Jun`, `Jun-Sep`, `Jun 15-Sep 15`, `Jul 14`, `Jun 01-15`. */
function formatMonthItem(item: string): string | undefined {
  let m = /^([a-z]{3})$/.exec(item)
  if (m) {
    const name = MONTH_NAMES[m[1]!]
    return name && `en ${name}`
  }
  m = /^([a-z]{3})-([a-z]{3})$/.exec(item)
  if (m) {
    const a = MONTH_NAMES[m[1]!]
    const b = MONTH_NAMES[m[2]!]
    return a && b ? `${de(a)} à ${b}` : undefined
  }
  m = /^([a-z]{3}) (\d{1,2})$/.exec(item)
  if (m) {
    const name = MONTH_NAMES[m[1]!]
    const d = formatDayOfMonth(m[2]!)
    return name && d ? `le ${d} ${name}` : undefined
  }
  m = /^([a-z]{3}) (\d{1,2})-(?:([a-z]{3}) )?(\d{1,2})$/.exec(item)
  if (m) {
    const a = MONTH_NAMES[m[1]!]
    const b = m[3] ? MONTH_NAMES[m[3]] : a
    const d1 = formatDayOfMonth(m[2]!)
    const d2 = formatDayOfMonth(m[4]!)
    if (!a || !b || !d1 || !d2) return undefined
    return a === b ? `du ${d1} au ${d2} ${a}` : `du ${d1} ${a} au ${d2} ${b}`
  }
  return undefined
}

/** `Mo`, `Mo-Fr`, `PH`, `SH`. Renvoie des morceaux à joindre (« le samedi », « du lundi au vendredi »). */
function formatDayItem(item: string): string | undefined {
  if (item === 'ph') return 'les jours fériés'
  if (item === 'sh') return 'pendant les vacances scolaires'
  let m = /^([a-z]{2})$/.exec(item)
  if (m) {
    const name = DAY_NAMES[m[1]!]
    return name && `le ${name}`
  }
  m = /^([a-z]{2})-([a-z]{2})$/.exec(item)
  if (m) {
    const a = DAY_NAMES[m[1]!]
    const b = DAY_NAMES[m[2]!]
    return a && b ? `du ${a} au ${b}` : undefined
  }
  return undefined
}

const SEASONS: Record<string, string> = {
  night: 'la nuit',
  summer: 'en été',
  winter: 'en hiver',
  spring: 'au printemps',
  autumn: 'en automne',
}

/**
 * Condition OSM (sous-ensemble courant de la syntaxe `opening_hours`) → complément
 * français : « de 12 h à 14 h », « de juin à septembre, le samedi et le dimanche »,
 * « la nuit ». `undefined` si un morceau n'est pas reconnu (on n'invente rien).
 *
 * Reconnus : plages `HH:MM-HH:MM` (séparées par `,`), `sunset-sunrise` & co, mois
 * (`Jun`, `Jun-Sep`, `Jun 15-Sep 15`, `Jul 14`), jours (`Mo`, `Mo-Fr`, `Sa,Su`, `PH`,
 * `SH`), `night`, `summer` / `winter` / `spring` / `autumn`, et leurs combinaisons
 * séparées par des espaces (`Jun-Sep Sa,Su 10:00-18:00`).
 */
export function describeDogCondition(condition: string): string | undefined {
  const normalized = stripOuterParens(condition).toLowerCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return undefined
  // Mois suivi d'un jour (« jun 15 ») : on garde l'espace interne en les recollant.
  // « # » sert de marqueur temporaire (un « # » d'origine devient une espace, sans risque).
  const words = normalized.replace(/\b([a-z]{3}) (\d{1,2})(?![\d:])/g, '$1#$2').split(' ')
  const parts: string[] = []
  for (const word of words) {
    const items = word.replace(/#/g, ' ').split(',')
    const seasonOrNight = items.length === 1 ? SEASONS[items[0]!] : undefined
    if (seasonOrNight) {
      parts.push(seasonOrNight)
      continue
    }
    let formatted: (string | undefined)[] = items.map(formatTimeItem)
    if (formatted.some(v => v === undefined)) formatted = items.map(formatMonthItem)
    if (formatted.some(v => v === undefined)) formatted = items.map(formatDayItem)
    if (formatted.some(v => v === undefined)) return undefined
    parts.push(joinFr(formatted as string[]))
  }
  return parts.join(', ')
}

const VALUE_PHRASES: Record<Exclude<OsmDogValue, 'other'>, string> = {
  yes: 'Chiens acceptés',
  leashed: 'Chiens acceptés en laisse',
  unleashed: 'Chiens acceptés sans laisse',
  outside: 'Chiens acceptés à l\'extérieur',
  no: 'Chiens interdits',
}

/**
 * Une règle `dog:conditional` → phrase française (« Chiens interdits de 12 h à 14 h »).
 * `only` ajoute « seulement » (autorisation sur fond d'interdiction : « Chiens acceptés
 * la nuit seulement »). `undefined` si la valeur ou la condition n'est pas reconnue.
 */
export function describeDogConditionalRule(rule: Pick<DogConditionalRule, 'value' | 'condition'>, only = false): string | undefined {
  if (rule.value === 'other') return undefined
  const condition = describeDogCondition(rule.condition)
  if (!condition) return undefined
  const sentence = `${VALUE_PHRASES[rule.value]} ${condition}`
  return only && rule.value !== 'no' ? `${sentence} seulement` : sentence
}

/** Textes de repli quand une règle ne peut pas être traduite (jamais de syntaxe OSM). */
export const OSM_DETAIL_FALLBACKS = {
  night_only: 'Chiens acceptés la nuit seulement',
  /** Interdictions à certains moments (`dog=yes` + `no @ …`, ou `no @ …` seul). */
  restricted: 'Chiens interdits à certains moments',
  /** Autorisations à certains moments (`dog=no` + `yes @ …`, ou `yes @ …` seul). */
  conditional_yes: 'Chiens acceptés à certains moments seulement',
  outside: 'Uniquement à l\'extérieur',
} as const

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1)
}

function describeOsmPolicy(policy: OsmDogPolicyKind, outsideOnly: boolean, base: OsmDogValue | undefined, rules: readonly DogConditionalRule[]): { detail?: string } {
  const baseAllowed = isDogAllowedValue(base)
  // Règles utiles : autorisations / interdictions (les valeurs non reconnues sont ignorées).
  const useful = rules.filter(r => r.value !== 'other')
  // « seulement » : autorisation sur fond d'interdiction (`dog=no`) ou politique « nuit seulement ».
  const only = base === 'no' || policy === 'night_only'
  const translated = useful.map(r => describeDogConditionalRule(r, only))
  const allTranslated = useful.length > 0 && translated.every(Boolean)
  const sentences = (head?: string): string | undefined => {
    if (!allTranslated) return undefined
    const list = [...(head ? [head] : []), ...(translated as string[])]
    return list.map((t, i) => (i === 0 ? t : lowerFirst(t))).join(' ; ')
  }
  switch (policy) {
    case 'night_only':
      return { detail: sentences() ?? OSM_DETAIL_FALLBACKS.night_only }
    case 'restricted': {
      const head = outsideOnly ? OSM_DETAIL_FALLBACKS.outside : undefined
      const generic = base === 'no' ? OSM_DETAIL_FALLBACKS.conditional_yes : OSM_DETAIL_FALLBACKS.restricted
      return { detail: sentences(head) ?? (head ? `${head} ; ${lowerFirst(generic)}` : generic) }
    }
    case 'all_day':
      if (outsideOnly) return { detail: OSM_DETAIL_FALLBACKS.outside }
      // Autorisation conditionnelle sans `dog` (« yes @ (Oct-May) ») : à préciser.
      return useful.length && !baseAllowed ? { detail: sentences() ?? OSM_DETAIL_FALLBACKS.conditional_yes } : {}
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
  /** Détail lisible de la politique OSM (`OsmDogPolicy.detail`, ex. « Chiens acceptés de 19 h à 8 h seulement »). */
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

/** Texte de la source `terrace` (statut `likely_terrace`), affiché après « Source : ». */
export const TERRACE_SOURCE_TEXT = 'terrasse indiquée sur OpenStreetMap, aucune info sur les chiens'

/**
 * Texte de la source du statut, à afficher après « Source : » sous le badge (§3.5) :
 * « OpenStreetMap », « terrasse indiquée sur OpenStreetMap, aucune info sur les chiens »,
 * « 3 membres, dernier retour il y a 12 jours », « signalé par 3 membres ».
 * `undefined` pour `unknown`.
 */
export function describeDogStatusSource(info: DogStatusInfo, now: Date | number = Date.now()): string | undefined {
  switch (info.source) {
    case 'osm':
      return 'OpenStreetMap'
    case 'terrace':
      return TERRACE_SOURCE_TEXT
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
