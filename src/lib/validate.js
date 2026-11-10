// Forma qiymatlarini tozalash va tekshirish. Xatolar o'zbek tilida yig'iladi.

class Tekshiruv {
  constructor() {
    this.xatolar = [];
  }

  get ok() {
    return this.xatolar.length === 0;
  }

  xato(matn) {
    this.xatolar.push(matn);
  }

  matn(v, nomi, { min = 0, max = 200, majburiy = false, qatorlar = false } = {}) {
    let s = typeof v === 'string' ? v : '';
    s = qatorlar ? s.replace(/\r\n?/g, '\n').trim() : s.replace(/\s+/g, ' ').trim();
    if (!s) {
      if (majburiy) this.xato(`${nomi} kiritilmagan`);
      return null;
    }
    if (s.length < min) this.xato(`${nomi} kamida ${min} belgidan iborat bo'lsin`);
    if (s.length > max) this.xato(`${nomi} ${max} belgidan oshmasin`);
    return s;
  }

  son(v, nomi, { min, max, majburiy = false } = {}) {
    if (v === undefined || v === null || String(v).trim() === '') {
      if (majburiy) this.xato(`${nomi} kiritilmagan`);
      return null;
    }
    const n = Number(String(v).trim());
    if (!Number.isSafeInteger(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
      this.xato(`${nomi} noto'g'ri`);
      return null;
    }
    return n;
  }

  id(v, nomi, { majburiy = false } = {}) {
    return this.son(v, nomi, { min: 1, majburiy });
  }

  tanlov(v, nomi, ruxsat, { majburiy = true } = {}) {
    if (v === undefined || v === null || v === '') {
      if (majburiy) this.xato(`${nomi} tanlanmagan`);
      return null;
    }
    if (!ruxsat.includes(v)) {
      this.xato(`${nomi} noto'g'ri tanlangan`);
      return null;
    }
    return v;
  }

  // "+998 90 123-45-67", "901234567" → "+998901234567"
  telefon(v) {
    const s = String(v || '').replace(/[\s()-]/g, '');
    if (!s) return null;
    let n = s;
    if (/^\d{9}$/.test(n)) n = `+998${n}`;
    else if (/^998\d{9}$/.test(n)) n = `+${n}`;
    if (!/^\+998\d{9}$/.test(n)) {
      this.xato("Telefon raqami +998XXXXXXXXX ko'rinishida bo'lsin");
      return null;
    }
    return n;
  }

  login(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) {
      this.xato('Login kiritilmagan');
      return null;
    }
    if (!/^[a-z0-9._-]{3,40}$/.test(s)) {
      this.xato("Login 3–40 belgi: lotin harflari, raqam, nuqta, chiziqcha bo'lsin");
      return null;
    }
    return s;
  }

  // bcrypt 72 baytdan uzun parolni kesadi — shuning uchun yuqori chegara
  parol(v, { majburiy = true, nomi = 'Parol' } = {}) {
    const s = typeof v === 'string' ? v : '';
    if (!s) {
      if (majburiy) this.xato(`${nomi} kiritilmagan`);
      return null;
    }
    if (s.length < 8) this.xato(`${nomi} kamida 8 belgidan iborat bo'lsin`);
    if (Buffer.byteLength(s) > 72) this.xato(`${nomi} juda uzun`);
    return s;
  }
}

module.exports = { Tekshiruv };
