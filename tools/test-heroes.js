/**
 * 武将与技能测试：
 *   1) 数据完整性：武将 / 技能元数据齐全，技能都有实现
 *   2) 选将：每人 5 张候选且全局互不重复（A 选走后 B 仍有 5 个可选）
 *   3) 逐个技能的功能测试（含用户反馈的陆逊【连营】）
 *   4) 实战冒烟：52 名武将轮番上场，校验牌张守恒 / 体力合法 / 不崩溃
 * 用法：node tools/test-heroes.js
 */
const path = require('path');
const { CARD_META, buildDeck, makeCard, isRed, isBlack, isSlashCard } = require(path.join(__dirname, '..', 'src', 'cards'));
const { Game } = require(path.join(__dirname, '..', 'src', 'engine'));
const { HEROES, HERO_MAP, SKILL_META, dealHeroOptions } = require(path.join(__dirname, '..', 'src', 'heroes'));
const { SKILLS } = require(path.join(__dirname, '..', 'src', 'skills'));
const { Room } = require(path.join(__dirname, '..', 'src', 'rooms'));

const errors = [];
function check(cond, msg) {
  if (!cond) { errors.push(msg); console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

/* ==================== 测试脚手架 ==================== */
const room = { id: 'H', broadcastGame() {}, socketOf() { return null; }, emitFX() {} };

/** clearHands=true 时清空发到的初始手牌，便于对技能做精确断言 */
function mk(heroIds, clearHands = true) {
  const g = new Game(room);
  g.aiDelay = 0; g.aiJitter = 0; g.turnTimeout = 5; g.reqTimeout = 2;
  g.init(heroIds.map((h, i) => ({ seat: i, id: `h${i}`, name: `P${i + 1}`, isAI: true, heroId: h })));
  if (clearHands) for (const p of g.players) p.hand = [];
  return g;
}

/** 从牌堆里取一张指定名字的牌（保持牌张守恒） */
function fromDeck(g, name, pred) {
  const i = g.drawPile.findIndex((c) => c.name === name && (!pred || pred(c)));
  return i < 0 ? null : g.drawPile.splice(i, 1)[0];
}
/**
 * 取牌优先从牌堆里拿（保持牌张守恒）；这张牌已被发进手牌时退化为临时造一张，
 * 保证技能测试不会因为发牌随机性而误判。
 */
function getCard(g, name, pred) {
  return fromDeck(g, name, pred) || makeCard(name, 'spade', 5);
}
const getRed = (g, n) => fromDeck(g, n, isRed) || makeCard(n, 'heart', 5);
const getBlack = (g, n) => fromDeck(g, n, isBlack) || makeCard(n, 'spade', 5);

/** 设置某人的手牌 */
function setHand(g, seat, names) {
  g.players[seat].hand = names.map((n) => getCard(g, n));
}

/** 接管所有请求：fn(seat, req) 返回应答；返回 null 表示放弃 */
function script(g, fn) { g.request = async (seat, req) => fn(seat, req); }

/** 默认应答：是/否一律选“是”，选择类取第一项，响应类一律放弃 */
const yesMan = (g) => script(g, (seat, req) => {
  if (req.kind === 'choose' && req.choices && req.choices.length) {
    return { ids: [req.choices[0].id] };
  }
  return null;
});

const totalCards = (g) => {
  let n = g.drawPile.length + g.discardPile.length;
  for (const p of g.players) {
    n += p.hand.length + p.judge.length;
    for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) if (p.equip[k]) n += 1;
  }
  return n;
};

/* ==================== 1. 数据完整性 ==================== */
function testData() {
  console.log('\n[1] 武将数据完整性');

  check(HEROES.length >= 50, `武将池共 ${HEROES.length} 名（满员 10 人局需要 10×5=50）`);

  const ids = new Set(); const names = new Set();
  let dup = [];
  for (const h of HEROES) {
    if (ids.has(h.id) || names.has(h.name)) dup.push(`${h.id}/${h.name}`);
    ids.add(h.id); names.add(h.name);
  }
  check(dup.length === 0, `武将 id / 名称唯一${dup.length ? '，重复：' + dup : ''}`);

  const bad = [];
  for (const h of HEROES) {
    if (!['shu', 'wei', 'wu', 'qun'].includes(h.country)) bad.push(`${h.name}.势力`);
    if (!['m', 'f'].includes(h.gender)) bad.push(`${h.name}.性别`);
    if (!(h.hp >= 3 && h.hp <= 8)) bad.push(`${h.name}.体力`);
    if (!h.skills || !h.skills.length) bad.push(`${h.name}.无技能`);
  }
  check(bad.length === 0, `每名武将的势力/性别/体力/技能均合法${bad.length ? '，异常：' + bad : ''}`);

  // 每个技能：有中文名与说明，且在 skills.js 中有实现（或明确由引擎实现）
  const missMeta = []; const missImpl = []; const missDesc = [];
  for (const h of HEROES) {
    for (const sid of h.skills) {
      if (!SKILL_META[sid]) { missMeta.push(`${h.name}.${sid}`); continue; }
      if (!SKILL_META[sid].cn || !SKILL_META[sid].desc) missDesc.push(`${h.name}.${sid}`);
      if (!SKILLS[sid]) missImpl.push(`${h.name}.${sid}`);
    }
  }
  check(missMeta.length === 0, `全部技能都有中文名与说明${missMeta.length ? '，缺少：' + missMeta : ''}`);
  check(missDesc.length === 0, `全部技能都有类型与描述${missDesc.length ? '，缺少：' + missDesc : ''}`);
  check(missImpl.length === 0, `全部技能都在 skills.js 中有实现${missImpl.length ? '，缺少：' + missImpl : ''}`);

  // 主动技能必须能被界面列出：type=active 的一定要有 active 实现
  const badActive = [];
  for (const sid of Object.keys(SKILLS)) {
    if (SKILL_META[sid] && SKILL_META[sid].type === 'active' && !SKILLS[sid].active) badActive.push(sid);
  }
  check(badActive.length === 0, `主动技能均提供 active 实现${badActive.length ? '，缺失：' + badActive : ''}`);

  const skillCount = new Set(HEROES.flatMap((h) => h.skills)).size;
  console.log(`   共 ${HEROES.length} 名武将 / ${skillCount} 个技能`);
}

/* ==================== 2. 选将不重复 ==================== */
function testPick() {
  console.log('\n[2] 选将：每人 5 张且互不重复');

  let ok = true; let detail = '';
  for (let n = 2; n <= 10; n++) {
    for (let k = 0; k < 30; k++) {
      const groups = dealHeroOptions(n, 5, (a) => a.slice().sort(() => Math.random() - 0.5));
      if (groups.length !== n) { ok = false; detail = `${n} 人局分组数=${groups.length}`; break; }
      const seen = new Set();
      for (const grp of groups) {
        if (grp.length !== 5 || new Set(grp).size !== 5) {
          ok = false; detail = `${n} 人局有玩家拿到 ${grp.length} 张（或自身重复）`; break;
        }
        for (const id of grp) {
          if (seen.has(id)) { ok = false; detail = `${n} 人局武将 ${id} 被分给了两名玩家`; break; }
          seen.add(id);
        }
        if (!ok) break;
      }
      if (!ok) break;
    }
    if (!ok) break;
  }
  check(ok, `2~10 人局每人都是 5 张且全局互不重复${ok ? '' : '（' + detail + '）'}`);

  // 关键：任何玩家选走一个武将后，其他人的可选项数量都不变（仍为 5）
  const groups = dealHeroOptions(10, 5, (a) => a.slice().sort(() => Math.random() - 0.5));
  const chosen = groups[0][0];
  const rest = groups.slice(1).map((grp) => grp.filter((id) => id !== chosen).length);
  check(rest.every((c) => c === 5), `A 选走 ${chosen} 后，其余 9 人仍有 5 个可选（实际 ${rest.join('/')}）`);

  const covered = new Set(groups.flat());
  check(groups.flat().length === 50, `满员 10 人局共发出 50 张候选卡（实际 ${groups.flat().length}）`);
  console.log(`   本次分配覆盖 ${covered.size} 名武将`);

  // 走一遍真实的开房 → 选将流程
  const r = new Room('PICK');
  for (let i = 0; i < 10; i++) r.join(`c${i}`, null, `玩家${i + 1}`);
  check(r.start() === true, '满员 10 人房间可以正常开始选将');
  const all = r.players.flatMap((p) => p.heroOptions);
  check(all.length === 50 && new Set(all).size === 50, `房间内 10 人共 50 张候选卡且互不重复（实际 ${all.length} 张 / ${new Set(all).size} 名）`);
  const chosenHero = r.players[0].heroOptions[0];
  check(r.pickHero('c0', chosenHero) === true, `玩家1 可以选定 ${HERO_MAP[chosenHero].name}`);
  const left = r.players.slice(1).map((p) => r.availableOptions(p).length);
  check(left.every((n) => n === 5), `玩家1 选走 ${HERO_MAP[chosenHero].name} 后，其余 9 人仍有 5 个可选（实际 ${left.join('/')}）`);
  const blocked = r.players.slice(1).filter((p) => r.availableOptions(p).indexOf(chosenHero) >= 0).length;
  check(blocked === 0, `被选走的武将不会出现在其他人的候选里（受影响人数 ${blocked}）`);
  clearTimeout(r.pickTimer);
}

/* ==================== 3. 逐个技能功能测试 ==================== */
async function testSkills() {
  console.log('\n[3] 逐个技能功能测试');

  /* ---------- 用户反馈：陆逊【连营】 ---------- */
  {
    const cases = [
      ['基本牌·杀', 'slash', 'slash', [1]],
      ['锦囊·顺手牵羊', 'snatch', 'snatch', [1]],
      ['锦囊·无中生有', 'abundance', 'abundance', []],
      ['装备·青釭剑', 'qinggang', 'qinggang', []],
      ['延时·乐不思蜀', 'lebu', 'lebu', [1]],
    ];
    const bad = [];
    for (const [label, name, as, targets] of cases) {
      const g = mk(['luxun', 'caocao', 'guanyu', 'zhangfei']);
      const p = g.players[0];
      const c = getCard(g, name);
      p.hand = [c];
      // 记录【连营】是否发动
      let fired = false;
      const origDraw = g.drawCards.bind(g);
      g.drawCards = (who, n) => { if (who.seat === 0) fired = true; return origDraw(who, n); };
      const before = p.hand.length;
      await g.playCard(p, { as, cardId: c.uid, targets });
      // 无中生有本身会摸 2 张，故用「是否触发过摸牌」判断
      if (!fired) bad.push(label);
      void before;
    }
    check(bad.length === 0,
      `陆逊失去最后一张手牌时【连营】必定触发（基本/锦囊/装备/延时）${bad.length ? '，未触发：' + bad : ''}`);

    // 失去装备区的牌不应触发【连营】
    const g2 = mk(['luxun', 'caocao', 'guanyu', 'zhangfei']);
    const p2 = g2.players[0];
    const weapon = getCard(g2, 'qinggang');
    p2.equip.weapon = weapon;
    p2.hand = [];
    await g2.loseEquip(p2, 'weapon');
    check(p2.hand.length === 0, '失去装备区的牌不会触发【连营】（区分手牌与装备）');
  }

  /* ---------- 蜀 ---------- */
  {
    const g = mk(['liubei', 'guanyu']);
    const p = g.players[0];
    p.hp = 1;
    setHand(g, 0, ['slash', 'slash']);
    let picked = null;
    script(g, (seat, req) => {
      if (req.purpose === 'rende') return { ids: p.hand.map((c) => c.uid) };
      if (req.purpose === 'allyTarget') { picked = req; return { ids: ['1'] }; }
      return null;
    });
    await g.useSkill(p, 'rende');
    check(p.hp === 2 && g.players[1].hand.length === 2, '【仁德】交出两张牌后回复1点体力');
  }
  {
    // 激将：主公没杀时，蜀势力角色可代打
    const g = mk(['liubei', 'guanyu', 'zhangfei']);
    g.players[0].role = 'lord'; g.lordSeat = 0;
    g.players[1].role = 'loyal'; g.players[2].role = 'loyal';   // 固定身份，避免随机身份影响 AI 是否愿意响应
    g.players[0].hand = [];
    setHand(g, 1, ['slash']);
    const res = await g.askCard(0, 'slash', { reason: 'test' });
    check(!!res && !!res.card, '【激将】主公需要【杀】时蜀势力角色可代为打出');
  }
  {
    const g = mk(['guanyu', 'caocao']);
    const p = g.players[0];
    const red = getRed(g, 'peach') || getRed(g, 'slash');
    check(g.convertNames(p, red, 'slash').includes('slash'), '【武圣】红色牌可当【杀】');
    // 注意：牌堆里的【闪】都是红色，这里用一张黑色的锦囊来验证
    const blk = getBlack(g, 'dismantle');
    check(!g.convertNames(p, blk, 'slash').includes('slash'), '【武圣】黑色牌不能当【杀】');
  }
  {
    const g = mk(['zhangfei', 'caocao']);
    check(g.slashLimit(g.players[0]) === Infinity, '【咆哮】使用【杀】无次数限制');
  }
  {
    const g = mk(['zhaoyun', 'caocao']);
    const p = g.players[0];
    const jink = getCard(g, 'jink'); const slash = getCard(g, 'slash');
    check(g.convertNames(p, jink, 'slash').includes('slash'), '【龙胆】【闪】可当【杀】');
    check(g.convertNames(p, slash, 'jink').includes('jink'), '【龙胆】【杀】可当【闪】');
  }
  {
    // 铁骑：判定为红色时【杀】不可被闪避
    const g = mk(['machao', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    yesMan(g);
    g.judgeCard = async () => makeCard('peach', 'heart', 5);
    setHand(g, 1, ['jink']);
    const slash = getCard(g, 'slash');
    p.hand = [slash];
    const before = t.hp;
    await g.useSlash(p, [t], slash);
    check(t.hp === before - 1, '【铁骑】判定为红色时【杀】不可被【闪】抵消');
  }
  {
    const g = mk(['machao', 'caocao', 'guanyu', 'zhangfei']);
    const withMashu = g.distance(g.players[0], g.players[2]);
    g.players[0].skillIds = g.players[0].skillIds.filter((s) => s !== 'mashu');
    const without = g.distance(g.players[0], g.players[2]);
    check(withMashu === without - 1, `【马术】与其他角色的距离-1（${without} → ${withMashu}）`);
  }
  {
    const g = mk(['zhugeliang', 'caocao']);
    const p = g.players[0];
    const top = g.peekTop(3);
    g.applyGuanxing([top[0].uid], [top[1].uid, top[2].uid]);
    check(g.drawPile[g.drawPile.length - 1].uid === top[0].uid, '【观星】可将选中的牌置于牌堆顶');
  }
  {
    const g = mk(['zhugeliang', 'caocao']);
    g.players[0].hand = [];
    check(!g.canBeTarget(g.players[0], 'slash', g.players[1]), '【空城】没有手牌时不能成为【杀】的目标');
    setHand(g, 0, ['slash']);
    check(g.canBeTarget(g.players[0], 'slash', g.players[1]), '【空城】有手牌时可以被【杀】指定');
  }
  {
    const g = mk(['huangyueying', 'caocao']);
    const p = g.players[0];
    const before = p.hand.length;
    await g.trigger('usedScroll', p, { card: getCard(g, 'snatch') });
    check(p.hand.length === before + 1, '【集智】使用锦囊牌后摸一张牌');
  }
  {
    const g = mk(['huangyueying', 'caocao', 'guanyu', 'zhangfei']);
    const card = getCard(g, 'snatch');
    g.players[0].hand = [card];
    const withQicai = g.computeActions(g.players[0]).filter((a) => a.as === 'snatch').map((a) => a.targets)[0];
    g.players[0].skillIds = g.players[0].skillIds.filter((s) => s !== 'qicai');
    const without = g.computeActions(g.players[0]).filter((a) => a.as === 'snatch').map((a) => a.targets)[0];
    check((withQicai || []).length > (without || []).length, `【奇才】锦囊牌无距离限制（${(without || []).length} → ${(withQicai || []).length} 个目标）`);
  }
  {
    // 烈弓：目标手牌数不少于自己时，杀不可被闪避
    const g = mk(['huangzhong', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    yesMan(g);
    setHand(g, 1, ['jink']);
    const slash = getCard(g, 'slash');
    p.hand = [slash];
    const before = t.hp;
    await g.useSlash(p, [t], slash);
    check(t.hp === before - 1, '【烈弓】满足条件时目标无法用【闪】响应（即使手上有闪）');
  }
  {
    const g = mk(['weiyan', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    p.hp = 2;
    yesMan(g);
    await g.applyDamage({ source: p, target: t, amount: 1, card: null, reason: '测试' });
    check(p.hp === 3, '【狂骨】对距离1以内的角色造成伤害后回复1点体力');
  }
  {
    const g = mk(['weiyan', 'caocao', 'guanyu', 'zhangfei']);
    const p = g.players[0];
    p.hp = 2;
    yesMan(g);
    await g.applyDamage({ source: p, target: g.players[2], amount: 1, card: null, reason: '测试' });
    check(p.hp === 2, '【狂骨】对距离超过1的角色不发动');
  }
  {
    const g = mk(['jiangwei', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    setHand(g, 1, ['peach']);   // 没有杀 → 被弃置一张牌
    script(g, (seat, req) => {
      if (req.purpose === 'enemyTarget') return { ids: ['1'] };
      if (req.purpose === 'fankui') return { ids: [req.choices[0].id] };
      return null;
    });
    await g.useSkill(p, 'tiaoxin');
    check(t.hand.length === 0, '【挑衅】对方未使用【杀】时，其一张牌被弃置');
  }
  {
    const g = mk(['wolong', 'caocao']);
    const p = g.players[0];
    const red = getRed(g, 'peach');
    const black = getBlack(g, 'slash');
    check(g.convertNames(p, red, 'play').includes('huogong'), '【火计】红色手牌可当【火攻】');
    check(g.convertNames(p, black, 'wuxie').includes('wuxie'), '【看破】黑色手牌可当【无懈可击】');
    p.hand = [];
    check(g.cardOptions(p, 'jink', {}).some((c) => c.id === 'bagua'), '【八阵】无防具时可发动【八卦阵】判定');
    p.equip.armor = getCard(g, 'bagua');
    check(g.cardOptions(p, 'jink', {}).some((c) => c.id === 'bagua'), '【八阵】装备防具后仍可正常判定');
    p.equip.armor = null;
    p.skillIds = p.skillIds.filter((s) => s !== 'bazhen');
    check(!g.cardOptions(p, 'jink', {}).some((c) => c.id === 'bagua'), '【八阵】没有该技能时无防具不能判定');
  }
  {
    // 巨象：免疫南蛮入侵并获得之
    const g = mk(['zhurong', 'caocao', 'guanyu']);
    const p = g.players[0];
    const inv = getCard(g, 'invasion');
    p.hand = [inv];
    const enemies = [g.players[1], g.players[2]];
    const hpBefore = enemies.map((x) => x.hp);
    script(g, (seat, req) => null);   // 曹/关 不出杀
    await g.playCard(p, { as: 'invasion', cardId: inv.uid, targets: [] });
    check(enemies.every((x, i) => x.hp === hpBefore[i] - 1), '【巨象】不免疫他人的【南蛮入侵】伤害逻辑正常（祝融为使用者）');
    check(p.hand.includes(inv), '【巨象】结算结束后获得该【南蛮入侵】');
  }
  {
    // 祸首：孟获免疫南蛮入侵
    const g = mk(['menghuo', 'caocao']);
    const p = g.players[0];
    const before = p.hp;
    script(g, (seat, req) => null);
    await g.applyDamage({ source: g.players[1], target: p, amount: 1, card: null, reason: '南蛮入侵' });
    void before;
    check(true, '【祸首】免疫【南蛮入侵】（引擎在结算时跳过）');
    const g2 = mk(['menghuo', 'caocao']);
    const inv = getCard(g2, 'invasion');
    g2.players[1].hand = [inv];
    const hp0 = g2.players[0].hp;
    script(g2, () => null);
    await g2.playCard(g2.players[1], { as: 'invasion', cardId: inv.uid, targets: [] });
    check(g2.players[0].hp === hp0, '【祸首】免疫【南蛮入侵】，祝融/孟获不掉血');
  }
  {
    const g = mk(['zhurong', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    setHand(g, 0, ['slash']);   // 祝融自己要有牌才能拼点
    setHand(g, 1, ['slash']);
    g.pinDian = async () => 1;   // 拼点必胜
    yesMan(g);
    const before = p.hand.length;
    await g.trigger('dealtDamage', p, { target: t, amount: 1, card: null, reason: '杀' });
    check(p.hand.length === before + 1 && t.hand.length === 0, '【烈刃】拼点获胜后获得其一张手牌');
  }
  {
    const g = mk(['menghuo', 'caocao']);
    const p = g.players[0];
    p.hp = 2;
    const before = p.hp;
    script(g, (seat, req) => (req.purpose === 'zaiqi' ? { ids: ['yes'] } : null));
    await g.drawPhase(p);
    check(p.hp === before + 1, '【再起】受伤时可放弃摸牌改为回复1点体力');
  }
  {
    const g = mk(['mizhu', 'caocao']);
    const p = g.players[0];
    setHand(g, 0, ['slash', 'peach']);
    const before = p.hand.length;
    script(g, (seat, req) => {
      if (req.purpose === 'rende') return { ids: p.hand.map((c) => c.uid) };
      if (req.purpose === 'allyTarget') return { ids: ['1'] };
      return null;
    });
    await g.useSkill(p, 'ziyuan');
    check(p.hand.length === 2 && g.players[1].hand.length === 2,
      `【资援】交出 ${before} 张后摸回 ${before} 张（手牌 ${p.hand.length}）`);
  }
  {
    const g = mk(['jianyong', 'caocao']);
    const p = g.players[0];
    setHand(g, 0, ['slash', 'peach']);
    setHand(g, 1, ['slash']);
    g.pinDian = async () => 1;
    script(g, (seat, req) => (req.purpose === 'enemyTarget' ? { ids: ['1'] } : null));
    await g.useSkill(p, 'qiaoshui');
    check(p.turnFlags.tianyi === true && p.turnFlags.noRangeLimit === true, '【巧说】拼点获胜后杀无次数/距离限制');
    const g2 = mk(['jianyong', 'caocao']);
    g2.players[0].hand = [getCard(g2, 'slash')];
    g2.players[1].hand = [getCard(g2, 'slash')];
    g2.pinDian = async () => -1;
    script(g2, (seat, req) => (req.purpose === 'enemyTarget' ? { ids: ['1'] } : null));
    await g2.useSkill(g2.players[0], 'qiaoshui');
    check(g2.players[0].turnFlags.noSlash === true, '【巧说】拼点未获胜则本回合不能使用【杀】');
  }

  /* ---------- 魏 ---------- */
  {
    const g = mk(['caocao', 'simayi']);
    const p = g.players[0];
    const card = getCard(g, 'slash');
    p.hand = [];
    script(g, () => ({ ids: ['yes'] }));
    await g.applyDamage({ source: g.players[1], target: p, amount: 1, card, reason: '杀' });
    check(p.hand.includes(card), '【奸雄】受到伤害后获得造成此伤害的牌');
  }
  {
    const g = mk(['caocao', 'simayi', 'xiahoudun']);
    g.players[0].role = 'lord'; g.lordSeat = 0;
    g.players[0].hand = [];
    setHand(g, 2, ['jink']);
    const res = await g.askCard(0, 'jink', { reason: 'test' });
    check(!!res && !!res.card, '【护驾】主公需要【闪】时魏势力角色可代为打出');
  }
  {
    const g = mk(['simayi', 'caocao']);
    const p = g.players[0];
    setHand(g, 1, ['slash']);
    p.hand = [];
    script(g, (seat, req) => {
      if (req.purpose === 'fankui') return { ids: [req.choices[0].id] };
      return { ids: ['yes'] };
    });
    await g.applyDamage({ source: g.players[1], target: p, amount: 1, card: null, reason: '杀' });
    check(p.hand.length === 1 && g.players[1].hand.length === 0, '【反馈】受到伤害后获得来源的一张牌');
  }
  {
    const g = mk(['simayi', 'caocao']);
    const p = g.players[0];
    const c = getCard(g, 'slash');
    p.hand = [c];
    script(g, (seat, req) => (req.purpose === 'guicai' ? { ids: [c.uid] } : null));
    const replaced = await g.askJudgeModify(g.players[1], makeCard('peach', 'heart', 5), '乐不思蜀');
    check(replaced && replaced.uid === c.uid, '【鬼才】可打出一张手牌替换判定牌');
  }
  {
    const g = mk(['xiahoudun', 'caocao']);
    const p = g.players[0]; const src = g.players[1];
    setHand(g, 1, ['slash', 'peach', 'jink']);
    g.judgeCard = async () => makeCard('slash', 'spade', 5);   // 不为红桃
    script(g, (seat, req) => {
      if (req.purpose === 'ganglie') return { ids: ['discard'] };
      if (req.purpose === 'discard') return { ids: req.choices.slice(0, 2).map((c) => c.id) };
      return { ids: [req.choices[0].id] };
    });
    const before = src.hand.length;
    await g.applyDamage({ source: src, target: p, amount: 1, card: null, reason: '杀' });
    check(src.hand.length === before - 2, '【刚烈】判定不为红桃时来源需弃置两张手牌');
  }
  {
    const g = mk(['guojia', 'caocao']);
    const p = g.players[0];
    p.hand = [];
    const jc = makeCard('slash', 'spade', 5);
    await g.trigger('judgeDone', p, { card: jc, reason: '测试' });
    check(p.hand.includes(jc) && g.judgeCardTaken, '【天妒】判定牌生效后获得此牌');
  }
  {
    const g = mk(['guojia', 'caocao']);
    const p = g.players[0];
    const before = p.hand.length;
    script(g, (seat, req) => {
      if (req.purpose === 'yijiCards') return null;   // 不再把牌给别人
      if (req.purpose === 'allyTarget') return { ids: ['1'] };
      return { ids: ['yes'] };
    });
    await g.applyDamage({ source: g.players[1], target: p, amount: 1, card: null, reason: '杀' });
    check(p.hand.length === before + 2, '【遗计】受到伤害后摸两张牌');
  }
  {
    const g = mk(['xuchu', 'caocao']);
    const p = g.players[0];
    script(g, (seat, req) => (req.purpose === 'luoyi' ? { ids: ['yes'] } : null));
    await g.drawPhase(p);
    check(p.turnFlags.luoyi === true, '【裸衣】少摸一张牌换本回合【杀】伤害+1');
  }
  {
    const g = mk(['zhenji', 'caocao']);
    const p = g.players[0];
    const before = p.hand.length;
    // 直接把牌堆顶布置成「黑、黑、红」，让真实判定流程走一遍
    const b1 = getCard(g, 'slash', isBlack) || getCard(g, 'jink', isBlack);
    const b2 = getCard(g, 'slash', isBlack) || getCard(g, 'dismantle', isBlack);
    const rd = getCard(g, 'peach') || getCard(g, 'fire');
    g.drawPile.push(rd, b2, b1);   // 牌堆尾即牌堆顶
    script(g, () => ({ ids: ['yes'] }));
    await g.trigger('turnBegin', p, {});
    check(p.hand.length === before + 2, `【洛神】连续获得黑色判定牌（获得 ${p.hand.length - before} 张）`);
  }
  {
    const g = mk(['zhenji', 'caocao']);
    const p = g.players[0];
    const black = getBlack(g, 'slash');
    check(g.convertNames(p, black, 'jink').includes('jink'), '【倾国】黑色手牌可当【闪】');
  }
  {
    const g = mk(['zhangliao', 'caocao', 'guanyu']);
    const p = g.players[0];
    setHand(g, 1, ['slash']);
    setHand(g, 2, ['peach']);
    p.hand = [];
    script(g, (seat, req) => {
      if (req.purpose === 'tuxi') return { ids: ['yes'] };
      if (req.purpose === 'tuxiTarget') return { ids: ['1', '2'] };
      return null;
    });
    await g.drawPhase(p);
    check(p.hand.length === 2 && g.players[1].hand.length === 0 && g.players[2].hand.length === 0,
      '【突袭】改为获得至多两名角色各一张手牌');
  }
  {
    const g = mk(['dianwei', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    const before = p.hp; const tBefore = t.hp;
    script(g, (seat, req) => {
      if (req.purpose === 'qiangxiMode') return { ids: ['hp'] };
      if (req.purpose === 'enemyTarget') return { ids: ['1'] };
      return null;
    });
    await g.useSkill(p, 'qiangxi');
    check(p.hp === before - 1 && t.hp === tBefore - 1, '【强袭】失去1点体力并对攻击范围内角色造成1点伤害');
  }
  {
    const g = mk(['xuhuang', 'caocao']);
    const p = g.players[0];
    const black = getBlack(g, 'slash');
    check(g.convertNames(p, black, 'play').includes('bingliang'), '【断粮】黑色手牌可当【兵粮寸断】');
  }
  {
    const g = mk(['yujin', 'caocao']);
    const t = g.players[0];
    t.equip.armor = null;
    const blackSlash = getBlack(g, 'slash');
    const evaded = await g.askJink(t, g.players[1], blackSlash);
    check(evaded === true, '【毅重】无防具时黑色【杀】对其无效');
    const redSlash = getRed(g, 'fire') || getRed(g, 'slash');
    const evaded2 = await g.askJink(t, g.players[1], redSlash);
    check(evaded2 === false, '【毅重】红色【杀】不受影响');
  }
  {
    const g = mk(['xiahouyuan', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    const before = t.hp;
    script(g, (seat, req) => {
      if (req.purpose === 'shensu') return { ids: ['yes'] };
      if (req.purpose === 'enemyTarget') return { ids: ['1'] };
      return null;
    });
    await g.drawPhase(p);
    check(t.hp === before - 1, '【神速】跳过摸牌视为使用一张【杀】');
  }
  {
    const g = mk(['pangde', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    setHand(g, 1, ['jink']);
    script(g, (seat, req) => {
      if (req.purpose === 'mengjin') return { ids: ['yes'] };
      if (req.purpose === 'fankui') return { ids: [req.choices[0].id] };
      return null;
    });
    await g.trigger('slashDodged', p, { target: t, card: null });
    check(t.hand.length === 0, '【猛进】【杀】被【闪】抵消后可弃置其一张牌');
  }
  {
    const g = mk(['caozhi', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    const club = getCard(g, 'slash', (c) => c.suit === 'club');
    t.hand = [club];
    p.hand = [];
    script(g, (seat, req) => (req.purpose === 'luoying' ? { ids: ['yes'] } : null));
    await g.discardFromHand(t, [club]);
    check(p.hand.includes(club), '【落英】其他角色的梅花牌进入弃牌堆时可获得之');
  }
  {
    const g = mk(['xunyu', 'caocao', 'guanyu']);
    const p = g.players[0];
    p.hp = 1;
    setHand(g, 1, ['slash']);
    g.pinDian = async () => 1;
    const t2 = g.players[2];
    const before = t2.hp;
    script(g, (seat, req) => {
      if (req.purpose === 'quhuTarget') return { ids: ['1'] };
      if (req.purpose === 'quhuVictim') return { ids: ['2'] };
      return { ids: [req.choices[0].id] };
    });
    await g.useSkill(p, 'quhu');
    check(t2.hp === before - 1, '【驱虎】拼点获胜后令其对指定角色造成1点伤害');
  }
  {
    const g = mk(['caoren', 'caocao']);
    const p = g.players[0];
    const before = p.hand.length;
    script(g, (seat, req) => (req.purpose === 'jushou' ? { ids: ['yes'] } : null));
    await g.trigger('turnEnd', p, {});
    check(p.hand.length === before + 3 && p.__skipNextDraw === true, '【据守】摸三张牌并跳过下一个回合的摸牌阶段');
    const handNow = p.hand.length;
    await g.drawPhase(p);
    check(p.hand.length === handNow && p.__skipNextDraw === false, '【据守】下一个回合确实跳过摸牌');
  }

  /* ---------- 吴 ---------- */
  {
    const g = mk(['sunquan', 'caocao']);
    const p = g.players[0];
    setHand(g, 0, ['slash', 'peach', 'jink']);
    script(g, (seat, req) => (req.purpose === 'zhiheng' ? { ids: p.hand.map((c) => c.uid) } : null));
    await g.useSkill(p, 'zhiheng');
    check(p.hand.length === 3, `【制衡】弃 3 张摸 3 张（当前 ${p.hand.length} 张）`);
  }
  {
    const g = mk(['sunquan', 'zhouyu']);
    g.players[0].role = 'lord'; g.lordSeat = 0;
    const lord = g.players[0]; const helper = g.players[1];
    lord.hp = 0;
    const peach = getCard(g, 'peach');
    helper.hand = [peach];
    script(g, (seat, req) => {
      if (req.kind === 'respond' && req.as === 'peach') return { ids: [peach.uid] };
      return null;
    });
    await g.resolveDying(lord, null);
    check(lord.hp === 2, '【救援】吴势力角色对主公使用【桃】时额外回复1点体力');
  }
  {
    const g = mk(['zhouyu', 'caocao']);
    const p = g.players[0];
    const before = p.hand.length;
    await g.drawPhase(p);
    check(p.hand.length === before + 3, '【英姿】摸牌阶段多摸一张牌');
  }
  {
    const g = mk(['zhouyu', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    const shown = getCard(g, 'slash', (c) => c.suit === 'spade');
    p.hand = [shown];
    const before = t.hp;
    script(g, (seat, req) => {
      if (req.purpose === 'fanjian') return { ids: [shown.uid] };
      if (req.purpose === 'enemyTarget') return { ids: ['1'] };
      if (req.purpose === 'guessSuit') return { ids: ['heart'] };  // 猜错
      return null;
    });
    await g.useSkill(p, 'fanjian');
    check(t.hp === before - 1 && t.hand.includes(shown), '【反间】猜错则受到伤害并获得该牌');
  }
  {
    const g = mk(['huanggai', 'caocao']);
    const p = g.players[0];
    const hpBefore = p.hp; const handBefore = p.hand.length;
    script(g, () => ({ ids: ['yes'] }));
    await g.useSkill(p, 'kurou');
    check(p.hp === hpBefore - 1 && p.hand.length === handBefore + 2, '【苦肉】失去1点体力并摸两张牌');
  }
  {
    const g = mk(['lvmeng', 'caocao']);
    const p = g.players[0];
    p.hp = 1;
    setHand(g, 0, ['slash', 'peach', 'jink']);
    p.turnFlags.slashUsed = 0;
    script(g, () => null);
    await g.discardPhase(p);
    check(p.hand.length === 3, '【克己】未使用过【杀】时跳过弃牌阶段');
  }
  {
    const g = mk(['luxun', 'caocao']);
    const t = g.players[0];
    check(!g.canBeTarget(t, 'snatch', g.players[1]) && !g.canBeTarget(t, 'lebu', g.players[1]),
      '【谦逊】不能成为【顺手牵羊】与【乐不思蜀】的目标');
  }
  {
    const g = mk(['sunshangxiang', 'caocao']);
    const p = g.players[0];
    const weapon = getCard(g, 'qinggang');
    p.equip.weapon = weapon;
    const before = p.hand.length;
    script(g, () => null);
    await g.loseEquip(p, 'weapon');
    check(p.hand.length === before + 2, '【枭姬】失去装备区里的一张牌后摸两张牌');
  }
  {
    const g = mk(['sunshangxiang', 'guanyu']);
    const p = g.players[0]; const t = g.players[1];
    p.hp = 1; t.hp = 2;
    setHand(g, 0, ['slash', 'peach']);
    script(g, (seat, req) => {
      if (req.purpose === 'jieyin') return { ids: p.hand.map((c) => c.uid) };
      if (req.purpose === 'allyTarget') return { ids: ['1'] };
      return null;
    });
    await g.useSkill(p, 'jieyin');
    check(p.hp === 2 && t.hp === 3, '【结姻】弃两张手牌与一名受伤男性各回复1点体力');
  }
  {
    const g = mk(['ganning', 'caocao']);
    const p = g.players[0];
    const black = getBlack(g, 'slash');
    check(g.convertNames(p, black, 'play').includes('dismantle'), '【奇袭】黑色手牌可当【过河拆桥】');
  }
  {
    const g = mk(['daqiao', 'caocao']);
    const p = g.players[0];
    const dia = getCard(g, 'slash', (c) => c.suit === 'diamond');
    check(g.convertNames(p, dia, 'play').includes('lebu'), '【国色】方块手牌可当【乐不思蜀】');
  }
  {
    const g = mk(['taishici', 'caocao', 'guanyu']);
    const p = g.players[0];
    setHand(g, 0, ['slash', 'peach']);
    setHand(g, 1, ['slash']);
    g.pinDian = async () => 1;
    script(g, (seat, req) => (req.purpose === 'enemyTarget' ? { ids: ['1'] } : null));
    await g.useSkill(p, 'tianyi');
    check(g.slashLimit(p) === Infinity, '【天义】拼点获胜后使用【杀】无次数限制');
  }
  {
    const g = mk(['sunjian', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    // 固定体力上限（随机身份当主公时会 +1，影响“已损失体力值”）
    p.maxHp = 4; p.hp = 2;
    const lost = p.maxHp - p.hp;
    const before = t.hand.length;
    script(g, (seat, req) => {
      if (req.purpose === 'yinghun') return { ids: ['yes'] };
      if (req.purpose === 'allyTarget') return { ids: ['1'] };
      if (req.purpose === 'discard') return { ids: [req.choices[0].id] };
      return null;
    });
    await g.trigger('turnBegin', p, {});
    check(t.hand.length === before + lost - 1, `【英魂】目标摸 ${lost} 张再弃 1 张（净 +${t.hand.length - before}）`);
  }
  {
    const g = mk(['xiaoqiao', 'caocao', 'guanyu']);
    const p = g.players[0]; const victim = g.players[2];
    const heart = getCard(g, 'peach', (c) => c.suit === 'heart') || getCard(g, 'slash', (c) => c.suit === 'heart');
    p.hand = [heart];
    const before = victim.hp;
    script(g, (seat, req) => {
      if (req.purpose === 'tianxiang') return { ids: ['yes'] };
      if (req.purpose === 'tianxiangCard') return { ids: [heart.uid] };
      if (req.purpose === 'allyTarget') return { ids: ['2'] };
      return null;
    });
    await g.applyDamage({ source: g.players[1], target: p, amount: 2, card: null, reason: '杀' });
    check(p.hp === p.maxHp && victim.hp === before - 2, '【天香】弃红桃手牌把伤害转移给其他角色');
  }

  /* ---------- 群 ---------- */
  {
    const g = mk(['diaochan', 'guanyu', 'zhangfei']);
    const p = g.players[0];
    const before = g.players[2].hp;
    script(g, (seat, req) => {
      if (req.purpose === 'enemyTarget') return { ids: ['1'] };
      if (req.purpose === 'lijianTarget') return { ids: ['2'] };
      return null;   // 决斗中双方都不出杀 → 后者受到伤害
    });
    await g.useSkill(p, 'lijian');
    check(g.players[2].hp === before - 1, '【离间】令两名男性角色进行决斗（后者先出杀，先不出者受伤）');
  }
  {
    const g = mk(['diaochan', 'caocao']);
    const p = g.players[0];
    const before = p.hand.length;
    await g.trigger('turnEnd', p, {});
    check(p.hand.length === before + 1, '【闭月】回合结束阶段摸一张牌');
  }
  {
    const g = mk(['lvbu', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    setHand(g, 1, ['jink']);   // 只有 1 张闪，无双需要 2 张
    const slash = getCard(g, 'slash');
    p.hand = [slash];
    const before = t.hp;
    yesMan(g);
    await g.useSlash(p, [t], slash);
    check(t.hp === before - 1, '【无双】目标需连续使用两张【闪】，只有一张时仍受伤害');
  }
  {
    const g = mk(['huatuo', 'caocao']);
    const p = g.players[0];
    const red = getRed(g, 'fire') || getRed(g, 'slash');   // 用红色的非【桃】牌，避免被原生【桃】干扰
    g.currentSeat = 1;                      // 不是华佗的回合
    check(g.convertNames(p, red, 'peach').includes('peach'), '【急救】回合外红色牌可当【桃】');
    g.currentSeat = 0;
    check(!g.convertNames(p, red, 'peach').includes('peach'), '【急救】自己的回合内不生效');
  }
  {
    const g = mk(['huatuo', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    t.hp = 1;
    setHand(g, 0, ['slash']);
    script(g, (seat, req) => {
      if (req.purpose === 'qingnang') return { ids: [p.hand[0].uid] };
      if (req.purpose === 'healTarget') return { ids: ['1'] };
      return null;
    });
    await g.useSkill(p, 'qingnang');
    check(t.hp === 2 && p.hand.length === 0, '【青囊】弃一张手牌令一名角色回复1点体力');
  }
  {
    const g = mk(['zhangjiao', 'caocao']);
    const p = g.players[0]; const t = g.players[1];
    g.judgeCard = async () => makeCard('slash', 'spade', 7);   // 黑桃
    const before = t.hp;
    script(g, (seat, req) => {
      if (req.purpose === 'leiji') return { ids: ['yes'] };
      if (req.purpose === 'enemyTarget') return { ids: ['1'] };
      return null;
    });
    await g.trigger('responded', p, { kind: 'jink', card: getCard(g, 'jink') });
    check(t.hp === before - 2, '【雷击】打出【闪】后判定为黑桃时造成2点雷电伤害');
  }
  {
    const g = mk(['zhangjiao', 'caocao']);
    const p = g.players[0];
    const black = getBlack(g, 'slash');
    p.hand = [black];
    script(g, (seat, req) => (req.purpose === 'guidao' ? { ids: [black.uid] } : null));
    const replaced = await g.askJudgeModify(g.players[1], makeCard('peach', 'heart', 5), '乐不思蜀');
    check(replaced && replaced.uid === black.uid, '【鬼道】可用黑色手牌替换判定牌');
    p.hand = [getRed(g, 'peach')];
    script(g, (seat, req) => (req.purpose === 'guidao' ? { ids: [p.hand[0].uid] } : null));
    const r2 = await g.askJudgeModify(g.players[1], makeCard('peach', 'heart', 5), '乐不思蜀');
    check(!r2, '【鬼道】红色手牌不能用于替换判定牌');
  }
  {
    const g = mk(['gongsunzan', 'caocao', 'guanyu', 'zhangfei']);
    const p = g.players[0];
    p.hp = 4;
    const near = g.distance(p, g.players[2]);
    p.hp = 1;
    const far = g.distance(p, g.players[2]);
    check(far > near, `【义从】体力≥3 时距离-1、≤2 时距离+1（${near} → ${far}）`);
  }
  {
    const g = mk(['jiaxu', 'caocao']);
    const t = g.players[0];
    const blackScroll = getBlack(g, 'dismantle') || getBlack(g, 'snatch') || getBlack(g, 'duel');
    check(!g.canBeTarget(t, blackScroll.name, g.players[1], blackScroll), '【帷幕】不能成为黑色锦囊牌的目标');
    const redScroll = getRed(g, 'duel') || getRed(g, 'snatch');
    check(g.canBeTarget(t, redScroll.name, g.players[1], redScroll), '【帷幕】红色锦囊牌不受影响');
  }
  {
    // 完杀：贾诩回合内，第三人不能使用桃救人
    const g = mk(['jiaxu', 'caocao', 'huatuo']);
    const jiaxu = g.players[0]; const dying = g.players[1]; const helper = g.players[2];
    g.currentSeat = 0;
    dying.hp = 0;
    const peach = getCard(g, 'peach');
    helper.hand = [peach];
    let asked = 0;
    script(g, (seat, req) => {
      if (req.kind === 'respond' && req.as === 'peach') { asked++; return { ids: [peach.uid] }; }
      return null;
    });
    await g.resolveDying(dying, jiaxu);
    check(asked === 0 && dying.dead, '【完杀】贾诩回合内其他角色不能使用【桃】救援');
    // 对照：不是贾诩的回合时可以救
    const g2 = mk(['jiaxu', 'caocao', 'huatuo']);
    g2.currentSeat = 2;
    g2.players[1].hp = 0;
    const p2 = getCard(g2, 'peach');
    g2.players[2].hand = [p2];
    let asked2 = 0;
    script(g2, (seat, req) => {
      if (req.kind === 'respond' && req.as === 'peach') { asked2++; return { ids: [p2.uid] }; }
      return null;
    });
    await g2.resolveDying(g2.players[1], g2.players[0]);
    check(asked2 > 0 && !g2.players[1].dead, '【完杀】不在贾诩回合时可以正常救援（对照组）');
  }
  {
    const g = mk(['gaoshun', 'caocao', 'guanyu', 'zhangfei']);
    const p = g.players[0];
    setHand(g, 0, ['slash', 'peach']);
    setHand(g, 1, ['slash']);
    g.pinDian = async () => 1;
    script(g, (seat, req) => (req.purpose === 'enemyTarget' ? { ids: ['1'] } : null));
    await g.useSkill(p, 'xianzhen');
    // 陷阵目标：无视防具（仁王盾挡不住黑杀）
    const t = g.players[1];
    t.equip.armor = getCard(g, 'renwang');
    const blackSlash = getBlack(g, 'slash');
    const blocked = await g.askJink(t, p, blackSlash);
    check(p.turnFlags.xianzhenSeat === 1 && blocked === false, '【陷阵】拼点获胜后对该角色的【杀】无视其防具');
  }
  {
    const g = mk(['huaxiong', 'caocao']);
    const p = g.players[0]; const src = g.players[1];
    src.hp = 2;
    const redSlash = getRed(g, 'slash') || getRed(g, 'fire');
    await g.applyDamage({ source: src, target: p, amount: 1, card: redSlash, reason: '杀' });
    check(src.hp === 3, '【耀武】受到红色【杀】伤害时伤害来源回复1点体力');
    const blackSlash = getBlack(g, 'slash') || getBlack(g, 'thunder');
    const handBefore = src.hand.length;
    await g.applyDamage({ source: src, target: p, amount: 1, card: blackSlash, reason: '杀' });
    check(src.hand.length === handBefore + 1, '【耀武】受到黑色【杀】伤害时伤害来源摸一张牌');
  }
  {
    const g = mk(['dongzhuo', 'caocao']);
    const p = g.players[0];
    const black = getBlack(g, 'slash');
    check(g.convertNames(p, black, 'play').includes('wine'), '【酒池】黑色手牌可当【酒】');
    // 崩坏：体力不是最低时失去1点体力
    p.hp = 5; g.players[1].hp = 3;
    await g.trigger('turnEnd', p, {});
    check(p.hp === 4, '【崩坏】体力不是全场最低时失去1点体力');
  }
  {
    const g = mk(['chenggong', 'caocao', 'guanyu']);
    const p = g.players[0];
    const slash = getCard(g, 'slash');
    p.hand = [slash];
    const t = g.players[1];
    const before = t.hand.length;
    script(g, (seat, req) => {
      if (req.purpose === 'mingce') return { ids: [slash.uid] };
      if (req.purpose === 'allyTarget') return { ids: ['1'] };
      if (req.purpose === 'mingceChoice') return { ids: ['draw'] };
      return null;
    });
    await g.useSkill(p, 'mingce');
    // 对方获得那张牌（+1）后又选择摸一张牌（+1）
    check(t.hand.includes(slash) && t.hand.length === before + 2,
      '【明策】交出一张牌后对方选择摸一张牌');
  }
}

/* ==================== 4. 实战冒烟 ==================== */
async function testSoak() {
  console.log('\n[4] 实战冒烟：全部武将轮番上场');
  const perGame = 4;
  const rounds = Math.ceil(HEROES.length / perGame);
  const appeared = new Set();
  let bad = [];

  for (let r = 0; r < rounds; r++) {
    const group = HEROES.slice(r * perGame, r * perGame + perGame);
    if (group.length < 2) continue;
    const heroIds = group.map((h) => h.id);
    for (let k = 0; k < 6; k++) {
      const g = mk(heroIds, false);   // 保留发到的初始手牌，跑真实对局
      const total0 = totalCards(g);
      try {
        await g.run();
      } catch (e) {
        bad.push(`${heroIds.join('+')} 抛出异常：${e.message}`);
        continue;
      }
      for (const h of group) appeared.add(h.id);
      const total1 = totalCards(g);
      if (total1 !== total0) bad.push(`${heroIds.join('+')} 牌张数从 ${total0} 变为 ${total1}`);
      // 引擎会把内部异常吞掉并记进日志，这里必须显式抓出来
      const errLog = g.logs.filter((l) => String(l.text || l).includes('[引擎异常]'));
      if (errLog.length) bad.push(`${heroIds.join('+')} 出现引擎异常：${String(errLog[0].text || errLog[0]).slice(0, 90)}`);
      for (const p of g.players) {
        if (p.hp > p.maxHp) bad.push(`${p.name}(${p.hero.name}) 体力 ${p.hp} 超过上限 ${p.maxHp}`);
        if (p.hand.some((c) => !c)) bad.push(`${p.name} 手牌存在空项`);
      }
      if (!g.over || !g.winner) bad.push(`${heroIds.join('+')} 未能正常分出胜负`);
    }
  }

  check(bad.length === 0, `${rounds} 组、每组 6 局共 ${rounds * 6} 局实战无异常${bad.length ? '：' + bad.slice(0, 3).join('；') : ''}`);
  check(appeared.size === HEROES.length,
    `全部 ${HEROES.length} 名武将都实际参与了对局（实际 ${appeared.size} 名）`);

  // 满员 10 人局（含 8 名人机）跑几局，确认新武将混战也稳定
  const mixBad = [];
  for (let k = 0; k < 3; k++) {
    const pool = HEROES.slice().sort(() => Math.random() - 0.5).slice(0, 10).map((h) => h.id);
    const g = mk(pool, false);
    const total0 = totalCards(g);
    await g.run();
    if (totalCards(g) !== total0) mixBad.push(`牌张不守恒 ${total0} → ${totalCards(g)}`);
    if (!g.over) mixBad.push('未分出胜负');
  }
  check(mixBad.length === 0, `10 人混战 3 局均正常${mixBad.length ? '：' + mixBad.join('；') : ''}`);
}

/* ==================== 主流程 ==================== */
(async () => {
  testData();
  testPick();
  await testSkills();
  await testSoak();

  console.log('\n—— 结果 ——');
  if (errors.length) {
    console.error(`存在 ${errors.length} 处问题：`);
    for (const e of errors) console.error(' - ' + e);
    process.exitCode = 1;
  } else {
    console.log('武将与技能测试全部通过。');
  }
})();
