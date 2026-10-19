import { useCallback, useEffect, useState } from 'react'
import { callFunction } from '../lib/api'
import { errorText, supabase, type CleaningStatus, type DayStatus, type Profile } from '../lib/supabase'
import { dayStatusLabel, fmtDate, fmtTime, minutesSince } from '../lib/format'
import Sheet from '../components/Sheet'
import { openCleanings } from '../lib/active'
import PushBanner from '../components/PushBanner'

interface BoardRow {
  room_id: string
  property_id: string
  room_no: string
  room_type_code: string
  day_status: DayStatus | null
  day_status_source: string | null
  block_id: string | null
  block_reason: string | null
  block_until: string | null
  cleaning_id: string | null
  cleaning_status: CleaningStatus | null
  hk_name: string | null
  members: string[] | null
  started_at: string | null
  check_started_at: string | null
  cleaning_type: 'full' | 'stayover' | null
  hk_state: 'clean' | 'dirty' | 'unknown'
  hk_state_at: string | null
  occupied: boolean | null
  departing: boolean
  arriving: boolean
  cleaning_requested_at: string | null
  min_minutes: number | null
  max_minutes: number | null
}

interface Property {
  id: string
  name: string
}

interface SyncRun {
  started_at: string
  finished_at: string | null
  heartbeat_at: string | null
  ok: boolean | null
  summary: Record<string, unknown> | null
  progress: Record<string, { next_page: number; pages: number | null; done: boolean }> | null
}

// Bitmemiş çalışma 3 dk'dır ilerlemiyorsa ölmüş sayılır (sunucu da aynı kuralı uygular)
const isStale = (r: SyncRun) => !r.finished_at && Date.now() - Date.parse(r.heartbeat_at ?? r.started_at) > 3 * 60_000

interface Unmatched {
  hr_number: string
  pms_name: string
  room_no: string | null
  guest_name?: string | null
  room_type?: string | null
  checkin: string
  checkout: string
}

const istanbulToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())

