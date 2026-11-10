// Botga kelgan xabarlarni qayta ishlash (webhook ham, polling ham shu funksiyani chaqiradi).
// Buyruqlar: /start <token> — hisobni ulash, /arizalarim — ochiq arizalar, /stop — uzish, /help.
const crypto = require('crypto');
const config = require('../../config');
const { one, many, tx, query } = require('../../db/pool');
const time = require('../../lib/time');
const { HOLATLAR } = require('../../lib/holat');
const { fio } = require('../../lib/roles');
const api = require('./api');

const TOKEN_DAQIQA = 15;

// Profil sahifasidagi "Telegram'ni ulash" — bir martalik havola
async function ulashHavolasi(userId) {
  const token = crypto.randomBytes(18).toString('base64url');
  await query('DELETE FROM tg_ulash WHERE user_id = $1 OR amal_qiladi < now()', [userId]);
  await query(`INSERT INTO tg_ulash (token, user_id, amal_qiladi) VALUES ($1, $2, now() + make_interval(mins => $3))`, [
    token,
    userId,
    TOKEN_DAQIQA,
  ]);
  return `https://t.me/${config.tg.username}?start=${token}`;
}

const uzish = (userId) => query('UPDATE users SET tg_chat_id = NULL WHERE id = $1', [userId]);

async function ulash(token, chatId) {
  return tx(async (c) => {
    const t = await one('SELECT user_id FROM tg_ulash WHERE token = $1 AND amal_qiladi > now() FOR UPDATE', [token], c);
    if (!t) return null;
    const u = await one('SELECT id, ism, familiya FROM users WHERE id = $1 AND faol', [t.user_id], c);
    if (!u) return null;
    // Bitta Telegram hisobi — bitta foydalanuvchi
    await c.query('UPDATE users SET tg_chat_id = NULL WHERE tg_chat_id = $1 AND id <> $2', [chatId, u.id]);
    await c.query('UPDATE users SET tg_chat_id = $2 WHERE id = $1', [u.id, chatId]);
    await c.query('DELETE FROM tg_ulash WHERE user_id = $1', [u.id]);
    return u;
  });
}

const ulanganUser = (chatId) => one('SELECT id, ism, familiya, rol FROM users WHERE tg_chat_id = $1 AND faol', [chatId]);

async function arizalarimMatni(u) {
  const rows = await many(
    `SELECT a.raqam, a.holat, a.muddat, x.raqam AS xona, b.nomi AS bino, t.nomi AS tur, j.belgi AS jihoz,
            (a.usta_id = $1) AS ish
       FROM arizalar a
       JOIN xonalar x ON x.id = a.xona_id JOIN binolar b ON b.id = x.bino_id
       JOIN jihoz_turlari t ON t.id = a.tur_id LEFT JOIN jihozlar j ON j.id = a.jihoz_id
      WHERE a.holat IN ('yangi', 'biriktirilgan', 'jarayonda', 'kutilmoqda', 'tekshiruvda')
        AND (a.user_id = $1 OR a.usta_id = $1
             OR EXISTS (SELECT 1 FROM ariza_kuzatuvchilar k WHERE k.ariza_id = a.id AND k.user_id = $1))
      ORDER BY a.muddat LIMIT 10`,
    [u.id]
  );
  if (!rows.length) return "Ochiq arizangiz yo'q.";
  const qatorlar = rows.map(
    (a) =>
      `<b>${api.esc(a.raqam)}</b> — ${HOLATLAR[a.holat]}${a.ish ? ' (sizning ishingiz)' : ''}\n` +
      `${api.esc([a.tur, a.jihoz].filter(Boolean).join(' '))} · ${api.esc(a.bino)}, ${api.esc(a.xona)}-xona\n` +
      `Muddat: ${time.formatVaqt(a.muddat)}`
  );
  return `Ochiq arizalar:\n\n${qatorlar.join('\n\n')}\n\nBatafsil: ${api.esc(config.appUrl)}/arizalar`;
}

const YORDAM =
  "Bu bot Ta'mirlash arizalari tizimining bildirishnomalarini yuboradi.\n\n" +
  "/arizalarim — ochiq arizalaringiz\n/stop — bildirishnomalarni o'chirish";

// Telegram update obyekti. Faqat shaxsiy chatdagi matnli xabarlar qayta ishlanadi.
async function yangilanish(update) {
  const msg = update && update.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private' || typeof msg.text !== 'string') return;
  const chatId = msg.chat.id;
  const [buyruq, ...qolgani] = msg.text.trim().split(/\s+/);
  const nom = buyruq.replace(/@\w+$/, '').toLowerCase();
  const javob = (matn) => api.chaqir('sendMessage', { chat_id: chatId, text: matn, parse_mode: 'HTML', disable_web_page_preview: true });

  if (nom === '/start' && qolgani[0]) {
    const u = await ulash(qolgani[0].slice(0, 40), chatId);
    if (!u) return javob("Havola eskirgan yoki noto'g'ri. Saytdagi Profil sahifasidan qaytadan ulang.");
    return javob(`Ulandi! ${api.esc(fio(u))}, endi arizalaringiz haqidagi xabarlar shu yerga keladi.\n\n/arizalarim — ochiq arizalar\n/stop — o'chirish`);
  }

  const u = await ulanganUser(chatId);
  if (nom === '/stop') {
    if (u) await uzish(u.id);
    return javob("Bildirishnomalar o'chirildi. Qayta ulash uchun saytdagi Profil sahifasiga kiring.");
  }
  if (!u) return javob(`${YORDAM}\n\nUlash uchun saytda <b>Profil → Telegram'ni ulash</b> tugmasini bosing: ${api.esc(config.appUrl)}/profil`);
  if (nom === '/arizalarim') return javob(await arizalarimMatni(u));
  if (nom === '/start') return javob(`Siz ${api.esc(fio(u))} sifatida ulangansiz.\n\n${YORDAM}`);
  return javob(YORDAM);
}

module.exports = { yangilanish, ulashHavolasi, uzish, ulash, TOKEN_DAQIQA };
