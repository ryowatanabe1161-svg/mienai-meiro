/* みえない迷路 〜ふーさんと まほうのしるし〜 オンライン版
 * 構成：WebRTC（PeerJS）による P2P。ホストのブラウザが唯一の正（authoritative）。
 * 見えない壁の配置・山のしるし・CPU（ふーさん🐻）の判断はホストだけが持ち、
 * 参加者には「みんなに見えている情報」だけを送ります（壁の配置はゲーム終了まで送りません）。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MG = window.MazeGame;
  var Q = new URLSearchParams(location.search);
  var CFG = window.LB_CONFIG || {};
  var ICE = (CFG.iceServers && CFG.iceServers.length) ? CFG.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
  if (Q.get('ice')) ICE = Q.get('ice').split(',').map(function (u) { return { urls: u }; }); // テスト・独自環境用
  var PEER_OPTS = Object.assign({ debug: 1, config: { iceServers: ICE } }, CFG.peer || {});
  var ID_PREFIX = 'mienai-meiro-jp-v1-';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var TURBO = Q.has('turbo');
  var DRAMA_MS = Q.get('dramams') ? +Q.get('dramams') : (TURBO ? 600 : 2000);
  var COLORS = [{ c: '#ff5d73', n: 'あか' }, { c: '#4cc9f0', n: 'あお' }, { c: '#ffd166', n: 'きいろ' }, { c: '#7ae582', n: 'みどり' }];
  var BEAR = '🐻', CPU_BASE = 'ふーさん' + BEAR, CPU_DEFAULT_RE = /^ふーさん🐻\d*$/;
  var LINES = {
    roll: ['えいっ！クマ', 'コロコロ〜クマ', 'いい目が出るといいクマ', 'それっ！クマ'],
    hit: ['いたたっ…壁があったクマ！', 'ゴツン！ここは壁クマ〜', 'うわっ、見えなかったクマ…', 'ここに壁…おぼえたクマ！'],
    forgot: ['あれ？ここ前にもぶつかったクマ…', 'わすれてたクマ〜！', 'また同じ壁クマ…はずかしいクマ'],
    collect: ['みつけたクマ〜！', 'やったクマ！', 'ふーさんの鼻はするどいクマ！', 'いただきクマ！'],
    stop: ['ここで止まっとくクマ', '無理はしないクマ', 'ちょっと様子見クマ'],
    gift: ['足もとにあったクマ！？', 'ラッキーだクマ！']
  };
  var WALL_OPTS = [{ v: 24, l: '24枚', s: '公式' }, { v: 19, l: '19枚', s: '公式のかんたん' }];
  var BUMP_OPTS = [{ v: false, l: 'なし', s: '公式・おぼえる' }, { v: true, l: 'あり', s: 'かんたん' }];
  var CPU_OPTS = [{ v: 'easy', l: 'やさしい', s: 'ときどき忘れる' }, { v: 'normal', l: 'ふつう', s: '' }, { v: 'strong', l: 'つよい', s: '全部おぼえる' }];
  var HB_MS = 3000, LOST_MS = 10000, MAXP = 4;
  var LS_ID = 'lb-online-client-id', LS_NAME = 'lb-online-name', LS_HOST = 'lb-online-host-room', SS_CLIENT = 'lb-online-joined', LS_SOUND = 'lb-online-sound';

  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} }
  function load(k, json) { try { var v = localStorage.getItem(k); return json ? JSON.parse(v) : v; } catch (e) { return null; } }
  function sstore(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sload(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }
  function rid(n) { var s = ''; for (var i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]; return s; }
  var myId = load(LS_ID) || (function () { var v = rid(16); store(LS_ID, v); return v; })();

  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function san(name) { return (name === 'あなた' || name.indexOf('さん') >= 0) ? name : name + 'さん'; }
  function who(s) { return (s.kind === 'cpu' && s.name.indexOf(BEAR) < 0 ? BEAR : '') + s.name; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8); }
  function genCode() { var c = ''; for (var i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 4); }
  function inviteUrl(code) { var u = location.origin + location.pathname + '?room=' + code; if (Q.get('ice')) u += '&ice=' + encodeURIComponent(Q.get('ice')); return u; }
  function symTxt(i) { var s = MG.SYMBOLS[i]; return s ? s.e + s.n : '?'; }

  // ---------- 汎用UI ----------
  function show(id) { ['title', 'lobby', 'game', 'end'].forEach(function (s) { $(s).classList.toggle('active', s === id); }); }
  function overlay(id, on) { $(id).classList.toggle('active', on); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3000); }
  function banner(msg) { var b = $('banner'); b.textContent = msg || ''; b.classList.toggle('show', !!msg); }
  function confirmBox(title, text, yes, cb) {
    $('cfTitle').textContent = title; $('cfText').textContent = text; $('cfYes').textContent = yes;
    overlay('confirmModal', true);
    $('cfYes').onclick = function () { overlay('confirmModal', false); cb(); };
    $('cfNo').onclick = function () { overlay('confirmModal', false); };
  }
  function alertBox(msg) { confirmBox('お知らせ', msg, 'OK', function () {}); $('cfNo').style.display = 'none'; setTimeout(function () { $('cfNo').style.display = ''; }, 0); }
  function connecting(on, title, text, onCancel) {
    overlay('connecting', on);
    if (on) { $('connTitle').textContent = title || '接続中…'; $('connText').textContent = text || ''; $('connCancel').onclick = onCancel || function () { location.href = location.pathname; }; }
  }
  $('rulesBtn1').onclick = $('rulesBtn2').onclick = function () { overlay('rulesModal', true); };
  $('rulesClose').onclick = function () { overlay('rulesModal', false); };
  $('rulesModal').addEventListener('click', function (e) { if (e.target === this) overlay('rulesModal', false); });

  // ---------- 効果音（WebAudio で合成。ファイルなし） ----------
  var Snd = (function () {
    var ctx = null, on = load(LS_SOUND) !== 'off';
    function ac() {
      if (!on) return null;
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
      return ctx;
    }
    function tone(f, t0, dur, type, vol, f2) {
      var c = ac(); if (!c) return;
      var t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
    }
    function noise(t0, dur, vol, freq) {
      var c = ac(); if (!c) return;
      var len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + t0;
      f.type = 'lowpass'; f.frequency.value = freq || 900; g.gain.value = vol || 0.3;
      src.buffer = buf; src.connect(f); f.connect(g); g.connect(c.destination); src.start(t);
    }
    return {
      unlock: function () { ac(); },
      isOn: function () { return on; },
      toggle: function () { on = !on; store(LS_SOUND, on ? 'on' : 'off'); return on; },
      roll: function () { for (var i = 0; i < 6; i++) noise(i * 0.09, 0.05, 0.25, 2500 - i * 200); tone(660, 0.6, 0.12, 'triangle', 0.15, 880); },
      step: function () { tone(523, 0, 0.09, 'triangle', 0.12, 700); },
      bonk: function () { tone(140, 0, 0.3, 'sine', 0.6, 45); noise(0, 0.15, 0.45, 600); },
      drop: function () { tone(1200, 0, 0.6, 'triangle', 0.12, 180); [0.62, 0.82, 0.95, 1.04].forEach(function (t, i) { tone(380 - i * 30, t, 0.07, 'square', 0.09 - i * 0.015); }); },
      collect: function () { [784, 988, 1175, 1568].forEach(function (f, i) { tone(f, i * 0.09, 0.3, 'triangle', 0.16); }); tone(2093, 0.4, 0.5, 'sine', 0.08); },
      win: function () { [523, 659, 784, 1047, 784, 1047].forEach(function (f, i) { tone(f, i * 0.14, 0.32, 'triangle', 0.18); }); }
    };
  })();
  document.addEventListener('pointerdown', function () { Snd.unlock(); }, true);
  function soundBtn() { $('soundBtn').textContent = Snd.isOn() ? '🔊' : '🔇'; }
  $('soundBtn').onclick = function () { Snd.toggle(); soundBtn(); toast(Snd.isOn() ? '効果音 ON' : '効果音 OFF'); };
  soundBtn();

  // =====================================================================
  //  ホスト（authoritative）
  // =====================================================================
  var host = null;
  function hostId(code) { return ID_PREFIX + code; }
  function newRoom(name) {
    return {
      code: genCode(), phase: 'lobby', opts: { walls: 24, bumps: false, cpu: 'normal' }, nextSid: 2, gameNo: 0,
      seats: [{ sid: 1, name: name, kind: 'host', clientId: myId, connected: true }],
      pids: null, G: null, log: [], evId: 0, ev: null, created: Date.now()
    };
  }
  function startHost(name, resumeRoom) {
    document.body.classList.add('is-host');
    host = { room: resumeRoom || newRoom(name), conns: {}, lastSeen: {}, timer: null, tries: 0, opened: false, cpuPlan: null };
    if (resumeRoom) {
      host.room.seats.forEach(function (s) { if (s.kind === 'remote') s.connected = false; });
      if (host.room.phase === 'play') addLog('🔄 ホストが部屋を再開しました');
    }
    connecting(true, resumeRoom ? '部屋を再開しています…' : '部屋を作っています…', 'シグナリングサーバーに接続中', function () { location.href = location.pathname; });
    openHostPeer();
    setInterval(hostHeartbeat, 2000);
  }
  function openHostPeer() {
    var R = host.room;
    var peer = new Peer(hostId(R.code), PEER_OPTS);
    host.peer = peer;
    peer.on('open', function () { host.opened = true; host.tries = 0; connecting(false); banner(''); hostRender(); saveHost(); hostSchedule(); });
    peer.on('connection', hostOnConnection);
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'unavailable-id') {
        try { peer.destroy(); } catch (x) {}
        if (!host.opened && R.phase === 'lobby' && !host.resuming) { R.code = genCode(); openHostPeer(); return; }
        if (++host.tries > 25) { connecting(false); toast('部屋を再開できませんでした'); return; }
        connecting(true, '部屋を再開しています…', '少し時間がかかることがあります（' + host.tries + '）');
        setTimeout(openHostPeer, 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!host.opened) { connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); setTimeout(function () { try { peer.destroy(); } catch (x) {} openHostPeer(); }, 4000); }
        else banner('シグナリングサーバーとの接続が不安定です（ゲームは続行できます）');
      } else if (e.type === 'browser-incompatible') {
        connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
      }
    });
  }
  function hostOnConnection(conn) {
    conn.on('data', function (msg) { hostOnMessage(conn, msg); });
    conn.on('close', function () { hostConnClosed(conn); });
    conn.on('error', function () { hostConnClosed(conn); });
  }
  function seatByClient(cid) { return host.room.seats.filter(function (s) { return s.clientId === cid; })[0]; }
  function seatBySid(sid) { return host.room.seats.filter(function (s) { return s.sid === sid; })[0]; }
  function seatOfP(i) { return seatBySid(host.room.pids[i]); }

  function hostOnMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    var R = host.room;
    if (msg.t === 'join') return hostJoin(conn, msg);
    var seat = conn.clientId && seatByClient(conn.clientId);
    if (!seat || host.conns[conn.clientId] !== conn) return;
    host.lastSeen[conn.clientId] = Date.now();
    if (msg.t === 'ping') return;
    if (msg.t === 'lobbyReq') return hostLobbyReq(seat);
    if (msg.t === 'abort') return;   // 中断できるのはホストだけ
    if (msg.t === 'act') {
      if (R.phase !== 'play' || !R.G || R.G.over) return;
      var i = R.pids.indexOf(seat.sid);
      if (i !== R.G.turn || seat.kind !== 'remote') return conn.send({ t: 'error', msg: 'あなたの番ではありません' });
      if (msg.seq !== R.G.seq) return;                       // 二重送信・古い操作
      if (['roll', 'step', 'stop'].indexOf(msg.kind) < 0) return;
      if (msg.kind === 'step' && !MG.DIRS[msg.dir]) return;
      hostAct(msg.kind, msg.dir);
    } else if (msg.t === 'leave') {
      if (R.phase === 'lobby') { R.seats.splice(R.seats.indexOf(seat), 1); addLog(seat.name + 'が退出しました'); }
      else { seat.connected = false; seat.left = true; addLog(seat.name + 'が退出しました'); }
      delete host.conns[conn.clientId];
      try { conn.close(); } catch (e) {}
      hostBroadcast();
    }
  }
  function hostJoin(conn, msg) {
    var R = host.room;
    var name = cleanName(msg.name), cid = String(msg.clientId || '').slice(0, 40);
    function reject(text) { conn.send({ t: 'reject', msg: text }); setTimeout(function () { try { conn.close(); } catch (e) {} }, 500); }
    if (!name || !cid) return reject('ニックネームを入力してください');
    if (cid === myId) return reject('ホストと同じ端末・ブラウザからは参加できません');
    var seat = seatByClient(cid);
    if (!seat) {
      seat = R.seats.filter(function (s) { return s.name === name && (s.kind === 'remote' || s.replaced) && !s.connected && s.kind !== 'host'; })[0];
      if (seat) seat.clientId = cid;
    }
    if (seat) {
      if (seat.kind === 'host') return reject('この名前は使えません');
      var restored = seat.kind === 'cpu' && seat.replaced;
      if (restored) { seat.kind = 'remote'; seat.replaced = false; }
      var old = host.conns[cid];
      if (old && old !== conn) { try { old.close(); } catch (e) {} }
      seat.connected = true; seat.left = false;
      addLog('🔌 ' + seat.name + 'が' + (restored ? '戻ってきました（ふーさん🐻と交代）' : '再接続しました'));
    } else {
      if (R.phase !== 'lobby') return reject('この部屋はゲーム中です。前に参加していた人は、同じニックネームで入ると元の席に戻れます。');
      if (R.seats.length >= MAXP) return reject('満員です（最大4人）');
      if (R.seats.some(function (s) { return s.name === name; })) return reject('その名前はすでに使われています。別のニックネームにしてください。');
      seat = { sid: R.nextSid++, name: name, kind: 'remote', clientId: cid, connected: true };
      R.seats.push(seat);
      renumberCpus();
      addLog('👋 ' + name + 'が参加しました');
    }
    conn.clientId = cid; host.conns[cid] = conn; host.lastSeen[cid] = Date.now();
    conn.send({ t: 'welcome', code: R.code, sid: seat.sid });
    hostBroadcast(); hostSchedule();
  }
  function hostConnClosed(conn) {
    if (!conn.clientId || host.conns[conn.clientId] !== conn) return;
    delete host.conns[conn.clientId];
    var seat = seatByClient(conn.clientId);
    if (seat && seat.connected) { seat.connected = false; addLog('⚠️ ' + seat.name + 'の接続が切れました'); hostBroadcast(); }
  }
  function hostHeartbeat() {
    if (!host) return;
    var now = Date.now();
    Object.keys(host.conns).forEach(function (cid) {
      var c = host.conns[cid];
      try { c.send({ t: 'hb' }); } catch (e) {}
      if (now - (host.lastSeen[cid] || 0) > LOST_MS) { try { c.close(); } catch (e) {} hostConnClosed(c); }
    });
  }
  function addLog(t) { var R = host.room; R.log.unshift(t); if (R.log.length > 40) R.log.length = 40; }
  function renumberCpus() {
    var cpus = host.room.seats.filter(function (s) { return s.kind === 'cpu' && !s.replaced && CPU_DEFAULT_RE.test(s.name); });
    cpus.forEach(function (s, k) { s.name = cpus.length === 1 ? CPU_BASE : CPU_BASE + (k + 1); });
  }

  // ---- 進行 ----
  function hostStartGame() {
    var R = host.room, n = R.seats.length;
    if (n < 2 || n > MAXP) return;
    renumberCpus();
    R.gameNo++;
    R.pids = R.seats.map(function (s) { return s.sid; });
    R.G = MG.createGame({ players: n, walls: R.opts.walls });
    R.phase = 'play'; R.ev = null; R.log = []; R.lobbyReq = null;
    host.cpuPlan = null;
    addLog('🎯 さいしょのしるし：' + symTxt(R.G.target));
    addLog('🌙 ゲーム開始！ 迷路の地下に見えない壁が' + R.opts.walls + '枚…。最初は ' + san(who(seatOfP(R.G.turn))) + ' から（いちばん最近道に迷った人…のかわりにくじ引き）');
    hostBroadcast(); hostSchedule();
  }
  function hostAct(kind, dir) {
    var R = host.room, G = R.G;
    if (!G || G.over || R.phase !== 'play') return;
    var i = G.turn, seat = seatOfP(i), cpu = seat.kind === 'cpu', nm = who(seat), ev = null;
    if (kind === 'roll') {
      var face = MG.roll(G); if (face == null) return;
      ev = { type: 'roll', p: i, face: face, line: cpu ? pick(LINES.roll) : '' };
      addLog('🎲 ' + nm + '：' + face + '（' + face + '歩まで）' + (ev.line ? '「' + ev.line + '」' : ''));
    } else if (kind === 'step') {
      var from = G.players[i].pos, to = MG.neighbor(from, dir), e = to >= 0 ? MG.edgeId(from, to) : -1;
      var knownWall = e >= 0 && G.pub.some(function (o) { return o.k === 'wall' && o.e === e; });
      var steps = G.path.length;   // この手番でいままでに進んだ歩数＋1
      var res = MG.step(G, dir); if (!res) return;
      ev = { type: res.type, p: i, from: res.from, to: res.to, dir: res.dir };
      if (res.type === 'hit') {
        ev.back = res.back; ev.line = cpu ? pick(knownWall ? LINES.forgot : LINES.hit) : '';
        addLog('💥 ' + nm + 'が見えない壁にぶつかった！ 玉がポトン…スタートにもどる' + (ev.line ? '「' + ev.line + '」' : ''));
      } else if (res.type === 'collect') {
        ev.sym = res.sym; ev.gifts = res.gifts; ev.line = cpu ? pick(LINES.collect) : '';
        addLog('✨ ' + nm + 'が ' + symTxt(res.sym) + ' をみつけた！（' + G.players[i].got.length + '/' + MG.GOAL + '）' + (ev.line ? '「' + ev.line + '」' : ''));
        res.gifts.forEach(function (g) { addLog('🎁 ' + who(seatOfP(g.p)) + 'は ' + symTxt(g.sym) + ' の上にいた！ そのままゲット（' + G.players[g.p].got.length + '/' + MG.GOAL + '）'); });
        if (!G.over) addLog('🎯 次のしるし：' + symTxt(G.target));
      } else if (res.type === 'end') {
        addLog('👣 ' + nm + 'は' + steps + '歩進んだ');
      } else if (res.type === 'stuck') {
        ev.back = res.back; addLog('😵 ' + nm + 'は止まれる場所がなく、手番のはじめのマスにもどった');
      }
    } else if (kind === 'stop') {
      var moved = G.path.length - 1;
      var r2 = MG.stop(G); if (!r2) return;
      ev = { type: 'stop', p: i, lost: r2.lost, line: cpu && r2.lost ? pick(LINES.stop) : '' };
      addLog('✋ ' + nm + 'は' + (moved ? moved + '歩進んで' : '動かずに') + '止まった' + (ev.line ? '「' + ev.line + '」' : ''));
    }
    if (!ev) return;
    ev.id = ++R.evId; ev.at = Date.now(); ev.seq = G.seq;
    R.ev = ev;
    if (G.over) { R.phase = 'end'; addLog('🏆 ' + who(seatOfP(G.winner)) + 'がしるしを' + MG.GOAL + 'つ集めて勝利！ 迷路のひみつが明かされます'); }
    if (kind !== 'step' || ev.type !== 'move') host.cpuPlan = host.cpuPlan && host.cpuPlan.turnNo === G.turnNo ? host.cpuPlan : null;
    hostBroadcast(); hostSchedule();
  }
  function cpuDelay(kind) {
    if (TURBO) return kind === 'step' ? 40 : 70;
    return kind === 'roll' ? 900 : kind === 'first' ? 1050 : 480;
  }
  function hostSchedule() {
    clearTimeout(host.timer);
    var R = host.room, G = R.G;
    if (!host.opened || R.phase !== 'play' || !G || G.over) return;
    var seat = seatOfP(G.turn);
    if (!seat || seat.kind !== 'cpu') return;
    var seq = G.seq, wait = 0;
    if (R.ev && (R.ev.type === 'hit' || R.ev.type === 'collect' || R.ev.type === 'stuck')) wait = Math.max(0, R.ev.at + DRAMA_MS + 200 - Date.now());
    var delay = wait + cpuDelay(G.stage === 'roll' ? 'roll' : (G.path.length <= 1 ? 'first' : 'step'));
    host.timer = setTimeout(function () {
      if (R.phase !== 'play' || R.G !== G || G.seq !== seq || G.over) return;
      var s = seatOfP(G.turn); if (!s || s.kind !== 'cpu') return;
      if (G.stage === 'roll') { hostAct('roll'); return; }
      var plan = host.cpuPlan;
      if (!plan || plan.turnNo !== G.turnNo) {
        plan = host.cpuPlan = { turnNo: G.turnNo, dirs: MG.cpuMoves(G, G.turn, R.opts.cpu, R.gameNo * 1009 + s.sid * 7919).dirs };
      }
      var d = plan.dirs.shift();
      if (d && MG.canStep(G, d)) hostAct('step', d);
      else if (MG.canStop(G)) hostAct('stop');
      else { var ld = MG.legalDirs(G); if (ld.length) hostAct('step', ld[0]); }
    }, delay);
  }
  function hostReplace(sid) {
    var R = host.room, seat = seatBySid(sid);
    if (!seat || seat.kind !== 'remote' || seat.connected) return;
    seat.kind = 'cpu'; seat.replaced = true;
    addLog('🐻 ' + seat.name + 'の代わりに、ふーさん🐻がプレイします');
    hostBroadcast(); hostSchedule();
  }

  // ---- 各プレイヤー向けの「見せてよい情報だけ」のビュー ----
  function viewFor(sid) {
    var R = host.room, G = R.G;
    var you = -1;
    R.seats.forEach(function (s, i) { if (s.sid === sid) you = i; });
    var v = {
      t: 'state', phase: R.phase, code: R.code, you: you, sid: sid, gameNo: R.gameNo,
      opts: { walls: R.opts.walls, bumps: !!R.opts.bumps, cpu: R.opts.cpu },
      seats: R.seats.map(function (s) { return { sid: s.sid, name: s.name, kind: s.kind, connected: s.kind !== 'remote' || s.connected, replaced: !!s.replaced }; }),
      log: R.log.slice(0, 6), notice: R.notice || null
    };
    if (sid === 1 && R.lobbyReq && R.phase !== 'lobby') v.lobbyReq = R.lobbyReq;
    if (R.phase !== 'lobby' && G) {
      var P = MG.publicView(G);
      delete P.pub;                                         // 通った道・ぶつかった壁の履歴は送らない（覚えるのはプレイヤーの仕事）
      P.pids = R.pids.slice();
      P.hitCount = P.players.map(function (_, i) { return G.hits.filter(function (h) { return h.by === i; }).length; });
      if (R.opts.bumps || G.over) P.bumps = G.hits.map(function (h) { return { e: h.e, by: h.by }; });   // 「あり（かんたん）」のときだけ
      if (G.over) P.walls = G.walls.slice();                // 壁の配置はゲーム終了後にだけ公開
      v.g = P;
      v.ev = R.ev;
    }
    return v;
  }
  // ---- 中断してロビーへ（ホストのみ） ----
  function hostToLobby(msg) {
    var R = host.room;
    clearTimeout(host.timer); R.phase = 'lobby'; R.G = null; R.pids = null; R.ev = null; host.cpuPlan = null;
    R.seats = R.seats.filter(function (s) {
      if (s.kind === 'cpu' && s.replaced) {
        if (s.clientId && host.conns[s.clientId] && host.conns[s.clientId].open) { s.kind = 'remote'; s.replaced = false; s.connected = true; s.left = false; return true; }
        return false;
      }
      if (s.kind === 'remote') { s.left = false; return !!s.connected; }
      return true;
    });
    renumberCpus();
    R.lobbyReq = null; R.notice = { id: (R.notice ? R.notice.id : 0) + 1, msg: msg };
    addLog(msg);
    hostBroadcast();
  }
  function hostLobbyReq(seat) {
    var R = host.room;
    if (seat.kind !== 'remote' || R.phase === 'lobby') return;
    if (R.lobbyReq && R.lobbyReq.sid === seat.sid && Date.now() - R.lobbyReq.at < 5000) return;
    R.lobbyReq = { sid: seat.sid, name: seat.name, at: Date.now() };
    addLog('🙋 ' + seat.name + '「ロビーに戻りたい」');
    hostBroadcast();
  }
  function hostBroadcast() {
    var R = host.room;
    R.seats.forEach(function (s) {
      if (s.kind !== 'remote') return;
      var c = host.conns[s.clientId];
      if (c && c.open) { try { c.send(viewFor(s.sid)); } catch (e) {} }
    });
    hostRender(); saveHost();
  }
  function hostRender() { render(viewFor(1)); }
  function saveHost() { store(LS_HOST, { room: host.room, saved: Date.now() }); }

  // ---- ホストのロビー操作 ----
  $('addCpuBtn').onclick = function () {
    var R = host && host.room; if (!R || R.phase !== 'lobby' || R.seats.length >= MAXP) return;
    R.seats.push({ sid: R.nextSid++, name: CPU_BASE, kind: 'cpu', connected: true });
    renumberCpus(); hostBroadcast();
  };
  $('seatList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sid]'); if (!b || !host) return;
    var R = host.room, seat = seatBySid(+b.dataset.sid);
    if (!seat || seat.kind === 'host' || R.phase !== 'lobby') return;
    var doRemove = function () {
      if (seat.kind === 'remote') {
        var c = host.conns[seat.clientId];
        if (c) { try { c.send({ t: 'kicked' }); } catch (x) {} setTimeout(function () { try { c.close(); } catch (x) {} }, 300); delete host.conns[seat.clientId]; }
      }
      R.seats.splice(R.seats.indexOf(seat), 1); renumberCpus(); hostBroadcast();
    };
    if (seat.kind === 'remote' && seat.connected) confirmBox(seat.name + 'を外しますか？', '部屋から退出させます。', '外す', doRemove); else doRemove();
  });
  function optSeg(id, key, parse) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !host || host.room.phase !== 'lobby') return;
      host.room.opts[key] = parse(b.dataset.v); hostBroadcast();
    });
  }
  optSeg('wallSeg', 'walls', function (v) { return +v; });
  optSeg('bumpSeg', 'bumps', function (v) { return v === 'true'; });
  optSeg('cpuSeg', 'cpu', function (v) { return v; });
  $('startBtn').onclick = function () { if (host) hostStartGame(); };
  $('againBtn').onclick = function () { if (host && host.room.phase === 'end') hostStartGame(); };
  $('toLobbyBtn').onclick = function () { if (host && host.room.phase === 'end') hostToLobby('ロビーに戻りました'); };
  $('players').addEventListener('click', function (e) { var b = e.target.closest('button[data-repl]'); if (b && host) hostReplace(+b.dataset.repl); });
  $('hostbar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !host) return;
    if (b.dataset.repl) hostReplace(+b.dataset.repl); else $('hostbar').dataset.dismiss = b.dataset.wait;
  });
  $('copyBtn').onclick = function () {
    var u = $('inviteUrl').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { toast('招待URLをコピーしました'); }, function () { toast('コピーできませんでした。URLを長押ししてコピーしてください'); });
  };
  $('shareBtn').onclick = function () {
    var u = $('inviteUrl').textContent;
    if (navigator.share) navigator.share({ title: 'みえない迷路', text: '見えない壁の迷路で、まほうのしるしを集めよう！', url: u }).catch(function () {});
    else $('copyBtn').click();
  };

  // =====================================================================
  //  参加者（クライアント）
  // =====================================================================
  var client = null;
  var received = [];
  function startClient(code, name) {
    document.body.classList.remove('is-host');
    client = { code: code, name: name, joined: false, lastMsg: Date.now(), everJoined: false, retry: 0 };
    connecting(true, '部屋 ' + code + ' に接続中…', 'しばらくお待ちください', function () { leaveClient(true); });
    var peer = new Peer(PEER_OPTS);
    client.peer = peer;
    peer.on('open', function () { clientConnect(); });
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'peer-unavailable') {
        if (!client.everJoined) { connecting(false); toast('部屋が見つかりません。コードを確認してください。'); leaveClient(false); }
        else clientLost();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!client.everJoined) connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…');
      } else if (e.type === 'browser-incompatible') {
        connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
      }
    });
    clearInterval(client.hbTimer);
    client.hbTimer = setInterval(clientHeartbeat, HB_MS);
    setTimeout(function () {
      if (client && !client.everJoined && $('connecting').classList.contains('active')) $('connText').textContent = 'つながりにくいようです。コードが正しいか、ホストが部屋を開いているか確認してください。（通信環境によっては接続できない場合があります）';
    }, 15000);
  }
  function clientConnect() {
    if (!client || !client.peer || client.peer.destroyed) return;
    if (client.conn) { try { client.conn.close(); } catch (e) {} }
    var conn = client.peer.connect(hostId(client.code), { reliable: true });
    client.conn = conn;
    conn.on('open', function () { conn.send({ t: 'join', name: client.name, clientId: myId }); });
    conn.on('data', function (m) { if (client && client.conn === conn) clientOnMessage(m); });
    conn.on('close', function () { if (client && client.conn === conn) clientLost(); });
    conn.on('error', function () { if (client && client.conn === conn) clientLost(); });
  }
  function clientOnMessage(m) {
    if (!m || typeof m !== 'object') return;
    client.lastMsg = Date.now();
    if (m.t === 'welcome') {
      client.joined = true; client.everJoined = true; client.retry = 0; actLock = '';
      connecting(false); banner('');
      sstore(SS_CLIENT, { code: client.code, name: client.name });
    } else if (m.t === 'state') {
      received.push(m); if (received.length > 5000) received.shift();
      render(m);
    } else if (m.t === 'reject') { connecting(false); toast(m.msg); leaveClient(false); alertBox(m.msg); }
    else if (m.t === 'kicked') { sstore(SS_CLIENT, null); leaveClient(false); alertBox('ホストによって部屋から外されました。'); }
    else if (m.t === 'closed') { sstore(SS_CLIENT, null); leaveClient(false); alertBox('ホストが部屋を閉じました。'); }
    else if (m.t === 'error') toast(m.msg);
  }
  function clientHeartbeat() {
    if (!client) return;
    if (client.conn && client.conn.open) { try { client.conn.send({ t: 'ping' }); } catch (e) {} }
    if (client.everJoined && Date.now() - client.lastMsg > LOST_MS) clientLost();
  }
  function clientLost() {
    if (!client || !client.everJoined) return;
    client.joined = false;
    banner('ホストとの接続が切れました。再接続しています…');
    clearTimeout(client.retryT);
    client.retryT = setTimeout(function () {
      if (!client) return;
      client.retry++; client.lastMsg = Date.now();
      if (client.peer.disconnected && !client.peer.destroyed) { try { client.peer.reconnect(); } catch (e) {} }
      clientConnect();
    }, 3000);
  }
  function leaveClient(sendLeave) {
    if (!client) return;
    if (sendLeave && client.conn && client.conn.open) { try { client.conn.send({ t: 'leave' }); } catch (e) {} }
    clearInterval(client.hbTimer); clearTimeout(client.retryT);
    var p = client.peer; client = null;
    setTimeout(function () { try { p.destroy(); } catch (e) {} }, 300);
    banner(''); connecting(false); show('title'); renderTitle();
  }

  // ---- 操作 ----
  var lastView = null, actLock = '';
  function lockKey(v) { return v && v.g ? v.gameNo + ':' + v.g.seq : ''; }   // ゲームごとに seq は 0 から数え直すので、ゲーム番号と組にする
  function myP(v) { return v && v.g ? v.g.pids.indexOf(v.sid) : -1; }
  function myTurn(v) { return v && v.phase === 'play' && v.g && !v.g.over && v.g.turn === myP(v) && v.seats[v.you] && v.seats[v.you].kind !== 'cpu'; }
  function sendAct(kind, dir) {
    var v = lastView; if (!myTurn(v) || actLock === lockKey(v)) return;
    if (kind === 'roll' && v.g.stage !== 'roll') return;
    if (kind === 'step' && (v.g.stage !== 'move' || !clientCanStep(v.g, myP(v), dir))) return;
    if (kind === 'stop' && (v.g.stage !== 'move' || !clientCanStop(v.g, myP(v)))) return;
    actLock = lockKey(v);
    Snd.unlock();
    if (host) hostAct(kind, dir);
    else if (client && client.conn && client.conn.open) { client.conn.send({ t: 'act', kind: kind, dir: dir, seq: v.g.seq }); renderGame(v); }
  }
  function othersAt(g, me, cell) { for (var k = 0; k < g.players.length; k++) if (k !== me && (g.players[k].pos === cell || g.players[k].start === cell)) return true; return false; }
  function clientCanStep(g, me, d) {
    if (!g || g.stage !== 'move' || g.left <= 0 || g.turn !== me) return false;
    var n = MG.neighbor(g.players[me].pos, d); if (n < 0) return false;
    if (g.left === 1 && othersAt(g, me, n) && !(g.target >= 0 && g.symAt[n] === g.target)) return false;
    return true;
  }
  function clientCanStop(g, me) { return g && g.stage === 'move' && !othersAt(g, me, g.players[me].pos); }
  $('die').onclick = function () { sendAct('roll'); };
  $('stopBtn').onclick = function () { sendAct('stop'); };
  $('dpad').addEventListener('click', function (e) { var b = e.target.closest('button[data-d]'); if (b) sendAct('step', b.dataset.d); });
  $('board').addEventListener('click', function (e) { var c = e.target.closest('.cell.can'); if (c) sendAct('step', c.dataset.d); });
  document.addEventListener('keydown', function (e) {
    if (!$('game').classList.contains('active') || document.querySelector('.overlay.active') || e.target.tagName === 'INPUT') return;
    var k = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' }[e.key];
    if (k) { e.preventDefault(); sendAct('step', k); }
    else if (e.key === ' ' || e.key === 'r') { e.preventDefault(); sendAct('roll'); }
    else if (e.key === 'Enter' || e.key === 's') sendAct('stop');
  });
  function leaveRoom() {
    if (host) {
      confirmBox('部屋を閉じますか？', '参加者全員の接続が切れ、ゲームは終了します。', '部屋を閉じる', function () {
        Object.keys(host.conns).forEach(function (cid) { try { host.conns[cid].send({ t: 'closed' }); } catch (e) {} });
        store(LS_HOST, null);
        setTimeout(function () { try { host.peer.destroy(); } catch (e) {} location.href = location.pathname; }, 400);
      });
    } else {
      confirmBox('部屋を出ますか？', 'ゲーム中に出た場合も、同じニックネームで入り直せば元の席に戻れます。', '部屋を出る', function () { sstore(SS_CLIENT, null); leaveClient(true); });
    }
  }
  $('leaveBtn1').onclick = $('leaveBtn2').onclick = leaveRoom;
  $('menuBtn').onclick = function () { overlay('menuModal', true); };
  function confirmAbort() {
    confirmBox('中断してロビーに戻りますか？', 'いまのゲームを終了して、全員をこの部屋のロビーに戻します。部屋コード・参加者・ふーさん🐻（CPU）・設定はそのままです。', '中断してロビーへ', function () {
      if (host && host.room.phase !== 'lobby') hostToLobby('⏸️ ホストがゲームを中断しました');
    });
  }
  $('menuAbort').onclick = function () { overlay('menuModal', false); confirmAbort(); };
  $('menuReq').onclick = function () { overlay('menuModal', false); if (client && client.conn && client.conn.open) client.conn.send({ t: 'lobbyReq' }); toast('ホストに「ロビーに戻りたい」と伝えました'); };
  $('menuLeave').onclick = function () { overlay('menuModal', false); leaveRoom(); };
  $('menuRules').onclick = function () { overlay('menuModal', false); overlay('rulesModal', true); };
  $('menuClose').onclick = function () { overlay('menuModal', false); };
  $('lobbyReqBar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-lr]'); if (!b || !host) return;
    if (b.dataset.lr === 'no') { host.room.lobbyReq = null; hostBroadcast(); } else confirmAbort();
  });
  var seenNotice = null;
  function abortUi(v) {
    if (seenNotice === null) seenNotice = v.notice ? v.notice.id : 0;
    else if (v.notice && v.notice.id !== seenNotice) { seenNotice = v.notice.id; if (!host && v.phase === 'lobby') toast(v.notice.msg + '。ロビーで次のゲームを待っています'); }
    if (v.phase === 'lobby') { overlay('menuModal', false); hideDrama(); }
    var bar = $('lobbyReqBar'), key = host && v.lobbyReq && v.phase !== 'lobby' ? v.lobbyReq.sid + ':' + v.lobbyReq.at : '';
    if (bar.dataset.key !== key) {
      bar.dataset.key = key;
      bar.innerHTML = key ? '<span>🙋 ' + esc(v.lobbyReq.name) + '「ロビーに戻りたい」</span><button data-lr="abort">中断してロビーへ</button><button data-lr="no" class="ghost">とじる</button>' : '';
      bar.classList.toggle('show', !!key);
    }
  }

  // =====================================================================
  //  描画（ホスト・参加者で共通。受け取ったビューだけを使う）
  // =====================================================================
  var lastEvId = null, endShowAt = 0, endTimer = null, gameKey = '';
  function render(v) {
    lastView = v; window.__lb.view = v;
    abortUi(v);
    if (v.phase === 'lobby') { show('lobby'); renderLobby(v); lastEvId = null; return; }
    handleEvent(v);
    if (v.phase === 'play') { clearTimeout(endTimer); show('game'); renderGame(v); return; }
    // end：最後のしるしの演出を見せてから結果へ
    renderGame(v);
    var wait = endShowAt - Date.now();
    clearTimeout(endTimer);
    if (wait > 0 && !$('end').classList.contains('active')) { show('game'); endTimer = setTimeout(function () { if (lastView && lastView.phase === 'end') { show('end'); renderEnd(lastView); } }, wait); }
    else { show('end'); renderEnd(v); }
  }
  function colorOf(i) { return COLORS[i % COLORS.length].c; }
  function seatOfView(v, i) { var sid = v.g.pids[i]; return v.seats.filter(function (s) { return s.sid === sid; })[0] || { name: '?', kind: 'remote', connected: false }; }

  function renderLobby(v) {
    var isHost = !!host;
    $('codeBig').textContent = v.code;
    var url = inviteUrl(v.code);
    $('inviteUrl').textContent = url;
    if ($('qr').dataset.url !== url) {
      try { var qr = qrcode(0, 'M'); qr.addData(url); qr.make(); $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { $('qr').textContent = ''; }
      $('qr').dataset.url = url;
    }
    var n = v.seats.length;
    $('seatCount').textContent = n + ' / 4人';
    $('seatList').innerHTML = v.seats.map(function (s, i) {
      var tags = '';
      if (s.kind === 'host') tags += '<span class="tag host">ホスト</span>';
      if (s.kind === 'cpu') tags += '<span class="tag cpu">' + BEAR + ' CPU</span>';
      if (i === v.you) tags += '<span class="tag you">あなた</span>';
      if (s.kind === 'remote') tags += s.connected ? '<span class="tag on">接続中</span>' : '<span class="tag off">切断</span>';
      var x = isHost && s.kind !== 'host' ? '<button class="xbtn" data-sid="' + s.sid + '" aria-label="外す">×</button>' : '';
      return '<div class="seat' + (s.connected ? '' : ' offline') + '"><span class="av" style="background:' + colorOf(i) + '">' + (s.kind === 'cpu' ? BEAR : i + 1) + '</span>' +
        '<span class="nm">' + esc(s.name) + '</span>' + tags + x + '</div>';
    }).join('');
    $('addCpuBtn').disabled = n >= MAXP;
    $('seatHint').textContent = n < 2 ? 'あと' + (2 - n) + '人必要です（ふーさん🐻を追加できます）' : n >= MAXP ? '満員です（2〜4人）' : '2〜4人で遊べます（駒の色・スタートの角は上の順番）';
    function seg(id, list, cur) {
      $(id).innerHTML = list.map(function (o) { return '<button data-v="' + o.v + '" class="' + (o.v === cur ? 'on' : '') + '"' + (isHost ? '' : ' disabled') + '>' + o.l + (o.s ? '<small>' + o.s + '</small>' : '') + '</button>'; }).join('');
      $(id).classList.toggle('ro', !isHost);
    }
    seg('wallSeg', WALL_OPTS, v.opts.walls); seg('bumpSeg', BUMP_OPTS, v.opts.bumps); seg('cpuSeg', CPU_OPTS, v.opts.cpu);
    $('startBtn').disabled = n < 2 || n > MAXP;
    $('startBtn').textContent = n < 2 ? 'あと' + (2 - n) + '人でスタートできます' : 'ゲーム開始！（' + n + '人）';
    $('leaveBtn1').textContent = isHost ? '部屋を閉じる' : '部屋を出る';
  }

  // ---- 盤面 ----
  function boardGeom(el) {
    var bs = parseFloat(el.style.getPropertyValue('--bs')) || el.clientWidth || 340;
    var inner = bs - 6 - 8, cell = (inner - 15) / 6;   // 枠線3px×2、内側の余白4px×2、すき間3px×5
    return { bs: bs, cell: cell, gap: 3, inner: inner };
  }
  function cellCenter(geo, c) { var p = MG.rc(c); return { x: p.c * (geo.cell + geo.gap) + geo.cell / 2, y: p.r * (geo.cell + geo.gap) + geo.cell / 2 }; }
  function edgeLine(geo, e) {
    var ab = MG.edgeCells(e), a = cellCenter(geo, ab[0]), b = cellCenter(geo, ab[1]), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, h = geo.cell / 2 + 1.5;
    return a.y === b.y ? { x1: mx, y1: my - h, x2: mx, y2: my + h, mx: mx, my: my } : { x1: mx - h, y1: my, x2: mx + h, y2: my, mx: mx, my: my };
  }
  function buildBoard(el) {
    if (el._built) return;
    var h = '<div class="cells">';
    for (var c = 0; c < 36; c++) h += '<div class="cell" data-c="' + c + '"><span class="s"></span></div>';
    h += '</div><svg class="ov"></svg>';
    for (var p = 0; p < 4; p++) h += '<div class="pawn" data-p="' + p + '" style="display:none"><div class="body"></div></div>';
    el.innerHTML = h; el._built = true;
  }
  var anim = null;   // 壁にぶつかった駒を、ぶつかったマスに少しのあいだ見せる
  function renderBoard(el, v, opt) {
    buildBoard(el);
    var g = v.g, geo = boardGeom(el), me = myP(v);
    var collected = {}; g.players.forEach(function (p) { p.got.forEach(function (s) { collected[s] = true; }); });
    var homes = {}; g.players.forEach(function (p, i) { homes[p.start] = i; });
    var canD = {};
    if (opt.interactive && myTurn(v) && g.stage === 'move' && actLock !== lockKey(v)) {
      ['U', 'D', 'L', 'R'].forEach(function (d) { if (clientCanStep(g, me, d)) canD[MG.neighbor(g.players[me].pos, d)] = d; });
    }
    var trail = {}; if (opt.trail !== false) g.path.forEach(function (c) { if (c >= 0) trail[c] = true; });
    var tc = g.pathBy >= 0 ? colorOf(g.pathBy) : '#fff';
    var cells = el.querySelectorAll('.cell');
    for (var c = 0; c < 36; c++) {
      var ce = cells[c], s = g.symAt[c], cls = 'cell';
      if (homes[c] != null) { cls += ' home'; ce.style.setProperty('--pc', colorOf(homes[c])); }
      if (s >= 0 && s === g.target) cls += ' tgt';
      if (canD[c]) { cls += ' can'; ce.dataset.d = canD[c]; } else delete ce.dataset.d;
      if (trail[c]) { cls += ' trail'; ce.style.setProperty('--tc', tc); }
      if (ce.className !== cls) ce.className = cls;
      var sym = s >= 0 ? MG.SYMBOLS[s].e : '';
      var se = ce.firstChild; if (se.textContent !== sym) se.textContent = sym;
      se.style.opacity = s >= 0 && collected[s] ? '.18' : '';
    }
    // SVG：軌跡・ぶつかった壁（「あり」のとき）・終了後の壁
    var svg = el.querySelector('svg'), W = geo.inner, out = '';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + W);
    svg.style.inset = '4px'; svg.style.width = svg.style.height = W + 'px';
    if (g.walls) g.walls.forEach(function (e) { var L = edgeLine(geo, e); out += '<line x1="' + L.x1 + '" y1="' + L.y1 + '" x2="' + L.x2 + '" y2="' + L.y2 + '" stroke="#ffd166" stroke-width="6" stroke-linecap="round" style="filter:drop-shadow(0 0 4px #ffd166)"/>'; });
    if (g.bumps) {
      var seenE = {};
      g.bumps.forEach(function (b) {
        if (seenE[b.e]) return; seenE[b.e] = true;
        var L = edgeLine(geo, b.e);
        out += '<line x1="' + L.x1 + '" y1="' + L.y1 + '" x2="' + L.x2 + '" y2="' + L.y2 + '" stroke="#ff5d73" stroke-width="' + (g.walls ? 4 : 5) + '" stroke-linecap="round"' + (g.walls ? '' : ' stroke-dasharray="6 4"') + '/>' +
          '<text x="' + L.mx + '" y="' + (L.my + 5) + '" text-anchor="middle" font-size="14" font-weight="900" fill="#fff" stroke="#ff5d73" stroke-width="3" paint-order="stroke">✕</text>';
      });
    }
    if (opt.trail !== false) {
      var pts = g.path.filter(function (c) { return c >= 0; }).map(function (c) { var p = cellCenter(geo, c); return p.x + ',' + p.y; });
      if (pts.length > 1) out += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + tc + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 8" opacity=".95"/>';
      pts.forEach(function (pt, k) { var xy = pt.split(','); out += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="' + (k === 0 ? 4 : 3) + '" fill="' + tc + '" opacity=".8"/>'; });
    }
    if (svg._html !== out) { svg._html = out; svg.innerHTML = out; }
    // 駒
    var pawns = el.querySelectorAll('.pawn'), placed = {};
    for (var p = 0; p < 4; p++) {
      var pe = pawns[p];
      if (p >= g.players.length) { pe.style.display = 'none'; continue; }
      var pos = g.players[p].pos;
      if (anim && anim.p === p && Date.now() < anim.until && opt.interactive) pos = anim.cell;
      var cc = MG.rc(pos), k = placed[pos] = (placed[pos] || 0) + 1;
      var off = k > 1 ? geo.cell * 0.18 * (k - 1) : 0;
      pe.style.display = '';
      pe.style.width = pe.style.height = geo.cell + 'px';
      pe.style.left = pe.style.top = '4px';
      pe.style.setProperty('--pc', colorOf(p));
      var tf = 'translate(' + (cc.c * (geo.cell + geo.gap) + off) + 'px,' + (cc.r * (geo.cell + geo.gap) - off) + 'px)';
      if (pe._tf !== tf) {
        if (pe._tp) { pe.style.transition = 'none'; pe.style.transform = tf; void pe.offsetWidth; pe.style.transition = ''; pe._tp = false; }
        else pe.style.transform = tf;
        pe._tf = tf;
      }
      pe.classList.toggle('cur', !g.over && g.turn === p);
      var st = seatOfView(v, p); pe.firstChild.textContent = st.kind === 'cpu' ? BEAR : '';
    }
  }
  function fitBoard() {
    var w = $('boardWrap'), b = $('board'); if (!$('game').classList.contains('active')) return;
    var size = Math.floor(Math.min(w.clientWidth - 2, w.clientHeight - 4));
    size = Math.max(200, Math.min(size, 520));
    if (b.style.getPropertyValue('--bs') !== size + 'px') { b.style.setProperty('--bs', size + 'px'); if (lastView && lastView.g) renderBoard(b, lastView, { interactive: true }); }
  }
  window.addEventListener('resize', function () { fitBoard(); });

  var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8] };
  function dieFace(n) { var on = PIPS[n] || []; var h = ''; for (var i = 0; i < 9; i++) h += '<i class="' + (on.indexOf(i) >= 0 ? 'on' : '') + '"></i>'; return h; }
  var rollAnim = { until: 0, t: null };

  function renderGame(v) {
    var g = v.g; if (!g) return;
    $('codeChip').textContent = v.code;
    var me = myP(v), np = g.players.length;
    $('players').style.setProperty('--np', np);
    var ph = '';
    for (var i = 0; i < np; i++) {
      var s = seatOfView(v, i), pl = g.players[i], gotH = '';
      for (var k = 0; k < MG.GOAL; k++) gotH += pl.got[k] != null ? '<i>' + MG.SYMBOLS[pl.got[k]].e + '</i>' : '<i class="e">・</i>';
      var badges = (s.kind === 'cpu' && s.replaced ? '<span class="badge cpu">' + BEAR + '代打</span>' : '') + (i === me ? '<span class="badge me">あなた</span>' : '') + (!s.connected ? '<span class="badge off">切断</span>' : '');
      var repl = host && s.kind === 'remote' && !s.connected ? '<button class="repl" data-repl="' + s.sid + '">' + BEAR + 'に交代</button>' : '';
      ph += '<div class="pl' + (!g.over && g.turn === i ? ' cur' : '') + (i === me ? ' me' : '') + '" data-p="' + i + '" style="--pc:' + colorOf(i) + '"><div class="top"><span class="pawnmini" title="集めた数">' + pl.got.length + '</span><span class="nm">' + esc(s.name) + '</span></div>' +
        '<div class="badges">' + badges + '</div><div class="got">' + gotH + '</div>' + repl + '</div>';
    }
    if ($('players')._html !== ph) { $('players')._html = ph; $('players').innerHTML = ph; }
    // 目標
    if (g.target >= 0) { $('tSym').textContent = MG.SYMBOLS[g.target].e; $('tName').textContent = MG.SYMBOLS[g.target].n; }
    else { $('tSym').textContent = '🏆'; $('tName').textContent = 'ゲーム終了'; }
    $('tDeck').innerHTML = 'のこりのしるし<br><b>' + g.deckLeft + '</b>こ';
    renderBoard($('board'), v, { interactive: true });
    $('log').innerHTML = (v.log || []).slice(0, 3).map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('');
    // 手番
    var cur = g.over ? null : seatOfView(v, g.turn), mine = myTurn(v), locked = actLock === lockKey(v), rolling = Date.now() < rollAnim.until;
    var st;
    if (!cur) st = 'ゲーム終了！';
    else if (mine && g.stage === 'roll') st = 'あなたの番！ サイコロをタップしてふろう';
    else if (mine) st = rolling ? 'コロコロ…' : 'のこり' + g.left + '歩：矢印かマスをタップ';
    else if (cur.kind === 'cpu') st = esc(who(cur)) + (g.stage === 'roll' ? 'の番クマ' : 'が迷路を進んでいるクマ') + '<span class="dots"></span>';
    else if (!cur.connected) st = esc(san(cur.name)) + 'の再接続を待っています<span class="dots"></span>';
    else st = esc(san(cur.name)) + (g.stage === 'roll' ? 'がサイコロをふるのを待っています' : 'が進んでいます') + '<span class="dots"></span>';
    $('status').innerHTML = st;
    var die = $('die');
    if (!rolling) { var face = g.stage === 'move' ? g.roll : (g.roll || 0); var fh = face ? dieFace(face) : dieFace(0); if (die._face !== face) { die.innerHTML = fh; die._face = face; } die.classList.toggle('blank', !face); }
    var canRoll = mine && g.stage === 'roll' && !locked;
    die.disabled = !canRoll; die.classList.toggle('ready', canRoll);
    $('dieLab').textContent = canRoll ? 'タップしてふる' : g.stage === 'move' && !rolling ? '出た目：' + g.roll : 'サイコロ';
    if (g.stage === 'move' && !rolling) {
      var dots = ''; for (var q = 0; q < g.roll; q++) dots += '<i class="' + (q < g.left ? 'on' : '') + '"></i>';
      $('stepsLeft').innerHTML = 'のこり <b>' + g.left + '</b> 歩<div class="steps">' + dots + '</div>';
    } else $('stepsLeft').innerHTML = g.over ? '' : '<span style="opacity:.75">サイコロの目（1〜4）だけ進めます</span>';
    var canMove = mine && g.stage === 'move' && !locked && !rolling;
    $('stopBtn').disabled = !(canMove && clientCanStop(g, me));
    Array.prototype.forEach.call($('dpad').querySelectorAll('button'), function (b) { b.disabled = !(canMove && clientCanStep(g, me, b.dataset.d)); });
    $('dpadC').style.background = me >= 0 ? colorOf(me) : '';
    // ホスト：手番の人が切断中なら交代を提案
    var hb = $('hostbar');
    if (host && cur && cur.kind === 'remote' && !cur.connected && hb.dataset.dismiss !== String(cur.sid)) {
      hb.innerHTML = '<span>⚠️ ' + esc(san(cur.name)) + 'の接続が切れています</span><button class="y" data-repl="' + cur.sid + '">' + BEAR + 'ふーさんに交代</button><button class="n" data-wait="' + cur.sid + '">待つ</button>';
      hb.classList.add('show');
    } else hb.classList.remove('show');
    fitBoard();
  }

  // ---- 演出 ----
  var dramaT = null;
  function hideDrama() { clearTimeout(dramaT); var d = $('drama'); d.className = ''; d.innerHTML = ''; }
  $('drama').addEventListener('click', hideDrama);
  function bubble(p, text) {
    if (!text) return;
    var row = document.querySelector('#players .pl[data-p="' + p + '"]'); if (!row) return;
    var b = document.createElement('div'); b.className = 'bubble'; b.textContent = text; row.appendChild(b);
    setTimeout(function () { b.remove(); }, 2300);
  }
  function showDrama(kind, html, ms) {
    var d = $('drama'); clearTimeout(dramaT);
    d.className = 'active ' + kind; d.innerHTML = html;
    dramaT = setTimeout(hideDrama, ms || DRAMA_MS);
  }
  function handleEvent(v) {
    var ev = v.ev;
    if (lastEvId === null) { lastEvId = ev ? ev.id : 0; return; }   // 途中参加・再接続：過去の演出は再生しない
    if (!ev || ev.id === lastEvId) return;
    if (ev.id < lastEvId) { lastEvId = ev.id; return; }             // ホストの再開・新しいゲーム
    lastEvId = ev.id;
    var g = v.g, s = seatOfView(v, ev.p), nm = s.kind === 'cpu' ? who(s) : s.name, mine = ev.p === myP(v);
    if (ev.type === 'roll') {
      Snd.roll();
      var die = $('die'), n = 0; die.classList.add('rolling'); rollAnim.until = Date.now() + 650;
      clearInterval(rollAnim.t); die.classList.remove('blank');
      rollAnim.t = setInterval(function () { die.innerHTML = dieFace(1 + (n++ % 4)); }, 70);
      setTimeout(function () { clearInterval(rollAnim.t); die.classList.remove('rolling'); die.classList.add('landed'); die.innerHTML = dieFace(ev.face); die._face = ev.face; setTimeout(function () { die.classList.remove('landed'); }, 400); if (lastView) renderGame(lastView); }, 650);
      bubble(ev.p, ev.line);
    } else if (ev.type === 'move' || ev.type === 'end') {
      Snd.step();
    } else if (ev.type === 'stop') {
      bubble(ev.p, ev.line || (ev.lost ? 'ここで止まる' : ''));
    } else if (ev.type === 'hit') {
      // ぶつかったマスで「ゴツン」→ 玉が落ちる → スタートへ
      anim = { p: ev.p, cell: ev.from, until: Date.now() + 700 };
      var pawn = $('board').querySelector('.pawn[data-p="' + ev.p + '"]'), geo = boardGeom($('board'));
      var dv = MG.DIRS[ev.dir], bx = dv === 1 ? 1 : dv === -1 ? -1 : 0, by = dv === 6 ? 1 : dv === -6 ? -1 : 0;
      if (pawn) { pawn.style.setProperty('--bx', bx * geo.cell * 0.42 + 'px'); pawn.style.setProperty('--by', by * geo.cell * 0.42 + 'px'); pawn.classList.remove('bonk'); void pawn.offsetWidth; pawn.classList.add('bonk'); }
      var a = cellCenter(geo, ev.from), sp = document.createElement('div');
      sp.className = 'spark'; sp.textContent = '💥';
      sp.style.left = 4 + a.x + bx * (geo.cell / 2 + 1.5) + 'px'; sp.style.top = 4 + a.y + by * (geo.cell / 2 + 1.5) + 'px';
      $('board').appendChild(sp); setTimeout(function () { sp.remove(); }, 950);
      Snd.bonk();
      bubble(ev.p, ev.line);
      setTimeout(function () {
        if (pawn) { pawn.classList.remove('bonk'); pawn._tp = true; }
        anim = null;
        Snd.drop();
        showDrama('hit', '<div class="big">ゴツン！</div><div class="stage"><div class="wallfx"></div><div class="ball"></div><div class="floor"></div></div>' +
          '<div class="msg">' + (mine ? 'あなた' : esc(nm)) + 'は見えない壁にぶつかった！<small>玉がポトン…のこりの歩数はなし。スタートの角🏠にもどります</small></div>', DRAMA_MS);
        if (lastView && lastView.g) renderBoard($('board'), lastView, { interactive: true });
      }, 700);
    } else if (ev.type === 'collect') {
      Snd.step();
      var sym = MG.SYMBOLS[ev.sym], sparks = '';
      for (var k = 0; k < 10; k++) sparks += '<i style="left:' + (10 + Math.random() * 80) + '%;top:' + (10 + Math.random() * 70) + '%;animation-delay:' + (Math.random() * .5).toFixed(2) + 's">✨</i>';
      var got = g.players[ev.p].got.length, gifts = (ev.gifts || []).map(function (x) { var gs = seatOfView(v, x.p); return '<small>🎁 ' + esc(gs.name) + 'は ' + MG.SYMBOLS[x.sym].e + MG.SYMBOLS[x.sym].n + ' の上にいたので、そのままゲット！</small>'; }).join('');
      if (g.over) endShowAt = Date.now() + 300 + DRAMA_MS + 300;
      setTimeout(function () {
        Snd.collect(); if (g.over) setTimeout(Snd.win, 500);
        showDrama('collect', '<div class="sparkles">' + sparks + '</div><div class="big">みつけた！</div><div class="gem">' + sym.e + '</div>' +
          '<div class="msg">' + (mine ? 'あなた' : esc(nm)) + 'が「' + esc(sym.n) + '」をゲット！（' + got + '/' + MG.GOAL + '）' + gifts +
          (g.over ? '<small>🏆 しるしを' + MG.GOAL + 'つ集めた！</small>' : '<small>次のしるし：' + MG.SYMBOLS[g.target].e + ' ' + MG.SYMBOLS[g.target].n + '</small>') + '</div>', DRAMA_MS);
      }, 300);
      bubble(ev.p, ev.line);
    } else if (ev.type === 'stuck') {
      toast(nm + 'は止まれる場所がなく、手番のはじめのマスにもどりました');
    }
  }

  // ---- 結果 ----
  var endKey = '';
  function renderEnd(v) {
    var g = v.g; if (!g) return;
    var ws = seatOfView(v, g.winner);
    $('endTitle').textContent = '🏆 ' + (g.winner === myP(v) ? 'あなたの勝ち！' : ws.name + 'の勝ち！');
    $('endWinner').textContent = 'まほうのしるしを' + MG.GOAL + 'つ集めました！';
    var order = g.players.map(function (p, i) { return i; }).sort(function (a, b) { return (b === g.winner) - (a === g.winner) || g.players[b].got.length - g.players[a].got.length; });
    $('rankList').innerHTML = order.map(function (i) {
      var s = seatOfView(v, i), p = g.players[i];
      return '<div class="rk' + (i === g.winner ? ' win' : '') + '" style="--pc:' + colorOf(i) + '"><span class="pawnmini"></span><span class="nm">' + esc(who(s)) + '</span>' +
        '<span class="syms">' + p.got.map(function (x) { return MG.SYMBOLS[x].e; }).join('') + '</span><span class="n">' + p.got.length + '</span><span class="hits">💥' + (g.hitCount ? g.hitCount[i] : 0) + '回</span></div>';
    }).join('');
    $('wallCount').textContent = (g.walls || []).length;
    var rb = $('revealBoard'), size = Math.min(window.innerWidth - 44, 380);
    rb.style.setProperty('--bs', size + 'px');
    renderBoard(rb, v, { interactive: false, trail: false });
    var k = v.code + ':' + g.turnNo + ':' + g.winner;
    if (k !== endKey) { endKey = k; $('end').querySelector('.col').scrollTop = 0; confetti(); }
    $('leaveBtn2').textContent = host ? '部屋を閉じる' : '部屋を出る';
  }
  function confetti() {
    var colors = ['#ffd166', '#ff5d73', '#4cc9f0', '#7ae582', '#b9a7ff'];
    for (var i = 0; i < 40; i++) {
      var c = document.createElement('div'); c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % colors.length];
      c.style.animationDuration = (2.2 + Math.random() * 2.5) + 's'; c.style.animationDelay = (Math.random() * 1.2) + 's';
      document.body.appendChild(c); setTimeout(function (el) { el.remove(); }.bind(null, c), 6500);
    }
  }

  // =====================================================================
  //  タイトル
  // =====================================================================
  function renderTitle() {
    var syms = ['', '🔮', '', '🗝️', '', '', '🦉', '', '🌙', '', '🍄', '', '', '⭐', '', '', '💎', '', '🪄', '', '', '🐸', '', '📜', '', '🕯️', '', '', '👑', '', '', '', '🧪', '', '🌈', ''];
    $('titleMaze').innerHTML = syms.map(function (s) { return '<span>' + s + '</span>'; }).join('') + '<div class="bear">🐻</div>';
    if (!$('nameIn').value) $('nameIn').value = load(LS_NAME) || '';
    var inv = normCode(Q.get('room'));
    $('inviteJoinBox').style.display = inv.length === 4 ? '' : 'none';
    $('invCode').textContent = inv;
    if (inv.length === 4) $('codeIn').value = inv;
    var saved = load(LS_HOST, true);
    var ok = saved && saved.room && Date.now() - saved.saved < 12 * 3600 * 1000;
    $('resumeBtn').style.display = ok ? '' : 'none';
    if (ok) $('resumeBtn').textContent = '前回の部屋（' + saved.room.code + '）を再開する';
    var joined = sload(SS_CLIENT);
    $('rejoinBtn').style.display = joined ? '' : 'none';
    if (joined) $('rejoinBtn').textContent = '部屋 ' + joined.code + ' に戻る（' + joined.name + '）';
  }
  function getName() {
    var n = cleanName($('nameIn').value);
    if (!n) { toast('ニックネームを入力してください'); $('nameIn').focus(); return null; }
    store(LS_NAME, n); return n;
  }
  $('createBtn').onclick = function () { var n = getName(); if (n) { store(LS_HOST, null); startHost(n, null); } };
  $('resumeBtn').onclick = function () { var saved = load(LS_HOST, true); if (!saved) return; startHost(saved.room.seats[0].name, saved.room); host.resuming = true; };
  function join(code) {
    var n = getName(); if (!n) return;
    code = normCode(code);
    if (code.length !== 4) { toast('4文字の部屋コードを入力してください'); return; }
    startClient(code, n);
  }
  $('joinBtn').onclick = function () { join($('codeIn').value); };
  $('joinInvitedBtn').onclick = function () { join(Q.get('room')); };
  $('rejoinBtn').onclick = function () { var j = sload(SS_CLIENT); if (j) { $('nameIn').value = j.name; startClient(j.code, j.name); } };
  $('codeIn').addEventListener('input', function () { this.value = normCode(this.value); });
  if (location.protocol === 'file:') setTimeout(function () { toast('ファイルを直接開いています。招待URLは公開URL（https）でのみ使えます。'); }, 500);

  // テスト・デバッグ用（壁の配置はホストの host.room にしか存在しません）
  window.__lb = {
    view: null, received: received,
    role: function () { return host ? 'host' : client ? 'client' : 'none'; },
    hostRoom: function () { return host ? host.room : null; },
    sendRaw: function (m) { if (client && client.conn) client.conn.send(m); },
    setDramaMs: function (ms) { DRAMA_MS = ms; }
  };
  renderTitle();
})();
