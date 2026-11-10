// /profil — o'z ma'lumotlari, parolni almashtirish (vaqtinchalik parol bo'lsa majburiy) va Telegram'ni ulash.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const config = require('../../config');
const { one, query } = require('../../db/pool');
const { h, flash } = require('../../lib/http');
const { Tekshiruv } = require('../../lib/validate');
const bot = require('../telegram/bot');

const tgYoqilgan = () => Boolean(config.tg.token && config.tg.username);

const korsat = async (req, res, { xatolar = [], status = 200 } = {}) => {
  const p = await one('SELECT ism, familiya, login, rol, toifa, telefon, yaratilgan, tg_chat_id FROM users WHERE id = $1', [req.user.id]);
  res.status(status).render('profil/index', {
    title: 'Profil',
    p,
    xatolar,
    majburiy: req.user.parol_almashtirish,
    tg: { yoqilgan: tgYoqilgan(), ulangan: Boolean(p.tg_chat_id), bot: config.tg.username, daqiqa: bot.TOKEN_DAQIQA },
  });
};

router.get('/', h((req, res) => korsat(req, res)));

router.post(
  '/parol',
  h(async (req, res) => {
    const t = new Tekshiruv();
    const eski = String(req.body.eski || '');
    const yangi = t.parol(req.body.yangi, { nomi: 'Yangi parol' });
    if (yangi && yangi !== req.body.takror) t.xato('Yangi parol va takrori bir xil emas');
    if (yangi && yangi === eski) t.xato("Yangi parol eskisidan farq qilsin");
    const u = await one('SELECT parol_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(eski, u.parol_hash))) t.xato("Joriy parol noto'g'ri");
    if (!t.ok) return korsat(req, res, { xatolar: t.xatolar, status: 400 });

    await query('UPDATE users SET parol_hash = $2, parol_almashtirish = FALSE WHERE id = $1', [
      req.user.id,
      await bcrypt.hash(yangi, 10),
    ]);
    flash(req, 'ok', 'Parol almashtirildi');
    res.redirect(req.user.parol_almashtirish ? '/' : '/profil');
  })
);

// Bir martalik havola bilan Telegram'ga o'tadi: foydalanuvchi botda "Start" ni bosadi va hisob ulanadi
router.post(
  '/telegram',
  h(async (req, res) => {
    if (!tgYoqilgan()) {
      flash(req, 'xato', 'Telegram bot hali sozlanmagan');
      return res.redirect('/profil');
    }
    res.redirect(await bot.ulashHavolasi(req.user.id));
  })
);

router.post(
  '/telegram/uzish',
  h(async (req, res) => {
    await bot.uzish(req.user.id);
    flash(req, 'ok', "Telegram uzildi — bildirishnomalar faqat saytda ko'rinadi");
    res.redirect('/profil');
  })
);

module.exports = router;