// Son HotelRunner senkronu; admin "Şimdi senkronla" ile başlatır, sonucu ve sorunları görür
function SyncBar({ me, onSynced }: { me: Profile; onSynced: () => void }) {
  const [run, setRun] = useState<SyncRun | null>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)

  const loadRun = useCallback(async () => {
    const { data } = await supabase.from('pms_sync_runs').select('started_at, finished_at, heartbeat_at, ok, summary, progress')
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    setRun((data as SyncRun) ?? null)
    return data as SyncRun | null
  }, [])

  useEffect(() => {
    loadRun()
  }, [loadRun])

  // Çalışma sürüyorsa (başka cihazdan ya da cron'dan başlamış olabilir) ekran kendiliğinden güncellenir
  useEffect(() => {
    if (!run || run.finished_at || isStale(run) || busy) return
    const t = setTimeout(async () => {
      const last = await loadRun()
      if (last?.finished_at) onSynced()
    }, 10_000)
    return () => clearTimeout(t)
  }, [run, busy, loadRun, onSynced])

  async function syncNow() {
    setBusy(true)
    setError(undefined)
    try {
      const res = await callFunction<{ started: boolean; message?: string }>('pms-sync', {})
      if (!res.started && res.message) setError(res.message)
      // Arka planda parça parça çalışır; bitene kadar 5 sn'de bir bakılır (ilk senkron uzun sürebilir)
      const startedAt = Date.now()
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000))
        const last = await loadRun()
        if (!last || last.finished_at || isStale(last) || Date.now() - startedAt > 30 * 60_000) break
      }
      onSynced()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (run === undefined) return null
  const summary = run?.summary ?? {}
  const problems = Object.entries(summary).filter(
    ([k, v]) => k !== 'applied' && (k === 'error' || (v && typeof v === 'object' && 'error' in (v as object))),
  )
  const unmatched = ((summary.applied as { unmatched?: Unmatched[] } | undefined)?.unmatched ?? []) as Unmatched[]
  const pages = Object.values(run?.progress ?? {})
  const pageText = pages.some((p) => p.pages)
    ? ` · ${pages.reduce((n, p) => n + Math.min(p.next_page - 1, p.pages ?? 0), 0)}/${pages.reduce((n, p) => n + (p.pages ?? 0), 0)} sayfa`
    : ''
  const label = !run
    ? 'HotelRunner henüz senkronlanmadı'
    : isStale(run)
      ? 'HotelRunner senkronu yarıda kaldı; tekrar başlatın'
      : !run.finished_at
        ? `HotelRunner senkronu sürüyor${pageText}…`
        : `HotelRunner: ${fmtTime(run.finished_at)}${run.ok ? '' : ' · sorun var'}`

  return (
    <div className="mx-4 mb-2 rounded-xl bg-white px-4 py-3 text-sm shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className={`text-left ${run && run.finished_at && !run.ok ? 'text-red-700' : 'text-slate-600'}`}
        >
          {label}
          {me.role === 'admin' && (problems.length > 0 || unmatched.length > 0) && <span className="ml-1 underline">ayrıntı</span>}
        </button>
        {me.role === 'admin' && (
          <button onClick={syncNow} disabled={busy} className="shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? 'Senkronlanıyor…' : 'Şimdi senkronla'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-red-700">{error}</p>}
      {open && me.role === 'admin' && (
        <div className="mt-2 space-y-1 text-xs">
          {problems.map(([k, v]) => (
            <p key={k} className="text-red-700">
              {k === 'error' ? String(v) : `${k}: ${(v as { error: string }).error}`}
            </p>
          ))}
          {unmatched.length > 0 && (
            <>
              <p className="font-semibold text-amber-800">Odası eşleşmeyen rezervasyonlar (HotelRunner'da oda atayın):</p>
              {unmatched.map((u) => (
                <p key={u.hr_number + (u.room_no ?? '')} className="text-amber-800">
                  {u.guest_name ?? u.hr_number} · {u.room_type ?? 'oda tipi?'} · {u.pms_name} · {fmtDate(u.checkin)}–{fmtDate(u.checkout)}
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS_CHOICES: DayStatus[] = ['checkout', 'checkout_checkin', 'stayover', 'checkin', 'vacant']

// Kullanım dışı (tadilat, boya, arıza): sebep ve bitiş tarihi; kaldırılınca bugünden itibaren biter
function BlockEditor({ room, me, onSaved }: { room: BoardRow; me: Profile; onSaved: () => void }) {
  const today = istanbulToday()
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState(today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function run(fn: () => Promise<{ error: unknown }> | PromiseLike<{ error: unknown }>) {
    setBusy(true)
    setError(undefined)
    const { error } = await fn()
    setBusy(false)
    if (error) setError(errorText(error))
    else onSaved()
  }

  if (room.block_id) {
    return (
      <div className="space-y-2 rounded-xl bg-slate-800 p-4 text-white">
        <p className="text-sm">
          Kullanım dışı: <b>{room.block_reason}</b>
          {room.block_until && ` · ${fmtDate(room.block_until)} dahil`}
        </p>
        <button
          disabled={busy}
          onClick={() => {
            const id = room.block_id!
            const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10)
            // Bugün başladıysa silinir; önceden başladıysa dünle biter (geçmiş kayıt kalır)
            run(async () => {
              const del = await supabase.from('room_blocks').delete().eq('id', id).gte('start_date', today)
              if (del.error) return del
              return await supabase.from('room_blocks').update({ end_date: yesterday }).eq('id', id).lt('start_date', today)
            })
          }}
          className="w-full rounded-lg bg-white py-3 text-sm font-semibold text-slate-800 disabled:opacity-50"
        >
          Kullanıma aç
        </button>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>
    )
  }

  return (
    <details className="rounded-xl bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">Kullanım dışı yap (tadilat, arıza…)</summary>
      <div className="mt-3 space-y-2">
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Sebep (ör. Tadilat, Tavan boya)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <label className="flex items-center justify-between gap-2 text-sm text-slate-600">
          Bitiş (dahil)
          <input type="date" min={today} className="rounded-lg border border-slate-300 px-3 py-2" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <button
          disabled={busy || reason.trim().length < 2 || until < today}
          onClick={() =>
            run(() =>
              supabase.from('room_blocks').insert({
                room_id: room.room_id, start_date: today, end_date: until, reason: reason.trim(), created_by: me.id,
              }),
            )
          }
          className="w-full rounded-lg bg-slate-800 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          Kaydet
        </button>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </details>
  )
}

// Süpervizör/admin günlük durumu elle değiştirir; o gün senkron ezmez (karar 5)
function StatusSheet({ room, me, onClose, onSaved }: { room: BoardRow; me: Profile; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function save(status: DayStatus | null) {
    setBusy(true)
    setError(undefined)
    const day = istanbulToday()
    const { error } =
      status === null
        ? await supabase.from('room_day_status').delete().eq('room_id', room.room_id).eq('day', day).eq('source', 'manual')
        : await supabase.from('room_day_status').upsert({
            room_id: room.room_id, day, status, source: 'manual', updated_by: me.id, updated_at: new Date().toISOString(),
          })
    setBusy(false)
    if (error) setError(errorText(error))
    else {
      onSaved()
      onClose()
    }
  }

  // Temizlik talebi (konaklayan odada müşteri isterse): gir / kaldır
  async function request(on: boolean) {
    setBusy(true)
    setError(undefined)
    const day = istanbulToday()
    const { error } = on
      ? await supabase.from('cleaning_requests').insert({ room_id: room.room_id })
      : await supabase.from('cleaning_requests').delete().eq('room_id', room.room_id).gte('requested_at', `${day}T00:00:00+03:00`)
    setBusy(false)
    if (error) setError(errorText(error))
    else {
      onSaved()
      onClose()
    }
  }

  async function mark(clean: boolean) {
    setBusy(true)
    setError(undefined)
    const { error } = await supabase.from('room_hk_marks').insert({ room_id: room.room_id, clean })
    setBusy(false)
    if (error) setError(errorText(error))
    else {
      onSaved()
      onClose()
    }
  }

  return (
    <Sheet title={`Oda ${room.room_no} · bugünkü durum`} onClose={onClose}>
      <div className="space-y-3">
        {room.cleaning_status && (
          <p className="rounded-lg bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            Temizlik: <b>{[room.hk_name, ...(room.members ?? [])].filter(Boolean).join(', ')}</b>
            {room.started_at && ` · ${fmtTime(room.started_at)}'da başladı`}
          </p>
        )}
        <div className="rounded-lg bg-white px-4 py-3 shadow-sm">
          <p className="text-sm text-slate-700">
            Oda: <b>{hkStateLabel[room.hk_state]}</b>
            {room.hk_state_at && ` · ${fmtDate(room.hk_state_at)} ${fmtTime(room.hk_state_at)}'dan beri`}
          </p>
          <div className="mt-2 flex gap-2">
            {(['clean', 'dirty'] as const).map((k) => (
              <button
                key={k}
                disabled={busy || room.hk_state === k}
                onClick={() => mark(k === 'clean')}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
              >
                {k === 'clean' ? 'Temiz işaretle' : 'Kirli işaretle'}
              </button>
            ))}
          </div>
        </div>
        <button
          disabled={busy}
          onClick={() => request(!room.cleaning_requested_at)}
          className={`w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50 ${
            room.cleaning_requested_at ? 'border border-orange-300 bg-orange-50 text-orange-800' : 'bg-orange-500 text-white'
          }`}
        >
          {room.cleaning_requested_at
            ? `Temizlik talebi var (${fmtTime(room.cleaning_requested_at)}) · kaldır`
            : 'Temizlik talebi gir'}
        </button>
        <p className="text-sm text-slate-600">
          Bugün: <b>{room.day_status ? dayStatusLabel[room.day_status] : 'bilinmiyor'}</b>
          {room.day_status_source === 'manual' ? ' (elle girildi)' : room.day_status ? ' (HotelRunner)' : ''}. Elle seçilen durum
          bugün HotelRunner senkronuyla değişmez.
        </p>
        {STATUS_CHOICES.map((s) => (
          <button
            key={s}
            disabled={busy}
            onClick={() => save(s)}
            className={`w-full rounded-xl border py-4 text-base font-semibold disabled:opacity-50 ${
              room.day_status === s ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {dayStatusLabel[s]}
          </button>
        ))}
        <div className="flex gap-2">
          {room.cleaning_id && (
            <a href={`#/kayit/${room.cleaning_id}`} className="flex-1 rounded-xl bg-white py-3 text-center text-sm font-semibold text-brand shadow-sm">
              Kontrol kaydı
            </a>
          )}
          <a href={`#/oda/${room.room_id}`} className="flex-1 rounded-xl bg-white py-3 text-center text-sm font-semibold text-brand shadow-sm">
            Oda sayfası
          </a>
        </div>
        <BlockEditor room={room} me={me} onSaved={() => { onSaved(); onClose() }} />
        {room.day_status_source === 'manual' && (
          <button disabled={busy} onClick={() => save(null)} className="w-full py-3 text-sm text-slate-500">
            Elle girileni kaldır (sonraki senkronda HotelRunner'dan gelir)
          </button>
        )}
        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </div>
    </Sheet>
  )
}

// Oda kutusunun rengi (karar 17, 19): her durum ayrı renk. Çıkış saati (12:00) gelince çıkış odası boşalır ve
// kirli olur, giriş saati (14:00) gelince giriş odası dolu sayılır (sunucu hesaplar).
type Tile = 'urgent' | 'todo' | 'requested' | 'cleaning' | 'clean' | 'departing' | 'stay' | 'blocked' | 'unknown'
const TILES: { key: Tile; label: string; cls: string; dot: string }[] = [
  { key: 'urgent', label: 'Giriş var, kirli', cls: 'bg-rose-900 text-white', dot: 'bg-rose-900' },
  { key: 'todo', label: 'Temizlenecek', cls: 'bg-red-500 text-white', dot: 'bg-red-500' },
  { key: 'requested', label: 'Temizlik talebi', cls: 'bg-orange-500 text-white', dot: 'bg-orange-500' },
  { key: 'cleaning', label: 'Temizleniyor', cls: 'bg-sky-500 text-white', dot: 'bg-sky-500' },
  { key: 'clean', label: 'Boş · temiz', cls: 'bg-emerald-500 text-white', dot: 'bg-emerald-500' },
  { key: 'departing', label: 'Çıkış', cls: 'bg-violet-500 text-white', dot: 'bg-violet-500' },
  { key: 'stay', label: 'Konaklama', cls: 'bg-yellow-300 text-yellow-950', dot: 'bg-yellow-300' },
  { key: 'blocked', label: 'Kullanım dışı', cls: 'bg-slate-800 text-white', dot: 'bg-slate-800' },
  { key: 'unknown', label: 'Bilinmiyor', cls: 'bg-slate-200 text-slate-500', dot: 'bg-slate-300' },
]

const inProgress = (r: BoardRow) => r.cleaning_status === 'in_progress' || r.cleaning_status === 'fixing'
// Giriş saati geçmiş (yeni misafir girmiş) ama oda temizlenmemiş: acil. Çık+gir odasında 12:00 öncesi
// içerideki eski misafirdir (departing), sayılmaz.
const dirtyArrival = (r: BoardRow) =>
  r.occupied === true &&
  !r.departing &&
  r.hk_state === 'dirty' &&
  (r.day_status === 'checkin' || r.day_status === 'checkout_checkin')
const cleanedToday = (r: BoardRow) => r.cleaning_status === 'submitted' || r.cleaning_status === 'analyzing' || r.cleaning_status === 'approved'

// Oda tipinin en uzun süresi (Excel: Max. Süre) aşıldı mı (karar 21)
const overTime = (r: BoardRow) => inProgress(r) && !!r.max_minutes && minutesSince(r.started_at!) > r.max_minutes

function tileOf(r: BoardRow): Tile {
  if (inProgress(r)) return 'cleaning'
  if (r.block_id) return 'blocked'
  if (dirtyArrival(r)) return 'urgent'
  if (r.cleaning_requested_at) return 'requested'
  if (r.occupied) return r.departing ? 'departing' : 'stay'
  if (r.hk_state === 'dirty') return 'todo'
  if (r.hk_state === 'clean') return 'clean'
  return 'unknown'
}

// Kutunun alt satırı
function tileNote(r: BoardRow): string {
  const who = r.hk_name?.split(' ')[0] ?? ''
  switch (tileOf(r)) {
    case 'cleaning': {
      const m = minutesSince(r.started_at!)
      if (overTime(r)) return `${who} ⚠ ${m}/${r.max_minutes}dk`
      return `${who} ${r.check_started_at ? 'kontrol' : m + 'dk'}`
    }
    case 'blocked':
      return r.block_reason ?? 'Kullanım dışı'
    case 'urgent':
      return 'Giriş var!'
    case 'requested':
      return `Talep ${fmtTime(r.cleaning_requested_at!)}`
    case 'departing':
      return r.arriving ? 'Çıkış + giriş' : 'Çıkış'
    case 'stay':
      if (r.day_status !== 'stayover') return 'Giriş yaptı'
      return cleanedToday(r) ? `✓ ${who}` : 'Konaklama'
    case 'todo':
      return r.arriving ? 'Giriş var' : r.day_status === 'checkout' || r.day_status === 'checkout_checkin' ? 'Çıkış yaptı' : 'Kirli'
    case 'clean':
      if (cleanedToday(r)) return `${who}${r.cleaning_status === 'approved' ? ' ✓' : ' · onay'}${r.arriving ? ' · giriş' : ''}`
      return r.arriving ? 'Giriş hazır' : 'Boş'
    default:
      return r.arriving ? 'Giriş · ?' : r.day_status ? SHORT[r.day_status] : 'Bilinmiyor'
  }
}

const SHORT: Record<DayStatus, string> = {
  checkout: 'Çıkış',
  checkout_checkin: 'Çık+Gir',
  stayover: 'Konak.',
  checkin: 'Giriş',
  vacant: 'Boş',
}

// Otel başlığındaki sayılar: temizlenecek (acil, kirli, müşteri istedi) ve bugün temizlenen
function summary(rows: BoardRow[]): [string, number, string][] {
  const items: [string, number, string][] = [
    ['temizlenecek', rows.filter((r) => ['urgent', 'todo', 'requested'].includes(tileOf(r))).length, 'bg-red-500'],
    ['temizlenen', rows.filter(cleanedToday).length, 'bg-emerald-500'],
  ]
  return items.filter(([, n]) => n > 0)
}

const hkStateLabel = { clean: 'Temiz', dirty: 'Kirli (temizlenecek)', unknown: 'Bilinmiyor' }

export default function Today({ me }: { me: Profile }) {
  const canEdit = me.role === 'supervisor' || me.role === 'admin'
  const [editing, setEditing] = useState<BoardRow>()
  const [rows, setRows] = useState<BoardRow[]>()
  const [properties, setProperties] = useState<Property[]>([])
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setError(undefined)
    const [board, props] = await Promise.all([
      supabase.rpc('today_board'),
      supabase.from('properties').select('id, name').order('name'),
    ])
    if (board.error || props.error) {
      setError(errorText(board.error ?? props.error))
      return
    }
    setRows(board.data as BoardRow[])
    setProperties(props.data as Property[])
  }, [])

  // Saat 12:00 / 14:00 geçişleri ve diğer HK'ların temizlikleri için dakikada bir ve ekrana dönünce yenilenir
  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  return (
    <div>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="text-lg font-bold text-slate-800">Bugün · {fmtDate(new Date())}</h1>
        <button onClick={load} className="rounded-lg px-3 py-2 text-sm text-brand active:bg-slate-200">
          Yenile
        </button>
      </div>

      <PushBanner me={me} />
      {canEdit && <SyncBar me={me} onSynced={load} />}
      {me.role === 'hk' &&
        openCleanings().map((c) => (
          <a
            key={c.id}
            href={c.check_started_at ? `#/cek/${c.id}` : `#/oda/${c.room_id}`}
            className="mx-4 mb-2 block rounded-xl bg-amber-400 px-4 py-3 font-semibold text-amber-950 shadow-sm active:scale-[0.99]"
          >
            Oda {c.room_no}: {c.check_started_at ? 'kontrol çekimine devam et' : `temizlik sürüyor · ${minutesSince(c.started_at)} dk`} →
          </a>
        ))}
      {error && <p className="mx-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <p className="px-4 text-slate-500">Yükleniyor…</p>}
      {rows && rows.length === 0 && (
        <p className="mx-4 rounded-xl bg-white p-4 text-slate-600 shadow-sm">
          Henüz oda tanımlı değil. Oteller ve odalar admin panelinden Excel ile içe aktarılacak.
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="mx-4 mb-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
          {TILES.map((t) => {
            const n = rows.filter((r) => tileOf(r) === t.key).length
            if (n === 0) return null
            return (
              <span key={t.key} className="flex items-center gap-1">
                <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />
                {t.label} {n}
              </span>
            )
          })}
        </div>
      )}

      {rows &&
        properties.map((p) => {
          const own = rows
            .filter((r) => r.property_id === p.id)
            .sort((a, b) => a.room_no.localeCompare(b.room_no, 'tr', { numeric: true }))
          if (own.length === 0) return null
          return (
            <section key={p.id} className="mt-3 px-4">
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 className="text-sm font-semibold text-brand">{p.name}</h2>
                {summary(own).map(([label, n, dot]) => (
                  <span key={label} className="flex items-center gap-1 text-[11px] text-slate-600">
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    {n} {label}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {own.map((r) => {
                  const t = TILES.find((x) => x.key === tileOf(r))!
                  return (
                    <button
                      key={r.room_id}
                      onClick={() => (canEdit ? setEditing(r) : (window.location.hash = `#/oda/${r.room_id}`))}
                      className={`relative flex h-[60px] flex-col justify-between rounded-xl px-2 py-1.5 text-left shadow-sm ${t.cls} ${
                        overTime(r) ? 'ring-4 ring-red-500' : ''
                      } enabled:active:scale-95`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-lg font-extrabold leading-none tracking-tight">{r.room_no}</span>
                        <span className="text-[9px] font-semibold uppercase leading-none opacity-70">{r.room_type_code}</span>
                      </div>
                      <div className="truncate text-[11px] font-medium leading-tight opacity-90">{tileNote(r)}</div>
                      {r.day_status_source === 'manual' && (
                        <span className="absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full bg-orange-400 ring-2 ring-white" title="elle" />
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}

      {editing && <StatusSheet room={editing} me={me} onClose={() => setEditing(undefined)} onSaved={load} />}
    </div>
  )
}
