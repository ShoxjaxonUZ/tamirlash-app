// Kichik yaxshilanishlar: sahifalar JavaScript siz ham to'liq ishlaydi.
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  // 1-bosqich: bino va qavat bo'yicha xonalarni saralash, xona tanlanganda avtomatik davom etish
  document.querySelectorAll('[data-xona-tanlash]').forEach(function (form) {
    var bino = form.querySelector('[data-filtr="bino"]');
    var qavat = form.querySelector('[data-filtr="qavat"]');
    var xona = form.querySelector('[data-xona]');
    if (!bino || !qavat || !xona) return;
    var options = Array.prototype.slice.call(xona.options, 1);

    function qavatlar() {
      var tanlangan = qavat.value;
      var set = {};
      options.forEach(function (o) {
        if (!bino.value || o.dataset.bino === bino.value) set[o.dataset.qavat] = true;
      });
      var royxat = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
      qavat.length = 1;
      royxat.forEach(function (q) {
        var o = new Option(q + '-qavat', String(q));
        qavat.add(o);
      });
      qavat.value = royxat.indexOf(Number(tanlangan)) >= 0 ? tanlangan : '';
    }
    function saralash() {
      var korinadi = 0;
      options.forEach(function (o) {
        var mos = (!bino.value || o.dataset.bino === bino.value) && (!qavat.value || o.dataset.qavat === qavat.value);
        o.hidden = !mos;
        o.disabled = !mos;
        if (mos) korinadi += 1;
      });
      if (xona.selectedOptions[0] && xona.selectedOptions[0].disabled) xona.value = '';
      xona.options[0].text = korinadi ? '— tanlang (' + korinadi + ') —' : 'Xona topilmadi';
    }
    bino.addEventListener('change', function () { qavatlar(); saralash(); });
    qavat.addEventListener('change', saralash);
    xona.addEventListener('change', function () { if (xona.value) form.submit(); });
    qavatlar();
  });

  // Jihoz tanlansa, turini alohida tanlash shart emas
  document.querySelectorAll('[data-jihoz]').forEach(function (sel) {
    var tur = document.querySelector('[data-tur]');
    if (!tur) return;
    function yangila() { tur.hidden = Boolean(sel.value); }
    sel.addEventListener('change', yangila);
    yangila();
  });

  // Tavsif uzunligi
  document.querySelectorAll('[data-sanagich]').forEach(function (ta) {
    var matn = ta.parentElement.querySelector('[data-sanagich-matn]');
    if (!matn) return;
    function yangila() {
      var n = ta.value.trim().length;
      matn.textContent = n < 10 ? 'Yana kamida ' + (10 - n) + ' belgi' : n + ' / 2000';
    }
    ta.addEventListener('input', yangila);
    yangila();
  });

  // Rasmlar: "Suratga olish" (kamera) va "Galereyadan tanlash". Telefon kamerasining 5–15 MB li surati
  // yuborishdan oldin shu yerda kichraytiriladi (uzun tomoni 1600px, JPEG) va yashirin maydonga yig'iladi.
  // JS siz: ikkala tugma ham to'g'ridan-to'g'ri yuboriladi (server hajm va turini tekshiradi).
  var UZUN_TOMON = 1600;

  function rasmniOch(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return imgOrqali(file); });
    }
    return imgOrqali(file);
  }
  function imgOrqali(file) {
    return new Promise(function (ok, xato) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); xato(new Error('ochilmadi')); };
      img.src = url;
    });
  }
  function kichrayt(file) {
    return rasmniOch(file).then(function (rasm) {
      var w = rasm.width;
      var h = rasm.height;
      var k = Math.min(1, UZUN_TOMON / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      canvas.getContext('2d').drawImage(rasm, 0, 0, canvas.width, canvas.height);
      if (rasm.close) rasm.close();
      return new Promise(function (ok, xato) {
        canvas.toBlob(function (blob) {
          if (!blob) return xato(new Error('saqlanmadi'));
          var nom = (file.name || 'rasm').replace(/\.[^.]+$/, '') + '.jpg';
          ok(new File([blob], nom, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.85);
      });
    });
  }

  var dtBor = (function () {
    try { return Boolean(new DataTransfer().files); } catch (e) { return false; }
  })();

  document.querySelectorAll('[data-rasmlar]').forEach(function (blok) {
    var max = Number(blok.dataset.max) || 3;
    var kamera = blok.querySelector('[data-kamera]');
    var galereya = blok.querySelector('[data-galereya]');
    var yuborish = blok.querySelector('[data-yuboriladi]');
    var box = blok.querySelector('[data-previews]');
    var xabar = blok.querySelector('[data-rasm-xabar]');
    var form = blok.closest('form');
    var asl = xabar.textContent;
    var tanlangan = [];
    var jarayonda = 0;

    // Kompyuterda (sichqoncha) kamera tugmasi kerak emas — "capture" u yerda ishlamaydi
    if (window.matchMedia && !window.matchMedia('(pointer: coarse)').matches) {
      blok.querySelector('[data-kamera-tugma]').hidden = true;
      blok.querySelector('[data-galereya-matn]').textContent = 'Rasm tanlash';
    }
    if (!dtBor) return; // eski brauzer: oddiy yuborish

    kamera.removeAttribute('name');
    galereya.removeAttribute('name');
    yuborish.name = 'rasmlar';
    yuborish.disabled = false;

    function yangila(matn) {
      var dt = new DataTransfer();
      tanlangan.forEach(function (f) { dt.items.add(f); });
      yuborish.files = dt.files;
      xabar.textContent = matn || (tanlangan.length ? tanlangan.length + ' / ' + max + ' ta rasm' : asl);
      form.querySelectorAll('button[type="submit"]').forEach(function (b) { b.disabled = jarayonda > 0; });
      box.innerHTML = '';
      tanlangan.forEach(function (f, i) {
        var fig = document.createElement('figure');
        var img = document.createElement('img');
        img.alt = 'Tanlangan rasm ' + (i + 1);
        img.src = URL.createObjectURL(f);
        img.onload = function () { URL.revokeObjectURL(img.src); };
        var och = document.createElement('button');
        och.type = 'button';
        och.className = 'rasm-ochir';
        och.setAttribute('aria-label', 'Rasmni olib tashlash');
        och.textContent = '×';
        och.addEventListener('click', function () {
          tanlangan.splice(i, 1);
          yangila();
        });
        fig.appendChild(img);
        fig.appendChild(och);
        box.appendChild(fig);
      });
    }

    function qosh(input) {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      var joy = max - tanlangan.length - jarayonda;
      if (files.length > joy) {
        files = files.slice(0, Math.max(0, joy));
        yangila("Ko'pi bilan " + max + ' ta rasm — ortiqchasi olinmadi');
      }
      files.forEach(function (f) {
        jarayonda += 1;
        yangila('Rasm tayyorlanmoqda…');
        kichrayt(f)
          .then(function (tayyor) {
            tanlangan.push(tayyor);
            jarayonda -= 1;
            yangila();
          })
          .catch(function () {
            jarayonda -= 1;
            yangila(f.name + ": bu rasmni o'qib bo'lmadi — JPG yoki PNG tanlang");
          });
      });
    }

    kamera.addEventListener('change', function () { qosh(kamera); });
    galereya.addEventListener('change', function () { qosh(galereya); });
    form.addEventListener('submit', function (e) {
      if (jarayonda > 0) {
        e.preventDefault();
        xabar.textContent = 'Rasm hali tayyorlanmoqda — bir soniya kuting';
      }
    });
  });

  // Foydalanuvchi formasi: mutaxassislik faqat usta uchun
  document.querySelectorAll('[data-rol-forma]').forEach(function (form) {
    var rol = form.querySelector('[data-rol]');
    var maydon = form.querySelector('[data-usta-maydon]');
    if (!rol || !maydon) return;
    function yangila() { maydon.hidden = rol.value !== 'usta'; }
    rol.addEventListener('change', yangila);
    yangila();
  });

  // Filtrlar: tanlov o'zgarganda darhol ko'rsatish
  document.querySelectorAll('form[data-avto-yubor]').forEach(function (form) {
    form.querySelectorAll('select, input[type="checkbox"]').forEach(function (el) {
      el.addEventListener('change', function () { form.requestSubmit ? form.requestSubmit() : form.submit(); });
    });
  });

  // Tasdiqlash so'raladigan amallar (CSP inline skriptga ruxsat bermaydi — shu yerda)
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.dataset.tasdiq && !window.confirm(form.dataset.tasdiq)) {
      e.preventDefault();
      return;
    }
    if (e.defaultPrevented) return;
    // Ikki marta yuborishning oldini olish (GET filtrlaridan tashqari)
    if ((form.method || '').toLowerCase() === 'post') {
      var btn = e.submitter || form.querySelector('button[type="submit"]');
      if (btn) {
        setTimeout(function () { btn.disabled = true; }, 0);
        setTimeout(function () { btn.disabled = false; }, 8000);
      }
    }
  });

  document.querySelectorAll('[data-chop]').forEach(function (b) {
    b.addEventListener('click', function () { window.print(); });
  });
})();
