import type { DayStatus, Region, Role } from './supabase'

const TZ = 'Europe/Istanbul'

export function fmtDate(d: string | Date): string {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d))
}

export function fmtTime(d: string | Date): string {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d))
}

export function minutesSince(d: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000))
}

export const roleLabel: Record<Role, string> = { hk: 'HK', supervisor: 'Süpervizör', admin: 'Admin' }
export const regionLabel: Record<Region, string> = { istanbul: 'İstanbul', izmir: 'İzmir' }

export const dayStatusLabel: Record<DayStatus, string> = {
  checkout: 'Çıkış',
  checkout_checkin: 'Çıkış + giriş',
  stayover: 'Konaklama',
  checkin: 'Giriş',
  vacant: 'Boş',
}

// Bugün ekranındaki gruplar (spec 5.1): Çıkış, Konaklama, Giriş, Boş
export const dayGroups: { key: string; label: string; statuses: (DayStatus | null)[] }[] = [
  { key: 'out', label: 'Çıkış', statuses: ['checkout', 'checkout_checkin'] },
  { key: 'stay', label: 'Konaklama', statuses: ['stayover'] },
  { key: 'in', label: 'Giriş', statuses: ['checkin'] },
  { key: 'vacant', label: 'Boş', statuses: ['vacant'] },
  { key: 'unknown', label: 'Durum bilinmiyor', statuses: [null] },
]
