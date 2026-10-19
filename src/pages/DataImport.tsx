import { useEffect, useState, type ChangeEvent } from 'react'
import readXlsxFile from 'read-excel-file/browser'
import { errorText, supabase } from '../lib/supabase'
import { callFunction } from '../lib/api'
import { fmtDate, fmtTime } from '../lib/format'
import { parseWorkbook, type ImportPayload, type Issue, type Template } from '../lib/excelImport'

// Excel'den temel veri içe aktarma (spec 3): yükle → önizleme + hata listesi → onayla.
// Tekrar yüklenince günceller, kopya oluşturmaz.

const templates = Object.values(
  import.meta.glob<Template>('../../templates/*.json', { eager: true, import: 'default' }),
)

interface Result {
  errors: Issue[]
  warnings: Issue[]
  counts: Record<string, { total: number; new?: number; skipped?: number; unverified?: number }>
  applied: boolean
}

const LABELS: [string, string][] = [
  ['properties', 'Otel'],
  ['room_types', 'Oda tipi'],
  ['rooms', 'Oda'],
  ['steps', 'Kontrol adımı'],
  ['catalog', 'Katalog kalemi'],
  ['inventory', 'Envanter satırı'],
]

function IssueList({ issues, tone }: { issues: Issue[]; tone: 'error' | 'warning' }) {
  // Sayfaya göre gruplu; aynı mesaj çok tekrarlanıyorsa (ör. "Adet boş") satır numaraları tek satırda
  const bySheet = new Map<string, Map<string, (number | null)[]>>()
  for (const i of issues) {
    const m = bySheet.get(i.sheet) ?? new Map<string, (number | null)[]>()
    m.set(i.message, [...(m.get(i.message) ?? []), i.row])
    bySheet.set(i.sheet, m)
  }
  const color = tone === 'error' ? 'text-red-700' : 'text-amber-800'
  return (
    <div className="space-y-3">
      {[...bySheet].map(([sheet, msgs]) => (
        <div key={sheet}>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{sheet}</div>
          <ul className={`mt-1 space-y-1 text-sm ${color}`}>
            {[...msgs].map(([msg, rows]) => {
              const nums = rows.filter((r): r is number => r !== null)
              return (
                <li key={msg}>
                  {nums.length > 0 && (
                    <span className="font-medium">
                      {nums.length > 8 ? `${nums.length} satır (${nums.slice(0, 8).join(', ')}…)` : `Satır ${nums.join(', ')}`}:{' '}
                    </span>
                  )}
                  {msg}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default function DataImport() {
  const [fileName, setFileName] = useState<string>()
  const [payload, setPayload] = useState<ImportPayload>()
  const [result, setResult] = useState<Result>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [showWarnings, setShowWarnings] = useState(false)

  async function run(p: ImportPayload, apply: boolean): Promise<Result> {
    const { data, error } = await supabase.rpc('import_master_data', { p, p_apply: apply })
    if (error) throw error
    return data as Result
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileName(file.name)
    setPayload(undefined)
    setResult(undefined)
    setError(undefined)
    setShowWarnings(false)
    setBusy('Dosya okunuyor…')
    try {
      const sheets = await readXlsxFile(file)
      const parsed = parseWorkbook(sheets, templates)
      setBusy('Kontrol ediliyor…')
      const res = await run(parsed.payload, false)
      // Biçim hataları (tarayıcıda bulunan) veritabanı hatalarının önüne
      setResult({ ...res, errors: [...parsed.issues, ...res.errors] })
      setPayload(parsed.payload)
    } catch (err) {
      setError(/zip|xlsx|spreadsheet/i.test(String(err)) ? 'Dosya okunamadı. Excel (.xlsx) dosyası seçin.' : errorText(err))
    } finally {
      setBusy(undefined)
    }
  }

  async function apply() {
    if (!payload) return
    setBusy('İçe aktarılıyor…')
    setError(undefined)
    try {
      setResult(await run(payload, true))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(undefined)
    }
  }

  const canApply = result && !result.applied && result.errors.length === 0

  return (
    <div className="space-y-4 px-4 pt-4">
      <h1 className="text-lg font-bold text-slate-800">Excel'den içe aktar</h1>
      <p className="text-sm text-slate-600">
        <b>HK_Veri_Toplama.xlsx</b> dosyasını seçin: oteller, oda tipleri, odalar, kontrol adımları, kalem kataloğu ve
        envanter yüklenir. Önce kontrol edilir, onaylarsanız kaydedilir. Tekrar yüklemek kayıtları günceller, kopya
        oluşturmaz.
      </p>

      <label
        className={`block w-full rounded-xl border-2 border-dashed border-brand/40 bg-white py-6 text-center font-semibold text-brand ${
          busy ? 'pointer-events-none opacity-50' : 'active:bg-slate-50'
        }`}
      >
        {busy ?? (fileName ? `${fileName} · başka dosya seç` : 'Excel dosyası seç')}
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={pick} />
      </label>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {result && (
        <>
          {result.applied ? (
            <div className="rounded-xl bg-green-50 p-4 text-green-800">
              İçe aktarıldı. Odalar Bugün ekranında görünür.
            </div>
          ) : result.errors.length > 0 ? (
            <div className="rounded-xl bg-red-50 p-4 text-red-800">
              {result.errors.length} hata var; düzeltip dosyayı tekrar seçin. Hiçbir şey kaydedilmedi.
            </div>
          ) : (
            <div className="rounded-xl bg-blue-50 p-4 text-blue-900">Dosya hatasız. Kontrol edip “İçe aktar”a basın.</div>
          )}

          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {LABELS.map(([k, label]) => {
                  const c = result.counts[k]
                  if (!c) return null
                  const extra = [
                    c.new !== undefined && `${c.new} yeni`,
                    c.skipped ? `${c.skipped} adedi boş, atlanacak` : null,
                    c.unverified ? `${c.unverified} doğrulanmamış` : null,
                  ].filter(Boolean)
                  return (
                    <tr key={k}>
                      <td className="px-4 py-3 text-slate-600">{label}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-semibold text-slate-800">{c.total}</span>
                        {extra.length > 0 && <div className="text-xs text-slate-500">{extra.join(' · ')}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="mb-2 font-semibold text-red-700">Hatalar ({result.errors.length})</h2>
              <IssueList issues={result.errors} tone="error" />
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <button onClick={() => setShowWarnings((v) => !v)} className="flex w-full justify-between font-semibold text-amber-800">
                <span>Uyarılar ({result.warnings.length})</span>
                <span>{showWarnings ? 'Gizle' : 'Göster'}</span>
              </button>
              {showWarnings && (
                <div className="mt-3">
                  <IssueList issues={result.warnings} tone="warning" />
                </div>
              )}
            </div>
          )}

          {canApply && (
            <button onClick={apply} disabled={!!busy} className="w-full rounded-xl bg-brand py-4 text-base font-semibold text-white disabled:opacity-50">
              {busy ?? 'İçe aktar'}
            </button>
          )}
        </>
      )}

      <StorageTest />
      <AiKey />
    </div>
  )
}

// Fotoğraf deposu (R2) testi: sunucu anahtarları, sonra bu tarayıcıdan yükleme/okuma (CORS)
function StorageTest() {
  const [state, setState] = useState<{ busy?: boolean; ok?: string; error?: string }>({})

  async function test() {
    setState({ busy: true })
    try {
      const t = await callFunction<{ key: string; put_url: string; get_url: string }>('media-sign', { action: 'selftest' })
      const put = await fetch(t.put_url, { method: 'PUT', body: 'ok', headers: { 'Content-Type': 'text/plain' } }).catch(() => null)
      if (!put?.ok) throw new Error(`Sunucu tarafı tamam, ama tarayıcıdan yükleme engellendi${put ? ` (${put.status})` : ''}. R2 CORS ayarını kontrol edin.`)
      const get = await fetch(t.get_url).catch(() => null)
      if (!get?.ok) throw new Error('Yükleme tamam, ama tarayıcıdan okuma engellendi. R2 CORS ayarında GET olmalı.')
      await callFunction('media-sign', { action: 'selftest_cleanup', key: t.key }).catch(() => {})
      setState({ ok: 'Fotoğraf deposu çalışıyor: yükleme ve görüntüleme tamam.' })
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : errorText(e) })
    }
  }

  return (
    <div className="mt-6 space-y-2 border-t border-slate-200 pt-4">
      <h2 className="font-semibold text-slate-800">Fotoğraf deposu</h2>
      <button onClick={test} disabled={state.busy} className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-brand shadow-sm disabled:opacity-50">
        {state.busy ? 'Deneniyor…' : 'Depoyu test et'}
      </button>
      {state.ok && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{state.ok}</p>}
      {state.error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
    </div>
  )
}


// AI anahtarı (karar 20): admin girer, değer geri okunamaz; sadece ne zaman girildiği görünür
function AiKey() {
  const [at, setAt] = useState<string | null>()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>()

  const load = () =>
    supabase.rpc('app_secret_status').then(({ data }) => {
      const row = (data as { name: string; updated_at: string }[] | null)?.find((r) => r.name === 'ANTHROPIC_API_KEY')
      setAt(row?.updated_at ?? null)
    })

  useEffect(() => {
    load()
  }, [])

  async function save() {
    setBusy(true)
    setMsg(undefined)
    const { error } = await supabase.rpc('set_app_secret', { p_name: 'ANTHROPIC_API_KEY', p_value: value })
    setBusy(false)
    if (error) return setMsg(errorText(error))
    setValue('')
    setMsg('Kaydedildi.')
    load()
  }

  return (
    <div className="mt-6 space-y-2 border-t border-slate-200 pt-4 pb-6">
      <h2 className="font-semibold text-slate-800">AI anahtarı (Anthropic)</h2>
      <p className="text-sm text-slate-600">
        {at === undefined ? '…' : at ? `Girildi: ${fmtDate(at)} ${fmtTime(at)}. Değiştirmek için yenisini yazın.` : 'Henüz girilmedi.'}
      </p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="sk-ant-..."
        autoComplete="off"
        className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base"
      />
      <button
        onClick={save}
        disabled={busy || value.trim().length < 20}
        className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        Kaydet
      </button>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
    </div>
  )
}
