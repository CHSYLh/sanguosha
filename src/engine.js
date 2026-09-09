/**
 * 三国杀核心引擎（服务端权威）
 * 出牌/判定/伤害/濒死/胜负 均在此结算，客户端仅负责展示与提交操作。
 */
const {
  CARD_META, SUIT_CN, buildDeck, isRed, isBlack, cardText, makeCard, cardView, equipView, slotOf,
  isSlashCard, elementOf,
} = require('./cards');
const { SKILL_META, heroById } = require('./heroes');
const { ROLE_CN, rolesFor } = require('./roles');
const { SKILLS } = require('./skills');
const ai = require('./ai');
const { shuffle, sleep, randInt } = require('./util');

const TURN_TIMEOUT = 90;   // 玩家回合操作超时（秒）
const REQ_TIMEOUT = 25;    // 响应类请求超时（秒）
const AI_DELAY = 800;      // AI 思考延迟（毫秒）
const DBG = process.env.SGS_DEBUG === '1';

class EndSignal extends Error {}

class Game {
  constructor(room) {
    this.room = room;
    this.players = [];
    this.over = false;
    this.winner = null;
    this.logs = [];
    this.pending = null;
    this.reqSeq = 0;
    this.round = 1;
    this.phase = 'wait';
    this.currentSeat = -1;
    this.lordSeat = -1;
    this.revealed = [];
    this.turnTimeout = TURN_TIMEOUT;
    this.reqTimeout = REQ_TIMEOUT;
    this.aiDelay = AI_DELAY;
    this.aiJitter = 400;
  }

  /* ==================== 初始化 ==================== */
  init(entries) {
    // entries: [{seat, id, name, isAI, heroId}]
    const roles = shuffle(rolesFor(entries.length));
    this.players = entries.map((e, i) => {
      const hero = heroById(e.heroId);
      const role = roles[i];
      return {
        seat: e.seat,
        id: e.id,
        name: e.name,
        isAI: e.isAI,
        role,
        hero,
        skillIds: hero ? hero.skills.slice() : [],
        maxHp: (hero ? hero.hp : 4) + (role === 'lord' ? 1 : 0),
        hp: (hero ? hero.hp : 4) + (role === 'lord' ? 1 : 0),
        dead: false,
        hand: [],
        equip: { weapon: null, armor: null, horsePlus: null, horseMinus: null },
        judge: [],
        turnFlags: this.freshFlags(),
        aiNotes: {},
      };
    });
    this.lordSeat = this.players.find((p) => p.role === 'lord').seat;
    this.drawPile = shuffle(buildDeck());
    this.discardPile = [];
    this._fxMute = true;                       // 发初始手牌不产生动画事件
    for (const p of this.players) this.drawCards(p, 4);
    this._fxMute = false;
    this.log(`游戏开始！共 ${this.players.length} 人：${this.players.map((p) => `${p.name}（${p.hero.name}）`).join('、')}`);
    this.log(`【${this.players[this.lordSeat].name}】为主公，其体力上限+1。`);
  }

  freshFlags() {
    return { slashUsed: 0, wine: false, usedWine: false, luoyi: false, skipPlay: false, skipDraw: false, skills: {} };
  }

  /* ==================== 日志 / 广播 ==================== */
  log(text) {
    this.logs.push({ t: Date.now(), text });
    if (this.logs.length > 300) this.logs.shift();
  }

  broadcast() {
    if (DBG) this.debugCheckZones();
    if (this.room) this.room.broadcastGame();
  }

