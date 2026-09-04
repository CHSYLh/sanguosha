/**
 * 武将数据层（标准包 22 名武将）
 */

const HEROES = [
  /* ========== 蜀 ========== */
  { id: 'liubei', name: '刘备', country: 'shu', gender: 'm', hp: 4, skills: ['rende', 'jijiang'] },
  { id: 'guanyu', name: '关羽', country: 'shu', gender: 'm', hp: 4, skills: ['wusheng'] },
  { id: 'zhangfei', name: '张飞', country: 'shu', gender: 'm', hp: 4, skills: ['paoxiao'] },
  { id: 'zhaoyun', name: '赵云', country: 'shu', gender: 'm', hp: 4, skills: ['longdan'] },
  { id: 'machao', name: '马超', country: 'shu', gender: 'm', hp: 4, skills: ['tieqi'] },
  { id: 'zhugeliang', name: '诸葛亮', country: 'shu', gender: 'm', hp: 3, skills: ['guanxing', 'kongcheng'] },
  { id: 'huangyueying', name: '黄月英', country: 'shu', gender: 'f', hp: 3, skills: ['jizhi', 'qicai'] },

  /* ========== 魏 ========== */
  { id: 'caocao', name: '曹操', country: 'wei', gender: 'm', hp: 4, skills: ['jianxiong', 'hujia'] },
  { id: 'simayi', name: '司马懿', country: 'wei', gender: 'm', hp: 3, skills: ['fankui', 'guicai'] },
  { id: 'xiahoudun', name: '夏侯惇', country: 'wei', gender: 'm', hp: 4, skills: ['ganglie'] },
  { id: 'guojia', name: '郭嘉', country: 'wei', gender: 'm', hp: 3, skills: ['tiandu', 'yiji'] },
  { id: 'xuchu', name: '许褚', country: 'wei', gender: 'm', hp: 4, skills: ['luoyi'] },
  { id: 'zhenji', name: '甄姬', country: 'wei', gender: 'f', hp: 3, skills: ['luoshen', 'qingguo'] },

  /* ========== 吴 ========== */
  { id: 'sunquan', name: '孙权', country: 'wu', gender: 'm', hp: 4, skills: ['zhiheng', 'jiuyuan'] },
  { id: 'zhouyu', name: '周瑜', country: 'wu', gender: 'm', hp: 3, skills: ['yingzi', 'fanjian'] },
  { id: 'huanggai', name: '黄盖', country: 'wu', gender: 'm', hp: 4, skills: ['kurou'] },
  { id: 'lvmeng', name: '吕蒙', country: 'wu', gender: 'm', hp: 4, skills: ['keji'] },
  { id: 'luxun', name: '陆逊', country: 'wu', gender: 'm', hp: 3, skills: ['qianxun', 'lianying'] },
  { id: 'sunshangxiang', name: '孙尚香', country: 'wu', gender: 'f', hp: 3, skills: ['xiaoji', 'jieyin'] },

  /* ========== 群 ========== */
  { id: 'diaochan', name: '貂蝉', country: 'qun', gender: 'f', hp: 3, skills: ['lijian', 'biyue'] },
  { id: 'lvbu', name: '吕布', country: 'qun', gender: 'm', hp: 4, skills: ['wushuang'] },
  { id: 'huatuo', name: '华佗', country: 'qun', gender: 'm', hp: 3, skills: ['jijiu', 'qingnang'] },
];

const COUNTRY_CN = { shu: '蜀', wei: '魏', wu: '吴', qun: '群' };

