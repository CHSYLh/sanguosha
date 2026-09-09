/**
 * 武将数据层（标准 + 风火林山常见武将，共 52 名）
 * 武将池需 ≥ 人数×5，保证满员 10 人局每位玩家都能拿到 5 张互不重复的候选卡。
 */

const HEROES = [
  /* ========== 蜀 ========== */
  { id: 'liubei', name: '刘备', country: 'shu', gender: 'm', hp: 4, skills: ['rende', 'jijiang'] },
  { id: 'guanyu', name: '关羽', country: 'shu', gender: 'm', hp: 4, skills: ['wusheng'] },
  { id: 'zhangfei', name: '张飞', country: 'shu', gender: 'm', hp: 4, skills: ['paoxiao'] },
  { id: 'zhaoyun', name: '赵云', country: 'shu', gender: 'm', hp: 4, skills: ['longdan'] },
  { id: 'machao', name: '马超', country: 'shu', gender: 'm', hp: 4, skills: ['tieqi', 'mashu'] },
  { id: 'zhugeliang', name: '诸葛亮', country: 'shu', gender: 'm', hp: 3, skills: ['guanxing', 'kongcheng'] },
  { id: 'huangyueying', name: '黄月英', country: 'shu', gender: 'f', hp: 3, skills: ['jizhi', 'qicai'] },
  { id: 'huangzhong', name: '黄忠', country: 'shu', gender: 'm', hp: 4, skills: ['liegong'] },
  { id: 'weiyan', name: '魏延', country: 'shu', gender: 'm', hp: 4, skills: ['kuangu'] },
  { id: 'jiangwei', name: '姜维', country: 'shu', gender: 'm', hp: 4, skills: ['tiaoxin'] },
  { id: 'wolong', name: '卧龙诸葛亮', country: 'shu', gender: 'm', hp: 3, skills: ['huoji', 'kanpo', 'bazhen'] },
  { id: 'zhurong', name: '祝融', country: 'shu', gender: 'f', hp: 4, skills: ['juxiang', 'lieren'] },
  { id: 'menghuo', name: '孟获', country: 'shu', gender: 'm', hp: 4, skills: ['huoshou', 'zaiqi'] },
  { id: 'mizhu', name: '糜竺', country: 'shu', gender: 'm', hp: 3, skills: ['ziyuan'] },
  { id: 'jianyong', name: '简雍', country: 'shu', gender: 'm', hp: 3, skills: ['qiaoshui'] },

  /* ========== 魏 ========== */
  { id: 'caocao', name: '曹操', country: 'wei', gender: 'm', hp: 4, skills: ['jianxiong', 'hujia'] },
  { id: 'simayi', name: '司马懿', country: 'wei', gender: 'm', hp: 3, skills: ['fankui', 'guicai'] },
  { id: 'xiahoudun', name: '夏侯惇', country: 'wei', gender: 'm', hp: 4, skills: ['ganglie'] },
  { id: 'guojia', name: '郭嘉', country: 'wei', gender: 'm', hp: 3, skills: ['tiandu', 'yiji'] },
  { id: 'xuchu', name: '许褚', country: 'wei', gender: 'm', hp: 4, skills: ['luoyi'] },
  { id: 'zhenji', name: '甄姬', country: 'wei', gender: 'f', hp: 3, skills: ['luoshen', 'qingguo'] },
  { id: 'zhangliao', name: '张辽', country: 'wei', gender: 'm', hp: 4, skills: ['tuxi'] },
  { id: 'dianwei', name: '典韦', country: 'wei', gender: 'm', hp: 4, skills: ['qiangxi'] },
  { id: 'xuhuang', name: '徐晃', country: 'wei', gender: 'm', hp: 4, skills: ['duanliang'] },
  { id: 'yujin', name: '于禁', country: 'wei', gender: 'm', hp: 4, skills: ['yizhong'] },
  { id: 'xiahouyuan', name: '夏侯渊', country: 'wei', gender: 'm', hp: 4, skills: ['shensu'] },
  { id: 'pangde', name: '庞德', country: 'wei', gender: 'm', hp: 4, skills: ['mashu', 'mengjin'] },
  { id: 'caozhi', name: '曹植', country: 'wei', gender: 'm', hp: 3, skills: ['luoying'] },
  { id: 'xunyu', name: '荀彧', country: 'wei', gender: 'm', hp: 3, skills: ['quhu'] },
  { id: 'caoren', name: '曹仁', country: 'wei', gender: 'm', hp: 4, skills: ['jushou'] },

  /* ========== 吴 ========== */
  { id: 'sunquan', name: '孙权', country: 'wu', gender: 'm', hp: 4, skills: ['zhiheng', 'jiuyuan'] },
  { id: 'zhouyu', name: '周瑜', country: 'wu', gender: 'm', hp: 3, skills: ['yingzi', 'fanjian'] },
  { id: 'huanggai', name: '黄盖', country: 'wu', gender: 'm', hp: 4, skills: ['kurou'] },
  { id: 'lvmeng', name: '吕蒙', country: 'wu', gender: 'm', hp: 4, skills: ['keji'] },
  { id: 'luxun', name: '陆逊', country: 'wu', gender: 'm', hp: 3, skills: ['qianxun', 'lianying'] },
  { id: 'sunshangxiang', name: '孙尚香', country: 'wu', gender: 'f', hp: 3, skills: ['xiaoji', 'jieyin'] },
  { id: 'ganning', name: '甘宁', country: 'wu', gender: 'm', hp: 4, skills: ['qixi'] },
  { id: 'daqiao', name: '大乔', country: 'wu', gender: 'f', hp: 3, skills: ['guose'] },
  { id: 'taishici', name: '太史慈', country: 'wu', gender: 'm', hp: 4, skills: ['tianyi'] },
  { id: 'sunjian', name: '孙坚', country: 'wu', gender: 'm', hp: 4, skills: ['yinghun'] },
  { id: 'xiaoqiao', name: '小乔', country: 'wu', gender: 'f', hp: 3, skills: ['tianxiang'] },

  /* ========== 群 ========== */
  { id: 'diaochan', name: '貂蝉', country: 'qun', gender: 'f', hp: 3, skills: ['lijian', 'biyue'] },
  { id: 'lvbu', name: '吕布', country: 'qun', gender: 'm', hp: 4, skills: ['wushuang'] },
  { id: 'huatuo', name: '华佗', country: 'qun', gender: 'm', hp: 3, skills: ['jijiu', 'qingnang'] },
  { id: 'zhangjiao', name: '张角', country: 'qun', gender: 'm', hp: 3, skills: ['leiji', 'guidao'] },
  { id: 'gongsunzan', name: '公孙瓒', country: 'qun', gender: 'm', hp: 4, skills: ['yicong'] },
  { id: 'jiaxu', name: '贾诩', country: 'qun', gender: 'm', hp: 3, skills: ['weimu', 'wansha'] },
  { id: 'gaoshun', name: '高顺', country: 'qun', gender: 'm', hp: 4, skills: ['xianzhen'] },
  { id: 'mateng', name: '马腾', country: 'qun', gender: 'm', hp: 4, skills: ['mashu'] },
  { id: 'huaxiong', name: '华雄', country: 'qun', gender: 'm', hp: 6, skills: ['yaowu'] },
  { id: 'dongzhuo', name: '董卓', country: 'qun', gender: 'm', hp: 8, skills: ['jiuchi', 'benghuai'] },
  { id: 'chenggong', name: '陈宫', country: 'qun', gender: 'm', hp: 3, skills: ['mingce'] },
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
  mashu: { cn: '马术', type: 'passive', desc: '锁定技，你与其他角色的距离-1。' },
  guanxing: { cn: '观星', type: 'trigger', desc: '回合开始阶段开始时，你可以观看牌堆顶的X张牌（X为存活角色数，最多5），将任意数量的牌以任意顺序置于牌堆顶，其余置于牌堆底。' },
  kongcheng: { cn: '空城', type: 'passive', desc: '锁定技，当你没有手牌时，你不能成为【杀】或【决斗】的目标。' },
  jizhi: { cn: '集智', type: 'trigger', desc: '当你使用一张非延时类锦囊牌后，你可以摸一张牌。' },
  qicai: { cn: '奇才', type: 'passive', desc: '你使用锦囊牌无距离限制。' },
  liegong: { cn: '烈弓', type: 'passive', desc: '当你使用【杀】指定目标后，若其手牌数不少于你的手牌数，或其体力值不高于你的体力值，该【杀】不可被【闪】响应。' },
  kuangu: { cn: '狂骨', type: 'trigger', desc: '锁定技，当你对距离1以内的角色造成伤害后，你回复1点体力。' },
  tiaoxin: { cn: '挑衅', type: 'active', desc: '出牌阶段限一次，你可以令一名其他角色对你使用一张【杀】，否则你弃置其一张牌。' },
  huoji: { cn: '火计', type: 'passive', desc: '你可以将一张红色手牌当【火攻】使用。' },
  kanpo: { cn: '看破', type: 'passive', desc: '你可以将一张黑色手牌当【无懈可击】使用或打出。' },
  bazhen: { cn: '八阵', type: 'passive', desc: '锁定技，若你的装备区里没有防具牌，你视为装备着【八卦阵】。' },
  juxiang: { cn: '巨象', type: 'passive', desc: '锁定技，【南蛮入侵】对你无效；其他角色使用的【南蛮入侵】结算结束后，你获得之（自己使用的不能再拿回，否则可无限重复）。' },
  lieren: { cn: '烈刃', type: 'trigger', desc: '当你使用【杀】造成伤害后，你可以与其拼点，若你赢，你获得其一张手牌。' },
  huoshou: { cn: '祸首', type: 'passive', desc: '锁定技，【南蛮入侵】对你无效。' },
  zaiqi: { cn: '再起', type: 'passive', desc: '摸牌阶段，若你已受伤，你可以放弃摸牌，改为回复1点体力。' },
  ziyuan: { cn: '资援', type: 'active', desc: '出牌阶段限一次，你可以将任意张手牌交给一名其他角色，然后你摸等量的牌。' },
  qiaoshui: { cn: '巧说', type: 'active', desc: '出牌阶段限一次，你可以与一名角色拼点：若你赢，本回合你使用【杀】无次数限制且无距离限制；若你没赢，本回合你不能使用【杀】。' },

  // 魏
  jianxiong: { cn: '奸雄', type: 'trigger', desc: '当你受到伤害后，你可以获得造成此伤害的牌。' },
  hujia: { cn: '护驾', type: 'lord', desc: '主公技，当你需要使用或打出【闪】时，你可令其他魏势力角色打出一张【闪】。' },
  fankui: { cn: '反馈', type: 'trigger', desc: '当你受到一次伤害后，你可以获得伤害来源的一张牌。' },
  guicai: { cn: '鬼才', type: 'passive', desc: '在一名角色的判定牌生效前，你可以打出一张手牌代替之。' },
  ganglie: { cn: '刚烈', type: 'trigger', desc: '当你受到一次伤害后，你可以判定：若结果不为红桃，伤害来源需弃置两张手牌，否则受到你造成的1点伤害。' },
  tiandu: { cn: '天妒', type: 'passive', desc: '在你的判定牌生效后，你可以获得此牌。' },
  yiji: { cn: '遗计', type: 'trigger', desc: '当你受到1点伤害后，你可以摸两张牌，然后可以将其中至多两张交给其他角色。' },
  luoyi: { cn: '裸衣', type: 'passive', desc: '摸牌阶段，你可以少摸一张牌，若如此，本回合你使用【杀】造成的伤害+1。' },
  luoshen: { cn: '洛神', type: 'trigger', desc: '回合开始阶段开始时，你可以重复判定，直到出现红色判定牌为止，你获得所有黑色判定牌。' },
  qingguo: { cn: '倾国', type: 'passive', desc: '你可以将一张黑色手牌当【闪】使用或打出。' },
  tuxi: { cn: '突袭', type: 'passive', desc: '摸牌阶段，你可以改为获得至多两名其他角色的各一张手牌。' },
  qiangxi: { cn: '强袭', type: 'active', desc: '出牌阶段限一次，你可以失去1点体力或弃置一张武器牌，然后对你攻击范围内的一名其他角色造成1点伤害。' },
  duanliang: { cn: '断粮', type: 'passive', desc: '你可以将一张黑色手牌当【兵粮寸断】使用。' },
  yizhong: { cn: '毅重', type: 'passive', desc: '锁定技，若你的装备区里没有防具牌，黑色【杀】对你无效。' },
  shensu: { cn: '神速', type: 'passive', desc: '摸牌阶段，你可以跳过摸牌，视为对一名其他角色使用一张【杀】。' },
  mengjin: { cn: '猛进', type: 'trigger', desc: '当你使用的【杀】被【闪】抵消后，你可以弃置其一张牌。' },
  luoying: { cn: '落英', type: 'trigger', desc: '当其他角色的梅花牌因弃置而进入弃牌堆时，你可以获得之。' },
  quhu: { cn: '驱虎', type: 'active', desc: '出牌阶段限一次，你可以与一名体力值大于你的角色拼点：若你赢，其对其攻击范围内一名由你指定的角色造成1点伤害；若你没赢，其对你造成1点伤害。' },
  jushou: { cn: '据守', type: 'trigger', desc: '回合结束阶段开始时，你可以摸三张牌，然后跳过你下一个回合的摸牌阶段。' },

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
  qixi: { cn: '奇袭', type: 'passive', desc: '你可以将一张黑色手牌当【过河拆桥】使用。' },
  guose: { cn: '国色', type: 'passive', desc: '你可以将一张方块手牌当【乐不思蜀】使用。' },
  tianyi: { cn: '天义', type: 'active', desc: '出牌阶段限一次，你可以与一名角色拼点：若你赢，本回合你使用【杀】无次数限制且可额外指定一个目标；若你没赢，本回合你不能使用【杀】。' },
  yinghun: { cn: '英魂', type: 'trigger', desc: '回合开始阶段开始时，若你已受伤，你可以令一名其他角色摸X张牌（X为你已损失的体力值），然后其弃置一张牌。' },
  tianxiang: { cn: '天香', type: 'trigger', desc: '当你受到伤害时，你可以弃置一张红桃手牌，将此伤害转移给另一名其他角色，然后其摸等同于伤害值的牌。' },

  // 群
  lijian: { cn: '离间', type: 'active', desc: '出牌阶段限一次，你可以令两名男性角色进行【决斗】（由后者先出杀）。' },
  biyue: { cn: '闭月', type: 'trigger', desc: '回合结束阶段开始时，你可以摸一张牌。' },
  wushuang: { cn: '无双', type: 'passive', desc: '锁定技，你使用【杀】时，目标需连续使用两张【闪】；你使用【决斗】时，目标每次需连续打出两张【杀】。' },
  jijiu: { cn: '急救', type: 'passive', desc: '你的回合外，你可以将一张红色牌当【桃】使用。' },
  qingnang: { cn: '青囊', type: 'active', desc: '出牌阶段限一次，你可以弃置一张手牌，令一名角色回复1点体力。' },
  leiji: { cn: '雷击', type: 'trigger', desc: '当你打出【闪】时，你可以令一名其他角色进行判定，若结果为黑桃，你对其造成2点雷电伤害。' },
  guidao: { cn: '鬼道', type: 'passive', desc: '在一名角色的判定牌生效前，你可以用一张黑色手牌替换之。' },
  yicong: { cn: '义从', type: 'passive', desc: '锁定技，若你的体力值不小于3，你与其他角色的距离-1；若你的体力值不大于2，你与其他角色的距离+1。' },
  weimu: { cn: '帷幕', type: 'passive', desc: '锁定技，你不能成为黑色锦囊牌的目标。' },
  wansha: { cn: '完杀', type: 'passive', desc: '锁定技，你的回合内，只有你和处于濒死状态的角色可以使用【桃】。' },
  xianzhen: { cn: '陷阵', type: 'active', desc: '出牌阶段限一次，你可以与一名角色拼点：若你赢，本回合你对其使用【杀】无距离限制且无视其防具；若你没赢，本回合你不能使用【杀】。' },
  yaowu: { cn: '耀武', type: 'trigger', desc: '锁定技，当你受到【杀】造成的伤害时，若此【杀】为红色，伤害来源回复1点体力；若为黑色，其摸一张牌。' },
  jiuchi: { cn: '酒池', type: 'passive', desc: '你可以将一张黑色手牌当【酒】使用。' },
  benghuai: { cn: '崩坏', type: 'trigger', desc: '锁定技，回合结束阶段开始时，若你的体力值为全场最低（含并列），你回复1点体力；否则你失去1点体力。' },
  mingce: { cn: '明策', type: 'active', desc: '出牌阶段限一次，你可以将一张【杀】或装备牌交给一名其他角色，其需选择一项：对其攻击范围内一名由你指定的角色造成1点伤害，或摸一张牌。' },
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

/**
 * 为 n 名玩家分配互不重复的候选武将，每人 count 张。
 * 全局不重复 ⇒ 任何玩家选走某个武将后，其他人的可选项数量都不会减少。
 * 武将池不足时（人数×count > 池子大小）退化为可重叠，避免出现空选项。
 */
const dealHeroOptions = (n, count, shuffleArr = (a) => a) => {
  const pool = shuffleArr(HEROES.slice());
  const need = n * count;
  if (pool.length >= need) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(pool.slice(i * count, (i + 1) * count).map((h) => h.id));
    return out;
  }
  // 兜底：池子不够则允许重叠，但保证每人拿满 count 张且自己不重复
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = [];
    const used = new Set();
    for (let k = 0; k < count; k++) {
      const h = pool[(i * count + k) % pool.length];
      if (!h || used.has(h.id)) {
        const rest = pool.find((x) => !used.has(x.id));
        if (!rest) break;
        g.push(rest.id); used.add(rest.id);
      } else {
        g.push(h.id); used.add(h.id);
      }
    }
    out.push(g);
  }
  return out;
};

module.exports = { HEROES, HERO_MAP, COUNTRY_CN, SKILL_META, heroById, pickRandomHeroes, dealHeroOptions };
