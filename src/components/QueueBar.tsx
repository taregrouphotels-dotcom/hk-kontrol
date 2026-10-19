import { useEffect, useState } from 'react'
import { dropFirst, process, subscribe, type QueueState } from '../lib/queue'

// Gönderilmeyi bekleyen işlemler (spec 4: yükleme durumu ekranda görünür). Kuyruk boşken görünmez.
export default function QueueBar() {
  const [q, setQ] = useState<QueueState>()

  useEffect(() => subscribe(setQ), [])

  if (!q || q.pending === 0) return null
  const what = q.photos ? `${q.photos} fotoğraf` + (q.pending > q.photos ? ` + ${q.pending - q.photos} işlem` : '') : `${q.pending} işlem`

  return (
    <div className={`px-4 py-2 text-sm ${q.paused ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
      <div className="flex items-center justify-between gap-2">
        <span>
          {q.running ? 'Gönderiliyor: ' : 'Gönderilecek: '}
          <b>{what}</b>
        </span>
        {!q.running && (
          <button onClick={() => process(true)} className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-sm">
            Tekrar dene
          </button>
        )}
      </div>
      {q.error && <p className="mt-1 text-xs">{q.error}</p>}
      {q.paused && (
        <button
          onClick={() => {
            if (window.confirm('Gönderilemeyen ilk işlem bu telefondan silinsin mi? Bu geri alınamaz.')) dropFirst()
          }}
          className="mt-1 text-xs underline"
        >
          Gönderilemeyen işlemi sil
        </button>
      )}
    </div>
  )
}
