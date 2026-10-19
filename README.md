# HK Kontrol

Tare otelleri (İstanbul + İzmir/Urla) için housekeeping oda kontrol uygulaması. HK temizlikten sonra odayı rehberli kamerayla çeker, süpervizör onaylar.

- Tarif: [docs/SPEC.md](docs/SPEC.md) · Kararlar: [docs/KARARLAR.md](docs/KARARLAR.md) · Kurulum: [docs/KURULUM.md](docs/KURULUM.md)
- Teknoloji ve kurallar: [CLAUDE.md](CLAUDE.md)

## Durum (Faz 1)

| Adım | Ne çalışıyor |
|---|---|
| Veritabanı | Şema, bölge bazlı yetki (RLS), temizlik başlatma/kontrol/gönderme/onay/iptal fonksiyonları, Bugün ekranı sorgusu. Testler: `test/veritabani_test.sh` |
| Arayüz iskeleti | Giriş (personel: kullanıcı adı + 6 haneli PIN; yönetici: e-posta + şifre), ilk girişte KVKK onayı, ilk adminin kendi profilini alması, Bugün ekranı (otel → Çıkış/Konaklama/Giriş/Boş, kim temizliyor), ana ekrana eklenebilir (PWA) |
| Personel yönetimi | Süpervizör → Personel: kendi bölgesinde HK hesabı açma ve PIN sıfırlama. Admin → Personel: HK (kullanıcı adı + PIN) ve süpervizör/admin (e-posta + şifre) hesabı açma, ad/rol/bölge düzenleme, PIN/şifre sıfırlama, pasife alma. Hesap işlemleri `admin-users` Edge Function'ında |
| Excel'den içe aktarma | Admin → Veri: `HK_Veri_Toplama.xlsx` seçilir → önizleme (sayılar, hata ve uyarı listesi) → İçe aktar. Hata varsa hiçbir şey yazılmaz; tekrar yükleme günceller. Adımı olmayan oda tiplerine geçici 5 adımlık şablon, adedi boş envanter satırları atlanır, minibar/ikram satırları ikram kalemi olarak eklenir. Testler: `test/import_test.sql`, `test/excel_import_test.mjs` |
| HotelRunner senkronu | `pms-sync` Edge Function saatte bir (Supabase cron) 4 tesisin son 2 günde değişen rezervasyonlarını okur (n8n kadar hafif; sadece oda no, tarih, durum, misafir bilgisi saklanmaz). Daha önce yapılmış rezervasyonların ilk dolumu Airtable kayıtlarından (`0009`), bugünün ve yarının oda durumunu hesaplar. Süpervizör/admin Bugün ekranında odaya dokunup durumu elle değiştirir; elle girilen o gün ezilmez. Admin: "Şimdi senkronla", hata ve odası eşleşmeyen rezervasyon listesi. Test: `test/pms_test.sql` |
| Oda kullanım dışı | Süpervizör/admin odaya dokunup "Kullanım dışı" (tadilat vb.) ve bitiş tarihi girer; kutu siyah görünür, süre bitince kendiliğinden kalkar (`0011`) |
| HK temizlik akışı | HK Bugün ekranında odaya dokunur → oda sayfası → "Temizliğe başla" → isteğe bağlı birlikte temizleyen → "Temizlik bitti · Kontrole başla" → tam ekran rehberli kamera (adım, talimat, kontrol maddeleri, fener, referans hayaleti, karanlık/bulanık uyarısı, filigran) → "Uygulanamıyor" açıklamayla → "Kontrolü gönder". Her işlem ve fotoğraf cihazdaki çevrimdışı kuyruğa (IndexedDB) yazılır, sırayla gönderilir; üstte bekleyen sayısı ve "Tekrar dene" görünür. Fotoğraflar `media-sign` ile R2'ye yüklenir, yüklenince cihazdan silinir. Çıkışta gönderilmemiş işlem varsa uyarır |
| TTLock | Kapı uygulamadan açılmaz (karar 16). Odaların TTLock kilit numaraları veritabanında (`0012`), ileride kilit kayıtlarını arka planda okumak için |

## Yapı

| Klasör | İçerik |
|---|---|
| `src/` | Arayüz (Vite + React + TypeScript + Tailwind): `pages/` ekranlar, `lib/` Supabase bağlantısı ve biçimlendirme |
| `public/` | PWA manifest, service worker, simgeler |
| `wrangler.jsonc` | Cloudflare yayın ayarı (derle, `dist/`i yayınla) |
| `supabase/functions/` | Edge Function'lar (Deno). `main`'e gelince GitHub Actions yayınlar |
| `supabase/migrations/` | Veritabanı: `0001_init` (başlangıç şeması), sonraki her değişiklik yeni dosya |
| `test/` | Veritabanı yetki testleri (yerel Postgres'te Supabase taklidiyle) |
| `scripts/apply_migrations.sh` | Migration'ları Supabase'e uygular (GitHub Actions çalıştırır) |
| `data/`, `templates/`, `config/` | Temel veri Excel'i, örnek şablon, ilk admin |

## Testler

```
PGHOST=/tmp PGPORT=5432 PGUSER=postgres test/veritabani_test.sh
```
Arayüz: `npm install && npm run build` (tip kontrolü + derleme), geliştirme için `npm run dev`.
Excel ayrıştırma: `node test/excel_import_test.mjs` (Excel değişince `--update` ile `test/fixtures/import_payload.json` yenilenir; veritabanı testi bu dosyayı kullanır).

İkisi de GitHub'da her push'ta otomatik çalışır. `main`'e gelen veritabanı değişiklikleri testler geçerse Supabase'e uygulanır.

## Yeni oda tipi eklemek
Excel'de Oda Tipleri, Odalar, Kontrol Adımları ve Envanter sayfalarına satır ekle, admin panelinden tekrar içe aktar. Her oda tipi için bir kez referans fotoğrafları çekilip adımlara eklenmeli.

## Sahaya çıkmadan önce
- Excel'de "Doğrulandı = Hayır" olan demirbaşları odada elle say.
- Her odanın QR etiketini (admin panelinden PDF) yazdırıp kapının iç yüzüne yapıştır.
- KVKK aydınlatma ve açık rıza metnini hukukçuya kontrol ettir.
- HK'ların telefonlarında uygulamayı ana ekrana ekle (iPhone'da bildirim için şart).
