/**
 * 三国杀联机服务端
 * 启动：node server.js   （默认端口 3000，可通过环境变量 PORT 修改）
 * 局域网内其他设备访问 http://<本机IP>:<端口> 即可加入。
 */
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { createRoom, getRoom, rooms, cleanup } = require('./src/rooms');
const { netInfo } = require('./src/net');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
global.io = io;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size }));

/**
 * 网络地址接口：返回本机所有可供局域网设备访问的地址，
 * 供首页展示「其他人如何进入本局」、客户端生成邀请链接。
 * GET /api/net -> { ok, port, host, hostname, ips[], interfaces[], primary, urls[], lanUrl, localUrl, time }
 */
app.get('/api/net', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(netInfo(req, PORT));
});

io.on('connection', (socket) => {
  let joinedRoomId = null;
  let clientId = null;

  const room = () => (joinedRoomId ? getRoom(joinedRoomId) : null);

  socket.on('room:create', ({ clientId: cid, name }, ack) => {
    clientId = cid;
    const r = createRoom();
    joinedRoomId = r.id;
    const p = r.join(cid, socket.id, (name || '玩家').slice(0, 12));
    socket.join(r.id);
    if (typeof ack === 'function') ack({ ok: true, roomId: r.id, seat: p.seat });
    r.broadcastRoom();
  });

  socket.on('room:join', ({ roomId, clientId: cid, name }, ack) => {
    clientId = cid;
    const r = getRoom(roomId);
    if (!r) {
      if (typeof ack === 'function') ack({ ok: false, error: '房间不存在' });
      return;
    }
    const p = r.join(cid, socket.id, (name || '玩家').slice(0, 12));
    if (!p) {
      if (typeof ack === 'function') ack({ ok: false, error: r.status !== 'lobby' ? '游戏已开始或房间已满' : '房间已满' });
      return;
    }
    joinedRoomId = r.id;
    socket.join(r.id);
    if (typeof ack === 'function') ack({ ok: true, roomId: r.id, seat: p.seat, status: r.status });
    r.broadcastRoom();
    if (r.status === 'playing' || r.status === 'picking') r.broadcastGame();
  });

  socket.on('room:leave', () => {
    const r = room();
    if (r && clientId) {
      r.leave(clientId);
      socket.leave(r.id);
      r.broadcastRoom();
    }
    joinedRoomId = null;
  });

  socket.on('room:addAI', () => {
    const r = room();
    if (!r || !clientId || r.hostClientId !== clientId) return;
    r.addAI();
    r.broadcastRoom();
  });

  socket.on('room:removeAI', ({ seat }) => {
    const r = room();
    if (!r || !clientId || r.hostClientId !== clientId) return;
    r.removeAt(seat);
    r.broadcastRoom();
  });

  socket.on('room:setAICount', ({ count }) => {
    const r = room();
    if (!r || !clientId || r.hostClientId !== clientId) return;
    r.setAICount(parseInt(count, 10) || 0);
    r.broadcastRoom();
  });

  socket.on('room:start', () => {
    const r = room();
    if (!r || !clientId || r.hostClientId !== clientId) return;
    if (!r.start() && typeof socket === 'object') socket.emit('toast', { text: `人数需在 2~10 之间` });
  });

  socket.on('room:pickHero', ({ heroId }) => {
    const r = room();
    if (!r || !clientId) return;
    r.pickHero(clientId, heroId);
  });

  socket.on('room:backToLobby', () => {
    const r = room();
    if (!r || !clientId || r.hostClientId !== clientId) return;
    r.backToLobby();
  });

  socket.on('room:chat', ({ text } = {}) => {
    const r = room();
    if (!r || !clientId) return;
    const msg = r.addChat(clientId, text);
    // 不合法/被限流的消息不广播，也不刷新房间状态
    if (msg) r.broadcastChat(msg);
  });

  socket.on('game:action', (payload) => {
    const r = room();
    if (!r || !r.game || !clientId) return;
    const p = r.findByClient(clientId);
    if (!p) return;
    r.game.submitAnswer(p.seat, payload);
    r.broadcastGame();
  });

  socket.on('game:respond', (payload) => {
    const r = room();
    if (!r || !r.game || !clientId) return;
    const p = r.findByClient(clientId);
    if (!p) return;
    r.game.submitAnswer(p.seat, payload);
    r.broadcastGame();
  });

  socket.on('disconnect', () => {
    const r = room();
    if (r && clientId) {
      r.leave(clientId);
      r.broadcastRoom();
    }
  });
});

setInterval(cleanup, 5 * 60 * 1000);

// 端口被占用（例如已经在别处启动过）时给出友好提示，而不是抛出未捕获异常
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log('');
    console.log(`  端口 ${PORT} 已被占用 —— 服务已经在运行了。`);
    console.log('');
    console.log(`  请直接访问：http://localhost:${PORT}`);
    console.log('  如需重新启动，请先关闭之前那个运行窗口，或换一个端口：');
    console.log('    set PORT=3001 && npm start      （cmd）');
    console.log('    $env:PORT=3001; npm start       （PowerShell）');
    console.log('');
    process.exit(0);
  }
  console.error('[启动失败]', err && err.message ? err.message : err);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const info = netInfo(null, PORT);
  console.log('');
  console.log('  ============================================');
  console.log('   三国杀联机服务已启动');
  console.log('  ============================================');
  console.log(`   本机访问：  ${info.localUrl}`);
  for (const it of info.interfaces) {
    console.log(`   局域网访问：http://${it.address}:${PORT}   （${it.iface}，同一 Wi-Fi 的手机/电脑可直接打开）`);
  }
  console.log('');
  console.log('   若其他设备无法连接，请检查 Windows 防火墙是否放行该端口。');
  console.log('');
  console.log('   关闭本窗口即可停止服务。');
  console.log('');
});
