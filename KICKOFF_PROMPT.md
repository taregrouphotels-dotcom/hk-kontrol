Bu repo, Tare otelleri için bağımsız bir housekeeping oda kontrol uygulaması (HK Kontrol). Önce şu dosyaları baştan sona oku:

- `CLAUDE.md` (proje kuralları ve teknoloji seçimi)
- `docs/SPEC.md` (teknik tarif v2: roller, HK akışı, rehberli kamera, AI düzeltme döngüsü, açık demirbaş eksikleri, hasar, kayıp eşya, raporlar, fazlar, kabul kriterleri)
- `supabase/schema.sql` (başlangıç şeması ve RLS; boş bir Postgres'te hatasız kuruluyor)
- `data/HK_Veri_Toplama.xlsx` (oteller, oda tipleri, odalar, kontrol adımları, envanter; admin panelindeki "Excel'den içe aktar" bu formatı okuyacak)
- `templates/X3.json` (X3 oda tipinin örnek şablonu; Excel ile çelişirse Excel geçerli)
- `config/team.json` (ekip büyüklüğü ve ilk admin; personel uygulamadan eklenecek)

Özet: İstanbul'da 4 HK + 1 süpervizör, İzmir'de (Urla) 3 HK + 1 süpervizör, sayısı serbest adminler. HK'lar kendi telefonlarını kullanıyor (Android + iPhone karışık), odayı kendileri seçiyor. Günlük oda durumu HotelRunner raporundan geliyor. Ücretsiz paketlerde kalmak için yayın Cloudflare Pages'ta, medya Cloudflare R2'de, veritabanı Supabase'de.

Şimdi sadece **Faz 1**'i yapacağız. Kodu yazmaya başlamadan önce:
1. Spec'te belirsiz veya çelişkili gördüğün noktaları liste halinde sor.
2. Faz 1 için klasör yapısını, sayfa listesini ve iş sırasını yaz (her adım tek commit büyüklüğünde).
3. Benim yapmam gereken hesap/kurulum işlerini sırala (Supabase, Cloudflare Pages, Cloudflare R2, ortam değişkenleri) ve her birinde ne yapacağımı kısaca anlat.
4. HotelRunner günlük raporundan örnek bir dosya iste; sütun eşlemesini ona göre kur.

Onayımdan sonra ilk adımla başla. Her adım bitince neyin çalıştığını ve telefondan nasıl test edeceğimi kısaca söyle.
