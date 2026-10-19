import { useEffect, useRef, useState } from 'react'
import { supabase, type Profile } from '../lib/supabase'
import { fmtDate, fmtTime } from '../lib/format'
import { callFunction } from '../lib/api'
import { capture, closeCamera, openCamera, setTorch, type Shot } from '../lib/camera'

// Referans çekim modu (karar 21): süpervizör/admin odada adımları "olması gereken" haliyle sırayla çeker;
// her kare o oda tipinin referansı olur (HK kamerasında transparan görünür, AI karşılaştırır). İnternet gerekir.

interface Step {
  id: string
  step_order: number
  title: string
  instruction: string
  needs_flash: boolean
  reference_key: string | null
}

export default function ReferenceCapture({ roomId, me }: { roomId: string; me: Profile }) {
  const [room, setRoom] = useState<{ room_no: string; room_type_id: string; properties: { name: string }; room_types: { code: string } }>()
  const [steps, setSteps] = useState<Step[]>()
  const [i, setI] = useState(0)
  const [preview, setPreview] = useState<Shot>()
  const [refUrl, setRefUrl] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string>()
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream>()

  useEffect(() => {
    supabase
      .from('rooms')
      .select('room_no, room_type_id, properties(name), room_types(code)')
      .eq('id', roomId)
      .single()
      .then(({ data }) => {
        const r = data as unknown as NonNullable<typeof room>
        setRoom(r)
        supabase
          .from('check_steps')
          .select('id, step_order, title, instruction, needs_flash, reference_key')
          .eq('room_type_id', r.room_type_id)
          .order('step_order')
          .then(({ data }) => setSteps((data as Step[]) ?? []))
      })
  }, [roomId])

  const step = steps?.[i]

  useEffect(() => {
    if (!step || preview) return
    let cancelled = false
    openCamera(video.current!)
      .then((s) => {
        if (cancelled) return closeCamera(s)
        stream.current = s
        setTorch(s, step.needs_flash)
      })
      .catch(() => setError('Kamera açılamadı.'))
    return () => {
      cancelled = true
      closeCamera(stream.current)
    }
  }, [step, preview])

  useEffect(() => {
    setRefUrl(undefined)
    if (step?.reference_key) callFunction<{ url: string }>('media-sign', { action: 'view', key: step.reference_key }).then((r) => setRefUrl(r.url)).catch(() => {})
  }, [step])

  async function shoot() {
    if (!video.current || !step || !room) return
    const now = new Date()
    setPreview(await capture(video.current, [`REFERANS · ${room.room_types.code} · ${room.properties.name} ${room.room_no}`, `${me.full_name} · ${fmtDate(now)} ${fmtTime(now)}`, `Adım ${step.step_order}: ${step.title}`]))
  }

  async function keep() {
    if (!preview || !step) return
    setBusy(true)
    setError(undefined)
    try {
      const up = await callFunction<{ key: string; url: string }>('media-sign', { action: 'reference_upload', step_id: step.id })
      const put = await fetch(up.url, { method: 'PUT', body: preview.blob, headers: { 'Content-Type': 'image/jpeg' } })
      if (!put.ok) throw new Error(`Yükleme hatası (${put.status})`)
      await callFunction('media-sign', { action: 'reference_commit', step_id: step.id, key: up.key })
      setSteps(steps!.map((s) => (s.id === step.id ? { ...s, reference_key: up.key } : s)))
      setDone({ ...done, [step.id]: true })
      setPreview(undefined)
      setI(i + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!steps || !room) return <p className="p-4 text-slate-500">Yükleniyor…</p>
  if (!step) {
    return (
      <div className="m-4 space-y-3 rounded-2xl bg-white p-5 text-center shadow-sm">
        <p className="text-lg font-bold text-emerald-700">Referans çekimi bitti</p>
        <p className="text-sm text-slate-600">
          {room.room_types.code} tipinde {Object.keys(done).length} adımın referansı güncellendi. Bu tipteki tüm odalarda HK kamerasında görünecek.
        </p>
        <a href={`#/oda/${roomId}`} className="block rounded-xl bg-brand py-3 font-semibold text-white">
          Oda sayfası
        </a>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-30 bg-black text-white">
      {!preview && <video ref={video} className="absolute inset-0 h-full w-full object-cover" playsInline muted />}
      {!preview && refUrl && <img src={refUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30" />}
      {preview && <img src={preview.thumb} alt="" className="absolute inset-0 h-full w-full object-contain" />}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-amber-300">
          <span>
            Referans çekimi · {room.room_types.code} · adım {i + 1}/{steps.length}
          </span>
          <a href={`#/oda/${roomId}`} className="normal-case text-white/80">
            Çık
          </a>
        </div>
        <h1 className="mt-1 text-xl font-bold">{step.title}</h1>
        <p className="text-sm text-white/90">{step.instruction}</p>
        <p className="mt-1 text-xs text-white/60">{step.reference_key ? 'Bu adımın referansı var; yenisi çekilirse değişir.' : 'Bu adımın referansı yok.'}</p>
        {error && <p className="mt-1 text-sm text-red-300">{error}</p>}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
        {preview ? (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setPreview(undefined)} className="rounded-xl bg-white/20 py-4 font-semibold">
              Tekrar çek
            </button>
            <button disabled={busy} onClick={keep} className="rounded-xl bg-white py-4 font-bold text-slate-800 disabled:opacity-50">
              {busy ? 'Kaydediliyor…' : 'Referans yap'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <button disabled={i === 0} onClick={() => setI(i - 1)} className="w-20 text-sm text-white/80 disabled:opacity-30">
              ‹ Önceki
            </button>
            <button onClick={shoot} aria-label="Çek" className="h-20 w-20 rounded-full border-4 border-amber-300 bg-white/30 active:scale-95" />
            <button onClick={() => setI(i + 1)} className="w-20 text-right text-sm text-white/80">
              Atla ›
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
