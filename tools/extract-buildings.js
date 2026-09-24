/*
 * 施設の絵 (art/building-sheet.png) から、建物を 1 つずつ切り出して img/b-*.png に置く。
 *
 *   node tools/extract-buildings.js      (要 playwright。ブラウザの canvas で処理する)
 *
 * この絵は背景が透明で、建物のまわりに半透明の光のにじみ (透明度 64 未満) が付いている。
 * 建物そのものは透明度 192 以上。にじみを透明度で切り落とし、建物は不透明にする。
 * にじみを落とすと、建物・名札・煙などはそれぞれ離れた塊になる。塊ごとに番号を振り、
 * 下の枠は「中心がこの中にある塊を拾う」目印に使う (名札は中心が枠の下なので入らない)。
 *
 * 数字は施設の絵の画素の位置 (1536x1024)。絵を差し替えたら測り直すこと。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art', 'building-sheet.png');
const OUT = path.join(ROOT, 'img');

// 名前: [x, y, w, h]
const BOXES = {
  castle: [0, 0, 460, 402],          // 名札が石段にくっついて1つの塊になるので、下を CLIP_BOTTOM で切る
  village: [485, 100, 480, 302],
  mansion: [995, 135, 320, 258],     // 猫侍の屋敷
  dojo: [1335, 130, 180, 210],       // 訓練場
  farm: [10, 470, 240, 175],         // 農場
  shop: [265, 480, 175, 165],        // 商店
  house: [475, 450, 170, 195],       // 民家
  armory: [690, 485, 185, 160],      // 武器屋
  workshop: [915, 480, 180, 165],    // 工房
  stable: [1145, 500, 180, 145],     // 厩舎
  tower: [1370, 405, 150, 240],      // 見張り台
  stonewall: [10, 690, 195, 150],    // 城の石垣
  fence: [235, 685, 170, 155],       // 柵
  bridge: [440, 690, 205, 150],      // 橋
  onsen: [665, 700, 190, 140],       // 温泉
  rice: [885, 685, 215, 155],        // 田んぼ
  sakura: [1105, 670, 140, 170],     // 桜の木
  garden: [1275, 700, 210, 140],     // 庭
  nobori: [30, 865, 60, 110],        // のぼり
  signboard: [145, 890, 95, 85],     // 看板
  barrels: [280, 895, 110, 80],      // 樽・箱
  torch: [435, 870, 60, 105],        // たいまつ
  lantern: [550, 875, 65, 100],      // 石灯籠
  well: [685, 875, 110, 100],        // 井戸
  cart: [815, 890, 130, 85],         // 荷車
  straw: [985, 890, 80, 85],         // 藁の束
  woodfence: [1115, 900, 105, 70],   // 木の柵
  flags: [1275, 865, 75, 110],       // 旗セット
  villager: [1425, 875, 80, 100]     // 村人猫 (汎用)
};

// 塊の中で、この y より下は捨てる (名札がくっついている物)
const CLIP_BOTTOM = { castle: 402 };

// 地図に置くと幅 100〜170px ほど (画素の倍率 1.5 で 150〜260px)。それより大きい絵は縮めて軽くする
const MAX_W = { castle: 300, village: 300, mansion: 240 };
const DEFAULT_MAX_W = 220;

const A_LO = 96;   // これより薄ければ消す (光のにじみ)
const A_HI = 190;  // これより濃ければ不透明 (建物)

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

  const out = await page.evaluate(async ({ src, BOXES, A_LO, A_HI, CLIP_BOTTOM, MAX_W, DEFAULT_MAX_W }) => {
    const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const W = img.width, H = img.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const im = x.getImageData(0, 0, W, H);
    const d = im.data;

    // にじみを切り落とす
    for (let p = 0; p < W * H; p++) {
      const t = Math.max(0, Math.min(1, (d[p * 4 + 3] - A_LO) / (A_HI - A_LO)));
      d[p * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255);
    }
    // つながった塊ごとに番号を振る (斜めもつながりとみなす)
    const label = new Int32Array(W * H).fill(-1);
    const comps = [];
    for (let p = 0; p < W * H; p++) {
      if (label[p] >= 0 || d[p * 4 + 3] === 0) continue;
      const id = comps.length;
      const comp = { x0: W, y0: H, x1: -1, y1: -1, n: 0, sx: 0, sy: 0 };
      const stack = [p];
      label[p] = id;
      while (stack.length) {
        const q = stack.pop();
        const qx = q % W, qy = (q / W) | 0;
        comp.n++; comp.sx += qx; comp.sy += qy;
        if (qx < comp.x0) comp.x0 = qx; if (qx > comp.x1) comp.x1 = qx;
        if (qy < comp.y0) comp.y0 = qy; if (qy > comp.y1) comp.y1 = qy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const r = ny * W + nx;
          if (label[r] < 0 && d[r * 4 + 3] > 0) { label[r] = id; stack.push(r); }
        }
      }
      comp.cx = comp.sx / comp.n; comp.cy = comp.sy / comp.n;
      comps.push(comp);
    }

    const result = {};
    const claimed = new Set();
    for (const [name, [bx, by, bw, bh]] of Object.entries(BOXES)) {
      // 中心が枠の中にある塊を拾う (小さな点は捨てる)
      const ids = [];
      comps.forEach((k, id) => {
        if (k.n >= 25 && k.cx >= bx && k.cx < bx + bw && k.cy >= by && k.cy < by + bh) ids.push(id);
      });
      ids.forEach((id) => claimed.add(id));
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      ids.forEach((id) => { const k = comps[id]; x0 = Math.min(x0, k.x0); y0 = Math.min(y0, k.y0); x1 = Math.max(x1, k.x1); y1 = Math.max(y1, k.y1); });
      if (CLIP_BOTTOM[name] !== undefined) y1 = Math.min(y1, CLIP_BOTTOM[name]);
      const ow = x1 - x0 + 1, oh = y1 - y0 + 1;
      const t = document.createElement('canvas');
      t.width = ow; t.height = oh;
      const tx = t.getContext('2d');
      const o = tx.createImageData(ow, oh);
      const set = new Set(ids);
      for (let yy = 0; yy < oh; yy++) for (let xx = 0; xx < ow; xx++) {
        const sp = (y0 + yy) * W + (x0 + xx);
        if (!set.has(label[sp])) continue;
        const op = (yy * ow + xx) * 4;
        o.data[op] = d[sp * 4]; o.data[op + 1] = d[sp * 4 + 1]; o.data[op + 2] = d[sp * 4 + 2]; o.data[op + 3] = d[sp * 4 + 3];
      }
      tx.putImageData(o, 0, 0);
      const maxW = MAX_W[name] || DEFAULT_MAX_W;
      let fin = t;
      if (ow > maxW) {
        fin = document.createElement('canvas');
        fin.width = maxW;
        fin.height = Math.round(oh * maxW / ow);
        const fx = fin.getContext('2d');
        fx.imageSmoothingQuality = 'high';
        fx.drawImage(t, 0, 0, fin.width, fin.height);
      }
      result[name] = { url: fin.toDataURL('image/png'), parts: ids.length };
    }
    // どの枠にも拾われなかった大きな塊 (名札以外に取りこぼしが無いか見るため)
    const left = comps.filter((k, id) => !claimed.has(id) && k.n >= 400)
      .map((k) => [Math.round(k.cx), Math.round(k.cy), k.x1 - k.x0 + 1, k.y1 - k.y0 + 1]);
    return { result, left };
  }, { src, BOXES, A_LO, A_HI, CLIP_BOTTOM, MAX_W, DEFAULT_MAX_W });

  for (const [name, r] of Object.entries(out.result)) {
    const buf = Buffer.from(r.url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, 'b-' + name + '.png'), buf);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    console.log(`b-${name}.png  ${w}x${h}  ${(buf.length / 1024).toFixed(0)}KB  塊${r.parts}`);
  }
  // 拾われなかった大きな塊。名札 (横長で背が 30px ほど) だけのはず
  console.log('拾わなかった塊 [中心x, 中心y, 幅, 高さ]:', JSON.stringify(out.left));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
