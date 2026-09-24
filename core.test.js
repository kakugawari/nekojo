const test = require('node:test');
const assert = require('node:assert');
const Core = require('./core.js');

function stateAt(merit, extra) {
  return Object.assign(Core.createInitialState(1), { merit: merit, totalMerit: merit }, extra || {});
}

test('rankIndexForMerit は境目ちょうどで上がる', () => {
  assert.strictEqual(Core.rankIndexForMerit(0), 0);
  assert.strictEqual(Core.rankIndexForMerit(19), 0);
  assert.strictEqual(Core.rankIndexForMerit(20), 1); // 草履取り
  assert.strictEqual(Core.rankIndexForMerit(149), 2);
  assert.strictEqual(Core.rankIndexForMerit(150), 3); // 足軽
  assert.strictEqual(Core.rankIndexForMerit(999999), Core.RANKS.length - 1);
});

test('addMerit は出世した瞬間を知らせる', () => {
  const s = stateAt(19);
  const r = Core.addMerit(s, 1);
  assert.strictEqual(r.rankedUp, true);
  assert.strictEqual(r.prevRankIndex, 0);
  assert.strictEqual(r.rankIndex, 1);
  assert.strictEqual(r.state.merit, 20);

  const r2 = Core.addMerit(stateAt(20), 1);
  assert.strictEqual(r2.rankedUp, false);
});

test('addMerit はもとの state を書き換えない', () => {
  const s = stateAt(0);
  Core.addMerit(s, 100);
  assert.strictEqual(s.merit, 0);
});

test('家臣は足軽 (rank 3) になるまで誘えない', () => {
  const s = stateAt(149); // rank 2 (中間)、手柄はコスト分あるが誘えない
  assert.strictEqual(Core.canRecruitVassal(s), false);
  const r = Core.recruitVassal(s, Core.mulberry32(1));
  assert.strictEqual(r.ok, false);
});

test('家臣を誘うと枠と手柄が減り、名前がつく', () => {
  const s = stateAt(349); // rank 3 (足軽)、枠は2
  const rng = Core.mulberry32(3);
  const r1 = Core.recruitVassal(s, rng);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.state.vassals.length, 1);
  assert.ok(Core.VASSAL_NAMES.includes(r1.vassal.name));
  assert.strictEqual(r1.state.merit, 349 - Core.recruitCost(s));

  const r2 = Core.recruitVassal(r1.state, rng);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.state.vassals.length, 2);

  // 枠 (2) を超えたら誘えない
  const r3 = Core.recruitVassal(r2.state, rng);
  assert.strictEqual(r3.ok, false);
  assert.strictEqual(r3.state.vassals.length, 2);
});

test('家臣を雇って手柄を使っても、出世 (ランク) は下がらない', () => {
  // 実際にブラウザで試して踏んだ不具合: 手柄と、家臣を雇う代金を同じ数字で
  // 扱っていたため、雇った直後に手柄の残りが減って出世前の値に戻り、
  // 家臣タブの鍵がまた掛かって、雇ったはずの家臣が画面から消えた。
  let s = stateAt(150); // 足軽 (rank 3) の閾値ちょうど
  const rng = Core.mulberry32(11);
  const before = Core.rankIndexOf(s);
  assert.strictEqual(before, 3);

  const r1 = Core.recruitVassal(s, rng);
  assert.strictEqual(r1.ok, true);
  assert.ok(r1.state.merit < 150, '財布の中身は閾値を割り込むまで使った');
  assert.strictEqual(Core.rankIndexOf(r1.state), 3, '出世は下がらない');
  assert.strictEqual(r1.state.totalMerit, s.totalMerit, '稼いだ合計は使っても減らない');

  const r2 = Core.trainVassal(r1.state, r1.vassal.id);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(Core.rankIndexOf(r2.state), 3, '家臣を鍛えても出世は下がらない');
});

test('家臣を鍛えるとレベルが上がり、手柄が減る', () => {
  const rng = Core.mulberry32(9);
  const r0 = Core.recruitVassal(stateAt(1000), rng);
  const vassal = r0.vassal;
  const before = r0.state.merit;
  const r1 = Core.trainVassal(r0.state, vassal.id);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.state.vassals[0].level, 2);
  assert.strictEqual(r1.state.merit, before - Core.trainVassalCost(vassal));
});

test('レベル上限 (10) を超えて鍛えられない', () => {
  const rng = Core.mulberry32(4);
  let r = Core.recruitVassal(stateAt(1000000), rng);
  let state = r.state;
  const id = r.vassal.id;
  for (let i = 0; i < 9; i++) {
    r = Core.trainVassal(state, id);
    assert.strictEqual(r.ok, true);
    state = r.state;
  }
  assert.strictEqual(state.vassals[0].level, 10);
  const over = Core.trainVassal(state, id);
  assert.strictEqual(over.ok, false);
});

test('存在しない家臣を操作しても壊れない', () => {
  const s = stateAt(1000);
  assert.strictEqual(Core.trainVassal(s, 999).ok, false);
  assert.strictEqual(Core.assignVassalJob(s, 999, 'labor').ok, false);
});

test('tick は dt が 0 以下なら何もしない (負の dt よけ)', () => {
  const s = stateAt(5000, { materials: 10 });
  assert.deepStrictEqual(Core.tick(s, 0), s);
  assert.deepStrictEqual(Core.tick(s, -5), s);
});

test('村は城主 (rank 8) になるまで大きくならない', () => {
  const s = stateAt(1000); // rank 4, まだ城主ではない
  const after = Core.tick(s, 100);
  assert.strictEqual(after.village.population, 0);
});

test('城主になると人口が上限へ向けて増える', () => {
  let s = stateAt(5000); // 城主, capacity = 10
  for (let i = 0; i < 50; i++) s = Core.tick(s, 1);
  assert.ok(s.village.population > 0, '人口が増えているはず');
  assert.ok(s.village.population <= Core.villageCapacity(s), '上限を超えない');
});

test('普請の家臣がいると資材が増える', () => {
  const rng = Core.mulberry32(2);
  let r = Core.recruitVassal(stateAt(5000), rng);
  r = Core.assignVassalJob(r.state, r.state.vassals[0].id, 'labor');
  const before = r.state.materials;
  const after = Core.tick(r.state, 10);
  assert.ok(after.materials > before, '資材が増えていない');
});

test('訓練の家臣がいると手柄が増える', () => {
  const rng = Core.mulberry32(5);
  const r = Core.recruitVassal(stateAt(5000), rng); // job は既定で training
  const before = r.state.merit;
  const after = Core.tick(r.state, 10);
  assert.ok(after.merit > before, '手柄が増えていない');
});

test('保存して読み込むと同じ状態に戻る', () => {
  let s = stateAt(1234, { materials: 56 });
  s = Core.recruitVassal(s, Core.mulberry32(1)).state;
  const json = Core.serialize(s);
  const restored = Core.deserialize(json);
  assert.deepStrictEqual(restored, s);
});

test('壊れた保存データでも初期状態として読み込める', () => {
  assert.doesNotThrow(() => Core.deserialize('{ this is not json'));
  const restored = Core.deserialize('{"merit": "abc", "vassals": "oops"}');
  assert.strictEqual(restored.merit, 0);
  assert.deepStrictEqual(restored.vassals, []);
  assert.strictEqual(restored.castle.cells.length, Core.MAP_CELLS);
});

