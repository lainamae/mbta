<script setup>
import { computed, ref, watch } from 'vue'
import { parseTrip, SAMPLE_TRIP } from './parseTrip.js'
import GoogleTripMap from './components/GoogleTripMap.vue'
import TripCards from './components/TripCards.vue'
import { useTripLocation } from './useTripLocation.js'

const raw = ref('')
const copied = ref(false)
const showJson = ref(false)
const showMap = ref(false)
/** Paste panel open when empty; collapses once a trip is loaded. */
const pasteOpen = ref(true)
const doneIndexes = ref(new Set())
let copyTimer

const parsed = computed(() => parseTrip(raw.value))
const jsonText = computed(() => JSON.stringify(parsed.value, null, 2))
const legCount = computed(() => parsed.value.legs.length)
const hasTrip = computed(() => legCount.value > 0)
const legs = computed(() => parsed.value.legs)

const {
  enabled: locationOn,
  status: locationStatus,
  statusMessage: locationMessage,
  activeIndex,
  toggle: toggleLocation,
} = useTripLocation(legs, doneIndexes)

watch(raw, () => {
  copied.value = false
})

watch(hasTrip, (trip) => {
  if (trip) pasteOpen.value = false
  else {
    pasteOpen.value = true
  }
})

watch(hasTrip, (trip, wasTrip) => {
  if (!trip && wasTrip && locationOn.value) {
    toggleLocation()
  }
})

function loadSample() {
  raw.value = SAMPLE_TRIP
}

function clearAll() {
  raw.value = ''
  pasteOpen.value = true
}

function updateDoneIndexes(indexes) {
  doneIndexes.value = indexes
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(jsonText.value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = jsonText.value
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
  }, 1800)
}
</script>

<template>
  <a class="skip-link" href="#trip-results">Skip to trip</a>

  <div class="page">
    <header class="hero">
      <p class="brand">MBTA trip</p>
      <h1>Your itinerary</h1>

    </header>

    <section class="composer" aria-labelledby="paste-heading">
      <div class="composer-head">
        <button
          type="button"
          class="paste-toggle"
          :aria-expanded="pasteOpen"
          aria-controls="paste-panel"
          @click="pasteOpen = !pasteOpen"
        >
          <span class="paste-chevron" aria-hidden="true">{{ pasteOpen ? '▾' : '▸' }}</span>
          <h2 id="paste-heading">Paste trip text</h2>
          <span class="paste-hint">{{ pasteOpen ? 'Hide' : 'Show' }}</span>
        </button>
      </div>

      <div v-show="pasteOpen" id="paste-panel" class="paste-panel">
        <div class="actions paste-actions" role="group" aria-label="Paste actions">
          <button type="button" class="btn ghost" @click="loadSample">
            Load sample
          </button>
          <button type="button" class="btn ghost" :disabled="!raw" @click="clearAll">
            Clear
          </button>
        </div>
        <label class="sr-only" for="trip-input">Trip itinerary text</label>
        <textarea
          id="trip-input"
          v-model="raw"
          class="input"
          spellcheck="false"
          rows="6"
          placeholder="Route, Start, End, Time On, Time Off…"
          autocomplete="off"
        />
      </div>
    </section>

    <div
      id="trip-results"
      class="results"
      tabindex="-1"
      aria-live="polite"
      aria-atomic="false"
    >
      <div class="results-head">
        <h2>
          <template v-if="hasTrip">
            {{ legCount }} leg{{ legCount === 1 ? '' : 's' }}
          </template>
          <template v-else>No trip yet</template>
        </h2>
        <div v-if="hasTrip" class="actions" role="group" aria-label="Trip actions">
          <button
            type="button"
            class="btn"
            :class="locationOn ? 'primary' : 'ghost'"
            :aria-pressed="locationOn"
            @click="toggleLocation"
          >
            {{ locationOn ? 'Location on' : 'Use location' }}
          </button>
          <button
            type="button"
            class="btn ghost"
            :aria-expanded="showMap"
            aria-controls="trip-map"
            @click="showMap = !showMap"
          >
            {{ showMap ? 'Hide map' : 'Show map' }}
          </button>
          <button type="button" class="btn primary" @click="copyJson">
            {{ copied ? 'JSON copied' : 'Copy JSON' }}
          </button>
          <button
            type="button"
            class="btn ghost"
            :aria-expanded="showJson"
            aria-controls="json-panel"
            @click="showJson = !showJson"
          >
            {{ showJson ? 'Hide JSON' : 'Show JSON' }}
          </button>
        </div>
      </div>

      <p
        v-if="hasTrip && locationOn"
        class="location-status"
        role="status"
        aria-live="polite"
      >
        {{ locationMessage }}
        <span v-if="locationStatus === 'denied'" class="location-hint">
          Enable location in browser settings to highlight your current leg.
        </span>
      </p>

      <p v-if="!hasTrip" class="empty">
        Paste an itinerary above, or load the sample to preview the card layout.
      </p>
      <div v-if="hasTrip && showMap" id="trip-map">
        <GoogleTripMap :legs="parsed.legs" />
      </div>
      <TripCards
        v-else
        :legs="parsed.legs"
        :notes="parsed.notes"
        :active-index="activeIndex"
        :location-enabled="locationOn"
        @done-change="updateDoneIndexes"
      />
      <pre
        v-if="hasTrip && showJson"
        id="json-panel"
        class="json"
        tabindex="0"
      >{{ jsonText }}</pre>
    </div>
  </div>
