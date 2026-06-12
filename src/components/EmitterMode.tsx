import { useState, useCallback, useRef, useEffect } from 'react'
import { encodeMessage, totalBits, BIT_DURATION_MS } from '../lib/vlc-protocol'
import { useTorch } from '../hooks/useTorch'

export default function EmitterMode() {
  const [message, setMessage] = useState('VLC')
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

    for (let i = 0; i < bits.length; i++) {
      if (abortRef.current) break
      const on = bits[i]
      setScreenOn(on)
      await torch.setLight(on)
      setProgress(Math.round(((i + 1) / total) * 100))
      await sleep(BIT_DURATION_MS)
    }

    setScreenOn(false)
    await torch.setLight(false)
    setSending(false)
    if (!abortRef.current) setDone(true)
  }, [message, sending, torch])

  const abort = () => { abortRef.current = true }

  const modeLabel = torch.mode === 'torch' ? 'Hardware Torch' : 'Screen Flash'
  const bitCount = totalBits(message)
  const durationSec = Math.round((bitCount * BIT_DURATION_MS) / 1000)

  return (
    // NO transition-colors — instant flash is essential for detection
    <div className={`min-h-screen flex flex-col ${screenOn ? 'bg-white' : 'bg-slate-950'}`}>

      {/* When screen is flashing white, show a big visible indicator */}
      {sending && screenOn && (
        <div className="fixed inset-0 bg-white z-0" />
      )}

      <div className="relative z-10 p-6 pt-10 flex flex-col items-center gap-2">
        <span className={`text-xs font-mono tracking-widest uppercase ${screenOn ? 'text-slate-400' : 'text-amber-400'}`}>
          {modeLabel}
        </span>
        <h1 className={`text-3xl font-bold tracking-tight ${screenOn ? 'text-slate-700' : 'text-white'}`}>
          Emitter
        </h1>
      </div>

      <div className="relative z-10 flex justify-center mb-6">
        <StatusPill sending={sending} done={done} mode={torch.mode} screenOn={screenOn} />
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center px-6 gap-6">
        <div className="w-full max-w-md">
          <label className={`block text-xs font-mono mb-2 tracking-wider uppercase ${screenOn ? 'text-slate-500' : 'text-slate-400'}`}>
            Message
          </label>
          <textarea
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-white font-mono text-sm resize-none focus:outline-none focus:border-amber-500"
            rows={2}
            value={message}
            onChange={e => setMessage(e.target.value)}
            disabled={sending}
            placeholder="Texte court recommandé (≤ 8 cars)"
          />
          <p className={`text-xs mt-1 font-mono ${screenOn ? 'text-slate-500' : 'text-slate-600'}`}>
            {bitCount} bits · ~{durationSec}s · {Math.round(1000 / BIT_DURATION_MS)} Hz
          </p>
        </div>

        {sending && (
          <div className="w-full max-w-md">
            <div className={`flex justify-between text-xs font-mono mb-1 ${screenOn ? 'text-slate-500' : 'text-slate-400'}`}>
              <span>Transmission…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Torch mode indicator */}
        {torch.mode === 'torch' && (
          <div className={`w-20 h-20 rounded-full flex items-center justify-center ${
            screenOn ? 'bg-amber-300 shadow-[0_0_40px_10px_rgba(251,191,36,0.8)]' : 'bg-slate-800'
          }`}>
            <span className="text-3xl">{screenOn ? '💡' : '🔦'}</span>
          </div>
        )}

        <div className="flex gap-3 w-full max-w-md">
          {!sending ? (
            <button
              onClick={transmit}
              disabled={!message.trim() || !torch.ready}
              className="flex-1 py-4 rounded-xl font-bold text-lg bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Transmettre
            </button>
          ) : (
            <button
              onClick={abort}
              className="flex-1 py-4 rounded-xl font-bold text-lg bg-red-600 text-white hover:bg-red-500"
            >
              Stop
            </button>
          )}
        </div>

        {/* Step-by-step instructions */}
        {!sending && !done && (
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
            <p className="text-slate-400 text-xs font-mono uppercase tracking-widest mb-3">Mode opératoire</p>
            <Step n={1} text="Lance d'abord le Récepteur sur l'autre appareil" />
            <Step n={2} text="Approche les deux écrans face à face (< 20 cm)" />
            <Step n={3} text="Baisse la luminosité ambiante si possible" />
            <Step n={4} text="Appuie sur Transmettre — l'écran va clignoter" />
            <Step n={5} text="Attends la fin (barre 100%) avant de bouger" />
          </div>
        )}

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
      <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {n}
      </span>
      <p className="text-slate-400 text-xs">{text}</p>
    </div>
  )
}

function StatusPill({ sending, done, mode, screenOn }: { sending: boolean; done: boolean; mode: string; screenOn: boolean }) {
  if (sending) return (
    <div className={`flex items-center gap-2 rounded-full px-4 py-1 border ${
      screenOn
        ? 'bg-white/80 border-slate-300 text-slate-700'
        : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
    }`}>
      <span className={`w-2 h-2 rounded-full animate-pulse ${screenOn ? 'bg-slate-600' : 'bg-amber-400'}`} />
      <span className="text-xs font-mono">TRANSMISSION</span>
    </div>
  )
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
