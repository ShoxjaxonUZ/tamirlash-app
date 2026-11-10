// Handlebars helper'lari: shablonlarda holat nomlari, vaqt formatlari, filtrlar uchun URL va h.k.
const time = require('./time');
const { HOLATLAR, MUHIMLIK, ISHDA, AMALLAR } = require('./holat');
const { ROLLAR, TOIFALAR, MUTAXASSISLIKLAR, XONA_TURLARI, fio } = require('./roles');

// Oxirgi argument — Handlebars options obyekti
const args = (a) => Array.prototype.slice.call(a, 0, -1);

const helpers = {
  eq: (a, b) => String(a) === String(b),
  ne: (a, b) => String(a) !== String(b),
  and: (...a) => args(a).every(Boolean),
  or: (...a) => args(a).some(Boolean),
  not: (a) => !a,
  gt: (a, b) => Number(a) > Number(b),
  lt: (a, b) => Number(a) < Number(b),
  inc: (n) => Number(n) + 1,
  dec: (n) => Number(n) - 1,
  includes: (arr, v) => Array.isArray(arr) && arr.map(String).includes(String(v)),
  // {{default qiymat "—"}}
  default: (v, d) => (v === null || v === undefined || v === '' ? d : v),

  holat: (h) => HOLATLAR[h] || h,
  muhimlik: (m) => MUHIMLIK[m]?.nomi || m,
  amal: (a) => AMALLAR[a] || a,
  rol: (r) => ROLLAR[r] || r,
  toifa: (t) => TOIFALAR[t] || '',
  mutaxassislik: (m) => MUTAXASSISLIKLAR[m] || m,
  xonaTuri: (t) => XONA_TURLARI[t] || t,
  fio,

  vaqt: (d) => time.formatVaqt(d),
  sana: (d) => time.formatSana(d),
  isoVaqt: (d) => (d ? new Date(d).toISOString() : ''),
  inputVaqt: (d) => (d ? time.toInput(d) : ''),
  nisbiy: (d) => (d ? time.nisbiy(d) : ''),
  kechikkanmi: (muddat, holat) => ISHDA.includes(holat) && new Date(muddat) < time.now(),
  ishdami: (holat) => ISHDA.includes(holat),

  // Uzun matnni qisqartiradi
  qisqa: (s, n) => {
    const str = String(s || '');
    const len = Number(n) || 120;
    return str.length > len ? `${str.slice(0, len - 1).trimEnd()}…` : str;
  },
  // Joy: "A bino · 101-xona"
  joy: (o) => (o ? `${o.bino} · ${o.xona}-xona` : ''),
  // Jihoz: "Kompyuter #3" yoki faqat tur
  jihozNomi: (o) => (o ? [o.tur, o.jihoz].filter(Boolean).join(' ') : ''),
  bytes: (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`),
  foiz: (a, b) => (Number(b) ? Math.round((Number(a) / Number(b)) * 100) : 0),
  son: (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('ru-RU').replace(/,/g, ' ')),

  // Joriy filtrlarni saqlagan holda bitta parametrni almashtiradi: {{url "/boshqaruv" filtr sahifa=2}}
  url: (base, query, options) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query || {})) if (v !== '' && v !== null && v !== undefined) p.set(k, v);
    for (const [k, v] of Object.entries(options.hash || {})) {
      if (v === '' || v === null || v === undefined) p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  },
  // {{#each (range 1 5)}}
  range: (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i),
  json: (v) => JSON.stringify(v),
  // Menyudagi joriy bo'lim: {{#if (joriy "/boshqaruv")}}aria-current="page"{{/if}}
  joriy: (prefix, options) => {
    const yol = (options && options.data && options.data.root.yol) || '';
    return prefix === '/' ? yol === '/' : yol === prefix || yol.startsWith(`${prefix}/`);
  },
  // Avatar uchun bosh harflar
  bosh: (u) => (u ? `${(u.ism || ' ')[0]}${(u.familiya || ' ')[0]}`.trim().toUpperCase() : ''),
  // Soatlarni o'qishli ko'rinishga: 5.2 soat / 3.1 kun
  davomiylik: (soat) => {
    if (soat === null || soat === undefined) return '—';
    return soat < 48 ? `${Number(soat).toLocaleString('ru-RU')} soat` : `${(soat / 24).toFixed(1).replace('.', ',')} kun`;
  },
  yulduz: (n) => '★'.repeat(Number(n) || 0) + '☆'.repeat(5 - (Number(n) || 0)),
  yil: () => time.yil(),
};

module.exports = { helpers };
