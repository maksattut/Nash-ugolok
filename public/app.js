(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
  };
  const svgHeart = '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.6-4.6-9.6-9.3C1 7.9 3.1 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.6 0 5.7 3.4 4.3 6.7-2 4.7-9.6 9.3-9.6 9.3z" fill="currentColor"/></svg>';
  const svgCrown = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.6 3.8L12 5l4.4 6.8L21 8l-2 10H5L3 8z" fill="currentColor"/></svg>';

  /* ---------- кто я и где ---------- */
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
  $('#roomLabel').textContent = 'комната ' + roomId;

  let myName = LS.get('nu_name') || '';
  const state = { video: null, game: null, users: [], offset: 0 };
  const serverNow = () => Date.now() + state.offset;
  const socket = io({ autoConnect: false });

  /* ---------- мелочи ---------- */
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

  /* ---------- вход ---------- */
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
  socket.on('disconnect', () => toast('Связь потеряна, переподключаюсь…'));

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
    currentUrl = null; // перезагрузить плеер на случай переподключения
    loadVideo(state.video);
  }

  /* ---------- люди ---------- */
  socket.on('users', (u) => { state.users = u; renderPeople(); renderGame(); });
  socket.on('joined', ({ name }) => toast(`${name} заходит в уголок`));

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
        y.textContent = 'ты';
        el.append(y);
      }
      el.title = u.name + ' — в сети';
      box.append(el);
    }
    if (list.length < 2) {
      const a = document.createElement('span');
      a.className = 'people-alone';
      a.textContent = 'ждём второго';
      box.append(a);
    }
  }

  $('#inviteBtn').addEventListener('click', async () => {
    const link = location.origin + location.pathname + '?r=' + encodeURIComponent(roomId);
    try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована — отправь её второму'); }
    catch { window.prompt ? window.prompt('Скопируй ссылку:', link) : toast(link); }
  });

  /* ---------- вкладки ---------- */
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

  /* ---------- чат ---------- */
  const chatList = $('#chatList');
  let lastMsg = null;
  function showChatEmpty() {
    const p = document.createElement('p');
    p.className = 'chat-empty';
    p.id = 'chatEmpty';
    p.textContent = 'Здесь будет ваша переписка. Напиши первое сообщение.';
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
      el.textContent = m.text + ' · ' + fmtClock(m.ts);
      chatList.append(el);
      lastMsg = null;
    } else {
      const mine = m.clientId === clientId;
      const cont = lastMsg && lastMsg.clientId === m.clientId && m.ts - lastMsg.ts < 3 * 60 * 1000;
      const el = document.createElement('div');
      el.className = 'msg' + (mine ? ' mine' : '') + (cont ? ' cont' : '');
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      meta.textContent = (mine ? 'ты' : m.name) + ' · ' + fmtClock(m.ts);
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
    $('#typing').textContent = `${name} печатает…`;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { $('#typing').textContent = ''; }, 3000);
  });

  /* ---------- сердечки ---------- */
  $('#heartBtn').addEventListener('click', () => socket.emit('react'));
  socket.on('react', ({ name, actor }) => {
    spawnHearts();
    if (actor !== socket.id) toast(`${name} отправляет сердечко`);
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

  /* ================= ВИДЕО ================= */
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
    } catch { /* не URL */ }
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
      if (kind === 'file') { try { video.currentTime = t; } catch { /* ещё не загружено */ } }
    },
  };

  function showError(text, link) {
    const el = $('#stageError');
    el.textContent = text;
    if (link) {
      const a = document.createElement('a');
      a.href = link; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = ' Открыть на YouTube';
      a.style.color = 'var(--rose)';
      el.append(a);
    }
    el.hidden = false;
  }
  const joinLabel = $('#joinBtn').lastChild;
  const showJoin = (text) => { joinLabel.textContent = ' ' + (text || 'Присоединиться к просмотру'); $('#joinBtn').hidden = false; };
  const hideJoin = () => { $('#joinBtn').hidden = true; };
  const ytUnstarted = () => kind === 'yt' && ytReady && [-1, 5].includes(yt.getPlayerState());
  $('#joinBtn').addEventListener('click', () => {
    hideJoin();
    if (!kind) return;
    const v = state.video;
    const t = expectedTime(v);
    if (kind === 'yt' && ytReady) {
      // Запуск прямо из нажатия — так телефон разрешает видео со звуком
      suppress(800);
      if (ytUnstarted()) yt.loadVideoById({ videoId: currentYtId, startSeconds: t });
      else { yt.seekTo(t, true); yt.playVideo(); }
      if (!v.playing) setTimeout(() => localChange(true, 'play'), 900);
      return;
    }
    if (!v.playing) { P.play().catch(() => {}); return; }
    applyState(true);
  });
  const YT_ERRORS = {
    2: 'Ссылка на YouTube неправильная, проверь её.',
    5: 'Этот браузер не может проиграть ролик. Попробуй Chrome или Safari.',
    100: 'Ролик удалён или скрыт.',
    101: 'Автор запретил показывать этот ролик на других сайтах. Выберите другой.',
    150: 'Автор запретил показывать этот ролик на других сайтах. Выберите другой.',
    152: 'YouTube не принял настройки плеера (ошибка 152). Обнови страницу.',
    153: 'YouTube не принял настройки плеера (ошибка 153). Обнови страницу.',
  };
  let currentYtId = null;

  function teardown() {
    suppress(2000);
    kind = null; ytReady = false; ytTitle = '';
    if (yt) { try { yt.destroy(); } catch { /* уже уничтожен */ } yt = null; }
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
      currentYtId = id;
      ytWrap.hidden = false;
      const watchUrl = 'https://www.youtube.com/watch?v=' + id;
      const loadTimer = setTimeout(() => {
        if (currentUrl === url && !ytReady) showError('YouTube не загрузился. Проверь интернет или VPN и нажми «Синхронизировать».', watchUrl);
      }, 12000);
      await loadYTApi();
      if (currentUrl !== url) return;
      yt = new YT.Player('ytPlayer', {
        videoId: id, width: '100%', height: '100%', host: 'https://www.youtube.com',
        playerVars: { playsinline: 1, rel: 0, enablejsapi: 1, origin: location.origin },
        events: {
          onReady: () => {
            clearTimeout(loadTimer);
            ytReady = true;
            $('#stageError').hidden = true;
            try { ytTitle = (yt.getVideoData() || {}).title || ''; } catch { ytTitle = ''; }
            updateNow();
            applyState(true);
          },
          onStateChange: onYtState,
          onError: (e) => {
            hideJoin();
            showError(YT_ERRORS[e.data] || `YouTube не смог показать ролик (ошибка ${e.data}).`, watchUrl);
          },
        },
      });
    } else {
      kind = 'file';
      video.hidden = false;
      const isHls = /\.m3u8(\?|#|$)/i.test(url);
      if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
        try { if (!window.Hls) await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js'); } catch { /* ниже — запасной вариант */ }
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
    showError('Не получилось открыть видео. Нужна прямая ссылка на файл (.mp4, .webm, .m3u8) или ссылка на YouTube. Страницы онлайн-кинотеатров так не открываются.');
  });

  function applyState(force) {
    const v = state.video;
    if (!v || !v.url || !kind) return;
    if (kind === 'yt' && !ytReady) return;
    // Видео ещё не запускали и оно на паузе: не трогаем плеер,
    // иначе YouTube на телефоне прячет превью и показывает чёрный экран
    if (ytUnstarted()) {
      // Ролик ещё ни разу не запускали: не трогаем плеер (иначе на телефоне чёрный экран),
      // а показываем свою кнопку — запуск из нажатия срабатывает всегда
      if (v.playing) {
        suppress(1500);
        yt.loadVideoById({ videoId: currentYtId, startSeconds: expectedTime(v) });
        setTimeout(() => { if (state.video.playing && kind === 'yt' && !P.playing()) showJoin(); }, 2500);
      } else {
        showJoin('Включить видео');
      }
      updateNow();
      return;
    }
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
    if (e.data === 1) { hideJoin(); $('#stageError').hidden = true; localChange(true); }
    else if (e.data === 2) localChange(false);
  }

  // Перемотка YouTube на паузе и подстройка рассинхрона
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
    const words = { play: 'включает', pause: 'ставит на паузу', seek: 'перематывает на ' + fmtTime(v.time), set: 'ставит новое видео' };
    if (v.by && words[v.action]) toast(`${v.by} ${words[v.action]}`);
  });

  function updateNow() {
    const v = state.video;
    const pill = $('#nowPill'), text = $('#nowText');
    p
