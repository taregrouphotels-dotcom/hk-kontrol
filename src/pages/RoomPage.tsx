import { useCallback, useEffect, useState } from 'react'
import { errorText, supabase, type CleaningStatus, type DayStatus, type Profile } from '../lib/supabase'
import { dayStatusLabel, fmtTime, minutesSince } from '../lib/format'
import { activeForRoom, cleaningTypeFor, saveActive, updateActive, type ActiveCleaning } from '../lib/active'
import { enqueue } from '../lib/queue'

// Oda ekranı (spec 5.1): HK odayı seçer → "Temizliğe başla" → (birlikte temizleyen) → "Kontrole başla".
// Kapı uygulamadan açılmaz; QR şimdilik kullanılmıyor (karar 16). #/qr/<token> bağlantısı çalışmaya devam eder.
// Çevrimdışı da çalışır: işlemler kuyruğa girer, ekran cihazdaki kayıttan (active.ts) beslenir.

interface Room {
  id: string
  room_no: string
  qr_token: string
  room_type_id: string
  properties: { name: string }
  room_types: { code: string; name: string }
}

interface Board {
  day_status: DayStatus | null
  block_reason: string | null
  cleaning_id: string | null
  cleaning_status: CleaningStatus | null
  hk_id: string | null
  hk_name: string | null
  started_at: string | null
  cleaning_requested_at: string | null
}

interface Member {
  id: string
  full_name: string
}

const CACHE = (id: string) => `hk-room-${id}`

