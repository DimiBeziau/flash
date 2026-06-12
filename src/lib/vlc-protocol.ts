/**
 * VLC Protocol v2 — self-clocking frame over light pulses.
 *
 * Frame layout (bits, 1 = light ON):
 *   PREAMBLE  "10" × 5          — alternating, lets the receiver measure the
 *                                  real bit duration (autobaud) and trains the
 *                                  camera's auto-exposure to a mid level
 *   SYNC      "11"              — breaks the alternation, marks start of data
 *   LENGTH    1 byte
 *   DATA      LENGTH bytes (UTF-8)
 *   CHECKSUM  1 byte (rolling XOR)
 *
 * Everything from SYNC onward is bit-stuffed: after 3 identical consecutive
 * bits an opposite bit is inserted, guaranteeing a light transition at least
 * every 3 bit periods (the camera's auto-exposure kills constant levels).
 *
 * Decoding works on TIMESTAMPED runs (state + duration in ms), never on
 * sample counts — this makes it immune to emitter timing jitter and to
 * irregular camera frame rates.
 */

export const BIT_DURATION_MS = 250
export const MAX_MESSAGE_BYTES = 16

const PREAMBLE_PAIRS = 5
const SYNC: boolean[] = [true, true]
// Tail of preamble + sync — searched in the reconstructed bit stream
const SYNC_PATTERN: boolean[] = [true, false, true, false, true, false, true, true]

export interface Sample { t: number; lux: number }
export interface Run { v: boolean; ms: number }

// ───────────────────────────── Encoding ─────────────────────────────

export function encodeMessage(text: string): boolean[] {
  const bytes = Array.from(new TextEncoder().encode(text)).slice(0, MAX_MESSAGE_BYTES)
  const raw: boolean[] = [...SYNC]
  pushByte(raw, bytes.length)
  for (const b of bytes) pushByte(raw, b)
  pushByte(raw, checksum(bytes))

  const frame: boolean[] = []
  for (let i = 0; i < PREAMBLE_PAIRS; i++) frame.push(true, false)
  frame.push(...stuff(raw))
  return frame
}

/** Exact transmitted bit count, for duration estimates in the UI. */
export function frameBitCount(text: string): number {
  return encodeMessage(text).length
}

// ───────────────────────────── Decoding ─────────────────────────────

/**
 * Full pipeline: timestamped luminosity samples → text.
 * `threshold` comes from calibrateThreshold().
 */
export function decodeSamples(samples: Sample[], threshold: number): string | null {
  const states = samplesToStates(samples, threshold)
  const runs = statesToRuns(samples, states)
  return decodeRuns(runs)
}

/**
 * Delta-latch binarization with amplitude-adaptive threshold.
 *
 * A sample flips the state ON when luminosity jumps up by more than the
 * threshold vs 2 samples earlier, OFF on the opposite jump, otherwise the
 * state is held.
 *
 * The threshold is the max of the calibration noise floor and 25% of the
 * signal range over the last ~1.5s. This matters because the camera's
 * auto-exposure decays a constant ON level by ~4% of the amplitude per
 * frame — well below 25% — while a real OFF edge drops ~90% of the
 * amplitude in 1-2 frames. A noise-based threshold alone cannot separate
 * the two; an amplitude-based one can.
 */
const RANGE_WINDOW = 45        // samples (~1.5s at 30fps)
const RANGE_FRACTION = 0.25

export function samplesToStates(samples: Sample[], baseThreshold: number): boolean[] {
  const states: boolean[] = []
  for (let i = 0; i < samples.length; i++) {
    let mn = Infinity, mx = -Infinity
    for (let j = Math.max(0, i - RANGE_WINDOW); j <= i; j++) {
      const l = samples[j].lux
      if (l < mn) mn = l
      if (l > mx) mx = l
    }
    const threshold = Math.max(baseThreshold, (mx - mn) * RANGE_FRACTION)

    const prev = i > 0 ? states[i - 1] : false
    const ref = samples[Math.max(0, i - 2)].lux
    const d = samples[i].lux - ref
    states.push(d > threshold ? true : d < -threshold ? false : prev)
  }
  return states
}

/** Collapse states into runs with real durations (ms) from timestamps. */
export function statesToRuns(samples: Sample[], states: boolean[]): Run[] {
  if (samples.length === 0) return []
  const runs: Run[] = []
  let runStart = samples[0].t
  let cur = states[0]
  for (let i = 1; i < states.length; i++) {
    if (states[i] !== cur) {
      runs.push({ v: cur, ms: samples[i].t - runStart })
      runStart = samples[i].t
      cur = states[i]
    }
  }
  runs.push({ v: cur, ms: samples[samples.length - 1].t - runStart })
  return runs
}

/**
 * Noise floor from a calibration window (camera looking at ambient light):
 * threshold = 4 × mean |2-sample delta|, floor of 6 lux units.
 */
