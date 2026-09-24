// Procedural pixel-art characters. All coordinates are in world pixels (1x).
(function () {
  const SKINS = ['#f6d3b3', '#eab88f', '#d39a6a', '#a86b43', '#7a4a2a', '#5a3620'];
  const HAIRS = ['#2b1d14', '#5b3a1e', '#a0522d', '#e2b659', '#d9d4c7', '#1f2a44', '#b03a48', '#6b3fa0', '#2e7d6b'];
  const SHIRTS = ['#4f8cff', '#a66bff', '#ff6bb5', '#ffb347', '#3ddc97', '#f5d547', '#ff7a59', '#4dd0e1', '#e8e8f0', '#394060'];
  const PANTS = ['#2a2f4a', '#3b3f58', '#1d2233', '#4a3b2a', '#27435a'];
  const HAIR_STYLES = 6;

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function randomLook(shirt) {
    return {
      skin: pick(SKINS),
      hair: pick(HAIRS),
      hairStyle: Math.floor(Math.random() * HAIR_STYLES),
      shirt: shirt || pick(SHIRTS),
      pants: pick(PANTS),
    };
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
    return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
  }

  // Draw a character with feet centered at (x, y).
  // opts: facing 'down'|'up'|'left'|'right', frame (walk frame int), moving, sitting, typing, t (time s)
  function drawCharacter(ctx, x, y, look, opts = {}) {
    const f = opts.facing || 'down';
    const r = (px, py, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x + px), Math.round(y + py), w, h); };
    const bob = opts.moving ? (opts.frame % 2) : 0;
    const sit = opts.sitting ? 3 : 0;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(Math.round(x), Math.round(y), 6, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs
    if (!opts.sitting) {
      const step = opts.moving ? (opts.frame % 4 < 2 ? 1 : -1) : 0;
      if (f === 'left' || f === 'right') {
        r(-2 + step, -6, 3, 5, look.pants); r(-2 - step, -6, 3, 5, shade(look.pants, -12));
        r(-2 + step, -1, 3, 1, '#15151f'); r(-2 - step, -1, 3, 1, '#15151f');
      } else {
        r(-4, -6 + (step > 0 ? -1 : 0), 3, 5, look.pants); r(1, -6 + (step < 0 ? -1 : 0), 3, 5, look.pants);
        r(-4, -1 + (step > 0 ? -1 : 0), 3, 1, '#15151f'); r(1, -1 + (step < 0 ? -1 : 0), 3, 1, '#15151f');
      }
    } else {
      r(-4, -5, 8, 2, look.pants);
    }

    const by = -14 - bob + sit; // body top
    // body
    r(-5, by, 10, 8, look.shirt);
    r(-5, by + 7, 10, 1, shade(look.shirt, -30));
    if (f === 'down') r(-1, by, 2, 2, shade(look.shirt, 35)); // collar

    // arms
    const armC = shade(look.shirt, -18);
    if (opts.typing) {
      const a = Math.floor((opts.t || 0) * 10) % 2;
      r(-7, by + 1 - a, 2, 5, armC); r(5, by + a, 2, 5, armC);
      r(-7, by + 5 - a, 2, 1, look.skin); r(5, by + 4 + a, 2, 1, look.skin);
    } else if (f === 'left' || f === 'right') {
      const swing = opts.moving ? (opts.frame % 4 < 2 ? 1 : -1) : 0;
      r(-1 + swing, by + 1, 2, 6, armC); r(-1 + swing, by + 6, 2, 1, look.skin);
    } else {
      r(-7, by + 1, 2, 6, armC); r(5, by + 1, 2, 6, armC);
      r(-7, by + 7, 2, 1, look.skin); r(5, by + 7, 2, 1, look.skin);
    }

    // head
    const hy = by - 8;
    r(-4, hy, 8, 8, look.skin);
    r(-4, hy + 7, 8, 1, shade(look.skin, -25));
    drawHair(r, hy, look, f);

    // face
    if (f === 'down') {
      r(-2, hy + 4, 1, 2, '#1b1b26'); r(1, hy + 4, 1, 2, '#1b1b26');
      r(-3, hy + 6, 1, 1, shade(look.skin, -20)); r(2, hy + 6, 1, 1, shade(look.skin, -20));
    } else if (f === 'left') {
      r(-3, hy + 4, 1, 2, '#1b1b26');
    } else if (f === 'right') {
      r(2, hy + 4, 1, 2, '#1b1b26');
    }
  }

  function drawHair(r, hy, look, f) {
    const h = look.hair;
    const d = shade(h, -25);
    switch (look.hairStyle) {
      case 0: // short
        r(-4, hy - 1, 8, 3, h); r(-5, hy, 1, 3, h); r(4, hy, 1, 3, h);
        if (f === 'up') r(-4, hy, 8, 6, h);
        break;
      case 1: // long
        r(-4, hy - 1, 8, 3, h); r(-5, hy, 2, 9, h); r(3, hy, 2, 9, h);
        if (f === 'up') r(-5, hy, 10, 10, h);
        if (f === 'left') r(1, hy, 4, 9, h);
        if (f === 'right') r(-5, hy, 4, 9, h);
        break;
      case 2: // bun
        r(-4, hy - 1, 8, 3, h); r(-2, hy - 4, 4, 3, d); r(-5, hy, 1, 2, h); r(4, hy, 1, 2, h);
        if (f === 'up') r(-4, hy, 8, 6, h);
        break;
      case 3: // spiky
        r(-4, hy - 1, 8, 2, h);
        for (let i = -4; i < 4; i += 2) r(i, hy - 3, 1, 2, h);
        if (f === 'up') r(-4, hy, 8, 6, h);
        break;
      case 4: // cap
        r(-5, hy - 1, 10, 3, look.shirt === h ? d : h);
        if (f === 'down') r(-5, hy + 2, 10, 1, d);
        if (f === 'left') r(-7, hy + 1, 3, 1, d);
        if (f === 'right') r(4, hy + 1, 3, 1, d);
        if (f === 'up') r(-4, hy + 2, 8, 3, '#2b1d14');
        break;
      default: // curly / afro
        r(-5, hy - 3, 10, 5, h); r(-6, hy - 1, 1, 5, h); r(5, hy - 1, 1, 5, h);
        if (f === 'up') r(-5, hy, 10, 7, h);
        break;
    }
  }

  // Portrait: head and shoulders scaled up on a small canvas.
  function drawPortrait(canvas, look, bg) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const s = Math.floor(canvas.width / 16);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.save();
    ctx.scale(s, s);
    drawCharacter(ctx, 8, 27, look, { facing: 'down' });
    ctx.restore();
  }

  window.Sprites = { drawCharacter, drawPortrait, randomLook, shade, SKINS, HAIRS, SHIRTS, PANTS, HAIR_STYLES };
})();
