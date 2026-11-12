# Jamoa uchun yo'riqnoma

Loyihaga qo'shilgan har bir a'zo shu sahifani bir marta o'qib chiqsa, birinchi kunning o'zida
kodni ishga tushirib, o'z branch'ida ishlay boshlaydi.

- **Jamoa:** Akparzoda Shoxjaxon, Isoqjonov Sanjar, Ziyoviddinov Raxmatillo
- **Ustoz:** Mamadjanov Shuxrat
- **Sayt:** https://tamirlash.onrender.com
- **Kod:** https://github.com/ShoxjaxonUZ/tamirlash-app
- **TZ:** `../TZ-tamirlash-arizalari.md` (repozitoriydan tashqarida, umumiy papkada)

## 1. Loyiha nima qiladi — 1 daqiqada

Xonada jihoz buzilsa (kompyuter, stul, konditsioner…), odam jihozdagi **QR-kodni skanerlaydi** yoki
saytda xona va jihozni tanlaydi → ariza yozadi → xo'jalik boshlig'i uni ustaga biriktiradi →
usta ishlaydi → ariza egasi "ishlayapti" deb tasdiqlaydi.

Muhim qoida: **bir jihozda faqat bitta ochiq ariza bo'ladi.** Ikkinchi odam xuddi shu konditsioner
haqida yozsa, yangi ariza ochilmaydi — uning xabari, rasmi mavjud arizaga qo'shiladi va u ham
holatni kuzatadi. Bu qoida bazada ham himoyalangan (`uq_arizalar_jihoz_ochiq` indeksi).

Ariza holatlari: `yangi → biriktirilgan → jarayonda ↔ kutilmoqda → tekshiruvda → yopilgan`
(yoki `rad_etilgan`). O'tishlar faqat `src/lib/holat.js` dagi jadval bo'yicha.

## 2. Kompyuterga o'rnatish

Kerak: **Node.js 22+**, **PostgreSQL 15+**, **Git**.

```bash
git clone https://github.com/ShoxjaxonUZ/tamirlash-app.git
cd tamirlash-app
npm ci
cp .env.example .env          # DATABASE_URL dagi PAROL ni o'zingiznikiga almashtiring
createdb tamirlash            # yoki pgAdmin → Create → Database
createdb tamirlash_test       # testlar uchun alohida baza
npm run migrate               # jadvallar + administrator
npm run seed                  # demo ma'lumotlar
npm run dev                   # http://localhost:3000
```

Demo hisoblar (parol `parol123`): `talaba`, `oqituvchi`, `usta.komp`, `usta.mebel`, `usta.elektr`,
`boshliq`. Administrator: `admin` / `admin12345` (birinchi kirishda parol almashtiriladi).

Tekshirish: `http://localhost:3000` ochiladi, `talaba` bilan kirib ariza berish mumkin bo'lsa — tayyor.

## 3. Kim nima uchun javobgar

Har kim asosan o'z fayllarini o'zgartiradi — shunda bir faylni ikki kishi bir vaqtda tahrirlamaydi.
Branch'lar va ularning egalarini jamoada kelishib, quyidagi jadvalga yozib qo'ying.

| Branch | Egasi | Nima | Asosiy fayllar |
|---|---|---|---|
| `1-backend` | … | Baza, login va rollar, binolar/xonalar/jihozlar, QR-kodlar, zaxira | `src/db/`, `src/middleware/`, `src/modules/auth`, `src/modules/joylar`, `src/modules/zaxira`, `src/lib/qr.js` |
| `2-ariza-oqimi` | … | Ariza formasi, rasmlar, dublikatlar, ariza sahifasi, tasdiqlash va baho | `src/modules/arizalar`, `src/views/arizalar`, `src/middleware/upload.js` |
| `3-boshqaruv` | … | Boshliq paneli, usta sahifasi, bildirishnomalar, Telegram, hisobotlar, dizayn | `src/modules/boshqaruv`, `usta`, `hisobotlar`, `bildirishnomalar`, `telegram`, `src/jobs/`, `public/css` |

Umumiy fayllar (`src/app.js`, `src/lib/holat.js`, `tests/helpers.js`, migratsiyalar) — o'zgartirishdan
oldin guruhda ayting.

## 4. Har kungi ish tartibi

