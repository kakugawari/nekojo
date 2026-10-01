/*
 * 城のパーツの絵 (art/castle-parts.png, 1536x1024。背景はマゼンタ) から、土台・建物・天守を 1 つずつ切り出して
 * img/c-<名前>.webp に置く。
 *
 *   node tools/extract-castle-parts.js      (要 playwright。ブラウザの canvas で処理する)
 *
 * 1. 背景の色 (四隅の真ん中の値) からの距離で抜く: 60 以下は背景、110 以上は絵、その間は半透明 (ボスと同じ)。
 *    半透明の所は、混ざった背景の色を引いて元の色に戻す
 * 2. 字の札 (絵の下の濃い紫の札 R85 G2 B105 ほど。緑がほぼ 0) を色で見つけ、札の四角ごと (中の白い字も) 消す。
 *    札が絵にくっついていて、同じ塊になっていた (池のある土台・橋・池・太鼓櫓)
 * 3. つながった塊に分け、塊の真ん中 (重心) が PARTS の四角の中にある物を、その絵として拾う。
 *    横に長い枠 (見出しのまわりの白い線) は幅 600px 超、細い線 (高さ 4px 以下) は捨てる。
 *    いちばん大きな塊から離れた小さな塊・白っぽい小さな塊 (300 画素未満) は、近くの説明の字なので捨てる
 * 4. 拾った塊の外の画素は消し、余白を切り詰めて WebP (品質 0.9) で書き出す。大きさはそのまま (縮めない)
 *
 * 四角は元の絵の画素の位置。絵を差し替えたら測り直すこと (書き出す見本で、絵が切れていないか・字が入っていないかを見る)。
 * 「金のシャチホコ 特別バージョン」は紺の札の上に描いてあるので、ここでは切り出さない。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art', 'castle-parts.png');
const OUT = path.join(ROOT, 'img');

// [名前, x0, y0, x1, y1] (重心がこの中にある塊を拾う)
const PARTS = [
  // 城の土台
  ['base', 245, 35, 545, 205], ['base-step', 555, 25, 905, 208], ['base-pond', 912, 40, 1195, 208], ['base-cross', 1200, 20, 1525, 208],
  ['road', 30, 235, 295, 393], ['road-curve', 325, 255, 540, 393], ['stairs', 560, 255, 790, 393], ['bridge', 810, 260, 1025, 393],
  ['pond', 1035, 250, 1260, 393], ['garden', 1270, 240, 1500, 393],
  // 城パーツ
  ['gate', 275, 455, 422, 582], ['yagura', 432, 445, 532, 582], ['barracks', 556, 455, 703, 582], ['storehouse', 705, 455, 835, 582],
  ['ricehouse', 846, 455, 982, 582], ['smithy', 986, 455, 1132, 582], ['merchant', 1140, 455, 1295, 582], ['drum', 1322, 445, 1455, 582],
  ['archery', 50, 612, 214, 730], ['stable', 216, 612, 364, 730], ['dojo', 370, 612, 536, 730], ['workshop', 540, 612, 680, 730],
  ['teahouse', 682, 612, 810, 730], ['sakura', 815, 608, 910, 730], ['bamboo', 920, 605, 1010, 730], ['field', 1014, 612, 1160, 730],
  ['nobori', 1166, 612, 1245, 730], ['fence', 1250, 612, 1355, 715],
  // 天守
  ['keep-normal', 160, 830, 292, 972], ['keep-gold', 292, 805, 428, 972], ['keep-sakura', 424, 805, 562, 972], ['keep-white', 560, 810, 702, 972],
  ['keep-black', 700, 810, 842, 972], ['keep-blue', 838, 810, 978, 972], ['keep-red', 972, 805, 1112, 972], ['keep-moon', 1098, 795, 1250, 972]
];

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.error('playwright が要ります'); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const data = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');
  const out = await page.evaluate(async ({ data, PARTS }) => {
    const im = new Image(); im.src = data; await im.decode();
    const W = im.width, H = im.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const samp = [[], [], []];
    for (const [cx, cy] of [[4, 40], [W - 24, 4], [4, H - 24], [W - 24, H - 24]]) {
      for (let y = cy; y < cy + 20; y++) for (let x = cx; x < cx + 20; x++) { const i = (y * W + x) * 4; for (let k = 0; k < 3; k++) samp[k].push(d[i + k]); }
    }
    const bg = samp.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
    const alpha = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2];
      const dist = Math.hypot(R - bg[0], G - bg[1], B - bg[2]);
      const a = dist <= 60 ? 0 : dist >= 110 ? 1 : (dist - 60) / 50;
      alpha[i] = a;
      if (a > 0.05 && a < 1) {
        d[i * 4] = Math.max(0, Math.min(255, (R - (1 - a) * bg[0]) / a));
        d[i * 4 + 1] = Math.max(0, Math.min(255, (G - (1 - a) * bg[1]) / a));
        d[i * 4 + 2] = Math.max(0, Math.min(255, (B - (1 - a) * bg[2]) / a));
      }
    }
    // 字の札を消す: 札の色の画素の塊のうち、札の形 (幅 50px 以上・高さ 18〜40px) の物の四角
    const isPill = (i) => d[i * 4 + 1] < 14 && d[i * 4] > 60 && d[i * 4] < 115 && d[i * 4 + 2] > 85 && d[i * 4 + 2] < 135;
    const seen = new Uint8Array(W * H);
    let pills = 0;
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || !isPill(i)) continue;
      const st = [i]; seen[i] = 1; let x0 = W, y0 = H, x1 = 0, y1 = 0;
      while (st.length) {
        const k = st.pop(); const px = k % W, py = (k - px) / W;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        for (const m of [px > 0 ? k - 1 : -1, px < W - 1 ? k + 1 : -1, k - W, k + W]) if (m >= 0 && m < W * H && !seen[m] && isPill(m)) { seen[m] = 1; st.push(m); }
      }
      if (x1 - x0 >= 50 && y1 - y0 >= 18 && y1 - y0 <= 40) {
        pills++;
        for (let y = Math.max(0, y0 - 2); y <= Math.min(H - 1, y1 + 2); y++) for (let x = Math.max(0, x0 - 2); x <= Math.min(W - 1, x1 + 2); x++) alpha[y * W + x] = 0;
      }
    }
    const lab = new Int32Array(W * H).fill(-1);
    const comps = [];
    for (let i = 0; i < W * H; i++) {
      if (alpha[i] < 0.35 || lab[i] >= 0) continue;
      const id = comps.length; const st = [i]; lab[i] = id;
      let n = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, lum = 0;
      while (st.length) {
        const k = st.pop(); n++;
        const px = k % W, py = (k - px) / W;
        sx += px; sy += py; lum += (d[k * 4] + d[k * 4 + 1] + d[k * 4 + 2]) / 3;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (px > 0 && lab[k - 1] < 0 && alpha[k - 1] >= 0.35) { lab[k - 1] = id; st.push(k - 1); }
        if (px < W - 1 && lab[k + 1] < 0 && alpha[k + 1] >= 0.35) { lab[k + 1] = id; st.push(k + 1); }
        if (py > 0 && lab[k - W] < 0 && alpha[k - W] >= 0.35) { lab[k - W] = id; st.push(k - W); }
        if (py < H - 1 && lab[k + W] < 0 && alpha[k + W] >= 0.35) { lab[k + W] = id; st.push(k + W); }
      }
      comps.push({ n, cx: sx / n, cy: sy / n, x0, y0, x1, y1, lum: lum / n });
    }
    const owner = new Int32Array(W * H).fill(-1);
    for (let i = 0; i < W * H; i++) if (lab[i] >= 0) owner[i] = lab[i];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < W * H; i++) {
        if (owner[i] >= 0 || alpha[i] <= 0) continue;
        const px = i % W;
        for (const m of [px > 0 ? i - 1 : -1, px < W - 1 ? i + 1 : -1, i - W, i + W]) if (m >= 0 && m < W * H && owner[m] >= 0) { owner[i] = owner[m]; break; }
      }
    }
    ctx.putImageData(img, 0, 0);
    const parts = PARTS.map(([name, bx0, by0, bx1, by1]) => {
      const keep = new Set();
      comps.forEach((cp, k) => {
        if (cp.n < 25 || cp.x1 - cp.x0 > 600 || cp.y1 - cp.y0 <= 4) return;
        if (cp.cx >= bx0 && cp.cx <= bx1 && cp.cy >= by0 && cp.cy <= by1) keep.add(k);
      });
      // いちばん大きな塊から離れた小さな塊 (説明の字など) は捨てる
      let main = -1; keep.forEach((k) => { if (main < 0 || comps[k].n > comps[main].n) main = k; });
      if (main >= 0) {
        const M = comps[main];
        [...keep].forEach((k) => {
          const cp = comps[k];
          const near = cp.x1 >= M.x0 - 4 && cp.x0 <= M.x1 + 4 && cp.y1 >= M.y0 - 4 && cp.y0 <= M.y1 + 4;
          // 説明の字は白い (天守の四角の中にかかっていた)
          if (k !== main && cp.n < 300 && (!near || cp.lum > 200)) keep.delete(k);
        });
      }
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      keep.forEach((k) => { const cp = comps[k]; x0 = Math.min(x0, cp.x0); y0 = Math.min(y0, cp.y0); x1 = Math.max(x1, cp.x1); y1 = Math.max(y1, cp.y1); });
      const P = 2;
      x0 = Math.max(0, x0 - P); y0 = Math.max(0, y0 - P); x1 = Math.min(W - 1, x1 + P); y1 = Math.min(H - 1, y1 + P);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const cut = document.createElement('canvas'); cut.width = cw; cut.height = ch;
      const cc = cut.getContext('2d');
      const part = ctx.getImageData(x0, y0, cw, ch);
      for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
        const gi = (y0 + yy) * W + (x0 + xx), li = (yy * cw + xx) * 4;
        part.data[li + 3] = owner[gi] >= 0 && keep.has(owner[gi]) ? Math.round(255 * alpha[gi]) : 0;
      }
      cc.putImageData(part, 0, 0);
      // 四角のふちに拾った塊が触れていたら、四角が狭い (絵が切れているか、となりの絵が入っている)
      const touch = [...keep].some((k) => { const cp = comps[k]; return cp.x0 <= bx0 - 30 || cp.x1 >= bx1 + 30 || cp.y0 <= by0 - 30 || cp.y1 >= by1 + 40; });
      return { name, url: cut.toDataURL('image/webp', 0.9), w: cw, h: ch, pieces: keep.size, touch, src: [x0, y0, cw, ch] };
    });
    return { parts, pills };
  }, { data, PARTS });
  console.log('消した字の札', out.pills);
  const res = out.parts;
  const meta = {};
  for (const r of res) {
    fs.writeFileSync(path.join(OUT, 'c-' + r.name + '.webp'), Buffer.from(r.url.split(',')[1], 'base64'));
    meta[r.name] = { w: r.w, h: r.h };
    console.log(r.name.padEnd(12), r.w + 'x' + r.h, '塊 ' + r.pieces, r.touch ? '★四角のふちから大きくはみ出す塊がある' : '', '元 ' + r.src.join(','));
  }
  // 目で確かめる見本
  const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#cfe3c8;font:12px sans-serif;display:flex;flex-wrap:wrap;gap:6px;padding:6px">' +
    res.map((r) => '<div style="background:#e9dfc8;padding:4px;text-align:center"><img src="' + r.url + '" style="display:block;max-width:300px"><span>' + r.name + '</span></div>').join('') + '</body>';
  const previewPath = process.env.PARTS_PREVIEW || path.join(require('node:os').tmpdir(), 'castle-parts.html');
  fs.writeFileSync(previewPath, html);
  console.log('見本:', previewPath);
  await browser.close();
}

main();
