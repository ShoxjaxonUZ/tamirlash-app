// Xona eshigiga yopishtiriladigan QR-kodlar (TZ, FR-2). Kod /q/<token> manziliga olib boradi.
const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('../config');

const qrUrl = (token) => `${config.appUrl}/q/${token}`;

// SVG satr: kutubxona faqat o'zimiz bergan URL dan yasaydi, shablonda {{{ }}} bilan chiqarish xavfsiz
const qrSvg = (token) => QRCode.toString(qrUrl(token), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });

const yangiToken = () => crypto.randomBytes(12).toString('base64url');

module.exports = { qrUrl, qrSvg, yangiToken };
