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
  assert.strictEqual(restored.castle.cells.length, Core.CASTLE_CELLS);
});

test('古い保存データに新しい項目が無くても補われる', () => {
  const restored = Core.sanitizeState({ merit: 500 });
  assert.strictEqual(restored.merit, 500);
  assert.strictEqual(restored.village.population, 0);
  assert.strictEqual(restored.village.cells.length, Core.MAP_CELLS);
  assert.strictEqual(restored.castle.cells.length, Core.CASTLE_CELLS);
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
    return e.state === 'charmed' ? Core.punch(b) : Core.lure(b);
  },
  release: () => true
};
// ふつう: 「!」を気にせず猫じゃらしを振り、MAX になったら強パンチまで溜めて離す
const casual = {
  press(b) {
    const e = Core.currentEnemy(b); if (!e || b.charge.on) return false;
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
  Core.toMax(e, 4);
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
  Core.toMax(e, 4);
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

test('合戦: 倒すと少し間をおいて次の敵が出てくる。最後の1匹が倒れたら勝ち', () => {
  const b = Core.createBattle(stateAtRank(0), Core.mulberry32(3));
  for (let n = 0; n < b.enemies.length; n++) {
    const e = untilReady(b);
    assert.strictEqual(b.current, n, `${n + 1}匹目が出てくる`);
    e.hp = 1;
    b.cd.lure = 0; b.cd.punch = 0;
    Core.toMax(e, 4);
    Core.punch(b);
    assert.strictEqual(e.state, 'down');
    if (n === b.enemies.length - 1) assert.strictEqual(b.phase, 'fight', '倒れる様子を見せてから終わる');
    for (let i = 0; i < 60 * 1.5; i++) Core.stepBattle(b, 1 / 60);
  }
  assert.strictEqual(b.phase, 'won');
});

test('合戦: 勝つと手柄・資材が入る。出世もする', () => {
  const s = stateAtRank(0);
  const b = runBattle(s, casual, 1);
  assert.strictEqual(b.phase, 'won');
  assert.ok(b.merit > 0 && b.bonus > 0 && b.materials > 0);
  const r = Core.applyBattleResult(s, b);
  assert.strictEqual(r.state.totalMerit, s.totalMerit + b.merit + b.bonus);
  assert.strictEqual(r.state.materials, s.materials + b.materials);
  assert.strictEqual(r.state.battlesWon, 1);
  assert.strictEqual(r.rankedUp, true, '村の子猫は1勝で出世する');
});

test('合戦: 体力が0になると負け。何も減らない', () => {
  const s = stateAtRank(5);
  const b = Core.createBattle(s, Core.mulberry32(10));
  b.player.hp = 5;
  for (let i = 0; i < 60 * 120 && b.phase === 'fight'; i++) Core.stepBattle(b, 1 / 60); // 何もしない
  assert.strictEqual(b.phase, 'lost');
  const r = Core.applyBattleResult(s, b);
  assert.deepStrictEqual(r.state, s);
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
  Core.toMax(e, 4); // どの種類の敵でも 4 秒夢中
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
/** 城の使える土地 (はじめは 10x10 の真ん中 8x8) の n 番目のマス */
const CC = (n) => Core.openCells(Core.createInitialState(1), 'castle')[n];
/** 村の使える土地 (はじめは 10x10 の真ん中 8x8) の n 番目のマス */
const VC = (n) => Core.openCells(Core.createInitialState(1), 'village')[n];
function build(s, zone, idx, type) {
  const r = Core.placeBuilding(s, zone, idx, type);
  assert.strictEqual(r.ok, true, `${type} を ${zone}[${idx}] に建てられるはず`);
  return r.state;
}

test('城と村: 城主になるまで建てられない', () => {
  const s = stateAt(1000, { materials: 100000 });
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', CC(0), 'keep'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', VC(0), 'house'), false);
});

test('城と村: 建物は決まった場所にしか建てられない (お城は城、民家は村)', () => {
  const s = townState();
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', VC(0), 'keep'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', CC(0), 'house'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', CC(0), 'keep'), true);
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', VC(0), 'house'), true);
});

test('城と村: 空いているマスにしか建てられない。マスの外にも建てられない', () => {
  let s = build(townState(), 'village', VC(5), 'house');
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', VC(5), 'farmhouse'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', VC(6), 'farmhouse'), true);
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', -1, 'farmhouse'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', Core.MAP_CELLS, 'farmhouse'), false);
  assert.strictEqual(Core.canPlaceBuilding(s, 'village', 0, 'farmhouse'), false, '村も、はじめは真ん中の 8x8 だけ');
});

test('城と村: 数に上限のある建物 (お城は1つ)', () => {
  let s = build(townState(), 'castle', CC(0), 'keep');
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', CC(1), 'keep'), false);
  assert.strictEqual(Core.isCastleComplete(s), true);
});

test('城と村: 資材が足りないと建てられず、建てると資材が減る', () => {
  const poor = townState({ materials: 10 });
  assert.strictEqual(Core.placeBuilding(poor, 'castle', CC(0), 'keep').ok, false);
  const s0 = townState({ materials: 1000 });
  const r = Core.placeBuilding(s0, 'castle', CC(0), 'keep');
  assert.strictEqual(r.state.materials, 1000 - Core.BUILDINGS.keep.cost);
});

test('城と村: 民家は建てるほど高くなり、村人猫の上限が増える', () => {
  let s = townState();
  const c0 = Core.buildingCost(s, 'house');
  const cap0 = Core.villageCapacity(s);
  s = build(s, 'village', VC(0), 'house');
  assert.ok(Core.buildingCost(s, 'house') > c0);
  assert.strictEqual(Core.villageCapacity(s), cap0 + 8);
  s = build(s, 'village', VC(1), 'well');
  assert.strictEqual(Core.villageCapacity(s), cap0 + 11);
});

test('城と村: 取り壊すとマスが空き、元の値段の半分が戻る', () => {
  let s = build(townState({ materials: 1000 }), 'castle', CC(3), 'armory');
  const before = s.materials;
  const r = Core.demolish(s, 'castle', CC(3));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.castle.cells[CC(3)], null);
  assert.strictEqual(r.state.materials, before + Math.floor(Core.BUILDINGS.armory.cost / 2));
  assert.strictEqual(Core.demolish(r.state, 'castle', CC(3)).ok, false, '空きマスは取り壊せない');
});

test('城と村: 民家を壊して上限を割ったら、村人猫は上限まで減る', () => {
  let s = build(townState(), 'village', VC(0), 'house');
  s = Object.assign({}, s, { village: Object.assign({}, s.village, { population: Core.villageCapacity(s) }) });
  const r = Core.demolish(s, 'village', VC(0));
  assert.strictEqual(r.state.village.population, Core.villageCapacity(r.state));
});

test('城と村の効果: 猫侍の屋敷で家臣の枠が増える', () => {
  const s = townState();
  const base = Core.vassalSlots(s);
  assert.strictEqual(Core.vassalSlots(build(s, 'castle', CC(0), 'mansion')), base + 2);
});

test('城と村の効果: 武器屋でパンチ、見張り台で体力、お城で手柄が増える。村の商店・温泉は合戦を強くしない', () => {
  const s = townState();
  const b0 = Core.createBattle(s, Core.mulberry32(1));
  let t = build(s, 'castle', CC(0), 'armory');
  t = build(t, 'castle', CC(1), 'tower');
  t = build(t, 'castle', CC(2), 'keep');
  const b1 = Core.createBattle(t, Core.mulberry32(1));
  assert.strictEqual(b1.player.atk, Math.round(b0.player.atk * 1.15));
  assert.strictEqual(b1.player.maxHp, Math.round(b0.player.maxHp * 1.1));
  assert.strictEqual(b1.enemies[0].reward, Math.round(b0.enemies[0].reward * 1.2));
  // 村は「増える所」。合戦を強くする効き目は城だけ (城と村の役割を分けた)
  let v = build(build(build(t, 'village', VC(0), 'training'), 'village', VC(1), 'shop'), 'village', VC(2), 'varmory');
  v = build(build(v, 'village', VC(3), 'inn'), 'village', VC(4), 'diner');
  const b2 = Core.createBattle(v, Core.mulberry32(1));
  assert.deepStrictEqual([b2.player.atk, b2.player.maxHp, b2.enemies[0].reward], [b1.player.atk, b1.player.maxHp, b1.enemies[0].reward]);
});

