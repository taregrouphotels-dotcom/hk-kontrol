# Kurulum

Hepsi ücretsiz paketle çalışır. Gizli anahtarlar (service role, R2, HotelRunner, Anthropic) asla tarayıcıya ve repoya girmez.

## 1. Supabase (ayrı proje)
1. supabase.com → New project, bölge **Frankfurt (eu-central-1)**. Veritabanı şifresini sakla.
2. Authentication → Sign In / Providers → Email:
   - "Confirm email" **kapalı**
   - "Allow new users to sign up" **kapalı** (kullanıcıları admin açar)
3. Authentication → URL Configuration → Site URL: Cloudflare Pages adresi.
4. İlk admin: Authentication → Users → Add user → `gokcercakir@gmail.com`, şifre, "Auto confirm" işaretli. Bu hesap uygulamaya ilk girdiğinde admin profilini kendisi alır (sadece hiç admin yokken ve sadece bu e-postayla). Diğer kullanıcıları adminler uygulamadan açar.

## 2. GitHub: Supabase token'ı
Supabase projesi: `ihwyfllcvkcpjsouhsel` (Frankfurt). Kimlik iş akışına yazılı; GitHub'a sadece token girilir.

1. supabase.com'a gir → sağ üstte profil resmi → **Account preferences** → soldan **Access Tokens** → **Generate new token**. Ad: `hk-kontrol-github`. Çıkan değeri kopyala (bir daha gösterilmez).
2. github.com/taregrouphotels-dotcom/hk-kontrol → üstte **Settings** (dişli) → solda **Secrets and variables** → **Actions** → yeşil **New repository secret**.
3. Name: `SUPBASE_ACCESS_TOKEN` (A harfi eksik; iş akışı bu adı okur), Secret: kopyaladığın değer → **Add secret**.
4. **Actions** sekmesi → solda "Supabase güncelle" → **Run workflow**. Yeşil biterse veritabanı kurulmuştur.

Bundan sonra `main`'e gelen her veritabanı değişikliği ve Edge Function testler geçtikten sonra Supabase'e otomatik yüklenir.

## 3. Cloudflare (yayın)
Arayüz Cloudflare'de `hk-kontrol` adlı Worker olarak yayında; ayarlar repodaki `wrangler.jsonc`'de.
Yayını GitHub Actions yapar (`.github/workflows/deploy.yml`): `main`'e gelen her değişiklikten sonra testler geçerse yayınlanır.

1. Cloudflare → sağ üstte profil simgesi → **My Profile** → **API Tokens** → **Create Token** → **Edit Cloudflare Workers** şablonunda **Use template**.
2. Account Resources: kendi hesabın. Zone Resources: All zones. → **Continue to summary** → **Create Token** → çıkan değeri kopyala.
3. GitHub → hk-kontrol → Settings → Secrets and variables → Actions → **New repository secret**:
   - `CLOUDFLARE_API_TOKEN` = kopyaladığın değer
   - `CLOUDFLARE_ACCOUNT_ID` = Cloudflare → Workers & Pages sayfasının sağındaki **Account ID**
4. Cloudflare'in kendi Git derlemesi kapatılabilir (Worker → Settings → Build → Disconnect); iki yayın birbirini ezmez ama gereksizdir.

Supabase adresi ve publishable key koda yazılı; tarayıcıya giden değerlerdir, gizli değildir. Başka bir Supabase projesine geçilirse `VITE_SUPABASE_URL` ve `VITE_SUPABASE_ANON_KEY` ortam değişkenleriyle değiştirilir.

Yayın adresi Supabase → Authentication → URL Configuration → Site URL'e yazılır.

## 4. Cloudflare R2 (fotoğraflar)
1. R2'yi etkinleştir, `hk-media` adlı bucket aç (public erişim kapalı).
2. R2 → Manage API Tokens → sadece `hk-media` için *Object Read & Write*. Access Key ID, Secret Access Key ve Account ID'yi sakla.
3. Bucket CORS kuralı medya adımında verilecek.

## 5. Supabase → Edge Functions → Secrets
| Ad | Ne |
|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | R2 bilgileri (`R2_BUCKET=hk-media`) |
| `APP_ORIGIN` | Pages adresi |
| `HOTELRUNNER_CONNECTIONS` | Tesis başına HotelRunner API bilgisi, tek satır JSON: `[{"hr_id":"...","token":"..."}, ...]` (4 tesis) |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Faz 2 |

HotelRunner bilgileri, n8n'deki "HotelRunner Biriktirici" akışının dört HTTP düğümündeki `token` ve `hr_id` değerleridir. Uygulama HotelRunner'a sadece okuma isteği gönderir (`undelivered=false`).
