// Express ilovasi. Testlar createApp() ni to'g'ridan-to'g'ri ishlatadi (server.js siz).
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const { engine } = require('express-handlebars');

const config = require('./config');
const { pool } = require('./db/pool');
const { helpers } = require('./lib/hbs');
const { h, HttpError } = require('./lib/http');
const { query } = require('./db/pool');
const { csrf, flash } = require('./middleware/security');
const { loadUser, requireLogin, requireRole, requireBoshqaruv, parolMajburiy } = require('./middleware/auth');
const pkg = require('../package.json');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.engine(
    'hbs',
    engine({
      extname: '.hbs',
      defaultLayout: 'main',
      layoutsDir: path.join(__dirname, 'views', 'layouts'),
      partialsDir: path.join(__dirname, 'views', 'partials'),
      helpers,
    })
  );
  app.set('view engine', 'hbs');
  app.set('views', path.join(__dirname, 'views'));
  if (config.isProd) app.enable('view cache');
  app.locals.versiya = pkg.version;

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'style-src': ["'self'"],
          'script-src': ["'self'"],
          'upgrade-insecure-requests': config.isProd ? [] : null,
        },
      },
      hsts: config.isProd,
    })
  );
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '7d' : 0 }));

  if (!config.isTest) {
    app.use((req, res, next) => {
      const t = Date.now();
      res.on('finish', () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t}ms`));
      next();
    });
  }

  // Sessiya va CSRF talab qilmaydigan manzillar
  app.get(
    '/healthz',
    h(async (req, res) => {
      await query('SELECT 1');
      res.json({ ok: true });
    })
  );
  app.use('/telegram', require('./modules/telegram/routes'));

  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(
    session({
      name: 'tamir.sid',
      store: new PgSession({ pool, tableName: 'session', pruneSessionInterval: config.isTest ? false : 15 * 60 }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 8 * 3600 * 1000 },
    })
  );
  app.use(flash);
  app.use((req, res, next) => {
    res.locals.yol = req.path;
    next();
  });
  app.use(csrf);
  app.use(h(loadUser));
  app.use(parolMajburiy);

  const arizalar = require('./modules/arizalar/routes');
  const joylar = require('./modules/joylar/routes');
  const users = require('./modules/users/routes');

  app.use(require('./modules/auth/routes'));
  app.use('/profil', requireLogin, require('./modules/profil/routes'));
  app.use('/arizalar', requireLogin, arizalar.router);
  app.use('/rasmlar', requireLogin, arizalar.rasmlar);
  app.use('/q', requireLogin, arizalar.qr);
  app.use('/bildirishnomalar', requireLogin, require('./modules/bildirishnomalar/routes'));
  app.use('/mening-ishlarim', requireRole('usta'), require('./modules/usta/routes'));
  app.use('/boshqaruv', requireBoshqaruv, require('./modules/boshqaruv/routes'));
  app.use('/hisobotlar', requireBoshqaruv, require('./modules/hisobotlar/routes'));
  app.use('/admin/foydalanuvchilar', requireRole('admin'), users.foydalanuvchilar);
  app.use('/admin/ustalar', requireBoshqaruv, users.ustalar);
  app.use('/admin/zaxira', requireRole('admin'), require('./modules/zaxira/routes'));
  app.use('/admin', requireBoshqaruv, joylar.admin);
  app.use('/xonalar', requireBoshqaruv, joylar.xonalar);
  app.use('/jihozlar', requireBoshqaruv, joylar.jihozlar);
  app.use('/', requireLogin, require('./modules/home/routes'));

  app.use((req, res, next) => next(new HttpError(404, 'Sahifa topilmadi')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const sarlavha = { 400: "Noto'g'ri so'rov", 403: "Ruxsat yo'q", 404: 'Topilmadi', 409: "Holat o'zgargan", 413: 'Juda katta' };
    res.status(status).render('error', {
      title: sarlavha[status] || 'Xato',
      status,
      message: status >= 500 ? "Serverda xatolik yuz berdi. Birozdan keyin qayta urinib ko'ring." : err.message,
      layout: res.locals.me ? 'main' : 'auth',
    });
  });

  return app;
}

module.exports = { createApp };
