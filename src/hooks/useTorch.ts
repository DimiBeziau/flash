import { useRef, useCallback, useState } from 'react'

export type TorchMode = 'torch' | 'screen' | 'none'

export interface TorchControls {
  mode: TorchMode
  ready: boolean
  error: string | null
  init: () => Promise<void>
  setLight: (on: boolean) => Promise<void>
  release: () => void
}

export function useTorch(): TorchControls {
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef  = useRef<MediaStreamTrack | null>(null)
  const [mode, setMode]   = useState<TorchMode>('none')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const init = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      trackRef.current = track

      // Try hardware torch
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean }
      if (capabilities.torch) {
        await (track.applyConstraints as (c: object) => Promise<void>)({ advanced: [{ torch: false }] })
        setMode('torch')
      } else {
        setMode('screen')
      }
      setReady(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setMode('screen')
      setReady(true) // screen flash always works
    }
  }, [])

  const setLight = useCallback(async (on: boolean) => {
    if (mode === 'torch' && trackRef.current) {
      try {
        await (trackRef.current.applyConstraints as (c: object) => Promise<void>)({
          advanced: [{ torch: on }],
        })
      } catch {
        // fall through to screen mode silently
      }
    }
    // screen mode is handled by the component via CSS
  }, [mode])

  const release = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
      trackRef.current = null
    }
    setReady(false)
    setMode('none')
  }, [])

  return { mode, ready, error, init, setLight, release }
}
