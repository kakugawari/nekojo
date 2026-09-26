/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 画面まわりの不具合は node のテストでは捕まらない。ここでは本物の
 * ブラウザを立ち上げ、指の操作をそのまま再現して確かめる。
 *
 * 対象は iPhone 16 Plus (430pt 幅) だが、手元の playwright がこの名前を
 * 知らないことがある (道具を入れ直すたびに起きた実際の落とし穴)。
 * 同じ大きさ (430pt 幅) の代わりを控えに用意しておく。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}

function skip(message) {
  console.log('  \x1b[90m- とばした: ' + message + '\x1b[0m');
}

function section(name) {
  console.log('\n' + name);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

/** 何かした直後に、その要素がどれだけずれるかを 1 フレームずつ測る。 */
function measureJump(page, selector, act) {
  return page.evaluate(async ({ sel, code }) => {
    const before = document.querySelector(sel).getBoundingClientRect();
    // eslint-disable-next-line no-new-func
    new Function(code)();
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const el = document.querySelector(sel);
      if (!el) { worst = Infinity; break; }
      const now = el.getBoundingClientRect();
      worst = Math.max(worst, Math.abs(now.left - before.left), Math.abs(now.top - before.top));
    }
    return Math.round(worst);
  }, { sel: selector, code: act });
}

