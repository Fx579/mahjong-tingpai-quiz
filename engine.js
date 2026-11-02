/*
 * 麻将胡牌 / 听牌判定引擎
 * 规则（国标/常见地方规则的基础形式）：
 *  - 胡牌：14 张牌 = 4 组面子（顺子/刻子）+ 1 对将；
 *          或 七对（7 个对子，允许 4 张相同计为两对）；
 *          或 十三幺（13 种幺九牌各一张 + 其中一种成对）。
 *  - 听牌：13 张牌，存在至少一张牌使其成为胡牌。
 *  - 多面听：听牌时等待的牌种 >= 2。
 *
 * 牌编码 0..33：
 *  0-8   一万..九万
 *  9-17  一筒..九筒
 *  18-26 一条..九条
 *  27-33 东 南 西 北 中 发 白
 */
(function (global) {
  'use strict';

  const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const SUIT_CN = ['万', '筒', '条'];
  const HONORS = ['东', '南', '西', '北', '中', '发', '白'];
  const TERMINALS_HONORS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

  function tileName(id) {
    if (id < 27) return NUM_CN[id % 9] + SUIT_CN[(id / 9) | 0];
    return HONORS[id - 27];
  }

  /* ---------- 胡牌判定 ---------- */

  // 把剩余牌全部拆成面子（顺子/刻子）
  function meldsOk(c) {
    let i = 0;
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) return true; // 全部拆完
    if (c[i] >= 3) {           // 尝试刻子
      c[i] -= 3;
      const ok = meldsOk(c);
      c[i] += 3;
      if (ok) return true;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) { // 尝试顺子
      c[i]--; c[i + 1]--; c[i + 2]--;
      const ok = meldsOk(c);
      c[i]++; c[i + 1]++; c[i + 2]++;
      if (ok) return true;
    }
    return false;
  }

  // 4 面子 + 1 将
  function winStandard(counts) {
    const c = counts.slice();
    for (let p = 0; p < 34; p++) {
      if (c[p] >= 2) {
        c[p] -= 2;
        const ok = meldsOk(c);
        c[p] += 2;
        if (ok) return true;
      }
    }
    return false;
  }

  // 七对（4 张相同视为两对）
  function winSevenPairs(counts) {
    let pairs = 0;
    for (let i = 0; i < 34; i++) {
      if (counts[i] === 1 || counts[i] === 3) return false;
      pairs += counts[i] / 2;
    }
    return pairs === 7;
  }

  // 十三幺
  function winThirteenOrphans(counts) {
    const set = new Set(TERMINALS_HONORS);
    let total = 0, hasPair = false;
    for (let i = 0; i < 34; i++) {
      const n = counts[i];
      if (n === 0) continue;
      if (!set.has(i)) return false;
      if (n === 2) { if (hasPair) return false; hasPair = true; }
      else if (n !== 1) return false;
      total += n;
    }
    return total === 14 && hasPair;
  }

  function canWin(counts) {
    let total = 0;
    for (let i = 0; i < 34; i++) {
      if (counts[i] < 0 || counts[i] > 4) return false;
      total += counts[i];
    }
    if (total !== 14) return false;
    return winStandard(counts) || winSevenPairs(counts) || winThirteenOrphans(counts);
  }

  /* ---------- 听牌 / 多面听 ---------- */

  // 13 张牌，返回所有能胡的牌（听牌张）
  function getWaits(counts13) {
    const waits = [];
    for (let t = 0; t < 34; t++) {
      if (counts13[t] >= 4) continue;
      counts13[t]++;
      if (canWin(counts13)) waits.push(t);
      counts13[t]--;
    }
    return waits;
  }

  /* ---------- 出题 ---------- */

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randInt(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
  function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(rng, 0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function expand(counts) {
    const tiles = [];
    for (let i = 0; i < 34; i++) for (let k = 0; k < counts[i]; k++) tiles.push(i);
    return tiles;
  }

  // 随机生成一手 14 张的胡牌；suit 为 0/1/2 时限定单一花色（困难），null 为混花色（一般）
  function genWinningCounts(rng, suit) {
    const kind = rng();
    const c = new Array(34).fill(0);
    const lo = suit == null ? 0 : suit * 9;
    const hi = suit == null ? 33 : suit * 9 + 8;
    if (suit == null && kind < 0.04) { // 十三幺（仅混花色）
      const dup = TERMINALS_HONORS[randInt(rng, 0, 12)];
      for (const t of TERMINALS_HONORS) c[t]++;
      c[dup]++;
      return c;
    }
    if (kind < 0.16) { // 七对
      const pool = shuffle(rng, Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
      if (pool.length < 7) return null;
      for (let i = 0; i < 7; i++) c[pool[i]] += 2;
      return c;
    }
    // 4 面子 + 1 将
    c[randInt(rng, lo, hi)] += 2;
    let guard = 0;
    for (let m = 0; m < 4; m++) {
      let placed = false;
      while (!placed && guard++ < 200) {
        if (rng() < 0.45) { // 刻子
          const t = randInt(rng, lo, hi);
          if (c[t] <= 1) { c[t] += 3; placed = true; }
        } else {           // 顺子
          let s;
          if (suit == null) {
            s = randInt(rng, 0, 26);
            if (s % 9 > 6) continue;
          } else {
            s = randInt(rng, lo, lo + 6);
          }
          if (c[s] <= 3 && c[s + 1] <= 3 && c[s + 2] <= 3) {
            c[s]++; c[s + 1]++; c[s + 2]++; placed = true;
          }
        }
      }
      if (!placed) return null;
    }
    return c;
  }

  // 从胡牌中打掉一张，得到多面听的 13 张手牌
  function genTingHand(rng, suit, minW = 2, maxW = 8, maxTries = 400) {
    for (let i = 0; i < maxTries; i++) {
      const w = genWinningCounts(rng, suit);
      if (!w) continue;
      const order = shuffle(rng, [...new Set(expand(w))]);
      for (const t of order) {
        const c = w.slice(); c[t]--;
        const waits = getWaits(c);
        if (waits.length >= minW && waits.length <= maxW) return { counts: c, waits };
      }
    }
    return null;
  }

  function buildOptions(waits, rng, target = 10) {
    const set = new Set(waits);
    const opts = waits.slice();
    const pool = [];
    for (let t = 0; t < 34; t++) if (!set.has(t)) pool.push(t);
    const need = Math.max(0, Math.min(target, 34) - opts.length);
    return shuffle(rng, opts.concat(shuffle(rng, pool).slice(0, need)));
  }

  function waitLabel(n) {
    if (n <= 1) return '单面听';
    if (n === 2) return '两面听';
    if (n === 3) return '三面听';
    if (n === 4) return '四面听';
    if (n === 9) return '九面听';
    if (n === 13) return '十三面听';
    return n + ' 面听';
  }

  // 经典多面听牌型（九莲宝灯为纯花色 → 困难；十三幺混花色 → 一般）
  const CURATED = [
    { key: 'jiulian', name: '九莲宝灯', diff: 'hard', counts: (() => {
        const c = new Array(34).fill(0);
        c[0] = 3; for (let i = 1; i <= 7; i++) c[i] = 1; c[8] = 3;
        return c;
      })() },
    { key: 'shisanyao', name: '十三幺', diff: 'normal', counts: (() => {
        const c = new Array(34).fill(0);
        for (const t of TERMINALS_HONORS) c[t] = 1;
        return c;
      })() }
  ];

  function curatedQuestion(item) {
    const waits = getWaits(item.counts.slice());
    return {
      title: item.name,
      counts: item.counts.slice(),
      hand: expand(item.counts).sort((a, b) => a - b),
      waits,
      options: waits.slice(),
      label: waitLabel(waits.length) + '（' + item.name + '）'
    };
  }

  function makeQuestion(rng, suit) {
    const g = genTingHand(rng, suit);
    if (!g) return null;
    return {
      title: null,
      counts: g.counts,
      hand: expand(g.counts).sort((a, b) => a - b),
      waits: g.waits,
      options: buildOptions(g.waits, rng),
      label: waitLabel(g.waits.length)
    };
  }

  // 一轮题目：难度 'normal'=混花色，'hard'=同一花色；经典牌型 + 随机多面听，去重后打乱
  function makeRound(count, seed, difficulty) {
    const rng = mulberry32(seed);
    const diff = difficulty === 'hard' ? 'hard' : 'normal';
    const qs = CURATED.filter(it => it.diff === diff).map(curatedQuestion);
    const seen = new Set(qs.map(q => q.hand.join(',')));
    let guard = 0;
    while (qs.length < count && guard++ < 200) {
      const suit = diff === 'hard' ? randInt(rng, 0, 2) : null;
      const q = makeQuestion(rng, suit);
      if (!q) continue;
      const sig = q.hand.join(',');
      if (seen.has(sig)) continue;
      seen.add(sig);
      qs.push(q);
    }
    return shuffle(rng, qs).slice(0, count);
  }

  const MahjongEngine = {
    NUM_CN, SUIT_CN, HONORS, TERMINALS_HONORS,
    tileName, canWin, getWaits, waitLabel,
    makeQuestion, makeRound, mulberry32
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MahjongEngine;
  global.MahjongEngine = MahjongEngine;
})(typeof window !== 'undefined' ? window : globalThis);
