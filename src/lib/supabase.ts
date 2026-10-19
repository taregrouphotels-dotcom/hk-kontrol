import { createClient } from '@supabase/supabase-js'

// Adres ve publishable key tarayıcıya gider, gizli değildir. Ortam değişkeni yoksa projenin kendi değerleri kullanılır.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://ihwyfllcvkcpjsouhsel.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vx9AmP_0QYUaR5-S3Tc8Tw_nq63idFY'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export type Role = 'hk' | 'supervisor' | 'admin'
export type Region = 'istanbul' | 'izmir'
export type DayStatus = 'stayover' | 'checkout' | 'vacant' | 'checkin' | 'checkout_checkin'
export type CleaningStatus =
  | 'in_progress'
  | 'submitted'
  | 'analyzing'
  | 'fixing'
  | 'escalated'
  | 'approved'
  | 'cancelled'

export interface Profile {
  id: string
  full_name: string
  username: string | null
  role: Role
  region: Region | null
  active: boolean
  consent_at: string | null
}

// HK'lar kullanıcı adı + PIN ile girer; Supabase Auth'ta e-postaları kullaniciadi@hk.tare.local
export function hkEmail(username: string): string {
  return `${username.trim().toLowerCase()}@hk.tare.local`
}

// Supabase'in İngilizce hata mesajlarını kullanıcıya Türkçe gösterir
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  if (/invalid login credentials/i.test(msg)) return 'Kullanıcı adı / e-posta veya şifre hatalı.'
  if (/failed to fetch|network/i.test(msg)) return 'İnternet bağlantısı yok. Bağlantıyı kontrol edip tekrar deneyin.'
  if (/rate limit|too many/i.test(msg)) return 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.'
  return msg
}
