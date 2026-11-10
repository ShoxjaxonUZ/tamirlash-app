// Fayl yuklash: ariza rasmlari (diskka) va Excel import (xotiraga).
// multer forma maydonlarini o'qigandan keyin CSRF tekshiriladi (shuning uchun formada _csrf birinchi turadi).
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { HttpError } = require('../lib/http');
const { csrfTogrimi } = require('./security');

fs.mkdirSync(config.uploadDir, { recursive: true });

const RASM_TURLARI = { 'image/jpeg': '.jpg', 'image/png': '.png' };
const MAX_RASM = 3;
const MAX_HAJM = 5 * 1024 * 1024;

const rasmMulter = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + RASM_TURLARI[file.mimetype]),
  }),
  limits: { fileSize: MAX_HAJM, files: MAX_RASM, fields: 30, fieldSize: 64 * 1024 },
  fileFilter: (req, file, cb) => {
    if (RASM_TURLARI[file.mimetype]) return cb(null, true);
    cb(Object.assign(new Error('Fayl turi'), { code: 'NOTOGRI_TUR' }));
  },
}).array('rasmlar', MAX_RASM);

function xatoMatni(err) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return 'Har bir rasm 5 MB dan oshmasin';
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return "Ko'pi bilan 3 ta rasm yuklash mumkin";
    case 'NOTOGRI_TUR':
      return 'Faqat JPG yoki PNG rasm yuklash mumkin';
    default:
      return null;
  }
}

// Brauzer aytgan turga ishonmaymiz: fayl boshidagi baytlar tekshiriladi
async function haqiqiyRasmmi(file) {
  const fd = await fs.promises.open(file.path, 'r');
  try {
    const b = Buffer.alloc(8);
    await fd.read(b, 0, 8, 0);
    if (file.mimetype === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    return b.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } finally {
    await fd.close();
  }
}

function ochir(files) {
  for (const f of files || []) if (f.path) fs.promises.unlink(f.path).catch(() => {});
}

// Natija: req.files (tekshirilgan rasmlar) va xato bo'lsa req.yuklashXatosi (forma qayta ko'rsatiladi)
function rasmlar(req, res, next) {
  rasmMulter(req, res, async (err) => {
    const files = req.files || [];
    if (!csrfTogrimi(req)) {
      ochir(files);
      return next(new HttpError(403, "Sahifa eskirgan. Uni yangilab, qaytadan urinib ko'ring."));
    }
    if (err) {
      ochir(files);
      const matn = xatoMatni(err);
      if (!matn) return next(err);
      req.files = [];
      req.yuklashXatosi = matn;
      return next();
    }
    try {
      for (const f of files) {
        if (!(await haqiqiyRasmmi(f))) {
          ochir(files);
          req.files = [];
          req.yuklashXatosi = 'Fayl rasm emas yoki shikastlangan';
          break;
        }
      }
      next();
    } catch (e) {
      ochir(files);
      next(e);
    }
  });
}

const excelMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 5 },
}).single('fayl');

// .xlsx — ZIP arxiv, "PK" bilan boshlanadi
function excel(req, res, next) {
  excelMulter(req, res, (err) => {
    if (!csrfTogrimi(req)) return next(new HttpError(403, "Sahifa eskirgan. Uni yangilab, qaytadan urinib ko'ring."));
    if (err) {
      req.yuklashXatosi = err.code === 'LIMIT_FILE_SIZE' ? 'Fayl hajmi 2 MB dan oshmasin' : 'Faylni yuklab bo\'lmadi';
      return next();
    }
    if (!req.file) req.yuklashXatosi = 'Excel fayl tanlanmagan';
    else if (req.file.buffer.subarray(0, 2).toString() !== 'PK') req.yuklashXatosi = 'Fayl .xlsx formatida bo\'lsin';
    next();
  });
}

module.exports = { rasmlar, excel, ochir, MAX_RASM, RASM_TURLARI };
