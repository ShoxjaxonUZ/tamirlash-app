// Sessiya egasini yuklash va rol bo'yicha ruxsatlar.
const { one } = require('../db/pool');
const { HttpError } = require('../lib/http');
const { boshqaruvchi } = require('../lib/roles');

// Har so'rovda foydalanuvchi bazadan o'qiladi: rol o'zgarsa yoki bloklansa darhol kuchga kiradi
async function loadUser(req, res, next) {
  res.locals.me = null;
  const id = req.session.userId;
  if (!id) return next();
  const u = await one(
    `SELECT u.id, u.ism, u.familiya, u.login, u.rol, u.toifa, u.faol, u.parol_almashtirish,
            (SELECT count(*) FROM bildirishnomalar b WHERE b.user_id = u.id AND NOT b.oqilgan)::int AS oqilmagan
       FROM users u WHERE u.id = $1`,
    [id]
  );
  if (!u || !u.faol) {
    delete req.session.userId;
    return next();
  }
  req.user = u;
  res.locals.me = u;
  res.locals.boshqaruv = boshqaruvchi(u);
  res.locals.ustami = u.rol === 'usta';
  res.locals.adminmi = u.rol === 'admin';
  next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  return res.redirect('/login');
}

const requireRole =
  (...rollar) =>
  (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (!rollar.includes(req.user.rol)) return next(new HttpError(403, "Bu sahifaga ruxsatingiz yo'q"));
    next();
  };

const requireBoshqaruv = requireRole('boshliq', 'admin');

// Vaqtinchalik parol bilan kirgan foydalanuvchi avval parolni almashtiradi
function parolMajburiy(req, res, next) {
  if (!req.user || !req.user.parol_almashtirish) return next();
  if (['/profil', '/profil/parol', '/logout'].includes(req.path)) return next();
  if (req.method === 'GET') return res.redirect('/profil');
  next(new HttpError(403, 'Avval vaqtinchalik parolni almashtiring'));
}

module.exports = { loadUser, requireLogin, requireRole, requireBoshqaruv, parolMajburiy };
