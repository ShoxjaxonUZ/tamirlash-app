// npm run tg:webhook — botni ishga tayyorlaydi: buyruqlar menyusi va (polling bo'lmasa) webhook manzili.
const config = require('../../config');
const api = require('./api');

const BUYRUQLAR = [
  { command: 'arizalarim', description: 'Ochiq arizalarim' },
  { command: 'stop', description: "Bildirishnomalarni o'chirish" },
  { command: 'help', description: 'Yordam' },
];

(async () => {
  if (!config.tg.token) throw new Error('.env da TG_BOT_TOKEN berilmagan (@BotFather dan oling)');
  const me = await api.chaqir('getMe');
  if (!me.ok) throw new Error(`Token noto'g'ri: ${me.description}`);
  console.log(`✓ Bot: @${me.result.username}`);
  if (config.tg.username && config.tg.username.toLowerCase() !== me.result.username.toLowerCase()) {
    console.log(`! TG_BOT_USERNAME (${config.tg.username}) botning haqiqiy nomiga mos emas: ${me.result.username}`);
  }
  const cmd = await api.chaqir('setMyCommands', { commands: BUYRUQLAR });
  console.log(cmd.ok ? "✓ Buyruqlar menyusi o'rnatildi" : `! Buyruqlar: ${cmd.description}`);

  if (config.tg.polling) {
    await api.chaqir('deleteWebhook', {});
    console.log('✓ TG_POLLING=true — webhook o\'chirildi, server o\'zi yangilanishlarni so\'raydi');
    return;
  }
  if (!/^https:\/\//.test(config.appUrl)) throw new Error("Webhook uchun APP_URL https:// bilan boshlanishi kerak (lokalda TG_POLLING=true qiling)");
  if (config.tg.webhookSecret.length < 16) throw new Error('TG_WEBHOOK_SECRET kamida 16 belgi bo\'lsin');
  const r = await api.chaqir('setWebhook', {
    url: `${config.appUrl}/telegram/webhook`,
    secret_token: config.tg.webhookSecret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  if (!r.ok) throw new Error(`Webhook o'rnatilmadi: ${r.description}`);
  console.log(`✓ Webhook: ${config.appUrl}/telegram/webhook`);
})().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
