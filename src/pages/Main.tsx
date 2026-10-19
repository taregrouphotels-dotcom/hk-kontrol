import { useEffect, useState } from 'react'
import { supabase, type Profile } from '../lib/supabase'
import { regionLabel, roleLabel } from '../lib/format'
import Today from './Today'
import Staff from './Staff'
import DataImport from './DataImport'
import RoomPage from './RoomPage'
import Capture from './Capture'
import Review from './Review'
import CleaningDetail from './CleaningDetail'
import QueueBar from '../components/QueueBar'
import { pendingOps } from '../lib/queue'

interface Tab {
  path: string
  label: string
  roles: Profile['role'][]
}

// Alt menü; adres çubuğundaki #/... ile eşleşir, geri tuşu çalışır
const TABS: Tab[] = [
  { path: '', label: 'Bugün', roles: ['hk', 'supervisor', 'admin'] },
  { path: 'onay', label: 'Onay', roles: ['admin', 'supervisor'] },
  { path: 'personel', label: 'Personel', roles: ['admin', 'supervisor'] },
  { path: 'veri', label: 'Veri', roles: ['admin'] },
]

function currentPath(): string {
  return window.location.hash.replace(/^#\/?/, '')
}

export default function Main({ profile }: { profile: Profile }) {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    const onHash = () => setPath(currentPath())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const tabs = TABS.filter((t) => t.roles.includes(profile.role))
  const active = tabs.find((t) => t.path === path) ?? tabs[0]
  // Sekme dışı sayfalar: oda (#/oda/<id>), kapı QR'ı (#/qr/<token>), kontrol çekimi (#/cek/<temizlik id>),
  // kontrol kaydı (#/kayit/<temizlik id>)
  const [route, arg] = path.split('/')
  const page = ['oda', 'qr', 'cek', 'kayit'].includes(route) && arg ? route : null

  async function logout() {
    // Gönderilmemiş fotoğraf/işlem varsa uyar: çıkışta cihazdaki kuyruk silinmez ama başka kullanıcı giremez (spec 4)
    const n = (await pendingOps()).length
    const msg = n
      ? `Bu telefonda henüz gönderilmemiş ${n} işlem var. Çıkış yaparsanız internet gelince gönderilemez. Yine de çıkılsın mı?`
      : 'Çıkış yapılsın mı?'
    if (window.confirm(msg)) supabase.auth.signOut()
  }

  const subtitle = [roleLabel[profile.role], profile.region && regionLabel[profile.region]].filter(Boolean).join(' · ')

  return (
    <div className={`mx-auto min-h-screen max-w-2xl ${tabs.length > 1 ? 'pb-24' : 'pb-10'}`}>
      <header className="sticky top-0 z-10 flex items-center justify-between bg-brand px-4 py-3 text-white shadow">
        <div>
          <div className="font-semibold">{profile.full_name}</div>
          <div className="text-xs text-white/70">{subtitle}</div>
        </div>
        <button onClick={logout} className="rounded-lg px-3 py-2 text-sm text-white/90 active:bg-white/10">
          Çıkış
        </button>
      </header>

      <QueueBar />

      {page === 'oda' && <RoomPage key={arg} roomId={arg} me={profile} />}
      {page === 'qr' && <QrRoom token={arg} me={profile} />}
      {page === 'cek' && <Capture key={arg} cleaningId={arg} me={profile} />}
      {page === 'kayit' && profile.role !== 'hk' && <CleaningDetail key={arg} cleaningId={arg} />}
      {!page && active.path === '' && <Today me={profile} />}
      {!page && active.path === 'onay' && <Review />}
      {!page && active.path === 'personel' && <Staff me={profile} />}
      {!page && active.path === 'veri' && <DataImport />}

      {tabs.length > 1 && !page && (
        <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex max-w-2xl">
            {tabs.map((t) => (
              <a
                key={t.path}
                href={`#/${t.path}`}
                className={`flex-1 py-4 text-center text-sm font-semibold ${
                  t === active ? 'text-brand' : 'text-slate-400'
                }`}
              >
                {t.label}
              </a>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

// Kapıdaki QR telefonun kendi kamerasıyla okutulunca uygulama #/qr/<token> ile açılır → ilgili oda sayfası
function QrRoom({ token, me }: { token: string; me: Profile }) {
  const [roomId, setRoomId] = useState<string | null>()

  useEffect(() => {
    supabase
      .from('rooms')
      .select('id')
      .eq('qr_token', token.toLowerCase())
      .maybeSingle()
      .then(({ data }) => setRoomId(data?.id ?? null))
  }, [token])

  if (roomId === undefined) return <p className="p-4 text-slate-500">Yükleniyor…</p>
  if (roomId === null)
    return <p className="m-4 rounded-xl bg-white p-4 text-slate-600">Bu QR tanınmadı ya da bu oda sizin bölgenizde değil.</p>
  return <RoomPage roomId={roomId} me={me} viaQr={token.toLowerCase()} />
}
