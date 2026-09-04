/**
 * 卡牌数据层
 * 花色: spade 黑桃 / heart 红桃 / club 梅花 / diamond 方块
 * 红色: heart, diamond   黑色: spade, club
 */

const SUIT_CN = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const SUIT_NAME = { spade: '黑桃', heart: '红桃', club: '梅花', diamond: '方块' };
const NUM_CN = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

/** 卡牌元数据
 * mode:
 *   self   - 对自己使用
 *   enemy  - 对其他角色使用
 *   all    - 对所有角色结算（无须选目标）
 *   heal   - 对自己或濒死角色使用
 *   -      - 不能被主动使用（闪/无懈可击）
 */
const CARD_META = {
  /* ===== 基本牌 ===== */
  slash: { cn: '杀', type: 'basic', mode: 'enemy', min: 1, max: 1, desc: '对攻击范围内的一名其他角色使用，其需打出一张【闪】，否则受到你造成的1点伤害。每回合限使用一次。' },
  jink: { cn: '闪', type: 'basic', mode: '-', desc: '抵消【杀】的效果。' },
  peach: { cn: '桃', type: 'basic', mode: 'heal', desc: '回复1点体力；当一名角色处于濒死状态时，可对其使用令其回复至1点体力。' },
  wine: { cn: '酒', type: 'basic', mode: 'self', desc: '出牌阶段对自己使用，令你下一张【杀】造成的伤害+1（每回合限一次）；濒死时可对自己使用，回复1点体力。' },

  /* ===== 锦囊牌 ===== */
  duel: { cn: '决斗', type: 'scroll', mode: 'enemy', min: 1, max: 1, desc: '由目标开始，双方轮流打出一张【杀】，先不出的一方受到1点伤害。' },
  invasion: { cn: '南蛮入侵', type: 'scroll', mode: 'all', desc: '所有其他角色需打出一张【杀】，否则受到你造成的1点伤害。' },
  arrows: { cn: '万箭齐发', type: 'scroll', mode: 'all', desc: '所有其他角色需打出一张【闪】，否则受到你造成的1点伤害。' },
  snatch: { cn: '顺手牵羊', type: 'scroll', mode: 'enemy', min: 1, max: 1, range: 1, desc: '获得距离1以内一名其他角色的一张牌。' },
  dismantle: { cn: '过河拆桥', type: 'scroll', mode: 'enemy', min: 1, max: 1, desc: '弃置一名其他角色的一张牌。' },
  abundance: { cn: '无中生有', type: 'scroll', mode: 'self', desc: '摸两张牌。' },
  harvest: { cn: '五谷丰登', type: 'scroll', mode: 'all', desc: '亮出牌堆顶的等量牌，所有角色依次各选择一张。' },
  orchard: { cn: '桃园结义', type: 'scroll', mode: 'all', desc: '所有存活角色各回复1点体力。' },
  borrow: { cn: '借刀杀人', type: 'scroll', mode: 'enemy', min: 1, max: 1, desc: '令一名有武器的角色对其攻击范围内的角色使用【杀】，若其不如此做，你获得其武器。' },
  wuxie: { cn: '无懈可击', type: 'scroll', mode: '-', desc: '抵消一张锦囊牌对一名角色的效果。' },

  /* ===== 延时类锦囊 ===== */
  lebu: { cn: '乐不思蜀', type: 'delayed', mode: 'enemy', min: 1, max: 1, desc: '置于目标判定区，其回合开始判定：若不为红桃，则跳过出牌阶段。' },
  lightning: { cn: '闪电', type: 'delayed', mode: 'self', desc: '置于自己判定区，回合开始判定：若为黑桃2~9，受到3点雷电伤害并无来源结算，否则传给下家。' },

  /* ===== 装备 / 武器 ===== */
  crossbow: { cn: '诸葛连弩', type: 'equip', sub: 'weapon', range: 1, desc: '攻击范围1；你使用【杀】无次数限制。' },
  qinggang: { cn: '青釭剑', type: 'equip', sub: 'weapon', range: 2, desc: '攻击范围2；你使用【杀】时无视目标防具。' },
  shuanggu: { cn: '雌雄双股剑', type: 'equip', sub: 'weapon', range: 2, desc: '攻击范围2；你用【杀】指定异性目标后，可令其弃一张手牌或令你摸一张牌。' },
  guanshi: { cn: '贯石斧', type: 'equip', sub: 'weapon', range: 3, desc: '攻击范围3；目标打出【闪】后，你可弃两张手牌令此【杀】依然造成伤害。' },
  qinglong: { cn: '青龙偃月刀', type: 'equip', sub: 'weapon', range: 3, desc: '攻击范围3；目标打出【闪】后，你可对同一目标继续使用【杀】。' },
  zhangba: { cn: '丈八蛇矛', type: 'equip', sub: 'weapon', range: 3, desc: '攻击范围3；你可将两张手牌当【杀】使用。' },
  fangtian: { cn: '方天画戟', type: 'equip', sub: 'weapon', range: 4, desc: '攻击范围4；当你使用的【杀】是你的最后一张手牌时，可额外指定至多两名目标。' },
  qilin: { cn: '麒麟弓', type: 'equip', sub: 'weapon', range: 5, desc: '攻击范围5；你用【杀】造成伤害后，可弃置其一张坐骑。' },

  /* ===== 装备 / 防具 ===== */
  bagua: { cn: '八卦阵', type: 'equip', sub: 'armor', desc: '需要打出【闪】时，你可判定：若结果为红色，视为打出一张【闪】。' },
  renwang: { cn: '仁王盾', type: 'equip', sub: 'armor', desc: '黑色【杀】对你无效。' },

  /* ===== 装备 / 坐骑 ===== */
  dilu: { cn: '的卢', type: 'equip', sub: 'horsePlus', desc: '+1马：其他角色到你的距离+1。' },
  jueying: { cn: '绝影', type: 'equip', sub: 'horsePlus', desc: '+1马：其他角色到你的距离+1。' },
  zhuahuang: { cn: '爪黄飞电', type: 'equip', sub: 'horsePlus', desc: '+1马：其他角色到你的距离+1。' },
  chitu: { cn: '赤兔', type: 'equip', sub: 'horseMinus', desc: '-1马：你到其他角色的距离-1。' },
  zixun: { cn: '紫骍', type: 'equip', sub: 'horseMinus', desc: '-1马：你到其他角色的距离-1。' },
  dayuan: { cn: '大宛', type: 'equip', sub: 'horseMinus', desc: '-1马：你到其他角色的距离-1。' },
};

