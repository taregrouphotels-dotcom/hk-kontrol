# Kararlar

Spec'te açık kalan noktalar için verilen kararlar. Değişirse burası ve `docs/SPEC.md` birlikte güncellenir.

| # | Konu | Karar |
|---|---|---|
| 1 | Repo | Ayrı private repo `hk-kontrol`. ShiftKeep (`personel-takip`) ile kod paylaşılmaz. |
| 2 | Supabase | Ayrı proje (Frankfurt). ShiftKeep veritabanıyla karışmaz. |
| 3 | `checkin` durumu | Tam kontrol. |
| 4 | Durumu bilinmeyen oda | Tam kontrol; kayıt "durum bilinmiyor" etiketi alır. |
| 5 | Günlük durum kaynağı | HotelRunner API'si, saatte bir (Faz 1). Süpervizör elle değiştirebilir; elle girilen durum o gün senkronla ezilmez. Genel müdürler admin rolüyle açılır. |
| 6 | Adımı olmayan oda tipleri | Geçici 5 adımlık genel şablon (Giriş, Banyo, WC, Yatak, Genel oda). Gerçek adımlar Excel'den gelince değişir. |
| 7 | Referans fotoğrafları | Admin veya süpervizör, rehberli kameranın "referans modu" ile oda tipi başına bir kez çeker. |
| 8 | Temizlik süresi | "Temizliğe başla" → "Kontrole başla". Kontrol süresi ayrı raporlanır. |
| 9 | HK'nın Bugün ekranı | Bölgedeki bugünkü kayıtların sadece durumu ve kişisi görünür; başkasının fotoğrafı ve geçmiş kaydı görünmez. |
| 10 | Çevrimdışı | Başlatma, kontrol ve gönderme internetsiz de çalışır, kuyruğa girer. QR, cihazdaki oda listesiyle doğrulanır. |
| 11 | Envanter | `item_catalog` tablosu eklenir; envanter oda tipine bağlanır, adım bağlantısı isteğe bağlı. Adeti boş satırlar içe aktarmayı durdurmaz, uyarıyla atlanır. |
| 12 | Max süre | Excel'deki Max. Süre / Max Süre Aktif Faz 1'e alınır (canlı panoda kırmızı, raporda "süre aşımı"). |
| 13 | AI talimatı, kare sayısı | Excel'e isteğe bağlı "Kare Sayısı" ve "AI Talimatı" sütunları; boşsa `templates/*.json` değeri. Diğer farklarda Excel geçerli. |
| 14 | Kalem fotoğrafları | Faz 1'de var: admin ekranından R2'ye yüklenir. |
| 15 | Temizliğe başlama | Tüm tesislerde "Temizliğe başla" düğmesiyle (QR yok; raporda "QR yok" sayılmaz). Ağ geçidi olan tesisler: Tare Houses Hotel, Tare Suites Beşiktaş, Tare Suites Urla. |
| 16 | Kapı / TTLock | Kapı bu uygulamadan hiçbir şekilde açılmaz. Tüm odalarda HK sadece "Temizliğe başla" der; QR ve konum kontrolü şimdilik yok. TTLock kilit numaraları (`rooms.ttlock_lock_id`, 32 kilit) ileride kilit kayıtlarını arka planda okuyup "HK kapıdaydı" doğrulaması için tutulur. |
| 17 | Oda temiz mi / dolu mu | Günlük durum (çıkış/giriş/konaklama/boş) yanında oda **temiz/kirli** ve **şu an dolu mu** hesaplanır. Çıkış saati (ayar `checkout_time`, 12:00) gelince çıkış odası kirli ve boş; çıkış günü 12:00'den önce temizliğe başlandıysa misafir erken çıkmış sayılır. Gönderilen temizlik (konaklama dahil) odayı temiz yapar. Giriş saati (`checkin_time`, 14:00) gelince giriş odası dolu sayılır; giriş olup oda kirliyse kutu kırmızı "Giriş · kirli!". Süpervizör odayı elle temiz/kirli işaretleyebilir. Hesap her sorguda o anki saate göre yapılır; ekran dakikada bir yenilenir. Eski günler için rezervasyon geçmişindeki çıkış tarihleri kullanılır. |
