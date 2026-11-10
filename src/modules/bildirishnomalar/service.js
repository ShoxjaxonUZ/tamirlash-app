// Tizim ichidagi bildirishnomalar (TZ, FR-7). Ariza amallari bilan bir tranzaksiyada yoziladi.
const { many, one, query } = require('../../db/pool');
const outbox = require('../telegram/outbox');

// Amalni bajargan odamning o'ziga xabar yuborilmaydi
async function yubor(c, userIds, arizaId, matn, kimdan = null) {
  const ids = [...new Set(userIds.filter((x) => x && x !== kimdan))];
  if (!ids.length) return 0;
  await c.query(
    `INSERT INTO bildirishnomalar (user_id, ariza_id, matn)
     SELECT u, $2, $3 FROM unnest($1::bigint[]) AS u`,
    [ids, arizaId, matn.slice(0, 300)]
  );
  // Telegram ulanganlarga (trigger navbatga qo'ygan) tranzaksiyadan keyin yuboriladi
  outbox.tez();
  return ids.length;
}

// Xo'jalik boshliqlari; ular bo'lmasa — administratorlar
async function boshqaruvchilar(c) {
  const b = await many("SELECT id FROM users WHERE rol = 'boshliq' AND faol", [], c);
  if (b.length) return b.map((r) => r.id);
  return (await many("SELECT id FROM users WHERE rol = 'admin' AND faol", [], c)).map((r) => r.id);
}

async function kuzatuvchilar(c, arizaId) {
  return (await many('SELECT user_id FROM ariza_kuzatuvchilar WHERE ariza_id = $1', [arizaId], c)).map((r) => r.user_id);
}

function royxat(userId, limit = 50) {
  return many(
    `SELECT b.id, b.matn, b.oqilgan, b.yaratilgan, b.ariza_id
       FROM bildirishnomalar b WHERE b.user_id = $1
      ORDER BY b.yaratilgan DESC, b.id DESC LIMIT $2`,
    [userId, limit]
  );
}

// O'qilgan deb belgilaydi va ariza id sini qaytaradi (begona bildirishnoma — null)
function oqildi(userId, id) {
  return one('UPDATE bildirishnomalar SET oqilgan = TRUE WHERE id = $1 AND user_id = $2 RETURNING ariza_id', [id, userId]);
}

const hammasiOqildi = (userId) =>
  query('UPDATE bildirishnomalar SET oqilgan = TRUE WHERE user_id = $1 AND NOT oqilgan', [userId]);

module.exports = { yubor, boshqaruvchilar, kuzatuvchilar, royxat, oqildi, hammasiOqildi };
