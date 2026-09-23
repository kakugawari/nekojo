/*!
 * core.js — ねこ城のロジック。DOM を触らないので node でテストできる。
 *
 * 村を出た子猫が、侍に仕えて手柄を立て、出世し、
 * 家臣を育て、自分の城と村を大きくしていく。
 *
 * ブラウザでは <script> で読み込むと window.Core になり、
 * node からは require() できる。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * 決まった順番で数を出す乱数 (mulberry32)。
   * 同じ seed からは必ず同じ並びになるので、テストで結果を固定できる。
   */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------- 出世の階段

  const RANKS = [
    { key: 'kodane', name: '村の子猫', threshold: 0, story: '生まれ育った村を飛び出した。' },
    { key: 'zori', name: '草履取り', threshold: 20, story: '侍の草履持ちに拾われた。' },
    { key: 'chugen', name: '中間', threshold: 60, story: '雑用係として認められた。' },
    { key: 'ashigaru', name: '足軽', threshold: 150, story: '槍を持たせてもらえた。仲間を持てるようになった。' },
    { key: 'samurai', name: '侍', threshold: 350, story: '名字帯刀を許された。' },
    { key: 'monogashira', name: '物頭', threshold: 700, story: '足軽をまとめる役になった。' },
    { key: 'karo', name: '家老', threshold: 1400, story: 'お殿様の相談役になった。' },
    { key: 'jodai', name: '城代', threshold: 2600, story: '城を預かる身になった。' },
    { key: 'joshu', name: '城主', threshold: 4500, story: '自分の城と土地を持った。城と村を大きくできる。' },
    { key: 'daimyo', name: '大名', threshold: 9000, story: '一国の主になった。' }
  ];

  const VASSAL_UNLOCK_RANK = 3; // 足軽
  const CASTLE_UNLOCK_RANK = 8; // 城主

  function rankIndexForMerit(merit) {
    let idx = 0;
    for (let i = 0; i < RANKS.length; i++) {
      if (merit >= RANKS[i].threshold) idx = i;
    }
    return idx;
  }

  /**
   * 出世は「稼いだ手柄の合計 (totalMerit)」で決まる。使って減っても下がらない。
   * state.merit は財布の中身 (家臣を雇ったり鍛えたりすると減る)。
   * この2つを同じ数字で扱うと、家臣を雇っただけで出世が下がって見える
   * (実際に踏んだ落とし穴: 手柄を使った直後にタブの鍵がまた掛かった)。
   */
  function rankIndexOf(state) {
    return rankIndexForMerit(state.totalMerit);
  }

  function rankOf(state) {
    return RANKS[rankIndexOf(state)];
  }

  function nextRankInfo(state) {
    const idx = rankIndexOf(state);
    const next = RANKS[idx + 1];
    if (!next) return null;
    return { rank: next, need: next.threshold - state.totalMerit, at: next.threshold };
  }

  function addMerit(state, amount) {
    const prevRankIndex = rankIndexOf(state);
    const merit = Math.max(0, state.merit + amount);
    const totalMerit = state.totalMerit + Math.max(0, amount);
    const rankIndex = rankIndexForMerit(totalMerit);
    return {
      state: Object.assign({}, state, { merit: merit, totalMerit: totalMerit }),
      prevRankIndex: prevRankIndex,
      rankIndex: rankIndex,
      rankedUp: rankIndex > prevRankIndex
    };
  }

  // ---------------------------------------------------------- 家臣

  const VASSAL_NAMES = ['トラ', 'コマ', 'ミケ', 'クロ', 'シロ', 'タマ', 'チャチャ', 'モモ', 'ハチ', 'ゴマ'];
  const VASSAL_MAX_LEVEL = 10;
  const VASSAL_LOOKS = ['cat-chatora', 'cat-kuro', 'cat-gray', 'cat-normal'];
  const VASSAL_JOBS = ['training', 'labor', 'battle'];
  const MAX_BATTLE_VASSALS = 2;

  function vassalSlotBase(rankIndex) {
    if (rankIndex < VASSAL_UNLOCK_RANK) return 0;
    if (rankIndex < 5) return 2;
    if (rankIndex < 6) return 3;
    if (rankIndex < 7) return 4;
    if (rankIndex < CASTLE_UNLOCK_RANK) return 6;
    return 8;
  }

  function countCastleBuildings(state, type) {
    return state.castle.cells.filter(function (c) { return c === type; }).length;
  }

  function vassalSlots(state) {
    const rankIndex = rankIndexOf(state);
    return vassalSlotBase(rankIndex) + countCastleBuildings(state, 'barracks') * 2;
  }

  function hasVassalSlot(state) {
    return rankIndexOf(state) >= VASSAL_UNLOCK_RANK && state.vassals.length < vassalSlots(state);
  }

  /** まだ誰も使っていない名前から選ぶ (全部使っていたら重なってよい) */
  function pickVassalName(state, random) {
    const used = state.vassals.map(function (v) { return v.name; });
    const free = VASSAL_NAMES.filter(function (n) { return used.indexOf(n) < 0; });
    const pool = free.length ? free : VASSAL_NAMES;
    return pool[Math.floor(random() * pool.length)];
  }

  function recruitCost(state) {
    return 40 + state.vassals.length * 35;
  }

  function canRecruitVassal(state) {
    return hasVassalSlot(state) && state.merit >= recruitCost(state);
  }

  function addVassal(state, name, look) {
    const vassal = { id: state.nextVassalId, name: name, level: 1, job: 'training', look: look };
    return {
      state: Object.assign({}, state, {
        nextVassalId: state.nextVassalId + 1,
        vassals: state.vassals.concat([vassal])
      }),
      vassal: vassal
    };
  }

  /** 村で仲間を募る (手柄を払う)。 */
  function recruitVassal(state, rng) {
    if (!canRecruitVassal(state)) return { ok: false, state: state };
    const random = rng || Math.random;
    const name = pickVassalName(state, random);
    const look = VASSAL_LOOKS[Math.floor(random() * VASSAL_LOOKS.length)];
    const r = addVassal(Object.assign({}, state, { merit: state.merit - recruitCost(state) }), name, look);
    return { ok: true, state: r.state, vassal: r.vassal };
  }

  /** 合戦のあと「仲間になりたそうにこちらを見ている」相手を迎える (ただ)。 */
  function acceptRecruitOffer(state, offer) {
    if (!offer || !hasVassalSlot(state)) return { ok: false, state: state };
    const r = addVassal(state, offer.name, offer.look);
    return { ok: true, state: r.state, vassal: r.vassal };
  }

  function trainVassalCost(vassal) {
    return 15 + vassal.level * 10;
  }

  function trainVassal(state, vassalId) {
    const idx = state.vassals.findIndex(function (v) { return v.id === vassalId; });
    if (idx < 0) return { ok: false, state: state };
    const vassal = state.vassals[idx];
    if (vassal.level >= VASSAL_MAX_LEVEL) return { ok: false, state: state };
    const cost = trainVassalCost(vassal);
    if (state.merit < cost) return { ok: false, state: state };
    const vassals = state.vassals.slice();
    vassals[idx] = Object.assign({}, vassal, { level: vassal.level + 1 });
    return { ok: true, state: Object.assign({}, state, { merit: state.merit - cost, vassals: vassals }) };
  }

  /** 役目: training (自主練で手柄) / labor (普請で資材) / battle (出陣。いっしょに戦う。2人まで) */
  function assignVassalJob(state, vassalId, job) {
    if (VASSAL_JOBS.indexOf(job) < 0) return { ok: false, state: state };
    const idx = state.vassals.findIndex(function (v) { return v.id === vassalId; });
    if (idx < 0) return { ok: false, state: state };
    if (job === 'battle' && state.vassals[idx].job !== 'battle') {
      const inBattle = state.vassals.filter(function (v) { return v.job === 'battle'; }).length;
      if (inBattle >= MAX_BATTLE_VASSALS) return { ok: false, state: state };
    }
    const vassals = state.vassals.slice();
    vassals[idx] = Object.assign({}, vassals[idx], { job: job });
    return { ok: true, state: Object.assign({}, state, { vassals: vassals }) };
  }

  // ---------------------------------------------------------- 合戦
  //
  // 横一列の戦い。自分は左 (x = PLAYER_X)、敵は右から歩いてくる。
  // 敵は近い順に STOP, STOP+GAP, ... の位置で止まって並ぶ。いちばん前の 1 匹だけが
  // 殴れる距離 (MELEE) に入るので、攻撃してくるのは一度に 1 匹 (こども向け)。
  //
  //   猫じゃらし: いちばん前の敵を引き寄せて夢中にする (その間は攻撃してこない)。
  //               敵が振りかぶった瞬間 (windup) に当てると「見切り」で長く夢中にできる。
  //   猫パンチ:   届く敵をたたく。夢中の敵には 2 倍。続けて当てるとコンボで上乗せ。
  //               届かなければ空振り (おっちょこちょい)。
  //   スペシャル: ゲージが 100 たまったら、画面の敵ぜんぶに猫じゃらしコンボ。
  //
  // 合戦の中身 (battle) は毎コマ書き換える入れ物。ゲームの state とは別に持ち、
  // 終わったら applyBattleResult で state に反映する。

  const FIELD_W = 400;
  const PLAYER_X = 70;
  const STOP = 58;
  const GAP = 36;
  const MELEE = 84;
  const SPAWN_X = FIELD_W + 30;
  const WINDUP = 0.6;
  const PUNCH_COOLDOWN = 0.32;
  const LURE_COOLDOWN = 4.2;
  const COMBO_WINDOW = 1.1;

  const ENEMY_KINDS = {
    nora: { name: '灰猫', look: 'cat-gray', hp: 1.0, atk: 1.0, speed: 46, interval: 1.9, charm: 1.0 },
    chatora: { name: '茶トラ侍', look: 'cat-chatora', hp: 1.3, atk: 1.1, speed: 40, interval: 1.8, charm: 1.0 },
    kuro: { name: '黒猫侍', look: 'cat-kuro', hp: 1.6, atk: 1.3, speed: 34, interval: 1.7, charm: 0.9 },
    boss: { name: '赤毛の大将', look: 'cat-red', hp: 2.6, atk: 1.5, speed: 28, interval: 1.6, charm: 0.6, boss: true }
  };

  function playerMaxHp(rankIndex) { return 60 + 12 * rankIndex; }
  function playerAtk(rankIndex) { return 6 + 3 * rankIndex; }
  function enemyReward(rankIndex, kind) {
    return Math.round(4 * Math.pow(1.5, rankIndex)) * (ENEMY_KINDS[kind].boss ? 3 : 1);
  }
  function allyDamage(level) { return 2 + 2 * level; }
  function allyInterval(level) { return Math.max(1.2, 2.6 - 0.12 * level); }
  function specialDamage(rankIndex) { return 22 + 10 * rankIndex; }

  function enemyPool(rankIndex) {
    if (rankIndex < 2) return ['nora'];
    if (rankIndex < 4) return ['nora', 'chatora'];
    if (rankIndex < 6) return ['nora', 'chatora', 'kuro'];
    return ['chatora', 'kuro'];
  }

  function createBattle(state, rng) {
    const random = rng || Math.random;
    const r = rankIndexOf(state);
    const count = Math.min(7, 3 + Math.floor(r / 2));
    const pool = enemyPool(r);
    const baseHp = 50 + 28 * r;
    const baseAtk = 5 + 1.8 * r;
    const enemies = [];
    for (let i = 0; i < count; i++) {
      const kind = (i === count - 1) ? 'boss' : pool[Math.floor(random() * pool.length)];
      const k = ENEMY_KINDS[kind];
      const hp = Math.round(baseHp * k.hp);
      enemies.push({
        id: i + 1, kind: kind, look: k.look, name: k.name, boss: !!k.boss,
        x: SPAWN_X, hp: hp, maxHp: hp, atk: Math.round(baseAtk * k.atk),
        speed: k.speed, interval: k.interval, cd: k.interval,
        windup: false, charm: 0, spawnAt: 0.8 + i * 2.1, spawned: false, alive: true,
        reward: enemyReward(r, kind)
      });
    }
    const allies = state.vassals.filter(function (v) { return v.job === 'battle'; }).slice(0, MAX_BATTLE_VASSALS)
      .map(function (v) { return { id: v.id, name: v.name, look: v.look, level: v.level, cd: allyInterval(v.level) }; });
    const maxHp = playerMaxHp(r);
    return {
      rank: r, t: 0, phase: 'fight', rng: random,
      player: { x: PLAYER_X, hp: maxHp, maxHp: maxHp, atk: playerAtk(r) },
      enemies: enemies, allies: allies,
      cd: { lure: 0, punch: 0 },
      special: 0, combo: 0, comboTimer: 0,
      merit: 0, bonus: 0, materials: 0, recruitOffer: null,
      events: []
    };
  }

  function liveEnemies(b) {
    return b.enemies.filter(function (e) { return e.alive && e.spawned; }).sort(function (a, c) { return a.x - c.x; });
  }

  function frontEnemy(b) {
    return liveEnemies(b)[0] || null;
  }

  function inReach(b, e) {
    return e.x - b.player.x <= MELEE;
  }

  function hurt(b, e, amount, source, crit) {
    e.hp = Math.max(0, e.hp - amount);
    b.events.push({ type: 'hit', id: e.id, amount: amount, source: source, crit: !!crit });
    if (e.hp <= 0 && e.alive) {
      e.alive = false;
      e.charm = 0;
      e.windup = false;
      b.merit += e.reward;
      b.events.push({ type: 'down', id: e.id, reward: e.reward, boss: e.boss });
    }
  }

  function addSpecial(b, n) {
    const before = b.special;
    b.special = Math.min(100, b.special + n);
    if (before < 100 && b.special >= 100) b.events.push({ type: 'specialReady' });
  }

  function finish(b) {
    if (b.phase !== 'fight') return;
    if (b.player.hp <= 0) {
      b.phase = 'lost';
      b.events.push({ type: 'lost' });
      return;
    }
    if (b.enemies.every(function (e) { return !e.alive; })) {
      b.phase = 'won';
      b.bonus = Math.round(b.merit * 0.3);
      b.materials = Math.round((b.merit + b.bonus) / 4);
      b.events.push({ type: 'won' });
    }
  }

  function stepBattle(b, dt) {
    if (!(dt > 0) || b.phase !== 'fight') return b;
    dt = Math.min(dt, 0.1); // 裏から戻った直後の大きな dt で敵が瞬間移動しないように

    b.t += dt;
    b.cd.lure = Math.max(0, b.cd.lure - dt);
    b.cd.punch = Math.max(0, b.cd.punch - dt);
    if (b.comboTimer > 0) {
      b.comboTimer -= dt;
      if (b.comboTimer <= 0) { b.comboTimer = 0; b.combo = 0; }
    }

    for (let i = 0; i < b.enemies.length; i++) {
      const e = b.enemies[i];
      if (!e.spawned && e.alive && b.t >= e.spawnAt) {
        e.spawned = true;
        b.events.push({ type: 'spawn', id: e.id });
      }
    }

    const line = liveEnemies(b);
    for (let k = 0; k < line.length; k++) {
      const e = line[k];
      if (e.charm > 0) {
        e.charm = Math.max(0, e.charm - dt);
        continue;
      }
      const stopX = PLAYER_X + STOP + k * GAP;
      if (e.x > stopX) e.x = Math.max(stopX, e.x - e.speed * dt);

      // いちばん前の敵は、一度前線に着いたら攻撃の溜めを止めない。
      // パンチでのけぞって届かなくなっても溜めは続き、戻った瞬間に殴ってくる
      // (のけぞるたびに溜めを戻すと、連打だけで永遠に攻撃されなくなった)
      if (k === 0 && (e.engaged || inReach(b, e))) {
        e.engaged = true;
        e.cd = Math.max(0, e.cd - dt);
        if (!e.windup && e.cd <= WINDUP) {
          e.windup = true;
          b.events.push({ type: 'windup', id: e.id });
        }
        if (e.cd <= 0 && inReach(b, e)) {
          e.windup = false;
          e.cd = e.interval;
          b.player.hp = Math.max(0, b.player.hp - e.atk);
          b.combo = 0;
          b.comboTimer = 0;
          b.events.push({ type: 'playerHit', id: e.id, amount: e.atk });
        }
      } else {
        e.windup = false;
        e.cd = Math.max(e.cd, WINDUP + 0.4);
      }
    }

    for (let i = 0; i < b.allies.length; i++) {
      const a = b.allies[i];
      a.cd -= dt;
      if (a.cd <= 0) {
        const target = frontEnemy(b);
        if (target) {
          a.cd = allyInterval(a.level);
          b.events.push({ type: 'allyAttack', ally: a.id, id: target.id });
          hurt(b, target, allyDamage(a.level), 'ally', false);
        } else {
          a.cd = 0.3;
        }
      }
    }

    finish(b);
    return b;
  }

  function lure(b) {
    if (b.phase !== 'fight' || b.cd.lure > 0) return false;
    const line = liveEnemies(b);
    const target = line.find(function (e) { return e.charm <= 0; }) || null;
    b.cd.lure = LURE_COOLDOWN;
    if (!target) {
      b.events.push({ type: 'lureMiss' });
      return true;
    }
    const perfect = target.windup;
    const charmMul = ENEMY_KINDS[target.kind].charm;
    target.charm = (perfect ? 3.0 : 1.8) * charmMul;
    target.windup = false;
    target.cd = target.interval;
    target.x = Math.max(PLAYER_X + STOP, target.x - 120);
    addSpecial(b, perfect ? 20 : 6);
    b.events.push({ type: 'lure', id: target.id, perfect: perfect });
    return true;
  }

  function punch(b) {
    if (b.phase !== 'fight' || b.cd.punch > 0) return false;
    b.cd.punch = PUNCH_COOLDOWN;
    const target = frontEnemy(b);
    if (!target || !inReach(b, target)) {
      b.combo = 0;
      b.comboTimer = 0;
      b.events.push({ type: 'miss' });
      return true;
    }
    const charmed = target.charm > 0;
    const amount = Math.round(b.player.atk * (charmed ? 2 : 1) * (1 + 0.1 * Math.min(b.combo, 5)));
    b.combo += 1;
    b.comboTimer = COMBO_WINDOW;
    if (!charmed) target.x += 10; // 軽くのけぞる
    addSpecial(b, charmed ? 13 : 7);
    hurt(b, target, amount, 'punch', charmed);
    finish(b);
    return true;
  }

  function special(b) {
    if (b.phase !== 'fight' || b.special < 100) return false;
    b.special = 0;
    const amount = specialDamage(b.rank);
    b.events.push({ type: 'special', amount: amount });
    liveEnemies(b).forEach(function (e) {
      e.windup = false;
      e.charm = Math.max(e.charm, 1.2);
      hurt(b, e, amount, 'special', true);
    });
    finish(b);
    return true;
  }

  /** 勝ったとき、倒した相手が仲間になりたがるか。枠が空いていれば半分の確率で。 */
  function rollRecruitOffer(state, b) {
    if (b.phase !== 'won' || !hasVassalSlot(state)) return null;
    const random = b.rng || Math.random;
    if (random() >= 0.5) return null;
    const pool = b.enemies.filter(function (e) { return !e.boss; });
    const e = pool[Math.floor(random() * pool.length)] || b.enemies[0];
    return { name: pickVassalName(state, random), look: e.look, from: e.name };
  }

  /** 合戦の結果を state に反映する。勝てば手柄・資材、負けても出世は下がらない。 */
  function applyBattleResult(state, b) {
    if (b.phase === 'won') {
      const r = addMerit(state, b.merit + b.bonus);
      r.state = Object.assign({}, r.state, {
        materials: r.state.materials + b.materials,
        battlesWon: (state.battlesWon || 0) + 1
      });
      return r;
    }
    const idx = rankIndexOf(state);
    return { state: state, prevRankIndex: idx, rankIndex: idx, rankedUp: false };
  }

  // ---------------------------------------------------------- 村

  function villageCapacity(state) {
    return 10 + state.village.houses * 8;
  }

  function houseCost(state) {
    return 30 + state.village.houses * 20;
  }

  function canBuildHouse(state) {
    return rankIndexOf(state) >= CASTLE_UNLOCK_RANK && state.materials >= houseCost(state);
  }

  function buildHouse(state) {
    if (!canBuildHouse(state)) return { ok: false, state: state };
    const cost = houseCost(state);
    return {
      ok: true,
      state: Object.assign({}, state, {
        materials: state.materials - cost,
        village: Object.assign({}, state.village, { houses: state.village.houses + 1 })
      })
    };
  }

  // ---------------------------------------------------------- 城

  const CASTLE_SIZE = 16;
  const BUILDING_DEFS = {
    keep: { name: '天守', cost: 300, max: 1, icon: '🏯' },
    storehouse: { name: '蔵', cost: 80, max: 4, icon: '📦' },
    barracks: { name: '長屋', cost: 60, max: 4, icon: '🛖' },
    well: { name: '井戸', cost: 20, max: 2, icon: '⛲' },
    wall: { name: '塀', cost: 10, max: null, icon: '🧱' }
  };

  function canPlaceBuilding(state, cellIndex, type) {
    const def = BUILDING_DEFS[type];
    if (!def) return false;
    if (rankIndexOf(state) < CASTLE_UNLOCK_RANK) return false;
    if (cellIndex < 0 || cellIndex >= state.castle.cells.length) return false;
    if (state.castle.cells[cellIndex] !== null) return false;
    if (def.max !== null && countCastleBuildings(state, type) >= def.max) return false;
    if (state.materials < def.cost) return false;
    return true;
  }

  function placeBuilding(state, cellIndex, type) {
    if (!canPlaceBuilding(state, cellIndex, type)) return { ok: false, state: state };
    const def = BUILDING_DEFS[type];
    const cells = state.castle.cells.slice();
    cells[cellIndex] = type;
    return {
      ok: true,
      state: Object.assign({}, state, {
        materials: state.materials - def.cost,
        castle: Object.assign({}, state.castle, { cells: cells })
      })
    };
  }

  function isCastleComplete(state) {
    return countCastleBuildings(state, 'keep') >= 1;
  }

  // ---------------------------------------------------------- 時の流れ (放置成長)

  function tick(state, dt) {
    if (!(dt > 0)) return state; // dt が 0 以下なら何もしない (負の dt が来ても暴れない)

    const rankIndex = rankIndexOf(state);
    const storehouseBonus = 1 + countCastleBuildings(state, 'storehouse') * 0.5;

    let materialGain = 0;
    let meritGain = 0;
    for (let i = 0; i < state.vassals.length; i++) {
      const v = state.vassals[i];
      if (v.job === 'labor') materialGain += v.level * 0.5;
      else if (v.job === 'training') meritGain += v.level * 0.4;
    }

    let village = state.village;
    if (rankIndex >= CASTLE_UNLOCK_RANK) {
      const capacity = villageCapacity(state);
      const growthRate = Math.max(0.15, (capacity - state.village.population) * 0.12);
      const population = Math.min(capacity, state.village.population + growthRate * dt);
      materialGain += population * 0.02;
      village = Object.assign({}, state.village, { population: population });
    }

    return Object.assign({}, state, {
      merit: state.merit + meritGain * dt,
      totalMerit: state.totalMerit + meritGain * dt,
      materials: state.materials + materialGain * storehouseBonus * dt,
      village: village
    });
  }

  // ---------------------------------------------------------- 状態の作成・保存

  function createInitialState(seed) {
    return {
      seed: (seed >>> 0) || 1,
      merit: 0,
      totalMerit: 0,
      materials: 0,
      nextVassalId: 1,
      vassals: [],
      battlesWon: 0,
      storySeen: false,
      village: { houses: 0, population: 0 },
      castle: { cells: new Array(CASTLE_SIZE).fill(null) }
    };
  }

  /** 保存データが壊れていたり古かったりしても、足りない所は初期値で補う。 */
  function sanitizeState(raw) {
    const base = createInitialState((raw && raw.seed) || 1);
    if (!raw || typeof raw !== 'object') return base;

    const out = Object.assign({}, base, raw);
    out.merit = Number.isFinite(raw.merit) ? Math.max(0, raw.merit) : base.merit;
    // 古い保存に totalMerit が無ければ、今の手柄より低くはしない (出世が下がって見えないように)
    out.totalMerit = Number.isFinite(raw.totalMerit) ? Math.max(0, raw.totalMerit) : Math.max(base.totalMerit, out.merit);
    out.materials = Number.isFinite(raw.materials) ? Math.max(0, raw.materials) : base.materials;
    out.nextVassalId = Number.isInteger(raw.nextVassalId) ? raw.nextVassalId : base.nextVassalId;
    out.battlesWon = Number.isInteger(raw.battlesWon) ? Math.max(0, raw.battlesWon) : base.battlesWon;
    out.storySeen = raw.storySeen === true;
    out.vassals = Array.isArray(raw.vassals) ? raw.vassals.filter(function (v) {
      return v && typeof v.id === 'number' && typeof v.name === 'string';
    }).map(function (v) {
      return {
        id: v.id,
        name: v.name,
        level: Number.isInteger(v.level) ? Math.min(VASSAL_MAX_LEVEL, Math.max(1, v.level)) : 1,
        job: VASSAL_JOBS.indexOf(v.job) >= 0 ? v.job : 'training',
        look: VASSAL_LOOKS.indexOf(v.look) >= 0 ? v.look : VASSAL_LOOKS[v.id % VASSAL_LOOKS.length]
      };
    }) : base.vassals;
    out.village = {
      houses: (raw.village && Number.isInteger(raw.village.houses)) ? Math.max(0, raw.village.houses) : base.village.houses,
      population: (raw.village && Number.isFinite(raw.village.population)) ? Math.max(0, raw.village.population) : base.village.population
    };
    const cells = new Array(CASTLE_SIZE).fill(null);
    if (raw.castle && Array.isArray(raw.castle.cells)) {
      for (let i = 0; i < CASTLE_SIZE; i++) {
        const c = raw.castle.cells[i];
        if (typeof c === 'string' && BUILDING_DEFS[c]) cells[i] = c;
      }
    }
    out.castle = { cells: cells };
    return out;
  }

  function serialize(state) {
    return JSON.stringify(state);
  }

  function deserialize(json) {
    try {
      return sanitizeState(JSON.parse(json));
    } catch (e) {
      return createInitialState(1);
    }
  }

  return {
    mulberry32: mulberry32,

    RANKS: RANKS,
    VASSAL_UNLOCK_RANK: VASSAL_UNLOCK_RANK,
    CASTLE_UNLOCK_RANK: CASTLE_UNLOCK_RANK,
    rankIndexForMerit: rankIndexForMerit,
    rankIndexOf: rankIndexOf,
    rankOf: rankOf,
    nextRankInfo: nextRankInfo,
    addMerit: addMerit,

    VASSAL_NAMES: VASSAL_NAMES,
    VASSAL_MAX_LEVEL: VASSAL_MAX_LEVEL,
    vassalSlotBase: vassalSlotBase,
    vassalSlots: vassalSlots,
    hasVassalSlot: hasVassalSlot,
    VASSAL_LOOKS: VASSAL_LOOKS,
    MAX_BATTLE_VASSALS: MAX_BATTLE_VASSALS,
    acceptRecruitOffer: acceptRecruitOffer,
    recruitCost: recruitCost,
    canRecruitVassal: canRecruitVassal,
    recruitVassal: recruitVassal,
    trainVassalCost: trainVassalCost,
    trainVassal: trainVassal,
    assignVassalJob: assignVassalJob,

    villageCapacity: villageCapacity,
    houseCost: houseCost,
    canBuildHouse: canBuildHouse,
    buildHouse: buildHouse,

    CASTLE_SIZE: CASTLE_SIZE,
    BUILDING_DEFS: BUILDING_DEFS,
    countCastleBuildings: countCastleBuildings,
    canPlaceBuilding: canPlaceBuilding,
    placeBuilding: placeBuilding,
    isCastleComplete: isCastleComplete,

    tick: tick,

    FIELD_W: FIELD_W,
    PLAYER_X: PLAYER_X,
    STOP: STOP,
    GAP: GAP,
    MELEE: MELEE,
    WINDUP: WINDUP,
    LURE_COOLDOWN: LURE_COOLDOWN,
    PUNCH_COOLDOWN: PUNCH_COOLDOWN,
    ENEMY_KINDS: ENEMY_KINDS,
    playerMaxHp: playerMaxHp,
    playerAtk: playerAtk,
    enemyReward: enemyReward,
    specialDamage: specialDamage,
    createBattle: createBattle,
    stepBattle: stepBattle,
    frontEnemy: frontEnemy,
    inReach: inReach,
    lure: lure,
    punch: punch,
    special: special,
    rollRecruitOffer: rollRecruitOffer,
    applyBattleResult: applyBattleResult,

    createInitialState: createInitialState,
    sanitizeState: sanitizeState,
    serialize: serialize,
    deserialize: deserialize
  };
});
