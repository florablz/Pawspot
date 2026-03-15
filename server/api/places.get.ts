function resolveImage(tags: Record<string, string>): string | undefined {
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

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const lat = Number(query.lat)
  const lon = Number(query.lon)
  const radius = Number(query.radius || 3000)

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Latitude ou longitude invalide',
    })
  }

  const body = `
    [out:json][timeout:30];
    (
      node["leisure"="park"](around:${radius},${lat},${lon});
      way["leisure"="park"](around:${radius},${lat},${lon});
      node["leisure"="dog_park"](around:${radius},${lat},${lon});
      way["leisure"="dog_park"](around:${radius},${lat},${lon});
      node["amenity"="restaurant"]["outdoor_seating"="yes"](around:${radius},${lat},${lon});
      way["amenity"="restaurant"]["outdoor_seating"="yes"](around:${radius},${lat},${lon});
      node["amenity"="bar"]["outdoor_seating"="yes"](around:${radius},${lat},${lon});
      way["amenity"="bar"]["outdoor_seating"="yes"](around:${radius},${lat},${lon});
      node["amenity"="cafe"]["outdoor_seating"="yes"](around:${radius},${lat},${lon});
      way["amenity"="cafe"]["outdoor_seating"="yes"](around:${radius},${lat},${lon});
      node["amenity"="veterinary"](around:${radius},${lat},${lon});
      way["amenity"="veterinary"](around:${radius},${lat},${lon});
    );
    out center tags;
  `

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'text/plain' },
  })

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      statusMessage: 'Erreur Overpass API',
    })
  }

  const data = await response.json()

  const places = (data.elements || []).map((el: any) => {
    const tags = el.tags || {}
    let category = 'park'
    if (tags.leisure === 'dog_park') category = 'dog_park'
    else if (tags.leisure === 'park') category = 'park'
    else if (tags.amenity === 'restaurant') category = 'restaurant'
    else if (tags.amenity === 'bar') category = 'bar'
    else if (tags.amenity === 'cafe') category = 'cafe'
    else if (tags.amenity === 'veterinary') category = 'vet'

    return {
      id: `${el.type}-${el.id}`,
      name: tags.name || 'Lieu sans nom',
      lat: el.lat ?? el.center?.lat,
      lon: el.lon ?? el.center?.lon,
      category,
      address: [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:postcode'],
        tags['addr:city'],
      ]
        .filter(Boolean)
        .join(' ') || undefined,
      phone: tags.phone || tags['contact:phone'] || undefined,
      website: tags.website || tags['contact:website'] || undefined,
      openingHours: tags.opening_hours || undefined,
      dog: tags.dog || undefined,
      description: tags.description || undefined,
      cuisine: tags.cuisine || undefined,
      image: resolveImage(tags),
    }
  }).filter((p: any) => p.lat && p.lon && p.dog !== 'no')

  return { places }
})
