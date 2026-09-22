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

    const catShown = await phone.evaluate(() => document.querySelectorAll('#playerCat svg').length === 1);
    ok(catShown, '自分のねこ (2頭身) が描かれている');

    // ------------------------------------------------ しゅぎょう
    section('しゅぎょう (タップで手柄)');
    await phone.evaluate(() => window.__app.forceSpawn());
    await phone.waitForTimeout(50);
    const targetVisible = await phone.evaluate(() => window.__app.tapTargetVisible());
    ok(targetVisible, 'タップする的が出る');

    await phone.locator('#tapTarget').tap();
    await phone.waitForTimeout(120);
    const afterTap = await phone.evaluate(() => window.__app.state().merit);
    ok(afterTap > 0, `タップすると手柄が増える (${afterTap})`);

    // 手柄が増えた直後、進捗バーやねこの表示が飛ばないか
    const jump = await measureJump(phone, '#trainingField', 'window.__app.forceSpawn()');
    ok(jump < 12, `的が出た直後に画面が飛ばない (最大ずれ ${jump}px)`);

    // ------------------------------------------------ 出世で家臣タブが解放される
    section('出世 → 家臣が解放される');
    ok(await phone.evaluate(() => document.getElementById('tab-vassals').classList.contains('locked')),
      'はじめは家臣タブが鍵つき');

    await phone.evaluate(() => window.__app.debugAddMerit(160)); // 足軽 (150) に到達
    await phone.waitForTimeout(50);
    const rankAfter = await phone.evaluate(() => window.__app.state().merit >= 150);
    ok(rankAfter, '手柄をためると出世する');
    ok(await phone.evaluate(() => !document.getElementById('tab-vassals').classList.contains('locked')),
      '足軽になると家臣タブの鍵が開く');

    await phone.evaluate(() => window.__app.setTab('vassals'));
    await phone.waitForTimeout(50);
    const recruited = await phone.evaluate(() => window.__app.recruit());
    ok(recruited, '家臣を誘える');
    const vassalCount = await phone.evaluate(() => window.__app.state().vassals.length);
    ok(vassalCount === 1, `家臣の一覧に反映される (${vassalCount}人)`);

    const vassalId = await phone.evaluate(() => window.__app.state().vassals[0].id);
    await phone.evaluate((id) => window.__app.trainVassal(id), vassalId);
    const level = await phone.evaluate(() => window.__app.state().vassals[0].level);
    ok(level === 2, `家臣を鍛えるとレベルが上がる (Lv.${level})`);

    await phone.evaluate((id) => window.__app.assignJob(id, 'labor'), vassalId);
    const job = await phone.evaluate(() => window.__app.state().vassals[0].job);
    ok(job === 'labor', '家臣の役目を普請に変えられる');

    // ------------------------------------------------ 城主 → 城と村
    section('城主になる → 城と村が解放される');
    await phone.evaluate(() => window.__app.debugAddMerit(10000));
    await phone.evaluate(() => window.__app.debugSetMaterials(1000));
    await phone.waitForTimeout(50);
    ok(await phone.evaluate(() => !document.getElementById('tab-castle').classList.contains('locked')),
      '城主になると城タブの鍵が開く');

    await phone.evaluate(() => window.__app.setTab('castle'));
    await phone.waitForTimeout(50);
    const placed = await phone.evaluate(() => window.__app.buildCastle(0, 'keep'));
    ok(placed, '天守を建てられる');
    const complete = await phone.evaluate(() => window.__app.state().castle.cells.includes('keep'));
    ok(complete, 'グリッドに天守が反映される');
    const bannerShown = await phone.evaluate(() => !document.getElementById('castleBanner').hidden);
    ok(bannerShown, 'お城完成のバナーが出る');

    await phone.evaluate(() => window.__app.buildCastle(1, 'storehouse'));
    await phone.evaluate(() => window.__app.buildCastle(2, 'barracks'));
    const cells = await phone.evaluate(() => window.__app.state().castle.cells.slice(0, 3));
    ok(cells[1] === 'storehouse' && cells[2] === 'barracks', '別の枠にも別の建物を建てられる (重ならない)');

    await phone.evaluate(() => window.__app.setTab('village'));
    await phone.waitForTimeout(50);
    const houseBuilt = await phone.evaluate(() => window.__app.buildHouse());
    ok(houseBuilt, '家を建てられる');

    // 人口は放っておくと増える (実時間で少し待つ)
    const popBefore = await phone.evaluate(() => window.__app.state().village.population);
    await phone.waitForTimeout(2500);
    const popAfter = await phone.evaluate(() => window.__app.state().village.population);
    ok(popAfter > popBefore, `村人猫が時間で増える (${popBefore.toFixed(2)} → ${popAfter.toFixed(2)})`);

    const catsShown = await phone.evaluate(() => document.querySelectorAll('#villageCats .mini-cat').length);
    ok(catsShown > 0, `村人猫のアイコンが画面に出る (${catsShown}匹ぶん)`);

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
      ok(apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${apple})`);
    }

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
