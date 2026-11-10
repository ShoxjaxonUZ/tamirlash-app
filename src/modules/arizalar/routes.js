// /arizalar — ariza berish, ariza sahifasi va undagi barcha amallar; /rasmlar — rasmlar (ruxsat bilan); /q — QR-kod.
const path = require('path');
const express = require('express');
const config = require('../../config');
const { one } = require('../../db/pool');
const time = require('../../lib/time');
const { h, toId, flash, HttpError } = require('../../lib/http');
const { Tekshiruv } = require('../../lib/validate');
const { MUHIMLIK, ISHDA } = require('../../lib/holat');
const upload = require('../../middleware/upload');
const S = require('./service');
const Q = require('./queries');

const router = express.Router();

const MUDDAT_MATNI = { shoshilinch: '4 soat ichida', yuqori: '1 ish kuni', orta: '3 ish kuni', past: '7 ish kuni' };
const muhimliklar = Object.entries(MUHIMLIK).map(([kalit, m]) => ({ kalit, ...m, muddat: MUDDAT_MATNI[kalit] }));

// Jihozlarni turi bo'yicha guruhlaydi (<optgroup> uchun)
function guruhla(jihozlar) {
  const g = new Map();
  for (const j of jihozlar) {
    if (!g.has(j.tur)) g.set(j.tur, []);
    g.get(j.tur).push(j);
  }
  return [...g].map(([tur, items]) => ({ tur, items }));
}

// 1-bosqich: xona tanlash. 2-bosqich: xona tanlangan — jihoz, tavsif, rasmlar (JS siz ham ishlaydi)
async function forma(req, res, { xonaId = null, qiymat = {}, xatolar = [], status = 200 }) {
  const xona = xonaId ? await Q.xonaOl(xonaId) : null;
  if (!xona || !xona.faol) {
    const [binolar, xonalar] = await Promise.all([Q.binolar(), Q.faolXonalar()]);
    if (xonaId) xatolar = [...xatolar, 'Xona topilmadi'];
    return res.status(status).render('arizalar/yangi', { title: 'Yangi ariza', bosqich1: true, binolar, xonalar, xatolar });
  }
  const [jihozlar, turlar, ochiq] = await Promise.all([
    Q.xonaJihozlari(xona.id),
    Q.turlar(),
    Q.xonaOchiqArizalari(xona.id, req.user.id),
  ]);
  res.status(status).render('arizalar/yangi', {
    title: 'Yangi ariza',
    xona,
    jihozGuruhlari: guruhla(jihozlar),
    jihozBor: jihozlar.length > 0,
    turlar,
    ochiq,
    muhimliklar,
    qiymat: { muhimlik: 'orta', ...qiymat },
    xatolar,
    maxRasm: upload.MAX_RASM,
  });
}

router.get(
  '/',
  h(async (req, res) => {
    const tab = req.query.tab === 'yopiq' ? 'yopiq' : 'ochiq';
    const arizalar = await Q.menikilar(req.user.id, tab);
    res.render('arizalar/mening', { title: 'Mening arizalarim', arizalar, tab });
  })
);

router.get(
  '/yangi',
  h(async (req, res) => {
    const xonaId = toId(req.query.xona);
    await forma(req, res, { xonaId, qiymat: { jihoz_id: toId(req.query.jihoz) } });
  })
);

router.post(
  '/',
  upload.rasmlar,
  h(async (req, res) => {
    try {
      const { d, xatolar } = await S.yangiTekshir(req.body);
      if (req.yuklashXatosi) xatolar.push(req.yuklashXatosi);
      if (xatolar.length) {
        upload.ochir(req.files);
        return forma(req, res, { xonaId: d.xona_id, qiymat: d, xatolar, status: 400 });
      }
      const a = await S.yaratish(req.user, d, req.files);
      flash(req, 'ok', `Ariza ${a.raqam} qabul qilindi. Holatini shu sahifada kuzatishingiz mumkin.`);
      res.redirect(`/arizalar/${a.id}`);
    } catch (err) {
      upload.ochir(req.files);
      throw err;
    }
  })
);

