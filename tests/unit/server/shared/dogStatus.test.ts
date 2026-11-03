import { describe, expect, it } from 'vitest'
import {
  computeAlertFlags,
  computeDogStatus,
  describeDogCondition,
  describeDogConditionalRule,
  describeDogStatusSource,
  DOG_STATUS_LABELS,
  isDogStatusConfirmed,
  isNightCondition,
  OSM_DETAIL_FALLBACKS,
  parseDogConditional,
  parseDogPolicy,
  parseOsmDogPolicy,
  parseTimeRanges,
  TERRACE_SOURCE_TEXT,
} from '../../../../shared/dogStatus'
import type { AlertSignal, DogReportInput, DogStatusInfo } from '../../../../shared/dogStatus'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-02T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)

/** Retour récent (10 jours) ou ancien (2 ans) d'un utilisateur. */
function report(userId: number, accepted: boolean, opts: { old?: boolean; location?: DogReportInput['location']; days?: number } = {}): DogReportInput {
  return {
    userId,
    accepted,
    location: opts.location ?? (accepted ? 'inside' : null),
    updatedAt: daysAgo(opts.days ?? (opts.old ? 730 : 10)),
  }
}

function alert(userId: number, type = 'dogs_not_allowed', days = 5): AlertSignal {
  return { userId, type, createdAt: daysAgo(days) }
}

const status = (input: Parameters<typeof computeDogStatus>[0]) => computeDogStatus({ now: NOW, ...input }).status

describe('computeDogStatus — tableau §3.8 bis', () => {
  it('refused : majorité de « Non » parmi au moins 2 retours récents', () => {
    expect(status({ tags: { dog: 'yes' }, reports: [report(1, false), report(2, false), report(3, true)] })).toBe('refused')
  })

  it('refused : alerte dogs_not_allowed confirmée par 3 utilisateurs distincts', () => {
    const result = computeDogStatus({ now: NOW, tags: { dog: 'yes' }, alerts: [alert(1), alert(2), alert(3)] })
    expect(result.status).toBe('refused')
    expect(result.info.source).toBe('alerts')
    expect(result.info.dogsNotAllowedAlerts).toBe(3)
  })

  it('refused par les alertes même avec une majorité de « Oui »', () => {
    expect(status({ reports: [report(1, true), report(2, true)], alerts: [alert(1), alert(2), alert(3)] })).toBe('refused')
  })

  it('confirmed : majorité de « Oui » avec au moins un « intérieur »', () => {
    expect(status({ reports: [report(1, true, { location: 'outside' }), report(2, true, { location: 'inside' })] })).toBe('confirmed')
  })

  it('confirmed : « les deux » compte comme intérieur', () => {
    expect(status({ reports: [report(1, true, { location: 'both' })] })).toBe('confirmed')
  })

  it('confirmed_outside_only : majorité de « Oui », uniquement « extérieur »', () => {
    expect(status({ reports: [report(1, true, { location: 'outside' }), report(2, true, { location: 'outside' })] })).toBe('confirmed_outside_only')
  })

  it.each(['yes', 'leashed', 'unleashed', 'designated', 'permissive', 'YES'])('osm_yes : aucun retour, dog=%s', (dog) => {
    expect(status({ tags: { dog } })).toBe('osm_yes')
  })

  it.each([
    [{ 'dog:conditional': 'yes @ night' }],
    [{ 'dog': 'no', 'dog:conditional': 'yes @ (19:00-08:00)' }],
    [{ 'dog:conditional': 'no @ (Jun-Sep)' }],
    [{ 'dog': 'yes', 'dog:conditional': 'no @ (Jul-Aug)' }],
  ])('osm_conditional : aucun retour, %o', (tags) => {
    expect(status({ tags })).toBe('osm_conditional')
  })

  it('osm_conditional porte le détail de la condition', () => {
    const { info } = computeDogStatus({ now: NOW, tags: { 'dog:conditional': 'yes @ (19:00-08:00)' } })
    expect(info.source).toBe('osm')
    expect(info.osmDetail).toBe('Chiens acceptés de 19 h à 8 h seulement')
  })

  it('likely_terrace : aucun retour ni tag chien, mais outdoor_seating=yes', () => {
    expect(status({ tags: { amenity: 'cafe', outdoor_seating: 'yes' } })).toBe('likely_terrace')
    expect(status({ tags: { amenity: 'cafe' }, hasTerrace: true })).toBe('likely_terrace')
  })

  it('unknown : rien de tout ça', () => {
    const result = computeDogStatus({ now: NOW, tags: { leisure: 'park' } })
    expect(result.status).toBe('unknown')
    expect(result.info.source).toBe('none')
    expect(status({})).toBe('unknown')
    expect(status({ tags: null })).toBe('unknown')
  })

  it('unknown pour dog=no sans retour (lieu exclu du cache de toute façon)', () => {
    expect(status({ tags: { dog: 'no', outdoor_seating: 'yes' } })).toBe('unknown')
  })

  it('les retours prennent le dessus sur une terrasse', () => {
    expect(status({ tags: { outdoor_seating: 'yes' }, reports: [report(1, true, { location: 'inside' })] })).toBe('confirmed')
  })
})

