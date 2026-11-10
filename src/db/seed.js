// npm run seed — demo ma'lumotlar: 2 bino, 20 xona, ~190 jihoz, foydalanuvchilar va turli holatdagi arizalar.
// Faqat lokal bazaga yoziladi (boshqa baza uchun: --force; lokal bazani tozalab qayta to'ldirish: --reset).
// Demo foydalanuvchilar paroli: parol123
const bcrypt = require('bcryptjs');
const config = require('../config');
const { pool, one, many, tx } = require('./pool');
const { migrate } = require('./migrate');
const { yangiToken } = require('../lib/qr');
const time = require('../lib/time');
const S = require('../modules/arizalar/service');

const PAROL = 'parol123';

const FOYDALANUVCHILAR = [
  { login: 'boshliq', familiya: 'Karimov', ism: 'Anvar', rol: 'boshliq', toifa: 'xodim', telefon: '+998901112233' },
  { login: 'usta.komp', familiya: 'Rahimov', ism: 'Jasur', rol: 'usta', toifa: 'xodim', telefon: '+998901234501', mut: ['kompyuter'] },
  { login: 'usta.mebel', familiya: 'Toshmatov', ism: 'Bobur', rol: 'usta', toifa: 'xodim', telefon: '+998901234502', mut: ['mebel', 'umumiy'] },
  { login: 'usta.elektr', familiya: 'Yusupov', ism: 'Sardor', rol: 'usta', toifa: 'xodim', telefon: '+998901234503', mut: ['elektr', 'santexnika'] },
  { login: 'talaba', familiya: 'Aliyeva', ism: 'Madina', rol: 'user', toifa: 'talaba' },
  { login: 'talaba2', familiya: 'Ergashev', ism: 'Sherzod', rol: 'user', toifa: 'talaba' },
  { login: 'talaba3', familiya: 'Nazarova', ism: 'Dilnoza', rol: 'user', toifa: 'talaba' },
  { login: 'oqituvchi', familiya: 'Qodirov', ism: 'Farrux', rol: 'user', toifa: 'oqituvchi', telefon: '+998935556677' },
];

const BINOLAR = [
  {
    nomi: 'A bino',
    manzil: "Universitet ko'chasi, 1",
    qavatlar: 4,
    xonalar: [
      ['101', 1, 'auditoriya'], ['102', 1, 'auditoriya'], ['103', 1, 'auditoriya'], ['104', 1, 'laboratoriya'], ['105', 1, 'ofis'],
      ['201', 2, 'auditoriya'], ['202', 2, 'auditoriya'], ['203', 2, 'auditoriya'], ['204', 2, 'auditoriya'], ['205', 2, 'auditoriya'],
      ['301', 3, 'auditoriya'], ['302', 3, 'auditoriya'], ['401', 4, 'zal'],
    ],
  },
  {
    nomi: 'B bino',
    manzil: "Universitet ko'chasi, 3",
    qavatlar: 3,
    xonalar: [
      ['101', 1, 'auditoriya'], ['102', 1, 'auditoriya'], ['103', 1, 'laboratoriya'],
      ['201', 2, 'auditoriya'], ['202', 2, 'auditoriya'], ['203', 2, 'auditoriya'], ['301', 3, 'auditoriya'],
    ],
  },
];

// Xona turiga qarab jihozlar: [tur, soni]
const JIHOZLAR = {
  auditoriya: [['Doska', 1], ['Proyektor', 1], ['Stol', 4], ['Stul', 3]],
  laboratoriya: [['Kompyuter', 12], ['Stol', 2], ['Proyektor', 1]],
  ofis: [['Kompyuter', 2], ['Printer', 1], ['Stol', 2], ['Shkaf', 1], ['Konditsioner', 1]],
  zal: [['Proyektor', 1], ['Konditsioner', 2], ['Stul', 4]],
};

// Demo uchun vaqtlar: ariza `otgan` soat oldin yaratilgan, tarixdagi har bir qadam yaratilgandan `qadamlar[i]`
// soat keyin bo'lgan. Muddat, bajarilgan va yopilgan vaqtlari shu jadvaldan qayta hisoblanadi.
async function jadval(id, otgan, qadamlar) {
  const yaratilgan = new Date(Date.now() - otgan * 3600e3);
  const tarix = await many('SELECT id, amal FROM ariza_tarix WHERE ariza_id = $1 ORDER BY id', [id]);
  const vaqtlar = tarix.map((t, i) => new Date(yaratilgan.getTime() + (qadamlar[i] ?? qadamlar.at(-1)) * 3600e3));
  for (const [i, t] of tarix.entries()) await pool.query('UPDATE ariza_tarix SET vaqt = $2 WHERE id = $1', [t.id, vaqtlar[i]]);
  const vaqti = (...amallar) => {
    const i = tarix.findLastIndex((t) => amallar.includes(t.amal));
    return i < 0 ? null : vaqtlar[i];
  };
  const a = await one('SELECT muhimlik FROM arizalar WHERE id = $1', [id]);
  await pool.query(
    `UPDATE arizalar SET yaratilgan = $2, yangilangan = $3, muddat = $4, bajarilgan = $5, yopilgan = $6 WHERE id = $1`,
    [
      id,
      yaratilgan,
      vaqtlar.at(-1),
      time.muddatHisobla(a.muhimlik, yaratilgan),
      vaqti('bajarildi'),
      vaqti('tasdiqlandi', 'yopildi', 'avto_yopildi'),
    ]
  );
  await pool.query('UPDATE bildirishnomalar SET yaratilgan = $2 WHERE ariza_id = $1', [id, vaqtlar.at(-1)]);
}

