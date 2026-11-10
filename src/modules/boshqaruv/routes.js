// /boshqaruv — barcha arizalar: filtrlar, kechikkanlar birinchi, sahifalash (TZ, FR-4).
const router = require('express').Router();
const { many } = require('../../db/pool');
const { h } = require('../../lib/http');
const { HOLATLAR, MUHIMLIK } = require('../../lib/holat');
const Q = require('../arizalar/queries');

router.get(
  '/',
  h(async (req, res) => {
    const filtr = Q.filtrOl(req.query);
    const sahifa = Math.min(Math.max(Number.parseInt(req.query.sahifa, 10) || 1, 1), 10000);
    const [natija, binolar, turlar, ustalar] = await Promise.all([
      Q.royxat(filtr, { sahifa }),
      Q.binolar(),
      Q.turlar(),
      many("SELECT id, ism, familiya FROM users WHERE rol = 'usta' AND faol ORDER BY familiya, ism"),
    ]);
    res.render('boshqaruv/index', {
      title: 'Boshqaruv',
      ...natija,
      filtr,
      binolar,
      turlar,
      ustalar,
      holatlar: Object.entries(HOLATLAR).map(([kalit, nomi]) => ({ kalit, nomi })),
      muhimliklar: Object.entries(MUHIMLIK).map(([kalit, m]) => ({ kalit, nomi: m.nomi })),
      filtrBor: Boolean(filtr.bino || filtr.tur || filtr.muhimlik || filtr.usta || filtr.kechikkan || filtr.q || filtr.holat !== 'ochiq'),
    });
  })
);

module.exports = router;