describe('computeDogStatus — cas limites (retours périmés, égalités)', () => {
  const tags = { dog: 'yes' }

  it('1 « Non » récent seul → on retombe sur OSM', () => {
    const result = computeDogStatus({ now: NOW, tags, reports: [report(1, false)] })
    expect(result.status).toBe('osm_yes')
    expect(result.info.reports.refused).toBe(1)
  })

  it('2 « Non » récents → refused', () => {
    expect(status({ tags, reports: [report(1, false), report(2, false)] })).toBe('refused')
  })

  it('égalité 1 « Oui » / 1 « Non » récents → OSM', () => {
    expect(status({ tags, reports: [report(1, true), report(2, false)] })).toBe('osm_yes')
    expect(status({ reports: [report(1, true), report(2, false)] })).toBe('unknown')
  })

  it('2 « Non » anciens (> 18 mois) → OSM', () => {
    expect(status({ tags, reports: [report(1, false, { old: true }), report(2, false, { old: true })] })).toBe('osm_yes')
  })

  it('1 « Non » récent contre 3 « Oui » anciens → OSM (0,75 < 1)', () => {
    const reports = [report(1, false), report(2, true, { old: true }), report(3, true, { old: true }), report(4, true, { old: true })]
    expect(status({ tags: {}, reports })).toBe('unknown')
    expect(status({ tags, reports })).toBe('osm_yes')
  })

  it('1 « Non » récent contre 5 « Oui » anciens → confirmé (1,25 > 1)', () => {
    const reports = [report(1, false), ...[2, 3, 4, 5, 6].map(u => report(u, true, { old: true, location: 'inside' }))]
    expect(status({ reports })).toBe('confirmed')
  })

  it('même utilisateur deux fois → seul le dernier retour compte', () => {
    const reports = [report(1, false, { days: 3 }), report(1, true, { days: 30, location: 'inside' }), report(2, false, { days: 4 })]
    // utilisateur 1 : dernier = « Non » (3 j) ; utilisateur 2 : « Non » → 2 « Non » récents
    const result = computeDogStatus({ now: NOW, reports })
    expect(result.status).toBe('refused')
    expect(result.info.reports.total).toBe(2)

    const changedMind = [report(1, false, { days: 30 }), report(1, true, { days: 2, location: 'inside' })]
    expect(status({ reports: changedMind })).toBe('confirmed')
  })

  it('« Oui » sans lieu précisé → confirmed_outside_only (on ne promet pas l\'intérieur)', () => {
    expect(status({ reports: [{ userId: 1, accepted: true, updatedAt: daysAgo(1) }] })).toBe('confirmed_outside_only')
    expect(status({ reports: [{ userId: 1, accepted: true, location: null, updatedAt: daysAgo(1) }] })).toBe('confirmed_outside_only')
  })

  it('3 alertes d\'un même utilisateur → pas refused', () => {
    expect(status({ tags, alerts: [alert(1, 'dogs_not_allowed', 1), alert(1, 'dogs_not_allowed', 2), alert(1, 'dogs_not_allowed', 3)] })).toBe('osm_yes')
  })

  it('3 alertes de plus de 90 jours → pas refused', () => {
    expect(status({ tags, alerts: [alert(1, 'dogs_not_allowed', 91), alert(2, 'dogs_not_allowed', 120), alert(3, 'dogs_not_allowed', 365)] })).toBe('osm_yes')
  })

  it('3 alertes « closed » ne rendent pas le lieu refused', () => {
    expect(status({ tags, alerts: [alert(1, 'closed'), alert(2, 'closed'), alert(3, 'closed')] })).toBe('osm_yes')
  })

  it('dog=outside → osm_conditional (« Uniquement à l\'extérieur »)', () => {
    const result = computeDogStatus({ now: NOW, tags: { dog: 'outside' } })
    expect(result.status).toBe('osm_conditional')
    expect(result.info.osmDetail).toBe('Uniquement à l\'extérieur')
  })

  it('terrasse + dog=yes → osm_yes', () => {
    expect(status({ tags: { dog: 'yes', outdoor_seating: 'yes' } })).toBe('osm_yes')
  })

  it('remplit le résumé des retours et la date du dernier', () => {
    const reports = [report(1, true, { location: 'inside', days: 2 }), report(2, true, { location: 'outside', old: true }), report(3, false, { days: 40 })]
    const { info } = computeDogStatus({ now: NOW, reports })
    expect(info.reports).toEqual({ total: 3, accepted: 2, refused: 1, inside: 1, recent: 2 })
    expect(info.lastReportAt).toBe(daysAgo(2).toISOString())
  })

  it('accepte des dates en chaîne ISO ou en millisecondes', () => {
    const reports: DogReportInput[] = [
      { userId: 1, accepted: false, updatedAt: daysAgo(1).toISOString() },
      { userId: 2, accepted: false, updatedAt: daysAgo(1).getTime() },
    ]
    expect(status({ reports })).toBe('refused')
  })
})

