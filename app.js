/*!
 * app.js — 画面まわり。操作と描画はここに書く。ロジックは core.js。
 */
(function () {
  'use strict';

  const C = window.Core;
  const SAVE_KEY = 'nekojo-save-v1';
  const OFFLINE_CAP_SECONDS = 8 * 60 * 60; // るすの間に育つのはここまで
  const UI_REFRESH_INTERVAL = 0.15; // 秒。数字の更新はここまで細かくすれば十分
  const MAX_VILLAGE_ICONS = 60;

  const FUR_COLORS = ['#e8a33d', '#8a8a8a', '#f2e6c9', '#6b4a37', '#c97b63', '#d9c15a'];

  const els = {
    rankBadge: document.getElementById('rankBadge'),
    meritBadge: document.getElementById('meritBadge'),

    lordLine: document.getElementById('lordLine'),
    progressLabel: document.getElementById('progressLabel'),
    progressFill: document.getElementById('progressFill'),
    trainingField: document.getElementById('trainingField'),
    playerCat: document.getElementById('playerCat'),
    tapTarget: document.getElementById('tapTarget'),

    vassalSlotCount: document.getElementById('vassalSlotCount'),
    vassalsLocked: document.getElementById('vassalsLocked'),
    vassalsContent: document.getElementById('vassalsContent'),
    vassalList: document.getElementById('vassalList'),
    btnRecruit: document.getElementById('btnRecruit'),

    materialCountCastle: document.getElementById('materialCountCastle'),
    castleLocked: document.getElementById('castleLocked'),
    castleContent: document.getElementById('castleContent'),
    castleBanner: document.getElementById('castleBanner'),
    castleGrid: document.getElementById('castleGrid'),
    buildPicker: document.getElementById('buildPicker'),

    materialCountVillage: document.getElementById('materialCountVillage'),
    villageLocked: document.getElementById('villageLocked'),
    villageContent: document.getElementById('villageContent'),
    popLabel: document.getElementById('popLabel'),
    popFill: document.getElementById('popFill'),
    villageCats: document.getElementById('villageCats'),
    btnBuildHouse: document.getElementById('btnBuildHouse'),

    toast: document.getElementById('toast')
  };

  const views = {
    training: document.getElementById('view-training'),
    vassals: document.getElementById('view-vassals'),
    castle: document.getElementById('view-castle'),
    village: document.getElementById('view-village')
  };
  const tabEls = {
    training: document.getElementById('tab-training'),
    vassals: document.getElementById('tab-vassals'),
    castle: document.getElementById('tab-castle'),
    village: document.getElementById('tab-village')
  };
  const TAB_LABELS = { training: 'しゅぎょう', vassals: '家臣', castle: '城', village: '村' };

  let rng = C.mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  let state = load();
  let currentTab = 'training';
  let openCellIndex = null;
  let lastPopFloor = -1;
  let spawnTimer = null;
  let hideTimer = null;
  let toastTimer = null;
  let saveTimer = null;

  // ---------------------------------------------------------- 見た目 (2頭身のねこ)

  function catSVG(opts) {
    opts = opts || {};
    const fur = opts.fur || '#e8a33d';
    const band = opts.headband;
    const bandMarkup = band
      ? '<path d="M17 45 Q50 32 83 45" stroke="' + band + '" stroke-width="9" fill="none" stroke-linecap="round"/>' +
        '<circle cx="83" cy="45" r="5.5" fill="' + band + '"/>'
      : '';
    return (
      '<svg viewBox="0 0 100 150" aria-hidden="true">' +
        '<path d="M28 132 Q8 122 15 140 Q24 150 35 139 Z" fill="' + fur + '"/>' +
        '<path d="M72 132 Q92 122 85 140 Q76 150 65 139 Z" fill="' + fur + '"/>' +
        '<ellipse cx="50" cy="130" rx="23" ry="19" fill="' + fur + '"/>' +
        '<polygon points="21,29 31,3 42,31" fill="' + fur + '"/>' +
        '<polygon points="58,31 69,3 79,29" fill="' + fur + '"/>' +
        '<polygon points="25,25 31,11 37,26" fill="#ffd9b3"/>' +
        '<polygon points="63,26 69,11 75,25" fill="#ffd9b3"/>' +
        '<circle cx="50" cy="52" r="34" fill="' + fur + '"/>' +
        bandMarkup +
        '<ellipse cx="38.5" cy="53" rx="4.5" ry="6" fill="#2a2200"/>' +
        '<ellipse cx="61.5" cy="53" rx="4.5" ry="6" fill="#2a2200"/>' +
        '<polygon points="46,64 54,64 50,69" fill="#e08a8a"/>' +
        '<path d="M50 69 Q50 73 44 74" stroke="#5a4632" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
        '<path d="M50 69 Q50 73 56 74" stroke="#5a4632" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
      '</svg>'
    );
  }

  function headbandForRank(rankIndex) {
    if (rankIndex >= 7) return '#ffd166';
    if (rankIndex >= 5) return '#d64545';
    if (rankIndex >= 3) return '#ffffff';
    return null;
  }

  function furForId(id) {
    return FUR_COLORS[id % FUR_COLORS.length];
  }

  // ---------------------------------------------------------- 保存・読み込み

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

  // ---------------------------------------------------------- トースト

  function showToast(message, ms) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.hidden = false;
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, ms || 2600);
  }

  // ---------------------------------------------------------- タブ

  function isUnlocked(tab) {
    const rankIndex = C.rankIndexOf(state);
    if (tab === 'vassals') return rankIndex >= C.VASSAL_UNLOCK_RANK;
    if (tab === 'castle' || tab === 'village') return rankIndex >= C.CASTLE_UNLOCK_RANK;
    return true;
  }

  function renderTabs() {
    Object.keys(tabEls).forEach(function (tab) {
      const unlocked = isUnlocked(tab);
      const btn = tabEls[tab];
      btn.classList.toggle('active', tab === currentTab);
      btn.classList.toggle('locked', !unlocked);
      const label = btn.querySelector('.tab-label');
      label.textContent = unlocked ? TAB_LABELS[tab] : '🔒 ' + TAB_LABELS[tab];
    });
  }

  function lockedMessage(tab) {
    if (tab === 'vassals') {
      return '「' + C.RANKS[C.VASSAL_UNLOCK_RANK].name + '」になると、仲間を誘えるようになるよ。';
    }
    return '「' + C.RANKS[C.CASTLE_UNLOCK_RANK].name + '」になると、自分の城と村を持てるようになるよ。';
  }

  function switchTab(name) {
    if (!views[name]) return;
    currentTab = name;
    Object.keys(views).forEach(function (t) { views[t].hidden = (t !== name); });
    renderTabs();
    renderActiveView();
  }

  function renderActiveView() {
    if (currentTab === 'training') {
      renderTrainingStatic();
      renderTrainingProgress();
    } else if (currentTab === 'vassals') {
      renderVassalsView();
    } else if (currentTab === 'castle') {
      renderCastleView();
    } else if (currentTab === 'village') {
      renderVillageView();
    }
  }

  // ---------------------------------------------------------- しゅぎょう

  function renderTrainingStatic() {
    const rankIndex = C.rankIndexOf(state);
    const rank = C.RANKS[rankIndex];
    const next = C.nextRankInfo(state);
    els.lordLine.textContent = rank.story + (next ? '　つぎは「' + next.rank.name + '」' : '');
    els.playerCat.innerHTML = catSVG({ fur: '#e8a33d', headband: headbandForRank(rankIndex) });
  }

  function renderTrainingProgress() {
    const rankIndex = C.rankIndexOf(state);
    const rank = C.RANKS[rankIndex];
    const next = C.RANKS[rankIndex + 1];
    if (!next) {
      els.progressLabel.textContent = '出世の最高位!';
      els.progressFill.style.width = '100%';
      return;
    }
    const span = next.threshold - rank.threshold;
    const pct = span > 0 ? Math.max(0, Math.min(100, (state.merit - rank.threshold) / span * 100)) : 100;
    els.progressLabel.textContent = 'つぎの出世まで あと ' + Math.max(0, Math.ceil(next.threshold - state.merit));
    els.progressFill.style.width = pct + '%';
  }

  function applyMerit(amount) {
    const result = C.addMerit(state, amount);
    state = result.state;
    if (result.rankedUp) {
      onRankUp(result.prevRankIndex, result.rankIndex);
    } else {
      renderTrainingProgress();
    }
    refreshLiveUI();
    saveSoon();
  }

  function onRankUp(prevIndex, rankIndex) {
    const rank = C.RANKS[rankIndex];
    showToast('出世した! 「' + rank.name + '」になった。' + rank.story, 3800);
    renderTabs();
    renderActiveView();
  }

  function popMeritText(amount, crit, x, y) {
    const span = document.createElement('span');
    span.className = 'merit-pop';
    span.textContent = '+' + amount + (crit ? ' 会心!' : '');
    span.style.left = x + 'px';
    span.style.top = y + 'px';
    els.trainingField.appendChild(span);
    const anim = span.animate(
      [
        { transform: 'translate(-50%, 0)', opacity: 1 },
        { transform: 'translate(-50%, -36px)', opacity: 0 }
      ],
      { duration: 700, easing: 'ease-out' }
    );
    anim.onfinish = function () { span.remove(); };
  }

  function scheduleSpawn(delayMs) {
    clearTimeout(spawnTimer);
    spawnTimer = setTimeout(spawnTarget, delayMs);
  }

  function spawnTarget() {
    if (currentTab !== 'training' || document.hidden) { scheduleSpawn(300); return; }
    const field = els.trainingField;
    const w = field.clientWidth;
    const h = field.clientHeight;
    if (w < 1 || h < 1) { scheduleSpawn(200); return; } // レイアウト前の 0 サイズ対策

    const size = 64;
    const margin = 8;
    const maxX = Math.max(margin, w - size - margin);
    const maxY = Math.max(margin, h - size - margin - 130); // 下の自分のねこと被らない余白
    const x = margin + rng() * (maxX - margin);
    const y = margin + rng() * Math.max(0, maxY - margin);

    els.tapTarget.style.left = x + 'px';
    els.tapTarget.style.top = y + 'px';
    els.tapTarget.textContent = '🪙';
    els.tapTarget.hidden = false;
    els.tapTarget.animate(
      [{ transform: 'scale(0)' }, { transform: 'scale(1)' }],
      { duration: 160, easing: 'cubic-bezier(.34,1.56,.64,1)' }
    );

    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      els.tapTarget.hidden = true;
      scheduleSpawn(400 + rng() * 600);
    }, 1500);
  }

  function onTapTarget() {
    if (els.tapTarget.hidden) return;
    clearTimeout(hideTimer);
    const rect = els.tapTarget.getBoundingClientRect();
    const fieldRect = els.trainingField.getBoundingClientRect();
    const reward = C.trainingReward(rng);
    popMeritText(reward.amount, reward.crit, rect.left - fieldRect.left + rect.width / 2, rect.top - fieldRect.top);
    applyMerit(reward.amount);
    const anim = els.tapTarget.animate(
      [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0 }],
      { duration: 180 }
    );
    anim.onfinish = function () { els.tapTarget.hidden = true; };
    scheduleSpawn(300 + rng() * 500);
  }

  // ---------------------------------------------------------- 家臣

  function updateRecruitButtonState() {
    const rankIndex = C.rankIndexOf(state);
    if (rankIndex < C.VASSAL_UNLOCK_RANK) return;
    const cost = C.recruitCost(state);
    els.btnRecruit.textContent = '仲間を誘う (手柄 ' + cost + ')';
    els.btnRecruit.disabled = !C.canRecruitVassal(state);
  }

  function renderVassalsView() {
    const rankIndex = C.rankIndexOf(state);
    const unlocked = rankIndex >= C.VASSAL_UNLOCK_RANK;
    els.vassalsLocked.hidden = unlocked;
    els.vassalsContent.hidden = !unlocked;
    if (!unlocked) {
      els.vassalsLocked.textContent = lockedMessage('vassals');
      return;
    }

    els.vassalSlotCount.textContent = state.vassals.length + ' / ' + C.vassalSlots(state) + ' 人';
    els.vassalList.innerHTML = '';
    state.vassals.forEach(function (v) {
      const li = document.createElement('li');
      li.className = 'vassal-card';

      const mini = document.createElement('div');
      mini.className = 'mini-cat';
      mini.innerHTML = catSVG({ fur: furForId(v.id) });
      li.appendChild(mini);

      const info = document.createElement('div');
      info.className = 'vassal-info';
      const trainCost = C.trainVassalCost(v);
      info.innerHTML =
        '<div class="vassal-name">' + v.name + '</div>' +
        '<div class="vassal-level">Lv.' + v.level + (v.level >= C.VASSAL_MAX_LEVEL ? ' (最大)' : '') + '</div>';
      li.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'vassal-actions';

      const btnTrain = document.createElement('button');
      btnTrain.type = 'button';
      btnTrain.className = 'btn btn-job';
      btnTrain.textContent = '鍛える(' + trainCost + ')';
      btnTrain.disabled = v.level >= C.VASSAL_MAX_LEVEL || state.merit < trainCost;
      btnTrain.addEventListener('click', function () { doTrainVassal(v.id); });
      actions.appendChild(btnTrain);

      ['training', 'labor'].forEach(function (job) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-job' + (v.job === job ? ' active' : '');
        btn.textContent = job === 'training' ? '訓練' : '普請';
        btn.addEventListener('click', function () { doAssignJob(v.id, job); });
        actions.appendChild(btn);
      });

      li.appendChild(actions);
      els.vassalList.appendChild(li);
    });

    updateRecruitButtonState();
  }

  function doRecruit() {
    const r = C.recruitVassal(state, rng);
    if (r.ok) {
      state = r.state;
      renderVassalsView();
      refreshLiveUI();
      saveSoon();
    }
    return r.ok;
  }

  function doTrainVassal(id) {
    const r = C.trainVassal(state, id);
    if (r.ok) {
      state = r.state;
      renderVassalsView();
      refreshLiveUI();
      saveSoon();
    }
    return r.ok;
  }

  function doAssignJob(id, job) {
    const r = C.assignVassalJob(state, id, job);
    if (r.ok) {
      state = r.state;
      renderVassalsView();
      saveSoon();
    }
    return r.ok;
  }

  // ---------------------------------------------------------- 城

  function renderCastleView() {
    const rankIndex = C.rankIndexOf(state);
    const unlocked = rankIndex >= C.CASTLE_UNLOCK_RANK;
    els.castleLocked.hidden = unlocked;
    els.castleContent.hidden = !unlocked;
    if (!unlocked) {
      els.castleLocked.textContent = lockedMessage('castle');
      return;
    }

    els.castleBanner.hidden = !C.isCastleComplete(state);
    if (!els.castleBanner.hidden) els.castleBanner.textContent = '🎉 天守が建った! お城の完成!';

    els.castleGrid.innerHTML = '';
    for (let i = 0; i < state.castle.cells.length; i++) {
      const type = state.castle.cells[i];
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'castle-cell' + (type ? ' filled' : '');
      cell.textContent = type ? C.BUILDING_DEFS[type].icon : '＋';
      cell.setAttribute('aria-label', type ? C.BUILDING_DEFS[type].name : '空き地');
      cell.addEventListener('click', function () { onCastleCellClick(i); });
      els.castleGrid.appendChild(cell);
    }

    if (openCellIndex !== null) renderBuildPicker(openCellIndex);
    else els.buildPicker.hidden = true;
  }

  function onCastleCellClick(index) {
    const type = state.castle.cells[index];
    if (type) {
      showToast(C.BUILDING_DEFS[type].name + 'が建っている。', 1800);
      return;
    }
    openCellIndex = (openCellIndex === index) ? null : index;
    renderCastleView();
  }

  function renderBuildPicker(index) {
    els.buildPicker.hidden = false;
    els.buildPicker.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = '<strong>ここに建てる</strong>';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn';
    close.textContent = 'とじる';
    close.addEventListener('click', function () { openCellIndex = null; renderCastleView(); });
    head.appendChild(close);
    els.buildPicker.appendChild(head);

    Object.keys(C.BUILDING_DEFS).forEach(function (type) {
      const def = C.BUILDING_DEFS[type];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'build-option';
      btn.disabled = !C.canPlaceBuilding(state, index, type);
      const countNote = def.max ? '(' + C.countCastleBuildings(state, type) + '/' + def.max + ')' : '';
      btn.innerHTML =
        '<span class="icon">' + def.icon + '</span>' +
        '<span class="name">' + def.name + ' ' + countNote + '</span>' +
        '<span class="cost">資材 ' + def.cost + '</span>';
      btn.addEventListener('click', function () { doPlaceBuilding(index, type); });
      els.buildPicker.appendChild(btn);
    });
  }

  function doPlaceBuilding(index, type) {
    const wasComplete = C.isCastleComplete(state);
    const r = C.placeBuilding(state, index, type);
    if (r.ok) {
      state = r.state;
      openCellIndex = null;
      renderCastleView();
      refreshLiveUI();
      saveSoon();
      if (!wasComplete && C.isCastleComplete(state)) {
        showToast('🎉 天守が建った! お城の完成!', 3600);
      }
    }
    return r.ok;
  }

  // ---------------------------------------------------------- 村

  function updateVillageCats() {
    els.villageCats.innerHTML = '';
    const count = Math.floor(state.village.population);
    const shown = Math.min(count, MAX_VILLAGE_ICONS);
    for (let i = 0; i < shown; i++) {
      const div = document.createElement('div');
      div.className = 'mini-cat';
      div.innerHTML = catSVG({ fur: FUR_COLORS[i % FUR_COLORS.length] });
      els.villageCats.appendChild(div);
    }
    if (count > shown) {
      const more = document.createElement('span');
      more.className = 'village-more';
      more.textContent = '+' + (count - shown) + ' 匹';
      els.villageCats.appendChild(more);
    }
  }

  function updateBuildHouseButtonState() {
    const rankIndex = C.rankIndexOf(state);
    if (rankIndex < C.CASTLE_UNLOCK_RANK) return;
    els.btnBuildHouse.textContent = '家を建てる (資材 ' + C.houseCost(state) + ')';
    els.btnBuildHouse.disabled = !C.canBuildHouse(state);
  }

  function renderVillageView() {
    const rankIndex = C.rankIndexOf(state);
    const unlocked = rankIndex >= C.CASTLE_UNLOCK_RANK;
    els.villageLocked.hidden = unlocked;
    els.villageContent.hidden = !unlocked;
    if (!unlocked) {
      els.villageLocked.textContent = lockedMessage('village');
      return;
    }
    const cap = C.villageCapacity(state);
    els.popLabel.textContent = '村人猫 ' + Math.floor(state.village.population) + ' / ' + cap;
    els.popFill.style.width = Math.min(100, state.village.population / cap * 100) + '%';
    lastPopFloor = Math.floor(state.village.population);
    updateVillageCats();
    updateBuildHouseButtonState();
  }

  function doBuildHouse() {
    const r = C.buildHouse(state);
    if (r.ok) {
      state = r.state;
      renderVillageView();
      refreshLiveUI();
      saveSoon();
    }
    return r.ok;
  }

  // ---------------------------------------------------------- 毎フレームの更新

  function refreshLiveUI() {
    const rankIndex = C.rankIndexOf(state);
    els.rankBadge.textContent = C.RANKS[rankIndex].name;
    els.meritBadge.textContent = '手柄 ' + Math.floor(state.merit);
    const matText = '資材 ' + Math.floor(state.materials);
    els.materialCountCastle.textContent = matText;
    els.materialCountVillage.textContent = matText;
    renderTrainingProgress();

    if (rankIndex >= C.CASTLE_UNLOCK_RANK) {
      const cap = C.villageCapacity(state);
      els.popLabel.textContent = '村人猫 ' + Math.floor(state.village.population) + ' / ' + cap;
      els.popFill.style.width = Math.min(100, state.village.population / cap * 100) + '%';
      const floorPop = Math.floor(state.village.population);
      if (floorPop !== lastPopFloor && currentTab === 'village') {
        lastPopFloor = floorPop;
        updateVillageCats();
      }
    }

    if (currentTab === 'vassals') updateRecruitButtonState();
    if (currentTab === 'village') updateBuildHouseButtonState();
    if (currentTab === 'castle' && openCellIndex !== null) renderBuildPicker(openCellIndex);
  }

  function fullRender() {
    renderTabs();
    renderActiveView();
    refreshLiveUI();
  }

  // ---------------------------------------------------------- ループ

  let last = performance.now();
  let uiAcc = 0;

  function frame(now) {
    const dt = Math.max(0, Math.min((now - last) / 1000, OFFLINE_CAP_SECONDS));
    last = now;

    if (dt > 0) {
      const prevRankIndex = C.rankIndexOf(state);
      state = C.tick(state, dt);
      const rankIndex = C.rankIndexOf(state);
      if (rankIndex > prevRankIndex) onRankUp(prevRankIndex, rankIndex);
    }

    uiAcc += dt;
    if (uiAcc >= UI_REFRESH_INTERVAL) {
      uiAcc = 0;
      refreshLiveUI();
    }

    requestAnimationFrame(frame);
  }

  function main() {
    els.tapTarget.addEventListener('click', onTapTarget);
    els.btnRecruit.addEventListener('click', doRecruit);
    els.btnBuildHouse.addEventListener('click', doBuildHouse);

    Object.keys(tabEls).forEach(function (tab) {
      tabEls[tab].addEventListener('click', function () { switchTab(tab); });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) saveNow();
    });
    window.addEventListener('pagehide', saveNow);
    setInterval(saveNow, 5000);

    switchTab('training');
    scheduleSpawn(500);
    fullRender();
    requestAnimationFrame(frame);

    // 自動テストから中身をのぞく・操作するための入口
    window.__app = {
      state: function () { return state; },
      tab: function () { return currentTab; },
      setTab: switchTab,
      tapTargetVisible: function () { return !els.tapTarget.hidden; },
      forceSpawn: function () { clearTimeout(spawnTimer); clearTimeout(hideTimer); spawnTarget(); },
      tap: function () { onTapTarget(); },
      recruit: doRecruit,
      trainVassal: doTrainVassal,
      assignJob: doAssignJob,
      buildCastle: doPlaceBuilding,
      buildHouse: doBuildHouse,
      debugAddMerit: function (n) { applyMerit(n); },
      debugSetMaterials: function (n) {
        state = Object.assign({}, state, { materials: n });
        renderCastleView();
        renderVillageView();
        refreshLiveUI();
      },
      render: fullRender
    };
  }

  main();
})();
