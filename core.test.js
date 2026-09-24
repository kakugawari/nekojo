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

/** 敵が前線に着くまで進める */
function untilEngaged(b) {
  for (let i = 0; i < 60 * 20; i++) {
    const f = Core.frontEnemy(b);
    if (f && Core.inReach(b, f)) return f;
    Core.stepBattle(b, 1 / 60);
  }
  throw new Error('敵が来ない');
}

function runBattle(state, bot, seed) {
  const b = Core.createBattle(state, Core.mulberry32(seed));
  for (let i = 0; i < 60 * 240 && b.phase === 'fight'; i++) {
    bot(b);
    Core.stepBattle(b, 1 / 60);
    b.events.length = 0;
  }
  return b;
}

// 下手: パンチだけを押し続ける
const masher = (b) => { Core.punch(b); };
// ふつう: パンチを押しつつ、猫じゃらしも時々。スペシャルは貯まったら使う
const casual = (b) => {
  if (b.special >= 100) { Core.special(b); return; }
  const f = Core.frontEnemy(b);
  if (f && Core.inReach(b, f) && b.cd.lure === 0 && b.rng() < 0.02) { Core.lure(b); return; }
  Core.punch(b);
};
// 上手: 振りかぶりを見てから 0.15〜0.35 秒で猫じゃらし (人の反応の遅れを入れる)
const skilled = (b) => {
  if (b.special >= 100) { Core.special(b); return; }
  const f = Core.frontEnemy(b);
  if (f && f.windup) {
    const key = f.id + ':' + Math.floor(b.t / 0.6);
    if (b._seen !== key) { b._seen = key; b._react = b.t + 0.15 + b.rng() * 0.2; }
    if (b.t >= b._react && b.cd.lure === 0) { Core.lure(b); return; }
  }
  if (f && Core.inReach(b, f)) Core.punch(b);
};

test('合戦: 敵は段位に応じた数で、最後は大将', () => {
  for (const r of [0, 3, 9]) {
    const b = Core.createBattle(stateAtRank(r), Core.mulberry32(1));
    assert.strictEqual(b.enemies.length, Math.min(7, 3 + Math.floor(r / 2)));
    assert.strictEqual(b.enemies[b.enemies.length - 1].kind, 'boss');
    assert.ok(b.enemies.every((e) => !e.spawned), 'はじめはまだ誰も出てきていない');
  }
});

test('合戦: 敵は近い順に並んで止まり、殴れるのは先頭だけ', () => {
  const b = Core.createBattle(stateAtRank(3), Core.mulberry32(2));
  for (let i = 0; i < 60 * 12; i++) Core.stepBattle(b, 1 / 60); // 4匹とも出てきて並ぶまで
  const line = b.enemies.filter((e) => e.spawned && e.alive).sort((a, c) => a.x - c.x);
  assert.ok(line.length >= 2);
  assert.ok(Core.inReach(b, line[0]), '先頭は届く');
  assert.ok(!Core.inReach(b, line[1]), '2番目は届かない');
  assert.ok(line[1].x - line[0].x >= Core.GAP - 1, '重ならずに並ぶ');
});

test('合戦: 届かないパンチは空振りで、コンボが切れる', () => {
  const b = Core.createBattle(stateAtRank(0), Core.mulberry32(3));
  b.combo = 3;
  assert.strictEqual(Core.punch(b), true);
  assert.ok(b.events.some((e) => e.type === 'miss'));
  assert.strictEqual(b.combo, 0);
});

test('合戦: パンチは続けて押せない (待ち時間)', () => {
  const b = Core.createBattle(stateAtRank(0), Core.mulberry32(3));
  untilEngaged(b);
  assert.strictEqual(Core.punch(b), true);
  assert.strictEqual(Core.punch(b), false);
});

test('合戦: パンチは届く敵を減らし、夢中の敵には2倍', () => {
  const b = Core.createBattle(stateAtRank(2), Core.mulberry32(4));
  const f = untilEngaged(b);
  const hp0 = f.hp;
  Core.punch(b);
  const normal = hp0 - f.hp;
  assert.strictEqual(normal, b.player.atk);

  b.cd.punch = 0; b.combo = 0; b.comboTimer = 0;
  Core.lure(b);
  assert.ok(f.charm > 0, '猫じゃらしで夢中になる');
  const hp1 = f.hp;
  Core.punch(b);
  assert.strictEqual(hp1 - f.hp, b.player.atk * 2);
});

