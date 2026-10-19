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
import Records from './Records'
import ReportForm from './ReportForm'
import Notifications from './Notifications'
import Sheet from '../components/Sheet'
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
  { path: 'kayitlar', label: 'Hasar & Eşya', roles: ['hk', 'supervisor', 'admin'] },
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
  // Sekme dışı sayfalar: oda (#/oda/<id>), kapı QR'ı (#/qr/<token>), kontrol çekimi (#/cek/<temizlik id>),
  // kontrol kaydı (#/kayit/<temizlik id>), hasar/eşya bildir (#/bildir/hasar|esya[/<oda id>]), bildirimler (#/bildirim)
  const [route, arg, arg2] = path.split('/')
  const active = tabs.find((t) => t.path === route) ?? tabs[0]
  const page = (['oda', 'qr', 'cek', 'kayit', 'bildir'].includes(route) && arg) || route === 'bildirim' ? route : null
  const [menu, setMenu] = useState(false)
  const unread = useUnread(profile.id)

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
        <div className="flex items-center gap-1">
          <button onClick={() => setMenu(true)} aria-label="Bildir" className="rounded-lg px-3 py-1.5 text-2xl leading-none active:bg-white/10">
            +
          </button>
          <a href="#/bildirim" aria-label="Bildirimler" className="relative rounded-lg px-2.5 py-2 active:bg-white/10">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
            {unread > 0 && (
              <span className="absolute right-0.5 top-0.5 min-w-[1.1rem] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </a>
          <button onClick={logout} className="rounded-lg px-3 py-2 text-sm text-white/90 active:bg-white/10">
            Çıkış
          </button>
        </div>
      </header>
      {menu && (
        <Sheet title="Bildir" onClose={() => setMenu(false)}>
          <div className="space-y-3">
            {(['hasar', 'esya'] as const).map((k) => (
              <a
                key={k}
                onClick={() => setMenu(false)}
                href={`#/bildir/${k}${route === 'oda' && arg ? `/${arg}` : ''}`}
                className="block w-full rounded-xl bg-white py-4 text-center text-base font-semibold text-slate-800 shadow-sm"
              >
                {k === 'hasar' ? 'Hasar bildir' : 'Eşya buldum'}
              </a>
            ))}
          </div>
        </Sheet>
      )}

      <QueueBar />

      {page === 'oda' && <RoomPage key={arg} roomId={arg} me={profile} />}
      {page === 'qr' && <QrRoom token={arg} me={profile} />}
      {page === 'cek' && <Capture key={arg} cleaningId={arg} me={profile} />}
      {page === 'kayit' && profile.role !== 'hk' && <CleaningDetail key={arg} cleaningId={arg} />}
      {page === 'bildir' && (arg === 'hasar' || arg === 'esya') && <ReportForm key={path} kind={arg} roomId={arg2} me={profile} />}
      {page === 'bildirim' && <Notifications me={profile} />}
      {!page && active.path === '' && <Today me={profile} />}
      {!page && active.path === 'kayitlar' && <Records me={profile} kind={arg === 'esya' ? 'esya' : 'hasar'} openId={arg2} />}
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

// Okunmamış bildirim sayısı: dakikada bir ve bildirim sayfasında okununca
function useUnread(userId: string): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const load = () =>
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null)
        .then(({ count }) => setN(count ?? 0))
    load()
    const t = setInterval(load, 60_000)
    window.addEventListener('hk-notifications', load)
    return () => {
      clearInterval(t)
      window.removeEventListener('hk-notifications', load)
    }
  }, [userId])
  return n
}
