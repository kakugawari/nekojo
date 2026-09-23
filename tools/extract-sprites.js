/*
 * 設定資料 (art/character-sheet.png) から、ゲームで使う絵を切り出して img/ に置く。
 *
 *   node tools/extract-sprites.js      (要 playwright。ブラウザの canvas で処理する)
 *
 * やり方: 枠のふちから、クリーム色の地と近い色をたどって塗りつぶし、
 * たどれた所だけ透明にする。ねこの白い毛は輪郭線に囲まれているので消えない。
 * 地との色の差に応じて半透明にし (影や羽の軌跡のにじみが残る)、
 * 半透明の所は地の色を引き戻して、ふちにクリーム色が残らないようにする。
 *
 * 数字は設定資料の画素の位置 (1254x1254)。絵を差し替えたら測り直すこと。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art', 'character-sheet.png');
const OUT = path.join(ROOT, 'img');

// [x, y, w, h]。erase は枠の中で消したい所 ([x, y, w, h] 設定資料の座標)。
// eraseRight は [y, x] の点列 (輪郭の右端)。行ごとに x を補間して、それより右を消す
const SPRITES = {
  // 成長の過程
  'stage0': { box: [40, 688, 122, 162] },
  'stage1': { box: [192, 676, 136, 174], erase: [[188, 674, 30, 28]] },
  'stage2': { box: [362, 652, 206, 198], erase: [[535, 770, 33, 50]] },  // 右の「>」
  // お城を築く: 後ろにお城と木が描き込まれていて地の色では抜けないので、右の輪郭をなぞって外を消す
  'stage3': {
    box: [562, 626, 164, 224], erase: [[560, 676, 12, 26]],
    eraseRight: [[626, 664], [690, 664], [692, 680], [740, 680], [746, 693], [758, 682], [766, 690], [770, 708],
      [768, 718], [778, 724], [795, 721], [805, 706], [820, 702], [836, 696], [850, 688]]
  },
  // カラーバリエーション (敵や家臣に使う)
  'cat-normal': { box: [810, 682, 130, 168] },
  'cat-chatora': { box: [950, 682, 130, 168] },
  'cat-kuro': { box: [1092, 678, 132, 172] },
  // 戦い方
  'pose-jarashi': { box: [28, 958, 280, 174] },  // 上の見出し「戦い方」を避ける
  'pose-punch': { box: [298, 926, 254, 206], erase: [[298, 926, 16, 34]] },  // 見出しの「)」
  'pose-special': { box: [548, 910, 290, 232] },
  // 表情
  'face-normal': { box: [640, 398, 105, 142] },
  'face-smile': { box: [745, 398, 100, 142] },
  'face-serious': { box: [845, 398, 103, 142] },
  'face-surprised': { box: [948, 392, 97, 148] },
  'face-angry': { box: [1045, 398, 95, 142] },
  'face-shy': { box: [1140, 398, 95, 142] }
};

// 色味を変えて作る敵・家臣の見た目 (元の絵, canvas の filter)
const TINTS = {
  'cat-gray': { from: 'cat-chatora', filter: 'grayscale(0.92) brightness(1.08) contrast(1.05)' },
  'cat-red': { from: 'cat-kuro', filter: 'sepia(0.5) saturate(2.2) hue-rotate(-25deg) brightness(1.25)' }
};

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const src = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');

  const out = await page.evaluate(async ({ src, SPRITES, TINTS }) => {
    const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });

    function cut(spec) {
      const [bx, by, bw, bh] = spec.box;
      const c = document.createElement('canvas');
      c.width = bw; c.height = bh;
      const x = c.getContext('2d');
      x.drawImage(img, bx, by, bw, bh, 0, 0, bw, bh);
      const im = x.getImageData(0, 0, bw, bh);
      const d = im.data;

      // 地の色 = ふちの画素の中央値
      const border = [];
      for (let i = 0; i < bw; i++) { border.push(i, (bh - 1) * bw + i); }
      for (let j = 0; j < bh; j++) { border.push(j * bw, j * bw + bw - 1); }
      const med = [0, 1, 2].map((ch) => {
        const v = border.map((p) => d[p * 4 + ch]).sort((a, b) => a - b);
        return v[v.length >> 1];
      });
      const dist = (p) => Math.hypot(d[p * 4] - med[0], d[p * 4 + 1] - med[1], d[p * 4 + 2] - med[2]);

      const LO = 14; // これより地に近ければ完全に透明
      const HI = 58; // これより離れていれば不透明 (たどるのもここまで)
      const seen = new Uint8Array(bw * bh);
      const stack = [];
      for (const p of border) if (!seen[p] && dist(p) < HI) { seen[p] = 1; stack.push(p); }
      while (stack.length) {
        const p = stack.pop();
        const px = p % bw, py = (p / bw) | 0;
        const nb = [px > 0 ? p - 1 : -1, px < bw - 1 ? p + 1 : -1, py > 0 ? p - bw : -1, py < bh - 1 ? p + bw : -1];
        for (const q of nb) if (q >= 0 && !seen[q] && dist(q) < HI) { seen[q] = 1; stack.push(q); }
      }
      for (let p = 0; p < bw * bh; p++) {
        if (!seen[p]) continue;
        const t = Math.max(0, Math.min(1, (dist(p) - LO) / (HI - LO)));
        const a = t * t * (3 - 2 * t);
        if (a <= 0.01) { d[p * 4 + 3] = 0; continue; }
        for (let ch = 0; ch < 3; ch++) {
          d[p * 4 + ch] = Math.max(0, Math.min(255, (d[p * 4 + ch] - (1 - a) * med[ch]) / a));
        }
        d[p * 4 + 3] = Math.round(a * 255);
      }
      for (const [ex, ey, ew, eh] of (spec.erase || [])) {
        for (let yy = ey - by; yy < ey - by + eh; yy++) for (let xx = ex - bx; xx < ex - bx + ew; xx++) {
          if (xx >= 0 && yy >= 0 && xx < bw && yy < bh) d[(yy * bw + xx) * 4 + 3] = 0;
        }
      }
      if (spec.eraseRight) {
        const pts = spec.eraseRight;
        for (let yy = 0; yy < bh; yy++) {
          const sy = yy + by;
          let edge = pts[pts.length - 1][1];
          if (sy <= pts[0][0]) edge = pts[0][1];
          for (let i = 0; i < pts.length - 1; i++) {
            if (sy >= pts[i][0] && sy <= pts[i + 1][0]) {
              const t = (sy - pts[i][0]) / Math.max(1, pts[i + 1][0] - pts[i][0]);
              edge = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
              break;
            }
          }
          for (let xx = Math.ceil(edge - bx); xx < bw; xx++) if (xx >= 0) d[(yy * bw + xx) * 4 + 3] = 0;
        }
      }
      x.putImageData(im, 0, 0);

      // 透明でない所に合わせて詰める (2px の余白)
      let x0 = bw, y0 = bh, x1 = -1, y1 = -1;
      for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
        if (d[(yy * bw + xx) * 4 + 3] > 12) {
          if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
        }
      }
      x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(bw - 1, x1 + 2); y1 = Math.min(bh - 1, y1 + 2);
      const t = document.createElement('canvas');
      t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;
      t.getContext('2d').drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
      return t;
    }

    const canvases = {};
    const result = {};
    for (const [name, spec] of Object.entries(SPRITES)) {
      canvases[name] = cut(spec);
      result[name] = canvases[name].toDataURL('image/png');
    }
    for (const [name, spec] of Object.entries(TINTS)) {
      const s = canvases[spec.from];
      const c = document.createElement('canvas');
      c.width = s.width; c.height = s.height;
      const x = c.getContext('2d');
      x.filter = spec.filter;
      x.drawImage(s, 0, 0);
      result[name] = c.toDataURL('image/png');
    }
    return result;
  }, { src, SPRITES, TINTS });

  for (const [name, url] of Object.entries(out)) {
    const buf = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, name + '.png'), buf);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    console.log(`${name}.png  ${w}x${h}  ${(buf.length / 1024).toFixed(0)}KB`);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