test('古い保存データに新しい項目が無くても補われる', () => {
  const restored = Core.sanitizeState({ merit: 500 });
  assert.strictEqual(restored.merit, 500);
  assert.strictEqual(restored.village.population, 0);
  assert.strictEqual(restored.village.cells.length, Core.MAP_CELLS);
  assert.strictEqual(restored.castle.cells.length, Core.MAP_CELLS);
});

// ---------------------------------------------------------- 合戦

function stateAtRank(r, extra) {
  const t = Core.RANKS[r].threshold;
  return stateAt(t, extra);
}

/** 今の敵が入ってきて戦える状態になるまで進める */
function untilReady(b) {
  for (let i = 0; i < 60 * 10; i++) {
    const e = Core.currentEnemy(b);
    if (e && e.state === 'idle') return e;
    Core.stepBattle(b, 1 / 60);
  }
  throw new Error('敵が来ない');
}

/** 特定のタイプの敵と 1 対 1 にする (テストで種類を決め打ちしたいとき) */
function duelWith(kind, r) {
  const b = Core.createBattle(stateAtRank(r || 3), Core.mulberry32(1));
  const k = Core.ENEMY_KINDS[kind];
  const e = b.enemies[0];
  Object.assign(e, { kind: kind, name: k.name, look: k.look, boss: !!k.boss, interval: k.interval, cd: k.interval });
  return { b, e: untilReady(b) };
}

function runBattle(state, bot, seed) {
  const b = Core.createBattle(state, Core.mulberry32(seed));
  let next = 0;
  for (let i = 0; i < 60 * 300 && b.phase === 'fight'; i++) {
    // 離すのはいつでも。押すのは人と同じくらいの間隔 (0.2〜0.3秒) でしか押さない
    if (b.charge.on && bot.release(b)) Core.punchRelease(b);
    if (b.t >= next && bot.press(b)) next = b.t + 0.2 + b.rng() * 0.1;
    Core.stepBattle(b, 1 / 60);
    b.events.length = 0;
  }
  return b;
}

// 下手: パンチをすぐ離して連打するだけ
const masher = { press: (b) => Core.punch(b), release: () => true };
// 溜めない: 猫じゃらしで MAX にして、すぐ離すパンチ
const tapper = {
  press(b) {
    const e = Core.currentEnemy(b); if (!e) return false;
    if (b.player.hp < b.player.maxHp * 0.3 && b.items.fish > 0) return Core.useItem(b, 'fish');
    return e.state === 'charmed' ? Core.punch(b) : Core.lure(b);
  },
  release: () => true
};
// ふつう: 「!」を気にせず猫じゃらしを振り、MAX になったら強パンチまで溜めて離す。体力が減ったら魚
const casual = {
  press(b) {
    const e = Core.currentEnemy(b); if (!e || b.charge.on) return false;
    if (b.player.hp < b.player.maxHp * 0.3 && b.items.fish > 0) return Core.useItem(b, 'fish');
    if (e.state === 'charmed') return Core.punchPress(b);
    return Core.lure(b);
  },
  release(b) { const e = Core.currentEnemy(b); return !e || e.state !== 'charmed' || Core.chargeLevel(b.charge.t) >= 1; }
};
// 上手: 「!」のときは振らない。MAX で会心まで溜める。ねこ侍はスキを狙う。
// カウンターを覚えたら、警戒中は溜めて待ち、攻撃の予告を見てから離す (反応の遅れ 0.15〜0.35 秒)
const skilled = {
  press(b) {
    const e = Core.currentEnemy(b); if (!e || b.charge.on) return false;
    if (b.player.hp < b.player.maxHp * 0.35 && b.items.fish > 0) return Core.useItem(b, 'fish');
    if (e.state === 'rushWarn') {
      // 突進の予告を見てから (反応の遅れ 0.15〜0.35 秒) 猫じゃらしで樽へ誘導
      if (e.react === undefined) e.react = 0.15 + b.rng() * 0.2;
      return (Core.RUSH_WARN - e.timer) >= e.react && !e.lured ? Core.lure(b) : false;
    }
    if (e.state === 'recover' && e.open) return Core.punch(b);
    if (e.state === 'charmed') return Core.punchPress(b);
    if (e.state === 'idle' && !Core.isAlert(e)) return Core.lure(b);
    if (Core.canCounter(b) && (e.state === 'idle' || e.state === 'knock') && Core.isAlert(e)) return Core.punchPress(b);
    return false;
  },
  release(b) {
    const e = Core.currentEnemy(b);
    if (!e) return true;
    if (e.state === 'charmed') return Core.chargeLevel(b.charge.t) >= 2 || e.charm < 0.1;
    if (e.state === 'rushWarn') return true; // 溜めていたら離して、猫じゃらしに持ちかえる
    if (e.state === 'windup') {
      if (e.react === undefined) e.react = 0.15 + b.rng() * 0.2;
      return (Core.WINDUP - e.timer) >= e.react && Core.chargeLevel(b.charge.t) >= 1;
    }
    e.react = undefined;
    return !Core.isAlert(e) && e.state === 'idle';
  }
};

/** 押してから t 秒たって離す (そのあいだ戦は進む) */
function hold(b, seconds) {
  assert.strictEqual(Core.punchPress(b), true, '押せる');
  for (let i = 0; i < Math.round(seconds * 60); i++) Core.stepBattle(b, 1 / 60);
  return Core.punchRelease(b);
}
function step(b, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) Core.stepBattle(b, 1 / 60);
}

test('合戦: 敵は1匹ずつ。数は段位で増え、最後は大将 (最初の戦はのら猫の親分、あとは大きなボス猫)', () => {
  for (const r of [0, 3, 9]) {
    const b = Core.createBattle(stateAtRank(r), Core.mulberry32(1));
    assert.strictEqual(b.enemies.length, Core.battleSize(r));
    const last = b.enemies[b.enemies.length - 1];
    assert.strictEqual(last.boss, true);
    assert.strictEqual(last.kind === 'boss', r > 0);
    assert.strictEqual(last.reward, Core.enemyReward(r, true));
    assert.strictEqual(b.enemies[0].state, 'enter');
    assert.ok(b.enemies.slice(1).every((e) => e.state === 'wait'), 'ほかの敵はまだ出てこない');
  }
});

test('合戦: 入ってくる途中の敵には、じゃらしもパンチも当たらない', () => {
  const b = Core.createBattle(stateAtRank(0), Core.mulberry32(2));
  Core.lure(b); Core.punch(b);
  assert.ok(b.events.some((e) => e.type === 'miss'));
  assert.ok(b.events.some((e) => e.type === 'lure' && e.result === 'miss'));
  assert.strictEqual(b.enemies[0].hp, b.enemies[0].maxHp);
});

test('合戦: のら猫は猫じゃらし2回で夢中 MAX。ゲージは ♡ でたまり、MAX で動けなくなる', () => {
  const { b, e } = duelWith('nora');
  assert.strictEqual(Core.enemyMood(e), 'none');
  Core.lure(b);
  assert.ok(e.muchu > Core.MUCHU_CHASE && e.muchu < Core.MUCHU_MAX, `1回目で半分より上 (${e.muchu})`);
  assert.strictEqual(e.state, 'idle');
  assert.strictEqual(Core.enemyMood(e), 'chase', '頭の上は ♡');
  b.cd.lure = 0;
  Core.lure(b);
  assert.strictEqual(e.state, 'charmed');
  assert.strictEqual(e.muchu, Core.MUCHU_MAX);
  assert.strictEqual(Core.enemyMood(e), 'max', '頭の上は肉球 (今だ!)');
  assert.ok(b.events.some((ev) => ev.type === 'lure' && ev.result === 'max'));
});

