// data/HK_Veri_Toplama.xlsx biçimindeki dosyayı okuyup import_master_data()'nın beklediği sade veriye çevirir.
// Sütunlar başlık adıyla bulunur (sıra değişse de çalışır). Satır numaraları Excel'deki gibidir.
// Burada sadece biçim kontrolü yapılır (sayı mı, Evet/Hayır mı); otel/oda tipi eşleşmesini veritabanı kontrol eder.

export type Cell = string | number | boolean | Date | null | unknown
export interface SheetInput {
  sheet: string
  data: Cell[][]
}

export interface Issue {
  sheet: string
  row: number | null
  message: string
}

// templates/*.json: Excel'de kare sayısı / AI talimatı boşsa buradan alınır (karar 13)
export interface Template {
  code: string
  steps: { order: number; shots?: number; ai_prompt?: string }[]
}

export interface ImportPayload {
  properties: Record<string, unknown>[]
  room_types: Record<string, unknown>[]
  rooms: Record<string, unknown>[]
  steps: Record<string, unknown>[]
  catalog: Record<string, unknown>[]
  inventory: Record<string, unknown>[]
}

const SHEETS = {
  properties: 'Oteller',
  roomTypes: 'Oda Tipleri',
  rooms: 'Odalar',
  steps: 'Kontrol Adımları',
  catalog: 'Kalem Kataloğu',
  fixtures: 'Envanter - Demirbaş',
  kitchen: 'Envanter - Mutfak',
  treats: 'Minibar ve İkram', // isteğe bağlı
}

const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim()

class SheetReader {
  private cols = new Map<string, number>()
  constructor(
    readonly name: string,
    private data: Cell[][],
    private issues: Issue[],
  ) {
    ;(data[0] ?? []).forEach((h, i) => {
      if (typeof h === 'string' && h.trim()) this.cols.set(norm(h), i)
    })
  }

  // Başlık tam eşleşmezse "ile başlayan" ilk sütun (ör. "Kontrol Maddeleri (her satır bir madde)")
  col(header: string, required = true): number | null {
    const h = norm(header)
    let i = this.cols.get(h)
    if (i === undefined) for (const [k, v] of this.cols) if (k.startsWith(h)) { i = v; break }
    if (i === undefined) {
      if (required) this.issues.push({ sheet: this.name, row: 1, message: `"${header}" sütunu bulunamadı` })
      return null
    }
    return i
  }

  // Veri satırları: boş satırlar ve tek hücrelik uzun açıklama satırları atlanır
  *rows(): Generator<{ row: number; cells: Cell[] }> {
    for (let i = 1; i < this.data.length; i++) {
      const cells = this.data[i] ?? []
      const filled = cells.filter((c) => c !== null && c !== undefined && String(c).trim() !== '')
      if (filled.length === 0) continue
      if (filled.length === 1 && typeof filled[0] === 'string' && filled[0].length > 30) continue
      yield { row: i + 1, cells }
    }
  }
}

function text(v: Cell): string | null {
  if (v === null || v === undefined) return null
  const s = (v instanceof Date ? v.toISOString() : String(v)).trim()
  return s === '' ? null : s
}