export function calibrateThreshold(samples: Sample[]): number {
  let sum = 0, n = 0
  for (let i = 2; i < samples.length; i++) {
    sum += Math.abs(samples[i].lux - samples[i - 2].lux)
    n++
  }
  const mean = n > 0 ? sum / n : 1
  return Math.max(6, mean * 4)
}

/**
 * Autobaud + decode. Scans for 6 consecutive alternating runs of similar
 * duration (the preamble), measures the real bit period from them, then
 * converts runs → bits and parses the frame. Tries every candidate window,
 * so garbage before/after the transmission is harmless — the checksum
 * arbitrates.
 */
export function decodeRuns(runs: Run[]): string | null {
  const W = 6
  for (let s = 0; s + W <= runs.length; s++) {
    const win = runs.slice(s, s + W)
    if (!win.every(r => r.ms >= 100 && r.ms <= 600)) continue

    let alternating = true
    for (let i = 1; i < W; i++) {
      if (win[i].v === win[i - 1].v) { alternating = false; break }
    }
    if (!alternating) continue

    const ds = win.map(r => r.ms).sort((a, b) => a - b)
    const T = (ds[2] + ds[3]) / 2  // median of the window
    if (ds[0] < T * 0.55 || ds[W - 1] > T * 1.7) continue

    const text = tryDecodeFrom(runs, s, T)
    if (text !== null) return text
  }
  return null
}

function tryDecodeFrom(runs: Run[], start: number, T: number): string | null {
  const bits: boolean[] = []
  for (let i = start; i < runs.length && bits.length < 1200; i++) {
    const n = Math.min(4, Math.max(1, Math.round(runs[i].ms / T)))
    for (let k = 0; k < n; k++) bits.push(runs[i].v)
  }

  outer:
  for (let p = 0; p + SYNC_PATTERN.length <= bits.length && p < 64; p++) {
    for (let k = 0; k < SYNC_PATTERN.length; k++) {
      if (bits[p + k] !== SYNC_PATTERN[k]) continue outer
    }
    // Stuffed region starts at the "11" (last 2 bits of the pattern)
    const text = parsePayload(bits.slice(p + SYNC_PATTERN.length - 2))
    if (text !== null) return text
  }
  return null
}

function parsePayload(stuffed: boolean[]): string | null {
  const raw = destuff(stuffed)
  if (raw.length < 2 + 8 + 8 + 8) return null
  if (!(raw[0] && raw[1])) return null

  const len = readByte(raw, 2)
  if (len < 1 || len > MAX_MESSAGE_BYTES) return null
  if (raw.length < 10 + len * 8 + 8) return null

  const bytes: number[] = []
  for (let j = 0; j < len; j++) bytes.push(readByte(raw, 10 + j * 8))

  if (readByte(raw, 10 + len * 8) !== checksum(bytes)) return null

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
    return text.length > 0 && isProbablyText(text) ? text : null
  } catch {
    return null
  }
}

// ───────────────────────────── Bit stuffing ─────────────────────────────

/** Insert one opposite bit after every 3 consecutive identical bits. */
function stuff(bits: boolean[]): boolean[] {
  const out: boolean[] = []
  let run = 0
  let last: boolean | null = null
  for (const bit of bits) {
    if (bit === last) run++
    else { run = 1; last = bit }
    out.push(bit)
    if (run === 3) {
      const stuffed: boolean = !bit
      out.push(stuffed)
      run = 1        // the stuffed bit itself starts a new run
      last = stuffed
    }
  }
  return out
}

/** Exact inverse of stuff(). */
function destuff(bits: boolean[]): boolean[] {
  const out: boolean[] = []
  let run = 0
  let last: boolean | null = null
  let skipNext = false
  for (const bit of bits) {
    if (skipNext) {
      skipNext = false
      run = 1      // mirror the encoder: stuffed bit starts a new run
      last = bit
      continue
    }
    if (bit === last) run++
    else { run = 1; last = bit }
    out.push(bit)
    if (run === 3) skipNext = true
  }
  return out
}

// ───────────────────────────── Helpers ─────────────────────────────

function pushByte(bits: boolean[], byte: number): void {
  for (let i = 7; i >= 0; i--) bits.push(((byte >> i) & 1) === 1)
}

function readByte(bits: boolean[], offset: number): number {
  let value = 0
  for (let i = 0; i < 8; i++) {
    if (bits[offset + i]) value |= 1 << (7 - i)
  }
  return value
}

/** Rolling XOR — order-sensitive, catches swapped bytes. */
function checksum(bytes: number[]): number {
  let c = 0xa5 ^ bytes.length
  for (const b of bytes) {
    c = (((c << 1) | (c >>> 7)) & 0xff) ^ b
  }
  return c
}

function isProbablyText(s: string): boolean {
  return [...s].every(c => {
    const n = c.charCodeAt(0)
    return (n >= 32 && n < 127) || n > 159
  })
}
