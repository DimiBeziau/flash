import { useState, useCallback, useRef, useEffect } from 'react'
import { encodeMessage, frameBitCount, BIT_DURATION_MS, MAX_MESSAGE_BYTES } from '../lib/vlc-protocol'
import { useTorch } from '../hooks/useTorch'

export default function EmitterMode() {
  const [message, setMessage] = useState('flash')
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(0)
  const [screenOn, setScreenOn] = useState(false)
  const [done, setDone] = useState(false)
  const abortRef = useRef(false)
  const torch = useTorch()

  useEffect(() => {
    torch.init()
    return () => torch.release()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const transmit = useCallback(async () => {
    if (!message.trim() || sending) return

    abortRef.current = false
    setSending(true)
    setDone(false)
    setProgress(0)

    const bits = encodeMessage(message.trim())
    const total = bits.length

    // Absolute-deadline scheduling: each bit boundary is t0 + i*BIT.
    // Lateness from applyConstraints/re-renders is absorbed instead of
    // accumulating into timing drift the receiver can't follow.
    const t0 = performance.now()
    for (let i = 0; i < total; i++) {
      if (abortRef.current) break
      setScreenOn(bits[i])
      await torch.setLight(bits[i])
      setProgress(Math.round(((i + 1) / total) * 100))
      const deadline = t0 + (i + 1) * BIT_DURATION_MS
      const wait = deadline - performance.now()
      if (wait > 0) await sleep(wait)
    }

    setScreenOn(false)
    await torch.setLight(false)
    setSending(false)
    if (!abortRef.current) setDone(true)
  }, [message, sending, torch])

  const abort = () => { abortRef.current = true }

  const modeLabel = torch.mode === 'torch' ? 'Hardware Torch' : 'Screen Flash'
  const bitCount = frameBitCount(message.trim() || 'X')
  const durationSec = Math.ceil((bitCount * BIT_DURATION_MS) / 1000)
  const byteLen = new TextEncoder().encode(message).length

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">

      {/* Full-screen flash overlay — covers everything for maximum contrast */}
      {sending && (
        <div className={`fixed inset-0 z-40 ${screenOn ? 'bg-white' : 'bg-black'}`}>
          <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-3">
            <span className={`text-sm font-mono ${screenOn ? 'text-slate-400' : 'text-slate-600'}`}>
              {progress}%
            </span>
            <button
              onClick={abort}
              className="px-6 py-2 rounded-lg text-sm font-mono bg-slate-700/50 text-slate-300"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="p-6 pt-10 flex flex-col items-center gap-2">
        <span className="text-xs font-mono tracking-widest text-amber-400 uppercase">{modeLabel}</span>
        <h1 className="text-3xl font-bold text-white tracking-tight">Emitter</h1>
      </div>

      <div className="flex justify-center mb-6">
        <StatusPill done={done} mode={torch.mode} />
      </div>

      <div className="flex-1 flex flex-col items-center px-6 gap-6">
        <div className="w-full max-w-md">
          <label className="block text-slate-400 text-xs font-mono mb-2 tracking-wider uppercase">
            Message ({byteLen}/{MAX_MESSAGE_BYTES} octets)
          </label>
          <textarea
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-white font-mono text-sm resize-none focus:outline-none focus:border-amber-500"
            rows={2}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Message court (ex: VLC)"
            maxLength={MAX_MESSAGE_BYTES}
          />
          <p className="text-slate-600 text-xs mt-1 font-mono">
            {bitCount} bits · ~{durationSec}s · {Math.round(1000 / BIT_DURATION_MS)} bits/s
          </p>
        </div>

        <button
          onClick={transmit}
          disabled={!message.trim() || !torch.ready}
          className="w-full max-w-md py-4 rounded-xl font-bold text-lg bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Transmettre
        </button>

        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <p className="text-slate-400 text-xs font-mono uppercase tracking-widest mb-3">Mode opératoire</p>
          <Step n={1} text='Sur l&apos;autre appareil : Receiver → "Start Receiving" et attendre la fin de la calibration' />
          <Step n={2} text="Placer cet écran face à la caméra du récepteur, à 10-20 cm" />
          <Step n={3} text='Appuyer sur "Transmettre" — l&apos;écran entier clignote noir/blanc' />
          <Step n={4} text="Ne pas bouger les appareils jusqu'à la fin (le message s'affiche tout seul)" />
        </div>

        {torch.error && (
          <p className="text-amber-400 text-xs font-mono text-center max-w-sm">
            ⚠ {torch.error} — fallback écran activé
          </p>
        )}
      </div>
    </div>
  )
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
      <p className="text-slate-400 text-xs">{text}</p>
    </div>
  )
}

function StatusPill({ done, mode }: { done: boolean; mode: string }) {
  if (done) return (
    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-full px-4 py-1">
      <span className="text-green-400 text-xs font-mono">✓ ENVOYÉ</span>
    </div>
  )
  return (
    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-full px-4 py-1">
      <span className="text-slate-400 text-xs font-mono">
        {mode === 'torch' ? '🔦 TORCH PRÊT' : mode === 'screen' ? '📱 ÉCRAN PRÊT' : 'INIT…'}
      </span>
    </div>
  )
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}
