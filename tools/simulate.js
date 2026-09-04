/**
 * 冒烟测试：纯人机自动对局，用于验证引擎不会崩溃且能正常分出胜负。
 * 用法：node tools/simulate.js [局数] [每局人数]
 */
const path = require('path');
const { Game } = require(path.join(__dirname, '..', 'src', 'engine'));
const { HEROES } = require(path.join(__dirname, '..', 'src', 'heroes'));
const { buildDeck } = require(path.join(__dirname, '..', 'src', 'cards'));

const DECK_SIZE = buildDeck().length;

const GAMES = parseInt(process.argv[2], 10) || 3;
const SIZE = parseInt(process.argv[3], 10) || 6;

const fakeRoom = {
  id: 'SIM',
  broadcastGame() {},
  socketOf() { return null; },
};

let errors = 0;
process.on('unhandledRejection', (e) => { errors++; console.error('[未捕获的异步异常]', e); });
process.on('uncaughtException', (e) => { errors++; console.error('[未捕获异常]', e); });

function makeEntries(n) {
  const heroes = HEROES.slice().sort(() => Math.random() - 0.5);
  return Array.from({ length: n }, (_, i) => ({
    seat: i, id: `ai_${i}`, name: `AI${i + 1}`, isAI: true, heroId: heroes[i % heroes.length].id,
  }));
}

async function runOne(idx) {
  const game = new Game(fakeRoom);
  game.aiDelay = 0;
  game.aiJitter = 0;
  game.turnTimeout = 5;
  game.reqTimeout = 2;
  game.init(makeEntries(SIZE));
  const t0 = Date.now();
  await game.run();
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  const win = game.winner || '未分胜负';
  console.log(`第 ${idx + 1} 局：${SIZE} 人 · ${game.round} 轮 · 用时 ${dur}s · 胜方：${win}`);
  if (!game.winner) {
    errors++;
    console.error('  !! 该局没有正常结束');
    console.error(game.logs.slice(-20).map((l) => '   ' + l.text).join('\n'));
  }
  // 完整性检查：全牌库中每张牌必须恰好存在于一个区域
  const seen = new Map();
  const add = (card, zone) => {
    if (!card) return;
    if (!card.uid) { errors++; console.error(`  !! ${zone} 存在非法卡牌数据`); return; }
    if (seen.has(card.uid)) {
      errors++;
      console.error(`  !! 卡牌 ${card.uid}（${card.name}）同时存在于「${seen.get(card.uid)}」和「${zone}」`);
    } else seen.set(card.uid, zone);
  };
  for (const p of game.players) {
    if (p.hp > p.maxHp) { errors++; console.error(`  !! ${p.name} 体力 ${p.hp} 超过上限 ${p.maxHp}`); }
    p.hand.forEach((c) => add(c, `${p.name}的手牌`));
    for (const slot of ['weapon', 'armor', 'horsePlus', 'horseMinus']) add(p.equip[slot], `${p.name}的装备`);
    p.judge.forEach((c) => add(c, `${p.name}的判定区`));
  }
  game.drawPile.forEach((c) => add(c, '牌堆'));
  game.discardPile.forEach((c) => add(c, '弃牌堆'));
  const total = game.drawPile.length + game.discardPile.length
    + game.players.reduce((n, p) => n + p.hand.length + p.judge.length
      + Object.values(p.equip).filter(Boolean).length, 0);
  if (total !== DECK_SIZE) {
    errors++;
    console.error(`  !! 牌张总数 ${total} 与牌库 ${DECK_SIZE} 不符`);
  }
  return game;
}

(async () => {
  console.log(`开始模拟：${GAMES} 局 × ${SIZE} 人（全部由 AI 操作）`);
  const tally = { lord: 0, rebel: 0, rene: 0, none: 0 };
  let rounds = 0;
  for (let i = 0; i < GAMES; i++) {
    const g = await runOne(i);
    tally[g.winner || 'none']++;
    rounds += g.round;
  }
  console.log('\n—— 统计 ——');
  console.log(`主公/忠臣胜：${tally.lord}　反贼胜：${tally.rebel}　内奸胜：${tally.rene}　未结束：${tally.none}`);
  console.log(`平均轮数：${(rounds / GAMES).toFixed(1)}`);
  console.log(errors === 0 ? '全部通过，未发现异常。' : `发现 ${errors} 处异常。`);
  process.exit(errors === 0 ? 0 : 1);
})();
