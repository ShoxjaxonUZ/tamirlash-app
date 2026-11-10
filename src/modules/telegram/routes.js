// POST /telegram/webhook — Telegram serveri yangilanishlarni shu yerga yuboradi.
// Sessiya va CSRF dan oldin ulanadi; haqiqiyligi X-Telegram-Bot-Api-Secret-Token sarlavhasi bilan tekshiriladi.
const crypto = require('crypto');
const express = require('express');
const config = require('../../config');
const bot = require('./bot');

const router = express.Router();

function sirTogrimi(qiymat) {
  const a = Buffer.from(String(qiymat || ''));
  const b = Buffer.from(config.tg.webhookSecret);
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/webhook', express.json({ limit: '1mb' }), async (req, res) => {
  if (!config.tg.token) return res.sendStatus(404);
  if (!sirTogrimi(req.get('x-telegram-bot-api-secret-token'))) return res.sendStatus(403);
  try {
    await bot.yangilanish(req.body);
  } catch (err) {
    console.error('[telegram] webhook xatosi:', err.message);
  }
  // Telegram 200 olmasa, xuddi shu yangilanishni qayta-qayta yuboradi
  res.sendStatus(200);
});

module.exports = router;
