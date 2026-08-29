/**
 * Resolve itinerary stop names to coordinates via MBTA V3 stops-by-route.
 * https://api-v3.mbta.com
 */

const API = 'https://api-v3.mbta.com'
const routeStopsCache = new Map()
const placeCache = new Map()

/** @param {string} routeLabel e.g. "Orange Line – Oak Grove", "66 – Nubian via Allston" */
export function routeIdFromLabel(routeLabel) {
  const r = (routeLabel || '').trim()
  const bus = r.match(/^(\d+)\s*[–-]/)
  if (bus) return bus[1]

  const lower = r.toLowerCase()
  if (lower.includes('orange')) return 'Orange'
  if (lower.includes('blue')) return 'Blue'
  if (lower.includes('red')) return 'Red'
  if (lower.includes('mattapan')) return 'Mattapan'
  if (lower.includes('silver')) return '741' // SL1 common; may need multi
  if (lower.includes('green')) {
    const branch = r.match(/Green Line\s*[–-]\s*([A-E])/i)
    if (branch) return `Green-${branch[1].toUpperCase()}`
    if (/\bD\b/.test(r) || /riverside/i.test(r)) return 'Green-D'
    if (/\bB\b/.test(r) || /boston college/i.test(r)) return 'Green-B'
    if (/\bC\b/.test(r) || /cleveland/i.test(r)) return 'Green-C'
    if (/\bE\b/.test(r) || /heath/i.test(r)) return 'Green-E'
    return 'Green-D'
  }
  return null
}

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\*+/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/reasonable request/gi, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9@\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Score how well a stop name matches an itinerary place string (higher = better). */
function matchScore(place, stopName) {
  const a = normalizeName(place)
  const b = normalizeName(stopName)
  if (!a || !b) return 0
  if (a === b) return 100
  if (a.includes(b) || b.includes(a)) return 80

  // Compare primary segment before @ or -
  const aHead = a.split(/[@-]/)[0].trim()
  const bHead = b.split(/[@-]/)[0].trim()
  if (aHead && bHead && (aHead.includes(bHead) || bHead.includes(aHead))) return 60

  const aTokens = new Set(a.split(' ').filter((t) => t.length > 2))
  const bTokens = b.split(' ').filter((t) => t.length > 2)
  if (!aTokens.size || !bTokens.length) return 0
  const hit = bTokens.filter((t) => aTokens.has(t)).length
  const ratio = hit / Math.max(aTokens.size, bTokens.length)
  return ratio >= 0.5 ? Math.round(ratio * 50) : 0
}

async function fetchStopsForRoute(routeId) {
  if (routeStopsCache.has(routeId)) return routeStopsCache.get(routeId)

  const params = new URLSearchParams({
    'filter[route]': routeId,
    'page[limit]': '200',
  })
  const res = await fetch(`${API}/stops?${params}`)
  if (!res.ok) throw new Error(`MBTA stops failed (${res.status})`)
  const json = await res.json()
  const stops = (json.data || [])
    .map((row) => ({
      id: row.id,
      name: row.attributes?.name || '',
      lat: row.attributes?.latitude,
      lon: row.attributes?.longitude,
    }))
    .filter((s) => typeof s.lat === 'number' && typeof s.lon === 'number')

  routeStopsCache.set(routeId, stops)
  return stops
}

/**
 * @param {string} place
 * @param {string|null} routeId
 * @returns {Promise<{lat: number, lon: number, name: string, score: number}|null>}
 */
