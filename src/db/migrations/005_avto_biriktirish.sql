-- Tizim sozlamalari (kalit -> qiymat). Birinchisi: yangi arizani mos ustaga avtomatik biriktirish.
-- Boshliq yoki admin "Ustalar" sahifasida yoqadi/o'chiradi.
CREATE TABLE IF NOT EXISTS sozlamalar (
  kalit        VARCHAR(40)  PRIMARY KEY,
  qiymat       TEXT         NOT NULL,
  yangilangan  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  user_id      BIGINT       REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO sozlamalar (kalit, qiymat) VALUES ('avto_biriktirish', 'true') ON CONFLICT (kalit) DO NOTHING;
