import { useState } from 'react'
import RoleSelector from './components/RoleSelector'
import EmitterMode  from './components/EmitterMode'
import ReceiverMode from './components/ReceiverMode'

type Role = 'emitter' | 'receiver' | null

export default function App() {
  const [role, setRole] = useState<Role>(null)

  if (role === 'emitter') {
    return (
      <div>
        <BackButton onClick={() => setRole(null)} />
        <EmitterMode />
      </div>
    )
  }

  if (role === 'receiver') {
    return (
      <div>
        <BackButton onClick={() => setRole(null)} />
        <ReceiverMode />
      </div>
    )
  }

  return <RoleSelector onSelect={setRole} />
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed top-4 left-4 z-50 flex items-center gap-1.5 bg-slate-900/80 backdrop-blur border border-slate-700 rounded-xl px-3 py-2 text-slate-300 text-sm font-mono hover:border-slate-500 transition-colors"
    >
      ← Back
    </button>
  )
}
