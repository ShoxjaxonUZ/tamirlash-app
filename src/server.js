// npm start — HTTP server va rejalashtiruvchi.
const config = require('./config');
const { createApp } = require('./app');
const { pool } = require('./db/pool');
const jobs = require('./jobs');
const polling = require('./modules/telegram/polling');

const server = createApp().listen(config.port, () => {
  console.log(`Ta'mirlash arizalari: ${config.appUrl} (port ${config.port})`);
});
jobs.ishgaTushir();
if (config.tg.token && config.tg.polling) polling.ishgaTushir();

function toxta(signal) {
  console.log(`${signal}: to'xtatilmoqda...`);
  polling.toxtat();
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => toxta('SIGTERM'));
process.on('SIGINT', () => toxta('SIGINT'));
