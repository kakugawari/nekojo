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
    missionText: $('missionText'), chargeGauge: $('chargeGauge'), chargeFill: $('chargeFill'), chargeLabel: $('chargeLabel'),
    btnItem: $('btnItem'), itemBadge: $('itemBadge'), itemMenu: $('itemMenu'),
    btnFish: $('btnFish'), btnMatatabi: $('btnMatatabi'), fishCount: $('fishCount'), matatabiCount: $('matatabiCount'),
    btnPause: $('btnPause'), pausePanel: $('pausePanel'), btnResume: $('btnResume'), btnRetreat: $('btnRetreat'),
    coinVassals: $('coinVassals'),
    field: $('field'), fieldBg: $('fieldBg'), fieldFg: $('fieldFg'), fieldBanner: $('fieldBanner'),
    readyPanel: $('readyPanel'), readyTitle: $('readyTitle'), readyText: $('readyText'), btnSortie: $('btnSortie'),
    readyTrain: $('readyTrain'), resultTrain: $('resultTrain'),
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
  const views = { battle: $('view-battle'), realm: $('view-realm'), vassals: $('view-vassals'), castle: $('view-castle'), village: $('view-village') };
  const tabEls = { battle: $('tab-battle'), realm: $('tab-realm'), vassals: $('tab-vassals'), castle: $('tab-castle'), village: $('tab-village') };
  const TAB_LABELS = { battle: '合戦', realm: '天下', vassals: '家臣', castle: '城', village: '村' };

  // ---------------------------------------------------------- 絵

  const IMG_NAMES = ['stage0', 'stage1', 'stage2', 'stage3', 'cat-normal', 'cat-chatora', 'cat-kuro', 'cat-gray', 'cat-red',
    'face-normal', 'face-smile', 'face-serious', 'face-surprised', 'face-angry', 'face-shy', 'pose-special', 'pose-jarashi', 'pose-punch', 'b-villager',
    'r-coin', 'r-catcoin', 'r-swords', 'r-tag-strength', 'r-tag-reward']
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
    if (tab === 'realm') return C.isRealmUnlocked(state);
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
    if (tab === 'realm') return '「' + C.RANKS[C.REALM_UNLOCK_RANK].name + '」になると、お殿様から 国をひとつ任されるにゃ。\nとなりの国の大名を倒して、天下統一をめざそう!';
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
    else if (currentTab === 'realm') renderRealmView();
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
    const cq = battle ? battle.conquest : (lastBattle && lastBattle.conquest);
    setText(els.missionText, 'mission', cq ? cq.name + 'の大名を倒す' : (MISSIONS[r] || MISSIONS[0]));
    const next = C.RANKS[r + 1];
    setWidth(els.nextFill, 'exp', next
      ? Math.max(0, Math.min(100, (state.totalMerit - C.RANKS[r].threshold) / (next.threshold - C.RANKS[r].threshold) * 100))
      : 100);

    const b = battle;
    const maxHp = b ? b.player.maxHp : heroStats().hp;
    const hp = b ? b.player.hp : maxHp;
    setWidth(els.hpFill, 'hp', hp / maxHp * 100);
    setText(els.hpText, 'hpText', Math.ceil(hp) + '/' + maxHp);
    setOnce('low', hp / maxHp < 0.3, function (v) { els.hpFill.classList.toggle('low', v); });

    const e = b ? b.enemies[b.current] : null;
    const showEnemy = !!(e && (e.alive || e.state === 'down') && e.state !== 'wait');
    setOnce('enemyShown', showEnemy, function (v) { els.enemyUnit.hidden = !v; });
    if (showEnemy) {
      setText(els.enemyName, 'enemyName', e.name);
      setWidth(els.enemyHpFill, 'enemyHp', e.hp / e.maxHp * 100);
      setOnce('enemyFace', e.look, function (v) { els.enemyFaceImg.src = imgs[v].src; });
    }

    // 修行の札 (小判・段位・修行の段が変わったときだけ書き換える)
    setOnce('train', Math.floor(state.merit) + '|' + r + '|' + C.heroLevel(state, 'hp') + '|' + C.heroLevel(state, 'atk'), renderTrain);

    // 溜めゲージ (押している長さ)。30 段に丸めて、変わったときだけ書き換える
    const charging = !!(b && b.charge.on);
    const ch = charging ? Math.round(Math.min(1, b.charge.t / C.CHARGE_LEVELS[2]) * 30) / 30 : 0;
    setOnce('charge', ch, function (v) { els.chargeFill.style.transform = 'scaleX(' + v + ')'; });
    const lv = charging ? C.chargeLevel(b.charge.t) : -1;
    setOnce('chargeLv', lv, function (v) {
      els.chargeGauge.classList.toggle('on', v >= 0);
      els.chargeGauge.classList.toggle('lv1', v === 1);
      els.chargeGauge.classList.toggle('lv2', v === 2);
      els.chargeLabel.textContent = v < 0 ? 'ながおしで ためる' : ['ためて…', '強パンチ!', '会心!'][v];
    });
    // 夢中 MAX の間は、猫パンチが光る (今だ!)
    setOnce('ready', !!(e && e.state === 'charmed'), function (v) { els.btnPunch.classList.toggle('ready', v); });

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
    // 上の札 (自分と敵の体力) の下端。敵の頭の上のゲージやしるしは、これより下に出す
    // (大きなボス猫は背が高く、そのまま頭の上に出すと敵の札の裏に隠れた)
    const lb = els.btnLure.getBoundingClientRect(), fb = els.field.getBoundingClientRect();
    fieldSize.lureBox = lb.width > 0 ? { right: lb.right - fb.left, top: lb.top - fb.top } : null;
    const hud = document.querySelector('.hud-top');
    fieldSize.hudBottom = hud ? Math.max(0, hud.getBoundingClientRect().bottom - els.field.getBoundingClientRect().top) : 0;
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
  const anim = { lure: 0, punch: 0, hurt: 0, shake: 0, flash: 0, knock: 0, punchLevel: 0, charge: 0, hop: 0, crash: 0, barrelIn: 1 };
  const petals = [];
  for (let i = 0; i < 12; i++) petals.push({ x: Math.random(), y: Math.random(), v: 0.03 + Math.random() * 0.03, p: Math.random() * 6 });
  let cheer = { t: 3, text: '' };

  // 効果音。いまは溜めが会心に届いたときの「ポン」だけ。音は最初に画面を押したときに鳴らせるようになる (iOS の決まり)
  let audioCtx = null;
  const sfxCount = { pon: 0 };
  function unlockAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { audioCtx = new AC(); } catch (err) { return; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  function playPon() {
    sfxCount.pon++;
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(1040, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t);
    o.stop(t + 0.3);
  }

  function addEffect(e) {
    e.t = 0;
    effects.push(e);
  }

  function heroX() { return fx(C.PLAYER_X); }
  /** 樽の山の位置 (足もと)。ボタンや家臣と重ならないよう、少し奥 (高い所) に置く */
  function obstaclePos() {
    const s = fieldSize.s;
    const im = imgs['b-barrels'];
    const half = im && im.naturalHeight ? 78 * s * im.naturalWidth / im.naturalHeight / 2 : 40 * s;
    // 縦画面では左の端で切れるので、画面の中に収まるところまで寄せる
    let x = Math.max(fx(C.OBSTACLE_X), half + 4);
    const y = fieldSize.ground - 34 * s;
    // 横画面では猫じゃらしのボタンと高さが重なるので、ボタンの右へずらす
    const lb = fieldSize.lureBox;
    if (lb && y > lb.top) x = Math.max(x, lb.right + half + 6);
    return { x: x, y: y };
  }
  function drawObstacle(ctx, b, dt) {
    const ob = b ? b.obstacle : (C.rankIndexOf(state) >= C.YUDO_RANK ? { ok: true } : null);
    if (!ob) return;
    const s = fieldSize.s;
    const o = obstaclePos();
    anim.barrelIn = Math.min(1, anim.barrelIn + dt / 0.5);
    const im = imgs['b-barrels'];
    if (!ready(im)) return;
    const sc = 78 * s / im.naturalHeight;
    if (ob.ok) {
      shadow(ctx, o.x, o.y, 34 * s);
      drawSprite(ctx, im, o.x, o.y, sc, { alpha: anim.barrelIn });
    } else if (anim.crash > 0) {
      // こわれた樽の板が飛び散る
      const k = 1 - anim.crash;
      ctx.fillStyle = '#8a5a2a';
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI * (0.15 + i / 9 * 0.7);
        const d = 90 * s * k;
        ctx.save();
        ctx.translate(o.x + Math.cos(a) * d, o.y - 30 * s + Math.sin(a) * d + 120 * s * k * k);
        ctx.rotate(k * 8 + i);
        ctx.globalAlpha = 1 - k;
        ctx.fillRect(-10 * s, -3 * s, 20 * s, 6 * s);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** 出陣の家臣の立ち位置 (自分の左うしろ) */
  function allyPos(i) {
    const s = fieldSize.s;
    return { x: heroX() - (fieldSize.land ? 62 + i * 34 : 70 + i * 38) * s, y: fieldSize.ground - (18 + i * 10) * s };
  }
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
    charm: ['♡', '#ff5f9e', 26], max: ['夢中 MAX!', '#ff5f9e', 24], weak: ['見られてる…', '#7a6650', 16], full: ['もう夢中!', '#ff5f9e', 16],
    yudo: ['こっちだにゃ!', '#ff5f9e', 20]
  };
  const PUNCH_WORD = ['バシッ!', 'ドカッ!', 'ドッカーン!'];

  function handleEvents(b) {
    const s = fieldSize.s;
    const e = b.enemies[b.current];
    const ex = e ? enemyX(e) : fieldSize.w * 0.7;
    const top = e ? fieldSize.ground - 150 * enemyScale(e) : fieldSize.ground - 150 * s;
    for (let i = 0; i < b.events.length; i++) {
      const ev = b.events[i];
      if (ev.type === 'lure') {
        anim.lure = 1;
        addEffect({ kind: 'swish', dur: 0.45, big: ev.result === 'max' });
        const lt = LURE_TEXT[ev.result];
        // 字は顔のあたりに出す (頭の上はゲージと「今だ!」の場所)
        if (lt) addEffect({ kind: 'text', x: ex, y: top + 40 * s, text: lt[0], color: lt[1], size: lt[2], dur: 0.9 });
        if (ev.result === 'max') setFace('smile', 1.0);
        if (ev.result === 'weak') setFace('shy', 0.7);
      } else if (ev.type === 'rushWarn') {
        setFace('surprised', 1.0);
      } else if (ev.type === 'rush') {
        if (ev.to === 'obstacle') anim.hop = 1; // ボス猫が羽を追って頭の上を通る。主人公はぴょんと跳ぶ
      } else if (ev.type === 'crash') {
        const o = obstaclePos();
        anim.crash = 1;
        anim.shake = 1;
        addEffect({ kind: 'burst', x: o.x, y: o.y - 30 * s, r: 90 * s, dur: 0.45 });
        addEffect({ kind: 'text', x: o.x + 20 * s, y: o.y - 110 * s, text: 'ドカーン!', color: '#ffd84a', size: 40, rot: -0.1, stroke: '#3a2a1c', dur: 1.0 });
        addEffect({ kind: 'dust', x: o.x, y: o.y - 10 * s, dur: 0.8 });
        setFace('smile', 1.6);
      } else if (ev.type === 'obstacleBack') {
        anim.barrelIn = 0;
        const o = obstaclePos();
        addEffect({ kind: 'text', x: o.x, y: o.y - 90 * s, text: 'よいしょ!', color: '#7a4a1c', size: 16, dur: 0.9 });
      } else if (ev.type === 'chargeStart') {
        anim.charge = 0;
      } else if (ev.type === 'charge') {
        const hx = heroX() + 44 * s, hy = fieldSize.ground - 80 * s;
        if (ev.level === 2) {
          addEffect({ kind: 'text', x: hx, y: hy - 40 * s, text: 'ポン!', color: '#ffd84a', size: 30, stroke: '#3a2a1c', dur: 0.8 });
          addEffect({ kind: 'ring', x: hx, y: hy, r: 60 * s, dur: 0.35 });
          playPon();
          setFace('serious', 1.0);
        } else {
          addEffect({ kind: 'ring', x: hx, y: hy, r: 40 * s, dur: 0.3 });
        }
      } else if (ev.type === 'chargeBroken') {
        addEffect({ kind: 'text', x: heroX() + 30 * s, y: fieldSize.ground - 170 * s, text: 'あっ…', color: '#7a6650', size: 18, dur: 0.8 });
      } else if (ev.type === 'hit') {
        if (ev.source === 'punch') {
          const lv = ev.level || 0;
          anim.punch = 1;
          anim.punchLevel = lv;
          anim.knock = 1;
          const big = lv >= 1 || ev.max || ev.crit;
          addEffect({ kind: 'burst', x: ex - 20 * s, y: fieldSize.ground - 80 * s, r: [46, 64, 90][lv] * s * (ev.max ? 1.15 : 1), dur: 0.3 + 0.1 * lv });
          addEffect({ kind: 'text', x: ex + 10 * s, y: top - 30 * s, text: ev.armor && !ev.max ? 'カキン!' : PUNCH_WORD[lv], color: '#ffd84a', size: [32, 38, 44][lv], rot: -0.12, dur: 0.75, stroke: '#3a2a1c' });
          let label = '';
          if (ev.counter) label = 'カウンター!';
          else if (ev.open) label = 'スキあり!';
          else if (lv === 2) label = ev.max ? '特大 猫パンチ!' : '会心の猫パンチ!';
          else if (lv === 1) label = '強パンチ!';
          if (label) addEffect({ kind: 'text', x: ex, y: top - 70 * s, text: label, color: '#c8412f', size: 20, dur: 1.0 });
          if (lv === 2 && ev.max) startCutin();
          if (lv >= 1) anim.shake = 0.6 + 0.4 * (lv - 1);
          if (big) setFace('smile', 1.0);
        } else if (ev.source === 'ally') {
          addEffect({ kind: 'burst', x: ex - 10 * s, y: fieldSize.ground - 100 * s, r: 20 * s, dur: 0.2 });
        }
        addEffect({ kind: 'num', x: ex + 30 * s, y: top + 10 * s, text: String(ev.amount), crit: ev.crit || ev.max, dur: 0.8 });
      } else if (ev.type === 'parry') {
        anim.punch = 1;
        anim.punchLevel = ev.level || 0;
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
        anim.punchLevel = ev.level || 0;
        addEffect({ kind: 'text', x: heroX() + 60 * s, y: fieldSize.ground - 140 * s, text: 'スカッ', color: '#7a6650', size: 16, dur: 0.7 });
        setFace('shy', 0.8);
      } else if (ev.type === 'item') {
        addEffect({ kind: 'text', x: ev.item === 'fish' ? heroX() : ex, y: top - 10 * s,
          text: ev.item === 'fish' ? '🐟 +' + ev.amount : '🌿 夢中 MAX!', color: ev.item === 'fish' ? '#3a8fe0' : '#5fa83a', size: 20, dur: 1.0 });
        setFace('smile', 0.8);
      } else if (ev.type === 'skill') {
        // 家臣の得意技が効いた。その家臣が跳ねて、しるしを出す
        const i2 = b.allies.findIndex(function (x) { return x.skill === ev.skill; });
        if (i2 >= 0) {
          const a = b.allies[i2];
          const pos = allyPos(i2);
          a.hop = 1;
          addEffect({ kind: 'text', x: pos.x, y: pos.y - 105 * s, text: C.VASSAL_SKILLS[ev.skill].icon, color: '#fff', size: 20, dur: 0.7 });
        }
        if (ev.skill === 'heal') {
          addEffect({ kind: 'num', x: heroX(), y: fieldSize.ground - 170 * s, text: '+' + ev.amount, heal: true, dur: 0.9 });
        }
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
      outlinedText(ctx, e.text, e.x, e.y - 30 * s * k, e.crit ? 32 : (e.hurt || e.heal ? 22 : 24), e.hurt ? '#ff6a55' : (e.heal ? '#5fcf5a' : (e.crit ? '#ffd84a' : '#ffffff')));
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
    } else if (e.kind === 'ring') {
      // 溜めの段が上がったとき、肉球から広がる輪
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.4 + k), 0, Math.PI * 2); ctx.stroke();
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

  /** 敵の頭の上: 夢中ゲージと、しるし (警戒「!」/ 攻撃の予告 赤い「!」/ 夢中「♡」/ MAX 肉球) */
  function drawMood(ctx, e, x, headY, t) {
    const s = fieldSize.s;
    const mood = C.enemyMood(e);
    const gw = 96 * s, gh = 12 * s, gx = x - gw / 2 + 10 * s;
    const gy = Math.max(headY - 34 * s, (fieldSize.hudBottom || 0) + 34 * s);
    // ゲージ
    ctx.fillStyle = 'rgba(30,26,40,.82)';
    ctx.beginPath(); ctx.roundRect(gx - 2, gy - 2, gw + 4, gh + 4, gh / 2 + 2); ctx.fill();
    const k = Math.max(0, Math.min(1, e.muchu / C.MUCHU_MAX));
    if (k > 0) {
      const flash = mood === 'max' ? 0.75 + 0.25 * Math.sin(t * 14) : 1;
      ctx.globalAlpha = flash;
      ctx.fillStyle = mood === 'max' ? '#ffd84a' : (e.muchu >= C.MUCHU_CHASE ? '#ff5f9e' : '#ff9cc4');
      ctx.beginPath(); ctx.roundRect(gx, gy, gw * k, gh, gh / 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // 半分の印 (ここから先は追いかけていて、攻撃してこない)
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillRect(gx + gw * C.MUCHU_CHASE / C.MUCHU_MAX - 1, gy + 2, 2, gh - 4);
    // しるし (ゲージの左)
    const ix = gx - 16 * s, iy = gy + gh / 2 + 7 * s;
    if (mood === 'rush') {
      // 突進の予告: 大きな赤い「!!」。樽があれば、猫じゃらしで誘導できると添える
      const p = 1 + 0.18 * Math.sin(t * 20);
      ctx.fillStyle = 'rgba(255,75,58,.4)';
      ctx.beginPath(); ctx.arc(ix, iy - 10 * s, 28 * s * p, 0, Math.PI * 2); ctx.fill();
      outlinedText(ctx, '!!', ix, iy, 40 * p, '#ff3b2a', '#fff');
      if (e.state === 'rushWarn' && battle && battle.obstacle && battle.obstacle.ok && !e.lured) {
        outlinedText(ctx, '🪶 じゃらして 樽へ!', x, gy - 16 * s, 17 + Math.sin(t * 10) * 1.5, '#c8412f', '#fff');
      }
    } else if (mood === 'attack') {
      const p = 1 + 0.15 * Math.sin(t * 24);
      ctx.fillStyle = 'rgba(255,75,58,.35)';
      ctx.beginPath(); ctx.arc(ix, iy - 8 * s, 22 * s * p, 0, Math.PI * 2); ctx.fill();
      outlinedText(ctx, '!', ix, iy, 38 * p, '#ff3b2a', '#fff');
    } else if (mood === 'alert') {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#3a2a1c';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ix, iy - 7 * s, 13 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      outlinedText(ctx, '!', ix, iy, 20, '#3a2a1c', '#fff');
    } else if (mood === 'chase') {
      outlinedText(ctx, '♥', ix, iy + Math.sin(t * 8) * 2 * s, 24 * (0.8 + 0.4 * k), '#ff5f9e', '#fff');
    } else if (mood === 'max') {
      outlinedText(ctx, '🐾', ix, iy + Math.sin(t * 10) * 3 * s, 26, '#fff', '#fff');
      outlinedText(ctx, '今だ!', x + 10 * s, gy - 12 * s, 16 + Math.sin(t * 12) * 2, '#c8412f', '#fff');
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
    const chasing = C.isChasing(e);

    if (e.state === 'enter') {
      y -= Math.abs(Math.sin(t * 10)) * 6 * s;
    } else if (e.state === 'idle' && chasing) {
      // 羽を追いかけて、ぴょこぴょこ跳ねる
      y -= Math.abs(Math.sin(t * 9)) * 16 * s;
      x -= 10 * s + Math.sin(t * 4.5) * 8 * s;
      rot = Math.sin(t * 9) * 0.06;
    } else if (e.state === 'idle') {
      y -= Math.abs(Math.sin(t * 3 + e.id)) * 3 * s;
    } else if (e.state === 'windup') {
      rot = -0.16;
      x += Math.sin(t * 40) * 2;
    } else if (e.state === 'rushWarn') {
      // 突進の予告: 体を低くして、足で地面をかく
      rot = -0.12;
      y += 6 * s;
      x += Math.sin(t * 30) * 3 * s;
      if (Math.floor(t * 8) % 2 === 0) {
        ctx.fillStyle = 'rgba(214,190,140,.7)';
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + (30 + i * 14) * sc, fieldSize.ground - 6 * s, (8 + i * 3) * s, 0, Math.PI * 2); ctx.fill(); }
      }
    } else if (e.state === 'rush') {
      // 突っ込む: 前のめりで、うしろに風の線
      rot = -0.22;
      y -= Math.abs(Math.sin(t * 22)) * 8 * s;
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const ly = y - (30 + i * 28) * sc;
        ctx.beginPath(); ctx.moveTo(x + 50 * sc, ly); ctx.lineTo(x + (110 + i * 12) * sc, ly); ctx.stroke();
      }
      if (e.rushTo === 'obstacle') feather(ctx, x - 70 * s, y - 90 * s, 24 * s, -1.6); // 羽が先を行く
    } else if (e.state === 'rushBack') {
      rot = 0.1;
    } else if (e.state === 'charmed' && e.dizzy) {
      // 樽にぶつかって目を回している
      rot = Math.sin(t * 6) * 0.12;
      y -= 2 * s;
    } else if (e.state === 'charmed') {
      // 夢中 MAX: 羽に見とれて動けない (小さく揺れるだけ)
      rot = -0.1 + Math.sin(t * 3) * 0.03;
      x -= 18 * s;
      y -= 6 * s;
    } else if (e.state === 'knock') {
      // 吹っ飛ぶ: のけぞって回る (位置は core の e.x が動かす)
      const k = Math.max(0, e.timer) / Math.max(0.01, e.knockTime);
      rot = 0.55 * k * (e.knockDist / 90);
      y -= Math.sin(k * Math.PI) * e.knockDist * 0.35 * s;
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

    // 夢中: ぶらさがる羽とハート (目を回しているときは星)
    if ((e.state === 'charmed' && !e.dizzy) || chasing) {
      feather(ctx, x - 40 * s, headY() - 4 * s + Math.sin(t * 8) * 6 * s, 22 * s, -1.2 + Math.sin(t * 6) * 0.4);
    }
    if (e.state === 'charmed' && e.dizzy) {
      for (let i = 0; i < 4; i++) {
        const a = t * 5 + i * Math.PI / 2;
        outlinedText(ctx, '★', x + Math.cos(a) * 36 * s, headY() + 26 * s + Math.sin(a) * 9 * s, 16, '#ffe27a');
      }
    } else if (e.state === 'charmed') {
      for (let i = 0; i < 3; i++) {
        const a = t * 3 + i * 2.1;
        outlinedText(ctx, '♥', x + Math.cos(a) * 34 * s, headY() + 30 * s + Math.sin(a) * 10 * s, 16, '#ff7fb0', '#fff');
      }
    }
    if (e.state === 'recover' && e.open) outlinedText(ctx, 'スキ!', x + 40 * s, headY() + 20 * s, 18 + Math.sin(t * 12) * 2, '#ff9a1a', '#fff');
    if (e.state === 'down') {
      // 目を回す
      for (let i = 0; i < 3; i++) {
        const a = t * 5 + i * 2.1;
        outlinedText(ctx, '★', x + Math.cos(a) * 30 * s, headY() + 20 * s + Math.sin(a) * 8 * s, 14, '#ffe27a');
      }
    } else if (e.state !== 'enter') {
      drawMood(ctx, e, enemyX(e), fieldSize.ground - 150 * sc, t);
    }
  }

  // 溜めの光は、一度だけ小さな絵に描いておき、毎コマは拡大して置くだけにする (毎コマ光の濃淡を作り直すより軽い)
  const glowCache = {};
  function glowSprite(pink) {
    const key = pink ? 'pink' : 'gold';
    if (glowCache[key]) return glowCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,240,.95)');
    g.addColorStop(0.45, pink ? 'rgba(255,120,190,.8)' : 'rgba(255,216,74,.75)');
    g.addColorStop(1, 'rgba(255,216,74,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    glowCache[key] = c;
    return c;
  }

  function drawHero(ctx, b, t, dt) {
    const s = fieldSize.s;
    const r = C.rankIndexOf(state);
    let x = heroX();
    shadow(ctx, x, fieldSize.ground, 38 * s);
    const y = fieldSize.ground - Math.sin(anim.hop * Math.PI) * 60 * s; // 突進をよけて跳ぶ
    if (anim.punch > 0) {
      // 飛び込んでパンチ。溜めた段が高いほど深く飛び込む
      const k = Math.sin(anim.punch * Math.PI);
      const reach = [0.55, 0.8, 1][anim.punchLevel || 0];
      const dash = (b && b.enemies[b.current] ? enemyX(b.enemies[b.current]) - x - 120 * s : 60 * s) * k * reach;
      drawSprite(ctx, imgs['pose-punch'], x + dash, y - k * (16 + 14 * (anim.punchLevel || 0)) * s, s * 0.95, { anchor: 0.4 });
      return;
    }
    if (b && b.charge && b.charge.on) {
      // 溜めている: 構えて、前の肉球がだんだん大きく光る
      const c = Math.min(1, b.charge.t / C.CHARGE_LEVELS[2]);
      const lv = C.chargeLevel(b.charge.t);
      const shake = lv === 2 ? Math.sin(t * 50) * 2 * s : 0;
      // 構えは、ふだんの姿を少し後ろへ引いて傾ける (パンチの絵は当たった瞬間の光まで描いてあるので使わない)
      drawSprite(ctx, imgs[stageForRank(r)], x - 14 * s * c + shake, y, s, { rot: -0.08 * c });
      const px = x + 44 * s, py = y - 80 * s;
      const rad = (10 + 26 * c) * s * (1 + 0.08 * Math.sin(t * 18));
      ctx.drawImage(glowSprite(lv === 2), px - rad, py - rad, rad * 2, rad * 2);
      outlinedText(ctx, '🐾', px, py + 6 * s, 14 + 14 * c, '#fff', '#fff');
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

    ['lure', 'punch', 'hurt', 'shake', 'flash', 'knock', 'hop', 'crash'].forEach(function (k) {
      const dur = { lure: 0.35, punch: 0.3, hurt: 0.4, shake: 0.25, flash: 0.35, knock: 0.25, hop: 0.55, crash: 0.6 }[k];
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
    drawObstacle(ctx, b, dt);

    const allies = b ? b.allies : state.vassals.filter(function (v) { return v.job === 'battle'; }).slice(0, C.MAX_BATTLE_VASSALS);
    allies.forEach(function (a, i) {
      a.hop = Math.max(0, (a.hop || 0) - dt / 0.3);
      const pos = allyPos(i);
      const jump = Math.sin(a.hop * Math.PI) * 14 * s;
      shadow(ctx, pos.x, pos.y, 20 * s);
      drawSprite(ctx, imgs[a.look] || imgs['cat-chatora'], pos.x, pos.y - jump, s * 0.62, {});
      // 得意技のしるし (頭の上に小さく)
      const sk = C.VASSAL_SKILLS[a.skill];
      if (sk) outlinedText(ctx, sk.icon, pos.x + 14 * s, pos.y - 92 * s - jump, 14, '#fff', '#fff');
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

  // ---------------------------------------------------------- 修行 (小判で主人公を鍛える)

  /** いまの体力の最大・パンチの強さ (出陣したときの値) */
  function heroStats(s) {
    const st = s || state;
    const r = C.rankIndexOf(st);
    const fxs = C.townEffects(st);
    return {
      hp: Math.round(C.playerMaxHp(r) * fxs.hpMul * C.heroMul(st, 'hp')),
      atk: Math.round(C.playerAtk(r) * fxs.atkMul * C.heroMul(st, 'atk'))
    };
  }

  /** 修行の札。ボタンは一度だけ作り、あとは字と押せるかだけを書き換える
   *  (小判は自主練の家臣で少しずつ増える。作り直すと、押している最中に札が入れ替わって押したことにならない) */
  function renderTrain() {
    [els.readyTrain, els.resultTrain].forEach(function (box) {
      if (!box) return;
      if (!box.firstChild) {
        box.innerHTML = '<div class="train-head"></div><div class="train-row"></div>';
        const rowEl = box.querySelector('.train-row');
        ['hp', 'atk'].forEach(function (key) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'train-btn train-' + key;
          btn.innerHTML = '<b></b><span></span>';
          btn.addEventListener('click', function () { doTrainHero(key); });
          rowEl.appendChild(btn);
        });
      }
      const now = heroStats();
      box.querySelector('.train-head').textContent = '修行 (小判で 主人公を鍛える)  ・ 手持ち 小判 ' + Math.floor(state.merit);
      ['hp', 'atk'].forEach(function (key) {
        const t = C.HERO_TRAIN[key];
        const lv = C.heroLevel(state, key);
        const btn = box.querySelector('.train-' + key);
        let note = 'もう最大';
        if (lv < C.HERO_TRAIN_MAX) {
          const after = heroStats(C.trainHero(Object.assign({}, state, { merit: Infinity }), key).state);
          note = '小判 ' + C.heroTrainCost(state, key) + ' ・ ' + now[key] + '→' + after[key];
        }
        btn.querySelector('b').textContent = t.icon + ' ' + t.name + ' Lv' + lv;
        btn.querySelector('span').textContent = note;
        btn.disabled = !C.canTrainHero(state, key);
      });
    });
  }

  function doTrainHero(key) {
    const res = C.trainHero(state, key);
    if (!res.ok) return false;
    state = res.state;
    saveSoon();
    renderTrain();
    renderHud(true);
    showToast(C.HERO_TRAIN[key].name + 'が 上がった! (Lv' + C.heroLevel(state, key) + ')', 1400);
    setFace('smile', 1.2);
    return true;
  }

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
      '猫じゃらしで ♡ をためて、<br>MAX 🐾 になったら 猫パンチ!',
      '猫パンチは ながおしで ためられる!<br>MAX の敵には すぐたまるにゃ',
      '頭に「!」が出ている敵は 猫じゃらしが効きにくい。<br>すばしっこい猫は よそ見のときに振ろう',
      'カウンター: ためて待って、<br>赤い「!」が出たら はなそう!',
      '大きなボス猫が 赤い「!!」で 突進してきたら、<br>猫じゃらしで 樽へ 誘導!',
      'ねこ侍は、攻撃のあとの「スキ」を<br>パンチで ねらおう',
      'MAX の敵に 会心まで ためて、<br>特大 猫パンチ!'
    ];
    let html = tips[Math.min(r, tips.length - 1)];
    const goers = state.vassals.filter(function (v) { return v.job === 'battle'; }).slice(0, C.MAX_BATTLE_VASSALS);
    if (goers.length) {
      html += '<span class="ready-allies">いっしょに出陣: ' + goers.map(function (v) {
        return (C.VASSAL_SKILLS[v.skill] ? C.VASSAL_SKILLS[v.skill].icon : '') + v.name;
      }).join(' ・ ') + '</span>';
    }
    els.readyText.innerHTML = html;
    els.resultTrain.hidden = true;
    renderTrain();
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
    const cq = res.conquest;
    if (b.phase === 'won') {
      pendingOffer = C.rollRecruitOffer(state, b);
      setFace('smile', 2.5);
      showBanner('勝利!');
      const gain = b.merit + b.bonus;
      let rows = '';
      if (cq) rows += row('🏯 手に入れた国', C.prefOf(cq.to).name) + row('入った兵', C.troopsAt(state, cq.to) + ' 匹') + row('失った兵', cq.lost + ' 匹');
      rows += row('倒した敵', b.enemies.length + ' 匹') + row('小判', '+' + gain) + row('経験値', '+' + gain) + row('資材', '+' + b.materials);
      if (b.loot.fish) rows += row('🐟 魚', '+' + b.loot.fish);
      if (b.loot.matatabi) rows += row('🌿 またたび', '+' + b.loot.matatabi);
      els.resultTitle.textContent = cq ? C.prefOf(cq.to).name + 'を 手に入れた!' : '勝利!';
      els.resultRows.innerHTML = rows;
      els.btnNext.textContent = cq ? '天下の地図へ' : 'つぎの戦へ';
      if (pendingOffer) {
        els.offer.hidden = false;
        els.offerImg.src = imgs[pendingOffer.look].src;
        els.offerText.textContent = pendingOffer.from + 'の「' + pendingOffer.name + '」(' + skillLabel(pendingOffer.skill) + ') が、仲間になりたそうにこちらを見ている!';
      } else {
        els.offer.hidden = true;
      }
      setTimeout(function () {
        els.resultPanel.hidden = false;
        if (res.rankedUp) showRankUp(res.prevRankIndex, res.rankIndex);
        if (cq && cq.unified) showUnify();
      }, 1100);
    } else {
      setFace('shy', 3);
      els.resultTitle.textContent = 'ひと休み…';
      // 負けても、倒したぶん (と戦っていた相手に与えた傷のぶん) の小判は持ち帰る。それで修行して、もう一度
      const got = C.lossReward(b);
      const downs = b.enemies.filter(function (e) { return !e.alive; }).length;
      let rows = '';
      if (cq) rows += row('戻らなかった兵', cq.lost + ' 匹') + row(C.prefOf(cq.to).name + 'の守り', '−' + cq.cut + ' 匹');
      rows += row('倒した敵', downs + ' 匹') + row('持ち帰った小判', '+' + got);
      rows += cq ? '<p class="panel-text">兵を ふやして、もう一度!<br>兵が多いほど 敵が弱くなるにゃ。</p>'
        : '<p class="panel-text">小判で 修行して、もう一度!<br>MAX で ためて なぐると 強いにゃ。</p>';
      els.resultRows.innerHTML = rows;
      els.offer.hidden = true;
      els.resultTrain.hidden = false;
      renderTrain();
      els.btnNext.textContent = cq ? '天下の地図へ' : 'もう一度';
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
    if (prev < C.COUNTER_RANK && idx >= C.COUNTER_RANK) text += '<br><b>新しい技「カウンター」を覚えた!</b><br>ためて待って、赤い「!」で はなそう';
    if (prev < C.YUDO_RANK && idx >= C.YUDO_RANK) text += '<br><b>新しい技「誘導」を覚えた!</b><br>ボス猫が「!!」で突進してきたら、猫じゃらしで 樽へ!';
    if (prev < C.REALM_UNLOCK_RANK && idx >= C.REALM_UNLOCK_RANK) text += '<br><b>🗾 国をひとつ任された!</b><br>「天下」の地図から、天下統一をめざそう';
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
    els.btnRetreat.textContent = battle.conquest ? '退却する (連れて行った兵の半分が戻らない)' : '退却する (何も減らない)';
    battle.charge = { on: false, t: 0 }; // 溜めは捨てる (止めている間にたまらないように)
    els.btnPunch.classList.remove('charging');
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
    const cq = battle && battle.conquest;
    if (battle) {
      const res = C.applyBattleResult(state, battle);
      state = res.state;
      saveSoon();
      if (res.conquest) showToast('退却… 兵が ' + res.conquest.lost + ' 匹 戻らなかった', 2400);
    }
    showReady();
    if (cq) backToRealm(cq.to);
  }

  /** 国とりの合戦のあと、天下の地図へ戻る。攻めた県を選んだままにする (負けたら、すぐ挑み直せる) */
  function backToRealm(id) {
    switchTab('realm');
    realm.sheetKey = '';
    selectPref(id);
    moveCamera(homeCamera());
  }

  // ---------------------------------------------------------- 家臣

  const JOB_LABELS = { training: '自主練', labor: '普請', battle: '出陣' };

  /** 得意技の強さを、画面に出す短い言葉にする */
  function skillEffectText(skill, level) {
    const p = C.skillPower(skill, level);
    if (skill === 'jarashi') return 'ゲージ x' + p.toFixed(2);
    if (skill === 'punch') return '溜めパンチ x' + p.toFixed(2);
    if (skill === 'quick') return '溜める速さ x' + p.toFixed(2);
    if (skill === 'heal') return C.HEAL_INTERVAL + '秒ごとに 体力 +' + Math.round(p * 100) + '%';
    return '';
  }
  function skillLabel(skill) {
    const k = C.VASSAL_SKILLS[skill];
    return k ? k.icon + ' ' + k.name : '';
  }

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

      // 得意技 (出陣しているときだけ効く)
      const sk = C.VASSAL_SKILLS[v.skill];
      if (sk) {
        const skill = document.createElement('div');
        skill.className = 'vassal-skill' + (v.job === 'battle' ? ' on' : '');
        skill.innerHTML = '<b class="skill-name"></b><span class="skill-effect"></span><span class="skill-text"></span>';
        skill.querySelector('.skill-name').textContent = skillLabel(v.skill);
        skill.querySelector('.skill-effect').textContent = skillEffectText(v.skill, v.level) + (v.job === 'battle' ? '' : ' (出陣で効く)');
        skill.querySelector('.skill-text').textContent = sk.text;
        info.appendChild(skill);
      }

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
  /** 猫パンチを押しはじめる (溜めはじめ)。離すと出る */
  function doPunchPress() {
    unlockAudio();
    if (!battle || paused) return false;
    const ok = C.punchPress(battle);
    if (ok) els.btnPunch.classList.add('charging');
    return ok;
  }
  function doPunchRelease() {
    els.btnPunch.classList.remove('charging');
    if (!battle || paused) return false;
    return C.punchRelease(battle);
  }
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

  // 長押しで iOS の虫眼鏡 (ルーペ) が出ないように、指が触れた瞬間 (touchstart) を止める。
  // pointerdown の preventDefault では止まらない。止めると click も来なくなるので、
  // pointer だけで受けている物 (猫じゃらし・猫パンチ・戦場) にだけ付ける
  function blockLoupe(el) {
    el.addEventListener('touchstart', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
  }

  // ---------------------------------------------------------- 天下 (日本地図の国とり)
  //
  // 地図はキャンバス 1 枚 (#realmCanvas)。県の形は japan-map.js (単位は緯度 0.01° ほど) を Path2D にして持ち、
  // 見る範囲 (cam: 真ん中の位置と倍率) を掛けて描く。変わったとき (国が増えた・選んだ・動かした) だけ描き直す。
  // 小さな県 (東京・大阪・香川) は全体の地図では指より小さいので、押すとその県ととなりが入るまで寄る。
  // 指 1 本で動かす・2 本で広げる。

  const JMAP = window.JAPAN_MAP;
  const realmEls = {
    sub: $('realmSub'), title: $('realmTitle'), top: $('realmTop'), back: $('btnRealmBack'),
    guide: $('realmGuide'), bubble: $('realmBubble'), remain: $('realmRemain'), left: $('realmLeft'),
    locked: $('realmLocked'), content: $('realmContent'), map: $('realmMap'), canvas: $('realmCanvas'),
    sheet: $('realmSheet'), all: $('btnRealmAll'), unify: $('unifyModal'), unifyOk: $('btnUnifyOk')
  };
  const rctx = realmEls.canvas.getContext('2d');
  const realm = {
    w: 0, h: 0, dpr: 1,
    cam: { x: JMAP.w / 2, y: JMAP.h / 2, k: 0.2 },
    anim: null,           // { from, to, t } 見る範囲を動かしている最中
    sel: null,            // 選んでいる県
    send: 0,              // 攻めるときに連れて行く兵
    dirty: true,
    sheetKey: '',
    pointers: {},
    gesture: null
  };
  // 県の形 (Path2D) と、はしの四角
  const prefShapes = JMAP.prefs.map(function (p) {
    const path = new Path2D();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    p.rings.forEach(function (r) {
      path.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) {
        path.lineTo(r[i], r[i + 1]);
        x0 = Math.min(x0, r[i]); y0 = Math.min(y0, r[i + 1]); x1 = Math.max(x1, r[i]); y1 = Math.max(y1, r[i + 1]);
      }
      path.closePath();
    });
    return { id: p.id, path: path, rings: p.rings, lx: p.lx, ly: p.ly, lr: p.lr, box: { x0: x0, y0: y0, x1: x1, y1: y1 } };
  });

  /**
   * 地図のうち、飾りや札に隠れていない所 (地図の中の px)。見る範囲はここに合わせる。
   * 地図は画面いっぱいで、上に題字と数の帯、横 (右) か縦 (下) に札が重なっている
   */
  function freeRect() {
    const m = realmEls.map.getBoundingClientRect();
    let x0 = 0, y0 = 0, x1 = realm.w, y1 = realm.h;
    const rectOf = function (el) { return el && !el.hidden && el.offsetWidth ? el.getBoundingClientRect() : null; };
    [realmEls.title, realmEls.top, realmEls.remain].forEach(function (el) {
      const b = rectOf(el);
      if (b && (b.top + b.bottom) / 2 - m.top < realm.h * 0.35) y0 = Math.max(y0, b.bottom - m.top + 4);
    });
    const sh = rectOf(realmEls.sheet);
    if (sh) {
      if (sh.left - m.left > realm.w * 0.35) x1 = Math.min(x1, sh.left - m.left - 6);   // 横: 札は右
      else y1 = Math.min(y1, sh.top - m.top - 6);                                       // 縦: 札は下
    }
    if (x1 - x0 < 80 || y1 - y0 < 80) return { x0: 0, y0: 0, x1: realm.w, y1: realm.h };
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function realmFitK() {
    const f = freeRect();
    return Math.min((f.x1 - f.x0) / JMAP.w, (f.y1 - f.y0) / JMAP.h) * 0.96;
  }

  function sizeRealm() {
    const w = realmEls.map.clientWidth, h = realmEls.map.clientHeight;
    if (!(w >= 1 && h >= 1)) return;
    // 画素の倍率は 1.5 まで (戦場と同じ)。塗る面積がそのまま重さになる
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (w === realm.w && h === realm.h && dpr === realm.dpr) return;
    const first = realm.w === 0;
    realm.w = w; realm.h = h; realm.dpr = dpr;
    realmEls.canvas.width = Math.round(w * dpr);
    realmEls.canvas.height = Math.round(h * dpr);
    if (first) realm.cam = homeCamera();
    realm.cam = clampCam(realm.cam);
    realm.dirty = true;
  }

  /** 地図の点 (mx, my) が、隠れていない所の真ん中に来る見る範囲 */
  function centerOn(mx, my, k) {
    const f = freeRect();
    return { x: mx - ((f.x0 + f.x1) / 2 - realm.w / 2) / k, y: my - ((f.y0 + f.y1) / 2 - realm.h / 2) / k, k: k };
  }

  function wholeCamera() { return clampCam(centerOn(JMAP.w / 2, JMAP.h / 2, realmFitK())); }

  /** 見る範囲: 自分の国と攻め込めるとなりが入るように。国がまだ無ければ日本全体 */
  function homeCamera() {
    if (!C.hasRealm(state)) return wholeCamera();
    const ids = [];
    for (let id = 1; id <= C.PREF_COUNT; id++) if (C.isMine(state, id) || C.attackSource(state, id)) ids.push(id);
    return frameCamera(ids);
  }

  function frameCamera(ids) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ids.forEach(function (id) {
      const b = prefShapes[id - 1].box;
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    });
    const f = freeRect();
    const pad = 1.25;
    const k = Math.min((f.x1 - f.x0) / ((x1 - x0) * pad + 40), (f.y1 - f.y0) / ((y1 - y0) * pad + 40));
    return clampCam(centerOn((x0 + x1) / 2, (y0 + y1) / 2, k));
  }

  function clampCam(c) {
    const fit = realmFitK();
    const k = Math.max(fit, Math.min(fit * 9, c.k));
    // 隠れていない所の真ん中が、地図の中から外れないように (地図の外の海ばかり見えないように)
    const f = freeRect();
    const off = { x: ((f.x0 + f.x1) / 2 - realm.w / 2) / k, y: ((f.y0 + f.y1) / 2 - realm.h / 2) / k };
    const hw = (f.x1 - f.x0) / 2 / k, hh = (f.y1 - f.y0) / 2 / k;
    const px = JMAP.w <= hw * 2 ? JMAP.w / 2 : Math.max(hw, Math.min(JMAP.w - hw, c.x + off.x));
    const py = JMAP.h <= hh * 2 ? JMAP.h / 2 : Math.max(hh, Math.min(JMAP.h - hh, c.y + off.y));
    return { x: px - off.x, y: py - off.y, k: k };
  }

  function moveCamera(to, instant) {
    to = clampCam(to);
    if (instant) { realm.cam = to; realm.anim = null; realm.dirty = true; return; }
    realm.anim = { from: Object.assign({}, realm.cam), to: to, t: 0 };
  }

  function toMap(sx, sy) {
    const c = realm.cam;
    return { x: (sx - realm.w / 2) / c.k + c.x, y: (sy - realm.h / 2) / c.k + c.y };
  }
  function toScreen(mx, my) {
    const c = realm.cam;
    return { x: (mx - c.x) * c.k + realm.w / 2, y: (my - c.y) * c.k + realm.h / 2 };
  }

  function insideRings(rings, x, y) {
    let c = false;
    rings.forEach(function (r) {
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
      }
    });
    return c;
  }

  /** 押した所の県。形の中でなければ、近くの県の名前の点 (指ひとつぶん以内) */
  function prefAt(sx, sy) {
    const m = toMap(sx, sy);
    for (let i = 0; i < prefShapes.length; i++) {
      const p = prefShapes[i];
      if (m.x < p.box.x0 || m.x > p.box.x1 || m.y < p.box.y0 || m.y > p.box.y1) continue;
      if (insideRings(p.rings, m.x, m.y)) return p.id;
    }
    let best = null, bd = 22 / realm.cam.k;
    prefShapes.forEach(function (p) {
      const d = Math.hypot(p.lx - m.x, p.ly - m.y);
      if (d < bd) { bd = d; best = p.id; }
    });
    return best;
  }

  function stars(level) {
    const n = Math.max(1, Math.min(5, 1 + Math.floor((level - C.PREF_LEVEL_MIN) / (C.PREF_LEVEL_SPAN + 1) * 5)));
    return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  }

  // ---- 描く (見本の絵 art/realm-mock.png に寄せる: 盛り上がった陸と崖・山と森・青い海と波・城と旗・白い名札)

  // 地方ごとの陸の色 (見本の色: 近畿は桃色、中部は藤色、中国・四国は緑…)
  const LAND_COLORS = ['#b8d98c', '#a9d08f', '#e7cd86', '#c3a7df', '#f0a898', '#9fd184', '#8ecfae', '#ebb487'];
  const MINE_LAND = '#f7a646';
  // 大名の旗の色 (地方ごと)。自分の国は赤
  const FLAG_COLORS = ['#2f5f8f', '#2f6f4f', '#8a5a1a', '#5a3f9a', '#2f3f8f', '#2f6f3f', '#1f6f6f', '#9b2335'];
  const MINE_FLAG = '#c8412f';

  // 山・森の模様と、海の波の模様。一度だけ作って、地図の位置に合わせて敷く (パターン)
  const TEX = 2;                         // 模様の細かさ (地図 1 単位 = 2px)
  function makeTile(size, draw) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size * TEX;
    const g = cv.getContext('2d');
    g.scale(TEX, TEX);
    const rnd = C.mulberry32(size * 7 + 3);
    // 端をまたぐ物は反対側にも描いて、つなぎ目を見せない
    const wrap = function (x, y, r, fn) {
      [-size, 0, size].forEach(function (ox) {
        [-size, 0, size].forEach(function (oy) {
          const X = x + ox, Y = y + oy;
          if (X + r >= 0 && X - r <= size && Y + r >= 0 && Y - r <= size) fn(X, Y);
        });
      });
    };
    draw(g, rnd, wrap);
    return cv;
  }
  const terrainTile = makeTile(480, function (g, rnd, wrap) {
    // 細かなむら
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * 480, y = rnd() * 480;
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.07)';
      g.fillRect(x, y, 1.5 + rnd() * 2, 1 + rnd() * 1.5);
    }
    // 森 (丸い木の固まり)
    for (let i = 0; i < 150; i++) {
      const cx = rnd() * 480, cy = rnd() * 480, n = 3 + Math.floor(rnd() * 4);
      wrap(cx, cy, 14, function (X, Y) {
        for (let j = 0; j < n; j++) {
          const x = X + (rnd() - 0.5) * 16, y = Y + (rnd() - 0.5) * 10, r = 2.2 + rnd() * 2.4;
          g.fillStyle = 'rgba(20,60,20,.30)'; g.beginPath(); g.arc(x, y + 0.8, r, 0, 7); g.fill();
          g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, 7); g.fill();
        }
      });
    }
    // 山 (左の面は明るく、右の面は暗い。大きな山は雪をかぶる)
    const mts = [];
    for (let i = 0; i < 95; i++) mts.push({ x: rnd() * 480, y: rnd() * 480, s: 7 + rnd() * 15 });
    mts.sort(function (a, b) { return a.y - b.y; });
    mts.forEach(function (m) {
      wrap(m.x, m.y, m.s * 1.2, function (X, Y) {
        const s = m.s, top = Y - s * 1.15;
        g.fillStyle = 'rgba(0,0,0,.12)';
        g.beginPath(); g.ellipse(X + s * 0.15, Y + 1, s * 1.05, s * 0.28, 0, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,.42)';
        g.beginPath(); g.moveTo(X - s, Y); g.lineTo(X, top); g.lineTo(X + s * 0.05, Y); g.closePath(); g.fill();
        g.fillStyle = 'rgba(0,0,0,.30)';
        g.beginPath(); g.moveTo(X + s * 0.05, Y); g.lineTo(X, top); g.lineTo(X + s * 0.95, Y); g.closePath(); g.fill();
        if (s > 15) {
          g.fillStyle = 'rgba(255,255,255,.75)';
          g.beginPath(); g.moveTo(X - s * 0.28, top + s * 0.32); g.lineTo(X, top); g.lineTo(X + s * 0.26, top + s * 0.3);
          g.lineTo(X + s * 0.05, top + s * 0.22); g.closePath(); g.fill();
        }
      });
    });
  });
  const seaTile = makeTile(240, function (g, rnd, wrap) {
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 240, y = rnd() * 240, w = 5 + rnd() * 9;
      wrap(x, y, w, function (X, Y) {
        g.strokeStyle = 'rgba(255,255,255,' + (0.35 + rnd() * 0.3).toFixed(2) + ')';
        g.lineWidth = 0.9;
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(X - w, Y); g.quadraticCurveTo(X - w / 2, Y - w * 0.35, X, Y); g.quadraticCurveTo(X + w / 2, Y - w * 0.35, X + w, Y); g.stroke();
      });
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = 'rgba(255,255,255,.08)';
      g.fillRect(rnd() * 240, rnd() * 240, 3 + rnd() * 6, 0.8);
    }
  });
  let terrainPat = null;
  // 海の波の模様は、地図の下の背景に敷く (動かしても描き直さない)
  realmEls.map.style.backgroundImage = 'url(' + seaTile.toDataURL() + '), linear-gradient(#2f9fc4, #4cbfd2)';
  realmEls.map.style.backgroundSize = (240 * 0.5) + 'px, 100% 100%';

  // 動かしている最中 (指で動かす・寄る) は、止まっていたときに描いておいた絵 (まわりに余白つき) を
  // ずらして拡げて貼るだけにする。県を 47 塗り直すと、CPU4倍遅で 1コマ 33ms かかった (貼るだけなら 16.7ms)。
  // 止まったら、その位置で描き直す
  const CACHE_MARGIN = 0.12;          // まわりの余白 (幅・高さの割合)。はみ出した所は下の海 (CSS) が見える
  const realmCache = { canvas: document.createElement('canvas'), cam: null, W: 0, H: 0 };

  function realmMoving() { return !!realm.anim || !!(realm.gesture && realm.gesture.kind !== 'tap'); }

  function drawRealm() {
    realm.dirty = false;
    const dpr = realm.dpr;
    const cc = realmCache;
    const W = Math.round(realm.w * (1 + 2 * CACHE_MARGIN)), H = Math.round(realm.h * (1 + 2 * CACHE_MARGIN));
    if (!realmMoving() || !cc.cam) {
      if (cc.W !== W || cc.H !== H) {
        cc.canvas.width = Math.round(W * dpr); cc.canvas.height = Math.round(H * dpr);
        cc.W = W; cc.H = H;
      }
      cc.cam = Object.assign({}, realm.cam);
      drawRealmTo(cc.canvas.getContext('2d'), cc.cam, W, H, dpr);
      realm.fullDraws = (realm.fullDraws || 0) + 1;
    }
    // 描いておいた絵を、いまの見る範囲に合わせて貼る (はみ出した所は、下に敷いた海の色が見える)
    const c = realm.cam, s = c.k / cc.cam.k;
    const dx = (-W / 2) * s + (cc.cam.x - c.x) * c.k + realm.w / 2;
    const dy = (-H / 2) * s + (cc.cam.y - c.y) * c.k + realm.h / 2;
    rctx.setTransform(1, 0, 0, 1, 0, 0);
    rctx.clearRect(0, 0, realmEls.canvas.width, realmEls.canvas.height);
    rctx.drawImage(cc.canvas, dx * dpr, dy * dpr, W * s * dpr, H * s * dpr);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /** のぼり旗 (竿と、肉球を染めた布) */
  function drawFlag(ctx, x, y, h, color) {
    const w = h * 0.42;
    ctx.fillStyle = '#5a3a1c';
    ctx.fillRect(x - 1, y, 2, h);
    ctx.fillStyle = color;
    ctx.fillRect(x - w - 1, y + h * 0.06, w, h * 0.62);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(x - w - 1, y + h * 0.06 + h * 0.56, w, h * 0.06);
    const cx = x - 1 - w / 2, cy = y + h * 0.4, r = w * 0.2;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.5, r * 1.1, r * 0.9, 0, 0, 7); ctx.fill();
    [-1, 0, 1].forEach(function (i) { ctx.beginPath(); ctx.arc(cx + i * r * 0.95, cy - r * 0.75 - (i === 0 ? r * 0.25 : 0), r * 0.42, 0, 7); ctx.fill(); });
  }

  /** 見る範囲 c で、幅 W・高さ H (CSS px) の面に地図を描く (真ん中が c の位置) */
  function drawRealmTo(ctx, c, W, H, dpr) {
    const k = c.k;
    const toS = function (mx, my) { return { x: (mx - c.x) * k + W / 2, y: (my - c.y) * k + H / 2 }; };
    const toMapXf = function () { ctx.setTransform(k * dpr, 0, 0, k * dpr, (W / 2 - c.x * k) * dpr, (H / 2 - c.y * k) * dpr); };
    if (!terrainPat) {
      terrainPat = ctx.createPattern(terrainTile, 'repeat');
      terrainPat.setTransform(new DOMMatrix().scale(1 / TEX, 1 / TEX));
    }
    const has = C.hasRealm(state);
    const sel = realm.sel;
    const selNb = sel ? C.prefOf(sel).nb : [];
    const px = 1 / k;                    // 画面の 1px は地図の何単位か

    // 海はキャンバスには描かない (地図の下の CSS の背景。波の模様も一度だけ作って敷く)。
    // キャンバスで海を塗ると、面積が大きいぶん描き直しが重かった
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    toMapXf();

    // 沖縄の枠 (紙の縁取り)
    const ob = JMAP.okinawaBox;
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = 'rgba(255,246,220,.85)';
    ctx.strokeRect(ob.x, ob.y, ob.w, ob.h);

    // 岸の浅瀬 (陸のまわりの明るい水色)
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(180,242,240,.42)';
    ctx.lineWidth = 16 * px;
    prefShapes.forEach(function (p) { ctx.stroke(p.path); });

    // 崖: 陸を少し下へずらして、土の色で 2 段に塗る (陸が盛り上がって見える)
    const cliff = function (dy, color) {
      ctx.save(); ctx.translate(0, dy * px);
      ctx.fillStyle = color;
      prefShapes.forEach(function (p) { ctx.fill(p.path, 'evenodd'); });
      ctx.restore();
    };
    cliff(8, '#6c4d31');
    cliff(5, '#9a7550');

    // 陸: 地方の色 (自分の国は橙)。そこへ山と森の模様を重ねる
    prefShapes.forEach(function (p) {
      const mine = C.isMine(state, p.id);
      ctx.fillStyle = mine ? MINE_LAND : LAND_COLORS[C.prefOf(p.id).region];
      ctx.fill(p.path, 'evenodd');
    });
    // (「重ねて色を混ぜる」overlay は重いので、白と黒を薄く重ねるだけにした)
    ctx.fillStyle = terrainPat;
    prefShapes.forEach(function (p) { ctx.fill(p.path, 'evenodd'); });

    // 県ざかい (白い細い線)
    ctx.strokeStyle = 'rgba(255,250,236,.85)';
    ctx.lineWidth = 1.4 * px;
    prefShapes.forEach(function (p) { ctx.stroke(p.path); });

    // 攻め込める国 (自分の国のとなり) は赤い点線
    if (has) {
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.lineWidth = 2.2 * px;
      ctx.strokeStyle = 'rgba(206,52,36,.95)';
      prefShapes.forEach(function (p) { if (C.attackSource(state, p.id)) ctx.stroke(p.path); });
      ctx.setLineDash([]);
    }
    // 選んでいる県: 明るくして、金色に光るふち
    if (sel) {
      const sp = prefShapes[sel - 1].path;
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = 'rgba(255,196,90,.45)';
      ctx.fill(sp, 'evenodd');
      ctx.globalCompositeOperation = 'source-over';
      [[14, 'rgba(255,214,90,.22)'], [8, 'rgba(255,220,100,.45)'], [3.5, '#fff0a0'], [1.6, '#e8a21a']].forEach(function (s) {
        ctx.lineWidth = s[0] * px; ctx.strokeStyle = s[1]; ctx.stroke(sp);
      });
    }

    // ---- ここから先は画面の大きさで描く (地図を広げても城や字は太らない)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const castle = imgs['b-castle'], face = imgs['face-smile'];
    // 置く順: 選んだ県・となり・自分の国・広い県。すでに置いた物にかかる県は、城も札も出さない (小さな点だけ)
    const placed = [];
    const order = prefShapes.slice().sort(function (a, b) {
      const pr = function (p) { return (p.id === sel ? 1e6 : 0) + (selNb.indexOf(p.id) >= 0 ? 1e5 : 0) + (C.isMine(state, p.id) ? 1e4 : 0) + p.lr; };
      return pr(b) - pr(a);
    });
    const font = function (w, size) { return w + ' ' + size + 'px "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif'; };
    order.forEach(function (p) {
      const pref = C.prefOf(p.id);
      const mine = C.isMine(state, p.id);
      const room = p.lr * k;               // 名前を書ける広さ (px)
      const focus = p.id === sel || selNb.indexOf(p.id) >= 0;
      const s = toS(p.lx, p.ly);
      if (s.x < -60 || s.x > W + 60 || s.y < -60 || s.y > H + 40) return;
      const showName = room >= 6 || p.id === sel || (focus && room >= 3);
      const showNum = has && (room >= 9 || p.id === sel || (focus && room >= 4));
      const ch = Math.max(0, Math.min(40, room * 1.8));   // 城の高さ
      const showCastle = room >= 12 || (room >= 7 && (p.id === sel || mine));
      const dot = function () {
        if (!mine) return;
        ctx.fillStyle = MINE_FLAG; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, 3.2, 0, 7); ctx.fill(); ctx.stroke();
      };
      if (!showName && !showNum) { dot(); return; }
      // 札の大きさ
      const name = pref.name, num = showNum ? String(C.troopsAt(state, p.id)) : '';
      ctx.font = font(900, 12);
      const nw = showName ? ctx.measureText(name).width : 0;
      ctx.font = font(800, 11);
      const mw = showNum ? ctx.measureText(num).width + 14 : 0;
      const bw = Math.max(nw, mw) + 14 + (mine ? 14 : 0), bh = (showName && showNum) ? 32 : 19;
      const cw = showCastle ? ch * castle.naturalWidth / castle.naturalHeight : 0;
      const up = (showCastle ? ch * 0.8 : 0) + bh / 2, down = bh / 2;
      const tries = [[0, 0], [0, up + down + 2], [0, -(up + down + 2)], [bw, 0], [-bw, 0]];
      let at = null;
      for (let i = 0; i < tries.length && !at; i++) {
        const x = s.x + tries[i][0], y = s.y + tries[i][1];
        const box = { x0: x - Math.max(bw, cw) / 2, x1: x + Math.max(bw, cw) / 2, y0: y - up, y1: y + down };
        const hit = placed.some(function (q) { return box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0; });
        if (!hit || (p.id === sel && i === tries.length - 1)) at = { x: x, y: y, box: box };
      }
      if (!at) { dot(); return; }
      placed.push(at.box);
      if (at.x !== s.x || at.y !== s.y) {
        ctx.strokeStyle = 'rgba(255,250,236,.9)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(at.x, at.y); ctx.stroke();
        ctx.fillStyle = mine ? MINE_FLAG : 'rgba(58,42,28,.8)';
        ctx.beginPath(); ctx.arc(s.x, s.y, 2.4, 0, 7); ctx.fill();
      }
      // 城と旗 (札の上)
      if (showCastle && ready(castle)) {
        const top = at.y - bh / 2 - ch * 0.82;
        ctx.fillStyle = 'rgba(40,30,20,.25)';
        ctx.beginPath(); ctx.ellipse(at.x, at.y - bh / 2 + 1, cw * 0.42, ch * 0.08, 0, 0, 7); ctx.fill();
        ctx.drawImage(castle, at.x - cw / 2, top, cw, ch);
        drawFlag(ctx, at.x + cw * 0.36, top - ch * 0.12, ch * 0.62, mine ? MINE_FLAG : FLAG_COLORS[pref.region]);
      }
      // 白い名札 (名前と、兵の数)
      const x0 = at.x - bw / 2, y0 = at.y - bh / 2;
      ctx.fillStyle = 'rgba(58,42,28,.28)';
      roundRect(ctx, x0 + 1, y0 + 2, bw, bh, 9); ctx.fill();
      ctx.fillStyle = p.id === sel ? '#fff8dc' : 'rgba(255,253,247,.94)';
      roundRect(ctx, x0, y0, bw, bh, 9); ctx.fill();
      ctx.strokeStyle = p.id === sel ? '#e8a21a' : 'rgba(185,139,52,.55)'; ctx.lineWidth = p.id === sel ? 2 : 1;
      ctx.stroke();
      const tx = at.x + (mine ? 7 : 0);
      if (mine && ready(face)) {
        const fh = 16, fw = fh * face.naturalWidth / face.naturalHeight;
        ctx.drawImage(face, x0 + 4, at.y - fh / 2, fw, fh);
      }
      if (showName) {
        ctx.font = font(900, 12);
        ctx.fillStyle = mine ? '#8a2a10' : '#3a2a1c';
        ctx.fillText(name, tx, showNum ? at.y - 7 : at.y + 0.5);
      }
      if (showNum) {
        ctx.font = font(800, 11);
        ctx.fillStyle = mine ? '#c8412f' : '#5a4632';
        ctx.fillText((mine ? '🚩' : '⚔') + num, tx, showName ? at.y + 8 : at.y + 0.5);
      }
    });
  }

  // ---- さわる

  function onRealmPointerDown(e) {
    e.preventDefault();
    try { realmEls.canvas.setPointerCapture(e.pointerId); } catch (err) { /* 捕まえられなくても動かせる */ }
    const r = realmEls.canvas.getBoundingClientRect();
    realm.pointers[e.pointerId] = { x: e.clientX - r.left, y: e.clientY - r.top };
    const ids = Object.keys(realm.pointers);
    realm.anim = null;
    if (ids.length === 1) {
      const p = realm.pointers[ids[0]];
      realm.gesture = { kind: 'tap', sx: p.x, sy: p.y, cam: Object.assign({}, realm.cam) };
    } else if (ids.length === 2) {
      const a = realm.pointers[ids[0]], b = realm.pointers[ids[1]];
      realm.gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: toMap((a.x + b.x) / 2, (a.y + b.y) / 2), cam: Object.assign({}, realm.cam) };
    }
  }
  function onRealmPointerMove(e) {
    if (!realm.pointers[e.pointerId]) return;
    const r = realmEls.canvas.getBoundingClientRect();
    realm.pointers[e.pointerId] = { x: e.clientX - r.left, y: e.clientY - r.top };
    const g = realm.gesture;
    if (!g) return;
    const ids = Object.keys(realm.pointers);
    if (g.kind === 'pinch' && ids.length >= 2) {
      const a = realm.pointers[ids[0]], b = realm.pointers[ids[1]];
      const k = g.cam.k * Math.hypot(a.x - b.x, a.y - b.y) / g.d;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      realm.cam = clampCam({ x: g.mid.x - (mx - realm.w / 2) / k, y: g.mid.y - (my - realm.h / 2) / k, k: k });
      realm.dirty = true;
      return;
    }
    const p = realm.pointers[ids[0]];
    if (!p) return;
    if (g.kind === 'tap' && Math.hypot(p.x - g.sx, p.y - g.sy) > 8) g.kind = 'pan';
    if (g.kind === 'pan') {
      realm.cam = clampCam({ x: g.cam.x - (p.x - g.sx) / g.cam.k, y: g.cam.y - (p.y - g.sy) / g.cam.k, k: g.cam.k });
      realm.dirty = true;
    }
  }
  function onRealmPointerUp(e) {
    if (!realm.pointers[e.pointerId]) return;
    const g = realm.gesture;
    const p = realm.pointers[e.pointerId];
    delete realm.pointers[e.pointerId];
    const left = Object.keys(realm.pointers);
    if (g && g.kind === 'tap' && e.type === 'pointerup' && left.length === 0) {
      const id = prefAt(p.x, p.y);
      selectPref(id);
    }
    if (left.length === 1) {
      // 2 本から 1 本になったら、残った指で続けて動かせるように
      const q = realm.pointers[left[0]];
      realm.gesture = { kind: 'pan', sx: q.x, sy: q.y, cam: Object.assign({}, realm.cam) };
    } else if (left.length === 0) {
      if (g && g.kind !== 'tap') realm.dirty = true; // 止まった位置で描き直す
      realm.gesture = null;
    }
  }

  /** 県を選ぶ。小さな県でも押せるように、その県ととなりが入るまで寄る */
  function selectPref(id) {
    if (!id) { realm.sel = null; realm.dirty = true; renderRealmSheet(); return; }
    realm.sel = id;
    const pref = C.prefOf(id);
    const src = C.hasRealm(state) ? C.attackSource(state, id) : null;
    realm.send = src ? C.troopsAt(state, src) : 0;
    const shape = prefShapes[id - 1];
    // 県の名前が書けるほど大きく見えていなければ、寄る
    // 沖縄は左上の枠の中にあるので、鹿児島と沖縄はいっしょに入れない (日本全体になってしまう)
    const around = pref.nb.filter(function (n) { return !((id === 46 && n === 47) || (id === 47 && n === 46)); });
    if (shape.lr * realm.cam.k < 10) {
      // となりが大きい (青森のとなりの北海道など) と寄り足りないので、選んだ県が指で押せる大きさ (12px) までは寄る
      let cam = frameCamera([id].concat(around));
      if (shape.lr * cam.k < 12) cam = centerOn(shape.lx, shape.ly, 12 / shape.lr);
      moveCamera(cam);
    }
    realm.dirty = true;
    renderRealmSheet();
  }

  // ---- 札 (買う・集める・攻める)

  function renderRealmView() {
    const unlocked = isUnlocked('realm');
    realmEls.locked.hidden = unlocked;
    realmEls.content.hidden = !unlocked;
    updateRealmNumbers();
    if (!unlocked) { realmEls.locked.textContent = lockedMessage('realm'); return; }
    sizeRealm();
    realm.sheetKey = '';
    renderRealmSheet();
    realm.dirty = true;
  }

  /** 上の紺の帯: 取った国の数・兵・小判 */
  function updateRealmNumbers() {
    const has = C.hasRealm(state);
    const coin = Math.floor(state.merit);
    const key = (has ? C.ownedCount(state) + '|' + C.totalTroops(state) : '-') + '|' + coin;
    if (realmEls.sub.dataset.key !== key) {
      realmEls.sub.dataset.key = key;
      realmEls.sub.innerHTML = (has ? '<span>🏯 ' + C.ownedCount(state) + '/' + C.PREF_COUNT + '</span><i class="rs-sep"></i>' +
        '<span>兵 ' + C.totalTroops(state) + '</span><i class="rs-sep"></i>' : '') +
        '<span class="rs-coin"><img src="' + imgs['r-coin'].src + '" alt="">小判 ' + coin + '</span>';
    }
    realmEls.remain.hidden = !has;
    if (has) {
      const left = String(C.PREF_COUNT - C.ownedCount(state));
      if (realmEls.left.textContent !== left) realmEls.left.textContent = left;
    }
  }

  /** 案内の猫のひとこと (いまできることを、ひとことで) */
  function guideText() {
    if (!C.hasRealm(state)) return realm.sel ? '「' + C.prefOf(realm.sel).name + '」でいいかにゃ?' : '任される国を えらぶにゃ!';
    if (state.realm.unified) return '天下統一にゃ! おめでとう!';
    const sel = realm.sel;
    if (!sel) return C.ownedCount(state) === 1 ? 'まずは近くの国から 攻めてみるにゃ!' : '赤い点線の国に 攻め込めるにゃ!';
    if (C.isMine(state, sel)) return '兵を買って ここに置けるにゃ';
    const src = C.attackSource(state, sel);
    if (!src) return 'となりの国を 先にとるにゃ';
    if (realm.send < C.TROOP_UNIT) return '兵がいないにゃ… 買って増やそう';
    const plan = C.attackPlan(state, src, sel, realm.send);
    if (plan.ratio >= 3) return 'この兵なら 楽勝にゃ!';
    if (plan.ratio >= 1.5) return 'この兵なら いけるにゃ!';
    if (plan.ratio >= 1) return '互角にゃ… 兵を増やすと 楽になるにゃ';
    return '兵が足りないにゃ… 敵が強くなるにゃ';
  }

  function sheetButton(cls, html, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.innerHTML = html;
    b.addEventListener('click', fn);
    return b;
  }

  const SWORDS_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><g stroke-linecap="round">' +
    '<path d="M8 40 L36 10" stroke="#8a6a3a" stroke-width="5"/><path d="M8 40 L36 10" stroke="#f3f0e6" stroke-width="2.6"/>' +
    '<path d="M40 40 L12 10" stroke="#8a6a3a" stroke-width="5"/><path d="M40 40 L12 10" stroke="#f3f0e6" stroke-width="2.6"/>' +
    '<path d="M5 35 L13 43 M43 35 L35 43" stroke="#3a2a1c" stroke-width="4"/>' +
    '<path d="M4 44 L9 39 M44 44 L39 39" stroke="#b98b34" stroke-width="5"/></g></svg>';

  /** 札を作る。選んだ県や、国を任されたかが変わったときだけ作り直す (数字は updateRealmSheet で書き換える) */
  function renderRealmSheet() {
    const has = C.hasRealm(state);
    const sel = realm.sel;
    const mode = !has ? 'choose' : !sel ? 'overview' : C.isMine(state, sel) ? 'mine' : 'enemy';
    const key = mode + '|' + (sel || 0) + '|' + (has && sel ? String(C.attackSource(state, sel)) : '');
    if (key === realm.sheetKey) { updateRealmSheet(); return; }
    realm.sheetKey = key;
    const box = realmEls.sheet;
    box.innerHTML = '';
    box.dataset.mode = mode;
    const pref = sel ? C.prefOf(sel) : null;
    const add = function (html, cls, tag) { const d = document.createElement(tag || 'div'); d.className = cls; d.innerHTML = html; box.appendChild(d); return d; };
    const castleImg = '<img src="' + imgs['b-castle'].src + '" alt="">';
    const head = function (img, name, note) { add(img + '<div><div class="sheet-name">' + name + '</div><div class="sheet-note">' + note + '</div></div>', 'rs-head'); };

    if (mode === 'choose') {
      if (pref) {
        head(castleImg, pref.name + ' <i>🐾</i>', pref.kuni + 'の国 ・ ' + C.REGIONS[pref.region]);
        add(pref.desc, 'rs-desc', 'p');
        const b = sheetButton('btn-start', '<span><b>この国から はじめる</b></span>', function () { doStartRealm(sel); });
        b.dataset.act = 'start';
        box.appendChild(b);
      } else {
        head('<img class="face" src="' + imgs['face-smile'].src + '" alt="">', '国を えらぶ', 'お殿様から 国をひとつ まかされた!');
        add('地図の国を押して えらんでね。まわりの国には、それぞれ猫の大名がいる。はじめの国から遠いほど 強いにゃ。', 'rs-desc', 'p');
      }
    } else if (mode === 'overview') {
      head('<img src="' + imgs['stage3'].src + '" alt="" class="face">', '天下統一まで あと <b data-v="left"></b> 国', '現在の状況');
      add('', 'rs-progress').dataset.v = 'progress';
      add('<span data-v="owned"></span><span data-v="troops"></span><span data-v="tax"></span>', 'sheet-stats');
      add('赤い点線の国に 攻め込めるにゃ。国を押してね。兵が多いほど、合戦の敵が へって 弱くなる。', 'rs-desc', 'p');
    } else if (mode === 'mine') {
      const home = state.realm.home === sel;
      head(castleImg, pref.name + ' <i>🐾</i>', pref.kuni + 'の国 (' + (home ? 'はじめに任された国' : '自分の国') + ')');
      add('<span data-v="here"></span><span data-v="troops"></span>', 'sheet-stats');
      add(pref.desc, 'rs-desc', 'p');
      const row = add('', 'sheet-row');
      const buy = sheetButton('btn-gold', '', function () { doBuyTroops(sel); });
      buy.dataset.act = 'buy';
      const gather = sheetButton('btn-paper', '🐾 ここに 兵を集める<br><small>つながった自分の国から ぜんぶ</small>', function () { doGather(sel); });
      gather.dataset.act = 'gather';
      row.appendChild(buy); row.appendChild(gather);
    } else {
      const lv = state.realm.level[sel - 1];
      head('<img src="' + imgs[pref.look].src + '" alt="" class="face">', pref.name + ' <i>🐾</i>', pref.kuni + 'の国 ・ 大名「' + pref.daimyo + '」');
      add('<img class="tag" src="' + imgs['r-tag-strength'].src + '" alt="敵の強さ"><img class="swords" src="' + imgs['r-swords'].src + '" alt=""><b data-v="garrison"></b><span class="stars">' + stars(lv) + '</span>', 'rs-row');
      add(pref.desc, 'rs-desc flavor', 'p');
      const src = C.attackSource(state, sel);
      if (!src) {
        add('となりの国を とってから 攻めよう。自分の国のとなり (赤い点線) から 攻め込めるにゃ。', 'rs-desc', 'p');
      } else {
        add('<img class="tag" src="' + imgs['r-tag-reward'].src + '" alt="主な報酬">' +
          '<div class="tile"><img src="' + imgs['r-coin'].src + '" alt=""><span>小判<b data-v="rcoin"></b></span></div>' +
          '<div class="tile"><img src="' + imgs['r-catcoin'].src + '" alt=""><span>経験値<b data-v="rexp"></b></span></div>', 'rs-rewards');
        const send = add('', 'send');
        const minus = sheetButton('btn-paper', '−', function () { changeSend(-C.TROOP_UNIT); });
        minus.dataset.act = 'minus';
        const count = document.createElement('span');
        count.className = 'send-count';
        count.dataset.v = 'send';
        const plus = sheetButton('btn-paper', '+', function () { changeSend(C.TROOP_UNIT); });
        plus.dataset.act = 'plus';
        const all = sheetButton('btn-paper send-all', 'ぜんぶ', function () { realm.send = C.troopsAt(state, src); updateRealmSheet(); });
        all.dataset.act = 'all';
        [minus, count, plus, all].forEach(function (el) { send.appendChild(el); });
        add('', 'preview').dataset.v = 'preview';
        const go = sheetButton('btn-attack', SWORDS_SVG + '<span><b>この国を攻める</b><small data-v="use"></small></span>', function () { doAttack(); });
        go.dataset.act = 'attack';
        box.appendChild(go);
        const row = add('', 'sheet-row');
        const buy = sheetButton('btn-paper', '', function () { doBuyTroops(src); realm.send += C.TROOP_UNIT; updateRealmSheet(); });
        buy.dataset.act = 'buy';
        const gather = sheetButton('btn-paper', '🐾 ' + C.prefOf(src).name + 'に 兵を集める', function () { doGather(src); realm.send = C.troopsAt(state, src); updateRealmSheet(); });
        gather.dataset.act = 'gather';
        row.appendChild(buy); row.appendChild(gather);
      }
    }
    updateRealmSheet();
    realmLayoutChanged();
  }

  /** 札の高さが変わったら、案内の猫を札の上に乗せ直し、見る範囲の真ん中も合わせる (縦画面) */
  function realmLayoutChanged() {
    const body = realmEls.content;
    const sh = realmEls.sheet.getBoundingClientRect(), m = realmEls.map.getBoundingClientRect();
    const cover = Math.max(0, m.bottom - sh.top);
    body.style.setProperty('--sheet-cover', Math.round(cover) + 'px');
  }

  function changeSend(d) {
    const src = C.attackSource(state, realm.sel);
    if (!src) return;
    realm.send = Math.max(0, Math.min(C.troopsAt(state, src), realm.send + d));
    updateRealmSheet();
  }

  /** 札の数字と、押せるかどうかだけを直す (ボタンは作り直さない。押している最中に入れ替わると押したことにならない) */
  function updateRealmSheet() {
    updateRealmNumbers();
    const box = realmEls.sheet;
    const set = function (v, text) { const el = box.querySelector('[data-v="' + v + '"]'); if (el && el.textContent !== text) el.textContent = text; };
    const act = function (a) { return box.querySelector('[data-act="' + a + '"]'); };
    const bubble = guideText();
    if (realmEls.bubble.textContent !== bubble) realmEls.bubble.textContent = bubble;
    const has = C.hasRealm(state);
    if (!has) return;
    const sel = realm.sel;
    set('left', String(C.PREF_COUNT - C.ownedCount(state)));
    set('owned', '自分の国 ' + C.ownedCount(state));
    set('troops', '兵 ぜんぶで ' + C.totalTroops(state));
    set('tax', '年貢 +' + Math.round(C.ownedCount(state) * C.TAX_PER_PREF * 60) + ' 小判/分');
    const prog = box.querySelector('[data-v="progress"]');
    if (prog) {
      // 地方ごとの丸: その地方をぜんぶ取ったら光る
      const done = C.REGIONS.map(function (_, r) { return C.PREFS.filter(function (p) { return p.region === r; }).every(function (p) { return C.isMine(state, p.id); }); });
      const html = done.map(function (d, r) { return '<i class="' + (d ? 'on' : '') + '" title="' + C.REGIONS[r] + '"></i>'; }).join('');
      if (prog.innerHTML !== html) prog.innerHTML = html;
    }
    const buyText = '兵を100 買う<br><small>小判 ' + C.TROOP_COST + '</small>';
    if (sel && C.isMine(state, sel)) {
      set('here', 'ここの兵 ' + C.troopsAt(state, sel));
      const buy = act('buy');
      if (buy) { if (buy.innerHTML !== buyText) buy.innerHTML = buyText; buy.disabled = !C.canBuyTroops(state, sel); }
      const g = act('gather');
      if (g) g.disabled = C.totalTroops(state) === C.troopsAt(state, sel);
    } else if (sel) {
      set('garrison', String(C.troopsAt(state, sel)));
      const src = C.attackSource(state, sel);
      if (!src) return;
      realm.send = Math.max(0, Math.min(C.troopsAt(state, src), realm.send));
      set('send', String(realm.send));
      set('use', C.prefOf(src).name + 'の兵を ' + realm.send + ' つかう');
      const buy = act('buy');
      if (buy) { if (buy.innerHTML !== buyText) buy.innerHTML = buyText; buy.disabled = !C.canBuyTroops(state, src); }
      const g = act('gather');
      if (g) g.disabled = C.totalTroops(state) === C.troopsAt(state, src);
      act('minus').disabled = realm.send <= C.TROOP_UNIT;
      act('plus').disabled = realm.send >= C.troopsAt(state, src);
      act('attack').disabled = !C.canAttack(state, src, sel, realm.send);
      let preview = '兵が いないと 攻められないにゃ。買うか 集めよう';
      let rc = '-';
      if (realm.send >= C.TROOP_UNIT) {
        const plan = C.attackPlan(state, src, sel, realm.send);
        const times = plan.ratio >= 10 ? Math.round(plan.ratio) : Math.round(plan.ratio * 10) / 10;
        preview = '兵は 敵の ' + times + ' 倍 → 敵 ' + plan.count + ' 匹 ・ 強さ ' + Math.round(plan.strength * 100) + '%';
        if (plan.ratio < 1) preview += '<br>敵より 少ないと 強くなるにゃ';
        else if (plan.ratio < 1.5) preview += '<br>1.5 倍で 敵が 1 匹へる';
        else if (plan.ratio < 3) preview += '<br>3 倍で もう 1 匹へる';
        rc = String(C.conquestReward(state, plan));
      }
      set('rcoin', rc);
      set('rexp', rc);
      const pv = box.querySelector('[data-v="preview"]');
      if (pv && pv.innerHTML !== preview) pv.innerHTML = preview;
    }
  }

  function doStartRealm(id) {
    const r = C.startRealm(state, id, rng);
    if (!r.ok) return false;
    state = r.state;
    saveSoon();
    realm.sel = null;
    moveCamera(homeCamera());
    realm.dirty = true;
    renderRealmSheet();
    showToast('「' + C.prefOf(id).name + '」を任された! となりの国に 攻め込もう', 2600);
    return true;
  }

  function doBuyTroops(id) {
    const r = C.buyTroops(state, id);
    if (!r.ok) return false;
    state = r.state;
    saveSoon();
    realm.dirty = true;
    updateRealmSheet();
    return true;
  }

  function doGather(id) {
    const r = C.gatherTroops(state, id);
    if (!r.ok) return false;
    state = r.state;
    saveSoon();
    realm.dirty = true;
    updateRealmSheet();
    showToast(C.prefOf(id).name + 'に 兵が ' + r.moved + ' 集まった', 1600);
    return true;
  }

  function doAttack() {
    const to = realm.sel;
    const from = to ? C.attackSource(state, to) : null;
    if (!from || !C.canAttack(state, from, to, realm.send)) return false;
    const plan = C.attackPlan(state, from, to, realm.send);
    switchTab('battle');
    showReady();
    battle = C.createBattle(state, rng, plan);
    lastBattle = null;
    paused = false;
    effects = [];
    els.readyPanel.hidden = true;
    els.resultPanel.hidden = true;
    renderHud(true);
    showBanner(plan.name + '攻め!', 40);
    return true;
  }

  function realmFrame(dt) {
    if (realm.anim) {
      const a = realm.anim;
      a.t = Math.min(1, a.t + dt / 0.3);
      const e = 1 - Math.pow(1 - a.t, 3);
      realm.cam = {
        x: a.from.x + (a.to.x - a.from.x) * e,
        y: a.from.y + (a.to.y - a.from.y) * e,
        k: a.from.k * Math.pow(a.to.k / a.from.k, e)
      };
      if (a.t >= 1) realm.anim = null;   // 止まったら、次の描き直しで描いておく絵も作り直す
      realm.dirty = true;
    }
    if (realm.dirty) drawRealm();
  }

  function showUnify() {
    realmEls.unify.hidden = false;
    realmEls.unify.querySelector('.modal-card').animate([{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
    setFace('smile', 4);
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

    if (currentTab === 'realm' && isUnlocked('realm')) realmFrame(Math.min(dt, 0.1));

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
      if (currentTab === 'realm' && isUnlocked('realm')) updateRealmSheet();
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
      const cq = lastBattle && lastBattle.conquest;
      showReady();
      // 国とりの合戦のあとは、天下の地図へ戻る (勝っても負けても。負けたら兵を足して挑み直す)
      if (cq) { backToRealm(cq.to); return; }
      if (!won) sortie();
    });
    realmEls.canvas.addEventListener('pointerdown', onRealmPointerDown);
    realmEls.canvas.addEventListener('pointermove', onRealmPointerMove);
    ['pointerup', 'pointercancel'].forEach(function (t) { realmEls.canvas.addEventListener(t, onRealmPointerUp); });
    blockLoupe(realmEls.canvas);
    realmEls.all.addEventListener('click', function () { moveCamera(wholeCamera()); });
    realmEls.back.addEventListener('click', function () { switchTab('battle'); });
    realmEls.unifyOk.addEventListener('click', function () { realmEls.unify.hidden = true; });
    els.btnOfferYes.addEventListener('click', acceptOffer);
    els.btnOfferNo.addEventListener('click', function () { pendingOffer = null; els.offer.hidden = true; });
    onDown(els.btnLure, function () { unlockAudio(); doLure(); });
    // 猫パンチは長押しで溜める。指がボタンの外へずれても離すまで捕まえておく (setPointerCapture)
    els.btnPunch.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { els.btnPunch.setPointerCapture(e.pointerId); } catch (err) { /* 捕まえられなくても押せる */ }
      doPunchPress();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (type) {
      els.btnPunch.addEventListener(type, function () { if (battle && battle.charge.on) doPunchRelease(); else els.btnPunch.classList.remove('charging'); });
    });
    els.btnPunch.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    [els.btnLure, els.btnPunch, els.fieldFg].forEach(blockLoupe);
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
    if (window.ResizeObserver) {
      new ResizeObserver(sizeField).observe(els.field);
      new ResizeObserver(function () { if (currentTab === 'realm') sizeRealm(); }).observe(realmEls.map);
      new ResizeObserver(function () { if (currentTab === 'realm') realmLayoutChanged(); }).observe(realmEls.sheet);
    }
    window.addEventListener('resize', function () {
      sizeField();
      if (currentTab === 'realm') sizeRealm();
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
      pressPunch: doPunchPress,
      releasePunch: doPunchRelease,
      mood: function () { const b = battle; return b ? C.enemyMood(b.enemies[b.current]) : 'none'; },
      sfx: function () { return Object.assign({}, sfxCount); },
      item: doItem,
      paused: function () { return paused; },
      offer: function () { return pendingOffer; },
      acceptOffer: acceptOffer,
      face: function () { return face.shown; },
      fieldSize: function () { return Object.assign({}, fieldSize); },
      /** 敵の頭の上のゲージの上端 (画面の見張り用) */
      moodTop: function () {
        const b = battle; const e = b && b.enemies[b.current];
        if (!e) return null;
        const s = fieldSize.s;
        return Math.max(fieldSize.ground - 150 * enemyScale(e) - 34 * s, (fieldSize.hudBottom || 0) + 34 * s) - 16 * s - 12;
      },
      // 立ち位置。enterLeft は、歩き出す瞬間の敵の絵の左端 (種類ごとの最小)。画面の外 (>= w) であるべき
      layout: function () {
        let enterLeft = Infinity;
        Object.keys(C.ENEMY_KINDS).forEach(function (k) {
          const e = { x: C.ENTER_X, state: 'enter', kind: k, look: C.ENEMY_KINDS[k].look, boss: k === 'boss' };
          const im = imgs[e.look];
          enterLeft = Math.min(enterLeft, enemyX(e) - im.naturalWidth * enemyScale(e) / 2);
        });
        return { bg: battleBgReady ? 'image' : 'drawn', bgGroundY: fieldSize.bgGroundY, land: !!fieldSize.land, w: fieldSize.w, h: fieldSize.h, s: fieldSize.s, ground: fieldSize.ground,
          obstacle: (function () {
            const im = imgs['b-barrels'];
            const o = obstaclePos();
            const hh = 78 * fieldSize.s, ww = hh * im.naturalWidth / im.naturalHeight;
            return { left: o.x - ww / 2, right: o.x + ww / 2, top: o.y - hh, bottom: o.y };
          })(),
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
      trainHero: doTrainHero,
      debugSetMaterials: function (n) {
        state = Object.assign({}, state, { materials: n });
        renderActiveView();
      },
      closeModals: function () { els.rankModal.hidden = true; els.storyModal.hidden = true; realmEls.unify.hidden = true; },
      // 天下
      startRealm: doStartRealm,
      selectPref: selectPref,
      selectedPref: function () { return realm.sel; },
      buyTroops: doBuyTroops,
      gather: doGather,
      attack: doAttack,
      setSend: function (n) { realm.send = n; updateRealmSheet(); },
      realmCam: function () { return Object.assign({}, realm.cam); },
      realmAnimating: function () { return !!realm.anim; },
      /** 地図を 47 県ぶん描き直した回数 (動かしている最中は増えないはず) */
      realmFullDraws: function () { return realm.fullDraws || 0; },
      realmFitAll: function () { moveCamera(wholeCamera(), true); },
      /** 地図のうち、飾りや札に隠れていない所 (画面の位置) */
      realmFreeRect: function () {
        const f = freeRect(), m = realmEls.map.getBoundingClientRect();
        return { left: m.left + f.x0, top: m.top + f.y0, right: m.left + f.x1, bottom: m.top + f.y1 };
      },
      /** 県の名前の点の、画面での位置 (指で押すテスト用) */
      prefPoint: function (id) {
        const p = prefShapes[id - 1];
        const r = realmEls.canvas.getBoundingClientRect();
        const s = toScreen(p.lx, p.ly);
        return { x: r.left + s.x, y: r.top + s.y, room: p.lr * realm.cam.k };
      },
      /** 小判だけ増やす (年貢や自主練で裏で増えるのと同じ。画面は作り直さない) */
      debugAddCoins: function (n) { state = Object.assign({}, state, { merit: state.merit + n }); },
      debugSetState: function (fn) { state = fn(state); renderTabs(); renderActiveView(); renderHud(true); }
    };
  }

  main();
})();