export default function RoomPage({ roomId, me, viaQr }: { roomId: string; me: Profile; viaQr?: string }) {
  const [room, setRoom] = useState<Room | null>()
  const [board, setBoard] = useState<Board | null>(null)
  const [active, setActive] = useState<ActiveCleaning | undefined>(() => activeForRoom(roomId))
  const [team, setTeam] = useState<Member[]>([])
  const [members, setMembers] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    const [r, b] = await Promise.all([
      supabase
        .from('rooms')
        .select('id, room_no, qr_token, room_type_id, properties(name), room_types(code, name)')
        .eq('id', roomId)
        .maybeSingle(),
      supabase.rpc('today_board'),
    ])
    if (r.data) {
      setRoom(r.data as unknown as Room)
      localStorage.setItem(CACHE(roomId), JSON.stringify({ room: r.data }))
    } else if (r.error) {
      // Çevrimdışı: son görülen oda bilgisi
      const cached = localStorage.getItem(CACHE(roomId))
      setRoom(cached ? JSON.parse(cached).room : null)
    } else setRoom(null)
    if (b.data) setBoard((b.data as (Board & { room_id: string })[]).find((x) => x.room_id === roomId) ?? null)
  }, [roomId])

  useEffect(() => {
    load()
    if (me.role === 'hk') {
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'hk')
        .eq('active', true)
        .neq('id', me.id)
        .order('full_name')
        .then(({ data }) => setTeam((data as Member[]) ?? []))
    }
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [load, me])

  // Kapıdaki QR telefonun kendi kamerasıyla okutulduysa (#/qr/<token>) tekrar okutmaya gerek yok
  const qrMatched = !!viaQr && room?.qr_token === viaQr

  async function start(viaQr: boolean) {
    if (!room) return
    setError(undefined)
    const c: ActiveCleaning = {
      id: crypto.randomUUID(),
      room_id: room.id,
      room_no: room.room_no,
      property_name: room.properties.name,
      room_type_id: room.room_type_id,
      type: cleaningTypeFor(board?.day_status ?? null),
      started_at: new Date().toISOString(),
      check_started_at: null,
      submitted_at: null,
      via_qr: viaQr,
      done: {},
    }
    saveActive(c)
    setActive(c)
    await enqueue({
      kind: 'rpc',
      fn: 'start_cleaning',
      args: { p_id: c.id, p_room: c.room_id, p_started_at: c.started_at, p_via_qr: viaQr },
    })
  }

  // Temizlik talebi: konaklayan odada müşteri temizlik isterse (karar 19)
  async function requestCleaning() {
    if (!room) return
    const { error } = await supabase.from('cleaning_requests').insert({ room_id: room.id })
    if (error) setError(errorText(error))
    else load()
  }

  async function addMember(id: string) {
    if (!active || !id || members.includes(id)) return
    setMembers([...members, id])
    await enqueue({ kind: 'rpc', fn: 'add_cleaning_member', args: { p_cleaning: active.id, p_profile: id } })
  }

  async function startCheck() {
    if (!active) return
    const at = new Date().toISOString()
    setActive(updateActive(active.id, { check_started_at: at }))
    await enqueue({ kind: 'rpc', fn: 'start_check', args: { p_cleaning: active.id, p_at: at } })
    window.location.hash = `#/cek/${active.id}`
  }

  if (room === undefined) return <p className="p-4 text-slate-500">Yükleniyor…</p>
  if (room === null) return <p className="m-4 rounded-xl bg-white p-4 text-slate-600">Oda bulunamadı.</p>

  const othersCleaning = board?.cleaning_status === 'in_progress' && board.hk_id !== me.id && !active
  const doneToday = board?.cleaning_status && ['submitted', 'approved', 'analyzing'].includes(board.cleaning_status)
  const primary = 'w-full rounded-2xl bg-brand py-5 text-lg font-bold text-white shadow active:scale-[0.99] disabled:opacity-50'

  return (
    <div className="space-y-4 px-4 pt-4">
      <a href="#/" className="text-sm text-brand">
        ← Bugün
      </a>
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h1 className="text-4xl font-extrabold text-slate-800">{room.room_no}</h1>
          <span className="text-sm font-semibold text-slate-500">{room.room_types.code}</span>
        </div>
        <p className="text-sm text-slate-500">
          {room.properties.name} · {room.room_types.name}
        </p>
        <p className="mt-3 text-base">
          Bugün: <b>{board?.day_status ? dayStatusLabel[board.day_status] : 'durum bilinmiyor'}</b>
          {' · '}
          {(active?.type ?? cleaningTypeFor(board?.day_status ?? null)) === 'stayover' ? 'konaklama kontrolü' : 'tam kontrol'}
        </p>
        {board?.block_reason && (
          <p className="mt-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">Kullanım dışı: {board.block_reason}</p>
        )}
        {board?.cleaning_requested_at && (
          <p className="mt-2 rounded-lg bg-orange-500 px-3 py-2 text-sm text-white">
            Temizlik talebi · {fmtTime(board.cleaning_requested_at)}
          </p>
        )}
        {board?.day_status === 'stayover' && !board.cleaning_requested_at && !active && (
          <button onClick={requestCleaning} className="mt-2 w-full rounded-lg border border-orange-300 py-2 text-sm font-semibold text-orange-700">
            Temizlik talebi gir
          </button>
        )}
        {board?.cleaning_status && board.hk_name && !active && (
          <p className="mt-2 text-sm text-slate-600">
            {doneToday ? 'Temizlendi' : 'Temizliyor'}: <b>{board.hk_name}</b>
            {board.started_at && ` · ${fmtTime(board.started_at)}`}
          </p>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {me.role === 'hk' && !active && (
        <div className="space-y-3">
          {othersCleaning && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Bu odayı şu an {board?.hk_name} temizliyor.</p>
          )}
          <button className={primary} onClick={() => start(qrMatched)}>
            Temizliğe başla
          </button>
        </div>
      )}

      {me.role === 'hk' && active && !active.check_started_at && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-amber-50 p-4 text-amber-900">
            <p className="text-lg font-bold">Temizlik sürüyor · {minutesSince(active.started_at)} dk</p>
            <p className="text-sm">{fmtTime(active.started_at)}'da başladı</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <label className="mb-2 block text-sm font-semibold text-slate-600">Birlikte temizleyen (isteğe bağlı)</label>
            <select
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
              value=""
              onChange={(e) => addMember(e.target.value)}
            >
              <option value="">Kişi ekle…</option>
              {team
                .filter((t) => !members.includes(t.id))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
            </select>
            {members.length > 0 && (
              <p className="mt-2 text-sm text-slate-600">
                {members.map((id) => team.find((t) => t.id === id)?.full_name).join(', ')}
              </p>
            )}
          </div>
          <button className={primary} onClick={startCheck}>
            Temizlik bitti · Kontrole başla
          </button>
        </div>
      )}

      {me.role === 'hk' && active?.check_started_at && !active.submitted_at && (
        <a href={`#/cek/${active.id}`} className={`${primary} block text-center`}>
          Kontrol çekimine devam et
        </a>
      )}

      <div className="grid grid-cols-2 gap-2 pt-2">
        <a href={`#/bildir/hasar/${room.id}`} className="rounded-xl bg-white py-3 text-center text-sm font-semibold text-slate-700 shadow-sm">
          Hasar bildir
        </a>
        <a href={`#/bildir/esya/${room.id}`} className="rounded-xl bg-white py-3 text-center text-sm font-semibold text-slate-700 shadow-sm">
          Eşya buldum
        </a>
      </div>
    </div>
  )
}
