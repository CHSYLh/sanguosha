/**
 * 端到端联机冒烟测试：2 个真人客户端 + 若干人机同桌，走完 房间 → 选将 → 对局 → 结算 全流程，
 * 同时校验服务端对玩家私有信息（手牌 / 身份）的隔离。
 * 用法：node tools/e2e.js   （需先启动服务：node server.js）
 */
const { io } = require('socket.io-client');
const http = require('http');

const URL = process.env.URL || 'http://localhost:3000';
const HUMANS = parseInt(process.env.HUMANS || '2', 10);
const AIS = parseInt(process.env.AIS || '2', 10);
// 默认预算随人数增加：人机每次决策都有固定思考耗时（默认 900ms），人数越多耗时越长。
// 想让联机测试跑得快一些，可用 SGS_AI_DELAY=100 启动服务，或直接用 E2E_TIMEOUT 覆盖。
const TIMEOUT = parseInt(process.env.E2E_TIMEOUT || String(120000 + (HUMANS + AIS) * 60000), 10);
const CHAT_TEXT = '开黑吗';     // 开局前聊天测试用的消息
const CHAT_TEXT2 = '打得好';    // 对局进行中聊天测试用的消息

const errors = [];
const clients = [];
let roomId = null;
let finished = false;
let started = false;
let pushes = 0;
let chatInRoomState = false;
let inGameChatSent = false;

