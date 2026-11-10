// Kichik yaxshilanishlar: sahifalar JavaScript siz ham to'liq ishlaydi.
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  var MAX_HAJM = 5 * 1024 * 1024;

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

  // Rasmlar: soni va hajmini oldindan tekshirish, kichik ko'rinish
  document.querySelectorAll('input[type="file"][data-max]').forEach(function (input) {
    var max = Number(input.dataset.max) || 3;
    var box = input.closest('form').querySelector('[data-previews]');
    var label = input.closest('.upload');
    var asl = label ? label.querySelector('span').textContent : '';
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      var xato = '';
      if (files.length > max) xato = "Ko'pi bilan " + max + ' ta rasm tanlang';
      files.forEach(function (f) {
        if (!/^image\/(jpeg|png)$/.test(f.type)) xato = 'Faqat JPG yoki PNG rasm';
        else if (f.size > MAX_HAJM) xato = f.name + ': 5 MB dan katta';
      });
      input.setCustomValidity(xato);
      if (xato) input.reportValidity();
      if (label) label.querySelector('span').textContent = files.length ? files.length + ' ta rasm tanlandi' : asl;
      if (!box) return;
      box.innerHTML = '';
      files.slice(0, max).forEach(function (f) {
        var fig = document.createElement('figure');
        var img = document.createElement('img');
        img.alt = '';
        img.src = URL.createObjectURL(f);
        img.onload = function () { URL.revokeObjectURL(img.src); };
        var cap = document.createElement('figcaption');
        cap.textContent = f.name;
        fig.appendChild(img);
        fig.appendChild(cap);
        box.appendChild(fig);
      });
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
