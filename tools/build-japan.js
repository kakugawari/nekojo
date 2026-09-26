// 日本地図 (japan-map.js) を作る。
//
//   curl -sSLo /tmp/japan.geojson https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson
//   node tools/build-japan.js /tmp/japan.geojson
//
// 元の形は「地球地図日本」(国土地理院) を dataofjapan/land が GeoJSON にしたもの (13MB)。
// 使うときは出典の明記が要る (営利目的なら、国土地理院への利用報告も要る)。画面の地図の下に出典を出している。
//
// やること:
// - 経度・緯度を平らに写す (x は cos(35.5°) を掛けて縦横の縮みを合わせる)。1 = 緯度 0.01° (約 1.1km)
// - 小さな島を落とす (いちばん大きな形は必ず残す)。点は Douglas-Peucker で間引く
// - 沖縄は本島だけを、日本海の空いた所 (左上) に 1.8 倍で置く。まわりに枠を描く
// - 県と県が隣り合うかは、元の形で同じ点を持っているかで決める (海をはさむ道は core.js で足す)
// - 県の名前やしるしを置く点は、形の中でいちばんふちから遠い所

const fs = require('fs');
const path = require('path');

const src = process.argv[2] || '/tmp/japan.geojson';
const g = JSON.parse(fs.readFileSync(src, 'utf8'));

const COS = Math.cos(35.5 * Math.PI / 180);
const LON0 = 128.4, LAT0 = 45.8;
const S = 100;
const TOL = 1.4;            // 間引きの許し (単位: 約 1.1km)
const MIN_AREA = 120;       // これより小さい島は落とす (約 150km²)
const OKINAWA = 47;
const OKI_SCALE = 1.8;
const OKI_BOX = { x: 40, y: 150, w: 170, h: 230 };

function project(p) { return [(p[0] - LON0) * COS * S, (LAT0 - p[1]) * S]; }

function area(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bd = tol;
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function simplifyRing(r) {
  // 閉じた輪は、いちばん遠い 2 点で分けてから間引く (始点が決め打ちだと形が崩れる)
  const open = r.slice(0, -1);
  let far = 0, fd = -1;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = simplify(open.slice(0, far + 1), TOL);
  const b = simplify(open.slice(far).concat([open[0]]), TOL);
  return a.concat(b.slice(1, -1));
}

function inside(rings, x, y) {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    }
  }
  return c;
}

function edgeDist(rings, x, y) {
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const ax = r[j][0], ay = r[j][1], bx = r[i][0], by = r[i][1];
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return best;
}

const prefs = [];
for (const f of g.features) {
  const id = f.properties.id;
  const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
  let list = polys.map((p) => p.map((r) => r.map(project)));
  list.sort((a, b) => area(b[0]) - area(a[0]));
  if (id === OKINAWA) list = list.slice(0, 1);
  else list = list.filter((p, i) => i === 0 || area(p[0]) >= MIN_AREA);
  // 穴 (琵琶湖など) も大きなものは残す
  let rings = [];
  list.forEach((p) => p.forEach((r, k) => { if (k === 0 || area(r) >= MIN_AREA) rings.push(simplifyRing(r)); }));
  if (id === OKINAWA) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rings.forEach((r) => r.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const bx = OKI_BOX.x + OKI_BOX.w / 2, by = OKI_BOX.y + OKI_BOX.h / 2;
    rings = rings.map((r) => r.map((p) => [bx + (p[0] - cx) * OKI_SCALE, by + (p[1] - cy) * OKI_SCALE]));
  }
  // 名前を置く点: いちばん大きな形の中で、ふちから最も遠い所
  const main = rings.slice(0, 1);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  main[0].forEach((p) => { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); });
  let lx = 0, ly = 0, ld = -1;
  const step = Math.max(1, Math.min(bx1 - bx0, by1 - by0) / 40);
  for (let x = bx0; x <= bx1; x += step) {
    for (let y = by0; y <= by1; y += step) {
      if (!inside(main, x, y)) continue;
      const d = edgeDist(main, x, y);
      if (d > ld) { ld = d; lx = x; ly = y; }
    }
  }
  prefs.push({ id: id, name: f.properties.nam_ja, rings: rings, lx: lx, ly: ly, r: ld });
}
prefs.sort((a, b) => a.id - b.id);

// 全体を左上 (余白 10) に寄せて、整数にする
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
prefs.forEach((p) => p.rings.forEach((r) => r.forEach((q) => {
  minX = Math.min(minX, q[0]); minY = Math.min(minY, q[1]); maxX = Math.max(maxX, q[0]); maxY = Math.max(maxY, q[1]);
})));
const PAD = 10;
const ox = PAD - minX, oy = PAD - minY;
const W = Math.ceil(maxX - minX + 2 * PAD), H = Math.ceil(maxY - minY + 2 * PAD);

let points = 0;
const out = prefs.map((p) => {
  const rings = p.rings.map((r) => {
    const flat = [];
    r.forEach((q) => { flat.push(Math.round(q[0] + ox), Math.round(q[1] + oy)); });
    points += r.length;
    return flat;
  });
  return { id: p.id, rings: rings, lx: Math.round(p.lx + ox), ly: Math.round(p.ly + oy), lr: Math.round(p.r) };
});
const box = { x: Math.round(OKI_BOX.x + ox), y: Math.round(OKI_BOX.y + oy), w: OKI_BOX.w, h: OKI_BOX.h };

const body = '// 自動で作ったファイル。手で直さない (tools/build-japan.js で作り直す)\n' +
  '// 地図の出典: 地球地図日本 (国土地理院)\n' +
  '(function (root) {\n' +
  '  \'use strict\';\n' +
  '  const JAPAN_MAP = ' + JSON.stringify({ w: W, h: H, okinawaBox: box, prefs: out }) + ';\n' +
  '  if (typeof module === \'object\' && module.exports) module.exports = JAPAN_MAP;\n' +
  '  else root.JAPAN_MAP = JAPAN_MAP;\n' +
  '})(this);\n';
const dest = path.join(__dirname, '..', 'japan-map.js');
fs.writeFileSync(dest, body);
console.log('wrote', dest, (body.length / 1024).toFixed(1) + 'KB', 'size', W + 'x' + H, 'points', points);
out.forEach((p) => console.log(p.id, prefs[p.id - 1].name, 'rings', p.rings.length, 'label', p.lx, p.ly, 'r', p.lr));