function check(cond, msg) {
  if (!cond) { errors.push(msg); console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

/** 校验服务端网络地址接口 GET /api/net */
function checkNetAPI(done) {
  const req = http.get(`${URL}/api/net`, (res) => {
    let data = '';
    res.on('data', (d) => { data += d; });
    res.on('end', () => {
      let j = null;
      try { j = JSON.parse(data); } catch (e) { /* 下面统一报错 */ }
      if (!j) {
        errors.push('/api/net 未返回合法 JSON');
        console.error('  ✗ /api/net 未返回合法 JSON');
      } else {
        check(j.ok === true, 'GET /api/net 返回 ok');
        check(Number(j.port) > 0, `/api/net 返回监听端口 ${j.port}`);
        check(/^http:\/\/localhost:\d+$/.test(j.localUrl || ''), `/api/net 返回本机地址 ${j.localUrl}`);
        check(Array.isArray(j.ips) && Array.isArray(j.urls) && j.urls.length === j.ips.length,
          `/api/net 返回 ${(j.ips || []).length} 个局域网地址`);
      }
      done();
    });
  });
  req.on('error', (e) => {
    errors.push(`/api/net 请求失败：${e.message}（请先启动 npm start）`);
    console.error('  ✗ /api/net 请求失败：' + e.message);
    done();
  });
}

function makeClient(idx) {
  const clientId = `e2e_${idx}_` + Math.random().toString(36).slice(2, 8);
  const socket = io(URL, { transports: ['websocket'] });
  const s = { idx, clientId, socket, picked: false, pushes: 0, fx: [], fxTypes: {}, fxBadSeq: 0, chat: [] };
  clients.push(s);

  socket.on('connect', () => {
    if (idx === 0) {
      socket.emit('room:create', { clientId, name: `玩家${idx + 1}` }, (res) => {
        check(!!(res && res.ok), '房主创建房间成功');
        roomId = res.roomId;
        socket.emit('room:setAICount', { count: AIS });
      });
    } else {
      const tryJoin = () => {
        if (!roomId) return setTimeout(tryJoin, 200);
        socket.emit('room:join', { roomId, clientId, name: `玩家${idx + 1}` }, (res) => {
          check(!!(res && res.ok), `玩家${idx + 1} 加入房间 ${roomId}`);
        });
      };
      tryJoin();
    }
  });

  socket.on('room', (r) => {
    if (!roomId || r.id !== roomId) return;
    const want = HUMANS + AIS;
    if (Array.isArray(r.chat) && r.chat.some((m) => m.text === CHAT_TEXT)) chatInRoomState = true;
    if (r.status === 'lobby' && r.playerCount === want && !started && idx === 0) {
      started = true;
      const s2 = r.roleSummary;
      check(s2.lord === 1, `${want} 人局身份自动配置：主公${s2.lord}/忠臣${s2.loyal}/反贼${s2.rebel}/内奸${s2.rene}`);
      check(s2.lord + s2.loyal + s2.rebel + s2.rene === want, '身份数量之和等于总人数');
      // 开局前先发一条聊天，验证房间内所有人都能收到
      socket.emit('room:chat', { text: CHAT_TEXT });
      socket.emit('room:start');
    }
    if (r.status === 'picking' && !s.picked) {
      const me = r.players.find((p) => p.clientId === clientId);
      if (me && me.heroOptions && me.heroOptions.length) {
        s.picked = true;
        socket.emit('room:pickHero', { heroId: me.heroOptions[0].id });
      }
    }
  });

  socket.on('game', (g) => {
    if (!g.me) return;
    s.pushes++;
    pushes++;

    // 对局进行中发一条聊天：延迟发送以避开限流，同时验证游戏照常推进
    if (idx === 0 && !inGameChatSent) {
      inGameChatSent = true;
      setTimeout(() => socket.emit('room:chat', { text: CHAT_TEXT2 }), 900);
    }

    // 信息隔离：对局中只能看到自己的身份、主公身份与已阵亡者身份
    if (!g.over) {
      const leaked = g.players.filter((p) => p.seat !== g.me.seat)
        .filter((p) => p.role !== 'unknown' && p.role !== 'lord' && !p.dead);
      if (leaked.length) {
        const tag = `玩家${idx + 1} 身份信息泄露：${leaked.map((p) => `${p.name}=${p.role}`).join(',')}`;
        if (errors.indexOf(tag) < 0) { errors.push(tag); console.error('  ✗ ' + tag); }
      }
    }

    if (g.over) {
      finish(g);
      return;
    }

    const p = g.pending;
    if (!p) return;
    if (p.kind === 'turn') {
      const cardAct = (p.actions || []).find((a) => a.type === 'card');
      const need = cardAct ? (cardAct.need || 1) : 1;
      // 无 cardId 表示需要用手牌合成（丈八蛇矛），此时必须补足 extraCards，否则服务端会判为非法操作而空转
      const extra = cardAct && !cardAct.cardId
        ? (g.me.hand || []).slice(0, need).map((c) => c.uid)
        : [];
      const playable = !!cardAct && (!!cardAct.cardId || extra.length >= need);
      if (playable && Math.random() < 0.75) {
        socket.emit('game:action', {
          type: 'card', as: cardAct.as, cardId: cardAct.cardId,
          targets: cardAct.targets && cardAct.targets.length ? [cardAct.targets[0]] : [],
          extraCards: extra,
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

  // 房间聊天
  socket.on('chat', (m) => {
    if (m && typeof m === 'object') s.chat.push(m);
  });

  // 特效 / 音效事件广播
  socket.on('fx', (f) => {
    if (!f || typeof f !== 'object') { errors.push('收到非法的 fx 事件'); return; }
    s.fx.push(f);
    if (f.type) s.fxTypes[f.type] = (s.fxTypes[f.type] || 0) + 1;
    const prev = s.fx[s.fx.length - 2];
    if (prev && !(f.seq > prev.seq)) s.fxBadSeq++;     // seq 必须严格递增
  });

  socket.on('disconnect', () => {
    if (!finished) { errors.push(`玩家${idx + 1} 连接意外断开`); }
  });

  return s;
}

function finish(g) {
  if (finished) return;
  finished = true;
  console.log(`\n对局结束：${g.winnerCn}获胜（共 ${g.round} 轮）`);
  check(!!g.winner, '产生胜负结果');
  check(g.players.every((p) => p.role !== 'unknown'), '结算后公开全部身份');
  check(clients.every((c) => c.pushes > 0), `全部 ${clients.length} 个客户端均收到游戏状态`);

  // 特效事件广播
  check(clients.every((c) => c.fx.length > 0), `全部 ${clients.length} 个客户端均收到 fx 特效事件`);
  check(clients.every((c) => (c.fxTypes.turn || 0) > 0), '每个客户端都收到回合开始（turn）特效');
  check(clients.some((c) => (c.fxTypes.play || 0) > 0), `收到出牌（play）特效 × ${clients.reduce((n, c) => n + (c.fxTypes.play || 0), 0)}`);
  check(clients.every((c) => c.fxBadSeq === 0), 'fx 事件的 seq 严格递增（可排序 / 去重）');

  // 房间聊天：同房间所有人都能收到
  const gotChat = clients.filter((c) => c.chat.some((m) => m.text === CHAT_TEXT));
  check(gotChat.length === clients.length,
    `全部 ${clients.length} 个真人客户端都收到聊天消息「${CHAT_TEXT}」（实际 ${gotChat.length} 个）`);
  const cm = clients.length ? clients[0].chat.find((m) => m.text === CHAT_TEXT) : null;
  check(!!cm && cm.name === '玩家1', `聊天消息带发言者昵称（${cm && cm.name}）`);
  check(!!cm && typeof cm.seat === 'number', '聊天消息带发言者座位号（用于挂在对应角色框上）');
  check(!!cm && typeof cm.ts === 'number' && cm.ts > 0, '聊天消息带时间戳');
  check(chatInRoomState, '房间状态里携带聊天记录（后加入的人也能看到历史消息）');

  // 对局进行中聊天：同样全员可见，且不影响游戏结束
  const gotChat2 = clients.filter((c) => c.chat.some((m) => m.text === CHAT_TEXT2));
  check(gotChat2.length === clients.length,
    `对局进行中发出的「${CHAT_TEXT2}」也被全部 ${clients.length} 个客户端收到（实际 ${gotChat2.length} 个）`);
  const total = clients.reduce((n, c) => n + c.fx.length, 0);
  const kinds = [...new Set(clients.flatMap((c) => Object.keys(c.fxTypes)))].sort();
  console.log(`  特效事件共 ${total} 条，类型：${kinds.join('、')}`);

  report();
}

function report() {
  console.log('\n—— 结果 ——');
  console.log(`配置：${HUMANS} 名真人 + ${AIS} 名人机，共收到 ${pushes} 次状态推送`);
  if (errors.length === 0) console.log('端到端联机测试全部通过。');
  else console.log(`存在 ${errors.length} 处问题：\n - ` + errors.join('\n - '));
  clients.forEach((c) => c.socket.close());
  process.exit(errors.length ? 1 : 0);
}

checkNetAPI(() => {
  for (let i = 0; i < HUMANS; i++) makeClient(i);
});

setTimeout(() => {
  if (!finished) { errors.push('超时未结束'); report(); }
}, TIMEOUT);
