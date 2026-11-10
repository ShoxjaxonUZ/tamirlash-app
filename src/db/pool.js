// PostgreSQL ulanishlar havzasi va tranzaksiya yordamchisi.
const { Pool, types } = require('pg');
const config = require('../config');

// bigint (OID 20) ni JS number qilamiz: id va count(*) uchun yetarli
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

if (!config.databaseUrl) throw new Error('DATABASE_URL berilmagan (.env faylini tekshiring)');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
  max: config.dbPoolMax,
});

pool.on('error', (err) => console.error("PostgreSQL ulanishida xato:", err.message));

const query = (text, params, c = pool) => c.query(text, params);
const one = async (text, params, c = pool) => (await c.query(text, params)).rows[0] || null;
const many = async (text, params, c = pool) => (await c.query(text, params)).rows;

// fn(client) xato bersa ROLLBACK, aks holda COMMIT
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, many, tx };
