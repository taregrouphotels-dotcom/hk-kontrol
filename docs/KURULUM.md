# Kurulum

Hepsi ücretsiz paketle çalışır. Gizli anahtarlar (service role, R2, HotelRunner, Anthropic) asla tarayıcıya ve repoya girmez.

## 1. Supabase (ayrı proje)
1. supabase.com → New project, bölge **Frankfurt (eu-central-1)**. Veritabanı şifresini sakla.
2. Authentication → Sign In / Providers → Email:
   - "Confirm email" **kapalı**
   - "Allow new users to sign up" **kapalı** (kullanıcıları admin açar)
3. Authentication → URL Configuration → Site URL: Cloudflare Pages adresi.
4. İlk admin: Authentication → Users → Add user → `gokcercakir@gmail.com`, şifre, "Auto confirm" işaretli. Rolü uygulamanın giriş adımında verilir.

## 2. GitHub → Settings → Secrets and variables → Actions
| Tür | Ad | Nereden |
|---|---|---|
| Secret | `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens → Generate |
| Variable | `SUPABASE_PROJECT_REF` | Project Settings → General → Reference ID (adresteki `xxxx.supabase.co` kısmı) |

Bunlar tanımlıysa `main`'e gelen her veritabanı değişikliği testler geçtikten sonra Supabase'e otomatik uygulanır (Actions → "Supabase güncelle").

## 3. Cloudflare Pages
Workers & Pages → Create → Pages → Connect to Git → `hk-kontrol`.
Build command `npm run build`, output `dist`. Ortam değişkenleri:
- `VITE_SUPABASE_URL` = Project URL
- `VITE_SUPABASE_ANON_KEY` = anon (publishable) key

Bu ikisi tarayıcıya gider, gizli değildir.

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
