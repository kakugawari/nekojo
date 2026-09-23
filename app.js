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
  const MAX_VILLAGE_ICONS = 60;

  const $ = (id) => document.getElementById(id);
  const els = {
    titleScreen: $('titleScreen'), btnStart: $('btnStart'),
    portraitImg: $('portraitImg'), rankTag: $('rankTag'), meritValue: $('meritValue'),
    hpFill: $('hpFill'), hpText: $('hpText'), nextRankLabel: $('nextRankLabel'), nextFill: $('nextFill'),
    field: $('field'), fieldBg: $('fieldBg'), fieldFg: $('fieldFg'), fieldBanner: $('fieldBanner'),
    readyPanel: $('readyPanel'), readyTitle: $('readyTitle'), readyText: $('readyText'), btnSortie: $('btnSortie'),
    resultPanel: $('resultPanel'), resultTitle: $('resultTitle'), resultRows: $('resultRows'),
    offer: $('offer'), offerImg: $('offerImg'), offerText: $('offerText'),
    btnOfferYes: $('btnOfferYes'), btnOfferNo: $('btnOfferNo'), btnNext: $('btnNext'),
    specialFill: $('specialFill'), comboText: $('comboText'),
    btnLure: $('btnLure'), btnPunch: $('btnPunch'), btnSpecial: $('btnSpecial'),
    lureCd: $('lureCd'), punchCd: $('punchCd'),
    vassalSlotCount: $('vassalSlotCount'), vassalsLocked: $('vassalsLocked'), vassalsContent: $('vassalsContent'),
    vassalList: $('vassalList'), btnRecruit: $('btnRecruit'),
    materialCountCastle: $('materialCountCastle'), castleLocked: $('castleLocked'), castleContent: $('castleContent'),
    castleBanner: $('castleBanner'), castleGrid: $('castleGrid'), buildPicker: $('buildPicker'),
    materialCountVillage: $('materialCountVillage'), villageLocked: $('villageLocked'), villageContent: $('villageContent'),
    popLabel: $('popLabel'), popFill: $('popFill'), villageCats: $('villageCats'), btnBuildHouse: $('btnBuildHouse'),
    toast: $('toast'), cutin: $('cutin'),
    storyModal: $('storyModal'), btnStory: $('btnStory'),
    rankModal: $('rankModal'), rankUpName: $('rankUpName'), rankUpArt: $('rankUpArt'), rankUpText: $('rankUpText'), btnRankOk: $('btnRankOk')
  };
  const views = { battle: $('view-battle'), vassals: $('view-vassals'), castle: $('view-castle'), village: $('view-village') };
  const tabEls = { battle: $('tab-battle'), vassals: $('tab-vassals'), castle: $('tab-castle'), village: $('tab-village') };
  const TAB_LABELS = { battle: '合戦', vassals: '家臣', castle: '城', village: '村' };

  // ---------------------------------------------------------- 絵

  const IMG_NAMES = ['stage0', 'stage1', 'stage2', 'stage3', 'cat-normal', 'cat-chatora', 'cat-kuro', 'cat-gray', 'cat-red',
    'face-normal', 'face-smile', 'face-serious', 'face-surprised', 'face-angry', 'face-shy', 'pose-special'];
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
  let openCellIndex = null;
  let lastPopFloor = -1;
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
    else if (currentTab === 'castle') renderCastleView();
    else if (currentTab === 'village') renderVillageView();
  }

  // ---------------------------------------------------------- 上の顔と体力

  const hudCache = {};
  function setText(el, key, text) {
    if (hudCache[key] !== text) { hudCache[key] = text; el.textContent = text; }
  }
  function setWidth(el, key, pct) {
    const v = Math.round(pct * 10) / 10;
    if (hudCache[key] !== v) { hudCache[key] = v; el.style.width = v + '%'; }
  }

  function renderHud(force) {
    if (force) Object.keys(hudCache).forEach(function (k) { delete hudCache[k]; });
    const r = C.rankIndexOf(state);
    setText(els.rankTag, 'rank', C.RANKS[r].name);
    setText(els.meritValue, 'merit', String(Math.floor(state.merit)));
    const next = C.RANKS[r + 1];
    if (next) {
      const span = next.threshold - C.RANKS[r].threshold;
      setText(els.nextRankLabel, 'nextLabel', '「' + next.name + '」まで');
      setWidth(els.nextFill, 'next', Math.max(0, Math.min(100, (state.totalMerit - C.RANKS[r].threshold) / span * 100)));
    } else {
      setText(els.nextRankLabel, 'nextLabel', '出世の最高位!');
      setWidth(els.nextFill, 'next', 100);
    }
    const hp = battle ? battle.player.hp : C.playerMaxHp(r);
    const maxHp = battle ? battle.player.maxHp : C.playerMaxHp(r);
    setWidth(els.hpFill, 'hp', hp / maxHp * 100);
    setText(els.hpText, 'hpText', Math.ceil(hp) + '/' + maxHp);
    const low = hp / maxHp < 0.3;
    if (hudCache.low !== low) { hudCache.low = low; els.hpFill.classList.toggle('low', low); }

    const sp = battle ? battle.special : 0;
    setWidth(els.specialFill, 'sp', sp);
    const spReady = !!(battle && battle.phase === 'fight' && sp >= 100);
    if (hudCache.spReady !== spReady) {
      hudCache.spReady = spReady;
      els.btnSpecial.disabled = !spReady;
      els.btnSpecial.classList.toggle('ready', spReady);
    }
    const combo = battle && battle.combo >= 2 ? battle.combo + ' コンボ!' : '';
    setText(els.comboText, 'combo', combo);

    const lureCd = battle ? battle.cd.lure / C.LURE_COOLDOWN : 0;
    const punchCd = battle ? battle.cd.punch / C.PUNCH_COOLDOWN : 0;
    const lc = Math.round(lureCd * 50) / 50, pc = Math.round(punchCd * 50) / 50;
    if (hudCache.lcd !== lc) { hudCache.lcd = lc; els.lureCd.style.setProperty('--cd', lc); }
    if (hudCache.pcd !== pc) { hudCache.pcd = pc; els.punchCd.style.setProperty('--cd', pc); }
  }

  // ---------------------------------------------------------- 戦場の大きさ

  const fieldSize = { w: 0, h: 0, dpr: 1, s: 1, ground: 0, padL: 0, padR: 0, depth: 0 };
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
    fieldSize.ground = Math.round(h * 0.9);
    // 左に家臣が並ぶ場所を空けておく
    fieldSize.padL = w * 0.17;
    fieldSize.padR = w * 0.03;
    // 設定資料の絵は、ねこ 1 匹がだいたい高さ 150px。横に並ぶので幅でも抑える
    fieldSize.s = Math.min(h * 0.3 / 150, w * 0.26 / 120);
    // 敵の列は奥へ斜めに並ぶ (奥ほど高く・小さく)。縦長の戦場を広く使うため
    fieldSize.depth = h * 0.075;
    [els.fieldBg, els.fieldFg].forEach(function (c) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    });
    drawBackground();
  }

  function fx(lx) {
    return fieldSize.padL + lx / C.FIELD_W * (fieldSize.w - fieldSize.padL - fieldSize.padR);
  }

  // ---------------------------------------------------------- 背景 (一度だけ描く)

  function drawBackground() {
    const ctx = bgCtx;
    const w = fieldSize.w, h = fieldSize.h, dpr = fieldSize.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const horizon = h * 0.34;
    const groundTop = h * 0.43;
    const R = C.mulberry32(20260923);

    // 空
    let g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, '#7cc4f2');
    g.addColorStop(1, '#dff2fb');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, groundTop + 2);
    g = ctx.createRadialGradient(w * 0.85, h * 0.05, 0, w * 0.85, h * 0.05, w * 0.5);
    g.addColorStop(0, 'rgba(255,250,220,.8)');
    g.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizon);

    // 雲
    function cloud(cx, cy, sc) {
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      [[0, 0, 22], [22, -8, 18], [42, 2, 16], [-20, 4, 14], [12, 8, 18]].forEach(function (c) {
        ctx.beginPath(); ctx.arc(cx + c[0] * sc, cy + c[1] * sc, c[2] * sc, 0, Math.PI * 2); ctx.fill();
      });
    }
    cloud(w * 0.12, h * 0.1, w / 430);
    cloud(w * 0.55, h * 0.06, w / 560);
    cloud(w * 0.92, h * 0.2, w / 520);

    // 遠くの山 (2 枚)
    function ridge(y0, amp, color, seed) {
      const r = C.mulberry32(seed);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, groundTop);
      ctx.lineTo(0, y0);
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const x = w * i / n;
        const y = y0 - amp * (0.4 + r() * 0.6);
        const cx = x - w / n / 2;
        ctx.quadraticCurveTo(cx, y - amp * 0.3, x, y0 - amp * 0.2 * r());
      }
      ctx.lineTo(w, groundTop);
      ctx.closePath();
      ctx.fill();
    }
    ridge(horizon + h * 0.02, h * 0.14, '#b3cde4', 3);
    ridge(horizon + h * 0.06, h * 0.1, '#9cbbd8', 7);

    // 丘の上のお城
    const cx = w * 0.74, cy = horizon + h * 0.03, u = Math.min(w, h * 1.1) / 430;
    ctx.fillStyle = '#86b867';
    ctx.beginPath(); ctx.ellipse(cx, cy + 34 * u, 110 * u, 40 * u, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#9d9788';
    ctx.beginPath();
    ctx.moveTo(cx - 44 * u, cy + 6 * u); ctx.lineTo(cx + 44 * u, cy + 6 * u);
    ctx.lineTo(cx + 36 * u, cy - 12 * u); ctx.lineTo(cx - 36 * u, cy - 12 * u); ctx.closePath(); ctx.fill();
    const tiers = [[34, 16], [26, 14], [18, 12]];
    let ty = cy - 12 * u;
    tiers.forEach(function (t, i) {
      const tw = t[0] * u, th = t[1] * u;
      ctx.fillStyle = '#fbf8f0';
      ctx.fillRect(cx - tw, ty - th, tw * 2, th);
      ctx.fillStyle = '#3f4d70';
      for (let k = -1; k <= 1; k++) ctx.fillRect(cx + k * tw * 0.55 - 2 * u, ty - th * 0.7, 4 * u, 4 * u);
      // 反った屋根
      ctx.fillStyle = '#34416a';
      ctx.beginPath();
      ctx.moveTo(cx - tw - 10 * u, ty - th + 1 * u);
      ctx.quadraticCurveTo(cx - tw * 0.4, ty - th - 2 * u, cx, ty - th - 9 * u);
      ctx.quadraticCurveTo(cx + tw * 0.4, ty - th - 2 * u, cx + tw + 10 * u, ty - th + 1 * u);
      ctx.lineTo(cx + tw + 2 * u, ty - th + 4 * u);
      ctx.lineTo(cx - tw - 2 * u, ty - th + 4 * u);
      ctx.closePath();
      ctx.fill();
      ty -= th + 6 * u;
      if (i === tiers.length - 1) {
        ctx.fillStyle = '#e9c46a';
        ctx.beginPath(); ctx.arc(cx - 6 * u, ty + 1 * u, 2.4 * u, 0, Math.PI * 2); ctx.arc(cx + 6 * u, ty + 1 * u, 2.4 * u, 0, Math.PI * 2); ctx.fill();
      }
    });

    // 手前の丘と木
    g = ctx.createLinearGradient(0, horizon, 0, groundTop);
    g.addColorStop(0, '#a6d27a');
    g.addColorStop(1, '#7fb95c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, groundTop);
    ctx.lineTo(0, horizon + h * 0.07);
    ctx.quadraticCurveTo(w * 0.25, horizon + h * 0.01, w * 0.5, horizon + h * 0.08);
    ctx.quadraticCurveTo(w * 0.8, horizon + h * 0.13, w, horizon + h * 0.07);
    ctx.lineTo(w, groundTop);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 14; i++) {
      const tx = R() * w, tyy = horizon + h * (0.06 + R() * 0.05), tr = (6 + R() * 8) * u;
      ctx.fillStyle = i % 2 ? '#5f9a48' : '#6fae52';
      ctx.beginPath(); ctx.arc(tx, tyy, tr, 0, Math.PI * 2); ctx.arc(tx + tr * 0.8, tyy + tr * 0.2, tr * 0.8, 0, Math.PI * 2); ctx.fill();
    }

    // 村の家 (かやぶき)
    function house(hx, hy, sc) {
      ctx.fillStyle = '#efe2c4';
      ctx.fillRect(hx - 14 * sc, hy - 12 * sc, 28 * sc, 12 * sc);
      ctx.fillStyle = '#6b4f33';
      ctx.fillRect(hx - 4 * sc, hy - 9 * sc, 8 * sc, 9 * sc);
      ctx.fillStyle = '#c9a063';
      ctx.beginPath(); ctx.moveTo(hx - 20 * sc, hy - 11 * sc); ctx.lineTo(hx, hy - 30 * sc); ctx.lineTo(hx + 20 * sc, hy - 11 * sc); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a98147';
      ctx.fillRect(hx - 20 * sc, hy - 13 * sc, 40 * sc, 3 * sc);
    }
    house(w * 0.1, groundTop - 2, u);
    house(w * 0.27, groundTop - 6, u * 0.8);
    house(w * 0.43, groundTop - 3, u * 0.7);

    // 広場 (土)
    g = ctx.createLinearGradient(0, groundTop, 0, h);
    g.addColorStop(0, '#e6d3a8');
    g.addColorStop(1, '#cfb27a');
    ctx.fillStyle = g;
    ctx.fillRect(0, groundTop, w, h - groundTop);
    ctx.fillStyle = 'rgba(255,248,225,.45)';
    ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.74, w * 0.6, h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = R() < 0.5 ? 'rgba(120,90,50,.18)' : 'rgba(255,255,255,.25)';
      const sx = R() * w, sy = groundTop + R() * (h - groundTop);
      ctx.fillRect(sx, sy, 1.5 + R() * 2, 1 + R());
    }
    // 草のふち
    ctx.fillStyle = '#8ec766';
    ctx.beginPath();
    ctx.moveTo(0, groundTop + 4);
    for (let x = 0; x <= w; x += 8) ctx.lineTo(x, groundTop + (x / 8 % 2 ? 7 : 1));
    ctx.lineTo(w, groundTop - 2); ctx.lineTo(0, groundTop - 2); ctx.closePath(); ctx.fill();

    // 柵
    ctx.strokeStyle = '#8a6a44';
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.moveTo(w * 0.52, groundTop - 12 * u); ctx.lineTo(w, groundTop - 12 * u);
    ctx.moveTo(w * 0.52, groundTop - 4 * u); ctx.lineTo(w, groundTop - 4 * u);
    ctx.stroke();
    ctx.fillStyle = '#7a5a36';
    for (let x = w * 0.54; x < w; x += 26 * u) ctx.fillRect(x - 2.5 * u, groundTop - 20 * u, 5 * u, 22 * u);

    // 肉球の旗
    function banner(bx, by, sc) {
      ctx.fillStyle = '#6b4f33';
      ctx.fillRect(bx - 1.5 * sc, by - 70 * sc, 3 * sc, 72 * sc);
      ctx.fillRect(bx - 1.5 * sc, by - 70 * sc, 22 * sc, 3 * sc);
      ctx.fillStyle = '#2f3f72';
      ctx.fillRect(bx + 1.5 * sc, by - 67 * sc, 18 * sc, 40 * sc);
      ctx.fillStyle = '#fff';
      const px = bx + 10.5 * sc, py = by - 45 * sc;
      ctx.beginPath(); ctx.ellipse(px, py + 3 * sc, 4.5 * sc, 3.8 * sc, 0, 0, Math.PI * 2); ctx.fill();
      [[-5, -3], [-2, -7], [2, -7], [5, -3]].forEach(function (d) {
        ctx.beginPath(); ctx.arc(px + d[0] * sc, py + d[1] * sc, 1.7 * sc, 0, Math.PI * 2); ctx.fill();
      });
    }
    banner(w * 0.035, groundTop + 12 * u, u * 1.1);
    banner(w * 0.93, groundTop + 6 * u, u);

    // 手前の草花
    for (let i = 0; i < 26; i++) {
      const gx = (i < 13 ? R() * w * 0.22 : w - R() * w * 0.22), gy = h - R() * h * 0.08;
      ctx.fillStyle = i % 3 ? '#77b456' : '#5f9a48';
      ctx.beginPath(); ctx.ellipse(gx, gy, 3 * u, 9 * u, (R() - 0.5), 0, Math.PI * 2); ctx.fill();
      if (i % 4 === 0) {
        ctx.fillStyle = '#f7b6cf';
        ctx.beginPath(); ctx.arc(gx + 3 * u, gy - 8 * u, 3 * u, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ふちを少し暗く
    g = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.35, w / 2, h * 0.55, h * 0.9);
    g.addColorStop(0, 'rgba(58,42,28,0)');
    g.addColorStop(1, 'rgba(58,42,28,.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // ---------------------------------------------------------- 効果

  let effects = [];
  const disp = {};        // 敵ごとの表示位置 (ゆっくり追いかける) と、ひかり・揺れ
  const anim = { lunge: 0, swing: 0, hurt: 0, shake: 0, flash: 0 };
  const petals = [];
  for (let i = 0; i < 9; i++) petals.push({ x: Math.random(), y: Math.random(), v: 0.03 + Math.random() * 0.03, p: Math.random() * 6 });

  function addEffect(e) {
    e.t = 0;
    effects.push(e);
  }

  function enemyScreen(e) {
    const d = disp[e.id];
    const x = fx(d ? d.x : e.x);
    return { x: x, y: fieldSize.ground - (d ? d.depth : 0) };
  }

  function handleEvents(b) {
    const s = fieldSize.s;
    for (let i = 0; i < b.events.length; i++) {
      const ev = b.events[i];
      const e = ev.id ? b.enemies.find(function (en) { return en.id === ev.id; }) : null;
      const pos = e ? enemyScreen(e) : null;
      const top = pos ? pos.y - 150 * s * (e.boss ? 1.25 : 1) : 0;
      if (ev.type === 'hit') {
        if (disp[ev.id]) disp[ev.id].flash = 1;
        if (ev.source === 'punch') {
          addEffect({ kind: 'burst', x: pos.x - 18 * s, y: pos.y - 70 * s, r: (ev.crit ? 46 : 34) * s, dur: 0.26 });
        } else if (ev.source === 'ally') {
          addEffect({ kind: 'burst', x: pos.x - 10 * s, y: pos.y - 90 * s, r: 20 * s, dur: 0.2 });
        } else {
          addEffect({ kind: 'sparkle', x: pos.x, y: pos.y - 70 * s, dur: 0.6 });
        }
        addEffect({ kind: 'num', x: pos.x, y: top, text: String(ev.amount), crit: ev.crit, dur: 0.8 });
        if (ev.crit && ev.source === 'punch') {
          addEffect({ kind: 'text', x: pos.x, y: top - 26 * s, text: '会心!', color: '#c8412f', size: 20, dur: 0.8 });
          setFace('smile', 0.8);
        }
      } else if (ev.type === 'down') {
        addEffect({ kind: 'dust', x: pos.x, y: pos.y - 30 * s, dur: 0.6 });
        addEffect({ kind: 'text', x: pos.x, y: top + 10 * s, text: '+' + ev.reward + ' 手柄', color: '#b98b34', size: 16, dur: 1.1 });
        addEffect({ kind: 'ghost', id: ev.id, x: pos.x, y: pos.y, look: e.look, boss: e.boss, dur: 0.5 });
        setFace('smile', 0.9);
      } else if (ev.type === 'lure') {
        anim.swing = 1;
        addEffect({ kind: 'swish', x0: fx(b.player.x) + 30 * s, y0: fieldSize.ground - 95 * s, x1: pos.x, y1: pos.y - 90 * s, dur: 0.38 });
        addEffect({ kind: 'text', x: pos.x, y: top - 4 * s, text: ev.perfect ? '見切り!' : '夢中!', color: ev.perfect ? '#c8412f' : '#e0679b', size: ev.perfect ? 24 : 18, dur: 1.0 });
        if (ev.perfect) setFace('smile', 1.0);
      } else if (ev.type === 'lureMiss') {
        anim.swing = 1;
      } else if (ev.type === 'miss') {
        addEffect({ kind: 'text', x: fx(b.player.x) + 50 * s, y: fieldSize.ground - 120 * s, text: 'スカッ', color: '#7a6650', size: 16, dur: 0.7 });
        setFace('shy', 0.8);
      } else if (ev.type === 'playerHit') {
        anim.hurt = 1; anim.shake = 1; anim.flash = 1;
        addEffect({ kind: 'num', x: fx(b.player.x), y: fieldSize.ground - 150 * s, text: '-' + ev.amount, hurt: true, dur: 0.8 });
        setFace('surprised', 0.7);
      } else if (ev.type === 'special') {
        startCutin();
        addEffect({ kind: 'swirl', dur: 1.2 });
      } else if (ev.type === 'specialReady') {
        setFace('smile', 1.0);
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
    ctx.save();
    ctx.translate(x, groundY);
    if (opts && opts.rot) ctx.rotate(opts.rot);
    if (opts && opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    ctx.drawImage(im, -w / 2, -h, w, h);
    if (opts && opts.flash > 0) {
      // 当たった瞬間だけ白く光らせる (同じ絵を足し算で重ねる)
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = opts.flash * 0.6;
      ctx.drawImage(im, -w / 2, -h, w, h);
    }
    ctx.restore();
  }

  function shadow(ctx, x, y, rx) {
    ctx.fillStyle = 'rgba(80,55,25,.25)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function outlinedText(ctx, text, x, y, size, fill, stroke) {
    ctx.font = '900 ' + size + 'px "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size / 5);
    ctx.strokeStyle = stroke || '#3a2a1c';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
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

  function drawEffect(ctx, e) {
    const k = e.t / e.dur;
    const s = fieldSize.s;
    if (e.kind === 'burst') {
      const r = e.r * (0.6 + k * 0.7);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = '#ffd84a';
      burstPath(ctx, e.x, e.y, r, 9); ctx.fill();
      ctx.fillStyle = '#fffbe0';
      burstPath(ctx, e.x, e.y, r * 0.55, 9); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (e.kind === 'num') {
      const y = e.y - 30 * s * k;
      ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      const size = e.crit ? 30 : (e.hurt ? 22 : 24);
      outlinedText(ctx, e.text, e.x, y, size, e.hurt ? '#ff6a55' : (e.crit ? '#ffd84a' : '#ffffff'));
      ctx.globalAlpha = 1;
    } else if (e.kind === 'text') {
      const y = e.y - 22 * s * k;
      ctx.globalAlpha = k < 0.6 ? 1 : (1 - k) / 0.4;
      outlinedText(ctx, e.text, e.x, y, e.size, e.color, '#fff');
      ctx.globalAlpha = 1;
    } else if (e.kind === 'swish') {
      // 猫じゃらしの羽の軌跡 (黄・白・桃)
      const mx = (e.x0 + e.x1) / 2, my = Math.min(e.y0, e.y1) - 60 * s;
      const tip = Math.min(1, k * 1.8);
      const bx = (1 - tip) * (1 - tip) * e.x0 + 2 * (1 - tip) * tip * mx + tip * tip * e.x1;
      const by = (1 - tip) * (1 - tip) * e.y0 + 2 * (1 - tip) * tip * my + tip * tip * e.y1;
      ctx.globalAlpha = 1 - Math.max(0, k - 0.5) * 2;
      const colors = ['#ffe27a', '#ffffff', '#f7a8c4'];
      ctx.lineCap = 'round';
      for (let c = 0; c < 3; c++) {
        ctx.strokeStyle = colors[c];
        ctx.lineWidth = (12 - c * 3) * s;
        ctx.beginPath();
        ctx.moveTo(e.x0, e.y0 + c * 4 * s);
        ctx.quadraticCurveTo(mx, my + c * 4 * s, bx, by + c * 4 * s);
        ctx.stroke();
      }
      ctx.fillStyle = '#f0c040';
      ctx.beginPath(); ctx.arc(bx, by, 6 * s, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (e.kind === 'dust') {
      ctx.fillStyle = 'rgba(255,248,230,' + (0.8 * (1 - k)) + ')';
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const d = 34 * s * k;
        ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.6, (10 + 8 * k) * s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,216,74,' + (1 - k) + ')';
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + 0.4;
        burstPath(ctx, e.x + Math.cos(a) * 46 * s * k, e.y - 20 * s + Math.sin(a) * 30 * s * k, 7 * s, 5);
        ctx.fill();
      }
    } else if (e.kind === 'ghost') {
      drawSprite(ctx, imgs[e.look], e.x, e.y - 20 * s * k, s * (e.boss ? 1.25 : 1), { alpha: 1 - k, rot: -0.3 * k });
    } else if (e.kind === 'sparkle') {
      ctx.fillStyle = 'rgba(255,255,255,' + (1 - k) + ')';
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2 + k * 3;
        burstPath(ctx, e.x + Math.cos(a) * 30 * s * k, e.y + Math.sin(a) * 30 * s * k, 6 * s, 4);
        ctx.fill();
      }
    } else if (e.kind === 'swirl') {
      // 必殺技: 虹の渦が広場を回る
      const cx = fieldSize.w * 0.62, cy = fieldSize.ground - 70 * s;
      const colors = ['#f7a8c4', '#ffe27a', '#9ee3a0', '#8fd0ff', '#c9a6ff'];
      ctx.globalAlpha = k < 0.8 ? 0.85 : (1 - k) * 4 * 0.85;
      ctx.lineCap = 'round';
      for (let i = 0; i < colors.length; i++) {
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = 12 * s;
        const r = (40 + i * 22) * s * (0.4 + k);
        const a0 = k * 9 + i * 1.3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 1.4, r * 0.7, 0, a0, a0 + 3.6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function allyInterval(level) {
    return Math.max(1.2, 2.6 - 0.12 * level);
  }

  function draw(now, dt) {
    const ctx = fgCtx;
    const w = fieldSize.w, h = fieldSize.h, s = fieldSize.s, ground = fieldSize.ground;
    if (!w) return;
    ctx.setTransform(fieldSize.dpr, 0, 0, fieldSize.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t = now / 1000;

    if (anim.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 8 * anim.shake, (Math.random() - 0.5) * 5 * anim.shake);
    }

    // 花びら
    ctx.fillStyle = 'rgba(247,168,196,.85)';
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i];
      p.y += p.v * dt; p.x += p.v * 0.5 * dt;
      if (p.y > 1.05) { p.y = -0.05; p.x = Math.random(); }
      if (p.x > 1.05) p.x = -0.05;
      ctx.beginPath();
      ctx.ellipse(p.x * w, p.y * h, 4, 2.4, Math.sin(t * 2 + p.p), 0, Math.PI * 2);
      ctx.fill();
    }

    const b = battle || lastBattle;
    const r = C.rankIndexOf(state);

    // 敵 (奥から描く)
    if (b) {
      const line = b.enemies.filter(function (e) { return e.spawned && e.alive; }).sort(function (a2, c2) { return a2.x - c2.x; });
      line.forEach(function (e, k) {
        let d = disp[e.id];
        if (!d) d = disp[e.id] = { x: e.x, flash: 0, depth: 0 };
        d.moving = Math.abs(d.x - e.x) > 0.5 || (b.phase === 'fight' && e.x > C.PLAYER_X + C.STOP + k * C.GAP + 0.5 && e.charm <= 0);
        d.x += (e.x - d.x) * Math.min(1, dt * 18);
        d.depth += (Math.min(k, 4) * fieldSize.depth - d.depth) * Math.min(1, dt * 8);
        d.flash = Math.max(0, d.flash - dt / 0.18);
      });
      for (let k = line.length - 1; k >= 0; k--) {
        const e = line[k];
        const d = disp[e.id];
        const scale = s * (e.boss ? 1.25 : 1) * (1 - Math.min(k, 4) * 0.07);
        const ex = fx(d.x);
        const ey = ground - d.depth;
        const hop = d.moving ? Math.abs(Math.sin(t * 9 + e.id)) * 5 * s : 0;
        let rot = d.moving ? Math.sin(t * 9 + e.id) * 0.05 : 0;
        if (e.charm > 0) rot = Math.sin(t * 6) * 0.12;
        if (e.windup) rot = 0.12;
        shadow(ctx, ex, ey, 32 * scale);
        drawSprite(ctx, imgs[e.look], ex, ey - hop, scale, { rot: rot, flash: d.flash });
        const headY = ey - 150 * scale;
        // 体力
        const bw = 52 * s, bh = 7 * s;
        ctx.fillStyle = '#3a2a1c';
        ctx.fillRect(ex - bw / 2 - 1.5, headY - 8 * s - 1.5, bw + 3, bh + 3);
        ctx.fillStyle = '#6b1d15';
        ctx.fillRect(ex - bw / 2, headY - 8 * s, bw, bh);
        ctx.fillStyle = e.boss ? '#ff8a3d' : '#e5463a';
        ctx.fillRect(ex - bw / 2, headY - 8 * s, bw * e.hp / e.maxHp, bh);
        if (e.boss) outlinedText(ctx, '大将', ex, headY - 20 * s, 13, '#ffd84a');
        // 振りかぶり / 夢中
        if (e.windup) {
          const pulse = 1 + Math.sin(t * 20) * 0.1;
          outlinedText(ctx, '!', ex - 24 * s, headY + 10 * s, 30 * pulse, '#ff4b3a', '#fff');
        } else if (e.charm > 0) {
          for (let i = 0; i < 3; i++) {
            const a = t * 3 + i * 2.1;
            outlinedText(ctx, '♥', ex + Math.cos(a) * 26 * s, headY + 16 * s + Math.sin(a) * 8 * s, 16, '#ff7fb0', '#fff');
          }
        }
      }
    }

    // 出陣の家臣と自分は、敵より手前に描く (重なっても主人公が隠れないように)
    const allies = b ? b.allies : state.vassals.filter(function (v) { return v.job === 'battle'; }).slice(0, C.MAX_BATTLE_VASSALS);
    allies.forEach(function (a, i) {
      // 主人公の左うしろに、一段奥に並ぶ
      const ax = fx(C.PLAYER_X) - (58 + i * 30) * s;
      const ay = ground - fieldSize.depth * (0.8 + i * 0.7);
      const since = a.cd !== undefined ? allyInterval(a.level) - a.cd : 1;
      const hop = since >= 0 && since < 0.25 ? Math.sin(since / 0.25 * Math.PI) * 10 * s : 0;
      shadow(ctx, ax, ay, 18 * s);
      drawSprite(ctx, imgs[a.look] || imgs['cat-chatora'], ax, ay - hop, s * 0.7, {});
    });

    // 自分
    anim.lunge = Math.max(0, anim.lunge - dt / 0.2);
    anim.swing = Math.max(0, anim.swing - dt / 0.35);
    anim.hurt = Math.max(0, anim.hurt - dt / 0.4);
    anim.shake = Math.max(0, anim.shake - dt / 0.25);
    anim.flash = Math.max(0, anim.flash - dt / 0.35);
    const px = fx(C.PLAYER_X) + Math.sin(anim.lunge * Math.PI) * 26 * s - anim.hurt * 8 * s;
    const bob = Math.abs(Math.sin(t * 3.2)) * 3 * s;
    const lean = anim.swing > 0 ? -Math.sin(anim.swing * Math.PI) * 0.18 : (anim.lunge > 0 ? 0.12 * Math.sin(anim.lunge * Math.PI) : 0);
    shadow(ctx, px, ground, 34 * s);
    drawSprite(ctx, imgs[stageForRank(r)], px, ground - bob, s, { rot: lean, flash: anim.hurt > 0.6 ? 0.8 : 0 });


    // 効果
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
      g.addColorStop(1, 'rgba(255,60,40,' + (0.45 * anim.flash) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // ---------------------------------------------------------- 合戦の流れ

  function showReady() {
    battle = null;
    lastBattle = null;
    effects = [];
    Object.keys(disp).forEach(function (k) { delete disp[k]; });
    els.resultPanel.hidden = true;
    els.readyPanel.hidden = false;
    els.readyTitle.textContent = '第' + kanjiNum((state.battlesWon || 0) + 1) + '戦';
    const r = C.rankIndexOf(state);
    els.readyText.innerHTML = r < 2
      ? '猫じゃらしで ひきつけて、<br>猫パンチで たたこう!'
      : (r < 5 ? '敵が「!」と振りかぶったら、<br>猫じゃらしで「見切り」だ!' : '最後に出てくる大将は手ごわいにゃ。<br>スペシャルをためておこう!');
    renderHud(true);
  }

  function sortie() {
    if (battle && battle.phase === 'fight') return;
    battle = C.createBattle(state, rng);
    lastBattle = null;
    effects = [];
    Object.keys(disp).forEach(function (k) { delete disp[k]; });
    els.readyPanel.hidden = true;
    els.resultPanel.hidden = true;
    showBanner('いざ、出陣!');
    renderHud(true);
  }

  function showBanner(text) {
    els.fieldBanner.textContent = text;
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
    if (b.phase === 'won') {
      const res = C.applyBattleResult(state, b);
      state = res.state;
      pendingOffer = C.rollRecruitOffer(state, b);
      saveSoon();
      setFace('smile', 2.5);
      showBanner('勝利!');
      els.resultTitle.textContent = '勝利!';
      els.resultRows.innerHTML =
        row('倒した敵', b.enemies.length + ' 匹') +
        row('手柄', '+' + b.merit) +
        row('勝ちいくさの褒美', '+' + b.bonus) +
        row('資材', '+' + b.materials);
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
      els.resultRows.innerHTML = '<p class="panel-text">猫じゃらしで ひきつけると、<br>攻撃されずに たたけるにゃ。</p>';
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
    els.rankUpArt.src = imgs[stageForRank(idx)].src;
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
    els.btnRecruit.textContent = '村で仲間を募る (手柄 ' + C.recruitCost(state) + ')';
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

  // ---------------------------------------------------------- 城

  function renderCastleView() {
    const unlocked = isUnlocked('castle');
    els.castleLocked.hidden = unlocked;
    els.castleContent.hidden = !unlocked;
    if (!unlocked) { els.castleLocked.textContent = lockedMessage('castle'); return; }
    els.materialCountCastle.textContent = '資材 ' + Math.floor(state.materials);
    els.castleBanner.hidden = !C.isCastleComplete(state);
    els.castleBanner.textContent = '🎉 天守が建った! お城の完成にゃ!';
    els.castleGrid.innerHTML = '';
    state.castle.cells.forEach(function (type, i) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'castle-cell' + (type ? ' filled' : '');
      cell.textContent = type ? C.BUILDING_DEFS[type].icon : '＋';
      cell.setAttribute('aria-label', type ? C.BUILDING_DEFS[type].name : '空き地');
      cell.addEventListener('click', function () { onCastleCellClick(i); });
      els.castleGrid.appendChild(cell);
    });
    if (openCellIndex !== null) renderBuildPicker(openCellIndex);
    else els.buildPicker.hidden = true;
  }

  function onCastleCellClick(index) {
    const type = state.castle.cells[index];
    if (type) { showToast(C.BUILDING_DEFS[type].name + 'が建っている。', 1600); return; }
    openCellIndex = (openCellIndex === index) ? null : index;
    renderCastleView();
  }

  function renderBuildPicker(index) {
    els.buildPicker.hidden = false;
    els.buildPicker.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'picker-head';
    head.innerHTML = '<span>ここに建てる</span>';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-paper';
    close.textContent = 'とじる';
    close.addEventListener('click', function () { openCellIndex = null; renderCastleView(); });
    head.appendChild(close);
    els.buildPicker.appendChild(head);
    Object.keys(C.BUILDING_DEFS).forEach(function (type) {
      const def = C.BUILDING_DEFS[type];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'build-option';
      b.disabled = !C.canPlaceBuilding(state, index, type);
      const note = def.max ? ' (' + C.countCastleBuildings(state, type) + '/' + def.max + ')' : '';
      b.innerHTML = '<span class="icon">' + def.icon + '</span><span class="name">' + def.name + note + '</span><span class="cost">資材 ' + def.cost + '</span>';
      b.addEventListener('click', function () { doPlaceBuilding(index, type); });
      els.buildPicker.appendChild(b);
    });
  }

  function doPlaceBuilding(index, type) {
    const was = C.isCastleComplete(state);
    const r = C.placeBuilding(state, index, type);
    if (r.ok) {
      state = r.state;
      openCellIndex = null;
      renderCastleView();
      saveSoon();
      if (!was && C.isCastleComplete(state)) showToast('🎉 天守が建った! お城の完成にゃ!', 3200);
    }
    return r.ok;
  }

  // ---------------------------------------------------------- 村

  function renderVillageView() {
    const unlocked = isUnlocked('village');
    els.villageLocked.hidden = unlocked;
    els.villageContent.hidden = !unlocked;
    if (!unlocked) { els.villageLocked.textContent = lockedMessage('village'); return; }
    updateVillageNumbers();
    lastPopFloor = Math.floor(state.village.population);
    updateVillageCats();
  }

  function updateVillageNumbers() {
    const cap = C.villageCapacity(state);
    els.materialCountVillage.textContent = '資材 ' + Math.floor(state.materials);
    els.popLabel.textContent = '村人猫 ' + Math.floor(state.village.population) + ' / ' + cap + ' 匹';
    els.popFill.style.width = Math.min(100, state.village.population / cap * 100) + '%';
    els.btnBuildHouse.textContent = '家を建てる (資材 ' + C.houseCost(state) + ')';
    els.btnBuildHouse.disabled = !C.canBuildHouse(state);
  }

  function updateVillageCats() {
    els.villageCats.innerHTML = '';
    const looks = ['cat-chatora', 'cat-gray', 'cat-kuro', 'cat-normal'];
    const count = Math.floor(state.village.population);
    const shown = Math.min(count, MAX_VILLAGE_ICONS);
    for (let i = 0; i < shown; i++) {
      const im = document.createElement('img');
      im.src = imgs[looks[i % looks.length]].src;
      im.alt = '';
      els.villageCats.appendChild(im);
    }
    if (count > shown) {
      const more = document.createElement('span');
      more.className = 'village-more';
      more.textContent = '+' + (count - shown) + ' 匹';
      els.villageCats.appendChild(more);
    }
  }

  function doBuildHouse() {
    const r = C.buildHouse(state);
    if (r.ok) { state = r.state; renderVillageView(); saveSoon(); }
    return r.ok;
  }

  // ---------------------------------------------------------- ボタン

  function press(btn) {
    btn.classList.add('pressed');
    setTimeout(function () { btn.classList.remove('pressed'); }, 90);
  }

  function doLure() { if (!battle) return false; const ok = C.lure(battle); if (ok) press(els.btnLure); return ok; }
  function doPunch() { if (!battle) return false; const ok = C.punch(battle); if (ok) { press(els.btnPunch); anim.lunge = 1; } return ok; }
  function doSpecial() { if (!battle) return false; return C.special(battle); }

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
        if (battle.phase === 'fight') C.stepBattle(battle, dt);
        // 知らせは戦の最中でなくても読む。最後の1匹をパンチで倒すと、
        // 勝ちの知らせは stepBattle の外で出る (読まないと勝利の札が出ずに止まる)
        handleEvents(battle);
      }
      draw(now, Math.min(dt, 0.1));
      updateFace(now);
      renderHud(false);
    }

    uiAcc += dt;
    if (uiAcc >= 0.25) {
      uiAcc = 0;
      if (currentTab === 'village' && isUnlocked('village')) {
        updateVillageNumbers();
        const f = Math.floor(state.village.population);
        if (f !== lastPopFloor) { lastPopFloor = f; updateVillageCats(); }
      }
      if (currentTab === 'vassals') updateRecruitButton();
      if (currentTab === 'castle' && isUnlocked('castle')) {
        els.materialCountCastle.textContent = '資材 ' + Math.floor(state.materials);
        if (openCellIndex !== null) renderBuildPicker(openCellIndex);
      }
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
    onDown(els.btnSpecial, doSpecial);
    els.btnRecruit.addEventListener('click', doRecruit);
    els.btnBuildHouse.addEventListener('click', doBuildHouse);
    Object.keys(tabEls).forEach(function (tab) {
      tabEls[tab].addEventListener('click', function () { switchTab(tab); });
    });

    document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
    window.addEventListener('pagehide', saveNow);
    setInterval(saveNow, 5000);
    if (window.ResizeObserver) new ResizeObserver(sizeField).observe(els.field);
    window.addEventListener('resize', sizeField);

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
      special: doSpecial,
      offer: function () { return pendingOffer; },
      acceptOffer: acceptOffer,
      face: function () { return face.shown; },
      fieldSize: function () { return Object.assign({}, fieldSize); },
      recruit: doRecruit,
      trainVassal: doTrainVassal,
      assignJob: doAssignJob,
      buildCastle: doPlaceBuilding,
      buildHouse: doBuildHouse,
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
