/**
 * 房间管理：开房 / 加人 / 添加人机 / 选将 / 开局
 */
const { Game } = require('./engine');
const { HEROES, HERO_MAP, SKILL_META, pickRandomHeroes } = require('./heroes');
const { ROLE_CONFIG, roleSummary, MIN_PLAYERS, MAX_PLAYERS, ROLE_CN } = require('./roles');
const { shuffle } = require('./util');

const PICK_SECONDS = 30;
const HERO_OPTION_COUNT = 5;  // 每位玩家的候选武将数量
const AI_NAME_POOL = [
  '孟获', '祝融', '张角', '袁绍', '公孙瓒', '刘表', '陶谦', '孔融', '纪灵', '华雄',
  '颜良', '文丑', '高顺', '臧霸', '张绣', '马腾', '韩遂', '刘璋', '张鲁', '严白虎',
  '徐晃', '张郃', '于禁', '乐进', '李典', '曹仁', '曹洪', '典韦', '程昱', '贾诩',
];

const rooms = new Map();

function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  do {
    id = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(id));
  return id;
}

class Room {
  constructor(id) {
    this.id = id;
    this.hostClientId = null;
    this.players = [];        // {seat, clientId, socketId, name, isAI, connected, heroId, heroOptions}
    this.status = 'lobby';    // lobby | picking | playing | over
    this.game = null;
    this.pickTimer = null;
    this.pickDeadline = 0;
    this.createdAt = Date.now();
    this.fxSeq = 0;           // 特效事件自增序号，客户端据此排序 / 去重
  }

  /* ---------- 基础 ---------- */
  get isFull() { return this.players.length >= MAX_PLAYERS; }
  findByClient(clientId) { return this.players.find((p) => p.clientId === clientId); }
  findBySocket(socketId) { return this.players.find((p) => p.socketId === socketId); }

  aiName() {
    const used = new Set(this.players.map((p) => p.name));
    const pool = AI_NAME_POOL.filter((n) => !used.has(n));
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : `电脑${this.players.length + 1}`;
  }

  /* ---------- 人员 ---------- */
  join(clientId, socketId, name) {
    const exist = this.findByClient(clientId);
    if (exist) {
      exist.socketId = socketId;
      exist.connected = true;
      if (name) exist.name = name;
      return exist;
    }
    if (this.status !== 'lobby') return null;
    if (this.isFull) return null;
    const p = { seat: this.players.length, clientId, socketId, name, isAI: false, connected: true, heroId: null, heroOptions: [] };
    this.players.push(p);
    if (!this.hostClientId) this.hostClientId = clientId;
    return p;
  }

  addAI() {
    if (this.status !== 'lobby') return null;
    if (this.isFull) return null;
    const clientId = `ai_${this.id}_${Math.random().toString(36).slice(2, 8)}`;
    const p = {
      seat: this.players.length, clientId, socketId: null,
      name: this.aiName(), isAI: true, connected: true, heroId: null, heroOptions: [],
    };
    this.players.push(p);
    return p;
  }

  removeAt(seat) {
    if (this.status !== 'lobby') return false;
    if (seat < 0 || seat >= this.players.length) return false;
    const p = this.players.splice(seat, 1)[0];
    this.reindex();
    if (p && p.clientId === this.hostClientId) this.hostClientId = this.players[0] ? this.players[0].clientId : null;
    return true;
  }

  reindex() { this.players.forEach((p, i) => { p.seat = i; }); }

  leave(clientId) {
    const p = this.findByClient(clientId);
    if (!p) return;
    if (this.status === 'lobby') {
      this.removeAt(p.seat);
    } else {
      p.connected = false;
      p.socketId = null;
    }
    if (this.hostClientId === clientId) {
      const next = this.players.find((x) => !x.isAI) || this.players[0];
      this.hostClientId = next ? next.clientId : null;
    }
    if (!this.players.length) rooms.delete(this.id);
  }

  setAICount(n) {
    if (this.status !== 'lobby') return;
    const humans = this.players.filter((p) => !p.isAI).length;
    n = Math.max(0, Math.min(MAX_PLAYERS - humans, n));
    const cur = this.players.filter((p) => p.isAI).length;
    if (n > cur) for (let i = cur; i < n; i++) this.addAI();
    else if (n < cur) for (let i = cur; i > n; i--) {
      for (let s = this.players.length - 1; s >= 0; s--) {
        if (this.players[s].isAI) { this.players.splice(s, 1); break; }
      }
    }
    this.reindex();
  }

  /* ---------- 开局 & 选将 ---------- */
  canStart() {
    return this.status === 'lobby' && this.players.length >= MIN_PLAYERS && this.players.length <= MAX_PLAYERS;
  }

  start() {
    if (!this.canStart()) return false;
    this.status = 'picking';
    // 每名玩家随机获得 5 个互不相同的候选武将（不同玩家之间可以重复出现，
    // 但“已被选定”的武将不可再选，保证武将池足够容纳满员 10 人局）
    for (const p of this.players) {
      p.heroOptions = pickRandomHeroes(HERO_OPTION_COUNT).map((h) => h.id);
      p.heroId = null;
    }
    for (const p of this.players) if (p.isAI) this.autoPick(p);
    this.pickDeadline = Date.now() + PICK_SECONDS * 1000;
    this.broadcastRoom();
    clearTimeout(this.pickTimer);
    this.pickTimer = setTimeout(() => this.forceStart(), PICK_SECONDS * 1000 + 500);
    this.tryBeginGame();
    return true;
  }

  /** 已被任何人选定的武将（不可重复选择） */
  takenHeroes() {
    const s = new Set();
    for (const p of this.players) if (p.heroId) s.add(p.heroId);
    return s;
  }

