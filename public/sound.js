/**
 * 游戏音效：使用 Web Audio API 实时合成，无需任何音频文件。
 * 浏览器要求首次交互后才能播放，故在第一次用户手势时自动解锁。
 * 全局对象：window.SGS_Sound
 */
(function () {
  'use strict';

  const KEY = 'sgs_muted';
  let ctx = null;
  let master = null;
  let muted = localStorage.getItem(KEY) === '1';
  let unlocked = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.34;
    master.connect(ctx.destination);
    return ctx;
  }

  function unlock() {
    if (unlocked) return;
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    unlocked = true;
  }

  function ready() {
    if (muted) return null;
    const c = ensure();
    if (!c) return null;
    if (c.state === 'suspended') c.resume();
    return c;
  }

  /** 单个音符（可带滑音） */
  function tone(o) {
    const c = ready();
    if (!c) return;
    const t0 = c.currentTime + (o.delay || 0);
    const dur = o.dur || 0.15;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + dur);
    const peak = (o.gain == null ? 0.5 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 噪声（用于“挥牌/命中”等质感） */
  function noise(o) {
    const c = ready();
    if (!c) return;
    const t0 = c.currentTime + (o.delay || 0);
    const dur = o.dur || 0.18;
    const frames = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = o.filterType || 'bandpass';
    filter.frequency.setValueAtTime(o.freq || 1200, t0);
    if (o.freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(60, o.freqEnd), t0 + dur);
    filter.Q.value = o.q == null ? 1.1 : o.q;
    const g = c.createGain();
    g.gain.setValueAtTime(o.gain == null ? 0.4 : o.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  const SFX = {
    click() { tone({ freq: 720, dur: 0.05, type: 'square', gain: 0.18 }); },
    select() { tone({ freq: 520, freqEnd: 880, dur: 0.09, type: 'triangle', gain: 0.26 }); },
    cancel() { tone({ freq: 460, freqEnd: 260, dur: 0.1, type: 'triangle', gain: 0.22 }); },
    // 出牌：纸张摩擦 + 轻微上扬
    card() {
      noise({ freq: 900, freqEnd: 2600, dur: 0.16, gain: 0.3, q: 0.8 });
      tone({ freq: 420, freqEnd: 700, dur: 0.1, type: 'triangle', gain: 0.16 });
    },
    equip() {
      tone({ freq: 400, freqEnd: 620, dur: 0.12, type: 'sine', gain: 0.24 });
      noise({ freq: 1800, freqEnd: 900, dur: 0.1, gain: 0.16 });
    },
    // 杀：破空声
    slash() {
      noise({ freq: 3200, freqEnd: 500, dur: 0.16, gain: 0.42, filterType: 'highpass', q: 0.7 });
    },
    // 闪：清脆格挡
    jink() {
      tone({ freq: 1500, freqEnd: 2200, dur: 0.1, type: 'square', gain: 0.16 });
      noise({ freq: 3600, freqEnd: 1800, dur: 0.08, gain: 0.2, filterType: 'highpass' });
    },
    // 受到伤害：低频撞击
    damage() {
      tone({ freq: 180, freqEnd: 55, dur: 0.3, type: 'sine', gain: 0.6 });
      noise({ freq: 500, freqEnd: 120, dur: 0.22, gain: 0.34, filterType: 'lowpass' });
    },
    // 回血：上行三音
    heal() {
      tone({ freq: 523, dur: 0.11, type: 'sine', gain: 0.26 });
      tone({ freq: 659, dur: 0.11, type: 'sine', gain: 0.24, delay: 0.08 });
      tone({ freq: 784, dur: 0.18, type: 'sine', gain: 0.24, delay: 0.16 });
    },
    // 阵亡：下行
    die() {
      tone({ freq: 320, freqEnd: 70, dur: 0.7, type: 'sawtooth', gain: 0.34 });
      noise({ freq: 700, freqEnd: 100, dur: 0.5, gain: 0.22, filterType: 'lowpass', delay: 0.05 });
    },
    // 判定
    judge() {
      tone({ freq: 1000, dur: 0.07, type: 'square', gain: 0.16 });
      tone({ freq: 1250, dur: 0.09, type: 'square', gain: 0.14, delay: 0.09 });
    },
    // 轮到自己
    turn() {
      tone({ freq: 660, dur: 0.12, type: 'sine', gain: 0.24 });
      tone({ freq: 990, dur: 0.22, type: 'sine', gain: 0.2, delay: 0.1 });
    },
    // 需要你响应
    alert() {
      tone({ freq: 880, dur: 0.09, type: 'square', gain: 0.2 });
      tone({ freq: 880, dur: 0.09, type: 'square', gain: 0.2, delay: 0.15 });
      tone({ freq: 880, dur: 0.12, type: 'square', gain: 0.2, delay: 0.3 });
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.24, type: 'triangle', gain: 0.28, delay: i * 0.11 }));
    },
    lose() {
      [523, 440, 349, 262].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'sine', gain: 0.24, delay: i * 0.14 }));
    },
    join() {
      tone({ freq: 600, dur: 0.08, type: 'sine', gain: 0.2 });
      tone({ freq: 900, dur: 0.14, type: 'sine', gain: 0.18, delay: 0.07 });
    },
    start() {
      [392, 523, 659].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'triangle', gain: 0.22, delay: i * 0.09 }));
    },
  };

  const EQUIP_CARDS = {
    crossbow: 1, qinggang: 1, shuanggu: 1, guanshi: 1, qinglong: 1, zhangba: 1, fangtian: 1, qilin: 1,
    bagua: 1, renwang: 1, dilu: 1, jueying: 1, zhuahuang: 1, chitu: 1, zixun: 1, dayuan: 1,
  };

  /** 根据游戏事件自动挑选音效 */
  function forFX(fx, mySeat) {
    switch (fx.type) {
      case 'play':
      case 'respond': {
        const as = fx.as;
        if (as === 'slash') return 'slash';
        if (as === 'jink') return 'jink';
        if (as === 'peach') return 'heal';
        if (EQUIP_CARDS[as]) return 'equip';
        return 'card';
      }
      case 'damage': return 'damage';
      case 'heal': return 'heal';
      case 'die': return 'die';
      case 'judge': return 'judge';
      case 'skill': return 'select';
      case 'equip':
      case 'unequip': return 'equip';
      case 'draw':
      case 'discard': return 'card';
      // 只有自己濒死时才提示，避免他人回合频繁打扰
      case 'dying': return fx.seat === mySeat ? 'alert' : null;
      case 'turn': return fx.seat === mySeat ? 'turn' : null;
      default: return null;
    }
  }

  const api = {
    unlock,
    play(name) {
      if (muted || !name) return;
      const fn = SFX[name];
      if (fn) { unlock(); fn(); }
    },
    /** 由服务端 fx 事件驱动播放 */
    fx(fx, mySeat) {
      if (!fx) return;
      if (fx.type === 'over') {
        api.play(fx.winner === 'rebel' ? 'lose' : 'win');
        return;
      }
      api.play(forFX(fx, mySeat));
    },
    isMuted: () => muted,
    setMuted(v) {
      muted = !!v;
      localStorage.setItem(KEY, muted ? '1' : '0');
      return muted;
    },
    toggle() { return api.setMuted(!muted); },
  };

  // 首次交互解锁音频上下文
  const once = () => { unlock(); window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once); };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);

  window.SGS_Sound = api;
})();
