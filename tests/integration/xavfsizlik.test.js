// Xavfsizlik: CSRF, fayl yuklash, rasmga ruxsat, login cheklovi, open redirect, XSS, sarlavhalar, rollar.
const fs = require('fs');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers');

const yuklanganlar = () => fs.readdirSync(process.env.UPLOAD_DIR);

describe('Xavfsizlik', { skip: H.skip }, () => {
  let app;
  let f;
  let talaba;
  let talaba3;
  let boshliq;

  before(async () => {
    await H.resetDb();
    f = await H.fixtures();
    app = require('../../src/app').createApp();
    [talaba, talaba3, boshliq] = await Promise.all(['talaba', 'talaba3', 'boshliq'].map((l) => H.kirish(app, l)));
  });
  after(() => H.db().pool.end());

  const asos = () => ({ xona_id: f.x101.id, tur_id: f.turKomp, muhimlik: 'orta', tavsif: 'Kompyuter umuman yonmayapti' });

  it("CSRF tokensiz yoki noto'g'ri token bilan POST rad etiladi", async () => {
    const id = await H.yangiAriza(talaba, asos());
    assert.equal((await talaba3.post(`/arizalar/${id}/menda-ham`).type('form').send({})).status, 403);
    assert.equal((await talaba3.post(`/arizalar/${id}/menda-ham`).type('form').send({ _csrf: 'x'.repeat(32) })).status, 403);
    assert.equal((await talaba3.post(`/arizalar/${id}/menda-ham`).type('form').send({ _csrf: talaba.csrf })).status, 403, 'boshqa sessiya tokeni');
    assert.equal((await H.db().one('SELECT count(*)::int AS n FROM ariza_kuzatuvchilar')).n, 0);
  });

  it("multipart forma faqat fayl yuklanadigan manzillarga qabul qilinadi (CSRF chetlab o'tilmaydi)", async () => {
    const id = await H.yangiAriza(talaba, asos());
    await H.db().query("UPDATE arizalar SET holat = 'tekshiruvda', usta_id = $2 WHERE id = $1", [id, f.usta.id]);
    const r = await talaba.post(`/arizalar/${id}/tasdiqlash`).field('x', '1');
    assert.equal(r.status, 403);
    assert.equal((await H.ariza(id)).holat, 'tekshiruvda');
  });

  it("Rasm bilan ariza: CSRF tokensiz rad etiladi va fayl diskda qolmaydi", async () => {
    const oldin = yuklanganlar().length;
    const r = await talaba
      .post('/arizalar')
      .field('xona_id', String(f.x101.id))
      .field('tur_id', String(f.turKomp))
      .field('tavsif', 'Kompyuter yonmayapti umuman')
      .field('muhimlik', 'orta')
      .attach('rasmlar', H.PNG, { filename: 'a.png', contentType: 'image/png' });
    assert.equal(r.status, 403);
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(yuklanganlar().length, oldin);
  });

  it("Rasm emas fayl, noto'g'ri tur va 3 tadan ko'p rasm rad etiladi", async () => {
    const soni = async () => (await H.db().one('SELECT count(*)::int AS n FROM arizalar')).n;
    const oldin = await soni();
    const soxta = await talaba.ariza(asos(), [{ buf: Buffer.from('<script>alert(1)</script>'), nomi: 'x.jpg', tur: 'image/jpeg' }]);
    assert.equal(soxta.status, 400);
    assert.match(soxta.text, /Fayl rasm emas/);
    const gif = await talaba.ariza(asos(), [{ buf: Buffer.from('GIF89a'), nomi: 'x.gif', tur: 'image/gif' }]);
    assert.equal(gif.status, 400);
    assert.match(gif.text, /Faqat JPG yoki PNG/);
    const tort = Array.from({ length: 4 }, (_, i) => ({ buf: H.PNG, nomi: `${i}.png`, tur: 'image/png' }));
    const kop = await talaba.ariza(asos(), tort);
    assert.equal(kop.status, 400);
    assert.match(kop.text, /3 ta rasm/);
    assert.equal(await soni(), oldin);
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(yuklanganlar().length, 0, 'rad etilgan fayllar o\'chirildi');
  });

  it("Rasmni faqat arizani ko'ra oladiganlar ochadi", async () => {
    const r = await talaba.ariza(asos(), [{ buf: H.PNG, nomi: 'buzuq.png', tur: 'image/png' }]);
    assert.equal(r.status, 302);
    const id = Number(r.headers.location.split('/').pop());
    const rasm = await H.db().one('SELECT id, fayl FROM ariza_rasmlar WHERE ariza_id = $1', [id]);
    assert.match(rasm.fayl, /^[a-f0-9]{32}\.png$/, 'fayl nomi tasodifiy');

    const egasi = await talaba.get(`/rasmlar/${rasm.id}`);
    assert.equal(egasi.status, 200);
    assert.match(egasi.headers['content-type'], /image\/png/);
    assert.equal((await talaba3.get(`/rasmlar/${rasm.id}`)).status, 403);
    assert.equal((await boshliq.get(`/rasmlar/${rasm.id}`)).status, 200);
    assert.equal((await H.request(app).get(`/rasmlar/${rasm.id}`)).status, 302, 'anonim — login sahifasiga');
    assert.equal((await talaba.get('/rasmlar/999999')).status, 404);
  });

  it("5 ta xato urinishdan keyin login 15 daqiqaga bloklanadi", async () => {
    const a = H.request.agent(app);
    const csrf = H.csrfOf((await a.get('/login')).text);
    for (let i = 0; i < 5; i++) {
      const r = await a.post('/login').type('form').send({ _csrf: csrf, login: 'talaba2', parol: 'notogri-parol' });
      assert.equal(r.status, 401);
    }
    const blok = await a.post('/login').type('form').send({ _csrf: csrf, login: 'talaba2', parol: 'parol123' });
    assert.equal(blok.status, 429, "to'g'ri parol bilan ham bloklangan");
    assert.match(blok.text, /15 daqiqadan keyin/);
    const boshqa = await a.post('/login').type('form').send({ _csrf: csrf, login: 'talaba3', parol: 'parol123' });
    assert.equal(boshqa.status, 302, 'boshqa hisob ishlayveradi');
  });

  it("Login dan keyin faqat sayt ichidagi manzilga qaytiladi (open redirect yo'q)", async () => {
    const a = H.request.agent(app);
    const csrf = H.csrfOf((await a.get('/login')).text);
    const r = await a.post('/login').type('form').send({ _csrf: csrf, login: 'talaba', parol: 'parol123', next: '//evil.example' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/');
  });

  it('Bloklangan foydalanuvchi keyingi so\'rovdayoq chiqarib yuboriladi', async () => {
    const a = await H.kirish(app, 'talaba3');
    assert.equal((await a.get('/arizalar')).status, 200);
    await H.db().query("UPDATE users SET faol = FALSE WHERE login = 'talaba3'");
    const r = await a.get('/arizalar');
    assert.equal(r.status, 302);
    assert.match(r.headers.location, /^\/login/);
    const csrf = H.csrfOf((await a.get('/login')).text);
    const kirish = await a.post('/login').type('form').send({ _csrf: csrf, login: 'talaba3', parol: 'parol123' });
    assert.equal(kirish.status, 403);
    await H.db().query("UPDATE users SET faol = TRUE WHERE login = 'talaba3'");
  });

  it("Foydalanuvchi matni HTML sifatida chiqmaydi (XSS)", async () => {
    const id = await H.yangiAriza(talaba, { ...asos(), tavsif: '<script>alert("x")</script> <img src=x onerror=alert(1)>' });
    const r = await talaba.get(`/arizalar/${id}`);
    assert.doesNotMatch(r.text, /<script>alert/);
    assert.doesNotMatch(r.text, /<img src=x/);
    assert.match(r.text, /&lt;script&gt;alert/);
  });

  it('Xavfsizlik sarlavhalari va sessiya cookie sozlamalari', async () => {
    const r = await H.request(app).get('/login');
    assert.match(r.headers['content-security-policy'], /script-src 'self'/);
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'self'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-powered-by'], undefined);
    const cookie = r.headers['set-cookie'].join(';');
    assert.match(cookie, /tamir\.sid=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  });

  it("Filtrdagi maxsus belgilar SQL ga ta'sir qilmaydi", async () => {
    for (const q of ["%' OR 1=1 --", '_', '\\', "'; DROP TABLE arizalar; --"]) {
      const r = await boshliq.get(`/boshqaruv?q=${encodeURIComponent(q)}&holat=hammasi`);
      assert.equal(r.status, 200);
      assert.match(r.text, /Topildi: 0 ta/);
    }
    assert.equal((await boshliq.get('/boshqaruv?holat=yoq&bino=abc&usta=1;2')).status, 200);
  });

  it("Foydalanuvchilarni faqat admin boshqaradi; vaqtinchalik parol almashtirilmaguncha boshqa sahifa yopiq", async () => {
    assert.equal((await boshliq.get('/admin/foydalanuvchilar')).status, 403);
    assert.equal((await talaba.get('/admin/ustalar')).status, 403);

    await H.db().query("UPDATE users SET parol_almashtirish = TRUE WHERE login = 'admin'");
    const admin = await H.kirish(app, 'admin', 'admin12345');
    const bosh = await admin.get('/');
    assert.equal(bosh.status, 302);
    assert.equal(bosh.headers.location, '/profil');
    assert.equal((await admin.yubor('/admin/binolar', { nomi: 'X', qavatlar_soni: 1 })).status, 403);
    const p = await admin.yubor('/profil/parol', { eski: 'admin12345', yangi: 'yangiParol2026', takror: 'yangiParol2026' });
    assert.equal(p.status, 302);
    assert.equal((await admin.get('/admin/foydalanuvchilar')).status, 200);
  });
});
