import { useRef, useState, useCallback, useEffect } from 'react'
import confetti from 'canvas-confetti'
import { decodeBytes, BIT_DURATION_MS } from '../lib/vlc-protocol'

const SAMPLE_RATE_MS  = 50                                         // 20 Hz
const SAMPLES_PER_BIT = Math.round(BIT_DURATION_MS / SAMPLE_RATE_MS) // = 10
const WINDOW_SECONDS  = 90
// Rolling average window for differential detection (~1 bit period of history)
const AVG_WINDOW      = SAMPLES_PER_BIT

export default function ReceiverMode() {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const samplesRef  = useRef<number[]>([])

  const [listening, setListening]     = useState(false)
  const [lux, setLux]                 = useState(0)
  const [luxHist, setLuxHist]         = useState<number[]>([])
  const [rawBits, setRawBits]         = useState<boolean[]>([])
  const [decoded, setDecoded]         = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [elapsed, setElapsed]         = useState(0)
  const [transitions, setTransitions] = useState(0)
  const startTimeRef                  = useRef(0)
  const luxHistRef                    = useRef<number[]>([])

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    setListening(false)
  }, [])

  const tryDecode = useCallback((samples: number[]): string | null => {
    const bits = rldDecode(samples, SAMPLES_PER_BIT)
    if (bits.length > 0) setRawBits(bits)
    return decodeBytes(bits)
  }, [])

  const stopAndDecode = useCallback(() => {
    const result = tryDecode(samplesRef.current)
    if (result !== null) { setDecoded(result); celebrate() }
    stop()
  }, [stop, tryDecode])

  const start = useCallback(async () => {
    setError(null)
    setDecoded(null)
    setRawBits([])
    setElapsed(0)
    setTransitions(0)
    setLuxHist([])
    samplesRef.current  = []
    luxHistRef.current  = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 320, height: 240 },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      setListening(true)
      startTimeRef.current = Date.now()

      intervalRef.current = setInterval(() => {
        const lum = sampleFrame(videoRef.current, canvasRef.current)
        if (lum === null) return

        setLux(lum)

        // Sparkline
        luxHistRef.current = [...luxHistRef.current.slice(-39), lum]
        setLuxHist([...luxHistRef.current])

        // Count transitions (for debug feedback)
        const prev = samplesRef.current[samplesRef.current.length - 1]
        if (prev !== undefined) {
          const prevBit = isHighRelative(samplesRef.current, prev)
          const curBit  = isHighRelative(samplesRef.current, lum)
          if (prevBit !== curBit) setTransitions(t => t + 1)
        }

        samplesRef.current.push(lum)

        const secs = (Date.now() - startTimeRef.current) / 1000
        setElapsed(Math.floor(secs))

        // Try decode every half bit period
        if (samplesRef.current.length % Math.ceil(SAMPLES_PER_BIT / 2) === 0) {
          const result = tryDecode(samplesRef.current)
          if (result !== null) {
            setDecoded(result)
            stop()
            celebrate()
            return
          }
        }

        if (secs >= WINDOW_SECONDS) stop()
      }, SAMPLE_RATE_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [stop, tryDecode])

  useEffect(() => () => stop(), [stop])

  // Compute rolling avg for display
  const recent = samplesRef.current.slice(-AVG_WINDOW)
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : lux
  const isHi = lux > avg * 1.08

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="p-6 pt-10 flex flex-col items-center gap-2">
        <span className="text-xs font-mono tracking-widest text-indigo-400 uppercase">Camera Analysis</span>
        <h1 className="text-3xl font-bold text-white tracking-tight">Receiver</h1>
      </div>

      {/* Video */}
      <div className="flex justify-center px-6 mb-4">
        <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-black w-full max-w-sm aspect-video">
          <video ref={videoRef} className="w-full h-full object-cover opacity-80" muted playsInline />
          {listening && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-0 right-0 h-0.5 bg-indigo-500/60 animate-scan" />
              <div className="absolute top-2 left-2 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-mono">REC {elapsed}s</span>
              </div>
              <div className="absolute bottom-2 right-2 text-indigo-300 text-xs font-mono">
                {transitions} transitions
              </div>
            </div>
          )}
          {!listening && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-slate-500 text-sm font-mono">Caméra off</span>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="flex-1 flex flex-col items-center px-6 gap-4">

        {/* Live lux indicator */}
        {listening && (
          <div className="w-full max-w-sm space-y-2">
            <div className="flex justify-between text-xs font-mono text-slate-400">
              <span>Luminosité (différentielle)</span>
              <span className={isHi ? 'text-white font-bold' : 'text-slate-500'}>
                {Math.round(lux)}/255 · moy {Math.round(avg)} · {isHi ? '● HI' : '○ lo'}
              </span>
            </div>

            {/* Sparkline — bars turn white when above rolling avg */}
            <div className="flex items-end gap-px h-10 bg-slate-900 rounded-lg px-1 py-1">
              {luxHist.map((v, i) => {
                const localSlice = luxHist.slice(Math.max(0, i - AVG_WINDOW), i)
                const localAvg = localSlice.length
                  ? localSlice.reduce((a, b) => a + b, 0) / localSlice.length
                  : v
                const hi = v > localAvg * 1.08
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-sm ${hi ? 'bg-white' : 'bg-indigo-800'}`}
                    style={{ height: `${Math.max(4, Math.round((v / 255) * 100))}%` }}
                  />
                )
              })}
            </div>

            <p className="text-slate-600 text-xs font-mono">
              Les barres doivent alterner blanc/sombre lors des flashs de l'émetteur.
              {transitions < 5 && elapsed > 3 ? ' ⚠ Peu de transitions — approche les écrans.' : ''}
            </p>
          </div>
        )}

        {/* Bit stream visualizer */}
        {rawBits.length > 0 && (
          <div className="w-full max-w-sm">
            <p className="text-slate-500 text-xs font-mono mb-1">
              {rawBits.length} bits reconstruits
            </p>
            <div className="flex flex-wrap gap-0.5">
              {rawBits.slice(-80).map((b, i) => (
                <span key={i} className={`w-2.5 h-2.5 rounded-sm ${b ? 'bg-white' : 'bg-slate-700'}`} />
              ))}
            </div>
          </div>
        )}

        {/* Result */}
        {decoded !== null && (
          <div className="w-full max-w-sm bg-green-950 border border-green-700 rounded-2xl p-5">
            <p className="text-green-400 text-xs font-mono mb-2 tracking-widest uppercase">✓ Message reçu</p>
            <p className="text-white text-xl font-bold break-words">{decoded}</p>
          </div>
        )}

        {error && <p className="text-red-400 text-xs font-mono text-center max-w-sm">⚠ {error}</p>}

        {/* Buttons */}
        <div className="w-full max-w-sm space-y-2">
          {!listening ? (
            <button onClick={start} className="w-full py-4 rounded-xl font-bold text-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">
              Start Receiving
            </button>
          ) : (
            <button onClick={stopAndDecode} className="w-full py-4 rounded-xl font-bold text-lg bg-red-700 text-white hover:bg-red-600 transition-colors">
              Stop &amp; Décoder
            </button>
          )}
        </div>

        {/* Step-by-step */}
        {!listening && !decoded && (
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
            <p className="text-slate-400 text-xs font-mono uppercase tracking-widest mb-3">Mode opératoire</p>
            <Step n={1} text="Lance le Récepteur ici en premier" />
            <Step n={2} text="Sur l'autre appareil, ouvre l'Emetteur et tape un message court (ex: VLC)" />
            <Step n={3} text="Approche les deux écrans face à face, à moins de 15 cm" />
            <Step n={4} text="L'émetteur clignote — tu dois voir les barres du graphe alterner" />
            <Step n={5} text="Le message apparaît automatiquement, ou appuie sur Stop & Décoder" />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Differential bit detection: a sample is HIGH if it's 8%+ above
 * the rolling average of the last AVG_WINDOW samples.
 * This cancels out slow auto-exposure drift.
 */
function isHighRelative(history: number[], current: number): boolean {
  if (history.length < 3) return false
  const window = history.slice(-AVG_WINDOW)
  const avg = window.reduce((a, b) => a + b, 0) / window.length
  return current > avg * 1.08
}

/**
 * Run-length decode using a fixed known samples-per-bit ratio.
 * Median filter applied first to kill single-sample noise spikes.
 */
function rldDecode(samples: number[], samplesPerBit: number): boolean[] {
  if (samples.length < samplesPerBit * 4) return []

  // Median filter (window=3)
  const filtered = samples.map((_, i) => {
    const w = [
      samples[Math.max(0, i - 1)],
      samples[i],
      samples[Math.min(samples.length - 1, i + 1)],
    ].sort((a, b) => a - b)
    return w[1]
  })

  // Differential binarization: HIGH = 8% above rolling avg
  const binary: boolean[] = []
  for (let i = 0; i < filtered.length; i++) {
    const window = filtered.slice(Math.max(0, i - AVG_WINDOW), i)
    const avg = window.length ? window.reduce((a, b) => a + b, 0) / window.length : filtered[i]
    binary.push(filtered[i] > avg * 1.08)
  }

  // Build runs
  const runs: { v: boolean; n: number }[] = []
  let cur = binary[0], count = 1
  for (let i = 1; i < binary.length; i++) {
    if (binary[i] === cur) count++
    else { runs.push({ v: cur, n: count }); cur = binary[i]; count = 1 }
  }
  runs.push({ v: cur, n: count })

  // Reconstruct bits
  const bits: boolean[] = []
  for (const run of runs) {
    const nBits = Math.max(1, Math.round(run.n / samplesPerBit))
    for (let i = 0; i < nBits; i++) bits.push(run.v)
  }

  return bits
}

function sampleFrame(video: HTMLVideoElement | null, canvas: HTMLCanvasElement | null): number | null {
  if (!video || !canvas || video.readyState < 2) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const W = 64, H = 64
  canvas.width = W; canvas.height = H
  ctx.drawImage(video, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H).data
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return sum / (W * H)
}

function celebrate() {
  confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 }, colors: ['#6366f1', '#a5b4fc', '#818cf8', '#ffffff', '#fbbf24'] })
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {n}
      </span>
      <p className="text-slate-400 text-xs">{text}</p>
    </div>
  )
}
