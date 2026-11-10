// /hisobotlar — statistika va Excel eksport (TZ, FR-9). Davr Toshkent vaqtidagi sanalar bilan beriladi.
const router = require('express').Router();
const ExcelJS = require('exceljs');
const { many, one } = require('../../db/pool');
const time = require('../../lib/time');
const { h } = require('../../lib/http');
const { HOLATLAR, MUHIMLIK, ISHDA } = require('../../lib/holat');
const { fio } = require('../../lib/roles');
const Q = require('../arizalar/queries');

const TZ = 'Asia/Tashkent';

function filtrOl(query) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  let gacha = time.parseSana(s(query.gacha)) || time.bugun();
  let dan = time.parseSana(s(query.dan)) || time.sanaQosh(gacha, -29);
  if (dan > gacha) [dan, gacha] = [gacha, dan];
  return {
    dan,
    gacha,
    bino: /^\d{1,12}$/.test(s(query.bino)) ? s(query.bino) : '',
    tur: /^\d{1,12}$/.test(s(query.tur)) ? s(query.tur) : '',
  };
}

// Davr: [dan 00:00, gacha+1 00:00) Toshkent vaqtida
function shart(f) {
  const params = [f.dan, f.gacha];
  const w = [
    `a.yaratilgan >= ($1::date::timestamp AT TIME ZONE '${TZ}')`,
    `a.yaratilgan < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`,
  ];
  if (f.bino) {
    params.push(Number(f.bino));
    w.push(`a.xona_id IN (SELECT id FROM xonalar WHERE bino_id = $${params.length})`);
  }
  if (f.tur) {
    params.push(Number(f.tur));
    w.push(`a.tur_id = $${params.length}`);
  }
  return { where: w.join(' AND '), params };
}

// Bajarilish vaqti: yaratilgandan usta "Bajarildi" bosgunicha (bo'lmasa — yopilgunicha), soatda
const SOAT = `EXTRACT(EPOCH FROM (COALESCE(a.bajarilgan, a.yopilgan) - a.yaratilgan)) / 3600`;
const MUDDATIDA = `COALESCE(a.bajarilgan, a.yopilgan) <= a.muddat`;

