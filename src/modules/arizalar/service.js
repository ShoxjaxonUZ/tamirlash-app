// Arizaning hayot sikli (TZ, 3–4-bo'limlar). Har bir amal: qulf → ruxsat → holat o'tishi → tarix → bildirishnoma,
// hammasi bitta tranzaksiyada. Route'lar faqat shu funksiyalarni chaqiradi.
const { tx, one, many } = require('../../db/pool');
const time = require('../../lib/time');
const { HttpError } = require('../../lib/http');
const { Tekshiruv } = require('../../lib/validate');
const { ISHDA, OCHIQ, MUHIMLIK, HOLATLAR, tekshirOtish } = require('../../lib/holat');
const { boshqaruvchi, fio } = require('../../lib/roles');
const xabar = require('../bildirishnomalar/service');

const NOW = Symbol('now');
const RUXSAT_YOQ = "Bu amalga ruxsatingiz yo'q";

const jihozNomi = (a) => [a.tur, a.jihoz].filter(Boolean).join(' ');
const nomi = (a) => `${a.raqam} (${a.bino}, ${a.xona}-xona — ${jihozNomi(a)})`;

async function keyingiRaqam(c) {
  const yil = time.yil();
  const r = await one(
    `INSERT INTO ariza_raqamlari (yil, oxirgi) VALUES ($1, 1)
     ON CONFLICT (yil) DO UPDATE SET oxirgi = ariza_raqamlari.oxirgi + 1
     RETURNING oxirgi`,
    [yil],
    c
  );
  return `T-${yil}-${String(r.oxirgi).padStart(4, '0')}`;
}

function tarix(c, arizaId, { eski = null, yangi, amal, userId = null, izoh = null }) {
  return c.query(
    `INSERT INTO ariza_tarix (ariza_id, eski_holat, yangi_holat, amal, user_id, izoh)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [arizaId, eski, yangi, amal, userId, izoh ? String(izoh).slice(0, 1000) : null]
  );
}

// Arizani o'zgartirish uchun qulflab o'qiydi (parallel amallar navbat bilan bajariladi)
async function qulfla(c, id) {
  const a = await one(
    `SELECT a.*, x.raqam AS xona, b.nomi AS bino, t.nomi AS tur, j.belgi AS jihoz
       FROM arizalar a
       JOIN xonalar x ON x.id = a.xona_id
       JOIN binolar b ON b.id = x.bino_id
       JOIN jihoz_turlari t ON t.id = a.tur_id
       LEFT JOIN jihozlar j ON j.id = a.jihoz_id
      WHERE a.id = $1
      FOR UPDATE OF a`,
    [id],
    c
  );
  if (!a) throw new HttpError(404, 'Ariza topilmadi');
  return a;
}

function kerak(a, holatlar) {
  if (!holatlar.includes(a.holat)) {
    throw new HttpError(409, `Ariza holati "${HOLATLAR[a.holat]}" — bu amalni bajarib bo'lmaydi. Sahifani yangilang.`);
  }
}

// Biriktirilgan usta yoki boshqaruv (TZ, 2-bo'lim: holatni "Jarayonda / Bajarildi" qilish)
function ustaRuxsat(user, a) {
  if (boshqaruvchi(user) || (user.rol === 'usta' && a.usta_id === user.id)) return;
  throw new HttpError(403, RUXSAT_YOQ);
}

function egasiRuxsat(user, a, { boshqaruvHam = false } = {}) {
  if (a.user_id === user.id || (boshqaruvHam && boshqaruvchi(user))) return;
  throw new HttpError(403, RUXSAT_YOQ);
}

function boshqaruvRuxsat(user) {
  if (!boshqaruvchi(user)) throw new HttpError(403, RUXSAT_YOQ);
}

