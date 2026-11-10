// Bosh sahifa: rolga qarab — foydalanuvchiga o'z arizalari, ustaga ishlari, boshliqqa umumiy holat.
const router = require('express').Router();
const { h } = require('../../lib/http');
const { boshqaruvchi } = require('../../lib/roles');
const Q = require('../arizalar/queries');

router.get(
  '/',
  h(async (req, res) => {
    const u = req.user;
    if (boshqaruvchi(u)) {
      const [son, yangilar, kechikkanlar] = await Promise.all([Q.umumiySonlar(), Q.yangiArizalar(), Q.kechikkanlar()]);
      return res.render('home/boshqaruv', { title: 'Bosh sahifa', son, yangilar, kechikkanlar });
    }
    if (u.rol === 'usta') {
      const [son, ishlar, menikilar] = await Promise.all([
        Q.ustaSonlari(u.id),
        Q.ustaIshlari(u.id, 'faol'),
        Q.menikilar(u.id, 'ochiq'),
      ]);
      return res.render('home/usta', { title: 'Bosh sahifa', son, ishlar: ishlar.slice(0, 6), menikilar });
    }
    const arizalar = await Q.menikilar(u.id, 'ochiq');
    res.render('home/user', { title: 'Bosh sahifa', arizalar });
  })
);

module.exports = router;
