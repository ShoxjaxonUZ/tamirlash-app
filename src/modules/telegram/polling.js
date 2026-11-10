// Lokal kompyuterda (tashqi manzil yo'q) webhook o'rniga getUpdates bilan ishlash: TG_POLLING=true.
const api = require('./api');
const bot = require('./bot');

let toxtat = false;

async function ishgaTushir() {
  await api.chaqir('deleteWebhook', { drop_pending_updates: false });
  let offset = 0;
  console.log('[telegram] polling rejimi yoqildi');
  while (!toxtat) {
    const r = await api.chaqir('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, { timeoutMs: 35000 });
    if (!r.ok) {
      if (r.error_code === 401) {
        console.error("[telegram] token noto'g'ri — polling to'xtatildi");
        return;
      }
      await new Promise((ok) => setTimeout(ok, 5000).unref());
      continue;
    }
    for (const u of r.result) {
      offset = u.update_id + 1;
      await bot.yangilanish(u).catch((err) => console.error('[telegram] xato:', err.message));
    }
  }
}

module.exports = {
  ishgaTushir: () => ishgaTushir().catch((err) => console.error('[telegram] polling xatosi:', err.message)),
  toxtat: () => {
    toxtat = true;
  },
};
