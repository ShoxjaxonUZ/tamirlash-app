// Ariza holatlari va ular orasidagi ruxsat etilgan o'tishlar (TZ, 4-bo'lim).
const { HttpError } = require('./http');

const HOLATLAR = {
  yangi: 'Yangi',
  biriktirilgan: 'Biriktirilgan',
  jarayonda: 'Jarayonda',
  kutilmoqda: 'Ehtiyot qism kutilmoqda',
  tekshiruvda: 'Tekshiruvda',
  yopilgan: 'Yopilgan',
  rad_etilgan: 'Rad etilgan',
};

// Ta'mir hali bajarilmagan holatlar: muddat shu holatlarda nazorat qilinadi
const ISHDA = ['yangi', 'biriktirilgan', 'jarayonda', 'kutilmoqda'];
// Yopilmagan holatlar
const OCHIQ = [...ISHDA, 'tekshiruvda'];
const YAKUNIY = ['yopilgan', 'rad_etilgan'];

const OTISHLAR = {
  yangi: ['biriktirilgan', 'rad_etilgan'],
  // yopilgan: faqat usta "Almashtirish kerak" deb belgilagan bo'lsa (boshliq yopadi)
  biriktirilgan: ['jarayonda', 'rad_etilgan', 'yopilgan'],
  jarayonda: ['kutilmoqda', 'tekshiruvda', 'biriktirilgan', 'rad_etilgan', 'yopilgan'],
  kutilmoqda: ['jarayonda', 'tekshiruvda', 'biriktirilgan', 'rad_etilgan', 'yopilgan'],
  tekshiruvda: ['yopilgan', 'biriktirilgan'],
  yopilgan: [],
  rad_etilgan: [],
};

const MUHIMLIK = {
  past: { nomi: 'Past', izoh: 'Kosmetik nuqson, ishlashga xalal bermaydi', tartib: 1 },
  orta: { nomi: "O'rta", izoh: 'Ishlaydi, lekin noqulay', tartib: 2 },
  yuqori: { nomi: 'Yuqori', izoh: 'Umuman ishlamaydi', tartib: 3 },
  shoshilinch: { nomi: 'Shoshilinch', izoh: 'Xavfli: tok urishi, suv oqishi, singan oyna', tartib: 4 },
};

const AMALLAR = {
  yaratildi: 'Ariza yaratildi',
  biriktirildi: 'Ustaga biriktirildi',
  qayta_biriktirildi: 'Boshqa ustaga berildi',
  muddat: "Muddat yoki muhimlik o'zgartirildi",
  boshlandi: 'Usta ishni boshladi',
  qism_kutilmoqda: 'Ehtiyot qism kutilmoqda',
  davom_etdi: 'Ish davom ettirildi',
  bajarildi: 'Usta: bajarildi',
  tasdiqlandi: 'Egasi ishni qabul qildi',
  qayta_ochildi: 'Egasi: hali ham buzuq',
  almashtirish: 'Almashtirish kerak deb belgilandi',
  rad_etildi: 'Rad etildi',
  bekor_qilindi: 'Egasi bekor qildi',
  birlashtirildi: 'Dublikat sifatida birlashtirildi',
  dublikat_qoshildi: "Dublikat ariza qo'shildi",
  menda_ham: '"Menda ham shu muammo"',
  izoh_qoshildi: "Qo'shimcha xabar",
  yopildi: 'Boshliq yopdi',
  avto_yopildi: 'Avtomatik yopildi',
  baho: "Baho qo'yildi",
};

function mumkinmi(eski, yangi) {
  return (OTISHLAR[eski] || []).includes(yangi);
}

function tekshirOtish(eski, yangi) {
  if (!mumkinmi(eski, yangi)) {
    throw new HttpError(409, `Ariza holati "${HOLATLAR[eski] || eski}" — bu amalni bajarib bo'lmaydi. Sahifani yangilang.`);
  }
}

module.exports = { HOLATLAR, ISHDA, OCHIQ, YAKUNIY, OTISHLAR, MUHIMLIK, AMALLAR, mumkinmi, tekshirOtish };
