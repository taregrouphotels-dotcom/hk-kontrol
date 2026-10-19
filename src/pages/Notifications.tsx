import { useEffect, useState } from 'react'
import { errorText, supabase, type Profile } from '../lib/supabase'
import { fmtDate, fmtTime } from '../lib/format'
import { disablePush, enablePush, pushState, type PushState } from '../lib/push'

// Uygulama içi bildirimler (spec 6): kişinin kendi bildirimleri; dokununca okundu olur ve ilgili kayda gider.
interface Note {
  id: number
  kind: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export default function Notifications({ me }: { me: Profile }) {
  const [rows, setRows] = useState<Note[]>()
  const [error, setError] = useState<string>()
  const [push, setPush] = useState<PushState>()

  useEffect(() => {
    pushState().then(setPush).catch(() => setPush('unsupported'))
  }, [])

  async function togglePush() {
    setError(undefined)
    try {
      setPush(push === 'on' ? await disablePush() : await enablePush(me.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : errorText(e))
    }
  }

  useEffect(() => {
    supabase
      .from('notifications')
      .select('id, kind, title, body, link, read_at, created_at')
      .eq('user_id', me.id)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => (error ? setError(errorText(error)) : setRows(data as Note[])))
  }, [me.id])

  async function open(n: Note) {
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    window.dispatchEvent(new Event('hk-notifications'))
    window.location.hash = n.link ?? '#/'
  }

  async function readAll() {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me.id).is('read_at', null)
    window.dispatchEvent(new Event('hk-notifications'))
    setRows(rows?.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })))
  }

  return (
    <div className="space-y-2 px-4 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">Bildirimler</h1>
        {rows?.some((r) => !r.read_at) && (
          <button onClick={readAll} className="rounded-lg px-3 py-2 text-sm text-brand">
            Hepsini okundu yap
          </button>
        )}
      </div>
      <div className="rounded-xl bg-white p-3 text-sm shadow-sm">
        {push === 'ios-install' && <p>iPhone'da telefona bildirim için: Safari'de Paylaş → "Ana Ekrana Ekle", sonra uygulamayı ana ekrandan açın.</p>}
        {push === 'unsupported' && <p>Bu tarayıcı telefona bildirimi desteklemiyor.</p>}
        {push === 'denied' && <p>Bildirim izni kapalı. Telefon ayarlarından bu uygulamaya bildirim izni verin.</p>}
        {(push === 'on' || push === 'off') && (
          <div className="flex items-center justify-between gap-3">
            <span>{push === 'on' ? 'Telefona bildirim açık' : 'Telefona bildirim kapalı'}</span>
            <button
              onClick={togglePush}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${push === 'on' ? 'border border-slate-300 text-slate-700' : 'bg-brand text-white'}`}
            >
              {push === 'on' ? 'Kapat' : 'Aç'}
            </button>
          </div>
        )}
      </div>
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {rows?.length === 0 && <p className="rounded-xl bg-white p-4 text-slate-600 shadow-sm">Bildirim yok.</p>}
      {rows?.map((n) => (
        <button
          key={n.id}
          onClick={() => open(n)}
          className={`block w-full rounded-xl p-3 text-left shadow-sm ${n.read_at ? 'bg-white text-slate-600' : 'bg-sky-50 text-slate-800'}`}
        >
          <p className={`text-sm ${n.read_at ? '' : 'font-bold'}`}>{n.title}</p>
          {n.body && <p className="text-sm">{n.body}</p>}
          <p className="mt-1 text-xs text-slate-500">
            {fmtDate(n.created_at)} {fmtTime(n.created_at)}
          </p>
        </button>
      ))}
    </div>
  )
}
