import { useState, type FormEvent } from 'react'
import { errorText, hkEmail, supabase } from '../lib/supabase'

type Mode = 'hk' | 'manager'

export default function Login({ message }: { message?: string }) {
  const [mode, setMode] = useState<Mode>('hk')
  const [user, setUser] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(message)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    if (mode === 'hk' && !/^\d{6}$/.test(secret)) {
      setError('PIN 6 haneli olmalı.')
      return
    }
    setBusy(true)
    const email = mode === 'hk' ? hkEmail(user) : user.trim()
    const { error } = await supabase.auth.signInWithPassword({ email, password: secret })
    setBusy(false)
    if (error) setError(errorText(error))
  }

  function switchMode(m: Mode) {
    setMode(m)
    setUser('')
    setSecret('')
    setError(undefined)
  }

  const input =
    'w-full rounded-xl border border-slate-300 bg-white px-4 py-4 text-lg outline-none focus:border-brand focus:ring-2 focus:ring-brand/30'

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <img src="/icon-192.png" alt="" className="mx-auto mb-3 h-16 w-16 rounded-2xl" />
        <h1 className="text-2xl font-bold text-brand">HK Kontrol</h1>
        <p className="text-sm text-slate-500">Tare Otelleri</p>
      </div>

      <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-200 p-1 text-base font-medium">
        {(['hk', 'manager'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={`rounded-lg py-3 ${mode === m ? 'bg-white text-brand shadow' : 'text-slate-600'}`}
          >
            {m === 'hk' ? 'Personel' : 'Yönetici'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === 'hk' ? (
          <>
            <input
              className={input}
              placeholder="Kullanıcı adı"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              required
            />
            <input
              className={`${input} tracking-[0.5em]`}
              placeholder="PIN (6 hane)"
              type="password"
              inputMode="numeric"
              pattern="\d*"
              maxLength={6}
              autoComplete="current-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value.replace(/\D/g, ''))}
              required
            />
          </>
        ) : (
          <>
            <input
              className={input}
              placeholder="E-posta"
              type="email"
              autoCapitalize="none"
              autoComplete="email"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              required
            />
            <input
              className={input}
              placeholder="Şifre"
              type="password"
              autoComplete="current-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
            />
          </>
        )}

        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-brand py-4 text-lg font-semibold text-white active:bg-brand-light disabled:opacity-60"
        >
          {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
      </form>

      {mode === 'hk' && (
        <p className="mt-6 text-center text-sm text-slate-500">PIN'inizi unuttuysanız süpervizörünüz sıfırlayabilir.</p>
      )}
    </div>
  )
}
