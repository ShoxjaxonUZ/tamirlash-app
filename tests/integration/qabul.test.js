// TZ, 10-bo'lim: qabul qilish mezonlari (12 ta test holati) — haqiqiy HTTP so'rovlar va PostgreSQL bilan.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers');

describe('TZ qabul qilish mezonlari', { skip: H.skip }, () => {
  let app;
  let f;
  let talaba;
  let talaba2;
  let talaba3;
  let usta;
  let usta2;
  let boshliq;
  let arizaId;

  before(async () => {
    await H.resetDb();
    f = await H.fixtures();
    app = require('../../src/app').createApp();
    [talaba, talaba2, talaba3, usta, usta2, boshliq] = await Promise.all(
      ['talaba', 'talaba2', 'talaba3', 'usta', 'usta2', 'boshliq'].map((l) => H.kirish(app, l))
    );
  });
  after(() => H.db().pool.end());

  it('1. Talaba A bino, 101-xona, "Kompyuter #3" ga ariza beradi → T-raqam bilan "Yangi"', async () => {
    arizaId = await H.yangiAriza(talaba, { xona_id: f.x101.id, jihoz_id: f.komp3, muhimlik: 'yuqori' });
    const a = await H.ariza(arizaId);
    assert.match(a.raqam, /^T-\d{4}-0001$/);
    assert.equal(a.holat, 'yangi');
    assert.equal(a.tur_id, f.turKomp, 'tur jihozdan olinadi');
    assert.ok(new Date(a.muddat) > new Date(), 'muddat qo\'yilgan');
    const sahifa = await talaba.get(`/arizalar/${arizaId}`);
    assert.equal(sahifa.status, 200);
    assert.match(sahifa.text, new RegExp(a.raqam));
    assert.match(sahifa.text, /Yangi/);
  });

  it("2. Tavsif bo'sh yoki 10 belgidan qisqa → forma xato ko'rsatadi, ariza yaratilmaydi", async () => {
    const oldin = (await H.db().one('SELECT count(*)::int AS n FROM arizalar')).n;
    const bosh = await talaba.ariza({ xona_id: f.x101.id, jihoz_id: f.stul1, muhimlik: 'orta', tavsif: '' });
    assert.equal(bosh.status, 400);
    assert.match(bosh.text, /Muammo tavsifi kiritilmagan/);
    const qisqa = await talaba.ariza({ xona_id: f.x101.id, jihoz_id: f.stul1, muhimlik: 'orta', tavsif: 'singan' });
    assert.equal(qisqa.status, 400);
    assert.match(qisqa.text, /kamida 10 belgi/);
    assert.match(qisqa.text, /value="singan"|>singan</, 'kiritilgan qiymat saqlanadi');
    const turSiz = await talaba.ariza({ xona_id: f.x101.id, muhimlik: 'orta', tavsif: 'Nimadir buzilgan, tekshiring' });
    assert.equal(turSiz.status, 400);
    assert.match(turSiz.text, /Jihozni yoki uning turini tanlang/);
    const begonaJihoz = await talaba.ariza({ xona_id: f.x101.id, jihoz_id: f.komp102, muhimlik: 'orta', tavsif: 'Kompyuter ishlamayapti umuman' });
    assert.equal(begonaJihoz.status, 400);
    assert.match(begonaJihoz.text, /bu xonada yo&#x27;q/);
    assert.equal((await H.db().one('SELECT count(*)::int AS n FROM arizalar')).n, oldin);
  });

  it('3. 101-xona QR-kodi skanerlanadi → forma A bino va 101-xona tanlangan holda ochiladi', async () => {
    const anonim = await H.request(app).get(`/q/${f.x101.qr_token}`);
    assert.equal(anonim.status, 302);
    assert.equal(anonim.headers.location, `/login?next=${encodeURIComponent(`/q/${f.x101.qr_token}`)}`);

    const r = await talaba2.get(`/q/${f.x101.qr_token}`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, `/arizalar/yangi?xona=${f.x101.id}`);
    const forma = await talaba2.get(r.headers.location);
    assert.match(forma.text, /A bino · 101-xona/);
    assert.match(forma.text, new RegExp(`name="xona_id" value="${f.x101.id}"`));

    assert.equal((await talaba2.get('/q/eskirgan-token')).status, 404);
  });

  it('4. Ikkinchi talaba shu xonaga ariza bermoqchi → ochiq ariza ko\'rsatiladi, "Menda ham" hisoblagichni oshiradi', async () => {
    const forma = await talaba2.get(`/arizalar/yangi?xona=${f.x101.id}`);
    assert.match(forma.text, /allaqachon xabar berilgan/);
    assert.match(forma.text, /Menda ham shu muammo/);

    assert.equal((await talaba2.yubor(`/arizalar/${arizaId}/menda-ham`)).status, 302);
    await talaba2.yubor(`/arizalar/${arizaId}/menda-ham`); // takroriy bosish hisoblanmaydi
    const k = await H.db().one('SELECT count(*)::int AS n FROM ariza_kuzatuvchilar WHERE ariza_id = $1', [arizaId]);
    assert.equal(k.n, 1);
    assert.equal((await talaba2.get(`/arizalar/${arizaId}`)).status, 200, "qo'shilgan foydalanuvchi arizani ko'radi");

    await talaba.yubor(`/arizalar/${arizaId}/menda-ham`); // egasi o'ziga qo'shila olmaydi
    assert.equal((await H.db().one('SELECT count(*)::int AS n FROM ariza_kuzatuvchilar WHERE ariza_id = $1', [arizaId])).n, 1);
  });

  it('5. Boshliq arizani kompyuterchi ustaga biriktiradi → "Biriktirilgan", muddat, usta va egasi xabar oladi', async () => {
    const forma = await boshliq.get(`/arizalar/${arizaId}`);
    assert.match(forma.text, /<optgroup label="Mutaxassisligi mos"><option value="\d+"\s*>Test usta —[^<]*<\/option><\/optgroup>/, 'mos usta birinchi');

    const r = await boshliq.yubor(`/arizalar/${arizaId}/biriktirish`, { usta_id: f.usta.id });
    assert.equal(r.status, 302);
    const a = await H.ariza(arizaId);
    assert.equal(a.holat, 'biriktirilgan');
    assert.equal(a.usta_id, f.usta.id);
    assert.ok(a.muddat);
    assert.ok((await H.xabarlar(f.usta.id)).some((x) => /Sizga yangi ish/.test(x.matn)));
    assert.ok((await H.xabarlar(f.talaba.id)).some((x) => /ustaga biriktirildi/.test(x.matn)));
  });

  it('6. Usta "Bajarildi" bosadi → "Tekshiruvda", egasi tasdiqlash so\'rovini oladi', async () => {
    assert.equal((await usta.yubor(`/arizalar/${arizaId}/boshlash`)).status, 302);
    assert.equal((await H.ariza(arizaId)).holat, 'jarayonda');
    const r = await usta
      .post(`/arizalar/${arizaId}/bajarildi`)
      .field('_csrf', usta.csrf)
      .field('izoh', "Quvvat bloki almashtirildi")
      .attach('rasmlar', H.PNG, { filename: 'natija.png', contentType: 'image/png' });
    assert.equal(r.status, 302);
    const a = await H.ariza(arizaId);
    assert.equal(a.holat, 'tekshiruvda');
    assert.ok(a.bajarilgan);
    assert.ok((await H.xabarlar(f.talaba.id)).some((x) => /tasdiqlang/.test(x.matn)));
    assert.ok((await H.xabarlar(f.talaba2.id)).some((x) => /bajarildi/.test(x.matn)), 'kuzatuvchi ham xabar oladi');
    const rasm = await H.db().one("SELECT count(*)::int AS n FROM ariza_rasmlar WHERE ariza_id = $1 AND bosqich = 'bajarildi'", [arizaId]);
    assert.equal(rasm.n, 1);
    const sahifa = await talaba.get(`/arizalar/${arizaId}`);
    assert.match(sahifa.text, /Ha, ishlayapti/);
  });

  it('7. Egasi "Hali ham buzuq" ni tanlaydi → ariza qayta ochilib, o\'sha ustaga qaytadi', async () => {
    const izohsiz = await talaba.yubor(`/arizalar/${arizaId}/qayta-ochish`, { izoh: '' });
    assert.equal(izohsiz.status, 302);
    assert.equal((await H.ariza(arizaId)).holat, 'tekshiruvda', 'izohsiz qayta ochilmaydi');

    await talaba.yubor(`/arizalar/${arizaId}/qayta-ochish`, { izoh: 'Hali ham yonmayapti' });
    const a = await H.ariza(arizaId);
    assert.equal(a.holat, 'biriktirilgan');
    assert.equal(a.usta_id, f.usta.id);
    assert.equal(a.bajarilgan, null);
    assert.ok((await H.xabarlar(f.usta.id)).some((x) => /qayta ochildi/.test(x.matn)));
  });

  it('8. Egasi 3 kun javob bermaydi → ariza avtomatik "Yopilgan" bo\'ladi', async () => {
    await usta.yubor(`/arizalar/${arizaId}/boshlash`);
    await usta.post(`/arizalar/${arizaId}/bajarildi`).field('_csrf', usta.csrf).field('izoh', 'Ona plata kabeli ulandi');
    assert.equal((await H.ariza(arizaId)).holat, 'tekshiruvda');

    const jobs = require('../../src/jobs');
    assert.equal(await jobs.avtoYopish(), 0, "3 kun o'tmagan");
    await H.db().query("UPDATE arizalar SET bajarilgan = now() - interval '73 hours' WHERE id = $1", [arizaId]);
    assert.equal(await jobs.avtoYopish(), 1);
    const a = await H.ariza(arizaId);
    assert.equal(a.holat, 'yopilgan');
    assert.ok(a.yopilgan);
    const t = await H.db().one("SELECT amal, user_id FROM ariza_tarix WHERE ariza_id = $1 ORDER BY id DESC LIMIT 1", [arizaId]);
    assert.equal(t.amal, 'avto_yopildi');
    assert.equal(t.user_id, null);
    assert.ok((await H.xabarlar(f.talaba.id)).some((x) => /avtomatik yopildi/.test(x.matn)));

    // Yopilgandan keyin baho — faqat bir marta
    await talaba.yubor(`/arizalar/${arizaId}/baho`, { baho: 5, izoh: 'Rahmat' });
    await talaba.yubor(`/arizalar/${arizaId}/baho`, { baho: 1 });
    assert.equal((await H.ariza(arizaId)).baho, 5);
  });

  it('9. Muddati o\'tgan ariza → boshqaruv panelida qizil, boshliq bir marta xabar oladi', async () => {
    const id = await H.yangiAriza(talaba2, { xona_id: f.x102.id, jihoz_id: f.komp102, tavsif: 'Monitor tasvir chiqarmayapti' });
    await H.db().query("UPDATE arizalar SET muddat = now() - interval '1 hour' WHERE id = $1", [id]);

    const panel = await boshliq.get('/boshqaruv?kechikkan=1');
    assert.equal(panel.status, 200);
    assert.match(panel.text, new RegExp(`href="/arizalar/${id}"`));
    assert.match(panel.text, /arow is-late/);
    assert.match(panel.text, /Kechikkan/);

    const jobs = require('../../src/jobs');
    assert.equal(await jobs.muddatOtdi(), 1);
    assert.equal(await jobs.muddatOtdi(), 0, 'ikkinchi marta yuborilmaydi');
    assert.ok((await H.xabarlar(f.boshliq.id)).some((x) => x.ariza_id === id && /muddati o'tdi/.test(x.matn)));
  });

  it("10. Talaba boshqa talabaning arizasini yoki /boshqaruv ni ochmoqchi → 403", async () => {
    const begona = await H.yangiAriza(talaba3, { xona_id: f.x102.id, tur_id: f.turElektr, tavsif: 'Rozetka ishlamayapti, zaryad yo\'q' });
    const r = await talaba.get(`/arizalar/${begona}`);
    assert.equal(r.status, 403);
    assert.match(r.text, /ruxsatingiz yo&#x27;q/);
    assert.equal((await talaba.get('/boshqaruv')).status, 403);
    assert.equal((await talaba.get('/hisobotlar')).status, 403);
    assert.equal((await talaba.get('/admin/binolar')).status, 403);
    assert.equal((await talaba.yubor(`/arizalar/${begona}/bekor`)).status, 403);
    assert.equal((await talaba.yubor(`/arizalar/${begona}/biriktirish`, { usta_id: f.usta.id })).status, 403);
  });

  it("11. Usta o'ziga biriktirilmagan arizani o'zgartirmoqchi → 403", async () => {
    const id = await H.yangiAriza(talaba, { xona_id: f.x101.id, jihoz_id: f.stul1, tavsif: "Stulning oyog'i singan" });
    await boshliq.yubor(`/arizalar/${id}/biriktirish`, { usta_id: f.usta2.id });
    assert.equal((await usta.get(`/arizalar/${id}`)).status, 403);
    assert.equal((await usta.yubor(`/arizalar/${id}/boshlash`)).status, 403);
    assert.equal((await usta.yubor(`/arizalar/${id}/almashtirish`, { izoh: 'Sinib ketgan' })).status, 403);
    assert.equal((await H.ariza(id)).holat, 'biriktirilgan');
    assert.equal((await usta2.yubor(`/arizalar/${id}/boshlash`)).status, 302);
    assert.equal((await H.ariza(id)).holat, 'jarayonda');
    assert.equal((await usta.get('/admin/binolar')).status, 403);
  });

  it('12. Bitta stul 90 kunda 3 marta buziladi → jihoz "Muammoli" deb belgilanadi', async () => {
    // Bitta jihozda bir vaqtda bitta ochiq ariza: har biri yopilgach stul yana buziladi (biri — 60 kun oldin)
    const yop = (id) => H.db().query("UPDATE arizalar SET holat = 'yopilgan', yopilgan = now() WHERE id = $1", [id]);
    await yop((await H.db().one("SELECT id FROM arizalar WHERE jihoz_id = $1 AND holat = 'jarayonda'", [f.stul1])).id);
    await yop(await H.yangiAriza(talaba2, { xona_id: f.x101.id, jihoz_id: f.stul1, tavsif: "Stul yana qimirlayapti" }));
    const eski = await H.yangiAriza(talaba, { xona_id: f.x101.id, jihoz_id: f.stul1, tavsif: "Stulning suyanchig'i singan" });
    await H.db().query("UPDATE arizalar SET yaratilgan = now() - interval '60 days' WHERE id = $1", [eski]);

    const sahifa = await boshliq.get(`/jihozlar/${f.stul1}`);
    assert.equal(sahifa.status, 200);
    assert.match(sahifa.text, /Muammoli: 90 kunda 3 marta/);
    const hisobot = await boshliq.get('/hisobotlar');
    assert.match(hisobot.text, new RegExp(`href="/jihozlar/${f.stul1}">Stul #1`));
    const royxat = await boshliq.get('/admin/jihozlar?holat=muammoli');
    assert.match(royxat.text, /Stul #1/);
    assert.doesNotMatch(royxat.text, /Kompyuter #3/);

    // 90 kundan eski ariza hisobga kirmaydi
    await H.db().query("UPDATE arizalar SET yaratilgan = now() - interval '100 days' WHERE id = $1", [eski]);
    assert.doesNotMatch((await boshliq.get(`/jihozlar/${f.stul1}`)).text, /Muammoli:/);
  });
});
