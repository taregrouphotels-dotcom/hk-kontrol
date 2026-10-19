// Bu cihazda başlatılan temizlikler (çevrimdışıyken de ekranlar çalışsın diye). Sunucudaki kayıt asıl kaynaktır;
// burası sadece hangi adımın çekildiğini ve akışın nerede olduğunu hatırlar.
import type { DayStatus } from './supabase'

export interface ActiveCleaning {
  id: string
  room_id: string
  room_no: string
  property_name: string
  room_type_id: string
  type: 'full' | 'stayover'
  started_at: string
  check_started_at: string | null
  submitted_at: string | null
  via_qr: boolean
  // "adımId:kare" → çekildi / uygulanamıyor
  done: Record<string, 'photo' | 'skip'>
}

const KEY = 'hk-active'

function read(): ActiveCleaning[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

function write(list: ActiveCleaning[]) {
  // 3 günden eski gönderilmiş kayıtlar temizlenir
  const cutoff = Date.now() - 3 * 86_400_000
  localStorage.setItem(KEY, JSON.stringify(list.filter((c) => !c.submitted_at || Date.parse(c.submitted_at) > cutoff)))
}

export function getActive(id: string): ActiveCleaning | undefined {
  return read().find((c) => c.id === id)
}

export function activeForRoom(roomId: string): ActiveCleaning | undefined {
  return read().filter((c) => c.room_id === roomId && !c.submitted_at).sort((a, b) => b.started_at.localeCompare(a.started_at))[0]
}

// Bu cihazda gönderilmemiş temizlikler (Bugün ekranında "devam et" için)
export function openCleanings(): ActiveCleaning[] {
  return read().filter((c) => !c.submitted_at).sort((a, b) => b.started_at.localeCompare(a.started_at))
}

export function saveActive(c: ActiveCleaning) {
  write([...read().filter((x) => x.id !== c.id), c])
}

export function updateActive(id: string, patch: Partial<ActiveCleaning>): ActiveCleaning | undefined {
  const c = getActive(id)
  if (!c) return undefined
  const next = { ...c, ...patch }
  saveActive(next)
  return next
}

// Sunucuyla aynı kural: konaklama → konaklama kontrolü, diğerleri ve bilinmeyen → tam kontrol
export const cleaningTypeFor = (s: DayStatus | null): 'full' | 'stayover' => (s === 'stayover' ? 'stayover' : 'full')
