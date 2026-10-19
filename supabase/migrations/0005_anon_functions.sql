-- Giriş yapmamış kullanıcı hiçbir fonksiyonu çağıramaz.
-- 0002'deki "alter default privileges in schema public" PUBLIC'e verilen genel varsayılanı kaldıramıyordu;
-- bu yüzden 0003 ve 0004'teki fonksiyonlar anon'a açık kaldı (hepsi oturumsuz çağrıyı reddediyordu, veri sızmadı).
-- authenticated'ın yetkileri ayrı verildiği için etkilenmez.
revoke execute on all functions in schema public from anon, public;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