export async function resolvePlace(place, routeId) {
  const key = `${routeId || ''}::${normalizeName(place)}`
  if (placeCache.has(key)) return placeCache.get(key)

  let best = null
  const routeIds = routeId ? [routeId] : []

  // Green trunk: try sibling branches if exact branch sparse
  if (routeId?.startsWith('Green-')) {
    for (const b of ['Green-B', 'Green-C', 'Green-D', 'Green-E']) {
      if (!routeIds.includes(b)) routeIds.push(b)
    }
  }

  for (const id of routeIds) {
    try {
      const stops = await fetchStopsForRoute(id)
      for (const stop of stops) {
        const score = matchScore(place, stop.name)
        if (score > 0 && (!best || score > best.score)) {
          best = { lat: stop.lat, lon: stop.lon, name: stop.name, score }
        }
      }
      if (best && best.score >= 60) break
    } catch {
      // try next route id
    }
  }

  // Parent stations sometimes only on subway routes without bus match
  if (!best || best.score < 40) {
    for (const id of ['Orange', 'Blue', 'Red', 'Green-D', 'Green-E', 'Green-B', 'Green-C']) {
      if (routeIds.includes(id)) continue
      try {
        const stops = await fetchStopsForRoute(id)
        for (const stop of stops) {
          const score = matchScore(place, stop.name)
          if (score >= 60 && (!best || score > best.score)) {
            best = { lat: stop.lat, lon: stop.lon, name: stop.name, score }
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  placeCache.set(key, best)
  return best
}

/**
 * @param {Array<{route: string, start: string, end: string}>} legs
 * @returns {Promise<Array<{start: {lat:number,lon:number}|null, end: {lat:number,lon:number}|null}>>}
 */
export async function resolveLegPlaces(legs) {
  const out = []
  for (const leg of legs) {
    const routeId = routeIdFromLabel(leg.route)
    const [start, end] = await Promise.all([
      resolvePlace(leg.start, routeId),
      resolvePlace(leg.end, routeId),
    ])
    out.push({
      start: start ? { lat: start.lat, lon: start.lon, matchedAs: start.name } : null,
      end: end ? { lat: end.lat, lon: end.lon, matchedAs: end.name } : null,
    })
  }
  return out
}

/** Haversine distance in meters. */
export function distanceMeters(a, b) {
  if (!a || !b) return Infinity
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function minutesFromMidnight(value) {
  const match = (value || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!match) return null

  let hour = Number(match[1]) % 12
  if (match[3].toUpperCase() === 'PM') hour += 12
  return hour * 60 + Number(match[2])
}

function distanceToTimeWindow(nowMinutes, leg) {
  const start = minutesFromMidnight(leg?.timeOn)
  const end = minutesFromMidnight(leg?.timeOff)
  if (start == null || end == null) return Infinity

  const adjustedEnd = end < start ? end + 24 * 60 : end
  const nowOptions = [nowMinutes, nowMinutes + 24 * 60]
  return Math.min(
    ...nowOptions.map((now) => {
      if (now >= start && now <= adjustedEnd) return 0
      return Math.min(Math.abs(now - start), Math.abs(now - adjustedEnd))
    }),
  )
}

/**
 * Pick the nearest plausible unfinished leg.
 *
 * Location is the primary signal. When multiple legs share a stop or are
 * similarly close, itinerary time breaks the tie. Manually completed legs are
 * excluded.
 *
 * @param {{lat:number, lon:number, accuracy?:number}} position
 * @param {Array<{start: object|null, end: object|null}>} resolved
 * @param {{
 *   doneIndexes?: Set<number>,
 *   legs?: Array<{timeOn?:string, timeOff?:string}>,
 *   now?: Date,
 *   tieRadiusM?: number,
 *   maxDistanceM?: number
 * }} [opts]
 * @returns {number|null} leg index
 */
export function pickActiveLeg(position, resolved, opts = {}) {
  const doneIndexes = opts.doneIndexes ?? new Set()
  const legs = opts.legs ?? []
  const now = opts.now ?? new Date()
  // Time should only break a true spatial tie (such as two legs sharing a
  // transfer platform), not override a clearly nearer stop.
  const tieRadiusM = opts.tieRadiusM ?? 10
  const maxDistanceM = opts.maxDistanceM ?? 1600
  if (!position || !resolved?.length) return null

  const candidates = resolved
    .map(({ start, end }, index) => {
      if (doneIndexes.has(index)) return null
      const startDistance = distanceMeters(position, start)
      const endDistance = distanceMeters(position, end)
      const distance = Math.min(startDistance, endDistance)
      if (!Number.isFinite(distance)) return null

      return {
        index,
        distance,
        timeDistance: distanceToTimeWindow(
          now.getHours() * 60 + now.getMinutes(),
          legs[index],
        ),
      }
    })
    .filter(Boolean)

  if (!candidates.length) return null

  const nearestDistance = Math.min(...candidates.map((candidate) => candidate.distance))
  const accuracyAllowance = Math.min(position.accuracy || 0, 250)
  if (nearestDistance > maxDistanceM + accuracyAllowance) return null

  // Only let time choose between stops that are geographically ambiguous.
  const plausible = candidates.filter(
    (candidate) => candidate.distance <= nearestDistance + tieRadiusM,
  )
  plausible.sort((a, b) => {
    if (a.timeDistance !== b.timeDistance) return a.timeDistance - b.timeDistance
    if (a.distance !== b.distance) return a.distance - b.distance
    return a.index - b.index
  })

  return plausible[0].index
}
