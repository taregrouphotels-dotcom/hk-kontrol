import { useCallback, useEffect, useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import { downloadXlsx } from '../lib/excelExport'

// Adım/şablon düzenleme (admin, karar 21): oda tipinin süre sınırları ve kontrol adımları uygulamadan düzenlenir.
// "Excel'e indir" ile Kontrol Adımları sayfası biçiminde dosya alınır (data/HK_Veri_Toplama.xlsx'e yapıştırmak için).

interface RoomType {
  id: string
  code: string
  name: string
  properties: { name: string } | null
  min_minutes_full: number
  min_minutes_stayover: number
  max_minutes_full: number | null
  max_minutes_stayover: number | null
  max_enabled: boolean
}

interface Step {
  id: string
  room_type_id: string
  step_order: number
  zone: string
  title: string
  instruction: string
  checks: string[]
  ai_prompt: string | null
  applies_to: ('full' | 'stayover')[]
  required: boolean
  needs_flash: boolean
  shots: number
  reference_key: string | null
}

const STEP_COLS = 'id, room_type_id, step_order, zone, title, instruction, checks, ai_prompt, applies_to, required, needs_flash, shots, reference_key'

export default function StepEditor() {
  const [types, setTypes] = useState<RoomType[]>([])
  const [typeId, setTypeId] = useState('')
  const [steps, setSteps] = useState<Step[]>()
  const [msg, setMsg] = useState<string>()

  useEffect(() => {
    supabase
      .from('room_types')
      .select('id, code, name, properties(name), min_minutes_full, min_minutes_stayover, max_minutes_full, max_minutes_stayover, max_enabled')
      .order('code')
      .then(({ data }) => {
        const list = (data as unknown as RoomType[]) ?? []
        setTypes(list)
        setTypeId((cur) => cur || list[0]?.id || '')
      })
  }, [])

  const load = useCallback(async () => {
    if (!typeId) return
    const { data } = await supabase.from('check_steps').select(STEP_COLS).eq('room_type_id', typeId).order('step_order')
    setSteps((data as Step[]) ?? [])
  }, [typeId])

  useEffect(() => {
    setSteps(undefined)
    load()
  }, [load])

  const type = types.find((t) => t.id === typeId)

  async function saveType(patch: Partial<RoomType>) {
    setMsg(undefined)
    const { error } = await supabase.from('room_types').update(patch).eq('id', typeId)
    if (error) return setMsg(errorText(error))
    setTypes(types.map((t) => (t.id === typeId ? { ...t, ...patch } : t)))
    setMsg('Kaydedildi.')
  }

  async function addStep() {
    const order = (steps?.[steps.length - 1]?.step_order ?? 0) + 1
    const { error } = await supabase.from('check_steps').insert({
      room_type_id: typeId, step_order: order, zone: 'Oda', title: 'Yeni adım', instruction: 'Ne çekileceğini yazın.',
      checks: [], applies_to: ['full', 'stayover'], required: true, needs_flash: false, shots: 1,
    })
    if (error) return setMsg(errorText(error))
    load()
  }

  // Sırayı değiştir: (oda tipi, sıra) tekil olduğu için önce geçici sıraya alınır
  async function move(i: number, dir: -1 | 1) {
    if (!steps) return
    const a = steps[i]
    const b = steps[i + dir]
    if (!b) return
    await supabase.from('check_steps').update({ step_order: -a.step_order }).eq('id', a.id)
    await supabase.from('check_steps').update({ step_order: a.step_order }).eq('id', b.id)
    await supabase.from('check_steps').update({ step_order: b.step_order }).eq('id', a.id)
    load()
  }

  async function remove(s: Step) {
    if (!window.confirm(`"${s.title}" adımı silinsin mi?`)) return
    const { error } = await supabase.from('check_steps').delete().eq('id', s.id)
    if (error) setMsg(error.code === '23503' ? 'Bu adımın çekilmiş fotoğrafları var; silinemez. Başlığını değiştirip kullanmaya devam edin.' : errorText(error))
    load()
  }

  async function exportAll() {
    const { data } = await supabase.from('check_steps').select(`${STEP_COLS}, room_types(code)`).order('step_order')
    const rows = ((data as unknown as (Step & { room_types: { code: string } })[]) ?? []).sort(
      (x, y) => x.room_types.code.localeCompare(y.room_types.code) || x.step_order - y.step_order,
    )
    const yn = (b: boolean) => (b ? 'Evet' : 'Hayır')
    await downloadXlsx('Kontrol_Adimlari.xlsx', [
      {
        name: 'Kontrol Adımları',
        header: ['Oda Tipi Kodu', 'Sıra', 'Bölge', 'Adım Adı', 'Çekim Talimatı', 'Kontrol Maddeleri (her satır bir madde)', 'Çıkışta', 'Konaklamada', 'Fener Gerekli', 'Zorunlu', 'Kare Sayısı', 'AI Talimatı'],
        rows: rows.map((s) => [
          s.room_types.code, s.step_order, s.zone, s.title, s.instruction, s.checks.join('\n'),
          yn(s.applies_to.includes('full')), yn(s.applies_to.includes('stayover')), yn(s.needs_flash), yn(s.required), s.shots, s.ai_prompt,
        ]),
      },
    ])
  }

  const num = (v: string) => (v === '' ? null : Math.max(0, Number(v)))

  return (
    <div className="space-y-3 px-4 pb-8 pt-4">
      <div className="flex gap-2">
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-3">
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} · {t.name} {t.properties ? `(${t.properties.name})` : ''}
            </option>
          ))}
        </select>
        <button onClick={exportAll} className="shrink-0 rounded-xl bg-white px-3 text-sm font-semibold text-brand shadow-sm">
          Excel'e indir
        </button>
      </div>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}

      {type && (
        <section className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-slate-800">Süre (dakika)</h2>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['min_minutes_full', 'En az · tam'],
                ['min_minutes_stayover', 'En az · konaklama'],
                ['max_minutes_full', 'En çok · tam'],
                ['max_minutes_stayover', 'En çok · konaklama'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="text-xs text-slate-500">
                {label}
                <input
                  type="number"
                  defaultValue={type[k] ?? ''}
                  key={`${type.id}-${k}`}
                  onBlur={(e) => {
                    const v = num(e.target.value)
                    if (v !== type[k] && !(k.startsWith('min') && v === null)) saveType({ [k]: v } as Partial<RoomType>)
                  }}
                  className="w-full rounded-lg border border-slate-300 px-2 py-2 text-base text-slate-800"
                />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-slate-700">
            <input type="checkbox" checked={type.max_enabled} onChange={(e) => saveType({ max_enabled: e.target.checked })} className="h-5 w-5" />
            En çok süre aşılınca Bugün ekranında uyar
          </label>
          <p className="text-xs text-slate-500">En az süreden kısa temizlikler raporda "şüpheli kısa" görünür.</p>
        </section>
      )}

      {!steps && <p className="text-slate-500">Yükleniyor…</p>}
      {steps?.map((s, i) => (
        <StepCard key={s.id} step={s} first={i === 0} last={i === steps.length - 1} onMove={(d) => move(i, d)} onDelete={() => remove(s)} onSaved={load} />
      ))}
      {steps && (
        <button onClick={addStep} className="w-full rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-semibold text-slate-500">
          + Adım ekle
        </button>
      )}
    </div>
  )
}

