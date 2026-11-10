// Testlar uchun umumiy yordamchilar. Integratsion testlar TEST_DATABASE_URL (alohida baza) talab qiladi;
// u berilmasa, ular o'tkazib yuboriladi. DIQQAT: test bazasi har faylda butunlay tozalanadi.
const os = require('os');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB && !/test/i.test(new URL(TEST_DB).pathname)) {
  throw new Error("TEST_DATABASE_URL nomida 'test' bo'lishi shart — ishchi bazani tozalab yubormaslik uchun");
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DB || 'postgresql://localhost/skip';
process.env.DB_SSL = 'false';
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';
process.env.INTERNAL_JOBS = 'false';
process.env.ADMIN_LOGIN = 'admin';
process.env.ADMIN_PAROL = 'admin12345';
process.env.APP_URL = 'https://tamir.test';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'tamirlash-test-uploads');

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');

const skip = TEST_DB ? false : 'TEST_DATABASE_URL berilmagan';
const HASH = bcrypt.hashSync('parol123', 4);

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function resetDb() {
  const { pool } = require('../src/db/pool');
  const { migrate } = require('../src/db/migrate');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
  fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
  require('../src/middleware/security')._URINISHLAR.clear();
}

// Minimal tuzilma: 1 bino, 2 xona, jihozlar va har bir roldagi foydalanuvchilar
async function fixtures() {
  const { pool } = require('../src/db/pool');
  const q = (sql, p) => pool.query(sql, p).then((r) => r.rows[0]);
  const tur = async (nomi) => (await q('SELECT id FROM jihoz_turlari WHERE nomi = $1', [nomi])).id;
  const f = {};
  f.bino = (await q("INSERT INTO binolar (nomi, qavatlar_soni) VALUES ('A bino', 3) RETURNING id")).id;
  f.x101 = await q("INSERT INTO xonalar (bino_id, qavat, raqam, qr_token) VALUES ($1, 1, '101', 'qr101token') RETURNING id, qr_token", [f.bino]);
  f.x102 = await q("INSERT INTO xonalar (bino_id, qavat, raqam, qr_token) VALUES ($1, 1, '102', 'qr102token') RETURNING id, qr_token", [f.bino]);
  f.turKomp = await tur('Kompyuter');
  f.turStul = await tur('Stul');
  f.turElektr = await tur('Elektr (rozetka, chiroq)');
  f.komp3 = (await q("INSERT INTO jihozlar (xona_id, tur_id, belgi, inventar_raqami) VALUES ($1, $2, '#3', 'INV-1') RETURNING id", [f.x101.id, f.turKomp])).id;
  f.stul1 = (await q("INSERT INTO jihozlar (xona_id, tur_id, belgi) VALUES ($1, $2, '#1') RETURNING id", [f.x101.id, f.turStul])).id;
  f.komp102 = (await q("INSERT INTO jihozlar (xona_id, tur_id, belgi) VALUES ($1, $2, '#1') RETURNING id", [f.x102.id, f.turKomp])).id;

  const user = async (login, rol, mut = []) => {
    const u = await q(
      `INSERT INTO users (ism, familiya, login, parol_hash, rol, toifa) VALUES ($1, 'Test', $1, $2, $3, 'talaba') RETURNING id, rol`,
      [login, HASH, rol]
    );
    for (const m of mut) await q('INSERT INTO usta_mutaxassislik (user_id, mutaxassislik) VALUES ($1, $2)', [u.id, m]);
    return u;
  };
  f.talaba = await user('talaba', 'user');
  f.talaba2 = await user('talaba2', 'user');
  f.talaba3 = await user('talaba3', 'user');
  f.usta = await user('usta', 'usta', ['kompyuter']);
  f.usta2 = await user('usta2', 'usta', ['mebel']);
  f.boshliq = await user('boshliq', 'boshliq');
  f.admin = await q("SELECT id, rol FROM users WHERE login = 'admin'");
  return f;
}

const csrfOf = (html) => (/name="_csrf" value="([^"]+)"/.exec(html) || [])[1];

// Tizimga kirgan agent: a.yubor(url, data) — CSRF token bilan POST
async function kirish(app, login, parol = 'parol123') {
  const a = request.agent(app);
  const g = await a.get('/login');
  const r = await a.post('/login').type('form').send({ _csrf: csrfOf(g.text), login, parol });
  assert.equal(r.status, 302, `${login} kira olmadi (${r.status})`);
  const s = await a.get('/profil');
  a.csrf = csrfOf(s.text);
  assert.ok(a.csrf, 'CSRF token topilmadi');
  a.yubor = (url, data = {}) => a.post(url).type('form').send({ _csrf: a.csrf, ...data });
  // multipart: _csrf birinchi maydon bo'lishi shart
  a.ariza = (maydonlar, rasmlar = []) => {
    let r = a.post('/arizalar').field('_csrf', a.csrf);
    for (const [k, v] of Object.entries(maydonlar)) if (v !== undefined && v !== null) r = r.field(k, String(v));
    for (const x of rasmlar) r = r.attach('rasmlar', x.buf, { filename: x.nomi, contentType: x.tur });
    return r;
  };
  return a;
}

const db = () => require('../src/db/pool');
const ariza = (id) => db().one('SELECT * FROM arizalar WHERE id = $1', [id]);
const xabarlar = (userId) => db().many('SELECT matn, ariza_id FROM bildirishnomalar WHERE user_id = $1 ORDER BY id', [userId]);

// Yangi ariza yaratadi (HTTP orqali) va id sini qaytaradi
async function yangiAriza(agent, data) {
  const r = await agent.ariza({ muhimlik: 'orta', tavsif: 'Kompyuter yonmayapti, tugma ishlamaydi', ...data });
  assert.equal(r.status, 302, `ariza yaratilmadi: ${r.status} ${(r.text || '').slice(0, 300)}`);
  return Number(/\/arizalar\/(\d+)$/.exec(r.headers.location)[1]);
}

module.exports = { skip, resetDb, fixtures, kirish, csrfOf, ariza, xabarlar, yangiAriza, db, PNG, request };
