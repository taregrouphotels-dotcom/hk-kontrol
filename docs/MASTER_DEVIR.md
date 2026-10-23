# HK Kontrol · Ana ekrana devir notu

Bu not, HK Kontrol'ü diğer Tare uygulamalarıyla tek ana ekran altında birleştirecek "master" proje için yazıldı. Ayrıntı: `README.md` (ne çalışıyor), `docs/SPEC.md` (tarif), `docs/KARARLAR.md` (verilen kararlar), `docs/KURULUM.md` (kurulum).

## 1. Amaç ve modüller
Tare otellerinde (İstanbul + İzmir/Urla, 5 tesis, 40 oda) housekeeping oda kontrolü. Kat görevlisi (HK) temizliği bitirince uygulama içi canlı kamerayla adım adım fotoğraf çeker. Fotoğrafları AI (Claude) kontrol maddelerine ve referans fotoğrafa göre değerlendirir, süpervizör onaylar. Modüller:
- **Bugün:** otel ve oda durumu (HotelRunner'dan giriş/çıkış/konaklama, kirli/temiz, kim temizliyor)
- **Oda sayfası ve temizlik akışı:** QR ile oda açma, rehberli çekim, çevrimdışı yükleme kuyruğu
- **Onay:** süpervizör kontrolü
- **Hasar & Eşya:** hasar, kayıp eşya, demirbaş eksikleri
- **Raporlar:** Excel'e aktarılır
- **Personel:** hesap açma, PIN sıfırlama
- **Yönetim:** ayarlar, AI anahtarı, kontrol adımları, Excel içe aktarma, QR PDF
- **Bildirimler:** uygulama içi + Web Push

Kapı uygulamadan **hiçbir şekilde açılmaz** (karar 16).

## 2. Teknoloji ve yayın
- **Arayüz:**
  - Vite 5 + React 18 + TypeScript + Tailwind 3
  - Ayrı bir yönlendirme kütüphanesi yok; adres çubuğunda `#/...` hash yönlendirmesi
  - Kütüphaneler: `@supabase/supabase-js` 2.45, `jsqr` (QR), `read-excel-file` / `write-excel-file`
- **Yayın:** Cloudflare **Workers statik varlık** (Pages değil); ayar `wrangler.jsonc`, Worker adı `hk-kontrol`.
  - Adres: https://hk-kontrol.taregrouphotels.workers.dev
  - Yayın GitHub Actions `deploy.yml` ile `main`'e push'ta yapılır.
  - Tek sayfa uygulama: bilinmeyen adresler `index.html`'e düşer.
- **Arka uç:** Supabase (Postgres, Auth, Edge Functions, pg_cron + pg_net).
- **Medya:** Cloudflare R2. Yükleme ve izleme, Edge Function'ın ürettiği süreli imzalı URL ile yapılır.

## 3. Supabase ve giriş
- **Project ref:** `ihwyfllcvkcpjsouhsel` (https://ihwyfllcvkcpjsouhsel.supabase.co). Publishable key `src/lib/supabase.ts` içinde yazılı; tarayıcıya giden değer olduğu için gizli değildir.
- **Giriş yöntemi:** Supabase Auth, e-posta + şifre (`signInWithPassword`).
  - **HK:** kullanıcı adı + 6 haneli PIN. Uygulama kullanıcı adını Auth tarafında `kullaniciadi@hk.tare.local` e-postasına çevirir (`hkEmail()`).
  - **Süpervizör / admin:** gerçek e-posta + şifre.
- **Hesap açma:** Kendi kendine kayıt yok. Hesapları admin/süpervizör, Personel ekranından `admin-users` Edge Function'ı ile açar.
- **İlk admin:** İlk admin, `claim_first_admin()` ile kendi profilini alır (`config/` + `0004`).
- **Giriş sonrası kontroller:** `profiles.active = false` ise oturum kapatılır. `consent_at` boşsa önce KVKK onay ekranı gelir.

## 4. Kullanıcı ve rol yapısı
- **Tablo:** `public.profiles`
  - Alanlar: `id` (= auth.users.id), `full_name`, `username` (benzersiz, HK için), `role`, `region`, `active`, `consent_at`
  - `role` (enum `user_role`): `hk` | `supervisor` | `admin`
  - `region` (enum `region`): `istanbul` | `izmir`. HK ve süpervizör için zorunlu, admin için boş.
- **Kim neyi görür:**
  - **HK:** kendi bölgesinin otelleri ve odaları, kendi temizlikleri. Sekmeler: Bugün, Hasar & Eşya.
  - **Süpervizör:** kendi bölgesinin her şeyi; onay, raporlar, bölgesinde HK hesabı açma/PIN sıfırlama. Sekmeler: Bugün, Onay, Hasar & Eşya, Raporlar, Personel.
  - **Admin:** her bölge, her şey. Ek olarak Yönetim sekmesi (ayarlar, adımlar, içe aktarma, AI anahtarı).
- Sekme ve rol eşlemesi `src/pages/Main.tsx` → `TABS`.
- **Ana ekran için not:** Rol tek alan ve bu uygulamaya özel. Modül bazlı yetki tablosu yok. Master projede "kullanıcı → modül → rol" yapısı kurulursa `profiles.role` ya ondan beslenmeli ya da ona eşlenmeli.

## 5. Tablolar
`[ORTAK]` işaretliler diğer otel uygulamalarıyla ortak olmaya aday.

**public**
- `properties` [ORTAK]: tesis/otel (ad, şehir, bölge, ilçe, kat, `pms_name` = HotelRunner adı)
- `room_types` [ORTAK]: oda tipi kodu (X1, X2…), min/max süre
- `rooms` [ORTAK]: tesis + oda no, oda tipi, kat, QR token, TTLock kilit no (`0012`)
- `profiles` [ORTAK]: kullanıcı, rol, bölge (bkz. 4)
- `pms_reservations` [ORTAK]: HotelRunner rezervasyonları (sadece oda no, tarih, durum; misafir bilgisi tutulmaz)
- `pms_sync_runs`: senkron kayıtları
- `room_day_status` [ORTAK]: odanın gün durumu (stayover / checkout / vacant / checkin / checkout_checkin)
- `room_blocks` [ORTAK]: kullanım dışı oda (tadilat vb.)
- `room_hk_marks`: süpervizörün temiz/kirli işareti
- `check_steps`, `expected_items`, `item_catalog`: kontrol adımları, oda tipi envanteri, kalem kataloğu
- `cleanings`, `cleaning_members`, `step_results`, `cleaning_requests`: temizlik kaydı, birlikte temizleyenler, adım fotoğrafları ve AI sonucu, temizlik talepleri
- `ai_queue`, `ai_usage`: AI kuyruğu ve maliyet
- `damage_reports`, `lost_items`, `inventory_issues`, `report_media`: hasar, kayıp eşya, demirbaş eksiği ve fotoğrafları
- `notifications`, `push_subscriptions`: bildirim merkezi ve Web Push abonelikleri
- `settings`: uygulama ayarları (otomatik onay, saklama süreleri vb.)
- `door_unlocks`, `ttlock_token`: TTLock için ayrılmış. Kapı açma kapalı (`0013`), sadece kilit eşlemesi ve ileride kayıt okuma için.

**ops** (tarayıcıdan erişilmez)
- `app_secrets`: admin ekranından girilen anahtarlar; değer geri okunamaz, sadece Edge Function'lar okur
- `cron_key`, `push_queue`

Şema: `supabase/migrations/0001` … `0022`. Excel'den toplu veri: `import_master_data(p jsonb, p_apply boolean)` RPC'si (`0006`).

## 6. RLS özeti
- Her tabloda RLS açık (59 politika).
- Yardımcı fonksiyonlar: `my_role()`, `my_region()`, `room_region(room)`, `is_admin()`, `is_region_sup(room)`.
- **Kural:**
  - Admin her şeyi görür ve yazar.
  - Süpervizör sadece kendi bölgesinin odalarına bağlı kayıtları görür ve yönetir.
  - HK kendi bölgesinin odalarını görür; kendi temizliğini başlatır ve yazar, başkasınınkini değiştiremez.
  - Pasif kullanıcı hiçbir şey göremez.
- Kritik işlemler `security definer` RPC'lerle yapılır; doğrudan tablo yazma kapalı. Örnekler: temizlik başlatma, gönderme, onay, iptal, demirbaş sayımı (`apply_inventory`), temiz/kirli işareti.
- Bazı iç fonksiyonlar (`room_hk_state`, `refresh_cleaning_ai`, `media_to_delete`) tarayıcıdan çağrılamaz.
- Testler: `test/veritabani_test.sh` (`rls_test.sql`, `import_test.sql` vb.).

## 7. Edge Function'lar ve dış servisler
| Function | Ne yapar | Tetik |
|---|---|---|
| `admin-users` | Hesap açma, PIN/şifre sıfırlama, pasifleştirme | Arayüz (admin/süpervizör) |
| `media-sign` | R2 için süreli yükleme/izleme URL'si | Arayüz |
| `analyze-step` | Adım fotoğrafını Claude ile değerlendirir | Yükleme sonrası + `ai-sweep` cron (dakikada bir) |
| `pms-sync` | HotelRunner'dan rezervasyon okur (sadece okuma) | cron, saatte bir (`10 * * * *`) |
| `push-send` | Web Push gönderir | cron, dakikada bir |
| `retention` | Süresi dolan fotoğrafları R2'den siler (temizlik 15, hasar 90, kayıp eşya 365 gün) | cron, her gece 00:30 |

Dış servisler:
- **Cloudflare R2:** fotoğraf deposu.
- **Anthropic Claude API:** görsel analiz. Model `CLAUDE_MODEL` ayarından okunur.
- **HotelRunner API:** sadece okuma; HotelRunner'a yazma yok (karar 21).
- **Web Push (VAPID).**
- **n8n akışı "HK Kontrol Günlük Özet (Telegram)":** 08:00 ve 20:00 özet, `daily_summary_auth` ile veri okur.
- **TTLock:** kilit eşlemesi var, kapı açma yok.

## 8. Ortam değişkenleri ve secret'lar (sadece adlar)
- **Arayüz (Vite, isteğe bağlı; yoksa koddaki varsayılan proje kullanılır):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Edge Function secrets (Supabase):**
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase'in kendisi verir)
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  - `HOTELRUNNER_CONNECTIONS`
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
  - `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`
  - `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` ve VAPID anahtarları `ops.app_secrets`'tan da okunabilir (admin ekranından girilir).
  - Ayrıca `ops.app_secrets` içinde `hotelrunner_api`, `hotelrunner_upload`.
- **GitHub Actions secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPBASE_ACCESS_TOKEN`
  - Dikkat: workflow'larda ad **SUPBASE** diye yazılı (A harfi eksik). Repoda bu adla tanımlı olmalı.
- **Workflow'lar:** `ci.yml` (test), `deploy.yml` (Cloudflare), `functions.yml` (Edge Function yayını), `supabase.yml` (migration), `ops.yml` (elle: kullanıcı/secret işlemleri).

## 9. Sayfa adresleri ve PWA
Hash yönlendirmesi (`#/...`), kök `/`:
- **Alt sekmeler:**
  - `#/`: Bugün
  - `#/onay`: Onay
  - `#/kayitlar`: Hasar & Eşya
  - `#/raporlar`: Raporlar
  - `#/personel`: Personel
  - `#/veri`: Yönetim
- **Alt sayfalar:**
  - `#/oda/<oda id>`: oda sayfası
  - `#/qr/<qr token>`: QR etiketinden oda açma
  - `#/cek/<temizlik id>`: çekim ekranı
  - `#/kayit/<temizlik id>`: temizlik kaydı
  - `#/referans/<oda id>`: referans çekim (süpervizör/admin)
  - `#/bildir/<tür>[/<oda id>]`: hasar/eşya formu
  - `#/bildirim`: bildirimler
  - Tanımlar `src/pages/Main.tsx` içinde.

PWA:
- **Manifest:** `public/manifest.webmanifest`
  - Ad "HK Kontrol", `start_url` ve `scope` `/`, `standalone`, dikey
  - İkonlar `icon-192.png` ve `icon-512.png`
- **Service worker:** `public/sw.js`, önbellek `hk-kabuk-v1`. Sadece üretimde kaydedilir (`src/main.tsx`).
  - Kabuğu ve `/assets/` dosyalarını önbellekler.
  - Supabase ve diğer adreslerin isteklerini önbelleğe almaz.
  - Web Push'u da bu dosya karşılar.
- **Ana ekran için not:** `scope` ve `start_url` şu an `/`. Uygulama ortak bir adresin alt yoluna (ör. `/hk/`) taşınırsa şunlar güncellenmeli:
  - Vite `base`, manifest `scope`/`start_url`
  - Service worker'ın kayıt yolu ve önbelleğe aldığı yollar
  - Push bildirimlerinin açtığı adresler
  - Supabase Auth → URL Configuration'daki Site URL

## 10. Yarım kalan işler ve bilinen sorunlar
- **Sahaya çıkmadan önce yapılacaklar:**
  - Excel'de "Doğrulandı = Hayır" olan demirbaşlar odada elle sayılacak
  - Oda QR etiketleri yazdırılacak
  - KVKK metni hukukçuya kontrol ettirilecek
- **X1/X2/X3 şablonlarında teyit bekleyenler:**
  - Ölçüler tahmini. X3 için Excel 28 m² diyor, çizimde yaklaşık 22 m² çıktı.
  - X2 yuvarlak aplik konumları
  - X3 banyo yerleşimi
  - X3 giriş kapısının şifreli kilit olup olmadığı
  - X3 kase ve su adedi; ikram tepsisindeki çay/kahve/şeker adedi (Excel'de boş, içe aktarmada atlanıyor)
- **Diğer tesislerin oda tipleri:** Tare Houses dışındakiler fotoğraf kataloğundan otomatik üretildi. Kontrol adımları elle gözden geçirilmedi.
- **Faz 3 işleri yapılmadı:**
  - Otomatik çekim (kadraj referansa benzeyince)
  - Kesintisiz düşük çözünürlüklü video
  - WhatsApp bildirimi
- **HotelRunner:** Rezervasyonda oda no atanmamışsa o oda için durum üretilmez, admin ekranında uyarı çıkar. HotelRunner'a temizlik durumu yazmak mümkün değil (API'de uç nokta yok).
- **iPhone push:** Bildirim için uygulama ana ekrana eklenmiş olmalı.
- **Doküman tutarsızlığı:** `CLAUDE.md` yayın için "Cloudflare Pages" diyor; gerçekte Cloudflare Workers statik varlık kullanılıyor.
- **Bilinmiyor:** Diğer uygulamaların (personel-takip, Kasa) aynı Supabase projesini kullanıp kullanmadığı.
