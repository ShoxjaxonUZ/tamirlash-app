// Bildirishnomalarni Telegram'ga yetkazish navbati. Ariza amali tranzaksiyasida faqat yozuv qo'shiladi
// (trigger tg_holat = 'kutilmoqda' qo'yadi), yuborish esa shu yerda — tarmoq xatosi arizaga ta'sir qilmaydi.
const config = require('../../config');
const { tx, many } = require('../../db/pool');
const api = require('./api');

const MAX_URINISH = 5;

async function yuborNavbat({ limit = 25 } = {}) {
  if (!api.yoqilganmi()) return { yuborildi: 0, xato: 0 };
  return tx(async (c) => {
    const rows = await many(
      `SELECT b.id, b.matn, b.ariza_id, b.tg_urinish, u.id AS user_id, u.tg_chat_id
         FROM bildirishnomalar b JOIN users u ON u.id = b.user_id
        WHERE b.tg_holat = 'kutilmoqda'
        ORDER BY b.id LIMIT $1
        FOR UPDATE OF b SKIP LOCKED`,
      [limit],
      c
    );
    const natija = { yuborildi: 0, xato: 0 };
    const holat = (id, h, urinish) =>
      c.query('UPDATE bildirishnomalar SET tg_holat = $2, tg_urinish = $3 WHERE id = $1', [id, h, urinish]);

    for (const b of rows) {
      if (!b.tg_chat_id) {
        await holat(b.id, 'xato', b.tg_urinish);
        natija.xato += 1;
        continue;
      }
      const havola = b.ariza_id ? `${config.appUrl}/arizalar/${b.ariza_id}` : null;
      const r = await api.xabar(b.tg_chat_id, api.esc(b.matn), havola);
      if (r.ok) {
        await holat(b.id, 'yuborildi', b.tg_urinish + 1);
        natija.yuborildi += 1;
      } else if (r.error_code === 403 || (r.error_code === 400 && /chat not found/i.test(r.description || ''))) {
        // Foydalanuvchi botni bloklagan yoki chat yo'q — ulanish uziladi
        await c.query('UPDATE users SET tg_chat_id = NULL WHERE id = $1', [b.user_id]);
        await c.query("UPDATE bildirishnomalar SET tg_holat = 'xato' WHERE user_id = $1 AND tg_holat = 'kutilmoqda'", [b.user_id]);
        natija.xato += 1;
      } else if (r.error_code === 429) {
        break; // Telegram "sekinroq" dedi — qolganlari keyingi safar
      } else {
        const urinish = b.tg_urinish + 1;
        await holat(b.id, urinish >= MAX_URINISH ? 'xato' : 'kutilmoqda', urinish);
        if (urinish >= MAX_URINISH) natija.xato += 1;
      }
    }
    return natija;
  });
}

// Ariza amalidan keyin tezroq yuborish (tranzaksiya yopilishiga ulgurishi uchun biroz kutiladi)
let rejada = null;
function tez() {
  if (!api.yoqilganmi() || config.isTest || rejada) return;
  rejada = setTimeout(() => {
    rejada = null;
    yuborNavbat().catch((err) => console.error('[telegram] yuborish xatosi:', err.message));
  }, 1000);
  rejada.unref();
}

module.exports = { yuborNavbat, tez, MAX_URINISH };
