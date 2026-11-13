// Saytning tashqi manzili (QR-kodlar va Telegram havolalari): APP_URL → RENDER_EXTERNAL_URL → localhost.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

// config modulini alohida jarayonda berilgan muhit bilan o'qiydi (.env bu qiymatlarni almashtirmaydi)
function manzil(env) {
  const out = execFileSync(
    process.execPath,
    ['-e', "const c = require('./src/config'); console.log(JSON.stringify({ url: c.appUrl, lokal: c.lokalManzil }))"],
    { cwd: path.join(__dirname, '..', '..'), env: { PATH: process.env.PATH, APP_URL: '', RENDER_EXTERNAL_URL: '', PORT: '3000', ...env } }
  );
  return JSON.parse(out);
}

describe('Saytning tashqi manzili', () => {
  it("APP_URL berilsa — o'sha (oxiridagi / olib tashlanadi)", () => {
    assert.deepEqual(manzil({ APP_URL: 'https://tamir.uz/', RENDER_EXTERNAL_URL: 'https://boshqa.onrender.com' }), { url: 'https://tamir.uz', lokal: false });
  });

  it("APP_URL bo'sh bo'lsa — Render o'zi beradigan manzil", () => {
    assert.deepEqual(manzil({ RENDER_EXTERNAL_URL: 'https://tamirlash.onrender.com' }), { url: 'https://tamirlash.onrender.com', lokal: false });
  });

  it("Hech narsa berilmasa — localhost, va u lokal deb belgilanadi (QR sahifasida ogohlantirish)", () => {
    assert.deepEqual(manzil({}), { url: 'http://localhost:3000', lokal: true });
    assert.equal(manzil({ APP_URL: 'http://127.0.0.1:3200' }).lokal, true);
    assert.equal(manzil({ APP_URL: 'http://192.168.1.10:3000' }).lokal, false, 'Wi-Fi tarmog\'idagi manzil telefonda ochiladi');
  });
});
