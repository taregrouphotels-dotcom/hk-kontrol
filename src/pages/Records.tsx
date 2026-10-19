import { useCallback, useEffect, useState } from 'react'
import { errorText, supabase, type Profile } from '../lib/supabase'
import { fmtDate, fmtTime } from '../lib/format'
import { callFunction } from '../lib/api'
import Sheet from '../components/Sheet'

// Hasar ve kayıp eşya listeleri (spec 5.5, 5.6). Herkes bölgesindekini görür (RLS);
// süpervizör/admin durumu değiştirir. Adres: #/kayitlar/hasar[/<id>] , #/kayitlar/esya[/<id>]

interface Base {
  id: string
  room_id: string
  description: string
  rooms: { room_no: string; properties: { name: string } }
  report_media: { media_key: string; media_deleted_at: string | null }[]
}
interface Damage extends Base {
  category: string
  status: 'open' | 'in_progress' | 'resolved'
  created_at: string
  resolved_at: string | null
  resolve_note: string | null
  reporter: { full_name: string } | null
  resolver: { full_name: string } | null
}
interface Lost extends Base {
  found_at: string
  stored_at: string | null
  status: 'stored' | 'returned' | 'disposed'
  closed_at: string | null
  returned_to: string | null
  close_note: string | null
  finder: { full_name: string } | null
  closer: { full_name: string } | null
}

const DAMAGE_STATUS = { open: ['Açık', 'bg-red-100 text-red-800'], in_progress: ['İşlemde', 'bg-amber-100 text-amber-800'], resolved: ['Giderildi', 'bg-emerald-100 text-emerald-800'] } as const
const LOST_STATUS = { stored: ['Saklanıyor', 'bg-sky-100 text-sky-800'], returned: ['Sahibine teslim', 'bg-emerald-100 text-emerald-800'], disposed: ['İmha / bağış', 'bg-slate-200 text-slate-700'] } as const

const ROOM = 'rooms(room_no, properties(name)), report_media(media_key, media_deleted_at)'
const DAMAGE_SELECT = `id, room_id, category, description, status, created_at, resolved_at, resolve_note, ${ROOM}, reporter:profiles!damage_reports_reported_by_fkey(full_name), resolver:profiles!damage_reports_resolved_by_fkey(full_name)`
const LOST_SELECT = `id, room_id, description, found_at, stored_at, status, closed_at, returned_to, close_note, ${ROOM}, finder:profiles!lost_items_found_by_fkey(full_name), closer:profiles!lost_items_closed_by_fkey(full_name)`