test('合戦: 続けて当てるとコンボで上乗せされる', () => {
  const b = Core.createBattle(stateAtRank(2), Core.mulberry32(5));
  const f = untilEngaged(b);
  const hits = [];
  for (let i = 0; i < 4; i++) {
    b.cd.punch = 0;
    f.x = Core.PLAYER_X + Core.STOP; // のけぞりを戻して必ず届くように
    const h = f.hp; Core.punch(b); hits.push(h - f.hp);
  }
  assert.ok(hits[3] > hits[0], `コンボで強くなる (${hits.join(',')})`);
});

test('合戦: 敵は振りかぶってから攻撃してくる。夢中の間は攻撃しない', () => {
  const b = Core.createBattle(stateAtRank(0), Core.mulberry32(6));
  const f = untilEngaged(b);
  let sawWindup = false;
  for (let i = 0; i < 60 * 3 && b.player.hp === b.player.maxHp; i++) {
    Core.stepBattle(b, 1 / 60);
    if (f.windup) sawWindup = true;
  }
  assert.ok(sawWindup, '攻撃の前に振りかぶる');
  assert.ok(b.player.hp < b.player.maxHp, '攻撃されると体力が減る');

  const hp = b.player.hp;
  b.cd.lure = 0;
  Core.lure(b);
  const charm = f.charm;
  for (let i = 0; i < Math.floor(charm * 60) - 1; i++) Core.stepBattle(b, 1 / 60);
  assert.strictEqual(b.player.hp, hp, '夢中の間は攻撃されない');
});

test('合戦: 振りかぶった瞬間の猫じゃらしは「見切り」で、長く夢中になりスペシャルも多くたまる', () => {
  const b = Core.createBattle(stateAtRank(0), Core.mulberry32(7));
  const f = untilEngaged(b);
  while (!f.windup) Core.stepBattle(b, 1 / 60);
  Core.lure(b);
  const ev = b.events.find((e) => e.type === 'lure');
  assert.strictEqual(ev.perfect, true);
  const perfectCharm = f.charm;
  const perfectSpecial = b.special;

  const b2 = Core.createBattle(stateAtRank(0), Core.mulberry32(7));
  const f2 = untilEngaged(b2);
  Core.lure(b2);
  assert.ok(perfectCharm > f2.charm, `見切りの方が長い (${perfectCharm} > ${f2.charm})`);
  assert.ok(perfectSpecial > b2.special);
});

test('合戦: 猫じゃらしは遠くの敵を引き寄せる', () => {
  const b = Core.createBattle(stateAtRank(0), Core.mulberry32(8));
  while (!b.enemies[0].spawned) Core.stepBattle(b, 1 / 60);
  const f = b.enemies[0];
  const x0 = f.x;
  Core.lure(b);
  assert.ok(f.x < x0, '近づく');
  assert.ok(f.x >= Core.PLAYER_X + Core.STOP, '自分より前には来ない');
});

test('合戦: スペシャルはゲージが満タンのときだけ、出ている敵ぜんぶに当たる', () => {
  const b = Core.createBattle(stateAtRank(3), Core.mulberry32(9));
  for (let i = 0; i < 60 * 6; i++) Core.stepBattle(b, 1 / 60);
  assert.strictEqual(Core.special(b), false, 'たまっていないと出ない');
  b.special = 100;
  const out = b.enemies.filter((e) => e.spawned && e.alive);
  const before = out.map((e) => e.hp);
  assert.strictEqual(Core.special(b), true);
  assert.strictEqual(b.special, 0);
  out.forEach((e, i) => assert.ok(e.hp < before[i], '出ている敵はみな減る'));
  assert.ok(b.enemies.filter((e) => !e.spawned).every((e) => e.hp === e.maxHp), 'まだ出ていない敵には当たらない');
});