test('村: 村人猫が兵に志願する。天下で国を任される前は、見習いとして 2000 匹まで村で待つ', () => {
  // 民家 5 軒で上限 50 匹。村人猫 50 匹
  let s = townState();
  for (let i = 30; i < 35; i++) s = build(s, 'village', VC(i), 'house');
  s = Object.assign({}, s, { village: Object.assign({}, s.village, { population: 50 }) });
  const out = Core.villageOutput(s);
  assert.ok(Math.abs(out.troops - 0.25) < 1e-9, `村人猫 50 匹で 1 秒に 0.25 匹 (${out.troops})`);
  const a = Core.tick(s, 60);
  assert.ok(Math.abs(a.village.recruits - 15) < 1e-6, `1 分で 15 匹待つ (${a.village.recruits})`);
  const b = Core.tick(s, 8 * 3600);
  assert.strictEqual(b.village.recruits, Core.RECRUIT_WAIT_CAP, '待つのは 2000 匹まで');
  // 国を任されると、100 匹そろうごとに、はじめの国へ行く (端数は村に残る)
  const r = Core.startRealm(b, 23, Core.mulberry32(1)).state;
  const t0 = Core.troopsAt(r, 23);
  const c = Core.tick(r, 1);
  assert.strictEqual(Core.troopsAt(c, 23) - t0, 2000, '待っていた 2000 匹がはじめの国へ');
  assert.ok(c.village.recruits > 0 && c.village.recruits < 100, `端数は村に残る (${c.village.recruits})`);
  assert.strictEqual(Core.troopsAt(c, 23) % 100, 0, '兵は 100 匹ずつ');
  const d = Core.tick(c, 1200);
  assert.strictEqual(Core.troopsAt(d, 23) - Core.troopsAt(c, 23), 300, '20 分で 300 匹 (村人猫 50 匹)');
});

test('村: 訓練所・馬小屋で志願する兵が増え、商店 1 軒ごとに村人猫の数に応じた小判が入る (経験値にはならない)', () => {
  let s = townState();
  for (let i = 30; i < 35; i++) s = build(s, 'village', VC(i), 'house');
  s = Object.assign({}, s, { village: Object.assign({}, s.village, { population: 50 }) });
  const t0 = Core.villageOutput(s).troops;
  assert.ok(Math.abs(Core.villageOutput(build(s, 'village', VC(0), 'training')).troops - t0 * 1.4) < 1e-9, '訓練所 +40%');
  assert.ok(Math.abs(Core.villageOutput(build(s, 'village', VC(0), 'vstable')).troops - t0 * 1.25) < 1e-9, '馬小屋 +25%');
  assert.strictEqual(Core.villageOutput(s).coins, 0, '商店が無いと小判は入らない');
  const one = build(s, 'village', VC(0), 'shop'), two = build(one, 'village', VC(1), 'shop');
  assert.ok(Math.abs(Core.villageOutput(one).coins - 0.125) < 1e-9, `村人猫 50 匹・商店 1 軒で 1 秒に小判 0.125 (${Core.villageOutput(one).coins})`);
  assert.ok(Math.abs(Core.villageOutput(two).coins - 0.25) < 1e-9, '2 軒で倍');
  const a = Core.tick(two, 100);
  assert.ok(Math.abs(a.merit - two.merit - 25) < 1e-6, `100 秒で小判が 25 入る (${(a.merit - two.merit).toFixed(1)})`);
  assert.strictEqual(a.totalMerit, two.totalMerit, '経験値にはならない');
});

test('村: 見習いの兵は保存して読み直しても残り、国を任される前なら 2000 匹までに直す', () => {
  const s = townState();
  const raw = JSON.parse(JSON.stringify(Object.assign({}, s, { village: Object.assign({}, s.village, { recruits: 5000 }) })));
  assert.strictEqual(Core.sanitizeState(raw).village.recruits, Core.RECRUIT_WAIT_CAP);
  raw.village.recruits = 123.5;
  assert.strictEqual(Core.sanitizeState(raw).village.recruits, 123.5);
  raw.village.recruits = 'x';
  assert.strictEqual(Core.sanitizeState(raw).village.recruits, 0);
});

test('城と村の効果: 訓練場で自主練、厩舎で普請、工房で資材ぜんぶが増える', () => {
  let s = townState({ materials: 0 });
  s = Core.recruitVassal(Object.assign({}, s, { materials: 100000 }), Core.mulberry32(1)).state;
  s = Core.recruitVassal(s, Core.mulberry32(2)).state;
  s = Core.assignVassalJob(s, s.vassals[1].id, 'labor').state;
  const meritGain = (x) => Core.tick(x, 10).merit - x.merit;
  const matGain = (x) => Core.tick(x, 10).materials - x.materials;
  const m0 = meritGain(s), g0 = matGain(s);
  assert.ok(meritGain(build(s, 'castle', CC(0), 'dojo')) > m0 * 1.4, '訓練場');
  assert.ok(matGain(build(s, 'castle', CC(0), 'stable')) > g0 * 1.1, '厩舎');
  const w = build(s, 'village', VC(0), 'workshop');
  assert.ok(matGain(w) > g0 * 1.4, '工房');
});

test('村: 食料 = 作る量 ÷ 村人猫。村人猫は食料のぶんまでは早く増え、それより多くはほとんど増えない (減りはしない)', () => {
  let s = townState();
  for (let i = 0; i < 5; i++) s = build(s, 'village', VC(i), 'house');      // 上限 50
  const pop = (x, n) => Object.assign({}, x, { village: Object.assign({}, x.village, { population: n }) });
  assert.strictEqual(Core.villageFood(pop(s, 10)).ratio, 1, 'はじめの畑 (10) で 10 匹は足りる');
  assert.strictEqual(Core.villageFood(pop(s, 40)).ratio, 0.25, '40 匹には 4 分の 1');
  assert.strictEqual(Core.villageFood(pop(s, 0)).ratio, 1, '村人猫がいないときは 100%');
  // 田畑が無いと、民家があっても 10 匹ほどで止まる (1 時間でも 14 匹)
  let a = pop(s, 2);
  for (let k = 0; k < 3600; k++) a = Core.tick(a, 1);
  assert.ok(a.village.population >= 10 && a.village.population < 15, `田畑が無いと 1 時間で ${a.village.population.toFixed(1)} 匹`);
  // 農家・田んぼ・果樹園で 40 → 40 匹まですぐ増える
  let b = build(build(build(pop(s, 2), 'village', VC(10), 'farmhouse'), 'village', VC(11), 'paddy'), 'village', VC(12), 'orchard');
  assert.strictEqual(Core.villageFood(b).made, 40, '10 + 農家 12 + 田んぼ 8 + 果樹園 10');
  for (let k = 0; k < 120; k++) b = Core.tick(b, 1);
  assert.ok(b.village.population >= 39.9 && b.village.population <= 40.2, `食料があると 2 分で 40 匹まで (${b.village.population.toFixed(1)})`);
  // 食料が減っても (田畑を壊しても) 村人猫は減らない
  const c = Core.tick(Core.demolish(b, 'village', VC(10)).state, 60);
  assert.ok(c.village.population >= b.village.population, '田畑を壊しても減らない');
  assert.strictEqual(Core.villageFood(build(b, 'village', VC(13), 'vricehouse')).made, 48, '米蔵 +20%');
});

test('村: 幸福度は 50% から、かざり・見張り台で 100% まで上がり、兵と小判が 1〜1.5 倍になる', () => {
  let s = townState();
  for (let i = 0; i < 5; i++) s = build(s, 'village', VC(i), 'house');
  s = build(s, 'village', VC(5), 'shop');
  s = Object.assign({}, s, { village: Object.assign({}, s.village, { population: 50 }) });
  assert.strictEqual(Core.villageHappiness(s), 50);
  const o0 = Core.villageOutput(s);
  let d = build(build(s, 'village', VC(6), 'sakura'), 'village', VC(7), 'vtower');
  assert.strictEqual(Core.villageHappiness(d), 65, '桜 +5・見張り台 +10');
  for (let i = 0; i < 20; i++) d = build(d, 'village', VC(10 + i), 'stall');
  assert.strictEqual(Core.villageHappiness(d), 100, 'かざりをたくさん建てても 100% まで');
  const o1 = Core.villageOutput(d);
  assert.ok(Math.abs(o1.troops - o0.troops * 1.5) < 1e-9 && Math.abs(o1.coins - o0.coins * 1.5) < 1e-9, '兵と小判が 1.5 倍');
  // 城のかざりは見た目だけ (幸福度は村のかざりで決まる)
  assert.strictEqual(Core.villageHappiness(build(s, 'castle', CC(0), 'csakura')), 50);
});

