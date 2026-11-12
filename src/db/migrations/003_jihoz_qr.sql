-- Har bir jihoz uchun QR-kod va «bitta jihoz — bitta ochiq ariza» qoidasi (ustoz taklifi).
-- Ikkinchi odam xuddi shu jihoz haqida yozsa, yangi ariza ochilmaydi — u mavjud arizaga qo'shiladi.
-- Fayl idempotent: qayta bajarilsa ham zarar qilmaydi.

-- 1. Jihoz QR tokeni: default bilan — jihoz yaratish, Excel import va seed kodi o'zgarmaydi
ALTER TABLE jihozlar ADD COLUMN IF NOT EXISTS qr_token VARCHAR(32);
UPDATE jihozlar SET qr_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) WHERE qr_token IS NULL;
ALTER TABLE jihozlar ALTER COLUMN qr_token SET DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
ALTER TABLE jihozlar ALTER COLUMN qr_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jihozlar_qr ON jihozlar (qr_token);

-- 2. Mavjud dublikatlar: bir jihozdagi ochiq arizalardan eng eskisi qoladi, qolganlari unga birlashtiriladi
CREATE TEMP TABLE dublikatlar ON COMMIT DROP AS
SELECT id, user_id, holat, asosiy FROM (
  SELECT id, user_id, holat, first_value(id) OVER (PARTITION BY jihoz_id ORDER BY id) AS asosiy
    FROM arizalar
   WHERE jihoz_id IS NOT NULL AND holat IN ('yangi', 'biriktirilgan', 'jarayonda', 'kutilmoqda', 'tekshiruvda')
) s
WHERE id <> asosiy;

INSERT INTO ariza_kuzatuvchilar (ariza_id, user_id)
SELECT d.asosiy, d.user_id FROM dublikatlar d JOIN arizalar a ON a.id = d.asosiy
 WHERE d.user_id <> a.user_id
ON CONFLICT DO NOTHING;

INSERT INTO ariza_tarix (ariza_id, eski_holat, yangi_holat, amal, izoh)
SELECT d.id, d.holat, 'rad_etilgan', 'birlashtirildi', 'Asosiy ariza: ' || a.raqam
  FROM dublikatlar d JOIN arizalar a ON a.id = d.asosiy;

UPDATE arizalar x
   SET holat = 'rad_etilgan', birlashtirilgan_id = d.asosiy, rad_sababi = 'Dublikat: ' || a.raqam, yangilangan = now()
  FROM dublikatlar d JOIN arizalar a ON a.id = d.asosiy
 WHERE x.id = d.id;

-- 3. Bitta jihozda faqat bitta ochiq ariza (bir vaqtda yuborilganda ham)
CREATE UNIQUE INDEX IF NOT EXISTS uq_arizalar_jihoz_ochiq ON arizalar (jihoz_id)
  WHERE jihoz_id IS NOT NULL AND holat IN ('yangi', 'biriktirilgan', 'jarayonda', 'kutilmoqda', 'tekshiruvda');