  /** 调试：扫描所有区域，报告第一次出现的“同一张牌身处两地” */
  debugCheckZones() {
    if (this.__zoneBroken) return;
    const seen = new Map();
    const add = (card, zone) => {
      if (!card) return false;
      if (seen.has(card.uid)) {
        this.__zoneBroken = true;
        console.error(`[牌张异常] ${card.uid} ${card.name} 同时位于「${seen.get(card.uid)}」与「${zone}」\n${new Error().stack}`);
        return true;
      }
      seen.set(card.uid, zone);
      return false;
    };
    for (const p of this.players) {
      for (const c of p.hand) if (add(c, `${p.name}.手牌`)) return;
      for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) if (add(p.equip[k], `${p.name}.装备`)) return;
      for (const j of p.judge) if (add(j, `${p.name}.判定区`)) return;
    }
    for (const c of this.drawPile) if (add(c, '牌堆')) return;
    for (const c of this.discardPile) if (add(c, '弃牌堆')) return;
  }

  /** 向客户端推送一个动画/音效事件（不影响游戏逻辑，无 room 时静默忽略） */
  emitFX(fx) {
    if (this._fxMute) return null;
    if (this.room && typeof this.room.emitFX === 'function') return this.room.emitFX(fx);
    return null;
  }

  /* ==================== 基础查询 ==================== */
  alive() { return this.players.filter((p) => !p.dead); }

  orderFrom(p) {
    const n = this.players.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const pl = this.players[(p.seat + i) % n];
      if (!pl.dead) out.push(pl);
    }
    return out;
  }

  nextAlive(p) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const pl = this.players[(p.seat + i) % n];
      if (!pl.dead) return pl;
    }
    return p;
  }

  distance(a, b) {
    if (a === b) return 0;
    const seats = this.alive().map((p) => p.seat).sort((x, y) => x - y);
    const ia = seats.indexOf(a.seat);
    const ib = seats.indexOf(b.seat);
    if (ia < 0 || ib < 0) return 99;
    const n = seats.length;
    let d = Math.min(Math.abs(ia - ib), n - Math.abs(ia - ib));
    if (b.equip.horsePlus) d += 1;
    if (a.equip.horseMinus) d -= 1;
    // 技能距离修正（马术 -1、义从 依体力值浮动）
    for (const sid of a.skillIds) {
      const sk = SKILLS[sid];
      if (sk && sk.modifyDistance) d += sk.modifyDistance(this, a) || 0;
    }
    return Math.max(1, d);
  }

  attackRange(p) {
    const w = p.equip.weapon;
    return w ? CARD_META[w.name].range : 1;
  }

  canReach(a, b) { return this.attackRange(a) >= this.distance(a, b); }

  slashLimit(p) {
    if (p.skillIds.includes('paoxiao')) return Infinity;
    if (p.equip.weapon && p.equip.weapon.name === 'crossbow') return Infinity;
    // 【天义】【巧说】拼点获胜：本回合【杀】无次数限制
    if (p.turnFlags.tianyi) return Infinity;
    return 1;
  }

  hasSkill(p, id) { return !!p && p.skillIds.includes(id); }

  /** canBeTarget 的可选第 4 参数 card：部分技能（如【帷幕】）需要依据实际牌的花色判断 */
  canBeTarget(t, cardName, source, card = null) {
    if (!t || t.dead || t === source) return false;
    if (this.hasSkill(t, 'qianxun') && (cardName === 'snatch' || cardName === 'lebu')) return false;
    if (this.hasSkill(t, 'kongcheng') && t.hand.length === 0 && (cardName === 'slash' || cardName === 'duel')) return false;
    // 【帷幕】：不能成为黑色锦囊牌的目标
    if (this.hasSkill(t, 'weimu') && CARD_META[cardName] && CARD_META[cardName].type === 'scroll'
      && card && card.color === 'black') return false;
    if (cardName === 'borrow' && !t.equip.weapon) return false;
    // 判定区里可能是被【断粮】【国色】当作延时锦囊使用的其它牌，按“当作”的牌名判断
    if (cardName === 'lebu' && t.judge.some((j) => (j.__as || j.name) === 'lebu')) return false;
    if (cardName === 'bingliang' && t.judge.some((j) => (j.__as || j.name) === 'bingliang')) return false;
    // 【火攻】需要目标有手牌可展示
    if (cardName === 'huogong' && t.hand.length === 0) return false;
    return true;
  }

  /* ==================== 摸牌 / 弃牌 ==================== */
  reshuffle() {
    if (!this.discardPile.length) return;
    this.drawPile = shuffle(this.discardPile);
    for (const c of this.drawPile) c.__inDiscard = false;
    this.discardPile = [];
    this.log('牌堆耗尽，弃牌堆重新洗牌。');
  }

  /** 唯一的入弃牌堆入口：保证同一张牌不会重复进入弃牌堆、也不会同时留在牌堆中 */
  discardCard(card) {
    if (!card || card.__inDiscard) return;
    // 防御：若该牌仍残留在牌堆中，先摘出来，避免出现“同一张牌身处两地”
    const inDeck = this.drawPile.indexOf(card);
    if (inDeck >= 0) {
      if (DBG) console.error(`[牌张修正] ${card.uid} ${card.name} 弃置时仍在牌堆中，已移除\n${new Error().stack}`);
      this.drawPile.splice(inDeck, 1);
    }
    card.__inDiscard = true;
    card.__as = null;   // 进入弃牌堆后恢复为原本的牌（不再“当作”其它牌）
    this.discardPile.push(card);
  }

  /** 从弃牌堆取回一张牌（【落英】等），取回后该牌不再处于弃牌堆中 */
  takeFromDiscard(card) {
    if (!card) return null;
    const i = this.discardPile.indexOf(card);
    if (i < 0) return null;
    this.discardPile.splice(i, 1);
    card.__inDiscard = false;
    return card;
  }

  drawCards(p, n) {
    const got = [];
    for (let i = 0; i < n; i++) {
      if (!this.drawPile.length) this.reshuffle();
      if (!this.drawPile.length) break;
      const c = this.drawPile.pop();
      c.__inDiscard = false;
      p.hand.push(c);
      got.push(c);
    }
    // 只广播张数：手牌内容属私有信息，张数已在状态中公开
    if (got.length) this.emitFX({ type: 'draw', seat: p.seat, count: got.length });
    return got;
  }

  peekTop(n) {
    return this.drawPile.slice(Math.max(0, this.drawPile.length - n)).reverse();
  }

  applyGuanxing(topUids, bottomUids) {
    const ts = new Set(topUids);
    const bs = new Set(bottomUids);
    const picked = this.drawPile.filter((c) => ts.has(c.uid) || bs.has(c.uid));
    this.drawPile = this.drawPile.filter((c) => !ts.has(c.uid) && !bs.has(c.uid));
    const tops = topUids.map((u) => picked.find((c) => c.uid === u)).filter(Boolean);
    const bots = bottomUids.map((u) => picked.find((c) => c.uid === u)).filter(Boolean);
    for (let i = tops.length - 1; i >= 0; i--) this.drawPile.push(tops[i]);
    for (let i = bots.length - 1; i >= 0; i--) this.drawPile.unshift(bots[i]);
  }

  removeFromHand(p, cards) {
    const ids = new Set(cards.filter(Boolean).map((c) => c.uid));
    const removed = p.hand.filter((c) => ids.has(c.uid));
    p.hand = p.hand.filter((c) => !ids.has(c.uid));
    return removed;
  }

  /**
   * 手牌离开手牌区的唯一推荐入口：移除 + 触发「失去手牌」类技能（陆逊【连营】等）。
   * 之前各条出牌路线各自触发，装备牌 / 锦囊牌 / 救人用【桃】等分支被遗漏，
   * 导致陆逊用掉最后一张非基本牌时【连营】不触发。统一在此触发可避免再漏。
   */
  async takeFromHand(p, cards, opts = {}) {
    const removed = this.removeFromHand(p, cards);
    if (removed.length && !this.over) await this.trigger('cardLose', p, { cards: removed, ...opts });
    return removed;
  }

  async discardFromHand(p, cards) {
    const removed = this.removeFromHand(p, cards);
    for (const c of removed) this.discardCard(c);
    if (removed.length) {
      this.emitFX({ type: 'discard', seat: p.seat, count: removed.length, from: 'hand' });
      await this.trigger('cardLose', p, { cards: removed });
      await this.triggerAll('onDiscard', { cards: removed, fromSeat: p.seat });
    }
    return removed;
  }

  /**
   * 该牌是否仍处于「结算中」：既不在弃牌堆里，也不被任何角色持有。
   * 用于「获得这张牌」类技能（【巨象】【奸雄】）：若这张牌在结算过程中
   * 已被弃置（例如持有者阵亡），就不能再获得，否则同一张牌会同时身处两地。
   */
  inLimbo(card) {
    if (!card) return false;
    return !card.__inDiscard && !this.inPossession(card);
  }

  /** 该牌是否仍被某位角色持有（手牌/装备/判定区）或在牌堆中 */
  inPossession(card) {
    if (!card) return false;
    for (const p of this.players) {
      if (p.hand.indexOf(card) >= 0) return true;
      for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) if (p.equip[k] === card) return true;
      if (p.judge.indexOf(card) >= 0) return true;
    }
    return this.drawPile.indexOf(card) >= 0;
  }

  /**
   * 卸下装备。
   * opts.discard=false 时只卸下不入弃牌堆（供「获得该牌」类效果使用）
   * opts.silent=true  时不广播动画（调用方已经用其它事件展示了这张牌，避免重复）
   */
  async loseEquip(p, slot, opts = {}) {
    const c = p.equip[slot];
    if (!c) return null;
    p.equip[slot] = null;
    if (opts.discard !== false) this.discardCard(c);
    if (!opts.silent) this.emitFX({ type: 'unequip', seat: p.seat, slot, card: cardView(c) });
    await this.trigger('cardLose', p, { cards: [c], fromEquip: true });
    // 【白银狮子】：失去装备区里的它时回复1点体力
    if (c.name === 'baiyin' && !p.dead) {
      this.heal(p, 1);
      this.log(`${p.name} 因失去【白银狮子】回复1点体力`);
    }
    return c;
  }

  /** 装备一张牌。opts.silent=true 时不广播动画（出牌事件已展示过这张牌） */
  async equip(p, card, opts = {}) {
    const slot = slotOf(card.name);
    const old = p.equip[slot];
    p.equip[slot] = card;
    this.log(`${p.name} 装备【${CARD_META[card.name].cn}】`);
    if (!opts.silent) this.emitFX({ type: 'equip', seat: p.seat, slot, card: cardView(card), replaced: cardView(old) });
    if (old) {
      this.discardCard(old);
      await this.trigger('cardLose', p, { cards: [old], fromEquip: true });
    }
  }

  heal(p, n = 1) {
    if (!p || p.dead || p.hp >= p.maxHp) return 0;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + n);
    this.log(`${p.name} 回复 ${p.hp - before} 点体力（当前 ${p.hp}/${p.maxHp}）`);
    if (p.hp > before) this.emitFX({ type: 'heal', seat: p.seat, amount: p.hp - before });
    return p.hp - before;
  }

  async loseHp(p, n = 1) {
    p.hp -= n;
    this.log(`${p.name} 失去 ${n} 点体力（当前 ${Math.max(0, p.hp)}/${p.maxHp}）`);
    this.broadcast();
    await this.trigger('damaged', p, { source: null, amount: n, card: null, reason: 'loseHp' });
    if (p.hp <= 0) await this.resolveDying(p, null);
  }

  /* ==================== 技能触发 ==================== */
  async trigger(hook, p, ctx = {}) {
    if (this.over || !p || !p.hero) return;
    for (const sid of p.skillIds) {
      if (SKILL_META[sid] && SKILL_META[sid].type === 'lord' && p.role !== 'lord') continue;
      const sk = SKILLS[sid];
      if (!sk || !sk[hook]) continue;
      await sk[hook](this, p, ctx);
      if (this.over) return;
    }
  }

  /**
   * 与 trigger 类似，但返回第一个「真值」结果，用于「伤害转移」这类
   * 由技能完全接管后续结算的钩子（返回真值表示已处理，调用方应中止原流程）。
   */
  async triggerValue(hook, p, ctx = {}) {
    if (this.over || !p || !p.hero) return null;
    for (const sid of p.skillIds) {
      if (SKILL_META[sid] && SKILL_META[sid].type === 'lord' && p.role !== 'lord') continue;
      const sk = SKILLS[sid];
      if (!sk || !sk[hook]) continue;
      const r = await sk[hook](this, p, ctx);
      if (r) return r;
      if (this.over) return null;
    }
    return null;
  }

  /** 向全场所有角色广播式触发（用于「别人的牌进弃牌堆」这类技能，如【落英】） */
  async triggerAll(hook, ctx = {}) {
    for (const p of this.players) {
      if (this.over) return;
      if (p.dead || !p.hero) continue;
      for (const sid of p.skillIds) {
        const sk = SKILLS[sid];
        if (!sk || !sk[hook]) continue;
        await sk[hook](this, p, ctx);
        if (this.over) return;
      }
    }
  }

  /** 卡牌可被当作哪些牌使用 */
  convertNames(p, card, ctx) {
    if (!p || !p.hero) return [];
    const names = [];
    if (ctx === 'play') {
      const meta = CARD_META[card.name];
      if (meta && meta.mode !== '-') names.push(card.name);
      // 火杀 / 雷杀也可以当作普通【杀】使用
      if (isSlashCard(card.name) && card.name !== 'slash' && !names.includes('slash')) names.push('slash');
    } else if (ctx === 'slash') {
      // 需要【杀】时，杀 / 火杀 / 雷杀均可打出
      if (isSlashCard(card.name)) names.push('slash');
      else if (card.name === ctx) names.push(ctx);
    } else {
      if (card.name === ctx) names.push(ctx);
    }
    for (const sid of p.skillIds) {
      const sk = SKILLS[sid];
      if (!sk || !sk.convert) continue;
      if (SKILL_META[sid] && SKILL_META[sid].type === 'lord' && p.role !== 'lord') continue;
      const extra = sk.convert(this, p, card, ctx);
      if (extra) for (const n of extra) if (!names.includes(n)) names.push(n);
    }
    return names;
  }

  /** 某玩家在当前情境下可用于响应（打出）的牌 */
  cardOptions(p, kind, ctx = {}) {
    const out = [];
    if (kind === 'jink' && !ctx.noArmor && !ctx.noBagua) {
      if (p.equip.armor && p.equip.armor.name === 'bagua') {
        out.push({ id: 'bagua', as: 'jink', label: '发动【八卦阵】判定', skill: 'bagua' });
      } else if (!p.equip.armor && this.hasSkill(p, 'bazhen')) {
        // 【八阵】：未装备防具时视为装备着【八卦阵】
        out.push({ id: 'bagua', as: 'jink', label: '发动【八阵】判定', skill: 'bazhen' });
      }
    }
    for (const c of p.hand) {
      const names = this.convertNames(p, c, kind);
      if (names.includes(kind)) {
        out.push({ id: c.uid, as: kind, label: cardText(c), card: cardView(c) });
      } else if (kind === 'peach' && c.name === 'wine' && ctx.dying && ctx.target === p) {
        // 濒死时可以用【酒】自救（酒只能救自己，不能救别人）
        out.push({ id: c.uid, as: 'peach', label: `${cardText(c)}（酒·自救）`, card: cardView(c) });
      }
    }
    return out;
  }

  /* ==================== 请求 / 应答 ==================== */
  async request(seat, req) {
    const p = this.players[seat];
    if (this.over || !p || p.dead) return null;
    const id = ++this.reqSeq;
    let resolveFn = null;
    let timer = null;
    const promise = new Promise((res) => { resolveFn = res; });
    this.pending = {
      id, seat, req,
      resolve: (ans) => {
        if (!this.pending || this.pending.id !== id) return;
        this.pending = null;
        if (timer) clearTimeout(timer);
        resolveFn(ans === undefined ? null : ans);
      },
    };
    const timeout = req.kind === 'turn' ? this.turnTimeout : this.reqTimeout;
    this.pending.timeout = timeout;
    this.pending.timeoutAt = Date.now() + timeout * 1000;
    timer = setTimeout(() => {
      if (this.pending && this.pending.id === id) this.pending.resolve(null);
    }, timeout * 1000);
    this.broadcast();

    if (p.isAI) {
      setTimeout(() => {
        if (!this.pending || this.pending.id !== id) return;
        let ans = null;
        try {
          ans = ai.decide(this, p, req);
        } catch (e) {
          console.error('[AI错误]', e);
          ans = null;
        }
        if (this.pending && this.pending.id === id) this.pending.resolve(ans);
      }, this.aiDelay + randInt(this.aiJitter));
    }

    const ans = await promise;
    this.broadcast();
    return ans;
  }

  submitAnswer(seat, ans) {
    if (!this.pending || this.pending.seat !== seat) return false;
    this.pending.resolve(ans);
    return true;
  }

  /**
   * 待操作提示的公开文案：会广播给房间内所有人。
   * 只包含公开信息——不透露可选手牌，也不透露“正在询问谁”（响应类请求）。
   */
  publicPendingTitle(req) {
    const r = req || {};
    const ctx = r.ctx || {};
    const name = (s) => (this.players[s] ? this.players[s].name : '');
    const cnOf = (n) => (CARD_META[n] ? CARD_META[n].cn : '锦囊');

    if (r.kind === 'turn') return '出牌阶段';
    if (r.kind === 'guanxing') return '观星';
    // 响应类请求：只说“在问什么”，不说“在问谁”
    if (r.kind === 'respond') {
      if (r.as === 'wuxie') return `询问是否有人使用【无懈可击】抵消【${cnOf(ctx.cardName)}】`;
      if (r.as === 'peach') return `询问是否有人使用【桃】救援 ${name(ctx.target)}`;
      return `询问是否有人打出【${cnOf(r.as)}】`;
    }
    if (r.kind === 'choose') {
      if (r.style === 'players') return r.prompt || '选择一名角色';
      if (r.style === 'suits') return '猜测花色';
      return r.prompt || '做出选择';
    }
    return '等待操作';
  }

  async choose(seat, { prompt, choices, min = 1, max = 1, optional = false, style = 'options', purpose = '', extra = {} }) {
    if (!choices || !choices.length) return null;
    const ans = await this.request(seat, { kind: 'choose', style, prompt, choices, min, max, optional, purpose, ...extra });
    if (!ans || !ans.ids || !ans.ids.length) return optional ? [] : null;
    // 只接受本次候选项之内的答案，避免异常/过期应答污染后续结算
    const valid = new Set(choices.map((c) => String(c.id)));
    const picked = ans.ids.map((id) => String(id)).filter((id) => valid.has(id));
    if (!picked.length) return optional ? [] : null;
    return picked;
  }

  async choosePlayer(seat, { prompt, candidates, optional = false, purpose = '' }) {
    const choices = candidates.map((s) => ({ id: String(s), label: this.players[s].name, seat: s }));
    const ids = await this.choose(seat, { prompt, choices, min: 1, max: 1, optional, style: 'players', purpose });
    if (!ids || !ids.length) return null;
    const s = Number(ids[0]);
    // 必须是合法的存活座位号，否则视为放弃（防止异常答案被当成座位使用）
    if (!Number.isInteger(s) || !this.players[s] || this.players[s].dead) return null;
    return s;
  }

  async askYesNo(seat, prompt, { yesLabel = '发动', noLabel = '不发动', purpose = '' } = {}) {
    const ids = await this.choose(seat, {
      prompt, optional: true, style: 'options', min: 1, max: 1, purpose,
      choices: [{ id: 'yes', label: yesLabel }, { id: 'no', label: noLabel }],
    });
    return !!ids && ids[0] === 'yes';
  }

  async respond(seat, kind, ctx = {}) {
    const p = this.players[seat];
    const choices = ctx.choices || (p ? this.cardOptions(p, kind, ctx) : []);
    if (!choices.length) return null;
    const ans = await this.request(seat, {
      kind: 'respond', as: kind, style: 'cards',
      prompt: ctx.prompt || `是否打出【${CARD_META[kind].cn}】？`,
      choices, min: 1, max: 1, optional: true,
      ctx: { purpose: ctx.purpose, target: ctx.target, reason: ctx.reason, initiator: ctx.initiator, cardName: ctx.cardName, bySeat: ctx.bySeat, forSeat: ctx.forSeat, skill: ctx.skill },
    });
    if (!ans || !ans.ids || !ans.ids.length) return null;
    return ans.ids[0];
  }

  /* ==================== 出牌 / 响应 ==================== */
  async askCard(seat, kind, ctx = {}) {
    const p = this.players[seat];
    if (!p || p.dead) return null;
    let noBagua = false;
    for (let guard = 0; guard < 4; guard++) {
      if (this.over || p.dead) return null;
      const choices = this.cardOptions(p, kind, { ...ctx, noBagua });
      if (!choices.length) break;
      const id = await this.respond(seat, kind, { ...ctx, choices });
      if (!id) break;
      if (id === 'bagua') {
        noBagua = true;
        const jc = await this.judgeCard(p, '八卦阵');
        this.log(`【八卦阵】判定${isRed(jc) ? '成功，视为打出一张【闪】' : '失败'}`);
        if (isRed(jc)) return { bagua: true };
        continue;
      }
      const card = p.hand.find((c) => c.uid === id);
      if (!card) break;
      this.removeFromHand(p, [card]);
      this.discardCard(card);
      const native = card.name === kind;
      this.log(native
        ? `${p.name} 打出【${CARD_META[kind].cn}】${cardText(card)}`
        : `${p.name} 将 ${cardText(card)} 当作【${CARD_META[kind].cn}】打出`);
      this.emitFX({ type: 'respond', seat: p.seat, as: kind, card: cardView(card), convert: !native });
      await this.trigger('cardLose', p, { cards: [card] });
      await this.trigger('responded', p, { kind, card });
      return { card };
    }
    return await this.lordAssist(p, kind, ctx);
  }

  /** 主公技：激将 / 护驾 */
  async lordAssist(p, kind, ctx = {}) {
    if (!p || p.dead || p.role !== 'lord') return null;
    const cfg = kind === 'slash' ? { skill: 'jijiang', country: 'shu' } : kind === 'jink' ? { skill: 'hujia', country: 'wei' } : null;
    if (!cfg || !p.skillIds.includes(cfg.skill)) return null;
    for (const helper of this.orderFrom(p)) {
      if (helper === p || helper.dead || helper.hero.country !== cfg.country) continue;
      const choices = this.cardOptions(helper, kind, { ...ctx, noBagua: true });
      if (!choices.length) continue;
      const id = await this.respond(helper.seat, kind, {
        ...ctx, choices, forSeat: p.seat, skill: cfg.skill,
        prompt: `【${SKILL_META[cfg.skill].cn}】是否为 ${p.name} 打出一张【${CARD_META[kind].cn}】？`,
      });
      if (!id || id === 'bagua') continue;
      const card = helper.hand.find((c) => c.uid === id);
      if (!card) continue;
      this.removeFromHand(helper, [card]);
      this.discardCard(card);
      this.log(`${helper.name} 响应【${SKILL_META[cfg.skill].cn}】，替 ${p.name} 打出【${CARD_META[kind].cn}】`);
      this.emitFX({ type: 'respond', seat: helper.seat, as: kind, card: cardView(card), forSeat: p.seat, skill: cfg.skill });
      await this.trigger('cardLose', helper, { cards: [card] });
      return { card };
    }
    return null;
  }

  /** 该【杀】的属性：装备【朱雀羽扇】可把普通杀当火杀使用 */
  slashElement(p, slashCard) {
    if (!slashCard) return null;
    if (slashCard.name === 'slash' && p && p.equip.weapon && p.equip.weapon.name === 'zhuque') return 'fire';
    return elementOf(slashCard.name);
  }

  async askJink(target, source, slashCard, opts = {}) {
    // 青釭剑 与【陷阵】都可无视目标防具
    const qinggang = (source && source.equip.weapon && source.equip.weapon.name === 'qinggang')
      || (source && source.turnFlags && source.turnFlags.xianzhenSeat === target.seat);
    if (!qinggang && target.equip.armor && target.equip.armor.name === 'renwang' && slashCard && isBlack(slashCard)) {
      this.log(`【仁王盾】生效，黑色【杀】对 ${target.name} 无效`);
      return true;
    }
    // 【藤甲】：普通杀无效；火杀 / 雷杀不受影响（青釭剑可无视防具）
    if (!qinggang && target.equip.armor && target.equip.armor.name === 'tengjia'
      && slashCard && this.slashElement(source, slashCard) === null) {
      this.log(`【藤甲】生效，${target.name} 免疫普通【杀】`);
      this.emitFX({ type: 'armorEffect', seat: target.seat, armor: 'tengjia', blocked: true });
      return true;
    }
    // 【毅重】：未装备防具时，黑色【杀】对你无效（青釭剑可无视）
    if (!qinggang && !target.equip.armor && this.hasSkill(target, 'yizhong') && slashCard && isBlack(slashCard)) {
      this.log(`【毅重】生效，黑色【杀】对 ${target.name} 无效`);
      this.emitFX({ type: 'armorEffect', seat: target.seat, armor: 'yizhong', blocked: true });
      return true;
    }
    const need = opts.needTwo ? 2 : 1;
    for (let i = 0; i < need; i++) {
      const res = await this.askCard(target.seat, 'jink', { noArmor: qinggang, source: source ? source.seat : -1 });
      if (!res) return false;
    }
    return true;
  }

  /* ==================== 无懈可击 ==================== */
  async askWuxie(cardName, sourceSeat, targetSeat, card) {
    const start = this.players[sourceSeat] || this.players[targetSeat];
    if (!start) return false;
    // 开场提示：向全场广播“正在询问是否有人使用无懈可击”
    this.emitFX({
      type: 'askWuxie', cardName, bySeat: sourceSeat, targetSeat,
      card: card ? cardView(card) : null,
    });
    for (const p of this.orderFrom(start)) {
      if (this.over || p.dead) continue;
      // 锦囊的使用者不需要对自己的牌使用【无懈可击】
      if (p.seat === sourceSeat) continue;
      const choices = this.cardOptions(p, 'wuxie', {});
      if (!choices.length) continue;
      const id = await this.respond(p.seat, 'wuxie', {
        choices, target: targetSeat, cardName, bySeat: sourceSeat, purpose: 'wuxie',
        prompt: `是否使用【无懈可击】抵消【${CARD_META[cardName].cn}】？`,
      });
      if (!id) continue;
      const card = p.hand.find((c) => c.uid === id);
      if (!card) continue;
      this.removeFromHand(p, [card]);
      this.discardCard(card);
      this.log(`${p.name} 使用【无懈可击】`);
      this.emitFX({ type: 'play', seat: p.seat, as: 'wuxie', card: cardView(card), targets: [targetSeat] });
      await this.trigger('usedScroll', p, { card });
      await this.trigger('cardLose', p, { cards: [card] });
      return true;
    }
    return false;
  }

  /* ==================== 判定 ==================== */
  async judgeCard(p, reason) {
    if (!this.drawPile.length) this.reshuffle();
    if (!this.drawPile.length) return makeCard('slash', 'spade', 5);
    const card = this.drawPile.pop();
    this.log(`${p.name} 进行【${reason}】判定，判定牌：${cardText(card)}`);
    this.emitFX({ type: 'judge', seat: p.seat, card: cardView(card), reason });
    this.broadcast();
    let finalCard = card;
    const replacement = await this.askJudgeModify(p, card, reason);
    if (replacement) {
      this.discardCard(card);
      finalCard = replacement;
      this.log(`判定牌被替换为 ${cardText(finalCard)}`);
    }
    this.judgeCardTaken = false;
    await this.trigger('judgeDone', p, { card: finalCard, reason });
    if (!this.judgeCardTaken) this.discardCard(finalCard);

    // 判定结果：明确告知“什么牌在谁身上判定、是否生效”，供客户端播放醒目动画
    const res = this.judgeEffect(finalCard, reason);
    this.emitFX({
      type: 'judgeResult', seat: p.seat, name: p.name, card: cardView(finalCard), reason,
      effect: res.effect, text: res.text,
    });
    return finalCard;
  }

  /** 判定结果：effect=true 生效，false 失效，null 表示不适用 */
  judgeEffect(card, reason) {
    const fire = (effect, text) => ({ effect, text });
    switch (reason) {
      case '乐不思蜀':
        return card.suit === 'heart'
          ? fire(false, '判定为红桃，【乐不思蜀】失效')
          : fire(true, '判定不为红桃，【乐不思蜀】生效，跳过出牌阶段');
      case '兵粮寸断':
        return card.suit === 'club'
          ? fire(false, '判定为梅花，【兵粮寸断】失效')
          : fire(true, '判定不为梅花，【兵粮寸断】生效，跳过摸牌阶段');
      case '闪电': {
        const hit = card.suit === 'spade' && card.num >= 2 && card.num <= 9;
        return hit
          ? fire(true, '判定为黑桃2~9，【闪电】生效，受到3点雷电伤害')
          : fire(false, '判定不为黑桃2~9，【闪电】未生效，传给下家');
      }
      case '八卦阵':
        return card.color === 'red'
          ? fire(true, '判定为红色，【八卦阵】生效，视为打出一张【闪】')
          : fire(false, '判定为黑色，【八卦阵】失效');
      case '铁骑':
        return card.color === 'red'
          ? fire(true, '判定为红色，【铁骑】生效，此【杀】不可被闪避')
          : fire(false, '判定为黑色，【铁骑】失效');
      case '刚烈':
        return card.suit === 'heart'
          ? fire(false, '判定为红桃，【刚烈】失效')
          : fire(true, '判定不为红桃，【刚烈】生效');
      case '洛神':
        return card.color === 'black'
          ? fire(true, '判定为黑色，【洛神】生效，获得此牌')
          : fire(false, '判定为红色，【洛神】停止');
      default:
        return fire(null, '');
    }
  }

  /** 判定牌生效前，允许发动的改判技能：【鬼才】任意手牌，【鬼道】仅限黑色手牌 */
  async askJudgeModify(p, card, reason) {
    for (const sp of this.orderFrom(p)) {
      if (this.over || sp.dead) continue;
      const sid = ['guicai', 'guidao'].find((s) => sp.skillIds.includes(s));
      if (!sid) continue;
      // 【鬼道】：只能用黑色手牌替换
      const pool = sid === 'guidao' ? sp.hand.filter((c) => isBlack(c)) : sp.hand;
      const choices = pool.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) }));
      if (!choices.length) continue;
      const ids = await this.choose(sp.seat, {
        prompt: `【${SKILL_META[sid].cn}】是否打出一张手牌替换 ${p.name} 的【${reason}】判定牌（${cardText(card)}）？`,
        choices, min: 1, max: 1, optional: true, style: 'cards', purpose: sid,
        extra: { judgeFor: p.seat, judgeReason: reason, currentCard: cardView(card) },
      });
      if (!ids || !ids.length) continue;
      const c = pool.find((x) => x.uid === ids[0]);
      if (!c) continue;
      await this.takeFromHand(sp, [c]);
      this.log(`${sp.name} 发动【${SKILL_META[sid].cn}】，打出 ${cardText(c)} 替换判定牌`);
      return c;
    }
    return null;
  }

  /* ==================== 拼点 ==================== */
  /**
   * 拼点：a 与 b 各暗置一张手牌后同时亮出，比较点数（A=1 … K=13）。
   * 返回 1 表示 a 胜、-1 表示 b 胜、0 表示平（按规则视为发起方 a 未获胜）。
   */
  async pinDian(a, b) {
    if (!a || !b || a.dead || b.dead) return 0;
    if (!a.hand.length || !b.hand.length) return 0;
    const promptA = `【拼点】与 ${b.name} 拼点，选择一张手牌`;
    const promptB = `【拼点】与 ${a.name} 拼点，选择一张手牌`;
    const mk = (p) => p.hand.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) }));
    // 注意：引擎同一时刻只能挂起一个请求（this.pending 为单槽），必须先后询问
    const ia = await this.choose(a.seat, { prompt: promptA, choices: mk(a), min: 1, max: 1, style: 'cards', purpose: 'pindian' });
    const ca = ia && ia.length ? a.hand.find((c) => c.uid === ia[0]) : a.hand[0];
    if (!ca) return 0;
    const ib = await this.choose(b.seat, { prompt: promptB, choices: mk(b), min: 1, max: 1, style: 'cards', purpose: 'pindian' });
    const cb = ib && ib.length ? b.hand.find((c) => c.uid === ib[0]) : null;
    if (!cb) return 0;
    this.log(`【拼点】${a.name} ${cardText(ca)} vs ${b.name} ${cardText(cb)}`);
    this.emitFX({ type: 'showCard', seat: a.seat, card: cardView(ca), reason: '拼点' });
    this.emitFX({ type: 'showCard', seat: b.seat, card: cardView(cb), reason: '拼点' });
    await this.discardFromHand(a, [ca]);
    await this.discardFromHand(b, [cb]);
    // 点数：A=1、J=11、Q=12、K=13
    if (ca.num > cb.num) return 1;
    if (ca.num < cb.num) return -1;
    return 0;
  }

  /* ==================== 伤害 / 濒死 / 死亡 ==================== */
  async applyDamage({ source = null, target, amount = 1, card = null, reason = '', element = null }) {
    if (this.over || !target || target.dead) return 0;
    const src = source && !source.dead ? source : null;
    // 【天香】等“转移伤害”类技能：返回真值表示已由技能接管本次结算
    if (await this.triggerValue('beforeDamage', target, { source: src, amount, card, reason, element })) return 0;
    if (this.over || target.dead) return 0;
    // 【白银狮子】：每次受到大于1点的伤害时，防止多余的伤害
    if (target.equip.armor && target.equip.armor.name === 'baiyin' && amount > 1) {
      this.log(`【白银狮子】防止了 ${amount - 1} 点伤害`);
      this.emitFX({ type: 'armorEffect', seat: target.seat, armor: 'baiyin', blocked: true });
      amount = 1;
    }
    // 【藤甲】：受到火焰伤害时 +1
    if (element === 'fire' && target.equip.armor && target.equip.armor.name === 'tengjia') {
      amount += 1;
      this.log(`【藤甲】使火焰伤害 +1（变为 ${amount} 点）`);
      this.emitFX({ type: 'armorEffect', seat: target.seat, armor: 'tengjia', blocked: false, bonus: 1 });
    }
    target.hp -= amount;
    this.log(`${src ? src.name : '【' + reason + '】'} 对 ${target.name} 造成 ${amount} 点伤害`);
    this.emitFX({ type: 'damage', seat: target.seat, amount, source: src ? src.seat : -1, reason });
    // 记录行为（供 AI 与玩家判断敌我）
    if (src) {
      for (const q of this.players) {
        if (!q.aiNotes[src.seat]) q.aiNotes[src.seat] = {};
        q.aiNotes[src.seat][`dmg_${target.seat}`] = (q.aiNotes[src.seat][`dmg_${target.seat}`] || 0) + amount;
      }
    }
    this.broadcast();
    await this.trigger('damaged', target, { source: src, amount, card, reason });
    if (this.over) return amount;
    // 【狂骨】【烈刃】等“造成伤害后”触发的技能
    if (src && !src.dead) await this.trigger('dealtDamage', src, { target, amount, card, reason });
    if (this.over) return amount;
    if (target.hp <= 0) await this.resolveDying(target, src);
    return amount;
  }

  /** 当前回合角色拥有【完杀】时返回其座位，否则返回 -1 */
  wanshaSeat() {
    const cur = this.players[this.currentSeat];
    return cur && !cur.dead && this.hasSkill(cur, 'wansha') ? cur.seat : -1;
  }

  async resolveDying(target, source) {
    this.log(`${target.name} 进入濒死状态，开始求桃`);
    this.emitFX({ type: 'dying', seat: target.seat, hp: target.hp, name: target.name });
    let guard = 0;
    while (target.hp <= 0 && !target.dead && !this.over && guard++ < 20) {
      let saved = false;
      for (const p of this.orderFrom(target)) {
        if (this.over || target.dead) break;
        if (p.dead) continue;
        // 【完杀】：贾诩的回合内，除其与濒死角色本人外，其他角色不能使用【桃】
        if (this.wanshaSeat() >= 0 && p.seat !== this.wanshaSeat() && p !== target) continue;
        const choices = this.cardOptions(p, 'peach', { dying: true, target });
        if (!choices.length) continue;
        const id = await this.respond(p.seat, 'peach', {
          choices, target: target.seat, purpose: 'peach',
          prompt: `${target.name} 濒死，是否使用【桃】相救？`,
        });
        if (!id) continue;
        const card = p.hand.find((c) => c.uid === id);
        if (!card) continue;
        await this.takeFromHand(p, [card]);
        this.discardCard(card);
        let heal = 1;
        if (target.role === 'lord' && target.skillIds.includes('jiuyuan') && p !== target && p.hero.country === 'wu') heal = 2;
        target.hp = Math.min(target.maxHp, Math.max(1, target.hp + heal));
        this.log(`${p.name} 对 ${target.name} 使用【桃】${heal > 1 ? '（【救援】额外+1）' : ''}，${target.name} 体力回复至 ${target.hp}`);
        this.emitFX({ type: 'play', seat: p.seat, as: 'peach', card: cardView(card), targets: [target.seat], heal });
        saved = true;
        this.broadcast();
        break;
      }
      if (!saved) {
        await this.killPlayer(target, source);
        break;
      }
    }
  }

  async killPlayer(target, killer) {
    target.dead = true;
    this.log(`${target.name} 阵亡，身份为【${ROLE_CN[target.role]}】`);
    this.emitFX({ type: 'die', seat: target.seat, role: target.role });
    const all = [...target.hand, ...Object.values(target.equip).filter(Boolean), ...target.judge];
    target.hand = [];
    target.equip = { weapon: null, armor: null, horsePlus: null, horseMinus: null };
    target.judge = [];
    for (const c of all) this.discardCard(c);
    if (killer && !killer.dead && killer !== target) {
      if (target.role === 'rebel') {
        this.log(`${killer.name} 击杀反贼，摸三张牌`);
        this.drawCards(killer, 3);
      } else if (target.role === 'loyal' && killer.role === 'lord') {
        this.log(`${killer.name} 误杀忠臣，弃置所有手牌与装备`);
        const ks = [...killer.hand, ...Object.values(killer.equip).filter(Boolean)];
        killer.hand = [];
        killer.equip = { weapon: null, armor: null, horsePlus: null, horseMinus: null };
        for (const c of ks) this.discardCard(c);
        await this.trigger('cardLose', killer, { cards: ks, fromEquip: true });
      }
    }
    this.broadcast();
    this.checkOver();
  }

  /* ==================== 回合流程 ==================== */
  async run() {
    try {
      let seat = this.lordSeat;
      let guard = 0;
      while (!this.over && guard++ < 3000) {
        const p = this.players[seat];
        this.currentSeat = seat;
        if (!p.dead) await this.turn(p);
        if (this.over) break;
        seat = (seat + 1) % this.players.length;
        if (seat === this.lordSeat) this.round++;
      }
    } catch (e) {
      if (!(e instanceof EndSignal)) console.error('[引擎异常]', e);
    }
    this.finish();
  }

  async turn(p) {
    this.phase = 'begin';
    p.turnFlags = this.freshFlags();
    this.log(`———— 第 ${this.round} 轮 · ${p.name} 的回合 ————`);
    this.emitFX({ type: 'turn', seat: p.seat, round: this.round });
    this.broadcast();
    await this.beginPhase(p);
    if (this.over || p.dead) return;
    this.phase = 'draw';
    this.broadcast();
    await this.drawPhase(p);
    if (this.over || p.dead) return;
    this.phase = 'play';
    this.broadcast();
    await this.playPhase(p);
    if (this.over || p.dead) return;
    this.phase = 'discard';
    this.broadcast();
    await this.discardPhase(p);
    if (this.over || p.dead) return;
    this.phase = 'end';
    this.broadcast();
    await this.endPhase(p);
  }

  async beginPhase(p) {
    await this.trigger('turnBegin', p, {});
    if (this.over || p.dead) return;
    for (const jc of [...p.judge]) {
      if (this.over || p.dead) break;
      const idx = p.judge.indexOf(jc);
      if (idx >= 0) p.judge.splice(idx, 1);
      const owner = this.players[jc.ownerSeat] || p;
      // 可能是被【断粮】【国色】当作延时锦囊使用的其它牌，按“当作”的牌名结算
      const jcName = jc.__as || jc.name;
      const jcCn = CARD_META[jcName].cn;
      if (await this.askWuxie(jcName, owner.seat, p.seat, jc)) {
        this.log(`【${jcCn}】被【无懈可击】抵消并弃置`);
        this.discardCard(jc);
        continue;
      }
      if (jcName === 'lebu') {
        const c = await this.judgeCard(p, '乐不思蜀');
        if (c.suit === 'heart') {
          this.log('判定为红桃，【乐不思蜀】失效');
        } else {
          this.log('判定不为红桃，【乐不思蜀】生效，跳过出牌阶段');
          p.turnFlags.skipPlay = true;
        }
        this.discardCard(jc);
      } else if (jcName === 'bingliang') {
        const c = await this.judgeCard(p, '兵粮寸断');
        if (c.suit === 'club') {
          this.log('判定为梅花，【兵粮寸断】失效');
        } else {
          this.log('判定不为梅花，【兵粮寸断】生效，跳过摸牌阶段');
          p.turnFlags.skipDraw = true;
        }
        this.discardCard(jc);
      } else if (jcName === 'lightning') {
        const c = await this.judgeCard(p, '闪电');
        const hit = c.suit === 'spade' && c.num >= 2 && c.num <= 9;
        if (hit) {
          this.log('判定为黑桃2~9，【闪电】生效！');
          await this.applyDamage({ source: null, target: p, amount: 3, card: jc, reason: '闪电' });
          // 用 inPossession 判断：若判定牌已被【奸雄】等技能获得，就不能再入弃牌堆，否则同一张牌会同时存在两处
          if (!this.inPossession(jc)) this.discardCard(jc);
        } else {
          const next = this.nextAlive(p);
          if (next && next !== p) {
            jc.ownerSeat = next.seat;
            next.judge.push(jc);
            this.log(`【闪电】未生效，移至 ${next.name} 的判定区`);
          } else {
            this.discardCard(jc);
          }
        }
      }
    }
  }

  async drawPhase(p) {
    let n = 2;
    if (p.turnFlags.skipDraw) {
      this.log(`${p.name} 因【兵粮寸断】跳过摸牌阶段`);
      return;
    }
    if (p.__skipNextDraw) {
      p.__skipNextDraw = false;
      this.log(`${p.name} 因【据守】跳过摸牌阶段`);
      return;
    }
    // 【突袭】【神速】等“用技能替代摸牌阶段”的技能
    for (const sid of p.skillIds) {
      const sk = SKILLS[sid];
      if (sk && sk.insteadDraw && await sk.insteadDraw(this, p)) return;
    }
    for (const sid of p.skillIds) {
      const sk = SKILLS[sid];
      if (sk && sk.modifyDraw) n += sk.modifyDraw(this, p) || 0;
    }
    if (p.skillIds.includes('luoyi') && !p.turnFlags.skills.luoyi) {
      const go = await this.askYesNo(p.seat, '是否发动【裸衣】？摸牌阶段少摸一张，本回合【杀】伤害+1', { yesLabel: '发动裸衣', noLabel: '不发动', purpose: 'luoyi' });
      p.turnFlags.skills.luoyi = true;
      if (go) {
        p.turnFlags.luoyi = true;
        n -= 1;
        this.log(`${p.name} 发动【裸衣】，本回合【杀】伤害+1`);
      }
    }
    n = Math.max(0, n);
    if (n) this.drawCards(p, n);
    this.log(`${p.name} 摸了 ${n} 张牌`);
  }

  async playPhase(p) {
    if (p.turnFlags.skipPlay) return;
    let guard = 0;
    while (!this.over && !p.dead && guard++ < 200) {
      const actions = this.computeActions(p);
      const act = await this.request(p.seat, { kind: 'turn', actions, canEnd: true });
      if (!act || act.type === 'end') break;
      if (act.type === 'card') await this.playCard(p, act);
      else if (act.type === 'skill') await this.useSkill(p, act.skill);
    }
  }

  async discardPhase(p) {
    if (this.over || p.dead) return;
    const excess = p.hand.length - p.hp;
    if (excess <= 0) return;
    // 【克己】描述为「可以跳过弃牌阶段」，是否跳过由玩家决定（无需弃牌时就不询问）
    if (p.skillIds.includes('keji') && p.turnFlags.slashUsed === 0) {
      const go = await this.askYesNo(p.seat, '本回合未使用过【杀】，是否发动【克己】跳过弃牌阶段？',
        { yesLabel: '跳过弃牌', noLabel: '正常弃牌', purpose: 'keji' });
      if (go) {
        this.log(`${p.name} 发动【克己】，跳过弃牌阶段`);
        return;
      }
    }
    // 可以弃置任意张，只要最终手牌数不超过体力值：
    // 最少弃 excess 张（刚好留到体力值），最多可全部弃掉。
    const choices = p.hand.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) }));
    let ids = await this.choose(p.seat, {
      prompt: `弃牌阶段：手牌 ${p.hand.length} 张 / 体力 ${p.hp}，请弃至不超过 ${p.hp} 张（至少 ${excess} 张）`,
      choices, min: excess, max: p.hand.length, style: 'cards', purpose: 'discard', optional: false,
    });
    let cards = [];
    if (ids && ids.length) {
      for (const uid of ids) {
        const c = p.hand.find((x) => x.uid === uid);
        if (c && !cards.includes(c)) cards.push(c);
      }
    }
    // 未选够（超时/异常）时按价值最低自动补足到最少张数
    if (cards.length < excess) {
      const rest = [...p.hand].filter((c) => !cards.includes(c))
        .sort((a, b) => this.cardValue(p, a) - this.cardValue(p, b));
      while (cards.length < excess && rest.length) cards.push(rest.shift());
    }
    await this.discardFromHand(p, cards);
    this.log(`${p.name} 弃置 ${cards.length} 张手牌（剩余 ${p.hand.length} 张）`);
  }

  async endPhase(p) {
    await this.trigger('turnEnd', p, {});
  }

  /* ==================== 可用动作 ==================== */
  computeActions(p) {
    const acts = [];
    if (p.dead || this.over) return acts;
    const limit = this.slashLimit(p);
    // 【天义】【陷阵】【巧说】拼点失败：本回合不能使用【杀】
    const canSlash = p.turnFlags.slashUsed < limit && !p.turnFlags.noSlash;
    const others = this.alive().filter((x) => x !== p);
    // 【陷阵】对指定目标无视距离，【巧说】本回合无距离限制
    const reach = others.filter((t) => this.canReach(p, t)
      || p.turnFlags.noRangeLimit
      || p.turnFlags.xianzhenSeat === t.seat);

    for (const c of p.hand) {
      for (const as of this.convertNames(p, c, 'play')) {
        const meta = CARD_META[as];
        if (!meta) continue;
        if (as === 'slash') {
          if (!canSlash) continue;
          const tg = reach.filter((t) => this.canBeTarget(t, 'slash', p)).map((t) => t.seat);
          if (!tg.length) continue;
          const isLast = p.hand.length === 1;
          let max = (p.equip.weapon && p.equip.weapon.name === 'fangtian' && isLast) ? Math.min(3, tg.length) : 1;
          // 【天义】获胜后可额外指定一个目标
          if (p.turnFlags.tianyi) max = Math.min(2, tg.length);
          acts.push({ type: 'card', as, cardId: c.uid, targets: tg, min: 1, max, need: 1 });
        } else if (meta.type === 'equip') {
          acts.push({ type: 'card', as, cardId: c.uid, targets: [], min: 0, max: 0, need: 1 });
        } else if (meta.type === 'delayed') {
          if (as === 'lightning') {
            if (p.judge.some((j) => j.name === 'lightning')) continue;
            acts.push({ type: 'card', as, cardId: c.uid, targets: [], min: 0, max: 0, need: 1 });
          } else if (as === 'lebu' || as === 'bingliang') {
            const tg = others.filter((t) => this.canBeTarget(t, as, p)).map((t) => t.seat);
            if (!tg.length) continue;
            acts.push({ type: 'card', as, cardId: c.uid, targets: tg, min: 1, max: 1, need: 1 });
          }
        } else if (meta.mode === 'self') {
          if (as === 'wine' && p.turnFlags.usedWine) continue;
          acts.push({ type: 'card', as, cardId: c.uid, targets: [], min: 0, max: 0, need: 1 });
        } else if (meta.mode === 'heal') {
          if (p.hp >= p.maxHp) continue;
          acts.push({ type: 'card', as, cardId: c.uid, targets: [], min: 0, max: 0, need: 1 });
        } else if (meta.mode === 'all') {
          acts.push({ type: 'card', as, cardId: c.uid, targets: [], min: 0, max: 0, need: 1 });
        } else if (meta.mode === 'enemy') {
          // 传入实际卡牌，供【帷幕】等按花色判断的技能使用
          let tg = others.filter((t) => this.canBeTarget(t, as, p, c));
          if (meta.range === 1 && !p.skillIds.includes('qicai')) tg = tg.filter((t) => this.distance(p, t) <= 1);
          if (as === 'borrow') {
            tg = tg.filter((t) => this.alive().some((b) => b !== t && this.attackRange(t) >= this.distance(t, b) && this.canBeTarget(b, 'slash', t)));
          }
          if (!tg.length) continue;
          acts.push({ type: 'card', as, cardId: c.uid, targets: tg.map((t) => t.seat), min: 1, max: 1, need: 1 });
        }
      }
    }

    if (p.equip.weapon && p.equip.weapon.name === 'zhangba' && canSlash && p.hand.length >= 2) {
      const tg = reach.filter((t) => this.canBeTarget(t, 'slash', p)).map((t) => t.seat);
      if (tg.length) acts.push({ type: 'card', as: 'slash', cardId: null, targets: tg, min: 1, max: 1, need: 2, weapon: 'zhangba' });
    }

    for (const sid of p.skillIds) {
      const meta = SKILL_META[sid];
      const sk = SKILLS[sid];
      if (!sk || !sk.active || !meta) continue;
      if (meta.type === 'lord' && p.role !== 'lord') continue;
      if (sk.oncePerTurn && p.turnFlags.skills[sid]) continue;
      if (sk.canUse && !sk.canUse(this, p)) continue;
      acts.push({ type: 'skill', skill: sid });
    }

    // 去重（同一张牌+同一用法）
    const seen = new Set();
    return acts.filter((a) => {
      const key = `${a.type}:${a.skill || ''}:${a.cardId || ''}:${a.as || ''}:${a.need || 1}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  cardValue(p, c) {
    const meta = CARD_META[c.name];
    switch (c.name) {
      case 'peach': return p.hp < p.maxHp ? 10 : 6;
      case 'slash': return 7;
      case 'jink': return 6;
      case 'wine': return 3;
      case 'wuxie': return 6;
      case 'duel': return 6;
      case 'invasion': case 'arrows': return 7;
      case 'snatch': case 'dismantle': return 6;
      case 'abundance': return 8;
      case 'harvest': return 5;
      case 'orchard': return 4;
      case 'borrow': return 4;
      case 'lebu': return 6;
      case 'lightning': return 1;
      case 'fire': case 'thunder': return 8;   // 属性杀更实用（可破藤甲）
      case 'bingliang': return 6;
      case 'huogong': return 5;
      case 'tengjia': return 5;
      case 'baiyin': return 6;
      case 'hanbing': case 'guding': case 'zhuque': return 6;
      default:
        if (meta.type === 'equip') return meta.sub === 'weapon' ? 6 : 4;
        return 3;
    }
  }

  /* ==================== 出牌结算 ==================== */
  async useSkill(p, sid) {
    const meta = SKILL_META[sid];
    const sk = SKILLS[sid];
    if (!sk || !sk.active || !meta) return;
    if (meta.type === 'lord' && p.role !== 'lord') return;
    if (sk.oncePerTurn && p.turnFlags.skills[sid]) return;
    if (sk.canUse && !sk.canUse(this, p)) return;
    this.emitFX({ type: 'skill', seat: p.seat, skill: sid, cn: meta.cn });
    await sk.active(this, p);
    if (sk.oncePerTurn) p.turnFlags.skills[sid] = true;
  }

  async playCard(p, act) {
    const meta = CARD_META[act.as];
    if (!meta) return;
    const cards = [];
    if (act.cardId) {
      const c = p.hand.find((x) => x.uid === act.cardId);
      if (!c) return;
      cards.push(c);
    }
    for (const uid of act.extraCards || []) {
      const c = p.hand.find((x) => x.uid === uid);
      if (c && !cards.includes(c)) cards.push(c);
    }
    const need = act.need || 1;
    if (cards.length < need) return;
    const targets = (act.targets || []).map((s) => this.players[s]).filter((t) => t && !t.dead);
    const main = cards[0];
    this.log(`${p.name} 使用【${meta.cn}】${cards.length > 1 ? `（${cards.map(cardText).join('+')}）` : ` ${cardText(main)}`}${targets.length ? ` → ${targets.map((t) => t.name).join('、')}` : ''}`);
    this.emitFX({
      type: 'play', seat: p.seat, as: act.as, card: cardView(main),
      extra: cards.slice(1).map(cardView),
      targets: targets.map((t) => t.seat),
    });
    // 牌已离手：无论基本牌 / 锦囊 / 装备 / 延时锦囊，都要触发【连营】这类技能
    await this.takeFromHand(p, cards);
    this.broadcast();

    if (meta.type === 'scroll' || meta.type === 'delayed') {
      const tgtSeat = targets[0] ? targets[0].seat : p.seat;
      if (await this.askWuxie(act.as, p.seat, tgtSeat, main)) {
        this.log(`【${meta.cn}】被【无懈可击】抵消`);
        for (const c of cards) this.discardCard(c);
        return;
      }
    }

    if (meta.type === 'delayed') {
      const tgt = act.as === 'lightning' ? p : targets[0];
      if (!tgt) {
        for (const c of cards) this.discardCard(c);
        return;
      }
      main.ownerSeat = p.seat;
      // 【断粮】【国色】等会把其它牌当作延时锦囊使用，这里记录其“当作”的牌名，
      // 否则判定阶段认不出这张牌，它会被移出判定区却永远不进弃牌堆（牌凭空消失）
      if (act.as !== main.name) main.__as = act.as;
      tgt.judge.push(main);
      this.log(`【${meta.cn}】置入 ${tgt.name} 的判定区`);
      for (const c of cards.slice(1)) this.discardCard(c);
      return;
    }

    if (meta.type === 'equip') {
      // 上面的 play 事件已经展示了这张牌，装备动画会重复，故静默
      await this.equip(p, main, { silent: true });
      for (const c of cards.slice(1)) this.discardCard(c);
      return;
    }

    switch (act.as) {
      case 'slash':
      case 'fire':
      case 'thunder':
        // 属性杀同样走【杀】结算，火焰/雷电属性由 slashElement 解析
        await this.useSlash(p, targets, main, { cards });
        break;
      case 'peach':
        this.heal(p, 1);
        break;
      case 'wine':
        p.turnFlags.wine = true;
        p.turnFlags.usedWine = true;
        this.log(`${p.name} 使用【酒】，下一张【杀】伤害+1`);
        break;
      case 'duel':
        await this.duel(p, targets[0]);
        break;
      case 'invasion':
        for (const t of this.orderFrom(p)) {
          if (this.over) break;
          if (t === p || t.dead) continue;
          // 【藤甲】免疫南蛮入侵，无需出杀
          if (t.equip.armor && t.equip.armor.name === 'tengjia') {
            this.log(`【藤甲】生效，${t.name} 免疫【南蛮入侵】`);
            this.emitFX({ type: 'armorEffect', seat: t.seat, armor: 'tengjia', blocked: true });
            continue;
          }
          // 【祸首】【巨象】：免疫【南蛮入侵】
          if (this.hasSkill(t, 'huoshou') || this.hasSkill(t, 'juxiang')) {
            const cn = this.hasSkill(t, 'huoshou') ? '祸首' : '巨象';
            this.log(`【${cn}】生效，${t.name} 免疫【南蛮入侵】`);
            continue;
          }
          const res = await this.askCard(t.seat, 'slash', { reason: 'invasion', purpose: 'invasion', initiator: p.seat });
          if (!res) await this.applyDamage({ source: p, target: t, amount: 1, card: main, reason: '南蛮入侵' });
        }
        // 【巨象】：【南蛮入侵】结算结束后，祝融获得之
        // 两点限制都必须有：
        // 1) 用 inLimbo 判断——该牌可能已在结算中被【奸雄】夺得并随其阵亡进入弃牌堆；
        // 2) 使用者本人不能拿回——否则祝融能把手里的【南蛮入侵】反复打出又拿回，
        //    同一回合内无限循环（实测一局能打出上万次，全场被磨死）。
        if (!this.over && !this.hasSkill(p, 'juxiang')) {
          const zr = this.alive().find((x) => this.hasSkill(x, 'juxiang'));
          if (zr && this.inLimbo(main)) {
            zr.hand.push(main);
            this.log(`${zr.name} 发动【巨象】，获得【南蛮入侵】`);
          }
        }
        break;
      case 'arrows':
        for (const t of this.orderFrom(p)) {
          if (this.over) break;
          if (t === p || t.dead) continue;
          // 【藤甲】免疫万箭齐发，无需出闪
          if (t.equip.armor && t.equip.armor.name === 'tengjia') {
            this.log(`【藤甲】生效，${t.name} 免疫【万箭齐发】`);
            this.emitFX({ type: 'armorEffect', seat: t.seat, armor: 'tengjia', blocked: true });
            continue;
          }
          const res = await this.askCard(t.seat, 'jink', { reason: 'arrows', purpose: 'arrows', initiator: p.seat });
          if (!res) await this.applyDamage({ source: p, target: t, amount: 1, card: main, reason: '万箭齐发' });
        }
        break;
      case 'huogong':
        await this.huoGong(p, targets[0]);
        break;
      case 'abundance':
        this.drawCards(p, 2);
        this.log(`${p.name} 摸了两张牌`);
        break;
      case 'orchard':
        for (const t of this.alive()) this.heal(t, 1);
        break;
      case 'harvest':
        await this.harvest(p);
        break;
      case 'snatch':
        await this.takeOrDump(p, targets[0], true);
        break;
      case 'dismantle':
        await this.takeOrDump(p, targets[0], false);
        break;
      case 'borrow':
        await this.borrow(p, targets[0]);
        break;
      default:
        break;
    }

    // 只把确实无主的牌放入弃牌堆（被【奸雄】等技能获得的牌仍在他人手中）
    // 只把确实无主的牌放入弃牌堆（被【奸雄】等技能获得的牌仍在他人手中）
    for (const c of cards) if (!this.inPossession(c)) this.discardCard(c);
    if (meta.type === 'scroll') await this.trigger('usedScroll', p, { card: main });
  }

  async useSlash(p, targets, mainCard, opts = {}) {
    if (!opts.free) p.turnFlags.slashUsed++;
    const weapon = p.equip.weapon ? p.equip.weapon.name : null;
    const wushuang = p.skillIds.includes('wushuang');
    let resolved = 0;

    for (const t of targets) {
      if (this.over || p.dead) break;
      if (t.dead) continue;

      // 雌雄双股剑
      if (weapon === 'shuanggu' && t.hero && t.hero.gender !== p.hero.gender) {
        const go = await this.askYesNo(p.seat, `是否发动【雌雄双股剑】？`, { yesLabel: '发动', noLabel: '不发动', purpose: 'shuanggu' });
        if (go) {
          const ch = [];
          if (t.hand.length) ch.push({ id: 'discard', label: '弃置一张手牌' });
          ch.push({ id: 'draw', label: `令 ${p.name} 摸一张牌` });
          const ids = await this.choose(t.seat, { prompt: '【雌雄双股剑】请选择：', choices: ch, min: 1, max: 1, purpose: 'shuanggu' });
          if (ids && ids[0] === 'discard' && t.hand.length) {
            const cs = await this.choose(t.seat, {
              prompt: '选择要弃置的手牌', style: 'cards', min: 1, max: 1, purpose: 'discard',
              choices: t.hand.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) })),
            });
            if (cs && cs.length) await this.discardFromHand(t, [t.hand.find((c) => c.uid === cs[0])]);
          } else {
            this.drawCards(p, 1);
            this.log(`${t.name} 选择令 ${p.name} 摸一张牌`);
          }
        }
      }

      // 铁骑
      let mustHit = false;
      if (p.skillIds.includes('tieqi')) {
        const go = await this.askYesNo(p.seat, '是否发动【铁骑】进行判定？', { yesLabel: '判定', noLabel: '不发动', purpose: 'tieqi' });
        if (go) {
          const jc = await this.judgeCard(p, '铁骑');
          if (isRed(jc)) {
            mustHit = true;
            this.log('【铁骑】判定为红色，此【杀】不可被【闪】抵消');
          }
        }
      }

      // 【烈弓】：目标手牌数不少于你、或体力值不高于你时，该【杀】不可被【闪】响应
      if (!mustHit && p.skillIds.includes('liegong')
        && (t.hand.length >= p.hand.length || t.hp <= p.hp)) {
        mustHit = true;
        this.log(`【烈弓】生效，${t.name} 的手牌数/体力值满足条件，无法使用【闪】响应此【杀】`);
      }

      let evaded = false;
      if (!mustHit) evaded = await this.askJink(t, p, mainCard, { needTwo: wushuang });

      if (evaded) {
        // 贯石斧
        if (weapon === 'guanshi' && p.hand.length >= 2 && !this.over) {
          const go = await this.askYesNo(p.seat, '目标打出【闪】，是否发动【贯石斧】弃两张手牌强制命中？', { yesLabel: '弃2张', noLabel: '不发动', purpose: 'guanshi' });
          if (go) {
            const cs = await this.choose(p.seat, {
              prompt: '选择两张手牌弃置', style: 'cards', min: 2, max: 2, purpose: 'discard',
              choices: p.hand.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) })),
            });
            if (cs && cs.length >= 2) {
              const two = cs.slice(0, 2).map((u) => p.hand.find((c) => c.uid === u)).filter(Boolean);
              await this.discardFromHand(p, two);
              evaded = false;
              this.log(`【贯石斧】生效，此【杀】依然造成伤害`);
            }
          }
        }
        // 青龙偃月刀
        if (evaded && weapon === 'qinglong' && !this.over) {
          const opts2 = this.cardOptions(p, 'slash', { noBagua: true });
          if (opts2.length) {
            const go = await this.askYesNo(p.seat, `是否发动【青龙偃月刀】继续对 ${t.name} 使用【杀】？`, { yesLabel: '继续出杀', noLabel: '不发动', purpose: 'qinglong' });
            if (go) {
              const id = await this.respond(p.seat, 'slash', { choices: opts2, prompt: '选择要使用的【杀】', purpose: 'qinglong', target: t.seat });
              const c = id ? p.hand.find((x) => x.uid === id) : null;
              if (c) {
                await this.takeFromHand(p, [c]);
                this.emitFX({ type: 'play', seat: p.seat, as: 'slash', card: cardView(c), targets: [t.seat], weapon: 'qinglong' });
                await this.useSlash(p, [t], c, { free: true });
                if (!this.inPossession(c)) this.discardCard(c);
                if (p.turnFlags.wine) p.turnFlags.wine = false;
                resolved++;
                continue;
              }
            }
          }
        }
        // 【猛进】【骁果】：【杀】被【闪】抵消后触发
        if (evaded) await this.trigger('slashDodged', p, { target: t, card: mainCard });
      }

      if (!evaded && !t.dead) {
        const element = this.slashElement(p, mainCard);
        if (element) this.log(`此【杀】为${element === 'fire' ? '火焰' : '雷电'}属性`);

        // 【寒冰剑】：防止此伤害，改为弃置其两张牌
        if (weapon === 'hanbing' && !this.over) {
          const go = await this.askYesNo(p.seat, '是否发动【寒冰剑】防止伤害，改为弃置其两张牌？',
            { yesLabel: '发动', noLabel: '不发动', purpose: 'hanbing' });
          if (go) {
            const pool = [...t.hand];
            if (pool.length) {
              const cs = await this.choose(p.seat, {
                prompt: `选择弃置 ${t.name} 的至多两张手牌`, style: 'cards',
                min: 1, max: Math.min(2, pool.length), purpose: 'discard',
                choices: pool.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) })),
              });
              const two = (cs || []).map((u) => t.hand.find((c) => c.uid === u)).filter(Boolean);
              if (two.length) {
                await this.discardFromHand(t, two);
                this.log(`【寒冰剑】生效，伤害被防止，${t.name} 弃置 ${two.length} 张牌`);
                if (p.turnFlags.wine) p.turnFlags.wine = false;
                resolved++;
                continue;
              }
            }
          }
        }

        let amount = 1 + (p.turnFlags.luoyi ? 1 : 0);
        // 【古锭刀】：对没有手牌的角色伤害+1
        if (weapon === 'guding' && t.hand.length === 0) {
          amount += 1;
          this.log(`【古锭刀】生效，${t.name} 无手牌，伤害+1`);
        }
        if (p.turnFlags.wine) {
          amount += 1;
          p.turnFlags.wine = false;
          this.log('【酒】生效，伤害+1');
        }
        await this.applyDamage({ source: p, target: t, amount, card: mainCard, reason: '杀', element });
        // 麒麟弓
        if (weapon === 'qilin' && !this.over && !t.dead) {
          const horses = [];
          if (t.equip.horsePlus) horses.push('horsePlus');
          if (t.equip.horseMinus) horses.push('horseMinus');
          if (horses.length) {
            const go = await this.askYesNo(p.seat, `是否发动【麒麟弓】弃置 ${t.name} 的一匹坐骑？`, { purpose: 'qilin' });
            if (go) {
              const ids = await this.choose(p.seat, {
                prompt: '选择要弃置的坐骑', min: 1, max: 1, purpose: 'qilin',
                choices: horses.map((h) => ({ id: h, label: CARD_META[t.equip[h].name].cn })),
              });
              if (ids && ids.length) await this.loseEquip(t, ids[0]);
            }
          }
        }
      }
      if (p.turnFlags.wine) p.turnFlags.wine = false;
      resolved++;
    }
    if (!resolved) return;
  }

  async duel(initiator, target) {
    if (!target || target.dead) return;
    let cur = target;
    let other = initiator;
    let guard = 0;
    while (!this.over && guard++ < 40) {
      if (cur.dead || other.dead) break;
      const need = other.skillIds.includes('wushuang') ? 2 : 1;
      let ok = true;
      for (let i = 0; i < need; i++) {
        const res = await this.askCard(cur.seat, 'slash', { reason: 'duel', purpose: 'duel', initiator: other.seat, target: other.seat });
        if (!res) { ok = false; break; }
      }
      if (!ok) {
        await this.applyDamage({ source: other, target: cur, amount: 1, card: null, reason: '决斗' });
        break;
      }
      const tmp = cur;
      cur = other;
      other = tmp;
    }
  }

  async borrow(p, A) {
    if (!A || A.dead) return;
    const cands = this.alive().filter((t) => t !== A && this.attackRange(A) >= this.distance(A, t) && this.canBeTarget(t, 'slash', A));
    if (!cands.length) return;
    const seatB = await this.choosePlayer(p.seat, { prompt: `【借刀杀人】选择 ${A.name} 攻击的目标`, candidates: cands.map((t) => t.seat), purpose: 'borrowTarget' });
    if (seatB === null) return;
    const B = this.players[seatB];
    this.log(`${p.name} 令 ${A.name} 对 ${B.name} 使用【杀】`);
    const res = await this.askCard(A.seat, 'slash', { reason: 'borrow', purpose: 'borrow', target: B.seat, initiator: p.seat, prompt: `【借刀杀人】是否对 ${B.name} 使用【杀】？` });
    if (res && res.card) {
      await this.useSlash(A, [B], res.card, { free: true });
      if (!this.inPossession(res.card)) this.discardCard(res.card);
    } else if (A.equip.weapon) {
      const w = await this.loseEquip(A, 'weapon', { discard: false });
      if (w) {
        p.hand.push(w);
        this.log(`${p.name} 获得【${CARD_META[w.name].cn}】`);
      }
    }
  }

  /** 【火攻】：目标展示一张手牌，你弃置一张同花色手牌，对其造成1点火焰伤害 */
  async huoGong(p, target) {
    if (!target || target.dead) return;
    if (!target.hand.length) {
      this.log(`${target.name} 没有手牌，【火攻】无法指定`);
      return;
    }
    const pick = await this.choose(target.seat, {
      prompt: '【火攻】请展示一张手牌', style: 'cards', min: 1, max: 1, purpose: 'showCard',
      choices: target.hand.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) })),
    });
    const shown = (pick && pick.length)
      ? target.hand.find((c) => c.uid === pick[0])
      : target.hand[randInt(target.hand.length)];
    if (!shown) return;
    this.log(`${target.name} 展示手牌 ${cardText(shown)}`);
    this.emitFX({ type: 'showCard', seat: target.seat, card: cardView(shown), reason: '火攻' });

    const same = p.hand.filter((c) => c.suit === shown.suit);
    if (!same.length) {
      this.log(`${p.name} 没有${SUIT_CN[shown.suit]}花色的手牌，【火攻】失败`);
      return;
    }
    const drop = await this.choose(p.seat, {
      prompt: `弃置一张${SUIT_CN[shown.suit]}花色的手牌以造成火焰伤害（也可放弃）`,
      style: 'cards', min: 0, max: 1, optional: true, purpose: 'huogong',
      choices: same.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) })),
    });
    if (!drop || !drop.length) {
      this.log(`${p.name} 放弃发动【火攻】`);
      return;
    }
    const card = p.hand.find((c) => c.uid === drop[0]);
    if (!card) return;
    await this.discardFromHand(p, [card]);
    await this.applyDamage({ source: p, target, amount: 1, card: null, reason: '火攻', element: 'fire' });
  }

  async takeOrDump(p, target, isSnatch) {
    if (!target || target.dead) return;
    const choices = [];
    if (target.hand.length) choices.push({ id: 'random', label: `随机手牌（${target.hand.length} 张）` });
    for (const slot of ['weapon', 'armor', 'horsePlus', 'horseMinus']) {
      const c = target.equip[slot];
      if (c) choices.push({ id: `eq:${slot}`, label: `装备·${CARD_META[c.name].cn}`, card: cardView(c) });
    }
    for (const j of target.judge) choices.push({ id: `jd:${j.uid}`, label: `判定·${CARD_META[j.__as || j.name].cn}`, card: cardView(j) });
    if (!choices.length) return;
    const ids = await this.choose(p.seat, {
      prompt: isSnatch ? '【顺手牵羊】选择要获得的牌' : '【过河拆桥】选择要弃置的牌',
      choices, min: 1, max: 1, style: 'mixed', purpose: isSnatch ? 'snatch' : 'dismantle',
    });
    const id = ids && ids[0];
    if (!id) return;
    let card = null;
    if (id === 'random') {
      card = target.hand.splice(randInt(target.hand.length), 1)[0];
      await this.trigger('cardLose', target, { cards: [card] });
    } else if (id.startsWith('eq:')) {
      // 过河拆桥（非顺手牵羊）随后会广播 destroy 事件公示这张牌，此处静默避免重复
      card = await this.loseEquip(target, id.slice(3), { discard: !isSnatch, silent: !isSnatch });
    } else if (id.startsWith('jd:')) {
      const j = target.judge.find((c) => c.uid === id.slice(3));
      if (j) {
        target.judge.splice(target.judge.indexOf(j), 1);
        card = j;
        await this.trigger('cardLose', target, { cards: [card] });
      }
    }
    if (!card) return;
    if (isSnatch) {
      p.hand.push(card);
      this.log(`${p.name} 获得 ${target.name} 的【${CARD_META[card.name].cn}】`);
    } else {
      this.discardCard(card);
      this.log(`${target.name} 的【${CARD_META[card.name].cn}】被弃置`);
      // 过河拆桥弃置的牌向全场公示
      this.emitFX({
        type: 'destroy', seat: target.seat, bySeat: p.seat,
        card: cardView(card), from: id.startsWith('eq:') ? 'equip' : id.startsWith('jd:') ? 'judge' : 'hand',
      });
    }
  }

  async harvest(p) {
    const n = this.alive().length;
    const pool = [];
    for (let i = 0; i < n; i++) {
      if (!this.drawPile.length) this.reshuffle();
      if (!this.drawPile.length) break;
      pool.push(this.drawPile.pop());
    }
    this.log(`${p.name} 使用【五谷丰登】，亮出 ${pool.length} 张牌`);
    // 先向全场公示所有牌约 1 秒，再开始依次选牌
    this.emitFX({ type: 'harvestReveal', seat: p.seat, cards: pool.map(cardView), hold: 1000 });
    await sleep(1000);
    for (const pl of this.orderFrom(p)) {
      if (this.over || pl.dead || !pool.length) break;
      const choices = pool.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) }));
      const ids = await this.choose(pl.seat, { prompt: '【五谷丰登】选择一张牌', choices, min: 1, max: 1, style: 'cards', purpose: 'harvest' });
      let pick = pool[0];
      if (ids && ids.length) {
        const f = pool.find((c) => c.uid === ids[0]);
        if (f) pick = f;
      }
      pool.splice(pool.indexOf(pick), 1);
      pl.hand.push(pick);
      this.log(`${pl.name} 获得一张牌`);
    }
    for (const c of pool) this.discardCard(c);
  }

  /* ==================== 胜负 ==================== */
  checkOver() {
    const alive = this.alive();
    const lord = this.players.find((p) => p.role === 'lord');
    const rebels = alive.filter((p) => p.role === 'rebel').length;
    const loyals = alive.filter((p) => p.role === 'loyal').length;
    const renes = alive.filter((p) => p.role === 'rene').length;
    if (!lord || lord.dead) {
      // 主公阵亡：只有“其他角色全是内奸”时内奸获胜；只要还有忠臣存活，一律判反贼获胜
      // （反贼是否已全部阵亡不影响此判定；内奸人数可能为 2，故用 >= 1）
      this.setWinner(rebels === 0 && loyals === 0 && renes >= 1 ? 'rene' : 'rebel');
      return true;
    }
    if (rebels === 0 && renes === 0) {
      this.setWinner('lord');
      return true;
    }
    return false;
  }

  setWinner(faction) {
    this.over = true;
    this.winner = faction;
    this.emitFX({ type: 'over', winner: faction });
    const group = faction === 'lord' ? ['lord', 'loyal'] : [faction];
    const names = this.players.filter((p) => group.includes(p.role));
    const cn = { lord: '主公与忠臣', rebel: '反贼', rene: '内奸' }[faction];
    this.log(`游戏结束！${cn}获胜：${names.map((p) => p.name).join('、')}`);
  }

  finish() {
    this.phase = 'over';
    if (!this.winner) this.checkOver();
    this.pending = null;
    this.broadcast();
  }

  /* ==================== 状态序列化 ==================== */
  stateFor(seat) {
    const me = this.players[seat];
    const players = this.players.map((p) => {
      const roleVisible = p.seat === seat || p.role === 'lord' || p.dead || this.over;
      return {
        seat: p.seat,
        name: p.name,
        isAI: p.isAI,
        connected: p.isAI ? true : !!this.room.socketOf(p.id),
        hero: p.hero ? { id: p.hero.id, name: p.hero.name, country: p.hero.country, gender: p.hero.gender } : null,
        skills: p.hero ? p.hero.skills
          .filter((s) => SKILL_META[s].type !== 'lord' || p.role === 'lord')
          .map((s) => ({ id: s, cn: SKILL_META[s].cn, desc: SKILL_META[s].desc, type: SKILL_META[s].type })) : [],
        hp: p.hp,
        maxHp: p.maxHp,
        dead: p.dead,
        handCount: p.hand.length,
        equip: equipView(p.equip),
        judge: p.judge.map(cardView),
        role: roleVisible ? p.role : 'unknown',
        attackRange: this.attackRange(p),
      };
    });
    const dist = {};
    if (me) for (const p of this.players) if (p !== me && !p.dead) dist[p.seat] = this.distance(me, p);

    let pending = null;
    if (this.pending && this.pending.seat === seat) {
      pending = { ...this.pending.req, id: this.pending.id };
    }

    return {
      roomId: this.room.id,
      round: this.round,
      phase: this.phase,
      currentSeat: this.currentSeat,
      lordSeat: this.lordSeat,
      over: this.over,
      winner: this.winner,
      winnerCn: this.winner ? { lord: '主公与忠臣', rebel: '反贼', rene: '内奸' }[this.winner] : '',
      players,
      me: me ? {
        seat: me.seat,
        hand: me.hand.map(cardView),
        role: me.role,
        hp: me.hp,
        maxHp: me.maxHp,
        dead: me.dead,
        dist,
      } : null,
      drawPileCount: this.drawPile.length,
      discardTop: cardView(this.discardPile[this.discardPile.length - 1]),
      discardCount: this.discardPile.length,
      pending,
      waitingSeat: this.pending ? this.pending.seat : null,
      waitingName: this.pending ? this.players[this.pending.seat].name : null,
      // 公开给所有人的“当前在等什么、还剩多久”，含倒计时截止时间戳。
      // 响应类请求（杀/闪/桃/无懈可击）不公开“正在询问谁”，只公开询问内容。
      pendingPublic: this.pending ? (() => {
        const anonymous = this.pending.req.kind === 'respond';
        return {
          seat: anonymous ? null : this.pending.seat,
          anonymous,
          kind: this.pending.req.kind,
          as: this.pending.req.as || null,
          style: this.pending.req.style || '',
          title: this.publicPendingTitle(this.pending.req),
          timeoutAt: this.pending.timeoutAt || 0,
          timeout: this.pending.timeout || 0,
        };
      })() : null,
      logs: this.logs.slice(-120),
    };
  }
}

module.exports = { Game, cardView, equipView, EndSignal };