describe('computeDogStatus — dog:conditional et anciens bugs de parseDogPolicy', () => {
  it.each([
    'no @ (11:00-14:00)',
    'yes @ (09:00-21:00)',
    'yes @ (Mo-Su 12:00-14:00)',
  ])('« %s » n\'est pas pris pour une condition de nuit', (value) => {
    expect(parseOsmDogPolicy({ 'dog:conditional': value }).policy).not.toBe('night_only')
  })

  it('« no @ (11:00-14:00) » → restricted', () => {
    expect(parseOsmDogPolicy({ 'dog:conditional': 'no @ (11:00-14:00)' }).policy).toBe('restricted')
  })

  it('« yes @ (09:00-21:00) » → all_day, affiché sous conditions', () => {
    expect(parseOsmDogPolicy({ 'dog:conditional': 'yes @ (09:00-21:00)' }).policy).toBe('all_day')
    expect(status({ tags: { 'dog:conditional': 'yes @ (09:00-21:00)' } })).toBe('osm_conditional')
  })

  it.each(['yes @ (Nov-Mar)', 'yes @ november', 'yes @ (Oct-May)'])('« %s » : « Nov » / « november » ne sont plus lus comme « no »', (value) => {
    expect(parseOsmDogPolicy({ 'dog:conditional': value }).policy).toBe('all_day')
  })

  it('access:conditional est ignoré pour le statut chien', () => {
    expect(parseOsmDogPolicy({ 'access:conditional': 'yes @ Night' }).policy).toBe('unknown')
    expect(parseOsmDogPolicy({ 'access:conditional': 'no @ (Jul-Aug)' }).policy).toBe('unknown')
    expect(status({ tags: { 'access:conditional': 'no @ (Jul-Aug)' } })).toBe('unknown')
    expect(status({ tags: { 'dog': 'yes', 'access:conditional': 'no @ (20:00-08:00)' } })).toBe('osm_yes')
  })

  it('dog:conditional s\'applique par-dessus dog', () => {
    expect(parseOsmDogPolicy({ 'dog': 'yes', 'dog:conditional': 'no @ (Jun-Sep)' }).policy).toBe('restricted')
    expect(parseOsmDogPolicy({ 'dog': 'no', 'dog:conditional': 'yes @ night' }).policy).toBe('night_only')
    expect(parseOsmDogPolicy({ 'dog': 'no', 'dog:conditional': 'yes @ (Oct-May)' }).policy).toBe('restricted')
    expect(parseOsmDogPolicy({ 'dog': 'no', 'dog:conditional': 'no @ (Jun-Sep)' }).policy).toBe('no')
    expect(parseOsmDogPolicy({ 'dog': 'yes', 'dog:conditional': 'leashed @ (Jun-Sep)' }).policy).toBe('all_day')
  })

  it('dog=no seul → no ; aucun tag → unknown', () => {
    expect(parseOsmDogPolicy({ dog: 'NO' }).policy).toBe('no')
    expect(parseOsmDogPolicy({}).policy).toBe('unknown')
    expect(parseOsmDogPolicy({ 'dog:conditional': '' }).policy).toBe('unknown')
  })

  it('une valeur dog non reconnue est traitée comme absente', () => {
    expect(parseOsmDogPolicy({ dog: 'peut-être' }).policy).toBe('unknown')
    expect(status({ tags: { dog: 'peut-être', outdoor_seating: 'yes' } })).toBe('likely_terrace')
  })

  it('parseDogPolicy garde la forme de l\'ancienne fonction', () => {
    expect(parseDogPolicy({ dog: 'Yes' })).toEqual({ policy: 'all_day', source: 'yes' })
    expect(parseDogPolicy({ 'dog:conditional': 'yes @ night' })).toEqual({ policy: 'night_only', source: 'yes @ night' })
    expect(parseDogPolicy({})).toEqual({ policy: 'unknown', source: undefined })
  })
})

