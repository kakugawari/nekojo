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
    // 人と同じくらいの間隔 (0.2〜0.3秒) でしか押さない
    if (b.t >= next && bot(b)) next = b.t + 0.2 + b.rng() * 0.1;
    Core.stepBattle(b, 1 / 60);
    b.events.length = 0;
  }
  return b;
}

// 下手: パンチだけを押し続ける
const masher = (b) => Core.punch(b);
// ふつう: 猫じゃらしで肉球を 3 つためてからパンチ。体力が減ったら魚
const casual = (b) => {
  const e = Core.currentEnemy(b); if (!e) return false;
  if (b.player.hp < b.player.maxHp * 0.3 && b.items.fish > 0) return Core.useItem(b, 'fish');
  if (e.state === 'charmed' && b.paw >= 3) return Core.punch(b);
  return Core.lure(b);
};
// 上手: 振りかぶりに見切り、肉球を満タンにして飛びつきの高いところでパンチ、ねこ侍はスキを狙う
const skilled = (b) => {
  const e = Core.currentEnemy(b); if (!e) return false;
  const k = Core.ENEMY_KINDS[e.kind];
  if (b.player.hp < b.player.maxHp * 0.35 && b.items.fish > 0) return Core.useItem(b, 'fish');
  if (e.state === 'windup' && b.cd.lure === 0) return Core.lure(b);
  if (e.state === 'recover' && e.open) return Core.punch(b);
  if (e.state === 'charmed') {
    if (b.paw >= Core.PAW_MAX || e.charm < 0.5) return (Core.atJumpPeak(e) || e.charm < 0.35) ? Core.punch(b) : false;
    return Core.lure(b);
  }
  if ((e.state === 'idle' || e.state === 'recover') && e.wary <= 0 && (!k.needLook || Core.isLooking(e))) return Core.lure(b);
  return false;
};

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

test('合戦: のら猫は猫じゃらしですぐ夢中になり、当たるたびに肉球がたまる', () => {
  const { b, e } = duelWith('nora');
  Core.lure(b);
  assert.strictEqual(e.state, 'charmed');
  assert.strictEqual(b.paw, 1);
  for (let i = 0; i < 6; i++) { b.cd.lure = 0; Core.lure(b); }
  assert.strictEqual(b.paw, Core.PAW_MAX, '5 で満タン');
});

test('合戦: 肉球が満タンになると、それ以上振っても夢中は延びない (振り続けて安全、にならない)', () => {
  const { b, e } = duelWith('nora');
  for (let i = 0; i < 5; i++) { b.cd.lure = 0; Core.lure(b); }
  const left = e.charm;
  b.cd.lure = 0; Core.lure(b);
  assert.strictEqual(e.charm, left);
  assert.ok(b.events.some((ev) => ev.result === 'full'));
});

test('合戦: 夢中が切れると飽きて、肉球ゲージは消える', () => {
  const { b, e } = duelWith('nora');
  Core.lure(b);
  for (let i = 0; i < 60 * 3; i++) Core.stepBattle(b, 1 / 60);
  assert.notStrictEqual(e.state, 'charmed');
  assert.strictEqual(b.paw, 0);
  assert.ok(b.events.some((ev) => ev.type === 'bored'));
});

test('合戦: 夢中の間は攻撃してこない。夢中でなければ振りかぶってから攻撃する', () => {
  const { b, e } = duelWith('nora');
  Core.lure(b);
  const hp = b.player.hp;
  for (let i = 0; i < Math.floor(e.charm * 60) - 1; i++) Core.stepBattle(b, 1 / 60);
  assert.strictEqual(b.player.hp, hp, '夢中の間は無事');
  let sawWindup = false;
  for (let i = 0; i < 60 * 4 && b.player.hp === hp; i++) { Core.stepBattle(b, 1 / 60); if (e.state === 'windup') sawWindup = true; }
  assert.ok(sawWindup && b.player.hp < hp, '夢中が切れると、振りかぶってから攻撃してくる');
});

test('合戦: 夢中の敵へのパンチは、肉球の数だけ大きく効く。満タンなら「猫じゃらしコンボ」', () => {
  for (const paw of [1, 3, 5]) {
    const { b, e } = duelWith('nora');
    for (let i = 0; i < paw; i++) { b.cd.lure = 0; Core.lure(b); }
    e.age = 0; // 飛びつきの低いところ (会心にしない)
    const hp = e.hp;
    Core.punch(b);
    assert.strictEqual(hp - e.hp, Math.min(hp, Math.round(b.player.atk * Core.comboMul(paw))), `肉球${paw}`);
    const ev = b.events.find((x) => x.type === 'hit');
    assert.strictEqual(ev.combo, paw === Core.PAW_MAX);
    assert.strictEqual(b.paw, 0, 'パンチで肉球は使い切る');
  }
  assert.ok(Core.comboMul(5) > Core.comboMul(4) * 1.4, '満タンは特大');
});

test('合戦: 飛びつきの高いところでパンチすると「会心の猫パンチ」(1.5倍)', () => {
  const { b, e } = duelWith('nora', 0);
  Core.lure(b);
  e.age = Core.JUMP_PERIOD * 0.45;
  assert.strictEqual(Core.atJumpPeak(e), true);
  e.hp = e.maxHp = 10000;
  Core.punch(b);
  const ev = b.events.find((x) => x.type === 'hit');
  assert.strictEqual(ev.crit, true);
  assert.strictEqual(ev.amount, Math.round(b.player.atk * Core.comboMul(1) * 1.5));
});

