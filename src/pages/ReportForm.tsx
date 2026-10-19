import { useEffect, useMemo, useState } from 'react'
import { supabase, type Profile } from '../lib/supabase'
import { fmtDate, fmtTime } from '../lib/format'
import { enqueue } from '../lib/queue'
import type { Shot } from '../lib/camera'
import PhotoTaker from '../components/PhotoTaker'

// Hasar bildir / Eşya buldum (spec 5.5, 5.6). Kayıt ve fotoğraflar çevrimdışı kuyruğa girer.

export const DAMAGE_CATEGORIES = ['Mobilya', 'Elektrik', 'Tesisat', 'Boya/duvar', 'Cihaz', 'Tekstil', 'Diğer']
const STORE_PLACES = ['Resepsiyon', 'Emanet dolabı']

interface RoomOpt {
  id: string
  room_no: string
  properties: { name: string }
}

const ROOMS_CACHE = 'hk-rooms'

export default function ReportForm({ kind, roomId, me }: { kind: 'hasar' | 'esya'; roomId?: string; me: Profile }) {
  const damage = kind === 'hasar'
  const [rooms, setRooms] = useState<RoomOpt[]>(() => JSON.parse(localStorage.getItem(ROOMS_CACHE) || '[]'))
  const [room, setRoom] = useState(roomId ?? '')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [place, setPlace] = useState('Resepsiyon')
  const [otherPlace, setOtherPlace] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)

  // Odalar (çevrimdışı için son liste cihazda)
  useEffect(() => {
    supabase
      .from('rooms')
      .select('id, room_no, properties(name)')
      .eq('active', true)
      .then(({ data }) => {
        if (!data) return
        const list = (data as unknown as RoomOpt[]).sort(
          (a, b) => a.properties.name.localeCompare(b.properties.name, 'tr') || a.room_no.localeCompare(b.room_no, 'tr', { numeric: true }),
        )
        setRooms(list)
        localStorage.setItem(ROOMS_CACHE, JSON.stringify(list))
      })
  }, [])

  const selected = rooms.find((r) => r.id === room)
  const groups = useMemo(() => {
    const m = new Map<string, RoomOpt[]>()
    for (const r of rooms) m.set(r.properties.name, [...(m.get(r.properties.name) ?? []), r])
    return [...m.entries()]
  }, [rooms])

  const storedAt = place === 'Diğer' ? otherPlace.trim() : place
  const ready = room && description.trim().length >= 3 && shots.length > 0 && (damage ? category : storedAt)

  async function submit() {
    if (!ready) return
    setBusy(true)
    const id = crypto.randomUUID()
    const row = damage
      ? { id, room_id: room, reported_by: me.id, category, description: description.trim() }
      : { id, room_id: room, found_by: me.id, description: description.trim(), stored_at: storedAt }
    await enqueue({ kind: 'report', table: damage ? 'damage_reports' : 'lost_items', row })
    for (const [i, s] of shots.entries()) {
      await enqueue({ kind: 'report_photo', report: damage ? 'damage' : 'lost', id, n: i + 1, blob: s.blob })
    }
    window.location.hash = `#/kayitlar/${kind}`
  }

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-2 text-sm font-semibold ${on ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-700'}`

  return (
    <div className="space-y-4 px-4 pb-8 pt-4">
      <a href={roomId ? `#/oda/${roomId}` : '#/'} className="text-sm text-brand">
        ← Geri
      </a>
      <h1 className="text-xl font-bold text-slate-800">{damage ? 'Hasar bildir' : 'Eşya buldum'}</h1>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-slate-600">Oda</span>
        <select value={room} onChange={(e) => setRoom(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3">
          <option value="">Oda seçin…</option>
          {groups.map(([prop, list]) => (
            <optgroup key={prop} label={prop}>
              {list.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room_no}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {damage && (
        <div>
          <span className="mb-1 block text-sm font-semibold text-slate-600">Kategori</span>
          <div className="flex flex-wrap gap-2">
            {DAMAGE_CATEGORIES.map((c) => (
              <button key={c} onClick={() => setCategory(c)} className={chip(category === c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-slate-600">{damage ? 'Ne oldu?' : 'Ne bulundu?'}</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={damage ? 'Ör. Komodin çekmecesinin kulpu kırık' : 'Ör. Siyah şarj aleti, komodin üstünde'}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base"
        />
      </label>

      {!damage && (
        <div>
          <span className="mb-1 block text-sm font-semibold text-slate-600">Nereye teslim edildi?</span>
          <div className="flex flex-wrap gap-2">
            {[...STORE_PLACES, 'Diğer'].map((p) => (
              <button key={p} onClick={() => setPlace(p)} className={chip(place === p)}>
                {p}
              </button>
            ))}
          </div>
          {place === 'Diğer' && (
            <input
              value={otherPlace}
              onChange={(e) => setOtherPlace(e.target.value)}
              placeholder="Teslim yeri"
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3"
            />
          )}
        </div>
      )}

      <div>
        <span className="mb-1 block text-sm font-semibold text-slate-600">Fotoğraf (1–3)</span>
        <div className="flex gap-2">
          {shots.map((s, i) => (
            <img key={i} src={s.thumb} alt="" className="h-20 w-16 rounded-lg object-cover" />
          ))}
          <button
            onClick={() => setCamera(true)}
            disabled={!room}
            aria-label="Fotoğraf çek"
            className="flex h-20 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-2xl text-slate-400 disabled:opacity-40"
          >
            +
          </button>
        </div>
        {!room && <p className="mt-1 text-xs text-slate-500">Önce oda seçin (fotoğrafa oda yazılır).</p>}
      </div>

      <button
        onClick={submit}
        disabled={!ready || busy}
        className="w-full rounded-2xl bg-brand py-4 text-lg font-bold text-white shadow disabled:opacity-40"
      >
        Gönder
      </button>
      <p className="text-center text-xs text-slate-500">İnternet yoksa da gönderebilirsiniz; bağlantı gelince yüklenir.</p>

      {camera && (
        <PhotoTaker
          initial={shots}
          watermark={() => {
            const now = new Date()
            return [
              `${selected?.properties.name ?? ''} · Oda ${selected?.room_no ?? ''}`,
              `${me.full_name} · ${fmtDate(now)} ${fmtTime(now)}`,
              damage ? `Hasar: ${category || '—'}` : 'Kayıp eşya',
            ]
          }}
          onDone={(s) => {
            setShots(s)
            setCamera(false)
          }}
        />
      )}
    </div>
  )
}
