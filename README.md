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
| Excel'den içe aktarma | Admin → Veri: `HK_Veri_Toplama.xlsx` seçilir → önizleme (sayılar, hata ve uyarı listesi) → İçe aktar. Hata varsa hiçbir şey yazılmaz; tekrar yükleme günceller. Her oda tipinin kontrol adımı Excel'de: X3 videodan, diğer 17 tip `scripts/generate_steps.py` ile oda özelliklerinden (10–18 adım; balkon, teras, mutfak, kasa, küvet varsa ilgili adım). Adımı olmayan tipe geçici 5 adımlık şablon, adedi boş envanter satırları atlanır, minibar/ikram satırları ikram kalemi olarak eklenir. Testler: `test/import_test.sql`, `test/excel_import_test.mjs` |
| HotelRunner senkronu | `pms-sync` Edge Function saatte bir (Supabase cron) 4 tesisin son 2 günde değişen rezervasyonlarını okur (n8n kadar hafif; sadece oda no, tarih, durum, misafir bilgisi saklanmaz). Daha önce yapılmış rezervasyonların ilk dolumu Airtable kayıtlarından (`0009`), bugünün ve yarının oda durumunu hesaplar. Süpervizör/admin Bugün ekranında odaya dokunup durumu elle değiştirir; elle girilen o gün ezilmez. Admin: "Şimdi senkronla", hata ve odası eşleşmeyen rezervasyon listesi. Test: `test/pms_test.sql` |
| Oda temiz mi / dolu mu | Bugün ekranında her durum ayrı renk: **Giriş var, kirli** (koyu kırmızı), **Temizlenecek** (kırmızı), **Temizlik talebi** (turuncu), **Temizleniyor** (mavi), **Boş · temiz** (yeşil), **Çıkış** (mor, 12:00 öncesi), **Konaklama** (sarı), Kullanım dışı, Bilinmiyor. Otel başlığında temizlenecek / temizlenen sayısı. Çıkış 12:00, giriş 14:00 (ayar). Süpervizör "Temiz/Kirli işaretle"; HK ve süpervizör konaklayan odaya "Temizlik talebi" girer (`0016`). Hesap: `room_hk_state` (`0014`), test: `test/hk_state_test.sql` |
| Oda kullanım dışı | Süpervizör/admin odaya dokunup "Kullanım dışı" (tadilat vb.) ve bitiş tarihi girer; kutu siyah görünür, süre bitince kendiliğinden kalkar (`0011`) |
| HK temizlik akışı | HK Bugün ekranında odaya dokunur → oda sayfası → "Temizliğe başla" → isteğe bağlı birlikte temizleyen → "Temizlik bitti · Kontrole başla" → tam ekran rehberli kamera (adım, talimat, kontrol maddeleri, fener, referans hayaleti, karanlık/bulanık uyarısı, filigran) → "Uygulanamıyor" açıklamayla → "Kontrolü gönder". Her işlem ve fotoğraf cihazdaki çevrimdışı kuyruğa (IndexedDB) yazılır, sırayla gönderilir; üstte bekleyen sayısı ve "Tekrar dene" görünür. Fotoğraflar `media-sign` ile R2'ye yüklenir, yüklenince cihazdan silinir. Çıkışta gönderilmemiş işlem varsa uyarır |
| TTLock | Kapı uygulamadan açılmaz (karar 16). Odaların TTLock kilit numaraları veritabanında (`0012`), ileride kilit kayıtlarını arka planda okumak için |
| AI kontrolü | Fotoğraf yüklenince `analyze-step` (Claude Haiku 5.5) kontrol maddeleri ve referansla değerlendirir; HK çekim ekranında birkaç saniye içinde "Düzelt ve tekrar çek" uyarısını görür, adım çubuğu renklenir (yeşil/sarı/kırmızı). Süpervizör her karede AI rozeti ve notunu görür, "Yanlış alarm" ve "Referans yap" der; onay listesinde kaydın genel AI sonucu. İlk haftalar onay süpervizörde. Kuyruk ve dakikalık tarama: `0015`. AI anahtarı: admin → Veri → "AI anahtarı" (`0017`, geri okunamaz). Test: `test/hk_state_test.sql` |
| Hasar ve kayıp eşya | Başlıktaki **+** (ya da oda sayfası): "Hasar bildir" (oda, kategori, açıklama, 1–3 canlı fotoğraf) / "Eşya buldum" (oda, açıklama, teslim yeri, 1–3 fotoğraf). Kayıt ve fotoğraflar çevrimdışı kuyruğa girer. **Hasar & Eşya** sekmesi: herkes bölgesindekini görür; süpervizör/admin hasarı işleme alır / giderildi (not), eşyayı sahibine teslim (kime) / imha-bağış olarak kapatır, kim/ne zaman sunucuda yazılır. Kayıp eşyada oda no, açıklama ve tarih aralığıyla arama. Yeni kayıtta bölge süpervizörüne ve adminlere bildirim (`0018`) |
| Bildirimler | Başlıktaki zil: okunmamış sayısı, `#/bildirim` listesi; dokununca okundu olur ve ilgili kayda gider |
| Süpervizör onayı | Süpervizör/admin → **Onay** sekmesi: gönderilmiş kontroller (en eski üstte) ve bugün onaylananlar. Kayıt ekranı (`#/kayit/<id>`): kim, ne zaman, kaç dakika, adım adım fotoğraflar (dokununca tam ekran, referansla karşılaştırma, adımlar arasında gezinme), uygulanamayan adımlar ve nedenleri, yüklenmemiş kareler. Onayla, not, şikayet işaretle, kaydı iptal et. Fotoğraf adresleri `media-sign` (`cleaning`) ile tek çağrıda, kullanıcının yetkisiyle |
| Raporlar | **Raporlar** sekmesi (süpervizör/admin): Personel (oda sayısı, ortalama süre, süre aşımı, AI uyarısı), Şikayet arama, Hasar/Eşya; her biri Excel'e indirilir |
| Yönetim | Ayarlar (otomatik onay, fotoğraf saklama, AI maliyet ve doğruluk, AI anahtarı, depo testi) · Adımlar (oda tipi min/max süre, adım ekle/sil/sırala, Excel) · Excel içe aktarma |
| Referans çekim modu | Süpervizör/admin oda sayfasında "Referans çek": adımları sırayla çeker, her kare o oda tipinin referansı olur |
| Telefon bildirimi | Web Push (VAPID, `push-send` dakikada bir). Bildirim ekranından açılır; iPhone'da uygulama ana ekrana eklenmiş olmalı |
| Fotoğraf saklama | `retention` her gece: temizlik 15 gün, hasar 90 gün, kayıp eşya 365 gün; şikayetli kayıtlar saklanır |
| Demirbaş eksiği | AI tam temizlikte kalemleri sayar; eksik varsa Hasar & Eşya → Eksikler + bildirim |
| Otomatik onay | Kapalıyken her temizlik süpervizöre gider. Açılınca AI'ın hepsine "ok" dediği temizlik kendiliğinden onaylanır |
| Süre uyarısı | Max süre aktif oda tipinde süreyi aşan temizlik Bugün ekranında "⚠ dk" ile işaretlenir |
| Telegram özeti | n8n akışı "HK Kontrol Günlük Özet (Telegram)": 08:00 otel durumu, 20:00 kim ne yaptı (`daily_summary_auth`) |
| Oda tipi şablonları | X3, X1, X2 elle hazırlanmış şablon (`templates/*.json`): adım, kontrol maddesi, AI talimatı, envanter ve referans fotoğraf tarifi. Excel'e `python3 scripts/apply_room_templates.py data/HK_Veri_Toplama.xlsx templates/X1.json templates/X2.json` ile yazılır, sonra admin panelinden içe aktarılır. X1/X2 oda dosyası (3B yerleşim, plan, görünüş): https://claude.ai/artifact/8o4ebkhuqdPPa3d66kzEH3 |
| HotelRunner'a yazma | Kurulmadı: API'de oda temizlik durumu uç noktası yok (karar 21) |

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