test('合戦: 殴られた敵はしばらく警戒して羽に引っかからない。外すと次に振れるまで長い', () => {
  const { b, e } = duelWith('nora');
  e.hp = e.maxHp = 10000;
  Core.lure(b); Core.punch(b);
  for (let i = 0; i < 60 * 0.7; i++) Core.stepBattle(b, 1 / 60); // 殴られてのけぞる間を過ぎる
  b.cd.lure = 0;
  Core.lure(b);
  assert.ok(b.events.some((ev) => ev.result === 'wary'));
  assert.ok(b.cd.lure > Core.LURE_COOLDOWN, '外した猫じゃらしは待ち時間が長い');
  assert.notStrictEqual(e.state, 'charmed');
});

test('合戦: 振りかぶった瞬間の猫じゃらしは「見切り」。攻撃を止め、肉球が2たまる (警戒中でも効く)', () => {
  const { b, e } = duelWith('nora');
  e.wary = 5;
  while (e.state !== 'windup') Core.stepBattle(b, 1 / 60);
  const hp = b.player.hp;
  Core.lure(b);
  assert.strictEqual(e.state, 'charmed');
  assert.strictEqual(b.paw, 2);
  assert.ok(b.events.some((ev) => ev.result === 'perfect'));
  for (let i = 0; i < 30; i++) Core.stepBattle(b, 1 / 60);
  assert.strictEqual(b.player.hp, hp, '攻撃は来ない');
});

test('合戦: すばしっこい猫は、羽を見ているときに振らないとかわす', () => {
  const { b, e } = duelWith('quick');
  e.age = Core.JUMP_PERIOD * 0 + 1.0; // 見ていない所 (0.75〜1.8秒)
  assert.strictEqual(Core.isLooking(e), false);
  Core.lure(b);
  assert.ok(b.events.some((ev) => ev.result === 'dodge'));
  assert.notStrictEqual(e.state, 'charmed');
  b.cd.lure = 0;
  e.age = 1.8 + 0.2; // 見ている所
  Core.lure(b);
  assert.strictEqual(e.state, 'charmed');
});

test('合戦: ねこ侍は夢中でないときに殴ると受け流して反撃。攻撃のあとのスキに殴ると会心', () => {
  const { b, e } = duelWith('samurai');
  const hp = b.player.hp;
  const ehp = e.hp;
  Core.punch(b);
  assert.ok(b.events.some((ev) => ev.type === 'parry'));
  assert.ok(b.player.hp < hp, '反撃される');
  assert.strictEqual(e.hp, ehp, '受け流されて効かない');
  while (!(e.state === 'recover' && e.open)) Core.stepBattle(b, 1 / 60);
  b.cd.punch = 0;
  const before = e.hp;
  Core.punch(b);
  assert.strictEqual(before - e.hp, Math.min(before, Math.round(b.player.atk * 2.5)));
  assert.ok(b.events.some((ev) => ev.type === 'hit' && ev.open && ev.crit));
});

test('合戦: 大きなボス猫は3回振ってやっと夢中。夢中でないとパンチは半分', () => {
  const { b, e } = duelWith('boss');
  e.hp = e.maxHp = 10000;
  const results = [];
  for (let i = 0; i < 3; i++) { b.cd.lure = 0; Core.lure(b); results.push(b.events.filter((ev) => ev.type === 'lure').pop().result); }
  assert.deepStrictEqual(results, ['resist', 'resist', 'charm']);
  const { b: b2, e: e2 } = duelWith('boss');
  e2.hp = e2.maxHp = 10000;
  Core.punch(b2);
  assert.strictEqual(10000 - e2.hp, Math.round(b2.player.atk * 0.5));
});

test('合戦: 魚で体力が戻り、またたびで敵が夢中になる。持っている数だけ使える', () => {
  const { b, e } = duelWith('boss');
  assert.strictEqual(Core.useItem(b, 'fish'), false, '体力が満タンなら魚は使わない');
  b.player.hp = 10;
  assert.strictEqual(Core.useItem(b, 'fish'), true);
  assert.strictEqual(b.player.hp, 10 + Math.round(b.player.maxHp * 0.4));
  assert.strictEqual(Core.useItem(b, 'matatabi'), true);
  assert.strictEqual(e.state, 'charmed', 'ボス猫でも、またたびなら一発で夢中');
  assert.strictEqual(b.paw, 2);
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

// 手ごたえの見張り。数字は各段位 30 回ずつ実際に戦わせて測った値をもとに線を引いた
// (下手: r0 30/30 残75%、r1 以上 0/30。ふつう: 全段位 30/30 残18〜64%。上手: 全段位 30/30)
test('手ごたえ: パンチだけでは最初の戦しか勝てない。猫じゃらしを使えば全段位で勝てる', () => {
  const wins = (r, bot) => {
    let w = 0;
    for (let seed = 1; seed <= 30; seed++) if (runBattle(stateAtRank(r), bot, seed).phase === 'won') w++;
    return w;
  };
  assert.strictEqual(wins(0, masher), 30, '村の子猫はパンチ連打で勝てる');
  assert.ok(wins(3, masher) <= 3, 'パンチ連打だけでは足軽の戦に勝てない');
  for (let r = 0; r < Core.RANKS.length; r++) {
    assert.ok(wins(r, casual) >= 26, `ふつうに遊べば勝てる (段位${r})`);
    assert.ok(wins(r, skilled) >= 29, `上手に遊べば勝てる (段位${r})`);
  }
  // 猫じゃらしを使えば無傷、にならないこと。測った値: 30/30 が殴られる。
  // 外したときの待ち時間を普通に戻すと 0/30、パンチのあとの警戒を無くすと 21〜27/30 になる
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
