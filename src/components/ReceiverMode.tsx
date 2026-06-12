import { useRef, useState, useCallback, useEffect } from 'react'
import confetti from 'canvas-confetti'
import { decodeBytes, BIT_DURATION_MS } from '../lib/vlc-protocol'

const SAMPLE_RATE_MS  = 50
const SAMPLES_PER_BIT = Math.round(BIT_DURATION_MS / SAMPLE_RATE_MS)  // 10
const WINDOW_SECONDS  = 90
const CALIB_SAMPLES   = Math.round(2000 / SAMPLE_RATE_MS)             // 2s of calibration

type Phase = 'idle' | 'calibrating' | 'listening' | 'done'

export default function ReceiverMode() {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const samplesRef  = useRef<number[]>([])
  const calibRef    = useRef<number[]>([])
  // absolute threshold derived from calibration dark level
  const threshRef   = useRef<number>(999)

  const [phase, setPhase]             = useState<Phase>('idle')
  const [lux, setLux]                 = useState(0)
  const [threshold, setThreshold]     = useState(999)
  const [luxHist, setLuxHist]         = useState<number[]>([])
  const [rawBits, setRawBits]         = useState<boolean[]>([])
  const [decoded, setDecoded]         = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [elapsed, setElapsed]         = useState(0)
  const [transitions, setTransitions] = useState(0)
  const [calibPct, setCalibPct]       = useState(0)
  const startTimeRef                  = useRef(0)
  const luxHistRef                    = useRef<number[]>([])

  const hardStop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }, [])

  const tryDecode = useCallback((samples: number[], thresh: number): string | null => {
    const bits = rldDecode(samples, thresh, SAMPLES_PER_BIT)
    if (bits.length > 0) setRawBits(bits)
    return decodeBytes(bits)
  }, [])

  const stopAndDecode = useCallback(() => {
    const result = tryDecode(samplesRef.current, threshRef.current)
    if (result !== null) { setDecoded(result); celebrate() }
    hardStop()
    setPhase('done')
  }, [hardStop, tryDecode])

  const start = useCallback(async () => {
    setError(null)
    setDecoded(null)
    setRawBits([])
    setElapsed(0)
    setTransitions(0)
    setLuxHist([])
    setCalibPct(0)
    samplesRef.current = []
    calibRef.current   = []
    threshRef.current  = 999
    luxHistRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 320, height: 240 },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }

      setPhase('calibrating')
      startTimeRef.current = Date.now()

      intervalRef.current = setInterval(() => {
        const lum = sampleFrame(videoRef.current, canvasRef.current)
        if (lum === null) return

        setLux(lum)
        luxHistRef.current = [...luxHistRef.current.slice(-39), lum]
        setLuxHist([...luxHistRef.current])

        // ── Phase 1: calibration (2s, camera pointing away from emitter) ─
        if (calibRef.current.length < CALIB_SAMPLES) {
          calibRef.current.push(lum)
          setCalibPct(Math.round((calibRef.current.length / CALIB_SAMPLES) * 100))
          return
        }

        // Calibration just finished → compute threshold
        if (threshRef.current === 999) {
          const darkAvg = calibRef.current.reduce((a, b) => a + b, 0) / calibRef.current.length
          // Threshold = dark baseline + 20 lux units (screen flash should add ≥30)
          threshRef.current = darkAvg + 20
          setThreshold(Math.round(threshRef.current))
          setPhase('listening')
          startTimeRef.current = Date.now()
        }

        // ── Phase 2: listening ────────────────────────────────────────────
        const prev = samplesRef.current[samplesRef.current.length - 1]
        if (prev !== undefined) {
          const wasHi = prev  > threshRef.current
          const isHi  = lum   > threshRef.current
          if (wasHi !== isHi) setTransitions(t => t + 1)
        }

        samplesRef.current.push(lum)

        const secs = (Date.now() - startTimeRef.current) / 1000
        setElapsed(Math.floor(secs))

        if (samplesRef.current.length % Math.ceil(SAMPLES_PER_BIT / 2) === 0) {
          const result = tryDecode(samplesRef.current, threshRef.current)
          if (result !== null) {
            setDecoded(result)
            hardStop()
            setPhase('done')
            celebrate()
            return
          }
        }

        if (secs >= WINDOW_SECONDS) { hardStop(); setPhase('done') }
      }, SAMPLE_RATE_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }, [hardStop, tryDecode])

  useEffect(() => () => hardStop(), [hardStop])

  const isHi = lux > threshRef.current

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
          {phase === 'calibrating' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3">
              <p className="text-white text-sm font-mono text-center px-4">
                🔇 Calibration en cours…<br/>
                <span className="text-slate-400 text-xs">Ne montre pas encore l'écran émetteur</span>
              </p>
              <div className="w-32 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${calibPct}%` }} />
              </div>
              <span className="text-indigo-400 text-xs font-mono">{calibPct}%</span>
            </div>
          )}
          {phase === 'listening' && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-0 right-0 h-0.5 bg-indigo-500/60 animate-scan" />
              <div className="absolute top-2 left-2 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-mono">REC {elapsed}s</span>
              </div>
              <div className="absolute bottom-2 right-2 text-xs font-mono">
                <span className={isHi ? 'text-white font-bold' : 'text-indigo-400'}>
                  {transitions} transitions · {isHi ? '● HI' : '○ lo'}
                </span>
              </div>
            </div>
          )}
          {phase === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-slate-500 text-sm font-mono">Caméra off</span>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="flex-1 flex flex-col items-center px-6 gap-4">

        {/* Sparkline + threshold info */}
        {(phase === 'listening' || phase === 'done') && (
          <div className="w-full max-w-sm space-y-2">
            <div className="flex justify-between text-xs font-mono text-slate-400">
              <span>Signal</span>
              <span className={isHi ? 'text-white font-bold' : 'text-slate-500'}>
                lux {Math.round(lux)} · seuil {Math.round(threshold)}
              </span>
            </div>
            <div className="flex items-end gap-px h-10 bg-slate-900 rounded-lg px-1 py-1">
              {luxHist.map((v, i) => {
                const hi = v > threshRef.current
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-sm transition-none ${hi ? 'bg-white' : 'bg-indigo-800'}`}
                    style={{ height: `${Math.max(4, Math.round((v / 255) * 100))}%` }}
                  />
                )
              })}
            </div>
            {phase === 'listening' && transitions < 5 && elapsed > 4 && (
              <p className="text-amber-400 text-xs font-mono">
                ⚠ Peu de transitions ({transitions}) — montre l'écran de l'émetteur maintenant.
              </p>
            )}
          </div>
        )}

        {/* Bit stream */}
        {rawBits.length > 0 && (
          <div className="w-full max-w-sm">
            <p className="text-slate-500 text-xs font-mono mb-1">{rawBits.length} bits reconstruits</p>
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
          {phase === 'idle' || phase === 'done' ? (
            <button onClick={start} className="w-full py-4 rounded-xl font-bold text-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">
              {phase === 'done' ? 'Recommencer' : 'Start Receiving'}
            </button>
          ) : (
            <button onClick={stopAndDecode} className="w-full py-4 rounded-xl font-bold text-lg bg-red-700 text-white hover:bg-red-600 transition-colors">
              Stop &amp; Décoder
            </button>
          )}
        </div>

        {/* Instructions */}
        {phase === 'idle' && (
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
            <p className="text-slate-400 text-xs font-mono uppercase tracking-widest mb-3">Comment ça marche</p>
            <Step n={1} text='Appuie sur "Start" — la caméra se calibre 2 secondes en fond sombre' />
            <Step n={2} text="Dès que la barre de calibration est à 100%, montre l'écran émetteur à la caméra" />
            <Step n={3} text="Le graphe doit alterner blanc/violet au rythme des flashs" />
            <Step n={4} text="Le message apparaît automatiquement" />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Run-length decode with absolute threshold.
 * Applies median filter (window=3) first.
 */
function rldDecode(samples: number[], threshold: number, samplesPerBit: number): boolean[] {
  if (samples.length < samplesPerBit * 4) return []

  const filtered = samples.map((_, i) => {
    const w = [
      samples[Math.max(0, i - 1)],
      samples[i],
      samples[Math.min(samples.length - 1, i + 1)],
    ].sort((a, b) => a - b)
    return w[1]
  })

  const binary = filtered.map(s => s > threshold)

  const runs: { v: boolean; n: number }[] = []
  let cur = binary[0], count = 1
  for (let i = 1; i < binary.length; i++) {
    if (binary[i] === cur) count++
    else { runs.push({ v: cur, n: count }); cur = binary[i]; count = 1 }
  }
  runs.push({ v: cur, n: count })

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
      <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
      <p className="text-slate-400 text-xs">{text}</p>
    </div>
  )
}