test('合戦: 夢中 MAX は決まった長さで切れ、ゲージは減っていく。切れると飽きて警戒する', () => {
  const { b, e } = duelWith('nora');
  Core.useItem(b, 'matatabi');
  step(b, 2);
  assert.strictEqual(e.state, 'charmed');
  assert.ok(e.muchu < Core.MUCHU_MAX && e.muchu > 0, `残り時間に合わせて減る (${Math.round(e.muchu)})`);
  step(b, 2.1);
  assert.strictEqual(e.state, 'idle');
  assert.strictEqual(e.muchu, 0);
  assert.ok(b.events.some((ev) => ev.type === 'bored'));
  assert.strictEqual(Core.enemyMood(e), 'alert', '飽きたら警戒 (頭の上に「!」)');
});

test('合戦: 振るのをやめると、夢中ゲージは少しずつ減る', () => {
  const { b, e } = duelWith('samurai');
  Core.lure(b);
  const g = e.muchu;
  step(b, 0.8);
  assert.strictEqual(e.muchu, g, 'すぐには減らない');
  step(b, 1.2);
  assert.ok(e.muchu < g, `しばらくすると減る (${g} → ${Math.round(e.muchu)})`);
});

test('合戦: 羽を追いかけている間 (ゲージ半分以上) は攻撃してこない。ゲージが無ければ振りかぶってから攻撃する', () => {
  const a = duelWith('samurai');
  const hp0 = a.b.player.hp;
  a.e.cd = 0.9; // もうすぐ振りかぶる所から
  for (let i = 0; i < 60 * 3; i++) {
    a.e.muchu = 70; a.e.muchuIdle = 0; // 振り続けて、半分より上を保つ
    Core.stepBattle(a.b, 1 / 60);
  }
  assert.ok(Core.isChasing(a.e));
  assert.strictEqual(a.b.player.hp, hp0, '追いかけている間は、攻撃の間隔 (1.8秒) を過ぎても殴られない');
  const c = duelWith('nora');
  const hp1 = c.b.player.hp;
  step(c.b, c.e.interval - Core.WINDUP + 0.05);
  assert.strictEqual(c.e.state, 'windup', '先に振りかぶる (赤い「!」)');
  assert.strictEqual(Core.enemyMood(c.e), 'attack');
  step(c.b, Core.WINDUP);
  assert.ok(c.b.player.hp < hp1, '振りかぶりのあとに殴られる');
});

test('合戦: 警戒中 (「!」) の猫じゃらしは効きが小さく、次に振れるまで長い', () => {
  const { b, e } = duelWith('nora');
  e.wary = Core.WARY;
  assert.strictEqual(Core.enemyMood(e), 'alert');
  Core.lure(b);
  assert.ok(e.muchu > 0 && e.muchu < 20, `少しだけたまる (${e.muchu})`);
  assert.ok(b.cd.lure > Core.LURE_COOLDOWN, '次に振れるまで長い');
  assert.ok(b.events.some((ev) => ev.type === 'lure' && ev.result === 'weak'));
});

test('合戦: 溜めパンチは押している長さで 通常 → 強 → 会心。段が上がると知らせる', () => {
  const { b, e } = duelWith('nora', 1);
  e.hp = e.maxHp = 100000;
  const atk = b.player.atk;
  let before = e.hp;
  hold(b, 0.1);
  assert.strictEqual(before - e.hp, atk, 'すぐ離すと通常パンチ');
  step(b, 0.5); e.state = 'idle'; e.x = Core.ENEMY_X; e.cd = 99;
  before = e.hp;
  Core.punchPress(b);
  step(b, 0.85);
  assert.ok(b.events.some((ev) => ev.type === 'charge' && ev.level === 1), '強になったと知らせる');
  Core.punchRelease(b);
  assert.strictEqual(before - e.hp, atk * Core.CHARGE_POWER[1]);
  assert.strictEqual(e.state, 'knock', '強パンチは敵を吹っ飛ばす');
  step(b, 1); e.state = 'idle'; e.cd = 99;
  before = e.hp;
  b.events.length = 0;
  hold(b, 1.55);
  assert.ok(b.events.some((ev) => ev.type === 'charge' && ev.level === 2), '会心になったと知らせる (ポン!)');
  assert.strictEqual(before - e.hp, Math.round(atk * Core.CHARGE_POWER[2]));
});

test('合戦: 夢中 MAX の敵には大ダメージ。溜めも 2 倍の速さでたまる', () => {
  const { b, e } = duelWith('nora', 1);
  e.hp = e.maxHp = 100000;
  Core.useItem(b, 'matatabi');
  Core.punchPress(b);
  step(b, 0.42);
  assert.strictEqual(Core.chargeLevel(b.charge.t), 1, '0.4 秒で強になる (ふだんは 0.8 秒)');
  const before = e.hp;
  Core.punchRelease(b);
  assert.strictEqual(before - e.hp, Math.round(b.player.atk * Core.CHARGE_POWER[1] * Core.MAX_MUL));
  assert.strictEqual(e.muchu, 0, '殴られると夢中は解ける');
  assert.ok(e.wary > 0, 'そのあと警戒する');
});

test('合戦: 溜めている途中で殴られると、溜めは解ける', () => {
  const { b, e } = duelWith('nora');
  Core.punchPress(b);
  step(b, e.interval + 0.1);
  assert.ok(b.player.hp < b.player.maxHp);
  assert.strictEqual(b.charge.on, false);
  assert.ok(b.events.some((ev) => ev.type === 'chargeBroken'));
  assert.strictEqual(Core.punchRelease(b), false, '離してもパンチは出ない');
});

test('合戦: 吹っ飛ばしても敵の攻撃の溜めは止まらない (強パンチを続けて封じ込め、にならない)', () => {
  const { b, e } = duelWith('nora', 1);
  e.hp = e.maxHp = 100000;
  const hp0 = b.player.hp;
  for (let i = 0; i < 4; i++) { hold(b, 0.85); step(b, Core.PUNCH_COOLDOWN + 0.05); }
  assert.ok(b.player.hp < hp0, '強パンチを続けていても殴られる');
});