/** 牌堆构成：[名称, 花色, 点数, 数量] */
const DECK_SPEC = [
  // 基本牌
  ['slash', 'spade', 7, 1], ['slash', 'spade', 8, 2], ['slash', 'spade', 9, 2], ['slash', 'spade', 10, 2],
  ['slash', 'club', 2, 1], ['slash', 'club', 3, 1], ['slash', 'club', 4, 1], ['slash', 'club', 5, 1],
  ['slash', 'club', 6, 1], ['slash', 'club', 7, 1], ['slash', 'club', 8, 2], ['slash', 'club', 9, 2],
  ['slash', 'club', 10, 2], ['slash', 'club', 11, 2],
  ['slash', 'diamond', 3, 1], ['slash', 'diamond', 4, 1], ['slash', 'diamond', 5, 1], ['slash', 'diamond', 6, 1],
  ['slash', 'diamond', 7, 1], ['slash', 'diamond', 8, 1], ['slash', 'diamond', 9, 1], ['slash', 'diamond', 10, 1],
  ['slash', 'diamond', 11, 1], ['slash', 'diamond', 12, 1],
  ['jink', 'heart', 2, 2], ['jink', 'heart', 6, 1], ['jink', 'heart', 7, 1], ['jink', 'heart', 8, 1],
  ['jink', 'heart', 9, 1], ['jink', 'heart', 10, 1], ['jink', 'heart', 11, 1],
  ['jink', 'diamond', 2, 2], ['jink', 'diamond', 6, 1], ['jink', 'diamond', 7, 1], ['jink', 'diamond', 8, 1],
  ['jink', 'diamond', 9, 1], ['jink', 'diamond', 10, 1], ['jink', 'diamond', 11, 1],
  ['peach', 'heart', 3, 1], ['peach', 'heart', 4, 1], ['peach', 'heart', 5, 1], ['peach', 'heart', 6, 1], ['peach', 'heart', 9, 1],
  ['peach', 'diamond', 2, 1], ['peach', 'diamond', 3, 1], ['peach', 'diamond', 4, 1], ['peach', 'diamond', 5, 1], ['peach', 'diamond', 12, 1],
  ['wine', 'spade', 3, 1], ['wine', 'spade', 9, 1], ['wine', 'club', 9, 1], ['wine', 'diamond', 9, 1], ['wine', 'diamond', 10, 1],

  // 锦囊牌
  ['duel', 'spade', 1, 1], ['duel', 'club', 1, 1], ['duel', 'diamond', 1, 1],
  ['invasion', 'spade', 7, 1], ['invasion', 'spade', 13, 1], ['invasion', 'club', 7, 1],
  ['arrows', 'heart', 1, 1],
  ['snatch', 'spade', 3, 1], ['snatch', 'spade', 4, 1], ['snatch', 'spade', 11, 1],
  ['snatch', 'club', 3, 1], ['snatch', 'club', 4, 1],
  ['dismantle', 'spade', 3, 1], ['dismantle', 'spade', 4, 1], ['dismantle', 'spade', 12, 1],
  ['dismantle', 'club', 3, 1], ['dismantle', 'club', 4, 1], ['dismantle', 'heart', 12, 1],
  ['abundance', 'heart', 7, 1], ['abundance', 'heart', 8, 1], ['abundance', 'heart', 9, 1], ['abundance', 'heart', 11, 1],
  ['harvest', 'heart', 3, 1], ['harvest', 'heart', 4, 1],
  ['orchard', 'heart', 1, 1],
  ['borrow', 'club', 12, 1], ['borrow', 'club', 13, 1],
  ['wuxie', 'spade', 11, 1], ['wuxie', 'club', 12, 1], ['wuxie', 'club', 13, 1], ['wuxie', 'diamond', 12, 1],
  ['lebu', 'spade', 6, 1], ['lebu', 'heart', 6, 1], ['lebu', 'club', 6, 1],
  ['lightning', 'spade', 1, 1], ['lightning', 'spade', 2, 1],

  // 装备牌
  ['crossbow', 'diamond', 1, 1], ['crossbow', 'club', 1, 1],
  ['qinggang', 'spade', 6, 1],
  ['shuanggu', 'spade', 2, 1],
  ['guanshi', 'diamond', 5, 1],
  ['qinglong', 'spade', 5, 1],
  ['zhangba', 'spade', 12, 1],
  ['fangtian', 'spade', 13, 1],
  ['qilin', 'heart', 5, 1],
  ['bagua', 'spade', 2, 1], ['bagua', 'club', 2, 1],
  ['renwang', 'club', 2, 1],
  ['dilu', 'club', 5, 1], ['jueying', 'spade', 5, 1], ['zhuahuang', 'heart', 13, 1],
  ['chitu', 'heart', 5, 1], ['zixun', 'diamond', 13, 1], ['dayuan', 'spade', 13, 1],
];

