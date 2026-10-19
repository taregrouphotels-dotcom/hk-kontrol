import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { errorText, supabase, type Profile } from './lib/supabase'
import Login from './pages/Login'
import Consent from './pages/Consent'
import Home from './pages/Home'

type State =
  | { kind: 'loading' }
  | { kind: 'signedOut'; message?: string }
  | { kind: 'consent'; profile: Profile }
  | { kind: 'ready'; profile: Profile }

// Oturumdaki kullanıcının profilini getirir. Profili yoksa ve ilk admin e-postasıysa admin profilini alır.
async function loadProfile(session: Session): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
  if (error) throw error
  if (data) return data as Profile
  const claimed = await supabase.rpc('claim_first_admin')
  if (claimed.error) throw claimed.error
  return claimed.data as Profile
}

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const resolve = useCallback(async (session: Session | null) => {
    if (!session) {
      setState((s) => (s.kind === 'signedOut' ? s : { kind: 'signedOut' }))
      return
    }
    try {
      const profile = await loadProfile(session)
      if (!profile.active) {
        await supabase.auth.signOut()
        setState({ kind: 'signedOut', message: 'Hesabınız pasif. Süpervizörünüze başvurun.' })
        return
      }
      setState(profile.consent_at ? { kind: 'ready', profile } : { kind: 'consent', profile })
    } catch (e) {
      const msg = errorText(e)
      await supabase.auth.signOut()
      setState({
        kind: 'signedOut',
        message: /tanımlı değil/.test(msg) ? 'Hesabınız uygulamada tanımlı değil. Yöneticinize başvurun.' : msg,
      })
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => resolve(data.session))
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Token yenilemesi profili yeniden yüklemeyi gerektirmez
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') resolve(session)
    })
    return () => data.subscription.unsubscribe()
  }, [resolve])

  switch (state.kind) {
    case 'loading':
      return <div className="flex min-h-screen items-center justify-center text-slate-500">Yükleniyor…</div>
    case 'signedOut':
      return <Login message={state.message} />
    case 'consent':
      return (
        <Consent
          profile={state.profile}
          onAccepted={(consent_at) => setState({ kind: 'ready', profile: { ...state.profile, consent_at } })}
        />
      )
    case 'ready':
      return <Home profile={state.profile} />
  }
}