// Kim nimani ko'ra va qila oladi (sahifa va rasmlar uchun)
function ruxsatlar(user, a, kuzatuvchimi = false) {
  const boshqaruv = boshqaruvchi(user);
  const egasi = a.user_id === user.id;
  const usta = user.rol === 'usta' && a.usta_id === user.id;
  return { boshqaruv, egasi, usta, kuzatuvchi: kuzatuvchimi, korish: boshqaruv || egasi || usta || kuzatuvchimi };
}

async function holatniOzgartir(c, a, yangi, { user, amal, izoh = null, set = {} }) {
  tekshirOtish(a.holat, yangi);
  const params = [a.id, yangi];
  const sets = ['holat = $2', 'yangilangan = now()'];
  // set kalitlari faqat shu fayldan keladi (foydalanuvchidan emas)
  for (const [k, v] of Object.entries(set)) {
    if (v === NOW) sets.push(`${k} = now()`);
    else {
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }
  }
  await c.query(`UPDATE arizalar SET ${sets.join(', ')} WHERE id = $1`, params);
  await tarix(c, a.id, { eski: a.holat, yangi, amal, userId: user ? user.id : null, izoh });
}

// --- Yangi ariza ----------------------------------------------------------------------------------

// Forma qiymatlarini tekshiradi (bazaga murojaat qiladi: xona, jihoz, tur)
async function yangiTekshir(body) {
  const v = new Tekshiruv();
  const xonaId = v.id(body.xona_id, 'Xona', { majburiy: true });
  const jihozId = v.id(body.jihoz_id, 'Jihoz');
  let turId = v.id(body.tur_id, 'Jihoz turi');
  const joyIzohi = v.matn(body.joy_izohi, 'Xonadagi joyi', { max: 200 });
  const tavsif = v.matn(body.tavsif, 'Muammo tavsifi', { min: 10, max: 2000, majburiy: true, qatorlar: true });
  const muhimlik = v.tanlov(body.muhimlik, 'Muhimlik darajasi', Object.keys(MUHIMLIK));

  let xona = null;
  if (xonaId) {
    xona = await one('SELECT id, faol FROM xonalar WHERE id = $1', [xonaId]);
    if (!xona || !xona.faol) v.xato('Xona topilmadi');
  }
  let jihoz = null;
  if (jihozId && xona) {
    jihoz = await one('SELECT id, tur_id, faol FROM jihozlar WHERE id = $1 AND xona_id = $2', [jihozId, xona.id]);
    if (!jihoz || !jihoz.faol) v.xato("Tanlangan jihoz bu xonada yo'q");
    else turId = jihoz.tur_id;
  }
  if (!jihozId) {
    if (!turId) v.xato('Jihozni yoki uning turini tanlang');
    else if (!(await one('SELECT 1 FROM jihoz_turlari WHERE id = $1', [turId]))) v.xato("Jihoz turi noto'g'ri");
  }
  return {
    d: { xona_id: xonaId, jihoz_id: jihoz ? jihoz.id : null, tur_id: turId, joy_izohi: joyIzohi, tavsif, muhimlik },
    xatolar: v.xatolar,
  };
}