/** タイトルの見張り。題字が切れない・札が安全域より上・重ねたボタンが札の上に乗っている */
async function checkTitle(page, safeB) {
  const t = await page.evaluate(() => {
    const f = document.querySelector('.title-frame').getBoundingClientRect();
    const s = f.width / 1672;
    const b = document.getElementById('btnStart').getBoundingClientRect();
    return {
      logoL: f.left + 455 * s, logoR: f.left + 1252 * s, logoT: f.top + 50 * s,
      btnB: b.bottom, btnL: b.left, btnR: b.right,
      imgW: document.querySelector('.title-art').naturalWidth,
      vw: innerWidth, vh: innerHeight
    };
  });
  const tag = `${t.vw}x${t.vh}`;
  ok(t.imgW === 1672, `${tag}: タイトルの絵 (横長) が読み込まれる`);
  ok(t.logoL >= 0 && t.logoR <= t.vw && t.logoT >= 0,
    `${tag}: 題字が画面からはみ出さない (左${t.logoL.toFixed(0)} 右${t.logoR.toFixed(0)} 上${t.logoT.toFixed(0)})`);
  ok(t.btnL >= 0 && t.btnR <= t.vw && t.btnB <= t.vh - safeB, `${tag}: 「はじめる」が画面の中 (安全域より上) にある (下端 ${t.btnB.toFixed(0)})`);

  // 重ねたボタンが、絵に描いた札の上にちゃんと乗っているか。
  // 光る範囲の上寄り (字の無い所) を元の絵の画素に戻して、札のクリーム色かを見る
  const plaque = await page.evaluate(() => {
    const img = document.querySelector('.title-art');
    const f = img.getBoundingClientRect();
    const g = document.querySelector('.title-start-glow').getBoundingClientRect();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const s = img.naturalWidth / f.width;
    return [0.3, 0.5, 0.7].map((fx) => {
      const px = Math.round((g.left + g.width * fx - f.left) * s);
      const py = Math.round((g.top + g.height * 0.15 - f.top) * s);
      const d = x.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
  });
  const cream = plaque.every(([r, g, b]) => r > 220 && g > 200 && b > 150 && r > b);
  ok(cream, `${tag}: 重ねたボタンが札の上に乗っている (${plaque.map((c) => 'rgb(' + c.join(',') + ')').join(' ')})`);
}

/** 戦場の背景の見張り。もらった背景の絵が敷かれ、ねこの足もとが絵の土の広場に来ているか */
async function checkBattleBg(page, tag) {
  await page.waitForFunction(() => window.__app.layout().bg === 'image', null, { timeout: 8000 });
  const L = await page.evaluate(() => window.__app.layout());
  // 土の色が多いのは元の絵の y760〜840 (測った値)。足もとをその帯に合わせている
  ok(L.bgGroundY >= 740 && L.bgGroundY <= 880, `${tag}: 足もとが、背景の絵の土の広場の高さに来る (絵の y${Math.round(L.bgGroundY)})`);
  const dirt = await page.evaluate((L) => {
    const c = document.getElementById('fieldBg');
    const k = c.width / L.w;
    let n = 0;
    for (let i = 0; i <= 8; i++) {
      const x = L.heroX + (L.enemyX - L.heroX) * i / 8;
      const d = c.getContext('2d').getImageData(Math.floor(x * k), Math.floor((L.ground - 4) * k), 1, 1).data;
      if (d[0] > 150 && d[0] - d[2] > 30 && d[0] >= d[1]) n++;
    }
    return n;
  }, L);
  ok(dirt >= 6, `${tag}: 自分と敵のあいだの足もとは土の色 (${dirt}/9 点)`);
}

function pickPhoneDevice(devices) {
  // 実機は iPhone 16 Plus (430pt 幅) だが、入っている playwright に
  // その名前が無いことがある。同じ幅の控えで代える。
  const preferred = ['iPhone 16 Plus', 'iPhone 15 Plus', 'iPhone 15 Pro Max', 'iPhone 14 Pro Max', 'iPhone 13'];
  for (const name of preferred) {
    if (devices[name]) return { name, device: devices[name] };
  }
  const fallback = Object.keys(devices).find((k) => k.includes('iPhone'));
  return { name: fallback, device: devices[fallback] };
}

async function run() {
  let chromium;
  let devices;
  try {
    ({ chromium, devices } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }

  const { name: deviceName, device } = pickPhoneDevice(devices);
  console.log(`(端末: ${deviceName})`);

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], { stdio: 'ignore' });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------ スマホで開く
    section('スマホで開く');
    const context = await browser.newContext({ ...device });
    const phone = await context.newPage();
    phone.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    phone.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
    await phone.bringToFront();
    await phone.goto(URL);
    await phone.waitForFunction(() => window.__app);
    ok(true, 'ページが開いて、画面のしくみが立ち上がる');

    const fit = await phone.evaluate(() => ({
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : ''
    }));
    ok(fit.wide <= 1, 'スマホ幅で横スクロールが出ない');
    ok(fit.title.length > 0, `見出しが出ている (${fit.title})`);

    // 設定資料から切り出した絵が全部読み込めるか
    const sprites = await phone.evaluate(async () => {
      const names = ['stage0', 'stage1', 'stage2', 'stage3', 'cat-normal', 'cat-chatora', 'cat-kuro', 'cat-gray', 'cat-red',
        'face-normal', 'face-smile', 'face-serious', 'face-surprised', 'face-angry', 'face-shy', 'pose-special'];
      const bad = [];
      await Promise.all(names.map((n) => new Promise((done) => {
        const im = new Image();
        im.onload = () => { if (!(im.naturalWidth > 20)) bad.push(n); done(); };
        im.onerror = () => { bad.push(n); done(); };
        im.src = './img/' + n + '.png';
      })));
      return { total: names.length, bad };
    });
    ok(sprites.bad.length === 0, `設定資料の絵が ${sprites.total} 枚とも読み込める${sprites.bad.length ? ' (だめ: ' + sprites.bad.join(',') + ')' : ''}`);

    // ------------------------------------------------ タイトル画面
    section('タイトル画面');
    // 題字 (元の絵 1672x941 で x455〜1252, y50〜) と「はじめる」の札が画面に収まっているか。
    // 縦は Safari で開いた高さ (端末の既定) とホーム画面から開いた実寸 (932)、横は 932x430 で見る
    for (const vp of [device.viewport, { width: 430, height: 932 }]) {
      const ctx = await browser.newContext({ ...device, viewport: vp });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push('タイトル: ' + e.message));
      await page.goto(URL);
      await page.waitForFunction(() => window.__app && document.querySelector('.title-art').complete);
      await checkTitle(page, 0);
      ok(await page.evaluate(() => getComputedStyle(document.querySelector('.title-hint')).display !== 'none'),
        `${vp.width}x${vp.height}: 縦では「よこにすると大きく遊べる」と添える`);
      await ctx.close();
    }

    ok(await phone.evaluate(() => window.__app.titleShown()), '開くとタイトル画面が出る');

    // 絵に描いた札の上に重ねたボタンを、指で押す
    await phone.locator('#btnStart').tap();
    await phone.waitForTimeout(500);
    const started = await phone.evaluate(() => ({
      shown: window.__app.titleShown(),
      hidden: document.getElementById('titleScreen').hidden
    }));
    ok(!started.shown && started.hidden, '「はじめる」を押すとタイトルが消える');

    // ------------------------------------------------ 物語
    section('はじめての物語');
    ok(await phone.evaluate(() => !document.getElementById('storyModal').hidden), 'はじめて遊ぶと、主人公の物語が出る');
    await phone.locator('#btnStory').tap();
    await phone.waitForTimeout(100);
    ok(await phone.evaluate(() => document.getElementById('storyModal').hidden && window.__app.state().storySeen),
      '「旅立つ!」で閉じ、次からは出ない');

    // ------------------------------------------------ 合戦
    section('合戦');
    const fs0 = await phone.evaluate(() => window.__app.fieldSize());
    ok(fs0.w > 300 && fs0.h > 500, `戦場が画面いっぱいに広がる (${fs0.w}x${fs0.h})`);
    const bgPainted = await phone.evaluate(() => {
      const c = document.getElementById('fieldBg');
      const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.05), 1, 1).data;
      return d[3] > 0 && d[2] > d[0];
    });
    ok(bgPainted, '背景 (空) が描かれている');
    await checkBattleBg(phone, '縦');
    // 画素の倍率 2 で描くと、CPU4倍遅の戦闘中に 1コマ 33ms (30fps) まで落ちた。1.5 なら 16.7ms
    const dprUsed = await phone.evaluate(() => {
      const c = document.getElementById('fieldFg');
      return c.width / c.getBoundingClientRect().width;
    });
    ok(dprUsed <= 1.51, `戦場を描く面の画素の倍率が 1.5 以下 (${dprUsed.toFixed(2)})`);
    ok(await phone.evaluate(() => !document.getElementById('readyPanel').hidden), '出陣の札が出ている');

    await phone.locator('#btnSortie').tap();
    await phone.waitForTimeout(100);
    ok(await phone.evaluate(() => !!window.__app.battle() && document.getElementById('readyPanel').hidden), '「出陣!」で戦が始まる');

    // 下のボタンと一時停止が、札や重ねた層にふさがれていないか (指の下にボタンがあるか)
    const under = await phone.evaluate(() => ['btnLure', 'btnPunch', 'btnItem', 'btnPause'].map((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el && el.closest('#' + id) ? 'ok' : id + '→' + (el ? el.id || el.className : 'none');
    }));
    ok(under.every((u) => u === 'ok'), `ボタンが押せる位置にある (${under.join(', ')})`);
    // 上の段 (自分と敵) と下のボタンが画面に収まり、重ならないか
    const layout = await phone.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const vh = document.getElementById('field').getBoundingClientRect();
      return { lureBottom: r('btnLure').bottom, punchRight: r('btnPunch').right, pauseRight: r('btnPause').right, bottom: vh.bottom, right: vh.right, missionBottom: r('mission').bottom, lureTop: r('btnLure').top };
    });
    ok(layout.lureBottom <= layout.bottom && layout.punchRight <= layout.right && layout.pauseRight <= layout.right,
      '上の段と下のボタンが戦場の中に収まる');

    await phone.waitForFunction(() => { const b = window.__app.battle(); const e = b && b.enemies[b.current]; return e && e.state === 'idle'; }, null, { timeout: 8000 });
    ok(await phone.evaluate(() => !document.getElementById('enemyUnit').hidden && document.getElementById('enemyName').textContent.length > 0),
      '敵が出てくると、右上に敵の名前と体力が出る');
    ok(await phone.evaluate(() => window.__app.face() === 'serious'), '戦っている間は真剣な顔');

    // 夢中ゲージ: 1回目で ♡ (追いかける)、2回目で MAX (🐾 今だ!)。のら猫は2回で MAX
    ok(await phone.evaluate(() => window.__app.mood() === 'none'), 'はじめは頭の上に何も出ていない');
    await phone.locator('#btnLure').tap();
    await phone.waitForTimeout(60);
    const g1 = await phone.evaluate(() => { const b = window.__app.battle(); const e = b.enemies[b.current]; return { st: e.state, muchu: e.muchu, mood: window.__app.mood() }; });
    ok(g1.st === 'idle' && g1.muchu > 50 && g1.mood === 'chase', `猫じゃらしを指で押すと、夢中ゲージがたまり頭の上に ♡ (${Math.round(g1.muchu)}, ${g1.mood})`);
    const cdOf = () => phone.evaluate(() => parseFloat(document.getElementById('lureCd').style.getPropertyValue('--cd')) || 0);
    const cd1 = await cdOf();
    ok(cd1 > 0.5, `振った直後は、猫じゃらしのボタンに待ち時間の影がかかる (${cd1.toFixed(2)})`);
    await phone.waitForTimeout(460);
    const cd2 = await cdOf();
    ok(cd2 === 0, `待ち時間が明けると影が消える (${cd2})`);
    await phone.locator('#btnLure').tap();
    await phone.waitForTimeout(60);
    const g2 = await phone.evaluate(() => { const b = window.__app.battle(); const e = b.enemies[b.current]; return { st: e.state, mood: window.__app.mood(), ready: document.getElementById('btnPunch').classList.contains('ready') }; });
    ok(g2.st === 'charmed' && g2.mood === 'max', `続けて振ると MAX になり、敵が動けなくなる (頭の上は 🐾) (${g2.st}, ${g2.mood})`);
    ok(g2.ready, 'MAX の間は、猫パンチのボタンが光る');
    ok(await phone.evaluate(() => document.querySelector('#btnPunch .round-glow').getAnimations().length > 0), '光は点滅している');

    // 溜めパンチ: 本物の指のように、押したまま待ってから離す
    const cdp = await context.newCDPSession(phone);
    const touchAt = async (sel) => { const r = await phone.locator(sel).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const touch = (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [pt] : [] });
    const pp = await touchAt('#btnPunch');
    await phone.evaluate(() => { const b = window.__app.battle(); const e = b.enemies[b.current]; e.hp = e.maxHp = 5000; });
    ok(await phone.evaluate(() => document.getElementById('chargeLabel').textContent === 'ながおしで ためる'), '溜めゲージに「ながおしで ためる」と出ている');
    await touch('touchStart', pp);
    await phone.waitForTimeout(520); // MAX の敵なら 0.4 秒で強になる
    const holding = await phone.evaluate(() => ({
      on: window.__app.battle().charge.on,
      label: document.getElementById('chargeLabel').textContent,
      fill: document.getElementById('chargeFill').style.transform,
      lv1: document.getElementById('chargeGauge').classList.contains('lv1')
    }));
    ok(holding.on && holding.lv1 && holding.label === '強パンチ!', `押したままにすると溜まり、ゲージが「強パンチ!」になる (${holding.label}, ${holding.fill})`);
    const before = await phone.evaluate(() => { const b = window.__app.battle(); return { hp: b.enemies[b.current].hp, atk: b.player.atk }; });
    await touch('touchEnd');
    await phone.waitForTimeout(60);
    const afterStrong = await phone.evaluate(() => { const b = window.__app.battle(); const e = b.enemies[b.current]; return { hp: e.hp, st: e.state, on: b.charge.on }; });
    ok(!afterStrong.on && before.hp - afterStrong.hp === before.atk * 2 * 3,
      `離すと強パンチ。MAX の敵には 強(2倍)x MAX(3倍) で効く (${before.hp} → ${afterStrong.hp}、攻撃力 ${before.atk})`);
    ok(afterStrong.st === 'knock', '強パンチで敵が吹っ飛ぶ');

    // 会心まで溜めると「ポン!」が鳴り、離すと特大猫パンチ (カットイン)
    await phone.waitForTimeout(700);
    await phone.evaluate(() => { const b = window.__app.battle(); const e = b.enemies[b.current]; e.wary = 0; b.items.matatabi = Math.max(1, b.items.matatabi); });
    await phone.evaluate(() => window.__app.item('matatabi'));
    const pon0 = await phone.evaluate(() => window.__app.sfx().pon);
    await touch('touchStart', pp);
    await phone.waitForTimeout(900); // MAX の敵なら 0.75 秒で会心
    const full = await phone.evaluate(() => ({ label: document.getElementById('chargeLabel').textContent, pon: window.__app.sfx().pon }));
    ok(full.label === '会心!' && full.pon === pon0 + 1, `会心まで溜まると「ポン!」が1回鳴る (${full.label}, ${full.pon - pon0}回)`);
    // 指をボタンの外へずらしてから離しても、パンチは出る (指を捕まえている)
    await touch('touchMove', { x: pp.x - 200, y: pp.y - 300 });
    const hpBig = await phone.evaluate(() => { const b = window.__app.battle(); return b.enemies[b.current].hp; });
    await touch('touchEnd');
    await phone.waitForTimeout(80);
    const big = await phone.evaluate(() => { const b = window.__app.battle(); return { hp: b.enemies[b.current].hp, on: b.charge.on, cutin: !document.getElementById('cutin').hidden }; });
    ok(!big.on && hpBig - big.hp === Math.round(before.atk * 3.5 * 3), `指をずらしてから離しても、特大猫パンチが出る (${hpBig} → ${big.hp})`);
    ok(big.cutin, '特大猫パンチでカットインが出る');
    await phone.waitForTimeout(1100);

    // 長押しで iOS の虫眼鏡 (ルーペ) が出ないように: 指が触れた瞬間 (touchstart) を止めている。
    // chromium では虫眼鏡は出ないので、止めたかどうか (defaultPrevented) と、字を選べないことを見る
    await phone.evaluate(() => {
      window.__ts = [];
      window.addEventListener('touchstart', (e) => { window.__ts.push(e.target.id || e.target.closest('[id]').id, e.defaultPrevented); });
    });
    const fieldPt = await phone.evaluate(() => {
      const r = document.getElementById('fieldFg').getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return { x, y, id: document.elementFromPoint(x, y).id };
    });
    ok(fieldPt.id === 'fieldFg', `戦場の真ん中を押すと、戦場のキャンバスに当たる (${fieldPt.id})`);
    for (const pt of [await touchAt('#btnPunch'), await touchAt('#btnLure'), { x: fieldPt.x, y: fieldPt.y }]) {
      await touch('touchStart', pt);
      await phone.waitForTimeout(30);
      await touch('touchEnd');
      await phone.waitForTimeout(30);
    }
    const ts = await phone.evaluate(() => window.__ts);
    ok(ts.length === 6 && ts[1] && ts[3] && ts[5], `猫パンチ・猫じゃらし・戦場は、触れた瞬間を止めて虫眼鏡を出さない (${JSON.stringify(ts)})`);
    const sel = await phone.evaluate(() => ['#btnPunch .round-plate', '#btnLure .round-plate', '#fieldFg', '#chargeLabel', '.hud-top']
      .map((q) => { const el = document.querySelector(q); return el ? getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect : 'なし'; }));
    ok(sel.every((v) => v === 'none'), `ボタンの字・戦場・ゲージの字は選べない (${sel.join(', ')})`);
    await phone.waitForTimeout(700);

    // アイテム: 魚で体力が戻る
    await phone.evaluate(() => { window.__app.battle().player.hp = 10; });
    await phone.locator('#btnItem').tap();
    await phone.waitForTimeout(60);
    ok(await phone.evaluate(() => !document.getElementById('itemMenu').hidden), 'アイテムを押すと、魚とまたたびが選べる');
    await phone.locator('#btnFish').tap();
    await phone.waitForTimeout(60);
    const fish = await phone.evaluate(() => ({ hp: window.__app.battle().player.hp, left: window.__app.battle().items.fish, menu: document.getElementById('itemMenu').hidden }));
    ok(fish.hp > 10 && fish.left === 1 && fish.menu, `魚を使うと体力が戻り、1つ減る (体力 ${fish.hp}、残り ${fish.left})`);

    // 一時停止
    await phone.locator('#btnPause').tap();
    await phone.waitForTimeout(60);
    const tp0 = await phone.evaluate(() => window.__app.battle().t);
    await phone.waitForTimeout(400);
    const tp1 = await phone.evaluate(() => window.__app.battle().t);
    ok(tp0 === tp1 && await phone.evaluate(() => !document.getElementById('pausePanel').hidden), '一時停止すると、戦が止まる');
    await phone.locator('#btnResume').tap();
    await phone.waitForTimeout(200);
    ok(await phone.evaluate(() => window.__app.battle().t) > tp1, '「つづける」で再び動く');

    // 実際に踏んだ不具合の見張り: 最後の1匹をパンチで倒すと「勝った」の知らせが
    // stepBattle の外で出る。それを読まずにいたため、勝利の札が出ずに止まった
    await phone.evaluate(() => {
      const b = window.__app.battle();
      b.enemies.forEach((e, i) => { if (i < b.enemies.length - 1) { e.alive = false; e.hp = 0; e.state = 'down'; e.timer = 0; } });
      b.current = b.enemies.length - 1;
      const f = b.enemies[b.current];
      Object.assign(f, { state: 'charmed', charm: 5, hp: 1, x: 270, reward: 30 }); // 1勝で草履取り (20) に届くように
      b.cd.punch = 0;
    });
    await phone.locator('#btnPunch').tap();
    await phone.waitForFunction(() => !document.getElementById('resultPanel').hidden, null, { timeout: 5000 }).catch(() => {});
    const won = await phone.evaluate(() => ({
      panel: !document.getElementById('resultPanel').hidden,
      title: document.getElementById('resultTitle').textContent,
      wins: window.__app.state().battlesWon,
      rows: document.getElementById('resultRows').textContent
    }));
    ok(won.panel && won.title === '勝利!', `最後の1匹をパンチで倒しても、勝利の札が出る (${won.title})`);
    ok(won.wins === 1 && won.rows.includes('小判') && won.rows.includes('経験値'), `勝つと小判と経験値が入る`);
    const rankUp = await phone.evaluate(() => ({ shown: !document.getElementById('rankModal').hidden, name: document.getElementById('rankUpName').textContent }));
    ok(rankUp.shown && rankUp.name === '草履取り', `勝って経験値がたまると出世の札が出る (${rankUp.name})`);
    const rankArt = await phone.evaluate(() => document.getElementById('rankUpArt').src);
    ok(/stage1\.png/.test(rankArt), `出世の札に、成長した姿 (旅立ち) が出る (${rankArt.split('/').pop().slice(0, 20)})`);
    await phone.locator('#btnRankOk').tap();
    await phone.locator('#btnNext').tap();
    await phone.waitForTimeout(80);
    const title2 = await phone.evaluate(() => document.getElementById('readyTitle').textContent);
    ok(title2 === '第二戦', `つぎの戦へ進める (${title2})`);

    // 負けたとき: 倒したぶんの小判は持ち帰り、その場で修行して「もう一度」
    ok(await phone.evaluate(() => document.querySelectorAll('#readyTrain .train-btn').length === 2), '出陣の札に、修行 (体力・パンチ) の札が出ている');
    // 実際に踏んだ不具合の見張り: 出陣の札を開いたまま小判が増えても、修行の札が古いまま (手持ち 0) だった。
    // 書き換えはボタンを作り直さずに行う (作り直すと、押している最中に札が入れ替わって押したことにならない)
    await phone.evaluate(() => { document.querySelector('#readyTrain .train-hp').__mark = 1; });
    const m0 = await phone.evaluate(() => Math.floor(window.__app.state().merit));
    await phone.evaluate(() => { window.__app.debugAddMerit(7); window.__app.closeModals(); });
    await phone.waitForTimeout(120);
    const tr = await phone.evaluate(() => ({ head: document.querySelector('#readyTrain .train-head').textContent, same: document.querySelector('#readyTrain .train-hp').__mark === 1 }));
    ok(tr.head.includes('小判 ' + (m0 + 7)), `札を開いたまま小判が増えても、修行の札の手持ちが書き変わる (${tr.head.split('・').pop().trim()})`);
    ok(tr.same, '書き変わっても、ボタンは作り直さない');
    await phone.locator('#btnSortie').tap();
    const lb = await phone.evaluate(() => ({ merit: window.__app.state().merit, total: window.__app.state().totalMerit, maxHp: window.__app.battle().player.maxHp }));
    await phone.evaluate(() => { const b = window.__app.battle(); b.merit = 40; b.player.hp = 0; }); // 40 小判ぶん倒してから負けた
    await phone.waitForFunction(() => !document.getElementById('resultPanel').hidden, null, { timeout: 4000 }).catch(() => {});
    const lost = await phone.evaluate(() => ({
      title: document.getElementById('resultTitle').textContent,
      next: document.getElementById('btnNext').textContent,
      rows: document.getElementById('resultRows').textContent,
      wins: window.__app.state().battlesWon,
      merit: window.__app.state().merit,
      total: window.__app.state().totalMerit,
      train: !document.getElementById('resultTrain').hidden && document.querySelectorAll('#resultTrain .train-btn').length
    }));
    ok(lost.title === 'ひと休み…' && lost.next === 'もう一度', `負けると「ひと休み」になり、やり直せる (${lost.title})`);
    ok(lost.rows.includes('持ち帰った小判') && lost.merit >= lb.merit + 40 && lost.total === lb.total,
      `負けても、倒したぶんの小判は持ち帰る (小判 ${Math.floor(lb.merit)} → ${Math.floor(lost.merit)}、経験値は ${lost.total} のまま)`);
    ok(lost.wins === 1, '負けても勝った数は減らない');
    ok(lost.train === 2, '負けの札に、修行の札が出る');
    const hpBtn = phone.locator('#resultTrain .train-hp');
    const canTrain = await hpBtn.evaluate((el) => !el.disabled);
    ok(canTrain, '持ち帰った小判で、体力を鍛えられる');
    await hpBtn.tap();
    await phone.waitForTimeout(60);
    const trained = await phone.evaluate(() => ({ lv: window.Core.heroLevel(window.__app.state(), 'hp'), label: document.querySelector('#resultTrain .train-hp b').textContent }));
    ok(trained.lv === 1 && trained.label.includes('Lv1'), `指で押すと体力が1段上がり、札も書き変わる (${trained.label})`);
    await phone.locator('#btnNext').tap();
    await phone.waitForTimeout(80);
    const again = await phone.evaluate(() => window.__app.battle() && window.__app.battle().player.maxHp);
    ok(!!again, '「もう一度」ですぐ次の戦が始まる');
    ok(again === Math.round(lb.maxHp * 1.15), `鍛えたぶん、次の戦では体力が多い (${lb.maxHp} → ${again})`);

    // ------------------------------------------------ 家臣
    section('家臣');
    await phone.evaluate(() => { window.__app.debugAddMerit(400); window.__app.closeModals(); });
    ok(await phone.evaluate(() => !document.getElementById('tab-vassals').classList.contains('locked')),
      '足軽になると家臣タブの鍵が開く');
    await phone.locator('#tab-vassals').tap();
    await phone.waitForTimeout(80);
    ok(await phone.evaluate(() => window.__app.battle() && window.__app.tab() === 'vassals'), '合戦の途中で家臣の画面へ行ける');
    const tBefore = await phone.evaluate(() => window.__app.battle().t);
    await phone.waitForTimeout(400);
    const tAfter = await phone.evaluate(() => window.__app.battle().t);
    ok(tAfter === tBefore, '合戦の画面を離れている間は、戦が止まっている');

    await phone.locator('#btnRecruit').tap();
    await phone.waitForTimeout(80);
    const vs = await phone.evaluate(() => window.__app.state().vassals.length);
    ok(vs === 1, `村で仲間を募れる (${vs}人)`);
    ok(await phone.evaluate(() => { const im = document.querySelector('.vassal-card img'); return im && im.naturalWidth > 20; }),
      '家臣の姿が設定資料の絵で出る');
    // 得意技: 札に名前と強さが出る。出陣していないときは「出陣で効く」と添える
    const sk0 = await phone.evaluate(() => {
      const v = window.__app.state().vassals[0];
      const el = document.querySelector('.vassal-card .vassal-skill');
      return { skill: v.skill, text: el ? el.textContent : '', on: el ? el.classList.contains('on') : null };
    });
    const skName = await phone.evaluate((k) => window.Core.VASSAL_SKILLS[k].name, sk0.skill);
    ok(sk0.text.includes(skName) && sk0.text.includes('出陣で効く') && sk0.on === false, `家臣の札に得意技が出る (${sk0.text.slice(0, 30)}…)`);
    await phone.locator('.vassal-card .job').nth(2).tap();
    await phone.waitForTimeout(60);
    ok(await phone.evaluate(() => window.__app.state().vassals[0].job === 'battle'), '役目を「出陣」にできる');
    ok(await phone.evaluate(() => { const el = document.querySelector('.vassal-card .vassal-skill'); return el.classList.contains('on') && !el.textContent.includes('出陣で効く'); }),
      '出陣にすると、得意技の札が「効いている」表示になる');
    const eff1 = await phone.evaluate(() => document.querySelector('.vassal-card .skill-effect').textContent);
    await phone.locator('.vassal-train').first().tap();
    await phone.waitForTimeout(60);
    ok(await phone.evaluate(() => window.__app.state().vassals[0].level === 2), '家臣を鍛えるとレベルが上がる');
    const eff2 = await phone.evaluate(() => document.querySelector('.vassal-card .skill-effect').textContent);
    ok(eff1 !== eff2, `鍛えると得意技も強くなる (${eff1} → ${eff2})`);

    await phone.locator('#tab-battle').tap();
    await phone.evaluate(() => { const b = window.__app.battle(); if (b) b.player.hp = 0; });
    await phone.waitForFunction(() => !document.getElementById('resultPanel').hidden, null, { timeout: 4000 }).catch(() => {});
    await phone.locator('#btnNext').tap();
    await phone.waitForTimeout(80);
    ok(await phone.evaluate(() => window.__app.battle().allies.length === 1), '出陣の家臣が、次の戦でいっしょに戦う');
    // 癒やし猫にして、戦いの最中に体力が戻るのを見る (画面に「+N」が出る知らせ)
    await phone.evaluate(() => {
      const b = window.__app.battle();
      b.allies[0].skill = 'heal';
      b.skills = window.Core.battleSkills(b.allies);
      b.player.hp = 5;
      b.healCd = 0.2;
      b.enemies.forEach((e) => { e.cd = 999; });
    });
    await phone.waitForTimeout(500);
    const healed = await phone.evaluate(() => window.__app.battle().player.hp);
    ok(healed > 5, `癒やし猫が、戦いの最中に体力を戻す (5 → ${healed})`);

    // ------------------------------------------------ 城主 → 城と村
    section('城と村 (マスに建てる地図)');
    await phone.evaluate(() => { window.__app.debugAddMerit(10000); window.__app.closeModals(); window.__app.debugSetMaterials(3000); });
    ok(await phone.evaluate(() => !document.getElementById('tab-castle').classList.contains('locked')),
      '城主になると城タブの鍵が開く');
    await phone.locator('#tab-castle').tap();
    await phone.waitForTimeout(100);
    const tapCell = async (zone, idx) => {
      const p = await phone.evaluate(([z, i]) => window.__app.cellPoint(z, i), [zone, idx]);
      await phone.touchscreen.tap(p.x, p.y);
      await phone.waitForTimeout(60);
      return phone.evaluate((z) => window.__app.selected(z), zone);
    };
    // 押した場所の読み取りが合っているか: 真ん中だけでなく、四隅のマスでも確かめる
    const picks = [];
    for (const idx of [0, 5, 30, 35, 14]) {
      const got = await tapCell('castle', idx);
      picks.push(idx + '→' + got);
      await tapCell('castle', idx); // もう一度押して閉じる
    }
    ok(picks.every((p) => { const [a, b] = p.split('→'); return a === b; }), `マスを指で押すと、そのマスが選ばれる (${picks.join(' ')})`);

    await tapCell('castle', 14);
    ok(await phone.evaluate(() => !document.getElementById('castleSheet').hidden), '空きマスを押すと、建てる物の札が出る');
    const cards = await phone.evaluate(() => [...document.querySelectorAll('#castleSheet .build-card')].map((c) => c.dataset.type));
    ok(cards.includes('keep') && !cards.includes('house'), `城の札には城の建物だけが並ぶ (${cards.length}種)`);
    const cardImgs = await phone.evaluate(() => [...document.querySelectorAll('#castleSheet .build-card img')].every((im) => im.naturalWidth > 20));
    ok(cardImgs, '札に施設の絵が出る');
    await phone.locator('#castleSheet .build-card[data-type="keep"]').tap();
    await phone.waitForTimeout(80);
    ok(await phone.evaluate(() => window.__app.state().castle.cells[14] === 'keep' && !document.getElementById('castleBanner').hidden),
      'お城を建てると、お城完成の札が出る');
    ok(await phone.evaluate(() => [...document.querySelectorAll('#castleEffects span')].some((s) => s.textContent.includes('小判'))),
      '建てた物の効果が、地図の下に出る');

    await tapCell('castle', 14);
    ok(await phone.evaluate(() => !!document.querySelector('#castleSheet .demolish')), '建っているマスを押すと、取り壊しの札が出る');
    const mat0 = await phone.evaluate(() => window.__app.state().materials);
    await phone.locator('#castleSheet .demolish').tap();
    await phone.waitForTimeout(60);
    const afterDemolish = await phone.evaluate(() => ({ cell: window.__app.state().castle.cells[14], mat: window.__app.state().materials }));
    ok(afterDemolish.cell === null && afterDemolish.mat > mat0, '取り壊すとマスが空き、資材が少し戻る');

    await phone.locator('#tab-village').tap();
    await phone.waitForTimeout(100);
    await tapCell('village', 0);
    await phone.locator('#villageSheet .build-card[data-type="house"]').tap();
    await phone.waitForTimeout(60);
    ok(await phone.evaluate(() => window.__app.state().village.cells[0] === 'house'), '村の角のマスに民家を建てられる');
    const popBefore = await phone.evaluate(() => window.__app.state().village.population);
    await phone.waitForTimeout(2000);
    const popAfter = await phone.evaluate(() => window.__app.state().village.population);
    ok(popAfter > popBefore, `村人猫が時間で増える (${popBefore.toFixed(2)} → ${popAfter.toFixed(2)})`);
    const walkers = await phone.evaluate(() => window.__app.walkers('village'));
    ok(walkers === Math.min(16, Math.floor(popAfter)), `村人猫が地図の上を歩いている (${walkers}匹)`);
    const mapPx = await phone.evaluate(() => {
      const c = document.querySelector('#villageMap .map-bg');
      const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.6), 1, 1).data;
      return d[1] > d[0] && d[3] > 0;
    });
    ok(mapPx, '村の地面 (草のマス) が描かれている');

    const wideAll = await phone.evaluate(async () => {
      const out = [];
      for (const t of ['battle', 'vassals', 'castle', 'village']) {
        window.__app.setTab(t);
        await new Promise((r) => requestAnimationFrame(r));
        out.push(document.documentElement.scrollWidth - document.documentElement.clientWidth);
      }
      return Math.max(...out);
    });
    ok(wideAll <= 1, 'どのタブでも横スクロールが出ない');

    // ------------------------------------------------ 横画面
    section('横画面 (端末を横にすると、合戦を大きく見る)');
    const portraitLayout = await phone.evaluate(() => window.__app.layout());
    {
      const LW = 932, LH = 430, SAFE = { l: 59, r: 59, b: 21 };
      const land = await browser.newContext({ ...device, viewport: { width: LW, height: LH }, screen: { width: LW, height: LH } });
      // 実機の横画面は、左右に 59pt・下に 21pt の安全域がある。chromium では env() が 0 なので、変数でまねる
      await land.addInitScript((sf) => {
        const put = () => {
          const st = document.createElement('style');
          st.id = 'fake-safe';
          st.textContent = `:root{--safe-l:${sf.l}px;--safe-r:${sf.r}px;--safe-b:${sf.b}px}`;
          (document.head || document.documentElement).appendChild(st);
        };
        if (document.documentElement) put(); else document.addEventListener('readystatechange', put, { once: true });
      }, SAFE);
      const lp = await land.newPage();
      lp.on('pageerror', (e) => errors.push('横: ' + e.message));
      lp.on('console', (m) => { if (m.type() === 'error') errors.push('横: ' + m.text()); });
      await lp.bringToFront();
      await lp.goto(URL);
      await lp.waitForFunction(() => window.__app);
      const inside = (r) => r.left >= -1 && r.top >= -1 && r.right <= LW + 1 && r.bottom <= LH + 1;
      const rectOf = (sel) => lp.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);

      await lp.waitForFunction(() => document.querySelector('.title-art').complete);
      await checkTitle(lp, SAFE.b);
      ok(await lp.evaluate(() => getComputedStyle(document.querySelector('.title-hint')).display === 'none'), '横では「よこにすると」の添え書きを出さない');
      await lp.locator('#btnStart').tap();
      await lp.waitForTimeout(200);
      const card = await rectOf('#storyModal .modal-card');
      ok(inside(card), `物語の札が画面に収まる (${Math.round(card.width)}x${Math.round(card.height)})`);
      await lp.locator('#btnStory').tap();
      await lp.waitForTimeout(200);
      ok(await lp.evaluate(() => document.getElementById('storyModal').hidden), '物語の「旅立つ!」を指で押せる');

      const tab = await rectOf('#tabbar');
      ok(tab.right < 140 && tab.height > LH - 2, `タブは左の縦帯になる (幅 ${Math.round(tab.width)})`);
      const scene = await rectOf('#field');
      ok(scene.left >= tab.right - 1 && scene.right >= LW - 1 && scene.height >= LH - 1, `戦場はタブの右から、画面の右端・下端まで広がる (${Math.round(scene.width)}x${Math.round(scene.height)})`);

      await lp.evaluate(() => window.__app.sortie());
      await lp.waitForFunction(() => { const b = window.__app.battle(); const e = b && b.enemies[b.current]; return e && e.state === 'idle'; }, null, { timeout: 8000 });
      await lp.waitForTimeout(100);
      const R = {};
      for (const [k, q] of Object.entries({ player: '.unit-player', enemy: '#enemyUnit', pause: '#btnPause', mission: '#mission', charge: '#chargeGauge', item: '#btnItem', lure: '#btnLure', punch: '#btnPunch' })) R[k] = await rectOf(q);
      ok(R.lure.left >= tab.right && R.lure.bottom <= LH - SAFE.b && R.punch.right <= LW - SAFE.r && R.punch.bottom <= LH - SAFE.b && R.pause.right <= LW - SAFE.r,
        '猫じゃらし・猫パンチ・一時停止は安全域の内側 (角の丸みや指の帯にかからない)');
      const names = Object.keys(R);
      const hits = [];
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        const a = R[names[i]], b = R[names[j]];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits.push(names[i] + '×' + names[j]);
      }
      ok(hits.length === 0, `上の札と下のボタンが重ならない${hits.length ? ' (' + hits.join(', ') + ')' : ''}`);

      const L = await lp.evaluate(() => window.__app.layout());
      const fl = scene.left;
      ok(L.land && L.s > portraitLayout.s * 1.05, `横では、ねこが縦より大きく描かれる (倍率 縦 ${portraitLayout.s.toFixed(2)} → 横 ${L.s.toFixed(2)})`);
      ok(L.heroX - L.heroHalf > R.lure.right - fl && L.enemyX < R.punch.left - fl, `自分と敵は、左右のボタンの間に立つ (自分 ${Math.round(L.heroX)} / 敵 ${Math.round(L.enemyX)})`);
      ok(L.ground <= R.lure.bottom - fl * 0 && L.ground > LH * 0.75, `足もとは画面の下の方、ボタンの下端より上 (${L.ground})`);
      // 敵の頭の上には「会心の猫パンチ!」「バシッ!」が出る。上に重ねた札がそこを隠さないこと
      // (前の肉球ゲージを右上に置いたら、会心の字がゲージの下に隠れた。いまの溜めゲージは猫パンチの上)
      {
        const top = L.ground - 150 * L.s - 70 * L.s - 24;
        const pop = { left: fl + L.enemyX - 100, right: fl + L.enemyX + 100, top: top, bottom: L.ground };
        const cover = ['charge', 'mission', 'item', 'player'].filter((k) => { const a = R[k]; return a.left < pop.right && pop.left < a.right && a.top < pop.bottom && pop.top < a.bottom; });
        ok(cover.length === 0, `敵の頭の上 (当たったときの字が出る所) を、札が隠さない${cover.length ? ' (' + cover.join(',') + ')' : ''}`);
      }
      ok(L.enterLeft >= L.w, `敵は画面の右の外から歩いてくる (出だしの左端 ${Math.round(L.enterLeft)} ≥ 幅 ${L.w})`);
      ok(await lp.evaluate(() => { const c = document.getElementById('fieldBg'); const d = c.getContext('2d').getImageData(c.width - 4, Math.floor(c.height * 0.3), 1, 1).data; return d[3] > 0; }),
        '背景が戦場の右端まで描かれている');
      await checkBattleBg(lp, '横');

      // 猫じゃらしとパンチを指で押す
      await lp.locator('#btnLure').tap();
      await lp.waitForTimeout(60);
      ok(await lp.evaluate(() => { const b = window.__app.battle(); return b.enemies[b.current].muchu > 0; }), '横でも猫じゃらしを指で押せる (夢中ゲージがたまる)');
      const hp0 = await lp.evaluate(() => { const b = window.__app.battle(); return b.enemies[b.current].hp; });
      await lp.locator('#btnPunch').tap();
      await lp.waitForTimeout(60);
      ok(await lp.evaluate((h) => { const b = window.__app.battle(); return b.enemies[b.current].hp < h; }, hp0), '横でも猫パンチを指で押せる');
      await lp.locator('#btnItem').tap();
      const menu = await rectOf('#itemMenu');
      ok(inside(menu), 'アイテムの一覧が画面に収まる');
      await lp.locator('#btnItem').tap();

      // 回す: 横 → 縦 → 横。そのたびに戦場を組み直す
      // 回すと安全域も変わる (縦: 上 59pt・下 34pt、左右は無し)
      const setSafe = (css) => lp.evaluate((c) => { document.getElementById('fake-safe').textContent = ':root{' + c + '}'; }, css);
      await setSafe('--safe-t:59px;--safe-b:34px;--safe-l:0px;--safe-r:0px');
      await lp.setViewportSize({ width: 430, height: 932 });
      await lp.waitForTimeout(250);
      const P = await lp.evaluate(() => window.__app.layout());
      ok(!P.land && P.w === 430 && P.ground === P.h - 150, `縦に戻すと、縦の並びに組み直す (幅 ${P.w}・足もと ${P.ground}/${P.h})`);
      await setSafe(`--safe-t:0px;--safe-b:${SAFE.b}px;--safe-l:${SAFE.l}px;--safe-r:${SAFE.r}px`);
      await lp.setViewportSize({ width: LW, height: LH });
      await lp.waitForTimeout(250);
      const L2 = await lp.evaluate(() => window.__app.layout());
      ok(L2.land && L2.w === L.w && L2.ground === L.ground, `また横にすると、同じ並びに戻る (幅 ${L2.w}・足もと ${L2.ground})`);

      // 勝利の札・出世の札
      await lp.evaluate(() => { const b = window.__app.battle(); b.enemies.forEach((e) => { e.hp = 0.1; }); });
      for (let i = 0; i < 40; i++) {
        if (await lp.evaluate(() => { const b = window.__app.battle(); return !b || b.phase !== 'fight'; })) break;
        await lp.evaluate(() => { const a = window.__app, b = a.battle(), e = b.enemies[b.current]; if (e && !['down', 'enter', 'wait'].includes(e.state)) { e.state = 'charmed'; e.charm = 3; a.punch(); } });
        await lp.waitForTimeout(250);
      }
      await lp.waitForFunction(() => !document.getElementById('resultPanel').hidden, null, { timeout: 8000 });
      const rp = await rectOf('#resultPanel');
      ok(inside(rp) && rp.left > L.heroX + fl, `勝利の札は画面に収まり、自分の姿を隠さないよう右に寄る (左端 ${Math.round(rp.left)})`);
      const pz = await rectOf('#btnPause');
      ok(Math.abs(pz.right - (LW - SAFE.r - 8)) <= 1, `敵の札が消えても、一時停止は右上に残る (右端 ${Math.round(pz.right)})`);
      if (await lp.evaluate(() => !document.getElementById('rankModal').hidden)) {
        const rc = await rectOf('#rankModal .modal-card');
        ok(inside(rc), '出世の札が画面に収まる');
      }

      // ほかのタブも横で崩れない
      await lp.evaluate(() => { const a = window.__app; a.closeModals(); a.debugAddMerit(6000); a.closeModals(); });
      const wideTabs = [];
      for (const t of ['vassals', 'castle', 'village']) {
        await lp.evaluate((tt) => window.__app.setTab(tt), t);
        await lp.waitForTimeout(150);
        const wv = await lp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (wv > 1) wideTabs.push(t);
      }
      ok(wideTabs.length === 0, '家臣・城・村のタブも、横で横スクロールが出ない' + (wideTabs.length ? ' (' + wideTabs.join(',') + ')' : ''));
      const vm = await rectOf('#villageMap');
      ok(vm.width <= 470 && vm.left >= tab.right, `村の地図は読みやすい幅に収まる (${Math.round(vm.width)}px)`);
      await land.close();
    }

    // ------------------------------------------------ 誘導 (侍から。大きなボス猫の突進を、猫じゃらしで樽へ)
    section('誘導 (ボス猫の突進を、猫じゃらしで樽へ)');
    for (const [vw, vh, safe] of [[430, 932, ':root{--safe-t:59px;--safe-b:34px}'], [932, 430, ':root{--safe-l:59px;--safe-r:59px;--safe-b:21px}']]) {
      const yc = await browser.newContext({ ...device, viewport: { width: vw, height: vh } });
      const yp = await yc.newPage();
      yp.on('pageerror', (e) => errors.push('誘導: ' + e.message));
      await yp.bringToFront();
      await yp.goto(URL);
      await yp.waitForFunction(() => window.__app);
      await yp.addStyleTag({ content: safe });
      const tag = `${vw}x${vh}`;
      await yp.evaluate(() => { const a = window.__app; a.start(); a.closeStory(); a.debugAddMerit(window.Core.RANKS[window.Core.YUDO_RANK].threshold); a.closeModals(); a.setTab('battle'); a.sortie(); });
      // 大将 (大きなボス猫) まで飛ばす
      await yp.evaluate(() => {
        const b = window.__app.battle();
        b.enemies.forEach((e, i) => { if (i < b.enemies.length - 1) { e.alive = false; e.hp = 0; e.state = 'down'; e.timer = 0.01; } });
        b.current = b.enemies.length - 2;
      });
      await yp.waitForFunction(() => { const b = window.__app.battle(); const e = b.enemies[b.current]; return b.current === b.enemies.length - 1 && e.state === 'idle'; }, null, { timeout: 8000 });
      await yp.evaluate(() => { const b = window.__app.battle(); const e = b.enemies[b.current]; e.hp = e.maxHp = 99999; e.cd = 0.7; });
      await yp.waitForFunction(() => { const b = window.__app.battle(); return b.enemies[b.current].state === 'rushWarn'; }, null, { timeout: 4000 });
      ok(await yp.evaluate(() => window.__app.mood() === 'rush'), `${tag}: ボス猫が突進の予告 (赤い「!!」) をする`);
      // 頭の上のしるしが、上の札の裏に隠れない (背の高いボス猫で、敵の札の裏に隠れていた)
      const mt = await yp.evaluate(() => ({ top: window.__app.moodTop(), hud: document.querySelector('.hud-top').getBoundingClientRect().bottom - document.getElementById('field').getBoundingClientRect().top }));
      ok(mt.top >= mt.hud, `${tag}: 予告のしるしと「じゃらして樽へ!」が、上の札より下に出る (上端 ${Math.round(mt.top)} ≥ 札の下 ${Math.round(mt.hud)})`);
      // 樽の山は、ボタンと重ならず、画面の中にある
      const L = await yp.evaluate(() => window.__app.layout());
      const fr = await yp.evaluate(() => { const r = document.getElementById('field').getBoundingClientRect(); return { left: r.left, top: r.top }; });
      const btns = await yp.evaluate(() => ['btnLure', 'btnItem', 'btnPunch'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
      const ob = { left: L.obstacle.left + fr.left, right: L.obstacle.right + fr.left, top: L.obstacle.top + fr.top, bottom: L.obstacle.bottom + fr.top };
      const hit = btns.filter((r) => r.left < ob.right && ob.left < r.right && r.top < ob.bottom && ob.top < r.bottom).map((r) => r.id);
      ok(hit.length === 0 && ob.left >= fr.left - 1, `${tag}: 樽の山がボタンに重ならず、画面の中にある${hit.length ? ' (' + hit.join(',') + ')' : ''}`);
      // 指で猫じゃらしを押すと、樽へ突っ込んで目を回す
      const hp0 = await yp.evaluate(() => window.__app.battle().player.hp);
      await yp.locator('#btnLure').tap();
      await yp.waitForFunction(() => { const b = window.__app.battle(); return b.enemies[b.current].state === 'charmed'; }, null, { timeout: 4000 }).catch(() => {});
      const after = await yp.evaluate(() => { const b = window.__app.battle(); const e = b.enemies[b.current]; return { st: e.state, dizzy: e.dizzy, ob: b.obstacle.ok, hp: b.player.hp, ready: document.getElementById('btnPunch').classList.contains('ready') }; });
      ok(after.st === 'charmed' && after.dizzy && !after.ob && after.hp === hp0,
        `${tag}: 予告の間に猫じゃらしを指で押すと、樽へ突っ込んで目を回す (こちらは無傷・樽はこわれる)`);
      ok(after.ready, `${tag}: 目を回している間は、猫パンチのボタンが光る (今だ!)`);
      await yc.close();
    }

    // ------------------------------------------------ 天下 (日本地図の国とり)
    section('天下 (日本地図で、となりの大名を倒して天下統一)');
    for (const [vw, vh, safe] of [[430, 932, ':root{--safe-t:59px;--safe-b:34px}'], [932, 430, ':root{--safe-l:59px;--safe-r:59px;--safe-b:21px}']]) {
      const rc = await browser.newContext({ ...device, viewport: { width: vw, height: vh } });
      const rp = await rc.newPage();
      rp.on('pageerror', (e) => errors.push('天下: ' + e.message));
      rp.on('console', (m) => { if (m.type() === 'error') errors.push('天下: ' + m.text()); });
      await rp.bringToFront();
      await rp.goto(URL);
      await rp.waitForFunction(() => window.__app);
      await rp.addStyleTag({ content: safe });
      const tag = `${vw}x${vh}`;
      const tapPref = async (id) => { const pt = await rp.evaluate((i) => window.__app.prefPoint(i), id); await rp.touchscreen.tap(pt.x, pt.y); };
      const settle = () => rp.waitForFunction(() => !window.__app.realmAnimating(), null, { timeout: 3000 });
      const rect = (sel) => rp.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);

      await rp.evaluate(() => { const a = window.__app; a.start(); a.closeStory(); });
      await rp.locator('#tab-realm').tap();
      const locked = await rp.evaluate(() => ({ tab: document.querySelector('#tab-realm .tab-label').textContent, note: !document.getElementById('realmLocked').hidden }));
      ok(locked.tab.includes('🔒') && locked.note, `${tag}: 侍になるまでは、天下の地図は鍵つき`);
      await rp.evaluate(() => { const a = window.__app; a.debugAddMerit(window.Core.RANKS[window.Core.REALM_UNLOCK_RANK].threshold); a.closeModals(); a.setTab('realm'); });
      await rp.waitForTimeout(200);

      // 地図と札が画面に収まる (縦: 地図の下に札 / 横: 右に札)
      const map = await rect('#realmMap'), sheet = await rect('#realmSheet'), tabs = await rect('#tabbar');
      ok(map.height >= (vw < vh ? 420 : 380) && map.width >= (vw < vh ? 400 : 440), `${tag}: 地図が大きく出る (${Math.round(map.width)}x${Math.round(map.height)})`);
      if (vw < vh) ok(sheet.bottom <= tabs.top + 1 && sheet.top > map.top + map.height * 0.3, `${tag}: 札は地図の下の方に重なり、タブより上`);
      else ok(sheet.left > map.left + map.width * 0.5 && sheet.right <= vw - 59 + 1 && sheet.bottom <= vh - 21 + 1, `${tag}: 札は地図の右に重なり、安全域の内側`);
      // 見本 (art/realm-mock.png) の飾りがそろっていて、地図を押す指をさえぎらない
      const deco = await rp.evaluate(() => ['realmTitle', 'realmGuide', 'realmRemain'].map((id) => {
        const el = document.getElementById(id); return { id, pe: getComputedStyle(el).pointerEvents, img: el.tagName !== 'IMG' || el.naturalWidth > 0 };
      }));
      ok(deco.every((d) => d.pe === 'none' && d.img), `${tag}: 題字・案内の猫・「あと ○ 国」の帯は、指を通す (${deco.map((d) => d.id + ':' + d.pe).join(', ')})`);
      const inView = (r) => r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1;
      const top = await rect('#realmTop'), title = await rect('#realmTitle');
      ok(inView(top) && inView(title) && (title.right <= top.left + 1 || title.bottom <= top.top + 1), `${tag}: 題字と上の帯が画面に収まり、重ならない`);

      // 任される国を指で選ぶ
      await tapPref(23); await settle();
      ok(await rp.evaluate(() => window.__app.selectedPref()) === 23, `${tag}: 地図の愛知を指で押すと選べる`);
      await rp.locator('[data-act="start"]').tap();
      await rp.waitForTimeout(100);
      const st0 = await rp.evaluate(() => { const s = window.__app.state(); return { home: s.realm && s.realm.home, sub: document.getElementById('realmSub').textContent }; });
      ok(st0.home === 23 && st0.sub.includes('1/47'), `${tag}: 「はじめる」で愛知を任される (${st0.sub})`);
      const chrome = await rp.evaluate(() => ({ left: document.getElementById('realmLeft').textContent, remain: !document.getElementById('realmRemain').hidden, bubble: document.getElementById('realmBubble').textContent }));
      ok(chrome.remain && chrome.left === '46' && chrome.bubble.length > 0, `${tag}: 「天下統一まであと 46 国」の帯と、案内の猫のひとことが出る (${chrome.bubble})`);

      // 47 都道府県ぜんぶ、指で選べる (小さな県は、1 回目で寄り、2 回目で選べる)
      if (vw < vh) {
        const miss = [], small = [], hidden = [];
        for (let id = 1; id <= 47; id++) {
          await rp.evaluate(() => window.__app.realmFitAll());
          let got = null;
          for (let n = 0; n < 2 && got !== id; n++) { await tapPref(id); await settle(); got = await rp.evaluate(() => window.__app.selectedPref()); }
          if (got !== id) miss.push(id + '→' + got);
          // 選んだあとは、その県が指で押せる大きさまで寄っていて (ふちから 10px 以上の所がある)、札に隠れていない
          const pt = await rp.evaluate((i) => window.__app.prefPoint(i), id);
          if (pt.room < 10) small.push(id + ':' + pt.room.toFixed(1));
          const fr = await rp.evaluate(() => window.__app.realmFreeRect());
          if (pt.y > fr.bottom || pt.y < fr.top || pt.x < fr.left || pt.x > fr.right) hidden.push(id);
        }
        ok(miss.length === 0, `${tag}: 日本全体の地図から、47 都道府県ぜんぶを指 2 回以内で選べる${miss.length ? ' (だめ: ' + miss.join(',') + ')' : ''}`);
        ok(small.length === 0, `${tag}: 選ぶと、小さな県 (東京・大阪・香川など) も指で押せる大きさまで寄る${small.length ? ' (だめ: ' + small.join(',') + ')' : ''}`);
        ok(hidden.length === 0, `${tag}: 選んだ県は、札や題字に隠れない${hidden.length ? ' (だめ: ' + hidden.join(',') + ')' : ''}`);
      }

      // 指で地図を動かしている最中は、47 県を塗り直さない (描いておいた絵をずらして貼るだけ。
      // 塗り直すと CPU4倍遅で 1コマ 33ms だった)。離したら 1 回だけ描き直す
      {
        const cdp = await rc.newCDPSession(rp);
        const c = await rect('#realmCanvas');
        const x0 = c.left + c.width / 2, y0 = c.top + 150;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
        await rp.waitForTimeout(50);
        const d0 = await rp.evaluate(() => window.__app.realmFullDraws());
        const cam0 = await rp.evaluate(() => window.__app.realmCam());
        for (let i = 1; i <= 20; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 4, y: y0 + i * 3 }] });
          await rp.waitForTimeout(16);
        }
        const d1 = await rp.evaluate(() => window.__app.realmFullDraws());
        const cam1 = await rp.evaluate(() => window.__app.realmCam());
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await rp.waitForTimeout(100);
        const d2 = await rp.evaluate(() => window.__app.realmFullDraws());
        ok(Math.hypot(cam1.x - cam0.x, cam1.y - cam0.y) > 20 / cam0.k, `${tag}: 指 1 本で地図を動かせる`);
        ok(d1 - d0 <= 1 && d2 - d1 === 1, `${tag}: 動かしている最中は塗り直さず、離したら 1 回だけ描き直す (最中 ${d1 - d0} 回・離して ${d2 - d1} 回)`);
        await cdp.detach();
      }

      // 兵を指で買う
      await rp.evaluate(() => { window.__app.debugSetState((s) => Object.assign({}, s, { merit: 175 })); window.__app.realmFitAll(); });
      await tapPref(22); await settle();
      const sel22 = await rp.evaluate(() => window.__app.selectedPref());
      if (sel22 !== 22) { await tapPref(22); await settle(); }
      ok(await rp.evaluate(() => window.__app.selectedPref()) === 22, `${tag}: となりの静岡を指で選べる`);
      const buyBtn = await rp.evaluate(() => { window.__buy = document.querySelector('[data-act="buy"]'); return !!window.__buy; });
      await rp.locator('[data-act="buy"]').tap();
      await rp.locator('[data-act="buy"]').tap();
      const bought = await rp.evaluate(() => ({ t: window.Core.troopsAt(window.__app.state(), 23), m: window.__app.state().merit, send: document.querySelector('[data-v="send"]').textContent, same: window.__buy === document.querySelector('[data-act="buy"]') }));
      // 小判は年貢で少しずつ増えるので、切り捨てで見る
      ok(buyBtn && bought.t === 700 && Math.floor(bought.m) === 75 && bought.send === '700', `${tag}: 「兵を100 買う」を 2 回押すと、愛知の兵が 700・小判が 100 減る (連れて行く兵も 700) (${bought.t}, ${bought.m.toFixed(2)}, ${bought.send})`);
      ok(bought.same, `${tag}: 買っても札のボタンは作り直さない (押している最中に入れ替わらない)`);
      await rp.evaluate(() => window.__app.debugAddCoins(1000));
      await rp.waitForTimeout(400);
      const grown = await rp.evaluate(() => ({ same: window.__buy === document.querySelector('[data-act="buy"]'), sub: document.getElementById('realmSub').textContent }));
      ok(grown.same && /小判 107\d/.test(grown.sub), `${tag}: 開いたまま小判が増えると上の数字が変わり、ボタンは同じもの (${grown.sub})`);

      // 出陣 → 大名との合戦 → 勝つと国が増える
      await rp.locator('[data-act="attack"]').tap();
      await rp.waitForTimeout(150);
      const cb = await rp.evaluate(() => { const b = window.__app.battle(); return { tab: window.__app.tab(), cq: b && b.conquest && b.conquest.to, last: b && b.enemies[b.enemies.length - 1].name, mission: document.getElementById('missionText').textContent }; });
      ok(cb.tab === 'battle' && cb.cq === 22 && cb.last === 'いまがわ にゃしもと', `${tag}: 「出陣!」で合戦になり、最後の敵は静岡の大名 (${cb.last})`);
      ok(cb.mission.includes('静岡'), `${tag}: お題が「静岡の大名を倒す」になる (${cb.mission})`);
      await rp.evaluate(() => { const b = window.__app.battle(); b.enemies.forEach((e, i) => { if (i < b.enemies.length - 1) { e.alive = false; e.hp = 0; e.state = 'down'; e.timer = 0.01; } }); b.current = b.enemies.length - 2; });
      await rp.waitForFunction(() => { const b = window.__app.battle(); const e = b && b.enemies[b.current]; return e && b.current === b.enemies.length - 1 && e.state === 'idle'; }, null, { timeout: 8000 });
      ok(await rp.evaluate(() => document.getElementById('enemyName').textContent === window.Core.prefOf(22).daimyo), `${tag}: 上の札に大名の名前が出る`);
      await rp.evaluate(() => { const b = window.__app.battle(); b.enemies[b.current].hp = 1; window.__app.punch(); });
      await rp.waitForFunction(() => !document.getElementById('resultPanel').hidden, null, { timeout: 6000 });
      const won = await rp.evaluate(() => ({ title: document.getElementById('resultTitle').textContent, next: document.getElementById('btnNext').textContent, mine: window.Core.isMine(window.__app.state(), 22) }));
      ok(won.title.includes('静岡') && won.mine, `${tag}: 大名を倒すと静岡が自分の国になる (${won.title})`);
      await rp.locator('#btnNext').tap();
      await rp.waitForTimeout(300);
      const back = await rp.evaluate(() => ({ tab: window.__app.tab(), sub: document.getElementById('realmSub').textContent, sel: window.__app.selectedPref() }));
      ok(back.tab === 'realm' && back.sub.includes('2/47') && back.sel === 22, `${tag}: 「${won.next}」で地図へ戻り、国が 2 つになっている (${back.sub})`);

      // 退却すると、連れて行った兵の半分が戻らない
      await rp.evaluate(() => window.__app.debugSetState((s) => { const r = JSON.parse(JSON.stringify(s.realm)); r.troops[21] = 400; r.troops[22] = 0; return Object.assign({}, s, { realm: r }); }));
      await rp.evaluate(() => window.__app.realmFitAll());
      await tapPref(14); await settle();
      if (await rp.evaluate(() => window.__app.selectedPref()) !== 14) { await tapPref(14); await settle(); }
      await rp.locator('[data-act="attack"]').tap();
      await rp.waitForTimeout(150);
      await rp.locator('#btnPause').tap();
      const rt = await rp.evaluate(() => document.getElementById('btnRetreat').textContent);
      await rp.locator('#btnRetreat').tap();
      await rp.waitForTimeout(300);
      const after = await rp.evaluate(() => ({ tab: window.__app.tab(), t: window.Core.troopsAt(window.__app.state(), 22) }));
      ok(rt.includes('半分') && after.tab === 'realm' && after.t === 200, `${tag}: 退却すると兵が半分 (400 → ${after.t}) になって地図へ戻る。退却のボタンにもそう書いてある`);

      // 「もどる」で合戦へ
      await rp.locator('#btnRealmBack').tap();
      ok(await rp.evaluate(() => window.__app.tab()) === 'battle', `${tag}: 「もどる」を押すと合戦の画面へ戻る`);
      await rp.evaluate(() => window.__app.setTab('realm'));

      // 敵の大名が攻めてくる: 知らせ・秒読み・迎え撃つ・何もしないと取られる
      {
        await rp.evaluate(() => window.__app.debugSetState((s) => {
          const r = JSON.parse(JSON.stringify(s.realm));
          [21, 20].forEach((id) => { r.mine[id - 1] = true; r.troops[id - 1] = 300; });
          r.invasion = null; r.nextInvasion = 1;
          return Object.assign({}, s, { realm: r });
        }));
        await rp.evaluate(() => window.__app.realmStep(2));
        const inv = await rp.evaluate(() => window.__app.state().realm.invasion);
        ok(!!inv && inv.left > 0, `${tag}: 自分の国が 3 つ以上になると、敵の大名が攻めてくる (${inv && inv.from}→${inv && inv.to})`);
        // ほかの画面にいても、下の知らせで分かる。押すと天下の地図の、攻められている国へ
        await rp.evaluate(() => window.__app.setTab('vassals'));
        await rp.waitForTimeout(100);
        const bar = await rp.evaluate(() => ({ shown: !document.getElementById('invasionBar').hidden, text: document.getElementById('invasionBar').textContent }));
        ok(bar.shown && /あと \d+ 秒/.test(bar.text), `${tag}: ほかの画面では、下に知らせの帯が出る (${bar.text})`);
        await rp.locator('#invasionBar').tap();
        await rp.waitForTimeout(200);
        const there = await rp.evaluate(() => ({ tab: window.__app.tab(), sel: window.__app.selectedPref(), bar: !document.getElementById('invasionBar').hidden }));
        ok(there.tab === 'realm' && there.sel === inv.to && !there.bar, `${tag}: 帯を押すと、天下の地図の攻められている国が選ばれる`);
        const alarm = await rp.evaluate(() => ({ left: document.querySelector('[data-v="invLeft"]')?.textContent, btn: !!document.querySelector('[data-act="defend"]') }));
        ok(alarm.btn && Number(alarm.left) > 0, `${tag}: 札に秒読みと「迎え撃つ!」が出る (あと ${alarm.left} 秒)`);
        // 秒読みは進む
        const l0 = await rp.evaluate(() => window.__app.state().realm.invasion.left);
        await rp.evaluate(() => window.__app.realmStep(5));
        await rp.waitForTimeout(350);
        const l1 = await rp.evaluate(() => ({ left: window.__app.state().realm.invasion.left, shown: document.querySelector('[data-v="invLeft"]').textContent }));
        ok(l1.left <= l0 - 4.9 && l1.shown === String(Math.ceil(l1.left)), `${tag}: 秒読みが進み、札の数も書き変わる (${Math.ceil(l0)} → ${l1.shown})`);
        // 画面を開いているだけでも秒読みは進む (毎コマ)。合戦の最中は止まる
        const l2 = await rp.evaluate(() => window.__app.state().realm.invasion.left);
        await rp.waitForTimeout(1200);
        const l3 = await rp.evaluate(() => window.__app.state().realm.invasion.left);
        ok(l2 - l3 > 0.8 && l2 - l3 < 1.6, `${tag}: 地図を開いているだけで秒読みが進む (1.2 秒で ${(l2 - l3).toFixed(2)} 秒)`);
        // 迎え撃つ → 大名を倒すと追い返す
        await rp.locator('[data-act="defend"]').tap();
        await rp.waitForTimeout(150);
        const l4 = await rp.evaluate(() => window.__app.state().realm.invasion.left);
        await rp.waitForTimeout(800);
        ok(await rp.evaluate(() => window.__app.state().realm.invasion.left) === l4, `${tag}: 合戦の最中は秒読みが止まる`);
        const db = await rp.evaluate(() => { const b = window.__app.battle(); return { def: b && b.conquest && b.conquest.defense, mission: document.getElementById('missionText').textContent }; });
        ok(db.def && db.mission.includes('を守る'), `${tag}: 「迎え撃つ!」で守りの合戦になる (${db.mission})`);
        await rp.evaluate(() => { const b = window.__app.battle(); b.enemies.forEach((e, i) => { if (i < b.enemies.length - 1) { e.alive = false; e.hp = 0; e.state = 'down'; e.timer = 0.01; } }); b.current = b.enemies.length - 2; });
        await rp.waitForFunction(() => { const b = window.__app.battle(); const e = b && b.enemies[b.current]; return e && b.current === b.enemies.length - 1 && e.state === 'idle'; }, null, { timeout: 8000 });
        await rp.evaluate(() => { const b = window.__app.battle(); b.enemies[b.current].hp = 1; window.__app.punch(); });
        await rp.waitForFunction(() => !document.getElementById('resultPanel').hidden, null, { timeout: 6000 });
        const rep = await rp.evaluate(() => ({ title: document.getElementById('resultTitle').textContent, inv: window.__app.state().realm.invasion }));
        ok(rep.title.includes('守りきった') && rep.inv === null, `${tag}: 勝つと追い返す (${rep.title})`);
        await rp.locator('#btnNext').tap();
        await rp.waitForTimeout(200);
        ok(await rp.evaluate(() => window.__app.tab()) === 'realm', `${tag}: 「天下の地図へ」で地図へ戻る`);
        // もう一度攻めてこさせて、何もしないと取られる (はじめの国でなければ)
        await rp.evaluate(() => window.__app.debugSetState((s) => { const r = JSON.parse(JSON.stringify(s.realm)); r.nextInvasion = 1; return Object.assign({}, s, { realm: r }); }));
        await rp.evaluate(() => window.__app.realmStep(2));
        const inv2 = await rp.evaluate(() => window.__app.state().realm.invasion);
        await rp.evaluate((to) => window.__app.debugSetState((s) => { const r = JSON.parse(JSON.stringify(s.realm)); r.troops[to - 1] = 0; return Object.assign({}, s, { realm: r }); }), inv2.to);
        await rp.evaluate(() => { for (let i = 0; i < 70; i++) window.__app.realmStep(1); });
        await rp.waitForTimeout(100);
        const after2 = await rp.evaluate((to) => ({ mine: window.Core.isMine(window.__app.state(), to), inv: window.__app.state().realm.invasion, home: window.__app.state().realm.home }), inv2.to);
        ok(after2.inv === null && (after2.home === inv2.to ? after2.mine : !after2.mine), `${tag}: 守りの兵がいないまま 60 秒たつと取られる (${inv2.to}: ${after2.mine ? '自分の国のまま' : '取られた'})`);
      }

      // 最後の 1 国を取ると天下統一
      await rp.evaluate(() => window.__app.debugSetState((s) => { const r = JSON.parse(JSON.stringify(s.realm)); r.mine = r.mine.map((m, i) => i !== 13); r.troops[21] = 3000; return Object.assign({}, s, { realm: r }); }));
      await rp.evaluate(() => window.__app.selectPref(14));
      await rp.locator('[data-act="attack"]').tap();
      await rp.evaluate(() => { const b = window.__app.battle(); b.enemies.forEach((e, i) => { if (i < b.enemies.length - 1) { e.alive = false; e.hp = 0; e.state = 'down'; e.timer = 0.01; } }); b.current = b.enemies.length - 2; });
      await rp.waitForFunction(() => { const b = window.__app.battle(); const e = b && b.enemies[b.current]; return e && b.current === b.enemies.length - 1 && e.state === 'idle'; }, null, { timeout: 8000 });
      await rp.evaluate(() => { const b = window.__app.battle(); b.enemies[b.current].hp = 1; window.__app.punch(); });
      await rp.waitForFunction(() => !document.getElementById('unifyModal').hidden, null, { timeout: 6000 }).catch(() => {});
      const uni = await rp.evaluate(() => ({ shown: !document.getElementById('unifyModal').hidden, all: window.Core.ownedCount(window.__app.state()) }));
      ok(uni.shown && uni.all === 47, `${tag}: 47 国そろうと「天下統一!」の札が出る`);
      const card = await rect('#unifyModal .modal-card');
      ok(card.top >= -1 && card.bottom <= vh + 1, `${tag}: 天下統一の札が画面に収まる`);
      await rc.close();
    }

    // ------------------------------------------------ 留守の間の進み (保存 → 再読み込み)
    section('留守の間も育つ (保存と再読み込み)');
    await phone.evaluate(() => {
      const s = window.__app.state();
      const past = Date.now() - 2 * 60 * 60 * 1000; // 2時間前に保存したことにする
      localStorage.setItem('nekojo-save-v1', JSON.stringify({ savedAt: past, state: s }));
    });
    await phone.reload();
    await phone.waitForFunction(() => window.__app);
    const materialsAfterReload = await phone.evaluate(() => window.__app.state().materials);
    ok(materialsAfterReload > 0, `留守の間の資材が計算されて戻ってくる (${materialsAfterReload.toFixed(1)})`);

    // ------------------------------------------------ 明るい画面・暗い画面
    section('明るい画面と暗い画面');
    for (const scheme of ['light', 'dark']) {
      const themed = await browser.newContext({ ...device, colorScheme: scheme });
      const page = await themed.newPage();
      page.on('pageerror', (e) => errors.push(scheme + ': ' + e.message));
      await page.goto(URL);
      await page.waitForFunction(() => window.__app);
      const colors = await page.evaluate(() => ({
        bg: getComputedStyle(document.body).backgroundColor,
        fg: getComputedStyle(document.body).color
      }));
      ok(colors.bg !== colors.fg, `${scheme}: 文字と背景の色が違う (${colors.bg} / ${colors.fg})`);
      await themed.close();
    }

    // ------------------------------------------------ アイコン
    section('アイコン');
    const desk = await browser.newPage();
    await desk.goto(URL);
    const apple = await desk.evaluate(() =>
      document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    if (!apple) {
      skip('ホーム画面用のアイコンはまだ無い (PWA にするときに用意する)');
    } else {
      // iOS は SVG のアイコンを使えない
      ok(apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${apple})`);
      const res = await desk.request.get(URL + apple.replace('./', ''));
      ok(res.ok() && res.headers()['content-type'] === 'image/png', `${apple} が PNG として配信される`);
      const size = await desk.evaluate((src) => new Promise((done) => {
        const im = new Image(); im.onload = () => done([im.naturalWidth, im.naturalHeight]); im.onerror = () => done([0, 0]); im.src = src;
      }), apple);
      ok(size[0] === 180 && size[1] === 180, `アイコンが 180x180 (${size.join('x')})`);
    }
    const art = await desk.request.get(URL + 'title.jpg');
    const artKB = Math.round((await art.body()).length / 1024);
    ok(art.headers()['content-type'] === 'image/jpeg', 'タイトルの絵が JPEG として配信される');
    // 元の PNG は 2.2MB あった。開くのが重くならないよう、焼き直した大きさを見張る
    ok(artKB < 600, `タイトルの絵が軽い (${artKB}KB)`);

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
