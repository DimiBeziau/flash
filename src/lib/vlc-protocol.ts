/**
 * VLC Protocol — framed binary with bit stuffing.
 *
 * Frame: PREAMBLE(10101010) + START(11001100) + LENGTH(8b) + DATA + STOP(00110011)
 *
 * Bit stuffing: after 3 consecutive identical bits, one opposite bit is inserted.
 * This guarantees a transition at least every 1.5 bit-periods, preventing the
 * camera's auto-exposure from locking onto a constant level.
 */

export const BIT_DURATION_MS = 500

// Framing bytes chosen to have max run length = 2 (no stuffing needed on them)
const PREAMBLE = 0b10101010  // alternating — unambiguous sync pattern
const START    = 0b11001100  // balanced
const STOP     = 0b00110011  // balanced

export function encodeMessage(text: string): boolean[] {
  const bytes = new TextEncoder().encode(text)
  const raw: boolean[] = []

  const pushByte = (byte: number) => {
    for (let i = 7; i >= 0; i--) raw.push(Boolean((byte >> i) & 1))
  }

  pushByte(PREAMBLE)
  pushByte(START)
  pushByte(bytes.length)
  for (const b of bytes) pushByte(b)
  pushByte(STOP)

  return stuffBits(raw)
}

export function decodeBytes(bits: boolean[]): string | null {
  const raw = destuffBits(bits)

  // Scan for preamble with up to 1 bit tolerance
  for (let start = 0; start <= raw.length - 24; start++) {
    if (hammingDistance(readByte(raw, start), PREAMBLE) > 1) continue
    if (readByte(raw, start + 8) !== START) continue

    const length = readByte(raw, start + 16)
    if (length === 0 || length > 64) continue

    const dataStart = start + 24
    if (dataStart + length * 8 > raw.length) continue

    const bytes: number[] = []
    for (let j = 0; j < length; j++) bytes.push(readByte(raw, dataStart + j * 8))

    try {
      const text = new TextDecoder().decode(new Uint8Array(bytes))
      if (text.length > 0 && isProbablyText(text)) return text
    } catch { continue }
  }
  return null
}

/** Insert one opposite bit after every 3 consecutive identical bits. */
function stuffBits(bits: boolean[]): boolean[] {
  const out: boolean[] = []
  let run = 0
  let last: boolean | null = null

  for (const bit of bits) {
    if (bit === last) run++
    else { run = 1; last = bit }

    out.push(bit)

    if (run === 3) {
      out.push(!bit)   // stuffed bit
      run = 0
      last = null
    }
  }
  return out
}

/** Remove every bit that was inserted by stuffBits. */
function destuffBits(bits: boolean[]): boolean[] {
  const out: boolean[] = []
  let run = 0
  let last: boolean | null = null
  let skipNext = false

  for (const bit of bits) {
    if (skipNext) { skipNext = false; run = 0; last = null; continue }

    if (bit === last) run++
    else { run = 1; last = bit }

    out.push(bit)

    if (run === 3) { skipNext = true; run = 0; last = null }
  }
  return out
}

function readByte(bits: boolean[], offset: number): number {
  let value = 0
  for (let i = 0; i < 8; i++) {
    if (bits[offset + i]) value |= 1 << (7 - i)
  }
  return value
}

function hammingDistance(a: number, b: number): number {
  let x = a ^ b, c = 0
  while (x) { c += x & 1; x >>= 1 }
  return c
}

function isProbablyText(s: string): boolean {
  return [...s].every(c => { const n = c.charCodeAt(0); return (n >= 32 && n < 127) || n > 159 })
}

export function totalBits(text: string): number {
  const byteLen = new TextEncoder().encode(text).length
  // raw bits + ~25% overhead from stuffing (worst case)
  return Math.ceil((1 + 1 + 1 + byteLen + 1) * 8 * 1.25)
}
