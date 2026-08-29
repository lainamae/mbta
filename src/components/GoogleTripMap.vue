<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { configureGoogleMaps } from '../googleMapsLoader.js'
import { distanceMeters, resolveLegPlaces } from '../mbtaLocation.js'
import { getLegShapePath } from '../mbtaShapes.js'

const props = defineProps({
  legs: {
    type: Array,
    required: true,
  },
  currentPosition: {
    type: Object,
    default: null,
  },
})

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID'
const mapElement = ref(null)
const loading = ref(false)
const error = ref('')
const walkingConnections = ref([])

let map = null
let markers = []
let polylines = []
let currentLocationMarker = null
let AdvancedMarkerClass = null
let renderVersion = 0

const fingerprint = computed(() =>
  props.legs
    .map((leg) => `${leg.route}|${leg.start}|${leg.end}`)
    .join('||'),
)

const routeLegend = computed(() => {
  const routes = new Map()
  props.legs.forEach((leg) => {
    if (!routes.has(leg.route)) {
      routes.set(leg.route, routeColor(leg.route))
    }
  })
  return [...routes].map(([name, color]) => ({ name, color }))
})

function asLatLng(point) {
  return point ? { lat: point.lat, lng: point.lon } : null
}

function routeColor(route) {
  const value = (route || '').toLowerCase()
  if (value.includes('orange')) return '#ed8b00'
  if (value.includes('blue')) return '#003da5'
  if (value.includes('green')) return '#00843d'
  if (value.includes('red') || value.includes('mattapan')) return '#da291c'
  if (value.includes('silver')) return '#6f777b'
  if (/^\d+\s*[–-]/.test(route || '')) return '#b07800'
  return '#4f5d75'
}

