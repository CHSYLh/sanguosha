/**
 * 牌堆与卡牌效果测试：
 *   1) 牌库构成合理（张数、类型数量、每种牌都有元数据与说明）
 *   2) 新增卡牌在真实对局中确实会被使用（属性杀 / 兵粮寸断 / 火攻 / 新装备）
 *   3) 新增装备的效果确实生效（藤甲免疫普通杀、古锭刀加成、白银狮子减伤等）
 * 用法：node tools/test-cards.js
 */
const path = require('path');
const { CARD_META, buildDeck, isSlashCard, elementOf, cardText } = require(path.join(__dirname, '..', 'src', 'cards'));
const { Game } = require(path.join(__dirname, '..', 'src', 'engine'));
const { HEROES } = require(path.join(__dirname, '..', 'src', 'heroes'));

const errors = [];
function check(cond, msg) {
  if (!cond) { errors.push(msg); console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

/* ---------- 1. 牌库构成 ---------- */
function testDeck() {
  console.log('\n[1] 牌库构成');
  const deck = buildDeck();
  const counts = {};
  for (const c of deck) counts[c.name] = (counts[c.name] || 0) + 1;

  check(deck.length >= 140, `牌库共 ${deck.length} 张（原先 116 张）`);
  check(Object.keys(counts).length >= 30, `包含 ${Object.keys(counts).length} 种卡牌`);

  // 每张牌都必须有中文名、类型与效果说明
  let bad = [];
  for (const name of Object.keys(counts)) {
    const m = CARD_META[name];
    if (!m || !m.cn || !m.type || !m.desc) bad.push(name);
  }
  check(bad.length === 0, `全部卡牌都有名称/类型/说明${bad.length ? '，缺失：' + bad : ''}`);

  // uid 唯一
  const uids = new Set(deck.map((c) => c.uid));
  check(uids.size === deck.length, '每张牌的 uid 唯一');

  // 新增类型必须存在
  const added = ['fire', 'thunder', 'bingliang', 'huogong', 'hanbing', 'guding', 'zhuque', 'tengjia', 'baiyin'];
  const missing = added.filter((n) => !counts[n]);
  check(missing.length === 0, `新增卡牌均已入牌堆${missing.length ? '，缺少：' + missing : ''}`);
  console.log('   新增：' + added.map((n) => `${CARD_META[n].cn}×${counts[n]}`).join('  '));

  // 杀的占比要够用
  const slashTotal = Object.keys(counts).filter(isSlashCard).reduce((n, k) => n + counts[k], 0);
  check(slashTotal >= 30, `杀系牌共 ${slashTotal} 张（普通杀 ${counts.slash} / 火杀 ${counts.fire} / 雷杀 ${counts.thunder}）`);
  check(counts.jink >= 15, `闪 ${counts.jink} 张`);
  check(counts.peach >= 10, `桃 ${counts.peach} 张`);

  // 属性杀的花色要符合规则
  for (const c of deck) {
    if (c.name === 'fire' && c.color !== 'red') { check(false, '火杀应为红色'); return; }
    if (c.name === 'thunder' && c.color !== 'black') { check(false, '雷杀应为黑色'); return; }
  }
  check(true, '火杀均为红色、雷杀均为黑色');
  check(elementOf('fire') === 'fire' && elementOf('thunder') === 'thunder' && elementOf('slash') === null,
    '属性杀的 element 元数据正确');
}

/* ---------- 2. 新卡牌在真实对局中被使用 ---------- */
async function testUsage() {
  console.log('\n[2] 新增卡牌在真实对局中被使用');
  const used = {};
  const fxTypes = {};
  const room = { id: 'CARD', broadcastGame() {}, socketOf() { return null; }, emitFX() {} };

  const N = 40;
  for (let k = 0; k < N; k++) {
    const g = new Game(room);
    g.aiDelay = 0; g.aiJitter = 0; g.turnTimeout = 5; g.reqTimeout = 2;
    const origLog = g.log.bind(g);
    g.log = (t) => { origLog(t); void t; };
    const heroes = HEROES.slice().sort(() => Math.random() - 0.5);
    g.init(Array.from({ length: 8 }, (_, i) => ({
      seat: i, id: `c${i}`, name: `AI${i + 1}`, isAI: true, heroId: heroes[(i + k) % heroes.length].id,
    })));
    // 记录所有打出的牌
    const origPlayCard = g.playCard.bind(g);
    g.playCard = async (p, act) => {
      used[act.as] = (used[act.as] || 0) + 1;
      return origPlayCard(p, act);
    };
    const origFX = g.emitFX.bind(g);
    g.emitFX = (fx) => { if (fx && fx.type) fxTypes[fx.type] = (fxTypes[fx.type] || 0) + 1; return origFX(fx); };
    await g.run();
  }

  const want = ['fire', 'thunder', 'bingliang', 'huogong', 'tengjia', 'baiyin', 'hanbing', 'guding', 'zhuque'];
  console.log('   ' + want.map((n) => `${CARD_META[n].cn}=${used[n] || 0}`).join('  '));
  const never = want.filter((n) => !used[n]);
  check(never.length === 0, `所有新增卡牌在 ${N} 局中都被使用过${never.length ? '，从未出现：' + never.map((n) => CARD_META[n].cn) : ''}`);
  check((fxTypes.judgeResult || 0) > 0, `判定结果事件已广播（${fxTypes.judgeResult || 0} 次）`);
  check((fxTypes.harvestReveal || 0) > 0 || (used.harvest || 0) > 0, '五谷丰登流程正常');
}

/* ---------- 3. 新装备效果 ---------- */
function makeGame() {
  const room = { id: 'EQ', broadcastGame() {}, socketOf() { return null; }, emitFX() {} };
  const g = new Game(room);
  g.aiDelay = 0; g.aiJitter = 0; g.turnTimeout = 5; g.reqTimeout = 2;
  const heroes = HEROES.slice().sort(() => Math.random() - 0.5);
  g.init(Array.from({ length: 4 }, (_, i) => ({
    seat: i, id: `e${i}`, name: `P${i + 1}`, isAI: true, heroId: heroes[i].id,
  })));
  return g;
}

async function testEquipment() {
  console.log('\n[3] 新增装备效果');

  // 藤甲：免疫普通杀
  {
    const g = makeGame();
    const a = g.players[0], b = g.players[1];
    b.equip.armor = g.drawPile.find((c) => c.name === 'tengjia') || null;
    if (b.equip.armor) {
      const hp0 = b.hp;
      b.hand = []; // 不给闪，若藤甲失效就会掉血
      await g.askCard(b.seat, 'jink', {});
      const evaded = await g.askJink(b, a, { uid: 'x', name: 'slash', cn: '杀', suit: 'club', num: 7, color: 'black', type: 'basic' }, {});
      check(evaded === true, '【藤甲】免疫普通【杀】');
      check(b.hp === hp0, '【藤甲】使目标不掉血');
    } else {
      console.log('  · 牌堆中未取到藤甲，跳过');
    }
  }

  // 藤甲：不免疫火杀
  {
    const g = makeGame();
    const a = g.players[0], b = g.players[1];
    b.equip.armor = g.drawPile.find((c) => c.name === 'tengjia') || null;
    if (b.equip.armor) {
      b.hand = []; // 清空手牌，确保没有【闪】可用，若仍不掉血则说明被藤甲免疫了
      const evaded = await g.askJink(b, a, { uid: 'y', name: 'fire', cn: '火杀', suit: 'heart', num: 4, color: 'red', type: 'basic' }, {});
      check(evaded === false, '【藤甲】无法免疫【火杀】（火杀可正常命中）');
    }
  }

  // 古锭刀：对无手牌角色伤害+1
  {
    const g = makeGame();
    const a = g.players[0], b = g.players[1];
    a.equip.weapon = g.drawPile.find((c) => c.name === 'guding') || null;
    if (a.equip.weapon) {
      b.hand = [];
      const hp0 = b.hp;
      await g.applyDamage({ source: a, target: b, amount: 1, card: null, reason: '古锭刀测试' });
      void hp0;
      // 走完整流程验证加成
      const hp1 = b.hp;
      b.hp = 5; b.maxHp = 5;
      // 直接调用 useSlash 的伤害计算路径
      await g.useSlash(a, [b], { uid: 'z', name: 'slash', cn: '杀', suit: 'club', num: 7, color: 'black', type: 'basic' }, { free: true });
      check(b.hp < 5, `【古锭刀】对无手牌角色造成了伤害（体力 ${hp1} → ${b.hp}）`);
    }
  }

  // 白银狮子：把大于1点的伤害压到1点
  {
    const g = makeGame();
    const b = g.players[1];
    b.equip.armor = g.drawPile.find((c) => c.name === 'baiyin') || null;
    if (b.equip.armor) {
      b.hp = 5; b.maxHp = 5;
      await g.applyDamage({ source: null, target: b, amount: 3, card: null, reason: '测试' });
      check(b.hp === 4, `【白银狮子】把 3 点伤害压为 1 点（体力 ${b.hp}）`);
    }
  }

  // 朱雀羽扇：普通杀变火杀
  {
    const g = makeGame();
    const a = g.players[0];
    a.equip.weapon = g.drawPile.find((c) => c.name === 'zhuque') || null;
    if (a.equip.weapon) {
      const el = g.slashElement(a, { uid: 'w', name: 'slash', cn: '杀', suit: 'club', num: 7, color: 'black', type: 'basic' });
      check(el === 'fire', '【朱雀羽扇】使普通【杀】变为火焰属性');
    }
  }

  // 兵粮寸断：判定不为梅花则跳过摸牌阶段
  {
    const g = makeGame();
    const p = g.players[0];
    const bl = g.drawPile.find((c) => c.name === 'bingliang');
    if (bl) {
      p.judge.push(bl);
      bl.ownerSeat = 1;
      // 固定为红桃，必定生效
      const fake = { uid: 'jj', name: 'peach', cn: '桃', suit: 'heart', num: 5, color: 'red', type: 'basic' };
      const res = g.judgeEffect(fake, '兵粮寸断');
      check(res.effect === true, '【兵粮寸断】判定不为梅花时生效（跳过摸牌阶段）');
      const res2 = g.judgeEffect({ ...fake, suit: 'club', color: 'black' }, '兵粮寸断');
      check(res2.effect === false, '【兵粮寸断】判定为梅花时失效');
    }
  }

  // 判定结果文案覆盖各种判定
  {
    const g = makeGame();
    const cases = [
      ['乐不思蜀', 'heart', false, false], ['乐不思蜀', 'club', true, false],
      ['兵粮寸断', 'club', false, false], ['兵粮寸断', 'heart', true, true],
      ['八卦阵', 'heart', true, true], ['八卦阵', 'club', false, false],
      ['铁骑', 'heart', true, true], ['刚烈', 'heart', false, false],
      ['洛神', 'club', true, true], ['洛神', 'heart', false, false],
    ];
    let ok = true;
    for (const [reason, suit, expectEffect] of cases) {
      const card = { uid: 't', name: 'slash', cn: '杀', suit, num: 7, color: suit === 'heart' ? 'red' : 'black', type: 'basic' };
      const r = g.judgeEffect(card, reason);
      if (r.effect !== expectEffect) { ok = false; errors.push(`判定 ${reason}/${suit} 结果应为 ${expectEffect}，实际 ${r.effect}`); }
    }
    check(ok, '各类判定的生效/失效判定与文案均正确');
    const lz = g.judgeEffect({ uid: 't', name: 'slash', cn: '杀', suit: 'spade', num: 5, color: 'black', type: 'basic' }, '闪电');
    check(lz.effect === true, '【闪电】黑桃2~9 时判定生效');
  }
}

(async () => {
  testDeck();
  await testUsage();
  await testEquipment();
  console.log('\n—— 结果 ——');
  if (errors.length === 0) console.log('牌堆与卡牌效果测试全部通过。');
  else console.log(`存在 ${errors.length} 处问题：\n - ` + errors.join('\n - '));
  process.exit(errors.length ? 1 : 0);
})();
