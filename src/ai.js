/**
 * 人机（电脑）决策模块
 * 说明：AI 基于自身身份 + 场上行为记忆进行推理，产生与人类相同的操作/应答。
 */
const { CARD_META } = require('./cards');
const { SKILL_META } = require('./heroes');

/* ==================== 敌我判断 ==================== */
function enemyScore(G, p, other) {
  if (!other || other === p) return -999;
  const known = other.role;
  let s = 0;
  if (p.role === 'rebel') {
    if (known === 'lord') s += 10;
    else if (known === 'loyal') s += 8;
    else if (known === 'rebel') s -= 12;
    else if (known === 'rene') s += 1;
  } else if (p.role === 'loyal' || p.role === 'lord') {
    if (known === 'rebel') s += 10;
    else if (known === 'rene') s += 6;
    else if (known === 'lord') s -= 14;
    else if (known === 'loyal') s -= 10;
  } else if (p.role === 'rene') {
    const rebels = G.alive().filter((x) => x.role === 'rebel').length;
    const loyals = G.alive().filter((x) => x.role === 'loyal').length;
    if (known === 'rebel') s += 8;
    else if (known === 'loyal') s += rebels > 1 ? 2 : 8;
    else if (known === 'lord') s += (rebels === 0 && loyals <= 1) ? 10 : -12;
  }
  // 距离越近越优先
  s += Math.max(0, 4 - G.distance(p, other));
  // 残血优先收割
  s += (other.maxHp - other.hp) * 1.5;
  // 行为记忆
  const note = (p.aiNotes && p.aiNotes[other.seat]) || {};
  s += (note['dmg_' + p.seat] || 0) * 1.2;
  s += (note['dmg_' + G.lordSeat] || 0) * 0.8;
  return s;
}

const bestEnemy = (G, p, seats) => seats
  .map((s) => G.players[s])
  .filter(Boolean)
  .sort((a, b) => enemyScore(G, p, b) - enemyScore(G, p, a))[0];

const bestAlly = (G, p, seats) => seats
  .map((s) => G.players[s])
  .filter(Boolean)
  .sort((a, b) => (enemyScore(G, p, a) - enemyScore(G, p, b)) || ((b.maxHp - b.hp) - (a.maxHp - a.hp)))[0];

/* ==================== 主入口 ==================== */
function decide(G, p, req) {
  try {
    switch (req.kind) {
      case 'turn': return decideTurn(G, p, req);
      case 'respond': return decideRespond(G, p, req);
      case 'choose': return decideChoose(G, p, req);
      case 'guanxing': return decideGuanxing(G, p, req);
      default: return null;
    }
  } catch (e) {
    console.error('[AI决策异常]', e);
    return null;
  }
}

/* ==================== 出牌阶段 ==================== */
function toPlay(G, p, a, targets) {
  const t = targets || [];
  if (!a.cardId && (a.need || 1) >= 2) {
    const two = [...p.hand].sort((x, y) => G.cardValue(p, x) - G.cardValue(p, y)).slice(0, 2).map((c) => c.uid);
    return { type: 'card', as: a.as, cardId: null, targets: t, extraCards: two };
  }
  return { type: 'card', as: a.as, cardId: a.cardId, targets: t, extraCards: [] };
}

function wantSkill(G, p, sid) {
  const flags = p.turnFlags;
  switch (sid) {
    case 'zhiheng':
      return p.hand.length >= 3 && p.hand.some((c) => G.cardValue(p, c) <= 3);
    case 'kurou':
      return p.hp >= 3 && (p.hand.length < 3 || p.hand.filter((c) => c.name === 'slash').length >= 2);
    case 'rende': {
      if ((flags.aiRende || 0) >= 2) return false;
      if (!G.alive().some((x) => x !== p && enemyScore(G, p, x) < 0)) return false;
      if (p.hand.length >= 2 && p.hp < p.maxHp) { flags.aiRende = (flags.aiRende || 0) + 1; return true; }
      return false;
    }
    case 'fanjian':
      return p.hand.length >= 2 && G.alive().some((x) => x !== p && enemyScore(G, p, x) > 2);
    case 'lijian':
      return true;
    case 'jieyin':
      return p.hp < p.maxHp && p.hand.length >= 2;
    case 'qingnang':
      return p.hand.length >= 2 && G.alive().some((x) => x.hp < x.maxHp && enemyScore(G, p, x) < 0);
    default:
      return true;
  }
}

