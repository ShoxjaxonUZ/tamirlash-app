# Ta'mirlash arizalari

Universitet xonalaridagi buzilgan jihozlar (kompyuter, stol, stul, proyektor, konditsioner…) haqida ariza berish va ta'mirni oxirigacha nazorat qilish tizimi. Masalan: *"A bino, 101-xona, deraza yonidagi 3-kompyuter yonmayapti"* — ariza ustaga biriktiriladi, muddat qo'yiladi, holati hammaga ko'rinadi, ish tugagach ariza egasi tasdiqlaydi.

TZ: [Ta'mirlash arizalari tizimi — TZ va reja](../TZ-tamirlash-arizalari.md)

## Imkoniyatlar (TZ bo'yicha)

| TZ | Nima qilingan |
|---|---|
| FR-1 Ariza berish | Bino → qavat → xona → jihoz; tavsif, xonadagi joyi, 4 muhimlik darajasi, 3 tagacha rasm. Raqam: `T-2026-0001` |
| FR-2 QR-kod | **Har jihoz uchun QR** (`/j/…`): skanerlansa ariza faqat shu jihoz uchun ochiladi. Kodni admin **"QR-kod yaratish"** tugmasi bilan yaratadi — bitta jihozga, xonaga yoki binoga, tur bo'yicha tanlab. Xona uchun QR (`/q/…`) — rozetka, eshik kabi jihozsiz muammolar uchun. Xona yoki bino bo'yicha A4 ga yorliq chop etish (tur bo'yicha filtr), SVG yuklab olish, QR ni yangilash |
| FR-3 Dublikatlar | **Bir jihoz — bitta ochiq ariza** (bazada unikal indeks): ikkinchi odam yozsa yangi ariza ochilmaydi, uning izohi va rasmi mavjud arizaga qo'shiladi, u kuzatuvchi bo'ladi; muhimroq xabar muhimlik va muddatni oshiradi. Jihozsiz arizalarda — xonadagi shu turdagi ochiq arizalar tavsiya qilinadi, "Menda ham shu muammo"; boshliq dublikatni asosiysiga birlashtiradi |
| FR-4 Biriktirish | Mutaxassisligi mos ustalar birinchi, bandligi bilan; muddat muhimlikdan avtomatik (4 soat / 1 / 3 / 7 ish kuni), qo'lda o'zgartirish |
| FR-5 Usta ishi | Ishni boshladim · Ehtiyot qism kutilmoqda · Bajarildi (izoh + rasm) · Almashtirish kerak |
| FR-6 Tasdiqlash | "Ha, ishlayapti" / "Hali ham buzuq" (o'sha ustaga qaytadi); 3 kun javob bo'lmasa avtomatik yopiladi; 1–5 baho |
| FR-7 Bildirishnomalar | Saytda (qo'ng'iroqcha) va **Telegram bot** orqali: biriktirildi, boshlandi, bajarildi, muddat yaqin (2 soat), muddat o'tdi; **har bir yangi ariza — boshliq va adminga** (shoshilinch alohida belgilanadi) |
| FR-8 Jihoz tarixi | Har jihozning ta'mir tarixi; 90 kunda 3+ marta buzilsa — "Muammoli" |
| FR-9 Hisobotlar | Holatlar, o'rtacha bajarilish vaqti, muddatida bajarilgan %, eng ko'p buziladigan xonalar, jihoz turlari, ustalar reytingi, Excel eksport |
| 7. Nofunksional | Mobil (375 px); 1000 ta ariza bilan sahifalar serverda 20–60 ms, eng sekini — Excel eksport 0,5 s gacha (talab: 2 s); kunlik zaxira nusxa; CSRF, login cheklovi |

Qo'shimcha: jihozlarni Excel dan ommaviy yuklash, har bir o'zgarish tarixi (audit), rollar bo'yicha bosh sahifa, qorong'i mavzu.

## Rollar

| Rol | Nima qila oladi |
|---|---|
| Foydalanuvchi (talaba, o'qituvchi) | Ariza beradi, o'z arizalarini kuzatadi, tasdiqlaydi yoki qayta ochadi, baholaydi |
| Usta | O'ziga biriktirilgan ishlar: boshlash, qism kutish, bajarildi, almashtirish kerak |
| Xo'jalik boshlig'i | Barcha arizalar, biriktirish, rad etish, birlashtirish, binolar/xonalar/jihozlar, ustalar, hisobotlar |
| Administrator | Boshliq huquqlari + foydalanuvchilar va rollar, zaxira nusxalar |

## O'rnatish

Talablar: **Node.js 22+**, **PostgreSQL 15+**.

```bash
npm ci
cp .env.example .env            # DATABASE_URL va SESSION_SECRET ni to'ldiring
createdb tamirlash              # yoki pgAdmin orqali baza yarating
npm run migrate                 # jadvallar + administrator
npm run seed                    # demo ma'lumotlar (faqat lokal bazaga)
npm run dev                     # http://localhost:3000
```

### Demo hisoblar (`npm run seed` dan keyin)

Parol hamma uchun: `parol123`

| Login | Rol |
|---|---|
| `talaba`, `talaba2`, `talaba3` | Talaba |
| `oqituvchi` | O'qituvchi |
| `usta.komp`, `usta.mebel`, `usta.elektr` | Usta (kompyuter / mebel / elektr va santexnika) |
| `boshliq` | Xo'jalik boshlig'i |
| `admin` | Administrator — parol `.env` dagi `ADMIN_PAROL`, bo'sh bo'lsa `admin12345` (birinchi kirishda almashtiriladi) |

Demo bazani qaytadan to'ldirish: `npm run seed -- --reset` (lokal bazani butunlay tozalaydi).

## Buyruqlar

| Buyruq | Vazifasi |
|---|---|
| `npm run dev` | Ishlab chiqish rejimi (fayl o'zgarsa qayta ishga tushadi) |
| `npm start` | Server |
| `npm run migrate` | `src/db/migrations/*.sql` ni tartib bilan qo'llaydi, administrator bo'lmasa yaratadi |
| `npm run seed` | Demo ma'lumotlar: 2 bino, 20 xona, ~190 jihoz, 8 foydalanuvchi, 13 ariza |
| `npm run zaxira` | Bazaning zaxira nusxasi (`zaxira/` papkasiga) |
| `npm run tiklash -- <fayl> --tasdiq` | Bazani zaxiradan tiklash (joriy ma'lumotlar almashtiriladi) |
| `npm run tg:webhook` | Telegram bot buyruqlari va webhook manzilini o'rnatadi |
| `npm test` | Unit + integratsion testlar (`TEST_DATABASE_URL` kerak) |
| `npm run test:unit` | Faqat unit testlar (bazasiz) |

## Telegram bot

1. Telegram'da **@BotFather** → `/newbot` → token va bot nomini oling.
2. `.env` ga yozing: `TG_BOT_TOKEN`, `TG_BOT_USERNAME`, `TG_WEBHOOK_SECRET` (kamida 16 belgi).
3. Server ochiq https manzilda bo'lsa (Render): `npm run tg:webhook`. Lokal kompyuterda: `.env` ga `TG_POLLING=true` qo'shing va `npm run tg:webhook` (webhook o'chiriladi, server o'zi so'raydi).
4. Foydalanuvchi saytda **Profil → Telegram'ni ulash** ni bosadi, ochilgan botda **Start** — tayyor. Bot buyruqlari: `/arizalarim`, `/stop`.

Xabar yuborilmasa (tarmoq, Telegram cheklovi) — 5 martagacha qayta urinadi; foydalanuvchi botni bloklasa, ulanish avtomatik uziladi. Ariza amallariga Telegram xatosi ta'sir qilmaydi.

## Zaxira nusxalar

- Server ishlab turganda **kuniga bir marta** avtomatik zaxira olinadi, oxirgi 7 tasi saqlanadi (`ZAXIRA_AVTO`, `ZAXIRA_SAQLASH`).
- Admin: **menyu → Zaxira nusxalar** — ro'yxat, "Hozir zaxira olish", yuklab olish.
- Tiklash: `npm run tiklash -- zaxira/zaxira-2026-11-10_0300.json.gz --tasdiq`.
- Faylda parol xeshlari va shaxsiy ma'lumotlar bor — boshqalarga bermang. Rasmlar (`uploads/`) alohida saqlanadi.

## Testlar

```bash
createdb tamirlash_test
TEST_DATABASE_URL=postgresql://postgres:PAROL@localhost:5432/tamirlash_test npm test
```

80 ta test: TZ 10-bo'limidagi **14 ta qabul qilish holati** (`qabul.test.js`, `jihoz-qr.test.js`), xavfsizlik (CSRF, fayl yuklash, rasmga ruxsat, login cheklovi, open redirect, XSS, SQL), jihoz QR va bir xil arizalarni qo'shish (shu jumladan 5 ta bir vaqtdagi so'rov), boshqaruv (birlashtirish, almashtirish, qayta biriktirish, parallel so'rovlar, Excel import/eksport, foydalanuvchilar), Telegram (soxta API bilan), zaxira va tiklash, vaqt va holat mantiqi. Test bazasi har faylda tozalanadi — nomida `test` bo'lmasa testlar ishga tushmaydi. GitHub'da har push'da testlar avtomatik ishlaydi (`.github/workflows/ci.yml`).

## Tuzilma

```
src/
  server.js, app.js, config.js
  db/            pool, migrate, migrations/, seed, zaxira (zaxira va tiklash)
  lib/           time (muddat, ish kunlari, Toshkent vaqti), holat (o'tishlar), validate, roles, qr, hbs
  middleware/    auth (sessiya, rollar), security (CSRF, login cheklovi), upload (rasm, Excel)
  modules/
    arizalar/    service.js — ariza hayot sikli (har amal: qulf → ruxsat → holat → tarix → xabar, bitta tranzaksiyada)
                 queries.js — ro'yxatlar va filtrlar; routes.js — sahifalar, rasmlar, QR
    telegram/    bot (buyruqlar, ulash), outbox (yetkazish navbati), webhook, polling, setup
    boshqaruv/   usta/   home/   profil/   auth/   bildirishnomalar/   zaxira/
    joylar/      binolar, xonalar, jihozlar, turlar, QR chop etish, Excel import
    users/       foydalanuvchilar (admin), ustalar (boshliq)
    hisobotlar/  statistika va Excel eksport
  jobs/          avtomatik yopish, muddat nazorati, kunlik zaxira, Telegram navbati
  views/         Handlebars shablonlari
public/          css, js (JS siz ham ishlaydi), favicon
tests/           unit/, integration/
```

## Xavfsizlik

- Parollar bcrypt bilan; login 5 ta xatodan keyin 15 daqiqaga bloklanadi; sessiya kirishda yangilanadi, rol va faollik har so'rovda bazadan tekshiriladi.
- Har bir POST — CSRF token bilan (fayl yuklanadigan formalarda ham); Helmet: CSP (`script-src 'self'`, inline skript yo'q), `nosniff`, `frame-ancestors`.
- Ruxsatlar serverda: begona ariza, rasm yoki boshqa ustaning ishi — 403.
- Rasmlar: faqat JPG/PNG, 5 MB, fayl boshidagi baytlar tekshiriladi, nomi tasodifiy; faqat arizani ko'ra oladiganlarga beriladi.
- Telegram webhook maxfiy sarlavha bilan himoyalangan; ulash havolasi bir martalik va 15 daqiqa amal qiladi.
- Arizalar o'chirilmaydi; har bir holat o'zgarishi tarixga yoziladi. Parallel amallar `SELECT … FOR UPDATE` bilan navbatga qo'yiladi.
- `npm audit`: `express-handlebars` ichidagi `glob`/`minimatch` bo'yicha 2 ta o'rtacha ogohlantirish — ular faqat dastur o'zining shablon yo'llari bilan ishlaydi, foydalanuvchi kiritgan ma'lumot u yerga yetmaydi.

## Render.com ga joylash

1. Kodni GitHub'ga yuklang.
2. Render → **New → Blueprint** → repozitoriyni tanlang. `render.yaml` baza va web-xizmatni birga yaratadi.
3. So'raladigan qiymatlar: `ADMIN_PAROL` (kamida 8 belgi), Telegram uchun `TG_BOT_TOKEN`, `TG_BOT_USERNAME` (ixtiyoriy). `APP_URL` ni bo'sh qoldirish mumkin: QR-kodlar va Telegram havolalari Render bergan manzilga (`https://<nom>.onrender.com`) olib boradi; o'z domeningiz bo'lsa — uni yozing. Tekshirish: `/healthz` javobidagi `url`.
4. Telegram ishlatilsa: xizmat ishga tushgach Render → Shell → `npm run tg:webhook`.

**QR-kodni telefonda lokal sinash:** `localhost` manzili telefonda ochilmaydi (QR sahifalarida ogohlantirish chiqadi). Kompyuter va telefon bitta Wi-Fi da bo'lsa, `.env` ga `APP_URL=http://<kompyuter IP si>:3000` yozing (IP: `ipconfig`).

Bepul rejadagi cheklovlar: disk vaqtinchalik — rasmlar va zaxira fayllari qayta joylashda o'chadi (zaxirani admin sahifasidan yuklab oling yoki pullik rejada Disk ulang va `UPLOAD_DIR`, `ZAXIRA_DIR` ni unga yo'naltiring); server 15 daqiqa so'rovsiz qolsa uxlaydi, rejalashtiruvchi faqat uyg'oq paytda ishlaydi; bepul baza 30 kundan keyin o'chadi.

## Guruhda ishlash (3 a'zo)

Har bir a'zo o'z branch'ida ishlaydi, tayyor ish Pull Request orqali `main` ga qo'shiladi (testlar avtomatik tekshiradi). Batafsil yo'riqnoma: **[docs/JAMOA.md](docs/JAMOA.md)**.

| Branch | A'zo | Fayllar |
|---|---|---|
| `1-backend` | 1 — backend asosi | `db/`, `middleware/`, `modules/auth`, `modules/joylar`, `modules/zaxira`, `lib/qr.js` |
| `2-ariza-oqimi` | 2 — ariza oqimi | `modules/arizalar`, `views/arizalar`, `middleware/upload.js` |
| `3-boshqaruv` | 3 — boshqaruv | `modules/boshqaruv`, `usta`, `hisobotlar`, `bildirishnomalar`, `telegram`, `jobs/`, `public/css` |

```bash
git checkout 2-ariza-oqimi
# ... o'zgartirishlar ...
git commit -am "Ariza formasi: ..."
git push -u origin 2-ariza-oqimi    # GitHub'da Pull Request oching
```
