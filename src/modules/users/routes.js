// /admin/foydalanuvchilar — foydalanuvchilar va rollar (faqat admin).
// /admin/ustalar — ustalar, ularning mutaxassisligi va bandligi (boshliq va admin).
const express = require('express');
const bcrypt = require('bcryptjs');
const { one, many, tx } = require('../../db/pool');
const { h, toId, flash, HttpError } = require('../../lib/http');
const { Tekshiruv } = require('../../lib/validate');
const { ROLLAR, TOIFALAR, MUTAXASSISLIKLAR } = require('../../lib/roles');

const foydalanuvchilar = express.Router();
const ustalar = express.Router();

const ID = '/:id(\\d+)';
const rollar = Object.entries(ROLLAR).map(([kalit, nomi]) => ({ kalit, nomi }));
const toifalar = Object.entries(TOIFALAR).map(([kalit, nomi]) => ({ kalit, nomi }));
const mutaxassisliklar = Object.entries(MUTAXASSISLIKLAR).map(([kalit, nomi]) => ({ kalit, nomi }));

const massiv = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const mutaxassislikOl = (v) => [...new Set(massiv(v).filter((m) => MUTAXASSISLIKLAR[m]))];

async function mutaxassislikSaqla(c, userId, rol, royxat) {
  await c.query('DELETE FROM usta_mutaxassislik WHERE user_id = $1', [userId]);
  if (rol !== 'usta' || !royxat.length) return;
  await c.query(
    'INSERT INTO usta_mutaxassislik (user_id, mutaxassislik) SELECT $1, unnest($2::text[])',
    [userId, royxat]
  );
}

// --- Foydalanuvchilar -----------------------------------------------------------------------------

foydalanuvchilar.get(
  '/',
  h(async (req, res) => {
    const s = (v) => (typeof v === 'string' ? v.trim() : '');
    const f = {
      rol: ROLLAR[s(req.query.rol)] ? s(req.query.rol) : '',
      holat: ['faol', 'bloklangan'].includes(s(req.query.holat)) ? s(req.query.holat) : '',
      q: s(req.query.q).slice(0, 60),
    };
    const sahifa = Math.min(Math.max(Number.parseInt(req.query.sahifa, 10) || 1, 1), 10000);
    const hajm = 50;
    const params = [];
    const w = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.rol) w.push(`u.rol = ${p(f.rol)}`);
    if (f.holat) w.push(f.holat === 'faol' ? 'u.faol' : 'NOT u.faol');
    if (f.q) {
      const like = p(`%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      w.push(`(u.ism ILIKE ${like} OR u.familiya ILIKE ${like} OR u.login ILIKE ${like} OR u.telefon ILIKE ${like})`);
    }
    const rows = await many(
      `SELECT u.id, u.ism, u.familiya, u.login, u.rol, u.toifa, u.telefon, u.faol, u.parol_almashtirish,
              COALESCE((SELECT array_agg(m.mutaxassislik ORDER BY m.mutaxassislik) FROM usta_mutaxassislik m WHERE m.user_id = u.id), '{}') AS mutaxassisliklar,
              count(*) OVER () AS jami
         FROM users u ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
        ORDER BY u.faol DESC, u.familiya, u.ism
        LIMIT ${p(hajm)} OFFSET ${p((sahifa - 1) * hajm)}`,
      params
    );
    const jami = rows.length ? rows[0].jami : 0;
    res.render('users/list', {
      title: 'Foydalanuvchilar',
      rows,
      jami,
      sahifa,
      sahifalar: Math.max(1, Math.ceil(jami / hajm)),
      filtr: f,
      rollar,
    });
  })
);

function forma(res, o, status = 200) {
  res.status(status).render('users/form', {
    title: o.u.id ? 'Foydalanuvchini tahrirlash' : 'Yangi foydalanuvchi',
    rollar,
    toifalar,
    mutaxassisliklar,
    ...o,
  });
}

function tekshir(body, { yangi }) {
  const t = new Tekshiruv();
  const d = {
    familiya: t.matn(body.familiya, 'Familiya', { max: 60, majburiy: true }),
    ism: t.matn(body.ism, 'Ism', { max: 60, majburiy: true }),
    login: t.login(body.login),
    rol: t.tanlov(body.rol, 'Rol', Object.keys(ROLLAR)),
    toifa: t.tanlov(body.toifa, 'Toifa', Object.keys(TOIFALAR), { majburiy: false }),
    telefon: t.telefon(body.telefon),
    faol: yangi ? true : body.faol === 'on',
    parol: t.parol(body.parol, { majburiy: yangi }),
    mutaxassisliklar: mutaxassislikOl(body.mutaxassisliklar),
  };
  if (d.rol === 'usta' && !d.mutaxassisliklar.length) t.xato('Ustaning kamida bitta mutaxassisligini belgilang');
  return { d, t };
}

foydalanuvchilar.get('/yangi', (req, res) => forma(res, { u: { rol: 'user', toifa: 'talaba', faol: true, mutaxassisliklar: [] } }));

foydalanuvchilar.post(
  '/',
  h(async (req, res) => {
    const { d, t } = tekshir(req.body, { yangi: true });
    if (!t.ok) return forma(res, { u: d, xatolar: t.xatolar }, 400);
    try {
      const hash = await bcrypt.hash(d.parol, 10);
      await tx(async (c) => {
        const r = await one(
          `INSERT INTO users (ism, familiya, login, parol_hash, rol, toifa, telefon, parol_almashtirish)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE) RETURNING id`,
          [d.ism, d.familiya, d.login, hash, d.rol, d.toifa, d.telefon],
          c
        );
        await mutaxassislikSaqla(c, r.id, d.rol, d.mutaxassisliklar);
      });
    } catch (err) {
      if (err.code !== '23505') throw err;
      return forma(res, { u: d, xatolar: ['Bu login band'] }, 400);
    }
    flash(req, 'ok', `${d.familiya} ${d.ism} qo'shildi. Birinchi kirishda parolni almashtiradi.`);
    res.redirect('/admin/foydalanuvchilar');
  })
);