function wantEquip(G, p, name) {
  const sub = CARD_META[name].sub;
  if (sub === 'weapon') {
    const cur = p.equip.weapon;
    if (cur && cur.name === 'crossbow') return false;
    if (!cur) return true;
    return CARD_META[name].range > CARD_META[cur.name].range;
  }
  if (sub === 'armor') return !p.equip.armor;
  if (sub === 'horseMinus') return !p.equip.horseMinus;
  if (sub === 'horsePlus') return !p.equip.horsePlus && p.hp <= 3;
  return true;
}

function wantAoe(G, p, as) {
  const others = G.alive().filter((x) => x !== p);
  let good = 0;
  let bad = 0;
  let risky = 0;
  const need = as === 'invasion' ? 'slash' : 'jink';
  for (const o of others) {
    const s = enemyScore(G, p, o);
    if (s > 2) good++;
    else if (s < -2) {
      bad++;
      // 队友残血且很可能没有响应牌时，不轻易放群体锦囊
      const canAnswer = o.hand.some((c) => G.convertNames(o, c, need).includes(need));
      if (o.hp <= 1 && !canAnswer) risky += 2;
      else if (o.hp <= 2 && !canAnswer) risky += 1;
    }
  }
  if (risky >= 1) return false;
  return good >= 1 && good > bad;
}

function wantOrchard(G, p) {
  const wounded = G.alive().filter((x) => x.hp < x.maxHp);
  let good = 0;
  let bad = 0;
  for (const o of wounded) {
    const s = enemyScore(G, p, o);
    if (s > 2) bad++;
    else good++;
  }
  return good > bad;
}

function decideTurn(G, p, req) {
  const acts = req.actions || [];
  if (!acts.length) return { type: 'end' };
  const cardActs = acts.filter((a) => a.type === 'card');
  const skillActs = acts.filter((a) => a.type === 'skill');
  const find = (as) => cardActs.find((a) => a.as === as);

  // 濒危先回血
  if (p.hp <= 1) {
    const peach = find('peach');
    if (peach) return toPlay(G, p, peach, []);
  }

  // 主动技能
  for (const s of skillActs) {
    if (wantSkill(G, p, s.skill)) return { type: 'skill', skill: s.skill };
  }

  // 装备
  const eq = cardActs.find((a) => CARD_META[a.as].type === 'equip' && wantEquip(G, p, a.as));
  if (eq) return toPlay(G, p, eq, []);

  // 无中生有
  const abundance = find('abundance');
  if (abundance) return toPlay(G, p, abundance, []);

  const slashActs = cardActs.filter((a) => a.as === 'slash');
  const enemy = bestEnemy(G, p, G.alive().filter((x) => x !== p).map((x) => x.seat));

  // 酒（准备爆发）
  const wine = find('wine');
  if (wine && slashActs.length && enemy && slashActs.some((a) => a.targets.includes(enemy.seat)) && p.hp > 1) {
    return toPlay(G, p, wine, []);
  }

  // AOE
  const aoe = cardActs.find((a) => a.as === 'invasion' || a.as === 'arrows');
  if (aoe && wantAoe(G, p, aoe.as)) return toPlay(G, p, aoe, []);

  // 顺手牵羊 / 过河拆桥
  for (const as of ['snatch', 'dismantle']) {
    const a = find(as);
    if (!a) continue;
    const t = bestEnemy(G, p, a.targets);
    if (t && enemyScore(G, p, t) > 0) return toPlay(G, p, a, [t.seat]);
  }

  // 乐不思蜀
  const lebu = find('lebu');
  if (lebu) {
    const t = bestEnemy(G, p, lebu.targets);
    if (t && enemyScore(G, p, t) > 2) return toPlay(G, p, lebu, [t.seat]);
  }

  // 决斗 / 借刀杀人
  for (const as of ['duel', 'borrow']) {
    const a = find(as);
    if (!a) continue;
    const t = bestEnemy(G, p, a.targets);
    if (t && enemyScore(G, p, t) > 0) return toPlay(G, p, a, [t.seat]);
  }

  // 出杀
  if (slashActs.length) {
    const a = slashActs[0];
    const cands = a.targets.map((s) => G.players[s]).filter((t) => t && enemyScore(G, p, t) > 0);
    if (cands.length) {
      cands.sort((x, y) => enemyScore(G, p, y) - enemyScore(G, p, x));
      const n = Math.min(a.max || 1, cands.length);
      return toPlay(G, p, a, cands.slice(0, n).map((t) => t.seat));
    }
  }

  // 桃园结义 / 五谷丰登
  const orchard = find('orchard');
  if (orchard && wantOrchard(G, p)) return toPlay(G, p, orchard, []);
  const harvest = find('harvest');
  if (harvest && p.hand.length <= 3) return toPlay(G, p, harvest, []);

  // 回血
  const peach2 = find('peach');
  if (peach2 && p.hp < p.maxHp) return toPlay(G, p, peach2, []);

  // 闪电（只有反贼且自身较安全时才考虑）
  const lightning = find('lightning');
  if (lightning && p.role === 'rebel' && p.hp >= 3) return toPlay(G, p, lightning, []);

  return { type: 'end' };
}

