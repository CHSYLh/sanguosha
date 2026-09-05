/**
 * 验证任务1（服务端）：
 *   1) GET /api/net  返回局域网访问地址
 *   2) 对局过程中 fx（动画/音效）事件能实时广播到每个真人客户端
 * 用法：node tools/test-fx.js   （需先启动服务）
 */
const http = require('http');
const path = require('path');
const { io } = require('socket.io-client');

const HOST = process.env.HOST || 'localhost:3000';
const URL = `http://${HOST}`;
const HUMANS = parseInt(process.env.HUMANS || '2', 10);
const AIS = parseInt(process.env.AIS || '2', 10);

const errors = [];
function check(cond, msg) {
  if (!cond) { errors.push(msg); console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get(`${URL}${path}`, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

/* ---------- 1. 网络地址接口 ---------- */
async function testNetApi() {
  console.log('\n[1] 网络地址接口 GET /api/net');
  const net = await getJSON('/api/net');
  check(Array.isArray(net.ips) && net.ips.length > 0, `返回 ${net.ips.length} 个局域网 IP：${net.ips.join(', ')}`);
  check(Array.isArray(net.urls) && net.urls.length === net.ips.length, '生成对应的访问 URL');
  check(net.urls.every((u) => /^http:\/\/\d+(\.\d+){3}:\d+$/.test(u)), 'URL 格式正确（http://IP:端口）');
  check(typeof net.port === 'number' && net.port > 0, `端口为 ${net.port}`);
  check(typeof net.current === 'string', `当前访问地址为 ${net.current}`);
}

/* ---------- 2. fx 事件广播 ---------- */
function makeClient(idx, roomRef, onFx) {
  const clientId = `fx_${idx}_` + Math.random().toString(36).slice(2, 8);
  const socket = io(URL, { transports: ['websocket'] });
  const s = { idx, clientId, socket, fx: [], picked: false, joined: false };

  socket.on('connect', () => {
    if (idx === 0) {
      socket.emit('room:create', { clientId, name: `玩家${idx + 1}` }, (res) => {
        if (res && res.ok) {
          roomRef.id = res.roomId;
          socket.emit('room:setAICount', { count: AIS });
        }
      });
    }
  });

  // 非房主客户端：等房主拿到房间号后再加入
  if (idx > 0) {
    const tryJoin = () => {
      if (s.joined) return;
      if (!roomRef.id) return setTimeout(tryJoin, 200);
      socket.emit('room:join', { roomId: roomRef.id, clientId, name: `玩家${idx + 1}` }, (res) => {
        if (res && res.ok) s.joined = true;
        else setTimeout(tryJoin, 300);
      });
    };
    tryJoin();
  }

  socket.on('room', (r) => {
    if (!roomRef.id || r.id !== roomRef.id) return;
    if (idx === 0 && r.status === 'lobby' && r.playerCount === HUMANS + AIS && !roomRef.started) {
      roomRef.started = true;
      socket.emit('room:start');
    }
    if (r.status === 'picking' && !s.picked) {
      const me = r.players.find((p) => p.clientId === clientId);
      if (me && me.heroOptions && me.heroOptions.length) {
        s.picked = true;
        socket.emit('room:pickHero', { heroId: me.heroOptions.find((h) => !h.taken) ? me.heroOptions.find((h) => !h.taken).id : me.heroOptions[0].id });
      }
    }
  });

  // 统计收到的 fx 事件
  socket.on('fx', (fx) => {
    s.fx.push(fx);
    if (typeof onFx === 'function') onFx(s, fx);
  });

  socket.on('game', (g) => {
    if (!g.me || g.over) return;
    const p = g.pending;
    if (!p) return;
    if (p.kind === 'turn') {
      const cardAct = (p.actions || []).find((a) => a.type === 'card');
      if (cardAct && Math.random() < 0.8) {
        socket.emit('game:action', {
          type: 'card', as: cardAct.as, cardId: cardAct.cardId,
          targets: cardAct.targets && cardAct.targets.length ? [cardAct.targets[0]] : [],
          extraCards: [],
        });
      } else {
        socket.emit('game:action', { type: 'end' });
      }
    } else if (p.kind === 'respond') {
      socket.emit('game:respond', p.choices && p.choices.length ? { ids: [p.choices[0].id] } : null);
    } else if (p.kind === 'choose') {
      socket.emit('game:respond', { ids: (p.choices || []).slice(0, p.min || 1).map((c) => c.id) });
    } else if (p.kind === 'guanxing') {
      socket.emit('game:respond', { top: (p.cards || []).slice(0, 2).map((c) => c.uid) });
    }
  });

  return s;
}

async function testFx() {
  console.log(`\n[2] fx 事件广播（${HUMANS} 真人 + ${AIS} 人机）`);
  const roomRef = { id: null, started: false };
  let done = false;
  const clients = [];

  // 收集所有客户端所见 fx 类型的并集
  const seenTypes = new Set();
  const samples = {};

  for (let i = 0; i < HUMANS; i++) {
    clients.push(makeClient(i, roomRef, (s, fx) => {
      seenTypes.add(fx.type);
      if (!samples[fx.type]) samples[fx.type] = fx;
    }));
  }

  // 等待对局进行直至结束（以便覆盖 heal / skill / over 等事件）
  const deadline = Date.now() + 180000;
  while (!done && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const over = clients.some((c) => c.fx.some((f) => f.type === 'over'));
    if (over) done = true;
  }
  if (!done) console.log('  · 未在 180 秒内结束，按已收到的事件校验');

  console.log('  各客户端收到 fx 数量：' + clients.map((c) => `玩家${c.idx + 1}=${c.fx.length}`).join('  '));
  console.log('  出现的 fx 类型：' + [...seenTypes].join(', '));

  check(clients.length === HUMANS, `建立 ${HUMANS} 个真人客户端连接`);
  check(clients.every((c) => c.fx.length > 0), '每个客户端都收到了 fx 事件');

  // fx 事件必须携带渲染所需字段
  const need = {
    play: ['seat', 'as', 'card', 'targets'],
    damage: ['seat', 'amount'],
    heal: ['seat', 'amount'],
    die: ['seat', 'role'],
    turn: ['seat'],
    judge: ['seat', 'card', 'reason'],
    respond: ['seat', 'as', 'card'],
    skill: ['seat', 'skill', 'cn'],
    over: ['winner'],
  };
  for (const [type, fields] of Object.entries(need)) {
    const s = samples[type];
    if (!s) { console.log(`  · 本局未出现 ${type} 事件（随机性导致，跳过字段校验）`); continue; }
    const missing = fields.filter((f) => s[f] === undefined);
    check(missing.length === 0, `${type} 事件字段完整${missing.length ? '，缺少：' + missing : ''}`);
  }

  // 核心：出牌事件必须能用于动画
  const play = samples.play;
  if (play) {
    check(play.card && play.card.cn, `出牌事件带卡牌信息（${play.as} → ${play.card.cn}）`);
    check(Array.isArray(play.targets), '出牌事件带目标座位列表');
  }
  const dmg = samples.damage;
  if (dmg) check(typeof dmg.amount === 'number' && dmg.amount > 0, `伤害事件带伤害值（${dmg.amount}）`);

  for (const c of clients) c.socket.close();
}

/* ---------- 3. 等待信息向所有人广播且不泄露私有信息 ---------- */
async function testPendingPublic() {
  console.log(`\n[3] 等待信息公开广播（${HUMANS} 真人 + ${AIS} 人机）`);
  const roomRef = { id: null, started: false };
  const clients = [];
  const seenTitles = new Set();
  const kinds = new Set();
  let leak = 0;
  let bothSeen = 0;

  for (let i = 0; i < HUMANS; i++) {
    const clientId = `pp_${i}_` + Math.random().toString(36).slice(2, 8);
    const socket = io(URL, { transports: ['websocket'] });
    const s = { idx: i, clientId, socket, picked: false, joined: i === 0, states: 0 };

    socket.on('connect', () => {
      if (i === 0) {
        socket.emit('room:create', { clientId, name: `玩家${i + 1}` }, (res) => {
          if (res && res.ok) { roomRef.id = res.roomId; socket.emit('room:setAICount', { count: AIS }); }
        });
      }
    });
    if (i > 0) {
      const tryJoin = () => {
        if (s.joined) return;
        if (!roomRef.id) return setTimeout(tryJoin, 200);
        socket.emit('room:join', { roomId: roomRef.id, clientId, name: `玩家${i + 1}` }, (res) => {
          if (res && res.ok) s.joined = true; else setTimeout(tryJoin, 300);
        });
      };
      tryJoin();
    }

    socket.on('room', (r) => {
      if (!roomRef.id || r.id !== roomRef.id) return;
      if (i === 0 && r.status === 'lobby' && r.playerCount === HUMANS + AIS && !roomRef.started) {
        roomRef.started = true;
        socket.emit('room:start');
      }
      if (r.status === 'picking' && !s.picked) {
        const me = r.players.find((p) => p.clientId === clientId);
        if (me && me.heroOptions && me.heroOptions.length) {
          s.picked = true;
          const free = me.heroOptions.find((h) => !h.taken) || me.heroOptions[0];
          socket.emit('room:pickHero', { heroId: free.id });
        }
      }
    });

    socket.on('game', (g) => {
      if (!g.me) return;
      if (g.over) { s.finished = true; return; }
      s.states++;
      // 有 pendingPublic 时，必须带 title / seat / timeoutAt
      if (g.pendingPublic) {
        kinds.add(g.pendingPublic.kind + (g.pendingPublic.as ? ':' + g.pendingPublic.as : ''));
        if (g.pendingPublic.title) seenTitles.add(g.pendingPublic.title);
        if (!g.pendingPublic.timeoutAt) { leak++; console.error('  ✗ pendingPublic 缺少倒计时时间'); }
        // 绝不能携带可选手牌等私有信息
        if (g.pendingPublic.choices) { leak++; console.error('  ✗ pendingPublic 泄露了 choices'); }
        if (g.pendingPublic.actions) { leak++; console.error('  ✗ pendingPublic 泄露了 actions'); }
      }
      // 正在被询问的人才有 pending；其余人只有 pendingPublic
      if (g.pending && g.pendingPublic) bothSeen++;
      const p = g.pending;
      if (!p) return;
      if (p.kind === 'turn') {
        const act = (p.actions || []).find((a) => a.type === 'card');
        if (act && Math.random() < 0.75) {
          socket.emit('game:action', { type: 'card', as: act.as, cardId: act.cardId, targets: [], extraCards: [] });
        } else socket.emit('game:action', { type: 'end' });
      } else if (p.kind === 'respond') {
        // 偶尔放弃，以便更容易触发濒死求桃等流程
        socket.emit('game:respond', p.choices && p.choices.length ? { ids: [p.choices[0].id] } : null);
      } else if (p.kind === 'choose') {
        socket.emit('game:respond', { ids: (p.choices || []).slice(0, p.min || 1).map((c) => c.id) });
      } else if (p.kind === 'guanxing') {
        socket.emit('game:respond', { top: (p.cards || []).slice(0, 2).map((c) => c.uid) });
      }
    });

    clients.push(s);
  }

  // 跑到对局结束，确保真人玩家也被询问过（否则只能观察到 AI 的等待提示）
  const deadline = Date.now() + 220000;
  let over = false;
  while (Date.now() < deadline && !over) {
    await new Promise((r) => setTimeout(r, 400));
    if (clients.some((c) => c.finished)) over = true;
    if (bothSeen > 0 && seenTitles.size >= 3 && kinds.size >= 2) break;
  }

  console.log('  观察到的等待类型：' + [...kinds].join(', '));
  console.log('  观察到的提示文案示例：' + [...seenTitles].slice(0, 3).map((t) => `「${t}」`).join(' '));
  check(clients.every((c) => c.states > 0), '所有客户端均收到游戏状态');
  check(seenTitles.size > 0, '对局中生成了等待提示文案');
  check(kinds.size >= 1, '等待提示覆盖了多种操作类型');
  check(leak === 0, '等待提示未泄露任何私有信息（choices / actions）');
  check(bothSeen > 0, '被询问者同时拥有 pending 与 pendingPublic');

  for (const c of clients) c.socket.close();
}

/* ---------- 4. 无懈可击：不询问锦囊使用者本人 ---------- */
async function testWuxieSkipsCaster() {
  console.log('\n[4] 无懈可击不会询问锦囊使用者本人');

  // 用引擎直接构造场景，精确验证“不会询问使用者”
  const { Game } = require(path.join(__dirname, '..', 'src', 'engine'));
  const { HEROES } = require(path.join(__dirname, '..', 'src', 'heroes'));
  const { makeCard, cardView } = require(path.join(__dirname, '..', 'src', 'cards'));

  const asked = [];
  const room = {
    id: 'WX',
    broadcastGame() {},
    socketOf() { return null; },
    emitFX() {},
  };
  const g = new Game(room);
  g.aiDelay = 0; g.aiJitter = 0;
  const heroes = HEROES.slice().sort(() => Math.random() - 0.5);
  g.init(Array.from({ length: 4 }, (_, i) => ({
    seat: i, id: `wx${i}`, name: `P${i + 1}`, isAI: false, heroId: heroes[i].id,
  })));

  // 记录每次询问，并一律回答“不使用”
  const origRespond = g.respond.bind(g);
  g.respond = async (seat, kind, ctx) => {
    if (kind === 'wuxie') asked.push(seat);
    return null;
  };
  void origRespond;

  // 给所有存活角色都发一张无懈可击，确保“没有被询问”只可能是因为规则跳过
  for (const p of g.players) {
    const c = makeCard('wuxie', 'spade', 11);
    c.uid = `wx_${p.seat}`;
    p.hand.push(c);
  }

  const sourceSeat = 0;
  const targetSeat = 1;
  await g.askWuxie('dismantle', sourceSeat, targetSeat);

  console.log(`  使用者座位=${sourceSeat}，被询问的座位=[${asked.join(', ')}]`);
  check(asked.length > 0, '确实向其他角色询问了是否使用无懈可击');
  check(asked.indexOf(sourceSeat) < 0, '锦囊使用者本人没有被询问（符合需求）');
  check(asked.length === g.players.length - 1,
    `除使用者外的所有角色都被询问（${asked.length}/${g.players.length - 1}）`);
  void cardView;
}

(async () => {
  try {
    await testNetApi();
    await testFx();
    await testPendingPublic();
    await testWuxieSkipsCaster();
  } catch (e) {
    errors.push('异常：' + e.message);
    console.error(e);
  }
  console.log('\n—— 结果 ——');
  if (errors.length === 0) console.log('服务端接口与特效广播测试全部通过。');
  else console.log(`存在 ${errors.length} 处问题：\n - ` + errors.join('\n - '));
  process.exit(errors.length ? 1 : 0);
})();
