<script setup>
import { computed, ref, watch } from 'vue'
import { parseTrip, SAMPLE_TRIP } from './parseTrip.js'

const raw = ref('')
const copied = ref(false)
let copyTimer

const parsed = computed(() => parseTrip(raw.value))
const jsonText = computed(() => JSON.stringify(parsed.value, null, 2))
const legCount = computed(() => parsed.value.legs.length)

watch(raw, () => {
  copied.value = false
})

function loadSample() {
  raw.value = SAMPLE_TRIP
}

function clearAll() {
  raw.value = ''
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(jsonText.value)
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 1800)
  } catch {
    // Fallback for older browsers / denied clipboard
    const ta = document.createElement('textarea')
    ta.value = jsonText.value
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    copied.value = true
  }
}
</script>

<template>
  <div class="page">
    <header class="hero">
      <p class="brand">MBTA Trip → JSON</p>
      <h1>Paste a trip itinerary</h1>
      <p class="lede">
        Drop in the Route / Start / End / Time On / Time Off blurb from an email.
        Get structured legs and walking notes as JSON.
      </p>
    </header>

    <main class="workspace">
      <section class="pane">
        <div class="pane-head">
          <h2>Email text</h2>
          <div class="actions">
            <button type="button" class="ghost" @click="loadSample">Load sample</button>
            <button type="button" class="ghost" :disabled="!raw" @click="clearAll">Clear</button>
          </div>
        </div>
        <textarea
          v-model="raw"
          class="input"
          spellcheck="false"
          placeholder="Paste trip table text here…"
          aria-label="Trip itinerary text"
        />
      </section>

      <section class="pane">
        <div class="pane-head">
          <h2>
            JSON
            <span v-if="legCount" class="badge">{{ legCount }} leg{{ legCount === 1 ? '' : 's' }}</span>
          </h2>
          <div class="actions">
            <button
              type="button"
              class="primary"
              :disabled="!legCount"
              @click="copyJson"
            >
              {{ copied ? 'Copied' : 'Copy JSON' }}
            </button>
          </div>
        </div>
        <pre class="output" aria-live="polite">{{ jsonText }}</pre>
      </section>
    </main>
  </div>
</template>

<style scoped>
.workspace {
  display: grid;
  gap: 1rem;
}

@media (min-width: 880px) {
  .workspace {
    grid-template-columns: 1fr 1fr;
    gap: 1.15rem;
    min-height: min(70vh, 640px);
  }
}

</style>
