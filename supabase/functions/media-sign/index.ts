// Cloudflare R2 için süreli imzalı adres (spec 9). Anahtarlar sadece burada; tarayıcı R2'ye doğrudan yükler/okur.
// upload: kaydı başlatan HK, açık (in_progress/fixing) temizliğin adım fotoğrafı için PUT adresi alır.
// view:   kullanıcı, RLS'e göre görebildiği bir fotoğrafın GET adresini alır.
// cleaning: bir temizlik kaydının tüm adım fotoğrafları ve adımların referans fotoğrafları (onay ekranı), tek çağrıda.
// Anahtar biçimi: {bölge}/{otel}/{oda}/{gün}/{temizlik}/{adım}-{kare}-{deneme}.jpg
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function r2() {
  const account = Deno.env.get('R2_ACCOUNT_ID')
  const key = Deno.env.get('R2_ACCESS_KEY_ID')
  const secret = Deno.env.get('R2_SECRET_ACCESS_KEY')
  const bucket = Deno.env.get('R2_BUCKET') || 'hk-media'
  if (!account || !key || !secret) return null
  return {
    client: new AwsClient({ accessKeyId: key.trim(), secretAccessKey: secret.trim(), service: 's3', region: 'auto' }),
    base: `https://${account.trim()}.r2.cloudflarestorage.com/${bucket.trim()}`,
  }
}

async function presign(method: 'PUT' | 'GET', objectKey: string, contentType?: string): Promise<string> {
  const store = r2()!
  const url = new URL(`${store.base}/${objectKey.split('/').map(encodeURIComponent).join('/')}`)
  url.searchParams.set('X-Amz-Expires', method === 'PUT' ? '900' : '3600')
  const signed = await store.client.sign(
    new Request(url, { method, headers: contentType ? { 'Content-Type': contentType } : {} }),
    { aws: { signQuery: true } },
  )
  return signed.url
}

const slug = (s: string) =>
  s.toLocaleLowerCase('tr').replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c]!)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Yalnızca POST' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Oturum yok.' }, 401)
  const { data: who } = await admin.auth.getUser(token)
  if (!who.user) return json({ error: 'Oturum geçersiz. Tekrar giriş yapın.' }, 401)
  if (!r2()) return json({ error: 'Fotoğraf deposu (R2) henüz kurulmadı.', code: 'no_storage' }, 503)

  const body = await req.json().catch(() => ({}))

  if (body.action === 'upload') {
    // Temizlik ve adım bilgisi; sahiplik ve açık durum sunucuda kontrol edilir
    const { data: c } = await admin.from('cleanings')
      .select('id, hk_id, status, day, rooms(room_no, properties(name, region))')
      .eq('id', body.cleaning_id).maybeSingle()
    if (!c || c.hk_id !== who.user.id) return json({ error: 'Kayıt bulunamadı.' }, 404)
    if (!['in_progress', 'fixing'].includes(c.status)) return json({ error: 'Kayıt kapanmış.' }, 409)
    const { data: step } = await admin.from('check_steps').select('step_order').eq('id', body.step_id).maybeSingle()
    if (!step) return json({ error: 'Adım bulunamadı.' }, 404)
    const room = (c as any).rooms
    const shot = Number(body.shot) || 1
    const attempt = Number(body.attempt) || 1
    const key = [room.properties.region, slug(room.properties.name), slug(room.room_no), c.day, c.id,
      `${step.step_order}-${shot}-${attempt}.jpg`].join('/')
    return json({ key, url: await presign('PUT', key, 'image/jpeg') })
  }

  if (body.action === 'view') {
    // Kullanıcının kendi yetkisiyle (RLS) bu fotoğrafı görüp göremediği kontrol edilir
    const userDb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })
    const key = String(body.key ?? '')
    const { data } = await userDb.from('step_results').select('id').eq('media_key', key).is('media_deleted_at', null).limit(1)
    let ok = (data?.length ?? 0) > 0
    if (!ok) {
      const { data: rm } = await userDb.from('report_media').select('id').eq('media_key', key).is('media_deleted_at', null).limit(1)
      ok = (rm?.length ?? 0) > 0
    }
    if (!ok) {
      const { data: ref } = await userDb.from('check_steps').select('id').eq('reference_key', key).limit(1)
      ok = (ref?.length ?? 0) > 0
    }
    if (!ok) return json({ error: 'Fotoğraf bulunamadı.' }, 404)
    return json({ url: await presign('GET', key) })
  }

  if (body.action === 'cleaning') {
    // Kayıt ve fotoğraflar kullanıcının kendi yetkisiyle (RLS) okunur; göremiyorsa boş döner
    const userDb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })
    const { data: c } = await userDb.from('cleanings').select('id, room_id, rooms(room_type_id)').eq('id', body.cleaning_id).maybeSingle()
    if (!c) return json({ error: 'Kayıt bulunamadı.' }, 404)
    const { data: results } = await userDb.from('step_results')
      .select('id, step_id, shot, attempt, media_key, media_deleted_at, skipped, skip_reason, captured_at')
      .eq('cleaning_id', c.id)
    const { data: steps } = await userDb.from('check_steps').select('id, reference_key')
      .eq('room_type_id', (c as any).rooms.room_type_id).not('reference_key', 'is', null)
    const photos = await Promise.all((results ?? []).map(async (r) => ({
      ...r,
      url: r.media_key && !r.media_deleted_at ? await presign('GET', r.media_key) : null,
    })))
    const references: Record<string, string> = {}
    for (const st of steps ?? []) references[st.id] = await presign('GET', st.reference_key!)
    return json({ photos, references })
  }

  // Admin: depo testi. Sunucu R2'ye yazıp okur (anahtarlar doğru mu), tarayıcı için de PUT/GET adresi verir (CORS doğru mu).
  if (body.action === 'selftest' || body.action === 'selftest_cleanup') {
    const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
    if (me?.role !== 'admin') return json({ error: 'Yetkiniz yok.' }, 403)
    const store = r2()!
    if (body.action === 'selftest_cleanup') {
      const key = String(body.key ?? '')
      if (!/^_test\/[0-9a-f-]+\.txt$/.test(key)) return json({ error: 'Geçersiz anahtar.' }, 400)
      await store.client.fetch(`${store.base}/${key}`, { method: 'DELETE' })
      return json({ ok: true })
    }
    const key = `_test/${crypto.randomUUID()}.txt`
    const put = await store.client.fetch(`${store.base}/${key}`, { method: 'PUT', body: 'ok', headers: { 'Content-Type': 'text/plain' } })
    if (!put.ok) return json({ error: `Sunucu R2'ye yazamadı (${put.status}): ${(await put.text()).slice(0, 300)}` }, 502)
    const get = await store.client.fetch(`${store.base}/${key}`)
    const text = await get.text()
    if (!get.ok || text !== 'ok') return json({ error: `Sunucu R2'den okuyamadı (${get.status}).` }, 502)
    return json({ key, put_url: await presign('PUT', key, 'text/plain'), get_url: await presign('GET', key) })
  }

  return json({ error: 'Bilinmeyen işlem.' }, 400)
})
