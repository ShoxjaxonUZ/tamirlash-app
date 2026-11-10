// npm run migrate
// migrations/NNN_nomi.sql fayllari tartib bilan, har biri alohida tranzaksiyada bajariladi va
// schema_migrations jadvaliga yoziladi. Advisory lock ikki nusxaning bir vaqtda ishlashiga yo'l qo'ymaydi.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { pool } = require('./pool');

const DIR = path.join(__dirname, 'migrations');
const LOCK_ID = 4815162342;

function migrationFiles() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: f.replace(/\.sql$/, ''), file: path.join(DIR, f) }));
}

async function ensureAdmin(client, log) {
  const { rows } = await client.query("SELECT login FROM users WHERE rol = 'admin' ORDER BY id LIMIT 1");
  if (rows.length) return log(`✓ Administrator mavjud: ${rows[0].login}`);

  const login = config.admin.login.toLowerCase();
  let parol = config.admin.parol;
  if (!parol) {
    if (config.isProd) throw new Error("Administrator yo'q: .env da ADMIN_PAROL ni bering (kamida 8 belgi)");
    parol = 'admin12345';
  }
  if (parol.length < 8) throw new Error("ADMIN_PAROL kamida 8 belgidan iborat bo'lsin");
  const taken = await client.query('SELECT 1 FROM users WHERE lower(login) = $1', [login]);
  if (taken.rowCount) return log(`! "${login}" logini band — administrator yaratilmadi. ADMIN_LOGIN ni o'zgartiring.`);

  await client.query(
    `INSERT INTO users (ism, familiya, login, parol_hash, rol, toifa, parol_almashtirish)
     VALUES ('Tizim', 'Administrator', $1, $2, 'admin', 'xodim', $3)`,
    [login, await bcrypt.hash(parol, 10), !config.admin.parol]
  );
  log(
    `✓ Administrator yaratildi: ${login}` +
      (config.admin.parol ? '' : ' (vaqtinchalik parol: admin12345 — birinchi kirishda almashtiriladi)')
  );
}

async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version     TEXT PRIMARY KEY,
         applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    let applied = 0;
    for (const m of migrationFiles()) {
      if (done.has(m.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(m.file, 'utf8'));
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`${m.version}: ${err.message}`, { cause: err });
      }
      applied += 1;
      log(`✓ ${m.version}`);
    }
    if (!applied) log('✓ Barcha migratsiyalar avval bajarilgan');
    await ensureAdmin(client, log);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .catch((err) => {
      console.error('Migratsiya xatosi:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { migrate };
