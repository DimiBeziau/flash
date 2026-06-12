import { useRef, useState, useCallback, useEffect } from 'react'
import confetti from 'canvas-confetti'
import {
  decodeSamples,
  calibrateThreshold,
  samplesToStates,
  type Sample,
} from '../lib/vlc-protocol'

const CALIB_MS      = 1500
const WINDOW_MS     = 120_000
const DECODE_EVERY  = 400     // ms between decode attempts

type Phase = 'idle' | 'calibrating' | 'listening' | 'done'

export default function ReceiverMode() {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const rafRef      = useRef<number>(0)
  const runningRef  = useRef(false)

  const calibSamplesRef = useRef<Sample[]>([])
  const samplesRef      = useRef<Sample[]>([])
  const thresholdRef    = useRef(12)
  const t0Ref           = useRef(0)
  const lastDecodeRef   = useRef(0)
  const phaseRef        = useRef<Phase>('idle')

  const [phase, setPhase]         = useState<Phase>('idle')
  const [lux, setLux]             = useState(0)
  const [stateHist, setStateHist] = useState<boolean[]>([])
  const [decoded, setDecoded]     = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [elapsed, setElapsed]     = useState(0)
  const [edges, setEdges]         = useState(0)
  const [calibPct, setCalibPct]   = useState(0)

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p) }

  const hardStop = useCallback(() => {
    runningRef.current = false
    cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  const finish = useCallback((result: string | null) => {
    hardStop()
    setPhaseBoth('done')
    if (result !== null) {
      setDecoded(result)
      celebrate()
    }
  }, [hardStop])

  const stopAndDecode = useCallback(() => {
    finish(decodeSamples(samplesRef.current, thresholdRef.current))
  }, [finish])

  const start = useCallback(async () => {
    setError(null)
    setDecoded(null)
    setStateHist([])
    setElapsed(0)
    setEdges(0)
    setCalibPct(0)
    calibSamplesRef.current = []
    samplesRef.current = []
    thresholdRef.current = 12
    lastDecodeRef.current = 0

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

      setPhaseBoth('calibrating')
      runningRef.current = true
      t0Ref.current = performance.now()

      const loop = () => {
        if (!runningRef.current) return
        rafRef.current = requestAnimationFrame(loop)

        const now = performance.now()
        const t = now - t0Ref.current
        const lum = sampleFrame(videoRef.current, canvasRef.current)
        if (lum === null) return

        setLux(lum)

        // ── Calibration: measure ambient noise floor ─────────────────────
        if (phaseRef.current === 'calibrating') {
          calibSamplesRef.current.push({ t, lux: lum })
          setCalibPct(Math.min(100, Math.round((t / CALIB_MS) * 100)))
          if (t >= CALIB_MS) {
            thresholdRef.current = calibrateThreshold(calibSamplesRef.current)
            setPhaseBoth('listening')
            t0Ref.current = performance.now()  // restart clock for listening
          }
          return
        }

        // ── Listening ─────────────────────────────────────────────────────
        samplesRef.current.push({ t, lux: lum })
        setElapsed(Math.floor(t / 1000))

        // Periodic decode attempt + UI refresh
        if (t - lastDecodeRef.current >= DECODE_EVERY) {
          lastDecodeRef.current = t

          const samples = samplesRef.current
          const states = samplesToStates(samples, thresholdRef.current)
          setStateHist(states.slice(-60))
          let e = 0
          for (let i = 1; i < states.length; i++) if (states[i] !== states[i - 1]) e++
          setEdges(e)

          const result = decodeSamples(samples, thresholdRef.current)
          if (result !== null) {
            finish(result)
            return
          }
        }

        if (t >= WINDOW_MS) finish(null)
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhaseBoth('idle')
    }
  }, [finish])

  useEffect(() => () => hardStop(), [hardStop])

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
                Calibration du bruit ambiant…
              </p>
              <div className="w-32 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${calibPct}%` }} />
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
                {edges} fronts · lux {Math.round(lux)}
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

        {/* Detected ON/OFF signal */}
        {(phase === 'listening' || phase === 'done') && (
          <div className="w-full max-w-sm space-y-1">
            <p className="text-slate-500 text-xs font-mono">Signal détecté (ON/OFF)</p>
            <div className="flex items-end gap-px h-8 bg-slate-900 rounded-lg px-1 py-1">
              {stateHist.length > 0 ? stateHist.map((on, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-sm ${on ? 'bg-white' : 'bg-indigo-900'}`}
                  style={{ height: on ? '100%' : '30%' }}
                />
              )) : (
                <span className="text-slate-700 text-xs font-mono m-auto">en attente du signal…</span>
              )}
            </div>
            {phase === 'listening' && edges < 4 && elapsed > 6 && (
              <p className="text-amber-400 text-xs font-mono">
                ⚠ Aucun flash détecté — rapproche l'écran émetteur de la caméra.
              </p>
            )}
          </div>
        )}

        {/* Result */}
        {decoded !== null && (
          <div className="w-full max-w-sm bg-green-950 border border-green-700 rounded-2xl p-5">
            <p className="text-green-400 text-xs font-mono mb-2 tracking-widest uppercase">✓ Message reçu</p>
            <p className="text-white text-2xl font-bold break-words">{decoded}</p>
          </div>
        )}
        {phase === 'done' && decoded === null && (
          <div className="w-full max-w-sm bg-amber-950/50 border border-amber-800 rounded-xl p-4">
            <p className="text-amber-400 text-xs font-mono">
              Décodage impossible ({edges} fronts capturés).
              {edges < 10
                ? " La caméra n'a pas vu les flashs : rapproche les appareils et réduis la lumière ambiante."
                : ' Signal partiel : recommence en gardant les appareils immobiles pendant toute la transmission.'}
            </p>
          </div>
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
            <Step n={1} text='"Start Receiving" — 1,5s de calibration du bruit ambiant' />
            <Step n={2} text="Placer l'écran de l'émetteur face à la caméra, à 10-20 cm" />
            <Step n={3} text='Lancer "Transmettre" sur l&apos;émetteur et ne plus bouger' />
            <Step n={4} text="Le message s'affiche automatiquement dès qu'il est complet" />
          </div>
        )}
      </div>
    </div>
  )
}

/** Average luminosity of the central 60% of the frame (where the emitter screen is). */
function sampleFrame(video: HTMLVideoElement | null, canvas: HTMLCanvasElement | null): number | null {
  if (!video || !canvas || video.readyState < 2) return null
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return null

  const W = 48, H = 48
  canvas.width = W
  canvas.height = H
  // Center 60% crop — concentrates on the emitter screen, ignores borders
  const cw = vw * 0.6, ch = vh * 0.6
  ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, W, H)

  const data = ctx.getImageData(0, 0, W, H).data
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return sum / (W * H)
}

function celebrate() {
  confetti({
    particleCount: 160,
    spread: 90,
    origin: { y: 0.6 },
    colors: ['#6366f1', '#a5b4fc', '#818cf8', '#ffffff', '#fbbf24'],
  })
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
      <p className="text-slate-400 text-xs">{text}</p>
    </div>
  )
}
