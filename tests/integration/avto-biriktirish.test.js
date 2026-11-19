// Yangi arizani mos ustaga avtomatik biriktirish ("Ustalar" sahifasida yoqiladi / o'chiriladi).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../helpers');

describe('Avtomatik biriktirish', { skip: H.skip }, () => {
  let app;
  let f;
  let talaba;
  let talaba2;
  let boshliq;
  let usta;

  before(async () => {
    await H.resetDb();
    f = await H.fixtures();
    app = require('../../src/app').createApp();
    [talaba, talaba2, boshliq, usta] = await Promise.all(['talaba', 'talaba2', 'boshliq', 'usta'].map((l) => H.kirish(app, l)));
  });
  after(() => H.db().pool.end());

  const yoq = (v) => boshliq.yubor('/admin/ustalar/avto', { yoqilgan: String(v) });
  const komp = (agent, extra = {}) =>
    H.yangiAriza(agent, { xona_id: f.x101.id, tur_id: f.turKomp, tavsif: 'Kompyuter yonmayapti umuman', ...extra });
  const yangiUsta = async (login, mutaxassislik) => {
    const u = await H.db().one(
      "INSERT INTO users (ism, familiya, login, parol_hash, rol) VALUES ($1, 'Usta', $1, 'x', 'usta') RETURNING id",
      [login]
    );
    await H.db().query('INSERT INTO usta_mutaxassislik (user_id, mutaxassislik) VALUES ($1, $2)', [u.id, mutaxassislik]);
    return u.id;
  };
  const ustasi = async (id) => String((await H.ariza(id)).usta_id);

  it("Faqat boshliq va admin yoqadi; holati «Ustalar» sahifasida ko'rinadi", async () => {
    assert.match((await boshliq.get('/admin/ustalar')).text, /Avtomatik biriktirish: <span class="badge">o(?:'|&#x27;)chirilgan/);
    assert.equal((await talaba.yubor('/admin/ustalar/avto', { yoqilgan: 'true' })).status, 403);
    assert.equal((await usta.yubor('/admin/ustalar/avto', { yoqilgan: 'true' })).status, 403);

    const r = await yoq(true);
    assert.equal(r.headers.location, '/admin/ustalar');
    assert.match((await boshliq.get('/admin/ustalar')).text, /holat-yopilgan">yoqilgan/);
    const s = await H.db().one("SELECT qiymat, user_id FROM sozlamalar WHERE kalit = 'avto_biriktirish'");
    assert.equal(s.qiymat, 'true');
    assert.equal(String(s.user_id), String(f.boshliq.id), 'kim yoqqani yoziladi');
  });

  it("Kompyuter arizasi kompyuter ustasiga o'zi biriktiriladi; usta, egasi va boshliq xabar oladi", async () => {
    const id = await komp(talaba);
    const a = await H.ariza(id);
    assert.equal(a.holat, 'biriktirilgan');
    assert.equal(String(a.usta_id), String(f.usta.id));

    const t = await H.db().one("SELECT user_id, izoh FROM ariza_tarix WHERE ariza_id = $1 AND amal = 'avto_biriktirildi'", [id]);
    assert.equal(t.user_id, null, 'tizim biriktirdi');
    assert.match(t.izoh, /mutaxassisligi mos, faol ishlari: 0/);

    assert.ok((await H.xabarlar(f.usta.id)).some((x) => x.ariza_id === id && /Sizga yangi ish/.test(x.matn)));
    assert.ok((await H.xabarlar(f.talaba.id)).some((x) => x.ariza_id === id && /ustaga biriktirildi/.test(x.matn)));
    assert.ok((await H.xabarlar(f.boshliq.id)).some((x) => x.ariza_id === id && /\(avtomatik\)/.test(x.matn)));
    assert.ok((await H.xabarlar(f.admin.id)).some((x) => x.ariza_id === id && /\(avtomatik\)/.test(x.matn)));

    const sahifa = await talaba.get(`/arizalar/${id}`);
    assert.match(sahifa.text, /qabul qilindi va ustaga biriktirildi/);
    assert.match(sahifa.text, /Ustaga avtomatik biriktirildi/);
    assert.equal((await usta.yubor(`/arizalar/${id}/boshlash`)).status, 302, 'usta darhol ishni boshlay oladi');
    assert.equal((await H.ariza(id)).holat, 'jarayonda');
  });

  it("Ish teng taqsimlanadi: faol ishi kam, teng bo'lsa — uzoqroq ish olmagan ustaga", async () => {
    const u3 = await yangiUsta('usta3', 'kompyuter');
    const a1 = await komp(talaba2, { xona_id: f.x102.id, tavsif: 'Monitor tasvir bermayapti' });
    assert.equal(await ustasi(a1), String(u3), "birinchi ustada 1 ta ish bor — yangi usta oladi");
    const a2 = await komp(talaba, { tavsif: 'Klaviatura tugmalari ishlamayapti' });
    assert.equal(await ustasi(a2), String(f.usta.id), 'ikkalasida 1 tadan — oldinroq ish olganiga');
  });

  it("Mos usta bo'lmasa — ariza boshliqda qoladi; «umumiy» usta bo'lsa — unga", async () => {
    const id = await H.yangiAriza(talaba, { xona_id: f.x101.id, tur_id: f.turElektr, tavsif: 'Rozetkadan uchqun chiqyapti' });
    const a = await H.ariza(id);
    assert.equal(a.holat, 'yangi');
    assert.equal(a.usta_id, null);
    assert.ok((await H.xabarlar(f.boshliq.id)).some((x) => x.ariza_id === id && /mos usta yo‘q, qo‘lda biriktiring/.test(x.matn)));

    const umumiy = await yangiUsta('usta4', 'umumiy');
    const id2 = await H.yangiAriza(talaba2, { xona_id: f.x102.id, tur_id: f.turElektr, tavsif: 'Chiroq yonmayapti, almashtirish kerak' });
    assert.equal(await ustasi(id2), String(umumiy));
  });

  it("Boshliq avtomatik biriktirilgan arizani boshqa ustaga o'tkaza oladi", async () => {
    const id = await komp(talaba2, { xona_id: f.x102.id, tavsif: 'Sichqoncha kursori qimirlamayapti' });
    const yangi = (await ustasi(id)) === String(f.usta.id) ? f.usta2.id : f.usta.id;
    await boshliq.yubor(`/arizalar/${id}/biriktirish`, { usta_id: yangi });
    assert.equal(await ustasi(id), String(yangi));
  });

  it("O'chirilsa — «Yangi» holatda qoladi; mavjud arizaga qo'shilgan xabar ustani o'zgartirmaydi", async () => {
    await yoq(false);
    const id = await komp(talaba, { tavsif: 'Kompyuter tez-tez qotib qolyapti' });
    assert.equal((await H.ariza(id)).holat, 'yangi');

    await yoq(true);
    const j = await H.yangiAriza(talaba, { xona_id: f.x101.id, jihoz_id: f.komp3, tavsif: 'Kompyuter #3 umuman yonmayapti' });
    const oldin = await ustasi(j);
    assert.notEqual(oldin, 'null');
    const r = await talaba2.ariza({ xona_id: f.x101.id, jihoz_id: f.komp3, muhimlik: 'orta', tavsif: 'Menda ham yonmayapti, ekran qora' });
    assert.equal(r.headers.location, `/arizalar/${j}`);
    assert.equal(await ustasi(j), oldin);
  });
});
