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

  // ---------------------------------------------------------- 修行 (主人公を小判で鍛える)
  //
  // 敵の強さは段位で決まるので、出世しても相手も強くなる。修行は段位と関係なく主人公だけが強くなる。
  // 負けて持ち帰った小判で鍛えれば、挑み直すたびに少しずつ勝ちやすくなる。

  const HERO_PER = 0.15;           // 1 段で +15%
  const HERO_TRAIN = {
    hp: { name: '体力', icon: '❤️', per: HERO_PER },
    atk: { name: 'パンチ', icon: '👊', per: HERO_PER }
  };
  const HERO_TRAIN_MAX = 10;

  function heroLevel(state, key) {
    const h = state.hero || {};
    return Number.isInteger(h[key]) ? h[key] : 0;
  }
  /** 鍛えたぶんの倍率 (1 段で +15%) */
  function heroMul(state, key) {
    return 1 + HERO_TRAIN[key].per * heroLevel(state, key);
  }
  const HERO_COST_BASE = 10;
  const HERO_COST_STEP = 15;
  function heroTrainCost(state, key) {
    return HERO_COST_BASE + HERO_COST_STEP * heroLevel(state, key);
  }
  function canTrainHero(state, key) {
    return !!HERO_TRAIN[key] && heroLevel(state, key) < HERO_TRAIN_MAX && state.merit >= heroTrainCost(state, key);
  }
  /** 小判を払って 体力 (hp) か パンチ (atk) を 1 段上げる。出世 (経験値) は下がらない */
  function trainHero(state, key) {
    if (!canTrainHero(state, key)) return { ok: false, state: state };
    const hero = Object.assign({ hp: 0, atk: 0 }, state.hero);
    hero[key] = heroLevel(state, key) + 1;
    return { ok: true, state: Object.assign({}, state, { merit: state.merit - heroTrainCost(state, key), hero: hero }) };
  }

  // ---------------------------------------------------------- 家臣

  const VASSAL_NAMES = ['トラ', 'コマ', 'ミケ', 'クロ', 'シロ', 'タマ', 'チャチャ', 'モモ', 'ハチ', 'ゴマ'];
  const VASSAL_MAX_LEVEL = 10;
  const VASSAL_LOOKS = ['cat-chatora', 'cat-kuro', 'cat-gray', 'cat-normal'];
  const VASSAL_JOBS = ['training', 'labor', 'battle'];
  const MAX_BATTLE_VASSALS = 2;

  // 家臣の得意技。出陣しているときだけ効き、レベルが上がるほど強くなる (2 人とも出陣なら足し合わせ)
  const VASSAL_SKILLS = {
    jarashi: { name: 'じゃらし名人', icon: '🪶', text: '猫じゃらしで 夢中ゲージが たまりやすい' },
    punch: { name: 'パンチ名人', icon: '💥', text: '溜めパンチが 強くなる' },
    quick: { name: 'すばやい猫', icon: '💨', text: '溜めが 早くたまる (カウンターが得意)' },
    heal: { name: '癒やし猫', icon: '💚', text: '戦いの最中に 体力を回復してくれる' }
  };
  const SKILL_KEYS = ['jarashi', 'punch', 'quick', 'heal'];
  const HEAL_INTERVAL = 7;         // 癒やし猫が回復する間隔 (秒)
  /** 得意技の強さ。jarashi: ゲージのたまり方 / punch: 溜めパンチの威力 / quick: 溜めの速さ (倍) / heal: 1 回に戻す体力 (最大の割合) */
  function skillPower(key, level) {
    const L = Math.max(1, Math.min(VASSAL_MAX_LEVEL, level || 1));
    if (key === 'jarashi') return 1.2 + 0.04 * L;
    if (key === 'punch' || key === 'quick') return 1.15 + 0.035 * L;
    if (key === 'heal') return 0.02 + 0.004 * L;
    return 0;
  }
  /** 出陣している家臣の得意技を足し合わせる */
  function battleSkills(allies) {
    const out = { lure: 1, power: 1, speed: 1, heal: 0 };
    (allies || []).forEach(function (a) {
      const p = skillPower(a.skill, a.level);
      if (a.skill === 'jarashi') out.lure += p - 1;
      else if (a.skill === 'punch') out.power += p - 1;
      else if (a.skill === 'quick') out.speed += p - 1;
      else if (a.skill === 'heal') out.heal += p;
    });
    return out;
  }
  /** 倒した相手の種類から、仲間になったときの得意技を決める */
  function skillFromEnemy(kind, random) {
    if (kind === 'quick') return 'quick';
    if (kind === 'samurai') return 'punch';
    return random() < 0.5 ? 'jarashi' : 'heal';
  }

  function vassalSlotBase(rankIndex) {
    if (rankIndex < VASSAL_UNLOCK_RANK) return 0;
    if (rankIndex < 5) return 2;
    if (rankIndex < 6) return 3;
    if (rankIndex < 7) return 4;
    if (rankIndex < CASTLE_UNLOCK_RANK) return 6;
    return 8;
  }

  function vassalSlots(state) {
    return vassalSlotBase(rankIndexOf(state)) + townEffects(state).slots;
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

  function addVassal(state, name, look, skill) {
    const vassal = { id: state.nextVassalId, name: name, level: 1, job: 'training', look: look,
      skill: VASSAL_SKILLS[skill] ? skill : SKILL_KEYS[state.nextVassalId % SKILL_KEYS.length] };
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
    const skill = SKILL_KEYS[Math.floor(random() * SKILL_KEYS.length)];
    const r = addVassal(Object.assign({}, state, { merit: state.merit - recruitCost(state) }), name, look, skill);
    return { ok: true, state: r.state, vassal: r.vassal };
  }

  /** 合戦のあと「仲間になりたそうにこちらを見ている」相手を迎える (ただ)。 */
  function acceptRecruitOffer(state, offer) {
    if (!offer || !hasVassalSlot(state)) return { ok: false, state: state };
    const r = addVassal(state, offer.name, offer.look, offer.skill);
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
  // 1 対 1 で、敵が 1 匹ずつ出てくる (最後は大きなボス猫)。
  //
  //   猫じゃらし: 敵を夢中にする (夢中の間は攻撃してこない)。当たるたびに肉球ゲージが 1 たまる (5 で満タン)。
  //               満タンになると、それ以上振っても夢中は延びない (振り続けて安全、にしない)。
  //               敵が「!」と振りかぶった瞬間に当てると「見切り」(ゲージ +2)。
  //   猫パンチ:   夢中の敵には肉球ゲージの数だけ大きく効く。満タンなら「猫じゃらしコンボ」。
  //               夢中の敵が羽に飛びついた高いところで当てると「会心の猫パンチ」。
  //               殴られた敵はしばらく警戒して羽に引っかからない。次の振りかぶりを見切るのが腕の見せどころ。
  //   アイテム:   魚 = 体力回復 / またたび = 敵をしばらく夢中にして、ゲージ +2。
  //
  // 敵のタイプ:
  //   のら猫         すぐ夢中になる。最初の敵
  //   すばしっこい猫 羽を見ている (👀) ときに振らないと、ひらりとかわす
  //   ねこ侍         夢中でないときに殴ると受け流して反撃。攻撃のあとの「スキ」に殴ると会心
  //   大きなボス猫   3 回振ってやっと夢中になる。夢中でないときはパンチが半分しか効かない
  //
  // 合戦の中身 (battle) は毎コマ書き換える入れ物。終わったら applyBattleResult で state に反映する。

  const SCENE_W = 400;
  const PLAYER_X = 110;
  const ENEMY_X = 270;
  const ENTER_X = SCENE_W + 40;
  const ENTER_TIME = 1.2;
  const DOWN_TIME = 1.3;
  const WINDUP = 0.6;              // 攻撃の予告 (頭の上に赤い「!」)。覚えていれば、この間に溜めパンチを離すとカウンター
  const RECOVER = 0.6;             // 敵が攻撃したあとの戻り
  const LURE_COOLDOWN = 0.45;
  const LURE_MISS_COOLDOWN = 1.2;  // 効きの小さかった猫じゃらしは、次に振れるまで長い (連打で押し切れないように)
  const PUNCH_COOLDOWN = 0.4;
  // 夢中ゲージ: 猫じゃらしでたまり、MAX で敵は動けなくなる。振るのをやめると少しずつ減る
  const MUCHU_MAX = 100;
  const MUCHU_CHASE = 50;          // ここまでたまると羽を追いかけていて、攻撃してこない
  const MUCHU_HOLD = 1.0;          // 振るのをやめてから、減りはじめるまで
  const MUCHU_DECAY = 30;          // 1 秒に減る量
  const WEAK_LURE = 0.25;          // 警戒中 (頭の上に「!」) の猫じゃらしの効き
  const WARY = 1.8;                // 殴られた・夢中が解けた敵は、しばらく警戒する
  const LOOK_PERIOD = 1.8;
  const LOOK_ALERT = 0.9;          // すばしっこい猫がこちらを見ている (警戒している) 長さ
  // 溜めパンチ: 押している長さで 通常 → 強 → 会心。夢中 MAX の敵が相手だと 2 倍の速さで溜まる
  const CHARGE_LEVELS = [0, 0.8, 1.5];
  const CHARGE_POWER = [1, 2, 3.5];
  const MAX_MUL = 3;               // 夢中 MAX の敵に当てたとき
  const COUNTER_MUL = 2.5;         // カウンター (攻撃の予告にパンチを当てる)
  const OPEN_MUL = 2.5;            // ねこ侍の攻撃のあとのスキ
  const COUNTER_RANK = 3;          // 足軽になるとカウンターを覚える
  // 誘導: 大きなボス猫が突進してくる。予告 (赤い「!!」) の間に猫じゃらしを振ると、羽を追って樽の山へ突っ込み、目を回す
  const YUDO_RANK = 4;             // 侍になると「誘導」を覚える (それまでボス猫は突進してこない)
  const RUSH_WARN = 1.0;           // 突進の予告の長さ
  const RUSH_TIME = 0.45;          // 突っ込んでいる長さ
  const RUSH_BACK = 0.6;           // 主人公に当たったあと、元の位置へ戻る長さ
  const RUSH_MUL = 1.6;            // 突進が当たったときの痛さ (ふつうの攻撃の何倍か)
  const CRASH_STUN = 3.0;          // 樽にぶつかって目を回している長さ (夢中 MAX と同じく動けない)
  const CRASH_DMG = 0.12;          // ぶつかったボス猫が受ける傷 (最大体力の割合)
  const OBSTACLE_X = 28;           // 樽の山の位置 (主人公の左うしろ)
  const OBSTACLE_RESPAWN = 8;      // こわれた樽を運んでくるまで
  const KNOCK_TIME = [0.3, 0.55, 0.9];
  const KNOCK_DIST = [10, 45, 90];

  const ENEMY_KINDS = {
    nora: { name: 'のら猫', look: 'cat-chatora', hp: 1.0, atk: 1.0, interval: 2.0, lures: 2, maxTime: 2.6 },
    quick: { name: 'すばしっこい猫', look: 'cat-gray', hp: 0.8, atk: 0.9, interval: 1.5, lures: 3, maxTime: 2.0, glance: true },
    samurai: { name: 'ねこ侍', look: 'cat-kuro', hp: 1.3, atk: 1.3, interval: 1.8, lures: 3, maxTime: 1.8, parry: true, open: 1.0 },
    boss: { name: '大きなボス猫', look: 'cat-red', hp: 3.0, atk: 1.5, interval: 2.2, lures: 5, maxTime: 2.4, armor: 0.5, boss: true, rush: true }
  };
  const ITEM_KINDS = {
    fish: { name: '魚', effect: '体力を 40% 回復' },
    matatabi: { name: 'またたび', effect: '敵の夢中ゲージがすぐ MAX (4 秒)' }
  };

  function playerMaxHp(rankIndex) { return 60 + 12 * rankIndex; }
  function playerAtk(rankIndex) { return 6 + 3 * rankIndex; }
  /** 最後に出てくる大将は手柄 3 倍 (最初の戦の大将は、のら猫の親分) */
  function enemyReward(rankIndex, isLeader) {
    return Math.round(4 * Math.pow(1.5, rankIndex)) * (isLeader ? 3 : 1);
  }
  function allyDamage(level) { return 2 + 2 * level; }
  function allyInterval(level) { return Math.max(1.2, 2.6 - 0.12 * level); }
  /** 押していた長さ → 溜めの段 (0 通常 / 1 強 / 2 会心) */
  function chargeLevel(t) { return t >= CHARGE_LEVELS[2] ? 2 : (t >= CHARGE_LEVELS[1] ? 1 : 0); }
  function canCounter(b) { return b.rank >= COUNTER_RANK; }
  function canYudo(b) { return b.rank >= YUDO_RANK; }
  /** 突進の途中 (予告・突っ込み・戻り)。吹っ飛ばしても止まらない */
  function isRushing(e) { return e.state === 'rushWarn' || e.state === 'rush' || e.state === 'rushBack'; }

  function enemyPool(rankIndex) {
    if (rankIndex < 1) return ['nora'];
    if (rankIndex < 3) return ['nora', 'quick'];
    if (rankIndex < 5) return ['nora', 'quick', 'samurai'];
    return ['quick', 'samurai'];
  }

  function battleSize(rankIndex) {
    return Math.min(5, 3 + Math.floor(rankIndex / 3));
  }

  /**
   * 合戦を始める。plan (attackPlan) を渡すと国とりの合戦: 敵の強さは攻め込む県の大名で決まり、
   * 兵の比で敵の数と強さが変わる。最後に出てくるのはその県の大名。
   * こちらの強さ (体力・パンチ・覚えた技) は、いつも自分の段位で決まる。
   */
  function createBattle(state, rng, plan) {
    const random = rng || Math.random;
    const r = rankIndexOf(state);
    const er = plan ? plan.level : r;          // 敵の強さを決める段
    const count = plan ? plan.count : battleSize(r);
    const mul = plan ? plan.strength : 1;
    const pool = enemyPool(er);
    const fx = townEffects(state);
    const baseHp = (50 + 28 * er) * mul;
    const baseAtk = (5 + 1.8 * er) * mul;
    const enemies = [];
    for (let i = 0; i < count; i++) {
      // いちばん最初の戦 (村の子猫) だけは大将を出さない。パンチだけでも勝てるように
      const kind = (i === count - 1 && er > 0) ? 'boss' : pool[Math.floor(random() * pool.length)];
      const k = ENEMY_KINDS[kind];
      const leader = i === count - 1;
      const hp = Math.round(baseHp * k.hp * (leader && !k.boss ? 1.6 : 1));
      let name = leader && !k.boss ? k.name + 'の親分' : k.name;
      if (plan && leader) name = plan.daimyo;
      enemies.push({
        id: i + 1, kind: kind, look: plan && leader ? plan.look : k.look, name: name, boss: leader, daimyo: !!(plan && leader),
        hp: hp, maxHp: hp, atk: Math.round(baseAtk * k.atk), interval: k.interval,
        state: 'wait', timer: 0, cd: k.interval, age: 0, x: ENTER_X,
        muchu: 0, muchuIdle: 0, charm: 0, charmTime: 0, wary: 0, knockTime: 0, knockDist: 0, open: false,
        rushNext: true, lured: false, rushTo: null, dizzy: false,
        alive: true, reward: Math.round(enemyReward(Math.min(er, r), leader) * fx.meritMul)
      });
    }
    const allies = state.vassals.filter(function (v) { return v.job === 'battle'; }).slice(0, MAX_BATTLE_VASSALS)
      .map(function (v) { return { id: v.id, name: v.name, look: v.look, level: v.level, skill: v.skill, cd: allyInterval(v.level) }; });
    const maxHp = Math.round(playerMaxHp(r) * fx.hpMul * heroMul(state, 'hp'));
    const items = state.items || { fish: 0, matatabi: 0 };
    const b = {
      rank: r, t: 0, phase: 'fight', rng: random,
      player: { x: PLAYER_X, hp: maxHp, maxHp: maxHp, atk: Math.round(playerAtk(r) * fx.atkMul * heroMul(state, 'atk')) },
      enemies: enemies, current: 0, allies: allies,
      cd: { lure: 0, punch: 0 },
      charge: { on: false, t: 0 },
      skills: battleSkills(allies),
      // 樽の山 (誘導を覚えてから置く)。こわれても少しすると運んでくる
      obstacle: r >= YUDO_RANK ? { ok: true, respawn: 0 } : null,
      healCd: HEAL_INTERVAL,
      items: { fish: items.fish || 0, matatabi: items.matatabi || 0 },
      used: { fish: 0, matatabi: 0 },
      merit: 0, bonus: 0, materials: 0, loot: { fish: 0, matatabi: 0 },
      conquest: plan ? Object.assign({}, plan) : null,
      events: []
    };
    enter(b);
    return b;
  }

  function currentEnemy(b) {
    const e = b.enemies[b.current];
    return e && e.alive ? e : null;
  }

  function enter(b) {
    const e = b.enemies[b.current];
    if (!e) return;
    e.state = 'enter';
    e.timer = ENTER_TIME;
    e.x = ENTER_X;
    b.events.push({ type: 'enter', id: e.id, boss: e.boss });
  }

  /** 警戒している (頭の上に「!」。猫じゃらしが効きにくい) */
  function isAlert(e) {
    if (e.state === 'windup' || e.wary > 0) return true;
    if (ENEMY_KINDS[e.kind].glance && e.state === 'idle' && e.muchu < MUCHU_CHASE) return (e.age % LOOK_PERIOD) < LOOK_ALERT;
    return false;
  }
  /** 羽を追いかけていて、攻撃してこない */
  function isChasing(e) {
    return e.state === 'idle' && e.muchu >= MUCHU_CHASE && !isAlert(e);
  }
  /** 敵の頭の上のしるし: alert「!」/ attack 赤い「!」/ chase「♡」/ max 肉球 / none */
  function enemyMood(e) {
    if (!e || !e.alive || e.state === 'enter' || e.state === 'wait') return 'none';
    if (e.state === 'charmed') return 'max';
    if (e.state === 'rushWarn' || e.state === 'rush') return 'rush';
    if (e.state === 'windup') return 'attack';
    if (isAlert(e)) return 'alert';
    if (e.muchu > 0) return 'chase';
    return 'none';
  }

  function hurtEnemy(b, e, amount, source, extra) {
    e.hp = Math.max(0, e.hp - amount);
    b.events.push(Object.assign({ type: 'hit', id: e.id, amount: amount, source: source }, extra || {}));
    if (e.hp <= 0) {
      e.alive = false;
      e.state = 'down';
      e.timer = DOWN_TIME;
      e.muchu = 0;
      e.charm = 0;
      b.merit += e.reward;
      b.events.push({ type: 'down', id: e.id, reward: e.reward, boss: e.boss });
    }
  }

  function hurtPlayer(b, amount, id) {
    b.player.hp = Math.max(0, b.player.hp - amount);
    b.events.push({ type: 'playerHit', id: id, amount: amount });
    if (b.charge.on) {
      // 殴られると溜めが解ける (溜めている間も敵は待ってくれない)
      b.charge = { on: false, t: 0 };
      b.events.push({ type: 'chargeBroken' });
    }
  }

  function finish(b) {
    if (b.phase !== 'fight') return;
    if (b.player.hp <= 0) {
      b.phase = 'lost';
      b.charge = { on: false, t: 0 };
      b.events.push({ type: 'lost' });
      return;
    }
    if (b.enemies.every(function (e) { return !e.alive; })) {
      const last = b.enemies[b.enemies.length - 1];
      if (last.state === 'down' && last.timer > 0) return; // 倒れる様子を見せてから終わる
      b.phase = 'won';
      b.charge = { on: false, t: 0 };
      b.bonus = Math.round(b.merit * 0.3);
      b.materials = Math.round((b.merit + b.bonus) / 4);
      const random = b.rng || Math.random;
      b.loot = { fish: random() < 0.6 ? 1 : 0, matatabi: random() < 0.3 ? 1 : 0 };
      b.events.push({ type: 'won' });
    }
  }

  function stepBattle(b, dt) {
    if (!(dt > 0) || b.phase !== 'fight') return b;
    dt = Math.min(dt, 0.1); // 裏から戻った直後の大きな dt で一気に進まないように

    b.t += dt;
    b.cd.lure = Math.max(0, b.cd.lure - dt);
    b.cd.punch = Math.max(0, b.cd.punch - dt);

    const e = b.enemies[b.current];
    if (e) {
      e.age += dt;
      e.wary = Math.max(0, e.wary - dt);
      if (e.state !== 'charmed' && e.state !== 'down') {
        e.muchuIdle += dt;
        if (e.muchuIdle > MUCHU_HOLD) e.muchu = Math.max(0, e.muchu - MUCHU_DECAY * dt);
      }
      if (e.state === 'down') {
        e.timer -= dt;
        if (e.timer <= 0) {
          if (b.current < b.enemies.length - 1) { b.current++; enter(b); }
        }
      } else if (e.state === 'enter') {
        e.timer -= dt;
        e.x = ENEMY_X + (ENTER_X - ENEMY_X) * Math.max(0, e.timer / ENTER_TIME);
        if (e.timer <= 0) { e.state = 'idle'; e.x = ENEMY_X; e.cd = e.interval; }
      } else if (e.state === 'charmed') {
        // 夢中 MAX: 動けない。ゲージは残り時間に合わせて減っていく
        e.charm -= dt;
        e.muchu = MUCHU_MAX * Math.max(0, e.charm / e.charmTime);
        if (e.x !== ENEMY_X) {
          // 樽にぶつかったあとは、目を回しながら元の位置まで転がって戻る
          e.x += (ENEMY_X - e.x) * Math.min(1, dt * 2.5);
          if (Math.abs(e.x - ENEMY_X) < 1) e.x = ENEMY_X;
        }
        if (e.charm <= 0) {
          e.charm = 0;
          e.muchu = 0;
          e.dizzy = false;
          e.x = ENEMY_X;
          e.state = 'idle';
          e.cd = e.interval;
          e.wary = WARY;
          b.events.push({ type: 'bored', id: e.id }); // 飽きた
        }
      } else if (e.state === 'knock') {
        // 吹っ飛んで戻ってくる。その間も攻撃の溜めは進む (連続で吹っ飛ばして封じ込め、にならないように)
        e.timer -= dt;
        e.cd -= dt;
        e.x = ENEMY_X + e.knockDist * Math.sin(Math.PI * Math.max(0, e.timer) / e.knockTime * 0.5);
        if (e.timer <= 0) { e.state = 'idle'; e.x = ENEMY_X; }
      } else if (e.state === 'recover') {
        e.timer -= dt;
        if (e.timer <= 0) { e.state = 'idle'; e.open = false; }
      } else if (e.state === 'idle') {
        if (!isChasing(e)) e.cd -= dt;
        if (e.cd <= WINDUP) {
          if (ENEMY_KINDS[e.kind].rush && canYudo(b) && e.rushNext) {
            // 大きなボス猫: ふつうの攻撃と突進をかわりばんこに
            e.state = 'rushWarn';
            e.timer = RUSH_WARN;
            e.lured = false;
            e.rushNext = false;
            b.events.push({ type: 'rushWarn', id: e.id });
          } else {
            e.state = 'windup';
            e.timer = WINDUP;
            if (ENEMY_KINDS[e.kind].rush) e.rushNext = true;
            b.events.push({ type: 'windup', id: e.id });
          }
        }
      } else if (e.state === 'rushWarn') {
        e.timer -= dt;
        if (e.timer <= 0) {
          e.state = 'rush';
          e.timer = RUSH_TIME;
          e.rushTo = e.lured && b.obstacle && b.obstacle.ok ? 'obstacle' : 'hero';
          b.events.push({ type: 'rush', id: e.id, to: e.rushTo });
        }
      } else if (e.state === 'rush') {
        e.timer -= dt;
        const to = e.rushTo === 'obstacle' ? OBSTACLE_X : PLAYER_X + 40;
        e.x = ENEMY_X + (to - ENEMY_X) * Math.min(1, 1 - e.timer / RUSH_TIME);
        if (e.timer <= 0) {
          e.cd = e.interval;
          if (e.rushTo === 'obstacle') {
            // ドカーン: 樽がこわれ、ボス猫は目を回して動けない (夢中 MAX と同じく、当てると大ダメージ)
            b.obstacle.ok = false;
            b.obstacle.respawn = OBSTACLE_RESPAWN;
            b.events.push({ type: 'crash', id: e.id });
            hurtEnemy(b, e, Math.max(1, Math.round(e.maxHp * CRASH_DMG)), 'crash');
            if (e.alive) {
              toMax(e, CRASH_STUN);
              e.dizzy = true;
            }
          } else {
            hurtPlayer(b, Math.round(e.atk * RUSH_MUL), e.id);
            e.state = 'rushBack';
            e.timer = RUSH_BACK;
          }
        }
      } else if (e.state === 'rushBack') {
        e.timer -= dt;
        e.x += (ENEMY_X - e.x) * Math.min(1, dt / Math.max(0.05, e.timer + dt));
        if (e.timer <= 0) { e.state = 'idle'; e.x = ENEMY_X; }
      } else if (e.state === 'windup') {
        e.timer -= dt;
        if (e.timer <= 0) {
          hurtPlayer(b, e.atk, e.id);
          const k = ENEMY_KINDS[e.kind];
          e.state = 'recover';
          e.timer = k.open || RECOVER;
          e.cd = e.interval;
          e.open = !!k.open; // ねこ侍は攻撃のあとにスキができる
          if (e.open) b.events.push({ type: 'open', id: e.id });
        }
      }
    }

    // こわれた樽は、少しすると運んでくる
    if (b.obstacle && !b.obstacle.ok) {
      b.obstacle.respawn -= dt;
      if (b.obstacle.respawn <= 0) {
        b.obstacle.ok = true;
        b.events.push({ type: 'obstacleBack' });
      }
    }

    // 溜め。夢中 MAX の敵が相手なら 2 倍の速さ
    if (b.charge.on) {
      const before = chargeLevel(b.charge.t);
      const tgt = currentEnemy(b);
      b.charge.t += dt * (tgt && tgt.state === 'charmed' ? 2 : 1) * b.skills.speed;
      const lv = chargeLevel(b.charge.t);
      if (lv > before) b.events.push({ type: 'charge', level: lv });
    }

    // 癒やし猫: ときどき体力を戻してくれる
    if (b.skills.heal > 0) {
      b.healCd -= dt;
      if (b.healCd <= 0) {
        b.healCd = HEAL_INTERVAL;
        if (b.player.hp < b.player.maxHp) {
          const amount = Math.min(b.player.maxHp - b.player.hp, Math.max(1, Math.round(b.player.maxHp * b.skills.heal)));
          b.player.hp += amount;
          b.events.push({ type: 'skill', skill: 'heal', amount: amount });
        }
      }
    }

    // 出陣の家臣は、戦える敵がいれば少しずつ攻撃する (夢中は解けない)
    const target = currentEnemy(b);
    for (let i = 0; i < b.allies.length; i++) {
      const a = b.allies[i];
      a.cd -= dt;
      if (a.cd <= 0) {
        a.cd = allyInterval(a.level);
        if (target && target.state !== 'enter' && target.alive) {
          b.events.push({ type: 'allyAttack', ally: a.id, id: target.id });
          hurtEnemy(b, target, allyDamage(a.level), 'ally');
        }
      }
    }

    finish(b);
    return b;
  }

  /** 夢中 MAX にする (動けなくなる) */
  function toMax(e, seconds) {
    e.state = 'charmed';
    e.charm = e.charmTime = seconds;
    e.muchu = MUCHU_MAX;
    e.open = false;
    e.wary = 0;
  }

  function lure(b) {
    if (b.phase !== 'fight' || b.cd.lure > 0) return false;
    b.cd.lure = LURE_COOLDOWN;
    const e = currentEnemy(b);
    if (!e || e.state === 'enter' || e.state === 'down') {
      b.events.push({ type: 'lure', result: 'miss' });
      return true;
    }
    if (e.state === 'charmed') {
      b.events.push({ type: 'lure', result: 'full', id: e.id, muchu: e.muchu }); // もう MAX。延びない
      return true;
    }
    if (e.state === 'rushWarn' && b.obstacle && b.obstacle.ok) {
      // 誘導: 突進の予告の間に振ると、羽を追って樽の山へ突っ込む
      e.lured = true;
      b.events.push({ type: 'lure', result: 'yudo', id: e.id });
      return true;
    }
    if (isRushing(e)) {
      b.cd.lure = LURE_MISS_COOLDOWN; // 突っ込んでいる最中・樽が無いときは効かない
      b.events.push({ type: 'lure', result: 'weak', id: e.id });
      return true;
    }
    const k = ENEMY_KINDS[e.kind];
    const alert = isAlert(e);
    let gain = (MUCHU_MAX / k.lures + 1) * b.skills.lure;
    if (b.skills.lure > 1) b.events.push({ type: 'skill', skill: 'jarashi' });
    if (alert) {
      gain *= WEAK_LURE;          // こちらを見ている。効きが小さい
      b.cd.lure = LURE_MISS_COOLDOWN;
    }
    e.muchu = Math.min(MUCHU_MAX, e.muchu + gain);
    e.muchuIdle = 0;
    let result = alert ? 'weak' : 'charm';
    if (e.muchu >= MUCHU_MAX) {
      toMax(e, k.maxTime);
      result = 'max';
    }
    b.events.push({ type: 'lure', result: result, id: e.id, muchu: e.muchu });
    return true;
  }

  /** パンチを押しはじめる (溜めはじめ) */
  function punchPress(b) {
    if (b.phase !== 'fight' || b.cd.punch > 0 || b.charge.on) return false;
    b.charge = { on: true, t: 0 };
    b.events.push({ type: 'chargeStart' });
    if (b.skills.speed > 1) b.events.push({ type: 'skill', skill: 'quick' });
    return true;
  }

  /** パンチを離す。押していた長さで強さが決まる */
  function punchRelease(b) {
    if (!b.charge.on) return false;
    const level = chargeLevel(b.charge.t);
    b.charge = { on: false, t: 0 };
    if (b.phase !== 'fight') return false;
    strike(b, level);
    return true;
  }

  /** すぐ離すパンチ (通常) */
  function punch(b) {
    if (!punchPress(b)) return false;
    return punchRelease(b);
  }

  function knock(e, level) {
    e.state = 'knock';
    e.timer = e.knockTime = KNOCK_TIME[level];
    e.knockDist = KNOCK_DIST[level];
  }

  function strike(b, level) {
    b.cd.punch = PUNCH_COOLDOWN;
    const e = currentEnemy(b);
    if (!e || e.state === 'enter' || e.state === 'down') {
      b.events.push({ type: 'miss', level: level });
      return;
    }
    const k = ENEMY_KINDS[e.kind];
    const pow = b.player.atk * CHARGE_POWER[level] * (level >= 1 ? b.skills.power : 1);
    if (level >= 1 && b.skills.power > 1) b.events.push({ type: 'skill', skill: 'punch' });
    if (e.state === 'charmed') {
      // 夢中 MAX の敵に当てる: 大ダメージ。溜めていれば吹っ飛ぶ
      const dizzy = e.dizzy;
      e.charm = 0;
      e.muchu = 0;
      e.dizzy = false;
      e.x = ENEMY_X;
      e.wary = WARY;
      e.cd = e.interval;
      knock(e, level);
      hurtEnemy(b, e, Math.round(pow * MAX_MUL), 'punch', { level: level, max: true, dizzy: dizzy, crit: level === 2 });
    } else if (e.state === 'windup' && canCounter(b) && level >= 1) {
      // カウンター: 溜めておいたパンチを、攻撃の予告 (赤い「!」) に合わせて離す。攻撃を打ち消して会心。
      // すぐ離すパンチでは起きない (連打しているだけで全部の攻撃を打ち消せてしまうので)
      e.muchu = 0;
      e.wary = WARY;
      e.cd = e.interval;
      knock(e, Math.max(1, level));
      hurtEnemy(b, e, Math.round(pow * COUNTER_MUL), 'punch', { level: level, counter: true, crit: true });
    } else if (e.state === 'recover' && e.open) {
      e.open = false;
      e.wary = WARY;
      knock(e, level);
      hurtEnemy(b, e, Math.round(pow * OPEN_MUL), 'punch', { level: level, open: true, crit: true });
    } else if (k.parry) {
      // ねこ侍: 受け流して、すぐ反撃
      b.events.push({ type: 'parry', id: e.id, level: level });
      e.muchu = 0;
      hurtPlayer(b, Math.round(e.atk * 0.7), e.id);
    } else {
      // ふつうに殴る。溜めていれば吹っ飛ぶ (攻撃の溜めは止まらない)
      e.muchu = 0;
      e.wary = WARY;
      if (level > 0 && e.state !== 'windup' && !isRushing(e)) knock(e, level);
      hurtEnemy(b, e, Math.round(pow * (k.armor || 1)), 'punch', { level: level, armor: !!k.armor });
    }
    finish(b);
  }

  function useItem(b, kind) {
    if (b.phase !== 'fight' || !ITEM_KINDS[kind] || !(b.items[kind] > 0)) return false;
    const e = currentEnemy(b);
    if (kind === 'matatabi' && (!e || e.state === 'enter' || e.state === 'down')) return false;
    if (kind === 'fish' && b.player.hp >= b.player.maxHp) return false;
    b.items[kind]--;
    b.used[kind]++;
    if (kind === 'fish') {
      const heal = Math.round(b.player.maxHp * 0.4);
      b.player.hp = Math.min(b.player.maxHp, b.player.hp + heal);
      b.events.push({ type: 'item', item: kind, amount: heal });
    } else {
      toMax(e, 4);
      b.events.push({ type: 'item', item: kind, id: e.id });
    }
    return true;
  }

  function rollRecruitOffer(state, b) {
    if (b.phase !== 'won' || !hasVassalSlot(state)) return null;
    const random = b.rng || Math.random;
    if (random() >= 0.5) return null;
    const pool = b.enemies.filter(function (e) { return !e.boss; });
    const e = pool[Math.floor(random() * pool.length)] || b.enemies[0];
    return { name: pickVassalName(state, random), look: e.look, from: e.name, skill: skillFromEnemy(e.kind, random) };
  }

  /** 負け・退却で持ち帰る小判: 倒した敵のぶん + 戦っていた相手に与えた傷のぶん (その相手の手柄の半分まで) */
  function lossReward(b) {
    const e = b.enemies[b.current];
    const partial = e && e.alive ? Math.round(e.reward * 0.5 * (1 - e.hp / e.maxHp)) : 0;
    return b.merit + partial;
  }

  /**
   * 国とりの合戦の結果を国に反映する。
   * 勝ち: 攻め込んだ県が自分の国になり、生き残った兵がそこに入る。
   * 負け・退却: 連れて行った兵の半分が戻らない。そのかわり、倒した敵のぶん守りの兵も減る (挑み直すと楽になる)。
   * 合戦の最中に兵を動かしていても、元の国にいる数より多くは減らさない。
   */
  function applyConquest(state, b) {
    const c = b.conquest;
    if (!c || !hasRealm(state) || !isMine(state, c.from) || isMine(state, c.to)) return { state: state, conquest: null };
    const sent = Math.min(c.sent, troopsAt(state, c.from));
    const out = { to: c.to, from: c.from, sent: sent, captured: false, lost: 0, cut: 0, unified: false };
    if (b.phase === 'won') {
      const lost = Math.min(conquestLosses(Object.assign({}, c, { sent: Math.max(TROOP_UNIT, sent) })), Math.max(0, sent - TROOP_UNIT));
      out.captured = true;
      out.lost = lost;
      const next = withRealm(state, function (r) {
        r.troops[c.from - 1] -= sent;
        r.mine[c.to - 1] = true;
        r.troops[c.to - 1] = Math.max(TROOP_UNIT, sent - lost);
        if (!r.unified && r.mine.every(Boolean)) { r.unified = true; out.unified = true; }
      });
      return { state: next, conquest: out };
    }
    const downs = b.enemies.filter(function (e) { return !e.alive; }).length;
    out.lost = roundTroops(sent / 2);
    out.cut = Math.min(roundTroops(c.garrison * 0.5 * downs / b.enemies.length), Math.max(0, troopsAt(state, c.to) - TROOP_UNIT));
    const next = withRealm(state, function (r) {
      r.troops[c.from - 1] -= out.lost;
      r.troops[c.to - 1] -= out.cut;
    });
    return { state: next, conquest: out };
  }

  /** 合戦の結果を state に反映する。勝てば手柄・資材、負けても出世は下がらない。国とりなら国も */
  function applyBattleResult(state, b) {
    const res = applyBattleRewards(state, b);
    if (!b.conquest) return res;
    const c = applyConquest(res.state, b);
    res.state = c.state;
    res.conquest = c.conquest;
    return res;
  }

  function applyBattleRewards(state, b) {
    // 使ったアイテムは、勝っても負けても減る
    const items = {
      fish: Math.max(0, (state.items.fish || 0) - b.used.fish),
      matatabi: Math.max(0, (state.items.matatabi || 0) - b.used.matatabi)
    };
    if (b.phase === 'won') {
      const r = addMerit(state, b.merit + b.bonus);
      items.fish += b.loot.fish;
      items.matatabi += b.loot.matatabi;
      r.state = Object.assign({}, r.state, {
        materials: r.state.materials + b.materials,
        battlesWon: (state.battlesWon || 0) + 1,
        items: items
      });
      return r;
    }
    // 負け・退却: 倒した敵のぶんの小判 (と資材) は持ち帰る。勝ったときの上乗せと拾い物は無し。
    // 何も持ち帰れないと、挑み直しても強くなれず、同じ戦の繰り返しになる。持ち帰った小判で修行する。
    // 経験値 (出世) は入れない。敵の強さは段位で決まるので、勝たずに出世すると相手だけ強くなってしまう
    const idx = rankIndexOf(state);
    const got = lossReward(b);
    const changed = got > 0 || b.used.fish || b.used.matatabi;
    const next = changed ? Object.assign({}, state, {
      merit: state.merit + got,
      materials: state.materials + Math.round(got / 4),
      items: items
    }) : state;
    return { state: next, prevRankIndex: idx, rankIndex: idx, rankedUp: false };
  }

  // ---------------------------------------------------------- 城と村 (マスに建てる)
  //
  // 城と村は、それぞれ 6x6 のマス。1 マスに 1 つ建てる。建物ごとに建てられる場所 (zone) が決まっている。
  // 効果は townEffects にまとめ、家臣の枠・時の流れ・合戦の強さから読む。

  const MAP_SIZE = 6;
  const MAP_CELLS = MAP_SIZE * MAP_SIZE;
  const ZONES = ['castle', 'village'];

  const BUILDINGS = {
    // 城
    keep: { zone: 'castle', name: 'お城', img: 'b-castle', cost: 300, max: 1, big: true, effect: 'お城の完成! 合戦の手柄 +20%' },
    mansion: { zone: 'castle', name: '猫侍の屋敷', img: 'b-mansion', cost: 60, max: 4, effect: '家臣の枠 +2' },
    dojo: { zone: 'castle', name: '訓練場', img: 'b-dojo', cost: 80, max: 2, effect: '自主練の手柄 +50%' },
    armory: { zone: 'castle', name: '武器屋', img: 'b-armory', cost: 120, max: 2, effect: '猫パンチ +15%' },
    tower: { zone: 'castle', name: '見張り台', img: 'b-tower', cost: 50, max: 2, effect: '合戦の体力 +10%' },
    stable: { zone: 'castle', name: '厩舎', img: 'b-stable', cost: 70, max: 2, effect: '普請の資材 +25%' },
    stonewall: { zone: 'castle', name: '城の石垣', img: 'b-stonewall', cost: 10, max: null, deco: true },
    fence: { zone: 'castle', name: '柵', img: 'b-fence', cost: 8, max: null, deco: true },
    flags: { zone: 'castle', name: '旗', img: 'b-flags', cost: 5, max: null, deco: true },
    torch: { zone: 'castle', name: 'たいまつ', img: 'b-torch', cost: 5, max: null, deco: true },
    // 村
    house: { zone: 'village', name: '民家', img: 'b-house', cost: 30, costStep: 20, max: null, effect: '村人猫の上限 +8' },
    farm: { zone: 'village', name: '農場', img: 'b-farm', cost: 40, max: 4, effect: '村人の集める資材 +50%' },
    rice: { zone: 'village', name: '田んぼ', img: 'b-rice', cost: 30, max: 4, effect: '村人猫が早く増える +30%' },
    workshop: { zone: 'village', name: '工房', img: 'b-workshop', cost: 80, max: 4, effect: '資材 +50%' },
    shop: { zone: 'village', name: '商店', img: 'b-shop', cost: 90, max: 2, effect: '合戦の手柄 +10%' },
    onsen: { zone: 'village', name: '温泉', img: 'b-onsen', cost: 150, max: 1, effect: '合戦の体力 +20%' },
    well: { zone: 'village', name: '井戸', img: 'b-well', cost: 20, max: 2, effect: '村人猫の上限 +3' },
    sakura: { zone: 'village', name: '桜の木', img: 'b-sakura', cost: 25, max: null, deco: true },
    garden: { zone: 'village', name: '庭', img: 'b-garden', cost: 25, max: null, deco: true },
    bridge: { zone: 'village', name: '橋', img: 'b-bridge', cost: 20, max: null, deco: true },
    lantern: { zone: 'village', name: '石灯籠', img: 'b-lantern', cost: 8, max: null, deco: true },
    signboard: { zone: 'village', name: '看板', img: 'b-signboard', cost: 5, max: null, deco: true },
    barrels: { zone: 'village', name: '樽・箱', img: 'b-barrels', cost: 5, max: null, deco: true },
    cart: { zone: 'village', name: '荷車', img: 'b-cart', cost: 8, max: null, deco: true },
    straw: { zone: 'village', name: '藁の束', img: 'b-straw', cost: 3, max: null, deco: true },
    woodfence: { zone: 'village', name: '木の柵', img: 'b-woodfence', cost: 3, max: null, deco: true },
    nobori: { zone: 'village', name: 'のぼり', img: 'b-nobori', cost: 3, max: null, deco: true }
  };
  const DECO_EFFECT = 'にぎわい (村人猫が少し早く増える)';

  function isTownUnlocked(state) {
    return rankIndexOf(state) >= CASTLE_UNLOCK_RANK;
  }

  function countBuildings(state, type) {
    const def = BUILDINGS[type];
    if (!def) return 0;
    return state[def.zone].cells.filter(function (c) { return c === type; }).length;
  }

  function countDeco(state) {
    let n = 0;
    ZONES.forEach(function (z) {
      state[z].cells.forEach(function (c) { if (c && BUILDINGS[c].deco) n++; });
    });
    return n;
  }

  function buildingCost(state, type) {
    const def = BUILDINGS[type];
    return def.cost + (def.costStep || 0) * countBuildings(state, type);
  }

  /** 建てた物ぜんぶの効果をまとめる。掛け算のものは 1 が「効果なし」 */
  function townEffects(state) {
    const n = function (t) { return countBuildings(state, t); };
    return {
      slots: 2 * n('mansion'),
      trainMul: 1 + 0.5 * n('dojo'),
      laborMul: 1 + 0.25 * n('stable'),
      popMatMul: 1 + 0.5 * n('farm'),
      matMul: 1 + 0.5 * n('workshop'),
      growthMul: 1 + 0.3 * n('rice') + Math.min(0.5, 0.05 * countDeco(state)),
      atkMul: 1 + 0.15 * n('armory'),
      hpMul: 1 + 0.1 * n('tower') + 0.2 * n('onsen'),
      meritMul: 1 + 0.2 * n('keep') + 0.1 * n('shop')
    };
  }

  function canPlaceBuilding(state, zone, cellIndex, type) {
    const def = BUILDINGS[type];
    if (!def || def.zone !== zone || ZONES.indexOf(zone) < 0) return false;
    if (!isTownUnlocked(state)) return false;
    if (!(cellIndex >= 0 && cellIndex < MAP_CELLS)) return false;
    if (state[zone].cells[cellIndex] !== null) return false;
    if (def.max !== null && countBuildings(state, type) >= def.max) return false;
    return state.materials >= buildingCost(state, type);
  }

  function placeBuilding(state, zone, cellIndex, type) {
    if (!canPlaceBuilding(state, zone, cellIndex, type)) return { ok: false, state: state };
    const cost = buildingCost(state, type);
    const cells = state[zone].cells.slice();
    cells[cellIndex] = type;
    const next = Object.assign({}, state, { materials: state.materials - cost });
    next[zone] = Object.assign({}, state[zone], { cells: cells });
    return { ok: true, state: next, cost: cost };
  }

  /** 取り壊す。建てたときの元の値段の半分が戻る */
  function demolish(state, zone, cellIndex) {
    if (ZONES.indexOf(zone) < 0) return { ok: false, state: state };
    const type = state[zone].cells[cellIndex];
    if (!type) return { ok: false, state: state };
    const refund = Math.floor(BUILDINGS[type].cost / 2);
    const cells = state[zone].cells.slice();
    cells[cellIndex] = null;
    const next = Object.assign({}, state, { materials: state.materials + refund });
    next[zone] = Object.assign({}, state[zone], { cells: cells });
    let village = next.village;
    // 家を減らしたら、上限を超えた村人猫はよそへ移る
    if (zone === 'village') {
      const cap = villageCapacity(next);
      if (village.population > cap) next.village = Object.assign({}, village, { population: cap });
    }
    return { ok: true, state: next, refund: refund };
  }

  function villageCapacity(state) {
    return 10 + 8 * countBuildings(state, 'house') + 3 * countBuildings(state, 'well');
  }

  function isCastleComplete(state) {
    return countBuildings(state, 'keep') >= 1;
  }

  // ---------------------------------------------------------- 天下 (日本地図の国とり)
  //
  // 侍になると、お殿様から小さな国 (県) をひとつ任される。となりの県には、それぞれ猫の大名がいる。
  // 兵 (家来の猫) を 100 匹ずつ小判で買って国に置き、となりの県へ攻め込む。
  // 攻め込むと合戦になる。最後に出てくるのがその県の大名。勝てばその県が自分の国になる。
  // 兵の数は合戦の手ごたえに効く: 敵より多く連れて行くほど、出てくる敵が減り、弱くなる。
  // 47 の都道府県をすべて取ったら天下統一。
  //
  // 県の番号は JIS の都道府県コード (1 北海道 〜 47 沖縄)。形は japan-map.js (tools/build-japan.js で作る)。
  // 隣り合うかは、地図の形で境を持っているか。海をはさむ所は、橋や海峡でつながる道を足した。

  const REALM_UNLOCK_RANK = 4;     // 侍
  const TROOP_UNIT = 100;          // 兵は 100 匹ずつ
  const TROOP_COST = 50;           // 100 匹の値段 (小判)
  const START_TROOPS = 500;        // 任された国に、はじめからいる兵
  const TAX_PER_PREF = 0.02;       // 取った国から入る年貢 (1 国・1 秒あたりの小判)

  const REGIONS = ['北海道', '東北', '関東', '中部', '近畿', '中国', '四国', '九州'];
  // [名前, 地方, 大名 (戦国の大名をもじった猫), となり]
  const PREF_TABLE = [
    ['北海道', 0, 'まつにゃえ 慶広', [2]],
    ['青森', 1, 'つがにゃ 為信', [1, 3, 5]],
    ['岩手', 1, 'にゃんぶ 信直', [2, 4, 5]],
    ['宮城', 1, '伊達 にゃさむね', [3, 5, 6, 7]],
    ['秋田', 1, 'あんどう にゃすえ', [2, 3, 4, 6]],
    ['山形', 1, 'もがにゃ 義光', [4, 5, 7, 15]],
    ['福島', 1, 'あしにゃ 盛氏', [4, 6, 8, 9, 10, 15]],
    ['茨城', 2, 'さたけ にゃしげ', [7, 9, 11, 12]],
    ['栃木', 2, 'うつにゃみや 国綱', [7, 8, 10, 11]],
    ['群馬', 2, 'にゃがの 業正', [7, 9, 11, 15, 20]],
    ['埼玉', 2, 'にゃりた 氏長', [8, 9, 10, 12, 13, 19, 20]],
    ['千葉', 2, 'さとにゃ 義堯', [8, 11, 13]],
    ['東京', 2, 'おおた にゃんかん', [11, 12, 14, 19]],
    ['神奈川', 2, 'ほうじょう にゃうじやす', [13, 19, 22]],
    ['新潟', 3, 'うえすぎ にゃんしん', [6, 7, 10, 16, 20]],
    ['富山', 3, 'さっさ にゃりまさ', [15, 17, 20, 21]],
    ['石川', 3, 'まえにゃ 利家', [16, 18, 21]],
    ['福井', 3, 'あさくにゃ 義景', [17, 21, 25, 26]],
    ['山梨', 3, 'たけにゃ 信玄', [11, 13, 14, 20, 22]],
    ['長野', 3, 'むらかみ にゃしきよ', [10, 11, 15, 16, 19, 21, 22, 23]],
    ['岐阜', 3, 'さいとう にゃんさん', [16, 17, 18, 20, 23, 24, 25]],
    ['静岡', 3, 'いまがわ にゃしもと', [14, 19, 20, 23]],
    ['愛知', 3, '織田 にゃぶなが', [20, 21, 22, 24]],
    ['三重', 4, 'きたばたけ にゃものり', [21, 23, 25, 26, 29, 30]],
    ['滋賀', 4, 'あざい にゃがまさ', [18, 21, 24, 26]],
    ['京都', 4, 'あしかが にゃしあき', [18, 24, 25, 27, 28, 29]],
    ['大阪', 4, 'とよとみ にゃでよし', [26, 28, 29, 30]],
    ['兵庫', 4, 'べっしょ にゃがはる', [26, 27, 31, 33, 36]],
    ['奈良', 4, 'まつにゃが 久秀', [24, 26, 27, 30]],
    ['和歌山', 4, 'さいか にゃごいち', [24, 27, 29]],
    ['鳥取', 5, 'やまにゃ 豊国', [28, 32, 33, 34]],
    ['島根', 5, 'あまにゃ 経久', [31, 34, 35]],
    ['岡山', 5, 'うきた にゃおいえ', [28, 31, 34, 37]],
    ['広島', 5, 'もうり にゃとなり', [31, 32, 33, 35, 38]],
    ['山口', 5, 'おおうち にゃしたか', [32, 34, 40]],
    ['徳島', 6, 'みよし にゃがよし', [28, 37, 38, 39]],
    ['香川', 6, 'そごう にゃずまさ', [33, 36, 38]],
    ['愛媛', 6, 'こうの にゃちなお', [34, 36, 37, 39]],
    ['高知', 6, 'ちょうそかべ にゃとちか', [36, 38]],
    ['福岡', 7, 'たちばな にゃんせつ', [35, 41, 43, 44]],
    ['佐賀', 7, 'りゅうぞうじ にゃかのぶ', [40, 42]],
    ['長崎', 7, 'おおむら にゃみただ', [41]],
    ['熊本', 7, 'かとう にゃよまさ', [40, 44, 45, 46]],
    ['大分', 7, 'おおとも にゃんりん', [40, 43, 45]],
    ['宮崎', 7, 'いとう にゃしすけ', [43, 44, 46]],
    ['鹿児島', 7, 'しまづ にゃしひろ', [43, 45, 47]],
    ['沖縄', 7, 'しょう にゃい王', [46]]
  ];
  const PREFS = PREF_TABLE.map(function (p, i) {
    // 大名の絵はあとで 1 匹ずつもらう。それまでは大きなボス猫の絵
    return { id: i + 1, name: p[0], region: p[1], daimyo: p[2], look: 'cat-red', nb: p[3] };
  });
  const PREF_COUNT = PREFS.length;

  function prefOf(id) { return PREFS[id - 1] || null; }
  function isNeighbor(a, b) { const p = prefOf(a); return !!p && p.nb.indexOf(b) >= 0; }
  function isRealmUnlocked(state) { return rankIndexOf(state) >= REALM_UNLOCK_RANK; }
  function hasRealm(state) { return !!(state.realm && state.realm.home); }
  function isMine(state, id) { return hasRealm(state) && state.realm.mine[id - 1] === true; }
  function ownedCount(state) { return hasRealm(state) ? state.realm.mine.filter(Boolean).length : 0; }
  function troopsAt(state, id) { return hasRealm(state) ? state.realm.troops[id - 1] : 0; }
  function totalTroops(state) {
    if (!hasRealm(state)) return 0;
    let n = 0;
    state.realm.mine.forEach(function (m, i) { if (m) n += state.realm.troops[i]; });
    return n;
  }
  function roundTroops(n) { return Math.max(0, Math.floor(n / TROOP_UNIT) * TROOP_UNIT); }

  /** はじめの国からの距離 (県をいくつまたぐか) */
  function prefDistances(home) {
    const d = new Array(PREF_COUNT + 1).fill(Infinity);
    d[home] = 0;
    const q = [home];
    while (q.length) {
      const a = q.shift();
      prefOf(a).nb.forEach(function (b) { if (d[b] === Infinity) { d[b] = d[a] + 1; q.push(b); } });
    }
    return d;
  }

  /**
   * 大名の強さ (合戦の敵の強さを、何段目の相手と同じにするか)。はじめの国から遠いほど強い。
   * いちばん遠い国が 18 になるように、遠さを割合にして決める (端の国から始めても、真ん中から始めても同じ)
   */
  const PREF_LEVEL_MIN = 4;
  const PREF_LEVEL_SPAN = 14;
  function prefLevelFor(dist, maxDist) {
    return PREF_LEVEL_MIN + Math.round(PREF_LEVEL_SPAN * Math.max(1, dist) / Math.max(1, maxDist));
  }
  /** 守りの兵。強い大名ほど多い (いちばん近くで 300〜500、いちばん遠くで 1 万ほど) */
  function garrisonFor(level, random) {
    return TROOP_UNIT * Math.round(3 * Math.pow(1.28, level - PREF_LEVEL_MIN) + random() * 2);
  }

  /** 任される国を選ぶ。ほかの県には大名と兵を置く (強さは、はじめの国からの距離で決まる) */
  function startRealm(state, homeId, rng) {
    if (hasRealm(state) || !isRealmUnlocked(state) || !prefOf(homeId)) return { ok: false, state: state };
    const random = rng || Math.random;
    const dist = prefDistances(homeId);
    const maxDist = Math.max.apply(null, dist.slice(1));
    const mine = new Array(PREF_COUNT).fill(false);
    const troops = new Array(PREF_COUNT).fill(0);
    const level = new Array(PREF_COUNT).fill(0);
    for (let id = 1; id <= PREF_COUNT; id++) {
      if (id === homeId) { mine[id - 1] = true; troops[id - 1] = START_TROOPS; continue; }
      level[id - 1] = prefLevelFor(dist[id], maxDist);
      troops[id - 1] = garrisonFor(level[id - 1], random);
    }
    const realm = { home: homeId, mine: mine, troops: troops, level: level, unified: false };
    return { ok: true, state: Object.assign({}, state, { realm: realm }) };
  }

  function withRealm(state, fn) {
    const realm = Object.assign({}, state.realm, { mine: state.realm.mine.slice(), troops: state.realm.troops.slice() });
    fn(realm);
    return Object.assign({}, state, { realm: realm });
  }

  function troopCost(count) { return TROOP_COST * Math.max(1, Math.round((count || TROOP_UNIT) / TROOP_UNIT)); }
  function canBuyTroops(state, id) { return isMine(state, id) && state.merit >= TROOP_COST; }
  /** 兵を 100 匹買って、その国に置く */
  function buyTroops(state, id) {
    if (!canBuyTroops(state, id)) return { ok: false, state: state };
    const next = withRealm(state, function (r) { r.troops[id - 1] += TROOP_UNIT; });
    next.merit = state.merit - TROOP_COST;
    return { ok: true, state: next };
  }

  /**
   * 自分の国から自分の国へ兵を移す (100 匹ずつ)。自分の国どうしがつながっていれば、遠くへも移せる
   * (敵の国をはさむと移せない。いまは敵が攻めてこないので、自分の国はいつもひとつながり)
   */
  function ownReach(state, from) {
    const seen = {};
    seen[from] = true;
    const q = [from];
    while (q.length) {
      const a = q.shift();
      prefOf(a).nb.forEach(function (b) { if (!seen[b] && isMine(state, b)) { seen[b] = true; q.push(b); } });
    }
    return seen;
  }
  function canMoveTroops(state, from, to, count) {
    return from !== to && isMine(state, from) && isMine(state, to) && !!ownReach(state, from)[to] &&
      count >= TROOP_UNIT && count % TROOP_UNIT === 0 && troopsAt(state, from) >= count;
  }
  function moveTroops(state, from, to, count) {
    if (!canMoveTroops(state, from, to, count)) return { ok: false, state: state };
    return { ok: true, state: withRealm(state, function (r) { r.troops[from - 1] -= count; r.troops[to - 1] += count; }) };
  }
  /** つながっている自分の国の兵を、ぜんぶ 1 か所に集める */
  function gatherTroops(state, to) {
    if (!isMine(state, to)) return { ok: false, state: state, moved: 0 };
    const reach = ownReach(state, to);
    let moved = 0;
    const next = withRealm(state, function (r) {
      for (let id = 1; id <= PREF_COUNT; id++) {
        if (id === to || !reach[id]) continue;
        moved += r.troops[id - 1];
        r.troops[to - 1] += r.troops[id - 1];
        r.troops[id - 1] = 0;
      }
    });
    return moved > 0 ? { ok: true, state: next, moved: moved } : { ok: false, state: state, moved: 0 };
  }

  /** 攻める県のとなりにある自分の国のうち、兵がいちばん多い所 (無ければ null) */
  function attackSource(state, to) {
    const p = prefOf(to);
    if (!p || !hasRealm(state) || isMine(state, to)) return null;
    let best = null;
    p.nb.forEach(function (id) {
      if (isMine(state, id) && (best === null || troopsAt(state, id) > troopsAt(state, best))) best = id;
    });
    return best;
  }

  function canAttack(state, from, to, sent) {
    return isMine(state, from) && !isMine(state, to) && isNeighbor(from, to) &&
      sent >= TROOP_UNIT && sent % TROOP_UNIT === 0 && troopsAt(state, from) >= sent;
  }

  /** 兵の数の比 (連れて行った兵 / 守りの兵) が、合戦の敵の数と強さに効く */
  function attackPlan(state, from, to, sent) {
    const p = prefOf(to);
    const garrison = troopsAt(state, to);
    const level = state.realm.level[to - 1];
    const ratio = sent / Math.max(TROOP_UNIT, garrison);
    const base = battleSize(level);
    const count = Math.max(2, base - (ratio >= 1.5 ? 1 : 0) - (ratio >= 3 ? 1 : 0));
    const strength = Math.min(1.5, Math.max(0.7, Math.sqrt(1 / ratio)));
    return {
      from: from, to: to, sent: sent, garrison: garrison, ratio: ratio, level: level,
      count: count, strength: strength, daimyo: p.daimyo, look: p.look, name: p.name
    };
  }

  /** 勝ったときに減る兵。守りが多いほど、こちらが少ないほど減る。1 回で 100 匹は必ず残る */
  function conquestLosses(plan) {
    const lost = roundTroops(plan.garrison * 0.6 / Math.sqrt(plan.ratio));
    return Math.min(lost, plan.sent - TROOP_UNIT);
  }

  // ---------------------------------------------------------- 時の流れ (放置成長)

  function tick(state, dt) {
    if (!(dt > 0)) return state; // dt が 0 以下なら何もしない (負の dt が来ても暴れない)

    const fx = townEffects(state);

    let materialGain = 0;
    let meritGain = 0;
    for (let i = 0; i < state.vassals.length; i++) {
      const v = state.vassals[i];
      if (v.job === 'labor') materialGain += v.level * 0.5 * fx.laborMul;
      else if (v.job === 'training') meritGain += v.level * 0.4 * fx.trainMul;
    }

    let village = state.village;
    if (isTownUnlocked(state)) {
      const capacity = villageCapacity(state);
      const growthRate = Math.max(0.15, (capacity - state.village.population) * 0.12) * fx.growthMul;
      const population = Math.min(capacity, state.village.population + growthRate * dt);
      materialGain += population * 0.02 * fx.popMatMul;
      village = Object.assign({}, state.village, { population: population });
    }

    // 取った国からの年貢 (小判だけ。経験値にはならない)
    const tax = ownedCount(state) * TAX_PER_PREF;

    return Object.assign({}, state, {
      merit: state.merit + (meritGain + tax) * dt,
      totalMerit: state.totalMerit + meritGain * dt,
      materials: state.materials + materialGain * fx.matMul * dt,
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
      items: { fish: 2, matatabi: 1 },
      hero: { hp: 0, atk: 0 },
      village: { population: 0, cells: new Array(MAP_CELLS).fill(null) },
      castle: { cells: new Array(MAP_CELLS).fill(null) },
      realm: null
    };
  }

  /** 保存データの国を確かめる。おかしければ、まだ国を任されていないことにする */
  function sanitizeRealm(raw) {
    if (!raw || typeof raw !== 'object' || !prefOf(raw.home)) return null;
    const ok = function (a) { return Array.isArray(a) && a.length === PREF_COUNT; };
    if (!ok(raw.mine) || !ok(raw.troops) || !ok(raw.level)) return null;
    const mine = raw.mine.map(function (m) { return m === true; });
    mine[raw.home - 1] = mine[raw.home - 1] || !mine.some(Boolean);
    return {
      home: raw.home,
      mine: mine,
      troops: raw.troops.map(function (t) { return Number.isFinite(t) ? roundTroops(t) : 0; }),
      level: raw.level.map(function (l) { return Number.isInteger(l) ? Math.min(PREF_LEVEL_MIN + PREF_LEVEL_SPAN, Math.max(0, l)) : PREF_LEVEL_MIN; }),
      unified: raw.unified === true
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
    const hero = raw.hero && typeof raw.hero === 'object' ? raw.hero : {};
    out.hero = {
      hp: Number.isInteger(hero.hp) ? Math.min(HERO_TRAIN_MAX, Math.max(0, hero.hp)) : 0,
      atk: Number.isInteger(hero.atk) ? Math.min(HERO_TRAIN_MAX, Math.max(0, hero.atk)) : 0
    };
    const it = raw.items || {};
    out.items = {
      fish: Number.isInteger(it.fish) ? Math.max(0, it.fish) : base.items.fish,
      matatabi: Number.isInteger(it.matatabi) ? Math.max(0, it.matatabi) : base.items.matatabi
    };
    out.vassals = Array.isArray(raw.vassals) ? raw.vassals.filter(function (v) {
      return v && typeof v.id === 'number' && typeof v.name === 'string';
    }).map(function (v) {
      return {
        id: v.id,
        name: v.name,
        level: Number.isInteger(v.level) ? Math.min(VASSAL_MAX_LEVEL, Math.max(1, v.level)) : 1,
        job: VASSAL_JOBS.indexOf(v.job) >= 0 ? v.job : 'training',
        look: VASSAL_LOOKS.indexOf(v.look) >= 0 ? v.look : VASSAL_LOOKS[v.id % VASSAL_LOOKS.length],
        // 得意技が無い前の保存データは、番号で決める (読み込むたびに変わらないように)
        skill: VASSAL_SKILLS[v.skill] ? v.skill : SKILL_KEYS[v.id % SKILL_KEYS.length]
      };
    }) : base.vassals;
    out.castle = { cells: new Array(MAP_CELLS).fill(null) };
    out.village = {
      population: (raw.village && Number.isFinite(raw.village.population)) ? Math.max(0, raw.village.population) : 0,
      cells: new Array(MAP_CELLS).fill(null)
    };
    const put = function (zone, type) {
      const i = out[zone].cells.indexOf(null);
      if (i >= 0) out[zone].cells[i] = type;
    };
    const oldCastle = raw.castle && Array.isArray(raw.castle.cells) ? raw.castle.cells : [];
    if (oldCastle.length === MAP_CELLS) {
      oldCastle.forEach(function (c, i) { if (BUILDINGS[c] && BUILDINGS[c].zone === 'castle') out.castle.cells[i] = c; });
    } else {
      // 前の版 (城 4x4・家は数だけ) からの引っ越し。似た役目の建物に置き換える
      const OLD = { keep: ['castle', 'keep'], barracks: ['castle', 'mansion'], wall: ['castle', 'stonewall'],
        storehouse: ['village', 'workshop'], well: ['village', 'well'] };
      oldCastle.forEach(function (c) { if (OLD[c]) put(OLD[c][0], OLD[c][1]); });
    }
    const oldVillage = raw.village && Array.isArray(raw.village.cells) ? raw.village.cells : null;
    if (oldVillage && oldVillage.length === MAP_CELLS) {
      oldVillage.forEach(function (c, i) { if (BUILDINGS[c] && BUILDINGS[c].zone === 'village') out.village.cells[i] = c; });
    } else if (raw.village && Number.isInteger(raw.village.houses)) {
      for (let i = 0; i < Math.min(raw.village.houses, MAP_CELLS); i++) put('village', 'house');
    }
    out.village.population = Math.min(out.village.population, villageCapacity(out));
    out.realm = sanitizeRealm(raw.realm);
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
    VASSAL_SKILLS: VASSAL_SKILLS,
    HERO_TRAIN: HERO_TRAIN,
    HERO_TRAIN_MAX: HERO_TRAIN_MAX,
    heroLevel: heroLevel,
    heroMul: heroMul,
    heroTrainCost: heroTrainCost,
    canTrainHero: canTrainHero,
    trainHero: trainHero,
    SKILL_KEYS: SKILL_KEYS,
    HEAL_INTERVAL: HEAL_INTERVAL,
    skillPower: skillPower,
    battleSkills: battleSkills,
    skillFromEnemy: skillFromEnemy,
    MAX_BATTLE_VASSALS: MAX_BATTLE_VASSALS,
    acceptRecruitOffer: acceptRecruitOffer,
    recruitCost: recruitCost,
    canRecruitVassal: canRecruitVassal,
    recruitVassal: recruitVassal,
    trainVassalCost: trainVassalCost,
    trainVassal: trainVassal,
    assignVassalJob: assignVassalJob,

    MAP_SIZE: MAP_SIZE,
    MAP_CELLS: MAP_CELLS,
    ZONES: ZONES,
    BUILDINGS: BUILDINGS,
    DECO_EFFECT: DECO_EFFECT,
    isTownUnlocked: isTownUnlocked,
    countBuildings: countBuildings,
    countDeco: countDeco,
    buildingCost: buildingCost,
    townEffects: townEffects,
    canPlaceBuilding: canPlaceBuilding,
    placeBuilding: placeBuilding,
    demolish: demolish,
    villageCapacity: villageCapacity,
    isCastleComplete: isCastleComplete,

    tick: tick,

    REALM_UNLOCK_RANK: REALM_UNLOCK_RANK,
    TROOP_UNIT: TROOP_UNIT,
    TROOP_COST: TROOP_COST,
    START_TROOPS: START_TROOPS,
    TAX_PER_PREF: TAX_PER_PREF,
    REGIONS: REGIONS,
    PREFS: PREFS,
    PREF_COUNT: PREF_COUNT,
    prefOf: prefOf,
    isNeighbor: isNeighbor,
    isRealmUnlocked: isRealmUnlocked,
    hasRealm: hasRealm,
    isMine: isMine,
    ownedCount: ownedCount,
    troopsAt: troopsAt,
    totalTroops: totalTroops,
    prefDistances: prefDistances,
    prefLevelFor: prefLevelFor,
    startRealm: startRealm,
    troopCost: troopCost,
    canBuyTroops: canBuyTroops,
    buyTroops: buyTroops,
    canMoveTroops: canMoveTroops,
    moveTroops: moveTroops,
    gatherTroops: gatherTroops,
    attackSource: attackSource,
    PREF_LEVEL_MIN: PREF_LEVEL_MIN,
    PREF_LEVEL_SPAN: PREF_LEVEL_SPAN,
    canAttack: canAttack,
    attackPlan: attackPlan,
    conquestLosses: conquestLosses,

    SCENE_W: SCENE_W,
    PLAYER_X: PLAYER_X,
    ENEMY_X: ENEMY_X,
    ENTER_X: ENTER_X,
    WINDUP: WINDUP,
    LURE_COOLDOWN: LURE_COOLDOWN,
    PUNCH_COOLDOWN: PUNCH_COOLDOWN,
    WARY: WARY,
    MUCHU_MAX: MUCHU_MAX,
    MUCHU_CHASE: MUCHU_CHASE,
    CHARGE_LEVELS: CHARGE_LEVELS,
    CHARGE_POWER: CHARGE_POWER,
    MAX_MUL: MAX_MUL,
    COUNTER_MUL: COUNTER_MUL,
    COUNTER_RANK: COUNTER_RANK,
    YUDO_RANK: YUDO_RANK,
    RUSH_WARN: RUSH_WARN,
    RUSH_TIME: RUSH_TIME,
    RUSH_MUL: RUSH_MUL,
    CRASH_STUN: CRASH_STUN,
    CRASH_DMG: CRASH_DMG,
    OBSTACLE_X: OBSTACLE_X,
    OBSTACLE_RESPAWN: OBSTACLE_RESPAWN,
    canYudo: canYudo,
    isRushing: isRushing,
    ENEMY_KINDS: ENEMY_KINDS,
    ITEM_KINDS: ITEM_KINDS,
    playerMaxHp: playerMaxHp,
    playerAtk: playerAtk,
    enemyReward: enemyReward,
    battleSize: battleSize,
    chargeLevel: chargeLevel,
    canCounter: canCounter,
    createBattle: createBattle,
    stepBattle: stepBattle,
    currentEnemy: currentEnemy,
    isAlert: isAlert,
    isChasing: isChasing,
    enemyMood: enemyMood,
    lure: lure,
    punch: punch,
    punchPress: punchPress,
    punchRelease: punchRelease,
    useItem: useItem,
    rollRecruitOffer: rollRecruitOffer,
    applyBattleResult: applyBattleResult,
    lossReward: lossReward,

    createInitialState: createInitialState,
    sanitizeState: sanitizeState,
    serialize: serialize,
    deserialize: deserialize
  };
});
