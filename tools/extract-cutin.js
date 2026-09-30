/*
 * 特大猫パンチのカットインの絵 (art/cutin-sheet.png, 1774x887。背景はマゼンタ) から、背景を抜いて img/cutin-punch.png に置く。
 *
 *   node tools/extract-cutin.js      (要 playwright。ブラウザの canvas で処理する)
 *
 * 絵には主人公・光のすじ・肉球・「特大猫パンチ!」の墨の帯と字がいっしょに描いてある。
 * 案内猫と同じく、マゼンタらしさ m (赤と青の小さい方 − 緑) で抜く: m ≥ 70 は背景、m ≤ 30 は絵、その間は半透明。
 * 半透明の所は、混ざったマゼンタを引き戻す (ふちが桃色ににじまないように)。
 * 光のしぶきは絵の本体から離れた小さな粒なので、塊を選ばずに全部残す。
 * 余白を切り詰め、幅 1200px までに縮める (縦画面では幅いっぱい、横画面では 700px ほどで出す)。
 * 透明を残したまま軽くするため WebP (品質 0.9) で書き出す (PNG だと 1.1MB あった。iOS の Safari は 14 から読める)。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art', 'cutin-sheet.png');
const OUT = path.join(ROOT, 'img', 'cutin-punch.webp');
const MAX_W = 1200;

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.error('playwright が要ります'); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const data = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');
  const r = await page.evaluate(async ({ data, MAX_W }) => {
    const im = new Image(); im.src = data; await im.decode();
    const w = im.width, h = im.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const corners = [0, w - 1, (h - 1) * w, h * w - 1].map((i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]].join(','));
    let x0 = w, y0 = h, x1 = -1, y1 = -1, solid = 0, soft = 0;
    for (let i = 0; i < w * h; i++) {
      const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2];
      const m = Math.min(R, B) - G;
      const a = m >= 70 ? 0 : m <= 30 ? 1 : (70 - m) / 40;
      if (a > 0 && a < 1) {
        const k = 1 - a;
        d[i * 4] = R - (R - G) * k * 0.6;
        d[i * 4 + 2] = B - (B - G) * k * 0.6;
        soft++;
      }
      d[i * 4 + 3] = Math.round(255 * a);
      if (a > 0) {
        if (a === 1) solid++;
        const px = i % w, py = (i - px) / w;
        if (a > 0.2) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
      }
    }
    ctx.putImageData(img, 0, 0);
    const P = 4;
    const cx = Math.max(0, x0 - P), cy = Math.max(0, y0 - P), cw = Math.min(w, x1 + P + 1) - cx, ch = Math.min(h, y1 + P + 1) - cy;
    let o = document.createElement('canvas'); o.width = cw; o.height = ch;
    o.getContext('2d').drawImage(c, cx, cy, cw, ch, 0, 0, cw, ch);
    // 半分ずつ縮める (一度に縮めると線がざらつく)
    while (o.width > MAX_W) {
      const nw = Math.max(MAX_W, Math.round(o.width / 2)), nh = Math.round(o.height * nw / o.width);
      const s = document.createElement('canvas'); s.width = nw; s.height = nh;
      const sx = s.getContext('2d'); sx.imageSmoothingQuality = 'high';
      sx.drawImage(o, 0, 0, nw, nh);
      o = s;
    }
    return { url: o.toDataURL('image/webp', 0.9), size: o.width + 'x' + o.height, crop: [cx, cy, cw, ch], corners, solid, soft };
  }, { data, MAX_W });
  fs.writeFileSync(OUT, Buffer.from(r.url.split(',')[1], 'base64'));
  console.log('cutin-punch', r.size, '元の絵から切った枠', r.crop.join(','), '四隅の色', r.corners.join(' / '), '絵', r.solid, '半透明', r.soft);
  await browser.close();
}

main();
