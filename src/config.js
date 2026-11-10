// Muhit sozlamalari. .env dan o'qiladi; noto'g'ri qiymat bo'lsa dastur ishga tushmaydi.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';
const port = Number(env.PORT) || 3000;

function sessionSecret() {
  const s = env.SESSION_SECRET || '';
  if (s.length >= 32) return s;
  if (isProd) throw new Error("SESSION_SECRET kamida 32 belgidan iborat bo'lishi kerak");
  return 'dev-only-session-secret-0123456789abcdef';
}

// Ish kunlari: 1 = Dushanba ... 7 = Yakshanba
const ishKunlari = (env.ISH_KUNLARI || '1,2,3,4,5')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
if (!ishKunlari.length) throw new Error("ISH_KUNLARI noto'g'ri: masalan 1,2,3,4,5");

const bool = (v, def) => (v === undefined || v === '' ? def : v === 'true');

module.exports = {
  isProd,
  isTest,
  port,
  appUrl: (env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: env.DATABASE_URL,
  dbSsl: bool(env.DB_SSL, false),
  dbPoolMax: Number(env.DB_POOL_MAX) || 10,
  sessionSecret: sessionSecret(),
  trustProxy: bool(env.TRUST_PROXY, isProd),
  uploadDir: path.resolve(env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  ishKunlari,
  // Ilova ichidagi rejalashtiruvchi (muddat nazorati, avtomatik yopish)
  jobs: bool(env.INTERNAL_JOBS, !isTest),
  timezone: 'Asia/Tashkent',
  admin: { login: env.ADMIN_LOGIN || 'admin', parol: env.ADMIN_PAROL || '' },
  // Telegram bot (ixtiyoriy, TZ FR-7.4). Token bo'lmasa — o'chiq
  tg: {
    token: env.TG_BOT_TOKEN || '',
    username: (env.TG_BOT_USERNAME || '').replace(/^@/, ''),
    webhookSecret: env.TG_WEBHOOK_SECRET || '',
    apiUrl: (env.TG_API_URL || 'https://api.telegram.org').replace(/\/+$/, ''),
    // Lokal kompyuterda (tashqi manzil yo'q) — webhook o'rniga getUpdates
    polling: bool(env.TG_POLLING, false),
  },
  // Bazaning zaxira nusxalari (TZ, 7-bo'lim)
  zaxira: {
    dir: path.resolve(env.ZAXIRA_DIR || path.join(__dirname, '..', 'zaxira')),
    avto: bool(env.ZAXIRA_AVTO, !isTest),
    saqlash: Math.max(1, Number(env.ZAXIRA_SAQLASH) || 7),
  },
};
