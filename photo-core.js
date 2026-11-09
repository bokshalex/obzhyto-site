// Ядро фото-чекапу оголошення. Чисті функції без DOM — працюють у браузері й у Node (тести).
// Усе рахується локально: фото нікуди не відправляються.
(function (root) {
  'use strict';

  const LIMITS = {
    minWidth: 1280,          // DIM.RIA/OLX стискають, але менше 1280 px по ширині — помітно мило
    darkMean: 85,            // середня яскравість (0–255) нижче — темне фото
    brightMean: 205,         // вище — пересвічене
    clipPct: 0.18,           // частка майже чорних/білих пікселів, що вже «вигоріли»
    lowContrast: 38,         // стандартне відхилення яскравості
    blurVar: 60,             // дисперсія лапласіана (на зменшеному фото) нижче — розмито
    emptyEdges: 0.06,        // частка «країв» нижче — схоже на порожню кімнату
    castDelta: 22,           // різниця середніх R і B — жовте/синє світло
    minPhotos: 8
  };

  // Яскравість пікселя (BT.601)
  function luma(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  // imageData: { width, height, data: Uint8ClampedArray RGBA } — бажано вже зменшене до ~320 px
  // original: { width, height } — розмір файлу до зменшення
  function analyze(imageData, original) {
    const { width: w, height: h, data } = imageData;
    const n = w * h;
    const gray = new Float32Array(n);
    let sum = 0, sumSq = 0, dark = 0, bright = 0, rSum = 0, bSum = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const y = luma(r, g, b);
      gray[i] = y; sum += y; sumSq += y * y; rSum += r; bSum += b;
      if (y < 16) dark++;
      if (y > 245) bright++;
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));

    // Лапласіан 4-сусідів: дисперсія = різкість, частка сильних відгуків = «наповненість» кадру
    let lSum = 0, lSq = 0, edges = 0, m = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
        lSum += l; lSq += l * l; m++;
        if (Math.abs(l) > 24) edges++;
      }
    }
    const lMean = m ? lSum / m : 0;
    const sharpness = m ? lSq / m - lMean * lMean : 0;

    const ow = (original && original.width) || w;
    const oh = (original && original.height) || h;
    return {
      width: ow,
      height: oh,
      landscape: ow >= oh,
      brightness: round(mean),
      contrast: round(std),
      darkPct: round(dark / n, 3),
      brightPct: round(bright / n, 3),
      sharpness: round(sharpness),
      edgeDensity: round(m ? edges / m : 0, 3),
      cast: round((rSum - bSum) / n)
    };
  }

  // Перелік зауважень до одного фото. code — для тестів, text — для людини.
  function review(mx) {
    const issues = [];
    const add = (code, level, text, fix) => issues.push({ code, level, text, fix });
    if (mx.width < LIMITS.minWidth)
      add('small', 'warn', `Мале фото: ${mx.width}×${mx.height} px.`, 'Знімай у повній роздільності, без пересилання через месенджер.');
    if (!mx.landscape)
      add('portrait', 'info', 'Вертикальне фото — у стрічці оголошень його обріжуть.', 'Тримай телефон горизонтально.');
    if (mx.brightness < LIMITS.darkMean || mx.darkPct > LIMITS.clipPct)
      add('dark', 'warn', 'Темне фото — кімната виглядає меншою й похмурою.', 'Увімкни все світло, знімай удень; або виправимо світло за тебе.');
    if (mx.brightness > LIMITS.brightMean || mx.brightPct > LIMITS.clipPct)
      add('bright', 'warn', 'Пересвічено — вікна й стіни «вигоріли».', 'Знімай спиною до вікна або в режимі HDR.');
    if (mx.contrast < LIMITS.lowContrast)
      add('flat', 'info', 'Плоска картинка без контрасту.', 'Легка корекція кольору це виправить.');
    if (mx.sharpness < LIMITS.blurVar)
      add('blur', 'warn', 'Схоже на розмите фото.', 'Протри камеру й зніми ще раз, спираючись на стіну.');
    if (Math.abs(mx.cast) > LIMITS.castDelta)
      add('cast', 'info', mx.cast > 0 ? 'Жовте світло — інтерʼєр виглядає старим.' : 'Синюватий відтінок — кімната здається холодною.', 'Вимкни теплі лампи або виправимо баланс білого.');
    if (mx.edgeDensity < LIMITS.emptyEdges && mx.sharpness >= LIMITS.blurVar)
      add('empty', 'stage', 'Схоже на порожню кімнату — покупцю важко уявити, як тут жити.', 'Кандидат на віртуальне мебльовання.');
    return issues;
  }

  function photoScore(issues) {
    let s = 100;
    for (const it of issues) s -= it.level === 'warn' ? 22 : it.level === 'stage' ? 12 : 8;
    return Math.max(0, s);
  }

  // Підсумок по всьому оголошенню
  function summarize(results) {
    const count = results.length;
    const tips = [];
    if (count === 0) return { score: 0, count, stageCandidates: 0, tips: ['Додай хоча б одне фото.'] };
    const scores = results.map(r => photoScore(r.issues));
    let score = Math.round(scores.reduce((a, b) => a + b, 0) / count);
    if (count < LIMITS.minPhotos) {
      score = Math.max(0, score - (LIMITS.minPhotos - count) * 3);
      tips.push(`Лише ${count} фото. Оголошення з ${LIMITS.minPhotos}+ фото переглядають довше — додай кухню, санвузол, вид з вікна, під'їзд.`);
    }
    const landscape = results.filter(r => r.metrics.landscape).length;
    if (landscape === 0) tips.push('Жодного горизонтального фото — перше фото краще зробити горизонтальним.');
    if (results[0] && results[0].issues.some(i => i.level === 'warn')) tips.push('Перше фото — обкладинка оголошення. Постав першим найсвітліше й найчіткіше.');
    const stageCandidates = results.filter(r => r.issues.some(i => i.code === 'empty')).length;
    if (stageCandidates) tips.push(`${stageCandidates} фото схожі на порожні кімнати — віртуальне мебльовання допоможе покупцю уявити простір. Оригінали лишай в оголошенні.`);
    return { score, count, stageCandidates, tips };
  }

  function round(x, d = 1) { const k = Math.pow(10, d); return Math.round(x * k) / k; }

  const api = { LIMITS, analyze, review, photoScore, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhotoCore = api;
})(typeof self !== 'undefined' ? self : this);
