import { distanceMeters, routeIdsFromLabel } from './mbtaLocation.js'

const API = 'https://api-v3.mbta.com'
const routeShapesCache = new Map()

/** Decode a Google encoded polyline into `{ lat, lon }` points. */
export function decodePolyline(encoded) {
  const points = []
  let index = 0
  let latitude = 0
  let longitude = 0

  while (index < encoded.length) {
    const latResult = decodeValue(encoded, index)
    index = latResult.nextIndex
    latitude += latResult.value

    const lonResult = decodeValue(encoded, index)
    index = lonResult.nextIndex
    longitude += lonResult.value

    points.push({
      lat: latitude / 1e5,
      lon: longitude / 1e5,
    })
  }

  return points
}

function decodeValue(encoded, startIndex) {
  let result = 0
  let shift = 0
  let index = startIndex
  let byte

  do {
    byte = encoded.charCodeAt(index++) - 63
    result |= (byte & 0x1f) << shift
    shift += 5
  } while (byte >= 0x20 && index < encoded.length)

  return {
    value: result & 1 ? ~(result >> 1) : result >> 1,
    nextIndex: index,
  }
}

async function fetchRouteShapes(routeId) {
  if (!routeShapesCache.has(routeId)) {
    const request = (async () => {
      const params = new URLSearchParams({
        'filter[route]': routeId,
        'fields[shape]': 'polyline',
        'page[limit]': '200',
      })
      const response = await fetch(`${API}/shapes?${params}`)
      if (!response.ok) {
        throw new Error(`MBTA shapes failed (${response.status})`)
      }
      const json = await response.json()
      return (json.data || [])
        .map((shape) => ({
          id: shape.id,
          points: decodePolyline(shape.attributes?.polyline || ''),
        }))
        .filter((shape) => shape.points.length > 1)
    })()
    routeShapesCache.set(routeId, request)
  }

  try {
    return await routeShapesCache.get(routeId)
  } catch (error) {
    routeShapesCache.delete(routeId)
    throw error
  }
}

function closestPointIndex(points, target) {
  let bestIndex = -1
  let bestDistance = Infinity

  points.forEach((point, index) => {
    const distance = distanceMeters(point, target)
    if (distance < bestDistance) {
      bestIndex = index
      bestDistance = distance
    }
  })

  return { index: bestIndex, distance: bestDistance }
}

function bestShapeBetweenStops(shapes, start, end) {
  let best = null

  shapes.forEach((shape) => {
    const startMatch = closestPointIndex(shape.points, start)
    const endMatch = closestPointIndex(shape.points, end)
    const score = startMatch.distance + endMatch.distance

    if (!best || score < best.score) {
      best = {
        shape,
        startMatch,
        endMatch,
        score,
      }
    }
  })

  return best
}

function shapePathBetweenStops(best, start, end) {
  const from = Math.min(best.startMatch.index, best.endMatch.index)
  const to = Math.max(best.startMatch.index, best.endMatch.index)
  let path = best.shape.points.slice(from, to + 1)
  if (best.startMatch.index > best.endMatch.index) path = path.reverse()

  // Use the resolved stop coordinates as exact endpoints so route and transfer
  // lines meet their markers without a visual gap.
  return [start, ...path, end]
}

/**
 * Find the route shape that best passes through this leg's two stops, then
 * return only the portion between them in the rider's direction.
 */
export async function getLegShapePath(leg, start, end) {
  const routeIds = routeIdsFromLabel(leg.route)
  if (!routeIds.length || !start || !end) return null

  let best = null

  for (const routeId of routeIds) {
    const shapes = await fetchRouteShapes(routeId)
    const candidate = bestShapeBetweenStops(shapes, start, end)
    if (candidate && (!best || candidate.score < best.score)) {
      best = candidate
    }
  }

  // A shape far from either stop is likely the wrong route variant.
  if (
    !best ||
    best.startMatch.distance > 600 ||
    best.endMatch.distance > 600
  ) {
    return null
  }

  return shapePathBetweenStops(best, start, end)
}
