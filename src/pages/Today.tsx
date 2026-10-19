import { useCallback, useEffect, useState } from 'react'
import { callFunction } from '../lib/api'
import { errorText, supabase, type CleaningStatus, type DayStatus, type Profile } from '../lib/supabase'
import { dayGroups, dayStatusLabel, fmtDate, fmtTime, minutesSince } from '../lib/format'
import Sheet from '../components/Sheet'

interface BoardRow {
  room_id: string
  property_id: string
  room_no: string
  room_type_code: string
  day_status: DayStatus | null
  day_status_source: string | null
  cleaning_id: string | null
  cleaning_status: CleaningStatus | null
  hk_name: string | null
  members: string[] | null
  started_at: string | null
  check_started_at: string | null
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
                  {u.pms_name} · {u.room_no ?? 'oda yok'} · {fmtDate(u.checkin)}–{fmtDate(u.checkout)} · {u.hr_number}
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

  return (
    <Sheet title={`Oda ${room.room_no} · bugünkü durum`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Şu an: <b>{room.day_status ? dayStatusLabel[room.day_status] : 'bilinmiyor'}</b>
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

// Odanın temizlik durumu: bekliyor / temizleniyor – kim / tamamlandı / sorunlu (spec 5.1)
function cleaningBadge(r: BoardRow): { text: string; cls: string } {
  const who = [r.hk_name, ...(r.members ?? [])].filter(Boolean).join(', ')
  switch (r.cleaning_status) {
    case null:
      return { text: 'Bekliyor', cls: 'bg-slate-100 text-slate-600' }
    case 'in_progress':
      return r.check_started_at
        ? { text: `Kontrol – ${who}`, cls: 'bg-blue-100 text-blue-800' }
        : { text: `Temizleniyor – ${who} · ${minutesSince(r.started_at!)} dk`, cls: 'bg-amber-100 text-amber-800' }
    case 'submitted':
    case 'analyzing':
      return { text: `Onay bekliyor – ${who}`, cls: 'bg-indigo-100 text-indigo-800' }
    case 'fixing':
      return { text: `Düzeltiliyor – ${who}`, cls: 'bg-orange-100 text-orange-800' }
    case 'escalated':
      return { text: `Sorunlu – ${who}`, cls: 'bg-red-100 text-red-800' }
    case 'approved':
      return { text: `Tamamlandı – ${who}`, cls: 'bg-green-100 text-green-800' }
    case 'cancelled':
      return { text: 'İptal', cls: 'bg-slate-100 text-slate-500' }
  }
}

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

  useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="text-lg font-bold text-slate-800">Bugün · {fmtDate(new Date())}</h1>
        <button onClick={load} className="rounded-lg px-3 py-2 text-sm text-brand active:bg-slate-200">
          Yenile
        </button>
      </div>

      {canEdit && <SyncBar me={me} onSynced={load} />}
      {error && <p className="mx-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <p className="px-4 text-slate-500">Yükleniyor…</p>}
      {rows && rows.length === 0 && (
        <p className="mx-4 rounded-xl bg-white p-4 text-slate-600 shadow-sm">
          Henüz oda tanımlı değil. Oteller ve odalar admin panelinden Excel ile içe aktarılacak.
        </p>
      )}

      {rows &&
        properties.map((p) => {
          const own = rows.filter((r) => r.property_id === p.id)
          if (own.length === 0) return null
          return (
            <section key={p.id} className="mt-3 px-4">
              <h2 className="mb-2 text-base font-semibold text-brand">{p.name}</h2>
              {dayGroups.map((g) => {
                const list = own.filter((r) => g.statuses.includes(r.day_status))
                if (list.length === 0) return null
                return (
                  <div key={g.key} className="mb-3">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {g.label} ({list.length})
                    </div>
                    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm">
                      {list.map((r) => {
                        const b = cleaningBadge(r)
                        return (
                          <li key={r.room_id}>
                            <button
                              disabled={!canEdit}
                              onClick={() => setEditing(r)}
                              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left enabled:active:bg-slate-50"
                            >
                              <div>
                                <span className="text-lg font-semibold text-slate-800">{r.room_no}</span>
                                <span className="ml-2 text-xs text-slate-400">{r.room_type_code}</span>
                                {r.day_status_source === 'manual' && <span className="ml-2 text-xs text-amber-700">elle</span>}
                              </div>
                              <span className={`rounded-full px-3 py-1 text-right text-xs font-medium ${b.cls}`}>{b.text}</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </section>
          )
        })}

      {editing && <StatusSheet room={editing} me={me} onClose={() => setEditing(undefined)} onSaved={load} />}
    </div>
  )
}
