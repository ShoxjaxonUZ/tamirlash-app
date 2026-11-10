// Rollar va ma'lumotnoma qiymatlari (TZ, 2-bo'lim).

const ROLLAR = {
  user: 'Foydalanuvchi',
  usta: 'Usta',
  boshliq: "Xo'jalik boshlig'i",
  admin: 'Administrator',
};

const TOIFALAR = { talaba: 'Talaba', oqituvchi: "O'qituvchi", xodim: 'Xodim' };

const MUTAXASSISLIKLAR = {
  kompyuter: 'Kompyuterchi',
  mebel: 'Duradgor (mebel)',
  elektr: 'Elektrik',
  santexnika: 'Santexnik',
  umumiy: 'Umumiy ishlar',
};

const XONA_TURLARI = {
  auditoriya: 'Auditoriya',
  laboratoriya: 'Laboratoriya',
  ofis: 'Ofis',
  zal: 'Zal',
  boshqa: 'Boshqa',
};

// Boshqaruv huquqi: barcha arizalar, biriktirish, ma'lumotnomalar, hisobotlar
const boshqaruvchi = (u) => Boolean(u) && (u.rol === 'boshliq' || u.rol === 'admin');

const fio = (u) => (u ? [u.familiya, u.ism].filter(Boolean).join(' ') : '');

module.exports = { ROLLAR, TOIFALAR, MUTAXASSISLIKLAR, XONA_TURLARI, boshqaruvchi, fio };