async function hisobot(f) {
  const { where, params } = shart(f);
  const ishda = `'{${ISHDA.join(',')}}'::text[]`;
  const [umumiy, holatlar, xonalar, turlar, ustalar, muammoli] = await Promise.all([
    one(
      `SELECT count(*)::int AS jami,
              count(*) FILTER (WHERE a.holat = 'yopilgan')::int AS yopilgan,
              count(*) FILTER (WHERE a.holat = ANY(${ishda}) AND a.muddat < now())::int AS kechikkan,
              round(avg(${SOAT}) FILTER (WHERE a.holat = 'yopilgan')::numeric, 1)::float8 AS ortacha_soat,
              count(*) FILTER (WHERE a.holat = 'yopilgan' AND ${MUDDATIDA})::int AS muddatida,
              round(avg(a.baho)::numeric, 1)::float8 AS baho,
              count(a.baho)::int AS baholar
         FROM arizalar a WHERE ${where}`,
      params
    ),
    many(`SELECT a.holat, count(*)::int AS soni FROM arizalar a WHERE ${where} GROUP BY a.holat`, params),
    many(
      `SELECT x.id, x.raqam AS xona, b.nomi AS bino, count(*)::int AS soni
         FROM arizalar a JOIN xonalar x ON x.id = a.xona_id JOIN binolar b ON b.id = x.bino_id
        WHERE ${where} AND a.holat <> 'rad_etilgan'
        GROUP BY x.id, b.nomi ORDER BY soni DESC, b.nomi, x.raqam LIMIT 10`,
      params
    ),
    many(
      `SELECT t.nomi AS tur, count(*)::int AS soni,
              round(avg(${SOAT}) FILTER (WHERE a.holat = 'yopilgan')::numeric, 1)::float8 AS ortacha_soat
         FROM arizalar a JOIN jihoz_turlari t ON t.id = a.tur_id
        WHERE ${where} AND a.holat <> 'rad_etilgan'
        GROUP BY t.id ORDER BY soni DESC, t.nomi`,
      params
    ),
    many(
      `SELECT u.id, u.ism, u.familiya,
              count(*)::int AS biriktirilgan,
              count(*) FILTER (WHERE a.holat = 'yopilgan')::int AS bajarilgan,
              count(*) FILTER (WHERE a.holat = 'yopilgan' AND ${MUDDATIDA})::int AS muddatida,
              count(*) FILTER (WHERE a.holat = ANY(${ishda}) AND a.muddat < now())::int AS kechikkan,
              round(avg(${SOAT}) FILTER (WHERE a.holat = 'yopilgan')::numeric, 1)::float8 AS ortacha_soat,
              round(avg(a.baho)::numeric, 1)::float8 AS baho
         FROM arizalar a JOIN users u ON u.id = a.usta_id
        WHERE ${where} AND a.holat <> 'rad_etilgan'
        GROUP BY u.id ORDER BY bajarilgan DESC, u.familiya`,
      params
    ),
    // Muammoli jihozlar davrga bog'liq emas: oxirgi 90 kunda 3 va undan ko'p ariza (TZ, FR-8)
    many(
      `SELECT j.id, j.belgi, t.nomi AS tur, x.raqam AS xona, b.nomi AS bino, count(*)::int AS soni
         FROM arizalar a JOIN jihozlar j ON j.id = a.jihoz_id JOIN jihoz_turlari t ON t.id = j.tur_id
         JOIN xonalar x ON x.id = j.xona_id JOIN binolar b ON b.id = x.bino_id
        WHERE j.faol AND a.holat <> 'rad_etilgan' AND a.yaratilgan > now() - interval '90 days'
        GROUP BY j.id, t.nomi, x.raqam, b.nomi HAVING count(*) >= 3
        ORDER BY soni DESC, b.nomi, x.raqam LIMIT 20`
    ),
  ]);

  const holatMap = Object.fromEntries(holatlar.map((r) => [r.holat, r.soni]));
  const maxHolat = Math.max(1, ...holatlar.map((r) => r.soni));
  const maxXona = Math.max(1, ...xonalar.map((r) => r.soni));
  const maxTur = Math.max(1, ...turlar.map((r) => r.soni));
  return {
    umumiy,
    holatlar: Object.keys(HOLATLAR).map((k) => ({ kalit: k, soni: holatMap[k] || 0, ulush: Math.round(((holatMap[k] || 0) / maxHolat) * 100) })),
    xonalar: xonalar.map((r) => ({ ...r, ulush: Math.round((r.soni / maxXona) * 100) })),
    turStat: turlar.map((r) => ({ ...r, ulush: Math.round((r.soni / maxTur) * 100) })),
    ustalar,
    muammoli,
  };
}

router.get(
  '/',
  h(async (req, res) => {
    const f = filtrOl(req.query);
    const [natija, binolar, turlar] = await Promise.all([hisobot(f), Q.binolar(), Q.turlar()]);
    res.render('hisobotlar/index', { title: 'Hisobotlar', filtr: f, ...natija, binolar, turlar });
  })
);

// Excel sanalari "devor soati" sifatida yoziladi: Toshkent vaqti (UTC+5)
const mahalliy = (d) => (d ? new Date(new Date(d).getTime() + 5 * 3600e3) : null);

