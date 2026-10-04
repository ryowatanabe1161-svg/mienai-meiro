/* みえない迷路 ― ルールと思考（ブラウザ / Node 共通）
 * 6×6 マス。マスとマスのあいだ（内側の辺 60 か所）に見えない壁を置く。
 * 壁の配置はホストだけが持ち、参加者には終了まで送らない。
 * CPU（ふーさん🐻）は「みんなが見ている情報（通れた道・ぶつかった壁）」だけで考える。
 */
(function (root) {
  'use strict';
  var N = 6, CELLS = 36, EDGES = 60;
  var DIE = [1, 2, 2, 3, 3, 4];                 // 公式のサイコロ
  var GOAL = 5;                                  // 先に 5 つ集めた人の勝ち
  var CORNERS = [0, 5, 35, 30];                  // 左上・右上・右下・左下（時計回り）
  var CORNER_SETS = { 2: [0, 35], 3: [0, 5, 35], 4: [0, 5, 35, 30] };   // 2人は対角
  var DIRS = { U: -6, D: 6, L: -1, R: 1 };
  var DIR_NAMES = { U: '上', D: '下', L: '左', R: '右' };
  var SYMBOLS = [
    { e: '🔮', n: 'すいしょう玉' }, { e: '🗝️', n: '金のかぎ' }, { e: '📜', n: 'まきもの' }, { e: '🧪', n: 'まほうのくすり' },
    { e: '🕯️', n: 'ろうそく' }, { e: '🦉', n: 'ふくろう' }, { e: '🐸', n: 'かえる' }, { e: '🍄', n: 'きのこ' },
    { e: '🌙', n: 'みかづき' }, { e: '⭐', n: 'ながれぼし' }, { e: '💎', n: 'ほうせき' }, { e: '👑', n: 'おうかん' },
    { e: '🪄', n: 'まほうのつえ' }, { e: '🧹', n: 'ほうき' }, { e: '🐉', n: 'ドラゴン' }, { e: '🦄', n: 'ユニコーン' },
    { e: '🕸️', n: 'くものす' }, { e: '🦇', n: 'こうもり' }, { e: '🍎', n: 'りんご' }, { e: '🔔', n: 'すず' },
    { e: '🪶', n: 'はね' }, { e: '🧿', n: 'おまもり' }, { e: '🌈', n: 'にじ' }, { e: '🎩', n: 'ぼうし' }
  ];

  function rc(c) { return { r: Math.floor(c / N), c: c % N }; }
  function neighbor(cell, d) {
    var p = rc(cell);
    if (d === 'U') return p.r > 0 ? cell - 6 : -1;
    if (d === 'D') return p.r < N - 1 ? cell + 6 : -1;
    if (d === 'L') return p.c > 0 ? cell - 1 : -1;
    if (d === 'R') return p.c < N - 1 ? cell + 1 : -1;
    return -1;
  }
  function dirTo(a, b) { for (var d in DIRS) if (neighbor(a, d) === b) return d; return null; }
  // 辺の番号：0〜29＝横どうし（r*5+c と その右）、30〜59＝縦どうし（セル lo と その下）
  function edgeId(a, b) {
    var lo = Math.min(a, b), hi = Math.max(a, b);
    if (hi - lo === 1 && lo % N !== N - 1) return Math.floor(lo / N) * 5 + (lo % N);
    if (hi - lo === N) return 30 + lo;
    return -1;
  }
  function edgeCells(id) {
    if (id < 30) { var r = Math.floor(id / 5), c = id % 5; return [r * N + c, r * N + c + 1]; }
    return [id - 30, id - 30 + N];
  }
  function cellNeighbors(cell) { var out = []; for (var d in DIRS) { var n = neighbor(cell, d); if (n >= 0) out.push(n); } return out; }

  // ---- 乱数 ----
  function mulberry(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function hash01(a, b, c) { var h = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; h = (h ^ (h >>> 16)) >>> 0; return h / 4294967296; }

  // ---- 壁 ----
  function isConnected(wallSet) {
    var seen = [true], stack = [0], n = 1;
    for (var i = 1; i < CELLS; i++) seen[i] = false;
    while (stack.length) {
      var c = stack.pop(), ns = cellNeighbors(c);
      for (var k = 0; k < ns.length; k++) {
        var m = ns[k];
        if (!seen[m] && !wallSet[edgeId(c, m)]) { seen[m] = true; n++; stack.push(m); }
      }
    }
    return n === CELLS;
  }
  function openings(wallSet, cell) { return cellNeighbors(cell).filter(function (m) { return !wallSet[edgeId(cell, m)]; }).length; }
  // 公式：19枚（かんたん）または24枚（むずかしめ）。どのマスにも必ず入口がある（さらに全マスがつながっていることを保証）
  function genWalls(count, rng) {
    count = Math.max(0, Math.min(25, count | 0));
    for (var attempt = 0; attempt < 50; attempt++) {
      var order = shuffle(Array.from({ length: EDGES }, function (_, i) { return i; }), rng);
      var set = {}, n = 0;
      for (var i = 0; i < order.length && n < count; i++) {
        set[order[i]] = true;
        if (isConnected(set)) n++; else delete set[order[i]];
      }
      if (n === count) return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    }
    throw new Error('wall generation failed');
  }
  function wallSetOf(list) { var s = {}; (list || []).forEach(function (e) { s[e] = true; }); return s; }
  function bfsDist(wallSet, from) {
    var d = []; for (var i = 0; i < CELLS; i++) d[i] = -1;
    d[from] = 0; var q = [from];
    while (q.length) { var c = q.shift(); cellNeighbors(c).forEach(function (m) { if (d[m] < 0 && !wallSet[edgeId(c, m)]) { d[m] = d[c] + 1; q.push(m); } }); }
    return d;
  }

  // ---- ゲーム ----
  // cfg: { players: n(2-4), walls: 19|24, seed }
  function createGame(cfg) {
    var n = cfg.players, rng = mulberry(cfg.seed != null ? cfg.seed : Math.floor(Math.random() * 4294967296));
    if (n < 2 || n > 4) throw new Error('2〜4人で遊べます');
    var walls = cfg.wallList ? cfg.wallList.slice() : genWalls(cfg.walls || 24, rng);
    var free = []; for (var c = 0; c < CELLS; c++) if (CORNERS.indexOf(c) < 0) free.push(c);
    shuffle(free, rng);
    var symAt = []; for (var k = 0; k < CELLS; k++) symAt[k] = -1;
    var cellOf = [];
    for (var s = 0; s < SYMBOLS.length; s++) { symAt[free[s]] = s; cellOf[s] = free[s]; }
    var starts = CORNER_SETS[n];
    var G = {
      walls: walls, symAt: symAt, cellOf: cellOf,
      players: starts.map(function (st, i) { return { start: st, pos: st, got: [] }; }),
      turn: cfg.first != null ? cfg.first : Math.floor(rng() * n),
      stage: 'roll', roll: 0, left: 0, path: [], turnFrom: -1,
      deck: shuffle(Array.from({ length: SYMBOLS.length }, function (_, i) { return i; }), rng),
      target: -1, over: false, winner: -1, moves: 0, seq: 0, turnNo: 1,
      pub: [],          // みんなが見た情報：{ k:'open'|'wall', e:辺, by:手番の人, t:ターン番号 }
      hits: [],         // ぶつかった壁（公開情報：ぶつかった瞬間はみんな見ている）
      seed: Math.floor(rng() * 4294967296)
    };
    G.rngState = Math.floor(rng() * 4294967296);
    drawTarget(G, []);
    return G;
  }
  function nextRand(G) { var r = mulberry(G.rngState); var v = r(); G.rngState = Math.floor(r() * 4294967296); return v; }
  function occupant(G, cell, except) { for (var i = 0; i < G.players.length; i++) if (i !== except && G.players[i].pos === cell) return i; return -1; }
  function isOthersStart(G, cell, i) { for (var k = 0; k < G.players.length; k++) if (k !== i && G.players[k].start === cell) return true; return false; }
  // 止まれるマス：ほかの人がいない（1マスに1人）、ほかの人のスタート地点ではない
  function canEndAt(G, i, cell) { return occupant(G, cell, i) < 0 && !isOthersStart(G, cell, i); }

  // 新しい目標を引く。すでにその記号のマスに誰かいれば、その人がもらって引き直し
  function drawTarget(G, gifts) {
    while (!G.over) {
      if (!G.deck.length) { G.target = -1; return; }
      G.target = G.deck.pop();
      var who = occupant(G, G.cellOf[G.target], -1);
      if (who < 0) return;
      G.players[who].got.push(G.target);
      gifts.push({ p: who, sym: G.target });
      if (G.players[who].got.length >= GOAL) { G.over = true; G.winner = who; G.target = -1; return; }
    }
  }

  function roll(G, face) {
    if (G.over || G.stage !== 'roll') return null;
    G.roll = face != null ? face : DIE[Math.floor(nextRand(G) * DIE.length)];
    G.left = G.roll; G.stage = 'move';
    var p = G.players[G.turn];
    G.path = [p.pos]; G.pathBy = G.turn; G.turnFrom = p.pos; G.seq++;
    return G.roll;
  }
  // 壁は見ずに「ルール上その方向へ進めるか」だけを判定
  function canStep(G, d) {
    if (G.over || G.stage !== 'move' || G.left <= 0) return false;
    var i = G.turn, n = neighbor(G.players[i].pos, d);
    if (n < 0) return false;
    if (G.left === 1 && !canEndAt(G, i, n) && !(G.target >= 0 && G.symAt[n] === G.target)) return false;
    return true;
  }
  function canStop(G) { return !G.over && G.stage === 'move' && canEndAt(G, G.turn, G.players[G.turn].pos); }
  function legalDirs(G) { return Object.keys(DIRS).filter(function (d) { return canStep(G, d); }); }

  function endTurn(G) {
    G.stage = 'roll'; G.left = 0; G.moves++; G.turnNo++;
    G.turn = (G.turn + 1) % G.players.length;
  }
  // 1歩進む。結果：{ type:'move'|'hit'|'collect'|'end', from, to, ... }
  function step(G, d) {
    if (!canStep(G, d)) return null;
    var i = G.turn, p = G.players[i], from = p.pos, to = neighbor(from, d), e = edgeId(from, to);
    G.seq++;
    if (wallSetOf(G.walls)[e]) {
      // 見えない壁にぶつかった：玉が落ちて、のこりの歩数は失い、自分のスタートに戻る
      G.pub.push({ k: 'wall', e: e, by: i, t: G.turnNo });
      G.hits.push({ e: e, by: i, from: from, to: to, t: G.turnNo });
      p.pos = p.start;
      var res = { type: 'hit', p: i, from: from, to: to, dir: d, e: e, back: p.start, lost: G.left - 1 };
      G.path.push(-1);
      endTurn(G);
      return res;
    }
    G.pub.push({ k: 'open', e: e, by: i, t: G.turnNo });
    p.pos = to; G.left--; G.path.push(to);
    if (G.symAt[to] === G.target && G.target >= 0) {
      var sym = G.target; p.got.push(sym);
      var gifts = [];
      var r = { type: 'collect', p: i, from: from, to: to, dir: d, sym: sym, lost: G.left, gifts: gifts };
      if (p.got.length >= GOAL) { G.over = true; G.winner = i; G.target = -1; G.stage = 'over'; return r; }
      drawTarget(G, gifts);
      if (G.over) { G.stage = 'over'; return r; }
      endTurn(G);
      return r;
    }
    if (G.left === 0) { endTurn(G); return { type: 'end', p: i, from: from, to: to, dir: d }; }
    // 万一：のこり歩数で止まれる場所がまったくない（ほかの駒に囲まれた）ときは、この手番の最初のマスに戻って終了
    if (!legalDirs(G).length && !canStop(G)) { p.pos = G.turnFrom; endTurn(G); return { type: 'stuck', p: i, from: from, to: to, dir: d, back: p.pos }; }
    return { type: 'move', p: i, from: from, to: to, dir: d, left: G.left };
  }
  function stop(G) {
    if (!canStop(G)) return null;
    var i = G.turn, lost = G.left; G.seq++;
    endTurn(G);
    return { type: 'stop', p: i, lost: lost };
  }

  // ---- CPU（ふーさん🐻） ----
  // 記憶力：own＝自分がぶつかった壁、other＝ほかの人がぶつかった壁、open＝誰かが通れた道
  var CPU_LEVELS = {
    // keep＝おぼえている確率、fade＝何ターンで半分忘れるか（0＝忘れない）、floor＝どれだけ時間がたっても残る割合
    easy: { own: 0.9, other: 0.55, open: 0.45, fade: 24, floor: 0.45, pen: 0.3, label: 'やさしい' },
    normal: { own: 1, other: 0.9, open: 0.75, fade: 0, floor: 1, pen: 0.7, label: 'ふつう' },
    strong: { own: 1, other: 1, open: 1, fade: 0, floor: 1, pen: 1.4, label: 'つよい' }
  };
  // その CPU が「おぼえている」壁と道。公開情報 G.pub だけを使う（G.walls は見ない）
  function cpuMemory(pub, me, level, salt, nowTurn) {
    var L = CPU_LEVELS[level] || CPU_LEVELS.normal, wall = {}, open = {};
    for (var k = 0; k < pub.length; k++) {
      var o = pub[k], own = o.by === me, base = o.k === 'wall' ? (own ? L.own : L.other) : L.open;
      var age = Math.max(0, nowTurn - o.t);
      var keep = L.fade ? base * Math.max(L.floor, Math.pow(0.5, age / L.fade)) : base;
      if (o.k === 'wall' && own && age <= 4) keep = 1;   // さっきぶつかった壁はさすがに覚えている
      var key = o.k === 'wall' ? o.e * 7 + 1 : o.e * 7 + 2;                   // 同じ壁を何度見ても「覚えているか」は1回の判定（見るたびに少し覚えやすく）
      var seen = 0; for (var q = 0; q < k; q++) if (pub[q].e === o.e && pub[q].k === o.k) seen++;
      keep = 1 - (1 - keep) * Math.pow(0.6, seen);
      if (hash01(salt, me * 1000 + key, seen) < keep) { if (o.k === 'wall') wall[o.e] = true; else open[o.e] = true; }
    }
    return { wall: wall, open: open };
  }
  // 目標までの道を考える（知っている壁は通らない／知らない道は少しこわい）
  function cpuPlan(pubView, me, level, salt) {
    var L = CPU_LEVELS[level] || CPU_LEVELS.normal;
    var V = pubView, mem = cpuMemory(V.pub, me, level, salt, V.turnNo);
    var start = V.players[me].pos, goal = V.target >= 0 ? V.cellOf[V.target] : -1;
    if (goal < 0) return { dirs: [], mem: mem };
    var dist = [], prev = [], done = [];
    for (var i = 0; i < CELLS; i++) { dist[i] = Infinity; prev[i] = -1; done[i] = false; }
    dist[start] = 0;
    for (;;) {
      var u = -1;
      for (var j = 0; j < CELLS; j++) if (!done[j] && (u < 0 || dist[j] < dist[u])) u = j;
      if (u < 0 || dist[u] === Infinity) break;
      done[u] = true;
      cellNeighbors(u).forEach(function (m) {
        var e = edgeId(u, m);
        if (mem.wall[e]) return;
        var w = 1 + (mem.open[e] ? 0 : L.pen) + hash01(salt, e, V.turnNo) * 0.05;
        if (dist[u] + w < dist[m]) { dist[m] = dist[u] + w; prev[m] = u; }
      });
    }
    var path = [];
    if (dist[goal] < Infinity) { for (var c = goal; c !== start; c = prev[c]) path.unshift(c); }
    return { path: path, mem: mem, cost: dist[goal] };
  }
  // サイコロの目に合わせて実際に進む方向の列（止まれないマスでは終わらないよう調整）
  function cpuMoves(G, me, level, salt) {
    var V = publicView(G);
    var plan = cpuPlan(V, me, level, salt);
    var path = plan.path || [], take = Math.min(G.left, path.length);
    var occ = function (cell) { return !canEndAt(G, me, cell) && !(G.target >= 0 && G.symAt[cell] === G.target); };
    // つよい：知らない道で遠くまで行き過ぎない（スタートから遠いほど、壁に当たったときの損が大きい）
    if (level === 'strong' && take > 0) {
      var unknown = 0, safeTake = take;
      for (var s = 0; s < take; s++) {
        var a = s === 0 ? G.players[me].pos : path[s - 1], b = path[s];
        if (!plan.mem.open[edgeId(a, b)]) { unknown++; if (unknown > 2) { safeTake = s; break; } }
      }
      take = Math.max(1, safeTake);
    }
    while (take > 0 && occ(path[take - 1])) take--;
    var dirs = [], cur = G.players[me].pos;
    for (var k = 0; k < take; k++) { dirs.push(dirTo(cur, path[k])); cur = path[k]; }
    if (!dirs.length && !canStop(G)) {   // 今いるマスに止まれない（通過中など）ときは、とにかく動ける方へ
      var ld = legalDirs(G); if (ld.length) dirs.push(ld[0]);
    }
    return { dirs: dirs, plan: plan };
  }

  // 参加者に見せてよい公開情報（壁の配置は含めない）
  function publicView(G) {
    return {
      symAt: G.symAt.slice(), cellOf: G.cellOf.slice(), target: G.target, turn: G.turn, stage: G.stage, roll: G.roll, left: G.left,
      path: G.path.slice(), pathBy: G.pathBy != null ? G.pathBy : -1, players: G.players.map(function (p) { return { start: p.start, pos: p.pos, got: p.got.slice() }; }),
      deckLeft: G.deck.length, over: G.over, winner: G.winner, moves: G.moves, seq: G.seq, turnNo: G.turnNo,
      pub: G.pub.map(function (o) { return { k: o.k, e: o.e, by: o.by, t: o.t }; })
    };
  }

  var api = {
    N: N, CELLS: CELLS, EDGES: EDGES, DIE: DIE, GOAL: GOAL, CORNERS: CORNERS, CORNER_SETS: CORNER_SETS, DIRS: DIRS, DIR_NAMES: DIR_NAMES,
    SYMBOLS: SYMBOLS, CPU_LEVELS: CPU_LEVELS,
    rc: rc, neighbor: neighbor, dirTo: dirTo, edgeId: edgeId, edgeCells: edgeCells, cellNeighbors: cellNeighbors,
    mulberry: mulberry, shuffle: shuffle, isConnected: isConnected, openings: openings, genWalls: genWalls, wallSetOf: wallSetOf, bfsDist: bfsDist,
    createGame: createGame, roll: roll, canStep: canStep, canStop: canStop, legalDirs: legalDirs, step: step, stop: stop,
    canEndAt: canEndAt, occupant: occupant, cpuMemory: cpuMemory, cpuPlan: cpuPlan, cpuMoves: cpuMoves, publicView: publicView
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MazeGame = api;
})(this);
