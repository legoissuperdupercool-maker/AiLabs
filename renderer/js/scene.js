// The 2D office: map, furniture, pathfinding and animated agents on a canvas.
(function () {
  const T = 16;
  const W = 40;
  const H = 24;
  const { drawCharacter, shade } = window.Sprites;

  // ---------- map ----------
  const blocked = Array.from({ length: H }, () => new Array(W).fill(false));
  const block = (x, y, w = 1, h = 1) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (blocked[j]) blocked[j][i] = true; };

  // outer walls
  block(0, 0, W, 2); block(0, H - 1, W, 1); block(0, 0, 1, H); block(W - 1, 0, 1, H);
  // wall between open office and side rooms (doors at y 7-8 and 17-18)
  for (let y = 2; y < H - 1; y++) if (![7, 8, 17, 18].includes(y)) block(28, y);
  // wall between lounge and meeting room (door at x 33-34)
  for (let x = 28; x < W; x++) if (![33, 34].includes(x)) block(x, 12);

  // desks: 8 pods in two rows of four
  const DESKS = [];
  for (let i = 0; i < 8; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const px = 2 + col * 6;
    const py = row === 0 ? 4 : 13;
    DESKS.push({ i, px, py, deskX: px + 1, deskY: py, seat: { x: px + 2, y: py + 2 } });
    block(px + 1, py, 3, 2);
  }

  const furniture = [];
  const add = (kind, x, y, w, h, extra = {}) => { furniture.push({ kind, x, y, w, h, ...extra }); if (!extra.walkable) block(x, y, w, h); };

  // open office
  add('plant', 1, 2, 1, 1); add('plant', 26, 2, 1, 1); add('plant', 1, 21, 1, 1); add('plant', 26, 21, 1, 1);
  add('bookshelf', 11, 2, 3, 1); add('bookshelf', 15, 2, 3, 1);
  add('printer', 1, 10, 1, 1);
  add('cabinet', 26, 10, 1, 2);
  add('sofa_small', 10, 20, 3, 2); add('plant', 13, 21, 1, 1); add('sofa_small', 15, 20, 3, 2);
  // lounge
  add('counter', 29, 2, 5, 1); add('coffee', 29, 2, 1, 1, { walkable: true }); add('fridge', 34, 2, 1, 2);
  add('cooler', 37, 2, 1, 1); add('arcade', 38, 4, 1, 2);
  add('table_small', 31, 6, 2, 1); add('couch', 30, 9, 4, 2);
  add('plant', 38, 10, 1, 1); add('plant', 29, 10, 1, 1);
  // meeting room
  add('whiteboard', 30, 13, 4, 1); add('meeting_table', 31, 16, 6, 2);
  for (const cx of [32, 34]) add('mchair', cx, 15, 1, 1, { walkable: true, facing: 'down' });
  for (const cx of [33, 35]) add('mchair', cx, 18, 1, 1, { walkable: true, facing: 'up' });
  add('server', 37, 19, 1, 3); add('server', 38, 19, 1, 3); add('plant', 29, 21, 1, 1);

  // places idle agents like to visit: {x, y, facing, sit}
  const POIS = [
    { x: 30, y: 3, facing: 'up', label: 'coffee' }, { x: 31, y: 3, facing: 'up', label: 'coffee' },
    { x: 34, y: 4, facing: 'up', label: 'fridge' }, { x: 37, y: 3, facing: 'up', label: 'water' },
    { x: 37, y: 5, facing: 'right', label: 'arcade' },
    { x: 30, y: 9, facing: 'up', sit: true }, { x: 31, y: 9, facing: 'up', sit: true },
    { x: 32, y: 9, facing: 'up', sit: true }, { x: 33, y: 9, facing: 'up', sit: true },
    { x: 31, y: 14, facing: 'up', label: 'whiteboard' }, { x: 32, y: 14, facing: 'up', label: 'whiteboard' },
    { x: 32, y: 15, facing: 'down', sit: true }, { x: 34, y: 15, facing: 'down', sit: true },
    { x: 33, y: 18, facing: 'up', sit: true }, { x: 35, y: 18, facing: 'up', sit: true },
    { x: 12, y: 3, facing: 'up', label: 'books' }, { x: 16, y: 3, facing: 'up', label: 'books' },
    { x: 2, y: 10, facing: 'left', label: 'printer' },
    { x: 11, y: 20, facing: 'down', sit: true }, { x: 16, y: 20, facing: 'down', sit: true },
    { x: 6, y: 10, facing: 'up' }, { x: 20, y: 10, facing: 'down' },
  ];

  // ---------- pathfinding (BFS on a 40x24 grid is instant) ----------
  function findPath(sx, sy, tx, ty) {
    if (sx === tx && sy === ty) return [];
    const key = (x, y) => y * W + x;
    const prev = new Map([[key(sx, sy), -1]]);
    const q = [[sx, sy]];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === tx && y === ty) break;
      for (const [dx, dy] of dirs) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        if (blocked[ny][nx] && !(nx === tx && ny === ty)) continue;
        prev.set(k, key(x, y));
        q.push([nx, ny]);
      }
    }
    if (!prev.has(key(tx, ty))) return null;
    const path = [];
    let k = key(tx, ty);
    while (k !== key(sx, sy)) { path.unshift({ x: k % W, y: Math.floor(k / W) }); k = prev.get(k); }
    return path;
  }

  // ---------- static background ----------
  function drawBackground(ctx) {
    // floors
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let c;
        if (x < 28) c = (x + y) % 2 ? '#2a2e48' : '#2c304c';
        else if (y < 12) c = (x % 2) ? '#4a3a34' : '#4e3e37';
        else c = (x + y) % 2 ? '#23384a' : '#253b4d';
        ctx.fillStyle = c;
        ctx.fillRect(x * T, y * T, T, T);
      }
    }
    // wood plank lines in lounge
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 2; y < 12; y++) for (let x = 29; x < W - 1; x++) ctx.fillRect(x * T, y * T + ((x % 2) ? 5 : 11), T, 1);

    // top wall face
    ctx.fillStyle = '#1a1d33'; ctx.fillRect(0, 0, W * T, 2 * T);
    ctx.fillStyle = '#23274a'; ctx.fillRect(0, 2 * T - 5, W * T, 3);
    ctx.fillStyle = '#12142a'; ctx.fillRect(0, 2 * T - 2, W * T, 2);
    // side & bottom walls (top-down)
    const wall = (x, y, w, h) => {
      ctx.fillStyle = '#15182c'; ctx.fillRect(x * T, y * T, w * T, h * T);
      ctx.fillStyle = '#2a2e52'; ctx.fillRect(x * T, y * T, w * T, 3);
    };
    wall(0, 2, 1, H - 2); wall(W - 1, 2, 1, H - 2); wall(0, H - 1, W, 1);
    wall(28, 2, 1, 5); wall(28, 9, 1, 8); wall(28, 19, 1, 4);
    wall(28, 12, 5, 1); wall(35, 12, 4, 1);
    // door frames
    ctx.fillStyle = '#3a4078';
    for (const [x, y, w, hh] of [[28, 7, 1, 0], [28, 9, 1, 0], [28, 17, 1, 0], [28, 19, 1, 0]]) ctx.fillRect(x * T, y * T - 2, w * T, 2 + hh);
    ctx.fillRect(33 * T - 2, 12 * T, 2, T); ctx.fillRect(35 * T, 12 * T, 2, T);
    // door mats
    ctx.fillStyle = '#3b2f5a';
    ctx.fillRect(28 * T + 3, 7 * T + 2, T - 6, 2 * T - 4);
    ctx.fillRect(28 * T + 3, 17 * T + 2, T - 6, 2 * T - 4);
    ctx.fillRect(33 * T + 2, 12 * T + 3, 2 * T - 4, T - 6);
  }

  // ---------- furniture drawing ----------
  function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

  function drawFurniture(ctx, f, t) {
    const X = f.x * T; const Y = f.y * T;
    switch (f.kind) {
      case 'plant':
        rect(ctx, X + 4, Y + 9, 8, 6, '#8a5a3c'); rect(ctx, X + 4, Y + 9, 8, 1, '#a36d49');
        rect(ctx, X + 3, Y + 1, 10, 8, '#2f8f5b'); rect(ctx, X + 5, Y - 2, 6, 4, '#3aa86b'); rect(ctx, X + 1, Y + 4, 3, 3, '#3aa86b'); rect(ctx, X + 12, Y + 3, 3, 3, '#277a4c');
        break;
      case 'bookshelf':
        rect(ctx, X, Y - 10, f.w * T, T + 10, '#5b3d2b'); rect(ctx, X + 1, Y - 9, f.w * T - 2, T + 8, '#3e2a1e');
        for (let s = 0; s < 3; s++) {
          for (let b = 0; b < f.w * 5; b++) {
            const hue = ['#c0504d', '#4f81bd', '#9bbb59', '#f79646', '#8064a2', '#e8e0c8'][(b * 7 + s * 3) % 6];
            rect(ctx, X + 2 + b * 3, Y - 8 + s * 8, 2, 6, hue);
          }
          rect(ctx, X + 1, Y - 2 + s * 8, f.w * T - 2, 1, '#5b3d2b');
        }
        break;
      case 'printer':
        rect(ctx, X + 1, Y + 3, 14, 11, '#c9ccd8'); rect(ctx, X + 1, Y + 3, 14, 3, '#e6e8f0'); rect(ctx, X + 4, Y + 8, 8, 2, '#2b2f4a');
        rect(ctx, X + 12, Y + 11, 2, 1, Math.floor(t * 2) % 2 ? '#3ddc97' : '#1f6f4d');
        break;
      case 'cabinet':
        rect(ctx, X + 1, Y - 4, 14, f.h * T + 3, '#6c7391'); rect(ctx, X + 2, Y - 3, 12, 1, '#8b92b3');
        for (let d = 0; d < 3; d++) { rect(ctx, X + 2, Y + d * 10, 12, 9, '#5a6180'); rect(ctx, X + 6, Y + d * 10 + 4, 4, 1, '#c9ccd8'); }
        break;
      case 'sofa_small':
        rect(ctx, X, Y + 4, f.w * T, f.h * T - 6, '#5a4f8f'); rect(ctx, X, Y + 4, f.w * T, 8, '#6d62a8'); rect(ctx, X, Y + 4, 4, f.h * T - 6, '#4b4178'); rect(ctx, X + f.w * T - 4, Y + 4, 4, f.h * T - 6, '#4b4178');
        break;
      case 'counter':
        rect(ctx, X, Y - 6, f.w * T, T + 6, '#6f5a4a'); rect(ctx, X, Y - 6, f.w * T, 4, '#d8d2c6'); rect(ctx, X + 50, Y - 4, 12, 5, '#9aa3b5');
        break;
      case 'coffee': {
        rect(ctx, X + 2, Y - 14, 12, 14, '#2d2f3a'); rect(ctx, X + 3, Y - 13, 10, 4, '#444857'); rect(ctx, X + 6, Y - 6, 4, 4, '#f2f2f2');
        rect(ctx, X + 11, Y - 12, 1, 1, '#ff5d5d');
        const puff = (t * 8) % 12;
        ctx.fillStyle = `rgba(255,255,255,${0.35 - puff / 40})`; ctx.fillRect(X + 7, Y - 16 - puff, 2, 2);
        break;
      }
      case 'fridge':
        rect(ctx, X + 1, Y - 12, 14, f.h * T + 10, '#dfe3ee'); rect(ctx, X + 1, Y + 2, 14, 1, '#a9aec0'); rect(ctx, X + 12, Y - 8, 1, 6, '#8d93a8'); rect(ctx, X + 12, Y + 6, 1, 8, '#8d93a8');
        break;
      case 'cooler':
        rect(ctx, X + 4, Y - 14, 8, 8, '#8fd3ff'); rect(ctx, X + 5, Y - 13, 3, 6, '#c4ebff'); rect(ctx, X + 3, Y - 6, 10, 20, '#e6e8f0'); rect(ctx, X + 6, Y, 4, 2, '#4f8cff');
        break;
      case 'arcade': {
        rect(ctx, X, Y - 10, T, f.h * T + 8, '#2a1f4f'); rect(ctx, X + 1, Y - 9, T - 2, 4, '#ff6bb5');
        const glow = ['#4dd0e1', '#a66bff', '#3ddc97', '#ffb347'][Math.floor(t * 3) % 4];
        rect(ctx, X + 2, Y - 4, T - 4, 12, '#0c0c18'); rect(ctx, X + 4, Y - 2 + Math.floor(t * 4) % 6, 3, 2, glow); rect(ctx, X + 9, Y + 4, 2, 2, '#fff');
        rect(ctx, X + 2, Y + 10, T - 4, 4, '#3a2d6a'); rect(ctx, X + 4, Y + 11, 2, 2, '#ff5d5d'); rect(ctx, X + 9, Y + 11, 2, 2, '#f5d547');
        break;
      }
      case 'table_small':
        rect(ctx, X, Y + 2, f.w * T, 10, '#7a5a44'); rect(ctx, X, Y + 2, f.w * T, 2, '#9b755a'); rect(ctx, X + 10, Y - 1, 4, 4, '#f2f2f2');
        break;
      case 'couch':
        rect(ctx, X - 2, Y + 4, f.w * T + 4, f.h * T - 4, '#2f6d8a'); rect(ctx, X - 2, Y + 16, f.w * T + 4, 12, '#27596f');
        for (let c = 0; c < f.w; c++) rect(ctx, X + c * T + 1, Y + 5, T - 2, 10, '#3a86a8');
        break;
      case 'whiteboard':
        rect(ctx, X, Y - 16, f.w * T, 18, '#9aa3b5'); rect(ctx, X + 2, Y - 14, f.w * T - 4, 14, '#f4f6fb');
        ctx.fillStyle = '#4f8cff'; ctx.fillRect(X + 6, Y - 11, 18, 1); ctx.fillRect(X + 6, Y - 8, 12, 1);
        ctx.fillStyle = '#ff6b6b'; ctx.fillRect(X + 34, Y - 12, 8, 6);
        ctx.fillStyle = '#3ddc97'; ctx.fillRect(X + 46, Y - 10, 10, 1); ctx.fillRect(X + 46, Y - 6, 6, 1);
        break;
      case 'meeting_table':
        rect(ctx, X - 2, Y, f.w * T + 4, f.h * T, '#6b4c38'); rect(ctx, X - 2, Y, f.w * T + 4, 3, '#8a6448'); rect(ctx, X - 2, Y + f.h * T - 3, f.w * T + 4, 3, '#523a2b');
        rect(ctx, X + 20, Y + 10, 10, 7, '#1d2233'); rect(ctx, X + 21, Y + 11, 8, 5, '#4dd0e1'); rect(ctx, X + 60, Y + 12, 6, 8, '#f2f2f2');
        break;
      case 'mchair':
        if (f.facing === 'down') { rect(ctx, X + 3, Y + 1, 10, 4, '#3a4a6a'); rect(ctx, X + 3, Y + 5, 10, 7, '#4a5d85'); }
        else { rect(ctx, X + 3, Y + 4, 10, 7, '#4a5d85'); rect(ctx, X + 3, Y + 11, 10, 4, '#3a4a6a'); }
        break;
      case 'server':
        rect(ctx, X + 1, Y - 12, 14, f.h * T + 10, '#1b1e2e'); rect(ctx, X + 2, Y - 11, 12, 1, '#3a3f5c');
        for (let s = 0; s < 7; s++) {
          rect(ctx, X + 2, Y - 8 + s * 7, 12, 5, '#262a3f');
          const on = (Math.sin(t * 5 + s * 1.7 + f.x) > 0.2);
          rect(ctx, X + 11, Y - 7 + s * 7, 2, 2, on ? '#3ddc97' : '#1b4d36');
          rect(ctx, X + 8, Y - 7 + s * 7, 2, 2, Math.sin(t * 9 + s) > 0.7 ? '#ffb347' : '#4a3a1a');
        }
        break;
      default: break;
    }
  }

  // ---------- desks ----------
  function drawDesk(ctx, desk, agent, run, t, deptColor) {
    const X = desk.deskX * T; const Y = desk.deskY * T;
    // desk surface & front
    rect(ctx, X - 2, Y + 6, 3 * T + 4, 18, '#7b5b45'); rect(ctx, X - 2, Y + 6, 3 * T + 4, 3, '#98735a');
    rect(ctx, X - 2, Y + 24, 3 * T + 4, 6, '#5a4232'); rect(ctx, X, Y + 30, 3, 2, '#3e2e23'); rect(ctx, X + 3 * T - 3, Y + 30, 3, 2, '#3e2e23');
    if (!agent) {
      rect(ctx, X + 14, Y - 2, 20, 12, '#23263a'); rect(ctx, X + 15, Y - 1, 18, 10, '#141625'); rect(ctx, X + 22, Y + 10, 4, 3, '#23263a');
      return;
    }
    const status = run?.status || 'idle';
    const active = status === 'working' || status === 'thinking' || status === 'waiting';
    // monitor
    rect(ctx, X + 11, Y - 6, 26, 16, '#23263a');
    const screen = status === 'error' ? '#3a1520' : status === 'waiting' ? '#3a2d10' : active ? '#0d1b2a' : '#141625';
    rect(ctx, X + 12, Y - 5, 24, 13, screen);
    if (active) {
      const scroll = Math.floor(t * (status === 'working' ? 10 : 3));
      for (let l = 0; l < 5; l++) {
        const w = 4 + ((l * 37 + scroll * 13) % 15);
        rect(ctx, X + 14 + ((l * 5) % 4), Y - 4 + l * 2 + 1, w, 1, l % 2 ? deptColor : shade(deptColor, 60));
      }
      ctx.fillStyle = hexA(deptColor, 0.12 + 0.05 * Math.sin(t * 4));
      ctx.fillRect(X + 4, Y - 10, 40, 34);
    } else if (status === 'error') {
      rect(ctx, X + 22, Y - 3, 3, 6, '#ff5d73'); rect(ctx, X + 22, Y + 4, 3, 2, '#ff5d73');
    } else {
      rect(ctx, X + 22, Y, 4, 3, hexA(deptColor, 0.5));
    }
    rect(ctx, X + 22, Y + 10, 4, 3, '#23263a');
    // keyboard, mug
    rect(ctx, X + 14, Y + 14, 20, 4, '#c9ccd8'); rect(ctx, X + 15, Y + 15, 18, 1, '#9aa0b5');
    rect(ctx, X + 40, Y + 12, 4, 5, '#f2f2f2'); rect(ctx, X + 44, Y + 13, 1, 2, '#f2f2f2');
    rect(ctx, X + 2, Y + 12, 7, 5, '#f5d547'); rect(ctx, X + 3, Y + 11, 5, 1, '#fff4a8');
  }

  function drawChair(ctx, desk, deptColor) {
    const X = desk.seat.x * T; const Y = desk.seat.y * T;
    rect(ctx, X + 3, Y + 4, 10, 8, shade(deptColor, -70)); rect(ctx, X + 7, Y + 12, 2, 3, '#1b1e2e');
    rect(ctx, X + 4, Y + 14, 8, 1, '#1b1e2e');
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------- sky in windows follows the real clock ----------
  function skyColors(date) {
    const h = date.getHours() + date.getMinutes() / 60;
    if (h < 5 || h >= 21) return ['#0b1030', '#1a1f4a', true];
    if (h < 7) return ['#40306a', '#f59e6b', false];
    if (h < 17) return ['#4aa3ff', '#a8dcff', false];
    if (h < 19) return ['#ff9a5a', '#ffd08a', false];
    return ['#3b2d6b', '#e0698a', false];
  }

  function drawWindows(ctx, t) {
    const [top, bottom, night] = skyColors(new Date());
    const wins = [3, 7, 20, 24, 30, 35];
    for (const wx of wins) {
      if (wx >= 29 && wx < 34) continue;
      const X = wx * T; const Y = 4;
      rect(ctx, X - 2, Y - 2, 2 * T + 4, 22, '#2e3358');
      const g = ctx.createLinearGradient(0, Y, 0, Y + 18);
      g.addColorStop(0, top); g.addColorStop(1, bottom);
      ctx.fillStyle = g; ctx.fillRect(X, Y, 2 * T, 18);
      if (night) {
        ctx.fillStyle = '#fff';
        for (let s = 0; s < 4; s++) if (Math.sin(t * 2 + s * 3 + wx) > -0.3) ctx.fillRect(X + ((s * 11 + wx * 3) % 30), Y + ((s * 7 + wx) % 14), 1, 1);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        const cx = X + ((t * 2 + wx * 9) % 40) - 6;
        ctx.fillRect(Math.round(cx), Y + 5, 8, 2); ctx.fillRect(Math.round(cx) + 2, Y + 4, 4, 1);
      }
      rect(ctx, X + T - 1, Y, 2, 18, '#2e3358'); rect(ctx, X, Y + 8, 2 * T, 1, '#2e3358');
    }
  }

  // ---------- the scene ----------
  class Scene {
    constructor(canvas, callbacks) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cb = callbacks;
      this.world = document.createElement('canvas');
      this.world.width = W * T;
      this.world.height = H * T;
      this.wctx = this.world.getContext('2d');
      this.bg = document.createElement('canvas');
      this.bg.width = W * T;
      this.bg.height = H * T;
      drawBackground(this.bg.getContext('2d'));
      this.actors = new Map(); // agentId -> actor
      this.agents = [];
      this.runtime = {};
      this.depts = {};
      this.selected = null;
      this.hover = null;
      this.officeName = '';
      this.last = performance.now();
      this.resize();
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      canvas.addEventListener('mousemove', (e) => this.onMove(e));
      canvas.addEventListener('mouseleave', () => { this.hover = null; this.hoverDesk = null; });
      canvas.addEventListener('click', (e) => this.onClick(e));
      requestAnimationFrame((ts) => this.frame(ts));
    }

    resize() {
      const parent = this.canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      this.cssW = parent.clientWidth;
      this.cssH = parent.clientHeight;
      this.canvas.width = Math.max(1, Math.floor(this.cssW * dpr));
      this.canvas.height = Math.max(1, Math.floor(this.cssH * dpr));
      this.canvas.style.width = `${this.cssW}px`;
      this.canvas.style.height = `${this.cssH}px`;
      const fit = Math.min(this.canvas.width / (W * T), this.canvas.height / (H * T));
      this.scale = fit >= 2 ? Math.floor(fit * 2) / 2 : fit;
      this.ox = Math.floor((this.canvas.width - W * T * this.scale) / 2);
      this.oy = Math.floor((this.canvas.height - H * T * this.scale) / 2);
      this.dpr = dpr;
    }

    setData({ agents, runtime, departments, selected, officeName }) {
      this.agents = agents;
      this.runtime = runtime || {};
      this.depts = departments;
      this.selected = selected;
      this.officeName = officeName || '';
      const ids = new Set(agents.map((a) => a.id));
      for (const id of [...this.actors.keys()]) if (!ids.has(id)) this.actors.delete(id);
      agents.forEach((a, idx) => {
        const desk = DESKS[idx];
        let actor = this.actors.get(a.id);
        if (!actor) {
          actor = { id: a.id, x: desk.seat.x, y: desk.seat.y, px: desk.seat.x * T + 8, py: desk.seat.y * T + 13, path: [], facing: 'up', sitting: true, nextThink: performance.now() / 1000 + 2 + Math.random() * 6, frame: 0, bubble: null };
          this.actors.set(a.id, actor);
        }
        actor.desk = desk;
        actor.agent = a;
      });
    }

    say(agentId, text, seconds = 4) {
      const actor = this.actors.get(agentId);
      if (actor && text) actor.bubble = { text: text.length > 46 ? `${text.slice(0, 44)}…` : text, until: performance.now() / 1000 + seconds };
    }

    // Walk to a coworker's desk briefly (used for delegation).
    visit(fromId, toId) {
      const a = this.actors.get(fromId); const b = this.actors.get(toId);
      if (!a || !b) return;
      this.goTo(a, { x: b.desk.seat.x + 1, y: b.desk.seat.y, facing: 'left' });
      a.visitUntil = performance.now() / 1000 + 6;
    }

    goTo(actor, target) {
      const path = findPath(actor.x, actor.y, target.x, target.y);
      if (path === null) return false;
      actor.path = path;
      actor.target = target;
      actor.sitting = false;
      return true;
    }

    think(actor, now) {
      const status = this.runtime[actor.id]?.status || 'idle';
      const busy = status !== 'idle';
      const seat = actor.desk.seat;
      const atDesk = actor.x === seat.x && actor.y === seat.y;
      if (actor.visitUntil && now < actor.visitUntil) return;
      if (busy) {
        if (!atDesk && (!actor.target || actor.target.x !== seat.x || actor.target.y !== seat.y)) this.goTo(actor, { x: seat.x, y: seat.y, facing: 'up', sit: true });
        return;
      }
      if (actor.path.length || now < actor.nextThink) return;
      // idle: wander to a random spot, or go sit at the desk for a while
      const roll = Math.random();
      if (roll < 0.35 && !atDesk) this.goTo(actor, { x: seat.x, y: seat.y, facing: 'up', sit: true });
      else if (roll < 0.9) {
        const taken = new Set([...this.actors.values()].filter((o) => o !== actor).map((o) => `${(o.target || o).x},${(o.target || o).y}`));
        const free = POIS.filter((p) => !taken.has(`${p.x},${p.y}`));
        if (free.length) this.goTo(actor, free[Math.floor(Math.random() * free.length)]);
      }
      actor.nextThink = now + 5 + Math.random() * 12;
    }

    update(dt, now) {
      for (const actor of this.actors.values()) {
        this.think(actor, now);
        if (actor.path.length) {
          const next = actor.path[0];
          const tx = next.x * T + 8; const ty = next.y * T + 13;
          const dx = tx - actor.px; const dy = ty - actor.py;
          const dist = Math.hypot(dx, dy);
          const speed = 46 * dt;
          if (Math.abs(dx) > Math.abs(dy)) actor.facing = dx > 0 ? 'right' : 'left';
          else if (dy !== 0) actor.facing = dy > 0 ? 'down' : 'up';
          if (dist <= speed) {
            actor.px = tx; actor.py = ty; actor.x = next.x; actor.y = next.y;
            actor.path.shift();
            if (!actor.path.length && actor.target) {
              actor.facing = actor.target.facing || actor.facing;
              actor.sitting = !!actor.target.sit;
              actor.target = null;
            }
          } else {
            actor.px += (dx / dist) * speed;
            actor.py += (dy / dist) * speed;
          }
          actor.frameT = (actor.frameT || 0) + dt;
          if (actor.frameT > 0.12) { actor.frame++; actor.frameT = 0; }
        }
        if (actor.visitUntil && now > actor.visitUntil) actor.visitUntil = 0;
      }
    }

    frame(ts) {
      const now = ts / 1000;
      const dt = Math.min(0.05, (ts - this.last) / 1000);
      this.last = ts;
      this.update(dt, now);
      this.draw(now);
      requestAnimationFrame((t) => this.frame(t));
    }

    deptColor(agent) { return this.depts[agent?.department]?.color || '#8b93c9'; }

    draw(t) {
      const c = this.wctx;
      c.imageSmoothingEnabled = false;
      c.drawImage(this.bg, 0, 0);
      drawWindows(c, t);

      // department rugs under desks
      DESKS.forEach((d, i) => {
        const agent = this.agents[i];
        const col = agent ? this.deptColor(agent) : '#3a3f66';
        c.fillStyle = hexA(col, agent ? 0.16 : 0.07);
        c.fillRect(d.px * T + 4, (d.py - 1) * T + 4, 5 * T - 8, 5 * T - 8);
        c.fillStyle = hexA(col, agent ? 0.5 : 0.18);
        c.fillRect(d.px * T + 4, (d.py - 1) * T + 4, 5 * T - 8, 2);
        c.fillRect(d.px * T + 4, (d.py + 4) * T - 6, 5 * T - 8, 2);
      });

      // y-sorted drawables: furniture, desks, chairs and people
      const items = [];
      for (const f of furniture) items.push({ y: (f.y + f.h) * T - 1, draw: () => drawFurniture(c, f, t) });
      DESKS.forEach((d, i) => {
        const agent = this.agents[i];
        const col = this.deptColor(agent);
        items.push({ y: (d.deskY + 2) * T - 2, draw: () => drawDesk(c, d, agent, agent && this.runtime[agent.id], t, col) });
        if (agent) items.push({ y: d.seat.y * T + 1, draw: () => drawChair(c, d, col) });
      });
      for (const actor of this.actors.values()) {
        const status = this.runtime[actor.id]?.status || 'idle';
        const atDesk = actor.x === actor.desk.seat.x && actor.y === actor.desk.seat.y && !actor.path.length;
        const typing = atDesk && status === 'working';
        items.push({
          // seated on a sofa/meeting chair: draw in front of the furniture
          y: actor.py + (actor.sitting ? (atDesk ? 2 : 2 * T) : 0),
          draw: () => {
            if (actor.id === this.selected) {
              c.strokeStyle = this.deptColor(actor.agent); c.lineWidth = 1;
              c.beginPath(); c.ellipse(Math.round(actor.px) + 0.5, Math.round(actor.py) + 0.5, 8, 3, 0, 0, Math.PI * 2); c.stroke();
            }
            drawCharacter(c, actor.px, actor.py, actor.agent.look, {
              facing: actor.facing, frame: actor.frame, moving: actor.path.length > 0, sitting: actor.sitting, typing, t,
            });
          },
        });
      }
      items.sort((a, b) => a.y - b.y);
      for (const it of items) it.draw();

      // blit the world, then draw crisp text on top at screen resolution
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0d1020';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.world, this.ox, this.oy, W * T * this.scale, H * T * this.scale);
      this.drawOverlay(ctx, t);
    }

    toScreen(px, py) { return [this.ox + px * this.scale, this.oy + py * this.scale]; }

    drawOverlay(ctx, t) {
      const s = this.scale;
      const fs = Math.max(10, Math.round(4.2 * s));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // office sign on the top wall
      const [sx, sy] = this.toScreen(14 * T, 14);
      ctx.font = `700 ${Math.round(fs * 1.25)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(170,180,255,0.85)';
      ctx.fillText(this.officeName.toUpperCase(), sx, sy);
      ctx.font = `600 ${Math.round(fs * 0.85)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(200,190,170,0.6)';
      ctx.fillText('LOUNGE', ...this.toScreen(36 * T, 11 * T + 6));
      ctx.fillStyle = 'rgba(170,210,230,0.55)';
      ctx.fillText('MEETING ROOM', ...this.toScreen(34 * T, 22 * T + 6));

      // desk name plates / hire hints
      DESKS.forEach((d, i) => {
        const agent = this.agents[i];
        const [x, y] = this.toScreen((d.px + 2.5) * T, (d.py + 3.6) * T);
        ctx.font = `600 ${Math.round(fs * 0.9)}px "Segoe UI", system-ui, sans-serif`;
        if (agent) {
          ctx.fillStyle = hexA(this.deptColor(agent), 0.95);
          ctx.fillText(agent.department.toUpperCase(), x, y);
        } else {
          const hovered = this.hoverDesk === i;
          ctx.fillStyle = hovered ? 'rgba(200,210,255,0.95)' : 'rgba(150,160,220,0.45)';
          ctx.fillText(hovered ? '+ HIRE AGENT' : 'OPEN DESK', x, y);
        }
      });

      // name tags & bubbles
      for (const actor of this.actors.values()) {
        const run = this.runtime[actor.id] || {};
        const [x, y] = this.toScreen(actor.px, actor.py - 26 + (actor.sitting ? 3 : 0));
        const showName = actor.id === this.hover || actor.id === this.selected;
        const now = performance.now() / 1000;
        let bubble = null;
        if (run.status === 'waiting') bubble = { icon: '!', color: '#ffb347', text: 'Needs approval', bounce: true };
        else if (run.status === 'error') bubble = { icon: '×', color: '#ff5d73', text: showName ? 'Error' : '' };
        else if (actor.bubble && now < actor.bubble.until) bubble = { text: actor.bubble.text, color: '#e8ebff' };
        else if (run.status === 'thinking') bubble = { icon: '…', color: '#a9b4ff', dots: true };
        else if (run.status === 'working') bubble = { icon: '⚙', color: this.deptColor(actor.agent), text: showName ? shortDetail(run.detail) : '' };
        else if (!run.status || run.status === 'idle') {
          if (actor.sitting && actor.path.length === 0 && actor.x === actor.desk.seat.x && actor.y === actor.desk.seat.y && showName) bubble = { text: 'Ready for work', color: '#9aa3c9' };
        }
        let top = y;
        if (bubble) top = this.drawBubble(ctx, x, y, bubble, fs, t) - 4;
        if (showName) {
          ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
          const label = actor.agent.name;
          const w = ctx.measureText(label).width + fs;
          ctx.fillStyle = 'rgba(10,12,28,0.85)';
          roundRect(ctx, x - w / 2, top - fs * 1.5, w, fs * 1.4, fs * 0.4); ctx.fill();
          ctx.fillStyle = this.deptColor(actor.agent);
          ctx.fillText(label, x, top - fs * 0.8);
        }
      }
    }

    drawBubble(ctx, x, y, b, fs, t) {
      const bounce = b.bounce ? Math.abs(Math.sin(t * 5)) * fs * 0.5 : 0;
      ctx.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`;
      let label = b.text || '';
      if (b.dots) label = '.'.repeat(1 + (Math.floor(t * 3) % 3));
      const iconW = b.icon && !b.dots ? fs * 1.1 : 0;
      const w = Math.max(fs * 1.8, ctx.measureText(label).width + iconW + fs * 0.9);
      const h = fs * 1.6;
      const bx = x - w / 2; const by = y - h - bounce;
      ctx.fillStyle = 'rgba(14,16,34,0.92)';
      roundRect(ctx, bx, by, w, h, fs * 0.45); ctx.fill();
      ctx.strokeStyle = b.color; ctx.lineWidth = Math.max(1, fs / 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - fs * 0.3, by + h); ctx.lineTo(x, by + h + fs * 0.4); ctx.lineTo(x + fs * 0.3, by + h); ctx.fillStyle = b.color; ctx.fill();
      ctx.fillStyle = b.color;
      if (iconW) {
        ctx.font = `800 ${fs}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillText(b.icon, bx + fs * 0.45 + iconW / 2 - (label ? 0 : -((w - iconW - fs * 0.9) / 2)), by + h / 2);
        ctx.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`;
      }
      if (label) { ctx.fillStyle = '#e8ebff'; ctx.fillText(label, bx + (w + iconW) / 2, by + h / 2); }
      return by;
    }

    pick(e) {
      const r = this.canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * this.dpr; const my = (e.clientY - r.top) * this.dpr;
      const wx = (mx - this.ox) / this.scale; const wy = (my - this.oy) / this.scale;
      let best = null; let bestD = 14;
      for (const a of this.actors.values()) {
        const d = Math.hypot(a.px - wx, a.py - 10 - wy);
        if (d < bestD) { best = a.id; bestD = d; }
      }
      let desk = null;
      if (!best) {
        DESKS.forEach((d, i) => {
          if (wx >= d.px * T && wx < (d.px + 5) * T && wy >= (d.py - 1) * T && wy < (d.py + 4) * T) desk = i;
        });
      }
      return { agentId: best, desk };
    }

    onMove(e) {
      const { agentId, desk } = this.pick(e);
      this.hover = agentId;
      this.hoverDesk = desk !== null && !this.agents[desk] ? desk : null;
      this.canvas.style.cursor = agentId || this.hoverDesk !== null || (desk !== null && this.agents[desk]) ? 'pointer' : 'default';
    }

    onClick(e) {
      const { agentId, desk } = this.pick(e);
      if (agentId) this.cb.onSelect(agentId);
      else if (desk !== null && this.agents[desk]) this.cb.onSelect(this.agents[desk].id);
      else if (desk !== null) this.cb.onHire();
      else this.cb.onSelect(null);
    }
  }

  function shortDetail(d) {
    if (!d) return 'Working';
    return d.length > 34 ? `${d.slice(0, 32)}…` : d;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.OfficeScene = Scene;
})();
