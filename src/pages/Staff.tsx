import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { callFunction } from '../lib/api'
import { errorText, supabase, type Profile, type Region, type Role } from '../lib/supabase'
import { regionLabel, roleLabel } from '../lib/format'

// Personel yönetimi. Admin: liste, yeni personel, düzenleme, PIN/şifre sıfırlama, pasife alma.
// Süpervizör: kendi bölgesindeki HK'lar; sadece hesap açma ve PIN sıfırlama.
// Kullanıcı açma ve şifre işlemleri admin-users Edge Function'ında (service role tarayıcıya gitmez).

const input =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/30'
const primary = 'w-full rounded-xl bg-brand py-4 text-base font-semibold text-white disabled:opacity-50'

function randomPin(): string {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(a[0] % 1_000_000).padStart(6, '0')
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-slate-100">
      <div className="flex items-center justify-between bg-brand px-4 py-3 text-white">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm active:bg-white/10">
          Kapat
        </button>
      </div>
      <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </div>
  )
}

function RoleRegionFields({
  role,
  region,
  setRole,
  setRegion,
  roles,
}: {
  role: Role
  region: Region | ''
  setRole: (r: Role) => void
  setRegion: (r: Region | '') => void
  roles: Role[]
}) {
  return (
    <>
      <label className="block text-sm font-medium text-slate-600">Rol</label>
      <div className="grid grid-cols-3 gap-2">
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`rounded-xl border py-3 text-sm font-semibold ${
              role === r ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-600'
            }`}
          >
            {roleLabel[r]}
          </button>
        ))}
      </div>
      {role !== 'admin' && (
        <>
          <label className="block text-sm font-medium text-slate-600">Bölge</label>
          <div className="grid grid-cols-2 gap-2">
            {(['istanbul', 'izmir'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRegion(r)}
                className={`rounded-xl border py-3 text-sm font-semibold ${
                  region === r ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-600'
                }`}
              >
                {regionLabel[r]}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function SecretField({ role, value, onChange }: { role: Role; value: string; onChange: (v: string) => void }) {
  if (role === 'hk') {
    return (
      <div className="flex gap-2">
        <input
          className={`${input} ${value ? 'tracking-[0.4em]' : ''}`}
          placeholder="PIN (6 hane)"
          inputMode="numeric"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          required
        />
        <button
          type="button"
          onClick={() => onChange(randomPin())}
          className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-brand"
        >
          Rastgele
        </button>
      </div>
    )
  }
  return (
    <input
      className={input}
      placeholder="Şifre (en az 8 karakter)"
      type="text"
      autoComplete="new-password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required
    />
  )
}

// Yeni hesabın giriş bilgisi bir kez gösterilir; admin personele iletir
function Credentials({ lines, onDone }: { lines: [string, string][]; onDone: () => void }) {
  const text = lines.map(([k, v]) => `${k}: ${v}`).join('\n')
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-green-50 p-4 text-green-800">Hesap hazır. Bu bilgileri personele iletin:</div>
      <div className="space-y-2 rounded-xl bg-white p-4 shadow-sm">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <span className="text-slate-500">{k}</span>
            <span className="select-all font-mono text-lg font-semibold">{v}</span>
          </div>
        ))}
      </div>
      <button
        className="w-full rounded-xl border border-slate-300 bg-white py-3 font-medium text-brand"
        onClick={() => navigator.clipboard?.writeText(text)}
      >
        Kopyala
      </button>
      <button className={primary} onClick={onDone}>
        Tamam
      </button>
    </div>
  )
}