router.get(
  '/excel',
  h(async (req, res) => {
    const f = filtrOl(req.query);
    const { where, params } = shart(f);
    const [arizalar, natija] = await Promise.all([
      many(
        `SELECT ${Q.USTUNLAR}, a.bajarilgan, a.baho, a.rad_sababi ${Q.JADVALLAR}
          WHERE ${where} ORDER BY a.yaratilgan`,
        params
      ),
      hisobot(f),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Ta'mirlash arizalari";
    const vaqtFmt = 'dd.mm.yyyy hh:mm';

    const ws = wb.addWorksheet('Arizalar', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Raqam', key: 'raqam', width: 14 },
      { header: 'Yaratilgan', key: 'yaratilgan', width: 17, style: { numFmt: vaqtFmt } },
      { header: 'Bino', key: 'bino', width: 14 },
      { header: 'Xona', key: 'xona', width: 9 },
      { header: 'Jihoz', key: 'jihoz', width: 22 },
      { header: 'Tavsif', key: 'tavsif', width: 50 },
      { header: 'Muhimlik', key: 'muhimlik', width: 13 },
      { header: 'Holat', key: 'holat', width: 22 },
      { header: 'Usta', key: 'usta', width: 22 },
      { header: 'Muddat', key: 'muddat', width: 17, style: { numFmt: vaqtFmt } },
      { header: 'Bajarilgan', key: 'bajarilgan', width: 17, style: { numFmt: vaqtFmt } },
      { header: 'Yopilgan', key: 'yopilgan', width: 17, style: { numFmt: vaqtFmt } },
      { header: 'Muddatida', key: 'muddatida', width: 11 },
      { header: 'Baho', key: 'baho', width: 7 },
      { header: 'Ariza bergan', key: 'egasi', width: 22 },
    ];
    for (const a of arizalar) {
      const tugadi = a.bajarilgan || a.yopilgan;
      ws.addRow({
        raqam: a.raqam,
        yaratilgan: mahalliy(a.yaratilgan),
        bino: a.bino,
        xona: a.xona,
        jihoz: [a.tur, a.jihoz].filter(Boolean).join(' '),
        tavsif: a.tavsif,
        muhimlik: MUHIMLIK[a.muhimlik].nomi,
        holat: HOLATLAR[a.holat] + (a.holat === 'rad_etilgan' && a.rad_sababi ? ` (${a.rad_sababi})` : ''),
        usta: a.usta || '',
        muddat: mahalliy(a.muddat),
        bajarilgan: mahalliy(a.bajarilgan),
        yopilgan: mahalliy(a.yopilgan),
        muddatida: a.holat === 'yopilgan' ? (new Date(tugadi) <= new Date(a.muddat) ? 'ha' : "yo'q") : '',
        baho: a.baho || '',
        egasi: a.egasi,
      });
    }
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: 'A1', to: 'O1' };

    const wu = wb.addWorksheet('Ustalar');
    wu.columns = [
      { header: 'Usta', key: 'usta', width: 26 },
      { header: 'Biriktirilgan', key: 'biriktirilgan', width: 13 },
      { header: 'Bajarilgan', key: 'bajarilgan', width: 12 },
      { header: 'Muddatida, %', key: 'foiz', width: 13 },
      { header: 'Hozir kechikkan', key: 'kechikkan', width: 15 },
      { header: "O'rtacha vaqt, soat", key: 'soat', width: 18 },
      { header: "O'rtacha baho", key: 'baho', width: 13 },
    ];
    for (const u of natija.ustalar) {
      wu.addRow({
        usta: fio(u),
        biriktirilgan: u.biriktirilgan,
        bajarilgan: u.bajarilgan,
        foiz: u.bajarilgan ? Math.round((u.muddatida / u.bajarilgan) * 100) : '',
        kechikkan: u.kechikkan,
        soat: u.ortacha_soat ?? '',
        baho: u.baho ?? '',
      });
    }
    wu.getRow(1).font = { bold: true };

    const wx = wb.addWorksheet('Xonalar');
    wx.columns = [
      { header: 'Bino', key: 'bino', width: 16 },
      { header: 'Xona', key: 'xona', width: 10 },
      { header: 'Arizalar soni', key: 'soni', width: 14 },
    ];
    natija.xonalar.forEach((x) => wx.addRow(x));
    wx.getRow(1).font = { bold: true };

    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.attachment(`hisobot-${f.dan}-${f.gacha}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  })
);

module.exports = router;
