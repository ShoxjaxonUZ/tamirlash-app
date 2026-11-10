// Joylar ma'lumotnomasi (boshliq va admin): binolar, xonalar, jihozlar, jihoz turlari, QR-kodlar, Excel import.
//   admin  → /admin/binolar, /admin/xonalar, /admin/jihozlar, /admin/turlar
//   xonalar → /xonalar/:id (xona kartochkasi), jihozlar → /jihozlar/:id (ta'mir tarixi)
const express = require('express');
const { one, many, query } = require('../../db/pool');
const { h, toId, flash, HttpError } = require('../../lib/http');
const { Tekshiruv } = require('../../lib/validate');
const { OCHIQ } = require('../../lib/holat');
const { XONA_TURLARI, MUTAXASSISLIKLAR } = require('../../lib/roles');
const { qrSvg, qrUrl, yangiToken } = require('../../lib/qr');
const upload = require('../../middleware/upload');
const Q = require('../arizalar/queries');
const importer = require('./import');

const admin = express.Router();
const xonalar = express.Router();
const jihozlar = express.Router();

const ID = '/:id(\\d+)';
const unikal = (err) => err && err.code === '23505';
const xonaTurlari = Object.entries(XONA_TURLARI).map(([kalit, nomi]) => ({ kalit, nomi }));
const mutaxassisliklar = Object.entries(MUTAXASSISLIKLAR).map(([kalit, nomi]) => ({ kalit, nomi }));

// Xonalar <optgroup> uchun binolar bo'yicha guruhlanadi
async function xonaGuruhlari() {
  const g = new Map();
  for (const x of await Q.faolXonalar()) {
    if (!g.has(x.bino)) g.set(x.bino, []);
    g.get(x.bino).push(x);
  }
  return [...g].map(([bino, items]) => ({ bino, items }));
}

// --- Binolar --------------------------------------------------------------------------------------

function binoTekshir(body) {
  const t = new Tekshiruv();
  const d = {
    nomi: t.matn(body.nomi, 'Bino nomi', { max: 60, majburiy: true }),
    manzil: t.matn(body.manzil, 'Manzil', { max: 200 }),
    qavatlar_soni: t.son(body.qavatlar_soni, 'Qavatlar soni', { min: 1, max: 50, majburiy: true }),
  };
  return { d, t };
}

const binoForma = (res, o, status = 200) =>
  res.status(status).render('joylar/bino-form', { title: o.bino.id ? 'Binoni tahrirlash' : 'Yangi bino', ...o });

admin.get(
  '/binolar',
  h(async (req, res) => {
    const binolar = await many(
      `SELECT b.id, b.nomi, b.manzil, b.qavatlar_soni,
              (SELECT count(*) FROM xonalar x WHERE x.bino_id = b.id AND x.faol)::int AS xonalar,
              (SELECT count(*) FROM jihozlar j JOIN xonalar x ON x.id = j.xona_id WHERE x.bino_id = b.id AND j.faol)::int AS jihozlar,
              (SELECT count(*) FROM arizalar a JOIN xonalar x ON x.id = a.xona_id
                WHERE x.bino_id = b.id AND a.holat = ANY($1::text[]))::int AS ochiq
         FROM binolar b ORDER BY b.nomi`,
      [OCHIQ]
    );
    res.render('joylar/binolar', { title: 'Binolar va xonalar', binolar });
  })
);

admin.get('/binolar/yangi', (req, res) => binoForma(res, { bino: { qavatlar_soni: 1 } }));

admin.post(
  '/binolar',
  h(async (req, res) => {
    const { d, t } = binoTekshir(req.body);
    if (!t.ok) return binoForma(res, { bino: d, xatolar: t.xatolar }, 400);
    try {
      const b = await one('INSERT INTO binolar (nomi, manzil, qavatlar_soni) VALUES ($1, $2, $3) RETURNING id', [
        d.nomi,
        d.manzil,
        d.qavatlar_soni,
      ]);
      flash(req, 'ok', `"${d.nomi}" qo'shildi. Endi xonalarni kiriting.`);
      res.redirect(`/admin/binolar/${b.id}`);
    } catch (err) {
      if (!unikal(err)) throw err;
      binoForma(res, { bino: d, xatolar: ['Bu nomdagi bino allaqachon bor'] }, 400);
    }
  })
);

