/**
 * Offline end-to-end test of the VLC protocol.
 *
 * Simulates the full physical chain:
 *   encodeMessage → emitter timing jitter → camera sampling with
 *   auto-exposure adaptation, sensor ramp, noise, dropped frames
 *   → calibrateThreshold + decodeSamples
 *
 * Run: npm run test:proto
 */
import {
  encodeMessage,
  decodeSamples,
  calibrateThreshold,
  BIT_DURATION_MS,
} from './.build/vlc-protocol.mjs'

// Deterministic PRNG so failures are reproducible
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * Simulate the camera's view of a transmission.
 * Returns timestamped luminosity samples covering:
 *   [0 .. calib] ambient only (receiver calibration window)
 *   [preMs .. ] the transmission
 *   [.. +1.2s] ambient again
 */
function simulate(message, seed, opts = {}) {
  const rng = mulberry32(seed)
  const bits = encodeMessage(message)
  const T = BIT_DURATION_MS

  const ambientBase = opts.ambient ?? 55
  const onLux = opts.onLux ?? 215
  const expTau = opts.expTau ?? 900      // auto-exposure time constant (ms)
  const ramp = opts.ramp ?? 0.65         // sensor smoothing per frame
  const captureFrom = opts.captureFrom ?? 0  // simulate late camera pointing

  const preMs = 1500 + 500 + rng() * 1500

  // Absolute-scheduled emitter: per-boundary lateness, NON-cumulative
  const starts = bits.map((_, k) => preMs + k * T + rng() * 25)
  const endT = preMs + bits.length * T + rng() * 25
  const stateAt = t => {
    if (t < starts[0] || t >= endT) return false
    let k = 0
    while (k + 1 < starts.length && starts[k + 1] <= t) k++
    return bits[k]
  }

  const samples = []
  let rawEMA = ambientBase
  let meas = ambientBase
  let prevT = 0
  for (let t = 0; t < endT + 1200; ) {
    const dt = t - prevT
    prevT = t

    const ambient = ambientBase + 5 * Math.sin(t / 650)
    const raw = stateAt(t) ? onLux : ambient

    // Auto-exposure: gain drifts toward keeping the average at ~110
    rawEMA += (raw - rawEMA) * Math.min(1, dt / expTau)
    const gain = clamp(110 / Math.max(40, rawEMA), 0.5, 2.0)

    // Sensor ramp: measured value approaches target over ~2 frames
    const target = clamp(raw * gain, 0, 255)
    meas += (target - meas) * ramp

    if (t >= captureFrom) {
      samples.push({ t, lux: clamp(meas + (rng() * 4 - 2), 0, 255) })
    }

    t += 28 + rng() * 12          // ~30 fps with jitter
    if (rng() < 0.02) t += 80     // occasional dropped frame
  }
  return samples
}

function runCase(message, seed, opts = {}) {
  const samples = simulate(message, seed, opts)
  const calib = samples.filter(s => s.t < 1400)
  const live = samples.filter(s => s.t >= 1500)
  if (calib.length < 10) {
    // Camera pointed late: no calib window — use a default threshold
    return decodeSamples(live, 12) === message
  }
  const th = calibrateThreshold(calib)
  return decodeSamples(live, th) === message
}

const MESSAGES = ['VLC', 'HI', 'TEST', 'Cafe!']
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

let pass = 0, fail = 0
const failures = []

for (const msg of MESSAGES) {
  for (const seed of SEEDS) {
    if (runCase(msg, seed)) pass++
    else { fail++; failures.push(`"${msg}" seed=${seed} (nominal)`) }
  }
}

// Stress variants
const stress = [
  { name: 'low contrast', opts: { onLux: 140, ambient: 70 } },
  { name: 'fast auto-exposure', opts: { expTau: 500 } },
  { name: 'slow sensor ramp', opts: { ramp: 0.45 } },
  { name: 'late camera (misses 800ms)', opts: { captureFrom: 1500 } },
]
for (const { name, opts } of stress) {
  for (const msg of ['VLC', 'TEST']) {
    for (const seed of [11, 12, 13]) {
      if (runCase(msg, seed, opts)) pass++
      else { fail++; failures.push(`"${msg}" seed=${seed} (${name})`) }
    }
  }
}

console.log(`${pass} passed, ${fail} failed`)
if (failures.length > 0) {
  console.log('Failures:')
  for (const f of failures) console.log('  -', f)
  process.exit(1)
}
