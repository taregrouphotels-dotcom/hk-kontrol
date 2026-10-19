// Adım fotoğrafının AI kontrolü (karar 18). Fotoğraf R2'den okunur, oda tipinin referans fotoğrafı varsa
// onunla birlikte Claude'a gönderilir; sonuç step_results.ai_status / ai_result'a yazılır.
// Çağrı: HK fotoğrafı yükleyince (kullanıcı oturumuyla, {step_result_id}) ya da dakikalık tarama (x-cron-key).
// Gizli bilgiler: ANTHROPIC_API_KEY, CLAUDE_MODEL (varsayılan claude-haiku-5-5) — Edge Function secrets'ta ya da
// admin'in Veri ekranından girdiği ops.app_secrets'ta (0017); R2_*.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { AwsClient } from 'npm:aws4fetch@1.0.20'
import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0'
import { Buffer } from 'node:buffer'

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
const env = (k: string) => (Deno.env.get(k) ?? '').trim()

// Önce ortam değişkeni, yoksa veritabanındaki uygulama bilgisi
async function secret(name: string): Promise<string> {
  if (env(name)) return env(name)
  const { data } = await admin.rpc('get_app_secret', { p_name: name })
  return (data ?? '').trim()
}
const MAX_TRIES = 3

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY'), service: 's3', region: 'auto',
})
const R2_BASE = `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_BUCKET') || 'hk-media'}`

async function image(key: string) {
  const res = await r2.fetch(`${R2_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`)
  if (!res.ok) throw new Error(`R2 okunamadı (${res.status}): ${key}`)
  return {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: Buffer.from(await res.arrayBuffer()).toString('base64') },
  }
}

const SYSTEM = `Sen bir otelin housekeeping kalite kontrolcüsüsün. Temizlikçinin (HK) oda temizliğinden sonra çektiği
tek bir kontrol fotoğrafını değerlendiriyorsun. Sana adımın adı, çekim talimatı ve kontrol maddeleri verilir; varsa
aynı oda tipinde doğru hazırlanmış bir referans fotoğraf da verilir.

Kurallar:
- Sadece fotoğrafta gerçekten görünen şeye göre karar ver. Görünmeyen bir madde için sorun uydurma.
- Kontrol maddelerinden açıkça karşılanmayanları "problems" listesine yaz; her biri için kısa ve somut Türkçe açıklama.
- status:
  "ok": görünen her şey düzgün.
  "warn": küçük kusur (ör. yastık hafif yamuk, havlu katı özensiz); oda yine de misafire verilebilir.
  "fail": düzeltilmesi gereken açık sorun (kir, leke, saç, çöp, eksik malzeme, bozulmuş yatak, unutulmuş eşya).
  "unclear": fotoğraf karar vermeye yetmiyor (çok karanlık, bulanık, yanlış yer çekilmiş, talimattaki alan görünmüyor).
- Referans fotoğraf yerleşim ve olması gereken durum içindir; kamera açısındaki küçük farkları sorun sayma.
- "note": HK'ya ekranda gösterilecek tek cümle, Türkçe, emir kipinde ve uygulanabilir
  (ör. "Klozet kapağının altını silip tekrar çek."). Sorun yoksa "Tamam".
- Konaklama kontrolünde misafirin kişisel eşyalarını (bavul, kıyafet, kozmetik) sorun sayma.
- "Sayılacak kalemler" verilirse her biri için fotoğrafta net sayabildiğin adedi "items"a yaz; net göremiyorsan -1 yaz.
  Beklenenden az görürsen bunu ayrıca "problems"a da ekle.`

const SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'warn', 'fail', 'unclear'] },
    problems: {
      type: 'array',
      items: {
        type: 'object',
        properties: { check: { type: 'string' }, problem: { type: 'string' } },
        required: ['check', 'problem'],
        additionalProperties: false,
      },
    },
    note: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, seen: { type: 'integer' } },
        required: ['key', 'seen'],
        additionalProperties: false,
      },
    },
  },
  required: ['status', 'problems', 'note', 'items'],
  additionalProperties: false,
}

interface Row {
  id: string
  step_id: string
  cleaning_id: string
  shot: number
  media_key: string | null
  skipped: boolean
  cleanings: { type: 'full' | 'stayover' }
  check_steps: { title: string; instruction: string; checks: string[]; ai_prompt: string | null; reference_key: string | null; shots: number }
}

