const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.ISH_KUNLARI = '1,2,3,4,5';
const time = require('../../src/lib/time');

// Toshkent vaqti (UTC+5) bo'yicha sana
const tk = (s) => new Date(`${s}+05:00`);

test("Ish kunlari: juma 17:00 + 1 ish kuni = dushanba 17:00", () => {
  assert.deepEqual(time.addWorkDays(tk('2026-11-13T17:00:00'), 1), tk('2026-11-16T17:00:00'));
});

test("Ish kunlari: shanba kuni berilgan ariza — dushanbadan hisoblanadi", () => {
  assert.deepEqual(time.addWorkDays(tk('2026-11-14T10:00:00'), 1), tk('2026-11-16T10:00:00'));
  assert.deepEqual(time.addWorkDays(tk('2026-11-14T10:00:00'), 3), tk('2026-11-18T10:00:00'));
});

test('Muddat muhimlikka bog\'liq (TZ, FR-4.3)', () => {
  const t = tk('2026-11-10T09:00:00'); // seshanba
  assert.deepEqual(time.muddatHisobla('shoshilinch', t), tk('2026-11-10T13:00:00'));
  assert.deepEqual(time.muddatHisobla('yuqori', t), tk('2026-11-11T09:00:00'));
  assert.deepEqual(time.muddatHisobla('orta', t), tk('2026-11-13T09:00:00'));
  assert.deepEqual(time.muddatHisobla('past', t), tk('2026-11-19T09:00:00'));
  assert.throws(() => time.muddatHisobla('yoq', t));
});

test('datetime-local qiymati Toshkent vaqtida o\'qiladi va yoziladi', () => {
  const d = time.parseInput('2026-11-10T14:30');
  assert.equal(d.toISOString(), '2026-11-10T09:30:00.000Z');
  assert.equal(time.toInput(d), '2026-11-10T14:30');
  assert.equal(time.parseInput('2026-02-30T10:00'), null);
  assert.equal(time.parseInput('10.11.2026'), null);
});

test('Sana tekshiruvi kalendarda yo\'q sanani rad etadi', () => {
  assert.equal(time.parseSana('2026-11-10'), '2026-11-10');
  assert.equal(time.parseSana('2026-02-29'), null);
  assert.equal(time.parseSana('abc'), null);
  assert.equal(time.sanaQosh('2026-12-30', 3), '2027-01-02');
});

test("Nisbiy vaqt: 'qoldi' / 'kechikdi'", () => {
  const now = tk('2026-11-10T12:00:00');
  assert.equal(time.nisbiy(tk('2026-11-10T15:00:00'), now), '3 soat qoldi');
  assert.equal(time.nisbiy(tk('2026-11-10T11:30:00'), now), '30 daqiqa kechikdi');
  assert.equal(time.nisbiy(tk('2026-11-15T12:00:00'), now), '5 kun qoldi');
});

test("Vaqt formati o'zbekcha", () => {
  time._setClock(() => tk('2026-11-10T12:00:00'));
  assert.equal(time.formatVaqt(tk('2026-11-10T09:05:00')), '10-noyabr, 09:05');
  assert.equal(time.formatVaqt(tk('2025-01-02T09:05:00')), '2-yanvar 2025, 09:05');
  time._setClock(null);
});