describe('détection de la nuit', () => {
  it.each(['06:00-10:00', '09:00-21:00', '12:00-14:00'])('%s n\'est pas la nuit', (range) => {
    expect(isNightCondition(range)).toBe(false)
  })

  it.each(['18:00-23:00', '00:00-09:00', '22:00-07:00', '19:30-06:00', '19:00-09:00', 'sunset-sunrise', 'Night'])('%s est la nuit', (range) => {
    expect(isNightCondition(range)).toBe(true)
  })

  it('lit les plages horaires numériquement, y compris celles qui passent minuit', () => {
    expect(parseTimeRanges('Mo-Fr 11:00-14:00')).toEqual([{ start: 660, end: 840 }])
    expect(parseTimeRanges('22:00-06:00')).toEqual([{ start: 1320, end: 1800 }])
    expect(parseTimeRanges('Nov-Mar')).toEqual([])
  })

  it('découpe dog:conditional sur « ; » hors parenthèses', () => {
    const rules = parseDogConditional('yes @ (Mo-Fr 19:00-08:00; Sa,Su); no @ (Jun-Sep)')
    expect(rules.map(r => [r.value, r.condition])).toEqual([
      ['yes', 'Mo-Fr 19:00-08:00; Sa,Su'],
      ['no', 'Jun-Sep'],
    ])
    expect(parseDogConditional('pas de règle')).toEqual([])
  })
})

describe('computeAlertFlags', () => {
  it('confirme closed et dogs_not_allowed à partir de 3 utilisateurs distincts', () => {
    const flags = computeAlertFlags([alert(1, 'closed'), alert(2, 'closed'), alert(3, 'closed'), alert(1), alert(2)], NOW)
    expect(flags.closed).toBe(true)
    expect(flags.dogsNotAllowed).toBe(false)
    expect(flags.distinctUsers).toEqual({ closed: 3, dogs_not_allowed: 2 })
  })

  it('compte chaque utilisateur une seule fois', () => {
    const flags = computeAlertFlags([alert(1), alert(1), alert(1), alert(2)], NOW)
    expect(flags.dogsNotAllowed).toBe(false)
    expect(flags.distinctUsers.dogs_not_allowed).toBe(2)
  })

  it('ignore les alertes de plus de 90 jours et les dates illisibles', () => {
    const flags = computeAlertFlags([
      alert(1, 'dogs_not_allowed', 89),
      alert(2, 'dogs_not_allowed', 91),
      { userId: 3, type: 'dogs_not_allowed', createdAt: 'pas une date' },
    ], NOW)
    expect(flags.distinctUsers.dogs_not_allowed).toBe(1)
  })

  it('aucune alerte → rien de confirmé', () => {
    expect(computeAlertFlags([], NOW)).toEqual({ closed: false, dogsNotAllowed: false, distinctUsers: {} })
  })
})

