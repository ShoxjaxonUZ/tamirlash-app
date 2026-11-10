const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mumkinmi, tekshirOtish, OTISHLAR, HOLATLAR } = require('../../src/lib/holat');
const { Tekshiruv } = require('../../src/lib/validate');
const { safeNext, toId } = require('../../src/lib/http');

test("Asosiy yo'l: yangi → biriktirilgan → jarayonda → tekshiruvda → yopilgan", () => {
  const yol = ['yangi', 'biriktirilgan', 'jarayonda', 'tekshiruvda', 'yopilgan'];
  for (let i = 0; i < yol.length - 1; i++) assert.ok(mumkinmi(yol[i], yol[i + 1]), `${yol[i]} → ${yol[i + 1]}`);
});

test("'Hali ham buzuq' ustaga qaytaradi, ehtiyot qism kutish ikki tomonlama", () => {
  assert.ok(mumkinmi('tekshiruvda', 'biriktirilgan'));
  assert.ok(mumkinmi('jarayonda', 'kutilmoqda'));
  assert.ok(mumkinmi('kutilmoqda', 'jarayonda'));
});

test("Yakuniy holatlardan chiqib bo'lmaydi, bosqichlarni sakrab o'tib bo'lmaydi", () => {
  for (const h of Object.keys(HOLATLAR)) {
    assert.equal(mumkinmi('yopilgan', h), false);
    assert.equal(mumkinmi('rad_etilgan', h), false);
  }
  assert.equal(mumkinmi('yangi', 'jarayonda'), false);
  assert.equal(mumkinmi('yangi', 'tekshiruvda'), false);
  assert.equal(mumkinmi('tekshiruvda', 'rad_etilgan'), false);
  assert.throws(() => tekshirOtish('yangi', 'yopilgan'), (e) => e.status === 409);
});

test("Har bir o'tish ma'lum holatga olib boradi", () => {
  for (const [h, keyingi] of Object.entries(OTISHLAR)) {
    assert.ok(HOLATLAR[h]);
    for (const k of keyingi) assert.ok(HOLATLAR[k], `${h} → ${k}`);
  }
});

test('Telefon raqami +998XXXXXXXXX ko\'rinishiga keltiriladi', () => {
  const t = new Tekshiruv();
  assert.equal(t.telefon('+998 90 123-45-67'), '+998901234567');
  assert.equal(t.telefon('901234567'), '+998901234567');
  assert.equal(t.telefon('998901234567'), '+998901234567');
  assert.equal(t.telefon(''), null);
  assert.ok(t.ok);
  assert.equal(t.telefon('12345'), null);
  assert.equal(t.xatolar.length, 1);
});

test('Matn, son, login va parol tekshiruvi', () => {
  const t = new Tekshiruv();
  assert.equal(t.matn('  bir   ikki  ', 'Nomi'), 'bir ikki');
  assert.equal(t.matn('a\r\nb', 'Tavsif', { qatorlar: true }), 'a\nb');
  assert.equal(t.matn('qisqa', 'Tavsif', { min: 10 }), 'qisqa');
  assert.match(t.xatolar.at(-1), /kamida 10/);
  assert.equal(t.son('5', 'Baho', { min: 1, max: 5 }), 5);
  assert.equal(t.son('6', 'Baho', { min: 1, max: 5 }), null);
  assert.equal(t.son('1.5', 'Son'), null);
  assert.equal(t.login('Ali.Valiyev'), 'ali.valiyev');
  assert.equal(t.login('a b'), null);
  assert.equal(t.parol('1234567'), '1234567');
  assert.match(t.xatolar.at(-1), /8 belgi/);
});

test('Qaytish manzili faqat sayt ichida (open redirect yo\'q)', () => {
  assert.equal(safeNext('/arizalar/5'), '/arizalar/5');
  assert.equal(safeNext('//evil.com'), '/');
  assert.equal(safeNext('/\\evil.com'), '/');
  assert.equal(safeNext('https://evil.com'), '/');
  assert.equal(safeNext(undefined), '/');
  assert.equal(toId('12'), 12);
  assert.equal(toId('0'), null);
  assert.equal(toId('1e3x'), null);
});