test('合戦: カウンターは足軽から。溜めたパンチを攻撃の予告に合わせて離すと、攻撃を打ち消して会心', () => {
  const setup = (r) => {
    const { b, e } = duelWith('nora', r);
    e.hp = e.maxHp = 100000;
    Core.punchPress(b);
    step(b, e.interval - Core.WINDUP + 0.1); // 溜めながら待つと、振りかぶる
    assert.strictEqual(e.state, 'windup');
    return { b, e };
  };
  const a = setup(Core.COUNTER_RANK);
  const hp0 = a.b.player.hp;
  Core.punchRelease(a.b);
  assert.ok(a.b.events.some((ev) => ev.type === 'hit' && ev.counter), 'カウンター!');
  step(a.b, Core.WINDUP);
  assert.strictEqual(a.b.player.hp, hp0, '攻撃は打ち消された');
  const n = setup(Core.COUNTER_RANK - 1);
  const hp1 = n.b.player.hp;
  Core.punchRelease(n.b);
  assert.ok(!n.b.events.some((ev) => ev.type === 'hit' && ev.counter), 'まだ覚えていない');
  step(n.b, Core.WINDUP);
  assert.ok(n.b.player.hp < hp1);
  // すぐ離すパンチではカウンターにならない (連打で全部打ち消せてしまうので)
  const { b, e } = duelWith('nora', Core.COUNTER_RANK);
  e.hp = e.maxHp = 100000;
  step(b, e.interval - Core.WINDUP + 0.1);
  const hp2 = b.player.hp;
  Core.punch(b);
  assert.ok(!b.events.some((ev) => ev.type === 'hit' && ev.counter));
  step(b, Core.WINDUP);
  assert.ok(b.player.hp < hp2);
});

test('合戦: すばしっこい猫は、こちらを見ている間 (「!」) は猫じゃらしが効きにくい', () => {
  const { b, e } = duelWith('quick');
  const alertTimes = [];
  for (let i = 0; i < 18; i++) { alertTimes.push(Core.isAlert(e)); step(b, 0.1); e.cd = 99; }
  const n = alertTimes.filter(Boolean).length;
  assert.ok(n >= 6 && n <= 12, `半分くらいの間こちらを見ている (${n}/18)`);
  while (!Core.isAlert(e)) step(b, 1 / 60);
  Core.lure(b);
  assert.ok(e.muchu < 15, '見られているときは効きにくい');
  e.muchu = 0; b.cd.lure = 0;
  while (Core.isAlert(e)) step(b, 1 / 60);
  Core.lure(b);
  assert.ok(e.muchu > 30, 'よそ見しているときは効く');
});

test('合戦: ねこ侍は夢中でないときに殴ると受け流して反撃。攻撃のあとのスキに殴ると会心', () => {
  const { b, e } = duelWith('samurai');
  const hp0 = b.player.hp;
  Core.punch(b);
  assert.ok(b.events.some((ev) => ev.type === 'parry'));
  assert.strictEqual(e.hp, e.maxHp);
  assert.ok(b.player.hp < hp0, '反撃される');
  b.cd.punch = 0;
  step(b, e.interval + 0.2);
  assert.strictEqual(e.state, 'recover');
  assert.strictEqual(e.open, true, '攻撃のあとはスキ');
  Core.punch(b);
  assert.ok(b.events.some((ev) => ev.type === 'hit' && ev.open && ev.crit));
});

test('合戦: 大きなボス猫は5回振ってやっと MAX。夢中でないとパンチは半分', () => {
  const { b, e } = duelWith('boss');
  for (let i = 0; i < 4; i++) { Core.lure(b); b.cd.lure = 0; }
  assert.strictEqual(e.state, 'idle', '4回ではまだ');
  Core.lure(b);
  assert.strictEqual(e.state, 'charmed');
  const { b: b2, e: e2 } = duelWith('boss');
  Core.punch(b2);
  assert.strictEqual(e2.maxHp - e2.hp, Math.round(b2.player.atk * 0.5));
});

test('合戦: 魚で体力が戻り、またたびで敵がすぐ夢中 MAX になる。持っている数だけ使える', () => {
  const { b, e } = duelWith('boss');
  assert.strictEqual(Core.useItem(b, 'fish'), false, '体力が満タンなら魚は使わない');
  b.player.hp = 10;
  assert.strictEqual(Core.useItem(b, 'fish'), true);
  assert.strictEqual(b.player.hp, 10 + Math.round(b.player.maxHp * 0.4));
  assert.strictEqual(Core.useItem(b, 'matatabi'), true);
  assert.strictEqual(e.state, 'charmed', 'ボス猫でも、またたびなら一発で MAX');
  assert.strictEqual(e.muchu, Core.MUCHU_MAX);
  assert.strictEqual(Core.useItem(b, 'matatabi'), false, '1つしか持っていない');
});

test('合戦: 倒すと少し間をおいて次の敵が出てくる。最後の1匹が倒れたら勝ち', () => {
  const b = Core.createBattle(stateAtRank(0), Core.mulberry32(3));
  for (let n = 0; n < b.enemies.length; n++) {
    const e = untilReady(b);
    assert.strictEqual(b.current, n, `${n + 1}匹目が出てくる`);
    e.hp = 1;
    b.cd.lure = 0; b.cd.punch = 0;
    Core.useItem(b, 'matatabi') || Core.lure(b);
    Core.punch(b);
    assert.strictEqual(e.state, 'down');
    if (n === b.enemies.length - 1) assert.strictEqual(b.phase, 'fight', '倒れる様子を見せてから終わる');
    for (let i = 0; i < 60 * 1.5; i++) Core.stepBattle(b, 1 / 60);
  }
  assert.strictEqual(b.phase, 'won');
});

test('合戦: 勝つと手柄・資材・拾い物が入り、使ったアイテムは減る。出世もする', () => {
  const s = stateAtRank(0);
  const b = runBattle(s, casual, 1);
  assert.strictEqual(b.phase, 'won');
  assert.ok(b.merit > 0 && b.bonus > 0 && b.materials > 0);
  const r = Core.applyBattleResult(s, b);
  assert.strictEqual(r.state.totalMerit, s.totalMerit + b.merit + b.bonus);
  assert.strictEqual(r.state.materials, s.materials + b.materials);
  assert.strictEqual(r.state.items.fish, s.items.fish - b.used.fish + b.loot.fish);
  assert.strictEqual(r.state.battlesWon, 1);
  assert.strictEqual(r.rankedUp, true, '村の子猫は1勝で出世する');
});

test('合戦: 体力が0になると負け。使ったアイテム以外は何も減らない', () => {
  const s = stateAtRank(5);
  const b = Core.createBattle(s, Core.mulberry32(10));
  b.player.hp = 5;
  Core.useItem(b, 'fish');
  for (let i = 0; i < 60 * 120 && b.phase === 'fight'; i++) Core.stepBattle(b, 1 / 60); // 何もしない
  assert.strictEqual(b.phase, 'lost');
  const r = Core.applyBattleResult(s, b);
  assert.strictEqual(r.state.items.fish, s.items.fish - 1);
  assert.deepStrictEqual(Object.assign({}, r.state, { items: s.items }), s);
});

test('合戦: dt が 0 以下なら何もしない。大きな dt でも一気に進まない', () => {
  const b = Core.createBattle(stateAtRank(0), Core.mulberry32(11));
  const snap = JSON.stringify(b.enemies);
  Core.stepBattle(b, 0);
  Core.stepBattle(b, -3);
  assert.strictEqual(JSON.stringify(b.enemies), snap);
  Core.stepBattle(b, 1000);
  assert.strictEqual(b.enemies[0].state, 'enter', '1コマで入場が終わらない');
});

