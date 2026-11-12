// Boshqaruv imkoniyatlari: dublikatlarni birlashtirish, almashtirish, qayta biriktirish, muddatlar,
// ma'lumotnomalar (bino/xona/jihoz), QR, Excel import/eksport, foydalanuvchilar.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const H = require('../helpers');

describe('Boshqaruv', { skip: H.skip }, () => {
  let app;
  let f;
  let talaba;
  let talaba2;
  let usta;
  let usta2;
  let boshliq;
  let admin;

  before(async () => {
    await H.resetDb();
    f = await H.fixtures();
    app = require('../../src/app').createApp();
    [talaba, talaba2, usta, usta2, boshliq] = await Promise.all(
      ['talaba', 'talaba2', 'usta', 'usta2', 'boshliq'].map((l) => H.kirish(app, l))
    );
    admin = await H.kirish(app, 'admin', 'admin12345');
  });
  after(() => H.db().pool.end());

  const yangi = (agent, extra = {}) =>
    H.yangiAriza(agent, { xona_id: f.x101.id, tur_id: f.turKomp, tavsif: 'Kompyuter yonmayapti umuman', ...extra });

  it("Shoshilinch ariza darhol boshliqqa xabar beradi va muddati 4 soat", async () => {
    const id = await yangi(talaba, { muhimlik: 'shoshilinch', jihoz_id: '', tur_id: f.turElektr, tavsif: 'Rozetkadan uchqun chiqyapti!' });
    const a = await H.ariza(id);
    const farq = (new Date(a.muddat) - new Date(a.yaratilgan)) / 3600e3;
    assert.ok(Math.abs(farq - 4) < 0.01, `muddat ${farq} soat`);
    assert.ok((await H.xabarlar(f.boshliq.id)).some((x) => x.ariza_id === id && /Shoshilinch/.test(x.matn)));
    assert.ok((await H.xabarlar(f.admin.id)).some((x) => x.ariza_id === id && /Shoshilinch/.test(x.matn)), 'admin ham');
  });

  it("Har bir yangi ariza boshliq va adminga xabar qilinadi, yozgan odamning o'ziga emas", async () => {
    const id = await yangi(talaba, { tavsif: 'Sichqoncha ishlamayapti, kursor qimirlamaydi' });
    for (const kim of [f.boshliq, f.admin]) {
      const x = (await H.xabarlar(kim.id)).find((b) => b.ariza_id === id);
      assert.ok(x, `rol: ${kim.rol}`);
      assert.match(x.matn, /^Yangi ariza: T-\d{4}-\d{4} \(A bino, 101-xona — Kompyuter\) — Sichqoncha/);
    }
    assert.equal((await H.xabarlar(f.talaba.id)).filter((b) => b.ariza_id === id).length, 0);
    assert.equal((await H.xabarlar(f.usta.id)).filter((b) => b.ariza_id === id).length, 0, 'usta biriktirilganda oladi');

    const oz = await yangi(admin, { tavsif: "Admin o'zi yozgan ariza, proyektor" });
    assert.equal((await H.xabarlar(f.admin.id)).filter((b) => b.ariza_id === oz).length, 0, "o'ziga yuborilmaydi");
    assert.ok((await H.xabarlar(f.boshliq.id)).some((b) => b.ariza_id === oz));
  });

  it("Bir vaqtda berilgan arizalar takrorlanmaydigan ketma-ket raqam oladi; parallel amal ikki marta bajarilmaydi", async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => yangi(talaba2, { xona_id: f.x102.id })));
    const raqamlar = (await H.db().many('SELECT raqam FROM arizalar WHERE id = ANY($1::bigint[]) ORDER BY raqam', [ids])).map((r) => r.raqam);
    assert.equal(new Set(raqamlar).size, 10);
    const n = raqamlar.map((r) => Number(r.slice(-4)));
    assert.equal(n.at(-1) - n[0], 9, 'oraliqsiz ketma-ketlik');

    const id = ids[0];
    await boshliq.yubor(`/arizalar/${id}/biriktirish`, { usta_id: f.usta.id });
    await Promise.all([usta.yubor(`/arizalar/${id}/boshlash`), usta.yubor(`/arizalar/${id}/boshlash`)]);
    const t = await H.db().one("SELECT count(*)::int AS n FROM ariza_tarix WHERE ariza_id = $1 AND amal = 'boshlandi'", [id]);
    assert.equal(t.n, 1);
  });

  it("Dublikat asosiy arizaga birlashtiriladi: egasi asosiy arizani kuzatadi", async () => {
    const asosiy = await yangi(talaba);
    const dublikat = await yangi(talaba2, { tavsif: 'Bu kompyuter ham ishlamayapti' });
    const r = await boshliq.yubor(`/arizalar/${dublikat}/birlashtirish`, { asosiy_id: asosiy });
    assert.equal(r.headers.location, `/arizalar/${asosiy}`);
    const d = await H.ariza(dublikat);
    assert.equal(d.holat, 'rad_etilgan');
    assert.equal(d.birlashtirilgan_id, asosiy);
    assert.match(d.rad_sababi, /Dublikat: T-/);
    const k = await H.db().one('SELECT 1 AS ok FROM ariza_kuzatuvchilar WHERE ariza_id = $1 AND user_id = $2', [asosiy, f.talaba2.id]);
    assert.ok(k, 'dublikat egasi kuzatuvchi bo\'ldi');
    assert.equal((await talaba2.get(`/arizalar/${asosiy}`)).status, 200);
    assert.ok((await H.xabarlar(f.talaba2.id)).some((x) => /birlashtirildi/.test(x.matn)));

    // Boshqa xonadagi arizaga birlashtirib bo'lmaydi
    const boshqaXona = await yangi(talaba2, { xona_id: f.x102.id, jihoz_id: f.komp102 });
    await boshliq.yubor(`/arizalar/${boshqaXona}/birlashtirish`, { asosiy_id: asosiy });
    assert.equal((await H.ariza(boshqaXona)).holat, 'yangi');
    const sahifa = await boshliq.get(`/arizalar/${boshqaXona}`);
    assert.match(sahifa.text, /bitta xonadagi arizalarni/);
  });

  it("Qayta biriktirish: yangi usta va eski usta xabar oladi; o'tgan muddat qabul qilinmaydi", async () => {
    const id = await yangi(talaba);
    await boshliq.yubor(`/arizalar/${id}/biriktirish`, { usta_id: f.usta.id });
    await usta.yubor(`/arizalar/${id}/boshlash`);
    assert.equal((await H.ariza(id)).holat, 'jarayonda');

    await boshliq.yubor(`/arizalar/${id}/biriktirish`, { usta_id: f.usta.id, muddat: '2020-01-01T10:00' });
    assert.match((await boshliq.get(`/arizalar/${id}`)).text, /Muddat kelajakdagi vaqt/);

    await boshliq.yubor(`/arizalar/${id}/biriktirish`, { usta_id: f.usta2.id });
    const a = await H.ariza(id);
    assert.equal(a.usta_id, f.usta2.id);
    assert.equal(a.holat, 'biriktirilgan', 'yangi usta ishni qaytadan boshlaydi');
    assert.ok((await H.xabarlar(f.usta.id)).some((x) => /boshqa ustaga berildi/.test(x.matn)));
    assert.ok((await H.xabarlar(f.usta2.id)).some((x) => /Sizga yangi ish/.test(x.matn)));

    // Muhimlik o'zgarsa, muddat yaratilgan vaqtdan qayta hisoblanadi
    await boshliq.yubor(`/arizalar/${id}/biriktirish`, { usta_id: f.usta2.id, muhimlik: 'shoshilinch' });
    const b = await H.ariza(id);
    assert.equal(b.muhimlik, 'shoshilinch');
    assert.ok(Math.abs((new Date(b.muddat) - new Date(b.yaratilgan)) / 3600e3 - 4) < 0.01);
    const tarix = await H.db().many('SELECT amal FROM ariza_tarix WHERE ariza_id = $1 ORDER BY id', [id]);
    assert.deepEqual(tarix.map((t) => t.amal), ['yaratildi', 'biriktirildi', 'boshlandi', 'qayta_biriktirildi', 'muddat']);
  });

  it("Ehtiyot qism kutish → davom; qismdan to'g'ridan-to'g'ri bajarildi ham mumkin", async () => {
    const id = await yangi(talaba);
    await boshliq.yubor(`/arizalar/${id}/biriktirish`, { usta_id: f.usta.id });
    await usta.yubor(`/arizalar/${id}/boshlash`);
    await usta.yubor(`/arizalar/${id}/qism-kutish`, { izoh: '' });
    assert.equal((await H.ariza(id)).holat, 'jarayonda', 'izohsiz qism kutish yo\'q');
    await usta.yubor(`/arizalar/${id}/qism-kutish`, { izoh: 'Quvvat bloki 450W' });
    assert.equal((await H.ariza(id)).holat, 'kutilmoqda');
    await usta.yubor(`/arizalar/${id}/davom`);
    assert.equal((await H.ariza(id)).holat, 'jarayonda');
    await usta.yubor(`/arizalar/${id}/qism-kutish`, { izoh: 'Kabel' });
    await usta.post(`/arizalar/${id}/bajarildi`).field('_csrf', usta.csrf).field('izoh', 'Kabel keldi va ulandi');
    assert.equal((await H.ariza(id)).holat, 'tekshiruvda');
    // Boshliq ham tasdiqlay oladi (TZ, 2-bo'lim)
    await boshliq.yubor(`/arizalar/${id}/tasdiqlash`);
    assert.equal((await H.ariza(id)).holat, 'yopilgan');
    // Yopilgan arizada usta amali — xato
    await usta.yubor(`/arizalar/${id}/boshlash`);
    assert.equal((await H.ariza(id)).holat, 'yopilgan');
  });

  it("Almashtirish kerak → boshliq yopadi va jihozni hisobdan chiqaradi", async () => {
    const id = await yangi(talaba, { jihoz_id: f.komp3 });
    await boshliq.yubor(`/arizalar/${id}/yopish`);
    assert.equal((await H.ariza(id)).holat, 'yangi', 'belgisiz yopilmaydi');
    await boshliq.yubor(`/arizalar/${id}/biriktirish`, { usta_id: f.usta.id });
    await usta.yubor(`/arizalar/${id}/almashtirish`, { izoh: 'Ona plata kuygan' });
    const a = await H.ariza(id);
    assert.equal(a.almashtirish_kerak, true);
    assert.ok((await H.xabarlar(f.boshliq.id)).some((x) => x.ariza_id === id && /almashtirish kerak/.test(x.matn)));
    await boshliq.yubor(`/arizalar/${id}/yopish`, { izoh: 'Yangi kompyuter buyurtma qilindi', hisobdan: 'on' });
    assert.equal((await H.ariza(id)).holat, 'yopilgan');
    assert.equal((await H.db().one('SELECT faol FROM jihozlar WHERE id = $1', [f.komp3])).faol, false);
    // Hisobdan chiqarilgan jihozga ariza berilmaydi
    const r = await talaba.ariza({ xona_id: f.x101.id, jihoz_id: f.komp3, muhimlik: 'orta', tavsif: 'Kompyuter yana ishlamayapti' });
    assert.equal(r.status, 400);
    await H.db().query('UPDATE jihozlar SET faol = TRUE WHERE id = $1', [f.komp3]);
  });

  it("Bekor qilish faqat egasi va faqat 'Yangi' holatda; rad etishga sabab shart", async () => {
    const id = await yangi(talaba);
    await talaba2.yubor(`/arizalar/${id}/bekor`);
    assert.equal((await H.ariza(id)).holat, 'yangi');
    await boshliq.yubor(`/arizalar/${id}/rad-etish`, { izoh: '' });
    assert.equal((await H.ariza(id)).holat, 'yangi');
    await talaba.yubor(`/arizalar/${id}/bekor`);
    assert.equal((await H.ariza(id)).holat, 'rad_etilgan');

    const id2 = await yangi(talaba);
    await boshliq.yubor(`/arizalar/${id2}/rad-etish`, { izoh: "Bu jihoz bo'lim mulki emas" });
    const a = await H.ariza(id2);
    assert.equal(a.holat, 'rad_etilgan');
    assert.ok((await H.xabarlar(f.talaba.id)).some((x) => /rad etildi: Bu jihoz/.test(x.matn)));
  });

  it("Muddat yaqinlashganda ustaga bir marta xabar boradi", async () => {
    const id = await yangi(talaba);
    await boshliq.yubor(`/arizalar/${id}/biriktirish`, { usta_id: f.usta2.id });
    await H.db().query("UPDATE arizalar SET muddat = now() + interval '90 minutes' WHERE id = $1", [id]);
    const jobs = require('../../src/jobs');
    assert.ok((await jobs.muddatYaqin()) >= 1);
    assert.equal(await jobs.muddatYaqin(), 0);
    assert.ok((await H.xabarlar(f.usta2.id)).some((x) => x.ariza_id === id && /2 soatdan kam/.test(x.matn)));
    const natija = await jobs.hammasi();
    assert.deepEqual(Object.keys(natija), ['yopildi', 'yaqin', 'otdi']);
  });

  it("Bildirishnoma bosilganda o'qiladi va arizaga olib boradi; begona bildirishnoma ochilmaydi", async () => {
    const x = await H.db().one('SELECT id, ariza_id FROM bildirishnomalar WHERE user_id = $1 ORDER BY id LIMIT 1', [f.talaba.id]);
    const r = await talaba.get(`/bildirishnomalar/${x.id}`);
    assert.equal(r.headers.location, `/arizalar/${x.ariza_id}`);
    assert.equal((await H.db().one('SELECT oqilgan FROM bildirishnomalar WHERE id = $1', [x.id])).oqilgan, true);
    const begona = await H.db().one('SELECT id FROM bildirishnomalar WHERE user_id = $1 AND NOT oqilgan LIMIT 1', [f.boshliq.id]);
    assert.equal((await talaba.get(`/bildirishnomalar/${begona.id}`)).headers.location, '/bildirishnomalar');
    assert.equal((await H.db().one('SELECT oqilgan FROM bildirishnomalar WHERE id = $1', [begona.id])).oqilgan, false);
    await talaba.yubor('/bildirishnomalar/oqildi');
    assert.equal((await H.db().one('SELECT count(*)::int AS n FROM bildirishnomalar WHERE user_id = $1 AND NOT oqilgan', [f.talaba.id])).n, 0);
  });

  it("Bino, xona, jihoz qo'shish; QR-kod va takroriy raqam tekshiruvi", async () => {
    let r = await boshliq.yubor('/admin/binolar', { nomi: 'C bino', manzil: '', qavatlar_soni: 2 });
    const binoId = Number(r.headers.location.split('/').pop());
    assert.equal((await boshliq.yubor('/admin/binolar', { nomi: 'c BINO', qavatlar_soni: 1 })).status, 400, 'nom katta-kichik harfga qaramay takrorlanmaydi');

    r = await boshliq.yubor('/admin/xonalar', { bino_id: binoId, qavat: 2, raqam: '210', turi: 'laboratoriya' });
    const xonaId = Number(r.headers.location.split('/').pop());
    const xona = await H.db().one('SELECT qr_token FROM xonalar WHERE id = $1', [xonaId]);
    assert.match(xona.qr_token, /^[A-Za-z0-9_-]{16}$/);
    assert.equal((await boshliq.yubor('/admin/xonalar', { bino_id: binoId, qavat: 1, raqam: '210', turi: 'auditoriya' })).status, 400);
    assert.match((await boshliq.yubor('/admin/xonalar', { bino_id: binoId, qavat: 5, raqam: '501', turi: 'auditoriya' })).text, /2 ta qavat bor/);

    r = await boshliq.yubor('/admin/jihozlar', { xona_id: xonaId, tur_id: f.turKomp, belgi: '#1', inventar_raqami: 'INV-C-1' });
    assert.equal(r.status, 302);
    assert.equal((await boshliq.yubor('/admin/jihozlar', { xona_id: xonaId, tur_id: f.turKomp, belgi: '#2', inventar_raqami: 'inv-c-1' })).status, 400);

    const svg = await boshliq.get(`/xonalar/${xonaId}/qr.svg`);
    assert.equal(svg.status, 200);
    assert.match(svg.headers['content-type'], /image\/svg\+xml/);
    const chop = await boshliq.get(`/admin/binolar/${binoId}/qr`);
    assert.match(chop.text, /C bino · 210-xona/);
    assert.match(chop.text, new RegExp(`https://tamir.test/q/${xona.qr_token}`));

    await boshliq.yubor(`/admin/xonalar/${xonaId}/qr-yangilash`);
    const yangiToken = (await H.db().one('SELECT qr_token FROM xonalar WHERE id = $1', [xonaId])).qr_token;
    assert.notEqual(yangiToken, xona.qr_token);
    assert.equal((await talaba.get(`/q/${xona.qr_token}`)).status, 404, 'eski QR ishlamaydi');

    // Xonasi bor binoni o'chirib bo'lmaydi
    await boshliq.yubor(`/admin/binolar/${binoId}/ochirish`);
    assert.ok(await H.db().one('SELECT 1 FROM binolar WHERE id = $1', [binoId]));
  });

  it("Excel import: xato bo'lsa hech narsa saqlanmaydi, to'g'ri fayl yangi xonani ham yaratadi", async () => {
    const fayl = async (qatorlar) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Jihozlar');
      ws.addRow(['Bino', 'Qavat', 'Xona', 'Jihoz turi', 'Belgisi', 'Inventar raqami']);
      qatorlar.forEach((q) => ws.addRow(q));
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const yukla = async (buf) =>
      boshliq.post('/admin/jihozlar/import').field('_csrf', boshliq.csrf).attach('fayl', buf, { filename: 'j.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const soni = async () => (await H.db().one('SELECT count(*)::int AS n FROM jihozlar')).n;
    const oldin = await soni();

    const xato = await yukla(await fayl([
      ['A bino', 1, '101', 'Stol', '#7', 'INV-X1'],
      ['Yoq bino', 1, '101', 'Stol', '#8', ''],
      ['A bino', 1, '101', 'Uchar likopcha', '#9', ''],
      ['A bino', 1, '101', 'Stol', '#10', 'INV-X1'],
    ]));
    assert.equal(xato.status, 400);
    assert.match(xato.text, /3 ta xato/);
    assert.match(xato.text, /3-qator: &quot;Yoq bino&quot; binosi topilmadi/);
    assert.match(xato.text, /faylda takrorlangan/);
    assert.equal(await soni(), oldin);

    const ok = await yukla(await fayl([
      ['A bino', 1, '101', 'Stol', '#7', 'INV-X1'],
      ['a bino', 3, '305', 'kompyuter', '#1', ''],
    ]));
    assert.equal(ok.status, 302);
    assert.equal(await soni(), oldin + 2);
    assert.ok(await H.db().one("SELECT 1 FROM xonalar WHERE raqam = '305' AND qavat = 3"));

    assert.equal((await yukla(Buffer.from('bu excel emas'))).status, 400);
    const namuna = await boshliq.get('/admin/jihozlar/namuna.xlsx').buffer(true).parse((res, cb) => {
      const d = [];
      res.on('data', (c) => d.push(c));
      res.on('end', () => cb(null, Buffer.concat(d)));
    });
    assert.equal(namuna.body.subarray(0, 2).toString(), 'PK');
  });

  it("Hisobot sahifasi va Excel eksport", async () => {
    const r = await boshliq.get('/hisobotlar?dan=2020-01-01&gacha=2099-12-31');
    assert.equal(r.status, 200);
    assert.match(r.text, /Jami arizalar/);
    assert.match(r.text, /Kompyuter/);
    const teskari = await boshliq.get('/hisobotlar?dan=2099-01-01&gacha=2020-01-01');
    assert.equal(teskari.status, 200, "sanalar almashib qolsa ham ishlaydi");

    const x = await boshliq.get('/hisobotlar/excel?dan=2020-01-01&gacha=2099-12-31').buffer(true).parse((res, cb) => {
      const d = [];
      res.on('data', (c) => d.push(c));
      res.on('end', () => cb(null, Buffer.concat(d)));
    });
    assert.equal(x.status, 200);
    assert.match(x.headers['content-disposition'], /hisobot-2020-01-01-2099-12-31\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Arizalar', 'Ustalar', 'Xonalar']);
    const jami = (await H.db().one('SELECT count(*)::int AS n FROM arizalar')).n;
    assert.equal(wb.getWorksheet('Arizalar').rowCount, jami + 1);
  });

  it("Admin usta qo'shadi (mutaxassislik shart), u vaqtinchalik parol bilan kiradi; yagona adminni bloklab bo'lmaydi", async () => {
    const yoq = await admin.yubor('/admin/foydalanuvchilar', { familiya: 'Olimov', ism: 'Aziz', login: 'usta.yangi', rol: 'usta', parol: 'vaqtinch1' });
    assert.equal(yoq.status, 400);
    assert.match(yoq.text, /kamida bitta mutaxassisligini/);

    const r = await admin
      .post('/admin/foydalanuvchilar')
      .type('form')
      .send(`_csrf=${encodeURIComponent(admin.csrf)}&familiya=Olimov&ism=Aziz&login=Usta.Yangi&rol=usta&telefon=90%20111%2022%2033&parol=vaqtinch1&mutaxassisliklar=elektr&mutaxassisliklar=santexnika`);
    assert.equal(r.status, 302);
    const u = await H.db().one("SELECT id, login, telefon, parol_almashtirish FROM users WHERE login = 'usta.yangi'");
    assert.equal(u.telefon, '+998901112233');
    assert.equal(u.parol_almashtirish, true);
    const m = await H.db().many('SELECT mutaxassislik FROM usta_mutaxassislik WHERE user_id = $1 ORDER BY 1', [u.id]);
    assert.deepEqual(m.map((x) => x.mutaxassislik), ['elektr', 'santexnika']);
    assert.equal((await admin.yubor('/admin/foydalanuvchilar', { familiya: 'B', ism: 'C', login: 'usta.yangi', rol: 'user', parol: 'vaqtinch1' })).status, 400, 'login band');

    const yangiUsta = await H.kirish(app, 'usta.yangi', 'vaqtinch1');
    assert.equal((await yangiUsta.get('/mening-ishlarim')).headers.location, '/profil');

    // Admin o'zini bloklay olmaydi va yagona admin rolini yo'qotmaydi
    const oz = await admin.yubor(`/admin/foydalanuvchilar/${f.admin.id}`, { familiya: 'Administrator', ism: 'Tizim', login: 'admin', rol: 'admin', toifa: 'xodim' });
    assert.equal(oz.status, 400);
    assert.match(oz.text, /O&#x27;zingizni bloklay olmaysiz/);
  });

  it("Ustalar sahifasi: boshliq mutaxassislikni o'zgartiradi", async () => {
    const r = await boshliq.get('/admin/ustalar');
    assert.equal(r.status, 200);
    assert.match(r.text, /Test usta/);
    await boshliq.post(`/admin/ustalar/${f.usta2.id}`).type('form').send(`_csrf=${encodeURIComponent(boshliq.csrf)}&mutaxassisliklar=mebel&mutaxassisliklar=umumiy`);
    const m = await H.db().many('SELECT mutaxassislik FROM usta_mutaxassislik WHERE user_id = $1 ORDER BY 1', [f.usta2.id]);
    assert.deepEqual(m.map((x) => x.mutaxassislik), ['mebel', 'umumiy']);
    assert.equal((await usta.get('/admin/ustalar')).status, 403);
  });
});
