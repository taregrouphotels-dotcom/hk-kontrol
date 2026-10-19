// data/HK_Veri_Toplama.xlsx'i arayüzdeki ayrıştırıcıyla okur ve test/fixtures/import_payload.json ile karşılaştırır.
// Veritabanı testi (test/import_test.sql) bu dosyayı kullanır. Excel veya ayrıştırıcı değişince: --update ile yenile.
// Kullanım: node test/excel_import_test.mjs [--update]
import { build } from 'esbuild'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import readXlsxFile from 'read-excel-file/node'

const out = await build({ entryPoints: ['src/lib/excelImport.ts'], bundle: true, format: 'esm', write: false, platform: 'node' })
const { parseWorkbook } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

const templates = readdirSync('templates').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`templates/${f}`, 'utf8')))
const sheets = await readXlsxFile('data/HK_Veri_Toplama.xlsx')
const { payload, issues } = parseWorkbook(sheets, templates)

const fail = (m) => { console.error('BAŞARISIZ: ' + m); process.exit(1) }
if (issues.length) fail('Excel okunurken biçim hatası: ' + JSON.stringify(issues))
const n = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, v.length]))
console.log('okunan:', JSON.stringify(n))
if (n.properties !== 5 || n.rooms !== 40 || n.room_types !== 18) fail('beklenen 5 otel, 18 oda tipi, 40 oda')
if (payload.room_types.some((t) => t.code.length > 10)) fail('açıklama satırı oda tipi sanıldı')
const x3 = payload.steps.filter((s) => s.room_type === 'X3')
if (x3.length !== 17) fail('X3 için 17 adım bekleniyordu')
if (x3.find((s) => s.step_order === 15)?.shots !== 2) fail('yatak adımı şablondan 2 kare almalı')

const path = 'test/fixtures/import_payload.json'
const json = JSON.stringify(payload, null, 1) + '\n'
if (process.argv.includes('--update')) {
  writeFileSync(path, json)
  console.log('güncellendi:', path)
} else if (readFileSync(path, 'utf8') !== json) {
  fail(`${path} güncel değil: node test/excel_import_test.mjs --update`)
}
console.log('EXCEL TESTİ GEÇTİ')
