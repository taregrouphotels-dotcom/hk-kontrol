// Telefon bildirimi (Web Push, karar 21). Kuyruktaki bildirimleri abone cihazlara gönderir; dakikada bir cron çağırır.
// VAPID anahtarları ops.app_secrets'ta (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Geçersiz abonelik silinir.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const secret = async (name: string) => ((await admin.rpc('get_app_secret', { p_name: name })).data ?? '').trim()

Deno.serve(async (req) => {
  const { data: ok } = await admin.rpc('check_cron_key', { k: req.headers.get('x-cron-key') ?? '' })
  if (!ok) return new Response('Yetkisiz', { status: 401 })
  const pub = await secret('VAPID_PUBLIC_KEY')
  const priv = await secret('VAPID_PRIVATE_KEY')
  if (!pub || !priv) return new Response('VAPID yok', { status: 503 })
  webpush.setVapidDetails('mailto:gokcercakir@gmail.com', pub, priv)

  const { data: rows } = await admin.rpc('push_take', { p_limit: 50 })
  let sent = 0
  let gone = 0
  for (const r of (rows ?? []) as { title: string; body: string | null; link: string | null; endpoint: string; keys: { p256dh: string; auth: string }; sub_id: number }[]) {
    try {
      // web-push sadece şifreli isteği hazırlar; gönderim Deno fetch ile (Node https katmanına güvenmeden)
      const d = webpush.generateRequestDetails(
        { endpoint: r.endpoint, keys: r.keys },
        JSON.stringify({ title: r.title, body: r.body ?? '', link: r.link ?? '#/' }),
        { TTL: 3600, urgency: 'high' },
      )
      const res = await fetch(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body as unknown as BodyInit })
      if (res.status === 404 || res.status === 410) {
        await admin.from('push_subscriptions').delete().eq('id', r.sub_id)
        gone++
      } else if (!res.ok) console.error('push hatası', res.status, (await res.text()).slice(0, 200))
      else sent++
    } catch (e) {
      console.error('push hatası', String(e).slice(0, 200))
    }
  }
  return new Response(JSON.stringify({ sent, gone }), { headers: { 'Content-Type': 'application/json' } })
})
