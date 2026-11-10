// Telegram Bot API ga murojaat. Testlarda TG_API_URL soxta serverga yo'naltiriladi.
const config = require('../../config');

const yoqilganmi = () => Boolean(config.tg.token);

// Natija: { ok, result, error_code, description, parameters } — tarmoq xatosida ok:false, error_code:0
async function chaqir(method, params = {}, { timeoutMs = 10000 } = {}) {
  if (!yoqilganmi()) return { ok: false, error_code: 0, description: "Bot sozlanmagan" };
  try {
    const r = await fetch(`${config.tg.apiUrl}/bot${config.tg.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await r.json().catch(() => ({ ok: false, error_code: r.status, description: r.statusText }));
    return data;
  } catch (err) {
    return { ok: false, error_code: 0, description: err.message };
  }
}

// HTML rejimida foydalanuvchi matni xavfsiz bo'lishi uchun
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Telegram tugmalari faqat ommaviy https manzilni qabul qiladi (localhost — yo'q)
const tugmaMumkinmi = () => /^https:\/\//.test(config.appUrl);

function xabar(chatId, matn, havola) {
  const p = { chat_id: chatId, text: matn, parse_mode: 'HTML', disable_web_page_preview: true };
  if (havola && tugmaMumkinmi()) p.reply_markup = { inline_keyboard: [[{ text: 'Arizani ochish', url: havola }]] };
  else if (havola) p.text += `\n${esc(havola)}`;
  return chaqir('sendMessage', p);
}

module.exports = { chaqir, xabar, esc, yoqilganmi };
