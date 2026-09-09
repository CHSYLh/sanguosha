/**
 * 武将技能实现
 * 钩子说明：
 *   convert(G,p,card,ctx)  卡牌可被当作哪些牌使用
 *   modifyDraw(G,p)        摸牌数修正
 *   turnBegin/turnEnd      回合开始/结束
 *   damaged(G,p,{source,amount,card,reason})
 *   cardLose(G,p,{cards,fromEquip})
 *   judgeDone(G,p,{card,reason})
 *   usedScroll(G,p,{card})
 *   active(G,p)            主动技能
 */
const { CARD_META, isRed, isBlack, isSlashCard, cardText, cardView, slotOf } = require('./cards');
const { SKILL_META } = require('./heroes');

const SUITS = [
  { id: 'spade', label: '♠ 黑桃' },
  { id: 'heart', label: '♥ 红桃' },
  { id: 'club', label: '♣ 梅花' },
  { id: 'diamond', label: '♦ 方块' },
];

const handChoices = (p) => p.hand.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) }));

const equipChoices = (p) => {
  const out = [];
  for (const slot of ['weapon', 'armor', 'horsePlus', 'horseMinus']) {
    const c = p.equip[slot];
    if (c) out.push({ id: `eq:${slot}`, label: `装备·${CARD_META[c.name].cn}`, card: cardView(c) });
  }
  return out;
};

const allChoices = (p) => [...handChoices(p), ...equipChoices(p)];

/** 令 chooser 弃置 victim 的一张牌（手牌优先），供【猛进】【挑衅】等复用 */
async function dumpOne(G, chooser, victim, purpose = 'dump') {
  const choices = [];
  if (victim.hand.length) choices.push({ id: 'random', label: `随机手牌（${victim.hand.length} 张）` });
  choices.push(...equipChoices(victim));
  for (const j of victim.judge) choices.push({ id: `jd:${j.uid}`, label: `判定·${CARD_META[j.__as || j.name].cn}`, card: cardView(j) });
  if (!choices.length) return false;
  const ids = await G.choose(chooser.seat, {
    prompt: `选择弃置 ${victim.name} 的一张牌`, style: 'mixed',
    choices, min: 1, max: 1, purpose,
  });
  const id = ids && ids[0];
  if (!id) return false;
  if (id === 'random') {
    const c = victim.hand.splice(Math.floor(Math.random() * victim.hand.length), 1)[0];
    await G.trigger('cardLose', victim, { cards: [c] });
    G.discardCard(c);
  } else if (id.startsWith('eq:')) {
    await G.loseEquip(victim, id.slice(3));
  } else if (id.startsWith('jd:')) {
    const j = victim.judge.find((c) => c.uid === id.slice(3));
    if (j) {
      victim.judge.splice(victim.judge.indexOf(j), 1);
      await G.trigger('cardLose', victim, { cards: [j] });
      G.discardCard(j);
    }
  }
  G.log(`${victim.name} 的一张牌被弃置`);
  return true;
}

/** 从玩家手牌中挑选 value 最低的 n 张 */
function pickLowest(G, p, n) {
  return [...p.hand].sort((a, b) => G.cardValue(p, a) - G.cardValue(p, b)).slice(0, n).map((c) => c.uid);
}

/** 从玩家手牌中挑选 value 最高的 n 张 */
function pickHighest(G, p, n) {
  return [...p.hand].sort((a, b) => G.cardValue(p, b) - G.cardValue(p, a)).slice(0, n).map((c) => c.uid);
}

