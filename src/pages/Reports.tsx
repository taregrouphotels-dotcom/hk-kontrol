import { useCallback, useEffect, useMemo, useState } from 'react'
import { errorText, supabase, type Profile } from '../lib/supabase'
import { fmtDate, fmtTime } from '../lib/format'
import { downloadXlsx } from '../lib/excelExport'

// Raporlar (spec 7): Personel · Şikayet arama · Hasar ve eşya. Süpervizör kendi bölgesini, admin hepsini görür (RLS).
// Adres: #/raporlar[/personel|sikayet|hasar]

const istanbulDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d)
const monthStart = () => istanbulDay().slice(0, 8) + '01'

export default function Reports({ seg }: { seg?: string; me: Profile }) {
  const tab = seg === 'sikayet' || seg === 'hasar' ? seg : 'personel'
  const link = (k: string, label: string) => (
    <a href={`#/raporlar/${k}`} className={`flex-1 rounded-lg py-2 text-center text-sm font-semibold ${tab === k ? 'bg-white text-brand shadow-sm' : 'text-slate-500'}`}>
      {label}
    </a>
  )
  return (
    <div className="space-y-3 px-4 pb-8 pt-4">
      <div className="flex gap-1 rounded-xl bg-slate-200 p-1">
        {link('personel', 'Personel')}
        {link('sikayet', 'Şikayet')}
        {link('hasar', 'Hasar/Eşya')}
      </div>
      {tab === 'personel' && <StaffReport />}
      {tab === 'sikayet' && <ComplaintSearch />}
      {tab === 'hasar' && <DamageReport />}
    </div>
  )
}

function Range({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex gap-2 text-xs text-slate-500">
      <label className="flex-1">
        Başlangıç
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5" />
      </label>
      <label className="flex-1">
        Bitiş
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5" />
      </label>
    </div>
  )
}

// ---------- Personel ----------
interface CRow {
  id: string
  day: string
  type: 'full' | 'stayover'
  status: string
  started_at: string
  finished_at: string | null
  started_via_qr: boolean
  ai_overall: string
  approved_by_ai: boolean
  hk_id: string
  hk: { full_name: string } | null
  cleaning_members: { profile_id: string; profiles: { full_name: string } | null }[]
  step_results: { attempt: number; ai_status: string; ai_false_alarm: boolean; skipped: boolean }[]
  rooms: { room_no: string; properties: { name: string }; room_types: { code: string; min_minutes_full: number; min_minutes_stayover: number } }
}

interface PersonStat {
  name: string
  total: number
  full: number
  stayover: number
  shared: number
  minutes: number[]
  firstPass: number
  aiJudged: number
  retakes: number
  short: number
  skipped: number
}

const minutesOf = (c: CRow) => (c.finished_at ? Math.round((Date.parse(c.finished_at) - Date.parse(c.started_at)) / 60000) : null)
const isShort = (c: CRow) => {
  const m = minutesOf(c)
  const min = c.type === 'stayover' ? c.rooms.room_types.min_minutes_stayover : c.rooms.room_types.min_minutes_full
  return m !== null && m < min
}