async function analyze(id: string) {
  const { data } = await admin.from('step_results')
    .select('id, step_id, cleaning_id, shot, media_key, skipped, cleanings(type), check_steps(title, instruction, checks, ai_prompt, reference_key, shots)')
    .eq('id', id).maybeSingle()
  const r = data as unknown as Row | null
  if (!r || r.skipped || !r.media_key) return null
  const st = r.check_steps
  // Demirbaş sayımı sadece tam kontrolde (konaklamada mutfak sayılmaz, spec 5.4)
  const { data: expected } = r.cleanings.type === 'full'
    ? await admin.from('expected_items').select('item_key, label, qty, item_catalog(description)').eq('step_id', r.step_id).gt('qty', 0)
    : { data: [] }
  const items = (expected ?? []) as unknown as { item_key: string; label: string; qty: number; item_catalog: { description: string | null } | null }[]
  const content: Anthropic.ContentBlockParam[] = []
  if (st.reference_key) {
    content.push({ type: 'text', text: 'Referans fotoğraf (olması gereken):' }, await image(st.reference_key))
  }
  content.push({ type: 'text', text: 'Değerlendirilecek fotoğraf:' }, await image(r.media_key))
  content.push({
    type: 'text',
    text: [
      `Adım: ${st.title}${st.shots > 1 ? ` (kare ${r.shot}/${st.shots})` : ''}`,
      `Kontrol türü: ${r.cleanings.type === 'stayover' ? 'konaklama kontrolü (misafir odada kalıyor)' : 'tam kontrol (misafir çıkmış)'}`,
      `Çekim talimatı: ${st.instruction}`,
      `Kontrol maddeleri:\n${st.checks.map((c) => `- ${c}`).join('\n')}`,
      st.ai_prompt ? `Özellikle bak: ${st.ai_prompt}` : '',
      items.length
        ? `Sayılacak kalemler (key: ad, beklenen adet):\n${items.map((i) => `- ${i.item_key}: ${i.label}${i.item_catalog?.description ? ` (${i.item_catalog.description})` : ''}, beklenen ${i.qty}`).join('\n')}`
        : 'Sayılacak kalem yok; items boş liste olsun.',
    ].filter(Boolean).join('\n'),
  })

  const client = new Anthropic({ apiKey: await secret('ANTHROPIC_API_KEY') })
  const res = await client.messages.create({
    model: (await secret('CLAUDE_MODEL')) || 'claude-haiku-5-5',
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  } as Anthropic.MessageCreateParamsNonStreaming)

  await admin.from('ai_usage').insert({
    step_result_id: r.id, model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
  })
  let result: {
    status: 'ok' | 'warn' | 'fail' | 'unclear'
    problems: { check: string; problem: string }[]
    note: string
    items?: { key: string; seen: number }[]
  }
  if (res.stop_reason === 'refusal') {
    result = { status: 'unclear', problems: [], note: 'AI bu fotoğrafı değerlendirmedi; süpervizör bakacak.' }
  } else {
    const text = res.content.find((b) => b.type === 'text')
    result = JSON.parse(text && text.type === 'text' ? text.text : '{}')
    if (!['ok', 'warn', 'fail', 'unclear'].includes(result.status)) throw new Error('AI yanıtı okunamadı')
  }
  await admin.from('step_results').update({ ai_status: result.status, ai_result: { ...result, model: res.model } }).eq('id', r.id)
  const counts = (result.items ?? []).filter((i) => i.seen >= 0 && items.some((x) => x.item_key === i.key))
  if (counts.length) await admin.rpc('apply_inventory', { p_step_result: r.id, p_counts: counts })
  await admin.rpc('refresh_cleaning_ai', { p_cleaning: r.cleaning_id })
  return result
}

// Kuyruktan alır (aynı fotoğrafı iki çağrı birden işlemesin diye silerek), hata olursa deneme sayısıyla geri koyar
async function claimAndAnalyze(id: string) {
  const { data: claimed } = await admin.from('ai_queue').delete().eq('step_result_id', id).select('tries')
  if (!claimed?.length) return { skipped: true }
  try {
    return { result: await analyze(id) }
  } catch (e) {
    const tries = (claimed[0].tries ?? 0) + 1
    const msg = e instanceof Error ? e.message : String(e)
    console.error('analiz hatası', id, msg)
    if (tries < MAX_TRIES) await admin.from('ai_queue').insert({ step_result_id: id, tries, last_error: msg.slice(0, 500) })
    else {
      await admin.from('step_results').update({
        ai_status: 'unclear', ai_result: { status: 'unclear', problems: [], note: 'AI kontrolü yapılamadı; süpervizör bakacak.', error: msg.slice(0, 300) },
      }).eq('id', id)
    }
    return { error: msg }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Yalnızca POST' }, 405)
  if (!(await secret('ANTHROPIC_API_KEY'))) return json({ error: 'AI anahtarı henüz girilmedi.', code: 'no_ai' }, 503)

  // Dakikalık tarama
  const cronKey = req.headers.get('x-cron-key')
  if (cronKey) {
    const { data: ok } = await admin.rpc('check_cron_key', { k: cronKey })
    if (!ok) return json({ error: 'Yetkisiz' }, 401)
    const started = Date.now()
    const { data: queue } = await admin.from('ai_queue').select('step_result_id').lt('tries', MAX_TRIES)
      .order('enqueued_at').limit(20)
    let done = 0
    for (const q of queue ?? []) {
      if (Date.now() - started > 100_000) break
      await claimAndAnalyze(q.step_result_id)
      done++
    }
    return json({ done })
  }

  // HK fotoğrafı yükledikten hemen sonra: sadece görebildiği (RLS) fotoğraf için
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Oturum yok.' }, 401)
  const userDb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false },
  })
  const body = await req.json().catch(() => ({}))
  const { data: sr } = await userDb.from('step_results').select('id, ai_status, ai_result').eq('id', body.step_result_id).maybeSingle()
  if (!sr) return json({ error: 'Kayıt bulunamadı.' }, 404)
  const out = await claimAndAnalyze(sr.id)
  if ('skipped' in out) return json({ ai_status: sr.ai_status, ai_result: sr.ai_result })
  if ('error' in out) return json({ error: 'AI kontrolü şu an yapılamadı; birazdan tekrar denenecek.' }, 502)
  return json({ ai_status: out.result?.status, ai_result: out.result })
})