router.get(
  '/:id(\\d+)',
  h(async (req, res) => {
    const a = await S.olish(toId(req.params.id));
    if (!a) throw new HttpError(404, 'Ariza topilmadi');
    const kuzatuvchi = await S.kuzatuvchimi(a.id, req.user.id);
    const r = S.ruxsatlar(req.user, a, kuzatuvchi);
    if (!r.korish) throw new HttpError(403, "Bu arizani ko'rishga ruxsatingiz yo'q");

    const [rasmlar, tarix] = await Promise.all([S.rasmlari(a.id), S.tarixi(a.id)]);
    const ishda = ISHDA.includes(a.holat);
    const ustaHuquqi = r.usta || r.boshqaruv;
    const ustaHolatlari = ['biriktirilgan', 'jarayonda', 'kutilmoqda'].includes(a.holat);
    const amallar = {
      bekor: r.egasi && a.holat === 'yangi',
      tasdiqlash: (r.egasi || r.boshqaruv) && a.holat === 'tekshiruvda',
      baho: r.egasi && a.holat === 'yopilgan' && !a.baho,
      boshlash: ustaHuquqi && a.holat === 'biriktirilgan',
      qism: ustaHuquqi && a.holat === 'jarayonda',
      davom: ustaHuquqi && a.holat === 'kutilmoqda',
      bajarildi: ustaHuquqi && ['jarayonda', 'kutilmoqda'].includes(a.holat),
      almashtirish: ustaHuquqi && ustaHolatlari && !a.almashtirish_kerak,
      biriktirish: r.boshqaruv && ishda,
      rad: r.boshqaruv && ishda,
      // Tekshiruvdagi arizani boshliq "Ha, ishlayapti" bilan yopadi; bu tugma — almashtirish holati uchun
      yopish: r.boshqaruv && a.almashtirish_kerak && ustaHolatlari,
    };
    amallar.usta = amallar.boshlash || amallar.qism || amallar.davom || amallar.bajarildi || amallar.almashtirish;
    amallar.egasi = amallar.bekor || amallar.tasdiqlash || amallar.baho;

    let ustalar = [];
    let boshqalar = [];
    if (amallar.biriktirish) [ustalar, boshqalar] = await Promise.all([S.ustalar(a.mutaxassislik), S.xonadagiBoshqalar(a)]);

    res.render('arizalar/show', {
      title: a.raqam,
      a,
      r,
      amallar,
      rasmlarAriza: rasmlar.filter((x) => x.bosqich === 'ariza'),
      rasmlarBajarildi: rasmlar.filter((x) => x.bosqich === 'bajarildi'),
      tarix,
      mosUstalar: ustalar.filter((u) => u.mos),
      boshqaUstalar: ustalar.filter((u) => !u.mos),
      boshqalar,
      muhimliklar,
      minMuddat: time.toInput(time.now()),
      maxRasm: upload.MAX_RASM,
    });
  })
);

// Amal natijasi: 400/409 xatolar ariza sahifasida xabar bo'lib ko'rinadi, 403/404 — xato sahifasi
const amal = (fn, okMatn) =>
  h(async (req, res) => {
    const id = toId(req.params.id);
    try {
      const natija = await fn(req, id);
      const matn = typeof okMatn === 'function' ? okMatn(natija) : okMatn;
      if (matn) flash(req, 'ok', matn);
    } catch (err) {
      if (!(err instanceof HttpError) || ![400, 409].includes(err.status)) throw err;
      flash(req, 'xato', err.message);
    }
    res.redirect(`/arizalar/${id}`);
  });

// Izoh maydoni: bo'sh bo'lsa service o'zi xato beradi
function izoh(v, nomi, max = 500) {
  const t = new Tekshiruv();
  const s = t.matn(v, nomi, { max, qatorlar: true });
  if (!t.ok) throw new HttpError(400, t.xatolar[0]);
  return s;
}

const ID = '/:id(\\d+)';

// Egasi
router.post(`${ID}/menda-ham`, amal((req, id) => S.mendaHam(req.user, id), (r) => (r.qoshildi ? 'Siz ham shu muammo haqida xabar berdingiz. Holat o\'zgarsa, sizga ham xabar keladi.' : null)));
router.post(`${ID}/bekor`, amal((req, id) => S.bekorQilish(req.user, id), 'Ariza bekor qilindi'));
router.post(`${ID}/tasdiqlash`, amal((req, id) => S.tasdiqlash(req.user, id), 'Rahmat! Ariza yopildi.'));
router.post(
  `${ID}/qayta-ochish`,
  amal((req, id) => S.qaytaOchish(req.user, id, izoh(req.body.izoh, 'Izoh')), 'Ariza qayta ochildi va ustaga qaytarildi')
);
router.post(
  `${ID}/baho`,
  amal((req, id) => {
    const t = new Tekshiruv();
    const baho = t.son(req.body.baho, 'Baho', { min: 1, max: 5, majburiy: true });
    const matn = t.matn(req.body.izoh, 'Izoh', { max: 500, qatorlar: true });
    if (!t.ok) throw new HttpError(400, t.xatolar[0]);
    return S.bahoQoy(req.user, id, baho, matn);
  }, 'Bahoyingiz uchun rahmat!')
);

