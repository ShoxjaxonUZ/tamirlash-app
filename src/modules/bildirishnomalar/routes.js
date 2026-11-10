// /bildirishnomalar — ro'yxat; bosilganda o'qilgan deb belgilanadi va arizaga o'tiladi.
const router = require('express').Router();
const { h, toId } = require('../../lib/http');
const B = require('./service');

router.get(
  '/',
  h(async (req, res) => {
    res.render('bildirishnomalar/index', { title: 'Bildirishnomalar', royxat: await B.royxat(req.user.id) });
  })
);

router.get(
  '/:id(\\d+)',
  h(async (req, res) => {
    const r = await B.oqildi(req.user.id, toId(req.params.id));
    res.redirect(r && r.ariza_id ? `/arizalar/${r.ariza_id}` : '/bildirishnomalar');
  })
);

router.post(
  '/oqildi',
  h(async (req, res) => {
    await B.hammasiOqildi(req.user.id);
    res.redirect('/bildirishnomalar');
  })
);

module.exports = router;
