import { useRef, useState, useCallback, useEffect } from 'react'
import confetti from 'canvas-confetti'
import { decodeBytes } from '../lib/vlc-protocol'

const SAMPLE_RATE_MS = 30    // 33Hz — oversampling intentional, run-length decoder handles it
const WINDOW_SECONDS = 45

export default function ReceiverMode() {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Raw luminosity samples (not bits — run-length decoded later)
  const samplesRef  = useRef<number[]>([])
  // Adaptive threshold: set from observed min/max in first 1s
  const threshRef   = useRef<number>(140)
  const calibRef    = useRef<{ min: number; max: number; count: number }>({ min: 255, max: 0, count: 0 })

  const [listening, setListening] = useState(false)
  const [lux, setLux]             = useState(0)
  const [threshold, setThreshold] = useState(140)
  const [rawBits, setRawBits]     = useState<boolean[]>([])
  const [decoded, setDecoded]     = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [elapsed, setElapsed]     = useState(0)
  const startTimeRef              = useRef(0)

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    setListening(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setDecoded(null)
    samplesRef.current  = []
    calibRef.current    = { min: 255, max: 0, count: 0 }
    threshRef.current   = 140
    setRawBits([])
    setElapsed(0)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 320, height: 240 },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }

      setListening(true)
      startTimeRef.current = Date.now()

      intervalRef.current = setInterval(() => {
        const lum = sampleFrame(videoRef.current, canvasRef.current)
        if (lum === null) return

        setLux(lum)
        const now = Date.now()
        const secs = (now - startTimeRef.current) / 1000
        setElapsed(Math.floor(secs))

        // ── Calibration: first 800ms, measure dynamic range ──────────────
        const calib = calibRef.current
        if (calib.count < 27) { // ~800ms at 30ms intervals
          calib.min = Math.min(calib.min, lum)
          calib.max = Math.max(calib.max, lum)
          calib.count++
          if (calib.count === 27 && calib.max - calib.min > 20) {
            threshRef.current = calib.min + (calib.max - calib.min) * 0.5
            setThreshold(Math.round(threshRef.current))
          }
          return // don't accumulate during calibration
        }

        samplesRef.current.push(lum)

        // ── Decode attempt every ~300ms (10 new samples) ─────────────────
        if (samplesRef.current.length % 10 === 0) {
          const bits = runLengthDecode(samplesRef.current, threshRef.current)
          setRawBits(bits)
          const result = decodeBytes(bits)
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
  }, [stop])

  useEffect(() => () => stop(), [stop])

  const luxPct = Math.round((lux / 255) * 100)
  const isHi   = lux > threshRef.current
  const displayBits = rawBits.slice(-80)

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="p-6 pt-10 flex flex-col items-center gap-2">
        <span className="text-xs font-mono tracking-widest text-indigo-400 uppercase">Camera Analysis</span>
        <h1 className="text-3xl font-bold text-white tracking-tight">Receiver</h1>
      </div>

      <div className="flex justify-center px-6 mb-4">
        <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-black w-full max-w-sm aspect-video">
          <video ref={videoRef} className="w-full h-full object-cover opacity-70" muted playsInline />
          {listening && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-0 right-0 h-0.5 bg-indigo-500/60 animate-scan" />
              <div className="absolute top-2 left-2 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-mono">
                  {samplesRef.current.length < 1 ? 'CALIBRATING…' : 'REC'}
                </span>
              </div>
              <div className="absolute bottom-2 right-2 text-indigo-300 text-xs font-mono">
                {elapsed}s / {WINDOW_SECONDS}s
              </div>
            </div>
          )}
          {!listening && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-slate-500 text-sm font-mono">Camera off</span>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="flex-1 flex flex-col items-center px-6 gap-5">
        {listening && (
          <div className="w-full max-w-sm">
            <div className="flex justify-between text-xs font-mono text-slate-400 mb-1">
              <span>Luminosity</span>
              <span className={isHi ? 'text-white font-bold' : 'text-slate-500'}>
                {luxPct}% {isHi ? '● HI' : '○ lo'}
              </span>
            </div>
            <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-75 ${isHi ? 'bg-white' : 'bg-indigo-600'}`}
                style={{ width: `${luxPct}%` }}
              />
            </div>
            <div className="mt-1 text-xs font-mono text-slate-600">
              seuil auto: {threshold}/255
            </div>
          </div>
        )}

        {rawBits.length > 0 && (
          <div className="w-full max-w-sm">
            <p className="text-slate-500 text-xs font-mono mb-1">
              {rawBits.length} bits décodés (run-length)
            </p>
            <div className="flex flex-wrap gap-0.5">
              {displayBits.map((b, i) => (
                <span key={i} className={`w-2.5 h-2.5 rounded-sm ${b ? 'bg-white' : 'bg-slate-700'}`} />
              ))}
            </div>
          </div>
        )}

        {decoded !== null && (
          <div className="w-full max-w-sm bg-green-950 border border-green-700 rounded-2xl p-5">
            <p className="text-green-400 text-xs font-mono mb-2 tracking-widest uppercase">✓ Message reçu</p>
            <p className="text-white text-xl font-bold break-words">{decoded}</p>
          </div>
        )}

        {error && <p className="text-red-400 text-xs font-mono text-center max-w-sm">⚠ {error}</p>}

        <div className="w-full max-w-sm">
          {!listening ? (
            <button onClick={start} className="w-full py-4 rounded-xl font-bold text-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">
              Start Receiving
            </button>
          ) : (
            <button onClick={stop} className="w-full py-4 rounded-xl font-bold text-lg bg-red-700 text-white hover:bg-red-600 transition-colors">
              Stop
            </button>
          )}
        </div>

        {!listening && !decoded && (
          <p className="text-slate-600 text-xs font-mono text-center max-w-xs">
            Pointe la caméra vers la lampe ou l'écran de l'émetteur, puis appuie sur Start.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Convert raw luminosity samples into bits via run-length decoding.
 *
 * Each "run" of consecutive above/below-threshold samples gets compressed
 * into N bits where N = round(run_length / estimated_min_run).
 * This compensates for oversampling (multiple samples per bit period).
 */
function runLengthDecode(samples: number[], threshold: number): boolean[] {
  if (samples.length < 8) return []

  // Binarize
  const binary = samples.map(s => s > threshold)

  // Build runs
  const runs: { v: boolean; n: number }[] = []
  let cur = binary[0], count = 1
  for (let i = 1; i < binary.length; i++) {
    if (binary[i] === cur) { count++ }
    else { runs.push({ v: cur, n: count }); cur = binary[i]; count = 1 }
  }
  runs.push({ v: cur, n: count })

  if (runs.length < 2) return []

  // Estimate 1-bit period = 10th percentile of run lengths
  const sorted = runs.map(r => r.n).sort((a, b) => a - b)
  const p10idx  = Math.max(0, Math.floor(sorted.length * 0.1))
  const minRun  = Math.max(1, sorted[p10idx])

  // Reconstruct bits
  const bits: boolean[] = []
  for (const run of runs) {
    const nBits = Math.max(1, Math.round(run.n / minRun))
    for (let i = 0; i < nBits; i++) bits.push(run.v)
  }

  return bits
}

function celebrate() {
  confetti({
    particleCount: 160,
    spread: 90,
    origin: { y: 0.6 },
    colors: ['#6366f1', '#a5b4fc', '#818cf8', '#ffffff', '#fbbf24'],
  })
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
