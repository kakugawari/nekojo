/*
 * 城の画面の見本 (art/castle-mock.png, 1672x941) から、画面の飾りを切り出して img/u-*.webp に置く。
 *
 *   node tools/extract-castle-ui.js      (要 playwright。ブラウザの canvas で処理する)
 *
 * 切り出し方は 4 通り:
 *   mask  … 色を塗り替えて使うしるし (タブのアイコン・金づち)。白い絵 + 透明度で書き出し、CSS の mask-image で塗る。
 *           透明度は「地の色からどれだけ離れているか」(紺の地に白い絵 / 金の地に紺の絵のどちらも)
 *   key   … 色つきの絵 (札・小判・木材・猫の丸・肉球の丸・梅の花)。四角のふちから、地の色に近い所をたどって抜く。
 *           絵と地の境目は、地の色からの離れ具合で半透明にする
 *   raw   … 四角のまま (タブの帯の波・選んだタブの金の札・建築するの金の札)。字やしるしの所は、行ごとに左右の色でつなぐ。
 *           選んだタブの札は、縦画面 (タブが下) 用に、角が上を向くよう回した物 (u-tab-on-up) も書き出す
 * すみの飾り (右下の菊・右上の桜) は、札のふちの線や雲がかかっているので切り出していない
 *
 * 四角は元の絵の画素の位置。絵を差し替えたら測り直すこと (書き出す見本で、絵が切れていないか・字が入っていないかを見る)。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art', 'castle-mock.png');
const OUT = path.join(ROOT, 'img');

const NAVY = [34, 54, 82];
const GOLD = [246, 213, 133];
// [名前, 切り方, x0, y0, x1, y1, ほか]
const PIECES = [
  // タブのアイコン (左の紺の帯。城だけは選ばれた金の札の上に紺)
  ['tab-battle', 'mask', 30, 130, 100, 196, { bg: NAVY }],
  ['tab-realm', 'mask', 30, 258, 100, 328, { bg: NAVY }],
  ['tab-vassals', 'mask', 30, 388, 100, 456, { bg: NAVY }],
  ['tab-castle', 'mask', 28, 520, 104, 592, { bg: GOLD }],
  ['tab-village', 'mask', 30, 652, 100, 722, { bg: NAVY }],
  // 「建築する」の金づち (金の札の上に紺)
  ['hammer', 'mask', 1318, 795, 1372, 850, { bg: [238, 196, 100] }],
  // 題の札 (肉球と「城」の字と金の雲)。左の雲は紺の帯にかかっているので、帯の手前で切ってぼかす
  ['title', 'key', 141, 4, 540, 104, { fadeL: 22 }],
  // 資源のしるし
  ['wood', 'key', 874, 32, 938, 84],
  ['coin', 'key', 1334, 30, 1390, 86],
  // 城レベルの猫の丸・城内の施設の肉球の丸・建築・強化の梅の花
  ['lv-cat', 'key', 170, 130, 252, 212],
  ['fac-paw', 'key', 206, 814, 290, 898, { circle: [247, 855, 37] }],
  ['plum', 'key', 1196, 136, 1242, 182, { circle: [1217, 161, 17] }],
  // 紺の帯の下の波 (左下)
  ['wave', 'raw', 0, 790, 132, 941],
  // 選んだタブの金の札 (右に角と花)。アイコンと字の所は消す
  ['tab-on', 'raw', 0, 506, 152, 642, { key: [NAVY, [249, 243, 228]], fill: [18, 518, 112, 632], cutAfterNavy: 100, up: true }],
  // 「建築する」の金の札。金づちと字の所は消す (右はしの花は残す)
  ['build', 'raw', 1222, 780, 1606, 866, { key: [[251, 245, 230]], fill: [1300, 792, 1520, 852] }],
];

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.error('playwright が要ります'); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const data = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');
  const res = await page.evaluate(async ({ data, PIECES }) => {
    const im = new Image(); im.src = data; await im.decode();
    const W = im.width;
    const src = document.createElement('canvas'); src.width = W; src.height = im.height;
    const sctx = src.getContext('2d'); sctx.drawImage(im, 0, 0);
    const dist = (d, i, c) => Math.hypot(d[i] - c[0], d[i + 1] - c[1], d[i + 2] - c[2]);
    const median = (arr) => arr.slice().sort((a, b) => a - b)[arr.length >> 1];

    // 四角のふちの色 (いちばん多い色のあたり) を地とみなす
    function borderColor(d, w, h) {
      const s = [[], [], []];
      const add = (x, y) => { const i = (y * w + x) * 4; for (let k = 0; k < 3; k++) s[k].push(d[i + k]); };
      for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
      for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
      return s.map(median);
    }
    // ふちから、地の色 (どれか) に近い所をたどる。たどれた所が地
    function floodBg(d, w, h, bgs, tol) {
      const bg = new Uint8Array(w * h);
      const near = (i) => bgs.some((c) => dist(d, i * 4, c) < tol);
      const st = [];
      const push = (k) => { if (!bg[k] && near(k)) { bg[k] = 1; st.push(k); } };
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (st.length) {
        const k = st.pop(); const x = k % w;
        if (x > 0) push(k - 1); if (x < w - 1) push(k + 1); if (k >= w) push(k - w); if (k < w * (h - 1)) push(k + w);
      }
      return bg;
    }
    // 行ごとに、四角の左右の色を混ぜてつなぐ (字やしるしを消す)
    function fillRows(d, w, x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++) {
        const L = (y * w + x0 - 1) * 4, R = (y * w + x1 + 1) * 4;
        for (let x = x0; x <= x1; x++) {
          const t = (x - x0 + 1) / (x1 - x0 + 2), i = (y * w + x) * 4;
          for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[L + k] * (1 - t) + d[R + k] * t);
        }
      }
    }
    // 透明な余白を切り詰める
    function trim(c) {
      const g = c.getContext('2d'); const { data: d } = g.getImageData(0, 0, c.width, c.height);
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
      o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
      return o;
    }

    return PIECES.map(([name, how, x0, y0, x1, y1, opt = {}]) => {
      const w = x1 - x0, h = y1 - y0;
      const img = sctx.getImageData(x0, y0, w, h); const d = img.data;
      let out = document.createElement('canvas'); out.width = w; out.height = h;
      const og = out.getContext('2d');
      if (how === 'mask') {
        const bg = opt.bg; let far = 0;
        for (let i = 0; i < w * h; i++) far = Math.max(far, dist(d, i * 4, bg));
        for (let i = 0; i < w * h; i++) {
          const a = Math.max(0, Math.min(1, (dist(d, i * 4, bg) - 30) / (far * 0.7 - 30)));
          d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.round(a * 255);
        }
        og.putImageData(img, 0, 0); out = trim(out);
      } else if (how === 'key') {
        const bgc = borderColor(d, w, h);
        const bg = floodBg(d, w, h, [bgc], 26);
        // 境目: 地にとなる絵の画素は、地からの離れ具合で半透明
        for (let i = 0; i < w * h; i++) {
          if (bg[i]) { d[i * 4 + 3] = 0; continue; }
          const x = i % w;
          const edge = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < w * (h - 1) && bg[i + w]);
          if (edge) {
            const a = Math.max(0.15, Math.min(1, (dist(d, i * 4, bgc) - 10) / 60));
            for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.max(0, Math.min(255, (d[i * 4 + k] - (1 - a) * bgc[k]) / a));
            d[i * 4 + 3] = Math.round(a * 255);
          }
          if (opt.fadeL && x < opt.fadeL) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * x / opt.fadeL);
          // 丸い物は、丸の外 (となりの札のふちの線) を捨てる
          if (opt.circle) {
            const [cx, cy, r] = opt.circle, e = r - Math.hypot(x0 + x + 0.5 - cx, y0 + (i - x) / w + 0.5 - cy);
            if (e < 1) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * Math.max(0, e));
          }
        }
        og.putImageData(img, 0, 0); out = trim(out);
      } else {
        if (opt.fill) { const [fx0, fy0, fx1, fy1] = opt.fill; fillRows(d, w, fx0 - x0, fy0 - y0, fx1 - x0, fy1 - y0); }
        if (opt.key) {
          const bg = floodBg(d, w, h, opt.key, 30);
          for (let i = 0; i < w * h; i++) if (bg[i]) d[i * 4 + 3] = 0;
        }
        // 札の右の、紺の帯のふちの金の線を捨てる: 行ごとに、札の右で紺が出てきたら、そこから右は札ではない
        if (opt.cutAfterNavy) {
          for (let y = 0; y < h; y++) {
            let cut = false;
            for (let x = opt.cutAfterNavy; x < w; x++) {
              const i = (y * w + x) * 4;
              if (!cut && dist(d, i, opt.key[0]) < 40) cut = true;
              if (cut) d[i + 3] = 0;
            }
          }
        }
        og.putImageData(img, 0, 0);
        if (opt.key) out = trim(out);
      }
      const r = [{ name, url: out.toDataURL('image/webp', 0.92), w: out.width, h: out.height }];
      if (opt.up) {
        const u = document.createElement('canvas'); u.width = out.height; u.height = out.width;
        const ug = u.getContext('2d'); ug.translate(0, u.height); ug.rotate(-Math.PI / 2); ug.drawImage(out, 0, 0);
        r.push({ name: name + '-up', url: u.toDataURL('image/webp', 0.92), w: u.width, h: u.height });
      }
      return r;
    }).flat();
  }, { data, PIECES });
  for (const r of res) {
    fs.writeFileSync(path.join(OUT, 'u-' + r.name + '.webp'), Buffer.from(r.url.split(',')[1], 'base64'));
    console.log(('u-' + r.name).padEnd(16), r.w + 'x' + r.h);
  }
  const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;font:12px sans-serif;display:flex;flex-wrap:wrap;gap:6px;padding:6px;background:#888">' +
    res.map((r) => '<div style="padding:4px;text-align:center;background:' + (/^tab-|hammer/.test(r.name) ? '#22364f' : '#cfe3c8') +
      '"><img src="' + r.url + '" style="display:block;width:' + r.w * 2 + 'px"><span>' + r.name + '</span></div>').join('') + '</body>';
  const previewPath = process.env.PARTS_PREVIEW || path.join(require('node:os').tmpdir(), 'castle-ui.html');
  fs.writeFileSync(previewPath, html);
  console.log('見本:', previewPath);
  await browser.close();
}

main();