export function slug(s: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' }
  return s
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]|i̇/g, (c) => map[c] ?? c)
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export function parseWorkbook(sheets: SheetInput[], templates: Template[] = []): { payload: ImportPayload; issues: Issue[] } {
  const issues: Issue[] = []
  const payload: ImportPayload = { properties: [], room_types: [], rooms: [], steps: [], catalog: [], inventory: [] }

  const get = (name: string, required = true): SheetReader | null => {
    const s = sheets.find((x) => norm(x.sheet) === norm(name))
    if (!s) {
      if (required) issues.push({ sheet: name, row: null, message: 'Sayfa bulunamadı' })
      return null
    }
    return new SheetReader(s.sheet, s.data, issues)
  }

  // Hücre okuyucular: biçim hatası issues'a yazılır, değer null döner
  const reader = (sheet: string, row: number) => ({
    text: (v: Cell) => text(v),
    int: (v: Cell, label: string): number | null => {
      const s = text(v)
      if (s === null) return null
      const n = Number(s.replace(',', '.'))
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        issues.push({ sheet, row, message: `${label} tam sayı olmalı ("${s}")` })
        return null
      }
      return n
    },
    num: (v: Cell, label: string): number | null => {
      const s = text(v)
      if (s === null) return null
      const n = Number(s.replace(',', '.'))
      if (!Number.isFinite(n)) {
        issues.push({ sheet, row, message: `${label} sayı olmalı ("${s}")` })
        return null
      }
      return n
    },
    yesNo: (v: Cell, label: string): boolean | null => {
      if (typeof v === 'boolean') return v
      const s = text(v)
      if (s === null) return null
      const n = norm(s)
      if (n === 'evet' || n === 'var') return true
      if (n === 'hayır' || n === 'hayir' || n === 'yok') return false
      issues.push({ sheet, row, message: `${label} "Evet" veya "Hayır" olmalı ("${s}")` })
      return null
    },
  })
  const at = (cells: Cell[], i: number | null) => (i === null ? null : cells[i])

  // ---------- Oteller ----------
  const ps = get(SHEETS.properties)
  if (ps) {
    const c = {
      name: ps.col('Otel Adı'), city: ps.col('Şehir'), region: ps.col('Bölge'), district: ps.col('Semt', false),
      floors: ps.col('Kat Sayısı', false), pms: ps.col("PMS'teki Adı", false), lock: ps.col('Kilit', false), note: ps.col('Not', false),
    }
    for (const { row, cells } of ps.rows()) {
      const r = reader(ps.name, row)
      const region = r.text(at(cells, c.region))
      payload.properties.push({
        row,
        name: r.text(at(cells, c.name)),
        city: r.text(at(cells, c.city)),
        region: region === null ? null : ({ istanbul: 'istanbul', izmir: 'izmir' } as Record<string, string>)[norm(region)] ?? region,
        district: r.text(at(cells, c.district)),
        floors: r.int(at(cells, c.floors), 'Kat sayısı'),
        pms_name: r.text(at(cells, c.pms)),
        lock_type: r.text(at(cells, c.lock)),
        note: r.text(at(cells, c.note)),
      })
    }
  }

  // ---------- Oda tipleri ----------
  const rts = get(SHEETS.roomTypes)
  const roomTypesByProperty = new Map<string, string[]>()
  if (rts) {
    const c = {
      code: rts.col('Oda Tipi Kodu'), name: rts.col('Oda Tipi Adı'), property: rts.col('Otel'), pms: rts.col('PMS Kodu', false),
      m2: rts.col('Yaklaşık m²', false), bed: rts.col('Yatak Tipi', false), guests: rts.col('Maks. Kişi', false),
      kitchen: rts.col('Mutfak Var mı', false), bath: rts.col('Banyo', false), outdoor: rts.col('Dış Alan', false),
      minFull: rts.col('Min. Süre Çıkış', false), minStay: rts.col('Min. Süre Konaklama', false),
      maxFull: rts.col('Max. Süre Çıkış', false), maxStay: rts.col('Max. Süre Konaklama', false),
      maxOn: rts.col('Max Süre Aktif', false), note: rts.col('Not', false),
    }
    for (const { row, cells } of rts.rows()) {
      const r = reader(rts.name, row)
      const code = r.text(at(cells, c.code))
      const property = r.text(at(cells, c.property))
      if (code && property) roomTypesByProperty.set(property, [...(roomTypesByProperty.get(property) ?? []), code])
      payload.room_types.push({
        row, code, property,
        name: r.text(at(cells, c.name)),
        pms_code: r.text(at(cells, c.pms)),
        approx_m2: r.num(at(cells, c.m2), 'm²'),
        bed_type: r.text(at(cells, c.bed)),
        max_guests: r.int(at(cells, c.guests), 'Maks. kişi'),
        has_kitchen: r.yesNo(at(cells, c.kitchen), 'Mutfak var mı'),
        bath_type: r.text(at(cells, c.bath)),
        outdoor: r.text(at(cells, c.outdoor)),
        min_full: r.int(at(cells, c.minFull), 'Min. süre çıkış'),
        min_stay: r.int(at(cells, c.minStay), 'Min. süre konaklama'),
        max_full: r.int(at(cells, c.maxFull), 'Max. süre çıkış'),
        max_stay: r.int(at(cells, c.maxStay), 'Max. süre konaklama'),
        max_enabled: r.yesNo(at(cells, c.maxOn), 'Max süre aktif'),
        note: r.text(at(cells, c.note)),
      })
    }
  }

  // ---------- Odalar ----------
  const rs = get(SHEETS.rooms)
  if (rs) {
    const c = {
      property: rs.col('Otel'), no: rs.col('Oda No'), floor: rs.col('Kat', false), type: rs.col('Oda Tipi Kodu'),
      active: rs.col('Aktif', false), note: rs.col('Not', false),
    }
    for (const { row, cells } of rs.rows()) {
      const r = reader(rs.name, row)
      payload.rooms.push({
        row,
        property: r.text(at(cells, c.property)),
        room_no: r.text(at(cells, c.no)),
        floor: r.int(at(cells, c.floor), 'Kat'),
        room_type: r.text(at(cells, c.type)),
        active: r.yesNo(at(cells, c.active), 'Aktif'),
        note: r.text(at(cells, c.note)),
      })
    }
  }

  // ---------- Kontrol adımları ----------
  const ss = get(SHEETS.steps)
  if (ss) {
    const c = {
      type: ss.col('Oda Tipi Kodu'), order: ss.col('Sıra'), zone: ss.col('Bölge', false), title: ss.col('Adım Adı'),
      instruction: ss.col('Çekim Talimatı'), checks: ss.col('Kontrol Maddeleri', false), full: ss.col('Çıkışta'),
      stay: ss.col('Konaklamada'), flash: ss.col('Fener Gerekli', false), required: ss.col('Zorunlu', false),
      shots: ss.col('Kare Sayısı', false), ai: ss.col('AI Talimatı', false),
    }
    for (const { row, cells } of ss.rows()) {
      const r = reader(ss.name, row)
      const room_type = r.text(at(cells, c.type))
      const step_order = r.int(at(cells, c.order), 'Sıra')
      const tpl = templates.find((t) => t.code === room_type)?.steps.find((s) => s.order === step_order)
      payload.steps.push({
        row, room_type, step_order,
        zone: r.text(at(cells, c.zone)),
        title: r.text(at(cells, c.title)),
        instruction: r.text(at(cells, c.instruction)),
        checks: (r.text(at(cells, c.checks)) ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
        full: r.yesNo(at(cells, c.full), 'Çıkışta'),
        stayover: r.yesNo(at(cells, c.stay), 'Konaklamada'),
        needs_flash: r.yesNo(at(cells, c.flash), 'Fener gerekli'),
        required: r.yesNo(at(cells, c.required), 'Zorunlu'),
        shots: r.int(at(cells, c.shots), 'Kare sayısı') ?? tpl?.shots ?? null,
        ai_prompt: r.text(at(cells, c.ai)) ?? tpl?.ai_prompt ?? null,
      })
    }
  }

  // ---------- Kalem kataloğu ----------
  const cs = get(SHEETS.catalog)
  const catalogKeys = new Set<string>()
  if (cs) {
    const c = {
      property: cs.col('Tesis'), key: cs.col('Kalem Kodu'), label: cs.col('Kalem Adı'), kind: cs.col('Tür', false),
      desc: cs.col('Tarif', false), photo: cs.col('Foto Dosyası', false),
    }
    for (const { row, cells } of cs.rows()) {
      const r = reader(cs.name, row)
      const property = r.text(at(cells, c.property))
      const item_key = r.text(at(cells, c.key))
      catalogKeys.add(`${property}|${item_key}`)
      payload.catalog.push({
        sheet: cs.name, row, property, item_key,
        label: r.text(at(cells, c.label)),
        kind: r.text(at(cells, c.kind)),
        description: r.text(at(cells, c.desc)),
        photo_file: r.text(at(cells, c.photo)),
      })
    }
  }

  // ---------- Envanter ----------
  for (const name of [SHEETS.fixtures, SHEETS.kitchen]) {
    const s = get(name)
    if (!s) continue
    const c = {
      property: s.col('Tesis'), type: s.col('Oda Tipi Kodu'), step: s.col('Adım No', false), key: s.col('Kalem Kodu'),
      qty: s.col('Olması Gereken Adet'), verified: s.col('Doğrulandı', false), note: s.col('Not', false),
    }
    for (const { row, cells } of s.rows()) {
      const r = reader(s.name, row)
      payload.inventory.push({
        sheet: s.name, row,
        property: r.text(at(cells, c.property)),
        room_type: r.text(at(cells, c.type)),
        step_order: r.int(at(cells, c.step), 'Adım no'),
        item_key: r.text(at(cells, c.key)),
        qty: r.int(at(cells, c.qty), 'Adet'),
        verified: r.yesNo(at(cells, c.verified), 'Doğrulandı mı'),
        location: null,
        note: r.text(at(cells, c.note)),
      })
    }
  }

  // ---------- Minibar ve ikram (isteğe bağlı; minibar ücretli değil, ikram olarak sayılır) ----------
  const ts = get(SHEETS.treats, false)
  if (ts) {
    const c = {
      property: ts.col('Tesis'), type: ts.col('Oda Tipi Kodu'), step: ts.col('Adım No', false), place: ts.col('Yer', false),
      key: ts.col('Kalem Kodu', false), label: ts.col('Ürün'), qty: ts.col('Standart Adet'), note: ts.col('Not', false),
    }
    for (const { row, cells } of ts.rows()) {
      const r = reader(ts.name, row)
      const property = r.text(at(cells, c.property))
      const label = r.text(at(cells, c.label))
      if (!property || !label) continue
      const item_key = r.text(at(cells, c.key)) ?? slug(label)
      const type = r.text(at(cells, c.type))
      // "Tümü": tesisin bütün oda tipleri
      const types = type && norm(type) === 'tümü' ? roomTypesByProperty.get(property) ?? [] : [type]
      if (!catalogKeys.has(`${property}|${item_key}`)) {
        catalogKeys.add(`${property}|${item_key}`)
        payload.catalog.push({ sheet: ts.name, row, property, item_key, label, kind: 'İkram', description: null, photo_file: null })
      }
      const common = {
        sheet: ts.name, row, property, item_key,
        step_order: r.int(at(cells, c.step), 'Adım no'),
        qty: r.int(at(cells, c.qty), 'Standart adet'),
        verified: false,
        location: r.text(at(cells, c.place)),
        note: r.text(at(cells, c.note)),
      }
      for (const room_type of types) payload.inventory.push({ ...common, room_type })
    }
  }

  return { payload, issues }
}
