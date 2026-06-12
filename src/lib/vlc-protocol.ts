/**
 * VLC Protocol — framed binary encoding over light pulses.
 *
 * Frame: PREAMBLE(10101010) + START(11111111) + LENGTH(8b) + DATA + STOP(00000000)
 * 1 = light ON, 0 = light OFF.
 */

export const BIT_DURATION_MS = 500  // shared by emitter & receiver (2 Hz)

export const PREAMBLE = 0b10101010
export const START    = 0b11111111
export const STOP     = 0b00000000

export function encodeMessage(text: string): boolean[] {
  const bytes = new TextEncoder().encode(text)
  const bits: boolean[] = []
  const pushByte = (byte: number) => {
    for (let i = 7; i >= 0; i--) bits.push(Boolean((byte >> i) & 1))
  }
  pushByte(PREAMBLE)
  pushByte(START)
  pushByte(bytes.length)
  for (const b of bytes) pushByte(b)
  pushByte(STOP)
  return bits
}

/**
 * Scans the bit array for a valid frame.
 * Tolerates 1-bit errors in the PREAMBLE and skips the STOP check
 * (physical channel noise can corrupt the last byte).
 */
export function decodeBytes(bits: boolean[]): string | null {
  for (let start = 0; start <= bits.length - 24; start++) {
    // Allow up to 1 bit error in preamble
    const pre = readByte(bits, start)
    const hammingToPreamble = hammingDistance(pre, PREAMBLE)
    if (hammingToPreamble > 1) continue

    const startByte = readByte(bits, start + 8)
    if (startByte !== START) continue

    const length = readByte(bits, start + 16)
    if (length === 0 || length > 64) continue  // sanity: max 64 chars

    const dataStart = start + 24
    if (dataStart + length * 8 > bits.length) continue

    const bytes: number[] = []
    for (let j = 0; j < length; j++) {
      bytes.push(readByte(bits, dataStart + j * 8))
    }

    try {
      const text = new TextDecoder().decode(new Uint8Array(bytes))
      // Basic sanity: only accept printable ASCII / UTF-8
      if (text.length > 0 && isProbablyText(text)) return text
    } catch {
      continue
    }
  }
  return null
}

function readByte(bits: boolean[], offset: number): number {
  let value = 0
  for (let i = 0; i < 8; i++) {
    if (bits[offset + i]) value |= 1 << (7 - i)
  }
  return value
}

function hammingDistance(a: number, b: number): number {
  let x = a ^ b
  let count = 0
  while (x) { count += x & 1; x >>= 1 }
  return count
}

function isProbablyText(s: string): boolean {
  return [...s].every(c => {
    const code = c.charCodeAt(0)
    return (code >= 32 && code < 127) || code > 159
  })
}

export function totalBits(text: string): number {
  const byteLen = new TextEncoder().encode(text).length
  return (1 + 1 + 1 + byteLen + 1) * 8
}