// Bitta jihozda bitta ochiq ariza: ikkinchi xabar mavjud arizaga qo'shiladi — yangi ariza ochilmaydi,
// lekin yozganlari (izoh, rasm) yo'qolmaydi va yozgan odam arizani kuzatadi
async function qoshish(c, user, a, d, rasmlar) {
  const meniki = a.user_id === user.id;
  if (!meniki) {
    await c.query('INSERT INTO ariza_kuzatuvchilar (ariza_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, user.id]);
  }
  const izoh = [d.tavsif, d.joy_izohi && `Joyi: ${d.joy_izohi}`].filter(Boolean).join('\n');
  await tarix(c, a.id, { eski: a.holat, yangi: a.holat, amal: meniki ? 'izoh_qoshildi' : 'menda_ham', userId: user.id, izoh });
  for (const f of rasmlar) {
    await c.query(
      `INSERT INTO ariza_rasmlar (ariza_id, fayl, mime, hajm, user_id, bosqich) VALUES ($1, $2, $3, $4, $5, 'ariza')`,
      [a.id, f.filename, f.mimetype, f.size, user.id]
    );
  }

  // Yangi xabar muhimroq bo'lsa (masalan, endi shoshilinch) — ariza muhimligi oshadi, muddat yaqinlashadi
  if (ISHDA.includes(a.holat) && MUHIMLIK[d.muhimlik].tartib > MUHIMLIK[a.muhimlik].tartib) {
    const yangiMuddat = time.muddatHisobla(d.muhimlik);
    const muddat = yangiMuddat < new Date(a.muddat) ? yangiMuddat : new Date(a.muddat);
    const muddatOzgardi = muddat.getTime() !== new Date(a.muddat).getTime();
    await c.query(
      `UPDATE arizalar SET muhimlik = $2, muddat = $3, yangilangan = now(),
              muddat_yaqin_xabar = muddat_yaqin_xabar AND NOT $4, muddat_otdi_xabar = muddat_otdi_xabar AND NOT $4
        WHERE id = $1`,
      [a.id, d.muhimlik, muddat, muddatOzgardi]
    );
    await tarix(c, a.id, {
      eski: a.holat,
      yangi: a.holat,
      amal: 'muddat',
      userId: user.id,
      izoh: `Yangi xabar bo'yicha muhimlik: ${MUHIMLIK[a.muhimlik].nomi} → ${MUHIMLIK[d.muhimlik].nomi}; muddat: ${time.formatVaqt(muddat)}`,
    });
    const kimlar = [...(await xabar.boshqaruvchilar(c)), a.usta_id];
    await xabar.yubor(c, kimlar, a.id, `${nomi(a)}: yana xabar berildi, muhimlik — ${MUHIMLIK[d.muhimlik].nomi}`, user.id);
  } else if (a.usta_id) {
    await xabar.yubor(c, [a.usta_id], a.id, `${a.raqam}: yana bir xabar — ${d.tavsif}`, user.id);
  }
  return { id: a.id, raqam: a.raqam, qoshildi: true };
}

async function yaratish(user, d, rasmlar = []) {
  return tx(async (c) => {
    if (d.jihoz_id) {
      // Bir jihozga bir vaqtda yuborilgan arizalar shu qulf orqali navbatga turadi
      await c.query('SELECT 1 FROM jihozlar WHERE id = $1 FOR UPDATE', [d.jihoz_id]);
      const ochiq = await one('SELECT id FROM arizalar WHERE jihoz_id = $1 AND holat = ANY($2::text[])', [d.jihoz_id, OCHIQ], c);
      if (ochiq) return qoshish(c, user, await qulfla(c, ochiq.id), d, rasmlar);
    }
    const raqam = await keyingiRaqam(c);
    const r = await one(
      `INSERT INTO arizalar (raqam, user_id, xona_id, jihoz_id, tur_id, joy_izohi, tavsif, muhimlik, muddat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [raqam, user.id, d.xona_id, d.jihoz_id, d.tur_id, d.joy_izohi, d.tavsif, d.muhimlik, time.muddatHisobla(d.muhimlik)],
      c
    );
    for (const f of rasmlar) {
      await c.query(
        `INSERT INTO ariza_rasmlar (ariza_id, fayl, mime, hajm, user_id, bosqich) VALUES ($1, $2, $3, $4, $5, 'ariza')`,
        [r.id, f.filename, f.mimetype, f.size, user.id]
      );
    }
    await tarix(c, r.id, { yangi: 'yangi', amal: 'yaratildi', userId: user.id });
    // Har bir yangi ariza boshliq va adminga xabar qilinadi (biriktirish uchun)
    const a = await qulfla(c, r.id);
    const sarlavha = d.muhimlik === 'shoshilinch' ? 'Shoshilinch ariza' : 'Yangi ariza';
    await xabar.yubor(c, await xabar.boshqaruvchilar(c), a.id, `${sarlavha}: ${nomi(a)} — ${d.tavsif}`, user.id);
    return { id: r.id, raqam, qoshildi: false };
  });
}

// --- Boshqaruv: biriktirish, rad etish, birlashtirish, yopish -------------------------------------

async function biriktirish(user, id, { ustaId, muddat = null, muhimlik = null }) {
  boshqaruvRuxsat(user);
  return tx(async (c) => {
    const a = await qulfla(c, id);
    kerak(a, ISHDA);
    const usta = await one("SELECT id, ism, familiya FROM users WHERE id = $1 AND rol = 'usta' AND faol", [ustaId], c);
    if (!usta) throw new HttpError(400, 'Usta topilmadi');

    const yangiMuhimlik = muhimlik || a.muhimlik;
    let yangiMuddat = a.muddat;
    if (muddat) yangiMuddat = muddat;
    else if (yangiMuhimlik !== a.muhimlik) yangiMuddat = time.muddatHisobla(yangiMuhimlik, a.yaratilgan);

    const ustaOzgardi = a.usta_id !== usta.id;
    const muddatOzgardi = new Date(yangiMuddat).getTime() !== new Date(a.muddat).getTime();
    const muhimlikOzgardi = yangiMuhimlik !== a.muhimlik;
    if (!ustaOzgardi && !muddatOzgardi && !muhimlikOzgardi) return { ozgarmadi: true };

    const yangiHolat = ustaOzgardi ? 'biriktirilgan' : a.holat;
    if (yangiHolat !== a.holat) tekshirOtish(a.holat, yangiHolat);
    await c.query(
      `UPDATE arizalar
          SET usta_id = $2, holat = $3, muhimlik = $4, muddat = $5, yangilangan = now(),
              muddat_yaqin_xabar = muddat_yaqin_xabar AND NOT $6,
              muddat_otdi_xabar = muddat_otdi_xabar AND NOT $7
        WHERE id = $1`,
      [a.id, usta.id, yangiHolat, yangiMuhimlik, yangiMuddat, ustaOzgardi || muddatOzgardi, muddatOzgardi]
    );

    const izohlar = [`Usta: ${fio(usta)}`, `muddat: ${time.formatVaqt(yangiMuddat)}`];
    if (muhimlikOzgardi) izohlar.push(`muhimlik: ${MUHIMLIK[yangiMuhimlik].nomi}`);
    const amal = !a.usta_id ? 'biriktirildi' : ustaOzgardi ? 'qayta_biriktirildi' : 'muddat';
    await tarix(c, a.id, { eski: a.holat, yangi: yangiHolat, amal, userId: user.id, izoh: izohlar.join('; ') });

    if (ustaOzgardi) {
      await xabar.yubor(c, [usta.id], a.id, `Sizga yangi ish: ${nomi(a)}. Muddat: ${time.formatVaqt(yangiMuddat)}`, user.id);
      if (a.usta_id) await xabar.yubor(c, [a.usta_id], a.id, `${a.raqam} boshqa ustaga berildi`, user.id);
      await xabar.yubor(c, [a.user_id], a.id, `${a.raqam}: arizangiz ustaga biriktirildi (${fio(usta)})`, user.id);
    } else {
      await xabar.yubor(c, [usta.id], a.id, `${a.raqam}: muddat o'zgardi — ${time.formatVaqt(yangiMuddat)}`, user.id);
    }
    return { ozgarmadi: false };
  });
}

async function radEtish(user, id, sabab) {
  boshqaruvRuxsat(user);
  if (!sabab) throw new HttpError(400, "Rad etish sababini yozing");
  return tx(async (c) => {
    const a = await qulfla(c, id);
    kerak(a, ISHDA);
    await holatniOzgartir(c, a, 'rad_etilgan', { user, amal: 'rad_etildi', izoh: sabab, set: { rad_sababi: sabab } });
    const kimlar = [a.user_id, a.usta_id, ...(await xabar.kuzatuvchilar(c, a.id))];
    await xabar.yubor(c, kimlar, a.id, `${a.raqam} rad etildi: ${sabab}`, user.id);
  });
}

// Dublikat arizani asosiysiga qo'shadi: dublikat egasi va kuzatuvchilari asosiy arizani kuzatadi
async function birlashtirish(user, id, asosiyId) {
  boshqaruvRuxsat(user);
  if (id === asosiyId) throw new HttpError(400, "Arizani o'zi bilan birlashtirib bo'lmaydi");
  return tx(async (c) => {
    // Qulflar id tartibida olinadi — parallel birlashtirishda deadlock bo'lmaydi
    const [birinchi, ikkinchi] = id < asosiyId ? [id, asosiyId] : [asosiyId, id];
    const q1 = await qulfla(c, birinchi);
    const q2 = await qulfla(c, ikkinchi);
    const a = q1.id === id ? q1 : q2;
    const b = q1.id === id ? q2 : q1;
    kerak(a, ISHDA);
    if (!OCHIQ.includes(b.holat)) throw new HttpError(409, `${b.raqam} yopilgan — unga birlashtirib bo'lmaydi`);
    if (a.xona_id !== b.xona_id) throw new HttpError(400, 'Faqat bitta xonadagi arizalarni birlashtirish mumkin');

    await holatniOzgartir(c, a, 'rad_etilgan', {
      user,
      amal: 'birlashtirildi',
      izoh: `Asosiy ariza: ${b.raqam}`,
      set: { rad_sababi: `Dublikat: ${b.raqam}`, birlashtirilgan_id: b.id },
    });
    await c.query(
      `INSERT INTO ariza_kuzatuvchilar (ariza_id, user_id)
       SELECT $1, u FROM (
         SELECT $2::bigint AS u
         UNION SELECT user_id FROM ariza_kuzatuvchilar WHERE ariza_id = $3
       ) s
       WHERE u <> $4
       ON CONFLICT DO NOTHING`,
      [b.id, a.user_id, a.id, b.user_id]
    );
    await tarix(c, b.id, { eski: b.holat, yangi: b.holat, amal: 'dublikat_qoshildi', userId: user.id, izoh: a.raqam });
    const kimlar = [a.user_id, ...(await xabar.kuzatuvchilar(c, a.id))];
    if (a.usta_id && a.usta_id !== b.usta_id) kimlar.push(a.usta_id);
    await xabar.yubor(c, kimlar, a.id, `${a.raqam} ${b.raqam} bilan birlashtirildi — holatini o'sha arizada kuzating`, user.id);
    return { asosiy: b };
  });
}

async function yopish(user, id, { izoh = null, hisobdan = false } = {}) {
  boshqaruvRuxsat(user);
  return tx(async (c) => {
    const a = await qulfla(c, id);
    const almashtirish = a.almashtirish_kerak && ['biriktirilgan', 'jarayonda', 'kutilmoqda'].includes(a.holat);
    if (a.holat !== 'tekshiruvda' && !almashtirish) {
      throw new HttpError(409, 'Ariza tekshiruvda bo\'lsa yoki usta "Almashtirish kerak" deb belgilagan bo\'lsa yopiladi');
    }
    const izohlar = [izoh];
    if (hisobdan && a.jihoz_id) {
      await c.query('UPDATE jihozlar SET faol = FALSE WHERE id = $1', [a.jihoz_id]);
      izohlar.push('Jihoz hisobdan chiqarildi');
    }
    await holatniOzgartir(c, a, 'yopilgan', {
      user,
      amal: 'yopildi',
      izoh: izohlar.filter(Boolean).join('. ') || null,
      set: { yopilgan: NOW },
    });
    const kimlar = [a.user_id, a.usta_id, ...(await xabar.kuzatuvchilar(c, a.id))];
    await xabar.yubor(c, kimlar, a.id, `${a.raqam} yopildi${izoh ? `: ${izoh}` : ''}`, user.id);
  });
}

// --- Usta amallari --------------------------------------------------------------------------------

async function boshlash(user, id) {
  return tx(async (c) => {
    const a = await qulfla(c, id);
    ustaRuxsat(user, a);
    kerak(a, ['biriktirilgan']);
    await holatniOzgartir(c, a, 'jarayonda', { user, amal: 'boshlandi' });
    await xabar.yubor(c, [a.user_id], a.id, `${a.raqam}: usta ishni boshladi`, user.id);
  });
}

async function qismKutish(user, id, izoh) {
  if (!izoh) throw new HttpError(400, 'Qanday ehtiyot qism kerakligini yozing');
  return tx(async (c) => {
    const a = await qulfla(c, id);
    ustaRuxsat(user, a);
    kerak(a, ['jarayonda']);
    await holatniOzgartir(c, a, 'kutilmoqda', { user, amal: 'qism_kutilmoqda', izoh });
    await xabar.yubor(c, [a.user_id], a.id, `${a.raqam}: ehtiyot qism kutilmoqda — ${izoh}`, user.id);
  });
}

async function davom(user, id) {
  return tx(async (c) => {
    const a = await qulfla(c, id);
    ustaRuxsat(user, a);
    kerak(a, ['kutilmoqda']);
    await holatniOzgartir(c, a, 'jarayonda', { user, amal: 'davom_etdi' });
    await xabar.yubor(c, [a.user_id], a.id, `${a.raqam}: ta'mir davom etmoqda`, user.id);
  });
}

async function bajarildi(user, id, izoh, rasmlar = []) {
  if (!izoh) throw new HttpError(400, 'Nima qilinganini yozing');
  return tx(async (c) => {
    const a = await qulfla(c, id);
    ustaRuxsat(user, a);
    kerak(a, ['jarayonda', 'kutilmoqda']);
    await holatniOzgartir(c, a, 'tekshiruvda', { user, amal: 'bajarildi', izoh, set: { bajarilgan: NOW } });
    for (const f of rasmlar) {
      await c.query(
        `INSERT INTO ariza_rasmlar (ariza_id, fayl, mime, hajm, user_id, bosqich) VALUES ($1, $2, $3, $4, $5, 'bajarildi')`,
        [a.id, f.filename, f.mimetype, f.size, user.id]
      );
    }
    await xabar.yubor(c, [a.user_id], a.id, `${a.raqam}: ta'mir bajarildi. Iltimos, tekshirib tasdiqlang.`, user.id);
    await xabar.yubor(c, await xabar.kuzatuvchilar(c, a.id), a.id, `${a.raqam}: ta'mir bajarildi`, user.id);
  });
}

async function almashtirish(user, id, sabab) {
  if (!sabab) throw new HttpError(400, 'Nima uchun tuzatib bo\'lmasligini yozing');
  return tx(async (c) => {
    const a = await qulfla(c, id);
    ustaRuxsat(user, a);
    kerak(a, ['biriktirilgan', 'jarayonda', 'kutilmoqda']);
    if (a.almashtirish_kerak) throw new HttpError(409, 'Allaqachon "Almashtirish kerak" deb belgilangan');
    await c.query(
      'UPDATE arizalar SET almashtirish_kerak = TRUE, almashtirish_sababi = $2, yangilangan = now() WHERE id = $1',
      [a.id, sabab]
    );
    await tarix(c, a.id, { eski: a.holat, yangi: a.holat, amal: 'almashtirish', userId: user.id, izoh: sabab });
    await xabar.yubor(c, await xabar.boshqaruvchilar(c), a.id, `${nomi(a)}: almashtirish kerak — ${sabab}`, user.id);
  });
}

// --- Ariza egasi amallari -------------------------------------------------------------------------

async function tasdiqlash(user, id) {
  return tx(async (c) => {
    const a = await qulfla(c, id);
    egasiRuxsat(user, a, { boshqaruvHam: true });
    kerak(a, ['tekshiruvda']);
    await holatniOzgartir(c, a, 'yopilgan', { user, amal: 'tasdiqlandi', set: { yopilgan: NOW } });
    await xabar.yubor(c, [a.usta_id], a.id, `${a.raqam}: ishingiz qabul qilindi`, user.id);
    await xabar.yubor(c, [a.user_id, ...(await xabar.kuzatuvchilar(c, a.id))], a.id, `${a.raqam} yopildi`, user.id);
  });
}

async function qaytaOchish(user, id, izoh) {
  if (!izoh) throw new HttpError(400, 'Nima hali ham ishlamayotganini yozing');
  return tx(async (c) => {
    const a = await qulfla(c, id);
    egasiRuxsat(user, a, { boshqaruvHam: true });
    kerak(a, ['tekshiruvda']);
    await holatniOzgartir(c, a, 'biriktirilgan', {
      user,
      amal: 'qayta_ochildi',
      izoh,
      set: {
        muddat: time.muddatHisobla(a.muhimlik),
        bajarilgan: null,
        muddat_yaqin_xabar: false,
        muddat_otdi_xabar: false,
      },
    });
    const matn = `${a.raqam} qayta ochildi: "Hali ham buzuq" — ${izoh}`;
    await xabar.yubor(c, [a.usta_id, ...(await xabar.boshqaruvchilar(c))], a.id, matn, user.id);
  });
}

async function bahoQoy(user, id, baho, izoh) {
  return tx(async (c) => {
    const a = await qulfla(c, id);
    egasiRuxsat(user, a);
    kerak(a, ['yopilgan']);
    if (a.baho) throw new HttpError(409, "Baho allaqachon qo'yilgan");
    await c.query('UPDATE arizalar SET baho = $2, baho_izohi = $3 WHERE id = $1', [a.id, baho, izoh]);
    await tarix(c, a.id, {
      eski: a.holat,
      yangi: a.holat,
      amal: 'baho',
      userId: user.id,
      izoh: `${baho}/5${izoh ? ` — ${izoh}` : ''}`,
    });
    await xabar.yubor(c, [a.usta_id], a.id, `${a.raqam}: ishingizga ${baho}/5 baho qo'yildi`, user.id);
  });
}

async function bekorQilish(user, id) {
  return tx(async (c) => {
    const a = await qulfla(c, id);
    egasiRuxsat(user, a);
    kerak(a, ['yangi']);
    await holatniOzgartir(c, a, 'rad_etilgan', {
      user,
      amal: 'bekor_qilindi',
      set: { rad_sababi: 'Egasi bekor qildi' },
    });
    await xabar.yubor(c, await xabar.kuzatuvchilar(c, a.id), a.id, `${a.raqam} egasi tomonidan bekor qilindi`, user.id);
  });
}

// "Menda ham shu muammo": takroriy ariza o'rniga mavjudiga qo'shiladi (TZ, FR-3)
async function mendaHam(user, id) {
  return tx(async (c) => {
    const a = await qulfla(c, id);
    if (a.user_id === user.id) throw new HttpError(400, 'Bu sizning arizangiz');
    if (!OCHIQ.includes(a.holat)) throw new HttpError(409, 'Bu ariza allaqachon yopilgan');
    const r = await c.query(
      'INSERT INTO ariza_kuzatuvchilar (ariza_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [a.id, user.id]
    );
    if (r.rowCount) await tarix(c, a.id, { eski: a.holat, yangi: a.holat, amal: 'menda_ham', userId: user.id });
    return { qoshildi: r.rowCount > 0, raqam: a.raqam };
  });
}

// --- O'qish ---------------------------------------------------------------------------------------

async function olish(id) {
  return one(
    `SELECT a.*, x.raqam AS xona, x.qavat, x.bino_id, b.nomi AS bino, t.nomi AS tur, t.mutaxassislik,
            j.belgi AS jihoz, j.inventar_raqami, j.faol AS jihoz_faol,
            e.ism AS egasi_ism, e.familiya AS egasi_familiya, e.toifa AS egasi_toifa, e.telefon AS egasi_telefon,
            us.ism AS usta_ism, us.familiya AS usta_familiya, us.telefon AS usta_telefon,
            asl.raqam AS asosiy_raqam,
            (SELECT count(*) FROM ariza_kuzatuvchilar k WHERE k.ariza_id = a.id)::int AS kuzatuvchilar
       FROM arizalar a
       JOIN xonalar x ON x.id = a.xona_id
       JOIN binolar b ON b.id = x.bino_id
       JOIN jihoz_turlari t ON t.id = a.tur_id
       JOIN users e ON e.id = a.user_id
       LEFT JOIN jihozlar j ON j.id = a.jihoz_id
       LEFT JOIN users us ON us.id = a.usta_id
       LEFT JOIN arizalar asl ON asl.id = a.birlashtirilgan_id
      WHERE a.id = $1`,
    [id]
  );
}

async function kuzatuvchimi(arizaId, userId) {
  return Boolean(await one('SELECT 1 FROM ariza_kuzatuvchilar WHERE ariza_id = $1 AND user_id = $2', [arizaId, userId]));
}

const rasmlari = (arizaId) =>
  many('SELECT id, bosqich, hajm FROM ariza_rasmlar WHERE ariza_id = $1 ORDER BY id', [arizaId]);

const tarixi = (arizaId) =>
  many(
    `SELECT t.amal, t.eski_holat, t.yangi_holat, t.izoh, t.vaqt, u.ism, u.familiya
       FROM ariza_tarix t LEFT JOIN users u ON u.id = t.user_id
      WHERE t.ariza_id = $1 ORDER BY t.vaqt, t.id`,
    [arizaId]
  );

// Biriktirish uchun ustalar: avval mutaxassisligi mos keladiganlar, keyin bandligi kam bo'lganlar
const ustalar = (mutaxassislik) =>
  many(
    `SELECT u.id, u.ism, u.familiya,
            COALESCE(array_agg(m.mutaxassislik ORDER BY m.mutaxassislik) FILTER (WHERE m.mutaxassislik IS NOT NULL), '{}') AS mutaxassisliklar,
            COALESCE(bool_or(m.mutaxassislik = $1), FALSE) AS mos,
            (SELECT count(*) FROM arizalar a
              WHERE a.usta_id = u.id AND a.holat IN ('biriktirilgan', 'jarayonda', 'kutilmoqda'))::int AS faol_ishlar
       FROM users u LEFT JOIN usta_mutaxassislik m ON m.user_id = u.id
      WHERE u.rol = 'usta' AND u.faol
      GROUP BY u.id
      ORDER BY mos DESC, faol_ishlar, u.familiya, u.ism`,
    [mutaxassislik]
  );

// Shu xonadagi boshqa ochiq arizalar (dublikatni birlashtirish uchun)
const xonadagiBoshqalar = (a) =>
  many(
    `SELECT a.id, a.raqam, a.holat, a.tavsif, t.nomi AS tur, j.belgi AS jihoz
       FROM arizalar a JOIN jihoz_turlari t ON t.id = a.tur_id LEFT JOIN jihozlar j ON j.id = a.jihoz_id
      WHERE a.xona_id = $1 AND a.id <> $2 AND a.holat = ANY($3::text[])
      ORDER BY (a.tur_id = $4) DESC, a.id`,
    [a.xona_id, a.id, OCHIQ, a.tur_id]
  );

module.exports = {
  yangiTekshir,
  yaratish,
  biriktirish,
  radEtish,
  birlashtirish,
  yopish,
  boshlash,
  qismKutish,
  davom,
  bajarildi,
  almashtirish,
  tasdiqlash,
  qaytaOchish,
  bahoQoy,
  bekorQilish,
  mendaHam,
  olish,
  kuzatuvchimi,
  rasmlari,
  tarixi,
  ustalar,
  xonadagiBoshqalar,
  ruxsatlar,
  nomi,
};
