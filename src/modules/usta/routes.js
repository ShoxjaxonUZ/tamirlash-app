// /mening-ishlarim — ustaga biriktirilgan arizalar, muddat bo'yicha tartiblangan (TZ, FR-5).
const router = require('express').Router();
const { h } = require('../../lib/http');
const Q = require('../arizalar/queries');

const TABLAR = ['faol', 'tekshiruvda', 'bajarilgan'];

router.get(
  '/',
  h(async (req, res) => {
    const tab = TABLAR.includes(req.query.tab) ? req.query.tab : 'faol';
    const [son, ishlar] = await Promise.all([Q.ustaSonlari(req.user.id), Q.ustaIshlari(req.user.id, tab)]);
    res.render('usta/ishlarim', { title: 'Mening ishlarim', son, ishlar, tab });
  })
);

module.exports = router;
