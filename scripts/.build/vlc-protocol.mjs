// src/lib/vlc-protocol.ts
var BIT_DURATION_MS = 250;
var MAX_MESSAGE_BYTES = 16;
var PREAMBLE_PAIRS = 5;
var SYNC = [true, true];
var SYNC_PATTERN = [true, false, true, false, true, false, true, true];
function encodeMessage(text) {
  const bytes = Array.from(new TextEncoder().encode(text)).slice(0, MAX_MESSAGE_BYTES);
  const raw = [...SYNC];
  pushByte(raw, bytes.length);
  for (const b of bytes) pushByte(raw, b);
  pushByte(raw, checksum(bytes));
  const frame = [];
  for (let i = 0; i < PREAMBLE_PAIRS; i++) frame.push(true, false);
  frame.push(...stuff(raw));
  return frame;
}
function frameBitCount(text) {
  return encodeMessage(text).length;
}
function decodeSamples(samples, threshold) {
  const states = samplesToStates(samples, threshold);
  const runs = statesToRuns(samples, states);
  return decodeRuns(runs);
}
var RANGE_WINDOW = 45;
var RANGE_FRACTION = 0.25;
function samplesToStates(samples, baseThreshold) {
  const states = [];
  for (let i = 0; i < samples.length; i++) {
    let mn = Infinity, mx = -Infinity;
    for (let j = Math.max(0, i - RANGE_WINDOW); j <= i; j++) {
      const l = samples[j].lux;
      if (l < mn) mn = l;
      if (l > mx) mx = l;
    }
    const threshold = Math.max(baseThreshold, (mx - mn) * RANGE_FRACTION);
    const prev = i > 0 ? states[i - 1] : false;
    const ref = samples[Math.max(0, i - 2)].lux;
    const d = samples[i].lux - ref;
    states.push(d > threshold ? true : d < -threshold ? false : prev);
  }
  return states;
}
function statesToRuns(samples, states) {
  if (samples.length === 0) return [];
  const runs = [];
  let runStart = samples[0].t;
  let cur = states[0];
  for (let i = 1; i < states.length; i++) {
    if (states[i] !== cur) {
      runs.push({ v: cur, ms: samples[i].t - runStart });
      runStart = samples[i].t;
      cur = states[i];
    }
  }
  runs.push({ v: cur, ms: samples[samples.length - 1].t - runStart });
  return runs;
}
function calibrateThreshold(samples) {
  let sum = 0, n = 0;
  for (let i = 2; i < samples.length; i++) {
    sum += Math.abs(samples[i].lux - samples[i - 2].lux);
    n++;
  }
  const mean = n > 0 ? sum / n : 1;
  return Math.max(6, mean * 4);
}
function decodeRuns(runs) {
  const W = 6;
  for (let s = 0; s + W <= runs.length; s++) {
    const win = runs.slice(s, s + W);
    if (!win.every((r) => r.ms >= 100 && r.ms <= 600)) continue;
    let alternating = true;
    for (let i = 1; i < W; i++) {
      if (win[i].v === win[i - 1].v) {
        alternating = false;
        break;
      }
    }
    if (!alternating) continue;
    const ds = win.map((r) => r.ms).sort((a, b) => a - b);
    const T = (ds[2] + ds[3]) / 2;
    if (ds[0] < T * 0.55 || ds[W - 1] > T * 1.7) continue;
    const text = tryDecodeFrom(runs, s, T);
    if (text !== null) return text;
  }
  return null;
}
function tryDecodeFrom(runs, start, T) {
  const bits = [];
  for (let i = start; i < runs.length && bits.length < 1200; i++) {
    const n = Math.min(4, Math.max(1, Math.round(runs[i].ms / T)));
    for (let k = 0; k < n; k++) bits.push(runs[i].v);
  }
  outer:
    for (let p = 0; p + SYNC_PATTERN.length <= bits.length && p < 64; p++) {
      for (let k = 0; k < SYNC_PATTERN.length; k++) {
        if (bits[p + k] !== SYNC_PATTERN[k]) continue outer;
      }
      const text = parsePayload(bits.slice(p + SYNC_PATTERN.length - 2));
      if (text !== null) return text;
    }
  return null;
}
function parsePayload(stuffed) {
  const raw = destuff(stuffed);
  if (raw.length < 2 + 8 + 8 + 8) return null;
  if (!(raw[0] && raw[1])) return null;
  const len = readByte(raw, 2);
  if (len < 1 || len > MAX_MESSAGE_BYTES) return null;
  if (raw.length < 10 + len * 8 + 8) return null;
  const bytes = [];
  for (let j = 0; j < len; j++) bytes.push(readByte(raw, 10 + j * 8));
  if (readByte(raw, 10 + len * 8) !== checksum(bytes)) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    return text.length > 0 && isProbablyText(text) ? text : null;
  } catch {
    return null;
  }
}
function stuff(bits) {
  const out = [];
  let run = 0;
  let last = null;
  for (const bit of bits) {
    if (bit === last) run++;
    else {
      run = 1;
      last = bit;
    }
    out.push(bit);
    if (run === 3) {
      const stuffed = !bit;
      out.push(stuffed);
      run = 1;
      last = stuffed;
    }
  }
  return out;
}
function destuff(bits) {
  const out = [];
  let run = 0;
  let last = null;
  let skipNext = false;
  for (const bit of bits) {
    if (skipNext) {
      skipNext = false;
      run = 1;
      last = bit;
      continue;
    }
    if (bit === last) run++;
    else {
      run = 1;
      last = bit;
    }
    out.push(bit);
    if (run === 3) skipNext = true;
  }
  return out;
}
function pushByte(bits, byte) {
  for (let i = 7; i >= 0; i--) bits.push((byte >> i & 1) === 1);
}
function readByte(bits, offset) {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    if (bits[offset + i]) value |= 1 << 7 - i;
  }
  return value;
}
function checksum(bytes) {
  let c = 165 ^ bytes.length;
  for (const b of bytes) {
    c = (c << 1 | c >>> 7) & 255 ^ b;
  }
  return c;
}
function isProbablyText(s) {
  return [...s].every((c) => {
    const n = c.charCodeAt(0);
    return n >= 32 && n < 127 || n > 159;
  });
}
export {
  BIT_DURATION_MS,
  MAX_MESSAGE_BYTES,
  calibrateThreshold,
  decodeRuns,
  decodeSamples,
  encodeMessage,
  frameBitCount,
  samplesToStates,
  statesToRuns
};