function StaffReport() {
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(() => istanbulDay())
  const [rows, setRows] = useState<CRow[]>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setRows(undefined)
    const { data, error } = await supabase
      .from('cleanings')
      .select(
        'id, day, type, status, started_at, finished_at, started_via_qr, ai_overall, approved_by_ai, hk_id, hk:profiles!cleanings_hk_id_fkey(full_name), ' +
          'cleaning_members(profile_id, profiles(full_name)), step_results(attempt, ai_status, ai_false_alarm, skipped), ' +
          'rooms(room_no, properties(name), room_types(code, min_minutes_full, min_minutes_stayover))',
      )
      .gte('day', from)
      .lte('day', to)
      .in('status', ['submitted', 'analyzing', 'approved', 'escalated', 'fixing'])
      .order('started_at')
      .limit(5000)
    if (error) return setError(errorText(error))
    setRows(data as unknown as CRow[])
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  const people = useMemo(() => {
    const m = new Map<string, PersonStat>()
    const get = (id: string, name: string) => {
      if (!m.has(id)) m.set(id, { name, total: 0, full: 0, stayover: 0, shared: 0, minutes: [], firstPass: 0, aiJudged: 0, retakes: 0, short: 0, skipped: 0 })
      return m.get(id)!
    }
    for (const c of rows ?? []) {
      const p = get(c.hk_id, c.hk?.full_name ?? '?')
      p.total++
      if (c.type === 'full') p.full++
      else p.stayover++
      const mins = minutesOf(c)
      if (mins !== null) p.minutes.push(mins)
      const retakes = c.step_results.filter((s) => s.attempt > 1).length
      p.retakes += retakes
      p.skipped += c.step_results.filter((s) => s.skipped).length
      if (c.ai_overall !== 'pending') {
        p.aiJudged++
        if (retakes === 0 && c.ai_overall === 'ok') p.firstPass++
      }
      if (isShort(c)) p.short++
      for (const mbr of c.cleaning_members) get(mbr.profile_id, mbr.profiles?.full_name ?? '?').shared++
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [rows])

  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null)
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null)

  async function excel() {
    await downloadXlsx(`Personel_${from}_${to}.xlsx`, [
      {
        name: 'Personel',
        header: ['Kişi', 'Oda', 'Tam', 'Konaklama', 'Ortak (yardım)', 'Ort. süre (dk)', 'AI ilk seferde geçme %', 'Tekrar çekim', 'Şüpheli kısa', 'Uygulanamıyor'],
        rows: people.map((p) => [p.name, p.total, p.full, p.stayover, p.shared, avg(p.minutes), pct(p.firstPass, p.aiJudged), p.retakes, p.short, p.skipped]),
      },
      {
        name: 'Temizlikler',
        header: ['Tarih', 'Otel', 'Oda', 'Tip', 'Tür', 'HK', 'Birlikte', 'Başlangıç', 'Bitiş', 'Süre (dk)', 'Şüpheli kısa', 'AI', 'Tekrar çekim', 'Durum'],
        rows: (rows ?? []).map((c) => [
          fmtDate(c.started_at), c.rooms.properties.name, c.rooms.room_no, c.rooms.room_types.code, c.type === 'full' ? 'Tam' : 'Konaklama',
          c.hk?.full_name, c.cleaning_members.map((m) => m.profiles?.full_name).join(', '), fmtTime(c.started_at),
          c.finished_at ? fmtTime(c.finished_at) : null, minutesOf(c), isShort(c) ? 'Evet' : null, c.ai_overall,
          c.step_results.filter((s) => s.attempt > 1).length, c.status === 'approved' ? (c.approved_by_ai ? 'Onaylandı (AI)' : 'Onaylandı') : 'Onay bekliyor',
        ]),
      },
    ])
  }

  return (
    <>
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <p className="text-slate-500">Yükleniyor…</p>}
      {rows && (
        <>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>{rows.length} temizlik</span>
            <button onClick={excel} className="rounded-lg bg-white px-3 py-2 font-semibold text-brand shadow-sm">
              Excel'e indir
            </button>
          </div>
          {people.length === 0 && <p className="rounded-xl bg-white p-4 text-slate-600 shadow-sm">Bu aralıkta temizlik yok.</p>}
          {people.map((p) => (
            <div key={p.name} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold text-slate-800">{p.name}</span>
                <span className="text-2xl font-extrabold text-slate-800">{p.total}</span>
              </div>
              <p className="text-xs text-slate-500">
                {p.full} tam · {p.stayover} konaklama{p.shared ? ` · ${p.shared} ortak` : ''}
              </p>
              <div className="mt-2 grid grid-cols-4 gap-1 text-center text-xs">
                {[
                  [avg(p.minutes) !== null ? `${avg(p.minutes)} dk` : '—', 'ort. süre'],
                  [pct(p.firstPass, p.aiJudged) !== null ? `%${pct(p.firstPass, p.aiJudged)}` : '—', 'AI ilk sefer'],
                  [String(p.retakes), 'tekrar çekim'],
                  [String(p.short), 'şüpheli kısa'],
                ].map(([v, k]) => (
                  <div key={k} className={`rounded-lg p-1.5 ${k === 'şüpheli kısa' && p.short ? 'bg-red-50 text-red-800' : 'bg-slate-50'}`}>
                    <div className="font-bold">{v}</div>
                    <div className="text-[10px] text-slate-500">{k}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  )
}

// ---------- Şikayet arama ----------
interface RoomOpt {
  id: string
  room_no: string
  properties: { name: string }
}

function ComplaintSearch() {
  const [rooms, setRooms] = useState<RoomOpt[]>([])
  const [room, setRoom] = useState('')
  const [day, setDay] = useState(() => istanbulDay())
  const [rows, setRows] = useState<{ id: string; day: string; status: string; complaint: boolean; started_at: string; type: string; hk: { full_name: string } | null; ai_overall: string }[]>()

  useEffect(() => {
    supabase
      .from('rooms')
      .select('id, room_no, properties(name)')
      .then(({ data }) =>
        setRooms(((data as unknown as RoomOpt[]) ?? []).sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'tr') || a.room_no.localeCompare(b.room_no, 'tr', { numeric: true }))),
      )
  }, [])

  useEffect(() => {
    if (!room) return
    // O günkü ve öncesindeki son kayıt (spec 7)
    const sel = 'id, day, status, complaint, started_at, type, ai_overall, hk:profiles!cleanings_hk_id_fkey(full_name)'
    Promise.all([
      supabase.from('cleanings').select(sel).eq('room_id', room).eq('day', day).order('started_at', { ascending: false }),
      supabase.from('cleanings').select(sel).eq('room_id', room).lt('day', day).neq('status', 'cancelled').order('started_at', { ascending: false }).limit(1),
    ]).then(([a, b]) => setRows([...((a.data as never[]) ?? []), ...((b.data as never[]) ?? [])]))
  }, [room, day])

  return (
    <>
      <select value={room} onChange={(e) => setRoom(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3">
        <option value="">Oda seçin…</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.properties.name} · {r.room_no}
          </option>
        ))}
      </select>
      <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2" />
      <p className="text-xs text-slate-500">Kayda dokunun: tüm fotoğraflar, AI notları, kim temizledi, kim onayladı. Orada "Şikayet işaretle" denirse fotoğraflar silinmez.</p>
      {room && rows?.length === 0 && <p className="rounded-xl bg-white p-4 text-slate-600 shadow-sm">Bu odada o gün ve öncesinde kayıt yok.</p>}
      {rows?.map((c) => (
        <a key={c.id} href={`#/kayit/${c.id}`} className="block rounded-xl bg-white p-4 shadow-sm active:bg-slate-50">
          <div className="flex justify-between">
            <span className="font-semibold text-slate-800">
              {fmtDate(c.started_at)} {fmtTime(c.started_at)}
            </span>
            {c.complaint && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Şikayet</span>}
          </div>
          <p className="text-sm text-slate-600">
            {c.hk?.full_name} · {c.type === 'full' ? 'tam' : 'konaklama'} · {c.status === 'approved' ? 'onaylandı' : c.status === 'cancelled' ? 'iptal' : 'onay bekliyor'} · AI {c.ai_overall}
            {c.day !== day && ' · (önceki kayıt)'}
          </p>
        </a>
      ))}
    </>
  )
}

// ---------- Hasar ve kayıp eşya ----------
interface DRow {
  category: string
  status: string
  description: string
  created_at: string
  resolved_at: string | null
  resolve_note: string | null
  rooms: { room_no: string; properties: { name: string } }
  reporter: { full_name: string } | null
}
interface LRow {
  description: string
  status: string
  found_at: string
  stored_at: string | null
  returned_to: string | null
  closed_at: string | null
  rooms: { room_no: string; properties: { name: string } }
  finder: { full_name: string } | null
}

const D_STATUS: Record<string, string> = { open: 'Açık', in_progress: 'İşlemde', resolved: 'Giderildi' }
const L_STATUS: Record<string, string> = { stored: 'Saklanıyor', returned: 'Teslim edildi', disposed: 'İmha / bağış' }

function DamageReport() {
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(() => istanbulDay())
  const [d, setD] = useState<DRow[]>()
  const [l, setL] = useState<LRow[]>()

  useEffect(() => {
    const a = `${from}T00:00:00+03:00`
    const b = `${to}T23:59:59+03:00`
    supabase
      .from('damage_reports')
      .select('category, status, description, created_at, resolved_at, resolve_note, rooms(room_no, properties(name)), reporter:profiles!damage_reports_reported_by_fkey(full_name)')
      .gte('created_at', a)
      .lte('created_at', b)
      .order('created_at')
      .then(({ data }) => setD(data as unknown as DRow[]))
    supabase
      .from('lost_items')
      .select('description, status, found_at, stored_at, returned_to, closed_at, rooms(room_no, properties(name)), finder:profiles!lost_items_found_by_fkey(full_name)')
      .gte('found_at', a)
      .lte('found_at', b)
      .order('found_at')
      .then(({ data }) => setL(data as unknown as LRow[]))
  }, [from, to])

  const hours = (r: DRow) => (r.resolved_at ? (Date.parse(r.resolved_at) - Date.parse(r.created_at)) / 3600000 : null)
  const resolved = (d ?? []).filter((r) => r.resolved_at)
  const avgH = resolved.length ? Math.round(resolved.reduce((s, r) => s + hours(r)!, 0) / resolved.length) : null
  const group = (key: (r: DRow) => string) => {
    const m = new Map<string, [number, number]>()
    for (const r of d ?? []) {
      const k = key(r)
      const [o, t] = m.get(k) ?? [0, 0]
      m.set(k, [o + (r.status === 'resolved' ? 0 : 1), t + 1])
    }
    return [...m.entries()].sort((a, b) => b[1][1] - a[1][1])
  }

  async function excel() {
    await downloadXlsx(`Hasar_Esya_${from}_${to}.xlsx`, [
      {
        name: 'Hasar',
        header: ['Tarih', 'Otel', 'Oda', 'Kategori', 'Açıklama', 'Bildiren', 'Durum', 'Giderildi', 'Süre (saat)', 'Not'],
        rows: (d ?? []).map((r) => [
          `${fmtDate(r.created_at)} ${fmtTime(r.created_at)}`, r.rooms.properties.name, r.rooms.room_no, r.category, r.description, r.reporter?.full_name,
          D_STATUS[r.status], r.resolved_at ? `${fmtDate(r.resolved_at)} ${fmtTime(r.resolved_at)}` : null, hours(r) !== null ? Math.round(hours(r)!) : null, r.resolve_note,
        ]),
      },
      {
        name: 'Kayıp eşya',
        header: ['Bulunma', 'Otel', 'Oda', 'Açıklama', 'Bulan', 'Teslim yeri', 'Durum', 'Kime', 'Kapanış'],
        rows: (l ?? []).map((r) => [
          `${fmtDate(r.found_at)} ${fmtTime(r.found_at)}`, r.rooms.properties.name, r.rooms.room_no, r.description, r.finder?.full_name, r.stored_at,
          L_STATUS[r.status], r.returned_to, r.closed_at ? fmtDate(r.closed_at) : null,
        ]),
      },
    ])
  }

  return (
    <>
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {d && l && (
        <>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              {d.length} hasar · {l.length} eşya
            </span>
            <button onClick={excel} className="rounded-lg bg-white px-3 py-2 font-semibold text-brand shadow-sm">
              Excel'e indir
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              [String(d.filter((r) => r.status !== 'resolved').length), 'açık hasar'],
              [String(resolved.length), 'giderilen'],
              [avgH !== null ? `${avgH} sa` : '—', 'ort. giderilme'],
            ].map(([v, k]) => (
              <div key={k} className="rounded-xl bg-white p-2 shadow-sm">
                <div className="text-lg font-bold text-slate-800">{v}</div>
                <div className="text-xs text-slate-500">{k}</div>
              </div>
            ))}
          </div>
          {[
            ['Kategoriye göre', group((r) => r.category)],
            ['Otele göre', group((r) => r.rooms.properties.name)],
          ].map(([title, g]) => (
            <div key={title as string} className="rounded-xl bg-white p-4 shadow-sm">
              <p className="mb-1 text-sm font-semibold text-slate-700">{title as string}</p>
              {(g as [string, [number, number]][]).map(([k, [open, total]]) => (
                <div key={k} className="flex justify-between text-sm text-slate-600">
                  <span>{k}</span>
                  <span>
                    {total} <span className="text-xs text-slate-400">({open} açık)</span>
                  </span>
                </div>
              ))}
              {(g as unknown[]).length === 0 && <p className="text-sm text-slate-400">Kayıt yok</p>}
            </div>
          ))}
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <p className="mb-1 text-sm font-semibold text-slate-700">Kayıp eşya</p>
            {Object.entries(L_STATUS).map(([k, label]) => (
              <div key={k} className="flex justify-between text-sm text-slate-600">
                <span>{label}</span>
                <span>{l.filter((r) => r.status === k).length}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