function StepCard({ step, first, last, onMove, onDelete, onSaved }: { step: Step; first: boolean; last: boolean; onMove: (d: -1 | 1) => void; onDelete: () => void; onSaved: () => void }) {
  const [s, setS] = useState(step)
  const [checks, setChecks] = useState(step.checks.join('\n'))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>()
  const dirty = JSON.stringify({ ...s, checks: checks.split('\n').map((c) => c.trim()).filter(Boolean) }) !== JSON.stringify(step)

  useEffect(() => {
    setS(step)
    setChecks(step.checks.join('\n'))
  }, [step])

  async function save() {
    setBusy(true)
    const { error } = await supabase
      .from('check_steps')
      .update({
        zone: s.zone, title: s.title.trim(), instruction: s.instruction.trim(), ai_prompt: s.ai_prompt?.trim() || null,
        checks: checks.split('\n').map((c) => c.trim()).filter(Boolean), applies_to: s.applies_to, required: s.required,
        needs_flash: s.needs_flash, shots: Math.min(5, Math.max(1, s.shots)), generic: false,
      })
      .eq('id', s.id)
    setBusy(false)
    setMsg(error ? errorText(error) : undefined)
    if (!error) onSaved()
  }

  const toggle = (t: 'full' | 'stayover') =>
    setS({ ...s, applies_to: s.applies_to.includes(t) ? s.applies_to.filter((x) => x !== t) : [...s.applies_to, t] })
  const input = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm'

  return (
    <div className="space-y-2 rounded-2xl bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="w-6 text-center font-bold text-slate-500">{s.step_order}</span>
        <input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} className={`${input} font-semibold`} />
        <button disabled={first} onClick={() => onMove(-1)} className="px-1 text-lg disabled:opacity-20" aria-label="Yukarı">
          ↑
        </button>
        <button disabled={last} onClick={() => onMove(1)} className="px-1 text-lg disabled:opacity-20" aria-label="Aşağı">
          ↓
        </button>
      </div>
      <input value={s.zone} onChange={(e) => setS({ ...s, zone: e.target.value })} placeholder="Bölge (Banyo, Mutfak…)" className={input} />
      <textarea value={s.instruction} onChange={(e) => setS({ ...s, instruction: e.target.value })} rows={2} placeholder="Çekim talimatı" className={input} />
      <textarea value={checks} onChange={(e) => setChecks(e.target.value)} rows={3} placeholder="Kontrol maddeleri (her satır bir madde)" className={input} />
      <textarea value={s.ai_prompt ?? ''} onChange={(e) => setS({ ...s, ai_prompt: e.target.value })} rows={2} placeholder="AI'a ek talimat (isteğe bağlı)" className={input} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={s.applies_to.includes('full')} onChange={() => toggle('full')} /> Çıkışta
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={s.applies_to.includes('stayover')} onChange={() => toggle('stayover')} /> Konaklamada
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={s.needs_flash} onChange={(e) => setS({ ...s, needs_flash: e.target.checked })} /> Fener
        </label>
        <label className="flex items-center gap-1">
          Kare
          <input type="number" min={1} max={5} value={s.shots} onChange={(e) => setS({ ...s, shots: Number(e.target.value) })} className="w-12 rounded border border-slate-300 px-1" />
        </label>
        <span className={s.reference_key ? 'text-emerald-700' : 'text-slate-400'}>{s.reference_key ? '● referans var' : '○ referans yok'}</span>
      </div>
      <div className="flex gap-2">
        <button disabled={!dirty || busy} onClick={save} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-40">
          Kaydet
        </button>
        <button onClick={onDelete} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500">
          Sil
        </button>
      </div>
      {msg && <p className="text-xs text-red-700">{msg}</p>}
    </div>
  )
}