const SKILLS = {
  /* ==================== 蜀 ==================== */
  rende: {
    active: async (G, p) => {
      if (!p.hand.length) return;
      const cands = G.alive().filter((x) => x !== p);
      if (!cands.length) return;
      const ids = await G.choose(p.seat, {
        prompt: '【仁德】选择要交给其他角色的手牌', style: 'cards',
        choices: handChoices(p), min: 1, max: p.hand.length, optional: true, purpose: 'rende',
      });
      if (!ids || !ids.length) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【仁德】选择获得牌的角色', purpose: 'allyTarget',
        candidates: cands.map((x) => x.seat), optional: true,
      });
      if (seat === null) return;
      const cards = ids.map((u) => p.hand.find((c) => c.uid === u)).filter(Boolean);
      G.removeFromHand(p, cards);
      for (const c of cards) G.players[seat].hand.push(c);
      p.turnFlags.rendeGiven = (p.turnFlags.rendeGiven || 0) + cards.length;
      G.log(`${p.name} 发动【仁德】，将 ${cards.length} 张牌交给 ${G.players[seat].name}`);
      let healed = 0;
      while (p.turnFlags.rendeGiven >= 2 && p.hp < p.maxHp) {
        p.turnFlags.rendeGiven -= 2;
        healOnce(G, p);
        healed++;
      }
      if (healed) G.log(`${p.name} 因【仁德】回复 ${healed} 点体力`);
      await G.trigger('cardLose', p, { cards });
    },
  },

  jijiang: {}, // 主公技，由引擎 lordAssist 实现
  hujia: {},   // 主公技，由引擎 lordAssist 实现
  jiuyuan: {}, // 主公技，由引擎 resolveDying 实现

  wusheng: {
    convert: (G, p, card, ctx) => {
      if ((ctx === 'slash' || ctx === 'play') && isRed(card)) return ['slash'];
      return [];
    },
  },

  paoxiao: {},
  kongcheng: {},
  qianxun: {},

  longdan: {
    convert: (G, p, card, ctx) => {
      if ((ctx === 'slash' || ctx === 'play') && card.name === 'jink') return ['slash'];
      if (ctx === 'jink' && card.name === 'slash') return ['jink'];
      return [];
    },
  },

  tieqi: {}, // 由引擎 useSlash 实现

  guanxing: {
    turnBegin: async (G, p) => {
      const n = Math.min(5, G.alive().length);
      const cards = G.peekTop(n);
      if (!cards.length) return;
      const ans = await G.request(p.seat, {
        kind: 'guanxing', style: 'guanxing',
        prompt: `【观星】观看牌堆顶 ${cards.length} 张牌，选择置于牌堆顶的牌（其余置于牌堆底）`,
        cards: cards.map(cardView), min: 0, max: cards.length, optional: true,
      });
      if (!ans) return;
      const top = ans.top || [];
      const bottom = cards.filter((c) => !top.includes(c.uid)).map((c) => c.uid);
      G.applyGuanxing(top, bottom);
      G.log(`${p.name} 发动【观星】，将 ${top.length} 张牌置于牌堆顶`);
    },
  },

  jizhi: {
    usedScroll: async (G, p) => {
      if (G.over || p.dead) return;
      const go = await G.askYesNo(p.seat, '是否发动【集智】摸一张牌？',
        { yesLabel: '摸一张牌', noLabel: '不发动', purpose: 'jizhi' });
      if (!go) return;
      G.drawCards(p, 1);
      G.log(`${p.name} 发动【集智】，摸一张牌`);
    },
  },

  qicai: {},

  /* ==================== 魏 ==================== */
  jianxiong: {
    damaged: async (G, p, { card, source }) => {
      // 无来源伤害（闪电等）不能发动；已进入弃牌堆或已被他人持有的牌不能再被获得
      if (!source || source.dead) return;
      if (!G.inLimbo(card)) return;   // 已进入弃牌堆或已被他人持有的牌不能再获得
      const go = await G.askYesNo(p.seat, `是否发动【奸雄】获得造成此伤害的【${CARD_META[card.name].cn}】？`);
      if (!go) return;
      p.hand.push(card);
      G.log(`${p.name} 发动【奸雄】，获得【${CARD_META[card.name].cn}】`);
    },
  },

  fankui: {
    damaged: async (G, p, { source }) => {
      if (!source || source === p || source.dead) return;
      const choices = [];
      if (source.hand.length) choices.push({ id: 'random', label: `随机手牌（${source.hand.length} 张）` });
      choices.push(...equipChoices(source));
      for (const j of source.judge) choices.push({ id: `jd:${j.uid}`, label: `判定·${CARD_META[j.__as || j.name].cn}`, card: cardView(j) });
      if (!choices.length) return;
      const go = await G.askYesNo(p.seat, `是否发动【反馈】获得 ${source.name} 的一张牌？`);
      if (!go) return;
      const ids = await G.choose(p.seat, {
        prompt: `【反馈】选择要获得的 ${source.name} 的一张牌`, style: 'mixed',
        choices, min: 1, max: 1, purpose: 'fankui',
      });
      const id = ids && ids[0];
      if (!id) return;
      let card = null;
      if (id === 'random') {
        card = source.hand.splice(Math.floor(Math.random() * source.hand.length), 1)[0];
        await G.trigger('cardLose', source, { cards: [card] });
      } else if (id.startsWith('eq:')) {
        card = await G.loseEquip(source, id.slice(3), { discard: false });
      } else if (id.startsWith('jd:')) {
        const j = source.judge.find((c) => c.uid === id.slice(3));
        if (j) {
          source.judge.splice(source.judge.indexOf(j), 1);
          card = j;
          await G.trigger('cardLose', source, { cards: [card] });
        }
      }
      if (!card) return;
      p.hand.push(card);
      G.log(`${p.name} 发动【反馈】，获得 ${source.name} 的【${CARD_META[card.name].cn}】`);
    },
  },

  guicai: {}, // 由引擎 askJudgeModify 实现

  ganglie: {
    damaged: async (G, p, { source }) => {
      if (!source || source === p || source.dead) return;
      const go = await G.askYesNo(p.seat, `是否发动【刚烈】对 ${source.name} 进行判定？`);
      if (!go) return;
      const jc = await G.judgeCard(p, '刚烈');
      if (jc.suit === 'heart') {
        G.log('【刚烈】判定为红桃，技能失效');
        return;
      }
      const choices = [];
      if (source.hand.length >= 2) choices.push({ id: 'discard', label: '弃置两张手牌' });
      choices.push({ id: 'damage', label: '受到1点伤害' });
      const ids = await G.choose(source.seat, {
        prompt: `【刚烈】判定不为红桃，请选择：`, style: 'options',
        choices, min: 1, max: 1, purpose: 'ganglie',
      });
      const pick = ids && ids[0];
      if (pick === 'discard' && source.hand.length >= 2) {
        const cs = await G.choose(source.seat, {
          prompt: '选择两张手牌弃置', style: 'cards', min: 2, max: 2,
          choices: handChoices(source), purpose: 'discard',
        });
        if (cs && cs.length >= 2) {
          const two = cs.slice(0, 2).map((u) => source.hand.find((c) => c.uid === u)).filter(Boolean);
          await G.discardFromHand(source, two);
          G.log(`${source.name} 弃置两张手牌`);
        }
      } else {
        await G.applyDamage({ source: p, target: source, amount: 1, card: null, reason: '刚烈' });
      }
    },
  },

  tiandu: {
    judgeDone: async (G, p, { card }) => {
      if (!card || G.over || p.dead) return;
      const go = await G.askYesNo(p.seat, `是否发动【天妒】获得判定牌 ${cardText(card)}？`,
        { yesLabel: '获得此牌', noLabel: '不发动', purpose: 'tiandu' });
      if (!go) return;
      p.hand.push(card);
      G.judgeCardTaken = true;
      G.log(`${p.name} 发动【天妒】，获得判定牌 ${cardText(card)}`);
    },
  },

  yiji: {
    damaged: async (G, p) => {
      const go = await G.askYesNo(p.seat, '是否发动【遗计】摸两张牌？');
      if (!go) return;
      G.drawCards(p, 2);
      G.log(`${p.name} 发动【遗计】，摸两张牌`);
      const cands = G.alive().filter((x) => x !== p).map((x) => x.seat);
      if (!cands.length || !p.hand.length) return;
      const ids = await G.choose(p.seat, {
        prompt: '【遗计】可选择至多两张手牌交给其他角色（不选则结束）', style: 'cards',
        choices: handChoices(p), min: 0, max: Math.min(2, p.hand.length), optional: true, purpose: 'yijiCards',
      });
      if (!ids || !ids.length) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【遗计】选择获得牌的角色', purpose: 'allyTarget',
        candidates: cands, optional: true,
      });
      if (seat === null) return;
      const cards = ids.map((u) => p.hand.find((c) => c.uid === u)).filter(Boolean);
      await G.takeFromHand(p, cards);
      for (const c of cards) G.players[seat].hand.push(c);
      G.log(`${p.name} 将 ${cards.length} 张牌交给 ${G.players[seat].name}`);
    },
  },

  luoyi: {}, // 由引擎 drawPhase 实现

  luoshen: {
    turnBegin: async (G, p) => {
      const go = await G.askYesNo(p.seat, '是否发动【洛神】？');
      if (!go) return;
      p.__luoshen = true;
      let count = 0;
      for (let i = 0; i < 30; i++) {
        if (G.over || p.dead) break;
        const jc = await G.judgeCard(p, '洛神');
        if (isBlack(jc)) {
          count++;
        } else {
          G.log('【洛神】判定为红色，停止');
          break;
        }
      }
      p.__luoshen = false;
      G.log(`${p.name} 发动【洛神】，获得 ${count} 张黑色判定牌`);
    },
    judgeDone: (G, p, { card }) => {
      if (p.__luoshen && isBlack(card)) {
        p.hand.push(card);
        G.judgeCardTaken = true;
      }
    },
  },

  qingguo: {
    convert: (G, p, card, ctx) => (ctx === 'jink' && isBlack(card) ? ['jink'] : []),
  },

  /* ==================== 吴 ==================== */
  zhiheng: {
    oncePerTurn: true,
    active: async (G, p) => {
      const choices = allChoices(p);
      if (!choices.length) return;
      const ids = await G.choose(p.seat, {
        prompt: '【制衡】选择要弃置的牌', style: 'mixed',
        choices, min: 1, max: choices.length, optional: true, purpose: 'zhiheng',
      });
      if (!ids || !ids.length) return;
      let n = 0;
      const handCards = [];
      for (const id of ids) {
        if (id.startsWith('eq:')) {
          if (await G.loseEquip(p, id.slice(3))) n++;
        } else {
          const c = p.hand.find((x) => x.uid === id);
          if (c) handCards.push(c);
        }
      }
      if (handCards.length) {
        G.removeFromHand(p, handCards);
        for (const c of handCards) G.discardCard(c);
        n += handCards.length;
      }
      if (!n) return;
      await G.trigger('cardLose', p, { cards: handCards });
      G.drawCards(p, n);
      G.log(`${p.name} 发动【制衡】，弃置 ${n} 张牌并摸 ${n} 张牌`);
    },
  },

  yingzi: { modifyDraw: () => 1 },

  fanjian: {
    oncePerTurn: true,
    active: async (G, p) => {
      if (!p.hand.length) return;
      const cands = G.alive().filter((x) => x !== p).map((x) => x.seat);
      if (!cands.length) return;
      const ids = await G.choose(p.seat, {
        prompt: '【反间】选择一张手牌暗置', style: 'cards',
        choices: handChoices(p), min: 1, max: 1, optional: true, purpose: 'fanjian',
      });
      if (!ids || !ids.length) return;
      const card = p.hand.find((c) => c.uid === ids[0]);
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【反间】选择一名角色猜测花色', purpose: 'enemyTarget',
        candidates: cands, optional: true,
      });
      if (seat === null || !card) return;
      await G.takeFromHand(p, [card]);
      const target = G.players[seat];
      G.log(`${p.name} 对 ${target.name} 使用【反间】，暗置一张手牌`);
      const gs = await G.choose(seat, {
        prompt: `猜测 ${p.name} 暗置牌的花色`, style: 'suits',
        choices: SUITS, min: 1, max: 1, purpose: 'guessSuit',
      });
      const guess = gs && gs[0];
      G.log(`${target.name} 猜测「${(SUITS.find((s) => s.id === guess) || {}).label || '未选择'}」，实际为 ${cardText(card)}`);
      if (guess && guess !== card.suit) {
        G.log('猜错了！');
        await G.applyDamage({ source: p, target, amount: 1, card: null, reason: '反间' });
      } else {
        G.log('猜对了！');
      }
      target.hand.push(card);
      G.log(`${target.name} 获得该牌`);
    },
  },

  kurou: {
    canUse: (G, p) => p.hp > 1,
    active: async (G, p) => {
      await G.loseHp(p, 1);
      if (!p.dead) {
        G.drawCards(p, 2);
        G.log(`${p.name} 发动【苦肉】，失去1点体力并摸两张牌`);
      }
    },
  },

  keji: {},

  lianying: {
    cardLose: async (G, p, { fromEquip }) => {
      if (fromEquip) return;
      if (p.dead || G.over) return;
      if (p.hand.length === 0) {
        // 技能描述为「可以摸一张牌」，因此是否发动交由玩家自己决定
        const go = await G.askYesNo(p.seat, '你失去了最后一张手牌，是否发动【连营】摸一张牌？',
          { yesLabel: '摸一张牌', noLabel: '不发动', purpose: 'lianying' });
        if (!go) return;
        G.drawCards(p, 1);
        G.log(`${p.name} 发动【连营】，摸一张牌`);
      }
    },
  },

  xiaoji: {
    cardLose: async (G, p, { fromEquip }) => {
      if (!fromEquip || p.dead || G.over) return;
      const go = await G.askYesNo(p.seat, '是否发动【枭姬】摸两张牌？',
        { yesLabel: '摸两张牌', noLabel: '不发动', purpose: 'xiaoji' });
      if (!go) return;
      G.drawCards(p, 2);
      G.log(`${p.name} 发动【枭姬】，摸两张牌`);
    },
  },

  jieyin: {
    oncePerTurn: true,
    canUse: (G, p) => p.hand.length >= 2 && G.alive().some((x) => x !== p && x.hero.gender === 'm' && x.hp < x.maxHp),
    active: async (G, p) => {
      const cands = G.alive().filter((x) => x !== p && x.hero.gender === 'm' && x.hp < x.maxHp);
      if (cands.length === 0 || p.hand.length < 2) return;
      const ids = await G.choose(p.seat, {
        prompt: '【结姻】选择两张手牌弃置', style: 'cards',
        choices: handChoices(p), min: 2, max: 2, optional: true, purpose: 'jieyin',
      });
      if (!ids || ids.length < 2) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【结姻】选择一名已受伤的男性角色', purpose: 'allyTarget',
        candidates: cands.map((x) => x.seat), optional: true,
      });
      if (seat === null) return;
      const two = ids.slice(0, 2).map((u) => p.hand.find((c) => c.uid === u)).filter(Boolean);
      G.removeFromHand(p, two);
      for (const c of two) G.discardCard(c);
      G.log(`${p.name} 发动【结姻】，与 ${G.players[seat].name} 各回复1点体力`);
      G.heal(p, 1);
      G.heal(G.players[seat], 1);
      await G.trigger('cardLose', p, { cards: two });
    },
  },

  /* ==================== 群 ==================== */
  lijian: {
    oncePerTurn: true,
    canUse: (G) => G.alive().filter((x) => x.hero.gender === 'm').length >= 2,
    active: async (G, p) => {
      const males = G.alive().filter((x) => x.hero.gender === 'm');
      if (males.length < 2) return;
      const s1 = await G.choosePlayer(p.seat, {
        prompt: '【离间】选择一名男性角色', purpose: 'enemyTarget',
        candidates: males.map((x) => x.seat), optional: true,
      });
      if (s1 === null) return;
      const rest = males.filter((x) => x.seat !== s1);
      const s2 = await G.choosePlayer(p.seat, {
        prompt: `【离间】选择 ${G.players[s1].name} 决斗的对象（后者先出杀）`, purpose: 'lijianTarget',
        candidates: rest.map((x) => x.seat), optional: true,
      });
      if (s2 === null) return;
      G.log(`${p.name} 发动【离间】，${G.players[s1].name} 与 ${G.players[s2].name} 进行决斗`);
      await G.duel(G.players[s1], G.players[s2]);
    },
  },

  biyue: {
    turnEnd: async (G, p) => {
      if (G.over || p.dead) return;
      const go = await G.askYesNo(p.seat, '是否发动【闭月】摸一张牌？',
        { yesLabel: '摸一张牌', noLabel: '不发动', purpose: 'biyue' });
      if (!go) return;
      G.drawCards(p, 1);
      G.log(`${p.name} 发动【闭月】，摸一张牌`);
    },
  },

  wushuang: {},

  jijiu: {
    convert: (G, p, card, ctx) => {
      if (ctx === 'peach' && isRed(card) && G.currentSeat !== p.seat) return ['peach'];
      return [];
    },
  },

  qingnang: {
    oncePerTurn: true,
    canUse: (G, p) => p.hand.length >= 1 && G.alive().some((x) => x.hp < x.maxHp),
    active: async (G, p) => {
      const cands = G.alive().filter((x) => x.hp < x.maxHp);
      if (!cands.length || !p.hand.length) return;
      const ids = await G.choose(p.seat, {
        prompt: '【青囊】选择一张手牌弃置', style: 'cards',
        choices: handChoices(p), min: 1, max: 1, optional: true, purpose: 'qingnang',
      });
      if (!ids || !ids.length) return;
      const card = p.hand.find((c) => c.uid === ids[0]);
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【青囊】选择回复1点体力的角色', purpose: 'healTarget',
        candidates: cands.map((x) => x.seat), optional: true,
      });
      if (seat === null || !card) return;
      G.removeFromHand(p, [card]);
      G.discardCard(card);
      G.log(`${p.name} 发动【青囊】，令 ${G.players[seat].name} 回复1点体力`);
      G.heal(G.players[seat], 1);
      await G.trigger('cardLose', p, { cards: [card] });
    },
  },
};

