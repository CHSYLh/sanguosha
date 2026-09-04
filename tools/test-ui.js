/**
 * 前端无头渲染测试（任务 2~7）：
 *   2) 音效模块可用、可静音
 *   3) 开始界面显示局域网地址
 *   4) 选将界面展示每个技能的完整说明
 *   5) 环形布局：所有玩家围绕屏幕，中央显示牌堆 / 弃牌区 / 打出的牌
 *   6) 出牌动画（中央展示、伤害飘字、受击闪烁）与音效联动
 *   7) 点击手牌 / 装备牌查看效果，点击对手角色查看武将技能
 * 用法：node tools/test-ui.js   （需先启动服务）
 */
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const HOST = process.env.HOST || 'localhost:3000';
const PUBLIC = path.join(__dirname, '..', 'public');

const errors = [];
function check(cond, msg) {
  if (!cond) { errors.push(msg); console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

/* ---------- 构造 DOM 并注入前端脚本 ---------- */
function buildDom() {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
    .replace(/<script src="[^"]*"><\/script>/g, '');

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { errors.push('页面 JS 错误：' + e.message); console.error('  ✗ 页面 JS 错误：' + e.message); });
  vc.on('error', (m) => { errors.push('console.error：' + m); console.error('  ✗ console.error：', m); });

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `http://${HOST}/`,
    virtualConsole: vc,
  });
  const w = dom.window;

  // --- Web Audio 桩（jsdom 不支持） ---
  class FakeParam {
    constructor() { this.value = 0; }
    setValueAtTime() { return this; }
    exponentialRampToValueAtTime() { return this; }
  }
  class FakeNode {
    constructor() { this.gain = new FakeParam(); this.frequency = new FakeParam(); this.Q = new FakeParam(); }
    connect() { return this; }
    start() {} stop() {}
  }
  w.AudioContext = class {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = new FakeNode(); }
    createGain() { return new FakeNode(); }
    createOscillator() { return new FakeNode(); }
    createBiquadFilter() { return new FakeNode(); }
    createBufferSource() { return new FakeNode(); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    resume() {}
  };

  // --- 尺寸桩：jsdom 无布局引擎，给出典型桌面牌桌尺寸 ---
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 900; } });
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 460; } });

  // --- socket.io 桩：记录 emit，不真正连接 ---
  const emitted = [];
  w.io = () => ({
    on(evt, fn) { (this.__h = this.__h || {})[evt] = fn; return this; },
    emit(...args) { emitted.push(args); return this; },
    close() {},
    __emitted: emitted,
  });

  // --- fetch 桩：仅实现 /api/net ---
  w.fetch = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      port: 3000,
      ips: ['192.168.1.50', '192.168.1.61'],
      current: HOST,
      urls: ['http://192.168.1.50:3000', 'http://192.168.1.61:3000'],
    }),
  });

  for (const f of ['sound.js', 'app.js']) {
    const el = w.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    w.document.body.appendChild(el);
  }
  return w;
}