// Usta
router.post(`${ID}/boshlash`, amal((req, id) => S.boshlash(req.user, id), 'Ish boshlandi'));
router.post(`${ID}/qism-kutish`, amal((req, id) => S.qismKutish(req.user, id, izoh(req.body.izoh, 'Izoh')), 'Holat: ehtiyot qism kutilmoqda'));
router.post(`${ID}/davom`, amal((req, id) => S.davom(req.user, id), 'Ish davom ettirildi'));
router.post(
  `${ID}/almashtirish`,
  amal((req, id) => S.almashtirish(req.user, id, izoh(req.body.izoh, 'Sabab')), "Boshliqqa xabar berildi: jihozni almashtirish kerak")
);
router.post(
  `${ID}/bajarildi`,
  upload.rasmlar,
  h(async (req, res) => {
    const id = toId(req.params.id);
    try {
      if (req.yuklashXatosi) throw new HttpError(400, req.yuklashXatosi);
      await S.bajarildi(req.user, id, izoh(req.body.izoh, 'Izoh', 1000), req.files);
      flash(req, 'ok', 'Bajarildi. Ariza egasiga tasdiqlash uchun xabar yuborildi.');
    } catch (err) {
      upload.ochir(req.files);
      if (!(err instanceof HttpError) || ![400, 409].includes(err.status)) throw err;
      flash(req, 'xato', err.message);
    }
    res.redirect(`/arizalar/${id}`);
  })
);

// Boshqaruv
router.post(
  `${ID}/biriktirish`,
  amal(
    (req, id) => {
      const t = new Tekshiruv();
      const ustaId = t.id(req.body.usta_id, 'Usta', { majburiy: true });
      const muhimlik = t.tanlov(req.body.muhimlik, 'Muhimlik', Object.keys(MUHIMLIK), { majburiy: false });
      let muddat = null;
      if (req.body.muddat) {
        muddat = time.parseInput(req.body.muddat);
        if (!muddat) t.xato("Muddat noto'g'ri");
        else if (muddat <= time.now()) t.xato("Muddat kelajakdagi vaqt bo'lsin");
      }
      if (!t.ok) throw new HttpError(400, t.xatolar[0]);
      return S.biriktirish(req.user, id, { ustaId, muddat, muhimlik });
    },
    (r) => (r.ozgarmadi ? "O'zgarish yo'q" : 'Saqlandi. Ustaga xabar yuborildi.')
  )
);
router.post(`${ID}/rad-etish`, amal((req, id) => S.radEtish(req.user, id, izoh(req.body.izoh, 'Sabab')), 'Ariza rad etildi'));
router.post(
  `${ID}/birlashtirish`,
  h(async (req, res) => {
    const id = toId(req.params.id);
    const asosiyId = toId(req.body.asosiy_id);
    try {
      if (!asosiyId) throw new HttpError(400, 'Asosiy arizani tanlang');
      const { asosiy } = await S.birlashtirish(req.user, id, asosiyId);
      flash(req, 'ok', `Dublikat ${asosiy.raqam} ga qo'shildi`);
      return res.redirect(`/arizalar/${asosiy.id}`);
    } catch (err) {
      if (!(err instanceof HttpError) || ![400, 409].includes(err.status)) throw err;
      flash(req, 'xato', err.message);
    }
    res.redirect(`/arizalar/${id}`);
  })
);
router.post(
  `${ID}/yopish`,
  amal(
    (req, id) => S.yopish(req.user, id, { izoh: izoh(req.body.izoh, 'Izoh'), hisobdan: req.body.hisobdan === 'on' }),
    'Ariza yopildi'
  )
);

// --- /rasmlar/:id — faqat arizani ko'ra oladiganlarga -------------------------------------------
const rasmlar = express.Router();
rasmlar.get(
  '/:id(\\d+)',
  h(async (req, res, next) => {
    const r = await one(
      `SELECT r.fayl, r.mime, a.id, a.user_id, a.usta_id
         FROM ariza_rasmlar r JOIN arizalar a ON a.id = r.ariza_id WHERE r.id = $1`,
      [toId(req.params.id)]
    );
    if (!r || !/^[a-f0-9]{32}\.(jpg|png)$/.test(r.fayl)) throw new HttpError(404, 'Rasm topilmadi');
    const kuzatuvchi = await S.kuzatuvchimi(r.id, req.user.id);
    if (!S.ruxsatlar(req.user, r, kuzatuvchi).korish) throw new HttpError(403, "Bu rasmni ko'rishga ruxsatingiz yo'q");
    res.set('Cache-Control', 'private, max-age=86400');
    res.type(r.mime);
    res.sendFile(path.join(config.uploadDir, r.fayl), (err) => {
      if (err && !res.headersSent) next(new HttpError(404, 'Rasm topilmadi'));
    });
  })
);

// --- /q/:token — xona eshigidagi QR-kod: forma xona tanlangan holda ochiladi (TZ, FR-2) ----------
const qr = express.Router();
qr.get(
  '/:token',
  h(async (req, res) => {
    const token = String(req.params.token);
    const x = /^[A-Za-z0-9_-]{8,32}$/.test(token) ? await one('SELECT id FROM xonalar WHERE qr_token = $1 AND faol', [token]) : null;
    if (!x) throw new HttpError(404, "QR-kod eskirgan yoki xona topilmadi. Arizani bosh sahifadan bering.");
    res.redirect(`/arizalar/yangi?xona=${x.id}`);
  })
);

module.exports = { router, rasmlar, qr, muhimliklar };
