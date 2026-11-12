// Arizalar ro'yxatlari: boshqaruv paneli filtrlari, "Mening arizalarim", ustaning ishlari, forma ma'lumotlari.
const { one, many } = require('../../db/pool');
const { ISHDA, OCHIQ, YAKUNIY, HOLATLAR, MUHIMLIK } = require('../../lib/holat');

const USTUNLAR = `
         a.id, a.raqam, a.holat, a.muhimlik, a.muddat, a.yaratilgan, a.yopilgan, a.almashtirish_kerak, a.tavsif,
         a.usta_id, a.user_id, b.nomi AS bino, x.raqam AS xona, x.qavat, t.nomi AS tur, j.belgi AS jihoz,
         us.familiya || ' ' || us.ism AS usta, e.familiya || ' ' || e.ism AS egasi,
         (SELECT count(*) FROM ariza_kuzatuvchilar k WHERE k.ariza_id = a.id)::int AS kuzatuvchilar,
         (a.holat = ANY('{${ISHDA.join(',')}}'::text[]) AND a.muddat < now()) AS kechikkan`;

const JADVALLAR = `
    FROM arizalar a
    JOIN xonalar x ON x.id = a.xona_id
    JOIN binolar b ON b.id = x.bino_id
    JOIN jihoz_turlari t ON t.id = a.tur_id
    JOIN users e ON e.id = a.user_id
    LEFT JOIN jihozlar j ON j.id = a.jihoz_id
    LEFT JOIN users us ON us.id = a.usta_id`;

const SELECT = `SELECT ${USTUNLAR} ${JADVALLAR}`;

// Avval kechikkanlar, keyin muhimroq va muddati yaqinroq
const TARTIB_ISH = `
  ORDER BY (a.holat = ANY('{${ISHDA.join(',')}}'::text[]) AND a.muddat < now()) DESC,
           CASE a.muhimlik WHEN 'shoshilinch' THEN 4 WHEN 'yuqori' THEN 3 WHEN 'orta' THEN 2 ELSE 1 END DESC,
           a.muddat, a.id`;

const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// Boshqaruv paneli filtri: query satridan tozalangan qiymatlar
function filtrOl(query) {
  const s = (v) => (Array.isArray(v) ? v[0] : v) || '';
  const id = (v) => (/^\d{1,12}$/.test(s(v)) ? s(v) : '');
  const holat = s(query.holat);
  return {
    holat: ['ochiq', 'hammasi', ...Object.keys(HOLATLAR)].includes(holat) ? holat : 'ochiq',
    bino: id(query.bino),
    tur: id(query.tur),
    muhimlik: Object.keys(MUHIMLIK).includes(s(query.muhimlik)) ? s(query.muhimlik) : '',
    usta: s(query.usta) === 'yoq' ? 'yoq' : id(query.usta),
    kechikkan: s(query.kechikkan) === '1' ? '1' : '',
    q: s(query.q).trim().slice(0, 100),
  };
}

async function royxat(f, { sahifa = 1, hajm = 25 } = {}) {
  const params = [];
  const w = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.holat === 'ochiq') w.push(`a.holat = ANY(${p(OCHIQ)}::text[])`);
  else if (f.holat !== 'hammasi') w.push(`a.holat = ${p(f.holat)}`);
  if (f.bino) w.push(`x.bino_id = ${p(Number(f.bino))}`);
  if (f.tur) w.push(`a.tur_id = ${p(Number(f.tur))}`);
  if (f.muhimlik) w.push(`a.muhimlik = ${p(f.muhimlik)}`);
  if (f.usta === 'yoq') w.push('a.usta_id IS NULL');
  else if (f.usta) w.push(`a.usta_id = ${p(Number(f.usta))}`);
  if (f.kechikkan) w.push(`a.holat = ANY(${p(ISHDA)}::text[]) AND a.muddat < now()`);
  if (f.q) {
    const like = p(`%${likeEscape(f.q)}%`);
    w.push(`(a.raqam ILIKE ${like} OR a.tavsif ILIKE ${like} OR x.raqam ILIKE ${like})`);
  }
  const faqatYopiq = YAKUNIY.includes(f.holat);
  // count(*) OVER () LIMIT dan oldin hisoblanadi — jami qatorlar soni
  const sql = `
    SELECT ${USTUNLAR}, count(*) OVER () AS jami ${JADVALLAR}
    ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
    ${faqatYopiq || f.holat === 'hammasi' ? 'ORDER BY a.yaratilgan DESC, a.id DESC' : TARTIB_ISH}
    LIMIT ${p(hajm)} OFFSET ${p((sahifa - 1) * hajm)}`;
  const rows = await many(sql, params);
  const jami = rows.length ? rows[0].jami : 0;
  return { rows, jami, sahifa, sahifalar: Math.max(1, Math.ceil(jami / hajm)) };
}

