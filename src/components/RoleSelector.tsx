type Role = 'emitter' | 'receiver'

interface Props {
  onSelect: (role: Role) => void
}

export default function RoleSelector({ onSelect }: Props) {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-6 gap-12">
      {/* Hero */}
      <div className="text-center flex flex-col items-center gap-4">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-amber-400 flex items-center justify-center text-4xl shadow-[0_0_40px_rgba(99,102,241,0.4)]">
          💡
        </div>
        <div>
          <h1 className="text-4xl font-black text-white tracking-tight">flash</h1>
          <p className="text-slate-400 text-sm mt-1 font-mono tracking-wide">
            Visible Light Communication
          </p>
        </div>
        <p className="text-slate-500 text-sm max-w-xs text-center leading-relaxed">
          Transfer data between devices using only light pulses — no Wi-Fi, no Bluetooth.
        </p>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-4 w-full max-w-sm">
        <RoleCard
          icon="🔦"
          title="Emitter"
          subtitle="Send a message via light"
          description="Encodes text into binary and flashes your device's torch or screen."
          accent="amber"
          onClick={() => onSelect('emitter')}
        />
        <RoleCard
          icon="📡"
          title="Receiver"
          subtitle="Capture &amp; decode light"
          description="Analyses your camera's video feed to reconstruct the original message."
          accent="indigo"
          onClick={() => onSelect('receiver')}
        />
      </div>

      {/* Footer */}
      <p className="text-slate-700 text-xs font-mono">
        Learning Lab · M2 · 2025–2026
      </p>
    </div>
  )
}

interface CardProps {
  icon: string
  title: string
  subtitle: string
  description: string
  accent: 'amber' | 'indigo'
  onClick: () => void
}

function RoleCard({ icon, title, subtitle, description, accent, onClick }: CardProps) {
  const ring    = accent === 'amber' ? 'hover:border-amber-500/60' : 'hover:border-indigo-500/60'
  const badge   = accent === 'amber' ? 'bg-amber-500/10 text-amber-400' : 'bg-indigo-500/10 text-indigo-400'
  const btnBg   = accent === 'amber'
    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
    : 'bg-indigo-600 hover:bg-indigo-500 text-white'
  const iconBg  = accent === 'amber'
    ? 'from-amber-400/20 to-amber-600/20'
    : 'from-indigo-400/20 to-indigo-600/20'

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border border-slate-800 ${ring} bg-slate-900 p-5 flex gap-4 items-start transition-all duration-200 group`}
    >
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${iconBg} flex items-center justify-center text-2xl flex-shrink-0`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-white font-bold text-lg">{title}</span>
          <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${badge}`}>
            {subtitle}
          </span>
        </div>
        <p className="text-slate-500 text-sm leading-relaxed">{description}</p>
      </div>
      <div className={`self-center flex-shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${btnBg} transition-colors`}>
        Select →
      </div>
    </button>
  )
}
