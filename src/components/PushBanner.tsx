import { useEffect, useState } from 'react'
import { enablePush, pushState, type PushState } from '../lib/push'
import type { Profile } from '../lib/supabase'

// Bugün ekranında bir kez: telefona bildirim kapalıysa açmayı önerir ("sonra" denirse bu cihazda bir daha sormaz)
export default function PushBanner({ me }: { me: Profile }) {
  const [state, setState] = useState<PushState>()
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('hk-push-ask') === 'no'
    } catch {
      return false
    }
  })

  useEffect(() => {
    pushState().then(setState).catch(() => setState('unsupported'))
  }, [])

  if (hidden || !state || state === 'on' || state === 'unsupported' || state === 'denied') return null
  return (
    <div className="mx-4 mb-2 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
      {state === 'ios-install' ? (
        <p>Telefona bildirim için: Safari'de Paylaş → "Ana Ekrana Ekle", sonra uygulamayı ana ekrandan açın.</p>
      ) : (
        <p>Temizlik talepleri ve onaylar telefonunuza bildirim olarak gelsin mi?</p>
      )}
      <div className="mt-2 flex gap-2">
        {state === 'off' && (
          <button onClick={() => enablePush(me.id).then(setState).catch(() => setState('denied'))} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">
            Bildirimleri aç
          </button>
        )}
        <button
          onClick={() => {
            setHidden(true)
            try {
              localStorage.setItem('hk-push-ask', 'no')
            } catch {
              /* özel pencere */
            }
          }}
          className="rounded-lg px-3 py-1.5 text-xs underline"
        >
          Sonra
        </button>
      </div>
    </div>
  )
}
