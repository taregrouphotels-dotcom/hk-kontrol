// Saklama süresi dolan fotoğrafları R2'den siler (spec 8, karar 21). Her gece cron çağırır (x-cron-key).
// Hangi fotoğrafların silineceğine veritabanı karar verir (media_to_delete): şikayetli kayıt ve referanslar silinmez.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const env = (k: string) => (Deno.env.get(k) ?? '').trim()
const r2 = new AwsClient({ accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY'), service: 's3', region: 'auto' })
const BASE = `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_BUCKET') || 'hk-media'}`

Deno.serve(async (req) => {
  const { data: ok } = await admin.rpc('check_cron_key', { k: req.headers.get('x-cron-key') ?? '' })
  if (!ok) return new Response('Yetkisiz', { status: 401 })
  const started = Date.now()
  let deleted = 0
  let failed = 0
  for (;;) {
    const { data: rows, error } = await admin.rpc('media_to_delete', { p_limit: 200 })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    if (!rows?.length || Date.now() - started > 100_000) break
    for (const r of rows as { kind: 'step' | 'report'; id: string; media_key: string }[]) {
      const res = await r2.fetch(`${BASE}/${r.media_key.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) {
        failed++
        continue
      }
      await admin.from(r.kind === 'step' ? 'step_results' : 'report_media').update({ media_deleted_at: new Date().toISOString() }).eq('id', r.id)
      deleted++
    }
    if (failed > 20) break
  }
  console.log('saklama', { deleted, failed })
  return new Response(JSON.stringify({ deleted, failed }), { headers: { 'Content-Type': 'application/json' } })
})