function NewStaff({ me, onClose, onSaved }: { me: Profile; onClose: () => void; onSaved: () => void }) {
  const isSup = me.role === 'supervisor'
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role>('hk')
  const [region, setRegion] = useState<Region | ''>(isSup ? (me.region ?? '') : '')
  const [login, setLogin] = useState('')
  const [secret, setSecret] = useState(randomPin)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<[string, string][]>()

  function changeRole(r: Role) {
    if ((r === 'hk') !== (role === 'hk')) {
      setLogin('')
      setSecret(r === 'hk' ? randomPin() : '')
    }
    setRole(r)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const body = {
        action: 'create',
        full_name: fullName,
        role,
        region: region || null,
        secret,
      }
      const res = await callFunction<{
        username: string | null
        email: string | null
      }>('admin-users', role === 'hk' ? { ...body, username: login } : { ...body, email: login })
      onSaved()
      setDone(
        role === 'hk'
          ? [
              ['Kullanıcı adı', res.username ?? login],
              ['PIN', secret],
            ]
          : [
              ['E-posta', res.email ?? login],
              ['Şifre', secret],
            ],
      )
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Yeni personel" onClose={onClose}>
      {done ? (
        <Credentials lines={done} onDone={onClose} />
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <input
            className={input}
            placeholder="Ad soyad"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          {isSup ? (
            <p className="text-sm text-slate-500">HK · {me.region && regionLabel[me.region]}</p>
          ) : (
            <RoleRegionFields
              role={role}
              region={region}
              setRole={changeRole}
              setRegion={setRegion}
              roles={['hk', 'supervisor', 'admin']}
            />
          )}
          <label className="block text-sm font-medium text-slate-600">Giriş bilgisi</label>
          {role === 'hk' ? (
            <input
              className={input}
              placeholder="Kullanıcı adı (ör. ayse.k)"
              autoCapitalize="none"
              autoCorrect="off"
              value={login}
              onChange={(e) => setLogin(e.target.value.toLowerCase())}
              required
            />
          ) : (
            <input
              className={input}
              placeholder="E-posta"
              type="email"
              autoCapitalize="none"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
            />
          )}
          <SecretField role={role} value={secret} onChange={setSecret} />
          {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <button className={primary} disabled={busy || (role !== 'admin' && !region)}>
            {busy ? 'Kaydediliyor…' : 'Hesabı aç'}
          </button>
        </form>
      )}
    </Sheet>
  )
}

function EditStaff({ person, me, onClose, onSaved }: { person: Profile; me: Profile; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState(person.full_name)
  const [role, setRole] = useState<Role>(person.role)
  const [region, setRegion] = useState<Region | ''>(person.region ?? '')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<[string, string][]>()
  const isMe = person.id === me.id
  const isAdmin = me.role === 'admin'

  async function run(body: Record<string, unknown>, after?: () => void) {
    setBusy(true)
    setError(undefined)
    try {
      await callFunction('admin-users', { id: person.id, ...body })
      onSaved()
      if (after) after()
      else onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Sheet title={person.full_name} onClose={onClose}>
        <Credentials lines={done} onDone={onClose} />
      </Sheet>
    )
  }

  return (
    <Sheet title={person.full_name} onClose={onClose}>
      <div className="space-y-6">
        {isAdmin && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              run({
                action: 'update',
                full_name: fullName,
                role,
                region: region || null,
              })
            }}
          >
            <input className={input} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            {person.username && <p className="text-sm text-slate-500">Kullanıcı adı: {person.username}</p>}
            <RoleRegionFields
              role={role}
              region={region}
              setRole={setRole}
              setRegion={setRegion}
              roles={person.role === 'hk' ? ['hk'] : ['supervisor', 'admin']}
            />
            <button className={primary} disabled={busy || (role !== 'admin' && !region)}>
              Kaydet
            </button>
          </form>
        )}
        {!isAdmin && person.username && <p className="text-sm text-slate-500">Kullanıcı adı: {person.username}</p>}

        <form
          className={`space-y-3 ${isAdmin ? 'border-t border-slate-200 pt-5' : ''}`}
          onSubmit={(e) => {
            e.preventDefault()
            const lines: [string, string][] =
              person.role === 'hk'
                ? [
                    ['Kullanıcı adı', person.username ?? ''],
                    ['PIN', secret],
                  ]
                : [['Şifre', secret]]
            run({ action: 'reset_secret', secret }, () => setDone(lines))
          }}
        >
          <label className="block text-sm font-medium text-slate-600">
            {person.role === 'hk' ? 'PIN sıfırla' : 'Şifre sıfırla'}
          </label>
          <SecretField role={person.role} value={secret} onChange={setSecret} />
          <button
            className="w-full rounded-xl border border-brand bg-white py-3 font-semibold text-brand disabled:opacity-50"
            disabled={busy || !secret}
          >
            {person.role === 'hk' ? 'Yeni PIN’i kaydet' : 'Yeni şifreyi kaydet'}
          </button>
        </form>

        {isAdmin && !isMe && (
          <div className="border-t border-slate-200 pt-5">
            <button
              disabled={busy}
              onClick={() => {
                const msg = person.active
                  ? `${person.full_name} pasife alınsın mı? Giriş yapamaz, kayıtları silinmez.`
                  : `${person.full_name} tekrar aktif edilsin mi?`
                if (window.confirm(msg)) run({ action: 'set_active', active: !person.active })
              }}
              className={`w-full rounded-xl py-3 font-semibold disabled:opacity-50 ${
                person.active ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
              }`}
            >
              {person.active ? 'Pasife al' : 'Aktif et'}
            </button>
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </div>
    </Sheet>
  )
}

export default function Staff({ me }: { me: Profile }) {
  const [people, setPeople] = useState<Profile[]>()
  const [error, setError] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Profile>()
  const [showPassive, setShowPassive] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('full_name')
    if (error) setError(errorText(error))
    else setPeople(data as Profile[])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Süpervizör sadece HK'ları yönetir (RLS zaten kendi bölgesiyle sınırlar)
  const managed = (people ?? []).filter((p) => me.role === 'admin' || p.role === 'hk')
  const visible = managed.filter((p) => showPassive || p.active)
  const passiveCount = managed.filter((p) => !p.active).length
  const order: Role[] = ['admin', 'supervisor', 'hk']

  return (
    <div className="px-4 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">Personel</h1>
        <button onClick={() => setAdding(true)} className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white">
          + Yeni personel
        </button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!people && !error && <p className="text-slate-500">Yükleniyor…</p>}

      {people &&
        order.map((role) => {
          const list = visible.filter((p) => p.role === role)
          if (list.length === 0) return null
          return (
            <div key={role} className="mb-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {roleLabel[role]} ({list.length})
              </div>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm">
                {list.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setEditing(p)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left active:bg-slate-50"
                    >
                      <div>
                        <div className={`font-medium ${p.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                          {p.full_name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {[p.username, p.region && regionLabel[p.region], p.id === me.id && 'siz'].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {!p.active && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">Pasif</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

      {passiveCount > 0 && (
        <button onClick={() => setShowPassive((v) => !v)} className="mb-4 w-full py-2 text-sm text-slate-500">
          {showPassive ? 'Pasifleri gizle' : `Pasifleri göster (${passiveCount})`}
        </button>
      )}

      {adding && <NewStaff me={me} onClose={() => setAdding(false)} onSaved={load} />}
      {editing && <EditStaff person={editing} me={me} onClose={() => setEditing(undefined)} onSaved={load} />}
    </div>
  )
}