async function binoOl(id) {
  const b = await one('SELECT * FROM binolar WHERE id = $1', [id]);
  if (!b) throw new HttpError(404, 'Bino topilmadi');
  return b;
}

admin.get(
  `/binolar${ID}`,
  h(async (req, res) => {
    const bino = await binoOl(toId(req.params.id));
    const rows = await many(
      `SELECT x.id, x.qavat, x.raqam, x.turi, x.faol,
              (SELECT count(*) FROM jihozlar j WHERE j.xona_id = x.id AND j.faol)::int AS jihozlar,
              (SELECT count(*) FROM arizalar a WHERE a.xona_id = x.id AND a.holat = ANY($2::text[]))::int AS ochiq
         FROM xonalar x WHERE x.bino_id = $1
        ORDER BY x.qavat, length(x.raqam), x.raqam`,
      [bino.id, OCHIQ]
    );
    const qavatlar = [];
    for (const x of rows) {
      let q = qavatlar.at(-1);
      if (!q || q.qavat !== x.qavat) qavatlar.push((q = { qavat: x.qavat, xonalar: [] }));
      q.xonalar.push(x);
    }
    res.render('joylar/bino', { title: bino.nomi, bino, qavatlar, xonaSoni: rows.length });
  })
);

admin.get(
  `/binolar${ID}/tahrir`,
  h(async (req, res) => binoForma(res, { bino: await binoOl(toId(req.params.id)) }))
);

admin.post(
  `/binolar${ID}`,
  h(async (req, res) => {
    const bino = await binoOl(toId(req.params.id));
    const { d, t } = binoTekshir(req.body);
    if (d.qavatlar_soni) {
      const m = await one('SELECT max(qavat) AS q FROM xonalar WHERE bino_id = $1', [bino.id]);
      if (m.q && d.qavatlar_soni < m.q) t.xato(`Binoda ${m.q}-qavatda xona bor — qavatlar soni undan kam bo'lmasin`);
    }
    if (!t.ok) return binoForma(res, { bino: { ...d, id: bino.id }, xatolar: t.xatolar }, 400);
    try {
      await query('UPDATE binolar SET nomi = $2, manzil = $3, qavatlar_soni = $4 WHERE id = $1', [
        bino.id,
        d.nomi,
        d.manzil,
        d.qavatlar_soni,
      ]);
    } catch (err) {
      if (!unikal(err)) throw err;
      return binoForma(res, { bino: { ...d, id: bino.id }, xatolar: ['Bu nomdagi bino allaqachon bor'] }, 400);
    }
    flash(req, 'ok', 'Saqlandi');
    res.redirect(`/admin/binolar/${bino.id}`);
  })
);

admin.post(
  `/binolar${ID}/ochirish`,
  h(async (req, res) => {
    const bino = await binoOl(toId(req.params.id));
    if (await one('SELECT 1 FROM xonalar WHERE bino_id = $1 LIMIT 1', [bino.id])) {
      flash(req, 'xato', "Binoda xonalar bor — avval ularni o'chirib bo'lmaydi, faqat nofaol qilish mumkin");
      return res.redirect(`/admin/binolar/${bino.id}`);
    }
    await query('DELETE FROM binolar WHERE id = $1', [bino.id]);
    flash(req, 'ok', `"${bino.nomi}" o'chirildi`);
    res.redirect('/admin/binolar');
  })
);

// Binodagi barcha xonalar uchun QR-kodlar — chop etish sahifasi
admin.get(
  `/binolar${ID}/qr`,
  h(async (req, res) => {
    const bino = await binoOl(toId(req.params.id));
    const rows = await many(
      'SELECT id, qavat, raqam, qr_token FROM xonalar WHERE bino_id = $1 AND faol ORDER BY qavat, length(raqam), raqam',
      [bino.id]
    );
    const kartalar = await Promise.all(rows.map(async (x) => ({ ...x, svg: await qrSvg(x.qr_token), manzil: qrUrl(x.qr_token) })));
    res.render('joylar/qr', { title: `QR-kodlar — ${bino.nomi}`, layout: 'print', bino, kartalar });
  })
);

// --- Xonalar --------------------------------------------------------------------------------------

