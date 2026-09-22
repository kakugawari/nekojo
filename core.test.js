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

test('trainingReward は 3〜6 (会心なら3倍) を返す', () => {
  const rng = Core.mulberry32(7);
  let sawCrit = false;
  for (let i = 0; i < 500; i++) {
    const { amount, crit } = Core.trainingReward(rng);
    if (crit) {
      sawCrit = true;
      assert.ok(amount >= 9 && amount <= 18, `会心の値がおかしい: ${amount}`);
    } else {
      assert.ok(amount >= 3 && amount <= 6, `通常の値がおかしい: ${amount}`);
    }
  }
  assert.ok(sawCrit, '500回も引けば会心が1回は出るはず');
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

test('長屋を建てると家臣の枠が増える', () => {
  let s = stateAt(5000); // 城主
  const cells = s.castle.cells.slice();
  cells[0] = 'barracks';
  s = Object.assign({}, s, { castle: { cells: cells } });
  const base = Core.vassalSlotBase(Core.rankIndexForMerit(5000));
  assert.strictEqual(Core.vassalSlots(s), base + 2);
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

test('蔵があると資材の増え方が良くなる', () => {
  const rng = Core.mulberry32(6);
  let r = Core.recruitVassal(stateAt(5000), rng);
  r = { state: Core.assignVassalJob(r.state, r.state.vassals[0].id, 'labor').state };

  const withoutStorehouse = Core.tick(r.state, 5).materials;

  const cells = r.state.castle.cells.slice();
  cells[0] = 'storehouse';
  const withStorehouse = Core.tick(Object.assign({}, r.state, { castle: { cells: cells } }), 5).materials;

  assert.ok(withStorehouse > withoutStorehouse, '蔵の分だけ増えが良くないとおかしい');
});

test('城は城主になるまで建てられない', () => {
  const s = stateAt(1000, { materials: 10000 });
  assert.strictEqual(Core.canPlaceBuilding(s, 0, 'keep'), false);
});

test('城は空いている枠にしか建てられない', () => {
  let s = stateAt(5000, { materials: 10000 });
  const r = Core.placeBuilding(s, 0, 'wall');
  assert.strictEqual(r.ok, true);
  const r2 = Core.placeBuilding(r.state, 0, 'wall');
  assert.strictEqual(r2.ok, false, '同じ枠には建てられない');
});

test('天守は1つしか建てられない', () => {
  let s = stateAt(5000, { materials: 10000 });
  const r1 = Core.placeBuilding(s, 0, 'keep');
  assert.strictEqual(r1.ok, true);
  const r2 = Core.placeBuilding(r1.state, 1, 'keep');
  assert.strictEqual(r2.ok, false);
});

test('資材が足りないと建てられない', () => {
  const s = stateAt(5000, { materials: 5 });
  assert.strictEqual(Core.canPlaceBuilding(s, 0, 'keep'), false);
  const r = Core.placeBuilding(s, 0, 'keep');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.state.materials, 5);
});

test('天守を建てるとお城が完成したことになる', () => {
  let s = stateAt(5000, { materials: 10000 });
  assert.strictEqual(Core.isCastleComplete(s), false);
  const r = Core.placeBuilding(s, 0, 'keep');
  assert.strictEqual(Core.isCastleComplete(r.state), true);
});

test('家を建てると村の上限が増える', () => {
  const s = stateAt(5000, { materials: 1000 });
  const cap0 = Core.villageCapacity(s);
  const r = Core.buildHouse(s);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(Core.villageCapacity(r.state), cap0 + 8);
  assert.strictEqual(r.state.materials, 1000 - Core.houseCost(s));
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
  assert.strictEqual(restored.castle.cells.length, Core.CASTLE_SIZE);
});

test('古い保存データに新しい項目が無くても補われる', () => {
  const restored = Core.sanitizeState({ merit: 500 });
  assert.strictEqual(restored.merit, 500);
  assert.deepStrictEqual(restored.village, { houses: 0, population: 0 });
  assert.strictEqual(restored.castle.cells.length, Core.CASTLE_SIZE);
});