/* ==================== 响应（杀/闪/桃/无懈） ==================== */
function shouldSave(G, p, dying) {
  if (p === dying) return true;
  const pr = p.role;
  const dr = dying.role;
  const spare = p.hand.length > 2;
  if (dr === 'lord') return pr === 'loyal' || pr === 'rene';
  if (pr === 'lord') return dr === 'loyal' && (spare || dying.hp < 0);
  if (pr === 'rebel') return dr === 'rebel' && spare;
  if (pr === 'loyal') return dr === 'loyal' && spare;
  if (pr === 'rene') return dr === 'lord' || (dr === 'loyal' && spare);
  return false;
}

function shouldWuxie(G, p, ctx) {
  const target = G.players[ctx.target];
  if (!ctx.cardName || !target) return false;
  const sc = target === p ? -100 : enemyScore(G, p, target);
  const benefit = ['abundance', 'harvest', 'orchard'].includes(ctx.cardName);
  if (benefit) return sc > 2 && p.hand.length > 1;
  if (sc < -1) return p.hand.length >= 1;
  return false;
}

function shouldPlayCard(G, p, as, ctx) {
  if (as === 'jink') return true;
  const reason = ctx.reason;
  if (reason === 'duel') {
    if (ctx.initiator === p.seat) return true;
    return p.hp > 1 || p.hand.length <= 2;
  }
  if (reason === 'invasion' || reason === 'arrows') return true;
  if (reason === 'borrow') {
    const t = G.players[ctx.target];
    if (!t) return false;
    if (enemyScore(G, p, t) > 0) return true;
    return !!(p.equip.weapon && G.cardValue(p, p.equip.weapon) >= 6);
  }
  if (reason === 'qinglong') {
    const t = G.players[ctx.target];
    return !!t && enemyScore(G, p, t) > 0;
  }
  if (ctx.skill && ctx.forSeat !== undefined && ctx.forSeat !== null) {
    const lord = G.players[ctx.forSeat];
    return !!lord && enemyScore(G, p, lord) < 0;
  }
  return true;
}

function decideRespond(G, p, req) {
  const as = req.as;
  const ctx = req.ctx || {};
  const choices = req.choices || [];

  if (as === 'peach') {
    const dying = G.players[ctx.target];
    if (!dying || !shouldSave(G, p, dying)) return null;
    const usable = choices.filter((c) => c.id !== 'bagua');
    if (!usable.length) return null;
    const pick = usable.slice().sort((a, b) => G.cardValue(p, a.card) - G.cardValue(p, b.card))[0];
    return { ids: [pick.id] };
  }

  if (as === 'wuxie') {
    if (!shouldWuxie(G, p, ctx)) return null;
    return { ids: [choices[0].id] };
  }

  const normal = choices.filter((c) => c.id !== 'bagua');
  const hasBagua = choices.some((c) => c.id === 'bagua');
  if (!normal.length && !hasBagua) return null;
  if (!shouldPlayCard(G, p, as, ctx)) return null;
  if (normal.length) {
    const pick = normal.slice().sort((a, b) => G.cardValue(p, a.card) - G.cardValue(p, b.card))[0];
    return { ids: [pick.id] };
  }
  return { ids: ['bagua'] };
}