export default function Records({ me, kind, openId }: { me: Profile; kind: 'hasar' | 'esya'; openId?: string }) {
  const damage = kind === 'hasar'
  const canManage = me.role !== 'hk'
  const [filter, setFilter] = useState<string>(damage ? 'active' : 'stored')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<(Damage | Lost)[]>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setError(undefined)
    let query
    if (damage) {
      query = supabase.from('damage_reports').select(DAMAGE_SELECT).order('created_at', { ascending: false }).limit(200)
      if (filter === 'active') query = query.in('status', ['open', 'in_progress'])
      else if (filter !== 'all') query = query.eq('status', filter)
    } else {
      query = supabase.from('lost_items').select(LOST_SELECT).order('found_at', { ascending: false }).limit(200)
      if (filter !== 'all') query = query.eq('status', filter)
      if (from) query = query.gte('found_at', `${from}T00:00:00+03:00`)
      if (to) query = query.lte('found_at', `${to}T23:59:59+03:00`)
    }
    const { data, error } = await query
    if (error) return setError(errorText(error))
    setRows(data as unknown as (Damage | Lost)[])
  }, [damage, filter, from, to])

  useEffect(() => {
    load()
  }, [load])

  // Arama: açıklama ya da oda numarası (spec 5.6)
  const needle = q.trim().toLocaleLowerCase('tr')
  const shown = (rows ?? []).filter(
    (r) => !needle || r.description.toLocaleLowerCase('tr').includes(needle) || r.rooms.room_no.toLocaleLowerCase('tr') === needle,
  )
  const open = shown.find((r) => r.id === openId)

  const tab = (k: 'hasar' | 'esya', label: string) => (
    <a href={`#/kayitlar/${k}`} className={`flex-1 rounded-lg py-2 text-center text-sm font-semibold ${kind === k ? 'bg-white text-brand shadow-sm' : 'text-slate-500'}`}>
      {label}
    </a>
  )
  const filters: [string, string][] = damage
    ? [['active', 'Açık + işlemde'], ['resolved', 'Giderildi'], ['all', 'Hepsi']]
    : [['stored', 'Saklanıyor'], ['returned', 'Teslim edildi'], ['disposed', 'İmha / bağış'], ['all', 'Hepsi']]

  return (
    <div className="space-y-3 px-4 pt-4">
      <div className="flex gap-1 rounded-xl bg-slate-200 p-1">
        {tab('hasar', 'Hasar')}
        {tab('esya', 'Kayıp eşya')}
      </div>
      <a
        href={`#/bildir/${kind}`}
        className="block w-full rounded-xl bg-brand py-3 text-center text-sm font-semibold text-white shadow-sm"
      >
        {damage ? '+ Hasar bildir' : '+ Eşya buldum'}
      </a>
      <div className="flex flex-wrap gap-1.5">
        {filters.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {!damage && (
        <div className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ara: oda no ya da açıklama (ör. 203, şarj)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2 text-xs text-slate-500">
            <label className="flex-1">
              Başlangıç
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </label>
            <label className="flex-1">
              Bitiş
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </label>
          </div>
        </div>
      )}
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <p className="text-slate-500">Yükleniyor…</p>}
      {rows?.length === 0 && <p className="rounded-xl bg-white p-4 text-slate-600 shadow-sm">Kayıt yok.</p>}
      {shown.map((r) => {
        const [label, cls] = damage ? DAMAGE_STATUS[(r as Damage).status] : LOST_STATUS[(r as Lost).status]
        const at = damage ? (r as Damage).created_at : (r as Lost).found_at
        return (
          <a key={r.id} href={`#/kayitlar/${kind}/${r.id}`} className="block rounded-xl bg-white p-4 shadow-sm active:bg-slate-50">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-lg font-bold text-slate-800">
                {r.rooms.room_no} <span className="text-xs font-normal text-slate-500">{r.rooms.properties.name}</span>
              </span>
              <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
            </div>
            <p className="text-sm text-slate-700">
              {damage && <b>{(r as Damage).category}: </b>}
              {r.description}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {fmtDate(at)} {fmtTime(at)} · {damage ? (r as Damage).reporter?.full_name : (r as Lost).finder?.full_name}
              {!damage && (r as Lost).stored_at && ` · ${(r as Lost).stored_at}`} · {r.report_media.length} foto
            </p>
          </a>
        )
      })}
      {open && (
        <Detail
          row={open}
          damage={damage}
          canManage={canManage}
          onClose={() => (window.location.hash = `#/kayitlar/${kind}`)}
          onSaved={load}
        />
      )}
    </div>
  )
}

