import { useCallback, useEffect, useState } from 'react'
import { errorText, supabase, type CleaningStatus } from '../lib/supabase'
import { fmtDate, fmtTime } from '../lib/format'

// Onay listesi (spec 6, Faz 1): gönderilmiş kontroller en eskiden yeniye; altta bugün onaylananlar.
// Süpervizör kendi bölgesini, admin hepsini görür (RLS).

export interface CleaningRow {
  id: string
  status: CleaningStatus
  type: 'full' | 'stayover'
  started_at: string
  check_started_at: string | null
  finished_at: string | null
  started_via_qr: boolean
  complaint: boolean
  rooms: { room_no: string; properties: { name: string } }
  hk: { full_name: string } | null
  cleaning_members: { profiles: { full_name: string } | null }[]
  step_results: { skipped: boolean }[]
}

export const CLEANING_SELECT =
  'id, status, type, started_at, check_started_at, finished_at, started_via_qr, complaint, ' +
  'rooms(room_no, properties(name)), hk:profiles!cleanings_hk_id_fkey(full_name), ' +
  'cleaning_members(profiles(full_name)), step_results(skipped)'

export const typeLabel = { full: 'Tam kontrol', stayover: 'Konaklama kontrolü' }

export function people(c: CleaningRow): string {
  return [c.hk?.full_name, ...c.cleaning_members.map((m) => m.profiles?.full_name)].filter(Boolean).join(', ')
}

export function duration(c: CleaningRow): string {
  if (!c.finished_at) return ''
  const m = Math.round((Date.parse(c.finished_at) - Date.parse(c.started_at)) / 60000)
  return `${m} dk`
}

const istanbulDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())

export default function Review() {
  const [waiting, setWaiting] = useState<CleaningRow[]>()
  const [approved, setApproved] = useState<CleaningRow[]>([])
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setError(undefined)
    const [w, a] = await Promise.all([
      supabase.from('cleanings').select(CLEANING_SELECT).in('status', ['submitted', 'escalated']).order('finished_at'),
      supabase
        .from('cleanings')
        .select(CLEANING_SELECT)
        .eq('status', 'approved')
        .eq('day', istanbulDay())
        .order('reviewed_at', { ascending: false }),
    ])
    if (w.error || a.error) return setError(errorText(w.error ?? a.error))
    setWaiting(w.data as unknown as CleaningRow[])
    setApproved(a.data as unknown as CleaningRow[])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-3 px-4 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">Onay bekleyen {waiting ? `(${waiting.length})` : ''}</h1>
        <button onClick={load} className="rounded-lg px-3 py-2 text-sm text-brand active:bg-slate-200">
          Yenile
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!waiting && !error && <p className="text-slate-500">Yükleniyor…</p>}
      {waiting?.length === 0 && <p className="rounded-xl bg-white p-4 text-slate-600 shadow-sm">Onay bekleyen kontrol yok.</p>}
      {waiting?.map((c) => <Card key={c.id} c={c} />)}

      {approved.length > 0 && (
        <>
          <h2 className="pt-3 text-sm font-semibold text-slate-500">Bugün onaylanan ({approved.length})</h2>
          {approved.map((c) => (
            <Card key={c.id} c={c} />
          ))}
        </>
      )}
    </div>
  )
}

function Card({ c }: { c: CleaningRow }) {
  const skipped = c.step_results.filter((s) => s.skipped).length
  return (
    <a href={`#/kayit/${c.id}`} className="block rounded-xl bg-white p-4 shadow-sm active:bg-slate-50">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-extrabold text-slate-800">{c.rooms.room_no}</span>
        <span className="truncate text-xs text-slate-500">{c.rooms.properties.name}</span>
      </div>
      <p className="text-sm text-slate-700">{people(c)}</p>
      <p className="mt-1 text-xs text-slate-500">
        {typeLabel[c.type]} · {c.finished_at ? `${fmtDate(c.finished_at)} ${fmtTime(c.finished_at)}` : ''} · {duration(c)}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
        {c.status === 'approved' && <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">Onaylandı</span>}
        {skipped > 0 && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">{skipped} uygulanamıyor</span>}
        {c.complaint && <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">Şikayet</span>}
      </div>
    </a>
  )
}
