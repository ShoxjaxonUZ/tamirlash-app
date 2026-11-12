// QR-kodlar (TZ, FR-2): xona eshigiga — /q/<token>, har bir jihozga — /j/<token>.
const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('../config');

const qrUrl = (token) => `${config.appUrl}/q/${token}`;
const jihozQrUrl = (token) => `${config.appUrl}/j/${token}`;

// SVG satr: kutubxona faqat o'zimiz bergan URL dan yasaydi, shablonda {{{ }}} bilan chiqarish xavfsiz
const svg = (url) => QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
const qrSvg = (token) => svg(qrUrl(token));
const jihozQrSvg = (token) => svg(jihozQrUrl(token));

const yangiToken = () => crypto.randomBytes(12).toString('base64url');
// Jihoz tokeni qisqaroq: kichik yorliqdagi QR siyrakroq bo'lib, oson skanerlanadi
const jihozToken = () => crypto.randomBytes(8).toString('hex');

const tokenTogrimi = (t) => /^[A-Za-z0-9_-]{8,32}$/.test(String(t || ''));

module.exports = { qrUrl, qrSvg, jihozQrUrl, jihozQrSvg, yangiToken, jihozToken, tokenTogrimi };