test('村: 村人猫がいちばん多かったときの数で、土地が 8x8 → 9x9 (40 匹) → 10x10 (90 匹) に広がり、減っても狭くならない', () => {
  let s = townState();
  assert.deepStrictEqual(Core.openArea(s, 'village'), { o: 1, n: 8, size: 10 });
  const pop = (x, n) => Object.assign({}, x, { village: Object.assign({}, x.village, { population: n }) });
  for (let i = 0; i < 5; i++) s = build(s, 'village', VC(i), 'house');
  let t = Core.tick(pop(s, 41), 0.01);
  assert.deepStrictEqual(Core.openArea(t, 'village'), { o: 0, n: 9, size: 10 });
  assert.strictEqual(Core.villageNextOpen(t), 90);
  // 民家を壊して村人猫が減っても、土地は狭くならない
  for (let i = 0; i < 5; i++) t = Core.demolish(t, 'village', VC(i)).state;
  t = Core.tick(t, 1);
  assert.ok(t.village.population <= 10 && Core.openArea(t, 'village').n === 9, `村人猫 ${Math.floor(t.village.population)} 匹でも 9x9 のまま`);
  // 保存して読み直しても同じ
  assert.strictEqual(Core.openArea(Core.sanitizeState(JSON.parse(JSON.stringify(t))), 'village').n, 9);
});

test('村: 前の版 (6x6) の村は真ん中へ引っ越し、前の建物は新しい建物になる (温泉は訓練所)', () => {
  const s = townState();
  const old = new Array(36).fill(null);
  old[0] = 'house'; old[1] = 'farm'; old[2] = 'rice'; old[3] = 'onsen'; old[4] = 'workshop'; old[5] = 'shop'; old[6] = 'straw'; old[35] = 'nobori';
  const raw = JSON.parse(JSON.stringify(Object.assign({}, s, { village: { population: 12, cells: old } })));
  const v = Core.sanitizeState(raw);
  const at = (gx, gy) => v.village.cells[(gy + 2) * 10 + gx + 2];
  assert.deepStrictEqual([at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(4, 0), at(5, 0), at(0, 1), at(5, 5)],
    ['house', 'farmhouse', 'paddy', 'training', 'workshop', 'shop', 'scarecrow', 'vnobori']);
  assert.ok(v.village.cells.every((c, i) => c === null || Core.isOpenCell(v, 'village', i)), '引っ越した物はみな使える土地の中');
  assert.strictEqual(v.village.peak, 12);
});

test('建物の名前 (種類の鍵) は、城と村で重ならない', () => {
  // 前は城の「橋」と村の「橋」が同じ鍵 (bridge) で、あとに書いた村の方だけが残り、城では橋を建てられなかった
  const src = require('fs').readFileSync(require('path').join(__dirname, 'core.js'), 'utf8');
  const body = src.slice(src.indexOf('const BUILDINGS = {'), src.indexOf('function decoEffect'));
  const keys = [...body.matchAll(/^ {4}(\w+): \{ zone:/gm)].map((m) => m[1]);
  assert.ok(keys.length > 60, `鍵を ${keys.length} 個読めた`);
  assert.deepStrictEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], '重なる鍵が無い');
  assert.strictEqual(Core.BUILDINGS.cbridge.zone, 'castle');
});

test('城: 10x10 のマスのうち、はじめは真ん中の 8x8 だけ使える。城レベルが上がると 9x9 → 10x10 に広がる', () => {
  let s = townState();
  assert.strictEqual(s.castle.cells.length, 100);
  assert.deepStrictEqual(Core.openArea(s, 'castle'), { o: 1, n: 8, size: 10 });
  assert.strictEqual(Core.openCells(s, 'castle').length, 64);
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 0, 'flags'), false, 'いちばん奥の角 (まだ使えない)');
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 11, 'flags'), true, '8x8 の奥の角');
  assert.strictEqual(Core.openArea(s, 'village').n, 8, '村は村人猫の数で広がる (城レベルとは別)');
  // 建てると経験値 (値段ぶん) が入り、区切りを越えるとレベルが上がる
  assert.strictEqual(Core.castleLevel(s), 1);
  let r = Core.placeBuilding(s, 'castle', CC(0), 'keep');   // 300
  assert.ok(r.ok && r.leveledUp);
  assert.strictEqual(r.state.castle.xp, 300);
  assert.strictEqual(Core.castleLevel(r.state), 2);
  r = Core.placeBuilding(r.state, 'castle', CC(1), 'armory'); // 420 → レベル 3 (9x9)
  assert.ok(r.leveledUp && Core.castleLevel(r.state) === 3);
  s = r.state;
  assert.deepStrictEqual(Core.openArea(s, 'castle'), { o: 0, n: 9, size: 10 });
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 0, 'flags'), true, '広がった所に建てられる');
  assert.strictEqual(s.castle.cells[CC(0)], 'keep', '前に建てた物はそのまま (広がっても前の土地を含む)');
  // 取り壊しても経験値は減らない
  const d = Core.demolish(s, 'castle', CC(1)).state;
  assert.strictEqual(d.castle.xp, 420);
  // いちばん上の段で 10x10
  const top = Object.assign({}, s, { castle: Object.assign({}, s.castle, { xp: Core.CASTLE_LEVELS[Core.CASTLE_LEVELS.length - 1].xp }) });
  assert.deepStrictEqual(Core.openArea(top, 'castle'), { o: 0, n: 10, size: 10 });
  assert.strictEqual(Core.castleLevelInfo(top).next, null);
  const info = Core.castleLevelInfo(s);
  assert.deepStrictEqual([info.level, info.xp, info.from, info.next], [3, 420, 400, 700]);
});

test('城: 大きな土台は 2x2 マスを使う。どのマスを押しても丸ごと取り壊せる。保存して読み直しても形が崩れない', () => {
  let s = townState();
  const a = 2 * 10 + 2;   // (2,2)
  assert.deepStrictEqual(Core.footprint('castle', a, 2), [22, 23, 32, 33]);
  s = build(s, 'castle', a, 'base');
  assert.deepStrictEqual([22, 23, 32, 33].map((i) => s.castle.cells[i]), ['base', '+22', '+22', '+22']);
  assert.strictEqual(Core.countBuildings(s, 'base'), 1);
  assert.strictEqual(Core.anchorOf(s, 'castle', 33), 22);
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 33, 'flags'), false, '使っているマスには建てられない');
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 11, 'base'), false, '重なる所には置けない (11 から 2x2 は 22 にかかる)');
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 88, 'base'), false, '使える土地 (8x8) からはみ出す所には置けない');
  assert.strictEqual(Core.canPlaceBuilding(s, 'castle', 77, 'base'), true);
  const back = Core.sanitizeState(JSON.parse(JSON.stringify(s)));
  assert.deepStrictEqual(back.castle.cells, s.castle.cells, '読み直しても印がそろう');
  const d = Core.demolish(s, 'castle', 33);
  assert.ok(d.ok && [22, 23, 32, 33].every((i) => d.state.castle.cells[i] === null), '印のマスを押しても丸ごと取り壊す');
  // 壊れた保存: 印だけ・重なり
  const broken = JSON.parse(JSON.stringify(s)); broken.castle.cells[44] = '+5'; broken.castle.cells[23] = 'flags';
  const fixed = Core.sanitizeState(broken);
  assert.strictEqual(fixed.castle.cells[44], null, '元の無い印は捨てる');
  assert.strictEqual(fixed.castle.cells[22], null, '重なる大きな土台は捨てる');
  assert.strictEqual(fixed.castle.cells[23], 'flags');
});

test('城: 天守の姿は城レベルと天下統一で開き、開いた物だけ選べる (見た目だけ)', () => {
  let s = townState();
  const open = (st) => Core.KEEP_STYLES.filter((k) => Core.isKeepStyleOpen(st, k.id)).map((k) => k.id);
  assert.deepStrictEqual(open(s), ['normal', 'white', 'black']);
  assert.strictEqual(Core.setKeepStyle(s, 'blue').ok, false);
  s = Object.assign({}, s, { castle: Object.assign({}, s.castle, { xp: 1200 }) });
  assert.deepStrictEqual(open(s), ['normal', 'white', 'black', 'blue', 'red', 'sakura']);
  const r = Core.setKeepStyle(s, 'red');
  assert.ok(r.ok && Core.keepStyle(r.state) === 'red');
  assert.strictEqual(Core.setKeepStyle(s, 'gold').ok, false, '金のシャチホコは天下統一から');
  const u = Object.assign({}, s, { realm: Object.assign({}, s.realm || {}, { unified: true }) });
  assert.ok(Core.setKeepStyle(u, 'gold').ok && Core.setKeepStyle(u, 'moon').ok);
  // 保存して読み直しても姿が残る
  assert.strictEqual(Core.keepStyle(Core.sanitizeState(JSON.parse(JSON.stringify(r.state)))), 'red');
  // 合戦の強さは変わらない
  const b0 = Core.createBattle(build(townState(), 'castle', CC(0), 'keep'), Core.mulberry32(1));
  const b1 = Core.createBattle(Core.setKeepStyle(build(townState(), 'castle', CC(0), 'keep'), 'white').state, Core.mulberry32(1));
  assert.strictEqual(b1.enemies[0].reward, b0.enemies[0].reward);
});

