import { useRef, useState, useCallback, useEffect } from 'react'
import confetti from 'canvas-confetti'
import { decodeBytes, BIT_DURATION_MS } from '../lib/vlc-protocol'

const SAMPLE_RATE_MS     = 40                                    // 25 Hz
const SAMPLES_PER_BIT    = Math.round(BIT_DURATION_MS / SAMPLE_RATE_MS) // = 5
const WINDOW_SECONDS     = 60

export default function ReceiverMode() {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const samplesRef  = useRef<number[]>([])
  const luxHistRef  = useRef<number[]>([])  // last 30 lux values for sparkline

  const [listening, setListening]   = useState(false)
  const [lux, setLux]               = useState(0)
  const [threshold, setThreshold]   = useState(128)
  const [rawBits, setRawBits]       = useState<boolean[]>([])
  const [decoded, setDecoded]       = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [elapsed, setElapsed]       = useState(0)
  const [luxHist, setLuxHist]       = useState<number[]>([])
  const [transitions, setTransitions] = useState(0)
  const startTimeRef                = useRef(0)

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    setListening(false)
  }, [])

  const tryDecode = useCallback((samples: number[], thresh: number): string | null => {
    const bits = rldDecode(samples, thresh, SAMPLES_PER_BIT)
    setRawBits(bits)
    return decodeBytes(bits)
  }, [])

  const stopAndDecode = useCallback(() => {
    const result = tryDecode(samplesRef.current, threshold)
    if (result !== null) { setDecoded(result); celebrate() }
    stop()
  }, [stop, tryDecode, threshold])

  const start = useCallback(async () => {
    setError(null)
    setDecoded(null)
    setRawBits([])
    setElapsed(0)
    setTransitions(0)
    samplesRef.current  = []
    luxHistRef.current  = []

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

        // Sparkline history
        luxHistRef.current = [...luxHistRef.current.slice(-29), lum]
        setLuxHist([...luxHistRef.current])

        // Count luminosity transitions (edge detection)
        const prev = samplesRef.current[samplesRef.current.length - 1]
        if (prev !== undefined) {
          const wasHi = prev > threshold
          const isHi  = lum  > threshold
          if (wasHi !== isHi) setTransitions(t => t + 1)
        }

        samplesRef.current.push(lum)

        const secs = (Date.now() - startTimeRef.current) / 1000
        setElapsed(Math.floor(secs))

        // Attempt decode every 5 new samples (~200ms)
        if (samplesRef.current.length % 5 === 0) {
          const result = tryDecode(samplesRef.current, threshold)
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
  }, [stop, tryDecode, threshold])

  useEffect(() => () => stop(), [stop])

  const luxPct = Math.round((lux / 255) * 100)
  const isHi   = lux > threshold
  const displayBits = rawBits.slice(-80)

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="p-6 pt-10 flex flex-col items-center gap-2">
        <span className="text-xs font-mono tracking-widest text-indigo-400 uppercase">Camera Analysis</span>
        <h1 className="text-3xl font-bold text-white tracking-tight">Receiver</h1>
      </div>

      {/* Video */}
      <div className="flex justify-center px-6 mb-4">
        <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-black w-full max-w-sm aspect-video">
          <video ref={videoRef} className="w-full h-full object-cover opacity-70" muted playsInline />
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
              <span className="text-slate-500 text-sm font-mono">Camera off</span>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="flex-1 flex flex-col items-center px-6 gap-4">

        {/* Lux meter + sparkline */}
        {listening && (
          <div className="w-full max-w-sm space-y-2">
            <div className="flex justify-between text-xs font-mono text-slate-400">
              <span>Luminosité</span>
              <span className={isHi ? 'text-white font-bold' : 'text-slate-500'}>
                {Math.round(lux)}/255 {isHi ? '● HI' : '○ lo'}
              </span>
            </div>
            <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-75 ${isHi ? 'bg-white' : 'bg-indigo-600'}`}
                style={{ width: `${luxPct}%` }}
              />
            </div>

            {/* Sparkline */}
            <div className="flex items-end gap-px h-8 bg-slate-900 rounded-lg px-1">
              {luxHist.map((v, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-sm transition-all duration-75 ${v > threshold ? 'bg-white' : 'bg-indigo-800'}`}
                  style={{ height: `${Math.round((v / 255) * 100)}%` }}
                />
              ))}
            </div>

            {/* Threshold slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-mono text-slate-500">
                <span>Seuil</span>
                <span>{threshold}/255</span>
              </div>
              <input
                type="range" min={10} max={245} value={threshold}
                onChange={e => setThreshold(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <p className="text-slate-600 text-xs font-mono">
                Ajuste si les barres du graphe ne passent pas au blanc lors des flashs
              </p>
            </div>
          </div>
        )}

        {/* Bit stream */}
        {rawBits.length > 0 && (
          <div className="w-full max-w-sm">
            <p className="text-slate-500 text-xs font-mono mb-1">
              {rawBits.length} bits reconstruits ({samplesRef.current.length} samples)
            </p>
            <div className="flex flex-wrap gap-0.5">
              {displayBits.map((b, i) => (
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
        <div className="w-full max-w-sm">
          {!listening ? (
            <button onClick={start} className="w-full py-4 rounded-xl font-bold text-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">
              Start Receiving
            </button>
          ) : (
            <button onClick={stopAndDecode} className="w-full py-4 rounded-xl font-bold text-lg bg-red-700 text-white hover:bg-red-600 transition-colors">
              Stop &amp; Decode
            </button>
          )}
        </div>

        {!listening && !decoded && (
          <p className="text-slate-600 text-xs font-mono text-center max-w-xs">
            Pointe la caméra vers l'émetteur. Le compteur "transitions" doit monter pendant la transmission.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Run-length decode using a KNOWN samples-per-bit ratio
 * instead of estimating from data (much more reliable).
 * Applies a median filter first to kill single-sample noise.
 */
function rldDecode(samples: number[], threshold: number, samplesPerBit: number): boolean[] {
  if (samples.length < samplesPerBit * 4) return []

  // Median filter (window = MEDIAN_WINDOW)
  const filtered = samples.map((_, i) => {
    const w = [
      samples[Math.max(0, i - 1)],
      samples[i],
      samples[Math.min(samples.length - 1, i + 1)],
    ].sort((a, b) => a - b)
    return w[1]
  })

  // Binarize
  const binary = filtered.map(s => s > threshold)

  // Build runs
  const runs: { v: boolean; n: number }[] = []
  let cur = binary[0], count = 1
  for (let i = 1; i < binary.length; i++) {
    if (binary[i] === cur) count++
    else { runs.push({ v: cur, n: count }); cur = binary[i]; count = 1 }
  }
  runs.push({ v: cur, n: count })

  // Reconstruct bits using fixed known ratio
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
