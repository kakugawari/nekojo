/*
 * 案内猫の設定資料 (art/guide-sheet.png, 1536x1024。背景はマゼンタ) から、ポーズごとの絵を切り出して img/guide-*.png に置く。
 *
 *   node tools/extract-guide.js      (要 playwright。ブラウザの canvas で処理する)
 *
 * 1. マゼンタ (赤と青が強く、緑が弱い) の画素を背景とみなして消す。足もとの影 (暗いマゼンタ) も同じく消える。
 *    猫の色 (茶・白・紺・肌の桃色) は緑が十分あるか赤が弱いので、マゼンタには入らない
 * 2. ふちの画素は、マゼンタらしさに応じて半透明にし、混ざったマゼンタを引き戻す (ふちが桃色ににじまないように)
 * 3. 枠の中で、いちばん大きな塊だけを残す (見出しの字・「♪」・きらめきの線を捨てる)。
 *    extra に書いた塊 (困りの汗) は、中心がその四角の中にあれば残す
 * 4. 余白を切り詰め、高さ 270px までに縮める (画面では 100px ほどで出すので、3 倍の画面でも足りる)
 *
 * 数字は設定資料の画素の位置。絵を差し替えたら測り直すこと。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art', 'guide-sheet.png');
const OUT = path.join(ROOT, 'img');

const JOBS = [
  { name: 'guide-main', box: [30, 240, 600, 730] },      // 大きな立ち姿 (手を差し出して、杖を持つ)
  { name: 'guide-stand', box: [660, 180, 330, 345] },    // 立ち絵
  { name: 'guide-walk', box: [1090, 160, 345, 380] },    // 歩き (地図を見ながら)
  { name: 'guide-hello', box: [540, 625, 270, 320] },    // 挨拶 (目を閉じて手を振る)
  { name: 'guide-cheer', box: [890, 620, 330, 330] },    // 応援 (杖をかかげる)
  { name: 'guide-worry', box: [1225, 620, 300, 330], extra: [[1440, 625, 40, 50]] }  // 困り (汗も残す)
];

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.error('playwright が要ります'); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const data = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');
  const results = await page.evaluate(async ({ data, jobs }) => {
    const im = new Image(); im.src = data; await im.decode();
    return jobs.map((job) => {
      const [x, y, w, h] = job.box;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(im, x, y, w, h, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      // 1-2. マゼンタらしさ m: 赤と青の小さい方から、緑を引いた量。70 以上は背景、30 以下は絵、その間は半透明
      const alpha = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        const m = Math.min(r, b) - g;
        const a = m >= 70 ? 0 : m <= 30 ? 1 : (70 - m) / 40;
        alpha[i] = a;
        if (a > 0 && a < 1) {
          // 混ざったマゼンタを引き戻す: 赤と青を緑のほうへ寄せる
          const k = 1 - a;
          d[i * 4] = r - (r - g) * k * 0.6;
          d[i * 4 + 2] = b - (b - g) * k * 0.6;
        }
      }
      // 3. 塊 (少しでも見える画素のつながり)
      const lab = new Int32Array(w * h).fill(-1);
      const comps = [];
      for (let i = 0; i < w * h; i++) {
        if (alpha[i] < 0.35 || lab[i] >= 0) continue;
        const id = comps.length; let n = 0, sx = 0, sy = 0; const st = [i]; lab[i] = id;
        while (st.length) {
          const k = st.pop(); n++;
          const px = k % w, py = (k - px) / w; sx += px; sy += py;
          if (px > 0 && lab[k - 1] < 0 && alpha[k - 1] >= 0.35) { lab[k - 1] = id; st.push(k - 1); }
          if (px < w - 1 && lab[k + 1] < 0 && alpha[k + 1] >= 0.35) { lab[k + 1] = id; st.push(k + 1); }
          if (py > 0 && lab[k - w] < 0 && alpha[k - w] >= 0.35) { lab[k - w] = id; st.push(k - w); }
          if (py < h - 1 && lab[k + w] < 0 && alpha[k + w] >= 0.35) { lab[k + w] = id; st.push(k + w); }
        }
        comps.push({ n: n, cx: x + sx / n, cy: y + sy / n });
      }
      let biggest = 0;
      comps.forEach((cp, k) => { if (cp.n > comps[biggest].n) biggest = k; });
      const keepId = new Uint8Array(comps.length);
      keepId[biggest] = 1;
      (job.extra || []).forEach(([ex, ey, ew, eh]) => comps.forEach((cp, k) => {
        if (cp.n >= 30 && cp.cx >= ex && cp.cx <= ex + ew && cp.cy >= ey && cp.cy <= ey + eh) keepId[k] = 1;
      }));
      // 半透明のふち (0.35 未満) は、となりに残す塊があれば残す
      const keep = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) if (lab[i] >= 0 && keepId[lab[i]]) keep[i] = 1;
      for (let i = 0; i < w * h; i++) {
        if (keep[i] || alpha[i] <= 0) continue;
        const px = i % w, py = (i - px) / w;
        const nb = (px > 0 && keep[i - 1] === 1) || (px < w - 1 && keep[i + 1] === 1) || (py > 0 && keep[i - w] === 1) || (py < h - 1 && keep[i + w] === 1);
        if (nb) keep[i] = 2;
      }
      let x0 = w, y0 = h, x1 = -1, y1 = -1, kept = 0;
      for (let i = 0; i < w * h; i++) {
        if (!keep[i]) { d[i * 4 + 3] = 0; continue; }
        d[i * 4 + 3] = Math.round(255 * alpha[i]);
        kept++;
        const px = i % w, py = (i - px) / w;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      ctx.putImageData(img, 0, 0);
      // 枠のふちに絵が触れていたら、枠が狭すぎる (絵が切れている)
      const touches = [x0 === 0 && 'left', y0 === 0 && 'top', x1 === w - 1 && 'right', y1 === h - 1 && 'bottom'].filter(Boolean);
      // 4. 余白を切り詰める (2px 残す)
      const P = 2;
      const cx0 = Math.max(0, x0 - P), cy0 = Math.max(0, y0 - P), cw = Math.min(w, x1 + P + 1) - cx0, ch = Math.min(h, y1 + P + 1) - cy0;
      let o = document.createElement('canvas'); o.width = cw; o.height = ch;
      o.getContext('2d').drawImage(c, cx0, cy0, cw, ch, 0, 0, cw, ch);
      // 半分ずつ縮める (一度に縮めると線がざらつく)
      const MAX_H = 270;
      while (o.height > MAX_H) {
        const nh = Math.max(MAX_H, Math.round(o.height / 2)), nw = Math.round(o.width * nh / o.height);
        const s2 = document.createElement('canvas'); s2.width = nw; s2.height = nh;
        const sx = s2.getContext('2d'); sx.imageSmoothingQuality = 'high';
        sx.drawImage(o, 0, 0, nw, nh);
        o = s2;
      }
      const dropped = comps.filter((cp, k) => !keepId[k] && cp.n >= 200).map((cp) => cp.n + '@' + Math.round(cp.cx) + ',' + Math.round(cp.cy));
      return { name: job.name, url: o.toDataURL('image/png'), size: o.width + 'x' + o.height, kept: kept, touches: touches, dropped: dropped };
    });
  }, { data, jobs: JOBS });
  for (const r of results) {
    fs.writeFileSync(path.join(OUT, r.name + '.png'), Buffer.from(r.url.split(',')[1], 'base64'));
    console.log(r.name, r.size, '残した画素', r.kept, r.touches.length ? '★枠に触れている: ' + r.touches.join(',') : '', '捨てた大きな塊', r.dropped.join(' '));
  }
  await browser.close();
}

main();
