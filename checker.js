// Фото-чекап: читає файли локально, зменшує до 320 px і віддає в PhotoCore.
(function () {
  'use strict';
  var C = window.PhotoCore;
  var input = document.getElementById('files');
  var drop = document.getElementById('drop');
  var MAX = 30, SIDE = 320;

  input.addEventListener('change', function () { run(input.files); });
  ['dragenter', 'dragover'].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (ev) { run(ev.dataTransfer.files); });

  function load(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Не вдалося відкрити ' + file.name)); };
      img.src = url;
    });
  }

  function measure(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var k = Math.min(1, SIDE / Math.max(w, h));
    var cw = Math.max(8, Math.round(w * k)), ch = Math.max(8, Math.round(h * k));
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    return C.analyze(ctx.getImageData(0, 0, cw, ch), { width: w, height: h });
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  async function run(fileList) {
    var files = Array.prototype.filter.call(fileList || [], function (f) { return /^image\//.test(f.type); }).slice(0, MAX);
    if (!files.length) return;
    var photos = document.getElementById('photos');
    photos.innerHTML = '';
    var results = [];
    for (var i = 0; i < files.length; i++) {
      try {
        var r = await load(files[i]);
        var metrics = measure(r.img);
        var issues = C.review(metrics);
        results.push({ metrics: metrics, issues: issues });
        var score = C.photoScore(issues);
        var li = issues.length ? issues.map(function (it) {
          return '<li class="' + (it.level === 'warn' ? 'warn' : '') + '">' + esc(it.text) + '<span class="fix">' + esc(it.fix) + '</span></li>';
        }).join('') : '<li>Добре фото — так і лишай.</li>';
        var el = document.createElement('div');
        el.className = 'photo';
        el.setAttribute('data-testid', 'photo-card');
        el.innerHTML = '<img alt="" src="' + r.url + '"><div class="body"><span class="badge">' + score + '</span><strong>Фото ' + (i + 1) + (i === 0 ? ' · обкладинка' : '') + '</strong><div class="muted" style="font-size:13px">' + metrics.width + '×' + metrics.height + ' px</div><ul>' + li + '</ul></div>';
        photos.appendChild(el);
      } catch (e) {
        var bad = document.createElement('div'); bad.className = 'photo';
        bad.innerHTML = '<div class="body">' + esc(e.message) + '</div>';
        photos.appendChild(bad);
      }
    }
    var s = C.summarize(results);
    document.getElementById('score').textContent = s.score;
    var tips = s.tips.length ? s.tips : ['Фото в хорошому стані. Порожні кімнати можна ще й віртуально мебльувати.'];
    document.getElementById('tips').innerHTML = tips.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
    document.getElementById('result').hidden = false;
    document.getElementById('result').scrollIntoView({ block: 'start' });
  }
})();
