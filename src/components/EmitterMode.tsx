import { useState, useCallback, useRef, useEffect } from 'react'
import { encodeMessage, totalBits, BIT_DURATION_MS } from '../lib/vlc-protocol'
import { useTorch } from '../hooks/useTorch'

export default function EmitterMode() {
  const [message, setMessage]     = useState('Hello VLC!')
  const [sending, setSending]     = useState(false)
  const [progress, setProgress]   = useState(0)
  const [screenOn, setScreenOn]   = useState(false)
  const [done, setDone]           = useState(false)
  const abortRef                  = useRef(false)
  const torch                     = useTorch()

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

    // Ensure light ends OFF
    setScreenOn(false)
    await torch.setLight(false)

    setSending(false)
    if (!abortRef.current) setDone(true)
  }, [message, sending, torch])

  const abort = () => {
    abortRef.current = true
  }

  const modeLabel = torch.mode === 'torch' ? 'Hardware Torch' : 'Screen Flash'
  const bitCount  = totalBits(message)

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors duration-75 ${
        screenOn ? 'bg-white' : 'bg-slate-950'
      }`}
    >
      {/* Header */}
      <div className="p-6 pt-10 flex flex-col items-center gap-2">
        <span className="text-xs font-mono tracking-widest text-amber-400 uppercase">
          {modeLabel}
        </span>
        <h1 className="text-3xl font-bold text-white tracking-tight">
          Emitter
        </h1>
      </div>

      {/* Status pill */}
      <div className="flex justify-center mb-6">
        <StatusPill sending={sending} done={done} mode={torch.mode} />
      </div>

      {/* Message input */}
      <div className="flex-1 flex flex-col items-center px-6 gap-6">
        <div className="w-full max-w-md">
          <label className="block text-slate-400 text-xs font-mono mb-2 tracking-wider uppercase">
            Message
          </label>
          <textarea
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-white font-mono text-sm resize-none focus:outline-none focus:border-amber-500 transition-colors"
            rows={3}
            value={message}
            onChange={e => setMessage(e.target.value)}
            disabled={sending}
            placeholder="Type a message to transmit…"
          />
          <p className="text-slate-600 text-xs mt-1 font-mono">
            {bitCount} bits · ~{Math.round((bitCount * BIT_DURATION_MS) / 1000)}s at {Math.round(1000 / BIT_DURATION_MS)} Hz
          </p>
        </div>

        {/* Progress */}
        {sending && (
          <div className="w-full max-w-md">
            <div className="flex justify-between text-xs font-mono text-slate-400 mb-1">
              <span>Transmitting…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-100"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Flash indicator (visible when torch mode) */}
        {torch.mode === 'torch' && (
          <div className={`w-20 h-20 rounded-full transition-all duration-75 flex items-center justify-center ${
            screenOn
              ? 'bg-amber-300 shadow-[0_0_40px_10px_rgba(251,191,36,0.8)]'
              : 'bg-slate-800'
          }`}>
            <span className="text-3xl">{screenOn ? '💡' : '🔦'}</span>
          </div>
        )}

        {/* CTA buttons */}
        <div className="flex gap-3 w-full max-w-md">
          {!sending ? (
            <button
              onClick={transmit}
              disabled={!message.trim() || !torch.ready}
              className="flex-1 py-4 rounded-xl font-bold text-lg bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Transmit
            </button>
          ) : (
            <button
              onClick={abort}
              className="flex-1 py-4 rounded-xl font-bold text-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
            >
              Stop
            </button>
          )}
        </div>

        {torch.error && (
          <p className="text-amber-400 text-xs font-mono text-center max-w-sm">
            ⚠ {torch.error} — using screen flash fallback
          </p>
        )}
      </div>
    </div>
  )
}

function StatusPill({ sending, done, mode }: { sending: boolean; done: boolean; mode: string }) {
  if (sending) return (
    <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-1">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse-fast" />
      <span className="text-amber-400 text-xs font-mono">TRANSMITTING</span>
    </div>
  )
  if (done) return (
    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-full px-4 py-1">
      <span className="text-green-400 text-xs font-mono">✓ SENT</span>
    </div>
  )
  return (
    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-full px-4 py-1">
      <span className="text-slate-400 text-xs font-mono">
        {mode === 'torch' ? '🔦 TORCH READY' : mode === 'screen' ? '📱 SCREEN READY' : 'INITIALIZING…'}
      </span>
    </div>
  )
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}