test('合戦: 全部倒すと勝ち、手柄と資材が入る。出世もする', () => {
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

test('合戦: 体力が0になると負け。負けても何も減らない', () => {
  const s = stateAtRank(5);
  const b = Core.createBattle(s, Core.mulberry32(10));
  for (let i = 0; i < 60 * 120 && b.phase === 'fight'; i++) Core.stepBattle(b, 1 / 60); // 何もしない
  assert.strictEqual(b.phase, 'lost');
  const r = Core.applyBattleResult(s, b);
  assert.deepStrictEqual(r.state, s);
});

test('合戦: dt が 0 以下なら何もしない。大きな dt でも敵が瞬間移動しない', () => {
  const b = Core.createBattle(stateAtRank(0), Core.mulberry32(11));
  const snap = JSON.stringify(b.enemies);
  Core.stepBattle(b, 0);
  Core.stepBattle(b, -3);
  assert.strictEqual(JSON.stringify(b.enemies), snap);
  b.t = 5; b.enemies[0].spawnAt = 0;
  Core.stepBattle(b, 1000);
  assert.ok(b.enemies[0].x > Core.PLAYER_X + Core.STOP + 20, `1コマで前線まで来ない (x=${b.enemies[0].x})`);
});

test('合戦: 出陣の家臣がいっしょに戦う (2人まで)', () => {
  let s = stateAtRank(3);
  for (let i = 0; i < 2; i++) s = Core.recruitVassal(s, Core.mulberry32(i)).state;
  s = Object.assign({}, s, { merit: 10000, totalMerit: 10000 });
  for (let i = 0; i < 3; i++) s = Core.recruitVassal(s, Core.mulberry32(10 + i)).state;
  const ids = s.vassals.map((v) => v.id);
  assert.strictEqual(Core.assignVassalJob(s, ids[0], 'battle').ok, true);
  s = Core.assignVassalJob(s, ids[0], 'battle').state;
  s = Core.assignVassalJob(s, ids[1], 'battle').state;
  assert.strictEqual(Core.assignVassalJob(s, ids[2], 'battle').ok, false, '3人目は出陣できない');

  const b = Core.createBattle(s, Core.mulberry32(12));
  assert.strictEqual(b.allies.length, 2);
  const f = untilEngaged(b);
  const hp = f.hp;
  for (let i = 0; i < 60 * 3; i++) Core.stepBattle(b, 1 / 60);
  assert.ok(b.events.some((e) => e.type === 'allyAttack'));
  assert.ok(f.hp < hp || !f.alive, '家臣の攻撃で敵が減る');
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
      assert.strictEqual(r.state.vassals.length, 1);
      assert.strictEqual(r.state.merit, s.merit, '仲間入りはただ');
    }
  }
  assert.ok(offers > 3 && offers < 17, `だいたい半分 (${offers}/20)`);
  assert.strictEqual(Core.rollRecruitOffer(stateAtRank(0), runBattle(stateAtRank(0), skilled, 1)), null, '足軽より前は仲間を持てない');
});

// 手ごたえの見張り。数字は各段位 30 回ずつ実際に戦わせて測った値をもとに線を引いた
// (下手: r0 30/30 残HP43%、r4 2/30、r6以上 0/30。ふつう: 全段位 29〜30/30。上手: 全段位 30/30)
test('手ごたえ: 下手でも最初は勝てる。上の段位は猫じゃらしを使わないと勝てない', () => {
  const wins = (r, bot) => {
    let w = 0;
    for (let seed = 1; seed <= 30; seed++) if (runBattle(stateAtRank(r), bot, seed).phase === 'won') w++;
    return w;
  };
  assert.strictEqual(wins(0, masher), 30, '村の子猫はパンチ連打で勝てる');
  assert.ok(wins(7, masher) <= 3, 'パンチ連打だけでは城代の戦に勝てない');
  for (let r = 0; r < Core.RANKS.length; r++) {
    assert.ok(wins(r, casual) >= 26, `ふつうに遊べば勝てる (段位${r})`);
    assert.ok(wins(r, skilled) >= 29, `上手に遊べば勝てる (段位${r})`);
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