async function xonaTekshir(body) {
  const t = new Tekshiruv();
  const d = {
    bino_id: t.id(body.bino_id, 'Bino', { majburiy: true }),
    qavat: t.son(body.qavat, 'Qavat', { min: -5, max: 50, majburiy: true }),
    raqam: t.matn(body.raqam, 'Xona raqami', { max: 20, majburiy: true }),
    turi: t.tanlov(body.turi, 'Xona turi', Object.keys(XONA_TURLARI)),
    faol: body.faol === undefined ? true : body.faol === 'on',
  };
  if (d.raqam && !/^[\p{L}\d][\p{L}\d .\-/]*$/u.test(d.raqam)) t.xato("Xona raqamida faqat harf, raqam, nuqta, chiziqcha bo'lsin");
  if (d.bino_id) {
    const b = await one('SELECT qavatlar_soni FROM binolar WHERE id = $1', [d.bino_id]);
    if (!b) t.xato('Bino topilmadi');
    else if (d.qavat !== null && d.qavat > b.qavatlar_soni) t.xato(`Binoda ${b.qavatlar_soni} ta qavat bor`);
  }
  return { d, t };
}

const xonaForma = async (res, o, status = 200) =>
  res.status(status).render('joylar/xona-form', {
    title: o.xona.id ? 'Xonani tahrirlash' : 'Yangi xona',
    binolar: await Q.binolar(),
    xonaTurlari,
    ...o,
  });

admin.get(
  '/xonalar/yangi',
  h(async (req, res) => xonaForma(res, { xona: { bino_id: toId(req.query.bino), turi: 'auditoriya', faol: true } }))
);

admin.post(
  '/xonalar',
  h(async (req, res) => {
    const { d, t } = await xonaTekshir({ ...req.body, faol: undefined });
    if (!t.ok) return xonaForma(res, { xona: d, xatolar: t.xatolar }, 400);
    try {
      const x = await one(
        'INSERT INTO xonalar (bino_id, qavat, raqam, turi, qr_token) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [d.bino_id, d.qavat, d.raqam, d.turi, yangiToken()]
      );
      flash(req, 'ok', `${d.raqam}-xona qo'shildi`);
      res.redirect(req.body.yana === '1' ? `/admin/xonalar/yangi?bino=${d.bino_id}` : `/xonalar/${x.id}`);
    } catch (err) {
      if (!unikal(err)) throw err;
      xonaForma(res, { xona: d, xatolar: ['Bu binoda shu raqamli xona bor'] }, 400);
    }
  })
);

async function xonaOl(id) {
  const x = await Q.xonaOl(id);
  if (!x) throw new HttpError(404, 'Xona topilmadi');
  return x;
}

admin.get(
  `/xonalar${ID}/tahrir`,
  h(async (req, res) => xonaForma(res, { xona: await xonaOl(toId(req.params.id)) }))
);

admin.post(
  `/xonalar${ID}`,
  h(async (req, res) => {
    const xona = await xonaOl(toId(req.params.id));
    const { d, t } = await xonaTekshir({ ...req.body, faol: req.body.faol || 'off' });
    if (!t.ok) return xonaForma(res, { xona: { ...d, id: xona.id }, xatolar: t.xatolar }, 400);
    try {
      await query('UPDATE xonalar SET bino_id = $2, qavat = $3, raqam = $4, turi = $5, faol = $6 WHERE id = $1', [
        xona.id,
        d.bino_id,
        d.qavat,
        d.raqam,
        d.turi,
        d.faol,
      ]);
    } catch (err) {
      if (!unikal(err)) throw err;
      return xonaForma(res, { xona: { ...d, id: xona.id }, xatolar: ['Bu binoda shu raqamli xona bor'] }, 400);
    }
    flash(req, 'ok', 'Saqlandi');
    res.redirect(`/xonalar/${xona.id}`);
  })
);

// Eski QR-kod ishlamay qoladi (masalan, yopishtirilgan qog'oz yo'qolsa)
admin.post(
  `/xonalar${ID}/qr-yangilash`,
  h(async (req, res) => {
    const xona = await xonaOl(toId(req.params.id));
    await query('UPDATE xonalar SET qr_token = $2 WHERE id = $1', [xona.id, yangiToken()]);
    flash(req, 'ok', 'Yangi QR-kod yaratildi. Eskisi endi ishlamaydi — yangisini chop etib yopishtiring.');
    res.redirect(`/xonalar/${xona.id}`);
  })
);

// --- Jihoz turlari --------------------------------------------------------------------------------

