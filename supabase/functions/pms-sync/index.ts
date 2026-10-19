// HotelRunner senkronu (spec 3): tesis başına son değişen rezervasyonları çeker, oda satırlarını pms_reservations'a
// yazar ve bugünün + yarının oda durumlarını hesaplatır (pms_apply_day_status).
// HotelRunner'a sadece okuma isteği gider (undelivered=false: rezervasyonlar "teslim edildi" işaretlenmez).
// Misafir bilgisi alınmaz/saklanmaz: sadece oda no, tarih, durum.
//
// Çağıranlar: saatlik Supabase cron (x-cron-key başlığı) veya admin ("Şimdi senkronla", oturum token'ı).
// Bağlantılar: HOTELRUNNER_CONNECTIONS = [{"pms_name":"Tare Houses Hotel","hr_id":"...","token":"..."}, ...]
// pms_name, Excel'deki "PMS'teki Adı" (properties.pms_name) ile aynı olmalı.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

interface Connection {
  pms_name: string
  hr_id: string
  token: string
}

interface Line {
  line_id: number
  hr_number: string
  pms_name: string
  room_no: string | null
  state: string
  checkin: string
  checkout: string
  hr_updated_at: string | null
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const API = 'https://app.hotelrunner.com/api/v2/apps/reservations'
const PAGE_INTERVAL_MS = 6000 // HotelRunner istek sınırı; n8n akışıyla aynı
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function istanbulNow(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

function minusDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

async function fetchPage(c: Connection, since: string, page: number) {
  const qs = new URLSearchParams({
    token: c.token, hr_id: c.hr_id, from_last_update_date: since, undelivered: 'false', per_page: '50', page: String(page),
  })
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}?${qs}`)
    if (res.ok) return await res.json()
    if (attempt >= 3) throw new Error(`HotelRunner ${res.status}: ${(await res.text()).slice(0, 200)}`)
    await sleep(5000 * attempt)
  }
}

// Bir tesisin değişen rezervasyonları → oda satırları
async function syncConnection(c: Connection, sinceDays: number) {
  const since = minusDays(istanbulNow().date, sinceDays)
  let total = 0
  let page = 1
  let pages = 1
  do {
    if (page > 1) await sleep(PAGE_INTERVAL_MS)
    const body = await fetchPage(c, since, page)
    pages = Number(body.pages || 1)
    // Sayfa sayfa yazılır: uzun ilk senkron yarıda kesilse de gelen kısım kalır
    const lines = new Map<number, Line>()
    for (const r of body.reservations ?? []) {
      for (const o of r.rooms ?? []) {
        const checkin = o.checkin_date || r.checkin_date
        const checkout = o.checkout_date || r.checkout_date
        if (!o.id || !checkin || !checkout) continue
        lines.set(Number(o.id), {
          line_id: Number(o.id),
          hr_number: String(r.hr_number),
          pms_name: c.pms_name,
          room_no: o.number ? String(o.number).trim() : null,
          state: String(o.state || r.state || ''),
          checkin,
          checkout,
          hr_updated_at: o.updated_at || r.updated_at || null,
        })
      }
    }
    if (lines.size > 0) {
      const synced_at = new Date().toISOString()
      const { error } = await admin.from('pms_reservations').upsert(
        [...lines.values()].map((l) => ({ ...l, synced_at })),
        { onConflict: 'line_id' },
      )
      if (error) throw error
    }
    total += lines.size
    page++
  } while (page <= pages && page <= 60)
  return { since, pages, lines: total }
}

async function run(trigger: string) {
  const { data: runRow } = await admin.from('pms_sync_runs').insert({ trigger }).select('id').single()
  const summary: Record<string, unknown> = {}
  let ok = true
  try {
    const connections = JSON.parse(Deno.env.get('HOTELRUNNER_CONNECTIONS') || '[]') as Connection[]
    if (connections.length === 0) throw new Error('HOTELRUNNER_CONNECTIONS tanımlı değil')

    // İlk senkronda geçmişe uzun bak; her gece 03:00'te 60 gün; diğer saatlerde son 2 gün (n8n akışıyla aynı)
    const { count } = await admin.from('pms_sync_runs').select('id', { count: 'exact', head: true }).eq('ok', true)
    const sinceDays = !count ? 180 : istanbulNow().hour === 3 ? 60 : 2

    const results = await Promise.allSettled(connections.map((c) => syncConnection(c, sinceDays)))
    const synced: string[] = []
    results.forEach((r, i) => {
      const name = connections[i].pms_name
      if (r.status === 'fulfilled') {
        synced.push(name)
        summary[name] = r.value
      } else {
        ok = false
        summary[name] = { error: String(r.reason?.message ?? r.reason) }
      }
    })

    if (synced.length > 0) {
      const { data, error } = await admin.rpc('pms_apply_day_status', { p_pms_names: synced })
      if (error) throw error
      summary.applied = data
    }
  } catch (e) {
    ok = false
    summary.error = e instanceof Error ? e.message : String(e)
  }
  await admin.from('pms_sync_runs').update({ finished_at: new Date().toISOString(), ok, summary }).eq('id', runRow?.id)
  return { ok, summary }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Yalnızca POST' }, 405)

  // Cron: veritabanında üretilen anahtar
  const cronKey = req.headers.get('x-cron-key')
  let trigger: string
  if (cronKey) {
    const { data } = await admin.rpc('check_cron_key', { k: cronKey })
    if (data !== true) return json({ error: 'Geçersiz anahtar.' }, 401)
    trigger = 'cron'
  } else {
    // Admin: "Şimdi senkronla"
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } }
    if (!auth.user) return json({ error: 'Oturum yok.' }, 401)
    const { data: me } = await admin.from('profiles').select('role, active').eq('id', auth.user.id).maybeSingle()
    if (!me || me.role !== 'admin' || !me.active) return json({ error: 'Bu işlem için admin yetkisi gerekir.' }, 403)
    trigger = 'manual'
  }

  // Aynı anda iki senkron çalışmasın (son 3 dakikada bitmemiş çalışma varsa)
  const { data: running } = await admin.from('pms_sync_runs').select('id')
    .is('finished_at', null).gte('started_at', new Date(Date.now() - 3 * 60_000).toISOString()).limit(1)
  if (running && running.length > 0) return json({ started: false, message: 'Senkron zaten çalışıyor.' })

  // Sayfalar arası bekleme yüzünden uzun sürebilir: arka planda çalışır, sonucu pms_sync_runs'a yazılır
  EdgeRuntime.waitUntil(run(trigger))
  return json({ started: true })
})

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }
