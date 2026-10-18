# HK Kontrol — Teknik Tarif (v2, 19.10.2026)

## 1. Amaç
Housekeeping (HK) temizliğinden sonra odanın rehberli kamerayla kontrol edilmesi:
1. Odayı **kimin** temizlediği ve **kim kaç oda** yaptığı görülür.
2. Her temizliğin fotoğraf/video kaydı **15 gün** saklanır; misafir şikayetinde geri dönülüp bakılır.
3. AI, odadaki **eksik ve hataları** HK'ya anında söyler (açıkta kablo, eksik tuvalet kağıdı, yatak düzgün yapılmamış vb.). HK düzeltip sadece o yerleri tekrar çeker.
4. **Demirbaşlar** oda tipi listesiyle karşılaştırılır; eksik, düzelene kadar o odada **açık eksik** olarak kayıtlı kalır.
5. **Hasar bildirimi** ve **kayıp eşya (lost & found)** kaydı.

## 2. Ekip, roller, yetki

| Bölge | HK | Süpervizör |
|---|---|---|
| İstanbul (Beşiktaş otelleri) | 4 | 1 |
| İzmir (Urla) | 3 | 1 |
| Tümü | — | Admin (sayısı serbest; admin yeni admin ekleyebilir) |

- HK'lar bölgesindeki tüm otellerde çalışabilir (İstanbul ekibi iki otel arasında geçiyor).
- `hk`: Bölgesindeki odaları görür, odayı **kendisi seçer**, temizlik ve kontrol çekimi yapar, hasar ve kayıp eşya bildirir. Sadece kendi temizlik kayıtlarını görür.
- `supervisor`: Kendi bölgesindeki her şeyi görür, onaylar, açık eksikleri ve hasarları kapatır. Bölgenin onaycısı her zaman bu kişidir.
- `admin`: Her şeyi görür ve yönetir; kullanıcı (admin dahil), otel, oda, şablon, ayarlar. Her kaydı onaylayabilir.

## 3. Veri girişi
- **Temel veri** `data/HK_Veri_Toplama.xlsx` dosyasından gelir: Oteller, Oda Tipleri, Odalar, Kontrol Adımları, Envanter (ve varsa İkram). Admin panelinde **"Excel'den içe aktar"**: yükle → önizleme + hata listesi (bilinmeyen oda tipi kodu, tekrar eden oda no, boş adet vb.) → onayla. Tekrar yüklenince günceller, kopya oluşturmaz. "Minibar ve İkram" sayfası opsiyonel; minibar yok, sadece ikram satırları okunur.
- **Personel** admin panelinden eklenir: ad soyad, kullanıcı adı, rol, bölge, PIN. Pasife alma, PIN sıfırlama.
- **Günlük oda durumu** HotelRunner'dan gelir: `stayover` (konaklama devam), `checkout`, `vacant` (boş), `checkin`, `checkout_checkin` (aynı gün çıkış + giriş).
  - Faz 1: **HotelRunner API'si** (`GET /api/v2/apps/reservations`, tesis başına `token` + `hr_id`, sadece okuma, `undelivered=false`) ile saatte bir senkron. Edge Function `pms-sync` son değişen rezervasyonları `pms_reservations` tablosuna yazar, bugünün ve yarının oda durumlarını hesaplar. Oda eşlemesi: tesis + oda no (`rooms[].number`); Tiny Houses, PMS'te Tare Suites Urla altında `T1–T4` numaralarıyla gelir. Rezervasyonda oda no atanmamışsa o oda için durum üretilmez, admin ekranında uyarı olarak görünür.
  - Durum hesabı (gün D, iptal ve no_show hariç): aynı gün çıkış ve giriş varsa `checkout_checkin`, sadece çıkış varsa `checkout`, sadece giriş varsa `checkin`, giriş < D < çıkış ise `stayover`, hiçbiri yoksa `vacant`.
  - Süpervizör durumu elle değiştirebilir; elle girilen durum (`source = manual`) o gün için senkronla ezilmez. Admin "Şimdi senkronla" ile anında çekebilir.
  - Faz 3: yalnızca WhatsApp ve video kalır; API senkronu Faz 1'e alındı.

