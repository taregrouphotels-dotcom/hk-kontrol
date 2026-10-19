-- Kapı uygulamadan açılmaz (karar 16, güncellendi): kapı açma kayıtları kaldırılır.
-- rooms.ttlock_lock_id ve ttlock_token, ileride kilit kayıtlarını arka planda okumak için kalır.
drop table door_unlocks;
