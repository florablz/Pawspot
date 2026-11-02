/**
 * Fonctions pures d'interprétation des tags OSM d'un lieu.
 * Migreront vers shared/ en Phase 1 (agent donnees).
 */

export function resolveImage(tags: Record<string, string>): string | undefined {
  // Direct image URL (http/https), but convert commons wiki/File: links to FilePath
  if (tags.image?.startsWith('http')) {
    const wikiFileMatch = tags.image.match(/commons\.wikimedia\.org\/wiki\/File:(.+)/)
    if (wikiFileMatch) {
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(wikiFileMatch[1]!)}?width=600`
    }
    return tags.image
  }

  // Wikimedia Commons: only handle "File:xxx" format (not "Category:")
  if (tags.wikimedia_commons?.startsWith('File:')) {
    const file = tags.wikimedia_commons.slice(5).replace(/ /g, '_')
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=600`
  }

  return undefined
}

export function parseDogPolicy(tags: Record<string, string>): { policy: 'all_day' | 'night_only' | 'no' | 'restricted' | 'unknown'; source: string | undefined } {
  const dogTag = tags.dog?.toLowerCase()
  const dogConditional = tags['dog:conditional'] || tags['access:conditional'] || ''

  if (dogTag === 'no') {
    return { policy: 'no', source: 'no' }
  }

  if (dogTag && dogTag !== 'no') {
    return { policy: 'all_day', source: dogTag }
  }

  if (dogConditional) {
    const lower = dogConditional.toLowerCase()
    if (lower.includes('night') || lower.includes('22:00') || lower.includes('23:00') || lower.includes('00:00') || lower.includes('1:00') || lower.includes('2:00') || lower.includes('3:00') || lower.includes('4:00') || lower.includes('5:00') || lower.includes('6:00')) {
      return { policy: 'night_only', source: dogConditional }
    }
    if (lower.includes('no')) {
      return { policy: 'restricted', source: dogConditional }
    }
    return { policy: 'all_day', source: dogConditional }
  }

  return { policy: 'unknown', source: undefined }
}