async function main() {
  const host = new URL(config.databaseUrl).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && !process.argv.includes('--force')) {
    throw new Error(`Baza lokal emas (${host}). Demo ma'lumotni yozish uchun: npm run seed -- --force`);
  }
  // --reset: lokal bazani butunlay tozalab, qaytadan to'ldiradi
  if (process.argv.includes('--reset')) await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
  if (await one('SELECT 1 FROM binolar LIMIT 1')) {
    console.log("Bazada allaqachon binolar bor — demo ma'lumot qo'shilmadi (qaytadan: npm run seed -- --reset).");
    return;
  }

  const hash = await bcrypt.hash(PAROL, 10);
  const u = {};
  const turlar = Object.fromEntries((await many('SELECT id, nomi FROM jihoz_turlari')).map((t) => [t.nomi, t.id]));
  const xonalar = {};
  const jihozlar = {};

  await tx(async (c) => {
    for (const f of FOYDALANUVCHILAR) {
      const r = await one(
        `INSERT INTO users (ism, familiya, login, parol_hash, rol, toifa, telefon) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (lower(login)) DO UPDATE SET rol = EXCLUDED.rol RETURNING id, rol`,
        [f.ism, f.familiya, f.login, hash, f.rol, f.toifa, f.telefon || null],
        c
      );
      u[f.login] = r;
      for (const m of f.mut || []) {
        await c.query('INSERT INTO usta_mutaxassislik (user_id, mutaxassislik) VALUES ($1, $2) ON CONFLICT DO NOTHING', [r.id, m]);
      }
    }
    for (const b of BINOLAR) {
      const bino = await one('INSERT INTO binolar (nomi, manzil, qavatlar_soni) VALUES ($1, $2, $3) RETURNING id', [b.nomi, b.manzil, b.qavatlar], c);
      const harf = b.nomi[0];
      for (const [raqam, qavat, turi] of b.xonalar) {
        const x = await one(
          'INSERT INTO xonalar (bino_id, qavat, raqam, turi, qr_token) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [bino.id, qavat, raqam, turi, yangiToken()],
          c
        );
        const kalit = `${harf}${raqam}`;
        xonalar[kalit] = x.id;
        let n = 0;
        for (const [tur, soni] of JIHOZLAR[turi]) {
          for (let i = 1; i <= soni; i++) {
            n += 1;
            const j = await one(
              'INSERT INTO jihozlar (xona_id, tur_id, belgi, inventar_raqami) VALUES ($1, $2, $3, $4) RETURNING id',
              [x.id, turlar[tur], `#${i}`, `INV-${kalit}-${String(n).padStart(2, '0')}`],
              c
            );
            jihozlar[`${kalit} ${tur} #${i}`] = j.id;
          }
        }
      }
    }
  });

  const boshliq = u.boshliq;
  const yarat = (kim, xona, jihoz, tavsif, muhimlik, extra = {}) =>
    S.yaratish(u[kim], {
      xona_id: xonalar[xona],
      jihoz_id: jihoz ? jihozlar[`${xona} ${jihoz}`] : null,
      tur_id: extra.tur ? turlar[extra.tur] : turlar[jihoz.split(' #')[0]],
      joy_izohi: extra.joy || null,
      tavsif,
      muhimlik,
    });
  const ber = (a, usta) => S.biriktirish(boshliq, a.id, { ustaId: u[usta].id });

  // A104 Kompyuter #3 — oxirgi 90 kunda uchinchi marta buziladi ("muammoli jihoz")
  for (const [kun, matn] of [[45, "Kompyuter juda sekin ishlayapti, qotib qolyapti"], [20, "Kompyuter o'z-o'zidan o'chib qolyapti"]]) {
    const a = await yarat('talaba2', 'A104', 'Kompyuter #3', matn, 'orta');
    await ber(a, 'usta.komp');
    await S.boshlash(u['usta.komp'], a.id);
    await S.bajarildi(u['usta.komp'], a.id, 'Changdan tozalandi, termopasta almashtirildi');
    await S.tasdiqlash(u.talaba2, a.id);
    await jadval(a.id, kun * 24, [0, 1, 2, 5, 9]);
  }

  const a1 = await yarat('talaba', 'A104', 'Kompyuter #3', "Kompyuter yonmayapti: quvvat tugmasi bosilganda hech narsa bo'lmaydi", 'yuqori', { joy: 'Deraza tomondagi 1-qator' });
  await ber(a1, 'usta.komp');
  await S.boshlash(u['usta.komp'], a1.id);
  await S.mendaHam(u.talaba3, a1.id);
  await jadval(a1.id, 5, [0, 0.5, 1, 2]);

  const a2 = await yarat('oqituvchi', 'A201', 'Proyektor #1', "Proyektor tasvir chiqarmayapti, lampasi yonib-o'chyapti", 'yuqori');
  await ber(a2, 'usta.komp');
  await S.boshlash(u['usta.komp'], a2.id);
  await S.qismKutish(u['usta.komp'], a2.id, 'Proyektor lampasi (UHP 240W) buyurtma qilindi');
  await jadval(a2.id, 50, [0, 1, 3, 4]);

  const a3 = await yarat('talaba3', 'A102', 'Stul #2', "Stulning oyog'i singan, o'tirish xavfli", 'orta');
  await jadval(a3.id, 3, [0]);

  await yarat('talaba', 'B101', 'Stol #1', 'Stol ustida chizilgan va yozilgan joylar bor, tozalash kerak', 'past');

  const a5 = await yarat('oqituvchi', 'A105', 'Konditsioner #1', "Konditsionerdan suv oqyapti, pastdagi hujjatlar ho'l bo'lishi mumkin", 'shoshilinch');
  await jadval(a5.id, 6, [0]);

  const a6 = await yarat('talaba2', 'A301', 'Doska #1', "Doska devordan qiyshayib qolgan, bir tomoni ko'chgan", 'yuqori');
  await ber(a6, 'usta.mebel');
  await S.boshlash(u['usta.mebel'], a6.id);
  await S.bajarildi(u['usta.mebel'], a6.id, 'Doska yangi dyubellar bilan mahkamlandi');
  await jadval(a6.id, 26, [0, 1, 4, 6]);

  const a7 = await yarat('talaba', 'A203', 'Stol #3', "Stolning tortmasi chiqib ketgan, yopilmayapti", 'past');
  await ber(a7, 'usta.mebel');
  await S.boshlash(u['usta.mebel'], a7.id);
  await S.bajarildi(u['usta.mebel'], a7.id, "Tortma relslari almashtirildi");
  await S.tasdiqlash(u.talaba, a7.id);
  await S.bahoQoy(u.talaba, a7.id, 5, 'Tez va sifatli, rahmat!');
  await jadval(a7.id, 5 * 24, [0, 2, 20, 26, 30, 30.2]);

  const a8 = await yarat('oqituvchi', 'B103', 'Kompyuter #7', "Kompyuter ekranida ko'k ekran (BSOD) chiqyapti, yuklanmayapti", 'yuqori');
  await ber(a8, 'usta.komp');
  await S.boshlash(u['usta.komp'], a8.id);
  await S.almashtirish(u['usta.komp'], a8.id, "Ona plata kuygan — ta'mirlash yangisidan qimmat");
  await jadval(a8.id, 30, [0, 1, 2, 4]);

  const a9 = await yarat('talaba3', 'A104', 'Kompyuter #5', 'Sichqoncha ishlamayapti, kursor qimirlamayapti', 'orta');
  await ber(a9, 'usta.komp');
  await S.boshlash(u['usta.komp'], a9.id);
  await S.bajarildi(u['usta.komp'], a9.id, 'Sichqoncha almashtirildi');
  await S.tasdiqlash(u.talaba3, a9.id);
  await S.bahoQoy(u.talaba3, a9.id, 4, null);
  await jadval(a9.id, 12 * 24, [0, 1, 3, 5, 8, 8.2]);

  const a10 = await yarat('talaba', 'A102', null, "Eshik yonidagi rozetka ishlamayapti, noutbukni zaryadlab bo'lmaydi", 'orta', { tur: 'Elektr (rozetka, chiroq)', joy: 'Eshik yonidagi devor' });
  await ber(a10, 'usta.elektr');
  await jadval(a10.id, 20, [0, 2]);

  const a11 = await yarat('talaba2', 'B202', 'Stul #1', "Stulning suyanchig'i qimirlayapti", 'past');
  await S.bekorQilish(u.talaba2, a11.id);

  console.log("✓ Demo ma'lumotlar qo'shildi: 2 bino, 20 xona, jihozlar va 13 ta ariza.");
  console.log(`  Kirish (parol: ${PAROL}): ${FOYDALANUVCHILAR.map((f) => f.login).join(', ')}`);
  console.log(`  Administrator: ${config.admin.login} (parol .env dagi ADMIN_PAROL yoki admin12345)`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Seed xatosi:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { main };
