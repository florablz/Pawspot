import { PAWSPOT_USER_AGENT } from '../utils/http'
import { parseDogPolicy, resolveImage } from '../utils/dogPolicy'

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

const OVERPASS_TIMEOUT_MS = 35_000

interface OverpassResponse {
  elements?: OverpassElement[]
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
      node["natural"="beach"](around:${radius},${lat},${lon});
      way["natural"="beach"](around:${radius},${lat},${lon});
      node["leisure"="beach"](around:${radius},${lat},${lon});
      way["leisure"="beach"](around:${radius},${lat},${lon});
    );
    out center tags;
  `

  let data: OverpassResponse
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': PAWSPOT_USER_AGENT,
      },
      signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
    })
    if (!response.ok) {
      // 429 / 502 / 504 : Overpass saturé ; autres codes : erreur amont.
      const busy = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504
      throw createError({
        statusCode: busy ? 503 : 502,
        statusMessage: busy
          ? 'Le service de cartes est saturé, réessayez dans quelques instants'
          : 'Le service de cartes est indisponible',
      })
    }
    data = await response.json() as OverpassResponse
  }
  catch (err) {
    if (isError(err)) throw err
    // Erreur réseau, délai dépassé ou JSON invalide : pas de détail interne.
    throw createError({
      statusCode: 502,
      statusMessage: 'Le service de cartes est indisponible',
    })
  }

  const places = (data.elements || []).map((el) => {
    const tags: Record<string, string> = el.tags || {}
    let category = 'park'
    if (tags.leisure === 'dog_park') category = 'dog_park'
    else if (tags.leisure === 'park') category = 'park'
    else if (tags.natural === 'beach' || tags.leisure === 'beach') category = 'beach'
    else if (tags.amenity === 'restaurant') category = 'restaurant'
    else if (tags.amenity === 'bar') category = 'bar'
    else if (tags.amenity === 'cafe') category = 'cafe'
    else if (tags.amenity === 'veterinary') category = 'vet'

    const { policy: dogPolicy, source: dogSource } = parseDogPolicy(tags)
    const dogValue = tags.dog || tags['dog:conditional'] || tags['access:conditional'] || undefined

    return {
      id: `${el.type}-${el.id}`,
      name: tags.name || 'Lieu sans nom',
      lat: el.lat ?? el.center?.lat,
      lon: el.lon ?? el.center?.lon,
      category,
      dog: dogValue,
      dogPolicy,
      dogPolicySource: dogSource,
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
      description: tags.description || undefined,
      cuisine: tags.cuisine || undefined,
      image: resolveImage(tags),
    }
  }).filter(p => p.lat && p.lon && p.dog !== 'no')

  return { places }
})
