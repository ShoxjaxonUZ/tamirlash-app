// Bazaning zaxira nusxasi (TZ, 7-bo'lim). pg_dump talab qilmaydi: barcha jadvallar siqilgan JSON faylga yoziladi.
//   npm run zaxira                          — hozir zaxira olish (ZAXIRA_DIR ga)
//   npm run tiklash -- <fayl> --tasdiq      — bazani zaxiradan tiklash (joriy ma'lumotlar o'chadi!)
// Kunlik avtomatik zaxira jobs/index.js da; oxirgi ZAXIRA_SAQLASH (7) tasi saqlanadi.
// DIQQAT: faylda parol xeshlari va shaxsiy ma'lumotlar bor — uni boshqalarga bermang. Rasmlar (uploads/) alohida.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('../config');
const { pool, tx, many } = require('./pool');
const time = require('../lib/time');

// Tiklash tartibi: avval boshqalar havola qiladigan jadvallar
const JADVALLAR = [
  'users',
  'usta_mutaxassislik',
  'binolar',
  'xonalar',
  'jihoz_turlari',
  'jihozlar',
  'ariza_raqamlari',
  'arizalar',
  'ariza_kuzatuvchilar',
  'ariza_rasmlar',
  'ariza_tarix',
  'bildirishnomalar',
  'tg_ulash',
];
const ID_JADVALLAR = ['users', 'binolar', 'xonalar', 'jihoz_turlari', 'jihozlar', 'arizalar', 'ariza_rasmlar', 'ariza_tarix', 'bildirishnomalar'];
const NOM = /^zaxira-\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?\.json\.gz$/;

const pad = (n) => String(n).padStart(2, '0');

async function migratsiyalar(c = pool) {
  return (await many('SELECT version FROM schema_migrations ORDER BY version', [], c)).map((r) => r.version);
}

// Bitta tranzaksiyada (REPEATABLE READ) — barcha jadvallar bir lahzadagi holatda olinadi
async function malumot() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const jadvallar = {};
    for (const t of JADVALLAR) jadvallar[t] = (await client.query(`SELECT * FROM ${t} ORDER BY 1`)).rows;
    const versiyalar = await migratsiyalar(client);
    await client.query('COMMIT');
    return { ilova: 'tamirlash-app', yaratilgan: new Date().toISOString(), migratsiyalar: versiyalar, jadvallar };
  } finally {
    client.release();
  }
}

async function yarat(dir = config.zaxira.dir) {
  fs.mkdirSync(dir, { recursive: true });
  const p = time.parts(time.now());
  let nom = `zaxira-${p.y}-${pad(p.m)}-${pad(p.d)}_${pad(p.h)}${pad(p.min)}.json.gz`;
  for (let i = 2; fs.existsSync(path.join(dir, nom)); i++) nom = nom.replace(/(-\d+)?\.json\.gz$/, `-${i}.json.gz`);
  const data = zlib.gzipSync(JSON.stringify(await malumot()));
  const fayl = path.join(dir, nom);
  fs.writeFileSync(`${fayl}.tmp`, data);
  fs.renameSync(`${fayl}.tmp`, fayl); // yarim yozilgan fayl ro'yxatda ko'rinmaydi
  return { nom, fayl, hajm: data.length };
}

function royxat(dir = config.zaxira.dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => NOM.test(f))
    .map((nom) => {
      const s = fs.statSync(path.join(dir, nom));
      return { nom, hajm: s.size, vaqt: s.mtime };
    })
    .sort((a, b) => b.vaqt - a.vaqt || b.nom.localeCompare(a.nom));
}

// Eng yangi `saqlash` tasidan boshqasini o'chiradi
function tozala(dir = config.zaxira.dir, saqlash = config.zaxira.saqlash) {
  const ortiqcha = royxat(dir).slice(saqlash);
  for (const z of ortiqcha) fs.unlinkSync(path.join(dir, z.nom));
  return ortiqcha.length;
}

async function tiklash(fayl) {
  const z = JSON.parse(zlib.gunzipSync(fs.readFileSync(fayl)).toString('utf8'));
  if (z.ilova !== 'tamirlash-app' || !z.jadvallar) throw new Error('Bu fayl ushbu tizimning zaxirasi emas');
  const hozirgi = await migratsiyalar();
  if (JSON.stringify(z.migratsiyalar) !== JSON.stringify(hozirgi)) {
    throw new Error(`Zaxira boshqa versiyada (${z.migratsiyalar.join(', ')}); baza: ${hozirgi.join(', ')}`);
  }
  return tx(async (c) => {
    await c.query(`TRUNCATE ${JADVALLAR.join(', ')}, "session" RESTART IDENTITY CASCADE`);
    const soni = {};
    for (const t of JADVALLAR) {
      const rows = z.jadvallar[t] || [];
      soni[t] = rows.length;
      if (rows.length) await c.query(`INSERT INTO ${t} SELECT * FROM json_populate_recordset(NULL::${t}, $1::json)`, [JSON.stringify(rows)]);
    }
    for (const t of ID_JADVALLAR) {
      await c.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE(max(id), 1), max(id) IS NOT NULL) FROM ${t}`);
    }
    return soni;
  });
}

const nomTogrimi = (nom) => NOM.test(String(nom || ''));

if (require.main === module) {
  const [buyruq, fayl] = process.argv.slice(2);
  (async () => {
    if (buyruq === 'tiklash') {
      if (!fayl) throw new Error('Foydalanish: npm run tiklash -- <fayl> --tasdiq');
      if (!process.argv.includes('--tasdiq')) {
        throw new Error("Bazadagi BARCHA joriy ma'lumotlar zaxiradagisi bilan almashtiriladi. Rozi bo'lsangiz, --tasdiq qo'shing.");
      }
      const soni = await tiklash(path.resolve(fayl));
      console.log(`✓ Tiklandi: ${soni.users} foydalanuvchi, ${soni.arizalar} ariza, ${soni.jihozlar} jihoz`);
    } else {
      const z = await yarat();
      const ochdi = tozala();
      console.log(`✓ Zaxira: ${z.fayl} (${Math.round(z.hajm / 1024)} KB)${ochdi ? `; eski ${ochdi} ta o'chirildi` : ''}`);
    }
  })()
    .catch((err) => {
      console.error('Xato:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { yarat, royxat, tozala, tiklash, nomTogrimi, JADVALLAR };
