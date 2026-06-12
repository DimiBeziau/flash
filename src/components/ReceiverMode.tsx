import { useRef, useState, useCallback, useEffect } from 'react'
import confetti from 'canvas-confetti'
import { decodeBytes, BIT_DURATION_MS } from '../lib/vlc-protocol'

const SAMPLE_RATE_MS  = 40
const SAMPLES_PER_BIT = Math.round(BIT_DURATION_MS / SAMPLE_RATE_MS)  // 12
const WINDOW_SECONDS  = 90
const CALIB_SAMPLES   = Math.round(1500 / SAMPLE_RATE_MS)             // 1.5s

type Phase = 'idle' | 'calibrating' | 'listening' | 'done'

export default function ReceiverMode() {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const samplesRef  = useRef<number[]>([])
  const calibRef    = useRef<number[]>([])
  // Noise level (std-dev of deltas during calibration) — used as delta threshold base
  const noiseLevelRef = useRef<number>(5)

  const [phase, setPhase]             = useState<Phase>('idle')
  const [lux, setLux]                 = useState(0)
  const [deltaThresh, setDeltaThresh] = useState(15)
  const [luxHist, setLuxHist]         = useState<number[]>([])
  const [stateHist, setStateHist]     = useState<boolean[]>([])
  const [rawBits, setRawBits]         = useState<boolean[]>([])
  const [decoded, setDecoded]         = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [elapsed, setElapsed]         = useState(0)
  const [transitions, setTransitions] = useState(0)
  const [calibPct, setCalibPct]       = useState(0)
  const startTimeRef                  = useRef(0)
  const luxHistRef                    = useRef<number[]>([])
  const stateHistRef                  = useRef<boolean[]>([])

  const hardStop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }, [])

  const tryDecode = useCallback((samples: number[], noiseLevel: number): string | null => {
    const { bits, states } = deltaRLD(samples, noiseLevel, SAMPLES_PER_BIT)
    if (bits.length > 0) setRawBits(bits)
    if (states.length > 0) setStateHist([...states])
    return bits.length > 0 ? decodeBytes(bits) : null
  }, [])

  const stopAndDecode = useCallback(() => {
    const result = tryDecode(samplesRef.current, noiseLevelRef.current)
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
    setStateHist([])
    setCalibPct(0)
    samplesRef.current   = []
    calibRef.current     = []
    noiseLevelRef.current = 5
    luxHistRef.current   = []
    stateHistRef.current = []

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
        luxHistRef.current = [...luxHistRef.current.slice(-49), lum]
        setLuxHist([...luxHistRef.current])

        // ── Calibration ──────────────────────────────────────────────────
        if (calibRef.current.length < CALIB_SAMPLES) {
          calibRef.current.push(lum)
          setCalibPct(Math.round((calibRef.current.length / CALIB_SAMPLES) * 100))
          return
        }

        if (noiseLevelRef.current === 5 && calibRef.current.length >= CALIB_SAMPLES) {
          // Compute noise = mean absolute delta between consecutive calib samples
          let sumDelta = 0
          for (let i = 1; i < calibRef.current.length; i++) {
            sumDelta += Math.abs(calibRef.current[i] - calibRef.current[i - 1])
          }
          const meanDelta = sumDelta / (calibRef.current.length - 1)
          // Threshold = 4× noise, minimum 8 lux
          noiseLevelRef.current = Math.max(8, meanDelta * 4)
          setDeltaThresh(Math.round(noiseLevelRef.current))
          setPhase('listening')
          startTimeRef.current = Date.now()
        }

        // ── Listening ────────────────────────────────────────────────────
        const prev = samplesRef.current[samplesRef.current.length - 1]
        if (prev !== undefined) {
          const delta = lum - prev
          if (Math.abs(delta) > noiseLevelRef.current) setTransitions(t => t + 1)
        }

        samplesRef.current.push(lum)

        const secs = (Date.now() - startTimeRef.current) / 1000
        setElapsed(Math.floor(secs))

        // Attempt decode every ~half bit period
        if (samplesRef.current.length % Math.ceil(SAMPLES_PER_BIT / 2) === 0) {
          const result = tryDecode(samplesRef.current, noiseLevelRef.current)
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

  // Build display: show state machine output (more meaningful than raw lux)
  const displayHistory = stateHist.length > 0 ? stateHist.slice(-50) : []

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
                Calibration…<br/>
                <span className="text-slate-400 text-xs">Ne montre pas encore l'émetteur</span>
              </p>
              <div className="w-32 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${calibPct}%` }} />
              </div>
            </div>
          )}

          {phase === 'listening' && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-0 right-0 h-0.5 bg-indigo-500/60 animate-scan" />
              <div className="absolute top-2 left-2 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-mono">REC {elapsed}s</span>
              </div>
              <div className="absolute bottom-2 right-2 text-indigo-300 text-xs font-mono">
                Δ seuil={Math.round(deltaThresh)} · {transitions} transitions
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

        {/* State machine visualizer */}
        {(phase === 'listening' || phase === 'done') && (
          <div className="w-full max-w-sm space-y-2">
            <div className="flex justify-between text-xs font-mono text-slate-400">
              <span>Signal reconstruit (delta)</span>
              <span>{Math.round(lux)}/255</span>
            </div>

            {/* Binary state bar — shows detected ON/OFF, not raw lux */}
            <div className="flex items-end gap-px h-8 bg-slate-900 rounded-lg px-1 py-1">
              {displayHistory.map((on, i) => (
                <div key={i} className={`flex-1 rounded-sm ${on ? 'bg-white' : 'bg-indigo-900'}`}
                  style={{ height: on ? '100%' : '30%' }} />
              ))}
              {displayHistory.length === 0 && (
                <span className="text-slate-700 text-xs font-mono m-auto">en attente de signal…</span>
              )}
            </div>

            {/* Raw lux sparkline below */}
            <div className="flex items-end gap-px h-6 bg-slate-900/50 rounded px-1">
              {luxHist.slice(-50).map((v, i) => (
                <div key={i} className="flex-1 bg-slate-600 rounded-sm"
                  style={{ height: `${Math.max(5, Math.round((v / 255) * 100))}%` }} />
              ))}
            </div>
            <p className="text-slate-600 text-xs font-mono">lux brut (bas=normal, varie avec l'auto-expo)</p>

            {phase === 'listening' && transitions < 4 && elapsed > 5 && (
              <p className="text-amber-400 text-xs font-mono">
                ⚠ Seulement {transitions} transitions — montre l'écran de l'émetteur à la caméra.
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
                <span key={i} className={`w-2.5 h-2.5 rounded-sm ${b ? 'bg-amber-400' : 'bg-slate-700'}`} />
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
        {phase === 'done' && decoded === null && (
          <p className="text-amber-400 text-xs font-mono text-center max-w-sm">
            Aucun message décodé. Recommence en rapprochant davantage les écrans.
          </p>
        )}

        {error && <p className="text-red-400 text-xs font-mono text-center max-w-sm">⚠ {error}</p>}

        {/* Buttons */}
        <div className="w-full max-w-sm">
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

        {phase === 'idle' && (
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
            <p className="text-slate-400 text-xs font-mono uppercase tracking-widest mb-3">Mode opératoire</p>
            <Step n={1} text='Start → caméra calibre 1.5s en fond neutre (pas de flash)' />
            <Step n={2} text="Dès 100% : montre immédiatement l'écran émetteur à la caméra" />
            <Step n={3} text="La barre blanche doit pulser au rythme des flashs de l'émetteur" />
            <Step n={4} text="Message court recommandé : 2-4 caractères max (ex: VLC, HI)" />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Delta-based detector + run-length decoder.
 *
 * Instead of measuring absolute lux (which the camera's auto-exposure ruins),
 * we watch for sudden CHANGES (delta between consecutive samples).
 * A state machine tracks ON/OFF state: a positive spike → ON, negative → OFF.
 * This is immune to slow exposure drift — only fast transitions matter.
 */
function deltaRLD(
  samples: number[],
  noiseLevel: number,
  samplesPerBit: number,
): { bits: boolean[]; states: boolean[] } {
  const empty = { bits: [], states: [] }
  if (samples.length < samplesPerBit * 3) return empty

  // State machine: latch ON on rising delta, OFF on falling delta
  const states: boolean[] = [false]
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i] - samples[i - 1]
    if (delta > noiseLevel)       states.push(true)
    else if (delta < -noiseLevel) states.push(false)
    else                          states.push(states[states.length - 1])
  }

  // Run-length encode the state sequence
  const runs: { v: boolean; n: number }[] = []
  let cur = states[0], count = 1
  for (let i = 1; i < states.length; i++) {
    if (states[i] === cur) count++
    else { runs.push({ v: cur, n: count }); cur = states[i]; count = 1 }
  }
  runs.push({ v: cur, n: count })

  // Convert runs → bits
  const bits: boolean[] = []
  for (const run of runs) {
    const nBits = Math.max(1, Math.round(run.n / samplesPerBit))
    for (let i = 0; i < nBits; i++) bits.push(run.v)
  }

  return { bits, states }
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
