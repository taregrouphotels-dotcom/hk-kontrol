// HotelRunner senkronu (spec 3): tesis başına son değişen rezervasyonları çeker, oda satırlarını pms_reservations'a
// yazar ve bugünün + yarının oda durumlarını hesaplatır (pms_apply_day_status).
// HotelRunner'a sadece okuma isteği gider (undelivered=false: rezervasyonlar "teslim edildi" işaretlenmez).
// Misafir bilgisi alınmaz/saklanmaz: sadece oda no, tarih, durum.
//
// Çağıranlar: saatlik Supabase cron (x-cron-key başlığı) veya admin ("Şimdi senkronla", oturum token'ı).
// Bağlantılar: HOTELRUNNER_CONNECTIONS = [{"pms_name":"Tare Houses Hotel","hr_id":"...","token":"..."}, ...]
// pms_name, Excel'deki "PMS'teki Adı" (properties.pms_name) ile aynı olmalı.
//
// Süre sınırı: HotelRunner sayfaları arasında 6 sn beklenir. Her çağrı en fazla ~100 sn çalışır; sığmazsa ilerlemeyi
// pms_sync_runs.progress'e yazar ve devamı için kendini yeniden çağırır (2 günlük pencerede normalde gerekmez).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

interface Connection {
  pms_name: string
  hr_id: string
  token: string
}

interface Progress {
  since: string
  next_page: number
  pages: number | null
  lines: number
  done: boolean
  error?: string
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const API = 'https://app.hotelrunner.com/api/v2/apps/reservations'
const PAGE_INTERVAL_MS = 6000 // HotelRunner istek sınırı; n8n akışıyla aynı
const BUDGET_MS = 100_000 // bir çağrıda çalışma süresi
const STALE_MS = 3 * 60_000 // bu kadar ilerleme yoksa çalışma ölmüş sayılır
const SELF_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/pms-sync`
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

function connections(): Connection[] {
  // Yapıştırırken kalan boşluklar temizlenir
  return (JSON.parse(Deno.env.get('HOTELRUNNER_CONNECTIONS') || '[]') as Connection[]).map((c) => ({
    pms_name: String(c.pms_name ?? '').trim(),
    hr_id: String(c.hr_id ?? '').trim(),
    token: String(c.token ?? '').trim(),
  }))
}

async function fetchPage(c: Connection, since: string, page: number) {
  const qs = new URLSearchParams({
    token: c.token, hr_id: c.hr_id, from_last_update_date: since, undelivered: 'false', per_page: '50', page: String(page),
  })
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}?${qs}`)
    if (res.ok) return await res.json()
    if (attempt >= 3) {
      // HotelRunner hata mesajında anahtarı geri yazıyor; ekrana ve kayda gitmesin
      const text = (await res.text()).split(c.token).join('***').slice(0, 200)
      throw new Error(`HotelRunner ${res.status}: ${text}`)
    }
    await sleep(5000 * attempt)
  }
}

// Bir sayfanın rezervasyonları → oda satırları (sadece oda no, tarih, durum)
async function savePage(c: Connection, body: { reservations?: Record<string, any>[] }): Promise<number> {
  const lines = new Map<number, Record<string, unknown>>()
  const synced_at = new Date().toISOString()
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
        synced_at,
      })
    }
  }
  if (lines.size > 0) {
    const { error } = await admin.from('pms_reservations').upsert([...lines.values()], { onConflict: 'line_id' })
    if (error) throw error
  }
  return lines.size
}

// Bir tesisin sayfalarını süre bitene kadar okur; ilerlemeyi p'ye yazar
async function step(c: Connection, p: Progress, deadline: number, beat: () => Promise<void>) {
  try {
    while (!p.done && Date.now() < deadline) {
      if (p.next_page > 1) await sleep(PAGE_INTERVAL_MS)
      const body = await fetchPage(c, p.since, p.next_page)
      p.pages = Number(body.pages || 1)
      p.lines += await savePage(c, body)
      p.next_page++
      if (p.next_page > p.pages) p.done = true
      await beat()
    }
  } catch (e) {
    p.done = true
    p.error = e instanceof Error ? e.message : String(e)
  }
}

