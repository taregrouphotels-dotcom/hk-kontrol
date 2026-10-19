# HK Kontrol

Tare otelleri (İstanbul + İzmir/Urla) için housekeeping oda kontrol uygulaması. HK temizlikten sonra odayı rehberli kamerayla çeker, süpervizör onaylar.

- Tarif: [docs/SPEC.md](docs/SPEC.md) · Kararlar: [docs/KARARLAR.md](docs/KARARLAR.md) · Kurulum: [docs/KURULUM.md](docs/KURULUM.md)
- Teknoloji ve kurallar: [CLAUDE.md](CLAUDE.md)

## Durum (Faz 1)

| Adım | Ne çalışıyor |
|---|---|
| Veritabanı | Şema, bölge bazlı yetki (RLS), temizlik başlatma/kontrol/gönderme/onay/iptal fonksiyonları, Bugün ekranı sorgusu. Testler: `test/veritabani_test.sh` |
| Arayüz iskeleti | Giriş (personel: kullanıcı adı + 6 haneli PIN; yönetici: e-posta + şifre), ilk girişte KVKK onayı, ilk adminin kendi profilini alması, Bugün ekranı (otel → Çıkış/Konaklama/Giriş/Boş, kim temizliyor), ana ekrana eklenebilir (PWA) |
| Personel yönetimi | Admin → Personel: HK (kullanıcı adı + PIN) ve süpervizör/admin (e-posta + şifre) hesabı açma, ad/rol/bölge düzenleme, PIN/şifre sıfırlama, pasife alma. Hesap işlemleri `admin-users` Edge Function'ında |

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

İkisi de GitHub'da her push'ta otomatik çalışır. `main`'e gelen veritabanı değişiklikleri testler geçerse Supabase'e uygulanır.

## Yeni oda tipi eklemek
Excel'de Oda Tipleri, Odalar, Kontrol Adımları ve Envanter sayfalarına satır ekle, admin panelinden tekrar içe aktar. Her oda tipi için bir kez referans fotoğrafları çekilip adımlara eklenmeli.

## Sahaya çıkmadan önce
- Excel'de "Doğrulandı = Hayır" olan demirbaşları odada elle say.
- Her odanın QR etiketini (admin panelinden PDF) yazdırıp kapının iç yüzüne yapıştır.
- KVKK aydınlatma ve açık rıza metnini hukukçuya kontrol ettir.
- HK'ların telefonlarında uygulamayı ana ekrana ekle (iPhone'da bildirim için şart).
