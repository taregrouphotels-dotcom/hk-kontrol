import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, type Profile } from '../lib/supabase'
import { fmtDate, fmtTime } from '../lib/format'
import { getActive, updateActive, type ActiveCleaning } from '../lib/active'
import { capture, closeCamera, openCamera, setTorch, torchSupported, type Shot } from '../lib/camera'
import { enqueue } from '../lib/queue'
import { callFunction } from '../lib/api'

// Rehberli kamera (spec 5.2): adım adım tam ekran çekim. Üstte adım ve talimat, altta büyük "Çek" düğmesi.
// Referans fotoğrafın yarı saydam hayaleti, fener gereken adımda fener, karanlık/bulanık kontrolü.
// Zorunlu adım atlanamaz; "Uygulanamıyor" sadece açıklamayla.

interface Step {
  id: string
  step_order: number
  zone: string
  title: string
  instruction: string
  checks: string[]
  applies_to: ('full' | 'stayover')[]
  required: boolean
  needs_flash: boolean
  shots: number
  reference_key: string | null
}

interface Item {
  step: Step
  shot: number
  key: string
}

const STEPS_CACHE = (rt: string) => `hk-steps-${rt}`

export default function Capture({ cleaningId, me }: { cleaningId: string; me: Profile }) {
  const [active, setActive] = useState<ActiveCleaning | undefined>(() => getActive(cleaningId))
  const [steps, setSteps] = useState<Step[]>()
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<Shot>()
  const [busy, setBusy] = useState(false)
  const [torch, setTorchState] = useState(false)
  const [canTorch, setCanTorch] = useState(false)
  const [refUrl, setRefUrl] = useState<string>()
  const [showRef, setShowRef] = useState(true)
  const [showChecks, setShowChecks] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream>()

  // Adımlar: sunucudan, çevrimdışıysa cihazdaki son kopyadan
  useEffect(() => {
    if (!active) return
    supabase.from('check_steps').select('*').eq('room_type_id', active.room_type_id).order('step_order').then(({ data, error }) => {
      if (data && data.length) {
        localStorage.setItem(STEPS_CACHE(active.room_type_id), JSON.stringify(data))
        setSteps(data as Step[])
      } else {
        const cached = localStorage.getItem(STEPS_CACHE(active.room_type_id))
        if (cached) setSteps(JSON.parse(cached))
        else setError(error ? 'İnternet yok ve bu oda tipinin adımları cihazda yok.' : 'Bu oda tipinin kontrol adımı yok.')
      }
    })
  }, [active])

  const items: Item[] = useMemo(
    () =>
      (steps ?? [])
        .filter((s) => active && s.applies_to.includes(active.type))
        .flatMap((s) => Array.from({ length: s.shots }, (_, i) => ({ step: s, shot: i + 1, key: `${s.id}:${i + 1}` }))),
    [steps, active],
  )
  const current = items.find((i) => !active?.done[i.key])
  const doneCount = items.filter((i) => active?.done[i.key]).length
  const stepCount = new Set(items.map((i) => i.step.id)).size
  const stepIndex = current ? [...new Set(items.map((i) => i.step.id))].indexOf(current.step.id) + 1 : stepCount

  // Kamera
  useEffect(() => {
    if (!current || preview) return
    let cancelled = false
    openCamera(video.current!)
      .then((s) => {
        if (cancelled) return closeCamera(s)
        stream.current = s
        setCanTorch(torchSupported(s))
      })
      .catch(() => setError('Kamera açılamadı. Tarayıcı ayarlarından kamera iznini verin.'))
    return () => {
      cancelled = true
      closeCamera(stream.current)
      stream.current = undefined
    }
    // Kamera adım değişince değil, sadece önizleme açılıp kapanınca yeniden açılır
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!current, !!preview])

  // Fener gereken adımda fener
  useEffect(() => {
    if (!current || !stream.current) return
    const want = current.step.needs_flash
    setTorch(stream.current, want).then((ok) => setTorchState(ok && want))
  }, [current?.key, canTorch]) // eslint-disable-line react-hooks/exhaustive-deps

  // Referans fotoğraf (R2 kurulu ve adımda referans varsa)
  useEffect(() => {
    setRefUrl(undefined)
    const key = current?.step.reference_key
    if (!key) return
    callFunction<{ url: string }>('media-sign', { action: 'view', key }).then((r) => setRefUrl(r.url)).catch(() => {})
  }, [current?.step.reference_key])

  const markDone = useCallback(
    (key: string, how: 'photo' | 'skip') => {
      if (!active) return
      setActive(updateActive(active.id, { done: { ...active.done, [key]: how } }))
    },
    [active],
  )

  async function shoot() {
    if (!current || !video.current || busy) return
    setBusy(true)
    try {
      const now = new Date()
      const s = current.step
      const shot = await capture(video.current, [
        `${active!.property_name} · Oda ${active!.room_no}`,
        `${me.full_name} · ${fmtDate(now)} ${fmtTime(now)}`,
        `Adım ${s.step_order}: ${s.title}${s.shots > 1 ? ` (${current.shot}/${s.shots})` : ''}`,
      ])
      if (shot.dark || shot.blurry) setPreview(shot)
      else await keep(shot)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  async function keep(shot: Shot) {
    if (!current) return
    await enqueue({
      kind: 'photo', cleaning_id: cleaningId, step_id: current.step.id, shot: current.shot, attempt: 1,
      captured_at: new Date().toISOString(), blob: shot.blob,
    })
    markDone(current.key, 'photo')
    setPreview(undefined)
  }

  async function notApplicable() {
    if (!current) return
    const reason = window.prompt(`"${current.step.title}" neden uygulanamıyor? (zorunlu açıklama)`)?.trim()
    if (!reason) return
    await enqueue({
      kind: 'skip', cleaning_id: cleaningId, step_id: current.step.id, shot: current.shot, reason,
      captured_at: new Date().toISOString(),
    })
    markDone(current.key, 'skip')
  }

  async function submit() {
    if (!active) return
    const at = new Date().toISOString()
    setActive(updateActive(active.id, { submitted_at: at }))
    await enqueue({ kind: 'rpc', fn: 'submit_cleaning', args: { p_cleaning: active.id, p_at: at } })
    window.location.hash = '#/'
  }

  if (!active) {
    return <p className="m-4 rounded-xl bg-white p-4 text-slate-600">Bu temizlik bu cihazda başlatılmamış.</p>
  }
  if (active.submitted_at) {
    return (
      <div className="m-4 space-y-3 rounded-xl bg-white p-5 text-center shadow-sm">
        <p className="text-lg font-bold text-emerald-700">Gönderildi</p>
        <p className="text-sm text-slate-600">Fotoğraflar arka planda yükleniyor. Süpervizör onaylayacak.</p>
        <a href="#/" className="block rounded-xl bg-brand py-3 font-semibold text-white">Bugün</a>
      </div>
    )
  }
  if (error && !current) return <p className="m-4 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>
  if (!steps) return <p className="p-4 text-slate-500">Adımlar yükleniyor…</p>

  // Hepsi çekildi: gönder
  if (!current) {
    return (
      <div className="m-4 space-y-4">
        <div className="rounded-2xl bg-emerald-50 p-5 text-emerald-900">
          <p className="text-xl font-bold">Tüm adımlar tamam</p>
          <p className="text-sm">
            Oda {active.room_no} · {doneCount} kare · {Object.values(active.done).filter((d) => d === 'skip').length} uygulanamıyor
          </p>
        </div>
        <button onClick={submit} className="w-full rounded-2xl bg-brand py-5 text-lg font-bold text-white shadow">
          Kontrolü gönder
        </button>
        <p className="text-center text-xs text-slate-500">İnternet yoksa da gönderebilirsiniz; bağlantı gelince yüklenir.</p>
      </div>
    )
  }

  const s = current.step
  return (
    <div className="fixed inset-0 z-30 bg-black text-white">
      {!preview && <video ref={video} className="absolute inset-0 h-full w-full object-cover" playsInline muted />}
      {!preview && refUrl && showRef && (
        <img src={refUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35" />
      )}
      {preview && <img src={preview.thumb} alt="" className="absolute inset-0 h-full w-full object-contain" />}

      {/* Üst: adım ve talimat */}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-white/70">
          <span>
            Adım {stepIndex}/{stepCount}
            {s.shots > 1 && ` · kare ${current.shot}/${s.shots}`}
          </span>
          <a href={`#/oda/${active.room_id}`} className="rounded px-2 py-1 normal-case active:bg-white/10">Çık</a>
        </div>
        <h1 className="mt-1 text-xl font-bold leading-tight">{s.title}</h1>
        <p className="mt-1 text-sm leading-snug text-white/90">{s.instruction}</p>
        {s.checks.length > 0 && (
          <button onClick={() => setShowChecks((v) => !v)} className="mt-1 text-xs text-white/70 underline">
            {showChecks ? 'Maddeleri gizle' : `Kontrol maddeleri (${s.checks.length})`}
          </button>
        )}
        {showChecks && (
          <ul className="mt-1 list-disc pl-5 text-xs text-white/90">
            {s.checks.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
        {s.needs_flash && !torch && <p className="mt-2 inline-block rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-black">Feneri açın</p>}
        <div className="mt-2 h-1 overflow-hidden rounded bg-white/20">
          <div className="h-full bg-emerald-400" style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </div>
      </div>

      {/* Alt: düğmeler */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
        {preview ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-amber-500 px-3 py-2 text-center text-sm font-semibold text-black">
              Fotoğraf {preview.dark ? 'karanlık' : 'bulanık'} görünüyor
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setPreview(undefined)} className="rounded-xl bg-white py-4 font-bold text-slate-800">Tekrar çek</button>
              <button onClick={() => keep(preview)} className="rounded-xl bg-white/20 py-4 font-semibold">Yine de kullan</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <button onClick={notApplicable} className="w-20 text-xs text-white/80">Uygulanamıyor</button>
            <button
              onClick={shoot}
              disabled={busy}
              aria-label="Çek"
              className="h-20 w-20 rounded-full border-4 border-white bg-white/30 active:scale-95 disabled:opacity-50"
            />
            <div className="flex w-20 flex-col items-end gap-2">
              {canTorch && (
                <button
                  onClick={async () => {
                    const next = !torch
                    if (stream.current && (await setTorch(stream.current, next))) setTorchState(next)
                  }}
                  className={`rounded-full px-3 py-2 text-xs font-semibold ${torch ? 'bg-amber-400 text-black' : 'bg-white/20'}`}
                >
                  Fener
                </button>
              )}
              {refUrl && (
                <button onClick={() => setShowRef((v) => !v)} className={`rounded-full px-3 py-2 text-xs ${showRef ? 'bg-white/40' : 'bg-white/20'}`}>
                  Referans
                </button>
              )}
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-center text-xs text-red-300">{error}</p>}
      </div>
    </div>
  )
}