/* ==================== 选择 ==================== */
function decideChoose(G, p, req) {
  const purpose = req.purpose || '';
  const ch = req.choices || [];
  if (!ch.length) return { ids: [] };
  const n = req.min || 1;
  const cards = ch.filter((c) => c.card);
  const lowFirst = cards.slice().sort((a, b) => G.cardValue(p, a.card) - G.cardValue(p, b.card));
  const highFirst = cards.slice().sort((a, b) => G.cardValue(p, b.card) - G.cardValue(p, a.card));

  switch (purpose) {
    case 'discard':
    case 'guanshi':
    case 'shuanggu':
      return { ids: lowFirst.slice(0, n).map((c) => c.id) };

    case 'zhiheng': {
      const junk = lowFirst.filter((c) => G.cardValue(p, c.card) <= 3);
      if (!junk.length) return { ids: [] };
      return { ids: junk.slice(0, Math.min(2, junk.length)).map((c) => c.id) };
    }

    case 'rende':
      return { ids: lowFirst.slice(0, Math.min(2, lowFirst.length)).map((c) => c.id) };

    case 'jieyin':
    case 'qingnang':
    case 'fanjian':
      return { ids: lowFirst.slice(0, n).map((c) => c.id) };

    case 'yijiCards':
      return { ids: lowFirst.slice(0, 2).map((c) => c.id) };

    case 'harvest':
      return { ids: highFirst.slice(0, 1).map((c) => c.id) };

    case 'fankui':
    case 'snatch':
    case 'dismantle': {
      for (const k of ['eq:weapon', 'eq:horseMinus', 'eq:horsePlus', 'eq:armor']) {
        const f = ch.find((c) => c.id === k);
        if (f) return { ids: [f.id] };
      }
      const jd = ch.find((c) => String(c.id).startsWith('jd:'));
      if (jd) return { ids: [jd.id] };
      const rnd = ch.find((c) => c.id === 'random');
      if (rnd) return { ids: [rnd.id] };
      return { ids: [ch[0].id] };
    }

    case 'guicai': {
      const tgt = G.players[req.judgeFor];
      if (!tgt) return { ids: [] };
      if (tgt !== p && enemyScore(G, p, tgt) > 0) return { ids: [] };
      const reason = req.judgeReason || '';
      const want = (c) => {
        switch (reason) {
          case '乐不思蜀': return c.suit === 'heart';
          case '闪电': return !(c.suit === 'spade' && c.num >= 2 && c.num <= 9);
          case '八卦阵': return c.color === 'red';
          case '洛神': return c.color === 'black';
          case '铁骑': return c.color === 'red';
          case '刚烈': return c.suit === 'heart';
          default: return false;
        }
      };
      if (req.currentCard && want(req.currentCard)) return { ids: [] };
      const ok = cards.find((c) => want(c.card));
      return ok ? { ids: [ok.id] } : { ids: [] };
    }

    case 'ganglie': {
      const d = ch.find((c) => c.id === 'discard');
      if (d && p.hand.length >= 4) return { ids: [d.id] };
      return { ids: [(ch.find((c) => c.id === 'damage') || ch[ch.length - 1]).id] };
    }

    case 'qilin':
      return { ids: [ch[0].id] };

    case 'luoyi': {
      const hasSlash = p.hand.some((c) => G.convertNames(p, c, 'play').includes('slash'));
      return { ids: [hasSlash ? 'yes' : 'no'] };
    }

    case 'tieqi':
      return { ids: ['yes'] };

    case 'guessSuit':
      return { ids: [ch[Math.floor(Math.random() * ch.length)].id] };

    case 'allyTarget':
    case 'healTarget': {
      const t = bestAlly(G, p, ch.map((c) => Number(c.id)));
      return { ids: [String(t.seat)] };
    }

    case 'enemyTarget':
    case 'borrowTarget': {
      const t = bestEnemy(G, p, ch.map((c) => Number(c.id)));
      return { ids: [String(t.seat)] };
    }

    default: {
      if (req.style === 'players') {
        const t = bestEnemy(G, p, ch.map((c) => Number(c.id)));
        return { ids: [String(t.seat)] };
      }
      if (req.style === 'suits') return { ids: [ch[Math.floor(Math.random() * ch.length)].id] };
      if (cards.length) return { ids: lowFirst.slice(0, n).map((c) => c.id) };
      return { ids: [ch[0].id] };
    }
  }
}

/* ==================== 观星 ==================== */
function decideGuanxing(G, p, req) {
  const cards = req.cards || [];
  const val = (c) => {
    switch (c.name) {
      case 'peach': return 10;
      case 'abundance': return 9;
      case 'slash': return 7;
      case 'jink': return 5;
      case 'wuxie': return 6;
      case 'duel': case 'invasion': case 'arrows': return 7;
      default: return c.type === 'equip' ? 8 : 2;
    }
  };
  const sorted = cards.slice().sort((a, b) => val(b) - val(a));
  const top = sorted.slice(0, Math.min(3, sorted.length)).map((c) => c.uid);
  return { top };
}

module.exports = { decide, enemyScore };
