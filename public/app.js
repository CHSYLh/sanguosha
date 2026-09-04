/* 三国杀联机版 · 客户端 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const socket = io();

  const SUIT = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
  const NUM = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  const TYPE = { basic: '基本', scroll: '锦囊', delayed: '延时', equip: '装备' };
  const ROLE_CN = { lord: '主公', loyal: '忠臣', rebel: '反贼', rene: '内奸', unknown: '未知' };
  const COUNTRY = { shu: '蜀', wei: '魏', wu: '吴', qun: '群' };
  const PHASE_CN = { wait: '准备', begin: '回合开始', draw: '摸牌', play: '出牌', discard: '弃牌', end: '回合结束', over: '已结束' };
  const GOAL = {
    lord: '消灭所有反贼与内奸',
    loyal: '保护主公，消灭反贼与内奸',
    rebel: '杀死主公',
    rene: '清除其他人后单挑主公',
  };

  const state = {
    clientId: null,
    name: '',
    room: null,
    game: null,
    sel: null,          // 出牌选择 {uid, as, action, extra:[], targets:[], options:[]}
    chooseSel: [],      // choose 请求已选 id
    lastReqId: null,
    gx: { top: [] },    // 观星
    logOpen: false,
  };

  /* ================= 工具 ================= */
  function genId() { return 'c' + Math.random().toString(36).slice(2, 10); }
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function show(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $('#screen-' + name).classList.add('active');
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ================= 初始化 ================= */
  state.clientId = localStorage.getItem('sgs_cid');
  if (!state.clientId) { state.clientId = genId(); localStorage.setItem('sgs_cid', state.clientId); }
  state.name = localStorage.getItem('sgs_name') || '';
  $('#input-name').value = state.name;
  const q = new URLSearchParams(location.search).get('room');
  if (q) $('#input-room').value = q.toUpperCase();
  loadNetAddresses();

  /* ================= 大厅 ================= */
  function getName() {
    const n = ($('#input-name').value || '').trim();
    if (!n) { toast('请先填写昵称'); return null; }
    state.name = n.slice(0, 12);
    localStorage.setItem('sgs_name', state.name);
    return state.name;
  }

  /* ---------- 局域网访问地址（供其他人加入） ---------- */
  async function loadNetAddresses() {
    const box = $('#net-list');
    try {
      const res = await fetch('/api/net');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const net = await res.json();
      const cur = (net.host || net.current || '').replace(/:\d+$/, '');
      const list = net.urls && net.urls.length ? net.urls : [`http://localhost:${net.port || 3000}`];
      box.innerHTML = list.map((url) => {
        const host = url.replace(/^http:\/\//, '').replace(/:\d+$/, '');
        const isCur = host === cur || host === 'localhost' || host === '127.0.0.1';
        return `<div class="net-item ${isCur ? 'cur' : ''}">
          <span class="net-tag">${isCur ? '本机' : '局域网'}</span>
          <span class="net-url"><b>${esc(url)}</b></span>
          <button class="btn btn-xs net-copy" data-copy="${esc(url)}">复制</button>
        </div>`;
      }).join('');
    } catch (e) {
      box.innerHTML = `<span class="muted">无法获取网络地址（${esc(e.message)}）。<br>其他人可访问 <b>http://&lt;本机IP&gt;:${esc(location.port || '3000')}</b> 加入。</span>`;
    }
  }

  $('#net-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const url = btn.dataset.copy;
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('已复制：' + url), () => toast(url));
    else toast(url);
  });

  $('#btn-create').addEventListener('click', () => {
    const name = getName();
    if (!name) return;
    socket.emit('room:create', { clientId: state.clientId, name }, (res) => {
      if (res && res.ok) {
        toast('房间已创建：' + res.roomId);
        window.SGS_Sound && window.SGS_Sound.play('start');
      }
    });
  });

  $('#btn-join').addEventListener('click', () => {
    const name = getName();
    if (!name) return;
    const roomId = ($('#input-room').value || '').trim().toUpperCase();
    if (!roomId) { toast('请输入房间号'); return; }
    socket.emit('room:join', { roomId, clientId: state.clientId, name }, (res) => {
      if (!res || !res.ok) toast((res && res.error) || '加入失败');
    });
  });

  /* ================= 房间 ================= */
  $('#btn-room-leave').addEventListener('click', () => {
    socket.emit('room:leave');
    state.room = null; state.game = null;
    show('home');
  });
  $('#btn-ai-plus').addEventListener('click', () => socket.emit('room:setAICount', { count: aiCount() + 1 }));
  $('#btn-ai-minus').addEventListener('click', () => socket.emit('room:setAICount', { count: aiCount() - 1 }));
  $('#btn-start').addEventListener('click', () => socket.emit('room:start'));
  $('#btn-copy').addEventListener('click', () => {
    const url = `${location.origin}/?room=${state.room.id}`;
    const text = `三国杀房间号：${state.room.id}\n${url}`;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('已复制邀请信息'), () => toast(text));
    else toast(text);
  });

  function aiCount() { return state.room ? state.room.players.filter((p) => p.isAI).length : 0; }

  function renderRoom() {
    const r = state.room;
    if (!r) return;
    $('#room-id').textContent = r.id;
    $('#room-count').textContent = `${r.playerCount} 人`;
    const isHost = r.you && r.you.isHost;
    $('#host-ai-ctrl').style.display = isHost && r.status === 'lobby' ? 'flex' : 'none';
    $('#ai-count').textContent = aiCount();
    $('#btn-start').style.display = isHost && r.status === 'lobby' ? 'block' : 'none';
    $('#room-hint').textContent = r.status === 'lobby'
      ? (isHost ? `可开始（${r.minPlayers}~${r.maxPlayers} 人），也可继续添加人机` : '等待房主开始游戏…')
      : '';

    $('#seat-list').innerHTML = r.players.map((p) => `
      <div class="seat-item ${p.clientId === state.clientId ? 'me' : ''} ${p.isAI ? 'ai' : ''}">
        <div class="si-top">
          <span class="si-name">${esc(p.name)}${p.isAI ? ' <span class="si-tag">(人机)</span>' : ''}</span>
          ${isHost && r.status === 'lobby' && p.isAI ? `<button class="btn btn-xs" data-kick="${p.seat}">移除</button>` : ''}
        </div>
        <div class="si-hero">${p.hero ? `${esc(p.hero.name)} · ${COUNTRY[p.hero.country]} · ${p.hero.hp}血` : '未选将'}</div>
        <div class="si-tag">${p.isAI ? '由电脑控制' : (p.connected ? '在线' : '掉线')} · 座位 ${p.seat + 1}</div>
      </div>`).join('');

    const s = r.roleSummary || {};
    $('#role-preview').innerHTML = `<span class="muted">当前身份配置：</span>` +
      [['lord', '主公'], ['loyal', '忠臣'], ['rebel', '反贼'], ['rene', '内奸']]
        .filter(([k]) => s[k])
        .map(([k, cn]) => `<span class="rp ${k}">${cn} × ${s[k]}</span>`).join('');

    // 选将
    const me = r.players.find((p) => p.clientId === state.clientId);
    if (r.status === 'picking' && me && !me.heroId && me.heroOptions && me.heroOptions.length) {
      showHeroModal(me.heroOptions, r.pickDeadline);
    } else {
      $('#modal-hero').classList.remove('show');
    }
  }

  const SKILL_TYPE_CN = { passive: '被动', active: '主动', trigger: '触发', lord: '主公技' };

  let pickTimer = null;
  function showHeroModal(heroes, deadline) {
    $('#hero-options').innerHTML = heroes.map((h) => `
      <div class="hero-card ${h.taken ? 'taken' : ''}" data-hero="${h.taken ? '' : h.id}">
        <div class="hc-top">
          <span class="hc-name">${esc(h.name)}</span>
          <span class="hc-country">${COUNTRY[h.country]}</span>
          <span class="hc-hp">${h.hp} 体力</span>
        </div>
        <div class="hc-skills">
          ${(h.skills || []).map((s) => `
            <div class="hc-skill">
              <span class="sk-name">【${esc(s.cn)}】</span>
              <span class="sk-type">${SKILL_TYPE_CN[s.type] || ''}</span>
              <div class="sk-desc">${esc(s.desc)}</div>
            </div>`).join('')}
        </div>
        ${h.taken ? '<div class="hc-taken">已被他人选择</div>' : ''}
      </div>`).join('');
    $('#modal-hero').classList.add('show');
    clearInterval(pickTimer);
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      $('#pick-timer').textContent = `${left} 秒后自动选择`;
      if (left <= 0) clearInterval(pickTimer);
    };
    tick();
    pickTimer = setInterval(tick, 1000);
  }

  $('#modal-hero').addEventListener('click', (e) => {
    const el = e.target.closest('[data-hero]');
    if (!el || !el.dataset.hero) return;
    socket.emit('room:pickHero', { heroId: el.dataset.hero });
    $('#modal-hero').classList.remove('show');
    clearInterval(pickTimer);
    window.SGS_Sound && window.SGS_Sound.play('select');
  });

  $('#seat-list').addEventListener('click', (e) => {
    const el = e.target.closest('[data-kick]');
    if (el) socket.emit('room:removeAI', { seat: Number(el.dataset.kick) });
  });

  /* ================= 游戏 ================= */
  function typeCls(c) { return c.type === 'equip' ? 'equip' : (c.type === 'scroll' || c.type === 'delayed') ? 'scroll' : ''; }

  function cardInner(c) {
    return `<div class="c-top"><span>${SUIT[c.suit]}</span><span>${NUM[c.num] || c.num}</span></div>
      <div class="c-name${c.cn.length > 2 ? ' small' : ''}">${esc(c.cn)}</div>
      <div class="c-type">${TYPE[c.type] || ''}</div>`;
  }

  function cardHtml(c, cls) {
    if (!c) return '';
    return `<div class="card ${c.color === 'red' ? 'red' : 'black'} ${typeCls(c)} ${cls || ''}" data-uid="${c.uid}" data-card-uid="${c.uid}">
      <span class="c-info" data-info-card="${c.uid}" title="查看效果">?</span>
      ${cardInner(c)}
    </div>`;
  }

  /** 装备小标签，可点击查看效果 */
  function equipMinis(eq, clickable) {
    const out = [];
    const map = { weapon: '武', armor: '防', horsePlus: '+1', horseMinus: '-1' };
    for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) {
      if (eq && eq[k]) {
        const c = eq[k];
        out.push(`<span class="mini" ${clickable ? `data-info-card="${c.uid}" data-info-card-obj="1" title="${esc(c.desc)}"` : `title="${esc(c.cn)}：${esc(c.desc)}"`}>${map[k]}·${esc(c.cn)}</span>`);
      }
    }
    return out.join('');
  }

  /** 环形布局：把 n 个座位均匀分布到椭圆上，自己固定在正下方 */
  function seatPosition(idx, total) {
    // idx=0 表示自己（正下方 90°），其余按逆时针依次排开
    const angle = (Math.PI * 2 * idx) / total + Math.PI / 2;
    const rx = 43;  // 横向半径（%）
    const ry = 40;  // 纵向半径（%）
    return {
      left: 50 + rx * Math.cos(angle),
      top: 50 + ry * Math.sin(angle),
    };
  }

  function seatHtml(pl, g) {
    const cls = ['seat'];
    if (pl.seat === g.me.seat) cls.push('is-me');
    if (pl.dead) cls.push('dead');
    if (g.currentSeat === pl.seat && !g.over) cls.push('current');
    if (g.waitingSeat === pl.seat) cls.push('waiting');
    if (state.sel && state.sel.action && state.sel.action.targets && state.sel.action.targets.includes(pl.seat)) cls.push('targetable');
    if (state.sel && state.sel.targets && state.sel.targets.includes(pl.seat)) cls.push('chosen');
    const role = pl.role || 'unknown';
    const dist = g.me && g.me.dist && g.me.dist[pl.seat] !== undefined ? `距离${g.me.dist[pl.seat]}` : '';
    return `<div class="${cls.join(' ')}" data-seat="${pl.seat}" data-seat-idx="${pl.ringIdx}">
      <div class="s-head">
        <span class="s-name">${esc(pl.name)}${pl.isAI ? '(机)' : ''}</span>
        <span class="role-badge ${role}">${ROLE_CN[role] || '?'}</span>
      </div>
      <div class="s-hero">
        ${pl.hero ? `<span data-info-hero="${pl.seat}">${esc(pl.hero.name)}<span class="muted">[${COUNTRY[pl.hero.country]}]</span></span>` : '-'}
        ${pl.hero ? `<span class="info-btn" data-info-hero="${pl.seat}" title="查看武将技能">?</span>` : ''}
      </div>
      <div class="s-hp">体力 <b>${pl.hp}</b>/${pl.maxHp} · ✋${pl.handCount} ${dist ? '· ' + dist : ''}</div>
      <div class="s-row">${equipMinis(pl.equip, true)}</div>
      ${pl.judge && pl.judge.length ? `<div class="s-row">${pl.judge.map((j) => `<span class="mini judge" data-info-card="${j.uid}" data-info-card-obj="1" title="${esc(j.desc)}">${esc(j.cn)}</span>`).join('')}</div>` : ''}
      ${pl.dead ? '<div class="s-row"><span class="mini">已阵亡</span></div>' : ''}
    </div>`;
  }

  /** 按牌桌尺寸与人数自动缩放座位，避免小屏或满员时相互重叠 */
  function fitSeatSize(n) {
    const table = $('#table');
    if (!table) return;
    const rx = table.clientWidth * 0.43;
    const ry = table.clientHeight * 0.40;
    if (!rx || !ry) return;
    // 椭圆周长（Ramanujan 近似）
    const perim = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const perSeat = perim / Math.max(1, n);
    const w = Math.round(Math.max(56, Math.min(112, perSeat * 0.58)));
    table.style.setProperty('--seat-w', w + 'px');
    table.style.setProperty('--seat-fs', (w < 78 ? 10 : w < 96 ? 10.8 : 11.5) + 'px');
  }

  /** 渲染环形座位：自己固定在正下方，其余按座位顺序环绕 */
  function renderSeatRing(g) {
    const n = g.players.length;
    const me = g.me.seat;
    fitSeatSize(n);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const pl = g.players[(me + i) % n];
      pl.ringIdx = i;
      const pos = seatPosition(i, n);
      const wrap = document.createElement('div');
      wrap.innerHTML = seatHtml(pl, g);
      const node = wrap.firstElementChild;
      node.style.left = pos.left + '%';
      node.style.top = pos.top + '%';
      frag.appendChild(node);
    }
    const ring = $('#seat-ring');
    ring.innerHTML = '';
    ring.appendChild(frag);
  }

  /* ================= 卡牌 / 武将 详情 ================= */
  /** 在整个牌桌状态中按 uid 找到一张牌（自己的手牌、任意角色的装备与判定区） */
  function findCard(uid) {
    const g = state.game;
    if (!g) return null;
    for (const c of g.me.hand) if (c.uid === uid) return c;
    for (const p of g.players) {
      for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) {
        if (p.equip[k] && p.equip[k].uid === uid) return p.equip[k];
      }
      for (const j of p.judge) if (j.uid === uid) return j;
    }
    return null;
  }

  const SLOT_CN = { weapon: '武器', armor: '防具', horsePlus: '+1 坐骑', horseMinus: '-1 坐骑' };

  function showCardInfo(uid) {
    const c = findCard(uid);
    if (!c) return;
    $('#info-title').textContent = c.cn;
    $('#info-sub').textContent = `${SUIT[c.suit]}${NUM[c.num] || c.num} · ${TYPE[c.type] || ''}${c.range ? ' · 攻击范围 ' + c.range : ''}${c.sub ? ' · ' + (SLOT_CN[c.sub] || c.sub) : ''}`;
    $('#info-card-preview').innerHTML = `<div class="card ${c.color === 'red' ? 'red' : 'black'} ${typeCls(c)}" style="cursor:default">${cardInner(c)}</div>`;
    $('#info-body').innerHTML = `
      <div class="info-sec">
        <h5>卡牌效果</h5>
        <div class="info-desc">${esc(c.desc || '（暂无说明）')}</div>
      </div>
      <div class="info-kv">
        <span>花色：${SUIT[c.suit]} ${['黑桃', '红桃', '梅花', '方块'][['spade', 'heart', 'club', 'diamond'].indexOf(c.suit)]}</span>
        <span>点数：${NUM[c.num] || c.num}</span>
        <span>类型：${TYPE[c.type] || '-'}</span>
      </div>`;
    $('#modal-info').classList.add('show');
    window.SGS_Sound && window.SGS_Sound.play('click');
  }

  function showHeroInfo(seat) {
    const g = state.game;
    if (!g) return;
    const p = g.players[seat];
    if (!p || !p.hero) return;
    const skills = p.skills || [];
    const known = p.role !== 'unknown';
    $('#info-title').textContent = p.hero.name;
    $('#info-sub').textContent = `${COUNTRY[p.hero.country]} · 体力上限 ${p.maxHp} · ${p.name}${p.isAI ? '（人机）' : ''}`;
    $('#info-card-preview').innerHTML = `<div class="hero-avatar">${esc(p.hero.name.slice(0, 1))}</div>`;
    $('#info-body').innerHTML = `
      <div class="info-sec">
        <h5>状态</h5>
        <div class="info-kv">
          <span>体力 ${p.hp}/${p.maxHp}</span>
          <span>手牌 ${p.handCount} 张</span>
          <span>攻击范围 ${p.attackRange}</span>
          <span>身份：${known ? ROLE_CN[p.role] : '未知（阵亡后公开）'}</span>
          <span>${p.isAI ? '由电脑控制' : (p.connected ? '在线' : '掉线')}</span>
        </div>
      </div>
      <div class="info-sec">
        <h5>武将技能（${skills.length}）</h5>
        ${skills.map((s) => `
          <div class="skill-row">
            <span class="sk-name">【${esc(s.cn)}】</span>
            <span class="sk-type">${SKILL_TYPE_CN[s.type] || ''}</span>
            <div class="sk-desc">${esc(s.desc)}</div>
          </div>`).join('') || '<div class="info-desc">该武将没有可展示的技能。</div>'}
      </div>
      <div class="info-sec">
        <h5>装备</h5>
        <div class="info-kv">${equipMinis(p.equip, true) || '<span>（无装备）</span>'}</div>
      </div>`;
    $('#modal-info').classList.add('show');
    window.SGS_Sound && window.SGS_Sound.play('click');
  }

  $('#btn-info-close').addEventListener('click', () => $('#modal-info').classList.remove('show'));
  $('#modal-info').addEventListener('click', (e) => {
    if (e.target.id === 'modal-info') $('#modal-info').classList.remove('show');
    // 详情内的装备小标签也可继续点开查看
    const card = e.target.closest('[data-info-card]');
    if (card) { showCardInfo(card.dataset.infoCard); return; }
  });

  /* ================= 出牌动画与音效 ================= */
  /** 在座位元素上播放一次受击/回血/阵亡效果 */
  function flashSeat(seat, cls) {
    const el = $(`#seat-ring .seat[data-seat="${seat}"]`);
    if (!el) return;
    el.classList.remove('hit', 'heal', 'dying');
    void el.offsetWidth; // 强制重排以便重新触发动画
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 900);
  }

  function floatText(seat, text, cls) {
    const el = $(`#seat-ring .seat[data-seat="${seat}"]`);
    const layer = $('#fx-layer');
    if (!el || !layer) return;
    const r = el.getBoundingClientRect();
    const lr = layer.getBoundingClientRect();
    const node = document.createElement('div');
    node.className = 'fx-float ' + cls;
    node.textContent = text;
    node.style.left = (r.left - lr.left + r.width / 2) + 'px';
    node.style.top = (r.top - lr.top + r.height / 2) + 'px';
    layer.appendChild(node);
    setTimeout(() => node.remove(), 1100);
  }

  /** 中央舞台展示刚打出的牌 */
  function showPlayedCard(fx) {
    const stage = $('#tc-stage');
    if (!stage || !fx.card) return;
    const layer = $('#fx-layer');
    const who = state.game ? (state.game.players[fx.seat] || {}).name : '';
    const node = document.createElement('div');
    node.className = 'fx-card';
    const targetNames = (fx.targets || []).map((s) => (state.game && state.game.players[s] ? state.game.players[s].name : '')).filter(Boolean);
    node.innerHTML = `
      <div class="card ${fx.card.color === 'red' ? 'red' : 'black'} ${typeCls(fx.card)}" style="cursor:default">
        ${cardInner(fx.card)}
      </div>
      <div class="fx-who">${esc(who || '')}${targetNames.length ? ' → ' + esc(targetNames.join('、')) : ''}</div>`;
    if (layer) {
      const lr = layer.getBoundingClientRect();
      node.style.left = lr.width / 2 + 'px';
      node.style.top = lr.height / 2 + 'px';
      layer.appendChild(node);
    } else {
      stage.appendChild(node);
    }
    setTimeout(() => node.remove(), 1600);
  }

  /** 处理服务端推送的动画/音效事件 */
  function handleFX(fx) {
    if (!fx) return;
    const mySeat = state.game && state.game.me ? state.game.me.seat : -1;
    window.SGS_Sound && window.SGS_Sound.fx(fx, mySeat);

    switch (fx.type) {
      case 'play':
      case 'respond':
        showPlayedCard(fx);
        break;
      case 'damage':
        flashSeat(fx.seat, 'hit');
        floatText(fx.seat, '-' + fx.amount, 'dmg');
        break;
      case 'heal':
        flashSeat(fx.seat, 'heal');
        floatText(fx.seat, '+' + fx.amount, 'heal');
        break;
      case 'die':
        flashSeat(fx.seat, 'dying');
        floatText(fx.seat, '阵亡', 'dmg');
        break;
      case 'judge':
        showPlayedCard({ card: fx.card, seat: fx.seat, targets: [] });
        break;
      case 'skill':
        floatText(fx.seat, fx.cn || '技能', 'heal');
        break;
      case 'equip':
        showPlayedCard({ seat: fx.seat, card: fx.card, targets: [] });
        break;
      case 'dying':
        if (fx.seat === mySeat) toast('你已进入濒死状态，等待他人救援');
        else floatText(fx.seat, '濒死', 'dmg');
        break;
      case 'turn':
        if (fx.seat === mySeat) toast('轮到你的回合');
        break;
      default:
        break;
    }
  }

  function renderGame() {
    const g = state.game;
    if (!g || !g.me) return;
    show('game');

    $('#g-round').textContent = `第 ${g.round} 轮`;
    $('#g-phase').textContent = PHASE_CN[g.phase] || g.phase;
    const myRole = g.me.role;
    $('#g-role').innerHTML = `我的身份：<b style="color:${roleColor(myRole)}">${ROLE_CN[myRole]}</b> <span class="muted">${GOAL[myRole] || ''}</span>`;

    // 所有玩家环绕在屏幕四周
    renderSeatRing(g);

    // 中央：牌堆 / 出牌舞台 / 弃牌区
    $('#tc-draw-count').textContent = g.drawPileCount;
    $('#tc-discard-count').textContent = g.discardCount;

    // 日志
    const list = $('#log-list');
    list.innerHTML = g.logs.map((l) => `<div>${esc(l.text)}</div>`).join('');
    list.scrollTop = list.scrollHeight;

    renderSelf(g);
    renderPrompt(g);

    if (g.over) showResult(g);
  }

  function roleColor(r) {
    return { lord: '#f0c419', loyal: '#4aa3ff', rebel: '#e5484d', rene: '#9a6bff' }[r] || '#8ba79c';
  }

  function renderSelf(g) {
    const me = g.players[g.me.seat];
    const p = g.pending;
    const isTurn = p && p.kind === 'turn';
    const sel = state.sel;

    const hand = g.me.hand.map((c) => {
      let cls = '';
      if (sel && (sel.uid === c.uid || sel.extra.includes(c.uid))) cls = 'selected';
      else if (sel && isTurn) cls = 'dim';
      return cardHtml(c, cls);
    }).join('');

    const skills = (me.skills || []).filter((s) => s.type === 'active' || s.type === 'lord');
    const skillAvailable = isTurn && p.actions ? p.actions.filter((a) => a.type === 'skill').map((a) => a.skill) : [];

    $('#self-area').innerHTML = `
      <div class="self-top">
        <span class="me-hero">${esc(me.hero ? me.hero.name : '')}</span>
        <span class="me-tag">体力 <b style="color:#ff8a8a">${me.hp}</b>/${me.maxHp}</span>
        <span class="me-tag">手牌 ${g.me.hand.length}</span>
        <span class="me-tag">攻击范围 ${me.attackRange}</span>
        <span class="me-tag">身份 ${ROLE_CN[g.me.role]}</span>
        ${me.dead ? '<span class="me-tag">已阵亡</span>' : ''}
      </div>
      <div class="me-equips">${equipMinis(me.equip, true) || '<span class="muted">（无装备）</span>'}</div>
      <div class="skill-btns">
        ${skills.map((s) => `<button class="btn btn-xs ${skillAvailable.includes(s.id) ? 'btn-gold' : ''}" ${skillAvailable.includes(s.id) ? '' : 'disabled'} data-skill="${s.id}" title="${esc(s.desc)}">${esc(s.cn)}</button>`).join('')}
      </div>
      <div class="hand-row" id="hand-row">${hand || '<span class="muted">（没有手牌）</span>'}</div>
    `;
  }

  /* ---------- 出牌交互 ---------- */
  function actionsFor(uid) {
    const p = state.game.pending;
    if (!p || p.kind !== 'turn' || !p.actions) return [];
    return p.actions.filter((a) => a.type === 'card' && (a.cardId === uid || (!a.cardId && (a.need || 1) > 1)));
  }

  function onCardClick(uid) {
    const g = state.game;
    const p = g.pending;
    if (!p || p.kind !== 'turn') return;
    // 多选（丈八蛇矛）
    if (state.sel && state.sel.action && (state.sel.action.need || 1) > 1) {
      const need = state.sel.action.need;
      if (state.sel.uid && state.sel.extra.length < need - 1 && uid !== state.sel.uid && !state.sel.extra.includes(uid)) {
        state.sel.extra.push(uid);
        renderGame();
        return;
      }
    }
    const acts = actionsFor(uid);
    if (!acts.length) return;
    if (acts.length === 1) {
      startAction(uid, acts[0]);
    } else {
      state.sel = { uid, as: null, action: null, extra: [], targets: [], options: acts };
      renderGame();
    }
  }

  function startAction(uid, action) {
    state.sel = { uid, as: action.as, action, extra: [], targets: [], options: null };
    renderGame();
  }

  function cancelSel() { state.sel = null; renderGame(); }

  function selReady() {
    const s = state.sel;
    if (!s || !s.action) return false;
    const a = s.action;
    const need = a.need || 1;
    if (need > 1 && (1 + s.extra.length) < need) return false;
    if ((a.min || 0) > 0 && s.targets.length < a.min) return false;
    return true;
  }

  function doPlay() {
    const s = state.sel;
    if (!s || !selReady()) return;
    const payload = { type: 'card', as: s.as, cardId: s.uid || null, targets: s.targets, extraCards: s.extra };
    state.sel = null;
    window.SGS_Sound && window.SGS_Sound.play('click');
    socket.emit('game:action', payload);
  }

  function onSeatClick(seat) {
    const g = state.game;
    const p = g.pending;
    if (!p) return;
    if (p.kind === 'choose' && p.style === 'players') {
      sendRespond({ ids: [String(seat)] });
      return;
    }
    if (p.kind === 'turn' && state.sel && state.sel.action) {
      const a = state.sel.action;
      if (!a.targets || !a.targets.includes(seat)) return;
      const i = state.sel.targets.indexOf(seat);
      if (i >= 0) state.sel.targets.splice(i, 1);
      else {
        if (state.sel.targets.length >= (a.max || 1)) state.sel.targets.shift();
        state.sel.targets.push(seat);
      }
      renderGame();
    }
  }

  function sendRespond(payload) {
    state.chooseSel = [];
    socket.emit('game:respond', payload);
  }

  /* ---------- 提示区 ---------- */
  function renderPrompt(g) {
    const p = g.pending;
    const box = $('#prompt');
    if (!p) {
      box.innerHTML = '';
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    // 新的一次请求：清空上一次的临时选择
    if (p.id !== state.lastReqId) {
      state.lastReqId = p.id;
      state.chooseSel = [];
      state.sel = null;
      if (p.kind === 'guanxing') state.gx = { top: [] };
    }

    if (p.kind === 'turn') return renderTurnPrompt(g, p);
    if (p.kind === 'respond') return renderRespondPrompt(g, p);
    if (p.kind === 'choose') return renderChoosePrompt(g, p);
    if (p.kind === 'guanxing') return renderGuanxingPrompt(g, p);
    box.innerHTML = '';
  }

  function renderTurnPrompt(g, p) {
    const s = state.sel;
    const box = $('#prompt');
    let title = '你的回合 · 请出牌';
    let body = '';

    if (s && !s.as && s.options) {
      title = '选择该牌的用法';
      body = s.options.map((a, i) => `<div class="p-card" data-as="${i}">作为【${esc(cardCn(a.as))}】</div>`).join('');
      body += `<div class="p-act"><button class="btn btn-sm" data-act="cancel">取消</button></div>`;
    } else if (s && s.action) {
      const a = s.action;
      const need = a.need || 1;
      if (need > 1 && (1 + s.extra.length) < need) {
        title = `【${esc(cardCn(a.as))}】还需选择 ${need - 1 - s.extra.length} 张手牌`;
      } else if ((a.min || 0) > 0 && s.targets.length < a.min) {
        title = `请选择目标（${s.targets.length}/${a.min}${a.max > 1 ? '，最多' + a.max : ''}）`;
      } else {
        title = `已选择【${esc(cardCn(a.as))}】${s.targets.length ? ' → ' + s.targets.map((t) => esc(g.players[t].name)).join('、') : ''}`;
      }
      const ok = selReady();
      body = `<button class="btn btn-gold" data-act="play" ${ok ? '' : 'disabled'}>确定出牌</button>`;
      body += `<button class="btn btn-sm" data-act="cancel">取消</button>`;
    }
    body += `<div class="p-act"><button class="btn btn-sm" data-act="endturn">结束回合</button></div>`;
    box.innerHTML = `<div class="p-title">${title}</div><div class="p-body">${body}</div>`;
  }

  function cardCn(name) {
    const MAP = {
      slash: '杀', jink: '闪', peach: '桃', wine: '酒', duel: '决斗', invasion: '南蛮入侵', arrows: '万箭齐发',
      snatch: '顺手牵羊', dismantle: '过河拆桥', abundance: '无中生有', harvest: '五谷丰登', orchard: '桃园结义',
      borrow: '借刀杀人', wuxie: '无懈可击', lebu: '乐不思蜀', lightning: '闪电',
      crossbow: '诸葛连弩', qinggang: '青釭剑', shuanggu: '雌雄双股剑', guanshi: '贯石斧', qinglong: '青龙偃月刀',
      zhangba: '丈八蛇矛', fangtian: '方天画戟', qilin: '麒麟弓', bagua: '八卦阵', renwang: '仁王盾',
      dilu: '的卢', jueying: '绝影', zhuahuang: '爪黄飞电', chitu: '赤兔', zixun: '紫骍', dayuan: '大宛',
    };
    return MAP[name] || name;
  }

  function renderRespondPrompt(g, p) {
    const body = (p.choices || []).map((c) => {
      const label = c.card ? `${esc(c.card.text)}` : esc(c.label);
      return `<div class="p-card" data-resp="${esc(c.id)}">${label}</div>`;
    }).join('');
    const pass = `<div class="p-act"><button class="btn btn-sm" data-act="pass">放弃</button></div>`;
    $('#prompt').innerHTML = `<div class="p-title">${esc(p.prompt || '请选择')}</div><div class="p-body">${body}${pass}</div>`;
  }

  function renderChoosePrompt(g, p) {
    const box = $('#prompt');
    const sel = state.chooseSel;
    if (p.style === 'players') {
      const body = (p.choices || []).map((c) => `<div class="p-card" data-pick="${esc(c.id)}">${esc(c.label)}</div>`).join('');
      const pass = p.optional ? `<div class="p-act"><button class="btn btn-sm" data-act="pass">放弃</button></div>` : '';
      box.innerHTML = `<div class="p-title">${esc(p.prompt)}</div><div class="p-body">${body}${pass}</div>`;
      return;
    }
    if (p.style === 'suits') {
      const body = (p.choices || []).map((c) => `<div class="p-card" data-pick="${esc(c.id)}">${esc(c.label)}</div>`).join('');
      box.innerHTML = `<div class="p-title">${esc(p.prompt)}</div><div class="p-body">${body}</div>`;
      return;
    }
    if (p.style === 'options') {
      const body = (p.choices || []).map((c) => `<div class="p-card" data-pick="${esc(c.id)}">${esc(c.label)}</div>`).join('');
      const pass = p.optional ? `<div class="p-act"><button class="btn btn-sm" data-act="pass">放弃</button></div>` : '';
      box.innerHTML = `<div class="p-title">${esc(p.prompt)}</div><div class="p-body">${body}${pass}</div>`;
      return;
    }
    // cards / mixed
    const chips = (p.choices || []).map((c) => {
      const on = sel.includes(c.id);
      if (c.card) {
        return `<div class="p-chip ${c.card.color === 'red' ? 'red' : 'black'} ${on ? 'sel' : ''}" data-pick="${esc(c.id)}" title="${esc(c.card.desc)}">
          <div class="c-top"><span>${SUIT[c.card.suit]}</span><span>${NUM[c.card.num] || c.card.num}</span></div>
          <div class="c-name">${esc(c.card.cn)}</div></div>`;
      }
      return `<div class="p-card ${on ? 'sel' : ''}" data-pick="${esc(c.id)}">${esc(c.label)}</div>`;
    }).join('');
    const ok = sel.length >= (p.min || 1);
    const pass = p.optional ? `<button class="btn btn-sm" data-act="pass">放弃</button>` : '';
    box.innerHTML = `<div class="p-title">${esc(p.prompt)} <span class="muted">（已选 ${sel.length}/${p.min || 1}${p.max > 1 ? '~' + p.max : ''}）</span></div>
      <div class="p-body">${chips}<div class="p-act"><button class="btn btn-gold" data-act="confirm" ${ok ? '' : 'disabled'}>确定</button>${pass}</div></div>`;
  }

  function renderGuanxingPrompt(g, p) {
    const top = state.gx.top;
    const cards = p.cards || [];
    const chip = (c) => `<div class="p-chip ${c.color === 'red' ? 'red' : 'black'}" data-gx="${c.uid}" title="${esc(c.desc)}">
      <div class="c-top"><span>${SUIT[c.suit]}</span><span>${NUM[c.num] || c.num}</span></div>
      <div class="c-name">${esc(c.cn)}</div></div>`;
    const tops = cards.filter((c) => top.includes(c.uid));
    const bots = cards.filter((c) => !top.includes(c.uid));
    $('#prompt').innerHTML = `<div class="p-title">${esc(p.prompt)}</div>
      <div class="gx-wrap">
        <div class="gx-col"><h5>牌堆顶（先摸到，按点击顺序）</h5><div class="gx-items">${tops.map(chip).join('') || '<span class="muted">点击右侧牌移到这里</span>'}</div></div>
        <div class="gx-col"><h5>牌堆底</h5><div class="gx-items">${bots.map(chip).join('')}</div></div>
      </div>
      <div class="p-body" style="margin-top:8px"><div class="p-act"><button class="btn btn-gold" data-act="gxok">确定</button><button class="btn btn-sm" data-act="pass">跳过</button></div></div>`;
  }

  /* ---------- 事件委托 ---------- */
  document.addEventListener('click', (e) => {
    // 查看卡牌效果（手牌右上角 ? 或任意装备 / 判定牌标签）
    const infoCard = e.target.closest('[data-info-card]');
    if (infoCard) { e.stopPropagation(); showCardInfo(infoCard.dataset.infoCard); return; }

    // 查看对手武将技能
    const infoHero = e.target.closest('[data-info-hero]');
    if (infoHero) { e.stopPropagation(); showHeroInfo(Number(infoHero.dataset.infoHero)); return; }

    const card = e.target.closest('#hand-row .card');
    if (card) { onCardClick(card.dataset.uid); return; }

    const seat = e.target.closest('#seat-ring .seat');
    if (seat) { onSeatClick(Number(seat.dataset.seat)); return; }

    const skillBtn = e.target.closest('[data-skill]');
    if (skillBtn && !skillBtn.disabled) {
      socket.emit('game:action', { type: 'skill', skill: skillBtn.dataset.skill });
      state.sel = null;
      return;
    }

    const asBtn = e.target.closest('[data-as]');
    if (asBtn && state.sel && state.sel.options) {
      const a = state.sel.options[Number(asBtn.dataset.as)];
      startAction(state.sel.uid, a);
      return;
    }

    const resp = e.target.closest('[data-resp]');
    if (resp) { sendRespond({ ids: [resp.dataset.resp] }); return; }

    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const id = pick.dataset.pick;
      const p = state.game && state.game.pending;
      if (!p) return;
      if (p.style === 'options' || p.style === 'players' || p.style === 'suits') {
        sendRespond({ ids: [id] });
        return;
      }
      const i = state.chooseSel.indexOf(id);
      if (i >= 0) state.chooseSel.splice(i, 1);
      else {
        if (state.chooseSel.length >= (p.max || 1)) state.chooseSel.shift();
        state.chooseSel.push(id);
      }
      renderPrompt(state.game);
      return;
    }

    const gx = e.target.closest('[data-gx]');
    if (gx) {
      const uid = gx.dataset.gx;
      const i = state.gx.top.indexOf(uid);
      if (i >= 0) state.gx.top.splice(i, 1);
      else state.gx.top.push(uid);
      renderPrompt(state.game);
      return;
    }

    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'cancel') cancelSel();
      else if (a === 'play') doPlay();
      else if (a === 'endturn') { state.sel = null; socket.emit('game:action', { type: 'end' }); }
      else if (a === 'pass') sendRespond(null);
      else if (a === 'confirm') sendRespond({ ids: state.chooseSel.slice() });
      else if (a === 'gxok') sendRespond({ top: state.gx.top.slice() });
      return;
    }
  });

  function setLog(open) {
    state.logOpen = open;
    $('#log-panel').classList.toggle('show', open);
  }
  $('#btn-toggle-log').addEventListener('click', () => {
    setLog(!state.logOpen);
    window.SGS_Sound && window.SGS_Sound.play('click');
  });
  $('#btn-close-log').addEventListener('click', () => setLog(false));

  /* ---------- 音效开关 ---------- */
  function refreshSoundBtn() {
    const muted = window.SGS_Sound ? window.SGS_Sound.isMuted() : false;
    const btn = $('#btn-sound');
    btn.textContent = muted ? '🔇 已静音' : '🔊 音效';
    btn.classList.toggle('btn-gold', !muted);
  }
  $('#btn-sound').addEventListener('click', () => {
    if (!window.SGS_Sound) return;
    window.SGS_Sound.toggle();
    refreshSoundBtn();
    window.SGS_Sound.play('click');
  });
  refreshSoundBtn();
  $('#btn-quit-game').addEventListener('click', () => {
    socket.emit('room:leave');
    state.room = null; state.game = null;
    show('home');
  });

  /* ---------- 结算 ---------- */
  function showResult(g) {
    const isHost = state.room && state.room.you && state.room.you.isHost;
    $('#result-title').textContent = `${g.winnerCn || ''}获胜！`;
    $('#result-title').style.color = g.winner === 'rebel' ? '#e5484d' : g.winner === 'rene' ? '#9a6bff' : '#f0c419';
    const group = g.winner === 'lord' ? ['lord', 'loyal'] : [g.winner];
    $('#result-body').innerHTML = g.players.map((p) => `
      <div class="res-row ${group.includes(p.role) ? 'win' : ''}">
        <span>${esc(p.name)}${p.isAI ? '（人机）' : ''} · ${p.hero ? esc(p.hero.name) : '-'}</span>
        <span style="color:${roleColor(p.role)}">${ROLE_CN[p.role]}${p.dead ? ' · 阵亡' : ''}</span>
      </div>`).join('');
    $('#btn-rematch').style.display = isHost ? 'block' : 'none';
    $('#modal-result').classList.add('show');
  }
  $('#btn-rematch').addEventListener('click', () => {
    socket.emit('room:backToLobby');
    $('#modal-result').classList.remove('show');
  });
  $('#btn-back-room').addEventListener('click', () => {
    $('#modal-result').classList.remove('show');
    if (state.room) show('room');
  });

  /* ================= 网络 ================= */
  socket.on('connect', () => {
    // 断线重连后自动回到房间
    if (state.room) socket.emit('room:join', { roomId: state.room.id, clientId: state.clientId, name: state.name }, () => {});
  });

  socket.on('room', (data) => {
    state.room = data;
    if (data.status === 'playing' && state.game) {
      renderRoom();
      return;
    }
    if (data.status === 'over' && state.game) { renderRoom(); return; }
    $('#modal-result').classList.remove('show');
    renderRoom();
    if (!state.game || data.status !== 'playing') { state.game = null; show('room'); }
  });

  socket.on('game', (data) => {
    state.game = data;
    if (data.over) { renderGame(); return; }
    $('#modal-result').classList.remove('show');
    renderGame();
  });

  // 动画 / 音效事件
  socket.on('fx', (fx) => handleFX(fx));

  socket.on('toast', (d) => toast(d && d.text ? d.text : String(d)));
  socket.on('disconnect', () => toast('与服务器断开连接'));

  /* ================= 调试 / 自动化测试入口 ================= */
  // 供浏览器控制台调试与 tools/test-ui.js 无头测试驱动渲染，不参与游戏逻辑。
  window.SGS = {
    state,
    socket,
    renderRoom,
    renderGame,
    handleFX,
    showCardInfo,
    showHeroInfo,
    setRoom(r) { state.room = r; renderRoom(); },
    setGame(g) { state.game = g; renderGame(); },
    seatPosition,
  };
})();
