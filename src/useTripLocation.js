import { onUnmounted, ref, shallowRef, watch } from 'vue'
import { pickActiveLeg, resolveLegPlaces } from './mbtaLocation.js'

/**
 * Browser geolocation + MBTA stop matching to find the active trip leg.
 */
export function useTripLocation(legsRef, doneIndexesRef) {
  const enabled = ref(false)
  const status = ref('idle') // idle | locating | ready | denied | error | unsupported
  const statusMessage = ref('')
  const position = shallowRef(null)
  const resolved = shallowRef([])
  const activeIndex = ref(null)
  const resolving = ref(false)

  let watchId = null

  async function resolveStops(legs) {
    if (!legs?.length) {
      resolved.value = []
      activeIndex.value = null
      return
    }
    resolving.value = true
    statusMessage.value = 'Matching stops…'
    try {
      resolved.value = await resolveLegPlaces(legs)
      updateActive()
      if (enabled.value && position.value) {
        status.value = 'ready'
        statusMessage.value = activeLabel()
      }
    } catch (err) {
      status.value = 'error'
      statusMessage.value = err?.message || 'Could not look up stops'
    } finally {
      resolving.value = false
    }
  }

  function activeLabel() {
    const i = activeIndex.value
    if (i == null || !legsRef.value?.[i]) return 'You are not near a trip stop'
    return `On leg ${i + 1}: ${legsRef.value[i].route}`
  }

  function updateActive() {
    if (!position.value || !resolved.value.length) {
      activeIndex.value = null
      return
    }
    activeIndex.value = pickActiveLeg(position.value, resolved.value, {
      legs: legsRef.value,
      doneIndexes: doneIndexesRef?.value,
    })
    if (status.value === 'ready' || status.value === 'locating') {
      statusMessage.value = activeLabel()
    }
  }

  function onPosition(pos) {
    position.value = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    }
    status.value = 'ready'
    updateActive()
    statusMessage.value = activeLabel()
  }

  function onError(err) {
    if (err?.code === 1) {
      status.value = 'denied'
      statusMessage.value = 'Location permission denied'
    } else {
      status.value = 'error'
      statusMessage.value = err?.message || 'Location unavailable'
    }
    activeIndex.value = null
  }

  function start() {
    if (!navigator.geolocation) {
      status.value = 'unsupported'
      statusMessage.value = 'Location not supported in this browser'
      enabled.value = false
      return
    }
    enabled.value = true
    status.value = 'locating'
    statusMessage.value = 'Getting your location…'
    resolveStops(legsRef.value)

    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 8000,
      timeout: 20000,
    })
  }

  function stop() {
    enabled.value = false
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    position.value = null
    activeIndex.value = null
    status.value = 'idle'
    statusMessage.value = ''
  }

  function toggle() {
    if (enabled.value) stop()
    else start()
  }

  watch(
    legsRef,
    (legs) => {
      if (enabled.value) resolveStops(legs)
      else {
        resolved.value = []
        activeIndex.value = null
      }
    },
    { deep: true },
  )

  if (doneIndexesRef) {
    watch(doneIndexesRef, updateActive, { deep: true })
  }

  onUnmounted(stop)

  return {
    enabled,
    status,
    statusMessage,
    position,
    resolved,
    activeIndex,
    resolving,
    toggle,
    start,
    stop,
  }
}
