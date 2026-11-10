// Zaxira nusxa: olish, tiklash (ketma-ketliklar bilan), eskilarini tozalash, kunlik avtomatik zaxira, admin sahifasi.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const DIR = path.join(os.tmpdir(), 'tamirlash-test-zaxira');
process.env.ZAXIRA_DIR = DIR;
process.env.ZAXIRA_AVTO = 'true';
process.env.ZAXIRA_SAQLASH = '3';
const H = require('../helpers');

describe('Zaxira nusxa', { skip: H.skip }, () => {
  let app;
  let f;
  let talaba;
  let zaxira;

  before(async () => {
    fs.rmSync(DIR, { recursive: true, force: true });
    await H.resetDb();
    f = await H.fixtures();
    app = require('../../src/app').createApp();
    zaxira = require('../../src/db/zaxira');
    talaba = await H.kirish(app, 'talaba');
  });
  after(() => H.db().pool.end());

  it("Zaxira olinadi va undan baza to'liq tiklanadi", async () => {
    const id = await H.yangiAriza(talaba, { xona_id: f.x101.id, jihoz_id: f.komp3, tavsif: 'Asl tavsif: kompyuter yonmayapti' });
    const z = await zaxira.yarat();
    assert.match(z.nom, /^zaxira-\d{4}-\d{2}-\d{2}_\d{4}\.json\.gz$/);
    const ichida = JSON.parse(zlib.gunzipSync(fs.readFileSync(z.fayl)));
    assert.equal(ichida.jadvallar.arizalar.length, 1);
    assert.deepEqual(ichida.migratsiyalar, ['001_init', '002_telegram']);

    // Zaxiradan keyingi o'zgarishlar
    await H.db().query("UPDATE arizalar SET tavsif = 'Buzilgan tavsif ...' WHERE id = $1", [id]);
    await H.db().query("INSERT INTO users (ism, familiya, login, parol_hash, rol) VALUES ('Yangi', 'Odam', 'yangi', 'x', 'user')");
    await H.db().query('DELETE FROM ariza_tarix');

    const soni = await zaxira.tiklash(z.fayl);
    assert.equal(soni.arizalar, 1);
    assert.equal((await H.ariza(id)).tavsif, 'Asl tavsif: kompyuter yonmayapti');
    assert.equal(await H.db().one("SELECT 1 FROM users WHERE login = 'yangi'"), null);
    assert.ok((await H.db().one('SELECT count(*)::int AS n FROM ariza_tarix')).n > 0);

    // Tiklangandan keyin: parol ishlaydi, yangi yozuvlar to'qnashmaydi (ketma-ketliklar tiklangan)
    const yana = await H.kirish(app, 'talaba');
    const id2 = await H.yangiAriza(yana, { xona_id: f.x101.id, jihoz_id: f.stul1, tavsif: "Stulning oyog'i singan" });
    assert.equal(id2, id + 1);
    assert.match((await H.ariza(id2)).raqam, /-0002$/);
  });

  it("Boshqa versiyadagi yoki begona fayl tiklanmaydi", async () => {
    const z = await zaxira.yarat();
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(z.fayl)));
    const eski = path.join(DIR, 'eski.json.gz');
    fs.writeFileSync(eski, zlib.gzipSync(JSON.stringify({ ...data, migratsiyalar: ['001_init'] })));
    await assert.rejects(zaxira.tiklash(eski), /boshqa versiyada/);
    fs.writeFileSync(eski, zlib.gzipSync(JSON.stringify({ salom: 1 })));
    await assert.rejects(zaxira.tiklash(eski), /zaxirasi emas/);
    fs.unlinkSync(eski);
  });

  it("Faqat oxirgi ZAXIRA_SAQLASH (3) tasi qoladi", async () => {
    for (let i = 0; i < 3; i++) await zaxira.yarat();
    assert.ok(zaxira.royxat().length >= 5);
    zaxira.tozala();
    assert.equal(zaxira.royxat().length, 3);
  });

  it("Kunlik zaxira: oxirgisi 23 soatdan eski bo'lgandagina olinadi", async () => {
    const jobs = require('../../src/jobs');
    assert.equal(await jobs.kunlikZaxira(), null, 'yangi zaxira bor');
    const eski = new Date(Date.now() - 25 * 3600e3);
    for (const z of zaxira.royxat()) fs.utimesSync(path.join(DIR, z.nom), eski, eski);
    const nom = await jobs.kunlikZaxira();
    assert.match(nom, /^zaxira-/);
    assert.equal(zaxira.royxat()[0].nom, nom);
    assert.equal(zaxira.royxat().length, 3);
  });

  it("Admin sahifasi: faqat admin ko'radi va yuklab oladi; boshqa fayllarga yo'l yo'q", async () => {
    const admin = await H.kirish(app, 'admin', 'admin12345');
    const boshliq = await H.kirish(app, 'boshliq');
    assert.equal((await boshliq.get('/admin/zaxira')).status, 403);
    const sahifa = await admin.get('/admin/zaxira');
    assert.equal(sahifa.status, 200);
    const nom = zaxira.royxat()[0].nom;
    assert.match(sahifa.text, new RegExp(nom));

    assert.equal((await admin.yubor('/admin/zaxira')).status, 302);
    const fayl = await admin.get(`/admin/zaxira/${nom}`).buffer(true).parse((res, cb) => {
      const d = [];
      res.on('data', (c) => d.push(c));
      res.on('end', () => cb(null, Buffer.concat(d)));
    });
    assert.equal(fayl.status, 200);
    assert.equal(fayl.body[0], 0x1f, 'gzip');
    assert.equal(fayl.body[1], 0x8b);
    assert.equal((await boshliq.get(`/admin/zaxira/${nom}`)).status, 403);
    assert.equal((await admin.get('/admin/zaxira/..%2F..%2F.env')).status, 404);
    assert.equal((await admin.get('/admin/zaxira/boshqa.txt')).status, 404);
  });
});
