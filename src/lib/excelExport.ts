// Raporları Excel (xlsx) olarak indirir; ilk satır kalın başlık.
import writeXlsxFile from 'write-excel-file'

export interface SheetData {
  name: string
  header: string[]
  rows: (string | number | null | undefined)[][]
}

export async function downloadXlsx(fileName: string, sheets: SheetData[]) {
  const data = sheets.map((s) => [
    s.header.map((h) => ({ value: h, fontWeight: 'bold' as const })),
    ...s.rows.map((r) => r.map((v) => (v === null || v === undefined || v === '' ? null : { value: v }))),
  ])
  const columns = sheets.map((s) => s.header.map((h, i) => ({ width: Math.min(60, Math.max(10, h.length + 2, ...s.rows.map((r) => String(r[i] ?? '').length + 2))) })))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (writeXlsxFile as any)(data, { sheets: sheets.map((s) => s.name.slice(0, 31)), columns, fileName })
}