  /** 该玩家当前仍可选的武将 */
  availableOptions(p) {
    const taken = this.takenHeroes();
    const opts = (p.heroOptions || []).filter((id) => !taken.has(id));
    if (opts.length) return opts;
    return HEROES.map((h) => h.id).filter((id) => !taken.has(id));
  }

  autoPick(p) {
    if (p.heroId) return;
    const opts = this.availableOptions(p);
    p.heroId = opts.length
      ? opts[Math.floor(Math.random() * opts.length)]
      : HEROES[Math.floor(Math.random() * HEROES.length)].id;
  }

  pickHero(clientId, heroId) {
    const p = this.findByClient(clientId);
    if (!p || this.status !== 'picking') return false;
    if (!p.heroOptions || !p.heroOptions.includes(heroId)) return false;
    if (this.takenHeroes().has(heroId)) return false; // 已被他人选定
    p.heroId = heroId;
    this.broadcastRoom();
    this.tryBeginGame();
    return true;
  }

  tryBeginGame() {
    if (this.status !== 'picking') return;
    if (!this.players.every((p) => p.heroId)) return;
    clearTimeout(this.pickTimer);
    this.beginGame();
  }

  forceStart() {
    if (this.status !== 'picking') return;
    for (const p of this.players) this.autoPick(p);
    this.tryBeginGame();
  }

  beginGame() {
    const entries = this.players.map((p) => ({
      seat: p.seat, id: p.clientId, name: p.name, isAI: p.isAI, heroId: p.heroId,
    }));
    this.status = 'playing';
    const game = new Game(this);
    game.aiDelay = 900;
    this.game = game;
    game.init(entries);
    this.broadcastRoom();
    setImmediate(() => game.run());
  }

  backToLobby() {
    clearTimeout(this.pickTimer);
    this.status = 'lobby';
    this.game = null;
    this.players.forEach((p) => { p.heroId = null; p.heroOptions = []; p.connected = true; });
    this.broadcastRoom();
  }

  /* ---------- 广播 ---------- */
  socketOf(clientId) {
    const p = this.findByClient(clientId);
    if (!p || !p.socketId) return null;
    return global.io ? global.io.sockets.sockets.get(p.socketId) : null;
  }

  emitTo(clientId, evt, data) {
    const s = this.socketOf(clientId);
    if (s) s.emit(evt, data);
  }

  roomState() {
    return {
      id: this.id,
      status: this.status,
      hostClientId: this.hostClientId,
      pickDeadline: this.pickDeadline,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      roleConfig: ROLE_CONFIG,
      players: this.players.map((p) => ({
        seat: p.seat, name: p.name, isAI: p.isAI, connected: p.connected,
        clientId: p.clientId, heroId: p.heroId,
        hero: p.heroId && HERO_MAP[p.heroId] ? { id: p.heroId, name: HERO_MAP[p.heroId].name, country: HERO_MAP[p.heroId].country, hp: HERO_MAP[p.heroId].hp } : null,
        heroOptions: this.status === 'picking' && !p.isAI
          ? (() => {
            const taken = this.takenHeroes();
            return (p.heroOptions || []).map((id) => HERO_MAP[id]).filter(Boolean).map((h) => ({
              id: h.id, name: h.name, country: h.country, hp: h.hp, taken: taken.has(h.id),
              skills: h.skills.filter((s) => SKILL_META[s].type !== 'lord').map((s) => ({ id: s, cn: SKILL_META[s].cn, desc: SKILL_META[s].desc })),
            }));
          })()
          : [],
        picked: !!p.heroId,
      })),
      roleSummary: roleSummary(this.players.length >= MIN_PLAYERS ? this.players.length : MIN_PLAYERS),
      playerCount: this.players.length,
    };
  }

  broadcastRoom() {
    const state = this.roomState();
    for (const p of this.players) {
      if (p.isAI) continue;
      this.emitTo(p.clientId, 'room', { ...state, you: { clientId: p.clientId, seat: p.seat, isHost: p.clientId === this.hostClientId } });
    }
  }

  broadcastGame() {
    if (!this.game) return;
    for (const p of this.players) {
      if (p.isAI) continue;
      this.emitTo(p.clientId, 'game', this.game.stateFor(p.seat));
    }
  }

  /**
   * 向房间内所有真人客户端广播一个特效 / 音效事件（出牌、伤害、回血、阵亡等）。
   * 与状态推送（game）分离，保证动画与音效的时序，且不影响逻辑结算。
   * 事件统一附带 roomId / seq / ts：seq 严格递增，客户端可据此排序与去重。
   * @param {{type:string}} fx 事件体，由 Game.emitFX 构造
   * @returns {object|null} 实际广播出去的事件（含 seq），未广播时为 null
   */
  emitFX(fx) {
    if (!fx || typeof fx !== 'object' || !fx.type) return null;
    const evt = { ...fx, roomId: this.id, seq: ++this.fxSeq, ts: Date.now() };
    const io = global.io;
    if (io) {
      // 直接向房间频道广播：AI 没有 socket，因此天然只推给真人客户端
      io.to(this.id).emit('fx', evt);
      return evt;
    }
    for (const p of this.players) {
      if (p.isAI) continue;
      this.emitTo(p.clientId, 'fx', evt);
    }
    return evt;
  }
}

function createRoom() {
  const id = genRoomId();
  const room = new Room(id);
  rooms.set(id, room);
  return room;
}

function getRoom(id) { return rooms.get(String(id || '').toUpperCase()); }

function cleanup() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.players.every((p) => p.isAI || !p.connected) && now - room.createdAt > 10 * 60 * 1000) rooms.delete(id);
  }
}

module.exports = { rooms, Room, createRoom, getRoom, cleanup, MAX_PLAYERS, MIN_PLAYERS, ROLE_CN };