function turTekshir(body) {
  const t = new Tekshiruv();
  const d = {
    nomi: t.matn(body.nomi, 'Nomi', { max: 60, majburiy: true }),
    mutaxassislik: t.tanlov(body.mutaxassislik, 'Mutaxassislik', Object.keys(MUTAXASSISLIKLAR)),
    tartib: t.son(body.tartib, 'Tartib', { min: 0, max: 9999 }) ?? 100,
  };
  return { d, t };
}

admin.get(
  '/turlar',
  h(async (req, res) => {
    const turlar = await many(
      `SELECT t.*, (SELECT count(*) FROM jihozlar j WHERE j.tur_id = t.id AND j.faol)::int AS jihozlar,
              (SELECT count(*) FROM arizalar a WHERE a.tur_id = t.id)::int AS arizalar
         FROM jihoz_turlari t ORDER BY t.tartib, t.nomi`
    );
    res.render('joylar/turlar', { title: 'Jihoz turlari', turlar, mutaxassisliklar });
  })
);

async function turSaqla(req, res, id) {
  const { d, t } = turTekshir(req.body);
  if (t.ok) {
    try {
      if (id) await query('UPDATE jihoz_turlari SET nomi = $2, mutaxassislik = $3, tartib = $4 WHERE id = $1', [id, d.nomi, d.mutaxassislik, d.tartib]);
      else await query('INSERT INTO jihoz_turlari (nomi, mutaxassislik, tartib) VALUES ($1, $2, $3)', [d.nomi, d.mutaxassislik, d.tartib]);
      flash(req, 'ok', 'Saqlandi');
    } catch (err) {
      if (!unikal(err)) throw err;
      flash(req, 'xato', 'Bu nomdagi tur allaqachon bor');
    }
  } else flash(req, 'xato', t.xatolar.join('. '));
  res.redirect('/admin/turlar');
}

admin.post('/turlar', h((req, res) => turSaqla(req, res, null)));
admin.post(`/turlar${ID}`, h((req, res) => turSaqla(req, res, toId(req.params.id))));

// --- Jihozlar -------------------------------------------------------------------------------------

const JIHOZ_HOLATLARI = { faol: 'Faol', nosoz: "Hozir ta'mirda", muammoli: 'Muammoli (90 kunda 3+)', hisobdan: 'Hisobdan chiqarilgan', hammasi: 'Hammasi' };