async function work(runId: number, started: number) {
  const { data: run } = await admin.from('pms_sync_runs').select('progress').eq('id', runId).single()
  const progress = (run?.progress ?? {}) as Record<string, Progress>
  const conns = connections().filter((c) => progress[c.pms_name])
  const beat = async () => {
    await admin.from('pms_sync_runs').update({ progress, heartbeat_at: new Date().toISOString() }).eq('id', runId)
  }

  await Promise.all(conns.map((c) => step(c, progress[c.pms_name], started + BUDGET_MS, beat)))
  await beat()

  if (Object.values(progress).some((p) => !p.done)) {
    // Süre doldu: devamı için kendini çağır
    const { data: key } = await admin.rpc('get_cron_key')
    await fetch(SELF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-key': String(key) },
      body: JSON.stringify({ continue_run: runId }),
    })
    return
  }

  // Hepsi bitti: durumları hesapla, çalışmayı kapat
  const summary: Record<string, unknown> = {}
  const synced: string[] = []
  for (const [name, p] of Object.entries(progress)) {
    summary[name] = p.error ? { error: p.error } : { since: p.since, pages: p.pages, lines: p.lines }
    if (!p.error) synced.push(name)
  }
  let ok = synced.length === Object.keys(progress).length
  if (synced.length > 0) {
    const { data, error } = await admin.rpc('pms_apply_day_status', { p_pms_names: synced })
    if (error) {
      ok = false
      summary.error = error.message
    } else summary.applied = data
  }
  await admin.from('pms_sync_runs').update({ finished_at: new Date().toISOString(), ok, summary }).eq('id', runId)
}

// Yeni çalışma: ilerleme kaydını hazırlar
async function startRun(trigger: string): Promise<number | null> {
  const conns = connections()
  if (conns.length === 0) {
    await admin.from('pms_sync_runs').insert({
      trigger, finished_at: new Date().toISOString(), ok: false, summary: { error: 'HOTELRUNNER_CONNECTIONS tanımlı değil' },
    })
    return null
  }
  // Sadece son 2 günde değişen rezervasyonlar (n8n akışıyla aynı yük). Daha önce yapılıp değişmemiş rezervasyonlar
  // pms_reservations'ta zaten durur; ilk dolum Airtable'daki HotelRunner kayıtlarından yapıldı (0009).
  const since = minusDays(istanbulNow().date, 2)
  const progress: Record<string, Progress> = {}
  for (const c of conns) progress[c.pms_name] = { since, next_page: 1, pages: null, lines: 0, done: false }
  const { data, error } = await admin.from('pms_sync_runs')
    .insert({ trigger, progress, heartbeat_at: new Date().toISOString() }).select('id').single()
  if (error) throw error
  return data.id
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Yalnızca POST' }, 405)
  const started = Date.now()
  const body = await req.json().catch(() => ({}))

  // Cron ve devam çağrısı: veritabanında üretilen anahtar
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

  // Devam çağrısı
  if (cronKey && typeof body.continue_run === 'number') {
    EdgeRuntime.waitUntil(work(body.continue_run, started))
    return json({ started: true, continued: true })
  }

  // Bitmemiş çalışmalar: yakın zamanda ilerlediyse zaten çalışıyor; uzun süredir ilerlemiyorsa yarıda kalmış say
  const { data: open } = await admin.from('pms_sync_runs').select('id, heartbeat_at, started_at').is('finished_at', null)
  for (const r of open ?? []) {
    const last = Date.parse(r.heartbeat_at ?? r.started_at)
    if (Date.now() - last < STALE_MS) return json({ started: false, message: 'Senkron zaten çalışıyor.' })
    await admin.from('pms_sync_runs').update({
      finished_at: new Date().toISOString(), ok: false, summary: { error: 'Yarıda kaldı (süre sınırı); yeniden başlatıldı.' },
    }).eq('id', r.id)
  }

  const runId = await startRun(trigger)
  if (runId !== null) EdgeRuntime.waitUntil(work(runId, started))
  return json({ started: runId !== null })
})

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }
