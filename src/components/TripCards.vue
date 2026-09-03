<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { isBusRouteLabel, isSilverLineLabel, routeIdFromLabel } from '../mbtaLocation.js'

const props = defineProps({
  legs: {
    type: Array,
    required: true,
  },
  notes: {
    type: Array,
    default: () => [],
  },
  /** Index of the leg location services thinks you are on. */
  activeIndex: {
    type: Number,
    default: null,
    validator: (v) => v === null || v === undefined || Number.isInteger(v),
  },
  locationEnabled: {
    type: Boolean,
    default: false,
  },
  /** Index of the leg selected from the trip map. */
  selectedIndex: {
    type: Number,
    default: null,
    validator: (v) => v === null || v === undefined || Number.isInteger(v),
  },
})

const emit = defineEmits(['done-change'])

/** Set of leg keys marked done (minimized). */
const done = ref(new Set())

const tripFingerprint = computed(() =>
  props.legs.map((l) => `${l.route}|${l.start}|${l.end}|${l.timeOn}|${l.timeOff}`).join('||'),
)

watch(tripFingerprint, () => {
  done.value = new Set()
  emit('done-change', new Set())
})

watch(
  () => props.activeIndex,
  async (index) => {
    if (index == null || !props.locationEnabled) return
    await nextTick()
    const el = document.getElementById(`leg-card-${index}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  },
)

function legKey(leg, index) {
  return `${index}:${leg.route}:${leg.timeOn}`
}

function isDone(leg, index) {
  return done.value.has(legKey(leg, index))
}

function toggleDone(leg, index) {
  const key = legKey(leg, index)
  const next = new Set(done.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  done.value = next
  emit(
    'done-change',
    new Set(
      props.legs
        .map((leg, legIndex) => (next.has(legKey(leg, legIndex)) ? legIndex : null))
        .filter((index) => index != null),
    ),
  )
}

const doneCount = computed(() => done.value.size)

/** Visual cue only — route name remains the accessible label. */
function lineTone(route) {
  const r = (route || '').toLowerCase()
  if (routeIdFromLabel(route)?.startsWith('CR-')) return 'commuter-rail'
  if (r.includes('orange')) return 'orange'
  if (r.includes('blue')) return 'blue'
  if (r.includes('green')) return 'green'
  if (r.includes('red')) return 'red'
  if (r.includes('silver') || isSilverLineLabel(route)) return 'silver'
  if (isBusRouteLabel(route)) return 'bus'
  return 'other'
}
</script>

<template>
  <div class="trip">
    <p v-if="legs.length" class="progress" aria-live="polite">
      {{ doneCount }} of {{ legs.length }} done
      <template v-if="locationEnabled && activeIndex != null">
        · Current: leg {{ activeIndex + 1 }}
      </template>
    </p>

    <ol v-if="legs.length" class="legs" aria-label="Trip legs">
      <li
        v-for="(leg, index) in legs"
        :id="`leg-card-${index}`"
        :key="legKey(leg, index)"
        class="leg"
        :class="{
          done: isDone(leg, index),
          active: locationEnabled && activeIndex === index,
          selected: selectedIndex === index,
        }"
        :data-line="lineTone(leg.route)"
      >
        <article
          class="card"
          :aria-labelledby="`leg-title-${index}`"
          :aria-current="locationEnabled && activeIndex === index ? 'step' : undefined"
        >
          <div class="card-top">
            <label class="check">
              <input
                type="checkbox"
                class="check-input"
                :checked="isDone(leg, index)"
                :aria-label="`Mark leg ${index + 1}, ${leg.route}, as done`"
                @change="toggleDone(leg, index)"
              />
              <span class="check-box" aria-hidden="true"></span>
            </label>

            <header class="card-head">
              <p class="step">
                <span class="sr-only">Leg </span>{{ index + 1 }}
                <span class="sr-only"> of {{ legs.length }}</span>
                <span v-if="isDone(leg, index)" class="sr-only">, done</span>
                <span
                  v-if="locationEnabled && activeIndex === index"
                  class="now-badge"
                >
                  You are here
                </span>
                <span v-if="selectedIndex === index" class="selected-badge">
                  Selected on map
                </span>
              </p>
              <h3 :id="`leg-title-${index}`" class="route">{{ leg.route }}</h3>
              <p v-if="isDone(leg, index)" class="mini-summary">
                {{ leg.start }} → {{ leg.end }}
                <span class="mini-times">{{ leg.timeOn }} – {{ leg.timeOff }}</span>
              </p>
              <p v-else-if="leg.reasonableRequest" class="flag">
                Reasonable request stop
              </p>
            </header>
          </div>

          <dl v-show="!isDone(leg, index)" class="stops">
            <div class="stop board">
              <dt>Board</dt>
              <dd>
                <span class="place">{{ leg.start }}</span>
                <span class="when">{{ leg.timeOn }}</span>
              </dd>
            </div>
            <div class="stop alight" aria-hidden="true">
              <span class="connector"></span>
            </div>
            <div class="stop leave">
              <dt>Alight</dt>
              <dd>
                <span class="place">{{ leg.end }}</span>
                <span class="when">{{ leg.timeOff }}</span>
              </dd>
            </div>
          </dl>
        </article>
      </li>
    </ol>

    <section v-if="notes.length" class="notes" aria-labelledby="notes-heading">
      <h3 id="notes-heading">Walking notes</h3>
      <ol>
        <li v-for="(note, i) in notes" :key="i">{{ note }}</li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.trip {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.progress {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--ink-muted);
}

.legs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.card {
  background: var(--panel);
  border: 2px solid var(--line);
  border-radius: var(--radius);
  border-left-width: 0.55rem;
  border-left-color: #6b7280;
  padding: 0.85rem 0.9rem 1rem;
}

.leg.done .card {
  opacity: 0.72;
  background: #f5f8f5;
}

.leg[data-line='orange'] .card {
  border-left-color: #ed8b00;
}
.leg[data-line='blue'] .card {
  border-left-color: #003da5;
}
.leg[data-line='green'] .card {
  border-left-color: #00843d;
}
.leg[data-line='red'] .card {
  border-left-color: #da291c;
}
.leg[data-line='silver'] .card {
  border-left-color: #7c878e;
}
.leg[data-line='commuter-rail'] .card {
  border-left-color: #80276c;
}
.leg[data-line='bus'] .card {
  border-left-color: #ffc72c;
}

.leg.active .card,
.leg.selected .card {
  border-top-color: var(--focus);
  border-right-color: var(--focus);
  border-bottom-color: var(--focus);
  box-shadow: 0 0 0 3px rgba(11, 87, 208, 0.22);
  background: #f3f7ff;
}

.leg.active.done .card {
  background: #eef5f1;
}

.now-badge {
  display: inline-block;
  margin-left: 0.45rem;
  padding: 0.2rem 0.45rem;
  border-radius: 0.25rem;
  background: var(--focus);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  vertical-align: middle;
}

.selected-badge {
  display: inline-block;
  margin-left: 0.45rem;
  padding: 0.2rem 0.45rem;
  border-radius: 0.25rem;
  background: var(--focus);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  vertical-align: middle;
}

.card-top {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.75rem;
  align-items: start;
}

.check {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--touch);
  height: var(--touch);
  margin: 0;
  cursor: pointer;
  flex-shrink: 0;
}

.check-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 1;
}

.check-box {
  display: block;
  width: 1.55rem;
  height: 1.55rem;
  border: 2.5px solid var(--ink-muted);
  border-radius: 0.35rem;
  background: #fff;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.check-input:focus-visible + .check-box {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}

.check-input:checked + .check-box {
  background: var(--ok-ink);
  border-color: var(--ok-ink);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23fff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 8.5 6.5 12 13 4'/%3E%3C/svg%3E");
  background-size: 1rem;
  background-repeat: no-repeat;
  background-position: center;
}

.card-head {
  min-width: 0;
}

.leg:not(.done) .card-head {
  margin-bottom: 0.75rem;
}

.step {
  margin: 0 0 0.2rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.route {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.015em;
}

.leg.done .route {
  font-size: 1rem;
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  color: var(--ink-muted);
}

.mini-summary {
  margin: 0.35rem 0 0;
  font-size: 0.9rem;
  color: var(--ink-muted);
  line-height: 1.35;
}

.mini-times {
  display: block;
  margin-top: 0.15rem;
  font-family: var(--mono);
  font-size: 0.85rem;
}

.flag {
  display: inline-block;
  margin: 0.55rem 0 0;
  padding: 0.35rem 0.55rem;
  border-radius: 0.3rem;
  background: var(--ok-bg);
  color: var(--ok-ink);
  font-size: 0.85rem;
  font-weight: 600;
}

.stops {
  margin: 0;
  display: grid;
  gap: 0.15rem;
  padding-left: calc(var(--touch) + 0.75rem);
}

.stop {
  display: grid;
}

.stop dt {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.stop dd {
  margin: 0.15rem 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.place {
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.3;
}

.when {
  font-family: var(--mono);
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--ink);
}

.connector {
  display: block;
  width: 2px;
  height: 1rem;
  margin: 0.15rem 0 0.15rem 0.35rem;
  background: var(--line);
}

.notes {
  background: var(--panel);
  border: 2px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.1rem 1.15rem;
}

.notes h3 {
  margin: 0 0 0.65rem;
  font-size: 1rem;
}

.notes ol {
  margin: 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.notes li {
  padding-left: 0.15rem;
  color: var(--ink);
}
</style>
