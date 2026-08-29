/**
 * Parse an MBTA trip itinerary paste (Route / Start / End / Time On / Time Off)
 * into structured JSON.
 */

const HEADER_RE = /^Route$/i
const TIME_ONLY_RE = /^(?:Approx\.\s*)?\d{1,2}:\d{2}\s*(?:AM|PM)$/i
const TIME_FIND_RE = /(?:Approx\.\s*)?\d{1,2}:\d{2}\s*(?:AM|PM)/gi

/**
 * @param {string} raw
 * @returns {{ legs: Array<{route: string, start: string, end: string, timeOn: string, timeOff: string}>, notes: string[] }}
 */
export function parseTrip(raw) {
  const text = (raw || '').replace(/\r\n/g, '\n').trim()
  if (!text) return { legs: [], notes: [] }

  const { bodyLines, notes } = extractNotes(text)

  if (bodyLines.some((l) => l.includes('\t') && l.split('\t').length >= 5)) {
    return { legs: parseTabRows(bodyLines), notes }
  }

  return { legs: parseLineBlocks(bodyLines), notes }
}

function extractNotes(text) {
  const lines = text.split('\n').map((l) => l.replace(/\t/g, '').trim())
  const notes = []
  const bodyLines = []

  // Skip header labels if present as a block
  let i = 0
  const headerLabels = ['route', 'start', 'end', 'time on', 'time off']
  const head = lines.filter(Boolean).slice(0, 5).map((l) => l.toLowerCase())
  if (headerLabels.every((h, idx) => head[idx] === h)) {
    // Drop those five non-empty header lines from consideration
    let seen = 0
    while (i < lines.length && seen < 5) {
      if (lines[i]) seen++
      i++
    }
  }

  const rest = lines.slice(i)
  for (const line of rest) {
    if (!line) continue
    if (isFootnoteLine(line)) {
      notes.push(line.replace(/^\*+/, '').trim())
      continue
    }
    bodyLines.push(line)
  }

  return { bodyLines, notes }
}

function isFootnoteLine(line) {
  if (!/^\*{1,2}/.test(line)) return false
  const stripped = line.replace(/^\*+/, '').trim()
  // Inline cell markers like *Reasonable Request* stay with the leg
  if (/^Reasonable Request\*?$/i.test(stripped)) return false
  return true
}

function parseTabRows(lines) {
  const legs = []
  for (const line of lines) {
    if (!line.includes('\t')) continue
    const cols = line.split('\t').map(normalizeCell)
    if (cols.length < 5) continue
    const route = cols[0]
    const start = cols[1]
    const end = cols[2]
    const timeOn = cols[3]
    const timeOff = cols[4]
    if (!route || !looksLikeTime(timeOn) || !looksLikeTime(timeOff)) continue
    legs.push({
      route,
      start,
      end,
      timeOn: normalizeTime(timeOn),
      timeOff: normalizeTime(timeOff),
    })
  }
  return legs
}

/**
 * Line-oriented paste: collapse "Approx." + next time, then walk tokens
 * grouping by consecutive time-on / time-off pairs.
 */
function parseLineBlocks(lines) {
  const tokens = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^Approx\.?$/i.test(line) && lines[i + 1] && TIME_ONLY_RE.test(lines[i + 1])) {
      tokens.push(`Approx. ${lines[i + 1]}`)
      i++
      continue
    }
    tokens.push(line)
  }

  const timeIndexes = []
  for (let i = 0; i < tokens.length; i++) {
    if (TIME_ONLY_RE.test(tokens[i])) timeIndexes.push(i)
  }

  const legs = []
  let cursor = 0
  for (let p = 0; p + 1 < timeIndexes.length; p += 2) {
    const onIdx = timeIndexes[p]
    const offIdx = timeIndexes[p + 1]
    const fields = tokens.slice(cursor, onIdx).filter((t) => !TIME_ONLY_RE.test(t))
    if (fields.length < 3) {
      cursor = offIdx + 1
      continue
    }

    const route = fields[0]
    // Start may include following short markers like *Reasonable Request*
    let start = fields[1]
    let endStart = 2
    let reasonableRequest = false
    while (endStart < fields.length - 1 && isReasonableRequest(fields[endStart])) {
      reasonableRequest = true
      endStart++
    }
    const end = fields.slice(endStart).join(' ')

    const leg = {
      route: normalizeCell(route),
      start: normalizeCell(start),
      end: normalizeCell(end),
      timeOn: normalizeTime(tokens[onIdx]),
      timeOff: normalizeTime(tokens[offIdx]),
    }
    if (reasonableRequest) leg.reasonableRequest = true
    legs.push(leg)
    cursor = offIdx + 1
  }

  return legs
}

function isReasonableRequest(s) {
  return /^\*?Reasonable Request\*?$/i.test((s || '').trim())
}

function looksLikeTime(s) {
  return /(?:Approx\.\s*)?\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(s || '')
}

function normalizeTime(s) {
  return (s || '').replace(/\s+/g, ' ').replace(/Approx\.\s*/i, 'Approx. ').trim()
}

function normalizeCell(s) {
  return (s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\*$/, '')
    .trim()
}

export const SAMPLE_TRIP = `Route
	
Start
	
End
	
Time On
	
Time Off
Orange Line – Oak Grove
	
Downtown Crossing
	
Malden Center
	
Approx.
1:37 PM
	
Approx.
1:52 PM
411 – Jack Satter House
	
Malden Center
	
Lynn St @ Beach St Berth B – Linden Square
	
2:16 PM
	
2:47 PM
119 – Beachmont
	
Lynn St @ Beach St Berth B – Linden Square
	
Winthrop Ave @ Beachmont
	
3:39 PM
	
4:06 PM
Blue Line – Bowdoin
	
Beachmont
	
Government Center
	
Approx.
4:24 PM
	
Approx.
4:32 PM
Green Line – D, Riverside
	
Government Center
	
Brigham Circle*
	
4:47 PM
	
5:15 PM
66 – Nubian via Allston
	
Tremont St opp Wigglesworth St
*Reasonable Request*
	
Tremont St @ Columbus Ave
(Roxbury Crossing Sta – 3 stops)
	
5:37 PM
	
5:45 PM
 
*Exit Pearl St, towards the large traffic intersection. Cross over Washington St, to find the bus stop across the street from the Fire House.
**Head towards the corner of the 7-Eleven, and then towards the shopping plaza with the JP Licks and Stop & Shop to find the bus stop on your left.`