## 4. Giriş ve KVKK
- HK: kullanıcı adı + 6 haneli PIN (Supabase Auth'ta `kullaniciadi@hk.tare.local` + PIN). Süpervizör/admin: e-posta + şifre.
- İlk girişte KVKK aydınlatma metni ve açık rıza; onaysız kullanım yok, onay zamanı kaydedilir. Metin admin panelinden düzenlenir.
- Personel kendi telefonunu kullandığı için: medya galeriye düşmez, cihazda yüklenene kadar sadece uygulamanın kendi deposunda (IndexedDB) durur, yüklenince silinir. Çıkış yapınca cihazdaki bekleyen veri kullanıcıya sorulmadan silinmez; uyarı verilir.

## 5. HK akışı

### 5.1 Oda seçimi ve başlangıç
1. **Bugün** ekranı: bölgesindeki oteller → odalar, HotelRunner durumuna göre gruplu (Çıkış, Konaklama, Giriş, Boş), her odanın temizlik durumu (bekliyor / temizleniyor – kim / tamamlandı / sorunlu).
2. HK odayı seçer → odanın kapısındaki **QR'ı okutur** → "Temizliğe başla". QR uyuşmazsa başlatmaz. QR okunamıyorsa "QR'sız başlat" seçilebilir ama kayıt "QR yok" etiketi alır ve raporda görünür.
3. Opsiyonel: **"Birlikte temizleyen ekle"** → bölgedeki başka bir HK seçilir. Raporda oda iki kişiye de yazılır, "ortak" etiketiyle.
4. Temizlik türü odanın günlük durumundan gelir: `checkout`, `checkout_checkin`, `vacant`, `checkin` → **tam kontrol**; `stayover` → **konaklama kontrolü**. Durum bilinmiyorsa tam kontrol, kayıt "durum bilinmiyor" etiketi alır. HK değiştiremez, süpervizör değiştirebilir.

### 5.2 Rehberli kamera ("sanal kamera")
Temizlik bitince **"Kontrole başla"**. Kamera tam ekran açılır ve HK'yı adım adım yönlendirir:
- Üstte adım adı ve kısa talimat ("Çatal-bıçak çekmecesini tamamen aç, üstten çek"), altta ilerleme (7/17).
- Ekranda **referans fotoğrafın yarı saydam hayaleti** (overlay, açılıp kapanabilir): HK telefonu referansla aynı kadraja getirir.
- Adım `needs_flash` ise fener otomatik açılır (destekleyen cihazlarda; desteklemeyende "feneri aç" uyarısı).
- **Büyük "Çek" butonu.** Faz 3'te otomatik çekim: telefon ~1 sn sabit kalınca ve kadraj referansa yeterince benzeyince kendiliğinden çeker.
- Çekimden sonra cihazda hızlı kalite kontrolü (karanlık / bulanık) → kötüyse "Tekrar çek".
- Zorunlu adım atlanamaz; "Uygulanamıyor" sadece açıklama yazılarak seçilir.
- Fotoğraf sayısı: X3 tam kontrol 17 adım, yatak adımı 2 kare → ~18–20 fotoğraf, 3–4 dakika. Konaklama kontrolü ~8–10 fotoğraf, 1–2 dakika.
- Faz 3: Kontrol boyunca **kesintisiz düşük çözünürlüklü video** da kaydedilir (şikayet kanıtı); adım fotoğrafları yine ayrı yüksek kalite alınır (AI için).

### 5.3 AI kontrolü ve düzeltme döngüsü (Faz 2)
1. Her adım fotoğrafı yüklenince AI analiz eder; HK kontrolü bitirdiğinde sonuçlar 1 dakika içinde ekrana gelir.
2. **Sonuç ekranı:** yeşil adımlar ✓, sorunlu adımlar sorun açıklamasıyla ("Çarşaf sağ kenardan sarkıyor", "Yedek tuvalet kağıdı yok").
3. HK düzeltir → **"Düzelttim, tekrar çek"** → sadece sorunlu adımlar için kamera açılır → AI yeniden analiz eder.
4. Tüm adımlar yeşil → kayıt **onaylandı (AI)**. Ayar `manual_approval_required = true` ise yine süpervizör onayına gider.
5. `max_fix_attempts` (varsayılan 2) denemeden sonra hâlâ sorun varsa veya HK "Düzeltemiyorum" derse → kayıt **sorunlu (escalated)** olur, bölge süpervizörüne ve tüm adminlere bildirim gider. Herhangi biri inceleyip onaylayabilir veya not düşebilir.
6. **Demirbaş eksiği HK döngüsünü bloklamaz.** Sayım eksik çıkarsa:
   - O oda için **açık eksik** kaydı açılır (kalem, beklenen, görülen, tarih, ilk tespit eden kayıt) ve süpervizöre bildirim gider.
   - Aynı kalem için zaten açık kayıt varsa yenisi açılmaz, "son görülme" güncellenir.
   - Sonraki bir kontrolde adet tamamsa kayıt otomatik **kapanır**; süpervizör elle de kapatabilir ("yerine konuldu" notuyla).
7. Onaysız oda misafire verilebilir; sistem oda satışını engellemez.
8. Düzeltme için hedef süre yok (ileride ayar olarak eklenebilir).

### 5.4 Konaklama (stayover) kuralları
- Misafir eşyaları (bavul, kıyafet, kişisel eşya, misafirin yiyecekleri) **değerlendirilmez**, sorun sayılmaz; AI talimatına bu açıkça yazılır.
- Kullanımda olabileceği için mutfak demirbaş **sayımı yapılmaz**; adımın `applies_to` alanında `stayover` yoksa adım hiç gösterilmez.
- Kontrol edilenler: yatak, banyo temizliği, havlu/tuvalet kağıdı, çöp, genel düzen, açıkta kablo.

### 5.5 Hasar bildirimi
- Her ekrandan ulaşılan **"Hasar bildir"**: oda seç (veya içinde bulunulan oda), 1–3 fotoğraf, kategori (mobilya, elektrik, tesisat, boya/duvar, cihaz, tekstil, diğer), açıklama.
- Bildirim süpervizöre ve adminlere gider. Durum: açık → işlemde → giderildi (kapatan, tarih, not). Temizlik kaydından bağımsızdır.

### 5.6 Kayıp eşya (lost & found)
- **"Eşya buldum"**: oda, bulunma tarih-saati (otomatik), bulan HK, 1–3 fotoğraf, açıklama, teslim edildiği yer (resepsiyon / emanet dolabı vb.).
- Durum: saklanıyor → sahibine teslim edildi (kime, tarih, teslim eden) / imha-bağış (tarih, onaylayan).
- Arama: oda, tarih aralığı, açıklama metni.

## 6. Süpervizör ve admin ekranları
- **Canlı durum:** bölgedeki odalar ve temizlik durumları; kim hangi odada, kaç dakikadır.
- **Sorunlu kayıtlar:** escalated kayıtlar, adım fotoğrafları referansla yan yana, AI notlarıyla. "Onayla" / "Not ekle". AI sonucunu "yanlış alarm" işaretleme.
- **Açık eksikler:** otel/oda/kalem bazında liste, kapatma.
- **Hasar** ve **kayıp eşya** listeleri.
- **Bildirimler:** uygulama içi bildirim merkezi + Web Push (iPhone'da push için uygulamanın ana ekrana eklenmesi gerekir). WhatsApp Faz 3.
- **Admin:** kullanıcılar, oteller, odalar, oda tipleri/adımlar/demirbaşlar, Excel içe aktarma, HotelRunner senkron durumu, QR etiket PDF'i (oda no + otel + QR, A4'e 12'li), ayarlar, KVKK metni.

## 7. Raporlar (filtre: tarih aralığı, bölge, otel, kişi, oda tipi)
- **Personel:** oda sayısı (tam / konaklama / ortak ayrı), oda başına ortalama süre, AI'dan ilk seferde geçme oranı, düzeltme sayısı, escalated sayısı, en sık sorun türleri, QR'sız başlatma, minimum süreden kısa temizlikler.
- **Demirbaş eksikleri:** toplam eksik (kalem bazında adet), oda bazında, otel bazında; açık / kapanmış; ortalama kapanma süresi.
- **Hasar:** açık / kapanmış, kategori, otel.
- **Şikayet arama:** otel + oda + tarih → o günkü (ve öncesindeki son) kayıt, tüm medya, AI notları, kim temizledi, kim onayladı. "Şikayet var" işareti → medya silinmez.
- Tüm raporlar Excel (xlsx) dışa aktarılabilir.

## 8. AI analizi (Faz 2) — teknik
- Edge Function `analyze-step`: medya R2'ye yüklenip kayıt düşünce çalışır (DB trigger → `ai_queue` tablosu; fonksiyon kuyruğu işler).
- Girdi: adım fotoğrafı (uzun kenar 1280 px), varsa referans fotoğraf, adımın `ai_prompt`'u, `expected_items` (sadece tam kontrolde), temizlik türü.
- Talimat çerçevesi (sistem mesajı):
  - Sen bir otel housekeeping denetçisisin. İlk görsel referans (olması gereken), ikinci görsel bu temizlikten.
  - Beklenen kalemlerin her birini say. Göremiyorsan `observed: null` ver ve nedenini yaz; tahmin etme.
  - Adım sorularını cevapla. Sadece gerçekten gördüğün sorunu yaz.
  - Konaklama kontrolünde misafir eşyalarını değerlendirme.
  - Sadece JSON döndür.
- Çıktı:
```json
{
  "status": "ok | warn | fail | unclear",
  "items": [{"key": "fork", "expected": 6, "observed": 5, "confidence": 0.8}],
  "issues": [{"type": "loose_cable | bed_not_made | missing_supply | dirty | damage | guest_item_left | other",
              "note": "Kettle kablosu tezgahta açıkta", "severity": "low | medium | high", "fixable_by_hk": true}],
  "image_quality": "good | dark | blurry"
}
```
- `fixable_by_hk = true` sorunlar düzeltme döngüsüne girer; `items` eksikleri açık eksik kaydına gider (5.3/6); `damage` türü sorunlar HK'ya "Hasar bildirimi aç?" önerisi olarak çıkar.
- `image_quality` kötü → HK'dan o adımı tekrar çekmesi istenir.
- Her çağrının token kullanımı `ai_usage` tablosuna; adminde aylık maliyet özeti.

## 9. Medya ve saklama
- R2 bucket `hk-media`, anahtar: `{region}/{property}/{room_no}/{yyyy-mm-dd}/{cleaning_id}/{step_order}-{attempt}.jpg`; hasar ve kayıp eşya için `damage/…`, `lost/…`.
- Fotoğraf: JPEG, uzun kenar 1600 px, kalite ~0.75 (~200–300 KB). Faz 3 video: 480p, düşük bit hızı.
- Saklama: temizlik medyası **15 gün** (ayar). `complaint = true` olanlar silinmez. Hasar medyası kayıt kapandıktan 90 gün sonra, kayıp eşya medyası kayıt kapandıktan 1 yıl sonra silinir (ayar).
- Günlük zamanlanmış görev (Supabase cron) süresi dolan medyayı R2'den siler, kayıtta `media_deleted_at` işaretler.

## 10. Durumlar
`cleanings.status`: `in_progress` → `analyzing` → (`fixing` → `analyzing` …) → `approved` | `escalated` → `approved`
Faz 1'de (AI yokken): `in_progress` → `submitted` → `approved` (süpervizör) ; `cancelled` (süpervizör/admin).

## 11. Fazlar
**Faz 1 — Temel (AI yok)**
- Giriş/PIN, KVKK, roller, RLS
- Excel içe aktarma, personel yönetimi, QR PDF
- HotelRunner API senkronu (saatlik) + elle durum
- HK akışı: oda seçimi, QR, ortak temizleyen, rehberli kamera (adım fotoğrafı, referans hayaleti, fener, kalite kontrolü), çevrimdışı kuyruk, R2 yükleme
- Süpervizör onayı (Faz 1'de her kayıt `submitted` olur ve onaylanır)
- Hasar bildirimi, kayıp eşya
- Uygulama içi bildirimler
- Raporlar (personel, şikayet arama, hasar), Excel dışa aktarma
- 15 günlük saklama görevi

**Faz 2 — AI**
- `analyze-step`, sonuç ekranı, düzelt-tekrar çek döngüsü, otomatik onay, escalate + bildirim
- Açık demirbaş eksikleri (otomatik aç/kapat) ve eksik raporları
- Yanlış alarm işaretleme, `ai_usage` maliyet özeti
- Web Push

**Faz 3 — Video ve entegrasyon**
- Kontrol boyunca kesintisiz video, otomatik çekim (sabitlik + kadraj benzerliği)
- WhatsApp bildirimi
- Personel takip uygulamasına özet veri aktarımı (API)

## 12. Kabul kriterleri
- HK başka HK'nın temizlik kaydını göremez; İzmir süpervizörü İstanbul verisini göremez (otomatik RLS testi).
- Galeriden medya seçilemiyor; çekilen fotoğraf telefon galerisinde görünmüyor.
- İnternet kesikken çekilen tüm adımlar bağlantı gelince eksiksiz yükleniyor.
- X3 tam kontrol bir telefonda 5 dakikanın altında tamamlanıyor; konaklama kontrolü 2 dakikanın altında.
- Şikayet aramasında otel + oda + tarih ile ilgili kayıt ve fotoğraflar 2 tıkta açılıyor.
- (Faz 2) Sorunlu adım düzeltilip tekrar çekildiğinde sadece o adım yeniden analiz ediliyor.
