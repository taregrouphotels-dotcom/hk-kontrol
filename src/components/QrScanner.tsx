import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { closeCamera, openCamera } from '../lib/camera'

// Kapıdaki QR'ı okur (spec 5.1). QR içeriği: https://…/#/qr/<qr_token> ya da sadece token.
export function qrToken(text: string): string | null {
  const m = text.match(/qr\/([0-9a-f]{8,})/i) ?? text.trim().match(/^([0-9a-f]{8,})$/i)
  return m ? m[1].toLowerCase() : null
}

export default function QrScanner({ onResult, onClose }: { onResult: (token: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer = 0
    let stopped = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    const tick = () => {
      const v = video.current
      if (stopped || !v) return
      if (v.videoWidth) {
        const s = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight))
        canvas.width = Math.round(v.videoWidth * s)
        canvas.height = Math.round(v.videoHeight * s)
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
        const token = code ? qrToken(code.data) : null
        if (token) {
          stopped = true
          onResult(token)
          return
        }
      }
      timer = window.setTimeout(tick, 200)
    }

    openCamera(video.current!)
      .then((s) => {
        stream = s
        tick()
      })
      .catch(() => setError('Kamera açılamadı. Tarayıcı ayarlarından kamera iznini verin.'))
    return () => {
      stopped = true
      clearTimeout(timer)
      closeCamera(stream)
    }
  }, [onResult])

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-black">
      <video ref={video} className="h-full w-full object-cover" playsInline muted />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-64 w-64 rounded-3xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
      </div>
      <div className="absolute inset-x-0 top-0 p-4 text-center text-white">
        <p className="text-lg font-semibold">Kapıdaki QR'ı çerçeveye getirin</p>
        {error && <p className="mt-2 rounded-lg bg-red-600/80 px-3 py-2 text-sm">{error}</p>}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button onClick={onClose} className="w-full rounded-xl bg-white/90 py-4 text-base font-semibold text-slate-800">
          Vazgeç
        </button>
      </div>
    </div>
  )
}