let uidSeq = 0;

function makeCard(name, suit, num) {
  return {
    uid: `c${++uidSeq}`,
    name,
    suit,
    num,
    color: suit === 'heart' || suit === 'diamond' ? 'red' : 'black',
    cn: CARD_META[name].cn,
    type: CARD_META[name].type,
  };
}

function buildDeck() {
  const cards = [];
  for (const [name, suit, num, count] of DECK_SPEC) {
    for (let i = 0; i < count; i++) cards.push(makeCard(name, suit, num));
  }
  return cards;
}

const isRed = (card) => !!card && card.color === 'red';
const isBlack = (card) => !!card && card.color === 'black';
const cardText = (card) => `${SUIT_CN[card.suit]}${NUM_CN[card.num] || card.num}${CARD_META[card.name].cn}`;

const slotOf = (cardName) => CARD_META[cardName].sub;

function cardView(c) {
  if (!c) return null;
  const meta = CARD_META[c.name];
  return {
    uid: c.uid, name: c.name, cn: meta.cn, type: meta.type,
    suit: c.suit, num: c.num, color: c.color,
    text: cardText(c), desc: meta.desc || '',
    range: meta.range || 0, sub: meta.sub || null,
  };
}

function equipView(equip) {
  const out = {};
  for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) out[k] = cardView(equip[k]);
  return out;
}

module.exports = {
  SUIT_CN, SUIT_NAME, NUM_CN, CARD_META, DECK_SPEC,
  buildDeck, makeCard, isRed, isBlack, cardText, cardView, equipView, slotOf,
};
