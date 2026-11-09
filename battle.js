/* 麻将人机对战：1 玩家 + 3 AI，国标简化规则（吃碰杠胡、无番不胡、8 分为底）
   AI 纯逻辑分析：向听数 + 进张量 + 危险度（基于对手牌河与副露），不吃牌山。
   UI 参考雀魂：绿色牌桌、四家牌河环绕、右侧浮层操作按钮、吃牌组合选择弹窗。 */
(function (global) {
  "use strict";
  const E = global.MahjongEngine;
  if (!E) { console.error("battle.js 需要 MahjongEngine"); return; }
  const TN = E.tileName;
  const isHonor = t => t >= 27;
  const suitOf = t => t < 9 ? 0 : t < 18 ? 1 : t < 27 ? 2 : 3;
  const isTerm = t => t < 27 && (t % 9 === 0 || t % 9 === 8);

  /* ---------- 基础工具 ---------- */
  function counts(hand) { const c = new Array(34).fill(0); for (const t of hand) c[t]++; return c; }
  function expand(c) { const a = []; for (let t = 0; t < 34; t++) for (let i = 0; i < c[t]; i++) a.push(t); return a.sort((x, y) => x - y); }

  /* ---------- 向听数 ---------- */
  function stdShanten(c, melds) {
    const cap = 4 - melds;
    let best = 0;
    (function rec(i, M, P, pair) {
      const s = 2 * M + P + (pair ? 1 : 0);
      if (s > best) best = s;
      if (M + P >= cap && pair) return;
      for (let t = i; t < 34; t++) {
        if (!c[t]) continue;
        if (M + 1 + P <= cap) {
          if (c[t] >= 3) { c[t] -= 3; rec(t, M + 1, P, pair); c[t] += 3; }
          if (t < 27 && t % 9 <= 6 && c[t + 1] && c[t + 2]) { c[t]--; c[t + 1]--; c[t + 2]--; rec(t, M + 1, P, pair); c[t]++; c[t + 1]++; c[t + 2]++; }
        }
        if (M + P + 1 <= cap) {
          if (c[t] >= 2) {
            if (!pair) { c[t] -= 2; rec(t, M, P, true); c[t] += 2; }
            c[t] -= 2; rec(t, M, P + 1, pair); c[t] += 2;
          }
          if (t < 27 && t % 9 <= 7 && c[t + 1]) { c[t]--; c[t + 1]--; rec(t, M, P + 1, pair); c[t]++; c[t + 1]++; }
          if (t < 27 && t % 9 <= 6 && c[t + 2]) { c[t]--; c[t + 2]--; rec(t, M, P + 1, pair); c[t]++; c[t + 2]++; }
        }
      }
    })(0, 0, 0, false);
    return 8 - 2 * melds - best;
  }
  function shanten(c, melds) {
    let s = stdShanten(c, melds);
    if (melds === 0) {
      let pr = 0; for (let t = 0; t < 34; t++) pr += Math.floor(c[t] / 2);
      s = Math.min(s, 6 - pr);
      let d = 0, p2 = 0;
      for (const t of E.TERMINALS_HONORS) { if (c[t] > 0) d++; if (c[t] > 1) p2 = 1; }
      s = Math.min(s, 13 - d - p2);
    }
    return s;
  }
  function ukeire(c, melds, avail) {
    const s = shanten(c, melds); let u = 0;
    for (let t = 0; t < 34; t++) {
      if (avail && avail[t] <= 0) continue;
      if (c[t] >= 4) continue;
      c[t]++; const s2 = shanten(c, melds); c[t]--;
      if (s2 < s) u += avail ? avail[t] : 1;
    }
    return u;
  }

  /* ---------- 番数（国标子集，无番不胡） ---------- */
  function calcFan(c14, melds, ctx) {
    const ds = E.decomposeAll(c14);
    if (!ds.length) return { fan: 0, list: [] };
    const all = expand(c14);
    const suits = new Set(all.map(suitOf));
    const hasHonor = all.some(isHonor);
    const hasTerm = all.some(isTerm);
    const ds0 = ds[0];
    const ke = [];
    for (const m of melds) if (m.type !== 'chi') ke.push(m.tiles[0]);
    const stds = ds.filter(d => d.form === 'std');
    let closedKe = [];
    if (stds.length) closedKe = stds[0].groups.filter(g => g.type === 'ke').map(g => g.tiles[0]);
    const allKe = ke.concat(closedKe);
    const windKe = allKe.filter(t => t >= 27 && t <= 30);
    const drK = allKe.filter(t => t >= 31);
    const list = []; let fan = 0;
    const add = (n, s) => { if (n) { fan += n; list.push(s + ' +' + n); } };
    if (ds0.form === 'kokushi') add(88, '十三幺');
    else if (ds0.form === '7pairs') add(24, '七对');
    else {
      if (windKe.length === 4) add(88, '大四喜');
      else if (windKe.length === 3 && stds.length && stds[0].groups.some(g => g.type === 'jiang' && g.tiles[0] >= 27 && g.tiles[0] <= 30)) add(64, '小四喜');
      if (!hasHonor && suits.size === 1) add(24, '清一色');
      else if (hasHonor && suits.size === 2) add(6, '混一色');
      if (hasHonor && suits.size === 1) add(64, '字一色');
      const allChi = melds.every(m => m.type === 'chi') && stds.length &&
        stds[0].groups.every(g => g.type === 'shun' || (g.type === 'jiang' && g.tiles[0] < 27));
      if (allChi && ds0.form === 'std') add(16, '平和');
    }
    if (!hasTerm && !hasHonor) add(2, '断幺');
    add(2 * drK.length, drK.length ? '箭刻×' + drK.length : '');
    add(2 * windKe.filter(t => t === ctx.roundWind || t === ctx.seatWind).length, '风刻');
    if (ctx.selfDraw) add(1, '自摸');
    else if (melds.length === 0 && ds0.form !== '7pairs' && ds0.form !== 'kokushi') add(2, '门前清');
    if (ds0.form !== 'kokushi' && ds0.form !== '7pairs' && fan === 0) add(8, '无番和');
    return { fan, list };
  }

  /* ---------- 牌局状态 ---------- */
  const SEATS = ['你', '下家', '对家', '上家'];
  const LVCN = { easy: '初学', normal: '进阶', hard: '大师' };
  let G = null;
  function newGame(diff) {
    G = { diff, scores: [0, 0, 0, 0], dealer: 0, round: 0,
      names: ['你', '阿青', '阿蓝', '阿紫'], aiLevel: [null, diff, diff, diff] };
    startRound();
  }
  function startRound() {
    G.round++;
    const wall = [];
    for (let t = 0; t < 34; t++) for (let i = 0; i < 4; i++) wall.push(t);
    for (let i = wall.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [wall[i], wall[j]] = [wall[j], wall[i]]; }
    G.wall = wall;
    G.hands = [[], [], [], []]; G.melds = [[], [], [], []]; G.rivers = [[], [], [], []];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 13; k++) G.hands[i].push(G.wall.pop());
    for (let i = 0; i < 4; i++) G.hands[i].sort((a, b) => a - b);
    G.turn = G.dealer; G.phase = 'draw'; G.last = null; G.claim = null; G.chiSel = null;
    G.roundWind = 27;
    G.msg = '第 ' + G.round + ' 局 · ' + SEATS[G.dealer] + ' 做庄';
    drawTile();
  }
  function visibleCounts() {
    const v = new Array(34).fill(0);
    for (let p = 0; p < 4; p++) {
      for (const t of G.rivers[p]) v[t]++;
      for (const m of G.melds[p]) for (const t of m.tiles) v[t]++;
    }
    for (const t of G.hands[0]) v[t]++;
    return v;
  }
  function avail() { const v = visibleCounts(); return v.map(x => Math.max(0, 4 - x)); }

  function selfCtx(p) { return { selfDraw: true, roundWind: G.roundWind, seatWind: 27 + ((p - G.dealer + 4) % 4) }; }
  function gangOptions(p, c) {
    const res = [];
    for (let t = 0; t < 34; t++) {
      if (c[t] === 4) res.push({ t, type: 'angang' });
      if (c[t] >= 1) { const m = G.melds[p].find(x => x.type === 'peng' && x.tiles[0] === t); if (m) res.push({ t, type: 'jiagang', m }); }
    }
    return res;
  }

  function drawTile() {
    if (G.wall.length <= 8) { endRound(null, -1, true); return; }
    const p = G.turn;
    const t = G.wall.pop();
    G.hands[p].push(t);
    G.drawn = t;
    G.phase = 'discard';
    if (p === 0) {
      const c = counts(G.hands[0]);
      G.canWinSelf = E.canWin(c) && calcFan(c, G.melds[0], selfCtx(0)).fan > 0;
      G.canGangSelf = gangOptions(0, c);
      render();
    } else {
      render();
      setTimeout(() => aiTurn(p), 500);
    }
  }

  function doDiscard(p, t) {
    const i = G.hands[p].indexOf(t); if (i < 0) return;
    G.hands[p].splice(i, 1);
    if (p === 0) G.hands[0].sort((a, b) => a - b);
    G.rivers[p].push(t);
    G.last = { t, from: p };
    G.drawn = -1; G.canWinSelf = false; G.canGangSelf = [];
    G.phase = 'claim';
    resolveClaims();
  }

  /* ---------- 认领（胡>碰杠>吃） ---------- */
  function resolveClaims() {
    const { t, from } = G.last;
    const rons = [];
    for (let k = 1; k <= 3; k++) {
      const p = (from + k) % 4;
      const c = counts(G.hands[p]); c[t]++;
      if (E.canWin(c)) {
        const f = calcFan(c, G.melds[p], { selfDraw: false, roundWind: G.roundWind, seatWind: 27 + ((p - G.dealer + 4) % 4) });
        if (f.fan > 0) rons.push(p);
      }
    }
    if (rons.includes(0)) { askClaim(['ron'], t, from); return; }
    if (rons.length) { doRon(rons[0], t, from); return; }
    for (let k = 1; k <= 3; k++) {
      const p = (from + k) % 4;
      const c = counts(G.hands[p]);
      if (c[t] >= 3) {
        if (p === 0) { askClaim(['gang', 'peng', 'pass'], t, from); return; }
        if (claimImproves(p, t, 'gang')) { doGang(p, t, from); return; }
      }
      if (c[t] >= 2) {
        if (p === 0) { askClaim(['peng', 'pass'], t, from); return; }
        if (claimImproves(p, t, 'peng')) { doPeng(p, t, from); return; }
      }
    }
    const p = (from + 1) % 4;
    if (p === 0 && chiOptions(0, t).length) { askClaim(['chi', 'pass'], t, from); return; }
    if (p !== 0) { const opt = bestChi(p, t); if (opt) { doChi(p, t, from, opt); return; } }
    G.turn = (from + 1) % 4;
    drawTile();
  }
  function claimImproves(p, t, type) {
    const c = counts(G.hands[p]);
    const s0 = shanten(c, G.melds[p].length);
    const c2 = c.slice();
    if (type === 'peng') { c2[t] -= 2; return shanten(c2, G.melds[p].length + 1) < s0; }
    c2[t] -= 3; return shanten(c2, G.melds[p].length + 1) <= s0;
  }
  function chiOptions(p, t) {
    if (isHonor(t)) return [];
    const c = counts(G.hands[p]); const n = t % 9; const res = [];
    if (n >= 2 && c[t - 2] && c[t - 1]) res.push([t - 2, t - 1]);
    if (n >= 1 && n <= 7 && c[t - 1] && c[t + 1]) res.push([t - 1, t + 1]);
    if (n <= 6 && c[t + 1] && c[t + 2]) res.push([t + 1, t + 2]);
    return res;
  }
  function bestChi(p, t) {
    const opts = chiOptions(p, t); if (!opts.length) return null;
    const c = counts(G.hands[p]); const s0 = shanten(c, G.melds[p].length);
    let best = null, bs = 99;
    for (const o of opts) {
      const c2 = c.slice(); c2[o[0]]--; c2[o[1]]--;
      const s = shanten(c2, G.melds[p].length + 1);
      if (s < bs) { bs = s; best = o; }
    }
    return bs < s0 ? best : (G.aiLevel[p] === 'easy' && Math.random() < 0.3 ? opts[0] : null);
  }
  function askClaim(acts, t, from) { G.claim = { acts, t, from }; render(); }

  function doRon(p, t, from) {
    G.hands[p].push(t);
    const i = G.rivers[from].lastIndexOf(t); if (i >= 0) G.rivers[from].splice(i, 1);
    const c = counts(G.hands[p]);
    const f = calcFan(c, G.melds[p], { selfDraw: false, roundWind: G.roundWind, seatWind: 27 + ((p - G.dealer + 4) % 4) });
    endRound({ winner: p, from, selfDraw: false, fan: f.fan, list: f.list }, from);
  }
  function doPeng(p, t, from) {
    for (let k = 0; k < 2; k++) { const i = G.hands[p].indexOf(t); G.hands[p].splice(i, 1); }
    G.melds[p].push({ type: 'peng', tiles: [t, t, t], from });
    G.rivers[from].pop();
    G.claim = null; G.chiSel = null; G.turn = p; G.phase = 'discard'; G.last = null;
    if (p === 0) { G.canWinSelf = false; G.canGangSelf = gangOptions(0, counts(G.hands[0])); render(); }
    else setTimeout(() => aiDiscard(p), 500);
  }
  function doGang(p, t, from) {
    for (let k = 0; k < 3; k++) { const i = G.hands[p].indexOf(t); G.hands[p].splice(i, 1); }
    G.melds[p].push({ type: 'gang', tiles: [t, t, t, t], from });
    G.rivers[from].pop();
    G.claim = null; G.chiSel = null; G.turn = p; G.last = null; G.phase = 'discard';
    if (G.wall.length <= 8) { endRound(null, -1, true); return; }
    const nt = G.wall.shift();
    G.hands[p].push(nt); G.drawn = nt;
    if (p === 0) { G.canWinSelf = false; G.canGangSelf = []; render(); }
    else setTimeout(() => aiTurn(p, true), 500);
  }
  function doChi(p, t, from, opt) {
    for (const o of opt) { const i = G.hands[p].indexOf(o); G.hands[p].splice(i, 1); }
    G.melds[p].push({ type: 'chi', tiles: [opt[0], opt[1], t].sort((a, b) => a - b), from });
    G.rivers[from].pop();
    G.claim = null; G.chiSel = null; G.turn = p; G.phase = 'discard'; G.last = null;
    if (p === 0) { G.canWinSelf = false; G.canGangSelf = gangOptions(0, counts(G.hands[0])); render(); }
    else setTimeout(() => aiDiscard(p), 500);
  }

  /* ---------- AI 决策 ---------- */
  function danger(t, p) {
    const mel = G.melds[p].length;
    const w = mel >= 3 ? 3 : mel >= 2 ? 1.8 : mel >= 1 ? 0.8 : 0.25;
    if (!w) return 0;
    const river = G.rivers[p];
    if (river.includes(t)) return 0;
    let near = 0;
    for (const r of river) {
      if (isHonor(t) || isHonor(r)) { if (r === t) near = 1; continue; }
      if (suitOf(r) === suitOf(t) && Math.abs(r - t) <= 2) near = Math.max(near, Math.abs(r - t) === 1 ? 1 : 0.6);
      if (suitOf(r) === suitOf(t)) near = Math.max(near, 0.3);
    }
    if (isHonor(t)) near = 1;
    return w * (0.5 + near);
  }
  function aiDiscard(p) {
    if (G.phase !== 'discard' || G.turn !== p) return;
    const c = counts(G.hands[p]);
    const av = avail();
    const lvl = G.aiLevel[p];
    const cands = [...new Set(G.hands[p])];
    if (lvl === 'easy' && Math.random() < 0.45) { doDiscard(p, cands[Math.floor(Math.random() * cands.length)]); return; }
    let bestT = cands[0], bestScore = -1e9;
    for (const t of cands) {
      c[t]--;
      const s = shanten(c, G.melds[p].length);
      const u = ukeire(c, G.melds[p].length, av);
      let score;
      if (lvl === 'normal') score = -s * 1000 + u;
      else {
        let dg = 0;
        for (let k = 1; k <= 3; k++) dg += danger(t, (p + k) % 4);
        if (s === 0) score = 100000 + E.getWaits(c.slice()).length * 10 - dg * 3;
        else score = -s * 1000 + u - dg * 7;
      }
      c[t]++;
      if (score > bestScore) { bestScore = score; bestT = t; }
    }
    doDiscard(p, bestT);
  }
  function aiTurn(p, afterGang) {
    if (G.phase !== 'discard') return;
    const c = counts(G.hands[p]);
    if (E.canWin(c)) {
      const f = calcFan(c, G.melds[p], selfCtx(p));
      if (f.fan > 0) { endRound({ winner: p, from: -1, selfDraw: true, fan: f.fan, list: f.list }, -1); return; }
    }
    if (!afterGang && G.aiLevel[p] !== 'easy') {
      for (const g of gangOptions(p, c)) {
        const c2 = c.slice(); c2[g.t] -= (g.type === 'angang' ? 4 : 1);
        if (shanten(c2, G.melds[p].length + 1) <= shanten(c, G.melds[p].length)) {
          if (g.type === 'angang') { for (let k = 0; k < 4; k++) G.hands[p].splice(G.hands[p].indexOf(g.t), 1); G.melds[p].push({ type: 'angang', tiles: [g.t, g.t, g.t, g.t], from: p }); }
          else { G.hands[p].splice(G.hands[p].indexOf(g.t), 1); g.m.type = 'gang'; g.m.tiles.push(g.t); }
          if (G.wall.length <= 8) { endRound(null, -1, true); return; }
          G.hands[p].push(G.wall.shift());
          render(); setTimeout(() => aiTurn(p, true), 500); return;
        }
      }
    }
    aiDiscard(p);
  }

  /* ---------- 结算 ---------- */
  function endRound(win, from, draw) {
    G.phase = 'over'; G.claim = null; G.chiSel = null;
    let text;
    if (draw) text = '荒庄流局';
    else {
      const w = win.winner, pay = 8 + win.fan;
      if (win.selfDraw) { for (let p = 0; p < 4; p++) if (p !== w) G.scores[p] -= pay; G.scores[w] += pay * 3; }
      else { G.scores[from] -= pay; G.scores[w] += pay; }
      text = SEATS[w] + (w === 0 ? '（你）' : '') + (win.selfDraw ? ' 自摸 ' : ' 胡牌 ') + win.fan + ' 番' + (win.selfDraw ? '' : '（' + SEATS[from] + ' 点炮）');
      G.lastWin = win;
    }
    G.overText = text;
    G.dealer = (G.dealer + 1) % 4;
    render();
  }

  /* ---------- 渲染（雀魂风格） ---------- */
  function faceSVG(t) { return (global.MJFACE ? global.MJFACE(t) : '<span class="fb">' + TN(t) + '</span>'); }
  function tileHTML(t, cls, onclick) {
    return '<div class="tile bt ' + (cls || '') + '" ' + (onclick ? 'onclick="' + onclick + '"' : '') + '>' + faceSVG(t) + '</div>';
  }
  function riverHTML(p) {
    const r = G.rivers[p];
    let s = '';
    for (let i = 0; i < r.length; i++) {
      s += '<div class="tile bt rvt' + (G.last && G.last.from === p && i === r.length - 1 ? ' hot' : '') + '">' + faceSVG(r[i]) + '</div>';

    }
    return s;
  }
  function meldHTML(m, own) {
    if (!own && m.type === 'angang') {
      const t = m.tiles[0];
      return '<span class="mg">' + tileHTML(t, 'sm') + '<div class="tile bt back sm"></div><div class="tile bt back sm"></div>' + tileHTML(t, 'sm') + '</span>';
    }
    return '<span class="mg">' + m.tiles.map(t => tileHTML(t, 'sm')).join('') + '</span>';
  }
  function oppBlock(p, pos) {
    const backs = Math.min(G.hands[p].length, 13);
    let bk = '';
    if (pos === 'top') { for (let i = 0; i < backs; i++) bk += '<div class="tile bt back tb"></div>'; }
    else { for (let i = 0; i < backs; i++) bk += '<div class="tile bt back tbv"></div>'; }
    return '<div class="opp ' + pos + '">' +
      '<div class="seatbadge"><b>' + G.names[p] + '</b><span class="lvtag">' + LVCN[G.aiLevel[p]] + '</span>' +
      (G.turn === p && G.phase !== 'over' ? '<span class="think">思考…</span>' : '') +
      '<span class="sc">' + G.scores[p] + '</span></div>' +
      '<div class="obacks' + (pos === 'top' ? '' : ' vert') + '">' + bk + '</div>' +
      '<div class="omelds">' + G.melds[p].map(m => meldHTML(m)).join('') + '</div>' +
      '</div>';
  }
  function render() {
    const root = document.getElementById('battleRoot');
    if (!root || !G) return;
    let h = '<div class="bhead"><span class="bh-l">第 ' + G.round + ' 局 · 庄 ' + SEATS[G.dealer] + ' · ' + LVCN[G.diff] + '</span>' +
      '<span class="bmsg">' + (G.msg || '') + '</span>' +
      '<span class="rotHint">↻ 建议横屏游玩</span>' +
      '<button id="bQuit" class="ghost bh-r">☰ 菜单</button></div>';
    h += '<div class="felt"><div class="tablegrid">';
    h += '<div class="cell c-t">' + oppBlock(2, 'top') + '</div>';
    h += '<div class="cell c-l">' + oppBlock(3, 'left') + '</div>';
    h += '<div class="cell c-cc"><div class="sq">' +
      '<div class="rz rz-t"><div class="river">' + riverHTML(2) + '</div></div>' +
      '<div class="rz rz-l"><div class="river vert">' + riverHTML(3) + '</div></div>' +
      '<div class="rz rz-r"><div class="river vert rev">' + riverHTML(1) + '</div></div>' +
      '<div class="rz rz-b"><div class="river">' + riverHTML(0) + '</div></div>' +
      '<div class="walln">' + G.wall.length + '<small>余牌</small></div></div></div>';
    h += '<div class="cell c-r">' + oppBlock(1, 'right') + '</div>';
    // 我方区
    h += '<div class="cell c-b"><div class="bme">';
    h += '<div class="btop"><div class="mmelds">' + G.melds[0].map(m => meldHTML(m, true)).join('') + '</div></div>';
    h += '<div class="mhand">';
    const hand = G.hands[0].slice();
    const myTurn = G.phase === 'discard' && G.turn === 0;
    if (myTurn && G.drawn >= 0) {
      const i = hand.lastIndexOf(G.drawn);
      if (i >= 0) { const t = hand.splice(i, 1)[0]; h += hand.map(x => tileHTML(x, 'canplay', 'MB.play(' + x + ')')).join('') + '<span class="gap"></span>' + tileHTML(t, 'drawn canplay', 'MB.play(' + t + ')'); }
      else h += hand.map(x => tileHTML(x, 'canplay', 'MB.play(' + x + ')')).join('');
    } else h += hand.map(x => tileHTML(x, '')).join('');
    h += '</div></div>';
    // 右侧浮层操作按钮（雀魂式）
    const acts = [];
    if (myTurn) {
      if (G.canWinSelf) acts.push(['ron', '胡']);
      for (const g of (G.canGangSelf || [])) acts.push(['selfgang|' + g.t + '|' + g.type, '杠']);
    }
    if (G.claim) {
      if (G.claim.acts.includes('ron')) acts.push(['ron', '胡']);
      if (G.claim.acts.includes('peng')) acts.push(['peng', '碰']);
      if (G.claim.acts.includes('gang')) acts.push(['gangp', '杠']);
      if (G.claim.acts.includes('chi')) acts.push(['chi', '吃']);
    }
    if (acts.length) {
      h += '<div class="actFloat">' + acts.map(a => {
        const k = a[0].split('|')[0];
        const cls = (k === 'gangp' || k === 'selfgang') ? 'gang' : k;
        return '<button class="abig ' + cls + '" data-a="' + a[0] + '">' + a[1] + '</button>';
      }).join('') + (G.claim ? '<button class="abig pass" data-a="pass">过</button>' : '') + '</div>';
    }
    h += '</div>';
    // 吃牌组合选择弹窗
    if (G.chiSel) {
      h += '<div class="overlay chiOv"><div class="ovbox"><h2>选择吃法</h2><div class="chiOpts">';
      G.chiSel.forEach((o, i) => {
        h += '<button class="chiOpt" data-i="' + i + '">' + o.map(t => tileHTML(t, 'sm')).join('') +
          '<span class="plus">+</span>' + tileHTML(G.claim.t, 'sm') + '</button>';
      });
      h += '</div><button class="abtn pass" id="chiCancel">取消</button></div></div>';
    }
    h += '</div></div>';
    // 结算
    if (G.phase === 'over') {
      h += '<div class="overlay"><div class="ovbox"><h2>' + G.overText + '</h2>';
      if (G.lastWin) h += '<div class="fanlist">' + G.lastWin.list.join('　') + '</div>';
      h += '<div class="scorerow">' + G.names.map((n, i) => '<span' + (i === 0 ? ' class="me"' : '') + '>' + n + ' <b>' + G.scores[i] + '</b></span>').join('') + '</div>';
      h += '<div><button id="bNext">继续下一局 →</button> <button class="ghost" id="bBack">退出到主菜单</button></div></div></div>';
    }
    root.innerHTML = h;
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    on('bQuit', () => quitToMenu());
    on('bNext', () => { G.lastWin = null; startRound(); });
    on('bBack', () => quitToMenu());
    root.querySelectorAll('.abig').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'ron') {
        if (G.claim) doRon(0, G.claim.t, G.claim.from);
        else { const c = counts(G.hands[0]); const f = calcFan(c, G.melds[0], selfCtx(0)); endRound({ winner: 0, from: -1, selfDraw: true, fan: f.fan, list: f.list }, -1); }
      } else if (a === 'peng') doPeng(0, G.claim.t, G.claim.from);
      else if (a === 'gangp') doGang(0, G.claim.t, G.claim.from);
      else if (a === 'chi') {
        const opts = chiOptions(0, G.claim.t);
        if (opts.length > 1) { G.chiSel = opts; render(); }
        else doChi(0, G.claim.t, G.claim.from, opts[0]);
      } else if (a === 'pass') { G.claim = null; G.chiSel = null; resolveAfterPass(); }
      else if (a.startsWith('selfgang|')) selfGang(a.split('|')[1], a.split('|')[2]);
    });
    root.querySelectorAll('.chiOpt').forEach(b => b.onclick = () => doChi(0, G.claim.t, G.claim.from, G.chiSel[+b.dataset.i]));
    on('chiCancel', () => { G.chiSel = null; render(); });
  }
  function resolveAfterPass() {
    const { t, from } = G.last;
    for (let k = 1; k <= 3; k++) {
      const p = (from + k) % 4; if (p === 0) continue;
      const c = counts(G.hands[p]); c[t]++;
      if (E.canWin(c)) { const f = calcFan(c, G.melds[p], { selfDraw: false, roundWind: G.roundWind, seatWind: 27 + ((p - G.dealer + 4) % 4) }); if (f.fan > 0) { doRon(p, t, from); return; } }
    }
    for (let k = 1; k <= 3; k++) {
      const p = (from + k) % 4; if (p === 0) continue;
      const c = counts(G.hands[p]);
      if (c[t] >= 3 && claimImproves(p, t, 'gang')) { doGang(p, t, from); return; }
      if (c[t] >= 2 && claimImproves(p, t, 'peng')) { doPeng(p, t, from); return; }
    }
    const p = (from + 1) % 4;
    if (p !== 0) { const opt = bestChi(p, t); if (opt) { doChi(p, t, from, opt); return; } }
    G.turn = (from + 1) % 4;
    drawTile();
  }
  function selfGang(t, type) {
    t = +t;
    if (type === 'angang') { for (let k = 0; k < 4; k++) G.hands[0].splice(G.hands[0].indexOf(t), 1); G.melds[0].push({ type: 'angang', tiles: [t, t, t, t], from: 0 }); }
    else { const m = G.melds[0].find(x => x.type === 'peng' && x.tiles[0] === t); G.hands[0].splice(G.hands[0].indexOf(t), 1); m.type = 'gang'; m.tiles.push(t); }
    if (G.wall.length <= 8) { endRound(null, -1, true); return; }
    G.hands[0].push(G.wall.shift()); G.drawn = G.hands[0][G.hands[0].length - 1];
    G.canGangSelf = []; G.canWinSelf = false;
    render();
  }
  function play(t) {
    if (G.phase !== 'discard' || G.turn !== 0) return;
    doDiscard(0, +t);
  }
  function quitToMenu() {
    G = null;
    const r = document.getElementById('battleRoot');
    r.style.display = 'none'; r.innerHTML = '';
    document.getElementById('startPanel').style.display = '';
    document.body.classList.remove('battling');
  }

  /* ---------- 入口接线 ---------- */
  function boot() {
    const mq = document.getElementById('modeQuiz'), mb = document.getElementById('modeBattle');
    const quizPart = ['quizIntro', 'diffSel', 'rulesBox', 'startBtn'].map(id => document.getElementById(id));
    const bs = document.getElementById('battleStart');
    if (!mq || !mb || !bs) return;
    let bdiff = 'normal';
    mq.onclick = () => { mq.classList.add('active'); mb.classList.remove('active'); quizPart.forEach(x => x && (x.style.display = '')); bs.style.display = 'none'; };
    mb.onclick = () => { mb.classList.add('active'); mq.classList.remove('active'); quizPart.forEach(x => x && (x.style.display = 'none')); bs.style.display = ''; };
    const bd = { bdEasy: 'easy', bdNormal: 'normal', bdHard: 'hard' };
    Object.keys(bd).forEach(id => { const el = document.getElementById(id); if (el) el.onclick = () => { bdiff = bd[id]; Object.keys(bd).forEach(x => document.getElementById(x).classList.toggle('active', x === id)); }; });
    const go = document.getElementById('battleGo');
    if (go) go.onclick = () => {
      document.getElementById('startPanel').style.display = 'none';
      document.getElementById('battleRoot').style.display = '';
      document.body.classList.add('battling');
      newGame(bdiff);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  global.MB = { play };
})(typeof window !== 'undefined' ? window : globalThis);