```bash
git checkout 2-ariza-oqimi        # o'z branch'ingiz
git pull                          # GitHub'dagi oxirgi holat
git merge main                    # boshqalarning tayyor ishini oling
# ... o'zgartirishlar ...
npm test                          # hammasi o'tishi kerak
git add -A
git commit -m "Ariza formasi: jihoz tanlanganda ochiq arizani ko'rsatish"
git push
```

So'ng GitHub'da **Pull Request** oching: `2-ariza-oqimi → main`. CI testlarni avtomatik ishga
tushiradi (yashil belgi). Kamida bitta a'zo ko'rib chiqib **Merge** qiladi.

Qoidalar:
- `main` ga to'g'ridan-to'g'ri push qilmang — faqat Pull Request orqali.
- `git push --force` ishlatmang: boshqalarning ishi yo'qolishi mumkin.
- Commit xabari nima o'zgarganini aytsin: "Hisobot: ustalar reytingiga baho qo'shildi", "tuzatish" emas.
- Konflikt chiqsa (`git merge main` dan keyin): faylni oching, `<<<<<<<` va `>>>>>>>` orasidan
  to'g'ri variantni qoldiring, `npm test`, so'ng commit. Tushunmasangiz — fayl egasidan so'rang.

## 5. Bazani o'zgartirish (migratsiya)

Jadvalga ustun yoki yangi jadval kerak bo'lsa, eski migratsiyani **o'zgartirmang** — yangi fayl qo'shing:

```
src/db/migrations/004_qisqa_nom.sql
```

`npm run migrate` uni bir marta qo'llaydi (`schema_migrations` jadvalida yoziladi). Render ham har
joylashda o'zi ishga tushiradi. Fayl qayta ishga tushsa ham buzilmasin (`IF NOT EXISTS`), so'ng
`tests/integration/zaxira.test.js` dagi migratsiyalar ro'yxatiga nomini qo'shing.

## 6. Testlar

```bash
npm test             # hammasi (TEST_DATABASE_URL kerak, .env da)
npm run test:unit    # faqat bazasiz unit testlar
```

- Test bazasi har faylda **tozalanadi** — shuning uchun nomida `test` bo'lmagan bazada testlar ishlamaydi.
- Yangi imkoniyat qo'shsangiz — `tests/integration/` ga test yozing. Namuna: `jihoz-qr.test.js`.
- Tayyor yordamchilar `tests/helpers.js` da: `fixtures()` (bino, xonalar, jihozlar, foydalanuvchilar),
  `kirish(app, 'talaba')`, `yangiAriza(agent, {...})`, `ariza(id)`.

## 7. Saytga chiqish (Render)

`main` ga merge qilingan har bir o'zgarish **o'zi** https://tamirlash.onrender.com ga chiqadi
(Render → Auto-Deploy). Ishga tushishda migratsiyalar qo'llanadi. Kuzatish: Render → tamirlash →
**Events** va **Logs**. Xato bo'lsa, oldingi versiya ishlashda davom etadi.

Bazani o'zgartiradigan katta ish oldidan admin panelda **Zaxira nusxalar → Hozir zaxira olish** ni bosing.

## 8. Mumkin emas

- `.env`, parollar, Render baza manzili (`postgresql://…`), Telegram token — **GitHub'ga yoki chatga yozilmaydi**.
  `.env` allaqachon `.gitignore` da. Tasodifan yuborilsa — Render'da darhol yangilang (Rotate).
- Jonli bazada test o'tkazmang; `npm run seed -- --reset` faqat lokal bazaga.
- Himoyadan keyin saytdagi demo hisoblarni (`parol123`) o'chiring yoki bloklang.

## 9. Tez-tez uchraydigan muammolar

| Belgi | Sabab va yechim |
|---|---|
| `ECONNREFUSED 5432` | PostgreSQL ishlamayapti — Services → postgresql ni yoqing |
| `password authentication failed` | `.env` dagi `DATABASE_URL` paroli noto'g'ri |
| `relation … does not exist` | `npm run migrate` ishlatilmagan |
| Testlar o'tkazib yuborildi (skipped) | `.env` da `TEST_DATABASE_URL` yo'q |
| Forma yuborilganda `403` | Sahifa eskirgan (CSRF) — yangilab qaytadan yuboring |
| Render: `Cannot find module` | Fayl commit qilinmagan — `git status` ni tekshiring |