function healOnce(G, p) {
  if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 1);
}

/* ==================== 新增武将技能 ==================== */
Object.assign(SKILLS, {
  /* ---------- 蜀 ---------- */
  liegong: {}, // 由引擎 useSlash 实现

  mashu: { modifyDistance: () => -1 },

  kuangu: {
    dealtDamage: async (G, p, { target }) => {
      if (!target || p.dead || p.hp >= p.maxHp) return;
      if (G.distance(p, target) > 1) return;
      G.heal(p, 1);
      G.log(`${p.name} 发动【狂骨】，回复1点体力`);
    },
  },

  tiaoxin: {
    oncePerTurn: true,
    canUse: (G, p) => G.alive().some((x) => x !== p),
    active: async (G, p) => {
      const cands = G.alive().filter((x) => x !== p);
      if (!cands.length) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【挑衅】选择一名其他角色', purpose: 'enemyTarget',
        candidates: cands.map((x) => x.seat), optional: true,
      });
      if (seat === null) return;
      const t = G.players[seat];
      G.log(`${p.name} 对 ${t.name} 发动【挑衅】`);
      const res = await G.askCard(t.seat, 'slash', {
        reason: 'tiaoxin', purpose: 'tiaoxin', initiator: p.seat, target: p.seat,
        prompt: `【挑衅】是否对 ${p.name} 使用一张【杀】？`,
      });
      if (res) {
        G.log(`${t.name} 使用了一张【杀】`);
        return;
      }
      G.log(`${t.name} 未使用【杀】，${p.name} 弃置其一张牌`);
      await dumpOne(G, p, t, 'fankui');
    },
  },

  huoji: { convert: (G, p, card, ctx) => (ctx === 'play' && isRed(card) ? ['huogong'] : []) },

  kanpo: { convert: (G, p, card, ctx) => (ctx === 'wuxie' && isBlack(card) ? ['wuxie'] : []) },

  bazhen: {},  // 由引擎 cardOptions 实现
  juxiang: {}, // 由引擎 playCard（南蛮入侵）实现
  huoshou: {}, // 由引擎 playCard（南蛮入侵）实现

  lieren: {
    dealtDamage: async (G, p, { target }) => {
      if (!target || target.dead || !target.hand.length || !p.hand.length) return;
      const go = await G.askYesNo(p.seat, `是否发动【烈刃】与 ${target.name} 拼点？`, { purpose: 'lieren' });
      if (!go) return;
      const r = await G.pinDian(p, target);
      if (r <= 0) {
        G.log('【烈刃】拼点未获胜，技能失效');
        return;
      }
      // 拼点本身会弃掉双方的牌，必须重新确认对方还有手牌
      if (!target.hand.length) {
        G.log('【烈刃】拼点后对方已无手牌');
        return;
      }
      const c = target.hand.splice(Math.floor(Math.random() * target.hand.length), 1)[0];
      if (!c) return;
      await G.trigger('cardLose', target, { cards: [c] });
      p.hand.push(c);
      G.log(`${p.name} 发动【烈刃】，获得 ${target.name} 的一张手牌`);
    },
  },

  zaiqi: {
    insteadDraw: async (G, p) => {
      if (p.hp >= p.maxHp) return false;
      const go = await G.askYesNo(p.seat, '是否发动【再起】？放弃摸牌，改为回复1点体力',
        { yesLabel: '回复体力', noLabel: '正常摸牌', purpose: 'zaiqi' });
      if (!go) return false;
      G.heal(p, 1);
      G.log(`${p.name} 发动【再起】，放弃摸牌并回复1点体力`);
      return true;
    },
  },

  ziyuan: {
    oncePerTurn: true,
    canUse: (G, p) => p.hand.length >= 1 && G.alive().some((x) => x !== p),
    active: async (G, p) => {
      const ids = await G.choose(p.seat, {
        prompt: '【资援】选择要交给其他角色的手牌', style: 'cards',
        choices: handChoices(p), min: 1, max: p.hand.length, optional: true, purpose: 'rende',
      });
      if (!ids || !ids.length) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【资援】选择获得牌的角色', purpose: 'allyTarget',
        candidates: G.alive().filter((x) => x !== p).map((x) => x.seat), optional: true,
      });
      if (seat === null) return;
      const cards = ids.map((u) => p.hand.find((c) => c.uid === u)).filter(Boolean);
      await G.takeFromHand(p, cards);
      for (const c of cards) G.players[seat].hand.push(c);
      G.log(`${p.name} 发动【资援】，将 ${cards.length} 张牌交给 ${G.players[seat].name}`);
      G.drawCards(p, cards.length);
    },
  },

  qiaoshui: {
    oncePerTurn: true,
    canUse: (G, p) => p.hand.length > 0 && G.alive().some((x) => x !== p && x.hand.length),
    active: async (G, p) => {
      const cands = G.alive().filter((x) => x !== p && x.hand.length);
      if (!cands.length) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【巧说】选择拼点的角色', purpose: 'enemyTarget',
        candidates: cands.map((x) => x.seat), optional: true,
      });
      if (seat === null) return;
      const r = await G.pinDian(p, G.players[seat]);
      if (r > 0) {
        p.turnFlags.tianyi = true;
        p.turnFlags.noRangeLimit = true;
        G.log(`${p.name} 发动【巧说】拼点获胜，本回合【杀】无次数限制且无距离限制`);
      } else {
        p.turnFlags.noSlash = true;
        G.log(`${p.name} 发动【巧说】拼点未获胜，本回合不能使用【杀】`);
      }
    },
  },

  /* ---------- 魏 ---------- */
  tuxi: {
    insteadDraw: async (G, p) => {
      const cands = G.alive().filter((x) => x !== p && x.hand.length);
      if (!cands.length) return false;
      const go = await G.askYesNo(p.seat, '是否发动【突袭】？放弃摸牌，改为获得至多两名角色各一张手牌',
        { yesLabel: '突袭', noLabel: '正常摸牌', purpose: 'tuxi' });
      if (!go) return false;
      const ids = await G.choose(p.seat, {
        prompt: '【突袭】选择至多两名角色', style: 'players', min: 1, max: Math.min(2, cands.length),
        choices: cands.map((x) => ({ id: String(x.seat), label: `${x.name}（${x.hand.length} 张手牌）`, seat: x.seat })),
        purpose: 'tuxiTarget',
      });
      if (!ids || !ids.length) return false;
      let n = 0;
      for (const id of ids) {
        const t = G.players[Number(id)];
        if (!t || !t.hand.length) continue;
        const c = t.hand.splice(Math.floor(Math.random() * t.hand.length), 1)[0];
        if (!c) continue;
        await G.trigger('cardLose', t, { cards: [c] });
        p.hand.push(c);
        n++;
        G.log(`${p.name} 突袭获得 ${t.name} 的一张手牌`);
      }
      return n > 0;
    },
  },

  qiangxi: {
    oncePerTurn: true,
    canUse: (G, p) => (p.hp > 1 || !!p.equip.weapon)
      && G.alive().some((x) => x !== p && G.attackRange(p) >= G.distance(p, x)),
    active: async (G, p) => {
      const opts = [];
      if (p.hp > 1) opts.push({ id: 'hp', label: '失去1点体力' });
      if (p.equip.weapon) opts.push({ id: 'weapon', label: `弃置武器【${CARD_META[p.equip.weapon.name].cn}】` });
      if (!opts.length) return;
      const mode = await G.choose(p.seat, {
        prompt: '【强袭】选择发动方式', choices: opts, min: 1, max: 1, purpose: 'qiangxiMode',
      });
      if (!mode || !mode.length) return;
      const cands = G.alive().filter((x) => x !== p && G.attackRange(p) >= G.distance(p, x)).map((x) => x.seat);
      if (!cands.length) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【强袭】选择受到伤害的角色', purpose: 'enemyTarget', candidates: cands, optional: true,
      });
      if (seat === null) return;
      if (mode[0] === 'weapon') await G.loseEquip(p, 'weapon');
      else await G.loseHp(p, 1);
      if (p.dead) return;
      G.log(`${p.name} 发动【强袭】，对 ${G.players[seat].name} 造成1点伤害`);
      await G.applyDamage({ source: p, target: G.players[seat], amount: 1, card: null, reason: '强袭' });
    },
  },

  duanliang: { convert: (G, p, card, ctx) => (ctx === 'play' && isBlack(card) ? ['bingliang'] : []) },

  yizhong: {}, // 由引擎 askJink 实现

  shensu: {
    insteadDraw: async (G, p) => {
      const cands = G.alive().filter((x) => x !== p);
      if (!cands.length) return false;
      const go = await G.askYesNo(p.seat, '是否发动【神速】？跳过摸牌，视为对一名其他角色使用一张【杀】',
        { yesLabel: '神速', noLabel: '正常摸牌', purpose: 'shensu' });
      if (!go) return false;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【神速】选择【杀】的目标', purpose: 'enemyTarget',
        candidates: cands.map((x) => x.seat), optional: true,
      });
      if (seat === null) return false;
      G.log(`${p.name} 发动【神速】，视为对 ${G.players[seat].name} 使用一张【杀】`);
      await G.useSlash(p, [G.players[seat]], null, { free: true });
      return true;
    },
  },

  mengjin: {
    slashDodged: async (G, p, { target }) => {
      if (!target || target.dead || G.over) return;
      const go = await G.askYesNo(p.seat, `是否发动【猛进】弃置 ${target.name} 的一张牌？`, { purpose: 'mengjin' });
      if (!go) return;
      await dumpOne(G, p, target, 'fankui');
    },
  },

  luoying: {
    onDiscard: async (G, p, { cards, fromSeat }) => {
      if (fromSeat === p.seat || p.dead) return;
      for (const c of cards || []) {
        if (G.over || p.dead) return;
        if (c.suit !== 'club') continue;
        const got = G.takeFromDiscard(c);
        if (!got) continue;
        const go = await G.askYesNo(p.seat, `是否发动【落英】获得弃置的【${CARD_META[c.name].cn}】${cardText(c)}？`, { purpose: 'luoying' });
        if (!go) {
          G.discardCard(got); // 放弃则放回弃牌堆
          continue;
        }
        p.hand.push(got);
        G.log(`${p.name} 发动【落英】，获得 ${cardText(c)}`);
      }
    },
  },

  quhu: {
    oncePerTurn: true,
    canUse: (G, p) => G.alive().some((x) => x !== p && x.hp > p.hp && x.hand.length),
    active: async (G, p) => {
      const cands = G.alive().filter((x) => x !== p && x.hp > p.hp && x.hand.length);
      if (!cands.length) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【驱虎】选择一名体力值大于你的角色拼点', purpose: 'quhuTarget',
        candidates: cands.map((x) => x.seat), optional: true,
      });
      if (seat === null) return;
      const t = G.players[seat];
      G.log(`${p.name} 对 ${t.name} 发动【驱虎】`);
      const r = await G.pinDian(p, t);
      if (r > 0) {
        const vics = G.alive().filter((x) => x !== t && G.attackRange(t) >= G.distance(t, x)).map((x) => x.seat);
        if (!vics.length) {
          G.log('【驱虎】拼点获胜，但其攻击范围内没有可指定的角色');
          return;
        }
        const v = await G.choosePlayer(p.seat, {
          prompt: `【驱虎】选择 ${t.name} 攻击的目标`, purpose: 'quhuVictim', candidates: vics, optional: true,
        });
        if (v === null) return;
        G.log(`【驱虎】${t.name} 对 ${G.players[v].name} 造成1点伤害`);
        await G.applyDamage({ source: t, target: G.players[v], amount: 1, card: null, reason: '驱虎' });
      } else {
        G.log(`【驱虎】拼点未获胜，${t.name} 对 ${p.name} 造成1点伤害`);
        await G.applyDamage({ source: t, target: p, amount: 1, card: null, reason: '驱虎' });
      }
    },
  },

  jushou: {
    turnEnd: async (G, p) => {
      const go = await G.askYesNo(p.seat, '是否发动【据守】？摸三张牌，然后跳过下一个回合的摸牌阶段',
        { yesLabel: '据守', noLabel: '不发动', purpose: 'jushou' });
      if (!go) return;
      G.drawCards(p, 3);
      p.__skipNextDraw = true;
      G.log(`${p.name} 发动【据守】，摸三张牌`);
    },
  },

  /* ---------- 吴 ---------- */
  qixi: { convert: (G, p, card, ctx) => (ctx === 'play' && isBlack(card) ? ['dismantle'] : []) },

  guose: { convert: (G, p, card, ctx) => (ctx === 'play' && card.suit === 'diamond' ? ['lebu'] : []) },

  tianyi: {
    oncePerTurn: true,
    canUse: (G, p) => p.hand.length > 0 && G.alive().some((x) => x !== p && x.hand.length),
    active: async (G, p) => {
      const cands = G.alive().filter((x) => x !== p && x.hand.length);
      if (!cands.length) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【天义】选择拼点的角色', purpose: 'enemyTarget',
        candidates: cands.map((x) => x.seat), optional: true,
      });
      if (seat === null) return;
      const r = await G.pinDian(p, G.players[seat]);
      if (r > 0) {
        p.turnFlags.tianyi = true;
        G.log(`${p.name} 发动【天义】拼点获胜，本回合【杀】无次数限制且可额外指定一个目标`);
      } else {
        p.turnFlags.noSlash = true;
        G.log(`${p.name} 发动【天义】拼点未获胜，本回合不能使用【杀】`);
      }
    },
  },

  yinghun: {
    turnBegin: async (G, p) => {
      const lost = p.maxHp - p.hp;
      if (lost <= 0) return;
      const cands = G.alive().filter((x) => x !== p).map((x) => x.seat);
      if (!cands.length) return;
      const go = await G.askYesNo(p.seat, `是否发动【英魂】？令一名其他角色摸 ${lost} 张牌，然后其弃置一张牌`,
        { purpose: 'yinghun' });
      if (!go) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【英魂】选择一名其他角色', purpose: 'allyTarget', candidates: cands, optional: true,
      });
      if (seat === null) return;
      const t = G.players[seat];
      G.drawCards(t, lost);
      G.log(`${p.name} 发动【英魂】，${t.name} 摸 ${lost} 张牌`);
      if (!t.hand.length) return;
      const ids = await G.choose(t.seat, {
        prompt: '【英魂】弃置一张手牌', style: 'cards', choices: handChoices(t), min: 1, max: 1, purpose: 'discard',
      });
      if (ids && ids.length) await G.discardFromHand(t, [t.hand.find((c) => c.uid === ids[0])]);
    },
  },

  tianxiang: {
    beforeDamage: async (G, p, { source, amount }) => {
      if (p.dead || G.__tianxiangBusy) return false;
      const hearts = p.hand.filter((c) => c.suit === 'heart');
      const cands = G.alive().filter((x) => x !== p);
      if (!hearts.length || !cands.length) return false;
      const go = await G.askYesNo(p.seat, `是否发动【天香】？弃置一张红桃手牌，将 ${amount} 点伤害转移给其他角色`,
        { purpose: 'tianxiang' });
      if (!go) return false;
      const ids = await G.choose(p.seat, {
        prompt: '【天香】选择要弃置的红桃手牌', style: 'cards', min: 1, max: 1, purpose: 'tianxiangCard',
        choices: hearts.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) })),
      });
      if (!ids || !ids.length) return false;
      const card = p.hand.find((c) => c.uid === ids[0]);
      if (!card) return false;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【天香】选择承担伤害的角色', purpose: 'allyTarget',
        candidates: cands.map((x) => x.seat), optional: true,
      });
      if (seat === null) return false;
      await G.discardFromHand(p, [card]);
      const t = G.players[seat];
      G.log(`${p.name} 发动【天香】，将 ${amount} 点伤害转移给 ${t.name}`);
      G.__tianxiangBusy = true;
      await G.applyDamage({ source, target: t, amount, card: null, reason: '天香' });
      G.__tianxiangBusy = false;
      if (!t.dead) G.drawCards(t, amount);
      return true;
    },
  },

  /* ---------- 群 ---------- */
  leiji: {
    responded: async (G, p, { kind }) => {
      if (kind !== 'jink' || p.dead || G.over) return;
      const cands = G.alive().filter((x) => x !== p).map((x) => x.seat);
      if (!cands.length) return;
      const go = await G.askYesNo(p.seat, '是否发动【雷击】？令一名其他角色判定，若为黑桃其受到2点雷电伤害',
        { purpose: 'leiji' });
      if (!go) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【雷击】选择判定的角色', purpose: 'enemyTarget', candidates: cands, optional: true,
      });
      if (seat === null) return;
      const t = G.players[seat];
      const jc = await G.judgeCard(t, '雷击');
      if (jc.suit === 'spade') {
        G.log('【雷击】判定为黑桃，造成2点雷电伤害');
        await G.applyDamage({ source: p, target: t, amount: 2, card: null, reason: '雷击', element: 'thunder' });
      } else {
        G.log('【雷击】判定不为黑桃，技能失效');
      }
    },
  },

  guidao: {}, // 由引擎 askJudgeModify 实现

  yicong: { modifyDistance: (G, p) => (p.hp >= 3 ? -1 : 1) },

  weimu: {}, // 由引擎 canBeTarget 实现
  wansha: {}, // 由引擎 resolveDying 实现

  xianzhen: {
    oncePerTurn: true,
    canUse: (G, p) => p.hand.length > 0 && G.alive().some((x) => x !== p && x.hand.length),
    active: async (G, p) => {
      const cands = G.alive().filter((x) => x !== p && x.hand.length);
      if (!cands.length) return;
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【陷阵】选择拼点的角色', purpose: 'enemyTarget',
        candidates: cands.map((x) => x.seat), optional: true,
      });
      if (seat === null) return;
      const r = await G.pinDian(p, G.players[seat]);
      if (r > 0) {
        p.turnFlags.xianzhenSeat = seat;
        G.log(`${p.name} 发动【陷阵】拼点获胜，本回合对 ${G.players[seat].name} 的【杀】无距离限制且无视其防具`);
      } else {
        p.turnFlags.noSlash = true;
        G.log(`${p.name} 发动【陷阵】拼点未获胜，本回合不能使用【杀】`);
      }
    },
  },

  yaowu: {
    damaged: async (G, p, { source, card }) => {
      if (!source || source === p || source.dead) return;
      if (!card || !isSlashCard(card.name)) return;
      if (isRed(card)) {
        G.heal(source, 1);
        G.log(`【耀武】生效，${source.name} 回复1点体力`);
      } else {
        G.drawCards(source, 1);
        G.log(`【耀武】生效，${source.name} 摸一张牌`);
      }
    },
  },

  jiuchi: { convert: (G, p, card, ctx) => (ctx === 'play' && isBlack(card) ? ['wine'] : []) },

  benghuai: {
    turnEnd: async (G, p) => {
      const alive = G.alive();
      if (alive.length < 2) return;
      const min = Math.min(...alive.map((x) => x.hp));
      if (p.hp === min) {
        if (p.hp < p.maxHp) {
          G.heal(p, 1);
          G.log(`${p.name} 因【崩坏】体力最低，回复1点体力`);
        }
      } else {
        G.log(`${p.name} 因【崩坏】失去1点体力`);
        await G.loseHp(p, 1);
      }
    },
  },

  mingce: {
    oncePerTurn: true,
    canUse: (G, p) => p.hand.some((c) => isSlashCard(c.name) || CARD_META[c.name].type === 'equip')
      && G.alive().some((x) => x !== p),
    active: async (G, p) => {
      const pool = p.hand.filter((c) => isSlashCard(c.name) || CARD_META[c.name].type === 'equip');
      if (!pool.length) return;
      const ids = await G.choose(p.seat, {
        prompt: '【明策】选择一张【杀】或装备牌', style: 'cards', min: 1, max: 1, optional: true, purpose: 'mingce',
        choices: pool.map((c) => ({ id: c.uid, label: cardText(c), card: cardView(c) })),
      });
      if (!ids || !ids.length) return;
      const card = p.hand.find((c) => c.uid === ids[0]);
      const seat = await G.choosePlayer(p.seat, {
        prompt: '【明策】选择获得牌的角色', purpose: 'allyTarget',
        candidates: G.alive().filter((x) => x !== p).map((x) => x.seat), optional: true,
      });
      if (seat === null || !card) return;
      const t = G.players[seat];
      await G.takeFromHand(p, [card]);
      t.hand.push(card);
      G.log(`${p.name} 发动【明策】，将 ${cardText(card)} 交给 ${t.name}`);
      const vics = G.alive().filter((x) => x !== t && G.attackRange(t) >= G.distance(t, x)).map((x) => x.seat);
      const ch = [];
      if (vics.length) ch.push({ id: 'slash', label: '对其攻击范围内一名角色造成1点伤害' });
      ch.push({ id: 'draw', label: '摸一张牌' });
      const pick = await G.choose(t.seat, { prompt: '【明策】请选择', choices: ch, min: 1, max: 1, purpose: 'mingceChoice' });
      if (pick && pick[0] === 'slash' && vics.length) {
        const v = await G.choosePlayer(p.seat, {
          prompt: `【明策】选择 ${t.name} 攻击的目标`, purpose: 'enemyTarget', candidates: vics, optional: true,
        });
        if (v !== null) {
          G.log(`【明策】${t.name} 对 ${G.players[v].name} 造成1点伤害`);
          await G.applyDamage({ source: t, target: G.players[v], amount: 1, card: null, reason: '明策' });
        }
      } else {
        G.drawCards(t, 1);
        G.log(`${t.name} 选择摸一张牌`);
      }
    },
  },
});

module.exports = { SKILLS, SUITS, handChoices, equipChoices, pickLowest, pickHighest };
