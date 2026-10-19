import { useCallback, useEffect, useMemo, useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import { fmtDate, fmtTime } from '../lib/format'
import { callFunction } from '../lib/api'
import { CLEANING_SELECT, duration, people, typeLabel, type CleaningRow } from './Review'

// Kontrol kaydı (spec 6): adım adım fotoğraflar, referansla karşılaştırma, Onayla / Not / İptal / Şikayet.

interface Detail extends CleaningRow {
  review_note: string | null
  reviewed_at: string | null
  complaint_note: string | null
  reviewer: { full_name: string } | null
  rooms: CleaningRow['rooms'] & { room_type_id: string }
}

interface Step {
  id: string
  step_order: number
  title: string
  instruction: string
  checks: string[]
  applies_to: ('full' | 'stayover')[]
  shots: number
}

interface Photo {
  id: string
  step_id: string
  shot: number
  attempt: number
  skipped: boolean
  skip_reason: string | null
  captured_at: string | null
  url: string | null
  ai_status: 'pending' | 'ok' | 'warn' | 'fail' | 'unclear'
  ai_result: { note?: string; problems?: { check: string; problem: string }[] } | null
  ai_false_alarm: boolean
}

// AI sonucunun rozeti (yanlış alarm işaretliyse gri)
const AI_BADGE: Record<Photo['ai_status'], [string, string]> = {
  ok: ['AI ✓', 'bg-emerald-600'],
  warn: ['AI !', 'bg-amber-500'],
  fail: ['AI ✗', 'bg-red-600'],
  unclear: ['AI ?', 'bg-slate-500'],
  pending: ['AI …', 'bg-slate-400'],
}

interface Item {
  step: Step
  shot: number
  photo?: Photo
}

export default function CleaningDetail({ cleaningId }: { cleaningId: string }) {
  const [c, setC] = useState<Detail | null>()
  const [steps, setSteps] = useState<Step[]>([])
  const [photos, setPhotos] = useState<Photo[]>()
  const [refs, setRefs] = useState<Record<string, string>>({})
  const [mediaError, setMediaError] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [open, setOpen] = useState<number>()

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('cleanings')
      .select(
        CLEANING_SELECT.replace('rooms(room_no, properties(name))', 'rooms(room_no, room_type_id, properties(name))') +
          ', review_note, reviewed_at, complaint_note, reviewer:profiles!cleanings_reviewed_by_fkey(full_name)',
      )
      .eq('id', cleaningId)
      .maybeSingle()
    if (error) return setError(errorText(error))
    const d = data as unknown as Detail | null
    setC(d)
    if (!d) return
    setNote(d.review_note ?? '')
    const s = await supabase
      .from('check_steps')
      .select('id, step_order, title, instruction, checks, applies_to, shots')
      .eq('room_type_id', d.rooms.room_type_id)
      .order('step_order')
    setSteps((s.data as Step[]) ?? [])
    try {
      const m = await callFunction<{ photos: Photo[]; references: Record<string, string> }>('media-sign', {
        action: 'cleaning',
        cleaning_id: cleaningId,
      })
      setPhotos(m.photos)
      setRefs(m.references)
    } catch (e) {
      setPhotos([])
      setMediaError(e instanceof Error ? e.message : errorText(e))
    }
  }, [cleaningId])

  useEffect(() => {
    load()
  }, [load])

  // Her adım/kare için son deneme
  const items: Item[] = useMemo(() => {
    if (!c) return []
    return steps
      .filter((s) => s.applies_to.includes(c.type))
      .flatMap((s) =>
        Array.from({ length: s.shots }, (_, i) => {
          const shot = i + 1
          const photo = (photos ?? [])
            .filter((p) => p.step_id === s.id && p.shot === shot)
            .sort((a, b) => b.attempt - a.attempt)[0]
          return { step: s, shot, photo }
        }),
      )
  }, [steps, photos, c])

  async function rpc(fn: string, args: Record<string, unknown>, back = false) {
    setBusy(true)
    setError(undefined)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return setError(errorText(error))
    if (back) window.location.hash = '#/onay'
    else load()
  }

  if (c === undefined) return <p className="p-4 text-slate-500">{error ?? 'Yükleniyor…'}</p>
  if (c === null) return <p className="m-4 rounded-xl bg-white p-4 text-slate-600">Kayıt bulunamadı.</p>

  const reviewable = c.status === 'submitted' || c.status === 'escalated'
  const missing = photos ? items.filter((i) => !i.photo).length : 0

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      <a href="#/onay" className="text-sm text-brand">
        ← Onay
      </a>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h1 className="text-3xl font-extrabold text-slate-800">{c.rooms.room_no}</h1>
          <span className="text-sm text-slate-500">{c.rooms.properties.name}</span>
        </div>
        <p className="text-base text-slate-700">{people(c)}</p>
        <p className="mt-1 text-sm text-slate-500">
          {typeLabel[c.type]} · {fmtDate(c.started_at)} {fmtTime(c.started_at)}
          {c.finished_at && `–${fmtTime(c.finished_at)} · ${duration(c)}`}
        </p>
        {c.status === 'approved' && (
          <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Onaylandı{c.reviewer && `: ${c.reviewer.full_name}`}
            {c.reviewed_at && ` · ${fmtTime(c.reviewed_at)}`}
          </p>
        )}
        {c.status === 'cancelled' && (
          <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">İptal edildi: {c.review_note}</p>
        )}
        {c.status === 'in_progress' && <p className="mt-2 text-sm text-amber-700">Temizlik / kontrol sürüyor.</p>}
      </div>

      {mediaError && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Fotoğraflar alınamadı: {mediaError}</p>}
      {missing > 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {missing} kare henüz yüklenmedi (HK'nın telefonunda bekliyor olabilir).
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {items.map((it, i) => (
          <button
            key={`${it.step.id}:${it.shot}`}
            onClick={() => it.photo?.url && setOpen(i)}
            className="overflow-hidden rounded-xl bg-white text-left shadow-sm"
          >
            <div className="relative flex aspect-[4/3] items-center justify-center bg-slate-200">
              {it.photo && !it.photo.skipped && (
                <span
                  className={`absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                    it.photo.ai_false_alarm ? 'bg-slate-400 line-through' : AI_BADGE[it.photo.ai_status][1]
                  }`}
                >
                  {AI_BADGE[it.photo.ai_status][0]}
                </span>
              )}
              {it.photo?.url ? (
                <img src={it.photo.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : it.photo?.skipped ? (
                <span className="px-2 text-center text-xs text-amber-800">Uygulanamıyor: {it.photo.skip_reason}</span>
              ) : (
                <span className="text-xs text-slate-500">{photos ? 'Yüklenmedi' : '…'}</span>
              )}
            </div>
            <div className="px-2 py-1.5">
              <p className="truncate text-xs font-semibold text-slate-700">
                {it.step.step_order}. {it.step.title}
                {it.step.shots > 1 && ` (${it.shot}/${it.step.shots})`}
              </p>
              {it.photo?.captured_at && (
                <p className="text-[11px] text-slate-500">
                  {fmtTime(it.photo.captured_at)}
                  {it.photo.attempt > 1 && ` · ${it.photo.attempt}. deneme`}
                </p>
              )}
              {it.photo?.ai_result?.note && ['warn', 'fail', 'unclear'].includes(it.photo.ai_status) && !it.photo.ai_false_alarm && (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-700">{it.photo.ai_result.note}</p>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Not (isteğe bağlı)"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base"
        />
        {reviewable && (
          <button
            disabled={busy}
            onClick={() => rpc('approve_cleaning', { p_cleaning: c.id, p_note: note }, true)}
            className="w-full rounded-2xl bg-emerald-600 py-4 text-lg font-bold text-white shadow disabled:opacity-50"
          >
            Onayla
          </button>
        )}
        {note.trim() !== (c.review_note ?? '') && (
          <button
            disabled={busy}
            onClick={() => rpc('add_review_note', { p_cleaning: c.id, p_note: note })}
            className="w-full rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            Notu kaydet
          </button>
        )}
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => {
              const n = c.complaint ? null : window.prompt('Şikayet notu (fotoğraflar silinmez):')
              if (c.complaint || n !== null) rpc('set_complaint', { p_cleaning: c.id, p_complaint: !c.complaint, p_note: n })
            }}
            className={`flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50 ${
              c.complaint ? 'bg-red-600 text-white' : 'border border-slate-300 text-slate-700'
            }`}
          >
            {c.complaint ? 'Şikayet var · kaldır' : 'Şikayet işaretle'}
          </button>
          {c.status !== 'cancelled' && (
            <button
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('İptal nedeni (ör. yanlış oda):')?.trim()
                if (reason) rpc('cancel_cleaning', { p_cleaning: c.id, p_note: reason }, true)
              }}
              className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-500 disabled:opacity-50"
            >
              Kaydı iptal et
            </button>
          )}
        </div>
        {c.complaint && c.complaint_note && <p className="text-sm text-red-700">Şikayet: {c.complaint_note}</p>}
        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </div>

      {open !== undefined && (
        <Viewer items={items} index={open} refs={refs} onIndex={setOpen} onClose={() => setOpen(undefined)} onChanged={load} />
      )}
    </div>
  )
}

// Tam ekran fotoğraf; varsa referansla karşılaştırma, sağ/sol ile adımlar arasında gezinme
function Viewer({
  items,
  index,
  refs,
  onIndex,
  onClose,
  onChanged,
}: {
  items: Item[]
  index: number
  refs: Record<string, string>
  onIndex: (i: number) => void
  onClose: () => void
  onChanged: () => void
}) {
  const [showRef, setShowRef] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>()
  const withPhoto = items.map((it, i) => (it.photo?.url ? i : -1)).filter((i) => i >= 0)
  const pos = withPhoto.indexOf(index)
  const it = items[index]
  const ref = refs[it.step.id]
  const p = it.photo!

  // AI'ın yanlış uyarısı: kaydın genel AI sonucundan düşer, raporda "yanlış alarm" sayılır
  async function falseAlarm() {
    setBusy(true)
    const { error } = await supabase.from('step_results').update({ ai_false_alarm: !p.ai_false_alarm }).eq('id', p.id)
    setBusy(false)
    if (error) setMsg(errorText(error))
    else onChanged()
  }

  // Bu fotoğraf oda tipinin bu adımı için referans olsun (HK kamerasında transparan görünür)
  async function makeReference() {
    if (!window.confirm('Bu fotoğraf, bu oda tipindeki tüm odalarda bu adımın referansı olsun mu?')) return
    setBusy(true)
    try {
      await callFunction('media-sign', { action: 'set_reference', step_result_id: p.id })
      setMsg('Referans yapıldı.')
      onChanged()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-black text-white">
      <div className="flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div>
          <p className="font-semibold">
            {it.step.step_order}. {it.step.title}
            {it.step.shots > 1 && ` (${it.shot}/${it.step.shots})`}
          </p>
          <p className="text-xs text-white/70">{it.step.instruction}</p>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-lg bg-white/15 px-3 py-2 text-sm">
          Kapat
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <img src={showRef && ref ? ref : it.photo!.url!} alt="" className="h-full w-full object-contain" />
        {showRef && <span className="absolute left-3 top-3 rounded bg-amber-400 px-2 py-1 text-xs font-bold text-black">REFERANS</span>}
      </div>
      {!showRef && p.ai_status !== 'pending' && (
        <div className={`mx-4 mt-2 rounded-lg px-3 py-2 text-xs ${p.ai_false_alarm ? 'bg-white/10' : AI_BADGE[p.ai_status][1]}`}>
          <p className="font-semibold">
            {AI_BADGE[p.ai_status][0]} {p.ai_false_alarm && '· yanlış alarm işaretli'}
          </p>
          {p.ai_result?.note && <p>{p.ai_result.note}</p>}
          {p.ai_result?.problems?.map((x) => (
            <p key={x.check}>
              • {x.check}: {x.problem}
            </p>
          ))}
        </div>
      )}
      <div className="flex gap-2 px-4 pt-2">
        {['warn', 'fail', 'unclear'].includes(p.ai_status) && (
          <button disabled={busy} onClick={falseAlarm} className="flex-1 rounded-lg bg-white/15 py-2 text-xs disabled:opacity-50">
            {p.ai_false_alarm ? 'Yanlış alarmı geri al' : 'Yanlış alarm'}
          </button>
        )}
        <button disabled={busy} onClick={makeReference} className="flex-1 rounded-lg bg-white/15 py-2 text-xs disabled:opacity-50">
          Referans yap
        </button>
      </div>
      {msg && <p className="px-4 pt-1 text-xs text-amber-300">{msg}</p>}
      {it.step.checks.length > 0 && (
        <ul className="list-disc px-8 pt-2 text-xs text-white/80">
          {it.step.checks.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          disabled={pos <= 0}
          onClick={() => onIndex(withPhoto[pos - 1])}
          className="rounded-xl bg-white/15 px-5 py-3 text-lg disabled:opacity-30"
        >
          ‹
        </button>
        {ref ? (
          <button
            onClick={() => setShowRef((v) => !v)}
            className={`rounded-xl px-4 py-3 text-sm font-semibold ${showRef ? 'bg-amber-400 text-black' : 'bg-white/15'}`}
          >
            {showRef ? 'Çekilen fotoğraf' : 'Referansı göster'}
          </button>
        ) : (
          <span className="text-xs text-white/50">Referans yok</span>
        )}
        <button
          disabled={pos >= withPhoto.length - 1}
          onClick={() => onIndex(withPhoto[pos + 1])}
          className="rounded-xl bg-white/15 px-5 py-3 text-lg disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </div>
  )
}
