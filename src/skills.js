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
const { CARD_META, isRed, isBlack, cardText, cardView, slotOf } = require('./cards');
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
      if (!card || G.discardPile.indexOf(card) >= 0 || G.inPossession(card)) return;
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
      for (const j of source.judge) choices.push({ id: `jd:${j.uid}`, label: `判定·${CARD_META[j.name].cn}`, card: cardView(j) });
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
    judgeDone: (G, p, { card }) => {
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
      G.removeFromHand(p, cards);
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
      G.removeFromHand(p, [card]);
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
    cardLose: async (G, p, { cards, fromEquip }) => {
      if (fromEquip) return;
      if (p.dead) return;
      if (p.hand.length === 0) {
        G.drawCards(p, 1);
        G.log(`${p.name} 发动【连营】，摸一张牌`);
      }
    },
  },

  xiaoji: {
    cardLose: async (G, p, { fromEquip }) => {
      if (!fromEquip || p.dead) return;
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
        prompt: `【离间】选择 ${G.players[s1].name} 决斗的对象（后者先出杀）`, purpose: 'enemyTarget',
        candidates: rest.map((x) => x.seat), optional: true,
      });
      if (s2 === null) return;
      G.log(`${p.name} 发动【离间】，${G.players[s1].name} 与 ${G.players[s2].name} 进行决斗`);
      await G.duel(G.players[s1], G.players[s2]);
    },
  },

  biyue: {
    turnEnd: async (G, p) => {
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

module.exports = { SKILLS, SUITS, handChoices, equipChoices, pickLowest, pickHighest };