test('城: 前の版 (城 6x6) の保存データは、真ん中へ引っ越し、建っている物の値段から城レベルが決まる', () => {
  const cells = new Array(36).fill(null);
  cells[0] = 'keep'; cells[7] = 'mansion'; cells[35] = 'flags';   // 6x6 の (0,0)・(1,1)・(5,5)
  const s = Core.sanitizeState({ merit: 5000, totalMerit: 5000, castle: { cells } });
  assert.strictEqual(s.castle.cells.length, 100);
  assert.strictEqual(s.castle.cells[2 * 10 + 2], 'keep', '(0,0) → (2,2)');
  assert.strictEqual(s.castle.cells[3 * 10 + 3], 'mansion');
  assert.strictEqual(s.castle.cells[7 * 10 + 7], 'flags');
  assert.ok([22, 33, 77].every((i) => Core.isOpenCell(s, 'castle', i)), '引っ越した先は使える土地の中');
  assert.strictEqual(s.castle.xp, 300 + 60 + 5);
  assert.strictEqual(Core.castleLevel(s), 2);
  assert.deepStrictEqual(Core.sanitizeState(JSON.parse(JSON.stringify(s))), s, '新しい形は読み直しても変わらない');
});

test('前の版の保存データ (城4x4・家の数) は、新しいマスへ引っ越す', () => {
  const old = {
    merit: 5000, totalMerit: 5000, materials: 10,
    village: { houses: 3, population: 20 },
    castle: { cells: ['keep', 'barracks', null, 'storehouse', 'well', 'wall'].concat(new Array(10).fill(null)) }
  };
  const s = Core.sanitizeState(old);
  assert.strictEqual(s.castle.cells.length, Core.CASTLE_CELLS);
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

// ---------------------------------------------------------- 天下 (日本地図の国とり)

const JAPAN_MAP = require('./japan-map.js');

function realmState(home, extra) {
  const s = stateAtRank(Core.REALM_UNLOCK_RANK, extra);
  return Core.startRealm(s, home || 23, Core.mulberry32(7)).state;
}

test('天下: 47 の都道府県。となりどうしは両方向で、ぜんぶがつながっている。大名がいる', () => {
  assert.strictEqual(Core.PREFS.length, 47);
  Core.PREFS.forEach((p, i) => {
    assert.strictEqual(p.id, i + 1);
    assert.ok(p.daimyo && p.name, p.id + ' に名前と大名');
    assert.ok(p.nb.length >= 1, p.name + ' にとなりがある');
    p.nb.forEach((n) => assert.ok(Core.prefOf(n).nb.includes(p.id), `${p.name} と ${Core.prefOf(n).name} は両方向`));
  });
  const d = Core.prefDistances(1);
  assert.ok(d.slice(1).every(Number.isFinite), '北海道から沖縄まで、どこへでも行ける');
  assert.strictEqual(d[47], Math.max(...d.slice(1)), '北海道からいちばん遠いのは沖縄');
});

test('天下: 地図の形は 47 県ぶん。名前を置く点は、その県の形の中にある', () => {
  assert.strictEqual(JAPAN_MAP.prefs.length, 47);
  const inside = (rings, x, y) => {
    let c = false;
    for (const r of rings) {
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
      }
    }
    return c;
  };
  JAPAN_MAP.prefs.forEach((p, i) => {
    assert.strictEqual(p.id, i + 1);
    assert.ok(p.rings.length >= 1 && p.rings.every((r) => r.length >= 6 && r.length % 2 === 0), p.id + ' の形');
    assert.ok(inside(p.rings, p.lx, p.ly), Core.prefOf(p.id).name + ' の名前の点が形の中');
  });
});

test('天下: 侍になると国をひとつ任される。それより前は始められない', () => {
  const early = stateAtRank(Core.REALM_UNLOCK_RANK - 1);
  assert.strictEqual(Core.startRealm(early, 23).ok, false);
  const s = realmState(23);
  assert.ok(Core.isMine(s, 23));
  assert.strictEqual(Core.ownedCount(s), 1);
  assert.strictEqual(Core.troopsAt(s, 23), Core.START_TROOPS);
  assert.strictEqual(Core.startRealm(s, 13).ok, false, '2 回は始められない');
});

test('天下: 大名は、はじめの国から遠いほど強く、守りの兵も多い。いちばん遠い国の強さは、どこから始めても同じ', () => {
  for (const home of [1, 13, 23, 47]) {
    const s = realmState(home);
    const d = Core.prefDistances(home);
    const maxD = Math.max(...d.slice(1));
    const far = [], near = [];
    for (let id = 1; id <= 47; id++) {
      if (id === home) continue;
      const lv = s.realm.level[id - 1];
      if (d[id] === 1) near.push(lv);
      if (d[id] === maxD) far.push(lv);
    }
    assert.strictEqual(Math.max(...far), Core.PREF_LEVEL_MIN + Core.PREF_LEVEL_SPAN, `いちばん遠い国 (${Core.prefOf(home).name}から)`);
    assert.ok(Math.max(...near) <= 7, `となりの国は弱い (${Core.prefOf(home).name}から ${near})`);
    const nb = Core.prefOf(home).nb;
    assert.ok(nb.every((id) => Core.troopsAt(s, id) <= 600), 'となりの守りは 600 以下 (はじめの兵 500 で攻められる)');
  }
});

test('天下: 兵は 100 匹ずつ小判で買う。自分の国にしか置けない', () => {
  let s = realmState(23, { merit: 120 });
  assert.strictEqual(Core.canBuyTroops(s, 22), false, '敵の国には置けない');
  let r = Core.buyTroops(s, 23);
  assert.ok(r.ok);
  assert.strictEqual(Core.troopsAt(r.state, 23), Core.START_TROOPS + 100);
  assert.strictEqual(r.state.merit, 120 - Core.TROOP_COST);
  r = Core.buyTroops(r.state, 23);
  assert.strictEqual(r.state.merit, 120 - 2 * Core.TROOP_COST);
  assert.strictEqual(Core.buyTroops(r.state, 23).ok, false, '小判が足りないと買えない');
  assert.strictEqual(Core.rankIndexOf(r.state), Core.rankIndexOf(s), '小判を使っても出世は下がらない');
});

test('天下: 兵はまとめても買える (1000 匹・買えるだけ)。半端な数や、小判が足りない数は買えない', () => {
  const s = realmState(23, { merit: 1234 });
  const r = Core.buyTroops(s, 23, 1000);
  assert.ok(r.ok);
  assert.strictEqual(Core.troopsAt(r.state, 23), Core.START_TROOPS + 1000);
  assert.strictEqual(r.state.merit, 1234 - 500);
  assert.strictEqual(Core.affordableTroops(s), 2400, '小判 1234 で 2400 匹 (100 匹 50 小判)');
  assert.ok(Core.buyTroops(s, 23, Core.affordableTroops(s)).ok, '買えるだけ買える');
  assert.strictEqual(Core.buyTroops(s, 23, 2500).ok, false, '小判が足りない');
  assert.strictEqual(Core.buyTroops(s, 23, 150).ok, false, '100 匹ずつでない');
});

test('天下: 「○倍に そろえる」は、つながった自分の国から足りないぶんだけ集め、それでも足りないぶんを買う', () => {
  // 愛知 500・静岡 300・長野 700 (自分の国)。三重 (守り 1000) を攻める
  const s0 = JSON.parse(JSON.stringify(realmState(23, { merit: 1000 })));
  s0.realm.mine[21] = true; s0.realm.troops[21] = 300;
  s0.realm.mine[19] = true; s0.realm.troops[19] = 700;
  s0.realm.troops[23] = 1000;
  assert.deepStrictEqual(Core.RATIO_STEPS.map((k) => Core.troopsForRatio(s0, 24, k)), [1500, 3000]);
  // 1.5 倍 = 1500: 足りない 1000 のうち、兵の多い長野から 700、静岡から 300。買うのは 0
  const a = Core.fillTroops(s0, 23, 1500);
  assert.ok(a.ok && a.plan.moved === 1000 && a.plan.buy === 0 && a.plan.cost === 0);
  assert.deepStrictEqual([23, 22, 20].map((id) => Core.troopsAt(a.state, id)), [1500, 0, 0]);
  // 3 倍 = 3000: 集めて 1500、残り 1500 を買う (小判 750)
  const b = Core.fillTroops(s0, 23, 3000);
  assert.ok(b.ok && b.plan.moved === 1000 && b.plan.buy === 1500 && b.plan.cost === 750);
  assert.strictEqual(Core.troopsAt(b.state, 23), 3000);
  assert.strictEqual(b.state.merit, 250);
  assert.strictEqual(Core.totalTroops(b.state), Core.totalTroops(s0) + 1500, '兵は集めたぶん動き、買ったぶんだけ増える');
  // 小判が足りなければ何もしない
  const poor = Object.assign({}, s0, { merit: 100 });
  const c = Core.fillTroops(poor, 23, 3000);
  assert.ok(!c.ok && c.state === poor && c.plan.cost === 750);
  // もうそろっていれば何もしない
  assert.ok(Core.fillPlan(a.state, 23, 1500).ok && Core.fillPlan(a.state, 23, 1500).need === 0);
  // 集めすぎない: 必要なぶんだけ動かす (残りはそのまま守りに残る)
  const d = Core.fillTroops(s0, 23, 700);
  assert.deepStrictEqual([23, 22, 20].map((id) => Core.troopsAt(d.state, id)), [700, 300, 500]);
});

test('天下: 「そろえる」で集めるとき、攻められている国の兵は最後に使う', () => {
  const s0 = JSON.parse(JSON.stringify(realmState(23, { merit: 0 })));
  s0.realm.mine[21] = true; s0.realm.troops[21] = 900;   // 静岡 (攻められている。兵がいちばん多い)
  s0.realm.mine[19] = true; s0.realm.troops[19] = 400;   // 長野
  s0.realm.invasion = { from: 14, to: 22, troops: 600, left: 50, lord: 14 };
  const r = Core.fillTroops(s0, 23, 900);
  assert.ok(r.ok);
  assert.deepStrictEqual([22, 20].map((id) => Core.troopsAt(r.state, id)), [900, 0], '長野から先に集め、静岡は手をつけない');
});

test('天下: 兵は自分の国どうしで移せる (100 匹ずつ)。集めると 1 か所にまとまる', () => {
  let s = realmState(23);
  s = JSON.parse(JSON.stringify(s));
  [22, 21, 16].forEach((id) => { s.realm.mine[id - 1] = true; s.realm.troops[id - 1] = 300; });
  assert.strictEqual(Core.moveTroops(s, 23, 21, 250).ok, false, '100 匹ずつ');
  assert.strictEqual(Core.moveTroops(s, 23, 21, 600).ok, false, 'いる数より多くは移せない');
  assert.strictEqual(Core.moveTroops(s, 23, 24, 100).ok, false, '敵の国へは移せない');
  const m = Core.moveTroops(s, 23, 16, 200);
  assert.ok(m.ok, 'つながっていれば、となりでなくても移せる (愛知 → 岐阜 → 富山)');
  assert.strictEqual(Core.troopsAt(m.state, 16), 500);
  const g = Core.gatherTroops(s, 21);
  assert.ok(g.ok);
  assert.strictEqual(Core.troopsAt(g.state, 21), 500 + 300 * 3);
  assert.strictEqual(Core.totalTroops(g.state), Core.totalTroops(s), '集めても数は変わらない');
});

test('天下: 攻めるのは、となりの自分の国から。兵が多いほど、合戦の敵が減って弱くなる', () => {
  let s = realmState(23, { merit: 100000 });
  assert.strictEqual(Core.attackSource(s, 22), 23, '静岡のとなりの自分の国は愛知');
  assert.strictEqual(Core.attackSource(s, 1), null, '北海道はとなりではない');
  assert.strictEqual(Core.canAttack(s, 23, 1, 100), false);
  for (let i = 0; i < 60; i++) s = Core.buyTroops(s, 23).state;
  const g = Core.troopsAt(s, 22);
  const few = Core.attackPlan(s, 23, 22, 100 * Math.ceil(g / 200));
  const same = Core.attackPlan(s, 23, 22, g);
  const many = Core.attackPlan(s, 23, 22, g * 3);
  assert.ok(few.strength > same.strength && same.strength > many.strength, `兵が多いほど弱い (${few.strength}, ${same.strength}, ${many.strength})`);
  assert.ok(many.count <= same.count - 2, `3 倍連れて行くと、敵が 2 匹へる (${same.count} → ${many.count})`);
  const b = Core.createBattle(s, Core.mulberry32(1), same);
  const last = b.enemies[b.enemies.length - 1];
  assert.strictEqual(last.name, Core.prefOf(22).daimyo, '最後に出てくるのは、その県の大名');
  assert.ok(last.daimyo && last.boss);
  assert.strictEqual(b.player.atk, Core.createBattle(s, Core.mulberry32(1)).player.atk, 'こちらの強さは、いつもの合戦と同じ (自分の段位で決まる)');
});

test('天下: 勝つとその県が自分の国になり、生き残った兵が入る。小判と経験値も入る', () => {
  const s = realmState(23, { merit: 0 });
  const plan = Core.attackPlan(s, 23, 22, 500);
  const b = Core.createBattle(s, Core.mulberry32(3), plan);
  b.enemies.forEach((e) => { e.alive = false; e.hp = 0; });
  b.phase = 'won'; b.merit = 100; b.bonus = 30;
  const res = Core.applyBattleResult(s, b);
  assert.ok(res.conquest.captured);
  assert.ok(Core.isMine(res.state, 22));
  assert.strictEqual(Core.troopsAt(res.state, 23), 0, '連れて行った兵は元の国から出ていく');
  assert.strictEqual(Core.troopsAt(res.state, 22), 500 - res.conquest.lost, '生き残った兵が新しい国に入る');
  assert.ok(Core.troopsAt(res.state, 22) >= 100, '少なくとも 100 匹は残る');
  assert.strictEqual(res.state.merit, 130);
  assert.strictEqual(res.state.totalMerit, s.totalMerit + 130);
});

test('天下: 負け・退却では連れて行った兵の半分 (100 匹ずつに切り上げ) が戻らない。そのかわり、倒したぶん敵の守りも減る', () => {
  const s = realmState(23);
  const g = Core.troopsAt(s, 22);
  const b = Core.createBattle(s, Core.mulberry32(3), Core.attackPlan(s, 23, 22, 500));
  b.enemies[0].alive = false; b.enemies[1].alive = false;
  b.phase = 'lost';
  const res = Core.applyBattleResult(s, b);
  assert.strictEqual(res.conquest.captured, false);
  assert.strictEqual(Core.isMine(res.state, 22), false);
  assert.strictEqual(Core.troopsAt(res.state, 23), 500 - 300, '500 のうち半分 (100 匹ずつに切り上げ) が戻らない');
  assert.ok(Core.troopsAt(res.state, 22) < g, `守りが減る (${g} → ${Core.troopsAt(res.state, 22)})`);
  assert.ok(Core.troopsAt(res.state, 22) >= 100, '守りは 100 より減らない');
});

test('天下: 100 匹だけ連れて行っても、負ければ兵は減る (「100 匹で挑んで、だめなら退却」を損なしにしない)', () => {
  // 前は半分を 100 匹ずつに切り下げていたので、100 匹で負けても 1 匹も減らなかった
  assert.deepStrictEqual([100, 200, 300, 500, 1000].map(Core.defeatLoss), [100, 100, 200, 300, 500]);
  const s = realmState(23);
  const b = Core.createBattle(s, Core.mulberry32(3), Core.attackPlan(s, 23, 22, 100));
  b.phase = 'lost';
  const res = Core.applyBattleResult(s, b);
  assert.strictEqual(res.conquest.lost, 100);
  assert.strictEqual(Core.troopsAt(res.state, 23), 400);
});

test('天下: 合戦の最中に兵を動かしても、元の国にいる数より多くは減らない', () => {
  let s = realmState(23);
  const b = Core.createBattle(s, Core.mulberry32(3), Core.attackPlan(s, 23, 22, 500));
  s = JSON.parse(JSON.stringify(s));
  s.realm.troops[22] = 200; // 合戦の最中に愛知の兵が 200 に減った
  b.phase = 'won'; b.enemies.forEach((e) => { e.alive = false; });
  const res = Core.applyBattleResult(s, b);
  assert.strictEqual(Core.troopsAt(res.state, 23), 0);
  assert.ok(Core.troopsAt(res.state, 22) <= 200, '連れて行けたのは 200 まで');
});

test('天下: 47 すべて取ると天下統一。知らせは 1 回だけ', () => {
  let s = realmState(23);
  s = JSON.parse(JSON.stringify(s));
  s.realm.mine = s.realm.mine.map((m, i) => i !== 21);
  s.realm.troops[22] = 1000;
  const win = (st) => {
    const b = Core.createBattle(st, Core.mulberry32(3), Core.attackPlan(st, 23, 22, 1000));
    b.phase = 'won'; b.enemies.forEach((e) => { e.alive = false; });
    return Core.applyBattleResult(st, b);
  };
  const res = win(s);
  assert.strictEqual(res.conquest.unified, true);
  assert.strictEqual(res.state.realm.unified, true);
  assert.strictEqual(Core.ownedCount(res.state), 47);
});

test('天下: 取った国から年貢 (小判) が入る。経験値にはならない', () => {
  let s = realmState(23, { merit: 0 });
  const one = Core.tick(s, 100).merit;
  s = JSON.parse(JSON.stringify(s));
  [22, 21, 24].forEach((id) => { s.realm.mine[id - 1] = true; });
  const four = Core.tick(s, 100);
  assert.ok(Math.abs(four.merit - 4 * one) < 1e-6, `国の数に比例 (${one} → ${four.merit})`);
  assert.strictEqual(four.totalMerit, s.totalMerit, '経験値は増えない');
});

test('天下: 保存して読み込むと国も戻る。壊れた国のデータは「まだ任されていない」にする', () => {
  const s = realmState(13);
  assert.deepStrictEqual(Core.deserialize(Core.serialize(s)).realm, s.realm);
  const bad = JSON.parse(Core.serialize(s));
  bad.realm.mine = [true];
  assert.strictEqual(Core.sanitizeState(bad).realm, null);
  const old = JSON.parse(Core.serialize(stateAtRank(5)));
  delete old.realm;
  assert.strictEqual(Core.sanitizeState(old).realm, null, '前の版の保存データには国が無い');
});

/** 天下統一まで自動で遊ばせる。攻めるのは守りのいちばん少ないとなりの国。兵は集めて、決めた倍率まで買う */
function campaign(home, ratio, bot, seed, trainShare) {
  const rng = Core.mulberry32(seed);
  let s = Core.startRealm(stateAtRank(Core.REALM_UNLOCK_RANK), home, rng).state;
  let battles = 0, losses = 0;
  const hp = [];
  const trainSome = (st, budget) => {
    for (;;) {
      const k = Core.heroTrainCost(st, 'hp') <= Core.heroTrainCost(st, 'atk') ? 'hp' : 'atk';
      const cost = Core.heroTrainCost(st, k);
      if (cost > budget || !Core.canTrainHero(st, k)) return st;
      budget -= cost; st = Core.trainHero(st, k).state;
    }
  };
  while (!s.realm.unified && battles < 300) {
    let to = null;
    for (let id = 1; id <= 47; id++) {
      if (!Core.isMine(s, id) && Core.attackSource(s, id) && (to === null || Core.troopsAt(s, id) < Core.troopsAt(s, to))) to = id;
    }
    const from = Core.attackSource(s, to);
    s = Core.gatherTroops(s, from).state;
    s = trainSome(s, s.merit * (trainShare || 0.3));
    const g = Core.troopsAt(s, to);
    while (Core.troopsAt(s, from) < g * ratio && Core.canBuyTroops(s, from)) s = Core.buyTroops(s, from).state;
    battles++;
    const sent = Core.troopsAt(s, from);
    if (sent < 100) { const b = runBattle(s, bot, seed * 1000 + battles); s = Core.applyBattleResult(s, b).state; continue; }
    const b = Core.createBattle(s, Core.mulberry32(seed * 1000 + battles), Core.attackPlan(s, from, to, sent));
    let next = 0;
    for (let i = 0; i < 60 * 300 && b.phase === 'fight'; i++) {
      if (b.charge.on && bot.release(b)) Core.punchRelease(b);
      if (b.t >= next && bot.press(b)) next = b.t + 0.2 + b.rng() * 0.1;
      Core.stepBattle(b, 1 / 60);
      b.events.length = 0;
    }
    if (b.phase !== 'won') losses++;
    hp.push(b.phase === 'won' ? b.player.hp / b.player.maxHp : 0);
    s = Core.tick(Core.applyBattleResult(s, b).state, b.t + 30);
  }
  hp.sort((a, b) => a - b);
  return { unified: s.realm.unified, battles, losses, medHp: hp[hp.length >> 1] };
}

test('手ごたえ (天下): ふつうに遊べば天下統一できる。兵を多く連れて行くほど楽に勝てる', () => {
  // 測った値 (アイテムをやめ、主人公の体力を 60 + 21 x 段位 にしたあと): 敵と同じ数の兵で 46 戦・残り体力の中央
  // 北海道 73%・愛知 92%・沖縄 72%。2 倍なら 46 戦・94〜96% (兵を増やすと楽。愛知からは同じ数でもすでに楽なので差が小さい)
  let gain = 0;
  for (const home of [1, 23, 47]) {
    const same = campaign(home, 1, casual, home);
    const twice = campaign(home, 2, casual, home);
    assert.ok(same.unified && same.battles <= 60, `${Core.prefOf(home).name}から: 敵と同じ数でも天下統一 (${same.battles} 戦・負け ${same.losses})`);
    assert.ok(twice.unified && twice.battles <= 55, `${Core.prefOf(home).name}から: 2 倍でも天下統一 (${twice.battles} 戦)`);
    assert.ok(twice.medHp >= same.medHp, `2 倍連れて行って苦しくなることはない (残り体力 ${Math.round(same.medHp * 100)}% → ${Math.round(twice.medHp * 100)}%)`);
    gain += (twice.medHp - same.medHp) / 3;
  }
  assert.ok(gain > 0.08, `2 倍連れて行くと楽 (残り体力が平均 ${Math.round(gain * 100)} ポイント上がる)`);
  // 溜めない子でも、小判を先に修行に使い、兵を 2 倍連れて行けば、たいてい天下統一できる。
  // 1 戦の勝ち負けで道すじが分かれる (勝って守りの多い県へ進むと負け続けることがある) ので、5 つの国から見る。
  // 測った値 (アイテムをやめたあと): 北海道 67・東京 56・広島 58・沖縄 63 戦、愛知だけ届かない (前の版も 5 つ中 4 つ)
  // 負けたときの兵を切り上げにしたあと: 北海道 66・東京 76・愛知 63・広島 60・沖縄 63 戦 (5 つすべて)
  const tapDone = [1, 13, 23, 34, 47].map((home) => campaign(home, 2, tapper, home, 1)).filter((t) => t.unified && t.battles <= 80);
  assert.ok(tapDone.length >= 3, `溜めない子も、修行して兵を 2 倍にすれば、たいてい天下統一 (${tapDone.length}/5 の国から)`);
});

test('天下: 県ごとに昔の国の名前とひとことがある。取ったときの小判のめやすは、勝ったときの実際と同じ', () => {
  Core.PREFS.forEach((p) => assert.ok(p.kuni && p.desc && p.desc.length >= 10, p.name));
  const s = realmState(23, { merit: 0 });
  const plan = Core.attackPlan(s, 23, 22, 500);
  const b = Core.createBattle(s, Core.mulberry32(4), plan);
  const merit = b.enemies.reduce((n, e) => n + e.reward, 0);
  assert.strictEqual(Core.conquestReward(s, plan), merit + Math.round(merit * 0.3));
});

// ---------------------------------------------------------- 敵の大名が攻めてくる

/** 愛知から始めて、となりを 2 つ取った (国が 3 つ) ことにする */
function threeLands(extra) {
  const s = JSON.parse(JSON.stringify(realmState(23, extra)));
  [22, 21].forEach((id) => { s.realm.mine[id - 1] = true; s.realm.troops[id - 1] = 300; });
  return s;
}
function untilInvade(s, seed) {
  const rng = Core.mulberry32(seed || 5);
  for (let t = 0; t < 400; t++) {
    const r = Core.stepRealm(s, 1, rng); s = r.state;
    const ev = r.events.find((e) => e.type === 'invade');
    if (ev) return { s, inv: ev.invasion, t };
  }
  throw new Error('攻めてこない');
}

test('攻めてくる: 自分の国が 3 つになるまでは攻めてこない。3 つになると 2.5〜5 分で攻めてくる', () => {
  let s = realmState(23);
  const rng = Core.mulberry32(1);
  for (let t = 0; t < 600; t++) s = Core.stepRealm(s, 1, rng).state;
  assert.strictEqual(s.realm.invasion, null, '国がひとつでは攻めてこない');
  const r = untilInvade(threeLands());
  assert.ok(r.t >= Core.INVASION_GAP[0] - 1 && r.t <= Core.INVASION_GAP[1] + 1, `${r.t} 秒で攻めてきた`);
  assert.ok(Core.isMine(r.s, r.inv.to) && !Core.isMine(r.s, r.inv.from) && Core.isNeighbor(r.inv.from, r.inv.to), 'となりの敵の国から、自分の国へ');
  assert.strictEqual(r.inv.left, Core.INVASION_WARN, `着くまで ${Core.INVASION_WARN} 秒`);
  assert.ok(r.inv.troops >= 100 && r.inv.troops % 100 === 0);
  assert.strictEqual(Core.stepRealm(r.s, 0).state, r.s, 'dt が 0 以下なら何もしない');
});

test('攻めてくる: 攻めてきた大名の国は、そのぶん兵が減っている (攻め返す好機)', () => {
  const s0 = threeLands();
  const r = untilInvade(s0);
  assert.strictEqual(Core.troopsAt(r.s, r.inv.from), Core.troopsAt(s0, r.inv.from) - r.inv.troops);
});

test('攻めてくる: 何もしなければ兵の数で決まる。守りが多ければ追い返し、少なければ取られる', () => {
  const r = untilInvade(threeLands());
  const rng = Core.mulberry32(9);
  const wait = (st) => { let out = null; for (let t = 0; t <= Core.INVASION_WARN + 1 && !out; t++) { const x = Core.stepRealm(st, 1, rng); st = x.state; const ev = x.events.find((e) => e.type === 'invasionResolved'); if (ev) out = { st, res: ev.result }; } return out; };
  // 守りを厚くして待つ
  const strong = JSON.parse(JSON.stringify(r.s));
  strong.realm.troops[r.inv.to - 1] = r.inv.troops + 300;
  const a = wait(strong);
  assert.ok(a.res.repelled && !a.res.fell && Core.isMine(a.st, r.inv.to), '追い返した');
  assert.ok(Core.troopsAt(a.st, r.inv.to) < r.inv.troops + 300 && Core.troopsAt(a.st, r.inv.to) >= 100, '守りの兵も少し減る');
  assert.strictEqual(a.st.realm.invasion, null);
  // 守りが薄い (はじめの国でなければ取られる)
  const weak = JSON.parse(JSON.stringify(r.s));
  weak.realm.troops[r.inv.to - 1] = 0;
  const b = wait(weak);
  if (r.inv.to !== 23) {
    assert.ok(b.res.fell && !Core.isMine(b.st, r.inv.to), '取られた');
    assert.strictEqual(Core.lordOf(b.st, r.inv.to).id, Core.lordOf(r.s, r.inv.from).id, '攻めてきた大名の国になる');
    assert.ok(Core.troopsAt(b.st, r.inv.to) >= 100);
  }
});

test('攻めてくる: はじめに任された国は取られない (負けても守りの兵が半分になるだけ)', () => {
  const r = untilInvade(threeLands());
  const s = JSON.parse(JSON.stringify(r.s));
  s.realm.invasion = Object.assign({}, s.realm.invasion, { to: 23, from: 24, left: 1, troops: 5000, lord: 24 });
  s.realm.troops[22] = 400;
  const out = Core.stepRealm(s, 2, Core.mulberry32(1));
  const res = out.events[0].result;
  assert.ok(!res.fell && !res.repelled, '取られない');
  assert.ok(Core.isMine(out.state, 23));
  assert.strictEqual(Core.troopsAt(out.state, 23), 200);
});

test('攻めてくる: 迎え撃つ合戦。最後は攻めてきた大名。勝てば追い返し、負けると取られる', () => {
  const r = untilInvade(threeLands({ merit: 0 }));
  const plan = Core.defensePlan(r.s);
  assert.ok(plan.defense && plan.to === r.inv.to && plan.attackers === r.inv.troops);
  const b = Core.createBattle(r.s, Core.mulberry32(2), plan);
  assert.strictEqual(b.enemies[b.enemies.length - 1].name, Core.lordOf(r.s, r.inv.from).daimyo);
  // 守りが多いほど楽
  const more = JSON.parse(JSON.stringify(r.s)); more.realm.troops[r.inv.to - 1] = r.inv.troops * 3;
  const p2 = Core.defensePlan(more);
  assert.ok(p2.strength < plan.strength && p2.count < plan.count, `守りが多いと敵が減って弱い (${plan.count}→${p2.count}, ${plan.strength}→${p2.strength})`);
  // 勝つ
  const won = Core.createBattle(r.s, Core.mulberry32(2), plan);
  won.phase = 'won'; won.enemies.forEach((e) => { e.alive = false; });
  const w = Core.applyBattleResult(r.s, won);
  assert.ok(w.defense.repelled && Core.isMine(w.state, r.inv.to) && w.state.realm.invasion === null, '追い返した');
  // 負ける (守りの兵が少ない)
  const thin = JSON.parse(JSON.stringify(r.s)); thin.realm.troops[r.inv.to - 1] = 0;
  const lost = Core.createBattle(thin, Core.mulberry32(2), Core.defensePlan(thin));
  lost.phase = 'lost';
  const l = Core.applyBattleResult(thin, lost);
  assert.ok(!l.defense.repelled && l.state.realm.invasion === null);
  if (r.inv.to !== 23) assert.ok(l.defense.fell && !Core.isMine(l.state, r.inv.to), '守りが少ないまま負けると取られる');
});

test('攻めてくる: 迎え撃って負けても・退却しても、何もしなかったときより悪くならない (兵の数で決まる)', () => {
  // 前は負けるとかならず取られた。守り 2000 に 600 が攻めてきても、迎え撃って退却すると国も兵も失った
  const r = untilInvade(threeLands());
  const s = JSON.parse(JSON.stringify(r.s));
  const to = r.inv.to === 23 ? 22 : r.inv.to;   // はじめの国でない所で試す
  s.realm.invasion = Object.assign({}, s.realm.invasion, { to: to, troops: 600 });
  s.realm.troops[to - 1] = 2000;
  const b = Core.createBattle(s, Core.mulberry32(2), Core.defensePlan(s));   // phase は fight のまま = 退却
  const res = Core.applyBattleResult(s, b);
  assert.ok(res.defense.repelled && !res.defense.fell && Core.isMine(res.state, to), '守りが多ければ、退却しても追い返す');
  assert.ok(Core.troopsAt(res.state, to) >= 1500, `守りの兵はほとんど残る (${Core.troopsAt(res.state, to)})`);
  assert.strictEqual(res.state.realm.invasion, null);
  // 守りが少し足りなくても、倒したぶん攻めてきた兵が減るので、追い返せることがある
  const close = JSON.parse(JSON.stringify(s)); close.realm.troops[to - 1] = 400;
  const b2 = Core.createBattle(close, Core.mulberry32(2), Core.defensePlan(close));
  b2.enemies.forEach((e, i) => { if (i < b2.enemies.length - 1) e.alive = false; });
  b2.phase = 'lost';
  const fb = Core.defenseFallback(close, b2);
  assert.ok(fb.attackers < 600 && fb.attackers >= 300, `倒したぶん攻めてきた兵が減る (600 → ${fb.attackers})`);
  const none = Core.createBattle(close, Core.mulberry32(2), Core.defensePlan(close));
  none.phase = 'lost';
  assert.ok(Core.applyBattleResult(close, none).defense.fell, '1 匹も倒せずに負け、守りも足りなければ取られる');
});

test('攻めてくる: 攻めてきている大名の国を取ると、その兵は散る。天下統一したら知らせも消える', () => {
  // 前は残ったままで、天下統一のあとも赤い帯が「あと 60 秒」で止まって出続け、倒した大名と迎え撃つ合戦ができた
  const r = untilInvade(threeLands());
  const s = JSON.parse(JSON.stringify(r.s));
  const src = Core.attackSource(s, r.inv.from);
  s.realm.troops[src - 1] = 1000;
  const b = Core.createBattle(s, Core.mulberry32(2), Core.attackPlan(s, src, r.inv.from, 1000));
  b.phase = 'won';
  const res = Core.applyBattleResult(s, b);
  assert.ok(Core.isMine(res.state, r.inv.from));
  assert.strictEqual(res.state.realm.invasion, null, '攻めてくる知らせが消える');
  assert.ok(res.conquest.scattered, '散ったことを知らせる');
  // 最後の 1 国が攻めてきている最中に、その国を取って天下統一
  const last = JSON.parse(JSON.stringify(realmState(23)));
  last.realm.mine = last.realm.mine.map((_, i) => i + 1 !== 47);
  last.realm.troops = last.realm.troops.map((t, i) => (i + 1 === 47 ? 1000 : 500));
  last.realm.nextInvasion = 0.01;
  const inv = Core.stepRealm(last, 1, Core.mulberry32(1)).state;
  assert.strictEqual(inv.realm.invasion.from, 47);
  const fin = Core.createBattle(inv, Core.mulberry32(2), Core.attackPlan(inv, 46, 47, 300));
  fin.phase = 'won';
  const u = Core.applyBattleResult(inv, fin).state;
  assert.ok(u.realm.unified && u.realm.invasion === null && Core.defensePlan(u) === null, '天下統一したら、攻めてくる知らせは無い');
  // 保存データに残っていても、読み込むと捨てる
  const saved = JSON.parse(Core.serialize(inv)); saved.realm.mine[46] = true; saved.realm.unified = true;
  assert.strictEqual(Core.sanitizeState(saved).realm.invasion, null);
});

test('攻めてくる: 取られた県は、攻めてきた大名が守る。攻め返すと、その大名が出てくる', () => {
  const r = untilInvade(threeLands());
  if (r.inv.to === 23) return;
  const s = JSON.parse(JSON.stringify(r.s));
  s.realm.troops[r.inv.to - 1] = 0;
  const fell = Core.stepRealm(Object.assign({}, s, { realm: Object.assign({}, s.realm, { invasion: Object.assign({}, s.realm.invasion, { left: 0.5 }) }) }), 1).state;
  const src = Core.attackSource(fell, r.inv.to);
  assert.ok(src, '取り返しに行ける');
  const plan = Core.attackPlan(fell, src, r.inv.to, 100);
  assert.strictEqual(plan.daimyo, Core.lordOf(r.s, r.inv.from).daimyo);
});

test('攻めてくる: 天下統一したら、もう攻めてこない。保存して読み込むと秒読みも戻る', () => {
  const r = untilInvade(threeLands());
  const back = Core.deserialize(Core.serialize(r.s));
  assert.deepStrictEqual(back.realm.invasion, r.s.realm.invasion);
  const bad = JSON.parse(Core.serialize(r.s)); bad.realm.invasion.to = 99;
  assert.strictEqual(Core.sanitizeState(bad).realm.invasion, null, 'おかしな知らせは捨てる');
  const done = JSON.parse(JSON.stringify(threeLands()));
  done.realm.unified = true; done.realm.nextInvasion = 1;
  assert.strictEqual(Core.stepRealm(done, 500, Core.mulberry32(1)).state.realm.invasion, null);
});

test('手ごたえ (攻めてくる): 攻めてきたら迎え撃つ子は、天下統一までに何度も攻められても、ほとんど追い返す', () => {
  // 測った値 (4 つの国から、敵と同じ数の兵): 攻めてきた 12〜13 回、追い返した 11〜13 回、58〜65 戦で天下統一
  const run = (s, b) => {
    let next = 0;
    for (let i = 0; i < 60 * 300 && b.phase === 'fight'; i++) {
      if (b.charge.on && casual.release(b)) Core.punchRelease(b);
      if (b.t >= next && casual.press(b)) next = b.t + 0.2 + b.rng() * 0.1;
      Core.stepBattle(b, 1 / 60); b.events.length = 0;
    }
    return b;
  };
  for (const home of [23, 1]) {
    const rng = Core.mulberry32(home);
    let s = Core.startRealm(stateAtRank(Core.REALM_UNLOCK_RANK), home, rng).state;
    let battles = 0, inv = 0, rep = 0;
    const advance = (sec) => {
      for (; sec > 0; sec -= 5) {
        s = Core.tick(s, 5);
        const r = Core.stepRealm(s, 5, rng); s = r.state;
        if (r.events.some((e) => e.type === 'invade')) {
          inv++; battles++;
          const res = Core.applyBattleResult(s, run(s, Core.createBattle(s, rng, Core.defensePlan(s))));
          s = res.state; if (res.defense.repelled) rep++;
        }
      }
    };
    while (!s.realm.unified && battles < 200) {
      let to = null;
      for (let id = 1; id <= 47; id++) if (!Core.isMine(s, id) && Core.attackSource(s, id) && (to === null || Core.troopsAt(s, id) < Core.troopsAt(s, to))) to = id;
      const from = Core.attackSource(s, to);
      s = Core.gatherTroops(s, from).state;
      for (;;) { const k = Core.heroTrainCost(s, 'hp') <= Core.heroTrainCost(s, 'atk') ? 'hp' : 'atk'; if (Core.heroTrainCost(s, k) > s.merit * 0.3 || !Core.canTrainHero(s, k)) break; s = Core.trainHero(s, k).state; }
      while (Core.troopsAt(s, from) < Core.troopsAt(s, to) && Core.canBuyTroops(s, from)) s = Core.buyTroops(s, from).state;
      battles++;
      const sent = Core.troopsAt(s, from);
      const b = run(s, sent >= 100 ? Core.createBattle(s, rng, Core.attackPlan(s, from, to, sent)) : Core.createBattle(s, rng));
      s = Core.applyBattleResult(s, b).state;
      advance(b.t + 30);
    }
    assert.ok(s.realm.unified && battles <= 80, `${Core.prefOf(home).name}から: 攻められながらも天下統一 (${battles} 戦)`);
    assert.ok(inv >= 5 && rep >= inv - 3, `${Core.prefOf(home).name}から: 攻めてきた ${inv} 回、追い返した ${rep} 回`);
  }
});

// ---------------------------------------------------------- ボス (もらった絵: art/bosses/)

test('ボス: 合戦の大将は段位ごとに変わる。最初の段だけは、のら猫の親分 (連打でも勝てるように)', () => {
  const first = Core.createBattle(stateAtRank(0), Core.mulberry32(1));
  const lead0 = first.enemies[first.enemies.length - 1];
  assert.strictEqual(lead0.kind, 'nora');
  assert.strictEqual(lead0.name, 'のら猫の親分');
  const seen = new Set();
  for (let r = 1; r < Core.RANKS.length; r++) {
    const b = Core.createBattle(stateAtRank(r), Core.mulberry32(r));
    const lead = b.enemies[b.enemies.length - 1];
    const id = Core.RANK_BOSS[r];
    assert.strictEqual(lead.kind, 'boss', Core.RANKS[r].name + ' の大将はボス');
    assert.strictEqual(lead.look, 'boss-' + id);
    assert.strictEqual(lead.name, Core.BOSSES[id].name);
    assert.strictEqual(Core.bossIdOf(lead.look), id);
    b.enemies.slice(0, -1).forEach((e) => assert.strictEqual(Core.bossIdOf(e.look), null, 'ボスは大将だけ'));
    seen.add(id);
  }
  assert.strictEqual(seen.size, Core.RANKS.length - 1, '段位ごとにちがうボス');
  assert.strictEqual(Core.RANK_BOSS[Core.RANKS.length - 1], 'kuro-maou', 'いちばん上の段は黒猫大魔王');
});

test('ボス: 天下の大名は地方ごとの姿。名前は県ごと', () => {
  const lookOf = (name) => Core.PREFS.find((p) => p.name === name).look;
  const want = { 北海道: 'kori', 青森: 'kori', 東京: 'sumo', 新潟: 'onryo', 富山: 'onryo', 石川: 'onryo', 福井: 'onryo', 長野: 'tengu', 愛知: 'tengu', 三重: 'kage-ninja', 滋賀: 'kage-ninja',
    京都: 'hime', 大阪: 'hime', 山口: 'kaze', 高知: 'koura', 鹿児島: 'aka-oni', 沖縄: 'aka-oni' };
  Object.keys(want).forEach((n) => assert.strictEqual(lookOf(n), 'boss-' + want[n], n));
  Core.PREFS.forEach((p) => assert.ok(Core.bossIdOf(p.look), p.name + ' の大名はボスの姿'));
  assert.ok(!Core.PREFS.some((p) => p.look === 'boss-kuro-maou'), '黒猫大魔王は最後の 1 国だけ');
});

test('ボス: 天下統一の最後の 1 国だけは、どの県でも黒猫大魔王が出てくる', () => {
  let s = realmState(23);
  const plan0 = Core.attackPlan(s, 23, 22, 500);
  assert.strictEqual(plan0.final, false);
  assert.strictEqual(plan0.look, Core.PREFS[21].look);
  // 静岡 (22) だけを残して、ぜんぶ自分の国にする
  const r = JSON.parse(JSON.stringify(s.realm));
  r.mine = r.mine.map((m, i) => i !== 21);
  r.troops = r.troops.map((t, i) => (i !== 21 ? 500 : t));
  s = Object.assign({}, s, { realm: r });
  const plan = Core.attackPlan(s, 23, 22, 500);
  assert.strictEqual(plan.final, true);
  assert.strictEqual(plan.look, 'boss-kuro-maou');
  assert.strictEqual(plan.daimyo, '黒猫大魔王');
  const b = Core.createBattle(s, Core.mulberry32(5), plan);
  const lead = b.enemies[b.enemies.length - 1];
  assert.strictEqual(lead.look, 'boss-kuro-maou');
  assert.strictEqual(lead.name, '黒猫大魔王');
});

test('ボス: 大将 (ボス・大名) は仲間にならない。大将しかいない戦では誘われない', () => {
  const s = stateAtRank(Core.VASSAL_UNLOCK_RANK);
  let offers = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const b = Core.createBattle(s, Core.mulberry32(seed));
    b.phase = 'won';
    const o = Core.rollRecruitOffer(s, b);
    if (o) { offers++; assert.strictEqual(Core.bossIdOf(o.look), null, '大将の姿の家臣はできない'); }
    const solo = Object.assign({}, b, { enemies: b.enemies.slice(-1) });
    assert.strictEqual(Core.rollRecruitOffer(s, solo), null);
  }
  assert.ok(offers > 50, '大将のほかの敵からは、ふつうに誘われる (' + offers + '/200)');
});
