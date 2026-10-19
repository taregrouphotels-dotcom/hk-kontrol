// Çevrimdışı kuyruk (spec 4, kural: zayıf internet). Başlatma, üye ekleme, kontrol başlatma, fotoğraf, "uygulanamıyor"
// ve gönderme işlemleri cihazdaki IndexedDB'ye sırayla yazılır, bağlantı varken sırayla sunucuya gönderilir.
// Fotoğraflar sadece burada durur (telefon galerisine düşmez); yüklenince cihazdan silinir.
// Sunucu işlemleri tekrar gönderilse de sorun çıkarmaz (aynı kimlik / benzersiz anahtar).
import { callFunction } from './api'
import { errorText, supabase } from './supabase'

export type QueueOp =
  | { kind: 'rpc'; fn: 'start_cleaning' | 'add_cleaning_member' | 'remove_cleaning_member' | 'start_check' | 'submit_cleaning'; args: Record<string, unknown> }
  | { kind: 'photo'; cleaning_id: string; step_id: string; shot: number; attempt: number; captured_at: string; blob: Blob }
  | { kind: 'skip'; cleaning_id: string; step_id: string; shot: number; reason: string; captured_at: string }
  // Hasar bildirimi / kayıp eşya: kimlik cihazda üretilir, tekrar gönderilirse kopya oluşmaz
  | { kind: 'report'; table: 'damage_reports' | 'lost_items'; row: Record<string, unknown> }
  | { kind: 'report_photo'; report: 'damage' | 'lost'; id: string; n: number; blob: Blob }

interface Stored {
  id?: number
  op: QueueOp
  added_at: string
}

export interface QueueState {
  pending: number
  photos: number
  running: boolean
  error: string | null
  paused: boolean // depo kurulmamış ya da kalıcı hata: elle "tekrar dene" bekler
}

const DB = 'hk-kontrol'
const STORE = 'queue'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(req.result)
    t.onerror = () => reject(t.error)
  })
}

const all = () => tx<Stored[]>('readonly', (s) => s.getAll())

let state: QueueState = { pending: 0, photos: 0, running: false, error: null, paused: false }
const listeners = new Set<(s: QueueState) => void>()

function emit(patch: Partial<QueueState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l(state))
}

export function subscribe(fn: (s: QueueState) => void): () => void {
  listeners.add(fn)
  fn(state)
  return () => listeners.delete(fn)
}

async function refreshCounts() {
  const items = await all()
  emit({ pending: items.length, photos: items.filter((i) => i.op.kind === 'photo' || i.op.kind === 'report_photo').length })
  return items
}

export async function enqueue(op: QueueOp) {
  await tx('readwrite', (s) => s.add({ op, added_at: new Date().toISOString() } satisfies Stored))
  await refreshCounts()
  void process()
}

// Kuyruktaki işlemler (ekranlar, yüklenmemiş fotoğrafları ve çekilmiş adımları göstermek için kullanır)
export async function pendingOps(): Promise<QueueOp[]> {
  return (await all()).map((i) => i.op)
}

class Permanent extends Error {}

const isNetwork = (e: unknown) => /failed to fetch|network|load failed|internet/i.test(String((e as Error)?.message ?? e))

async function run(op: QueueOp) {
  if (op.kind === 'rpc') {
    const { error } = await supabase.rpc(op.fn, op.args)
    if (error) {
      if (isNetwork(error)) throw error
      throw new Permanent(errorText(error))
    }
    return
  }
  if (op.kind === 'skip') {
    const { error } = await supabase.from('step_results').insert({
      cleaning_id: op.cleaning_id, step_id: op.step_id, shot: op.shot, attempt: 1,
      skipped: true, skip_reason: op.reason, captured_at: op.captured_at,
    })
    if (error && error.code !== '23505') {
      if (isNetwork(error)) throw error
      throw new Permanent(errorText(error))
    }
    return
  }
  if (op.kind === 'report') {
    const { error } = await supabase.from(op.table).insert(op.row)
    if (error && error.code !== '23505') {
      if (isNetwork(error)) throw error
      throw new Permanent(errorText(error))
    }
    return
  }
  if (op.kind === 'report_photo') {
    let signed: { key: string; url: string }
    try {
      signed = await callFunction('media-sign', { action: 'report_upload', kind: op.report, id: op.id, n: op.n })
    } catch (e) {
      if (isNetwork(e)) throw e
      throw new Permanent(errorText(e))
    }
    const put = await fetch(signed.url, { method: 'PUT', body: op.blob, headers: { 'Content-Type': 'image/jpeg' } })
    if (!put.ok) throw new Error(`Yükleme hatası (${put.status})`)
    const { error } = await supabase
      .from('report_media')
      .insert({ [op.report === 'damage' ? 'damage_id' : 'lost_id']: op.id, media_key: signed.key })
    if (error && error.code !== '23505') {
      if (isNetwork(error)) throw error
      throw new Permanent(errorText(error))
    }
    return
  }
  // Fotoğraf: imzalı adres → R2'ye yükle → kaydı yaz
  let signed: { key: string; url: string }
  try {
    signed = await callFunction('media-sign', {
      action: 'upload', cleaning_id: op.cleaning_id, step_id: op.step_id, shot: op.shot, attempt: op.attempt,
    })
  } catch (e) {
    if (isNetwork(e)) throw e
    throw new Permanent(errorText(e))
  }
  const put = await fetch(signed.url, { method: 'PUT', body: op.blob, headers: { 'Content-Type': 'image/jpeg' } })
  if (!put.ok) throw new Error(`Yükleme hatası (${put.status})`)
  const { data, error } = await supabase.from('step_results').insert({
    cleaning_id: op.cleaning_id, step_id: op.step_id, shot: op.shot, attempt: op.attempt,
    media_key: signed.key, captured_at: op.captured_at,
  }).select('id').single()
  if (error && error.code !== '23505') {
    if (isNetwork(error)) throw error
    throw new Permanent(errorText(error))
  }
  // AI kontrolünü hemen iste; sonucu çekim ekranı okur. Olmazsa sunucudaki dakikalık tarama yapar.
  if (data) void callFunction('analyze-step', { step_result_id: data.id }).catch(() => {})
}

let running = false

// Kuyruğu baştan sona sırayla işler. Ağ hatasında durur ve bağlantı gelince yeniden dener.
export async function process(force = false) {
  if (running) return
  if (state.paused && !force) return
  running = true
  emit({ running: true, error: null, paused: false })
  try {
    for (;;) {
      const items = await refreshCounts()
      const next = items[0]
      if (!next) break
      if (!navigator.onLine) {
        emit({ error: 'İnternet yok; bağlantı gelince gönderilecek.' })
        break
      }
      try {
        await run(next.op)
        await tx('readwrite', (s) => s.delete(next.id!))
      } catch (e) {
        if (e instanceof Permanent) {
          emit({ error: e.message, paused: true })
        } else {
          emit({ error: isNetwork(e) ? 'İnternet zayıf; tekrar denenecek.' : errorText(e) })
          setTimeout(() => void process(), 15_000)
        }
        break
      }
    }
  } finally {
    running = false
    emit({ running: false })
    await refreshCounts()
  }
}

// Kalıcı hatalı işlemi atlamak (ör. süpervizör kaydı iptal ettiyse) — kullanıcı onayıyla
export async function dropFirst() {
  const items = await all()
  if (items[0]) await tx('readwrite', (s) => s.delete(items[0].id!))
  emit({ paused: false, error: null })
  await refreshCounts()
  void process()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void process())
  void refreshCounts().then(() => process())
}
