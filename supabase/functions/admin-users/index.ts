// Personel yönetimi: kullanıcı açma, bilgi güncelleme, PIN/şifre sıfırlama, pasife alma.
// Admin her şeyi yapar. Süpervizör sadece kendi bölgesinde HK hesabı açar ve HK PIN'i sıfırlar.
// Sadece aktif admin/süpervizör çağırabilir. Supabase Auth'ta kullanıcı açmak service role ister; bu anahtar sadece burada.
// HK: kullaniciadi@hk.tare.local + 6 haneli PIN. Süpervizör/admin: e-posta + en az 8 karakter şifre.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

type Role = 'hk' | 'supervisor' | 'admin'
type Region = 'istanbul' | 'izmir'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

class UserError extends Error {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const ROLES: Role[] = ['hk', 'supervisor', 'admin']
const REGIONS: Region[] = ['istanbul', 'izmir']

function checkRoleRegion(role: unknown, region: unknown): { role: Role; region: Region | null } {
  if (!ROLES.includes(role as Role)) throw new UserError('Geçersiz rol.')
  if (role === 'admin') return { role, region: null }
  if (!REGIONS.includes(region as Region)) throw new UserError('HK ve süpervizör için bölge seçilmeli.')
  return { role: role as Role, region: region as Region }
}

function checkSecret(role: Role, secret: unknown): string {
  const s = String(secret ?? '')
  if (role === 'hk') {
    if (!/^\d{6}$/.test(s)) throw new UserError('PIN 6 haneli rakam olmalı.')
  } else if (s.length < 8) {
    throw new UserError('Şifre en az 8 karakter olmalı.')
  }
  return s
}

function checkName(name: unknown): string {
  const n = String(name ?? '').trim()
  if (n.length < 2) throw new UserError('Ad soyad girilmeli.')
  return n
}

async function getProfile(id: string) {
  const { data, error } = await admin.from('profiles').select('id, role, region, active, username').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new UserError('Kullanıcı bulunamadı.')
  return data as { id: string; role: Role; region: Region | null; active: boolean; username: string | null }
}

interface Caller {
  id: string
  role: Role
  region: Region | null
}

// Süpervizör sadece kendi bölgesindeki HK'lar için
function checkSupervisorScope(me: Caller, role: Role, region: Region | null) {
  if (me.role === 'supervisor' && (role !== 'hk' || region !== me.region)) {
    throw new UserError('Süpervizör sadece kendi bölgesindeki HK hesaplarını yönetebilir.')
  }
}

async function create(body: Record<string, unknown>, me: Caller) {
  const full_name = checkName(body.full_name)
  const { role, region } = checkRoleRegion(body.role, body.region)
  checkSupervisorScope(me, role, region)
  const secret = checkSecret(role, body.secret)
  let email: string
  let username: string | null = null
  if (role === 'hk') {
    username = String(body.username ?? '').trim().toLowerCase()
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      throw new UserError('Kullanıcı adı 3–30 karakter olmalı; sadece küçük harf, rakam, nokta, tire (Türkçe karakter yok).')
    }
    const { data } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
    if (data) throw new UserError('Bu kullanıcı adı kullanılıyor.')
    email = `${username}@hk.tare.local`
  } else {
    email = String(body.email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('Geçerli bir e-posta girin.')
  }

  const { data: created, error } = await admin.auth.admin.createUser({ email, password: secret, email_confirm: true })
  if (error) {
    if (/already|registered|exists/i.test(error.message)) throw new UserError('Bu e-posta / kullanıcı adıyla bir hesap zaten var.')
    throw error
  }
  const id = created.user.id
  const { error: pErr } = await admin.from('profiles').insert({ id, full_name, username, role, region })
  if (pErr) {
    await admin.auth.admin.deleteUser(id)
    throw pErr
  }
  return { id, username, email: role === 'hk' ? null : email }
}

async function update(body: Record<string, unknown>, me: string) {
  const target = await getProfile(String(body.id))
  const full_name = checkName(body.full_name)
  const { role, region } = checkRoleRegion(body.role, body.region)
  // HK kullanıcı adı + PIN ile, diğerleri e-posta ile girer; bu ikisi arasında rol değişmez
  if ((target.role === 'hk') !== (role === 'hk')) {
    throw new UserError('HK ile süpervizör/admin arasında rol değiştirilemez; yeni hesap açın.')
  }
  if (target.id === me && role !== 'admin') throw new UserError('Kendi admin yetkinizi kaldıramazsınız.')
  const { error } = await admin.from('profiles').update({ full_name, role, region }).eq('id', target.id)
  if (error) throw error
  return {}
}

async function setActive(body: Record<string, unknown>, me: string) {
  const target = await getProfile(String(body.id))
  const active = body.active === true
  if (target.id === me && !active) throw new UserError('Kendinizi pasife alamazsınız.')
  // Pasif kullanıcı giriş yapamaz (ban), açık oturumu da RLS'te hiçbir şey göremez (profiles.active)
  const { error: aErr } = await admin.auth.admin.updateUserById(target.id, { ban_duration: active ? 'none' : '876000h' })
  if (aErr) throw aErr
  const { error } = await admin.from('profiles').update({ active }).eq('id', target.id)
  if (error) throw error
  return {}
}

async function resetSecret(body: Record<string, unknown>, me: Caller) {
  const target = await getProfile(String(body.id))
  checkSupervisorScope(me, target.role, target.region)
  const secret = checkSecret(target.role, body.secret)
  const { error } = await admin.auth.admin.updateUserById(target.id, { password: secret })
  if (error) throw error
  return {}
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Yalnızca POST' }, 405)

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Oturum yok.' }, 401)
  const { data: auth, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !auth.user) return json({ error: 'Oturum geçersiz. Tekrar giriş yapın.' }, 401)
  const { data: profile } = await admin.from('profiles').select('role, region, active').eq('id', auth.user.id).maybeSingle()
  if (!profile || !profile.active || !['admin', 'supervisor'].includes(profile.role)) {
    return json({ error: 'Bu işlem için yönetici yetkisi gerekir.' }, 403)
  }
  const me: Caller = { id: auth.user.id, role: profile.role, region: profile.region }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek.' }, 400)
  }

  try {
    switch (body.action) {
      case 'create':
        return json(await create(body, me))
      case 'reset_secret':
        return json(await resetSecret(body, me))
      case 'update':
      case 'set_active':
        if (me.role !== 'admin') return json({ error: 'Bu işlem için admin yetkisi gerekir.' }, 403)
        return json(body.action === 'update' ? await update(body, me.id) : await setActive(body, me.id))
      default:
        return json({ error: 'Bilinmeyen işlem.' }, 400)
    }
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400)
    console.error(e)
    return json({ error: 'Sunucu hatası: ' + (e instanceof Error ? e.message : String(e)) }, 500)
  }
})
