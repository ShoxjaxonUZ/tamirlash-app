// Vaqt bilan ishlash. "Bugun", muddat va sanalar Toshkent vaqtida (UTC+5, yozgi vaqt yo'q) hisoblanadi.
const config = require('../config');

const OFFSET_MS = 5 * 3600 * 1000;
const OYLAR = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

// Testlarda soatni o'rnatish uchun
let clock = () => new Date();
const now = () => clock();
const _setClock = (fn) => {
  clock = fn || (() => new Date());
};

const pad = (n) => String(n).padStart(2, '0');

// Toshkent vaqtidagi qismlar; dow: 1 = Dushanba ... 7 = Yakshanba
function parts(d) {
  const t = new Date(new Date(d).getTime() + OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: t.getUTCHours(),
    min: t.getUTCMinutes(),
    dow: t.getUTCDay() || 7,
  };
}

// from dan keyin n ta ish kuni (vaqt saqlanadi): juma 17:00 + 1 ish kuni = dushanba 17:00
function addWorkDays(from, n, days = config.ishKunlari) {
  let t = new Date(from).getTime();
  let added = 0;
  while (added < n) {
    t += 864e5;
    if (days.includes(parts(t).dow)) added += 1;
  }
  return new Date(t);
}

// Muhimlik darajasiga ko'ra bajarish muddati (TZ, FR-4.3)
const MUDDATLAR = { shoshilinch: { soat: 4 }, yuqori: { kun: 1 }, orta: { kun: 3 }, past: { kun: 7 } };

function muddatHisobla(muhimlik, from = now()) {
  const m = MUDDATLAR[muhimlik];
  if (!m) throw new Error(`Noma'lum muhimlik: ${muhimlik}`);
  return m.soat ? new Date(new Date(from).getTime() + m.soat * 3600e3) : addWorkDays(from, m.kun);
}

// "10-noyabr, 14:30" (boshqa yil bo'lsa yil ham qo'shiladi)
function formatVaqt(d) {
  if (!d) return '';
  const p = parts(d);
  const yil = p.y !== parts(now()).y ? ` ${p.y}` : '';
  return `${p.d}-${OYLAR[p.m - 1]}${yil}, ${pad(p.h)}:${pad(p.min)}`;
}

function formatSana(d) {
  if (!d) return '';
  const p = parts(d);
  return `${p.d}-${OYLAR[p.m - 1]} ${p.y}`;
}

// <input type="datetime-local"> qiymati
function toInput(d) {
  const p = parts(d);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

function parseInput(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi) - OFFSET_MS;
  const p = parts(t);
  if (p.y !== y || p.m !== mo || p.d !== d || p.h !== h || p.min !== mi) return null;
  return new Date(t);
}

// 'YYYY-MM-DD' (kalendarda bor sana bo'lsa) yoki null
function parseSana(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3] ? m[0] : null;
}

function bugun() {
  const p = parts(now());
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

function sanaQosh(sana, kun) {
  const t = new Date(`${sana}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + kun);
  return t.toISOString().slice(0, 10);
}

// "3 soat qoldi" / "2 kun kechikdi"
function nisbiy(muddat, from = now()) {
  const diff = new Date(muddat).getTime() - new Date(from).getTime();
  const min = Math.max(1, Math.round(Math.abs(diff) / 60000));
  let s;
  if (min < 60) s = `${min} daqiqa`;
  else if (min < 48 * 60) s = `${Math.round(min / 60)} soat`;
  else s = `${Math.round(min / 1440)} kun`;
  return diff >= 0 ? `${s} qoldi` : `${s} kechikdi`;
}

const yil = () => parts(now()).y;

module.exports = {
  now,
  _setClock,
  parts,
  addWorkDays,
  muddatHisobla,
  MUDDATLAR,
  formatVaqt,
  formatSana,
  toInput,
  parseInput,
  parseSana,
  bugun,
  sanaQosh,
  nisbiy,
  yil,
  OYLAR,
};