describe('describeDogStatusSource', () => {
  const reports = { total: 3, accepted: 3, refused: 0, inside: 1, recent: 3 }

  it('OpenStreetMap / terrasse / rien', () => {
    expect(describeDogStatusSource({ source: 'osm', reports: { ...reports, total: 0 } })).toBe('OpenStreetMap')
    expect(describeDogStatusSource({ source: 'terrace', reports })).toBe(TERRACE_SOURCE_TEXT)
    expect(TERRACE_SOURCE_TEXT).toBe('terrasse indiquée sur OpenStreetMap, aucune info sur les chiens')
    expect(describeDogStatusSource({ source: 'none', reports })).toBeUndefined()
  })

  it('retours de la communauté : membres et ancienneté du dernier retour', () => {
    const info = (days: number, total = 3): DogStatusInfo => ({ source: 'community', reports: { ...reports, total }, lastReportAt: daysAgo(days).toISOString() })
    expect(describeDogStatusSource(info(12), NOW)).toBe('3 membres, dernier retour il y a 12 jours')
    expect(describeDogStatusSource(info(1, 1), NOW)).toBe('1 membre, dernier retour il y a 1 jour')
    expect(describeDogStatusSource(info(0), NOW)).toBe('3 membres, dernier retour aujourd\'hui')
    expect(describeDogStatusSource({ source: 'community', reports }, NOW)).toBe('3 membres')
  })

  it('alertes : « signalé par N membres »', () => {
    expect(describeDogStatusSource({ source: 'alerts', reports, dogsNotAllowedAlerts: 3 })).toBe('signalé par 3 membres')
  })

  it('isDogStatusConfirmed ne garde que les statuts confirmés par la communauté', () => {
    expect(isDogStatusConfirmed('confirmed')).toBe(true)
    expect(isDogStatusConfirmed('confirmed_outside_only')).toBe(true)
    expect(isDogStatusConfirmed('osm_yes')).toBe(false)
    expect(isDogStatusConfirmed('refused')).toBe(false)
  })
})

describe('libellés du statut chien', () => {
  it('textes lisibles, au vouvoiement', () => {
    expect(DOG_STATUS_LABELS.osm_yes.label).toBe('Accepté')
    expect(DOG_STATUS_LABELS.refused.label).toBe('Chiens refusés')
    expect(DOG_STATUS_LABELS.unknown.label).toBe('Info non disponible : soyez le premier à nous le dire !')
  })

  it('aucun libellé ne contient de syntaxe OSM ni de tutoiement', () => {
    for (const { label } of Object.values(DOG_STATUS_LABELS)) {
      expect(label).not.toMatch(/[@;]|\bOSM\b|\b(tu|ton|ta|tes)\b/i)
    }
  })
})

describe('describeDogCondition — traduction des conditions OSM', () => {
  it.each([
    ['12:00-14:00', 'de 12 h à 14 h'],
    ['12:30-14:45', 'de 12 h 30 à 14 h 45'],
    ['22:00-24:00', 'de 22 h à minuit'],
    ['00:00-06:00', 'de minuit à 6 h'],
    ['10:00-12:00,14:00-16:00', 'de 10 h à 12 h et de 14 h à 16 h'],
    ['Jul 1', 'le 1er juillet'],
    ['Jul 14', 'le 14 juillet'],
    ['Jun 01-15', 'du 1er au 15 juin'],
    ['Oct 1-Mar 31', 'du 1er octobre au 31 mars'],
    ['Jun 15-Sep 15', 'du 15 juin au 15 septembre'],
    ['Oct-Mar', 'd\'octobre à mars'],
    ['Apr-Sep', 'd\'avril à septembre'],
    ['(Jun-Sep)', 'de juin à septembre'],
    ['Aug', 'en août'],
    ['Jul 10:00-12:00', 'en juillet, de 10 h à 12 h'],
    ['Sa,Su', 'le samedi et le dimanche'],
    ['Mo-Fr 08:00-20:00', 'du lundi au vendredi, de 8 h à 20 h'],
    ['Jun-Sep Sa,Su 10:00-18:00', 'de juin à septembre, le samedi et le dimanche, de 10 h à 18 h'],
    ['PH', 'les jours fériés'],
    ['SH', 'pendant les vacances scolaires'],
    ['sunset-sunrise', 'du coucher au lever du soleil'],
    ['dawn-dusk', 'de l\'aube au crépuscule'],
    ['night', 'la nuit'],
    ['summer', 'en été'],
  ])('« %s » → « %s »', (condition, expected) => {
    expect(describeDogCondition(condition)).toBe(expected)
  })

  it.each(['foo', 'Xyz 12:00', '25:00-26:00', '24:30-02:00', 'Jun 32', '', '   '])('condition non reconnue « %s » → undefined (rien d\'inventé)', (condition) => {
    expect(describeDogCondition(condition)).toBeUndefined()
  })
})

