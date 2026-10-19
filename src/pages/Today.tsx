import { useCallback, useEffect, useState } from 'react'
import { errorText, supabase, type CleaningStatus, type DayStatus } from '../lib/supabase'
import { dayGroups, fmtDate, minutesSince } from '../lib/format'

interface BoardRow {
  room_id: string
  property_id: string
  room_no: string
  room_type_code: string
  day_status: DayStatus | null
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

export default function Today() {
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
                          <li key={r.room_id} className="flex items-center justify-between gap-3 px-4 py-3">
                            <div>
                              <span className="text-lg font-semibold text-slate-800">{r.room_no}</span>
                              <span className="ml-2 text-xs text-slate-400">{r.room_type_code}</span>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-right text-xs font-medium ${b.cls}`}>
                              {b.text}
                            </span>
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
    </div>
  )
}
