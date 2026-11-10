// Telegram bot: hisobni ulash, webhook himoyasi, buyruqlar, bildirishnomalarni yetkazish (soxta Telegram API bilan).
const http = require('http');
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers');

const SIR = 'test-webhook-sir-0123456789';

describe('Telegram bot', { skip: H.skip }, () => {
  let server;
  let sorovlar = [];
  let javoblar = {};
  let app;
  let f;
  let talaba;
  let boshliq;
  let outbox;

  // Soxta api.telegram.org: barcha so'rovlarni yozib oladi, javobni test belgilaydi
  before(async () => {
    server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        const method = req.url.split('/').pop();
        const body = JSON.parse(b || '{}');
        sorovlar.push({ method, body, url: req.url });
        const javob = (javoblar[method] || (() => ({ ok: true, result: { message_id: sorovlar.length } })))(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(javob));
      });
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    process.env.TG_BOT_TOKEN = '123456:TEST';
    process.env.TG_BOT_USERNAME = 'tamir_test_bot';
    process.env.TG_WEBHOOK_SECRET = SIR;
    process.env.TG_API_URL = `http://127.0.0.1:${server.address().port}`;

    await H.resetDb();
    f = await H.fixtures();
    app = require('../../src/app').createApp();
    outbox = require('../../src/modules/telegram/outbox');
    [talaba, boshliq] = await Promise.all(['talaba', 'boshliq'].map((l) => H.kirish(app, l)));
  });
  after(async () => {
    server.close();
    await H.db().pool.end();
  });
  beforeEach(() => {
    sorovlar = [];
    javoblar = {};
  });

  const webhook = (matn, { chatId = 777, sir = SIR, tur = 'private' } = {}) =>
    H.request(app)
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', sir)
      .send({ update_id: Date.now(), message: { message_id: 1, chat: { id: chatId, type: tur }, text: matn } });
  const yuborilgan = () => sorovlar.filter((s) => s.method === 'sendMessage');
  const chatId = async (login) => (await H.db().one('SELECT tg_chat_id FROM users WHERE login = $1', [login])).tg_chat_id;

  it("Webhook maxfiy sarlavhasiz chaqirilsa rad etiladi", async () => {
    assert.equal((await webhook('/start', { sir: '' })).status, 403);
    assert.equal((await webhook('/start', { sir: 'notogri-sir-0123456789abcd' })).status, 403);
    assert.equal(yuborilgan().length, 0);
  });

  it("Profil → Telegram'ni ulash → botda Start: hisob ulanadi", async () => {
    const p = await talaba.get('/profil');
    assert.match(p.text, /Telegram&#x27;ni ulash|Telegram'ni ulash/);
    const r = await talaba.yubor('/profil/telegram');
    assert.equal(r.status, 302);
    const m = /^https:\/\/t\.me\/tamir_test_bot\?start=([\w-]+)$/.exec(r.headers.location);
    assert.ok(m, r.headers.location);

    const w = await webhook(`/start ${m[1]}`);
    assert.equal(w.status, 200);
    assert.equal(await chatId('talaba'), 777);
    assert.match(yuborilgan()[0].body.text, /Ulandi!/);
    assert.match((await talaba.get('/profil')).text, /Ulangan/);

    // Havola bir martalik
    await webhook(`/start ${m[1]}`, { chatId: 888 });
    assert.match(yuborilgan()[1].body.text, /eskirgan/);
    assert.equal(await chatId('talaba'), 777);
  });

  it("Muddati o'tgan havola ishlamaydi; guruh chatidagi xabarlar e'tiborsiz qoldiriladi", async () => {
    const r = await boshliq.yubor('/profil/telegram');
    const token = r.headers.location.split('start=')[1];
    await H.db().query("UPDATE tg_ulash SET amal_qiladi = now() - interval '1 minute' WHERE token = $1", [token]);
    await webhook(`/start ${token}`, { chatId: 999 });
    assert.equal(await chatId('boshliq'), null);
    await webhook('/arizalarim', { chatId: 777, tur: 'group' });
    assert.equal(yuborilgan().filter((s) => s.body.chat_id === 777).length, 0);
  });

  it("Bildirishnoma Telegram'ga yetkaziladi: HTML xavfsiz, havola tugmasi bilan", async () => {
    const id = await H.yangiAriza(talaba, { xona_id: f.x101.id, jihoz_id: f.komp3 });
    await boshliq.yubor(`/arizalar/${id}/rad-etish`, { izoh: 'Sabab: <b>soxta</b> & takroriy' });
    const b = await H.db().one('SELECT tg_holat FROM bildirishnomalar WHERE user_id = $1 AND ariza_id = $2', [f.talaba.id, id]);
    assert.equal(b.tg_holat, 'kutilmoqda', 'trigger navbatga qo\'ydi');
    const boshqa = await H.db().one("SELECT count(*)::int AS n FROM bildirishnomalar WHERE user_id = $1 AND tg_holat IS NOT NULL", [f.boshliq.id]);
    assert.equal(boshqa.n, 0, "Telegram ulamaganlar navbatga tushmaydi");

    const n = await outbox.yuborNavbat();
    assert.equal(n.yuborildi, 1);
    const [s] = yuborilgan();
    assert.equal(s.body.chat_id, 777);
    assert.equal(s.body.parse_mode, 'HTML');
    assert.match(s.body.text, /rad etildi: Sabab: &lt;b&gt;soxta&lt;\/b&gt; &amp; takroriy/);
    assert.equal(s.body.reply_markup.inline_keyboard[0][0].url, `https://tamir.test/arizalar/${id}`);
    assert.equal((await H.db().one('SELECT tg_holat FROM bildirishnomalar WHERE user_id = $1 AND ariza_id = $2', [f.talaba.id, id])).tg_holat, 'yuborildi');
    assert.equal((await outbox.yuborNavbat()).yuborildi, 0, 'qayta yuborilmaydi');
  });

  it("/arizalarim ochiq arizalarni ko'rsatadi; /start ulangan foydalanuvchini taniydi", async () => {
    const id = await H.yangiAriza(talaba, { xona_id: f.x101.id, jihoz_id: f.stul1, tavsif: "Stulning oyog'i singan" });
    const raqam = (await H.ariza(id)).raqam;
    await webhook('/arizalarim');
    assert.match(yuborilgan()[0].body.text, new RegExp(`${raqam}</b> — Yangi`));
    assert.match(yuborilgan()[0].body.text, /Stul #1 · A bino, 101-xona/);
    await webhook('/start');
    assert.match(yuborilgan()[1].body.text, /Test talaba sifatida ulangansiz/);
    await webhook('salom', { chatId: 12345 });
    assert.match(yuborilgan()[2].body.text, /Profil → Telegram/);
  });

  it("Vaqtinchalik xato — qayta urinadi, 5 martadan keyin to'xtaydi; 429 da navbat kutadi", async () => {
    await H.db().query("INSERT INTO bildirishnomalar (user_id, matn) VALUES ($1, 'Sinov xabari')", [f.talaba.id]);
    javoblar.sendMessage = () => ({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 5 } });
    await outbox.yuborNavbat();
    let b = await H.db().one("SELECT tg_holat, tg_urinish FROM bildirishnomalar WHERE matn = 'Sinov xabari'");
    assert.deepEqual(b, { tg_holat: 'kutilmoqda', tg_urinish: 0 });

    javoblar.sendMessage = () => ({ ok: false, error_code: 500, description: 'Internal Server Error' });
    for (let i = 0; i < 5; i++) await outbox.yuborNavbat();
    b = await H.db().one("SELECT tg_holat, tg_urinish FROM bildirishnomalar WHERE matn = 'Sinov xabari'");
    assert.deepEqual(b, { tg_holat: 'xato', tg_urinish: 5 });
  });

  it("Foydalanuvchi botni bloklasa (403) — ulanish uziladi", async () => {
    await H.db().query("INSERT INTO bildirishnomalar (user_id, matn) VALUES ($1, 'Bloklash sinovi')", [f.talaba.id]);
    javoblar.sendMessage = () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    await outbox.yuborNavbat();
    assert.equal(await chatId('talaba'), null);
    assert.equal((await H.db().one("SELECT tg_holat FROM bildirishnomalar WHERE matn = 'Bloklash sinovi'")).tg_holat, 'xato');
    // Ulanmagan foydalanuvchiga yangi xabar navbatga tushmaydi
    await H.db().query("INSERT INTO bildirishnomalar (user_id, matn) VALUES ($1, 'Keyingi')", [f.talaba.id]);
    assert.equal((await H.db().one("SELECT tg_holat FROM bildirishnomalar WHERE matn = 'Keyingi'")).tg_holat, null);
  });

  it("/stop va profildagi 'Uzish' ulanishni o'chiradi", async () => {
    const r = await talaba.yubor('/profil/telegram');
    await webhook(`/start ${r.headers.location.split('start=')[1]}`, { chatId: 555 });
    assert.equal(await chatId('talaba'), 555);
    await webhook('/stop', { chatId: 555 });
    assert.equal(await chatId('talaba'), null);

    const r2 = await talaba.yubor('/profil/telegram');
    await webhook(`/start ${r2.headers.location.split('start=')[1]}`, { chatId: 556 });
    await talaba.yubor('/profil/telegram/uzish');
    assert.equal(await chatId('talaba'), null);
  });
});