// Mening arizalarim: o'zim bergan + "Menda ham" bosganlarim
function menikilar(userId, tur = 'ochiq') {
  const holatlar = tur === 'yopiq' ? YAKUNIY : OCHIQ;
  return many(
    `${SELECT}
      WHERE (a.user_id = $1 OR EXISTS (SELECT 1 FROM ariza_kuzatuvchilar k WHERE k.ariza_id = a.id AND k.user_id = $1))
        AND a.holat = ANY($2::text[])
      ORDER BY a.yaratilgan DESC, a.id DESC
      LIMIT 100`,
    [userId, holatlar]
  );
}

// Ustaning ishlari: faol (muddat bo'yicha), tekshiruvda, oxirgi 30 kunda yopilganlar
function ustaIshlari(ustaId, tab = 'faol') {
  if (tab === 'tekshiruvda') {
    return many(`${SELECT} WHERE a.usta_id = $1 AND a.holat = 'tekshiruvda' ORDER BY a.bajarilgan DESC`, [ustaId]);
  }
  if (tab === 'bajarilgan') {
    return many(
      `${SELECT} WHERE a.usta_id = $1 AND a.holat = 'yopilgan' AND a.yopilgan > now() - interval '30 days'
        ORDER BY a.yopilgan DESC`,
      [ustaId]
    );
  }
  return many(`${SELECT} WHERE a.usta_id = $1 AND a.holat IN ('biriktirilgan', 'jarayonda', 'kutilmoqda') ${TARTIB_ISH}`, [ustaId]);
}

const ustaSonlari = (ustaId) =>
  one(
    `SELECT count(*) FILTER (WHERE holat IN ('biriktirilgan', 'jarayonda', 'kutilmoqda'))::int AS faol,
            count(*) FILTER (WHERE holat IN ('biriktirilgan', 'jarayonda', 'kutilmoqda') AND muddat < now())::int AS kechikkan,
            count(*) FILTER (WHERE holat = 'tekshiruvda')::int AS tekshiruvda,
            count(*) FILTER (WHERE holat = 'yopilgan' AND yopilgan > now() - interval '30 days')::int AS bajarilgan
       FROM arizalar WHERE usta_id = $1`,
    [ustaId]
  );

// Bosh sahifadagi kartochkalar
const umumiySonlar = () =>
  one(
    `SELECT count(*) FILTER (WHERE holat = 'yangi')::int AS yangi,
            count(*) FILTER (WHERE holat = ANY($1::text[]) AND muddat < now())::int AS kechikkan,
            count(*) FILTER (WHERE holat IN ('biriktirilgan', 'jarayonda', 'kutilmoqda'))::int AS ishda,
            count(*) FILTER (WHERE holat = 'tekshiruvda')::int AS tekshiruvda,
            count(*) FILTER (WHERE almashtirish_kerak AND holat = ANY($1::text[]))::int AS almashtirish,
            count(*) FILTER (WHERE holat = 'yopilgan'
                             AND yopilgan >= (date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'))::int AS bugun_yopilgan
       FROM arizalar`,
    [ISHDA]
  );

const yangiArizalar = (limit = 8) => many(`${SELECT} WHERE a.holat = 'yangi' ${TARTIB_ISH} LIMIT $1`, [limit]);

const kechikkanlar = (limit = 8) =>
  many(`${SELECT} WHERE a.holat = ANY($1::text[]) AND a.muddat < now() ${TARTIB_ISH} LIMIT $2`, [ISHDA, limit]);

// --- Ariza formasi uchun ---------------------------------------------------------------------------

const binolar = () => many('SELECT id, nomi, qavatlar_soni FROM binolar ORDER BY nomi');

const faolXonalar = () =>
  many(
    `SELECT x.id, x.bino_id, x.qavat, x.raqam, b.nomi AS bino
       FROM xonalar x JOIN binolar b ON b.id = x.bino_id
      WHERE x.faol ORDER BY b.nomi, x.qavat, x.raqam`
  );

