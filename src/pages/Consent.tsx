import { useEffect, useState } from 'react'
import { errorText, supabase, type Profile } from '../lib/supabase'

// İlk girişte KVKK aydınlatma metni ve açık rıza (spec 4). Onaylamadan uygulama kullanılamaz.
export default function Consent({ profile, onAccepted }: { profile: Profile; onAccepted: (at: string) => void }) {
  const [text, setText] = useState<string>()
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('key', 'kvkk_text')
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(errorText(error))
        else setText(typeof data?.value === 'string' ? data.value : '')
      })
  }, [])

  async function accept() {
    setBusy(true)
    setError(undefined)
    const { data, error } = await supabase.rpc('give_consent')
    setBusy(false)
    if (error) setError(errorText(error))
    else onAccepted(data as string)
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-6">
      <h1 className="mb-1 text-xl font-bold text-brand">Kişisel verilerin korunması</h1>
      <p className="mb-4 text-sm text-slate-500">Merhaba {profile.full_name}. Devam etmeden önce lütfen okuyun.</p>

      <div className="mb-4 flex-1 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white p-4 text-[15px] leading-relaxed text-slate-700 shadow-sm">
        {text ?? 'Yükleniyor…'}
      </div>

      <label className="mb-4 flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm">
        <input
          type="checkbox"
          className="mt-1 h-6 w-6 shrink-0 accent-brand"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span className="text-[15px] text-slate-700">
          Aydınlatma metnini okudum. Temizlik kontrolü için fotoğraf ve video çekilmesine ve bu kayıtların işlenmesine
          açık rıza veriyorum.
        </span>
      </label>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <button
        onClick={accept}
        disabled={!checked || busy || text === undefined}
        className="mb-3 w-full rounded-xl bg-brand py-4 text-lg font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Kaydediliyor…' : 'Onaylıyorum'}
      </button>
      <button onClick={() => supabase.auth.signOut()} className="w-full py-3 text-slate-500">
        Onaylamıyorum, çıkış yap
      </button>
    </div>
  )
}
