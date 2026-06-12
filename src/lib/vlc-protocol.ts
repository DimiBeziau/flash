/**
 * VLC Protocol — simple framed binary encoding over light pulses.
 *
 * Frame structure:
 *   PREAMBLE (8 bits: 10101010) + START (8 bits: 11111111)
 *   + LENGTH (8 bits) + DATA bytes + STOP (8 bits: 00000000)
 *
 * Each bit is one time-slot at the configured frequency.
 * 1 = light ON, 0 = light OFF.
 */

export const PREAMBLE = 0b10101010  // sync pattern
export const START    = 0b11111111  // frame start
export const STOP     = 0b00000000  // frame end

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

export function decodeBytes(bits: boolean[]): string | null {
  // Locate START marker after PREAMBLE
  let i = 0
  while (i < bits.length - 8) {
    const byte = readByte(bits, i)
    if (byte === PREAMBLE) {
      i += 8
      if (readByte(bits, i) === START) {
        i += 8
        break
      }
    } else {
      i++
    }
  }

  if (i >= bits.length - 8) return null

  const length = readByte(bits, i)
  i += 8

  if (i + length * 8 + 8 > bits.length) return null

  const bytes: number[] = []
  for (let j = 0; j < length; j++) {
    bytes.push(readByte(bits, i))
    i += 8
  }

  if (readByte(bits, i) !== STOP) return null

  return new TextDecoder().decode(new Uint8Array(bytes))
}

function readByte(bits: boolean[], offset: number): number {
  let value = 0
  for (let i = 0; i < 8; i++) {
    if (bits[offset + i]) value |= 1 << (7 - i)
  }
  return value
}

export function totalBits(text: string): number {
  const byteLen = new TextEncoder().encode(text).length
  // preamble + start + length + data + stop
  return (1 + 1 + 1 + byteLen + 1) * 8
}
