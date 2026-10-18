# HK Kontrol — Proje Kuralları

Tare otelleri (İstanbul + İzmir/Urla) için bağımsız housekeeping oda kontrol uygulaması.
Detaylı tarif: `docs/SPEC.md`. Verilen kararlar: `docs/KARARLAR.md`. Veritabanı: `supabase/schema.sql`. Temel veri: `data/HK_Veri_Toplama.xlsx`. Örnek şablon: `templates/X3.json`.

## Teknoloji (ücretsiz paketlere sığacak şekilde seçildi)
- **Arayüz:** Vite + React + TypeScript + Tailwind CSS, PWA (manifest + service worker, Web Push)
- **Yayın:** Cloudflare Pages
- **Veritabanı, giriş, sunucu fonksiyonları:** Supabase (Postgres, Auth, Edge Functions, Realtime)
- **Fotoğraf/video depolama:** Cloudflare R2 (Supabase Storage kullanılmayacak; ücretsiz 1 GB limiti yetmiyor). Yükleme ve izleme, Edge Function'ın ürettiği süreli imzalı URL ile.
- **AI:** Anthropic Claude API (görsel analiz), sadece Edge Function içinden çağrılır. Model adı `CLAUDE_MODEL` ortam değişkeninden okunur.

## Kurallar
- Arayüz dili **Türkçe**. Kod, değişken ve tablo adları İngilizce.
- Önce **mobil**. HK'lar kendi telefonlarını kullanıyor, modeller karışık (Android + iPhone): Chrome ve Safari'de test et. Büyük butonlar, tek elle kullanım.
- Fotoğraf/video **sadece uygulama içi canlı kameradan** alınır (`getUserMedia`). Galeriden seçme yok. Çekilen medya **telefonun galerisine kaydedilmez**; yüklenene kadar uygulamanın kendi deposunda (IndexedDB) bekler, yüklenince cihazdan silinir.
- Her medyaya çekim anında filigran: otel, oda no, kişi, tarih-saat, adım no.
- Yetki kontrolü veritabanında **RLS** ile; sadece arayüzde gizlemek yeterli değil.
- Gizli anahtarlar (Supabase service role, R2, Anthropic) asla tarayıcıya gitmez.
- Saat dilimi `Europe/Istanbul`; tarih gg.aa.yyyy, saat 24 saat.
- Zayıf internet varsayılır: çevrimdışı kuyruk, yükleme durumu ekranda görünür, yarım kalan yükleme kaldığı yerden devam eder.
- Veri kaynağı önceliği: `data/HK_Veri_Toplama.xlsx` > `templates/*.json`.

## Çalışma şekli
- Fazlara sadık kal (`docs/SPEC.md` → Fazlar). Bir faz bitmeden sonrakine geçme.
- Her özellik bitince: kısa test, `README` güncelle, commit.
- Şema değişikliği `supabase/migrations/` altında yeni migration olarak.
- Emin olmadığın iş kuralında varsayım yapma, sor.