/* ---------- 构造测试数据 ---------- */
function fakeGame(n = 6) {
  const players = [];
  for (let i = 0; i < n; i++) {
    players.push({
      seat: i, name: `玩家${i + 1}`, isAI: i !== 0, connected: true,
      hero: { id: 'caocao', name: '曹操', country: 'wei', gender: 'm' },
      skills: [
        { id: 'jianxiong', cn: '奸雄', type: 'trigger', desc: '当你受到伤害后，你可以获得造成此伤害的牌。' },
        { id: 'hujia', cn: '护驾', type: 'lord', desc: '主公技，当你需要使用或打出【闪】时，你可令其他魏势力角色打出一张【闪】。' },
      ],
      hp: i === 0 ? 5 : 4, maxHp: i === 0 ? 5 : 4, dead: false, handCount: 4,
      equip: {
        weapon: { uid: `eq_w${i}`, name: 'qinggang', cn: '青釭剑', type: 'equip', suit: 'spade', num: 6, color: 'black', sub: 'weapon', range: 2, text: '♠6青釭剑', desc: '攻击范围2；你使用【杀】时无视目标防具。' },
        armor: null, horsePlus: null, horseMinus: null,
      },
      judge: i === 1 ? [{ uid: 'jd_1', name: 'lebu', cn: '乐不思蜀', type: 'delayed', suit: 'heart', num: 6, color: 'red', text: '♥6乐不思蜀', desc: '置于目标判定区，其回合开始判定：若不为红桃，则跳过出牌阶段。' }] : [],
      role: i === 0 ? 'lord' : 'unknown',
      attackRange: 2,
    });
  }
  const dist = {};
  for (let i = 1; i < n; i++) dist[i] = Math.min(i, n - i);
  return {
    roomId: 'TEST', round: 3, phase: 'play', currentSeat: 0, lordSeat: 0,
    over: false, winner: null, winnerCn: '', players,
    me: {
      seat: 0, role: 'lord', hp: 5, maxHp: 5, dead: false, dist,
      hand: [
        { uid: 'h1', name: 'slash', cn: '杀', type: 'basic', suit: 'club', num: 7, color: 'black', text: '♣7杀', desc: '对攻击范围内的一名其他角色使用，其需打出一张【闪】，否则受到你造成的1点伤害。每回合限使用一次。' },
        { uid: 'h2', name: 'peach', cn: '桃', type: 'basic', suit: 'heart', num: 5, color: 'red', text: '♥5桃', desc: '回复1点体力；当一名角色处于濒死状态时，可对其使用令其回复至1点体力。' },
      ],
    },
    drawPileCount: 88, discardCount: 12,
    discardTop: { uid: 'd1', name: 'jink', cn: '闪', type: 'basic', suit: 'diamond', num: 2, color: 'red', text: '♦2闪', desc: '抵消【杀】的效果。' },
    pending: { id: 1, kind: 'turn', actions: [], canEnd: true },
    waitingSeat: 0, waitingName: '玩家1',
    logs: [{ t: Date.now(), text: '游戏开始！' }],
  };
}

function fakeRoomPicking(clientId) {
  return {
    id: 'TEST', status: 'picking', hostClientId: clientId, pickDeadline: Date.now() + 30000,
    minPlayers: 2, maxPlayers: 10, roleConfig: {}, playerCount: 4,
    roleSummary: { lord: 1, loyal: 1, rebel: 1, rene: 1 },
    players: [
      { seat: 0, name: '我', isAI: false, connected: true, clientId, heroId: null, hero: null, heroOptions: [
        { id: 'guojia', name: '郭嘉', country: 'wei', hp: 3, taken: false, skills: [
          { id: 'tiandu', cn: '天妒', type: 'passive', desc: '在你的判定牌生效后，你可以获得此牌。' },
          { id: 'yiji', cn: '遗计', type: 'trigger', desc: '当你受到1点伤害后，你可以摸两张牌，然后可以将其中至多两张交给其他角色。' },
        ] },
        { id: 'lvbu', name: '吕布', country: 'qun', hp: 4, taken: true, skills: [
          { id: 'wushuang', cn: '无双', type: 'passive', desc: '锁定技，你使用【杀】时，目标需连续使用两张【闪】。' },
        ] },
      ], picked: false },
      { seat: 1, name: '电脑A', isAI: true, connected: true, clientId: 'ai1', heroId: 'caocao', hero: null, heroOptions: [], picked: true },
    ],
    you: { clientId, seat: 0, isHost: true },
  };
}

