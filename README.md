# HK Kontrol — Başlangıç Paketi

## Projeyi açma
1. GitHub'da yeni **private** repo: `hk-kontrol`.
2. Bu klasördeki dosyaları yapıyı koruyarak repoya koy:
   ```
   CLAUDE.md
   KICKOFF_PROMPT.md
   README.md
   docs/SPEC.md
   supabase/schema.sql
   templates/X3.json
   config/team.json
   data/HK_Veri_Toplama.xlsx
   ```
3. `data/HK_Veri_Toplama.xlsx` yerine **doldurduğun Excel'i** aynı adla koy.
4. HotelRunner API bilgileri (tesis başına `token` + `hr_id`) Supabase Edge Function secret'ı olarak girilir; bkz. Kurulum.
5. Claude Code'da repoyu aç, `KICKOFF_PROMPT.md` içindeki metni ilk mesaj olarak yapıştır. Soruları cevapla, planı onayla.

## Açman gereken hesaplar (hepsi ücretsiz paketle başlar)
- **Supabase:** yeni proje, bölge Frankfurt (eu-central-1). Veritabanı, giriş, sunucu fonksiyonları.
- **Cloudflare:** Pages (uygulamanın yayını) + R2 (fotoğraf/video). R2 için kart bilgisi istenebilir; ücretsiz kota aşılmadıkça ücret çıkmaz.
- **Anthropic API anahtarı:** Faz 2 (AI) için.

## Yeni oda tipi eklemek
Excel'de Oda Tipleri, Odalar, Kontrol Adımları ve Envanter sayfalarına satır ekle, admin panelinden tekrar içe aktar. Her oda tipi için bir kez referans fotoğrafları çekilip adımlara eklenmeli.

## Sahaya çıkmadan önce
- Excel'de "Doğrulandı = Hayır" olan demirbaşları odada elle say.
- Her odanın QR etiketini (admin panelinden PDF) yazdırıp kapının iç yüzüne yapıştır.
- KVKK aydınlatma ve açık rıza metnini hukukçuya kontrol ettir.
- HK'ların telefonlarında uygulamayı ana ekrana ekle (iPhone'da bildirim için şart).
