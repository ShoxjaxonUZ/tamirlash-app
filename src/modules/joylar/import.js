// Jihozlarni Excel dan ommaviy kiritish. Ustunlar: Bino | Qavat | Xona | Jihoz turi | Belgisi | Inventar raqami.
// Bazada yo'q xona (qavati ko'rsatilgan bo'lsa) avtomatik yaratiladi. Bitta xato bo'lsa ham hech narsa saqlanmaydi.
const ExcelJS = require('exceljs');
const { tx, many } = require('../../db/pool');
const { yangiToken } = require('../../lib/qr');

const USTUNLAR = ['Bino', 'Qavat', 'Xona', 'Jihoz turi', 'Belgisi', 'Inventar raqami'];
const KENGLIK = [16, 8, 10, 24, 18, 18];
const MAX_QATOR = 2000;

const matn = (cell) => String((cell && cell.text) ?? '').trim();

async function namuna() {
  const [binolar, turlar] = await Promise.all([
    many('SELECT nomi FROM binolar ORDER BY nomi'),
    many('SELECT nomi FROM jihoz_turlari ORDER BY tartib, nomi'),
  ]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Jihozlar');
  ws.columns = USTUNLAR.map((header, i) => ({ header, width: KENGLIK[i] }));
  ws.getRow(1).font = { bold: true };
  const bino = binolar[0] ? binolar[0].nomi : 'A bino';
  ws.addRow([bino, 1, '101', 'Kompyuter', '#1', 'INV-000001']);
  ws.addRow([bino, 1, '101', 'Stol', '#1', '']);

  const m = wb.addWorksheet("Ma'lumotnoma");
  m.columns = [
    { header: 'Binolar', width: 22 },
    { header: 'Jihoz turlari', width: 28 },
  ];
  m.getRow(1).font = { bold: true };
  for (let i = 0; i < Math.max(binolar.length, turlar.length); i++) {
    m.addRow([binolar[i] ? binolar[i].nomi : '', turlar[i] ? turlar[i].nomi : '']);
  }
  return wb;
}

async function yukla(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return { xatolar: [{ qator: '—', xato: "Faylni o'qib bo'lmadi: .xlsx formatida ekanini tekshiring" }] };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { xatolar: [{ qator: '—', xato: "Faylda varaq yo'q" }] };
  const sarlavha = USTUNLAR.map((_, i) => matn(ws.getRow(1).getCell(i + 1)).toLowerCase());
  if (sarlavha[0] !== 'bino' || sarlavha[2] !== 'xona' || sarlavha[3] !== 'jihoz turi') {
    return { xatolar: [{ qator: 1, xato: `Birinchi qator sarlavha bo'lsin: ${USTUNLAR.join(' | ')}` }] };
  }

  const [binolar, turlar, xonalar, inventarlar] = await Promise.all([
    many('SELECT id, nomi, qavatlar_soni FROM binolar'),
    many('SELECT id, nomi FROM jihoz_turlari'),
    many('SELECT id, bino_id, raqam FROM xonalar'),
    many('SELECT lower(inventar_raqami) AS inv FROM jihozlar WHERE inventar_raqami IS NOT NULL'),
  ]);
  const binoMap = new Map(binolar.map((b) => [b.nomi.toLowerCase(), b]));
  const turMap = new Map(turlar.map((t) => [t.nomi.toLowerCase(), t.id]));
  const xonaMap = new Map(xonalar.map((x) => [`${x.bino_id}|${x.raqam.toLowerCase()}`, x.id]));
  const bazadagiInv = new Set(inventarlar.map((r) => r.inv));

  const qatorlar = [];
  const xatolar = [];
  const yangiXonalar = new Map();
  const fayldagiInv = new Set();

  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const [binoNomi, qavatMatn, xonaRaqam, turNomi, belgi, inv] = USTUNLAR.map((_, i) => matn(row.getCell(i + 1)));
    if (!binoNomi && !xonaRaqam && !turNomi && !belgi) return;
    const xato = (m) => xatolar.push({ qator: n, xato: m });

    const bino = binoMap.get(binoNomi.toLowerCase());
    if (!bino) return xato(`"${binoNomi}" binosi topilmadi`);
    if (!xonaRaqam || xonaRaqam.length > 20) return xato("Xona raqami kiritilmagan yoki juda uzun");
    const turId = turMap.get(turNomi.toLowerCase());
    if (!turId) return xato(`"${turNomi}" jihoz turi topilmadi`);
    if (!belgi || belgi.length > 40) return xato("Belgisi kiritilmagan yoki 40 belgidan uzun");
    if (inv) {
      const k = inv.toLowerCase();
      if (inv.length > 40) return xato('Inventar raqami 40 belgidan uzun');
      if (bazadagiInv.has(k)) return xato(`${inv} inventar raqami bazada bor`);
      if (fayldagiInv.has(k)) return xato(`${inv} inventar raqami faylda takrorlangan`);
      fayldagiInv.add(k);
    }
    const kalit = `${bino.id}|${xonaRaqam.toLowerCase()}`;
    if (!xonaMap.has(kalit) && !yangiXonalar.has(kalit)) {
      const qavat = Number(qavatMatn);
      if (!qavatMatn || !Number.isInteger(qavat) || qavat < -5 || qavat > bino.qavatlar_soni) {
        return xato(`${xonaRaqam}-xona bazada yo'q: uni yaratish uchun qavatni kiriting (1–${bino.qavatlar_soni})`);
      }
      yangiXonalar.set(kalit, { bino_id: bino.id, qavat, raqam: xonaRaqam });
    }
    qatorlar.push({ kalit, tur_id: turId, belgi, inv: inv || null });
  });

  if (qatorlar.length > MAX_QATOR) return { xatolar: [{ qator: '—', xato: `Bir martada ko'pi bilan ${MAX_QATOR} ta qator` }] };
  if (!qatorlar.length && !xatolar.length) xatolar.push({ qator: '—', xato: "Faylda ma'lumot yo'q" });
  if (xatolar.length) return { xatolar };

  return tx(async (c) => {
    for (const [kalit, x] of yangiXonalar) {
      const r = await c.query('INSERT INTO xonalar (bino_id, qavat, raqam, qr_token) VALUES ($1, $2, $3, $4) RETURNING id', [
        x.bino_id,
        x.qavat,
        x.raqam,
        yangiToken(),
      ]);
      xonaMap.set(kalit, r.rows[0].id);
    }
    await c.query(
      `INSERT INTO jihozlar (xona_id, tur_id, belgi, inventar_raqami)
       SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::text[])`,
      [
        qatorlar.map((q) => xonaMap.get(q.kalit)),
        qatorlar.map((q) => q.tur_id),
        qatorlar.map((q) => q.belgi),
        qatorlar.map((q) => q.inv),
      ]
    );
    return { xatolar: [], jihozlar: qatorlar.length, xonalar: yangiXonalar.size };
  });
}

module.exports = { namuna, yukla, USTUNLAR };
