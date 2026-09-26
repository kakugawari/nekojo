/*
 * 天下統一の画面の見本 (art/realm-mock.png, 1536x1024) から、飾りの絵を切り出して img/r-*.png に置く。
 *
 *   node tools/extract-realm-ui.js      (要 playwright。ブラウザの canvas で処理する)
 *
 * 見本の絵は背景 (空・桜・紙) の上に描いてあるので、透明にするには背景を消す必要がある。
 * 1. 残したい物 (墨・金・濃い色) を「かべ」とみなし、枠のふちから、かべ以外をたどって塗る = 背景
 * 2. たどり着けなかった所 (かべと、かべに囲まれた白い字など) を残す
 * 3. 残った所のうち、いちばん大きな塊 (と、決めた大きさ以上の塊) だけを取る (遠くの山の影などを捨てる)
 * 4. ふちは 1px ぼかす
 *
 * 数字は見本の画素の位置。見本を差し替えたら測り直すこと。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art', 'realm-mock.png');
const OUT = path.join(ROOT, 'img');

// wall: 残す色の決まり (r, g, b → 残すなら true)。keepMin: この画素数より小さい塊は捨てる
const lum = 'var L = 0.299 * r + 0.587 * g + 0.114 * b;';
const gold = '(r > 150 && g > 105 && b < 140 && r - b > 55)';
const JOBS = [
  // 題字「天下統一 〜日本の国を ねこが制す〜」(桜と空の上)
  { name: 'r-title', box: [8, 18, 570, 172], wall: lum + ' return L < 115 || ' + gold + ';', keepMin: 4000 },
  // 「天下統一まであと 46 国」の帯 (桜の上)。字は消して、画面の字を重ねる
  { name: 'r-remain', box: [1010, 878, 526, 132], wall: lum + ' return L < 115 || ' + gold + ';', keepMin: 4000,
    erase: { box: [1156, 914, 324, 52] } },
  // 小判 (紙の上)
  { name: 'r-coin', box: [1150, 470, 72, 76], wall: 'return !(r > 200 && g > 190 && b > 150 && r - b < 75);', keepMin: 600 },
  // 経験値の猫 (紙の上の丸い札)
  { name: 'r-catcoin', box: [1333, 470, 72, 76], wall: 'return !(r > 200 && g > 190 && b > 150 && r - b < 75);', keepMin: 600 },
  // 交差した刀 (紙の上の黒い物)
  { name: 'r-swords', box: [1272, 252, 48, 48], wall: lum + ' return L < 160;', keepMin: 100 },
  // 「敵の強さ」「主な報酬」の墨の札
  { name: 'r-tag-strength', box: [1138, 250, 126, 46], wall: lum + ' return L < 120 || ' + gold + ';', keepMin: 500 },
  { name: 'r-tag-reward', box: [1136, 426, 142, 42], wall: lum + ' return L < 120 || ' + gold + ';', keepMin: 500 }
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
      // eslint-disable-next-line no-new-func
      const isWall = new Function('r', 'g', 'b', job.wall);
      const wall = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) wall[i] = isWall(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) ? 1 : 0;
      // 1. ふちから、かべ以外をたどる
      const bg = new Uint8Array(w * h);
      const q = [];
      const push = (i) => { if (!bg[i] && !wall[i]) { bg[i] = 1; q.push(i); } };
      for (let i = 0; i < w; i++) { push(i); push((h - 1) * w + i); }
      for (let j = 0; j < h; j++) { push(j * w); push(j * w + w - 1); }
      while (q.length) {
        const i = q.pop(), px = i % w, py = (i - px) / w;
        if (px > 0) push(i - 1); if (px < w - 1) push(i + 1);
        if (py > 0) push(i - w); if (py < h - 1) push(i + w);
      }
      // 3. 残った所の塊
      const lab = new Int32Array(w * h).fill(-1);
      const sizes = [];
      for (let i = 0; i < w * h; i++) {
        if (bg[i] || lab[i] >= 0) continue;
        const id = sizes.length; let n = 0; const st = [i]; lab[i] = id;
        while (st.length) {
          const k = st.pop(); n++;
          const px = k % w, py = (k - px) / w;
          const nb = [px > 0 ? k - 1 : -1, px < w - 1 ? k + 1 : -1, py > 0 ? k - w : -1, py < h - 1 ? k + w : -1];
          for (const m of nb) if (m >= 0 && !bg[m] && lab[m] < 0) { lab[m] = id; st.push(m); }
        }
        sizes.push(n);
      }
      const biggest = sizes.indexOf(Math.max.apply(null, sizes));
      const keep = (i) => lab[i] >= 0 && (lab[i] === biggest || sizes[lab[i]] >= job.keepMin);
      let kept = 0;
      for (let i = 0; i < w * h; i++) {
        if (!keep(i)) { d[i * 4 + 3] = 0; continue; }
        kept++;
        // 4. ふち (となりが背景) は半分透ける
        const px = i % w, py = (i - px) / w;
        const edge = (px > 0 && !keep(i - 1)) || (px < w - 1 && !keep(i + 1)) || (py > 0 && !keep(i - w)) || (py < h - 1 && !keep(i + w));
        if (edge) d[i * 4 + 3] = 140;
      }
      // 字を消す: 白っぽい字の画素を、まわりの墨の色で塗りつぶす
      if (job.erase) {
        const [ex, ey, ew, eh] = job.erase.box;
        const x0 = ex - x, y0 = ey - y;
        let sr = 0, sg = 0, sb = 0, sn = 0;
        for (let yy = y0; yy < y0 + eh; yy++) for (let xx = x0; xx < x0 + ew; xx++) {
          const i = (yy * w + xx) * 4; const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (L < 60 && d[i + 3] > 200) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; sn++; }
        }
        const ink = [sr / sn, sg / sn, sb / sn];
        for (let yy = y0; yy < y0 + eh; yy++) for (let xx = x0; xx < x0 + ew; xx++) {
          const i = (yy * w + xx) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          // 字のあった所は、金の線のほかは全部墨で塗る (字のふちの灰色が残らないように)
          if (d[i + 3] > 0 && !(r > 150 && g > 105 && b < 140 && r - b > 55)) {
            const n = ((xx * 7 + yy * 13) % 9) - 4; // 少しだけむらを残す (のっぺりしないように)
            d[i] = ink[0] + n; d[i + 1] = ink[1] + n; d[i + 2] = ink[2] + n;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      return { name: job.name, url: c.toDataURL('image/png'), kept: kept, pieces: sizes.filter((s) => s >= job.keepMin).length };
    });
  }, { data, jobs: JOBS });
  for (const r of results) {
    fs.writeFileSync(path.join(OUT, r.name + '.png'), Buffer.from(r.url.split(',')[1], 'base64'));
    console.log(r.name, '残した画素', r.kept, '塊', r.pieces);
  }
  await browser.close();
}

main();