/** 技能元数据：type = passive 锁定/被动 | active 主动 | trigger 触发 | lord 主公技 */
const SKILL_META = {
  // 蜀
  rende: { cn: '仁德', type: 'active', desc: '出牌阶段，你可以将任意张手牌交给其他角色，每给出两张牌你回复1点体力。' },
  jijiang: { cn: '激将', type: 'lord', desc: '主公技，当你需要使用或打出【杀】时，你可令其他蜀势力角色打出一张【杀】。' },
  wusheng: { cn: '武圣', type: 'passive', desc: '你可以将一张红色牌当【杀】使用或打出。' },
  paoxiao: { cn: '咆哮', type: 'passive', desc: '你使用【杀】无次数限制。' },
  longdan: { cn: '龙胆', type: 'passive', desc: '你可以将【杀】当【闪】、【闪】当【杀】使用或打出。' },
  tieqi: { cn: '铁骑', type: 'passive', desc: '当你使用【杀】指定目标后，你可以判定，若结果为红色，该【杀】不可被【闪】抵消。' },
  guanxing: { cn: '观星', type: 'active', desc: '回合开始阶段开始时，你可以观看牌堆顶的X张牌（X为存活角色数，最多5），将任意数量的牌以任意顺序置于牌堆顶，其余置于牌堆底。' },
  kongcheng: { cn: '空城', type: 'passive', desc: '锁定技，当你没有手牌时，你不能成为【杀】或【决斗】的目标。' },
  jizhi: { cn: '集智', type: 'trigger', desc: '当你使用一张非延时类锦囊牌后，你可以摸一张牌。' },
  qicai: { cn: '奇才', type: 'passive', desc: '你使用锦囊牌无距离限制。' },

  // 魏
  jianxiong: { cn: '奸雄', type: 'trigger', desc: '当你受到伤害后，你可以获得造成此伤害的牌。' },
  hujia: { cn: '护驾', type: 'lord', desc: '主公技，当你需要使用或打出【闪】时，你可令其他魏势力角色打出一张【闪】。' },
  fankui: { cn: '反馈', type: 'trigger', desc: '当你受到一次伤害后，你可以获得伤害来源的一张牌。' },
  guicai: { cn: '鬼才', type: 'passive', desc: '在一名角色的判定牌生效前，你可以打出一张手牌代替之。' },
  ganglie: { cn: '刚烈', type: 'trigger', desc: '当你受到一次伤害后，你可以判定：若结果不为红桃，伤害来源需弃置两张手牌，否则受到你造成的1点伤害。' },
  tiandu: { cn: '天妒', type: 'passive', desc: '在你的判定牌生效后，你可以获得此牌。' },
  yiji: { cn: '遗计', type: 'trigger', desc: '当你受到1点伤害后，你可以摸两张牌，然后可以将其中至多两张交给其他角色。' },
  luoyi: { cn: '裸衣', type: 'active', desc: '摸牌阶段，你可以少摸一张牌，若如此，本回合你使用【杀】造成的伤害+1。' },
  luoshen: { cn: '洛神', type: 'active', desc: '回合开始阶段开始时，你可以重复判定，直到出现红色判定牌为止，你获得所有黑色判定牌。' },
  qingguo: { cn: '倾国', type: 'passive', desc: '你可以将一张黑色手牌当【闪】使用或打出。' },

  // 吴
  zhiheng: { cn: '制衡', type: 'active', desc: '出牌阶段限一次，你可以弃置任意张牌，然后摸等量的牌。' },
  jiuyuan: { cn: '救援', type: 'lord', desc: '主公技，吴势力角色对你使用【桃】时，你额外回复1点体力。' },
  yingzi: { cn: '英姿', type: 'passive', desc: '锁定技，摸牌阶段你多摸一张牌。' },
  fanjian: { cn: '反间', type: 'active', desc: '出牌阶段限一次，你可以暗置一张手牌，令一名其他角色猜测花色：若猜错，其受到你造成的1点伤害，然后获得该牌；若猜对，其获得该牌。' },
  kurou: { cn: '苦肉', type: 'active', desc: '出牌阶段，你可以失去1点体力，然后摸两张牌。' },
  keji: { cn: '克己', type: 'passive', desc: '若你于出牌阶段未使用过【杀】，你可以跳过弃牌阶段。' },
  qianxun: { cn: '谦逊', type: 'passive', desc: '锁定技，你不能成为【顺手牵羊】和【乐不思蜀】的目标。' },
  lianying: { cn: '连营', type: 'trigger', desc: '当你失去手牌后，若你没有手牌，你可以摸一张牌。' },
  xiaoji: { cn: '枭姬', type: 'trigger', desc: '当你失去装备区里的一张牌后，你可以摸两张牌。' },
  jieyin: { cn: '结姻', type: 'active', desc: '出牌阶段限一次，你可以弃置两张手牌，与一名已受伤的男性角色各回复1点体力。' },

  // 群
  lijian: { cn: '离间', type: 'active', desc: '出牌阶段限一次，你可以令两名男性角色进行【决斗】（由后者先出杀）。' },
  biyue: { cn: '闭月', type: 'trigger', desc: '回合结束阶段开始时，你可以摸一张牌。' },
  wushuang: { cn: '无双', type: 'passive', desc: '锁定技，你使用【杀】时，目标需连续使用两张【闪】；你使用【决斗】时，目标每次需连续打出两张【杀】。' },
  jijiu: { cn: '急救', type: 'passive', desc: '你的回合外，你可以将一张红色牌当【桃】使用。' },
  qingnang: { cn: '青囊', type: 'active', desc: '出牌阶段限一次，你可以弃置一张手牌，令一名角色回复1点体力。' },
};

const HERO_MAP = {};
for (const h of HEROES) HERO_MAP[h.id] = h;

const heroById = (id) => HERO_MAP[id];

const pickRandomHeroes = (n, exclude = []) => {
  const pool = HEROES.filter((h) => !exclude.includes(h.id));
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
};

module.exports = { HEROES, HERO_MAP, COUNTRY_CN, SKILL_META, heroById, pickRandomHeroes };
