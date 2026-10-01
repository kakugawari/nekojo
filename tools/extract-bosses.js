/*
 * ボスの絵 (art/bosses/<名前>.png。1536x1024、背景はマゼンタ、2x2 に 立ち絵・攻撃1・攻撃2・やられた) から、
 * ポーズごとの絵を切り出して img/boss-<名前>-<ポーズ>.webp と、並べるための数字 boss-art.js を作る。
 *
 *   node tools/extract-bosses.js      (要 playwright。ブラウザの canvas で処理する)
 *
 * 1. 背景の色 (四隅の真ん中の値) からの距離で抜く: 60 以下は背景、110 以上は絵、その間は半透明。
 *    案内猫と同じ「マゼンタらしさ」で抜くと、影の忍猫の紫の煙や姫にゃんの着物の赤・桜の桃色まで抜けて穴だらけになった。
 *    半透明の所は、混ざった背景の色を引いて元の色に戻す (C = (P − (1 − a)·B) / a)
 * 2. つながった塊に分け、字を捨てる: 立ち絵の左上の名前と説明 (x<380・y<250 に収まる塊) と、
 *    各マスの下の「立ち絵」「攻撃 (…)」などの字 (y468〜536・y930〜1024 に収まる小さな塊)。25 画素より小さい粒も捨てる。
 *    名前の札が体とつながっている絵は、ERASE の四角を先に消す
 * 3. 残った塊を、重心の位置で 4 つのマスに分ける (光のすじがマスの境をまたいでも切れない)
 * 4. マスの中でいちばん大きな塊を体とみなし、その下端を足もととする。真ん中は顔の真ん中 (ANCHOR。目で見て決めた割合)
 * 5. 0.8 倍に縮めて WebP (品質 0.85) で書き出す。立ち絵からは顔の四角も切って、上の札の顔に使う
 *
 * 絵を差し替えたら、書き出す見本 (一時フォルダの boss-sheet.html。場所は最後に出る) で足もと (赤)・真ん中 (青) の線を目で見て、
 * 外れていたら ANCHOR を直すこと。ボスを足すときは IDS と core.js の BOSSES に足す。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art', 'bosses');
const OUT = path.join(ROOT, 'img');
const IDS = ['kaze', 'kage-ninja', 'hime', 'koura', 'sumo', 'aka-oni', 'tengu', 'kori', 'kuro-maou', 'onryo'];
const POSES = ['stand', 'atk1', 'atk2', 'down'];   // 左上・右上・左下・右下
const SCALE = 0.8;
const QUALITY = 0.85;
// 真ん中 (ポーズを切り替えても動かない所) は、顔の真ん中にする。攻撃のポーズは光や煙が片側に大きく出るので、
// 重心 (体の塊) や頭の重心だと効果に引っぱられた。見本 (boss-sheet.html) を見て、切り出した絵の幅に対する割合で決めた。
// 顔を合わせておくと、ポーズが変わっても顔が同じ所に残るので、とんだように見えない。
// ただし、やられた (寝そべった絵) は、顔が端にあるので顔で合わせると体が片側へ長く伸び、縦画面の右端で切れた。
// やられたは、絵の真ん中 (0.5) で合わせる (下の表の 4 つ目の値は使わない)
const DOWN_ANCHOR = 0.5;
const ANCHOR = {
  kaze: [0.58, 0.40, 0.22, 0.29], 'kage-ninja': [0.69, 0.54, 0.44, 0.36], hime: [0.51, 0.40, 0.47, 0.31],
  koura: [0.55, 0.64, 0.69, 0.33], sumo: [0.51, 0.56, 0.51, 0.31], 'aka-oni': [0.60, 0.46, 0.40, 0.24],
  tengu: [0.57, 0.53, 0.60, 0.38], kori: [0.55, 0.46, 0.36, 0.27], 'kuro-maou': [0.51, 0.53, 0.44, 0.34],
  onryo: [0.55, 0.66, 0.49, 0.5]
};
// 塊を分ける前に消す四角 (元の絵の画素)。姫にゃんは名前の札がしっぽの先とつながって、体と同じ塊になっていた
const ERASE = { hime: [[0, 0, 318, 122]] };

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.error('playwright が要ります'); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const art = {};
  const preview = [];
  for (const id of IDS) {
    const file = path.join(SRC, id + '.png');
    if (!fs.existsSync(file)) { console.log(id, 'の絵がまだ無い'); continue; }
    const data = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
    const r = await page.evaluate(async ({ data, POSES, SCALE, QUALITY, anchor, downAnchor, erase }) => {
      const im = new Image(); im.src = data; await im.decode();
      const W = im.width, H = im.height;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.drawImage(im, 0, 0);
      const img = ctx.getImageData(0, 0, W, H);
      const d = img.data;
      // 背景の色: 四隅 (20x20) の値の真ん中
      const samp = [[], [], []];
      for (const [cx, cy] of [[4, 4], [W - 24, 4], [4, H - 24], [W - 24, H - 24]]) {
        for (let y = cy; y < cy + 20; y++) for (let x = cx; x < cx + 20; x++) { const i = (y * W + x) * 4; for (let k = 0; k < 3; k++) samp[k].push(d[i + k]); }
      }
      const bg = samp.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
      // 1. 距離で抜く
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
      (erase || []).forEach(([ex, ey, ew, eh]) => { for (let y = ey; y < ey + eh; y++) for (let x = ex; x < ex + ew; x++) alpha[y * W + x] = 0; });
      // 2. 塊
      const lab = new Int32Array(W * H).fill(-1);
      const comps = [];
      for (let i = 0; i < W * H; i++) {
        if (alpha[i] < 0.35 || lab[i] >= 0) continue;
        const id = comps.length; const st = [i]; lab[i] = id;
        let n = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
        while (st.length) {
          const k = st.pop(); n++;
          const px = k % W, py = (k - px) / W;
          sx += px; sy += py;
          if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
          if (px > 0 && lab[k - 1] < 0 && alpha[k - 1] >= 0.35) { lab[k - 1] = id; st.push(k - 1); }
          if (px < W - 1 && lab[k + 1] < 0 && alpha[k + 1] >= 0.35) { lab[k + 1] = id; st.push(k + 1); }
          if (py > 0 && lab[k - W] < 0 && alpha[k - W] >= 0.35) { lab[k - W] = id; st.push(k - W); }
          if (py < H - 1 && lab[k + W] < 0 && alpha[k + W] >= 0.35) { lab[k + W] = id; st.push(k + W); }
        }
        comps.push({ n, cx: sx / n, cy: sy / n, x0, y0, x1, y1 });
      }
      const within = (cp, bx0, by0, bx1, by1) => cp.x0 >= bx0 && cp.y0 >= by0 && cp.x1 <= bx1 && cp.y1 <= by1;
      const dropped = { title: 0, label: 0, speck: 0 };
      const cell = comps.map((cp) => {
        if (cp.n < 25) { dropped.speck++; return -1; }
        if (within(cp, 0, 0, 380, 250)) { dropped.title++; return -1; }
        if (cp.n < 4000 && (within(cp, 0, 468, W, 536) || within(cp, 0, 930, W, H))) { dropped.label++; return -1; }
        return (cp.cy < H / 2 ? 0 : 2) + (cp.cx < W / 2 ? 0 : 1);
      });
      // 半透明のふち (0.35 未満) は、となりの画素の塊に付ける
      const owner = new Int32Array(W * H).fill(-1);
      for (let i = 0; i < W * H; i++) if (lab[i] >= 0) owner[i] = lab[i];
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < W * H; i++) {
          if (owner[i] >= 0 || alpha[i] <= 0) continue;
          const px = i % W;
          const nb = [px > 0 ? i - 1 : -1, px < W - 1 ? i + 1 : -1, i - W, i + W];
          for (const m of nb) if (m >= 0 && m < W * H && owner[m] >= 0) { owner[i] = owner[m]; break; }
        }
      }
      ctx.putImageData(img, 0, 0);
      const out = {};
      for (let p = 0; p < 4; p++) {
        const ids = []; let main = -1;
        comps.forEach((cp, k) => { if (cell[k] === p) { ids.push(k); if (main < 0 || cp.n > comps[main].n) main = k; } });
        const keep = new Uint8Array(comps.length); ids.forEach((k) => { keep[k] = 1; });
        let x0 = W, y0 = H, x1 = 0, y1 = 0;
        ids.forEach((k) => { const cp = comps[k]; x0 = Math.min(x0, cp.x0); y0 = Math.min(y0, cp.y0); x1 = Math.max(x1, cp.x1); y1 = Math.max(y1, cp.y1); });
        const P = 3;
        x0 = Math.max(0, x0 - P); y0 = Math.max(0, y0 - P); x1 = Math.min(W - 1, x1 + P); y1 = Math.min(H - 1, y1 + P);
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        const cut = document.createElement('canvas'); cut.width = cw; cut.height = ch;
        const cc = cut.getContext('2d');
        const part = ctx.getImageData(x0, y0, cw, ch);
        const pd = part.data;
        for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
          const gi = (y0 + yy) * W + (x0 + xx), li = (yy * cw + xx) * 4;
          pd[li + 3] = owner[gi] >= 0 && keep[owner[gi]] ? Math.round(255 * alpha[gi]) : 0;
        }
        cc.putImageData(part, 0, 0);
        // 体 (いちばん大きな塊): 足もと = 下端、真ん中 = 重心。顔 = 上から 3 割の画素の重心
        const m = comps[main];
        let hx = 0, hn = 0;
        const headBottom = m.y0 + (m.y1 - m.y0) * 0.3;
        for (let y = m.y0; y <= headBottom; y++) for (let x = m.x0; x <= m.x1; x++) if (lab[y * W + x] === main) { hx += x; hn++; }
        const f = p === 3 ? downAnchor : anchor[p];
        const ax = f !== undefined ? x0 + f * cw : m.cx;
        const nw = Math.round(cw * SCALE), nh = Math.round(ch * SCALE);
        const s = document.createElement('canvas'); s.width = nw; s.height = nh;
        const sx = s.getContext('2d'); sx.imageSmoothingQuality = 'high';
        sx.drawImage(cut, 0, 0, nw, nh);
        out[POSES[p]] = {
          url: s.toDataURL('image/webp', QUALITY), w: nw, h: nh,
          ax: Math.round((ax - x0) * SCALE), ay: Math.round((m.y1 - y0) * SCALE),
          top: Math.round((m.y0 - y0) * SCALE), bodyH: Math.round((m.y1 - m.y0) * SCALE),
          headX: hn ? Math.round((hx / hn - x0) * SCALE) : Math.round((m.cx - x0) * SCALE),
          pieces: ids.length, src: [x0, y0, cw, ch]
        };
        if (p === 0) {
          // 顔: 頭の真ん中を中心に、体の高さの半分の四角 (上の札の丸い顔に使う)
          const side = Math.round((m.y1 - m.y0) * 0.5);
          const fx0 = Math.round(hx / hn - side / 2), fy0 = Math.round(m.y0 - side * 0.04);
          const f = document.createElement('canvas'); f.width = f.height = 160;
          const fc = f.getContext('2d'); fc.imageSmoothingQuality = 'high';
          fc.drawImage(cut, fx0 - x0, fy0 - y0, side, side, 0, 0, 160, 160);
          out.face = { url: f.toDataURL('image/webp', QUALITY) };
        }
      }
      return { bg, dropped, poses: out };
    }, { data, POSES, SCALE, QUALITY, anchor: ANCHOR[id] || [], downAnchor: DOWN_ANCHOR, erase: ERASE[id] });
    art[id] = {};
    for (const p of POSES.concat(['face'])) {
      const o = r.poses[p];
      fs.writeFileSync(path.join(OUT, 'boss-' + id + '-' + p + '.webp'), Buffer.from(o.url.split(',')[1], 'base64'));
      if (p !== 'face') {
        art[id][p] = { w: o.w, h: o.h, ax: o.ax, ay: o.ay, top: o.top, bodyH: o.bodyH, headX: o.headX };
        preview.push({ id, p, url: o.url, meta: art[id][p] });
      }
    }
    console.log(id, '背景', r.bg.join(','), '捨てた塊', JSON.stringify(r.dropped),
      POSES.map((p) => p + ' ' + r.poses[p].w + 'x' + r.poses[p].h + ' (体 ' + r.poses[p].bodyH + ', 塊 ' + r.poses[p].pieces + ')').join(' / '));
  }
  const body = '// 自動で作ったファイル。手で直さない (tools/extract-bosses.js で作り直す)\n' +
    '// ボスの絵の大きさと、足もと (ax, ay)・体の上端 (top)・体の高さ (bodyH)・頭の真ん中 (headX)。単位は書き出した絵の画素\n' +
    '(function (root) {\n  \'use strict\';\n  const BOSS_ART = ' + JSON.stringify(art) + ';\n' +
    '  if (typeof module === \'object\' && module.exports) module.exports = BOSS_ART;\n  else root.BOSS_ART = BOSS_ART;\n})(this);\n';
  fs.writeFileSync(path.join(ROOT, 'boss-art.js'), body);
  // 目で確かめる見本: 足もと (赤の横線) と真ん中 (青の縦線)
  const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#e9dfc8;font:12px sans-serif">' +
    '<div style="display:grid;grid-template-columns:repeat(4,300px);gap:6px;padding:6px">' +
    preview.map((q) => {
      const k = 280 / Math.max(q.meta.w, q.meta.h);
      return '<div style="position:relative;height:300px;background:#cfe3c8"><img src="' + q.url + '" style="position:absolute;left:0;top:0;width:' + q.meta.w * k + 'px">' +
        '<div style="position:absolute;left:0;right:0;top:' + q.meta.ay * k + 'px;border-top:2px solid red"></div>' +
        '<div style="position:absolute;top:0;height:' + q.meta.h * k + 'px;left:' + q.meta.ax * k + 'px;border-left:2px solid blue"></div>' +
        '<div style="position:absolute;left:0;right:0;top:' + q.meta.top * k + 'px;border-top:1px dashed #333"></div>' +
        '<div style="position:absolute;top:0;height:' + q.meta.h * k + 'px;left:' + q.meta.headX * k + 'px;border-left:2px dashed #0a0"></div>' +
        '<span style="position:absolute;right:2px;bottom:2px">' + q.id + ' ' + q.p + '</span></div>';
    }).join('') + '</div>';
  const previewPath = process.env.BOSS_PREVIEW || path.join(require('node:os').tmpdir(), 'boss-sheet.html');
  fs.writeFileSync(previewPath, html);
  console.log('見本:', previewPath);
  await browser.close();
}

main();
