import { useEffect, useRef, useState } from 'react'
import { capture, closeCamera, openCamera, type Shot } from '../lib/camera'

// Hasar / kayıp eşya için 1–3 fotoğraf (spec 5.5, 5.6). Sadece canlı kamera; çekilenler filigranlı, galeriye düşmez.
export default function PhotoTaker({
  watermark,
  max = 3,
  initial,
  onDone,
}: {
  watermark: () => string[]
  max?: number
  initial: Shot[]
  onDone: (shots: Shot[]) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [shots, setShots] = useState<Shot[]>(initial)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stream: MediaStream | undefined
    let cancelled = false
    openCamera(video.current!)
      .then((s) => (cancelled ? closeCamera(s) : (stream = s)))
      .catch(() => setError('Kamera açılamadı. Tarayıcı ayarlarından kamera iznini verin.'))
    return () => {
      cancelled = true
      closeCamera(stream)
    }
  }, [])

  async function shoot() {
    if (!video.current || busy || shots.length >= max) return
    setBusy(true)
    try {
      setShots([...shots, await capture(video.current, watermark())])
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black text-white">
      <video ref={video} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="font-semibold">
          Fotoğraf {shots.length}/{max}
        </p>
        {error && <p className="mt-1 text-sm text-red-300">{error}</p>}
        <div className="mt-2 flex gap-2">
          {shots.map((s, i) => (
            <button key={i} onClick={() => setShots(shots.filter((_, j) => j !== i))} className="relative">
              <img src={s.thumb} alt="" className="h-16 w-12 rounded object-cover" />
              <span className="absolute -right-1 -top-1 rounded-full bg-black/70 px-1.5 text-xs">✕</span>
            </button>
          ))}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
        <button onClick={() => onDone(initial)} className="w-20 text-sm text-white/80">
          Vazgeç
        </button>
        <button
          onClick={shoot}
          disabled={busy || shots.length >= max}
          aria-label="Çek"
          className="h-20 w-20 rounded-full border-4 border-white bg-white/30 active:scale-95 disabled:opacity-40"
        />
        <button onClick={() => onDone(shots)} className="w-20 text-right text-sm font-bold">
          Bitti
        </button>
      </div>
    </div>
  )
}
