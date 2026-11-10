// Kirish va chiqish. Sessiya kirishda yangilanadi (session fixation'ga qarshi).
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { one } = require('../../db/pool');
const { h, safeNext } = require('../../lib/http');
const { loginKaliti, blokQoldi, xatoUrinish, muvaffaqiyatli } = require('../../middleware/security');

// Mavjud bo'lmagan login uchun ham bcrypt ishlaydi — javob vaqti login borligini oshkor qilmaydi
const SOXTA_HASH = bcrypt.hashSync('soxta-parol-vaqtni-tenglash', 10);

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  res.render('auth/login', { title: 'Kirish', layout: 'auth', next: safeNext(req.query.next) });
});

router.post(
  '/login',
  h(async (req, res, next) => {
    const login = String(req.body.login || '').trim().toLowerCase();
    const parol = String(req.body.parol || '');
    const nextUrl = safeNext(req.body.next);
    const korsat = (status, xato) =>
      res.status(status).render('auth/login', { title: 'Kirish', layout: 'auth', xato, login, next: nextUrl });

    const kalit = loginKaliti(req);
    const qoldi = blokQoldi(kalit);
    if (qoldi) return korsat(429, `Juda ko'p urinish. ${qoldi} daqiqadan keyin qayta urinib ko'ring.`);

    const user = login ? await one('SELECT id, parol_hash, faol FROM users WHERE lower(login) = $1', [login]) : null;
    const togri = await bcrypt.compare(parol, user ? user.parol_hash : SOXTA_HASH);
    if (!user || !togri) {
      xatoUrinish(kalit);
      return korsat(401, "Login yoki parol noto'g'ri");
    }
    if (!user.faol) return korsat(403, 'Hisobingiz bloklangan. Administratorga murojaat qiling.');

    muvaffaqiyatli(kalit);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.save((e) => (e ? next(e) : res.redirect(nextUrl)));
    });
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('tamir.sid');
    res.redirect('/login');
  });
});

module.exports = router;