function formatDistance(meters) {
  if (meters < 160) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1609.344).toFixed(1)} mi`
}

function formatDuration(milliseconds) {
  const minutes = Math.max(1, Math.round(milliseconds / 60000))
  return `${minutes} min`
}

function collectStops(resolved) {
  const byCoordinate = new Map()

  props.legs.forEach((leg, index) => {
    const isFirstLeg = index === 0
    const isLastLeg = index === props.legs.length - 1
    const points = [
      {
        point: resolved[index]?.start,
        endpoint: {
          label: isFirstLeg ? 'Start' : `T${index}`,
          kind: isFirstLeg ? 'origin' : 'transfer',
          description: isFirstLeg
            ? `Trip starts at ${leg.start}`
            : `Transfer ${index}, board leg ${index + 1} at ${leg.start}`,
        },
      },
      {
        point: resolved[index]?.end,
        endpoint: {
          label: isLastLeg ? 'End' : `T${index + 1}`,
          kind: isLastLeg ? 'destination' : 'transfer',
          description: isLastLeg
            ? `Trip ends at ${leg.end}`
            : `Transfer ${index + 1}, alight leg ${index + 1} at ${leg.end}`,
        },
      },
    ]

    points.forEach(({ point, endpoint }) => {
      if (!point) return
      const key = `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`
      const existing = byCoordinate.get(key)
      if (existing) {
        const sharedEndpoint = existing.endpoints.find(
          (item) => item.label === endpoint.label,
        )
        if (sharedEndpoint) {
          sharedEndpoint.description += `. ${endpoint.description}`
        } else {
          existing.endpoints.push(endpoint)
        }
        return
      }
      byCoordinate.set(key, {
        point,
        endpoints: [endpoint],
      })
    })
  })

  return [...byCoordinate.values()]
}

function updateCurrentLocationMarker() {
  if (!map || !AdvancedMarkerClass) return

  if (!props.currentPosition) {
    if (currentLocationMarker) currentLocationMarker.map = null
    currentLocationMarker = null
    return
  }

  const position = asLatLng(props.currentPosition)
  if (currentLocationMarker) {
    currentLocationMarker.position = position
    return
  }

  const markerContent = document.createElement('div')
  markerContent.className = 'current-location-pin'
  markerContent.setAttribute('aria-hidden', 'true')

  currentLocationMarker = new AdvancedMarkerClass({
    map,
    position,
    title: 'You are here',
    content: markerContent,
    gmpClickable: true,
    zIndex: 1000,
  })
}

async function renderMap() {
  const version = ++renderVersion
  error.value = ''
  walkingConnections.value = []

  if (!apiKey) return

  loading.value = true
  await nextTick()

  try {
    const importLibrary = configureGoogleMaps(apiKey)

    const [{ Map, Polyline }, { AdvancedMarkerElement }, { Route }, { LatLngBounds }] =
      await Promise.all([
        importLibrary('maps'),
        importLibrary('marker'),
        importLibrary('routes'),
        importLibrary('core'),
      ])

    const resolved = await resolveLegPlaces(props.legs)
    if (version !== renderVersion || !mapElement.value) return

    const shapePaths = []
    for (let index = 0; index < props.legs.length; index++) {
      try {
        shapePaths.push(
          await getLegShapePath(
            props.legs[index],
            resolved[index]?.start,
            resolved[index]?.end,
          ),
        )
      } catch {
        shapePaths.push(null)
      }
    }
    if (version !== renderVersion || !mapElement.value) return

    map = new Map(mapElement.value, {
      center: { lat: 42.3601, lng: -71.0589 },
      zoom: 12,
      mapId,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    })
    AdvancedMarkerClass = AdvancedMarkerElement

    const bounds = new LatLngBounds()
    const stops = collectStops(resolved)

    // Draw every transit leg first so walking paths and stop markers remain
    // visually distinct above them.
    resolved.forEach((legPoints, index) => {
      if (!legPoints.start || !legPoints.end) return
      const routePath = shapePaths[index] || [legPoints.start, legPoints.end]
      const path = routePath.map(asLatLng)
      path.forEach((point) => bounds.extend(point))
      const polyline = new Polyline({
        map,
        path,
        strokeColor: routeColor(props.legs[index].route),
        strokeOpacity: 0.9,
        strokeWeight: 7,
        zIndex: 1,
      })
      polylines.push(polyline)
    })

    markers = stops.map((stop) => {
      const position = asLatLng(stop.point)
      bounds.extend(position)

      const markerContent = document.createElement('div')
      markerContent.className = 'trip-map-marker'
      markerContent.setAttribute('aria-hidden', 'true')
      stop.endpoints.forEach((endpoint) => {
        const endpointLabel = document.createElement('span')
        endpointLabel.className = `trip-map-marker-label is-${endpoint.kind}`
        endpointLabel.textContent = endpoint.label
        markerContent.append(endpointLabel)
      })

      return new AdvancedMarkerElement({
        map,
        position,
        title: stop.endpoints.map((endpoint) => endpoint.description).join('. '),
        content: markerContent,
        gmpClickable: true,
      })
    })
    updateCurrentLocationMarker()

    const connections = []
    for (let index = 0; index < resolved.length - 1; index++) {
      const origin = resolved[index]?.end
      const destination = resolved[index + 1]?.start
      if (!origin || !destination) continue

      const straightLineDistance = distanceMeters(origin, destination)
      if (straightLineDistance < 15) continue

      try {
        const result = await Route.computeRoutes({
          origin: asLatLng(origin),
          destination: asLatLng(destination),
          travelMode: 'WALKING',
          fields: ['path', 'distanceMeters', 'durationMillis'],
        })
        const route = result.routes?.[0]
        if (!route) continue

        const routePolylines = route.createPolylines()
        routePolylines.forEach((polyline) => {
          polyline.setOptions({
            strokeColor: '#6f3fa0',
            strokeOpacity: 0.9,
            strokeWeight: 5,
            zIndex: 2,
          })
          polyline.setMap(map)
          polylines.push(polyline)
        })
        route.path?.forEach((point) => bounds.extend(point))

        connections.push({
          from: props.legs[index].end,
          to: props.legs[index + 1].start,
          distance: formatDistance(route.distanceMeters || straightLineDistance),
          duration: formatDuration(route.durationMillis || 0),
        })
      } catch {
        connections.push({
          from: props.legs[index].end,
          to: props.legs[index + 1].start,
          distance: formatDistance(straightLineDistance),
          duration: 'Route unavailable',
        })
      }
    }

    if (version !== renderVersion) return
    walkingConnections.value = connections
    if (!bounds.isEmpty()) map.fitBounds(bounds, 42)
  } catch (err) {
    error.value =
      err?.message ||
      'The map could not load. Check the API key and enabled Google Maps APIs.'
  } finally {
    if (version === renderVersion) loading.value = false
  }
}

function cleanup() {
  renderVersion++
  if (currentLocationMarker) currentLocationMarker.map = null
  markers.forEach((marker) => {
    marker.map = null
  })
  polylines.forEach((polyline) => polyline.setMap(null))
  markers = []
  polylines = []
  currentLocationMarker = null
  AdvancedMarkerClass = null
  map = null
}

watch(
  fingerprint,
  () => {
    cleanup()
    renderMap()
  },
  { immediate: true },
)

watch(
  () => [
    props.currentPosition?.lat,
    props.currentPosition?.lon,
  ],
  updateCurrentLocationMarker,
)

onBeforeUnmount(cleanup)
</script>

<template>
  <section class="map-card" aria-labelledby="trip-map-heading">
    <div class="map-heading">
      <div>
        <p class="eyebrow">Trip overview</p>
        <h2 id="trip-map-heading">Stops and walking connections</h2>
      </div>
      <div class="map-keys" aria-label="Map legend">
        <span class="endpoint-key location-key">
          <b><span class="location-dot" aria-hidden="true"></span></b>
          You are here
        </span>
        <span class="endpoint-key origin-key"><b>Start</b></span>
        <span class="endpoint-key transfer-key"><b>T1</b> Transfer</span>
        <span class="endpoint-key destination-key"><b>End</b></span>
        <span class="walk-key">
          <span class="walk-line" aria-hidden="true"></span>
          Walking
        </span>
      </div>
    </div>

    <ul class="route-legend" aria-label="Transit route colors">
      <li v-for="route in routeLegend" :key="route.name">
        <span
          class="route-swatch"
          :style="{ backgroundColor: route.color }"
          aria-hidden="true"
        ></span>
        {{ route.name }}
      </li>
    </ul>

    <div v-if="!apiKey" class="map-message" role="status">
      <strong>Google Maps needs an API key.</strong>
      Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to a <code>.env.local</code>
      file, then restart the development server.
    </div>

    <div v-else>
      <p v-if="loading" class="map-message" role="status">Loading trip map…</p>
      <p v-if="error" class="map-message error" role="alert">{{ error }}</p>
      <div
        ref="mapElement"
        class="map"
        role="region"
        :aria-label="`Map showing stops for ${legs.length} trip legs`"
      ></div>

      <div class="walks">
        <h3>Walking between legs</h3>
        <p v-if="!loading && !walkingConnections.length" class="no-walks">
          No separate walking connections were found.
        </p>
        <ol v-else>
          <li v-for="(walk, index) in walkingConnections" :key="index">
            <span class="walk-route">{{ walk.from }} → {{ walk.to }}</span>
            <span class="walk-meta">{{ walk.distance }} · {{ walk.duration }}</span>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<style scoped>
.map-card {
  margin-top: 1rem;
  padding: 1rem;
  border: 2px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
}

.map-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.eyebrow {
  margin: 0 0 0.2rem;
  color: var(--ink-muted);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h2,
h3 {
  margin: 0;
}

h2 {
  font-size: 1.1rem;
  line-height: 1.3;
}

.walk-key {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--ink-muted);
}

.map-keys {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
}

.endpoint-key {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--ink-muted);
  font-size: 0.8rem;
  font-weight: 600;
}

.endpoint-key b {
  min-width: 1.9rem;
  padding: 0.12rem 0.25rem;
  border: 2px solid;
  border-radius: 0.25rem;
  color: #fff;
  font-size: 0.72rem;
  text-align: center;
}

.location-key b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-color: #9cb9e8;
}

.location-dot {
  display: block;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background: #0b57d0;
  box-shadow: 0 0 0 3px rgba(11, 87, 208, 0.22);
}

.origin-key b {
  background: #176b45;
  border-color: #0d4c30;
}

.transfer-key b {
  background: #6f3fa0;
  border-color: #4b286d;
}

.destination-key b {
  background: #b3471a;
  border-color: #7f2f0e;
}

.walk-line {
  width: 1.8rem;
  border-top: 4px solid #6f3fa0;
  border-radius: 99px;
}

.route-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.7rem;
  margin: 0 0 0.85rem;
  padding: 0;
  list-style: none;
}

.route-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.25;
}

.route-swatch {
  width: 1.8rem;
  height: 0.4rem;
  flex: 0 0 auto;
  border: 1px solid rgba(20, 32, 51, 0.35);
  border-radius: 99px;
}

.map {
  width: 100%;
  height: min(58vh, 27rem);
  min-height: 19rem;
  border: 2px solid var(--line);
  border-radius: 0.4rem;
  background: #e8e4db;
}

:global(.trip-map-marker) {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px;
  border: 2px solid #fff;
  border-radius: 0.4rem;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 1px 5px rgba(20, 32, 51, 0.35);
}

:global(.trip-map-marker-label) {
  min-width: 2.4rem;
  padding: 0.2rem 0.3rem;
  border: 2px solid;
  border-radius: 0.25rem;
  color: #fff;
  font: 700 0.75rem/1 var(--sans);
  text-align: center;
}

:global(.trip-map-marker-label.is-origin) {
  border-color: #0d4c30;
  background: #176b45;
}

:global(.trip-map-marker-label.is-transfer) {
  border-color: #4b286d;
  background: #6f3fa0;
}

:global(.trip-map-marker-label.is-destination) {
  border-color: #7f2f0e;
  background: #b3471a;
}

:global(.current-location-pin) {
  position: relative;
  width: 1.35rem;
  height: 1.35rem;
  border: 3px solid #fff;
  border-radius: 50%;
  background: #0b57d0;
  box-shadow:
    0 1px 5px rgba(20, 32, 51, 0.45),
    0 0 0 8px rgba(11, 87, 208, 0.2);
}

:global(.current-location-pin::after) {
  position: absolute;
  inset: -0.55rem;
  border: 2px solid rgba(11, 87, 208, 0.45);
  border-radius: 50%;
  content: '';
  animation: location-pulse 2s ease-out infinite;
}

@keyframes location-pulse {
  0% {
    opacity: 0.8;
    transform: scale(0.65);
  }
  75%,
  100% {
    opacity: 0;
    transform: scale(1.25);
  }
}

.map-message {
  margin: 0;
  padding: 0.85rem;
  border: 2px solid #b7c9f0;
  border-radius: 0.4rem;
  background: #eef3ff;
  color: var(--ink);
  line-height: 1.5;
}

.map-message strong {
  display: block;
  margin-bottom: 0.25rem;
}

.map-message.error {
  margin-bottom: 0.75rem;
  border-color: #d99a91;
  background: #fff0ee;
}

code {
  font-family: var(--mono);
  font-size: 0.85em;
}

.walks {
  margin-top: 1rem;
}

.walks h3 {
  font-size: 1rem;
}

.walks ol {
  margin: 0.65rem 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.6rem;
}

.walks li {
  padding: 0.75rem;
  border-radius: 0.35rem;
  background: #f3edf8;
  border-left: 0.35rem solid #6f3fa0;
}

.walk-route,
.walk-meta {
  display: block;
}

.walk-route {
  font-weight: 600;
  line-height: 1.35;
}

.walk-meta {
  margin-top: 0.25rem;
  font-family: var(--mono);
  font-size: 0.85rem;
  color: var(--ink-muted);
}

.no-walks {
  margin: 0.45rem 0 0;
  color: var(--ink-muted);
  font-size: 0.9rem;
}

@media (max-width: 420px) {
  .map-card {
    padding: 0.75rem;
  }

  .map {
    min-height: 17rem;
  }
}
</style>