admin.get(
  '/jihozlar',
  h(async (req, res) => {
    const s = (v) => (typeof v === 'string' ? v.trim() : '');
    const f = {
      bino: /^\d+$/.test(s(req.query.bino)) ? s(req.query.bino) : '',
      tur: /^\d+$/.test(s(req.query.tur)) ? s(req.query.tur) : '',
      holat: Object.keys(JIHOZ_HOLATLARI).includes(s(req.query.holat)) ? s(req.query.holat) : 'faol',
      q: s(req.query.q).slice(0, 60),
    };
    const sahifa = Math.min(Math.max(Number.parseInt(req.query.sahifa, 10) || 1, 1), 10000);
    const hajm = 50;
    const params = [OCHIQ];
    const w = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    // Shartlar ichki so'rov ustunlariga yoziladi (j — hosila jadval)
    if (f.bino) w.push(`j.bino_id = ${p(Number(f.bino))}`);
    if (f.tur) w.push(`j.tur_id = ${p(Number(f.tur))}`);
    if (f.holat === 'faol') w.push('j.faol');
    if (f.holat === 'hisobdan') w.push('NOT j.faol');
    if (f.holat === 'nosoz') w.push('j.faol AND j.ochiq > 0');
    if (f.holat === 'muammoli') w.push('j.faol AND j.soni90 >= 3');
    if (f.q) {
      const like = p(`%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      w.push(`(j.belgi ILIKE ${like} OR j.inventar_raqami ILIKE ${like} OR j.xona ILIKE ${like})`);
    }
    const rows = await many(
      `SELECT *, count(*) OVER () AS jami FROM (
         SELECT j.id, j.belgi, j.inventar_raqami, j.faol, j.tur_id, x.id AS xona_id, x.raqam AS xona, x.bino_id, b.nomi AS bino, t.nomi AS tur,
                (SELECT count(*) FROM arizalar a WHERE a.jihoz_id = j.id AND a.holat = ANY($1::text[]))::int AS ochiq,
                (SELECT count(*) FROM arizalar a WHERE a.jihoz_id = j.id AND a.holat <> 'rad_etilgan'
                   AND a.yaratilgan > now() - interval '90 days')::int AS soni90,
                t.tartib
           FROM jihozlar j JOIN xonalar x ON x.id = j.xona_id JOIN binolar b ON b.id = x.bino_id
           JOIN jihoz_turlari t ON t.id = j.tur_id
       ) j ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
       ORDER BY j.bino, length(j.xona), j.xona, j.tartib, length(j.belgi), j.belgi
       LIMIT ${p(hajm)} OFFSET ${p((sahifa - 1) * hajm)}`,
      params
    );
    const jami = rows.length ? rows[0].jami : 0;
    const [binolar, turlar] = await Promise.all([Q.binolar(), Q.turlar()]);
    res.render('joylar/jihozlar', {
      title: 'Jihozlar',
      rows,
      jami,
      sahifa,
      sahifalar: Math.max(1, Math.ceil(jami / hajm)),
      filtr: f,
      binolar,
      turlar,
      holatlar: Object.entries(JIHOZ_HOLATLARI).map(([kalit, nomi]) => ({ kalit, nomi })),
    });
  })
);

async function jihozTekshir(body) {
  const t = new Tekshiruv();
  const d = {
    xona_id: t.id(body.xona_id, 'Xona', { majburiy: true }),
    tur_id: t.id(body.tur_id, 'Jihoz turi', { majburiy: true }),
    belgi: t.matn(body.belgi, 'Belgisi', { max: 40, majburiy: true }),
    inventar_raqami: t.matn(body.inventar_raqami, 'Inventar raqami', { max: 40 }),
    faol: body.faol === undefined ? true : body.faol === 'on',
  };
  if (d.xona_id && !(await one('SELECT 1 FROM xonalar WHERE id = $1', [d.xona_id]))) t.xato('Xona topilmadi');
  if (d.tur_id && !(await one('SELECT 1 FROM jihoz_turlari WHERE id = $1', [d.tur_id]))) t.xato('Jihoz turi topilmadi');
  return { d, t };
}

const jihozForma = async (res, o, status = 200) =>
  res.status(status).render('joylar/jihoz-form', {
    title: o.jihoz.id ? 'Jihozni tahrirlash' : 'Yangi jihoz',
    xonaGuruhlari: await xonaGuruhlari(),
    turlar: await Q.turlar(),
    ...o,
  });

admin.get(
  '/jihozlar/yangi',
  h(async (req, res) => jihozForma(res, { jihoz: { xona_id: toId(req.query.xona), faol: true } }))
);

admin.post(
  '/jihozlar',
  h(async (req, res) => {
    const { d, t } = await jihozTekshir({ ...req.body, faol: undefined });
    if (!t.ok) return jihozForma(res, { jihoz: d, xatolar: t.xatolar }, 400);
    try {
      await query('INSERT INTO jihozlar (xona_id, tur_id, belgi, inventar_raqami) VALUES ($1, $2, $3, $4)', [
        d.xona_id,
        d.tur_id,
        d.belgi,
        d.inventar_raqami,
      ]);
    } catch (err) {
      if (!unikal(err)) throw err;
      return jihozForma(res, { jihoz: d, xatolar: ['Bu inventar raqami boshqa jihozda bor'] }, 400);
    }
    flash(req, 'ok', `Jihoz qo'shildi: ${d.belgi}`);
    res.redirect(req.body.yana === '1' ? `/admin/jihozlar/yangi?xona=${d.xona_id}` : `/xonalar/${d.xona_id}`);
  })
);

async function jihozOl(id) {
  const j = await one(
    `SELECT j.*, t.nomi AS tur, x.raqam AS xona, x.qavat, x.bino_id, b.nomi AS bino
       FROM jihozlar j JOIN jihoz_turlari t ON t.id = j.tur_id
       JOIN xonalar x ON x.id = j.xona_id JOIN binolar b ON b.id = x.bino_id
      WHERE j.id = $1`,
    [id]
  );
  if (!j) throw new HttpError(404, 'Jihoz topilmadi');
  return j;
}

admin.get(
  `/jihozlar${ID}/tahrir`,
  h(async (req, res) => jihozForma(res, { jihoz: await jihozOl(toId(req.params.id)) }))
);

admin.post(
  `/jihozlar${ID}`,
  h(async (req, res) => {
    const j = await jihozOl(toId(req.params.id));
    const { d, t } = await jihozTekshir({ ...req.body, faol: req.body.faol || 'off' });
    if (!t.ok) return jihozForma(res, { jihoz: { ...d, id: j.id }, xatolar: t.xatolar }, 400);
    try {
      await query(
        'UPDATE jihozlar SET xona_id = $2, tur_id = $3, belgi = $4, inventar_raqami = $5, faol = $6 WHERE id = $1',
        [j.id, d.xona_id, d.tur_id, d.belgi, d.inventar_raqami, d.faol]
      );
    } catch (err) {
      if (!unikal(err)) throw err;
      return jihozForma(res, { jihoz: { ...d, id: j.id }, xatolar: ['Bu inventar raqami boshqa jihozda bor'] }, 400);
    }
    flash(req, 'ok', 'Saqlandi');
    res.redirect(`/jihozlar/${j.id}`);
  })
);

// Excel dan ommaviy kiritish: avval hamma qatorlar tekshiriladi, xato bo'lsa hech narsa saqlanmaydi
admin.get('/jihozlar/import', (req, res) => res.render('joylar/import', { title: 'Jihozlarni Excel dan yuklash' }));

admin.get(
  '/jihozlar/namuna.xlsx',
  h(async (req, res) => {
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.attachment('jihozlar-namuna.xlsx');
    await (await importer.namuna()).xlsx.write(res);
    res.end();
  })
);

admin.post(
  '/jihozlar/import',
  upload.excel,
  h(async (req, res) => {
    const korsat = (o, status = 200) => res.status(status).render('joylar/import', { title: 'Jihozlarni Excel dan yuklash', ...o });
    if (req.yuklashXatosi) return korsat({ xatolar: [req.yuklashXatosi] }, 400);
    const natija = await importer.yukla(req.file.buffer);
    if (natija.xatolar.length) return korsat({ qatorXatolari: natija.xatolar.slice(0, 50), xatoSoni: natija.xatolar.length }, 400);
    flash(req, 'ok', `${natija.jihozlar} ta jihoz qo'shildi${natija.xonalar ? `, ${natija.xonalar} ta yangi xona yaratildi` : ''}`);
    res.redirect('/admin/jihozlar');
  })
);

// --- Ko'rish sahifalari ---------------------------------------------------------------------------

xonalar.get(
  ID,
  h(async (req, res) => {
    const xona = await xonaOl(toId(req.params.id));
    const [jihozRows, arizalar, svg] = await Promise.all([
      many(
        `SELECT j.id, j.belgi, j.inventar_raqami, j.faol, t.nomi AS tur,
                (SELECT count(*) FROM arizalar a WHERE a.jihoz_id = j.id AND a.holat = ANY($2::text[]))::int AS ochiq,
                (SELECT count(*) FROM arizalar a WHERE a.jihoz_id = j.id AND a.holat <> 'rad_etilgan'
                   AND a.yaratilgan > now() - interval '90 days')::int AS soni90
           FROM jihozlar j JOIN jihoz_turlari t ON t.id = j.tur_id
          WHERE j.xona_id = $1 ORDER BY j.faol DESC, t.tartib, t.nomi, length(j.belgi), j.belgi`,
        [xona.id, OCHIQ]
      ),
      Q.xonaArizalari(xona.id),
      qrSvg(xona.qr_token),
    ]);
    res.render('joylar/xona', {
      title: `${xona.bino} · ${xona.raqam}-xona`,
      xona,
      jihozlar: jihozRows,
      arizalar,
      svg,
      qrManzil: qrUrl(xona.qr_token),
    });
  })
);

xonalar.get(
  `${ID}/qr.svg`,
  h(async (req, res) => {
    const xona = await xonaOl(toId(req.params.id));
    res.type('image/svg+xml');
    res.attachment(`qr-${xona.bino}-${xona.raqam}.svg`.replace(/[^\w.-]+/g, '-'));
    res.send(await qrSvg(xona.qr_token));
  })
);

jihozlar.get(
  ID,
  h(async (req, res) => {
    const j = await jihozOl(toId(req.params.id));
    const arizalar = await Q.jihozArizalari(j.id);
    const soni90 = arizalar.filter(
      (a) => a.holat !== 'rad_etilgan' && new Date(a.yaratilgan) > new Date(Date.now() - 90 * 864e5)
    ).length;
    res.render('joylar/jihoz', { title: `${j.tur} ${j.belgi}`, j, arizalar, soni90, muammoli: soni90 >= 3 });
  })
);

module.exports = { admin, xonalar, jihozlar };
