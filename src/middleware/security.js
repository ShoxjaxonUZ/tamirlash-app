// Xavfsizlik: CSRF (sessiyaga bog'langan token), flash xabarlar, login urinishlarini cheklash.
const crypto = require('crypto');
const { HttpError } = require('../lib/http');

// Fayl yuklanadigan manzillar: ular CSRF ni multer'dan keyin tekshiradi (middleware/upload.js)
const MULTIPART_YOLLAR = [/^\/arizalar$/, /^\/arizalar\/\d+\/bajarildi$/, /^\/admin\/jihozlar\/import$/];

function token(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  return req.session.csrf;
}

function tengmi(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

const ESKIRGAN = "Sahifa eskirgan. Uni yangilab, qaytadan urinib ko'ring.";

function csrf(req, res, next) {
  res.locals.csrf = token(req);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.is('multipart/form-data')) {
    if (MULTIPART_YOLLAR.some((r) => r.test(req.path))) return next();
    return next(new HttpError(403, ESKIRGAN));
  }
  if (tengmi(req.body?._csrf ?? req.get('x-csrf-token'), req.session.csrf)) return next();
  next(new HttpError(403, ESKIRGAN));
}

const csrfTogrimi = (req) => tengmi(req.body?._csrf, req.session.csrf);

function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
}

// Login: 5 ta xato urinishdan keyin 15 daqiqa kutish (IP + login bo'yicha)
const URINISHLAR = new Map();
const LIMIT = 5;
const BLOK_MS = 15 * 60 * 1000;

const loginKaliti = (req) => `${req.ip}|${String(req.body.login || '').trim().toLowerCase()}`;

// Bloklangan bo'lsa qolgan daqiqalar, aks holda 0
function blokQoldi(kalit) {
  const e = URINISHLAR.get(kalit);
  if (!e || !e.blok) return 0;
  if (e.blok > Date.now()) return Math.ceil((e.blok - Date.now()) / 60000);
  URINISHLAR.delete(kalit);
  return 0;
}

function xatoUrinish(kalit) {
  const e = URINISHLAR.get(kalit) || { soni: 0, blok: 0, oxirgi: 0 };
  e.soni += 1;
  e.oxirgi = Date.now();
  if (e.soni >= LIMIT) {
    e.blok = Date.now() + BLOK_MS;
    e.soni = 0;
  }
  URINISHLAR.set(kalit, e);
}

const muvaffaqiyatli = (kalit) => URINISHLAR.delete(kalit);

setInterval(() => {
  const chegara = Date.now() - BLOK_MS;
  for (const [k, e] of URINISHLAR) if (e.blok < Date.now() && e.oxirgi < chegara) URINISHLAR.delete(k);
}, 10 * 60 * 1000).unref();

module.exports = { csrf, csrfTogrimi, flash, loginKaliti, blokQoldi, xatoUrinish, muvaffaqiyatli, _URINISHLAR: URINISHLAR };
