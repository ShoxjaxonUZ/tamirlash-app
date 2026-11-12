// /admin/zaxira — bazaning zaxira nusxalari (faqat admin): ro'yxat, hozir olish, yuklab olish.
// Tiklash xavfli amal bo'lgani uchun faqat buyruq satridan: npm run tiklash -- <fayl> --tasdiq
const path = require('path');
const router = require('express').Router();
const config = require('../../config');
const zaxira = require('../../db/zaxira');
const { h, flash, HttpError } = require('../../lib/http');

router.get('/', (req, res) => {
  res.render('zaxira/index', {
    title: 'Zaxira nusxalar',
    royxat: zaxira.royxat(),
    avto: config.zaxira.avto,
    saqlash: config.zaxira.saqlash,
    papka: config.zaxira.dir,
  });
});

router.post(
  '/',
  h(async (req, res) => {
    const z = await zaxira.yarat();
    zaxira.tozala();
    flash(req, 'ok', `Zaxira olindi: ${z.nom}`);
    res.redirect('/admin/zaxira');
  })
);

router.get('/:nom', (req, res, next) => {
  if (!zaxira.nomTogrimi(req.params.nom)) return next(new HttpError(404, 'Fayl topilmadi'));
  res.set('Cache-Control', 'no-store');
  res.download(path.join(config.zaxira.dir, req.params.nom), (err) => {
    if (err && !res.headersSent) next(new HttpError(404, 'Fayl topilmadi'));
  });
});

module.exports = router;