const xonaOl = (id) =>
  one(
    `SELECT x.id, x.bino_id, x.qavat, x.raqam, x.turi, x.faol, x.qr_token, b.nomi AS bino
       FROM xonalar x JOIN binolar b ON b.id = x.bino_id WHERE x.id = $1`,
    [id]
  );

// Xona jihozlari; ochiq arizasi bor jihozda uning raqami (formada «ariza bor» deb ko'rsatiladi)
const xonaJihozlari = (xonaId) =>
  many(
    `SELECT j.id, j.belgi, j.tur_id, t.nomi AS tur, oa.raqam AS ochiq_ariza
       FROM jihozlar j JOIN jihoz_turlari t ON t.id = j.tur_id
       LEFT JOIN arizalar oa ON oa.jihoz_id = j.id AND oa.holat = ANY($2::text[])
      WHERE j.xona_id = $1 AND j.faol
      ORDER BY t.tartib, t.nomi, length(j.belgi), j.belgi`,
    [xonaId, OCHIQ]
  );

// QR yoki havola orqali tanlangan jihoz va undagi ochiq ariza (bo'lsa — yangi forma o'rniga «qo'shilish»)
async function formaJihozi(jihozId, xonaId, userId) {
  const j = await one(
    `SELECT j.id, j.belgi, j.inventar_raqami, j.tur_id, t.nomi AS tur
       FROM jihozlar j JOIN jihoz_turlari t ON t.id = j.tur_id
      WHERE j.id = $1 AND j.xona_id = $2 AND j.faol`,
    [jihozId, xonaId]
  );
  if (!j) return null;
  j.ochiq = await one(
    `SELECT a.id, a.raqam, a.holat, a.muhimlik, a.tavsif, a.yaratilgan,
            1 + (SELECT count(*) FROM ariza_kuzatuvchilar k WHERE k.ariza_id = a.id)::int AS xabar_berganlar,
            a.user_id = $2 AS meniki,
            EXISTS (SELECT 1 FROM ariza_kuzatuvchilar k WHERE k.ariza_id = a.id AND k.user_id = $2) AS qoshilganman
       FROM arizalar a WHERE a.jihoz_id = $1 AND a.holat = ANY($3::text[])`,
    [j.id, userId, OCHIQ]
  );
  return j;
}

const turlar = () => many('SELECT id, nomi, mutaxassislik FROM jihoz_turlari ORDER BY tartib, nomi');

// Takroriy arizaning oldini olish: shu xonadagi ochiq arizalar (egasining ismi ko'rsatilmaydi)
const xonaOchiqArizalari = (xonaId, userId) =>
  many(
    `SELECT a.id, a.raqam, a.holat, a.tavsif, a.yaratilgan, a.jihoz_id, a.tur_id, t.nomi AS tur, j.belgi AS jihoz,
            1 + (SELECT count(*) FROM ariza_kuzatuvchilar k WHERE k.ariza_id = a.id)::int AS xabar_berganlar,
            a.user_id = $2 AS meniki,
            EXISTS (SELECT 1 FROM ariza_kuzatuvchilar k WHERE k.ariza_id = a.id AND k.user_id = $2) AS qoshilganman
       FROM arizalar a JOIN jihoz_turlari t ON t.id = a.tur_id LEFT JOIN jihozlar j ON j.id = a.jihoz_id
      WHERE a.xona_id = $1 AND a.holat = ANY($3::text[])
      ORDER BY a.yaratilgan DESC`,
    [xonaId, userId, OCHIQ]
  );

// Xona va jihoz sahifalari uchun arizalar tarixi
const xonaArizalari = (xonaId, limit = 30) =>
  many(`${SELECT} WHERE a.xona_id = $1 ORDER BY (a.holat = ANY($2::text[])) DESC, a.yaratilgan DESC LIMIT $3`, [xonaId, OCHIQ, limit]);

const jihozArizalari = (jihozId) => many(`${SELECT} WHERE a.jihoz_id = $1 ORDER BY a.yaratilgan DESC`, [jihozId]);

module.exports = {
  filtrOl,
  royxat,
  menikilar,
  ustaIshlari,
  ustaSonlari,
  umumiySonlar,
  yangiArizalar,
  kechikkanlar,
  binolar,
  faolXonalar,
  xonaOl,
  xonaJihozlari,
  formaJihozi,
  turlar,
  xonaOchiqArizalari,
  xonaArizalari,
  jihozArizalari,
  SELECT,
  USTUNLAR,
  JADVALLAR,
};
