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
| 15 | Temizliğe başlama | Kilidi TTLock olmayan tesislerde (Tare Village Urla, Tiny Houses: anahtar kutusu) QR yok, "Temizliğe başla" düğmesiyle başlanır; raporda "QR yok" sayılmaz. TTLock tesislerinde (ağ geçidi var: Tare Houses Hotel, Tare Suites Beşiktaş, Tare Suites Urla) ileride TTLock ile kapı/konum doğrulaması; o zamana kadar QR. |
