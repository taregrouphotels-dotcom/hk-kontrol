// Uygulama içi canlı kamera (kural: galeriden seçme yok, galeriye kaydetme yok).
// Çekilen kare uzun kenarı 1600 px JPEG'e çevrilir, üzerine filigran yazılır, karanlık/bulanıklık kontrol edilir.

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  })
  video.srcObject = stream
  video.setAttribute('playsinline', 'true') // iPhone tam ekran oynatmasın
  video.muted = true
  await video.play()
  return stream
}

export function closeCamera(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop())
}

// Fener: destekleyen cihazlarda (çoğu Android Chrome); desteklemeyende false döner
export function torchSupported(stream: MediaStream): boolean {
  const track = stream.getVideoTracks()[0]
  const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean }
  return !!caps.torch
}

export async function setTorch(stream: MediaStream, on: boolean): Promise<boolean> {
  const track = stream.getVideoTracks()[0]
  if (!track || !torchSupported(stream)) return false
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
    return true
  } catch {
    return false
  }
}

export interface Shot {
  blob: Blob
  thumb: string // küçük önizleme (data URL)
  dark: boolean
  blurry: boolean
}

// Basit kalite kontrolü: ortalama parlaklık ve Laplace varyansı (küçük gri kopya üzerinde)
function quality(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const { data } = ctx.getImageData(0, 0, w, h)
  const g = new Float32Array(w * h)
  let sum = 0
  for (let i = 0; i < w * h; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    g[i] = v
    sum += v
  }
  const mean = sum / (w * h)
  let lapSum = 0
  let lapSq = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]
      lapSum += l
      lapSq += l * l
      n++
    }
  }
  const variance = lapSq / n - (lapSum / n) ** 2
  return { dark: mean < 45, blurry: variance < 60 }
}

export async function capture(video: HTMLVideoElement, watermark: string[]): Promise<Shot> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const scale = Math.min(1, 1600 / Math.max(vw, vh))
  const w = Math.round(vw * scale)
  const h = Math.round(vh * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, w, h)

  // Kalite: 240 px'lik kopya
  const qs = Math.min(1, 240 / Math.max(w, h))
  const qc = document.createElement('canvas')
  qc.width = Math.round(w * qs)
  qc.height = Math.round(h * qs)
  const qctx = qc.getContext('2d', { willReadFrequently: true })!
  qctx.drawImage(canvas, 0, 0, qc.width, qc.height)
  const q = quality(qctx, qc.width, qc.height)

  // Filigran: alt şerit
  const fs = Math.max(14, Math.round(h * 0.022))
  const pad = Math.round(fs * 0.5)
  const bandH = watermark.length * (fs + 4) + pad * 2
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, h - bandH, w, bandH)
  ctx.fillStyle = '#fff'
  ctx.font = `600 ${fs}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  watermark.forEach((line, i) => ctx.fillText(line, pad, h - bandH + pad + i * (fs + 4)))

  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Fotoğraf oluşturulamadı'))), 'image/jpeg', 0.75))
  const tc = document.createElement('canvas')
  const ts = 160 / Math.max(w, h)
  tc.width = Math.round(w * ts)
  tc.height = Math.round(h * ts)
  tc.getContext('2d')!.drawImage(canvas, 0, 0, tc.width, tc.height)
  return { blob, thumb: tc.toDataURL('image/jpeg', 0.6), ...q }
}
