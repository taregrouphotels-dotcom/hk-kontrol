import { FunctionsHttpError } from '@supabase/supabase-js'
import { errorText, supabase } from './supabase'

// Edge Function çağrısı; hata olursa fonksiyonun döndürdüğü Türkçe mesajı fırlatır.
export async function callFunction<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null)
      if (detail?.error) throw new Error(detail.error)
    }
    throw new Error(errorText(error))
  }
  return data as T
}
