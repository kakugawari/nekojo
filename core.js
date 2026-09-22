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

  /** 修行タップ 1 回ぶんの手柄。まれに会心 (3倍) が出る。 */
  function trainingReward(rng) {
    const random = rng || Math.random;
    const base = 3 + Math.floor(random() * 4); // 3..6
    const crit = random() < 0.1;
    return { amount: crit ? base * 3 : base, crit: crit };
  }

  // ---------------------------------------------------------- 家臣

  const VASSAL_NAMES = ['トラ', 'コマ', 'ミケ', 'クロ', 'シロ', 'タマ', 'チャチャ', 'モモ', 'ハチ', 'ゴマ'];
  const VASSAL_MAX_LEVEL = 10;

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

  function recruitCost(state) {
    return 40 + state.vassals.length * 35;
  }

  function canRecruitVassal(state) {
    const rankIndex = rankIndexOf(state);
    return rankIndex >= VASSAL_UNLOCK_RANK &&
      state.vassals.length < vassalSlots(state) &&
      state.merit >= recruitCost(state);
  }

  function recruitVassal(state, rng) {
    if (!canRecruitVassal(state)) return { ok: false, state: state };
    const random = rng || Math.random;
    const cost = recruitCost(state);
    const name = VASSAL_NAMES[Math.floor(random() * VASSAL_NAMES.length)];
    const vassal = { id: state.nextVassalId, name: name, level: 1, job: 'training' };
    const next = Object.assign({}, state, {
      merit: state.merit - cost,
      nextVassalId: state.nextVassalId + 1,
      vassals: state.vassals.concat([vassal])
    });
    return { ok: true, state: next, vassal: vassal };
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

  function assignVassalJob(state, vassalId, job) {
    if (job !== 'training' && job !== 'labor') return { ok: false, state: state };
    const idx = state.vassals.findIndex(function (v) { return v.id === vassalId; });
    if (idx < 0) return { ok: false, state: state };
    const vassals = state.vassals.slice();
    vassals[idx] = Object.assign({}, vassals[idx], { job: job });
    return { ok: true, state: Object.assign({}, state, { vassals: vassals }) };
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
    out.vassals = Array.isArray(raw.vassals) ? raw.vassals.filter(function (v) {
      return v && typeof v.id === 'number' && typeof v.name === 'string';
    }).map(function (v) {
      return {
        id: v.id,
        name: v.name,
        level: Number.isInteger(v.level) ? Math.min(VASSAL_MAX_LEVEL, Math.max(1, v.level)) : 1,
        job: (v.job === 'labor') ? 'labor' : 'training'
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
    trainingReward: trainingReward,

    VASSAL_NAMES: VASSAL_NAMES,
    VASSAL_MAX_LEVEL: VASSAL_MAX_LEVEL,
    vassalSlotBase: vassalSlotBase,
    vassalSlots: vassalSlots,
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

    createInitialState: createInitialState,
    sanitizeState: sanitizeState,
    serialize: serialize,
    deserialize: deserialize
  };
});
