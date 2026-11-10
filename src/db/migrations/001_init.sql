-- Ta'mirlash arizalari tizimi: boshlang'ich sxema (TZ, 5-bo'lim).
-- Joylar ierarxiyasi: bino → xona → jihoz. Arizalar o'chirilmaydi, faqat holati o'zgaradi.

CREATE TABLE IF NOT EXISTS users (
  id                  BIGSERIAL PRIMARY KEY,
  ism                 VARCHAR(60)  NOT NULL,
  familiya            VARCHAR(60)  NOT NULL,
  login               VARCHAR(40)  NOT NULL,
  parol_hash          VARCHAR(100) NOT NULL,
  rol                 VARCHAR(10)  NOT NULL CHECK (rol IN ('user', 'usta', 'boshliq', 'admin')),
  toifa               VARCHAR(10)  CHECK (toifa IN ('talaba', 'oqituvchi', 'xodim')),
  telefon             VARCHAR(13),
  faol                BOOLEAN      NOT NULL DEFAULT TRUE,
  parol_almashtirish  BOOLEAN      NOT NULL DEFAULT FALSE,
  yaratilgan          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_login ON users (lower(login));
CREATE INDEX IF NOT EXISTS idx_users_rol ON users (rol) WHERE faol;

-- Ustaning mutaxassisliklari (bir usta bir nechta sohani biladi)
CREATE TABLE IF NOT EXISTS usta_mutaxassislik (
  user_id        BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutaxassislik  VARCHAR(12) NOT NULL CHECK (mutaxassislik IN ('kompyuter', 'mebel', 'elektr', 'santexnika', 'umumiy')),
  PRIMARY KEY (user_id, mutaxassislik)
);

CREATE TABLE IF NOT EXISTS binolar (
  id             BIGSERIAL PRIMARY KEY,
  nomi           VARCHAR(60)  NOT NULL,
  manzil         VARCHAR(200),
  qavatlar_soni  SMALLINT     NOT NULL DEFAULT 1 CHECK (qavatlar_soni BETWEEN 1 AND 50)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_binolar_nomi ON binolar (lower(nomi));

CREATE TABLE IF NOT EXISTS xonalar (
  id        BIGSERIAL PRIMARY KEY,
  bino_id   BIGINT      NOT NULL REFERENCES binolar(id) ON DELETE RESTRICT,
  qavat     SMALLINT    NOT NULL CHECK (qavat BETWEEN -5 AND 50),
  raqam     VARCHAR(20) NOT NULL,
  turi      VARCHAR(12) NOT NULL DEFAULT 'auditoriya'
            CHECK (turi IN ('auditoriya', 'laboratoriya', 'ofis', 'zal', 'boshqa')),
  qr_token  VARCHAR(32) NOT NULL UNIQUE,
  faol      BOOLEAN     NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_xonalar_raqam ON xonalar (bino_id, lower(raqam));

CREATE TABLE IF NOT EXISTS jihoz_turlari (
  id             BIGSERIAL PRIMARY KEY,
  nomi           VARCHAR(60) NOT NULL,
  mutaxassislik  VARCHAR(12) NOT NULL CHECK (mutaxassislik IN ('kompyuter', 'mebel', 'elektr', 'santexnika', 'umumiy')),
  tartib         SMALLINT    NOT NULL DEFAULT 100
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_jihoz_turlari_nomi ON jihoz_turlari (lower(nomi));

CREATE TABLE IF NOT EXISTS jihozlar (
  id               BIGSERIAL PRIMARY KEY,
  xona_id          BIGINT      NOT NULL REFERENCES xonalar(id) ON DELETE RESTRICT,
  tur_id           BIGINT      NOT NULL REFERENCES jihoz_turlari(id) ON DELETE RESTRICT,
  belgi            VARCHAR(40) NOT NULL,                 -- "#3", "deraza yonidagi"
  inventar_raqami  VARCHAR(40),
  faol             BOOLEAN     NOT NULL DEFAULT TRUE,    -- false = hisobdan chiqarilgan
  yaratilgan       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_jihozlar_inventar ON jihozlar (lower(inventar_raqami)) WHERE inventar_raqami IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jihozlar_xona ON jihozlar (xona_id);

-- Har yil uchun ariza raqamlari ketma-ketligi: T-2026-0001
CREATE TABLE IF NOT EXISTS ariza_raqamlari (
  yil     SMALLINT PRIMARY KEY,
  oxirgi  INTEGER  NOT NULL
);

CREATE TABLE IF NOT EXISTS arizalar (
  id                   BIGSERIAL PRIMARY KEY,
  raqam                VARCHAR(20)  NOT NULL UNIQUE,
  user_id              BIGINT       NOT NULL REFERENCES users(id),
  xona_id              BIGINT       NOT NULL REFERENCES xonalar(id),
  jihoz_id             BIGINT       REFERENCES jihozlar(id),
  tur_id               BIGINT       NOT NULL REFERENCES jihoz_turlari(id),
  joy_izohi            VARCHAR(200),
  tavsif               TEXT         NOT NULL CHECK (char_length(tavsif) BETWEEN 10 AND 2000),
  muhimlik             VARCHAR(12)  NOT NULL CHECK (muhimlik IN ('past', 'orta', 'yuqori', 'shoshilinch')),
  holat                VARCHAR(14)  NOT NULL DEFAULT 'yangi'
                       CHECK (holat IN ('yangi', 'biriktirilgan', 'jarayonda', 'kutilmoqda', 'tekshiruvda', 'yopilgan', 'rad_etilgan')),
  usta_id              BIGINT       REFERENCES users(id),
  muddat               TIMESTAMPTZ  NOT NULL,
  almashtirish_kerak   BOOLEAN      NOT NULL DEFAULT FALSE,
  almashtirish_sababi  VARCHAR(500),
  rad_sababi           VARCHAR(500),
  birlashtirilgan_id   BIGINT       REFERENCES arizalar(id),
  baho                 SMALLINT     CHECK (baho BETWEEN 1 AND 5),
  baho_izohi           VARCHAR(500),
  yaratilgan           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  yangilangan          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  bajarilgan           TIMESTAMPTZ,              -- usta "Bajarildi" bosgan vaqt
  yopilgan             TIMESTAMPTZ,
  muddat_yaqin_xabar   BOOLEAN      NOT NULL DEFAULT FALSE,
  muddat_otdi_xabar    BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT arizalar_usta_chk CHECK (holat NOT IN ('biriktirilgan', 'jarayonda', 'kutilmoqda', 'tekshiruvda') OR usta_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_arizalar_holat ON arizalar (holat);
CREATE INDEX IF NOT EXISTS idx_arizalar_usta ON arizalar (usta_id, holat);
CREATE INDEX IF NOT EXISTS idx_arizalar_xona ON arizalar (xona_id);
CREATE INDEX IF NOT EXISTS idx_arizalar_user ON arizalar (user_id);
CREATE INDEX IF NOT EXISTS idx_arizalar_jihoz ON arizalar (jihoz_id) WHERE jihoz_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_arizalar_yaratilgan ON arizalar (yaratilgan);

-- "Menda ham shu muammo" bosganlar va birlashtirilgan dublikatlar egalari
CREATE TABLE IF NOT EXISTS ariza_kuzatuvchilar (
  ariza_id   BIGINT      NOT NULL REFERENCES arizalar(id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qoshilgan  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ariza_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_kuzatuvchilar_user ON ariza_kuzatuvchilar (user_id);

CREATE TABLE IF NOT EXISTS ariza_rasmlar (
  id          BIGSERIAL PRIMARY KEY,
  ariza_id    BIGINT      NOT NULL REFERENCES arizalar(id) ON DELETE CASCADE,
  fayl        VARCHAR(40) NOT NULL,
  mime        VARCHAR(20) NOT NULL,
  hajm        INTEGER     NOT NULL,
  user_id     BIGINT      NOT NULL REFERENCES users(id),
  bosqich     VARCHAR(10) NOT NULL CHECK (bosqich IN ('ariza', 'bajarildi')),
  yaratilgan  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rasmlar_ariza ON ariza_rasmlar (ariza_id);

-- Har bir o'zgarish yoziladi (audit)
CREATE TABLE IF NOT EXISTS ariza_tarix (
  id           BIGSERIAL PRIMARY KEY,
  ariza_id     BIGINT       NOT NULL REFERENCES arizalar(id) ON DELETE CASCADE,
  eski_holat   VARCHAR(14),
  yangi_holat  VARCHAR(14)  NOT NULL,
  amal         VARCHAR(24)  NOT NULL,
  user_id      BIGINT       REFERENCES users(id),
  izoh         VARCHAR(1000),
  vaqt         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tarix_ariza ON ariza_tarix (ariza_id, vaqt);

CREATE TABLE IF NOT EXISTS bildirishnomalar (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ariza_id    BIGINT       REFERENCES arizalar(id) ON DELETE CASCADE,
  matn        VARCHAR(300) NOT NULL,
  oqilgan     BOOLEAN      NOT NULL DEFAULT FALSE,
  yaratilgan  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bildirishnomalar_user ON bildirishnomalar (user_id, oqilgan, yaratilgan DESC);

-- express-session (connect-pg-simple) jadvali
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR      NOT NULL COLLATE "default" PRIMARY KEY,
  "sess"   JSON         NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Jihoz turlari ma'lumotnomasi (boshliq keyin o'zgartira oladi)
INSERT INTO jihoz_turlari (nomi, mutaxassislik, tartib) VALUES
  ('Kompyuter', 'kompyuter', 10),
  ('Monitor', 'kompyuter', 20),
  ('Printer', 'kompyuter', 30),
  ('Proyektor', 'kompyuter', 40),
  ('Stol', 'mebel', 50),
  ('Stul', 'mebel', 60),
  ('Doska', 'mebel', 70),
  ('Shkaf', 'mebel', 80),
  ('Eshik yoki deraza', 'mebel', 90),
  ('Konditsioner', 'elektr', 100),
  ('Elektr (rozetka, chiroq)', 'elektr', 110),
  ('Santexnika', 'santexnika', 120),
  ('Boshqa', 'umumiy', 999)
ON CONFLICT DO NOTHING;
