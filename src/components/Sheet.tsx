import type { ReactNode } from 'react'

// Tam ekran açılan panel (telefonda alttan sayfa gibi)
export default function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-label={title} className="fixed inset-0 z-20 flex flex-col bg-slate-100">
      <div className="flex items-center justify-between bg-brand px-4 py-3 text-white">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm active:bg-white/10">
          Kapat
        </button>
      </div>
      <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </div>
  )
}