</template>

<style scoped>
.page {
  width: min(100%, 40rem);
  margin: 0 auto;
  padding: 1.25rem var(--space) 3rem;
}

.hero {
  margin-bottom: 1.35rem;
}

.brand {
  margin: 0 0 0.4rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
}

h1 {
  margin: 0 0 0.45rem;
  font-size: clamp(1.65rem, 6vw, 2rem);
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.lede {
  margin: 0;
  color: var(--ink-muted);
  font-size: 1rem;
  max-width: 34ch;
}

.composer,
.results {
  margin-bottom: 1.25rem;
}

.composer {
  background: var(--panel);
  border: 2px solid var(--line);
  border-radius: var(--radius);
  padding: 0.85rem;
}

.composer-head {
  margin: 0;
}

.results-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  margin-bottom: 0.65rem;
}

.results-head h2 {
  margin: 0;
  font-size: 1rem;
}

.paste-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-height: var(--touch);
  margin: 0;
  padding: 0.15rem 0.25rem;
  border: 0;
  border-radius: 0.35rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.paste-toggle h2 {
  margin: 0;
  flex: 1;
  font-size: 1rem;
}

.paste-chevron {
  font-size: 1rem;
  line-height: 1;
  color: var(--ink-muted);
}

.paste-hint {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-muted);
}

.paste-panel {
  margin-top: 0.55rem;
}

.paste-actions {
  margin-bottom: 0.55rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.btn {
  min-height: var(--touch);
  min-width: var(--touch);
  padding: 0.55rem 0.9rem;
  border-radius: 0.4rem;
  border: 2px solid transparent;
  cursor: pointer;
  font-weight: 700;
  font-size: 0.95rem;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn.ghost {
  background: transparent;
  border-color: var(--line);
  color: var(--ink);
}

.btn.ghost:not(:disabled):hover {
  border-color: var(--ink-muted);
  background: rgba(255, 255, 255, 0.7);
}

.btn.primary {
  background: var(--accent);
  color: var(--accent-ink);
}

.btn.primary:hover {
  filter: brightness(0.92);
}

.input {
  display: block;
  width: 100%;
  min-height: 8.5rem;
  padding: 0.75rem;
  border: 2px solid var(--line);
  border-radius: 0.35rem;
  background: #fff;
  color: var(--ink);
  font-family: var(--mono);
  font-size: 0.9rem;
  line-height: 1.5;
  resize: vertical;
}

.input:focus-visible {
  border-color: var(--focus);
}

.empty {
  margin: 0;
  padding: 1.1rem 0.2rem;
  color: var(--ink-muted);
}

.location-status {
  margin: 0 0 0.85rem;
  padding: 0.65rem 0.75rem;
  border-radius: 0.35rem;
  background: #e8eefc;
  border: 2px solid #b7c9f0;
  color: var(--ink);
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.35;
}

.location-hint {
  display: block;
  margin-top: 0.25rem;
  font-weight: 500;
  color: var(--ink-muted);
}

.json {
  margin: 1rem 0 0;
  padding: 0.85rem;
  overflow: auto;
  border: 2px solid var(--line);
  border-radius: var(--radius);
  background: #1b2433;
  color: #e8eef7;
  font-family: var(--mono);
  font-size: 0.8rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (min-width: 640px) {
  .page {
    padding-top: 2rem;
  }
}
</style>
