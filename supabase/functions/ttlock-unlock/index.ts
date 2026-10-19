// Kapıyı TTLock ağ geçidi üzerinden açar (karar 16). TTLock bilgileri sadece burada; tarayıcı TTLock'a bağlanmaz.
// unlock: aktif kullanıcı odanın kapısını açar. Admin her odayı, süpervizör ve HK kendi bölgesindeki odaları.
//         Her deneme door_unlocks tablosuna yazılır; kısa sürede çok fazla deneme engellenir.
// test:   admin, TTLock bağlantısını ve kilitleri kontrol eder (kapı açmaz).
// Gizli değişkenler: TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USERNAME, TTLOCK_PASSWORD (düz ya da md5),
// isteğe bağlı TTLOCK_API (varsayılan https://euapi.ttlock.com).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { createHash } from 'node:crypto'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const env = (k: string) => (Deno.env.get(k) ?? '').trim()
const API = (env('TTLOCK_API') || 'https://euapi.ttlock.com').replace(/\/$/, '')
const MAX_PER_10_MIN = 20

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

class TTLockError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
  }
}

async function call(path: string, params: Record<string, string | number>, method: 'GET' | 'POST' = 'POST') {
  const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  const url = method === 'GET' ? `${API}${path}?${body}` : `${API}${path}`
  const res = await fetch(url, method === 'GET' ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(() => {
    throw new TTLockError('TTLock sunucusuna ulaşılamadı.')
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || (data.errcode && data.errcode !== 0)) {
    throw new TTLockError(`TTLock: ${data.errmsg ?? data.description ?? res.statusText} (${data.errcode ?? res.status})`, data.errcode)
  }
  return data
}

// Oturum anahtarı veritabanında saklanır (her açılışta yeniden giriş yapmamak için)
async function token(fresh = false): Promise<string> {
  if (!fresh) {
    const { data } = await admin.from('ttlock_token').select('access_token, expires_at').eq('id', 1).maybeSingle()
    if (data && Date.parse(data.expires_at) > Date.now() + 3600_000) return data.access_token
  }
  const pw = env('TTLOCK_PASSWORD')
  const r = await call('/oauth2/token', {
    clientId: env('TTLOCK_CLIENT_ID'),
    clientSecret: env('TTLOCK_CLIENT_SECRET'),
    username: env('TTLOCK_USERNAME'),
    password: /^[0-9a-f]{32}$/i.test(pw) ? pw.toLowerCase() : createHash('md5').update(pw).digest('hex'),
  })
  if (!r.access_token) throw new TTLockError('TTLock girişi başarısız. Kullanıcı adı/şifreyi kontrol edin.')
  const expires = new Date(Date.now() + (Number(r.expires_in) || 86400) * 1000).toISOString()
  await admin.from('ttlock_token').upsert({ id: 1, access_token: r.access_token, expires_at: expires })
  return r.access_token
}

// Anahtar geçersizse (10003/10004) bir kez yeniden giriş yapıp tekrar dener
async function withToken<T>(fn: (t: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await token())
  } catch (e) {
    if (e instanceof TTLockError && (e.code === 10003 || e.code === 10004)) return await fn(await token(true))
    throw e
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Yalnızca POST' }, 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Oturum yok.' }, 401)
  const { data: who } = await admin.auth.getUser(jwt)
  if (!who.user) return json({ error: 'Oturum geçersiz. Tekrar giriş yapın.' }, 401)
  const { data: me } = await admin.from('profiles').select('id, role, region, active').eq('id', who.user.id).maybeSingle()
  if (!me?.active) return json({ error: 'Hesabınız aktif değil.' }, 403)
  if (!env('TTLOCK_CLIENT_ID') || !env('TTLOCK_USERNAME')) {
    return json({ error: 'TTLock bağlantısı henüz kurulmadı.', code: 'no_ttlock' }, 503)
  }

  const body = await req.json().catch(() => ({}))

  if (body.action === 'unlock') {
    const { data: room } = await admin.from('rooms')
      .select('id, room_no, ttlock_lock_id, properties(region)')
      .eq('id', body.room_id).maybeSingle()
    if (!room) return json({ error: 'Oda bulunamadı.' }, 404)
    const region = (room as any).properties?.region
    if (me.role !== 'admin' && me.region !== region) return json({ error: 'Bu odanın kapısını açma yetkiniz yok.' }, 403)
    if (!room.ttlock_lock_id) return json({ error: 'Bu odanın TTLock kilidi tanımlı değil.' }, 400)

    const since = new Date(Date.now() - 10 * 60_000).toISOString()
    const { count } = await admin.from('door_unlocks').select('id', { count: 'exact', head: true })
      .eq('profile_id', me.id).gte('at', since)
    if ((count ?? 0) >= MAX_PER_10_MIN) return json({ error: 'Çok fazla kapı açma denemesi. Birkaç dakika sonra deneyin.' }, 429)

    const cleaning = typeof body.cleaning_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.cleaning_id) ? body.cleaning_id : null
    let error: string | null = null
    try {
      await withToken((t) => call('/v3/lock/unlock', {
        clientId: env('TTLOCK_CLIENT_ID'), accessToken: t, lockId: room.ttlock_lock_id, date: Date.now(),
      }))
    } catch (e) {
      error = e instanceof TTLockError ? e.message : 'Kapı açılamadı.'
    }
    await admin.from('door_unlocks').insert({ room_id: room.id, profile_id: me.id, cleaning_id: cleaning, ok: !error, error })
    return error ? json({ error }, 502) : json({ ok: true })
  }

  if (body.action === 'test') {
    if (me.role !== 'admin') return json({ error: 'Yetkiniz yok.' }, 403)
    try {
      const locks: any[] = []
      await withToken(async (t) => {
        for (let page = 1; page <= 10; page++) {
          const r = await call('/v3/lock/list', {
            clientId: env('TTLOCK_CLIENT_ID'), accessToken: t, pageNo: page, pageSize: 100, date: Date.now(),
          }, 'GET')
          locks.push(...(r.list ?? []))
          if (page >= (r.pages ?? 1)) break
        }
      })
      const { data: rooms } = await admin.from('rooms')
        .select('room_no, ttlock_lock_id, properties(name)').not('ttlock_lock_id', 'is', null)
      const byId = new Map(locks.map((l) => [Number(l.lockId), l]))
      const label = (r: any) => `${r.properties.name} ${r.room_no}`
      const missing: string[] = []
      const noGateway: string[] = []
      const lowBattery: string[] = []
      for (const r of rooms ?? []) {
        const l = byId.get(Number(r.ttlock_lock_id))
        if (!l) missing.push(label(r))
        else {
          if (l.hasGateway === 0) noGateway.push(label(r))
          if (typeof l.electricQuantity === 'number' && l.electricQuantity < 30) lowBattery.push(`${label(r)} (%${l.electricQuantity})`)
        }
      }
      return json({ locks: locks.length, rooms: rooms?.length ?? 0, missing, noGateway, lowBattery })
    } catch (e) {
      return json({ error: e instanceof TTLockError ? e.message : 'TTLock testi başarısız.' }, 502)
    }
  }

  return json({ error: 'Bilinmeyen işlem.' }, 400)
})
