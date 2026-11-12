-- Jihoz QR-kodi endi avtomatik berilmaydi: admin yoki boshliq "QR-kod yaratish" tugmasini bosganda
-- yaratiladi (bitta jihozga, xonaga yoki butun binoga, jihoz turi bo'yicha tanlab).
ALTER TABLE jihozlar ALTER COLUMN qr_token DROP DEFAULT;
ALTER TABLE jihozlar ALTER COLUMN qr_token DROP NOT NULL;

-- 003 avtomatik bergan kodlar hali chop etilmagan — tozalanadi, kodlarni admin o'zi yaratadi.
-- (uq_jihozlar_qr unikal indeksi qoladi: bir nechta NULL ga ruxsat beradi.)
UPDATE jihozlar SET qr_token = NULL WHERE qr_token IS NOT NULL;
