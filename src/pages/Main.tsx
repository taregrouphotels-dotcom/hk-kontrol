import { useEffect, useState } from 'react'
import { supabase, type Profile } from '../lib/supabase'
import { regionLabel, roleLabel } from '../lib/format'
import Today from './Today'
import Staff from './Staff'
import DataImport from './DataImport'

interface Tab {
  path: string
  label: string
  roles: Profile['role'][]
}

// Alt menü; adres çubuğundaki #/... ile eşleşir, geri tuşu çalışır
const TABS: Tab[] = [
  { path: '', label: 'Bugün', roles: ['hk', 'supervisor', 'admin'] },
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

  function logout() {
    // Çevrimdışı kuyruk geldiğinde: bekleyen yükleme varsa burada uyarılacak (spec 4)
    if (window.confirm('Çıkış yapılsın mı?')) supabase.auth.signOut()
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

      {active.path === '' && <Today />}
      {active.path === 'personel' && <Staff me={profile} />}
      {active.path === 'veri' && <DataImport />}

      {tabs.length > 1 && (
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