test('合戦: 出陣の家臣がいっしょに戦う (2人まで)。夢中は解けない', () => {
  let s = stateAtRank(3);
  s = Object.assign({}, s, { merit: 10000, totalMerit: 10000 });
  for (let i = 0; i < 3; i++) s = Core.recruitVassal(s, Core.mulberry32(10 + i)).state;
  const ids = s.vassals.map((v) => v.id);
  s = Core.assignVassalJob(s, ids[0], 'battle').state;
  s = Core.assignVassalJob(s, ids[1], 'battle').state;
  assert.strictEqual(Core.assignVassalJob(s, ids[2], 'battle').ok, false, '3人目は出陣できない');
  const b = Core.createBattle(s, Core.mulberry32(12));
  assert.strictEqual(b.allies.length, 2);
  const e = untilReady(b);
  e.hp = e.maxHp = 10000;
  Core.useItem(b, 'matatabi'); // どの種類の敵でも 4 秒夢中
  for (let i = 0; i < 60 * 3; i++) Core.stepBattle(b, 1 / 60);
  assert.ok(b.events.some((ev) => ev.type === 'allyAttack'));
  assert.ok(e.hp < 10000);
  assert.strictEqual(e.state, 'charmed');
});

test('合戦のあと: 枠が空いていれば、倒した相手が仲間になりたがることがある', () => {
  const s = stateAtRank(3);
  let offers = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const b = runBattle(s, skilled, seed);
    const offer = Core.rollRecruitOffer(s, b);
    if (offer) {
      offers++;
      assert.ok(Core.VASSAL_LOOKS.includes(offer.look));
      const r = Core.acceptRecruitOffer(s, offer);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.state.merit, s.merit, '仲間入りはただ');
    }
  }
  assert.ok(offers > 3 && offers < 17, `だいたい半分 (${offers}/20)`);
  assert.strictEqual(Core.rollRecruitOffer(stateAtRank(0), runBattle(stateAtRank(0), skilled, 1)), null, '足軽より前は仲間を持てない');
});

// ---------------------------------------------------------- 家臣の得意技

/** 出陣の家臣 (得意技・レベル) を決め打ちして 1 対 1 にする */
function duelWithSkills(kind, r, skills) {
  const s = stateAtRank(r || 3);
  s.vassals = skills.map((sk, i) => ({ id: i + 1, name: 'v' + i, level: sk[1], job: 'battle', look: 'cat-gray', skill: sk[0] }));
  const b = Core.createBattle(s, Core.mulberry32(1));
  const k = Core.ENEMY_KINDS[kind];
  Object.assign(b.enemies[0], { kind: kind, name: k.name, look: k.look, boss: !!k.boss, interval: k.interval, cd: k.interval });
  b.allies.forEach((a) => { a.cd = 999; }); // 家臣の攻撃は止めて、得意技だけを見る
  return { b, e: untilReady(b) };
}

test('得意技: 家臣はひとつずつ得意技を持つ。村で募ると 4 つのどれか、倒した相手はその種類で決まる', () => {
  let s = stateAtRank(3);
  s = Object.assign({}, s, { merit: 100000 });
  const got = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const r = Core.recruitVassal(Object.assign({}, s, { vassals: [] }), Core.mulberry32(seed));
    assert.ok(Core.SKILL_KEYS.includes(r.vassal.skill));
    got.add(r.vassal.skill);
  }
  assert.strictEqual(got.size, 4, '4 つとも出る');
  const rnd = Core.mulberry32(3);
  assert.strictEqual(Core.skillFromEnemy('quick', rnd), 'quick', 'すばしっこい猫 → すばやい猫');
  assert.strictEqual(Core.skillFromEnemy('samurai', rnd), 'punch', 'ねこ侍 → パンチ名人');
  for (let i = 0; i < 10; i++) assert.ok(['jarashi', 'heal'].includes(Core.skillFromEnemy('nora', rnd)), 'のら猫 → じゃらし名人か癒やし猫');
  const acc = Core.acceptRecruitOffer(s, { name: 'シロ', look: 'cat-gray', from: 'すばしっこい猫', skill: 'quick' });
  assert.strictEqual(acc.vassal.skill, 'quick', '仲間入りした相手は、誘われたときの得意技のまま');
});

test('得意技: 前の保存データの家臣にも得意技がつく (番号で決まり、読み直しても変わらない)', () => {
  const raw = Object.assign(Core.createInitialState(), { vassals: [{ id: 5, name: 'ミケ', level: 2, job: 'battle', look: 'cat-gray' }] });
  const a = Core.sanitizeState(JSON.parse(JSON.stringify(raw)));
  const b2 = Core.sanitizeState(JSON.parse(JSON.stringify(raw)));
  assert.ok(Core.SKILL_KEYS.includes(a.vassals[0].skill));
  assert.strictEqual(a.vassals[0].skill, b2.vassals[0].skill);
  const kept = Core.sanitizeState(Object.assign({}, raw, { vassals: [Object.assign({}, raw.vassals[0], { skill: 'heal' })] }));
  assert.strictEqual(kept.vassals[0].skill, 'heal', 'ある得意技はそのまま');
});

test('得意技: じゃらし名人がいると夢中ゲージがたまりやすい。鍛えるほど強い', () => {
  const plain = duelWithSkills('samurai', 3, []);
  const lv1 = duelWithSkills('samurai', 3, [['jarashi', 1]]);
  const lv10 = duelWithSkills('samurai', 3, [['jarashi', 10]]);
  [plain, lv1, lv10].forEach((d) => Core.lure(d.b));
  assert.ok(lv1.e.muchu > plain.e.muchu && lv10.e.muchu > lv1.e.muchu, `${plain.e.muchu} < ${lv1.e.muchu} < ${lv10.e.muchu}`);
  assert.ok(lv1.b.events.some((ev) => ev.type === 'skill' && ev.skill === 'jarashi'), '効いたと知らせる (家臣が跳ねる)');
});

test('得意技: パンチ名人は溜めパンチ (強以上) だけ強くする。すぐ離すパンチは同じ', () => {
  const plain = duelWithSkills('nora', 3, []);
  const pm = duelWithSkills('nora', 3, [['punch', 5]]);
  for (const d of [plain, pm]) { d.e.hp = d.e.maxHp = 100000; d.e.cd = 99; }
  Core.punch(plain.b); Core.punch(pm.b);
  assert.strictEqual(plain.e.maxHp - plain.e.hp, pm.e.maxHp - pm.e.hp, 'すぐ離すパンチは同じ');
  step(plain.b, 1); step(pm.b, 1);
  for (const d of [plain, pm]) { d.e.state = 'idle'; d.e.x = Core.ENEMY_X; d.e.cd = 99; d.e.hp = d.e.maxHp; hold(d.b, 0.9); }
  const a = plain.e.maxHp - plain.e.hp, c = pm.e.maxHp - pm.e.hp;
  assert.strictEqual(c, Math.round(plain.b.player.atk * Core.CHARGE_POWER[1] * Core.skillPower('punch', 5)), `強パンチが x${Core.skillPower('punch', 5)} (${a} → ${c})`);
});

test('得意技: すばやい猫がいると溜めが早くたまる (カウンターに間に合いやすい)', () => {
  const plain = duelWithSkills('nora', 3, []);
  const q = duelWithSkills('nora', 3, [['quick', 10]]);
  for (const d of [plain, q]) { d.e.cd = 99; Core.punchPress(d.b); step(d.b, 0.6); }
  assert.strictEqual(Core.chargeLevel(plain.b.charge.t), 0, 'ふつうは 0.6 秒ではまだ強にならない');
  assert.strictEqual(Core.chargeLevel(q.b.charge.t), 1, `すばやい猫 Lv10 なら強になる (x${Core.skillPower('quick', 10)})`);
});

