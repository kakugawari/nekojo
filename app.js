/*!
 * app.js — 画面まわり。操作と描画はここに書く。ロジックは core.js。
 *
 * 合戦の戦場は 2 枚のキャンバスで描く。
 *   fieldBg: 空・山・お城・村・広場。大きさが変わったときだけ描く (毎コマ塗らない)
 *   fieldFg: ねこたちと効果。毎コマ消して描き直す
 */
(function () {
  'use strict';

  const C = window.Core;
  const SAVE_KEY = 'nekojo-save-v1';
  const OFFLINE_CAP_SECONDS = 8 * 60 * 60;

  const $ = (id) => document.getElementById(id);
  const els = {
    titleScreen: $('titleScreen'), btnStart: $('btnStart'),
    portraitImg: $('portraitImg'), rankTag: $('rankTag'), lvText: $('lvText'),
    hpFill: $('hpFill'), hpText: $('hpText'), nextFill: $('nextFill'),
    enemyUnit: $('enemyUnit'), enemyName: $('enemyName'), enemyHpFill: $('enemyHpFill'), enemyFaceImg: $('enemyFaceImg'),
    missionText: $('missionText'), pawGauge: $('pawGauge'),
    btnItem: $('btnItem'), itemBadge: $('itemBadge'), itemMenu: $('itemMenu'),
    btnFish: $('btnFish'), btnMatatabi: $('btnMatatabi'), fishCount: $('fishCount'), matatabiCount: $('matatabiCount'),
    btnPause: $('btnPause'), pausePanel: $('pausePanel'), btnResume: $('btnResume'), btnRetreat: $('btnRetreat'),
    coinVassals: $('coinVassals'),
    field: $('field'), fieldBg: $('fieldBg'), fieldFg: $('fieldFg'), fieldBanner: $('fieldBanner'),
    readyPanel: $('readyPanel'), readyTitle: $('readyTitle'), readyText: $('readyText'), btnSortie: $('btnSortie'),
    resultPanel: $('resultPanel'), resultTitle: $('resultTitle'), resultRows: $('resultRows'),
    offer: $('offer'), offerImg: $('offerImg'), offerText: $('offerText'),
    btnOfferYes: $('btnOfferYes'), btnOfferNo: $('btnOfferNo'), btnNext: $('btnNext'),
    btnLure: $('btnLure'), btnPunch: $('btnPunch'),
    lureCd: $('lureCd'), punchCd: $('punchCd'),
    vassalSlotCount: $('vassalSlotCount'), vassalsLocked: $('vassalsLocked'), vassalsContent: $('vassalsContent'),
    vassalList: $('vassalList'), btnRecruit: $('btnRecruit'),
    materialCountCastle: $('materialCountCastle'), castleLocked: $('castleLocked'), castleContent: $('castleContent'),
    castleBanner: $('castleBanner'),
    materialCountVillage: $('materialCountVillage'), villageLocked: $('villageLocked'), villageContent: $('villageContent'),
    popLabel: $('popLabel'), popFill: $('popFill'),
    toast: $('toast'), cutin: $('cutin'),
    storyModal: $('storyModal'), btnStory: $('btnStory'),
    rankModal: $('rankModal'), rankUpName: $('rankUpName'), rankUpArt: $('rankUpArt'), rankUpText: $('rankUpText'), btnRankOk: $('btnRankOk')
  };
  const views = { battle: $('view-battle'), vassals: $('view-vassals'), castle: $('view-castle'), village: $('view-village') };
  const tabEls = { battle: $('tab-battle'), vassals: $('tab-vassals'), castle: $('tab-castle'), village: $('tab-village') };
  const TAB_LABELS = { battle: '合戦', vassals: '家臣', castle: '城', village: '村' };

  // ---------------------------------------------------------- 絵

  const IMG_NAMES = ['stage0', 'stage1', 'stage2', 'stage3', 'cat-normal', 'cat-chatora', 'cat-kuro', 'cat-gray', 'cat-red',
    'face-normal', 'face-smile', 'face-serious', 'face-surprised', 'face-angry', 'face-shy', 'pose-special', 'pose-jarashi', 'pose-punch', 'b-villager']
    .concat(Object.keys(C.BUILDINGS).map(function (t) { return C.BUILDINGS[t].img; }));
  const imgs = {};
  IMG_NAMES.forEach(function (n) {
    const im = new Image();
    im.src = './img/' + n + '.png';
    imgs[n] = im;
  });
  const ready = (im) => im && im.complete && im.naturalWidth > 0;

  /** 成長の過程: 村の子猫 → 旅立ち → 猫侍に仕える → お城を築く */
  function stageForRank(r) {
    if (r >= 7) return 'stage3';
    if (r >= 3) return 'stage2';
    if (r >= 1) return 'stage1';
    return 'stage0';
  }

  // ---------------------------------------------------------- 状態

  let rng = C.mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  let state = load();
  let currentTab = 'battle';
  let titleShown = true;
  let battle = null;        // 戦っている最中の中身 (core の createBattle)
  let lastBattle = null;    // 終わった戦 (結果の札を出している間)
  let pendingOffer = null;
  let toastTimer = null;
  let saveTimer = null;

  function load() {
    let saved = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (e) { saved = null; }
    if (!saved || !saved.state) return C.createInitialState(Math.floor(Math.random() * 0xffffffff));
    let s = C.sanitizeState(saved.state);
    const elapsed = Math.max(0, Math.min((Date.now() - (saved.savedAt || Date.now())) / 1000, OFFLINE_CAP_SECONDS));
    if (elapsed > 1) s = C.tick(s, elapsed);
    return s;
  }

  function saveNow() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ savedAt: Date.now(), state: state }));
    } catch (e) { /* 保存できない環境 (プライベートモード等) は諦める */ }
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }

  function showToast(message, ms) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.hidden = false;
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, ms || 2400);
  }

  function kanjiNum(n) {
    const d = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (n <= 0) return '〇';
    if (n >= 1000) return String(n);
    const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
    return (h ? (h > 1 ? d[h] : '') + '百' : '') + (t ? (t > 1 ? d[t] : '') + '十' : '') + d[o];
  }

  // ---------------------------------------------------------- 表情

  const face = { shown: '', override: '', until: 0 };

  function setFace(name, seconds) {
    face.override = name;
    face.until = performance.now() + seconds * 1000;
  }

  function updateFace(now) {
    let name;
    if (face.override && now < face.until) {
      name = face.override;
    } else if (battle && battle.phase === 'fight') {
      name = battle.player.hp / battle.player.maxHp < 0.3 ? 'angry' : 'serious';
    } else {
      name = 'normal';
    }
    if (name !== face.shown) {
      face.shown = name;
      els.portraitImg.src = imgs['face-' + name].src;
    }
  }

  // ---------------------------------------------------------- タブ

  function isUnlocked(tab) {
    const r = C.rankIndexOf(state);
    if (tab === 'vassals') return r >= C.VASSAL_UNLOCK_RANK;
    if (tab === 'castle' || tab === 'village') return r >= C.CASTLE_UNLOCK_RANK;
    return true;
  }

  function renderTabs() {
    Object.keys(tabEls).forEach(function (tab) {
      const unlocked = isUnlocked(tab);
      tabEls[tab].classList.toggle('active', tab === currentTab);
      tabEls[tab].classList.toggle('locked', !unlocked);
      tabEls[tab].querySelector('.tab-label').textContent = unlocked ? TAB_LABELS[tab] : '🔒' + TAB_LABELS[tab];
    });
  }

  function lockedMessage(tab) {
    if (tab === 'vassals') return '「' + C.RANKS[C.VASSAL_UNLOCK_RANK].name + '」になると、仲間を持てるようになるにゃ。';
    return '「' + C.RANKS[C.CASTLE_UNLOCK_RANK].name + '」になると、自分の城と村を持てるにゃ。';
  }

  function switchTab(name) {
    if (!views[name]) return;
    currentTab = name;
    Object.keys(views).forEach(function (t) { views[t].hidden = (t !== name); });
    renderTabs();
    renderActiveView();
    if (name === 'battle') sizeField();
  }

  function renderActiveView() {
    if (currentTab === 'battle') renderHud(true);
    else if (currentTab === 'vassals') renderVassalsView();
    else if (currentTab === 'castle' || currentTab === 'village') renderTownView(currentTab);
  }

  // ---------------------------------------------------------- 上の段 (自分と敵の顔・体力)

  const MISSIONS = ['村の平和を守る', '殿の草履を取り返す', 'お使いの荷を守る', '足軽の初陣', '峠の関所を守る',
    '足軽隊をひきいる', '殿の名代で出陣', '城の守りを固める', 'わが城下を守る', '天下の大合戦'];

  const hudCache = {};
  function setText(el, key, text) {
    if (hudCache[key] !== text) { hudCache[key] = text; el.textContent = text; }
  }
  function setWidth(el, key, pct) {
    const v = Math.round(pct * 10) / 10;
    if (hudCache[key] !== v) { hudCache[key] = v; el.style.width = v + '%'; }
  }
  function setOnce(key, value, fn) {
    if (hudCache[key] !== value) { hudCache[key] = value; fn(value); }
  }

  function renderHud(force) {
    if (force) Object.keys(hudCache).forEach(function (k) { delete hudCache[k]; });
    const r = C.rankIndexOf(state);
    setText(els.lvText, 'lv', 'Lv.' + (r + 1));
    setText(els.rankTag, 'rank', C.RANKS[r].name);
    setText(els.missionText, 'mission', MISSIONS[r] || MISSIONS[0]);
    const next = C.RANKS[r + 1];
    setWidth(els.nextFill, 'exp', next
      ? Math.max(0, Math.min(100, (state.totalMerit - C.RANKS[r].threshold) / (next.threshold - C.RANKS[r].threshold) * 100))
      : 100);

    const b = battle;
    const maxHp = b ? b.player.maxHp : Math.round(C.playerMaxHp(r) * C.townEffects(state).hpMul);
    const hp = b ? b.player.hp : maxHp;
    setWidth(els.hpFill, 'hp', hp / maxHp * 100);
    setText(els.hpText, 'hpText', Math.ceil(hp) + '/' + maxHp);
    setOnce('low', hp / maxHp < 0.3, function (v) { els.hpFill.classList.toggle('low', v); });

    const e = b ? b.enemies[b.current] : null;
    const showEnemy = !!(e && (e.alive || e.state === 'down') && e.state !== 'wait');
    setOnce('enemyShown', showEnemy, function (v) {
      els.enemyUnit.hidden = !v;
      els.pawGauge.classList.toggle('idle', !v); // 横画面では、敵がいない間ゲージを隠す (縦は常に出す)
    });
    if (showEnemy) {
      setText(els.enemyName, 'enemyName', e.name);
      setWidth(els.enemyHpFill, 'enemyHp', e.hp / e.maxHp * 100);
      setOnce('enemyFace', e.look, function (v) { els.enemyFaceImg.src = imgs[v].src; });
    }

    const paw = b ? b.paw : 0;
    setOnce('paw', paw, function (v) {
      els.pawGauge.querySelectorAll('i').forEach(function (i, k) { i.classList.toggle('on', k < v); });
      els.pawGauge.classList.toggle('full', v >= C.PAW_MAX);
    });

    const items = b ? b.items : state.items;
    setText(els.itemBadge, 'itemBadge', String(items.fish + items.matatabi));
    setText(els.fishCount, 'fish', '×' + items.fish);
    setText(els.matatabiCount, 'matatabi', '×' + items.matatabi);

    const lc = b ? Math.round(Math.min(1, b.cd.lure / C.LURE_COOLDOWN) * 12) / 12 : 0;
    const pc = b ? Math.round(Math.min(1, b.cd.punch / C.PUNCH_COOLDOWN) * 12) / 12 : 0;
    setOnce('lcd', lc, function (v) { els.lureCd.style.setProperty('--cd', v); });
    setOnce('pcd', pc, function (v) { els.punchCd.style.setProperty('--cd', v); });
  }

  // ---------------------------------------------------------- 戦場の大きさ

  const fieldSize = { w: 0, h: 0, dpr: 1, s: 1, ground: 0 };
  const bgCtx = els.fieldBg.getContext('2d');
  const fgCtx = els.fieldFg.getContext('2d');

  function sizeField() {
    const w = els.field.clientWidth;
    const h = els.field.clientHeight;
    // 回転中や組み直しの最中は 0 が来ることがある。そのときは前の大きさのまま
    if (!(w >= 1 && h >= 1)) return;
    // 描く面の画素の倍率は 1.5 まで。ねこの絵は 1 匹 120px ほどしかなく、2 倍で描いても
    // 細かさは増えず塗る量だけ増える (CPU4倍遅で 1コマ 33ms → 1.5倍にして 16.7ms)
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (w === fieldSize.w && h === fieldSize.h && dpr === fieldSize.dpr) return;
    fieldSize.w = w; fieldSize.h = h; fieldSize.dpr = dpr;
    fieldSize.land = w > h;
    if (fieldSize.land) {
      // 横: ボタンは左右の角にあるので、ねこはその間の下の方に立つ。背丈は戦場の高さの半分ほど。
      // 足もとは猫じゃらしのボタンの下端に合わせる (安全域の分だけ上がる)
      const fr = els.field.getBoundingClientRect(), lr = els.btnLure.getBoundingClientRect();
      const btnBottom = lr.height > 0 ? lr.bottom - fr.top : h;
      fieldSize.ground = Math.round(btnBottom - 22);
      fieldSize.s = Math.min(h * 0.46 / 150, w * 0.3 / 150);
    } else {
      // 縦: 立つ位置は下のボタンのすぐ上。ねこは戦場の高さの 1/4 ほど
      fieldSize.ground = Math.round(h - 150);
      fieldSize.s = Math.min(h * 0.26 / 150, w * 0.42 / 150);
    }
    [els.fieldBg, els.fieldFg].forEach(function (c) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    });
    drawBackground();
  }

  // 戦場の横の位置 (0〜SCENE_W) → 画面の位置。
  // 横画面では幅が倍あるので、自分を 36%・敵を 68% に置く (左の角の猫じゃらしボタンに家臣が重ならない)
  function fx(lx) {
    const w = fieldSize.w;
    if (!fieldSize.land) return lx / C.SCENE_W * w;
    return w * 0.14 + lx / C.SCENE_W * w * 0.8;
  }

  // ---------------------------------------------------------- 背景 (一度だけ描く)
  //
  // 背景だけの絵 (BATTLE_BG_SRC) があればそれを敷く。無いあいだは、施設の絵 (お城・民家・桜・
  // 柵・のぼり・村人猫) を並べて、いただいたプレイ画面に近い村の景色を組み立てる。

  // 背景だけの絵が届いたら、ここにファイル名を書く (例: './img/battle-bg.jpg')。空なら組み立てた景色
  const BATTLE_BG_SRC = './img/battle-bg.jpg';
  // その絵の中で、ねこの足もとに来てほしい高さ (土の広場のまん中。元の絵 1536x1024 で y800)
  const BATTLE_BG_GROUND_Y = 800;
  const battleBg = new Image();
  let battleBgReady = false;
  let battleBgFailed = false;
  battleBg.onload = function () { battleBgReady = battleBg.naturalWidth > 0; drawBackground(); };
  battleBg.onerror = function () { battleBgFailed = true; drawBackground(); }; // 読めなければ組み立てた景色
  if (BATTLE_BG_SRC) battleBg.src = BATTLE_BG_SRC;
  ['b-castle', 'b-sakura', 'b-house', 'b-farm', 'b-woodfence', 'b-nobori', 'b-villager', 'cat-chatora', 'cat-gray'].forEach(function (n) {
    imgs[n].addEventListener('load', function () { drawBackground(); });
  });

  function drawBackground() {
    const ctx = bgCtx;
    const w = fieldSize.w, h = fieldSize.h, dpr = fieldSize.dpr;
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (battleBgReady) {
      // 画面いっぱいに敷く (はみ出した分は切る)。上下は、絵の土の広場がねこの足もとに来るように
      // ずらす。ただし画面の端に絵の無い所が出ない範囲で (縦は高さで合わせるので、ずらす余地は無い)
      const iw = battleBg.naturalWidth, ih = battleBg.naturalHeight;
      const sc = Math.max(w / iw, h / ih);
      const dw = iw * sc, dh = ih * sc;
      const dy = Math.min(0, Math.max(h - dh, fieldSize.ground - BATTLE_BG_GROUND_Y * sc));
      ctx.drawImage(battleBg, (w - dw) / 2, dy, dw, dh);
      fieldSize.bgGroundY = (fieldSize.ground - dy) / sc; // 足もとが絵のどの高さに来たか (見張り用)
      return;
    }
    if (BATTLE_BG_SRC && !battleBgFailed) {
      // 絵を読み込んでいる間は、空と土の色だけ (組み立てた景色を一瞬見せてから絵に替わると、ちらつく)
      const g0 = ctx.createLinearGradient(0, 0, 0, h);
      g0.addColorStop(0, '#5aa8ec'); g0.addColorStop(0.55, '#cfe6c0'); g0.addColorStop(0.62, '#e2c98f'); g0.addColorStop(1, '#c9a86a');
      ctx.fillStyle = g0;
      ctx.fillRect(0, 0, w, h);
      return;
    }

    // 置く物の大きさの物差し。縦は幅、横は高さから決める (横で幅に合わせると、お城が画面より高くなる)。
    // 置く場所は縦横とも幅の割合のまま
    const u = fieldSize.land ? h * 0.85 : w;
    const horizon = h * (fieldSize.land ? 0.42 : 0.40);
    const groundTop = h * (fieldSize.land ? 0.58 : 0.55);
    const R = C.mulberry32(20260924);
    const put = function (name, cx, bottom, width, alpha) {
      const im = imgs[name];
      if (!ready(im)) return;
      const hh = width * im.naturalHeight / im.naturalWidth;
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.drawImage(im, cx - width / 2, bottom - hh, width, hh);
      ctx.globalAlpha = 1;
    };

    // 空
    let g = ctx.createLinearGradient(0, 0, 0, groundTop);
    g.addColorStop(0, '#4fa6ec');
    g.addColorStop(0.55, '#a9dbfa');
    g.addColorStop(1, '#fff3d6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, groundTop + 2);
    g = ctx.createRadialGradient(w * 0.8, h * 0.08, 0, w * 0.8, h * 0.08, w * 0.6);
    g.addColorStop(0, 'rgba(255,250,225,.85)');
    g.addColorStop(1, 'rgba(255,250,225,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizon);
    function cloud(cx, cy, sc) {
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      [[0, 0, 26], [26, -10, 22], [50, 2, 18], [-24, 5, 16], [14, 10, 20]].forEach(function (c) {
        ctx.beginPath(); ctx.arc(cx + c[0] * sc, cy + c[1] * sc, c[2] * sc, 0, Math.PI * 2); ctx.fill();
      });
    }
    cloud(w * 0.12, h * 0.16, u / 430);
    cloud(w * 0.86, h * 0.2, u / 480);
    cloud(w * 0.5, h * 0.11, u / 620);

    // 遠くの山
    ctx.fillStyle = '#9dbfe0';
    ctx.beginPath();
    ctx.moveTo(0, horizon + h * 0.06);
    ctx.quadraticCurveTo(w * 0.15, horizon - h * 0.05, w * 0.32, horizon + h * 0.02);
    ctx.quadraticCurveTo(w * 0.55, horizon - h * 0.08, w * 0.75, horizon + h * 0.01);
    ctx.quadraticCurveTo(w * 0.9, horizon - h * 0.04, w, horizon + h * 0.03);
    ctx.lineTo(w, groundTop); ctx.lineTo(0, groundTop); ctx.closePath(); ctx.fill();

    // 丘の上のお城
    ctx.fillStyle = '#7fb85e';
    ctx.beginPath(); ctx.ellipse(w * 0.52, horizon + h * 0.1, w * 0.46, h * 0.1, 0, Math.PI, 0); ctx.fill();
    put('b-castle', w * 0.52, horizon + h * 0.09, u * 0.5, 0.97);
    // うっすら霞
    g = ctx.createLinearGradient(0, horizon - h * 0.15, 0, groundTop);
    g.addColorStop(0, 'rgba(220,238,250,0)');
    g.addColorStop(1, 'rgba(236,244,236,.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon - h * 0.15, w, groundTop - horizon + h * 0.15);

    // 左に桜、右に村の家
    if (fieldSize.land) {
      // 横は幅が余るので、奥にもう少し並べる
      put('b-sakura', w * 0.34, groundTop - h * 0.01, u * 0.2);
      put('b-house', w * 0.64, groundTop - h * 0.015, u * 0.22);
    }
    put('b-sakura', w * 0.08, groundTop + h * 0.03, u * 0.34);
    put('b-sakura', w * 0.28, groundTop + h * 0.0, u * 0.24);
    put('b-farm', w * 0.9, groundTop + h * 0.03, u * 0.42);
    put('b-house', w * 0.72, groundTop - h * 0.005, u * 0.28);

    // 広場
    g = ctx.createLinearGradient(0, groundTop, 0, h);
    g.addColorStop(0, '#e9d6a8');
    g.addColorStop(1, '#caa870');
    ctx.fillStyle = g;
    ctx.fillRect(0, groundTop, w, h - groundTop);
    ctx.fillStyle = 'rgba(255,247,222,.5)';
    ctx.beginPath(); ctx.ellipse(w * 0.5, fieldSize.ground - h * 0.02, w * 0.62, h * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = R() < 0.5 ? 'rgba(120,90,50,.2)' : 'rgba(255,255,255,.3)';
      ctx.fillRect(R() * w, groundTop + R() * (h - groundTop), 1.5 + R() * 2.5, 1 + R());
    }

    // 見物の猫と柵、のぼり
    put('b-villager', w * 0.07, groundTop + h * 0.045, u * 0.12);
    put('cat-chatora', w * 0.17, groundTop + h * 0.05, u * 0.1);
    put('b-villager', w * 0.92, groundTop + h * 0.05, u * 0.12);
    if (fieldSize.land) put('cat-gray', w * 0.82, groundTop + h * 0.05, u * 0.1);
    for (let x = -w * 0.04; x < w * 0.34; x += u * 0.16) put('b-woodfence', x + u * 0.08, groundTop + h * 0.07, u * 0.18);
    for (let x = w * 0.7; x < w * 1.04; x += u * 0.16) put('b-woodfence', x + u * 0.08, groundTop + h * 0.07, u * 0.18);
    put('b-nobori', w * 0.36, groundTop + h * 0.05, u * 0.07);
    put('b-nobori', w * 0.64, groundTop + h * 0.05, u * 0.07);

    // 手前の草花 (ぼかした茂み)
    function bush(cx, cy, r, col) {
      const gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gg.addColorStop(0, col);
      gg.addColorStop(1, 'rgba(90,150,60,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    bush(w * 0.02, h * 0.98, u * 0.22, 'rgba(96,160,70,.9)');
    bush(w * 1.0, h * 0.97, u * 0.24, 'rgba(96,160,70,.9)');
    bush(w * 0.2, h * 1.02, u * 0.16, 'rgba(120,180,80,.85)');
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = '#f7b6cf';
      ctx.beginPath(); ctx.arc(R() * w * 0.25, h * (0.9 + R() * 0.08), 3 + R() * 3, 0, Math.PI * 2); ctx.fill();
    }

    // ふちを少し暗く
    g = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.3, w / 2, h * 0.55, h * 0.85);
    g.addColorStop(0, 'rgba(58,42,28,0)');
    g.addColorStop(1, 'rgba(58,42,28,.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // ---------------------------------------------------------- 効果

  let effects = [];
  const anim = { lure: 0, punch: 0, hurt: 0, shake: 0, flash: 0, knock: 0 };
  const petals = [];
  for (let i = 0; i < 12; i++) petals.push({ x: Math.random(), y: Math.random(), v: 0.03 + Math.random() * 0.03, p: Math.random() * 6 });
  let cheer = { t: 3, text: '' };

  function addEffect(e) {
    e.t = 0;
    effects.push(e);
  }

  function heroX() { return fx(C.PLAYER_X); }
  function enemyX(e) {
    // 歩いてくる間は、画面の右の外から出てくるように引き伸ばす (横画面ではそのままだと半身が見えた所から出る)
    if (fieldSize.land && e.state === 'enter' && e.x > C.ENEMY_X) {
      const im = imgs[e.look];
      const half = (im && im.naturalWidth ? im.naturalWidth : 130) * enemyScale(e) / 2;
      const from = fx(C.ENEMY_X), to = fieldSize.w + half + 10;
      return from + (e.x - C.ENEMY_X) / (C.ENTER_X - C.ENEMY_X) * (to - from);
    }
    return fx(e.x);
  }

  function enemyScale(e) {
    return fieldSize.s * (e.kind === 'boss' ? 1.45 : (e.boss ? 1.2 : 1));
  }

  const LURE_TEXT = {
    charm: ['夢中!', '#ff5f9e', 20], perfect: ['見切り!', '#c8412f', 26], dodge: ['ひらり…', '#ff7fb0', 20],
    resist: ['まだまだ…?', '#7a6650', 16], wary: ['警戒中…', '#7a6650', 16], full: ['もう夢中!', '#ff5f9e', 16]
  };

  function handleEvents(b) {
    const s = fieldSize.s;
    const e = b.enemies[b.current];
    const ex = e ? enemyX(e) : fieldSize.w * 0.7;
    const top = e ? fieldSize.ground - 150 * enemyScale(e) : fieldSize.ground - 150 * s;
    for (let i = 0; i < b.events.length; i++) {
      const ev = b.events[i];
      if (ev.type === 'lure') {
        anim.lure = 1;
        addEffect({ kind: 'swish', dur: 0.45, big: ev.result === 'perfect' });
        const lt = LURE_TEXT[ev.result];
        if (lt) addEffect({ kind: 'text', x: ex, y: top - 10 * s, text: lt[0], color: lt[1], size: lt[2], dur: 0.9 });
        if (ev.result === 'perfect') setFace('smile', 1.0);
        if (ev.result === 'dodge' || ev.result === 'wary') setFace('shy', 0.7);
      } else if (ev.type === 'hit') {
        if (ev.source === 'punch') {
          anim.punch = 1;
          anim.knock = 1;
          const big = ev.combo || ev.crit;
          addEffect({ kind: 'burst', x: ex - 20 * s, y: fieldSize.ground - 80 * s, r: (big ? 70 : 46) * s, dur: 0.3 });
          addEffect({ kind: 'text', x: ex + 10 * s, y: top - 30 * s, text: ev.armor ? 'カキン!' : 'バシッ!', color: '#ffd84a', size: big ? 40 : 32, rot: -0.12, dur: 0.75, stroke: '#3a2a1c' });
          if (ev.combo) startCutin();
          if (ev.crit) addEffect({ kind: 'text', x: ex, y: top - 70 * s, text: ev.open ? 'スキあり!' : '会心の猫パンチ!', color: '#c8412f', size: 20, dur: 1.0 });
          if (big) setFace('smile', 1.0);
        } else if (ev.source === 'ally') {
          addEffect({ kind: 'burst', x: ex - 10 * s, y: fieldSize.ground - 100 * s, r: 20 * s, dur: 0.2 });
        }
        addEffect({ kind: 'num', x: ex + 30 * s, y: top + 10 * s, text: String(ev.amount), crit: ev.crit || ev.combo, dur: 0.8 });
      } else if (ev.type === 'parry') {
        anim.punch = 1;
        addEffect({ kind: 'text', x: ex, y: top - 20 * s, text: '受け流し!', color: '#3f4d70', size: 22, dur: 0.9 });
      } else if (ev.type === 'open') {
        addEffect({ kind: 'text', x: ex, y: top - 40 * s, text: 'スキあり!', color: '#ff9a1a', size: 20, dur: 0.9 });
      } else if (ev.type === 'bored') {
        addEffect({ kind: 'text', x: ex, y: top - 10 * s, text: 'あきた…', color: '#7a6650', size: 16, dur: 0.9 });
      } else if (ev.type === 'down') {
        addEffect({ kind: 'dust', x: ex, y: fieldSize.ground - 30 * s, dur: 0.7 });
        addEffect({ kind: 'text', x: ex, y: top + 20 * s, text: '+' + ev.reward + ' 小判', color: '#b98b34', size: 18, dur: 1.2 });
        setFace('smile', 1.0);
      } else if (ev.type === 'enter') {
        const en = b.enemies[b.current];
        showBanner(en.boss ? '大将 あらわる!' : en.name + ' があらわれた!', en.boss ? 34 : 26);
      } else if (ev.type === 'playerHit') {
        anim.hurt = 1; anim.shake = 1; anim.flash = 1;
        addEffect({ kind: 'num', x: heroX(), y: fieldSize.ground - 170 * s, text: '-' + ev.amount, hurt: true, dur: 0.8 });
        setFace('surprised', 0.7);
      } else if (ev.type === 'miss') {
        anim.punch = 1;
        addEffect({ kind: 'text', x: heroX() + 60 * s, y: fieldSize.ground - 140 * s, text: 'スカッ', color: '#7a6650', size: 16, dur: 0.7 });
        setFace('shy', 0.8);
      } else if (ev.type === 'item') {
        addEffect({ kind: 'text', x: ev.item === 'fish' ? heroX() : ex, y: top - 10 * s,
          text: ev.item === 'fish' ? '🐟 +' + ev.amount : '🌿 またたび!', color: ev.item === 'fish' ? '#3a8fe0' : '#5fa83a', size: 20, dur: 1.0 });
        setFace('smile', 0.8);
      } else if (ev.type === 'allyAttack') {
        const a = b.allies.find(function (x) { return x.id === ev.ally; });
        if (a) a.hop = 1;
      } else if (ev.type === 'won' || ev.type === 'lost') {
        onBattleEnd(b);
      }
    }
    b.events.length = 0;
  }

  function startCutin() {
    els.cutin.hidden = false;
    const band = els.cutin.querySelector('.cutin-band');
    const art = els.cutin.querySelector('.cutin-art');
    const text = els.cutin.querySelector('.cutin-text');
    band.animate([{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 1, transform: 'scaleY(1)', offset: 0.15 }, { opacity: 1, transform: 'scaleY(1)', offset: 0.8 }, { opacity: 0, transform: 'scaleY(0)' }], { duration: 1000 });
    art.animate([{ transform: 'translateX(-110%)' }, { transform: 'translateX(0)', offset: 0.25 }, { transform: 'translateX(4%)', offset: 0.8 }, { transform: 'translateX(120%)' }], { duration: 1000, easing: 'ease-out' });
    const last = text.animate([{ opacity: 0, transform: 'scale(2)' }, { opacity: 1, transform: 'scale(1)', offset: 0.3 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 1000 });
    last.onfinish = function () { els.cutin.hidden = true; };
    setFace('smile', 1.4);
  }

  // ---------------------------------------------------------- 描く

  function drawSprite(ctx, im, x, groundY, scale, opts) {
    if (!ready(im)) return;
    const w = im.naturalWidth * scale;
    const h = im.naturalHeight * scale;
    const ax = opts && opts.anchor !== undefined ? opts.anchor : 0.5; // 絵のどこを x に合わせるか
    ctx.save();
    ctx.translate(x, groundY);
    if (opts && opts.rot) ctx.rotate(opts.rot);
    if (opts && opts.flip) ctx.scale(-1, 1);
    if (opts && opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    ctx.drawImage(im, -w * ax, -h, w, h);
    if (opts && opts.flash > 0) {
      // 当たった瞬間だけ白く光らせる (同じ絵を足し算で重ねる)
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = opts.flash * 0.6;
      ctx.drawImage(im, -w * ax, -h, w, h);
    }
    ctx.restore();
  }

  function shadow(ctx, x, y, rx) {
    ctx.fillStyle = 'rgba(80,55,25,.25)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function outlinedText(ctx, text, x, y, size, fill, stroke, rot) {
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.font = '900 ' + size + 'px "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size / 5);
    ctx.strokeStyle = stroke || '#3a2a1c';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function burstPath(ctx, x, y, r, spikes) {
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = i / (spikes * 2) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  /** 猫じゃらしの羽 (桃・白・黄) を x, y に描く */
  function feather(ctx, x, y, size, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);
    const cols = ['#ffe27a', '#fff4f8', '#f7a8c4'];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = cols[i];
      ctx.beginPath();
      ctx.ellipse(size * 0.6, (i - 1) * size * 0.18, size * 0.7, size * 0.22, (i - 1) * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f0c040';
    ctx.beginPath(); ctx.arc(0, 0, size * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawEffect(ctx, e) {
    const k = e.t / e.dur;
    const s = fieldSize.s;
    if (e.kind === 'burst') {
      const r = e.r * (0.6 + k * 0.7);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = '#ffd84a';
      burstPath(ctx, e.x, e.y, r, 10); ctx.fill();
      ctx.fillStyle = '#fffbe0';
      burstPath(ctx, e.x, e.y, r * 0.55, 10); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (e.kind === 'num') {
      ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      outlinedText(ctx, e.text, e.x, e.y - 30 * s * k, e.crit ? 32 : (e.hurt ? 22 : 24), e.hurt ? '#ff6a55' : (e.crit ? '#ffd84a' : '#ffffff'));
      ctx.globalAlpha = 1;
    } else if (e.kind === 'text') {
      ctx.globalAlpha = k < 0.6 ? 1 : (1 - k) / 0.4;
      const pop = k < 0.15 ? 0.6 + k / 0.15 * 0.4 : 1;
      outlinedText(ctx, e.text, e.x, e.y - 20 * s * k, e.size * pop, e.color, e.stroke || '#fff', e.rot);
      ctx.globalAlpha = 1;
    } else if (e.kind === 'swish') {
      // 猫じゃらしの羽の軌跡 (いただいたプレイ画面の、桃と黄の帯)
      const hx = heroX() + 40 * s, hy = fieldSize.ground - 90 * s;
      const cx = (hx + fx(C.ENEMY_X)) / 2, cy = hy - 20 * s;
      const rx = (fx(C.ENEMY_X) - hx) * 0.62, ry = 60 * s;
      const a0 = Math.PI * 0.9, a1 = a0 + Math.PI * 1.25 * Math.min(1, k * 1.6);
      ctx.globalAlpha = 1 - Math.max(0, k - 0.55) / 0.45;
      ctx.lineCap = 'round';
      const cols = e.big ? ['#ffe27a', '#fff', '#f7a8c4', '#c9a6ff'] : ['#ffe27a', '#fff', '#f7a8c4'];
      cols.forEach(function (c, i) {
        ctx.strokeStyle = c;
        ctx.lineWidth = (14 - i * 3) * s;
        ctx.beginPath();
        ctx.ellipse(cx, cy + i * 5 * s, rx, ry, -0.12, a0, a1);
        ctx.stroke();
      });
      feather(ctx, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, 26 * s, a1 + Math.PI / 2);
      ctx.globalAlpha = 1;
    } else if (e.kind === 'dust') {
      ctx.fillStyle = 'rgba(255,248,230,' + (0.8 * (1 - k)) + ')';
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2;
        const d = 40 * s * k;
        ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.5, (12 + 8 * k) * s, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawEnemy(ctx, b, e, t) {
    const s = fieldSize.s;
    const sc = enemyScale(e);
    let x = enemyX(e);
    let y = fieldSize.ground;
    let rot = 0;
    let alpha = 1;
    const headY = function () { return y - 150 * sc; };

    if (e.state === 'enter') {
      y -= Math.abs(Math.sin(t * 10)) * 6 * s;
    } else if (e.state === 'idle') {
      y -= Math.abs(Math.sin(t * 3 + e.id)) * 3 * s;
    } else if (e.state === 'windup') {
      rot = -0.16;
      x += Math.sin(t * 40) * 2;
    } else if (e.state === 'charmed') {
      // 羽に飛びつく
      const ph = (e.age % C.JUMP_PERIOD) / C.JUMP_PERIOD;
      y -= Math.sin(ph * Math.PI) * 46 * s;
      rot = Math.sin(ph * Math.PI * 2) * 0.12;
      x -= 18 * s;
    } else if (e.state === 'recover') {
      rot = 0.22 * Math.max(0, e.timer / 0.6);
      x += 16 * s * Math.max(0, e.timer / 0.6);
    } else if (e.state === 'down') {
      const k = 1 - Math.max(0, e.timer) / 1.3;
      rot = Math.min(1, k * 3) * (Math.PI / 2);
      x += Math.min(1, k * 3) * 30 * s;
      y -= Math.sin(Math.min(1, k * 3) * Math.PI) * 30 * s;
      alpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    }

    shadow(ctx, enemyX(e), fieldSize.ground, 40 * sc);
    const flash = anim.knock > 0.6 && e.state !== 'down' ? anim.knock : 0;
    drawSprite(ctx, imgs[e.look], x, y, sc, { rot: rot, alpha: alpha, flash: flash });

    // 夢中: ぶらさがる羽とハート。飛びつきの高いところ (会心になる所) で星が光る
    if (e.state === 'charmed') {
      feather(ctx, x - 40 * s, headY() - 24 * s + Math.sin(t * 8) * 6 * s, 22 * s, -1.2 + Math.sin(t * 6) * 0.4);
      for (let i = 0; i < 3; i++) {
        const a = t * 3 + i * 2.1;
        outlinedText(ctx, '♥', x + Math.cos(a) * 34 * s, headY() + 18 * s + Math.sin(a) * 10 * s, 16, '#ff7fb0', '#fff');
      }
      if (C.atJumpPeak(e)) {
        ctx.strokeStyle = 'rgba(255,226,122,.95)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(x, headY() + 60 * sc, 70 * sc, 0, Math.PI * 2); ctx.stroke();
        outlinedText(ctx, '★', x + 50 * sc, headY() + 10 * sc, 26, '#ffe27a');
      }
    }
    if (e.state === 'windup') outlinedText(ctx, '!', x - 34 * s, headY() + 8 * s, 34 + Math.sin(t * 20) * 3, '#ff4b3a', '#fff');
    if (e.state === 'recover' && e.open) outlinedText(ctx, 'スキ!', x, headY() - 6 * s, 18 + Math.sin(t * 12) * 2, '#ff9a1a', '#fff');
    if (e.kind === 'quick' && (e.state === 'idle' || e.state === 'recover') && C.isLooking(e)) {
      outlinedText(ctx, '👀', x + 26 * s, headY() + 6 * s, 20, '#fff', '#fff');
    }
    if (e.kind === 'boss' && e.state !== 'charmed' && e.lureCount > 0 && e.state !== 'down') {
      outlinedText(ctx, '?'.repeat(e.lureCount), x + 30 * s, headY() + 4 * s, 20, '#ff7fb0', '#fff');
    }
    if (e.state === 'down') {
      // 目を回す
      for (let i = 0; i < 3; i++) {
        const a = t * 5 + i * 2.1;
        outlinedText(ctx, '★', x + Math.cos(a) * 30 * s, headY() + 20 * s + Math.sin(a) * 8 * s, 14, '#ffe27a');
      }
    }
    // 肉球ゲージ (頭の上)
    if (b.paw > 0 && e.state !== 'down') {
      for (let i = 0; i < C.PAW_MAX; i++) {
        ctx.globalAlpha = i < b.paw ? 1 : 0.3;
        outlinedText(ctx, '🐾', x - 44 * s + i * 22 * s, headY() - 30 * s, 15, '#fff', '#fff');
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawHero(ctx, b, t, dt) {
    const s = fieldSize.s;
    const r = C.rankIndexOf(state);
    let x = heroX();
    const y = fieldSize.ground;
    shadow(ctx, x, y, 38 * s);
    if (anim.punch > 0) {
      // 飛び込んでパンチ
      const k = Math.sin(anim.punch * Math.PI);
      const dash = (b && b.enemies[b.current] ? enemyX(b.enemies[b.current]) - x - 120 * s : 60 * s) * k;
      drawSprite(ctx, imgs['pose-punch'], x + dash, y - k * 24 * s, s * 0.95, { anchor: 0.4 });
      return;
    }
    if (anim.lure > 0) {
      drawSprite(ctx, imgs['pose-jarashi'], x, y, s * 0.95, { anchor: 0.32 });
      return;
    }
    const bob = Math.abs(Math.sin(t * 3.2)) * 3 * s;
    x -= anim.hurt * 10 * s;
    drawSprite(ctx, imgs[stageForRank(r)], x, y - bob, s, { flash: anim.hurt > 0.6 ? 0.8 : 0 });
  }

  function draw(now, dt) {
    const ctx = fgCtx;
    const w = fieldSize.w, h = fieldSize.h, s = fieldSize.s;
    if (!w) return;
    ctx.setTransform(fieldSize.dpr, 0, 0, fieldSize.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t = now / 1000;

    ['lure', 'punch', 'hurt', 'shake', 'flash', 'knock'].forEach(function (k) {
      const dur = { lure: 0.35, punch: 0.3, hurt: 0.4, shake: 0.25, flash: 0.35, knock: 0.25 }[k];
      anim[k] = Math.max(0, anim[k] - dt / dur);
    });
    if (anim.shake > 0) ctx.translate((Math.random() - 0.5) * 8 * anim.shake, (Math.random() - 0.5) * 5 * anim.shake);

    // 花びら
    ctx.fillStyle = 'rgba(247,168,196,.9)';
    petals.forEach(function (p) {
      p.y += p.v * dt; p.x += p.v * 0.5 * dt;
      if (p.y > 1.05) { p.y = -0.05; p.x = Math.random(); }
      if (p.x > 1.05) p.x = -0.05;
      ctx.beginPath();
      ctx.ellipse(p.x * w, p.y * h, 5, 3, Math.sin(t * 2 + p.p), 0, Math.PI * 2);
      ctx.fill();
    });

    // 見物の猫の声援
    cheer.t -= dt;
    if (cheer.t <= 0) {
      cheer = { t: 6 + Math.random() * 4, show: 1.6, text: ['がんばれにゃ!', 'いけー!', 'そこだにゃ!'][Math.floor(Math.random() * 3)], left: Math.random() < 0.5 };
    }
    if (cheer.show > 0 && battle) {
      cheer.show -= dt;
      outlinedText(ctx, cheer.text, cheer.left ? w * 0.16 : w * 0.84, h * 0.5, 13, '#3a8fe0', '#fff', cheer.left ? -0.1 : 0.1);
    }

    const b = battle || lastBattle;

    // 出陣の家臣 (自分の左うしろ)
    const allies = b ? b.allies : state.vassals.filter(function (v) { return v.job === 'battle'; }).slice(0, C.MAX_BATTLE_VASSALS);
    allies.forEach(function (a, i) {
      a.hop = Math.max(0, (a.hop || 0) - dt / 0.3);
      const ax = heroX() - (fieldSize.land ? 62 + i * 34 : 70 + i * 38) * s;
      const ay = fieldSize.ground - (18 + i * 10) * s;
      shadow(ctx, ax, ay, 20 * s);
      drawSprite(ctx, imgs[a.look] || imgs['cat-chatora'], ax, ay - Math.sin(a.hop * Math.PI) * 14 * s, s * 0.62, {});
    });

    if (b) {
      const e = b.enemies[b.current];
      if (e && e.state !== 'wait') drawEnemy(ctx, b, e, t);
    }
    drawHero(ctx, b, t, dt);

    effects = effects.filter(function (e) {
      e.t += dt;
      if (e.t >= e.dur) return false;
      drawEffect(ctx, e);
      return true;
    });

    if (anim.flash > 0) {
      ctx.setTransform(fieldSize.dpr, 0, 0, fieldSize.dpr, 0, 0);
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.8);
      g.addColorStop(0, 'rgba(255,60,40,0)');
      g.addColorStop(1, 'rgba(255,60,40,' + (0.4 * anim.flash) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // ---------------------------------------------------------- 合戦の流れ

  let paused = false;

  function showReady() {
    battle = null;
    lastBattle = null;
    paused = false;
    effects = [];
    els.resultPanel.hidden = true;
    els.pausePanel.hidden = true;
    els.itemMenu.hidden = true;
    els.readyPanel.hidden = false;
    els.readyTitle.textContent = '第' + kanjiNum((state.battlesWon || 0) + 1) + '戦';
    const r = C.rankIndexOf(state);
    const tips = [
      '猫じゃらしで すきを作って、<br>猫パンチ!',
      '肉球ゲージを ためてから パンチすると<br>大ダメージ!',
      'すばしっこい猫は、👀 のときに<br>猫じゃらしを振ろう',
      '敵が「!」と振りかぶったら、<br>猫じゃらしで「見切り」!',
      'ねこ侍は、攻撃のあとの「スキ」を<br>パンチで ねらおう',
      '大きなボス猫は、3回振ると夢中になるにゃ',
      '羽に飛びついた ★ のときにパンチすると<br>会心の猫パンチ!'
    ];
    els.readyText.innerHTML = tips[Math.min(r, tips.length - 1)];
    renderHud(true);
  }

  function sortie() {
    if (battle && battle.phase === 'fight') return;
    battle = C.createBattle(state, rng);
    lastBattle = null;
    paused = false;
    effects = [];
    els.readyPanel.hidden = true;
    els.resultPanel.hidden = true;
    renderHud(true);
  }

  function showBanner(text, size) {
    els.fieldBanner.textContent = text;
    els.fieldBanner.style.fontSize = (size || 46) + 'px';
    els.fieldBanner.hidden = false;
    const a = els.fieldBanner.animate([
      { opacity: 0, transform: 'scale(1.8)' },
      { opacity: 1, transform: 'scale(1)', offset: 0.2 },
      { opacity: 1, transform: 'scale(1)', offset: 0.75 },
      { opacity: 0, transform: 'scale(1)' }
    ], { duration: 1300, easing: 'ease-out' });
    a.onfinish = function () { els.fieldBanner.hidden = true; };
  }

  function row(label, value) {
    return '<div class="result-row"><span>' + label + '</span><b>' + value + '</b></div>';
  }

  function onBattleEnd(b) {
    lastBattle = b;
    battle = null;
    els.itemMenu.hidden = true;
    const res = C.applyBattleResult(state, b);
    state = res.state;
    saveSoon();
    if (b.phase === 'won') {
      pendingOffer = C.rollRecruitOffer(state, b);
      setFace('smile', 2.5);
      showBanner('勝利!');
      const gain = b.merit + b.bonus;
      let rows = row('倒した敵', b.enemies.length + ' 匹') + row('小判', '+' + gain) + row('経験値', '+' + gain) + row('資材', '+' + b.materials);
      if (b.loot.fish) rows += row('🐟 魚', '+' + b.loot.fish);
      if (b.loot.matatabi) rows += row('🌿 またたび', '+' + b.loot.matatabi);
      els.resultTitle.textContent = '勝利!';
      els.resultRows.innerHTML = rows;
      els.btnNext.textContent = 'つぎの戦へ';
      if (pendingOffer) {
        els.offer.hidden = false;
        els.offerImg.src = imgs[pendingOffer.look].src;
        els.offerText.textContent = pendingOffer.from + 'の「' + pendingOffer.name + '」が、仲間になりたそうにこちらを見ている!';
      } else {
        els.offer.hidden = true;
      }
      setTimeout(function () {
        els.resultPanel.hidden = false;
        if (res.rankedUp) showRankUp(res.prevRankIndex, res.rankIndex);
      }, 1100);
    } else {
      setFace('shy', 3);
      els.resultTitle.textContent = 'ひと休み…';
      els.resultRows.innerHTML = '<p class="panel-text">猫じゃらしで 夢中にすれば、<br>攻撃されずに たたけるにゃ。</p>';
      els.offer.hidden = true;
      els.btnNext.textContent = 'もう一度';
      setTimeout(function () { els.resultPanel.hidden = false; }, 600);
    }
    renderHud(true);
  }

  function acceptOffer() {
    if (!pendingOffer) return false;
    const r = C.acceptRecruitOffer(state, pendingOffer);
    pendingOffer = null;
    els.offer.hidden = true;
    if (r.ok) {
      state = r.state;
      saveSoon();
      showToast('「' + r.vassal.name + '」が家臣になった!', 2200);
    }
    return r.ok;
  }

  function showRankUp(prev, idx) {
    const rank = C.RANKS[idx];
    els.rankUpName.textContent = rank.name;
    els.rankUpArt.src = (prev < C.CASTLE_UNLOCK_RANK && idx >= C.CASTLE_UNLOCK_RANK) ? imgs['b-castle'].src : imgs[stageForRank(idx)].src;
    let text = rank.story;
    if (prev < C.VASSAL_UNLOCK_RANK && idx >= C.VASSAL_UNLOCK_RANK) text += '<br><b>家臣を持てるようになった!</b>';
    if (prev < C.CASTLE_UNLOCK_RANK && idx >= C.CASTLE_UNLOCK_RANK) text += '<br><b>城と村を持てるようになった!</b>';
    if (stageForRank(prev) !== stageForRank(idx)) text += '<br>見た目も りっぱになった!';
    els.rankUpText.innerHTML = text;
    els.rankModal.hidden = false;
    els.rankModal.querySelector('.modal-card').animate([{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    renderTabs();
    setFace('smile', 3);
  }

  function pauseBattle() {
    if (!battle || battle.phase !== 'fight') return;
    paused = true;
    els.itemMenu.hidden = true;
    els.pausePanel.hidden = false;
  }

  function resumeBattle() {
    paused = false;
    els.pausePanel.hidden = true;
  }

  /** 退却: 使ったアイテムだけ減る。ほかは何も減らない */
  function retreat() {
    if (battle) {
      state = C.applyBattleResult(state, battle).state;
      saveSoon();
    }
    showReady();
  }

  // ---------------------------------------------------------- 家臣

  const JOB_LABELS = { training: '自主練', labor: '普請', battle: '出陣' };

  function renderVassalsView() {
    const unlocked = isUnlocked('vassals');
    els.vassalsLocked.hidden = unlocked;
    els.vassalsContent.hidden = !unlocked;
    if (!unlocked) { els.vassalsLocked.textContent = lockedMessage('vassals'); els.vassalSlotCount.textContent = ''; return; }

    els.vassalSlotCount.textContent = state.vassals.length + ' / ' + C.vassalSlots(state) + ' 人';
    const inBattle = state.vassals.filter(function (v) { return v.job === 'battle'; }).length;
    els.vassalList.innerHTML = '';
    state.vassals.forEach(function (v) {
      const li = document.createElement('li');
      li.className = 'vassal-card paper';
      const img = document.createElement('img');
      img.src = imgs[v.look] ? imgs[v.look].src : imgs['cat-chatora'].src;
      img.alt = '';
      li.appendChild(img);

      const info = document.createElement('div');
      info.className = 'vassal-info';
      const top = document.createElement('div');
      top.className = 'vassal-top';
      top.innerHTML = '<span class="vassal-name"></span><span class="vassal-level"></span>';
      top.querySelector('.vassal-name').textContent = v.name;
      top.querySelector('.vassal-level').textContent = 'Lv.' + v.level + (v.level >= C.VASSAL_MAX_LEVEL ? ' (最大)' : '');
      const cost = C.trainVassalCost(v);
      const train = document.createElement('button');
      train.type = 'button';
      train.className = 'btn-gold vassal-train';
      train.textContent = '鍛える ' + cost;
      train.disabled = v.level >= C.VASSAL_MAX_LEVEL || state.merit < cost;
      train.addEventListener('click', function () { doTrainVassal(v.id); });
      top.appendChild(train);
      info.appendChild(top);

      const jobs = document.createElement('div');
      jobs.className = 'jobs';
      ['training', 'labor', 'battle'].forEach(function (job) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'job' + (v.job === job ? ' active' : '');
        b.textContent = JOB_LABELS[job];
        b.disabled = job === 'battle' && v.job !== 'battle' && inBattle >= C.MAX_BATTLE_VASSALS;
        b.addEventListener('click', function () { doAssignJob(v.id, job); });
        jobs.appendChild(b);
      });
      info.appendChild(jobs);
      li.appendChild(info);
      els.vassalList.appendChild(li);
    });
    updateRecruitButton();
  }

  function updateRecruitButton() {
    if (!isUnlocked('vassals')) return;
    els.btnRecruit.textContent = '村で仲間を募る (小判 ' + C.recruitCost(state) + ')';
    els.coinVassals.textContent = String(Math.floor(state.merit));
    els.btnRecruit.disabled = !C.canRecruitVassal(state);
  }

  function doRecruit() {
    const r = C.recruitVassal(state, rng);
    if (r.ok) { state = r.state; renderVassalsView(); renderHud(); saveSoon(); }
    return r.ok;
  }
  function doTrainVassal(id) {
    const r = C.trainVassal(state, id);
    if (r.ok) { state = r.state; renderVassalsView(); renderHud(); saveSoon(); }
    return r.ok;
  }
  function doAssignJob(id, job) {
    const r = C.assignVassalJob(state, id, job);
    if (r.ok) { state = r.state; renderVassalsView(); saveSoon(); }
    return r.ok;
  }

  // ---------------------------------------------------------- 城と村の地図
  //
  // 斜め上から見た 6x6 のマス。地面は大きさが変わったときだけ描き (map-bg)、
  // 建物と歩くねこは奥から順に毎コマ描く (map-fg)。

  const selected = { castle: null, village: null };
  const townMaps = { castle: makeTownMap('castle'), village: makeTownMap('village') };

  function makeTownMap(zone) {
    const root = $(zone + 'Map');
    const m = {
      zone: zone, root: root,
      bg: root.querySelector('.map-bg'), fg: root.querySelector('.map-fg'),
      w: 0, h: 0, dpr: 1, tw: 0, th: 0, ox: 0, oy: 0, walkers: []
    };
    m.bgCtx = m.bg.getContext('2d');
    m.fgCtx = m.fg.getContext('2d');
    m.fg.addEventListener('pointerdown', function (e) {
      const r = m.fg.getBoundingClientRect();
      const idx = cellAt(m, e.clientX - r.left, e.clientY - r.top);
      if (idx >= 0) selectCell(zone, idx);
    });
    return m;
  }

  function sizeMap(m) {
    const w = m.root.clientWidth;
    if (!(w >= 1)) return; // 隠れている間は 0。前の大きさのまま
    const N = C.MAP_SIZE;
    const tw = (w - 12) / N;
    const th = tw / 2;
    const top = tw * 1.35; // 建物が上へはみ出す分
    const h = Math.round(top + N * th + th * 0.9);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (w === m.w && h === m.h && dpr === m.dpr) return;
    m.w = w; m.h = h; m.dpr = dpr; m.tw = tw; m.th = th; m.ox = w / 2; m.oy = top;
    m.root.style.height = h + 'px';
    [m.bg, m.fg].forEach(function (c) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); });
    drawGround(m);
  }

  /** マスの上の頂点 (画面の位置) */
  function cellTop(m, gx, gy) {
    return { x: m.ox + (gx - gy) * m.tw / 2, y: m.oy + (gx + gy) * m.th / 2 };
  }

  /** 画面の位置 → マスの番号 (外なら -1) */
  function cellAt(m, x, y) {
    const dx = (x - m.ox) / (m.tw / 2);
    const dy = (y - m.oy) / (m.th / 2);
    const gx = Math.floor((dy + dx) / 2);
    const gy = Math.floor((dy - dx) / 2);
    if (gx < 0 || gy < 0 || gx >= C.MAP_SIZE || gy >= C.MAP_SIZE) return -1;
    return gy * C.MAP_SIZE + gx;
  }

  function diamond(ctx, m, gx, gy) {
    const t = cellTop(m, gx, gy);
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(t.x + m.tw / 2, t.y + m.th / 2);
    ctx.lineTo(t.x, t.y + m.th);
    ctx.lineTo(t.x - m.tw / 2, t.y + m.th / 2);
    ctx.closePath();
  }

  function drawGround(m) {
    const ctx = m.bgCtx, N = C.MAP_SIZE;
    ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    ctx.clearRect(0, 0, m.w, m.h);
    const castle = m.zone === 'castle';
    const L = { x: m.ox - N * m.tw / 2, y: m.oy + N * m.th / 2 };
    const B = { x: m.ox, y: m.oy + N * m.th };
    const Rr = { x: m.ox + N * m.tw / 2, y: m.oy + N * m.th / 2 };
    const depth = m.th * 0.7;
    // 台の側面 (手前の2面)
    ctx.fillStyle = castle ? '#8f8778' : '#a9794a';
    ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(B.x, B.y); ctx.lineTo(B.x, B.y + depth); ctx.lineTo(L.x, L.y + depth); ctx.closePath(); ctx.fill();
    ctx.fillStyle = castle ? '#7a7366' : '#93673d';
    ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.lineTo(Rr.x, Rr.y); ctx.lineTo(Rr.x, Rr.y + depth); ctx.lineTo(B.x, B.y + depth); ctx.closePath(); ctx.fill();
    if (castle) {
      // 石垣の目地
      ctx.strokeStyle = 'rgba(40,35,30,.25)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 2 * N; i++) {
        const k = i / (2 * N);
        const ax = L.x + (Rr.x - L.x) * k;
        const ay = ax <= B.x ? L.y + (B.y - L.y) * ((ax - L.x) / (B.x - L.x)) : B.y + (Rr.y - B.y) * ((ax - B.x) / (Rr.x - B.x));
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay + depth); ctx.stroke();
      }
    }
    // マス
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
      diamond(ctx, m, gx, gy);
      ctx.fillStyle = castle ? ((gx + gy) % 2 ? '#e4d8bd' : '#d9ccae') : ((gx + gy) % 2 ? '#a4d273' : '#96c865');
      ctx.fill();
      ctx.strokeStyle = castle ? 'rgba(120,100,70,.25)' : 'rgba(60,110,40,.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // 村は草のつぶつぶ、城は砂利
    const R = C.mulberry32(castle ? 11 : 22);
    for (let i = 0; i < 220; i++) {
      const gx = R() * N, gy = R() * N;
      const x = m.ox + (gx - gy) * m.tw / 2, y = m.oy + (gx + gy) * m.th / 2;
      ctx.fillStyle = castle ? 'rgba(110,95,70,.25)' : (i % 3 ? 'rgba(70,130,50,.35)' : 'rgba(255,255,220,.35)');
      ctx.fillRect(x, y, 2, castle ? 1.5 : 2);
    }
  }

  function buildingSize(m, type, im) {
    const def = C.BUILDINGS[type];
    // 施設の絵は、ふつうの建物が幅 190px ほど。それを 1 マスの 1.3 倍に合わせ、小物は小さいまま
    const w = def.big ? m.tw * 2.2 : im.naturalWidth * (m.tw * 1.3 / 190);
    return { w: w, h: w * im.naturalHeight / im.naturalWidth };
  }

  function wantedWalkers(zone) {
    if (zone === 'village') {
      const n = Math.min(16, Math.floor(state.village.population));
      const out = [];
      for (let i = 0; i < n; i++) out.push(i % 3 === 2 ? (i % 2 ? 'cat-chatora' : 'cat-gray') : 'b-villager');
      return out;
    }
    return state.vassals.slice(0, 8).map(function (v) { return v.look; });
  }

  function emptyCells(zone) {
    const out = [];
    state[zone].cells.forEach(function (c, i) { if (!c) out.push(i); });
    return out;
  }

  function pickTarget(zone) {
    const empty = emptyCells(zone);
    const N = C.MAP_SIZE;
    const i = empty.length ? empty[Math.floor(Math.random() * empty.length)] : Math.floor(Math.random() * N * N);
    return { gx: (i % N) + 0.3 + Math.random() * 0.4, gy: Math.floor(i / N) + 0.3 + Math.random() * 0.4 };
  }

  function updateWalkers(m, dt) {
    const want = wantedWalkers(m.zone);
    while (m.walkers.length > want.length) m.walkers.pop();
    while (m.walkers.length < want.length) {
      const p = pickTarget(m.zone);
      m.walkers.push({ gx: p.gx, gy: p.gy, tx: p.gx, ty: p.gy, wait: Math.random() * 2, phase: Math.random() * 6 });
    }
    m.walkers.forEach(function (wk, i) {
      wk.look = want[i];
      if (wk.wait > 0) { wk.wait -= dt; wk.moving = false; return; }
      const dx = wk.tx - wk.gx, dy = wk.ty - wk.gy;
      const d = Math.hypot(dx, dy);
      if (d < 0.05) {
        wk.wait = 1 + Math.random() * 2.5;
        const p = pickTarget(m.zone);
        wk.tx = p.gx; wk.ty = p.gy;
        wk.moving = false;
        return;
      }
      const step = Math.min(d, 0.7 * dt);
      wk.gx += dx / d * step;
      wk.gy += dy / d * step;
      wk.moving = true;
      wk.flip = (dx - dy) < 0; // 画面で左へ向かうとき
    });
  }

  function drawTownMap(m, now) {
    if (!m.w) return;
    const ctx = m.fgCtx;
    ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    ctx.clearRect(0, 0, m.w, m.h);
    const t = now / 1000;
    const N = C.MAP_SIZE;

    const sel = selected[m.zone];
    if (sel !== null) {
      diamond(ctx, m, sel % N, Math.floor(sel / N));
      ctx.fillStyle = 'rgba(255,226,122,' + (0.35 + 0.2 * Math.sin(t * 5)) + ')';
      ctx.fill();
      ctx.strokeStyle = '#b98b34';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    const items = [];
    state[m.zone].cells.forEach(function (type, i) {
      if (type) items.push({ depth: (i % N) + Math.floor(i / N) + 1, type: type, i: i });
    });
    m.walkers.forEach(function (wk) { items.push({ depth: wk.gx + wk.gy, walker: wk }); });
    items.sort(function (a, b) { return a.depth - b.depth; });

    items.forEach(function (it) {
      if (it.walker) {
        const wk = it.walker;
        const im = imgs[wk.look];
        if (!ready(im)) return;
        const x = m.ox + (wk.gx - wk.gy) * m.tw / 2;
        const y = m.oy + (wk.gx + wk.gy) * m.th / 2;
        const h = m.tw * 0.42;
        const w = h * im.naturalWidth / im.naturalHeight;
        const bob = wk.moving ? Math.abs(Math.sin(t * 9 + wk.phase)) * 3 : 0;
        ctx.fillStyle = 'rgba(60,40,20,.22)';
        ctx.beginPath(); ctx.ellipse(x, y, w * 0.32, w * 0.12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.translate(x, y - bob);
        if (wk.flip) ctx.scale(-1, 1);
        ctx.drawImage(im, -w / 2, -h, w, h);
        ctx.restore();
        return;
      }
      const def = C.BUILDINGS[it.type];
      const im = imgs[def.img];
      if (!ready(im)) return;
      const top = cellTop(m, it.i % N, Math.floor(it.i / N));
      const sz = buildingSize(m, it.type, im);
      const bottom = top.y + m.th * (def.big ? 1.25 : 1.1);
      ctx.drawImage(im, top.x - sz.w / 2, bottom - sz.h, sz.w, sz.h);
    });
  }

  function effectChips(zone) {
    const fx = C.townEffects(state);
    const pct = function (mul) { return Math.round((mul - 1) * 100); };
    const chips = [];
    if (zone === 'castle') {
      if (fx.slots) chips.push('家臣の枠 +' + fx.slots);
      if (fx.trainMul > 1) chips.push('自主練 +' + pct(fx.trainMul) + '%');
      if (fx.laborMul > 1) chips.push('普請 +' + pct(fx.laborMul) + '%');
      if (fx.atkMul > 1) chips.push('猫パンチ +' + pct(fx.atkMul) + '%');
      if (fx.hpMul > 1) chips.push('体力 +' + pct(fx.hpMul) + '%');
      if (fx.meritMul > 1) chips.push('小判と経験値 +' + pct(fx.meritMul) + '%');
    } else {
      chips.push('村人猫の上限 ' + C.villageCapacity(state) + '匹');
      if (fx.matMul > 1) chips.push('資材 +' + pct(fx.matMul) + '%');
      if (fx.popMatMul > 1) chips.push('村人の資材 +' + pct(fx.popMatMul) + '%');
      if (fx.growthMul > 1) chips.push('増え方 +' + pct(fx.growthMul) + '%');
    }
    return chips;
  }

  function renderTownView(zone) {
    const unlocked = isUnlocked(zone);
    const lockedEl = zone === 'castle' ? els.castleLocked : els.villageLocked;
    const contentEl = zone === 'castle' ? els.castleContent : els.villageContent;
    lockedEl.hidden = unlocked;
    contentEl.hidden = !unlocked;
    if (!unlocked) { lockedEl.querySelector('p').textContent = lockedMessage(zone); return; }
    sizeMap(townMaps[zone]);
    updateTownNumbers(zone);
    if (zone === 'castle') {
      els.castleBanner.hidden = !C.isCastleComplete(state);
      els.castleBanner.textContent = '🎉 お城の完成にゃ!';
    }
    $(zone + 'Effects').innerHTML = effectChips(zone).map(function (c) { return '<span>' + c + '</span>'; }).join('');
    renderSheet(zone);
  }

  function updateTownNumbers(zone) {
    const matText = '資材 ' + Math.floor(state.materials);
    if (zone === 'castle') els.materialCountCastle.textContent = matText;
    else {
      els.materialCountVillage.textContent = matText;
      const cap = C.villageCapacity(state);
      els.popLabel.textContent = '村人猫 ' + Math.floor(state.village.population) + ' / ' + cap + ' 匹';
      els.popFill.style.width = Math.min(100, state.village.population / cap * 100) + '%';
    }
  }

  function selectCell(zone, idx) {
    selected[zone] = (selected[zone] === idx) ? null : idx;
    renderSheet(zone);
  }

  function renderSheet(zone) {
    const sheet = $(zone + 'Sheet');
    const idx = selected[zone];
    if (idx === null) { sheet.hidden = true; sheet.innerHTML = ''; return; }
    sheet.hidden = false;
    sheet.innerHTML = '';
    const type = state[zone].cells[idx];
    const head = document.createElement('div');
    head.className = 'sheet-head';
    head.innerHTML = '<span></span>';
    head.firstChild.textContent = type ? '建っている物' : 'ここに建てる';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-paper';
    close.textContent = 'とじる';
    close.addEventListener('click', function () { selected[zone] = null; renderSheet(zone); });
    head.appendChild(close);
    sheet.appendChild(head);

    if (type) {
      const def = C.BUILDINGS[type];
      const info = document.createElement('div');
      info.className = 'built-info';
      info.innerHTML = '<img alt=""><div><div class="name"></div><div class="effect"></div></div>';
      info.querySelector('img').src = imgs[def.img].src;
      info.querySelector('.name').textContent = def.name;
      info.querySelector('.effect').textContent = def.deco ? C.DECO_EFFECT : def.effect;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-paper demolish';
      del.textContent = '取り壊す (資材 +' + Math.floor(def.cost / 2) + ')';
      del.addEventListener('click', function () { doDemolish(zone, idx); });
      info.querySelector('div').appendChild(del);
      sheet.appendChild(info);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'build-grid';
    Object.keys(C.BUILDINGS).forEach(function (t) {
      const def = C.BUILDINGS[t];
      if (def.zone !== zone) return;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'build-card';
      card.dataset.type = t;
      card.innerHTML = '<img alt=""><span class="name"></span><span class="effect"></span><span class="cost"></span>';
      card.querySelector('img').src = imgs[def.img].src;
      card.querySelector('.name').textContent = def.name;
      card.querySelector('.effect').textContent = def.deco ? 'かざり・にぎわい' : def.effect;
      card.addEventListener('click', function () { doPlaceBuilding(zone, idx, t); });
      grid.appendChild(card);
    });
    sheet.appendChild(grid);
    refreshSheet(zone);
  }

  /** 資材が増えたときは、札を作り直さずに押せるかどうかと値段だけ直す (押している最中に札が入れ替わらないように) */
  function refreshSheet(zone) {
    const idx = selected[zone];
    if (idx === null) return;
    $(zone + 'Sheet').querySelectorAll('.build-card').forEach(function (card) {
      const t = card.dataset.type;
      const def = C.BUILDINGS[t];
      const n = C.countBuildings(state, t);
      card.disabled = !C.canPlaceBuilding(state, zone, idx, t);
      card.querySelector('.cost').textContent = '資材 ' + C.buildingCost(state, t) + (def.max ? ' (' + n + '/' + def.max + ')' : '');
    });
  }

  function doPlaceBuilding(zone, idx, type) {
    const was = C.isCastleComplete(state);
    const r = C.placeBuilding(state, zone, idx, type);
    if (r.ok) {
      state = r.state;
      selected[zone] = null;
      renderTownView(zone);
      saveSoon();
      if (!was && C.isCastleComplete(state)) showToast('🎉 お城の完成にゃ!', 3200);
      else showToast(C.BUILDINGS[type].name + 'を建てた!', 1400);
    }
    return r.ok;
  }

  function doDemolish(zone, idx) {
    const r = C.demolish(state, zone, idx);
    if (r.ok) {
      state = r.state;
      selected[zone] = null;
      renderTownView(zone);
      saveSoon();
    }
    return r.ok;
  }

  // ---------------------------------------------------------- ボタン

  function press(btn) {
    btn.classList.add('pressed');
    setTimeout(function () { btn.classList.remove('pressed'); }, 90);
  }

  function doLure() { if (!battle || paused) return false; const ok = C.lure(battle); if (ok) press(els.btnLure); return ok; }
  function doPunch() { if (!battle || paused) return false; const ok = C.punch(battle); if (ok) press(els.btnPunch); return ok; }
  function doItem(kind) {
    if (!battle || paused) return false;
    const ok = C.useItem(battle, kind);
    if (ok) els.itemMenu.hidden = true;
    return ok;
  }
  function toggleItemMenu() {
    if (!battle || paused) return;
    els.itemMenu.hidden = !els.itemMenu.hidden;
    const e = C.currentEnemy(battle);
    els.btnFish.disabled = !(battle.items.fish > 0) || battle.player.hp >= battle.player.maxHp;
    els.btnMatatabi.disabled = !(battle.items.matatabi > 0) || !e || e.state === 'enter';
  }

  // 連打するので click (指を離したとき) ではなく pointerdown (触れた瞬間) で受ける
  function onDown(btn, fn) {
    btn.addEventListener('pointerdown', function (e) { e.preventDefault(); fn(); });
  }

  // ---------------------------------------------------------- 始まり

  function startGame() {
    if (!titleShown) return;
    titleShown = false;
    // 消えるまでの間も下の画面を押せるように、まず押せなくしてから薄くする
    els.titleScreen.style.pointerEvents = 'none';
    const a = els.titleScreen.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: 'ease-out' });
    a.onfinish = function () { els.titleScreen.hidden = true; };
    sizeField();
    if (!state.storySeen) els.storyModal.hidden = false;
  }

  function closeStory() {
    els.storyModal.hidden = true;
    state = Object.assign({}, state, { storySeen: true });
    saveSoon();
  }

  // ---------------------------------------------------------- ループ

  let last = performance.now();
  let uiAcc = 0;

  function frame(now) {
    // コマの間隔は上も下も止める (負の dt が来ても暴れないように)
    const dt = Math.max(0, Math.min((now - last) / 1000, OFFLINE_CAP_SECONDS));
    last = now;

    if (dt > 0) {
      const prev = C.rankIndexOf(state);
      state = C.tick(state, dt);
      const idx = C.rankIndexOf(state);
      if (idx > prev) {
        if (battle) showToast('出世! 「' + C.RANKS[idx].name + '」になった', 2600);
        else showRankUp(prev, idx);
      }
    }

    if (currentTab === 'battle' && !titleShown) {
      if (battle) {
        if (battle.phase === 'fight' && !paused) C.stepBattle(battle, dt);
        // 知らせは戦の最中でなくても読む。最後の1匹をパンチで倒すと、
        // 勝ちの知らせは stepBattle の外で出る (読まないと勝利の札が出ずに止まる)
        handleEvents(battle);
      }
      draw(now, paused ? 0 : Math.min(dt, 0.1));
      updateFace(now);
      renderHud(false);
    }

    if ((currentTab === 'castle' || currentTab === 'village') && isUnlocked(currentTab)) {
      const m = townMaps[currentTab];
      updateWalkers(m, Math.min(dt, 0.1));
      drawTownMap(m, now);
    }

    uiAcc += dt;
    if (uiAcc >= 0.25) {
      uiAcc = 0;
      if ((currentTab === 'castle' || currentTab === 'village') && isUnlocked(currentTab)) {
        updateTownNumbers(currentTab);
        refreshSheet(currentTab);
      }
      if (currentTab === 'vassals') updateRecruitButton();
    }

    requestAnimationFrame(frame);
  }

  function main() {
    els.btnStart.addEventListener('click', startGame);
    els.btnStory.addEventListener('click', closeStory);
    els.btnRankOk.addEventListener('click', function () { els.rankModal.hidden = true; renderTabs(); });
    els.btnSortie.addEventListener('click', sortie);
    els.btnNext.addEventListener('click', function () {
      if (pendingOffer) { pendingOffer = null; els.offer.hidden = true; }
      const won = lastBattle && lastBattle.phase === 'won';
      showReady();
      if (!won) sortie();
    });
    els.btnOfferYes.addEventListener('click', acceptOffer);
    els.btnOfferNo.addEventListener('click', function () { pendingOffer = null; els.offer.hidden = true; });
    onDown(els.btnLure, doLure);
    onDown(els.btnPunch, doPunch);
    els.btnItem.addEventListener('click', toggleItemMenu);
    els.btnFish.addEventListener('click', function () { doItem('fish'); });
    els.btnMatatabi.addEventListener('click', function () { doItem('matatabi'); });
    els.btnPause.addEventListener('click', pauseBattle);
    els.btnResume.addEventListener('click', resumeBattle);
    els.btnRetreat.addEventListener('click', retreat);
    els.btnRecruit.addEventListener('click', doRecruit);
    Object.keys(tabEls).forEach(function (tab) {
      tabEls[tab].addEventListener('click', function () { switchTab(tab); });
    });

    document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
    window.addEventListener('pagehide', saveNow);
    setInterval(saveNow, 5000);
    if (window.ResizeObserver) new ResizeObserver(sizeField).observe(els.field);
    window.addEventListener('resize', function () {
      sizeField();
      if (currentTab === 'castle' || currentTab === 'village') sizeMap(townMaps[currentTab]);
    });

    switchTab('battle');
    showReady();
    requestAnimationFrame(frame);

    // 自動テストから中身をのぞく・操作するための入口
    window.__app = {
      state: function () { return state; },
      battle: function () { return battle; },
      lastBattle: function () { return lastBattle; },
      tab: function () { return currentTab; },
      setTab: switchTab,
      titleShown: function () { return titleShown; },
      start: startGame,
      closeStory: closeStory,
      sortie: sortie,
      lure: doLure,
      punch: doPunch,
      item: doItem,
      paused: function () { return paused; },
      offer: function () { return pendingOffer; },
      acceptOffer: acceptOffer,
      face: function () { return face.shown; },
      fieldSize: function () { return Object.assign({}, fieldSize); },
      // 立ち位置。enterLeft は、歩き出す瞬間の敵の絵の左端 (種類ごとの最小)。画面の外 (>= w) であるべき
      layout: function () {
        let enterLeft = Infinity;
        Object.keys(C.ENEMY_KINDS).forEach(function (k) {
          const e = { x: C.ENTER_X, state: 'enter', kind: k, look: C.ENEMY_KINDS[k].look, boss: k === 'boss' };
          const im = imgs[e.look];
          enterLeft = Math.min(enterLeft, enemyX(e) - im.naturalWidth * enemyScale(e) / 2);
        });
        return { bg: battleBgReady ? 'image' : 'drawn', bgGroundY: fieldSize.bgGroundY, land: !!fieldSize.land, w: fieldSize.w, h: fieldSize.h, s: fieldSize.s, ground: fieldSize.ground,
          heroX: heroX(), enemyX: fx(C.ENEMY_X), heroHalf: imgs.stage1.naturalWidth * fieldSize.s / 2, enterLeft: enterLeft };
      },
      recruit: doRecruit,
      trainVassal: doTrainVassal,
      assignJob: doAssignJob,
      build: doPlaceBuilding,
      demolish: doDemolish,
      select: selectCell,
      selected: function (zone) { return selected[zone]; },
      walkers: function (zone) { return townMaps[zone].walkers.length; },
      /** マスの真ん中の、画面での位置 (指で押すテスト用) */
      cellPoint: function (zone, idx) {
        const m = townMaps[zone];
        const r = m.fg.getBoundingClientRect();
        const t = cellTop(m, idx % C.MAP_SIZE, Math.floor(idx / C.MAP_SIZE));
        return { x: r.left + t.x, y: r.top + t.y + m.th / 2 };
      },
      debugAddMerit: function (n) {
        const res = C.addMerit(state, n);
        state = res.state;
        renderTabs(); renderActiveView(); renderHud(true);
        if (res.rankedUp) showRankUp(res.prevRankIndex, res.rankIndex);
      },
      debugSetMaterials: function (n) {
        state = Object.assign({}, state, { materials: n });
        renderActiveView();
      },
      closeModals: function () { els.rankModal.hidden = true; els.storyModal.hidden = true; }
    };
  }

  main();
})();
