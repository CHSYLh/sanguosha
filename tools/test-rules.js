/**
 * 规则测试：
 *   1) 胜负判定（主公阵亡 / 反贼与内奸全灭 / 内奸单独存活 等各种组合）
 *   2) 濒死时可用【酒】自救
 *   3) 启动端口被占用时的处理（server.js 的 EADDRINUSE 友好提示）
 * 用法：node tools/test-rules.js
 */
const path = require('path');
const fs = require('fs');
const { Game } = require(path.join(__dirname, '..', 'src', 'engine'));
const { HEROES } = require(path.join(__dirname, '..', 'src', 'heroes'));
const { makeCard } = require(path.join(__dirname, '..', 'src', 'cards'));
const { Room } = require(path.join(__dirname, '..', 'src', 'rooms'));

const errors = [];
function check(cond, msg) {
  if (!cond) { errors.push(msg); console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

function makeGame() {
  const room = { id: 'RULE', broadcastGame() {}, socketOf() { return null; }, emitFX() {} };
  const g = new Game(room);
  g.aiDelay = 0; g.aiJitter = 0; g.turnTimeout = 5; g.reqTimeout = 2;
  return g;
}

/** 直接构造一个指定身份与存活状态的局面，返回 checkOver 后的 winner */
function setup(g, roles, deadFlags) {
  const heroes = HEROES.slice().sort(() => Math.random() - 0.5);
  g.init(Array.from({ length: roles.length }, (_, i) => ({
    seat: i, id: `r${i}`, name: `P${i + 1}`, isAI: true, heroId: heroes[i].id,
  })));
  // 覆盖随机身份，改为我们指定的身份
  g.players.forEach((p, i) => { p.role = roles[i]; });
  g.lordSeat = g.players.find((p) => p.role === 'lord').seat;
  g.players.forEach((p, i) => { p.dead = !!deadFlags[i]; });
  g.checkOver();
  return g.winner;
}

/* ---------- 1. 胜负判定 ---------- */
function testWinConditions() {
  console.log('\n[1] 胜负判定');

  // 反贼与内奸全灭 → 主公与忠臣胜
  {
    const g = makeGame();
    const w = setup(g, ['lord', 'loyal', 'rebel', 'rene'], [false, false, true, true]);
    check(w === 'lord', '反贼与内奸全部阵亡 → 主公与忠臣获胜');
  }

  // 主公阵亡，仅剩内奸一人 → 内奸胜
  {
    const g = makeGame();
    const w = setup(g, ['lord', 'loyal', 'rebel', 'rene'], [true, true, true, false]);
    check(w === 'rene', '主公阵亡且仅剩内奸一人 → 内奸获胜');
  }

  // 主公阵亡，忠臣还活着（内奸没杀光）→ 反贼胜
  {
    const g = makeGame();
    const w = setup(g, ['lord', 'loyal', 'rebel', 'rene'], [true, false, true, false]);
    check(w === 'rebel', '反贼已死光但主公先于忠臣阵亡 → 仍判反贼获胜');
  }
  // 同上但反贼也还活着
  {
    const g = makeGame();
    const w = setup(g, ['lord', 'loyal', 'rebel', 'rene'], [true, false, false, false]);
    check(w === 'rebel', '主公阵亡且仍有忠臣存活 → 反贼获胜');
  }

  // 主公阵亡，只剩两名内奸 → 内奸胜（不能因为“内奸不是1个”就判反贼）
  {
    const g = makeGame();
    const w = setup(g, ['lord', 'loyal', 'rebel', 'rene', 'rene'], [true, true, true, false, false]);
    check(w === 'rene', '主公阵亡且只剩内奸（2 名）→ 内奸获胜');
  }

  // 主公阵亡，内奸和忠臣都在 → 反贼胜
  {
    const g = makeGame();
    const w = setup(g, ['lord', 'loyal', 'loyal', 'rene'], [true, false, false, false]);
    check(w === 'rebel', '主公阵亡，忠臣与内奸均存活 → 反贼获胜');
  }

  // 尚未结束的情况不应误判
  {
    const g = makeGame();
    const w = setup(g, ['lord', 'loyal', 'rebel', 'rene'], [false, false, false, false]);
    check(w === null, '局势未定时不产生胜负');
  }
  // 反贼全灭但内奸还在 → 未结束
  {
    const g = makeGame();
    const w = setup(g, ['lord', 'loyal', 'rebel', 'rene'], [false, false, true, false]);
    check(w === null, '反贼全灭但内奸存活 → 游戏继续');
  }
}

/* ---------- 2. 濒死用酒自救 ---------- */
async function testWineSelfRescue() {
  console.log('\n[2] 濒死可用【酒】自救');

  const g = makeGame();
  const heroes = HEROES.slice().sort(() => Math.random() - 0.5);
  g.init(Array.from({ length: 4 }, (_, i) => ({
    seat: i, id: `w${i}`, name: `P${i + 1}`, isAI: true, heroId: heroes[i].id,
  })));

  const me = g.players[0];
  const other = g.players[1];

  // 自己濒死：手牌里有酒，应当可以打出
  me.hand = [makeCard('wine', 'club', 9)];
  me.hp = 0;
  const opts = g.cardOptions(me, 'peach', { dying: true, target: me });
  check(opts.some((o) => o.card && o.card.name === 'wine'),
    '自己濒死时，手牌中的【酒】可作为救援牌打出');

  // 普通桃依然可用
  me.hand = [makeCard('peach', 'heart', 5)];
  const opts2 = g.cardOptions(me, 'peach', { dying: true, target: me });
  check(opts2.some((o) => o.card && o.card.name === 'peach'), '自己濒死时【桃】可用');

  // 别人濒死时，自己的酒不能用来救人（酒只能自救）
  me.hand = [makeCard('wine', 'club', 9)];
  const opts3 = g.cardOptions(me, 'peach', { dying: true, target: other });
  check(!opts3.some((o) => o.card && o.card.name === 'wine'),
    '他人濒死时，自己的【酒】不能用于救援（酒只能自救）');

  // 非濒死状态下，酒不能当桃
  me.hand = [makeCard('wine', 'club', 9)];
  const opts4 = g.cardOptions(me, 'peach', {});
  check(!opts4.some((o) => o.card && o.card.name === 'wine'), '非濒死时【酒】不能当【桃】使用');

  // 端到端：自己濒死且只有一张酒，AI 应当用它自救
  {
    const g2 = makeGame();
    const hs = HEROES.slice().sort(() => Math.random() - 0.5);
    g2.init(Array.from({ length: 4 }, (_, i) => ({
      seat: i, id: `x${i}`, name: `AI${i + 1}`, isAI: true, heroId: hs[i].id,
    })));
    const p = g2.players[0];
    // 清空其他人手牌，确保只有自己手上的酒能救自己
    g2.players.forEach((x, i) => { x.hand = i === 0 ? [makeCard('wine', 'club', 9)] : []; });
    p.hp = 0;
    await g2.resolveDying(p, g2.players[1]);
    check(!p.dead && p.hp === 1, `濒死时用【酒】成功自救（体力 ${p.hp}，阵亡=${p.dead}）`);
    check(p.hand.length === 0, '自救后【酒】已被弃置（说明确实是自己的酒生效）');
    check(g2.discardPile.some((c) => c.name === 'wine'), '【酒】进入了弃牌堆');
  }
}

/* ---------- 2.5 救援者范围（含击杀者） ---------- */
async function testRescuers() {
  console.log('\n[2.5] 救援者范围');

  /**
   * 直接拦截 respond，记录「谁被询问」，避免测到 AI 的敌我判断
   * （AI 即使被询问也可能主动放弃救援，那属于策略而非规则）。
   */
  function spyRespond(g, answerFor) {
    const asked = [];
    g.respond = async (seat, kind, ctx) => {
      if (kind === 'peach') {
        asked.push(seat);
        if (answerFor && answerFor.seat === seat) return answerFor.id;
      }
      return null;
    };
    return asked;
  }

  function build() {
    const g = makeGame();
    const hs = HEROES.slice().sort(() => Math.random() - 0.5);
    g.init(Array.from({ length: 4 }, (_, i) => ({
      seat: i, id: `k${i}`, name: `AI${i + 1}`, isAI: true, heroId: hs[i].id,
    })));
    return g;
  }

  // 击杀者会被询问（规则允许其救援）
  {
    const g = build();
    const killer = g.players[1], victim = g.players[0];
    g.players.forEach((x) => { x.hand = x.seat === killer.seat ? [makeCard('peach', 'heart', 5)] : []; });
    const asked = spyRespond(g);
    victim.hp = 0;
    await g.resolveDying(victim, killer);
    check(asked.indexOf(killer.seat) >= 0,
      `击杀者会被询问是否救援（被询问座位=[${asked.join(',')}]，击杀者=${killer.seat}）`);
  }

  // 击杀者若交出桃，则被击倒者获救
  {
    const g = build();
    const killer = g.players[1], victim = g.players[0];
    const peach = makeCard('peach', 'heart', 5);
    g.players.forEach((x) => { x.hand = x.seat === killer.seat ? [peach] : []; });
    spyRespond(g, { seat: killer.seat, id: peach.uid });
    victim.hp = 0;
    await g.resolveDying(victim, killer);
    check(!victim.dead && victim.hp === 1, '击杀者交出桃后，被击倒者被救活');
    // 用「那张桃已不在手上」判断，而不是手牌数为 0：
    // 随机武将可能带【连营】等技能，用掉最后一张手牌后会再摸一张
    check(!killer.hand.includes(peach), '救援消耗了那张桃');
  }

  // 其他角色同样会被询问
  {
    const g = build();
    const other = g.players[2], victim = g.players[0];
    g.players.forEach((x) => { x.hand = x.seat === other.seat ? [makeCard('peach', 'heart', 5)] : []; });
    const asked = spyRespond(g);
    victim.hp = 0;
    await g.resolveDying(victim, g.players[1]);
    check(asked.indexOf(other.seat) >= 0, '其他持有桃的角色也会被询问');
  }

  // 无伤害来源（如闪电）时仍会询问
  {
    const g = build();
    const holder = g.players[1], victim = g.players[0];
    g.players.forEach((x) => { x.hand = x.seat === holder.seat ? [makeCard('peach', 'heart', 5)] : []; });
    const asked = spyRespond(g);
    victim.hp = 0;
    await g.resolveDying(victim, null);
    check(asked.indexOf(holder.seat) >= 0, '无伤害来源（如闪电）时仍会询问持有桃的角色');
  }

  // 无人有桃则不会询问任何人，正常阵亡
  {
    const g = build();
    g.players.forEach((x) => { x.hand = []; });
    const asked = spyRespond(g);
    g.players[0].hp = 0;
    await g.resolveDying(g.players[0], g.players[1]);
    check(asked.length === 0, '无人持有桃时不询问任何人');
    check(g.players[0].dead, '无人救援时正常阵亡');
  }
}

/* ---------- 3. 端口占用处理 ---------- */
/** 读取脚本：.bat 保存为 GBK，需要按正确编码解码才能校验中文文案 */
function readScript(rel) {
  const buf = fs.readFileSync(path.join(__dirname, '..', rel));
  const cands = [];
  for (const enc of ['utf-8', 'gbk']) {
    try { cands.push(new TextDecoder(enc, { fatal: true }).decode(buf)); } catch (e) { /* 换下一种编码 */ }
  }
  // 选中能正确解出中文标题的那个，避免把乱码拿去匹配
  return cands.find((s) => s.indexOf('三国杀') >= 0) || cands[0] || buf.toString('utf8');
}

function testPortHandling() {
  console.log('\n[3] 端口占用与停止服务');
  const src = readScript('server.js');
  check(/EADDRINUSE/.test(src), 'server.js 识别 EADDRINUSE 错误码');
  check(/server\.on\('error'/.test(src), 'server.js 注册了监听错误回调');
  check(/已被占用/.test(src), '端口被占用时给出友好提示而不是抛出未处理异常');

  const bat = readScript('启动三国杀.bat');
  check(/healthz/.test(bat), '启动脚本会先探测服务是否已在运行');
  check(/已经?在运行/.test(bat), '启动脚本检测到已在运行时给出明确提示');
  check(/exit \/b 0/.test(bat), '检测到已运行时直接打开浏览器并正常退出（不重复启动）');

  // 后台运行时也能被停止
  const stopBat = readScript('停止三国杀.bat');
  check(!!stopBat && /stop-server\.ps1/.test(stopBat), '提供「停止三国杀.bat」用于结束后台服务');
  const ps1 = readScript(path.join('tools', 'stop-server.ps1'));
  check(/server\.js/.test(ps1) && /Stop-Process/.test(ps1),
    '停止脚本按命令行匹配 server.js 精确结束进程（不影响其它 node 程序）');
  // ps1 必须保持纯 ASCII，否则 Windows PowerShell 5.1 会因 BOM/编码报错
  const raw = fs.readFileSync(path.join(__dirname, '..', 'tools', 'stop-server.ps1'));
  const allAscii = Array.from(raw).every((b) => b < 128);
  check(raw[0] !== 0xEF && allAscii,
    'stop-server.ps1 为纯 ASCII 且无 BOM（Windows PowerShell 5.1 可正确解析）');
}

/* ---------- 4. 房间聊天 ---------- */
async function testChat() {
  console.log('\n[4] 房间聊天');
  const r = new Room('CHAT');
  r.join('c1', null, '张三');
  r.addAI();
  const p1 = r.players[0];
  const ai = r.players[1];

  check(r.addChat('c1', '大家好') !== null, '房间内成员可以发送消息');
  check(r.addChat('c1', '   ') === null, '空白内容不会被收录');
  check(r.addChat('c1', '') === null, '空内容不会被收录');
  check(r.addChat('nobody', '我不在房间里') === null, '非本房成员不能发送');
  check(r.addChat(ai.clientId, '人机发言') === null, '人机不会发言');

  // 限流：同一人短时间内连发只收录第一条
  const before = r.chat.length;
  r.addChat('c1', '刷屏1');
  const after = r.chat.length;
  check(after === before, '同一人短时间内的连续发言被限流（防刷屏）');

  // 长度截断
  await new Promise((res) => setTimeout(res, 700));
  const long = '很长的内容'.repeat(30);
  const m = r.addChat('c1', long);
  check(!!m && m.text.length === 60, `超长消息被截断到 60 字（实际 ${m && m.text.length}）`);

  // 消息内容
  const first = r.chat[0];
  check(first && first.name === '张三', '消息带发言者昵称（张三）');
  check(first && first.seat === p1.seat, `消息带发言者座位号（${first && first.seat}）`);
  check(first && typeof first.ts === 'number' && first.ts > 0, '消息带时间戳（客户端据此判断是否为新消息）');
  check(first && typeof first.id === 'number' && first.id > 0, '消息带自增 id（客户端据此去重）');

  // 房间状态里携带聊天记录，后加入的人也能看到
  const st = r.roomState();
  check(Array.isArray(st.chat) && st.chat.some((x) => x.text === '大家好'), '房间状态里携带聊天记录');

  // 回到大厅会清空上一局的聊天
  r.backToLobby();
  check(r.chat.length === 0, '回到大厅后清空聊天记录');

  // 条数上限
  const r2 = new Room('CHAT2');
  r2.join('c9', null, '李四');
  for (let i = 0; i < 60; i++) {
    r2.lastChatAt.c9 = 0;   // 绕开限流，只验证条数上限
    r2.addChat('c9', `第${i}条`);
  }
  check(r2.chat.length === 40, `聊天记录最多保留 40 条（实际 ${r2.chat.length}）`);
  check(r2.chat[r2.chat.length - 1].text === '第59条', '保留的是最近的消息');
}

(async () => {
  testWinConditions();
  await testWineSelfRescue();
  await testRescuers();
  await testChat();
  testPortHandling();
  console.log('\n—— 结果 ——');
  if (errors.length === 0) console.log('规则测试全部通过。');
  else console.log(`存在 ${errors.length} 处问题：\n - ` + errors.join('\n - '));
  process.exit(errors.length ? 1 : 0);
})();