test('得意技: 癒やし猫は、ときどき体力を戻してくれる (満タンより上には戻らない)', () => {
  const { b, e } = duelWithSkills('nora', 3, [['heal', 5]]);
  e.cd = 999;
  b.player.hp = 10;
  step(b, Core.HEAL_INTERVAL + 0.1);
  const want = Math.round(b.player.maxHp * Core.skillPower('heal', 5));
  assert.strictEqual(b.player.hp, 10 + want, `${Core.HEAL_INTERVAL} 秒で体力 +${want}`);
  assert.ok(b.events.some((ev) => ev.type === 'skill' && ev.skill === 'heal' && ev.amount === want));
  b.player.hp = b.player.maxHp - 1;
  step(b, Core.HEAL_INTERVAL + 0.1);
  assert.strictEqual(b.player.hp, b.player.maxHp);
});

test('得意技: 効くのは出陣している家臣だけ。2 人いれば足し合わせ', () => {
  let s = stateAtRank(5);
  s.vassals = [
    { id: 1, name: 'a', level: 1, job: 'training', look: 'cat-gray', skill: 'jarashi' },
    { id: 2, name: 'b', level: 1, job: 'battle', look: 'cat-gray', skill: 'jarashi' },
    { id: 3, name: 'c', level: 1, job: 'battle', look: 'cat-gray', skill: 'jarashi' }
  ];
  const b = Core.createBattle(s, Core.mulberry32(1));
  const p = Core.skillPower('jarashi', 1);
  assert.ok(Math.abs(b.skills.lure - (1 + 2 * (p - 1))) < 1e-9, '出陣の 2 人ぶん (自主練の子は入らない)');
  assert.deepStrictEqual(Core.battleSkills([]), { lure: 1, power: 1, speed: 1, heal: 0 });
});

// ---------------------------------------------------------- 負けても強くなる (持ち帰りと修行)

test('負け: 倒した敵のぶんと、戦っていた相手に与えた傷のぶんの小判は持ち帰る。経験値 (出世) は入らない', () => {
  const s = stateAtRank(1);
  const b = Core.createBattle(s, Core.mulberry32(4));
  const e1 = untilReady(b);
  e1.hp = 1; Core.punch(b);                      // 1 匹目を倒す
  step(b, 1.5);
  const e2 = untilReady(b);
  e2.hp = Math.round(e2.maxHp / 2);              // 2 匹目は半分まで削った
  b.player.hp = 0; step(b, 0.1);                 // そこで負け
  assert.strictEqual(b.phase, 'lost');
  const want = e1.reward + Math.round(e2.reward * 0.5 * 0.5);
  assert.strictEqual(Core.lossReward(b), want);
  const r = Core.applyBattleResult(s, b);
  assert.strictEqual(r.state.merit, s.merit + want, '小判は増える');
  assert.strictEqual(r.state.totalMerit, s.totalMerit, '経験値は増えない (勝たずに出世すると、相手だけ強くなるので)');
  assert.strictEqual(r.rankedUp, false);
  assert.strictEqual(r.state.materials, s.materials + Math.round(want / 4));
  assert.strictEqual(r.state.battlesWon, s.battlesWon);
});

test('修行: 小判で体力とパンチを鍛える。1 段で +15%、値段は上がっていく。出世は下がらない', () => {
  let s = Object.assign(stateAtRank(1), { merit: 1000 });
  const b0 = Core.createBattle(s, Core.mulberry32(1));
  assert.strictEqual(Core.heroTrainCost(s, 'hp'), 10);
  s = Core.trainHero(s, 'hp').state;
  assert.strictEqual(s.merit, 990);
  assert.strictEqual(Core.heroTrainCost(s, 'hp'), 25, '上げるほど高くなる');
  s = Core.trainHero(s, 'atk').state;
  s = Core.trainHero(s, 'atk').state;
  assert.strictEqual(s.totalMerit, Core.RANKS[1].threshold, '小判を使っても出世は下がらない');
  const b1 = Core.createBattle(s, Core.mulberry32(1));
  assert.strictEqual(b1.player.maxHp, Math.round(b0.player.maxHp * 1.15));
  assert.strictEqual(b1.player.atk, Math.round(Core.playerAtk(1) * 1.3));
  assert.strictEqual(b1.enemies[0].maxHp, b0.enemies[0].maxHp, '敵は強くならない');
  assert.strictEqual(Core.trainHero(Object.assign({}, s, { merit: 5 }), 'hp').ok, false, '小判が足りないと鍛えられない');
  let full = Object.assign({}, s, { merit: 1e9 });
  for (let i = 0; i < 20; i++) full = Core.trainHero(full, 'hp').state;
  assert.strictEqual(Core.heroLevel(full, 'hp'), Core.HERO_TRAIN_MAX, `Lv${Core.HERO_TRAIN_MAX} で止まる`);
});

test('修行: 前の保存データ (修行が無い) は Lv0 から。壊れた値は直す', () => {
  const raw = Core.createInitialState();
  delete raw.hero;
  assert.deepStrictEqual(Core.sanitizeState(raw).hero, { hp: 0, atk: 0 });
  assert.deepStrictEqual(Core.sanitizeState(Object.assign(raw, { hero: { hp: 99, atk: -3 } })).hero, { hp: Core.HERO_TRAIN_MAX, atk: 0 });
});

// 挑み直しの見張り (いただいた声: 「負けても強くなったりお金がたまったりしないと、同じことの繰り返し」)。
// 負けたら持ち帰った小判で修行 (安い方から) して、もう一度。測った値 (20 人ずつ、草履取りの戦):
// 溜めない子 中央 4 回目・遅くても 6 回目で勝つ。連打 3 回目。修行しないと 10 回挑んでも勝てない子がいる
test('挑み直すと強くなる: 溜めない子でも、負けて修行すれば 10 回以内に勝てる', () => {
  const trainAll = (s) => {
    for (;;) {
      const k = Core.heroTrainCost(s, 'hp') <= Core.heroTrainCost(s, 'atk') ? 'hp' : 'atk';
      const r = Core.trainHero(s, k); if (!r.ok) return s; s = r.state;
    }
  };
  const tries = (seed, useTrain) => {
    let s = stateAtRank(1);
    for (let n = 1; n <= 10; n++) {
      const b = runBattle(s, tapper, seed * 100 + n);
      s = Core.applyBattleResult(s, b).state;
      if (b.phase === 'won') return n;
      if (useTrain) s = trainAll(s);
    }
    return 99;
  };
  const withTrain = [], without = [];
  for (let seed = 1; seed <= 20; seed++) { withTrain.push(tries(seed, true)); without.push(tries(seed, false)); }
  assert.ok(withTrain.every((n) => n <= 10), `修行すれば全員 10 回以内に勝つ (${withTrain.join(',')})`);
  assert.ok(without.filter((n) => n === 99).length >= 10, `修行しないと、10 回挑んでも勝てない子が多い (${without.filter((n) => n === 99).length}/20)`);
});

// ---------------------------------------------------------- 誘導 (大きなボス猫の突進を、猫じゃらしで樽へ)

/** 大きなボス猫と 1 対 1 で、突進の予告まで進める */
function untilRushWarn(r) {
  const { b, e } = duelWith('boss', r);
  e.hp = e.maxHp = 100000;
  for (let i = 0; i < 60 * 10 && e.state !== 'rushWarn'; i++) Core.stepBattle(b, 1 / 60);
  return { b, e };
}