async function userOl(id) {
  const u = await one(
    `SELECT u.*, COALESCE((SELECT array_agg(m.mutaxassislik) FROM usta_mutaxassislik m WHERE m.user_id = u.id), '{}') AS mutaxassisliklar
       FROM users u WHERE u.id = $1`,
    [id]
  );
  if (!u) throw new HttpError(404, 'Foydalanuvchi topilmadi');
  return u;
}

foydalanuvchilar.get(
  `${ID}/tahrir`,
  h(async (req, res) => {
    const u = await userOl(toId(req.params.id));
    forma(res, { u, ozimi: u.id === req.user.id });
  })
);

foydalanuvchilar.post(
  ID,
  h(async (req, res) => {
    const eski = await userOl(toId(req.params.id));
    const ozimi = eski.id === req.user.id;
    const { d, t } = tekshir(req.body, { yangi: false });
    if (ozimi && d.rol !== eski.rol) t.xato("O'zingizning rolingizni o'zgartira olmaysiz");
    if (ozimi && !d.faol) t.xato("O'zingizni bloklay olmaysiz");
    if (eski.rol === 'admin' && eski.faol && (d.rol !== 'admin' || !d.faol)) {
      const boshqa = await one("SELECT 1 FROM users WHERE rol = 'admin' AND faol AND id <> $1 LIMIT 1", [eski.id]);
      if (!boshqa) t.xato("Bu yagona faol administrator — avval boshqa administrator tayinlang");
    }
    if (!t.ok) return forma(res, { u: { ...d, id: eski.id }, ozimi, xatolar: t.xatolar }, 400);

    try {
      const hash = d.parol ? await bcrypt.hash(d.parol, 10) : null;
      await tx(async (c) => {
        await c.query(
          `UPDATE users SET ism = $2, familiya = $3, login = $4, rol = $5, toifa = $6, telefon = $7, faol = $8,
                  parol_hash = COALESCE($9, parol_hash),
                  parol_almashtirish = CASE WHEN $9::text IS NULL THEN parol_almashtirish ELSE TRUE END
            WHERE id = $1`,
          [eski.id, d.ism, d.familiya, d.login, d.rol, d.toifa, d.telefon, d.faol, hash]
        );
        await mutaxassislikSaqla(c, eski.id, d.rol, d.mutaxassisliklar);
      });
    } catch (err) {
      if (err.code !== '23505') throw err;
      return forma(res, { u: { ...d, id: eski.id }, ozimi, xatolar: ['Bu login band'] }, 400);
    }

    let matn = 'Saqlandi';
    if (eski.rol === 'usta' && (d.rol !== 'usta' || !d.faol)) {
      const r = await one(
        "SELECT count(*)::int AS n FROM arizalar WHERE usta_id = $1 AND holat IN ('biriktirilgan', 'jarayonda', 'kutilmoqda')",
        [eski.id]
      );
      if (r.n) matn += `. Diqqat: unda ${r.n} ta faol ish bor — ularni boshqa ustaga biriktiring.`;
    }
    flash(req, 'ok', matn);
    res.redirect('/admin/foydalanuvchilar');
  })
);

