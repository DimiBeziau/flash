import { useRef, useState, useCallback, useEffect } from 'react'
import confetti from 'canvas-confetti'
import { decodeBytes } from '../lib/vlc-protocol'

const SAMPLE_RATE_MS  = 60   // ~16 samples/sec
const THRESHOLD       = 140  // luminosity 0-255 above = "light ON"
const WINDOW_SECONDS  = 30   // max capture window

export default function ReceiverMode() {
  const videoRef        = useRef<HTMLVideoElement>(null)
  const canvasRef       = useRef<HTMLCanvasElement>(null)
  const streamRef       = useRef<MediaStream | null>(null)
  const intervalRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const bitsRef         = useRef<boolean[]>([])

  const [listening, setListening] = useState(false)
  const [lux, setLux]             = useState(0)
  const [bits, setBits]           = useState<boolean[]>([])
  const [decoded, setDecoded]     = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [elapsed, setElapsed]     = useState(0)
  const startTimeRef              = useRef(0)

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setListening(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setDecoded(null)
    bitsRef.current = []
    setBits([])
    setElapsed(0)

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
        const ctx = sampleLuminosity()
        if (ctx === null) return

        const { lum } = ctx
        setLux(lum)

        const bit = lum > THRESHOLD
        bitsRef.current.push(bit)
        setBits([...bitsRef.current])

        const secs = Math.floor((Date.now() - startTimeRef.current) / 1000)
        setElapsed(secs)

        // Attempt decode every 8 new bits
        if (bitsRef.current.length % 8 === 0) {
          const result = decodeBytes(bitsRef.current)
          if (result !== null) {
            setDecoded(result)
            stop()
            celebrate()
          }
        }

        if (secs >= WINDOW_SECONDS) stop()
      }, SAMPLE_RATE_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [stop])

  const sampleLuminosity = (): { lum: number } | null => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return null

    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const W = 64, H = 64
    canvas.width  = W
    canvas.height = H
    ctx.drawImage(video, 0, 0, W, H)

    const data = ctx.getImageData(0, 0, W, H).data
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      // Perceived luminosity
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
    return { lum: sum / (W * H) }
  }

  useEffect(() => () => stop(), [stop])

  const luxPercent = Math.round((lux / 255) * 100)
  const bitHistory = bits.slice(-80)

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="p-6 pt-10 flex flex-col items-center gap-2">
        <span className="text-xs font-mono tracking-widest text-indigo-400 uppercase">
          Camera Analysis
        </span>
        <h1 className="text-3xl font-bold text-white tracking-tight">Receiver</h1>
      </div>

      {/* Video preview (hidden canvas for sampling) */}
      <div className="flex justify-center px-6 mb-4">
        <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-black w-full max-w-sm aspect-video">
          <video
            ref={videoRef}
            className="w-full h-full object-cover opacity-70"
            muted
            playsInline
          />
          {listening && (
            <div className="absolute inset-0 pointer-events-none">
              {/* Scan line effect */}
              <div className="absolute left-0 right-0 h-0.5 bg-indigo-500/60 animate-scan" />
              <div className="absolute top-2 left-2 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-mono">REC</span>
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
        {/* Lux meter */}
        {listening && (
          <div className="w-full max-w-sm">
            <div className="flex justify-between text-xs font-mono text-slate-400 mb-1">
              <span>Luminosity</span>
              <span className={lux > THRESHOLD ? 'text-white font-bold' : 'text-slate-500'}>
                {luxPercent}% {lux > THRESHOLD ? '● HI' : '○ lo'}
              </span>
            </div>
            <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-75 ${
                  lux > THRESHOLD ? 'bg-white' : 'bg-indigo-600'
                }`}
                style={{ width: `${luxPercent}%` }}
              />
            </div>
            <div className="mt-1 text-xs font-mono text-slate-600">
              threshold: {THRESHOLD}/255
            </div>
          </div>
        )}

        {/* Bit stream visualizer */}
        {bits.length > 0 && (
          <div className="w-full max-w-sm">
            <p className="text-slate-500 text-xs font-mono mb-1">
              Bit stream ({bits.length} bits captured)
            </p>
            <div className="flex flex-wrap gap-0.5">
              {bitHistory.map((b, i) => (
                <span
                  key={i}
                  className={`w-2.5 h-2.5 rounded-sm ${b ? 'bg-white' : 'bg-slate-700'}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Decoded message */}
        {decoded !== null && (
          <div className="w-full max-w-sm bg-green-950 border border-green-700 rounded-2xl p-5">
            <p className="text-green-400 text-xs font-mono mb-2 tracking-widest uppercase">
              ✓ Message Received
            </p>
            <p className="text-white text-xl font-bold break-words">{decoded}</p>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-xs font-mono text-center max-w-sm">⚠ {error}</p>
        )}

        {/* CTA */}
        <div className="w-full max-w-sm">
          {!listening ? (
            <button
              onClick={start}
              className="w-full py-4 rounded-xl font-bold text-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
            >
              Start Receiving
            </button>
          ) : (
            <button
              onClick={stop}
              className="w-full py-4 rounded-xl font-bold text-lg bg-red-700 text-white hover:bg-red-600 transition-colors"
            >
              Stop
            </button>
          )}
        </div>

        {!listening && !decoded && (
          <p className="text-slate-600 text-xs font-mono text-center max-w-xs">
            Point camera at the emitter's flashlight or screen, then tap Start.
          </p>
        )}
      </div>
    </div>
  )
}

function celebrate() {
  confetti({
    particleCount: 160,
    spread: 90,
    origin: { y: 0.6 },
    colors: ['#6366f1', '#a5b4fc', '#818cf8', '#ffffff', '#fbbf24'],
  })
}
