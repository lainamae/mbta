/**
 * Resolve itinerary stop names to coordinates via MBTA V3 stops-by-route.
 * https://api-v3.mbta.com
 */

const API = 'https://api-v3.mbta.com'
const routeStopsCache = new Map()
const placeCache = new Map()

const COMMUTER_RAIL_ROUTES = [
  { id: 'CR-NewBedford', names: ['fall river/new bedford', 'new bedford', 'fall river'] },
  { id: 'CR-Worcester', names: ['framingham/worcester', 'worcester', 'framingham'] },
  { id: 'CR-Franklin', names: ['franklin/foxboro', 'franklin'] },
  { id: 'CR-Newburyport', names: ['newburyport/rockport', 'newburyport', 'rockport'] },
  { id: 'CR-Providence', names: ['providence/stoughton', 'providence', 'stoughton'] },
  { id: 'CR-Fairmount', names: ['fairmount'] },
  { id: 'CR-Fitchburg', names: ['fitchburg'] },
  { id: 'CR-Greenbush', names: ['greenbush'] },
  { id: 'CR-Haverhill', names: ['haverhill'] },
  { id: 'CR-Kingston', names: ['kingston'] },
  { id: 'CR-Lowell', names: ['lowell'] },
  { id: 'CR-Needham', names: ['needham'] },
  { id: 'CR-Foxboro', names: ['foxboro event service'] },
]

function singleRouteIdFromLabel(routeLabel) {
  const r = (routeLabel || '').trim()
  const lower = r.toLowerCase()
  const commuterRailRoute = COMMUTER_RAIL_ROUTES.find(({ names }) =>
    names.some((name) => lower.includes(name)),
  )
  if (commuterRailRoute) return commuterRailRoute.id

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

/**
 * @param {string} routeLabel e.g. "Orange Line – Oak Grove", "23 or 28 – Ruggles"
 * @returns {string[]} MBTA route IDs to try (empty when unknown)
 */
export function routeIdsFromLabel(routeLabel) {
  const r = (routeLabel || '').trim()
  const orBus = r.match(/^(\d+(?:\s+or\s+\d+)+)\s*[–-]/i)
  if (orBus) return orBus[1].split(/\s+or\s+/i).map((id) => id.trim())

  const bus = r.match(/^(\d+)\s*[–-]/)
  if (bus) return [bus[1]]

  const single = singleRouteIdFromLabel(routeLabel)
  return single ? [single] : []
}

/** @param {string} routeLabel e.g. "Orange Line – Oak Grove", "66 – Nubian via Allston" */
export function routeIdFromLabel(routeLabel) {
  return routeIdsFromLabel(routeLabel)[0] ?? null
}

/** True for numeric bus routes, including either-or labels like "23 or 28 – Ruggles". */
export function isBusRouteLabel(routeLabel) {
  const ids = routeIdsFromLabel(routeLabel)
  return ids.length > 0 && ids.every((id) => /^\d+$/.test(id))
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

  const request = (async () => {
    const params = new URLSearchParams({
      'filter[route]': routeId,
      'page[limit]': '200',
    })
    const res = await fetch(`${API}/stops?${params}`)
    if (!res.ok) throw new Error(`MBTA stops failed (${res.status})`)
    const json = await res.json()
    return (json.data || [])
      .map((row) => ({
        id: row.id,
        name: row.attributes?.name || '',
        lat: row.attributes?.latitude,
        lon: row.attributes?.longitude,
      }))
      .filter((s) => typeof s.lat === 'number' && typeof s.lon === 'number')
  })()

  routeStopsCache.set(routeId, request)
  try {
    return await request
  } catch (error) {
    routeStopsCache.delete(routeId)
    throw error
  }
}

/**
 * @param {string} place
 * @param {string|string[]|null} routeIdsInput
 * @returns {Promise<{lat: number, lon: number, name: string, score: number}|null>}
 */
export async function resolvePlace(place, routeIdsInput) {
  const routeIds = Array.isArray(routeIdsInput)
    ? [...routeIdsInput]
    : routeIdsInput
      ? [routeIdsInput]
      : []
  const key = `${routeIds.join('|')}::${normalizeName(place)}`
  if (placeCache.has(key)) return placeCache.get(key)

  let best = null

  // Green trunk: try sibling branches if exact branch sparse
  if (routeIds.some((id) => id?.startsWith('Green-'))) {
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
    const routeIds = routeIdsFromLabel(leg.route)
    const [start, end] = await Promise.all([
      resolvePlace(leg.start, routeIds),
      resolvePlace(leg.end, routeIds),
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

/**
 * Shortest distance from a location to a route path in meters.
 * Uses a local equirectangular projection, which is accurate at MBTA scale.
 */
export function distanceToPathMeters(position, path) {
  if (!position || !path?.length) return Infinity
  if (path.length === 1) return distanceMeters(position, path[0])

  const earthRadius = 6371000
  const latitudeRadians = (position.lat * Math.PI) / 180
  const toLocalPoint = (point) => ({
    x:
      ((point.lon - position.lon) * Math.PI * earthRadius *
        Math.cos(latitudeRadians)) /
      180,
    y: ((point.lat - position.lat) * Math.PI * earthRadius) / 180,
  })

  let closest = Infinity
  for (let index = 0; index < path.length - 1; index++) {
    const start = toLocalPoint(path[index])
    const end = toLocalPoint(path[index + 1])
    const segmentX = end.x - start.x
    const segmentY = end.y - start.y
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2
    const projection =
      segmentLengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              -(start.x * segmentX + start.y * segmentY) /
                segmentLengthSquared,
            ),
          )
    const nearestX = start.x + projection * segmentX
    const nearestY = start.y + projection * segmentY
    closest = Math.min(closest, Math.hypot(nearestX, nearestY))
  }

  return closest
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
 * @param {Array<{start: object|null, end: object|null, path?: object[]|null}>} resolved
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
    .map(({ start, end, path }, index) => {
      if (doneIndexes.has(index)) return null
      const startDistance = distanceMeters(position, start)
      const endDistance = distanceMeters(position, end)
      const pathDistance = distanceToPathMeters(position, path)
      const distance = Math.min(startDistance, endDistance, pathDistance)
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