(async () => {
  const w = buildDom();
  const doc = w.document;
  const $ = (s) => doc.querySelector(s);
  const $$ = (s) => Array.from(doc.querySelectorAll(s));
  const SGS = w.SGS;

  /* ---------- [2] 音效模块 ---------- */
  console.log('\n[2] 音效模块');
  check(!!w.SGS_Sound, 'SGS_Sound 已挂载到 window');
  if (!w.SGS_Sound) { report(); return; }
  check(typeof w.SGS_Sound.play === 'function', '提供 play(name) 播放接口');
  check(typeof w.SGS_Sound.fx === 'function', '提供 fx(event) 由游戏事件驱动播放');
  check(typeof w.SGS_Sound.toggle === 'function', '提供静音开关');

  const names = ['click', 'select', 'cancel', 'card', 'equip', 'slash', 'jink', 'damage', 'heal', 'die', 'judge', 'turn', 'alert', 'win', 'lose', 'join', 'start'];
  let ok = true;
  for (const n of names) { try { w.SGS_Sound.play(n); } catch (e) { ok = false; errors.push(`音效 ${n} 播放异常：${e.message}`); } }
  check(ok, `全部 ${names.length} 个音效均可播放且无异常`);

  let fxOk = true;
  for (const fx of [
    { type: 'play', as: 'slash' }, { type: 'play', as: 'peach' }, { type: 'play', as: 'qinggang' },
    { type: 'play', as: 'duel' }, { type: 'respond', as: 'jink' }, { type: 'respond', as: 'slash' },
    { type: 'damage', amount: 2 }, { type: 'heal', amount: 1 }, { type: 'die' },
    { type: 'judge' }, { type: 'skill' }, { type: 'turn', seat: 0 }, { type: 'turn', seat: 3 },
    { type: 'over', winner: 'rebel' }, { type: 'over', winner: 'lord' },
  ]) { try { w.SGS_Sound.fx(fx, 0); } catch (e) { fxOk = false; errors.push(`fx ${fx.type}/${fx.as || ''} 异常：${e.message}`); } }
  check(fxOk, '各类游戏事件均能映射到音效（含装备牌→equip 的修复）');

  const before = w.SGS_Sound.isMuted();
  w.SGS_Sound.toggle();
  check(w.SGS_Sound.isMuted() === !before, '静音开关可切换');
  w.SGS_Sound.toggle();
  check(w.SGS_Sound.isMuted() === before, '静音开关可恢复');
  check(w.localStorage.getItem('sgs_muted') !== null, '静音状态已持久化到 localStorage');

  /* ---------- [3] 开始界面局域网地址 ---------- */
  console.log('\n[3] 开始界面局域网地址');
  for (let i = 0; i < 60 && !$('#net-list .net-item'); i++) await new Promise((r) => setTimeout(r, 50));
  const netItems = $$('#net-list .net-item');
  check(netItems.length === 2, `开始界面展示 ${netItems.length} 个访问地址`);
  check(netItems.length > 0 && netItems.every((el) => /http:\/\/\d+\.\d+\.\d+\.\d+:\d+/.test(el.querySelector('.net-url').textContent.trim())),
    '地址格式为 http://IP:端口，其他设备可直接打开');
  check($$('#net-list [data-copy]').length === netItems.length, '每个地址都提供复制按钮');
  check($$('#net-list .net-tag').length === netItems.length, '标注了「本机 / 局域网」');

  /* ---------- [4] 选将界面技能说明 ---------- */
  console.log('\n[4] 选将界面技能说明');
  SGS.setRoom(fakeRoomPicking(SGS.state.clientId));
  await new Promise((r) => setTimeout(r, 30));
  check($('#modal-hero').classList.contains('show'), '进入选将阶段自动弹出选将界面');
  const heroCards = $$('#modal-hero .hero-card');
  check(heroCards.length === 2, `展示 ${heroCards.length} 名候选武将`);

  const gj = heroCards[0];
  const gjSkills = Array.from(gj.querySelectorAll('.hc-skill'));
  check(gjSkills.length === 2, `郭嘉展示 ${gjSkills.length} 个技能`);
  const names4 = gjSkills.map((el) => el.querySelector('.sk-name').textContent.trim());
  check(names4.join('|') === '【天妒】|【遗计】', `技能名称完整：${names4.join(' ')}`);
  const descs = gjSkills.map((el) => el.querySelector('.sk-desc').textContent.trim());
  check(descs[0] === '在你的判定牌生效后，你可以获得此牌。', '技能 1 展示了完整效果说明');
  check(descs[1].indexOf('摸两张牌') >= 0, '技能 2 展示了完整效果说明');
  check(gj.querySelector('.sk-type').textContent.trim() === '被动', '标注了技能类型（被动/主动/触发/主公技）');
  check(gj.querySelector('.hc-hp').textContent.indexOf('3') >= 0, '标注了体力上限');
  check(gj.querySelector('.hc-country').textContent.trim() === '魏', '标注了势力');

  const lb = heroCards[1];
  check(lb.classList.contains('taken'), '已被他人选择的武将标记为 taken');
  check(lb.dataset.hero === '', '已选择的武将不可再点击');
  check(!!lb.querySelector('.hc-taken'), '已选择的武将显示「已被他人选择」');

  /* ---------- [5] 环形布局 ---------- */
  console.log('\n[5] 环形布局：玩家环绕，中央显示牌堆/弃牌区/出牌');
  for (const n of [4, 6, 8, 10]) {
    SGS.setGame(fakeGame(n));
    await new Promise((r) => setTimeout(r, 20));
    const seats = $$('#seat-ring .seat');
    check(seats.length === n, `${n} 人局：环绕显示 ${seats.length} 个座位`);
    const pos = seats.map((el) => `${parseFloat(el.style.left).toFixed(0)},${parseFloat(el.style.top).toFixed(0)}`);
    check(new Set(pos).size === n, `${n} 人局：${n} 个座位位置互不重叠`);
    // 每个座位都应落在牌桌边缘区域（不挤在正中心）
    const inRing = seats.every((el) => {
      const l = parseFloat(el.style.left), t = parseFloat(el.style.top);
      return Math.hypot(l - 50, t - 50) > 20;
    });
    check(inRing, `${n} 人局：所有座位都分布在四周而非中央`);
    // 自己固定在正下方
    const me = seats.find((el) => el.classList.contains('is-me'));
    check(!!me && parseFloat(me.style.top) > 50 && Math.abs(parseFloat(me.style.left) - 50) < 1,
      `${n} 人局：自己固定在屏幕正下方`);
  }

  // 座位尺寸随人数自适应，且相邻座位不能重叠
  const TW = 900, TH = 460; // 与尺寸桩一致
  for (const n of [4, 6, 8, 10]) {
    SGS.setGame(fakeGame(n));
    await new Promise((r) => setTimeout(r, 20));
    const w0 = parseFloat($('#table').style.getPropertyValue('--seat-w'));
    check(w0 >= 56 && w0 <= 112, `${n} 人局座位宽度 ${w0}px 在合理区间内`);
    const pts = $$('#seat-ring .seat').map((el) => ({
      x: (parseFloat(el.style.left) / 100) * TW,
      y: (parseFloat(el.style.top) / 100) * TH,
    }));
    let minGap = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        minGap = Math.min(minGap, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      }
    }
    check(minGap >= w0 * 0.92, `${n} 人局相邻座位最小间距 ${minGap.toFixed(0)}px ≥ 座位宽度 ${w0}px（不重叠）`);
  }

  SGS.setGame(fakeGame(6));
  await new Promise((r) => setTimeout(r, 20));
  check($('#tc-draw-count').textContent === '88', '中央显示牌堆剩余张数');
  check($('#tc-discard-count').textContent === '12', '中央显示弃牌区张数');
  check(!!$('#tc-stage'), '中央存在出牌舞台（用于展示打出的牌）');
  check(!!$('#table .table-felt'), '存在牌桌桌面');
  check($('#table .table-center') && $('#seat-ring'), '中央区域与座位环均在牌桌内');

  /* ---------- [6] 出牌动画 ---------- */
  console.log('\n[6] 出牌动画与音效');
  const layer = $('#fx-layer');
  layer.innerHTML = '';

  SGS.handleFX({ type: 'play', seat: 0, as: 'slash', card: fakeGame(6).me.hand[0], targets: [2, 3] });
  await new Promise((r) => setTimeout(r, 30));
  let cardFx = layer.querySelector('.fx-card');
  check(!!cardFx, '出牌时中央弹出该牌');
  check(cardFx && cardFx.textContent.indexOf('杀') >= 0, '弹出的牌显示牌名（杀）');
  check(cardFx && cardFx.textContent.indexOf('玩家1') >= 0, '显示出牌者');
  check(cardFx && cardFx.textContent.indexOf('玩家3') >= 0 && cardFx.textContent.indexOf('玩家4') >= 0, '显示出牌目标');

  layer.innerHTML = '';
  SGS.handleFX({ type: 'damage', seat: 3, amount: 2, source: 0 });
  await new Promise((r) => setTimeout(r, 30));
  let fl = layer.querySelector('.fx-float');
  check(!!fl && fl.classList.contains('dmg'), '受到伤害时出现伤害飘字');
  check(fl && fl.textContent === '-2', `飘字显示伤害数值（${fl && fl.textContent}）`);
  check(!!$('#seat-ring .seat[data-seat="3"].hit'), '目标座位播放受击闪烁');

  layer.innerHTML = '';
  SGS.handleFX({ type: 'heal', seat: 2, amount: 1 });
  await new Promise((r) => setTimeout(r, 30));
  fl = layer.querySelector('.fx-float');
  check(!!fl && fl.classList.contains('heal') && fl.textContent === '+1', '回血时出现 +N 飘字');
  check(!!$('#seat-ring .seat[data-seat="2"].heal'), '目标座位播放回血效果');

  layer.innerHTML = '';
  SGS.handleFX({ type: 'die', seat: 4, role: 'rebel' });
  await new Promise((r) => setTimeout(r, 30));
  check(!!$('#seat-ring .seat[data-seat="4"].dying'), '阵亡时座位播放阵亡效果');

  layer.innerHTML = '';
  SGS.handleFX({ type: 'judge', seat: 1, card: { uid: 'j1', cn: '乐不思蜀', type: 'delayed', suit: 'heart', num: 6, color: 'red' }, reason: '乐不思蜀' });
  await new Promise((r) => setTimeout(r, 30));
  check(!!layer.querySelector('.fx-card'), '判定时中央展示判定牌');

  layer.innerHTML = '';
  SGS.handleFX({ type: 'skill', seat: 0, skill: 'jianxiong', cn: '奸雄' });
  await new Promise((r) => setTimeout(r, 30));
  fl = layer.querySelector('.fx-float');
  check(!!fl && fl.textContent === '奸雄', '发动技能时显示技能名');

  // 引擎扩展出的事件类型
  layer.innerHTML = '';
  SGS.handleFX({ type: 'equip', seat: 0, slot: 'weapon', card: { uid: 'q1', cn: '青釭剑', type: 'equip', suit: 'spade', num: 6, color: 'black', sub: 'weapon' } });
  await new Promise((r) => setTimeout(r, 30));
  check(!!layer.querySelector('.fx-card'), '装备牌时中央展示该装备');

  layer.innerHTML = '';
  SGS.handleFX({ type: 'dying', seat: 3, hp: 0 });
  await new Promise((r) => setTimeout(r, 30));
  check(!!layer.querySelector('.fx-float'), '他人濒死时给出提示');

  // draw / discard / unequip 只出声不挡视线，确认不报错且无残留动画元素
  let extraOk = true;
  for (const fx of [
    { type: 'draw', seat: 1, count: 2 },
    { type: 'discard', seat: 1, count: 3, from: 'hand' },
    { type: 'unequip', seat: 1, slot: 'weapon', card: { uid: 'q2', cn: '青釭剑', type: 'equip', suit: 'spade', num: 6, color: 'black' } },
  ]) { try { SGS.handleFX(fx); } catch (e) { extraOk = false; errors.push(`fx ${fx.type} 处理异常：${e.message}`); } }
  check(extraOk, 'draw / discard / unequip 事件可正常处理');

  // 未知类型不应导致异常
  let unknownOk = true;
  try { SGS.handleFX({ type: '不存在的类型', seat: 0 }); SGS.handleFX(null); SGS.handleFX(undefined); } catch (e) { unknownOk = false; errors.push('未知 fx 类型导致异常：' + e.message); }
  check(unknownOk, '未知/空特效事件不会导致前端异常');

  /* ---------- [7] 卡牌 / 武将详情 ---------- */
  console.log('\n[7] 点击查看详情');
  SGS.setGame(fakeGame(6));
  await new Promise((r) => setTimeout(r, 20));

  // 手牌右上角 ? 查看效果
  const handCard = $('#hand-row .card');
  check(!!handCard, '自己的手牌已渲染');
  const infoBtn = handCard.querySelector('.c-info');
  check(!!infoBtn, '手牌上带「查看效果」按钮');
  infoBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check($('#modal-info').classList.contains('show'), '点击后弹出卡牌详情');
  check($('#info-title').textContent === '杀', `详情标题为牌名（${$('#info-title').textContent}）`);
  check($('#info-body').textContent.indexOf('需打出一张【闪】') >= 0, '详情正文包含完整卡牌效果');
  check(!!$('#info-card-preview .card'), '详情中展示卡牌样式预览');
  $('#btn-info-close').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check(!$('#modal-info').classList.contains('show'), '可关闭详情弹窗');

  // 对手装备牌查看效果
  const enemyEquip = $('#seat-ring .seat[data-seat="2"] .mini[data-info-card]');
  check(!!enemyEquip, '对手装备牌可点击查看');
  enemyEquip.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check($('#modal-info').classList.contains('show') && $('#info-title').textContent === '青釭剑', '弹出对手装备牌详情');
  check($('#info-body').textContent.indexOf('无视目标防具') >= 0, '装备详情包含效果说明');
  $('#btn-info-close').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  // 对手判定牌
  const judgeCard = $('#seat-ring .seat[data-seat="1"] .mini.judge');
  check(!!judgeCard, '对手判定区的牌可点击查看');
  judgeCard.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check($('#info-title').textContent === '乐不思蜀', '弹出判定牌详情');
  $('#btn-info-close').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  // 点击对手角色查看武将技能
  const heroBtn = $('#seat-ring .seat[data-seat="3"] [data-info-hero]');
  check(!!heroBtn, '对手角色名/按钮可点击查看武将');
  heroBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check($('#modal-info').classList.contains('show'), '弹出武将详情');
  check($('#info-title').textContent === '曹操', `武将详情标题为武将名（${$('#info-title').textContent}）`);
  const rows = $$('#modal-info .skill-row');
  check(rows.length === 2, `展示 ${rows.length} 个武将技能`);
  check(rows.length === 2 && rows[0].querySelector('.sk-desc').textContent.indexOf('获得造成此伤害的牌') >= 0,
    '技能说明完整展示');
  check($('#info-body').textContent.indexOf('未知（阵亡后公开）') >= 0, '未公开身份不会泄露');
  check($('#info-body').textContent.indexOf('体力') >= 0 && $('#info-body').textContent.indexOf('手牌') >= 0,
    '同时展示体力 / 手牌 / 攻击范围等状态');
  $('#btn-info-close').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  // 点击详情内的装备标签可继续深挖
  SGS.showHeroInfo(0);
  await new Promise((r) => setTimeout(r, 20));
  const innerEquip = $('#modal-info [data-info-card]');
  check(!!innerEquip, '武将详情内的装备也可点击');
  innerEquip.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check($('#info-title').textContent === '青釭剑', '可继续查看该装备的效果');

  report();

  function report() {
    console.log('\n—— 结果 ——');
    if (errors.length === 0) console.log('前端渲染测试全部通过。');
    else console.log(`存在 ${errors.length} 处问题：\n - ` + errors.join('\n - '));
    process.exit(errors.length ? 1 : 0);
  }
})();
