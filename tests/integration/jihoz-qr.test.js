// Har bir jihoz uchun QR-kod va «bitta jihoz — bitta ochiq ariza»: ikkinchi xabar mavjud arizaga qo'shiladi.
const fs = require('fs');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers');

describe('Jihoz QR-kodi va bir xil arizalar', { skip: H.skip }, () => {
  let app;
  let f;
  let talaba;
  let talaba2;
  let talaba3;
  let usta;
  let boshliq;

  before(async () => {
    await H.resetDb();
    f = await H.fixtures();
    app = require('../../src/app').createApp();
    [talaba, talaba2, talaba3, usta, boshliq] = await Promise.all(
      ['talaba', 'talaba2', 'talaba3', 'usta', 'boshliq'].map((l) => H.kirish(app, l))
    );
  });
  after(() => H.db().pool.end());

  const token = async (id) => (await H.db().one('SELECT qr_token FROM jihozlar WHERE id = $1', [id])).qr_token;
  const arizalarSoni = async () => (await H.db().one('SELECT count(*)::int AS n FROM arizalar')).n;
  const komp3 = (extra = {}) => ({ xona_id: f.x101.id, jihoz_id: f.komp3, muhimlik: 'orta', tavsif: 'Konditsioner issiq bermayapti', ...extra });

  it("QR-kod avtomatik berilmaydi — admin tugma bilan yaratadi (jihoz, xona, bino; tur bo'yicha)", async () => {
    assert.equal((await H.db().one('SELECT count(qr_token)::int AS n FROM jihozlar')).n, 0);
    await boshliq.yubor('/admin/jihozlar', { xona_id: f.x102.id, tur_id: f.turStul, belgi: '#9' });
    const stul9 = await H.db().one("SELECT id, qr_token FROM jihozlar WHERE belgi = '#9'");
    assert.equal(stul9.qr_token, null, "yangi jihoz ham QR-kodsiz");

    // Jihoz sahifasi: "QR-kod yaratish" tugmasi; kod yo'q — SVG ham yo'q
    const sahifa = await boshliq.get(`/jihozlar/${f.komp3}`);
    assert.match(sahifa.text, /hali QR-kod yaratilmagan/);
    assert.match(sahifa.text, new RegExp(`action="/admin/jihozlar/${f.komp3}/qr-yangilash"`));
    assert.equal((await boshliq.get(`/jihozlar/${f.komp3}/qr.svg`)).status, 404);
    assert.match((await boshliq.get(`/xonalar/${f.x101.id}`)).text, /QR yo&#x27;q|QR yo'q/);

    // Chop etish sahifasi: yorliq yo'q, yaratish tugmasi bor
    const bosh = await boshliq.get(`/admin/xonalar/${f.x101.id}/jihoz-qr`);
    assert.match(bosh.text, /2 ta jihozda QR-kod yo(?:'|&#x27;)q/);
    assert.match(bosh.text, /Hali QR-kod yaratilmagan/);
    assert.doesNotMatch(bosh.text, /class="jqr-label"/);

    // Faqat stullarga: tur filtri saqlanadi
    const r = await boshliq.yubor(`/admin/xonalar/${f.x101.id}/jihoz-qr`, { tur: f.turStul });
    assert.equal(r.headers.location, `/admin/xonalar/${f.x101.id}/jihoz-qr?tur=${f.turStul}`);
    assert.match(await token(f.stul1), /^[0-9a-f]{16}$/);
    assert.equal(await token(f.komp3), null, 'kompyuter tanlanmagan');
    assert.match((await boshliq.get(r.headers.location)).text, /1 ta jihozga QR-kod yaratildi/);

    // Bitta jihozga — jihoz sahifasidagi tugma
    const bitta = await boshliq.yubor(`/admin/jihozlar/${f.komp3}/qr-yangilash`);
    assert.equal(bitta.headers.location, `/jihozlar/${f.komp3}`);
    assert.match(await token(f.komp3), /^[0-9a-f]{16}$/);
    assert.match((await boshliq.get(`/jihozlar/${f.komp3}`)).text, /QR-kod yaratildi\. Uni chop etib/);

    // Butun bino: qolganlariga; bor kodlar o'zgarmaydi
    const eski = await token(f.stul1);
    await boshliq.yubor(`/admin/binolar/${f.bino}/jihoz-qr`);
    assert.equal(await token(f.stul1), eski);
    const tokenlar = (await H.db().many('SELECT qr_token FROM jihozlar WHERE faol')).map((x) => x.qr_token);
    assert.ok(tokenlar.every((t) => /^[0-9a-f]{16}$/.test(t)));
    assert.equal(new Set(tokenlar).size, tokenlar.length);
    assert.match((await boshliq.get(`/admin/binolar/${f.bino}/jihoz-qr`)).text, /4 ta yorliq/);

    // Talaba yarata olmaydi
    assert.equal((await talaba.yubor(`/admin/xonalar/${f.x102.id}/jihoz-qr`)).status, 403);
  });

  it("/j/:token formani shu jihozga qulflab ochadi", async () => {
    const t = await token(f.komp3);
    const anonim = await H.request(app).get(`/j/${t}`);
    assert.equal(anonim.status, 302);
    assert.equal(anonim.headers.location, `/login?next=${encodeURIComponent(`/j/${t}`)}`);

    const r = await talaba.get(`/j/${t}`);
    assert.equal(r.headers.location, `/arizalar/yangi?xona=${f.x101.id}&jihoz=${f.komp3}`);
    const forma = await talaba.get(r.headers.location);
    assert.match(forma.text, /Kompyuter #3/);
    assert.match(forma.text, /ariza faqat shu jihoz uchun/);
    assert.match(forma.text, new RegExp(`name="jihoz_id" value="${f.komp3}"`));
    assert.doesNotMatch(forma.text, /<select name="jihoz_id"/, 'jihoz tanlash ro\'yxati yo\'q');

    assert.equal((await talaba.get('/j/notogri-token-123')).status, 404);
    await H.db().query('UPDATE jihozlar SET faol = FALSE WHERE id = $1', [f.komp102]);
    assert.equal((await talaba.get(`/j/${await token(f.komp102)}`)).status, 404, 'hisobdan chiqarilgan jihoz');
    await H.db().query('UPDATE jihozlar SET faol = TRUE WHERE id = $1', [f.komp102]);
  });

  let asosiy;
  it("Ikkinchi odam xuddi shu jihozga yozsa — yangi ariza ochilmaydi, xabari mavjud arizaga qo'shiladi", async () => {
    asosiy = await H.yangiAriza(talaba, komp3());
    const oldin = await arizalarSoni();

    const forma = await talaba2.get(`/arizalar/yangi?xona=${f.x101.id}&jihoz=${f.komp3}`);
    assert.match(forma.text, /Bu jihoz bo(?:'|&#x27;)yicha ariza allaqachon bor/);
    assert.match(forma.text, /Xabarni arizaga qo(?:'|&#x27;)shish/);

    const r = await talaba2.ariza(komp3({ tavsif: 'Issiq bermayapti, faqat shamol chiqaryapti' }), [{ buf: H.PNG, nomi: 'k.png', tur: 'image/png' }]);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, `/arizalar/${asosiy}`);
    assert.equal(await arizalarSoni(), oldin, 'yangi ariza yaratilmadi');
    assert.match((await talaba2.get(`/arizalar/${asosiy}`)).text, /allaqachon bor — xabaringiz unga qo(?:'|&#x27;)shildi/);

    assert.ok(await H.db().one('SELECT 1 AS ok FROM ariza_kuzatuvchilar WHERE ariza_id = $1 AND user_id = $2', [asosiy, f.talaba2.id]));
    const t = await H.db().one('SELECT amal, izoh FROM ariza_tarix WHERE ariza_id = $1 ORDER BY id DESC LIMIT 1', [asosiy]);
    assert.equal(t.amal, 'menda_ham');
    assert.match(t.izoh, /faqat shamol/);
    const rasm = await H.db().one('SELECT user_id FROM ariza_rasmlar WHERE ariza_id = $1', [asosiy]);
    assert.equal(rasm.user_id, f.talaba2.id, "rasm mavjud arizaga qo'shildi");

    // Raqam sarflanmadi: keyingi yangi ariza ketma-ket raqam oladi
    const keyingi = await H.yangiAriza(talaba3, { xona_id: f.x102.id, tur_id: f.turElektr, tavsif: 'Rozetka ishlamayapti umuman' });
    assert.match((await H.ariza(keyingi)).raqam, /-0002$/);
  });

  it("Egasi qayta yozsa — izoh qo'shiladi; muhimroq xabar muhimlik va muddatni o'zgartiradi", async () => {
    const r = await talaba.ariza(komp3({ tavsif: "Endi xonada juda issiq, dars o'tib bo'lmayapti", muhimlik: 'shoshilinch' }));
    assert.equal(r.headers.location, `/arizalar/${asosiy}`);
    const amallar = (await H.db().many('SELECT amal FROM ariza_tarix WHERE ariza_id = $1 ORDER BY id', [asosiy])).map((x) => x.amal);
    assert.deepEqual(amallar.slice(-2), ['izoh_qoshildi', 'muddat']);
    const a = await H.ariza(asosiy);
    assert.equal(a.muhimlik, 'shoshilinch');
    assert.ok(new Date(a.muddat) - Date.now() <= 4 * 3600e3 + 60e3, 'muddat 4 soatga yaqinlashdi');
    assert.ok((await H.xabarlar(f.boshliq.id)).some((x) => x.ariza_id === asosiy && /muhimlik — Shoshilinch/.test(x.matn)));
  });

  it("Usta biriktirilgan bo'lsa, yangi xabar unga ham boradi", async () => {
    await boshliq.yubor(`/arizalar/${asosiy}/biriktirish`, { usta_id: f.usta.id });
    await talaba3.ariza(komp3({ tavsif: 'Pultdan ham yoqilmayapti' }));
    assert.ok((await H.xabarlar(f.usta.id)).some((x) => x.ariza_id === asosiy && /yana bir xabar — Pultdan/.test(x.matn)));
  });

  it("Ariza yopilgach yoki rad etilgach — shu jihozga yangi ariza ochiladi", async () => {
    await boshliq.yubor(`/arizalar/${asosiy}/rad-etish`, { izoh: 'Sinov' });
    const yangi = await H.yangiAriza(talaba2, komp3({ tavsif: 'Yana ishlamay qoldi, issiq yo\'q' }));
    assert.notEqual(yangi, asosiy);
    assert.equal((await H.ariza(yangi)).user_id, f.talaba2.id);
  });

  it("Bir vaqtda 5 kishi bir jihozga yozsa — aynan bitta ariza, qolganlari unga qo'shiladi", async () => {
    const odamlar = [talaba, talaba2, talaba3, usta, boshliq];
    const javoblar = await Promise.all(
      odamlar.map((a, i) => a.ariza({ xona_id: f.x102.id, jihoz_id: f.komp102, muhimlik: 'orta', tavsif: `Monitor yonmayapti (${i + 1}-xabar)` }))
    );
    assert.ok(javoblar.every((r) => r.status === 302));
    const ochiq = await H.db().many(
      "SELECT id FROM arizalar WHERE jihoz_id = $1 AND holat IN ('yangi', 'biriktirilgan', 'jarayonda', 'kutilmoqda', 'tekshiruvda')",
      [f.komp102]
    );
    assert.equal(ochiq.length, 1);
    const k = await H.db().one('SELECT count(*)::int AS n FROM ariza_kuzatuvchilar WHERE ariza_id = $1', [ochiq[0].id]);
    assert.equal(k.n, 4);
    assert.ok(javoblar.every((r) => r.headers.location === `/arizalar/${ochiq[0].id}`));
  });

  it("Jihozsiz arizalar yumshoq: bir xil turga ikkinchi ariza ochiladi, formada tavsiya ko'rsatiladi", async () => {
    const elektr = (agent) => H.yangiAriza(agent, { xona_id: f.x101.id, tur_id: f.turElektr, tavsif: 'Rozetka ishlamayapti, zaryad yo\'q' });
    const a1 = await elektr(talaba);
    const forma = await talaba2.get(`/arizalar/yangi?xona=${f.x101.id}`);
    assert.match(forma.text, new RegExp(`data-tur="${f.turElektr}"`));
    assert.match(forma.text, /Siz tanlagan tur/);
    const a2 = await elektr(talaba2);
    assert.notEqual(a1, a2, 'boshqa muammo bo\'lishi mumkin — yangi ariza ochiladi');
  });

  it("Baza darajasida ham bir jihozga ikkinchi ochiq ariza yozib bo'lmaydi", async () => {
    const ochiq = await H.db().one(
      "SELECT * FROM arizalar WHERE jihoz_id = $1 AND holat IN ('yangi', 'biriktirilgan', 'jarayonda', 'kutilmoqda', 'tekshiruvda')",
      [f.komp102]
    );
    await assert.rejects(
      H.db().query(
        `INSERT INTO arizalar (raqam, user_id, xona_id, jihoz_id, tur_id, tavsif, muhimlik, muddat)
         VALUES ('T-TEST-1', $1, $2, $3, $4, 'Qo''lda kiritilgan dublikat', 'orta', now())`,
        [f.talaba.id, ochiq.xona_id, f.komp102, ochiq.tur_id]
      ),
      (e) => e.code === '23505'
    );
  });

  it("Migratsiyalar: 003 avvaldan bor dublikatlarni birlashtiradi, 004 avtomatik QR-kodlarni olib tashlaydi", async () => {
    const { pool } = H.db();
    await pool.query('DROP INDEX uq_arizalar_jihoz_ochiq');
    const ins = (raqam, user) =>
      pool.query(
        `INSERT INTO arizalar (raqam, user_id, xona_id, jihoz_id, tur_id, tavsif, muhimlik, muddat)
         VALUES ($1, $2, $3, $4, $5, 'Eski dublikat sinovi', 'orta', now() + interval '1 day') RETURNING id`,
        [raqam, user, f.x101.id, f.stul1, f.turStul]
      ).then((r) => r.rows[0].id);
    const eski = await ins('T-ESKI-1', f.talaba.id);
    const dub = await ins('T-ESKI-2', f.talaba3.id);

    const migratsiya = (nom) => fs.readFileSync(path.join(__dirname, `../../src/db/migrations/${nom}.sql`), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(migratsiya('003_jihoz_qr'));
      await c.query('COMMIT');
      assert.equal((await c.query('SELECT count(qr_token)::int AS n FROM jihozlar')).rows[0].n, 4, '003 hammasiga kod beradi');
      await c.query('BEGIN');
      await c.query(migratsiya('004_jihoz_qr_qolda'));
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    assert.equal((await H.db().one('SELECT count(qr_token)::int AS n FROM jihozlar')).n, 0, "004 dan keyin kodlar yo'q");
    const ustun = await H.db().one(
      "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'jihozlar' AND column_name = 'qr_token'"
    );
    assert.deepEqual(ustun, { is_nullable: 'YES', column_default: null });
    const d = await H.ariza(dub);
    assert.equal(d.holat, 'rad_etilgan');
    assert.equal(d.birlashtirilgan_id, eski);
    assert.equal(d.rad_sababi, 'Dublikat: T-ESKI-1');
    assert.equal((await H.ariza(eski)).holat, 'yangi');
    assert.ok(await H.db().one('SELECT 1 AS ok FROM ariza_kuzatuvchilar WHERE ariza_id = $1 AND user_id = $2', [eski, f.talaba3.id]));
    assert.ok(await H.db().one("SELECT 1 AS ok FROM pg_indexes WHERE indexname = 'uq_arizalar_jihoz_ochiq'"), 'indeks qayta yaratildi');
  });

  it("Jihoz QR yorliqlarini chop etish, SVG va yangi QR", async () => {
    await boshliq.yubor(`/admin/binolar/${f.bino}/jihoz-qr`);
    const xona = await boshliq.get(`/admin/xonalar/${f.x101.id}/jihoz-qr`);
    assert.equal(xona.status, 200);
    assert.match(xona.text, /Kompyuter #3/);
    assert.match(xona.text, /Stul #1/);
    assert.match(xona.text, new RegExp(`https://tamir.test/j/${await token(f.komp3)}`));
    const faqatStul = await boshliq.get(`/admin/xonalar/${f.x101.id}/jihoz-qr?tur=${f.turStul}`);
    assert.match(faqatStul.text, /Stul #1/);
    assert.doesNotMatch(faqatStul.text, /Kompyuter #3<\/strong>/);
    assert.equal((await boshliq.get(`/admin/binolar/${f.bino}/jihoz-qr`)).status, 200);
    assert.equal((await talaba.get(`/admin/xonalar/${f.x101.id}/jihoz-qr`)).status, 403);

    const svg = await boshliq.get(`/jihozlar/${f.komp3}/qr.svg`);
    assert.match(svg.headers['content-type'], /image\/svg\+xml/);
    const sahifa = await boshliq.get(`/jihozlar/${f.komp3}`);
    assert.match(sahifa.text, /Jihoz QR-kodi/);

    const eski = await token(f.komp3);
    await boshliq.yubor(`/admin/jihozlar/${f.komp3}/qr-yangilash`);
    assert.notEqual(await token(f.komp3), eski);
    assert.equal((await talaba.get(`/j/${eski}`)).status, 404, 'eski QR ishlamaydi');
  });
});
