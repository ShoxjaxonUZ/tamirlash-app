// HTTP yordamchilari: xato turi, async handler o'rami, xavfsiz qaytish manzili, flash xabar.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// async route xatolarini Express xato ishlovchisiga uzatadi
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// URL parametridan musbat butun son yoki null
function toId(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Faqat shu sayt ichidagi manzil (open redirect'ga qarshi)
function safeNext(v) {
  return typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : '/';
}

function flash(req, type, text) {
  req.session.flash = { type, text };
}

// Query satridan bitta qiymat (massiv kelsa — birinchisi)
function q(v) {
  if (Array.isArray(v)) v = v[0];
  return typeof v === 'string' ? v.trim() : '';
}

module.exports = { HttpError, h, toId, safeNext, flash, q };