// --- Ustalar --------------------------------------------------------------------------------------

ustalar.get(
  '/',
  h(async (req, res) => {
    const rows = await many(
      `SELECT u.id, u.ism, u.familiya, u.telefon,
              COALESCE(array_agg(m.mutaxassislik ORDER BY m.mutaxassislik) FILTER (WHERE m.mutaxassislik IS NOT NULL), '{}') AS mutaxassisliklar,
              (SELECT count(*) FROM arizalar a WHERE a.usta_id = u.id AND a.holat IN ('biriktirilgan', 'jarayonda', 'kutilmoqda'))::int AS faol,
              (SELECT count(*) FROM arizalar a WHERE a.usta_id = u.id AND a.holat IN ('biriktirilgan', 'jarayonda', 'kutilmoqda')
                 AND a.muddat < now())::int AS kechikkan,
              (SELECT count(*) FROM arizalar a WHERE a.usta_id = u.id AND a.holat = 'tekshiruvda')::int AS tekshiruvda,
              (SELECT count(*) FROM arizalar a WHERE a.usta_id = u.id AND a.holat = 'yopilgan'
                 AND a.yopilgan > now() - interval '30 days')::int AS bajarilgan,
              (SELECT round(avg(a.baho), 1)::float8 FROM arizalar a WHERE a.usta_id = u.id AND a.baho IS NOT NULL) AS baho
         FROM users u LEFT JOIN usta_mutaxassislik m ON m.user_id = u.id
        WHERE u.rol = 'usta' AND u.faol
        GROUP BY u.id ORDER BY u.familiya, u.ism`
    );
    res.render('users/ustalar', { title: 'Ustalar', rows, mutaxassisliklar });
  })
);

ustalar.post(
  ID,
  h(async (req, res) => {
    const u = await one("SELECT id, ism, familiya FROM users WHERE id = $1 AND rol = 'usta'", [toId(req.params.id)]);
    if (!u) throw new HttpError(404, 'Usta topilmadi');
    const royxat = mutaxassislikOl(req.body.mutaxassisliklar);
    if (!royxat.length) {
      flash(req, 'xato', 'Kamida bitta mutaxassislik belgilang');
      return res.redirect('/admin/ustalar');
    }
    await tx((c) => mutaxassislikSaqla(c, u.id, 'usta', royxat));
    flash(req, 'ok', `${u.familiya} ${u.ism}: mutaxassisliklar saqlandi`);
    res.redirect('/admin/ustalar');
  })
);

module.exports = { foydalanuvchilar, ustalar };
