/*
 * Движок русских шашек (общий для сервера и браузера).
 * Доска 8×8, строки 0..7 сверху вниз (белые снизу, ходят вверх).
 * Фигуры: 'w' / 'b' — простые, 'W' / 'B' — дамки, null — пусто.
 * Правила: бить обязательно; простая бьёт вперёд и назад; дамка «летучая»;
 * побитые снимаются после хода («турецкий удар» запрещён); простая,
 * дошедшая до последней горизонтали во время боя, сразу бьёт дальше как дамка;
 * если после взятия есть продолжение — его надо выбрать.
 */
(function (root) {
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const colorOf = (p) => (p ? p.toLowerCase() : null);
  const isKing = (p) => p === 'W' || p === 'B';
  const promoRow = (col) => (col === 'w' ? 0 : 7);
  const fwd = (col) => (col === 'w' ? -1 : 1);
  const opp = (col) => (col === 'w' ? 'b' : 'w');

  function initialBoard() {
    const b = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (let c = 0; c < 8; c++) {
        let p = null;
        if ((r + c) % 2 === 1) {
          if (r < 3) p = 'b';
          else if (r > 4) p = 'w';
        }
        row.push(p);
      }
      b.push(row);
    }
    return b;
  }

  function captureSeqs(board, sr, sc, col, king0) {
    const b = board.map((row) => row.slice());
    b[sr][sc] = null; // клетка, с которой ушла шашка, свободна
    const out = [];

    function options(r, c, king, caps) {
      const capSet = new Set(caps.map(([a, d]) => a * 8 + d));
      const opts = [];
      for (const [dr, dc] of DIRS) {
        if (!king) {
          const er = r + dr, ec = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
          if (!inB(lr, lc)) continue;
          const e = b[er][ec];
          if (e && colorOf(e) !== col && !capSet.has(er * 8 + ec) && b[lr][lc] === null) {
            opts.push({ cap: [er, ec], lands: [[lr, lc]] });
          }
        } else {
          let er = r + dr, ec = c + dc;
          while (inB(er, ec) && b[er][ec] === null) { er += dr; ec += dc; }
          if (!inB(er, ec)) continue;
          const e = b[er][ec];
          if (colorOf(e) === col || capSet.has(er * 8 + ec)) continue;
          const lands = [];
          let lr = er + dr, lc = ec + dc;
          while (inB(lr, lc) && b[lr][lc] === null) { lands.push([lr, lc]); lr += dr; lc += dc; }
          if (lands.length) opts.push({ cap: [er, ec], lands });
        }
      }
      return opts;
    }

    function dfs(r, c, king, path, caps) {
      const opts = options(r, c, king, caps);
      if (!opts.length) {
        if (caps.length) out.push({ path, captures: caps });
        return;
      }
      for (const opt of opts) {
        const nextCaps = caps.concat([opt.cap]);
        const conts = opt.lands.map(([lr, lc]) => {
          const nk = king || lr === promoRow(col);
          return { lr, lc, nk, can: options(lr, lc, nk, nextCaps).length > 0 };
        });
        const mustContinue = conts.some((x) => x.can);
        for (const x of conts) {
          if (mustContinue && !x.can) continue;
          dfs(x.lr, x.lc, x.nk, path.concat([[x.lr, x.lc]]), nextCaps);
        }
      }
    }

    dfs(sr, sc, king0, [[sr, sc]], []);
    return out;
  }

  function legalMoves(board, col) {
    const caps = [];
    const simple = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (colorOf(p) !== col) continue;
        const k = isKing(p);
        caps.push(...captureSeqs(board, r, c, col, k));
        if (caps.length) continue;
        if (!k) {
          for (const dc of [-1, 1]) {
            const nr = r + fwd(col), nc = c + dc;
            if (inB(nr, nc) && board[nr][nc] === null) simple.push({ path: [[r, c], [nr, nc]], captures: [] });
          }
        } else {
          for (const [dr, dc] of DIRS) {
            let nr = r + dr, nc = c + dc;
            while (inB(nr, nc) && board[nr][nc] === null) {
              simple.push({ path: [[r, c], [nr, nc]], captures: [] });
              nr += dr; nc += dc;
            }
          }
        }
      }
    }
    return caps.length ? caps : simple;
  }

  function applyMove(board, move) {
    const b = board.map((row) => row.slice());
    const [sr, sc] = move.path[0];
    let p = b[sr][sc];
    b[sr][sc] = null;
    for (const [r, c] of move.captures) b[r][c] = null;
    const [er, ec] = move.path[move.path.length - 1];
    if (!isKing(p) && move.path.slice(1).some(([r]) => r === promoRow(colorOf(p)))) p = p.toUpperCase();
    b[er][ec] = p;
    return b;
  }

  function samePath(a, b) {
    return a.length === b.length && a.every((sq, i) => sq[0] === b[i][0] && sq[1] === b[i][1]);
  }

  function countPieces(board, col) {
    let n = 0;
    for (const row of board) for (const p of row) if (colorOf(p) === col) n++;
    return n;
  }

  const api = { initialBoard, legalMoves, applyMove, samePath, countPieces, colorOf, isKing, opp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Checkers = api;
})(typeof self !== 'undefined' ? self : this);
