// Rejalashtirilgan ishlar (TZ, FR-6.2 va FR-7):
//  - tekshiruvda 3 kun turgan ariza avtomatik yopiladi;
//  - muddatiga 2 soatdan kam qolganda ustaga xabar;
//  - muddati o'tganda boshliq va adminga (va ustaga) xabar.
//  - kuniga bir marta bazaning zaxira nusxasi (TZ, 7-bo'lim);
//  - Telegram navbatidagi xabarlarni yuborish.
// Har biri bitta SQL buyruq: holat, tarix va bildirishnoma birga yoziladi. Har bir xabar bir marta yuboriladi.
const { pool } = require('../db/pool');
const config = require('../config');
const zaxira = require('../db/zaxira');
const outbox = require('../modules/telegram/outbox');
const tgApi = require('../modules/telegram/api');

const ISHDA = "('yangi', 'biriktirilgan', 'jarayonda', 'kutilmoqda')";
const LOCK_ID = 4815162343;
const AVTO_YOPISH_KUN = 3;

async function avtoYopish(c = pool) {
  const r = await c.query(
    `WITH y AS (
       UPDATE arizalar SET holat = 'yopilgan', yopilgan = now(), yangilangan = now()
        WHERE holat = 'tekshiruvda' AND bajarilgan < now() - make_interval(days => $1)
        RETURNING id, raqam, user_id, usta_id
     ), t AS (
       INSERT INTO ariza_tarix (ariza_id, eski_holat, yangi_holat, amal, izoh)
       SELECT id, 'tekshiruvda', 'yopilgan', 'avto_yopildi', $1 || ' kun ichida egasi javob bermadi' FROM y
     ), n AS (
       INSERT INTO bildirishnomalar (user_id, ariza_id, matn)
       SELECT user_id, id, raqam || ': ariza avtomatik yopildi (' || $1 || ' kun javob bo''lmadi)' FROM y
       UNION ALL
       SELECT usta_id, id, raqam || ': ishingiz qabul qilindi (avtomatik)' FROM y WHERE usta_id IS NOT NULL
     )
     SELECT count(*)::int AS soni FROM y`,
    [AVTO_YOPISH_KUN]
  );
  return r.rows[0].soni;
}

async function muddatYaqin(c = pool) {
  const r = await c.query(
    `WITH y AS (
       UPDATE arizalar SET muddat_yaqin_xabar = TRUE
        WHERE holat IN ('biriktirilgan', 'jarayonda', 'kutilmoqda') AND NOT muddat_yaqin_xabar
          AND muddat > now() AND muddat <= now() + interval '2 hours'
        RETURNING id, raqam, usta_id
     ), n AS (
       INSERT INTO bildirishnomalar (user_id, ariza_id, matn)
       SELECT usta_id, id, raqam || ': muddat tugashiga 2 soatdan kam qoldi' FROM y
     )
     SELECT count(*)::int AS soni FROM y`
  );
  return r.rows[0].soni;
}

async function muddatOtdi(c = pool) {
  const r = await c.query(
    `WITH y AS (
       UPDATE arizalar SET muddat_otdi_xabar = TRUE
        WHERE holat IN ${ISHDA} AND NOT muddat_otdi_xabar AND muddat < now()
        RETURNING id, raqam, usta_id
     ), qabul AS (
       SELECT id FROM users WHERE rol IN ('boshliq', 'admin') AND faol
     ), n AS (
       INSERT INTO bildirishnomalar (user_id, ariza_id, matn)
       SELECT q.id, y.id, y.raqam || ': muddati o''tdi' FROM y CROSS JOIN qabul q
       UNION ALL
       SELECT usta_id, id, raqam || ': muddati o''tdi — iltimos, tezlashtiring' FROM y WHERE usta_id IS NOT NULL
     )
     SELECT count(*)::int AS soni FROM y`
  );
  return r.rows[0].soni;
}

// Bir nechta nusxa ishlasa ham bir vaqtda faqat bittasi bajaradi
async function hammasi() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (!rows[0].ok) return null;
    try {
      return {
        yopildi: await avtoYopish(client),
        yaqin: await muddatYaqin(client),
        otdi: await muddatOtdi(client),
      };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    }
  } finally {
    client.release();
  }
}

// Oxirgi zaxira 23 soatdan eski bo'lsa — yangisini oladi va eskilarini tozalaydi
async function kunlikZaxira() {
  if (!config.zaxira.avto) return null;
  const oxirgi = zaxira.royxat()[0];
  if (oxirgi && Date.now() - oxirgi.vaqt.getTime() < 23 * 3600e3) return null;
  const z = await zaxira.yarat();
  zaxira.tozala();
  return z.nom;
}

function ishgaTushir({ interval = 5 * 60 * 1000 } = {}) {
  if (!config.jobs) return null;
  const run = async () => {
    try {
      const r = await hammasi();
      if (r && (r.yopildi || r.yaqin || r.otdi)) console.log('[jobs]', JSON.stringify(r));
      const z = await kunlikZaxira();
      if (z) console.log(`[jobs] zaxira olindi: ${z}`);
    } catch (err) {
      console.error('[jobs] xato:', err.message);
    }
  };
  setTimeout(run, 5000).unref();
  if (tgApi.yoqilganmi()) {
    setInterval(() => outbox.yuborNavbat().catch((err) => console.error('[telegram] xato:', err.message)), 30 * 1000).unref();
  }
  return setInterval(run, interval).unref();
}

module.exports = { avtoYopish, muddatYaqin, muddatOtdi, hammasi, kunlikZaxira, ishgaTushir };
