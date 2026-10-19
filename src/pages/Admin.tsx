import { useEffect, useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import DataImport, { AiKey, StorageTest } from './DataImport'
import StepEditor from './StepEditor'

// Yönetim (admin): Ayarlar · Adımlar · Excel. Adres: #/veri[/ayarlar|adimlar|excel]
export default function Admin({ seg }: { seg?: string }) {
  const tab = seg === 'adimlar' || seg === 'excel' ? seg : 'ayarlar'
  const link = (k: string, label: string) => (
    <a href={`#/veri/${k}`} className={`flex-1 rounded-lg py-2 text-center text-sm font-semibold ${tab === k ? 'bg-white text-brand shadow-sm' : 'text-slate-500'}`}>
      {label}
    </a>
  )
  return (
    <div>
      <div className="mx-4 mt-4 flex gap-1 rounded-xl bg-slate-200 p-1">
        {link('ayarlar', 'Ayarlar')}
        {link('adimlar', 'Adımlar')}
        {link('excel', 'Excel')}
      </div>
      {tab === 'ayarlar' && <Settings />}
      {tab === 'adimlar' && <StepEditor />}
      {tab === 'excel' && <DataImport />}
    </div>
  )
}

const istanbulDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d)

interface Stats {
  photos: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  by_status: Record<string, number>
  flagged: number
  false_alarms: number
  retakes: number
  top_steps: { step: string; n: number }[]
}

function Settings() {
  const [manual, setManual] = useState<boolean>()
  const [days, setDays] = useState<number>()
  const [msg, setMsg] = useState<string>()
  const [from, setFrom] = useState(() => istanbulDay().slice(0, 8) + '01')
  const [to, setTo] = useState(() => istanbulDay())
  const [stats, setStats] = useState<Stats>()

  useEffect(() => {
    supabase
      .from('settings')
      .select('key, value')
      .in('key', ['manual_approval_required', 'media_retention_days'])
      .then(({ data }) => {
        for (const r of data ?? []) {
          if (r.key === 'manual_approval_required') setManual(r.value === true)
          if (r.key === 'media_retention_days') setDays(Number(r.value))
        }
      })
  }, [])

  useEffect(() => {
    supabase.rpc('ai_stats', { p_from: from, p_to: to }).then(({ data }) => setStats(data as Stats))
  }, [from, to])

  async function save(key: string, value: unknown) {
    setMsg(undefined)
    const { error } = await supabase.from('settings').update({ value }).eq('key', key)
    setMsg(error ? errorText(error) : 'Kaydedildi.')
  }

  const judged = stats ? Object.entries(stats.by_status).reduce((a, [, n]) => a + n, 0) : 0
  const pct = (n: number, d: number) => (d ? `%${Math.round((n / d) * 100)}` : '—')

  return (
    <div className="space-y-4 px-4 pb-8 pt-4">
      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-800">Onay</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-700">
            <b>Otomatik onay</b>: tüm adımlar AI'dan geçerse kayıt kendiliğinden onaylanır. Kapalıyken her kayıt süpervizöre gider.
          </span>
          <input
            type="checkbox"
            className="h-6 w-6 shrink-0"
            checked={manual === false}
            disabled={manual === undefined}
            onChange={(e) => {
              setManual(!e.target.checked)
              save('manual_approval_required', !e.target.checked)
            }}
          />
        </label>
      </section>

      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-800">Saklama</h2>
        <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
          Temizlik fotoğrafları kaç gün saklansın? (şikayetli kayıtlar ve referanslar silinmez)
          <input
            type="number"
            min={7}
            max={365}
            value={days ?? ''}
            onChange={(e) => setDays(Number(e.target.value))}
            onBlur={() => days && days >= 7 && save('media_retention_days', days)}
            className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-right"
          />
        </label>
        <p className="text-xs text-slate-500">Hasar fotoğrafları kapandıktan 90 gün, kayıp eşya fotoğrafları 1 yıl sonra silinir. Silme her gece 03:30'da çalışır.</p>
      </section>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-800">AI kontrolü: maliyet ve doğruluk</h2>
        <div className="flex gap-2 text-xs text-slate-500">
          <label className="flex-1">
            Başlangıç
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="flex-1">
            Bitiş
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
          </label>
        </div>
        {stats && (
          <>
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                ['Fotoğraf', String(stats.photos)],
                ['Maliyet', `$${Number(stats.cost_usd).toFixed(2)}`],
                ['Sorun buldu', pct(stats.flagged, judged)],
                ['Yanlış alarm', pct(stats.false_alarms, stats.flagged)],
                ['Tekrar çekim', String(stats.retakes)],
                ['Foto başı', stats.photos ? `${((Number(stats.cost_usd) / stats.photos) * 100).toFixed(2)}¢` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-slate-50 p-2">
                  <div className="text-lg font-bold text-slate-800">{v}</div>
                  <div className="text-xs text-slate-500">{k}</div>
                </div>
              ))}
            </div>
            {stats.top_steps.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-700">En çok sorun çıkan adımlar</p>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                  {stats.top_steps.map((s) => (
                    <li key={s.step} className="flex justify-between gap-2">
                      <span className="truncate">{s.step}</span>
                      <b>{s.n}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <AiKey />
      <StorageTest />
    </div>
  )
}