test('誘導: 侍になるまで、大きなボス猫は突進してこない (樽の山も無い)', () => {
  const { b, e } = duelWith('boss', Core.YUDO_RANK - 1);
  e.hp = e.maxHp = 100000;
  const states = new Set();
  for (let i = 0; i < 60 * 12; i++) { Core.stepBattle(b, 1 / 60); states.add(e.state); b.player.hp = b.player.maxHp; }
  assert.ok(!states.has('rushWarn') && !states.has('rush'), [...states].join(','));
  assert.strictEqual(b.obstacle, null);
});

test('誘導: 侍からは、ふつうの攻撃と突進をかわりばんこにしてくる。突進の前には長い予告 (赤い「!!」)', () => {
  const { b, e } = duelWith('boss', Core.YUDO_RANK);
  e.hp = e.maxHp = 100000;
  const seq = [];
  for (let i = 0; i < 60 * 14; i++) {
    const before = e.state;
    Core.stepBattle(b, 1 / 60);
    b.player.hp = b.player.maxHp;
    if (e.state !== before && (e.state === 'rushWarn' || e.state === 'windup')) seq.push(e.state);
  }
  assert.deepStrictEqual(seq.slice(0, 4), ['rushWarn', 'windup', 'rushWarn', 'windup']);
  assert.ok(b.obstacle && b.obstacle.ok, '樽の山がある');
});

test('誘導: 予告の間に猫じゃらしを振ると、樽の山へ突っ込んで目を回す (傷を受け、動けない。こちらは無傷)', () => {
  const { b, e } = untilRushWarn(Core.YUDO_RANK);
  assert.strictEqual(Core.enemyMood(e), 'rush');
  const hp0 = b.player.hp, ehp0 = e.hp;
  Core.lure(b);
  assert.ok(b.events.some((ev) => ev.type === 'lure' && ev.result === 'yudo'), '誘導できた');
  step(b, Core.RUSH_WARN + Core.RUSH_TIME + 0.05);
  assert.ok(b.events.some((ev) => ev.type === 'crash'), 'ドカーン');
  assert.strictEqual(b.player.hp, hp0, 'こちらは無傷');
  assert.strictEqual(ehp0 - e.hp, Math.round(e.maxHp * Core.CRASH_DMG), 'ぶつかった傷');
  assert.strictEqual(e.state, 'charmed', '目を回して動けない (MAX と同じ)');
  assert.ok(e.dizzy);
  assert.strictEqual(b.obstacle.ok, false, '樽はこわれる');
  // 目を回している間の溜めパンチは MAX と同じく大ダメージ
  const before = e.hp;
  hold(b, 0.45);
  assert.strictEqual(before - e.hp, Math.round(b.player.atk * Core.CHARGE_POWER[1] * Core.MAX_MUL));
  // 樽は少しすると運んでくる
  step(b, Core.OBSTACLE_RESPAWN + 0.1);
  assert.strictEqual(b.obstacle.ok, true);
});

test('誘導: 振らないと突進が当たる (ふつうの攻撃より痛い)。樽がこわれている間は誘導できない', () => {
  const a = untilRushWarn(Core.YUDO_RANK);
  const hp0 = a.b.player.hp;
  step(a.b, Core.RUSH_WARN + Core.RUSH_TIME + 0.05);
  assert.strictEqual(hp0 - a.b.player.hp, Math.round(a.e.atk * Core.RUSH_MUL));
  const c = untilRushWarn(Core.YUDO_RANK);
  c.b.obstacle.ok = false; c.b.obstacle.respawn = 99;
  Core.lure(c.b);
  assert.ok(!c.b.events.some((ev) => ev.type === 'lure' && ev.result === 'yudo'));
  const hp1 = c.b.player.hp;
  step(c.b, Core.RUSH_WARN + Core.RUSH_TIME + 0.05);
  assert.ok(c.b.player.hp < hp1, '樽が無ければ突進が当たる');
});

test('誘導: 突進は、溜めパンチで吹っ飛ばしても止まらない (猫じゃらしで誘導するしかない)', () => {
  const { b, e } = untilRushWarn(Core.YUDO_RANK);
  Core.punchPress(b); step(b, 0.85); Core.punchRelease(b);
  assert.notStrictEqual(e.state, 'knock');
  const hp0 = b.player.hp;
  step(b, Core.RUSH_WARN + Core.RUSH_TIME);
  assert.ok(b.player.hp < hp0);
});

// 手ごたえの見張り。数字は各段位 30 回ずつ実際に戦わせて測った値をもとに線を引いた
// (下手: r0 30/30 残67%、r1 以上 0/30。溜めない: r0 30/30、r1・r2 9/30、r3 以上 0/30。
//  ふつう: 全段位 30/30 残24〜67%。上手: 全段位 30/30)
test('手ごたえ: パンチ連打は最初の戦だけ。溜めパンチを使えば全段位で勝てる', () => {
  const wins = (r, bot) => {
    let w = 0;
    for (let seed = 1; seed <= 30; seed++) if (runBattle(stateAtRank(r), bot, seed).phase === 'won') w++;
    return w;
  };
  assert.strictEqual(wins(0, masher), 30, '村の子猫はパンチ連打で勝てる');
  assert.ok(wins(3, masher) <= 3, 'パンチ連打だけでは足軽の戦に勝てない (連打でカウンターを拾えない)');
  assert.ok(wins(3, tapper) <= 3, '溜めずに殴るだけでは足軽の戦に勝てない (溜めパンチに意味がある)');
  for (let r = 0; r < Core.RANKS.length; r++) {
    assert.ok(wins(r, casual) >= 26, `ふつうに遊べば勝てる (段位${r})`);
    assert.ok(wins(r, skilled) >= 29, `上手に遊べば勝てる (段位${r})`);
  }
  // 誘導に意味があること: 突進の予告で振らない「ふつう」は、大名の戦で勝てない回が出る (測った値 18/30)。
  // 振る「ふつう」は 30/30
  const noYudo = { press(b) { const e = Core.currentEnemy(b); return e && e.state === 'rushWarn' ? false : casual.press(b); }, release: casual.release };
  assert.ok(wins(9, noYudo) <= 25, '突進を誘導しないと、大名の戦で勝てない回が出る');
  // 猫じゃらしを使えば無傷、にならないこと (測った値: どの段位も 30/30 が殴られる)
  for (const r of [1, 4, 8]) {
    let hurt = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const b = runBattle(stateAtRank(r), casual, seed);
      if (b.player.hp < b.player.maxHp) hurt++;
    }
    assert.ok(hurt >= 28, `ふつうに遊んでも、たいていは殴られる (段位${r}: ${hurt}/30)`);
  }
});

test('家臣の名前は、空いている名前があればかぶらない', () => {
  let s = stateAt(1000000, { castle: { cells: ['mansion', 'mansion', 'mansion', 'mansion'].concat(new Array(Core.MAP_CELLS - 4).fill(null)) } });
  const rng = Core.mulberry32(21);
  for (let i = 0; i < Core.VASSAL_NAMES.length; i++) s = Core.recruitVassal(s, rng).state;
  const names = s.vassals.map((v) => v.name);
  assert.strictEqual(new Set(names).size, Core.VASSAL_NAMES.length, names.join(','));
});

