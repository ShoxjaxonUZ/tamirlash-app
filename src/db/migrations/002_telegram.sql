-- Telegram orqali bildirishnomalar (TZ, FR-7.4).
-- Foydalanuvchi profilida botni ulaydi; Telegram ulangan foydalanuvchining har bir bildirishnomasi
-- yuborish navbatiga (tg_holat = 'kutilmoqda') tushadi va alohida jarayon uni yetkazadi.

ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_chat_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tg_chat ON users (tg_chat_id) WHERE tg_chat_id IS NOT NULL;

-- Bir martalik ulash havolalari (t.me/<bot>?start=<token>), 15 daqiqa amal qiladi
CREATE TABLE IF NOT EXISTS tg_ulash (
  token        VARCHAR(40) PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amal_qiladi  TIMESTAMPTZ NOT NULL
);

ALTER TABLE bildirishnomalar
  ADD COLUMN IF NOT EXISTS tg_holat   VARCHAR(10) CHECK (tg_holat IN ('kutilmoqda', 'yuborildi', 'xato')),
  ADD COLUMN IF NOT EXISTS tg_urinish SMALLINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_bildirishnomalar_tg ON bildirishnomalar (id) WHERE tg_holat = 'kutilmoqda';

-- Bildirishnoma qayerdan yozilmasin (ilova, rejalashtiruvchi), Telegram navbatiga shu yerda qo'yiladi
CREATE OR REPLACE FUNCTION bildirishnoma_tg() RETURNS trigger AS $$
BEGIN
  IF NEW.tg_holat IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND tg_chat_id IS NOT NULL) THEN
    NEW.tg_holat := 'kutilmoqda';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bildirishnoma_tg ON bildirishnomalar;
CREATE TRIGGER trg_bildirishnoma_tg
  BEFORE INSERT ON bildirishnomalar
  FOR EACH ROW EXECUTE FUNCTION bildirishnoma_tg();
