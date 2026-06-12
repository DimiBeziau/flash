/** Step-by-step debug of one simulation case. */
import {
  encodeMessage,
  calibrateThreshold,
  samplesToStates,
  statesToRuns,
  decodeRuns,
  BIT_DURATION_MS,
} from './.build/vlc-protocol.mjs'

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

const message = 'VLC'
const seed = 1
const rng = mulberry32(seed)
const bits = encodeMessage(message)
const T = BIT_DURATION_MS

console.log('=== ENCODED BITS ===')
console.log(bits.map(b => (b ? '1' : '0')).join(''))
console.log('count:', bits.length)

const ambientBase = 55, onLux = 215, expTau = 900, ramp = 0.65
const preMs = 1500 + 500 + rng() * 1500
const starts = bits.map((_, k) => preMs + k * T + rng() * 25)
const endT = preMs + bits.length * T + rng() * 25
const stateAt = t => {
  if (t < starts[0] || t >= endT) return false
  let k = 0
  while (k + 1 < starts.length && starts[k + 1] <= t) k++
  return bits[k]
}

const samples = []
let rawEMA = ambientBase, meas = ambientBase, prevT = 0
for (let t = 0; t < endT + 1200; ) {
  const dt = t - prevT
  prevT = t
  const ambient = ambientBase + 5 * Math.sin(t / 650)
  const raw = stateAt(t) ? onLux : ambient
  rawEMA += (raw - rawEMA) * Math.min(1, dt / expTau)
  const gain = clamp(110 / Math.max(40, rawEMA), 0.5, 2.0)
  const target = clamp(raw * gain, 0, 255)
  meas += (target - meas) * ramp
  samples.push({ t, lux: clamp(meas + (rng() * 4 - 2), 0, 255) })
  t += 28 + rng() * 12
  if (rng() < 0.02) t += 80
}

const calib = samples.filter(s => s.t < 1400)
const live = samples.filter(s => s.t >= 1500)
const th = calibrateThreshold(calib)
console.log('\n=== THRESHOLD ===', th.toFixed(1))

const states = samplesToStates(live, th)
const runs = statesToRuns(live, states)
console.log('\n=== RUNS (v:ms) ===')
console.log(runs.map(r => `${r.v ? 1 : 0}:${Math.round(r.ms)}`).join(' '))

// Expected runs from the original bits
const expRuns = []
let cur = bits[0], n = 1
for (let i = 1; i < bits.length; i++) {
  if (bits[i] === cur) n++
  else { expRuns.push(`${cur ? 1 : 0}x${n}`); cur = bits[i]; n = 1 }
}
expRuns.push(`${cur ? 1 : 0}x${n}`)
console.log('\n=== EXPECTED RUNS (v x bits) ===')
console.log(expRuns.join(' '))

console.log('\n=== DECODE ===', JSON.stringify(decodeRuns(runs)))