function Detail({
  row,
  damage,
  canManage,
  onClose,
  onSaved,
}: {
  row: Damage | Lost
  damage: boolean
  canManage: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [urls, setUrls] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [returnedTo, setReturnedTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [big, setBig] = useState<string>()

  useEffect(() => {
    Promise.all(
      row.report_media
        .filter((m) => !m.media_deleted_at)
        .map((m) => callFunction<{ url: string }>('media-sign', { action: 'view', key: m.media_key }).then((r) => r.url).catch(() => '')),
    ).then((u) => setUrls(u.filter(Boolean)))
  }, [row])

  async function update(patch: Record<string, unknown>) {
    setBusy(true)
    setError(undefined)
    const { error } = await supabase.from(damage ? 'damage_reports' : 'lost_items').update(patch).eq('id', row.id)
    setBusy(false)
    if (error) return setError(errorText(error))
    onSaved()
    onClose()
  }

  const d = row as Damage
  const l = row as Lost
  const btn = 'w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50'

  return (
    <Sheet title={`Oda ${row.rooms.room_no} · ${damage ? 'hasar' : 'kayıp eşya'}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">{row.rooms.properties.name}</p>
        <p className="text-base text-slate-800">
          {damage && <b>{d.category}: </b>}
          {row.description}
        </p>
        <div className="flex gap-2 overflow-x-auto">
          {urls.map((u) => (
            <img key={u} src={u} alt="" onClick={() => setBig(u)} className="h-28 w-20 shrink-0 rounded-lg object-cover" />
          ))}
          {row.report_media.length > urls.length && <p className="text-xs text-slate-500">Fotoğraflar yükleniyor…</p>}
        </div>
        <p className="text-xs text-slate-500">
          {damage
            ? `${fmtDate(d.created_at)} ${fmtTime(d.created_at)} · bildiren: ${d.reporter?.full_name ?? ''}`
            : `${fmtDate(l.found_at)} ${fmtTime(l.found_at)} · bulan: ${l.finder?.full_name ?? ''} · teslim yeri: ${l.stored_at ?? '—'}`}
        </p>
        {damage && d.status === 'resolved' && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Giderildi: {d.resolver?.full_name} · {d.resolved_at && `${fmtDate(d.resolved_at)} ${fmtTime(d.resolved_at)}`}
            {d.resolve_note && ` · ${d.resolve_note}`}
          </p>
        )}
        {!damage && l.status !== 'stored' && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {l.status === 'returned' ? `Teslim edildi: ${l.returned_to ?? ''}` : 'İmha / bağış'} · {l.closer?.full_name}
            {l.closed_at && ` · ${fmtDate(l.closed_at)} ${fmtTime(l.closed_at)}`}
            {l.close_note && ` · ${l.close_note}`}
          </p>
        )}

        {canManage && (
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Not"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base"
            />
            {damage && d.status === 'open' && (
              <button disabled={busy} onClick={() => update({ status: 'in_progress' })} className={`${btn} bg-amber-500 text-white`}>
                İşleme al
              </button>
            )}
            {damage && d.status !== 'resolved' && (
              <button disabled={busy} onClick={() => update({ status: 'resolved', resolve_note: note.trim() || null })} className={`${btn} bg-emerald-600 text-white`}>
                Giderildi
              </button>
            )}
            {damage && d.status === 'resolved' && (
              <button disabled={busy} onClick={() => update({ status: 'open' })} className={`${btn} border border-slate-300 text-slate-700`}>
                Tekrar aç
              </button>
            )}
            {!damage && l.status === 'stored' && (
              <>
                <input
                  value={returnedTo}
                  onChange={(e) => setReturnedTo(e.target.value)}
                  placeholder="Kime teslim edildi (ad soyad)"
                  className="w-full rounded-xl border border-slate-300 px-3 py-3"
                />
                <button
                  disabled={busy || returnedTo.trim().length < 3}
                  onClick={() => update({ status: 'returned', returned_to: returnedTo.trim(), close_note: note.trim() || null })}
                  className={`${btn} bg-emerald-600 text-white`}
                >
                  Sahibine teslim edildi
                </button>
                <button
                  disabled={busy}
                  onClick={() => window.confirm('İmha / bağış olarak kapatılsın mı?') && update({ status: 'disposed', close_note: note.trim() || null })}
                  className={`${btn} border border-slate-300 text-slate-700`}
                >
                  İmha / bağış
                </button>
              </>
            )}
            {!damage && l.status !== 'stored' && (
              <button disabled={busy} onClick={() => update({ status: 'stored' })} className={`${btn} border border-slate-300 text-slate-700`}>
                Tekrar saklanıyor yap
              </button>
            )}
          </div>
        )}
        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </div>
      {big && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black" onClick={() => setBig(undefined)}>
          <img src={big} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </Sheet>
  )
}
