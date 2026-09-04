/**
 * 全人数冒烟测试：对 2~10 人局各自动模拟若干局，覆盖身份自动配置表的每一种人数。
 * 每局结束后校验：
 *   1) 引擎未抛异常且能正常分出胜负
 *   2) 体力值不超过上限
 *   3) 牌张守恒——全牌库中每张牌必须恰好存在于一个区域（手牌/装备/判定/牌堆/弃牌堆）
 * 用法：node tools/simulate-all.js [每种人数的局数]
 *   例：node tools/simulate-all.js 3   → 2~10 人各 3 局，共 27 局
 */
const path = require('path');
const { Game } = require(path.join(__dirname, '..', 'src', 'engine'));
const { HEROES } = require(path.join(__dirname, '..', 'src', 'heroes'));
const { buildDeck } = require(path.join(__dirname, '..', 'src', 'cards'));
const { MIN_PLAYERS, MAX_PLAYERS, roleSummary } = require(path.join(__dirname, '..', 'src', 'roles'));
const { shuffle } = require(path.join(__dirname, '..', 'src', 'util'));

const DECK_SIZE = buildDeck().length;
const PER_SIZE = Math.max(1, parseInt(process.argv[2], 10) || 2);

let errors = 0;
// 打印完整堆栈，便于定位偶发问题
process.on('unhandledRejection', (e) => {
  errors++;
  console.error('[未捕获的异步异常]', e && e.stack ? e.stack : e);
});
process.on('uncaughtException', (e) => {
  errors++;
  console.error('[未捕获异常]', e && e.stack ? e.stack : e);
});

const fakeRoom = {
  id: 'SIM',
  broadcastGame() {},
  socketOf() { return null; },
};

function makeEntries(n) {
  const heroes = shuffle(HEROES);
  return Array.from({ length: n }, (_, i) => ({
    seat: i, id: `ai_${i}`, name: `AI${i + 1}`, isAI: true, heroId: heroes[i % heroes.length].id,
  }));
}

/** 牌张守恒 + 体力合法性检查，返回本局新增的错误数 */
function checkIntegrity(game, tag) {
  let bad = 0;
  const seen = new Map();
  const add = (card, zone) => {
    if (!card) return;
    if (!card.uid) { bad++; errors++; console.error(`  !! ${tag} ${zone} 存在非法卡牌数据`); return; }
    if (seen.has(card.uid)) {
      bad++; errors++;
      console.error(`  !! ${tag} 卡牌 ${card.uid}（${card.name}）同时存在于「${seen.get(card.uid)}」和「${zone}」`);
    } else seen.set(card.uid, zone);
  };
  for (const p of game.players) {
    if (p.hp > p.maxHp) {
      bad++; errors++;
      console.error(`  !! ${tag} ${p.name} 体力 ${p.hp} 超过上限 ${p.maxHp}`);
    }
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
    bad++; errors++;
    console.error(`  !! ${tag} 牌张总数 ${total} 与牌库 ${DECK_SIZE} 不符`);
  }
  return bad;
}

async function runOne(size, idx) {
  const tag = `${size}人第${idx + 1}局`;
  const game = new Game(fakeRoom);
  game.aiDelay = 0;
  game.aiJitter = 0;
  game.turnTimeout = 5;
  game.reqTimeout = 2;
  game.init(makeEntries(size));
  const t0 = Date.now();
  await game.run();
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  if (!game.winner) {
    errors++;
    console.error(`  !! ${tag} 没有正常结束`);
    console.error(game.logs.slice(-20).map((l) => '   ' + l.text).join('\n'));
  }
  checkIntegrity(game, tag);
  return { game, dur };
}

(async () => {
  const sizes = [];
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) sizes.push(n);
  console.log(`开始全人数模拟：${sizes.join('/')} 人，每种 ${PER_SIZE} 局，共 ${sizes.length * PER_SIZE} 局（全部由 AI 操作）`);
  console.log(`牌库共 ${DECK_SIZE} 张\n`);

  const rows = [];
  for (const size of sizes) {
    const s = roleSummary(size);
    const cfg = `${s.lord}主/${s.loyal}忠/${s.rebel}反/${s.rene}内`;
    const tally = { lord: 0, rebel: 0, rene: 0, none: 0 };
    let rounds = 0;
    let ms = 0;
    for (let i = 0; i < PER_SIZE; i++) {
      const { game, dur } = await runOne(size, i);
      tally[game.winner || 'none']++;
      rounds += game.round;
      ms += parseFloat(dur);
    }
    const avg = (rounds / PER_SIZE).toFixed(1);
    rows.push({ size, cfg, avg, ms: ms.toFixed(1), tally });
    const ok = tally.none === 0;
    console.log(`${String(size).padStart(2)} 人局 [${cfg}]  平均 ${avg} 轮 · 用时 ${ms.toFixed(1)}s · ` +
      `主公胜 ${tally.lord} / 反贼胜 ${tally.rebel} / 内奸胜 ${tally.rene} / 未结束 ${tally.none} ${ok ? '' : '  <-- 有异常'}`);
  }

  console.log('\n—— 汇总 ——');
  console.log('身份配置校验：' + sizes.map((n) => {
    const s = roleSummary(n);
    return `${n}人=${s.lord + s.loyal + s.rebel + s.rene}`;
  }).join(' '));
  const totalGames = sizes.length * PER_SIZE;
  const finished = rows.reduce((n, r) => n + (PER_SIZE - r.tally.none), 0);
  console.log(`总局数 ${totalGames} · 正常分出胜负 ${finished} · 平均轮数 ${(rows.reduce((n, r) => n + parseFloat(r.avg), 0) / rows.length).toFixed(1)}`);
  console.log(errors === 0 ? '全部通过，未发现异常。' : `发现 ${errors} 处异常。`);
  process.exit(errors === 0 ? 0 : 1);
})();
