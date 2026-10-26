(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* РїСЂРёРІР°С‚РЅС‹Р№ СЂРµР¶РёРј */ } },
  };
  const svgHeart = '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.6-4.6-9.6-9.3C1 7.9 3.1 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.6 0 5.7 3.4 4.3 6.7-2 4.7-9.6 9.3-9.6 9.3z" fill="currentColor"/></svg>';
  const svgCrown = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.6 3.8L12 5l4.4 6.8L21 8l-2 10H5L3 8z" fill="currentColor"/></svg>';

  /* ---------- РєС‚Рѕ СЏ Рё РіРґРµ ---------- */
  let clientId = LS.get('nu_id');
  if (!clientId) {
    clientId = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
    LS.set('nu_id', clientId);
  }
  const params = new URLSearchParams(location.search);
  let roomId = (params.get('r') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  if (!roomId) {
    roomId = 'ugolok-' + Math.random().toString(36).slice(2, 8);
    params.set('r', roomId);
    history.replaceState(null, '', location.pathname + '?' + params.toString());
  }
  $('#roomLabel').textContent = 'РєРѕРјРЅР°С‚Р° ' + roomId;

  let myName = LS.get('nu_name') || '';
  const state = { video: null, game: null, users: [], offset: 0 };
  const serverNow = () => Date.now() + state.offset;
  const socket = io({ autoConnect: false });

  /* ---------- РјРµР»РѕС‡Рё ---------- */
  let toastTimer = null;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }
  const fmtClock = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function armable(btn, label, armedLabel, action) {
    let armed = false, t = null;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (!armed) {
        armed = true; btn.classList.add('is-armed'); btn.textContent = armedLabel;
        t = setTimeout(() => { armed = false; btn.classList.remove('is-armed'); btn.textContent = label; }, 3000);
        return;
      }
      clearTimeout(t); action();
    });
    return btn;
  }

  /* ---------- РІС…РѕРґ ---------- */
  const nameInput = $('#nameInput');
  nameInput.value = myName;
  setTimeout(() => nameInput.focus(), 50);
  $('#nameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = nameInput.value.trim().slice(0, 24);
    if (!n) return;
    myName = n;
    LS.set('nu_name', n);
    $('#nameModal').hidden = true;
    socket.connect();
  });

  socket.on('connect', () => {
    socket.emit('hello', { room: roomId, clientId, name: myName }, onWelcome);
    syncClock();
  });
  socket.on('disconnect', () => toast('РЎРІСЏР·СЊ РїРѕС‚РµСЂСЏРЅР°, РїРµСЂРµРїРѕРґРєР»СЋС‡Р°СЋСЃСЊвЂ¦'));

  function syncClock() {
    let best = null, n = 0;
    const one = () => {
      const t0 = Date.now();
      socket.emit('clock', null, (s) => {
        const t1 = Date.now(), rtt = t1 - t0;
        if (!best || rtt < best.rtt) best = { rtt, off: s - (t0 + t1) / 2 };
        state.offset = best.off;
        if (++n < 4) setTimeout(one, 250);
      });
    };
    one();
  }

  function onWelcome(d) {
    if (!d || !d.ok) return;
    state.offset = d.serverNow - Date.now();
    state.users = d.users;
    state.game = d.game;
    state.video = d.video;
    chatList.innerHTML = '';
    lastMsg = null;
    if (!d.chat.length) showChatEmpty();
    d.chat.forEach((m) => appendMsg(m, false));
    scrollChat(true);
    renderPeople();
    renderGame();
    currentUrl = null; // РїРµСЂРµР·Р°РіСЂСѓР·РёС‚СЊ РїР»РµРµСЂ РЅР° СЃР»СѓС‡Р°Р№ РїРµСЂРµРїРѕРґРєР»СЋС‡РµРЅРёСЏ
    loadVideo(state.video);
  }

  /* ---------- Р»СЋРґРё ---------- */
  socket.on('users', (u) => { state.users = u; renderPeople(); renderGame(); });
  socket.on('joined', ({ name }) => toast(`${name} Р·Р°С…РѕРґРёС‚ РІ СѓРіРѕР»РѕРє`));

  function renderPeople() {
    const box = $('#people');
    box.innerHTML = '';
    const list = [...state.users].sort((a, b) => (a.id === clientId ? -1 : b.id === clientId ? 1 : 0));
    for (const u of list) {
      const el = document.createElement('span');
      el.className = 'person' + (u.id === clientId ? ' is-me' : '');
      const av = document.createElement('span');
      av.className = 'avatar';
      av.textContent = (u.name || '?').trim().charAt(0).toUpperCase();
      const nm = document.createElement('span');
      nm.className = 'person-name';
      nm.textContent = u.name;
      el.append(av, nm);
      if (u.id === clientId) {
        const y = document.createElement('span');
        y.className = 'person-you person-name';
        y.textContent = 'С‚С‹';
        el.append(y);
      }
      el.title = u.name + ' вЂ” РІ СЃРµС‚Рё';
      box.append(el);
    }
    if (list.length < 2) {
      const a = document.createElement('span');
      a.className = 'people-alone';
      a.textContent = 'Р¶РґС‘Рј РІС‚РѕСЂРѕРіРѕ';
      box.append(a);
    }
  }

  $('#inviteBtn').addEventListener('click', async () => {
    const link = location.origin + location.pathname + '?r=' + encodeURIComponent(roomId);
    try { await navigator.clipboard.writeText(link); toast('РЎСЃС‹Р»РєР° СЃРєРѕРїРёСЂРѕРІР°РЅР° вЂ” РѕС‚РїСЂР°РІСЊ РµС‘ РІС‚РѕСЂРѕРјСѓ'); }
    catch { window.prompt ? window.prompt('РЎРєРѕРїРёСЂСѓР№ СЃСЃС‹Р»РєСѓ:', link) : toast(link); }
  });

  /* ---------- РІРєР»Р°РґРєРё ---------- */
  let activeTab = 'cinema';
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
  function setTab(name) {
    activeTab = name;
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('is-active', p.id === 'pane-' + name));
    updateGameDot();
  }

  /* ---------- С‡Р°С‚ ---------- */
  const chatList = $('#chatList');
  let lastMsg = null;
  function showChatEmpty() {
    const p = document.createElement('p');
    p.className = 'chat-empty';
    p.id = 'chatEmpty';
    p.textContent = 'Р—РґРµСЃСЊ Р±СѓРґРµС‚ РІР°С€Р° РїРµСЂРµРїРёСЃРєР°. РќР°РїРёС€Рё РїРµСЂРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ.';
    chatList.append(p);
  }
  function scrollChat(force) {
    const near = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 120;
    if (force || near) chatList.scrollTop = chatList.scrollHeight;
  }
  function appendMsg(m, scroll = true) {
    const empty = $('#chatEmpty');
    if (empty) empty.remove();
    if (m.sys) {
      const el = document.createElement('div');
      el.className = 'msg-sys';
      el.textContent = m.text + ' В· ' + fmtClock(m.ts);
      chatList.append(el);
      lastMsg = null;
    } else {
      const mine = m.clientId === clientId;
      const cont = lastMsg && lastMsg.clientId === m.clientId && m.ts - lastMsg.ts < 3 * 60 * 1000;
      const el = document.createElement('div');
      el.className = 'msg' + (mine ? ' mine' : '') + (cont ? ' cont' : '');
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      meta.textContent = (mine ? 'С‚С‹' : m.name) + ' В· ' + fmtClock(m.ts);
      const b = document.createElement('div');
      b.className = 'msg-bubble';
      b.textContent = m.text;
      el.append(meta, b);
      chatList.append(el);
      lastMsg = m;
    }
    if (scroll) scrollChat(m.clientId === clientId);
  }
  socket.on('chat', (m) => {
    appendMsg(m);
    if (!m.sys && m.clientId !== clientId) $('#typing').textContent = '';
  });
  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#chatInput');
    const text = inp.value.trim();
    if (!text) return;
    socket.emit('chat', { text });
    inp.value = '';
  });
  let lastTypingSent = 0;
  $('#chatInput').addEventListener('input', () => {
    if (Date.now() - lastTypingSent > 2000) { lastTypingSent = Date.now(); socket.emit('typing'); }
  });
  let typingTimer = null;
  socket.on('typing', ({ name }) => {
    $('#typing').textContent = `${name} РїРµС‡Р°С‚Р°РµС‚вЂ¦`;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { $('#typing').textContent = ''; }, 3000);
  });

  /* ---------- СЃРµСЂРґРµС‡РєРё ---------- */
  $('#heartBtn').addEventListener('click', () => socket.emit('react'));
  socket.on('react', ({ name, actor }) => {
    spawnHearts();
    if (actor !== socket.id) toast(`${name} РѕС‚РїСЂР°РІР»СЏРµС‚ СЃРµСЂРґРµС‡РєРѕ`);
  });
  function spawnHearts() {
    const box = $('#hearts');
    if (activeTab !== 'cinema') setTab('cinema');
    for (let i = 0; i < 7; i++) {
      const h = document.createElement('div');
      h.className = 'heart';
      h.innerHTML = svgHeart;
      h.style.left = (10 + Math.random() * 80) + '%';
      h.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      h.style.setProperty('--rot', (Math.random() * 50 - 25) + 'deg');
      h.style.animationDelay = (i * 0.12) + 's';
      const s = 22 + Math.random() * 20;
      h.style.width = h.style.height = s + 'px';
      box.append(h);
      setTimeout(() => h.remove(), 3400);
    }
  }

  /* ================= Р’РР”Р•Рћ ================= */
  const video = $('#video');
  const ytWrap = $('#ytWrap');
  let kind = null; // 'yt' | 'file' | null
  let yt = null, ytReady = false, hls = null, currentUrl = null;
  let ytTitle = '';
  let suppressUntil = 0;
  const suppress = (ms = 1500) => { suppressUntil = Date.now() + ms; };
  const suppressed = () => Date.now() < suppressUntil;
  const expectedTime = (v) => v.time + (v.playing ? Math.max(0, serverNow() - v.ts) / 1000 : 0);

  function parseYouTube(u) {
    try {
      const x = new URL(u);
      const h = x.hostname.replace(/^(www|m|music)\./, '');
      if (h === 'youtu.be') return x.pathname.slice(1).split('/')[0] || null;
      if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
        if (x.searchParams.get('v')) return x.searchParams.get('v');
        const m = x.pathname.match(/\/(embed|shorts|live|v)\/([\w-]{6,})/);
        if (m) return m[2];
      }
    } catch { /* РЅРµ URL */ }
    return null;
  }

  let ytApi = null;
  function loadYTApi() {
    if (ytApi) return ytApi;
    ytApi = new Promise((res) => {
      if (window.YT && window.YT.Player) return res();
      window.onYouTubeIframeAPIReady = () => res();
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.append(s);
    });
    return ytApi;
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.append(s);
    });
  }

  const P = {
    time() {
      if (kind === 'yt') return yt && ytReady ? (yt.getCurrentTime() || 0) : 0;
      if (kind === 'file') return video.currentTime || 0;
      return 0;
    },
    playing() {
      if (kind === 'yt') { if (!ytReady) return false; const s = yt.getPlayerState(); return s === 1 || s === 3; }
      if (kind === 'file') return !video.paused && !video.ended;
      return false;
    },
    play() {
      if (kind === 'yt') { if (ytReady) yt.playVideo(); return Promise.resolve(); }
      if (kind === 'file') return video.play();
      return Promise.resolve();
    },
    pause() {
      if (kind === 'yt' && ytReady) yt.pauseVideo();
      if (kind === 'file') video.pause();
    },
    seek(t) {
      if (kind === 'yt' && ytReady) yt.seekTo(t, true);
      if (kind === 'file') { try { video.currentTime = t; } catch { /* РµС‰С‘ РЅРµ Р·Р°РіСЂСѓР¶РµРЅРѕ */ } }
    },
  };

  function showError(text) { const el = $('#stageError'); el.textContent = text; el.hidden = false; }
  const showJoin = () => { $('#joinBtn').hidden = false; };
  const hideJoin = () => { $('#joinBtn').hidden = true; };
  $('#joinBtn').addEventListener('click', () => { hideJoin(); applyState(true); });

  function teardown() {
    suppress(2000);
    kind = null; ytReady = false; ytTitle = '';
    if (yt) { try { yt.destroy(); } catch { /* СѓР¶Рµ СѓРЅРёС‡С‚РѕР¶РµРЅ */ } yt = null; }
    ytWrap.hidden = true;
    ytWrap.innerHTML = '<div id="ytPlayer"></div>';
    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
    hideJoin();
    $('#stageError').hidden = true;
  }

  async function loadVideo(v) {
    const url = (v && v.url) || '';
    if (url === currentUrl) { applyState(); return; }
    currentUrl = url;
    teardown();
    if (!url) { $('#stageEmpty').hidden = false; updateNow(); return; }
    $('#stageEmpty').hidden = true;
    const id = parseYouTube(url);
    if (id) {
      kind = 'yt';
      ytWrap.hidden = false;
      await loadYTApi();
      if (currentUrl !== url) return;
      yt = new YT.Player('ytPlayer', {
        videoId: id, width: '100%', height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(expectedTime(state.video)) },
        events: {
          onReady: () => {
            ytReady = true;
            try { ytTitle = (yt.getVideoData() || {}).title || ''; } catch { ytTitle = ''; }
            updateNow();
            applyState(true);
          },
          onStateChange: onYtState,
          onError: () => showError('YouTube РЅРµ СЂР°Р·СЂРµС€Р°РµС‚ РїРѕРєР°Р·Р°С‚СЊ СЌС‚Рѕ РІРёРґРµРѕ РІРѕ РІСЃС‚СЂРѕРµРЅРЅРѕРј РїР»РµРµСЂРµ. РџРѕРїСЂРѕР±СѓР№ РґСЂСѓРіСѓСЋ СЃСЃС‹Р»РєСѓ.'),
        },
      });
    } else {
      kind = 'file';
      video.hidden = false;
      const isHls = /\.m3u8(\?|#|$)/i.test(url);
      if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
        try { if (!window.Hls) await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js'); } catch { /* РЅРёР¶Рµ вЂ” Р·Р°РїР°СЃРЅРѕР№ РІР°СЂРёР°РЅС‚ */ }
        if (currentUrl !== url) return;
        if (window.Hls && Hls.isSupported()) { hls = new Hls(); hls.loadSource(url); hls.attachMedia(video); }
        else video.src = url;
      } else {
        video.src = url;
      }
      video.addEventListener('loadedmetadata', () => applyState(true), { once: true });
    }
    updateNow();
  }

  video.addEventListener('error', () => {
    if (kind !== 'file') return;
    showError('РќРµ РїРѕР»СѓС‡РёР»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РІРёРґРµРѕ. РќСѓР¶РЅР° РїСЂСЏРјР°СЏ СЃСЃС‹Р»РєР° РЅР° С„Р°Р№Р» (.mp4, .webm, .m3u8) РёР»Рё СЃСЃС‹Р»РєР° РЅР° YouTube. РЎС‚СЂР°РЅРёС†С‹ РѕРЅР»Р°Р№РЅ-РєРёРЅРѕС‚РµР°С‚СЂРѕРІ С‚Р°Рє РЅРµ РѕС‚РєСЂС‹РІР°СЋС‚СЃСЏ.');
  });

  function applyState(force) {
    const v = state.video;
    if (!v || !v.url || !kind) return;
    if (kind === 'yt' && !ytReady) return;
    // Р’РёРґРµРѕ РµС‰С‘ РЅРµ Р·Р°РїСѓСЃРєР°Р»Рё Рё РѕРЅРѕ РЅР° РїР°СѓР·Рµ: РЅРµ С‚СЂРѕРіР°РµРј РїР»РµРµСЂ,
    // РёРЅР°С‡Рµ YouTube РЅР° С‚РµР»РµС„РѕРЅРµ РїСЂСЏС‡РµС‚ РїСЂРµРІСЊСЋ Рё РїРѕРєР°Р·С‹РІР°РµС‚ С‡С‘СЂРЅС‹Р№ СЌРєСЂР°РЅ
    if (kind === 'yt' && !v.playing && [-1, 5].includes(yt.getPlayerState())) { hideJoin(); updateNow(); return; }
    suppress(1500);
    const t = expectedTime(v);
    if (force || Math.abs(P.time() - t) > 1.2) P.seek(t);
    if (v.playing) {
      const pr = P.play();
      if (pr && pr.catch) pr.catch(() => showJoin());
      setTimeout(() => { if (state.video.playing && kind && !P.playing()) showJoin(); }, 2500);
    } else {
      P.pause();
      hideJoin();
    }
    updateNow();
  }

  function localChange(playing, action) {
    if (!kind || suppressed()) return;
    const v = state.video;
    if (!v || !v.url) return;
    const time = P.time();
    if (v.playing === playing && Math.abs(expectedTime(v) - time) < 1.5) return;
    if (!action) action = v.playing === playing ? 'seek' : (playing ? 'play' : 'pause');
    state.video = { ...v, playing, time, ts: serverNow(), by: myName, action };
    socket.emit('video:state', { playing, time, action });
    if (playing) hideJoin();
    updateNow();
  }

  video.addEventListener('play', () => localChange(true));
  video.addEventListener('pause', () => { if (video.seeking || video.ended) return; localChange(false); });
  video.addEventListener('seeked', () => localChange(!video.paused));
  function onYtState(e) {
    if (e.data === 1) { hideJoin(); localChange(true); }
    else if (e.data === 2) localChange(false);
  }

  // РџРµСЂРµРјРѕС‚РєР° YouTube РЅР° РїР°СѓР·Рµ Рё РїРѕРґСЃС‚СЂРѕР№РєР° СЂР°СЃСЃРёРЅС…СЂРѕРЅР°
  let lastT = 0, tick = 0;
  setInterval(() => {
    const v = state.video;
    if (!v || !v.url || !kind || (kind === 'yt' && !ytReady)) return;
    const t = P.time();
    tick++;
    if (suppressed()) { lastT = t; return; }
    if (!v.playing) {
      if (kind === 'yt' && Math.abs(t - lastT) > 1.5 && Math.abs(t - v.time) > 1.5) localChange(false, 'seek');
    } else if (P.playing() && tick % 3 === 0) {
      const exp = expectedTime(v);
      if (Math.abs(t - exp) > 2.5) { suppress(1500); P.seek(exp); }
    }
    lastT = t;
    if (tick % 5 === 0) updateNow();
  }, 1000);

  socket.on('video', (v) => {
    state.video = v;
    if (v.actor === socket.id) { updateNow(); return; }
    if (v.url !== currentUrl) {
      loadVideo(v);
      if (v.url && activeTab !== 'cinema') setTab('cinema');
    } else {
      applyState();
    }
    const words = { play: 'РІРєР»СЋС‡Р°РµС‚', pause: 'СЃС‚Р°РІРёС‚ РЅР° РїР°СѓР·Сѓ', seek: 'РїРµСЂРµРјР°С‚С‹РІР°РµС‚ РЅР° ' + fmtTime(v.time), set: 'СЃС‚Р°РІРёС‚ РЅРѕРІРѕРµ РІРёРґРµРѕ' };
    if (v.by && words[v.action]) toast(`${v.by} ${words[v.action]}`);
  });

  function updateNow() {
    const v = state.video;
    const pill = $('#nowPill'), text = $('#nowText');
    pill.className = 'now-pill';
    if (!v || !v.url) { pill.textContent = 'РїСѓСЃС‚Рѕ'; text.textContent = 'РќРёС‡РµРіРѕ РЅРµ РёРіСЂР°РµС‚'; return; }
    pill.textContent = v.playing ? 'РёРґС‘С‚' : 'РїР°СѓР·Р°';
    pill.classList.add(v.playing ? 'is-playing' : 'is-paused');
    let label = ytTitle;
    if (!label) {
      try {
        const u = new URL(v.url);
        label = parseYouTube(v.url) ? 'YouTube' : decodeURIComponent(u.pathname.split('/').pop() || u.hostname);
      } catch { label = v.url; }
    }
    const t = fmtTime(kind ? P.time() : expectedTime(v));
    text.textContent = `${label} В· ${t}${v.by ? ' В· РїРѕСЃР»РµРґРЅРµРµ РґРµР№СЃС‚РІРёРµ: ' + v.by : ''}`;
    text.title = v.url;
  }

  $('#urlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#urlInput').value.trim();
    if (!/^https?:\/\//i.test(url)) { toast('РЎСЃС‹Р»РєР° РґРѕР»Р¶РЅР° РЅР°С‡РёРЅР°С‚СЊСЃСЏ СЃ http:// РёР»Рё https://'); return; }
    socket.emit('video:set', { url });
    state.video = { url, playing: false, time: 0, ts: serverNow(), by: myName, action: 'set' };
    loadVideo(state.video);
    $('#urlInput').value = '';
  });

  $('#syncBtn').addEventListener('click', () => {
    socket.emit('video:get', null, (d) => {
      if (!d) return;
      state.video = d.video;
      if (d.video.url !== currentUrl) loadVideo(d.video); else applyState(true);
      toast('РЎРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°РЅРѕ');
    });
  });

  $('#fsBtn').addEventListener('click', () => {
    const stage = $('#stage');
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
    else if (kind === 'file' && video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });

  /* ================= РЁРђРЁРљР ================= */
  const boardEl = $('#board');
  let sel = null; // { prefix: [[r,c], ...] }
  const key = (sq) => sq[0] * 8 + sq[1];
  const prefixMatch = (path, prefix) => prefix.every((sq, i) => path[i] && path[i][0] === sq[0] && path[i][1] === sq[1]);
  const colorWord = { w: 'Р±РµР»С‹Рµ', b: 'С‡С‘СЂРЅС‹Рµ' };
  const colorWordGen = { w: 'Р±РµР»С‹С…', b: 'С‡С‘СЂРЅС‹С…' };

  socket.on('game', (g) => {
    const wasMyTurn = state.game && canAct();
    state.game = g;
    sel = null;
    renderGame();
    if (!wasMyTurn && canAct() && activeTab !== 'game') toast('РўРІРѕР№ С…РѕРґ РІ С€Р°С€РєР°С…');
  });

  const mySeats = () => {
    const g = state.game;
    if (!g) return [];
    return ['w', 'b'].filter((c) => g.seats[c] === clientId);
  };
  const viewColor = () => { const s = mySeats(); return s.length === 1 ? s[0] : 'w'; };
  const canAct = () => {
    const g = state.game;
    return !!g && g.status === 'playing' && g.seats[g.turn] === clientId;
  };
  const nameOf = (id) => (id && state.game.names[id]) || '';
  const isOnline = (id) => state.users.some((u) => u.id === id);

  function updateGameDot() {
    $('#gameDot').hidden = !(canAct() && activeTab !== 'game');
  }

  function renderSeat(el, color) {
    const g = state.game;
    const id = g.seats[color];
    const board = g.board || Checkers.initialBoard();
    el.className = 'seat' + (g.status === 'playing' && g.turn === color ? ' is-turn' : '');
    el.innerHTML = '';
    const piece = document.createElement('span');
    piece.className = 'seat-piece ' + color;
    const info = document.createElement('div');
    info.className = 'seat-info';
    const label = document.createElement('span');
    label.className = 'seat-label';
    label.textContent = color === 'w' ? 'Р‘РµР»С‹Рµ' : 'Р§С‘СЂРЅС‹Рµ';
    const nm = document.createElement('span');
    nm.className = 'seat-name' + (id ? '' : ' is-empty');
    nm.textContent = id ? nameOf(id) + (id === clientId ? ' (С‚С‹)' : '') + (isOnline(id) ? '' : ' В· РЅРµ РІ СЃРµС‚Рё') : 'РјРµСЃС‚Рѕ СЃРІРѕР±РѕРґРЅРѕ';
    const left = document.createElement('span');
    left.className = 'seat-left';
    left.textContent = g.board ? `РЅР° РґРѕСЃРєРµ ${Checkers.countPieces(board, color)}` : '';
    info.append(label, nm, left);
    el.append(piece, info);
  }

  function renderGame() {
    const g = state.game;
    if (!g) return;
    const vc = viewColor();
    const topColor = vc === 'w' ? 'b' : 'w';
    renderSeat($('#seatTop'), topColor);
    renderSeat($('#seatBottom'), vc);
    const sc = (c) => (g.seats[c] && g.scores[g.seats[c]]) || 0;
    $('#scoreNums').textContent = `${sc(topColor)} : ${sc(vc)}`;
    $('#draws').textContent = `РЅРёС‡СЊРёС… ${g.draws || 0}`;

    const tl = $('#turnLine');
    if (g.status === 'playing') {
      tl.innerHTML = '';
      const s = document.createElement('strong');
      s.textContent = canAct() ? 'РўРІРѕР№ С…РѕРґ' : `РҐРѕРґСЏС‚ ${colorWord[g.turn]}`;
      tl.append(s);
      if (!canAct() && g.seats[g.turn]) tl.append(` вЂ” ${nameOf(g.seats[g.turn])}`);
      tl.append(` В· РїР°СЂС‚РёСЏ в„–${g.gameNo}, С…РѕРґ ${Math.floor(g.moveNo / 2) + 1}`);
    } else {
      tl.textContent = g.gameNo ? `РЎС‹РіСЂР°РЅРѕ РїР°СЂС‚РёР№: ${g.gameNo}` : '';
    }

    renderBoard();
    renderOverlay();
    renderControls();
    updateGameDot();
  }

  function renderBoard() {
    const g = state.game;
    const board = g.board || Checkers.initialBoard();
    const flip = viewColor() === 'b';
    const act = canAct();
    const moves = act ? Checkers.legalMoves(board, g.turn) : [];
    const cand = sel ? moves.filter((m) => prefixMatch(m.path, sel.prefix)) : moves;
    const movable = new Set(sel && sel.prefix.length > 1 ? [] : moves.map((m) => key(m.path[0])));
    const targets = new Set(sel ? cand.map((m) => m.path[sel.prefix.length]).filter(Boolean).map(key) : []);
    const pendingCaps = new Set(sel && cand[0] ? cand[0].captures.slice(0, sel.prefix.length - 1).map(key) : []);
    const lastSq = new Set(g.lastMove && g.status !== 'idle' ? [g.lastMove.path[0], g.lastMove.path[g.lastMove.path.length - 1]].map(key) : []);
    const lastCaps = new Set(g.lastMove && g.status !== 'idle' ? g.lastMove.captures.map(key) : []);

    // Р’Рѕ РІСЂРµРјСЏ РјРЅРѕРіРѕС…РѕРґРѕРІРѕРіРѕ Р±РѕСЏ РїРѕРєР°Р·С‹РІР°РµРј С€Р°С€РєСѓ РЅР° РїСЂРѕРјРµР¶СѓС‚РѕС‡РЅРѕР№ РєР»РµС‚РєРµ
    let shown = board;
    if (sel && sel.prefix.length > 1) {
      shown = board.map((row) => row.slice());
      const [sr, sc] = sel.prefix[0];
      const [er, ec] = sel.prefix[sel.prefix.length - 1];
      const p = shown[sr][sc];
      shown[sr][sc] = null;
      shown[er][ec] = p;
    }

    const frag = document.createDocumentFragment();
    for (let vr = 0; vr < 8; vr++) {
      for (let vcol = 0; vcol < 8; vcol++) {
        const r = flip ? 7 - vr : vr;
        const c = flip ? 7 - vcol : vcol;
        const dark = (r + c) % 2 === 1;
        const sq = document.createElement('div');
        const k = r * 8 + c;
        let cls = 'sq ' + (dark ? 'dark' : 'light');
        if (dark) {
          if (lastSq.has(k)) cls += ' last';
          if (targets.has(k)) cls += ' target';
          if (movable.has(k)) cls += ' movable';
          if (sel && key(sel.prefix[sel.prefix.length - 1]) === k) cls += ' selected';
          if (pendingCaps.has(k)) cls += ' cap-pending';
          if (lastCaps.has(k) && !shown[r][c]) cls += ' cap-last';
        }
        sq.className = cls;
        sq.dataset.r = r;
        sq.dataset.c = c;
        if (vcol === 0) {
          const l = document.createElement('span'); l.className = 'coord rank'; l.textContent = String(8 - r); sq.append(l);
        }
        if (vr === 7) {
          const l = document.createElement('span'); l.className = 'coord file'; l.textContent = 'abcdefgh'[c]; sq.append(l);
        }
        const p = shown[r][c];
        if (p) {
          const pc = document.createElement('div');
          pc.className = 'piece ' + Checkers.colorOf(p) + (Checkers.isKing(p) ? ' king' : '');
          if (Checkers.isKing(p)) pc.innerHTML = svgCrown;
          sq.append(pc);
        } else if (lastCaps.has(k)) {
          const gh = document.createElement('div'); gh.className = 'piece-ghost'; sq.append(gh);
        }
        frag.append(sq);
      }
    }
    boardEl.replaceChildren(frag);
  }

  boardEl.addEventListener('click', (e) => {
    const sqEl = e.target.closest('.sq.dark');
    if (!sqEl || !canAct()) return;
    const g = state.game;
    const r = +sqEl.dataset.r, c = +sqEl.dataset.c, k = r * 8 + c;
    const moves = Checkers.legalMoves(g.board, g.turn);
    if (sel) {
      const cand = moves.filter((m) => prefixMatch(m.path, sel.prefix));
      const next = cand.filter((m) => m.path[sel.prefix.length] && key(m.path[sel.prefix.length]) === k);
      if (next.length) {
        const prefix = sel.prefix.concat([[r, c]]);
        const done = next.find((m) => m.path.length === prefix.length);
        if (done) { sel = null; sendMove(done.path); }
        else sel = { prefix };
        renderBoard();
        return;
      }
      if (sel.prefix.length > 1) { toast('Р‘РѕР№ РЅСѓР¶РЅРѕ РїСЂРѕРґРѕР»Р¶РёС‚СЊ'); return; }
    }
    if (moves.some((m) => key(m.path[0]) === k)) {
      sel = sel && key(sel.prefix[0]) === k ? null : { prefix: [[r, c]] };
    } else {
      if (g.board[r][c] && Checkers.colorOf(g.board[r][c]) === g.turn && moves.length && moves[0].captures.length) toast('Р‘РёС‚СЊ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ вЂ” РІС‹Р±РµСЂРё С€Р°С€РєСѓ, РєРѕС‚РѕСЂР°СЏ РјРѕР¶РµС‚ Р±РёС‚СЊ');
      sel = null;
    }
    renderBoard();
  });

  function sendMove(path) {
    socket.emit('game:move', { path }, (res) => {
      if (res && !res.ok) { toast(res.error || 'РҐРѕРґ РЅРµ РїСЂРёРЅСЏС‚'); renderGame(); }
    });
  }

  function renderOverlay() {
    const g = state.game;
    const ov = $('#boardOverlay');
    let title = '', text = '';
    if (g.status === 'over') {
      if (g.winner === 'draw') { title = 'РќРёС‡СЊСЏ'; text = 'РЎР»РµРґСѓСЋС‰СѓСЋ РїР°СЂС‚РёСЋ РЅР°С‡РЅС‘С‚Рµ СЃ РїРµСЂРµРјРµРЅРѕР№ С†РІРµС‚Р°.'; }
      else {
        const wid = g.seats[g.winner];
        title = wid === clientId && mySeats().length === 1 ? 'РџРѕР±РµРґР°!' : `РџРѕР±РµРґР° ${colorWordGen[g.winner]}`;
        text = `${nameOf(wid)} Р·Р°Р±РёСЂР°РµС‚ РїР°СЂС‚РёСЋ. РЎР»РµРґСѓСЋС‰Р°СЏ вЂ” СЃ РїРµСЂРµРјРµРЅРѕР№ С†РІРµС‚Р°.`;
      }
    } else if (g.status !== 'playing') {
      if (!g.seats.w || !g.seats.b) { title = 'РЎР°РґРёС‚РµСЃСЊ Р·Р° РґРѕСЃРєСѓ'; text = 'РљР°Р¶РґС‹Р№ РІС‹Р±РёСЂР°РµС‚ СЃРІРѕР±РѕРґРЅС‹Р№ С†РІРµС‚ РєРЅРѕРїРєР°РјРё РЅРёР¶Рµ.'; }
      else { title = 'Р’СЃС‘ РіРѕС‚РѕРІРѕ'; text = 'Р‘РµР»С‹Рµ РЅР°С‡РёРЅР°СЋС‚. РќР°Р¶РјРёС‚Рµ В«РќР°С‡Р°С‚СЊ РїР°СЂС‚РёСЋВ».'; }
    }
    ov.hidden = !title;
    $('#overlayTitle').textContent = title;
    $('#overlayText').textContent = text;
  }

  function btn(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.textContent = label;
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function renderControls() {
    const g = state.game;
    const box = $('#gameControls');
    box.innerHTML = '';
    const seated = mySeats().length > 0;
    if (g.status !== 'playing') {
      for (const c of ['w', 'b']) {
        const id = g.seats[c];
        if (!id || (id !== clientId && !isOnline(id))) {
          box.append(btn(`РЎРµСЃС‚СЊ Р·Р° ${colorWordGen[c]}`, 'btn-ghost', () => socket.emit('game:sit', { color: c })));
        }
      }
      if (g.seats.w && g.seats.b && seated) {
        if (g.status === 'over') box.append(btn('РЎР»РµРґСѓСЋС‰Р°СЏ РїР°СЂС‚РёСЏ В· С†РІРµС‚Р° РјРµРЅСЏСЋС‚СЃСЏ', 'btn-primary', () => socket.emit('game:start')));
        else {
          box.append(btn('РќР°С‡Р°С‚СЊ РїР°СЂС‚РёСЋ', 'btn-primary', () => socket.emit('game:start')));
          box.append(btn('РџРѕРјРµРЅСЏС‚СЊСЃСЏ С†РІРµС‚Р°РјРё', 'btn-ghost', () => socket.emit('game:swap')));
        }
      }
      if (seated) box.append(btn('Р’СЃС‚Р°С‚СЊ РёР·-Р·Р° РґРѕСЃРєРё', 'btn-ghost btn-sm', () => socket.emit('game:stand')));
    } else if (seated) {
      const myColor = g.seats[g.turn] === clientId ? g.turn : mySeats()[0];
      if (g.drawOffer && (g.drawOffer !== myColor || mySeats().length === 2)) {
        box.append(btn('РџСЂРёРЅСЏС‚СЊ РЅРёС‡СЊСЋ', 'btn-amber', () => socket.emit('game:draw', { action: 'accept' })));
        box.append(btn('РћС‚РєР°Р·Р°С‚СЊСЃСЏ', 'btn-ghost', () => socket.emit('game:draw', { action: 'decline' })));
      } else if (g.drawOffer) {
        const s = document.createElement('span');
        s.className = 'draws';
        s.textContent = 'РќРёС‡СЊСЏ РїСЂРµРґР»РѕР¶РµРЅР°, Р¶РґС‘Рј РѕС‚РІРµС‚Р°';
        box.append(s);
      } else {
        box.append(btn('РџСЂРµРґР»РѕР¶РёС‚СЊ РЅРёС‡СЊСЋ', 'btn-ghost', () => socket.emit('game:draw', { action: 'offer' })));
      }
      box.append(armable(btn('', 'btn-warn'), 'РЎРґР°С‚СЊСЃСЏ', 'РўРѕС‡РЅРѕ СЃРґР°С‚СЊСЃСЏ?', () => socket.emit('game:resign')));
    }
    if (seated && (g.gameNo || g.draws)) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'btn-link';
      armable(reset, 'РћР±РЅСѓР»РёС‚СЊ СЃС‡С‘С‚', 'РќР°Р¶РјРё РµС‰С‘ СЂР°Р·, С‡С‚РѕР±С‹ РѕР±РЅСѓР»РёС‚СЊ', () => socket.emit('game:reset-score'));
      box.append(reset);
    }
  }
})();