describe('describeDogConditionalRule', () => {
  it('interdiction : « Chiens interdits … »', () => {
    expect(describeDogConditionalRule({ value: 'no', condition: '12:00-14:00' })).toBe('Chiens interdits de 12 h à 14 h')
    // « seulement » n'est jamais ajouté à une interdiction.
    expect(describeDogConditionalRule({ value: 'no', condition: '12:00-14:00' }, true)).toBe('Chiens interdits de 12 h à 14 h')
  })

  it('autorisation avec « seulement » et élision', () => {
    expect(describeDogConditionalRule({ value: 'leashed', condition: 'Oct-Mar' }, true)).toBe('Chiens acceptés en laisse d\'octobre à mars seulement')
    expect(describeDogConditionalRule({ value: 'yes', condition: 'night' })).toBe('Chiens acceptés la nuit')
  })

  it('valeur ou condition inconnue → undefined', () => {
    expect(describeDogConditionalRule({ value: 'other', condition: '12:00-14:00' })).toBeUndefined()
    expect(describeDogConditionalRule({ value: 'yes', condition: 'n\'importe quoi' })).toBeUndefined()
  })
})

describe('détail osm_conditional affiché (parseOsmDogPolicy.detail)', () => {
  const detail = (tags: Record<string, string>) => computeDogStatus({ now: NOW, tags }).info.osmDetail

  it.each<[Record<string, string>, string]>([
    [{ 'dog': 'yes', 'dog:conditional': 'no @ (Jun-Sep)' }, 'Chiens interdits de juin à septembre'],
    [{ 'dog': 'no', 'dog:conditional': 'yes @ (Oct-May)' }, 'Chiens acceptés d\'octobre à mai seulement'],
    [{ 'dog': 'no', 'dog:conditional': 'yes @ (19:00-08:00)' }, 'Chiens acceptés de 19 h à 8 h seulement'],
    [{ 'dog:conditional': 'yes @ night' }, 'Chiens acceptés la nuit seulement'],
    [{ 'dog': 'outside', 'dog:conditional': 'no @ (Jul-Aug)' }, 'Uniquement à l\'extérieur ; chiens interdits de juillet à août'],
    [{ 'dog': 'yes', 'dog:conditional': 'no @ (12:00-14:00); no @ (Sa)' }, 'Chiens interdits de 12 h à 14 h ; chiens interdits le samedi'],
  ])('%o → « %s »', (tags, expected) => {
    expect(detail(tags)).toBe(expected)
  })

  it.each<[Record<string, string>, string]>([
    [{ 'dog': 'yes', 'dog:conditional': 'no @ (bizarre)' }, OSM_DETAIL_FALLBACKS.restricted],
    [{ 'dog': 'no', 'dog:conditional': 'yes @ (bizarre)' }, OSM_DETAIL_FALLBACKS.conditional_yes],
    [{ 'dog:conditional': 'yes @ (strange thing)' }, OSM_DETAIL_FALLBACKS.conditional_yes],
    [{ 'dog:conditional': 'yes @ (bizarre night)' }, OSM_DETAIL_FALLBACKS.night_only],
    // Une seule règle non traduisible suffit : pas de phrase à moitié traduite.
    [{ 'dog': 'yes', 'dog:conditional': 'no @ (12:00-14:00); no @ (bizarre)' }, OSM_DETAIL_FALLBACKS.restricted],
  ])('condition inconnue %o → texte générique', (tags, expected) => {
    expect(detail(tags)).toBe(expected)
  })

  it('jamais de syntaxe OSM dans le détail', () => {
    for (const conditional of ['no @ (Jun-Sep)', 'yes @ (bizarre)', 'no @ (Mo-Fr 12:00-14:00); no @ (PH)', 'yes @ (sunset-sunrise)']) {
      for (const dog of ['yes', 'no', 'outside', undefined]) {
        const d = detail({ ...(dog ? { dog } : {}), 'dog:conditional': conditional })
        if (d) expect(d).not.toMatch(/@|\(|\)|\b(yes|no|Jun|Sep|Mo|Fr|PH)\b/)
      }
    }
  })

  it('pas de détail pour un oui franc', () => {
    expect(detail({ dog: 'yes' })).toBeUndefined()
    expect(detail({ dog: 'leashed', 'dog:conditional': 'yes @ (Jun-Sep)' })).toBeUndefined()
  })
})