// ---------------------------------------------------------- 城と村 (マスに建てる)

function townState(extra) {
  return stateAt(5000, Object.assign({ materials: 100000 }, extra || {})); // 城主
}
function build(s, zone, idx, type) {
  const r = Core.placeBuilding(s, zone, idx, type);
  assert.strictEqual(r.ok, true, `${type} を ${zone}[${idx}] に建てられるはず`);
  return r.state;
}

test('城と村: 城主になるまで建てられない', () => {
  const s = stateAt(1000, { materials: 100000 });
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 0, 'keep'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', 0, 'house'), false);
});

test('城と村: 建物は決まった場所にしか建てられない (お城は城、民家は村)', () => {
  const s = townState();
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', 0, 'keep'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 0, 'house'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 0, 'keep'), true);
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', 0, 'house'), true);
});

test('城と村: 空いているマスにしか建てられない。マスの外にも建てられない', () => {
  let s = build(townState(), 'village', 5, 'house');
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', 5, 'farm'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', -1, 'farm'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', Core.MAP_CELLS, 'farm'), false);
});

test('城と村: 数に上限のある建物 (お城は1つ)', () => {
  let s = build(townState(), 'castle', 0, 'keep');
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 1, 'keep'), false);
  assert.strictEqual(Core.isCastleComplete(s), true);
});

test('城と村: 資材が足りないと建てられず、建てると資材が減る', () => {
  const poor = townState({ materials: 10 });
  assert.strictEqual(Core.placeBuilding(poor, 'castle', 0, 'keep').ok, false);
  const s0 = townState({ materials: 1000 });
  const r = Core.placeBuilding(s0, 'castle', 0, 'keep');
  assert.strictEqual(r.state.materials, 1000 - Core.BUILDINGS.keep.cost);
});

test('城と村: 民家は建てるほど高くなり、村人猫の上限が増える', () => {
  let s = townState();
  const c0 = Core.buildingCost(s, 'house');
  const cap0 = Core.villageCapacity(s);
  s = build(s, 'village', 0, 'house');
  assert.ok(Core.buildingCost(s, 'house') > c0);
  assert.strictEqual(Core.villageCapacity(s), cap0 + 8);
  s = build(s, 'village', 1, 'well');
  assert.strictEqual(Core.villageCapacity(s), cap0 + 11);
});

test('城と村: 取り壊すとマスが空き、元の値段の半分が戻る', () => {
  let s = build(townState({ materials: 1000 }), 'castle', 3, 'armory');
  const before = s.materials;
  const r = Core.demolish(s, 'castle', 3);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.castle.cells[3], null);
  assert.strictEqual(r.state.materials, before + Math.floor(Core.BUILDINGS.armory.cost / 2));
  assert.strictEqual(Core.demolish(r.state, 'castle', 3).ok, false, '空きマスは取り壊せない');
});

test('城と村: 民家を壊して上限を割ったら、村人猫は上限まで減る', () => {
  let s = build(townState(), 'village', 0, 'house');
  s = Object.assign({}, s, { village: Object.assign({}, s.village, { population: Core.villageCapacity(s) }) });
  const r = Core.demolish(s, 'village', 0);
  assert.strictEqual(r.state.village.population, Core.villageCapacity(r.state));
});

test('城と村の効果: 猫侍の屋敷で家臣の枠が増える', () => {
  const s = townState();
  const base = Core.vassalSlots(s);
  assert.strictEqual(Core.vassalSlots(build(s, 'castle', 0, 'mansion')), base + 2);
});

test('城と村の効果: 武器屋でパンチ、見張り台と温泉で体力、お城と商店で手柄が増える', () => {
  const s = townState();
  const b0 = Core.createBattle(s, Core.mulberry32(1));
  let t = build(s, 'castle', 0, 'armory');
  t = build(t, 'castle', 1, 'tower');
  t = build(t, 'village', 0, 'onsen');
  t = build(t, 'castle', 2, 'keep');
  t = build(t, 'village', 1, 'shop');
  const b1 = Core.createBattle(t, Core.mulberry32(1));
  assert.strictEqual(b1.player.atk, Math.round(b0.player.atk * 1.15));
  assert.strictEqual(b1.player.maxHp, Math.round(b0.player.maxHp * 1.3));
  assert.strictEqual(b1.enemies[0].reward, Math.round(b0.enemies[0].reward * 1.3));
});

test('城と村の効果: 訓練場で自主練、厩舎で普請、工房で資材ぜんぶが増える', () => {
  let s = townState({ materials: 0 });
  s = Core.recruitVassal(Object.assign({}, s, { materials: 100000 }), Core.mulberry32(1)).state;
  s = Core.recruitVassal(s, Core.mulberry32(2)).state;
  s = Core.assignVassalJob(s, s.vassals[1].id, 'labor').state;
  const meritGain = (x) => Core.tick(x, 10).merit - x.merit;
  const matGain = (x) => Core.tick(x, 10).materials - x.materials;
  const m0 = meritGain(s), g0 = matGain(s);
  assert.ok(meritGain(build(s, 'castle', 0, 'dojo')) > m0 * 1.4, '訓練場');
  assert.ok(matGain(build(s, 'castle', 0, 'stable')) > g0 * 1.1, '厩舎');
  const w = build(s, 'village', 0, 'workshop');
  assert.ok(matGain(w) > g0 * 1.4, '工房');
});

test('城と村の効果: 田んぼとかざりで村人猫が早く増える (かざりは +50% まで)', () => {
  let s = build(townState(), 'village', 0, 'house');
  const grow = (x) => Core.tick(x, 1).village.population - x.village.population;
  const g0 = grow(s);
  assert.ok(grow(build(s, 'village', 1, 'rice')) > g0 * 1.25, '田んぼ');
  let d = s;
  for (let i = 0; i < 20; i++) d = build(d, 'village', 2 + i, 'straw');
  assert.strictEqual(Core.townEffects(d).growthMul, 1.5, 'かざり20個でも +50% まで');
});

test('前の版の保存データ (城4x4・家の数) は、新しいマスへ引っ越す', () => {
  const old = {
    merit: 5000, totalMerit: 5000, materials: 10,
    village: { houses: 3, population: 20 },
    castle: { cells: ['keep', 'barracks', null, 'storehouse', 'well', 'wall'].concat(new Array(10).fill(null)) }
  };
  const s = Core.sanitizeState(old);
  assert.strictEqual(s.castle.cells.length, Core.MAP_CELLS);
  assert.strictEqual(Core.countBuildings(s, 'keep'), 1);
  assert.strictEqual(Core.countBuildings(s, 'mansion'), 1, '長屋 → 猫侍の屋敷');
  assert.strictEqual(Core.countBuildings(s, 'stonewall'), 1, '塀 → 城の石垣');
  assert.strictEqual(Core.countBuildings(s, 'workshop'), 1, '蔵 → 工房');
  assert.strictEqual(Core.countBuildings(s, 'well'), 1);
  assert.strictEqual(Core.countBuildings(s, 'house'), 3, '家の数 → 民家');
  assert.strictEqual(s.village.population, 20);
  const again = Core.sanitizeState(JSON.parse(JSON.stringify(s)));
  assert.deepStrictEqual(again, s, '新しい形は読み直しても変わらない');
});
