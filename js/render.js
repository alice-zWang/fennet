// Drawing primitives shared by the editor, thumbnails and export.
import { getBlob, loadImage } from './db.js';
import { loadScript, uid, asset } from './util.js';
import { TEMPLATES, drawTemplate } from './templates.js';

export const PAGE_SIZES = {
  letter: { label: 'US Letter', w: 816, h: 1056 },
  a4: { label: 'A4', w: 794, h: 1123 },
  legal: { label: 'US Legal', w: 816, h: 1344 },
  landscape: { label: 'Letter landscape', w: 1056, h: 816 },
};

export const PAPER_TYPES = Object.fromEntries(TEMPLATES.map((t) => [t.id, t.name]));

export const PAPER_COLORS = {
  white: '#ffffff', ivory: '#fbf6e9', cream: '#f6efdc', yellow: '#fff5c2', peach: '#fde7d6', pink: '#fdecf2',
  lavender: '#efeafb', blue: '#e9f2ff', mint: '#e6f7f1', green: '#eaf7ea', gray: '#eeeff1', kraft: '#e3cfa9',
  sepia: '#d9c7a7', slate: '#2b2f36', navy: '#1d2840', black: '#121316',
};

// Paper color: a named color or any "#rrggbb".
export function paperFill(paper) {
  const c = paper && paper.color;
  return PAPER_COLORS[c] || (typeof c === 'string' && c[0] === '#' ? c : '#ffffff');
}

export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function blankPage(size = 'letter') {
  const s = PAGE_SIZES[size] || PAGE_SIZES.letter;
  return { id: uid(), w: s.w, h: s.h, objs: [] };
}

export function isDarkPaper(paper) {
  const hex = paperFill(paper).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.42;
}

export function effectivePaper(page, notePaper) {
  return page.paper || notePaper || { type: 'lined', color: 'white' };
}

// Paper background: color + template, or a custom image template. Pages with a PDF get plain white.
export async function drawPaper(ctx, page, notePaper, thick = 1) {
  const { w, h } = page;
  const paper = effectivePaper(page, notePaper);
  ctx.fillStyle = page.pdf ? '#fff' : paperFill(paper);
  ctx.fillRect(0, 0, w, h);
  if (page.pdf) return;
  if (paper.type === 'custom' && paper.blob) {
    const img = await loadImage(paper.blob);
    if (img) ctx.drawImage(img, 0, 0, w, h);
    return;
  }
  drawTemplate(ctx, paper.type, w, h, isDarkPaper(paper), paper.line, thick);
}

// ---------- Pens & brushes
export const BRUSHES = {
  pen: [
    ['ballpoint', 'Ballpoint'], ['fountain', 'Fountain pen'], ['brush', 'Brush pen'], ['felt', 'Felt-tip marker'],
    ['fineliner', 'Fineliner'], ['pencil', 'Pencil'], ['softpencil', 'Soft pencil'], ['crayon', 'Crayon'],
    ['calligraphy', 'Calligraphy'], ['dashed', 'Dashed line'], ['dotted', 'Dotted line'],
  ],
  highlighter: [['classic', 'Classic'], ['straight', 'Straight line'], ['chisel', 'Chisel tip']],
};
export const brushOf = (s) => s.brush || (s.tool === 'highlighter' ? 'classic' : 'ballpoint');

// Pressure (0–1; mouse/touch report 0.5) → width factor, per brush.
const WIDTH = {
  ballpoint: (p) => (p > 0 ? 0.72 + 0.56 * p : 1), // real ballpoints vary little with pressure
  fountain: (p) => 0.3 + 1.4 * p,
  brush: (p) => 0.12 + 0.45 * p + 2.4 * p * p,
  pencil: (p) => 0.75 + 0.5 * p,
  softpencil: (p) => 1.7 + 1.5 * p,
  crayon: (p) => 1.7 + 0.7 * p,
  calligraphy: (p) => 1.3 + 1.7 * p,
};
const TAPER = { brush: 7, fountain: 4 };

// Deterministic grain textures for pencil-like brushes.
const rgbCache = new Map();
function toRGB(color) {
  if (!rgbCache.has(color)) {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = color; x.fillRect(0, 0, 1, 1);
    rgbCache.set(color, [...x.getImageData(0, 0, 1, 1).data].slice(0, 3));
  }
  return rgbCache.get(color);
}
const grainCache = new Map();
function grainCanvas(color, kind) {
  const key = color + '|' + kind;
  if (!grainCache.has(key)) {
    const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d'), img = x.createImageData(N, N), [r, g, b] = toRGB(color);
    let seed = kind === 'pencil' ? 7 : kind === 'softpencil' ? 13 : 29;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // fine paper-tooth noise; crayon adds horizontal waxy streaks
    const fill = kind === 'pencil' ? 0.6 : kind === 'softpencil' ? 0.55 : 0.78;
    const streak = new Array(N).fill(0).map(() => (kind === 'crayon' ? rnd() * 0.5 : 0));
    for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
      const on = rnd() < fill - streak[y] * 0.6;
      const a = on ? (kind === 'softpencil' ? 90 + rnd() * 120 : 150 + rnd() * 105) : rnd() * (kind === 'softpencil' ? 70 : 35);
      const i = (y * N + xx) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
    }
    x.putImageData(img, 0, 0);
    grainCache.set(key, c);
  }
  return grainCache.get(key);
}

export function strokeBBox(s) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const p = s.pts;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
    if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
  }
  const r = s.size * 1.6 + 1;
  return { x: x0 - r, y: y0 - r, w: x1 - x0 + 2 * r, h: y1 - y0 + 2 * r };
}

// Draw into an offscreen layer at full opacity, then composite with alpha (no darkening where the stroke overlaps itself).
function withLayer(ctx, s, alpha, fn) {
  const m = ctx.getTransform(), b = strokeBBox(s);
  const dx = Math.floor(b.x * m.a + m.e), dy = Math.floor(b.y * m.d + m.f);
  const dw = Math.ceil(b.w * m.a) + 2, dh = Math.ceil(b.h * m.d) + 2;
  if (dw <= 0 || dh <= 0) return;
  if (dw * dh > 12e6) { ctx.globalAlpha = alpha; fn(ctx); return; }
  const c = document.createElement('canvas'); c.width = dw; c.height = dh;
  const x = c.getContext('2d');
  x.setTransform(m.a, 0, 0, m.d, m.e - dx, m.f - dy);
  x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = x.fillStyle = s.color;
  fn(x);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(c, dx, dy); ctx.restore();
  c.width = c.height = 0;
}

function nibPath(ctx, p, n, size, wf, angle) {
  const nx = Math.cos(angle), ny = Math.sin(angle);
  for (let i = 1; i < n; i++) {
    const ax = p[i * 3 - 3], ay = p[i * 3 - 2], bx = p[i * 3], by = p[i * 3 + 1];
    const wa = (size * wf(p[i * 3 - 1])) / 2, wb = (size * wf(p[i * 3 + 2])) / 2;
    ctx.beginPath();
    ctx.moveTo(ax + nx * wa, ay + ny * wa); ctx.lineTo(bx + nx * wb, by + ny * wb);
    ctx.lineTo(bx - nx * wb, by - ny * wb); ctx.lineTo(ax - nx * wa, ay - ny * wa);
    ctx.closePath(); ctx.fill();
  }
}

// ---------- Smooth variable-width strokes
// Pressure-sensitive pens are drawn as ONE filled outline (not many short segments), so the
// edges stay smooth while the width changes:
//   1. light smoothing of the pen positions (removes hand/sensor jitter)
//   2. pressure easing (no sudden width jumps)
//   3. Catmull-Rom resampling every ~1 unit (a smooth curve through the points)
//   4. left/right offsets by half the width, joined with round caps, filled once.
function smoothCenterline(p, n) {
  let xs = new Float64Array(n), ys = new Float64Array(n), ps = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = p[i * 3]; ys[i] = p[i * 3 + 1]; ps[i] = p[i * 3 + 2]; }
  // three passes of a [1 2 1] filter on positions (ends pinned)
  for (let pass = 0; pass < 3 && n > 2; pass++) {
    const nx = xs.slice(), ny = ys.slice();
    for (let i = 1; i < n - 1; i++) { nx[i] = (xs[i - 1] + 2 * xs[i] + xs[i + 1]) / 4; ny[i] = (ys[i - 1] + 2 * ys[i] + ys[i + 1]) / 4; }
    xs = nx; ys = ny;
  }
  // ease pressure forwards and backwards (no lag, no spikes)
  for (let i = 1; i < n; i++) ps[i] = ps[i - 1] + (ps[i] - ps[i - 1]) * 0.3;
  for (let i = n - 2; i >= 0; i--) ps[i] = ps[i + 1] + (ps[i] - ps[i + 1]) * 0.5;
  // Catmull-Rom resample
  const ox = [], oy = [], op = [];
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1), i3 = Math.min(n - 1, i + 2);
    const d = Math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]);
    const steps = Math.max(1, Math.ceil(d / 1.0));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, e) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
      ox.push(cr(xs[i0], xs[i], xs[i + 1], xs[i3]));
      oy.push(cr(ys[i0], ys[i], ys[i + 1], ys[i3]));
      op.push(ps[i] + (ps[i + 1] - ps[i]) * t);
    }
  }
  ox.push(xs[n - 1]); oy.push(ys[n - 1]); op.push(ps[n - 1]);
  return { xs: ox, ys: oy, ps: op };
}

// widthAt(i, tangentX, tangentY) → full width at resampled point i
function fillOutline(ctx, xs, ys, widthAt) {
  const m = xs.length;
  if (m < 2) { ctx.beginPath(); ctx.arc(xs[0], ys[0], Math.max(0.3, widthAt(0, 1, 0) / 2), 0, 7); ctx.fill(); return; }
  const L = [], R = [], W = new Array(m);
  let tx0 = 1, ty0 = 0;
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 2), b = Math.min(m - 1, i + 2);
    let tx = xs[b] - xs[a], ty = ys[b] - ys[a];
    const len = Math.hypot(tx, ty);
    if (len > 1e-6) { tx /= len; ty /= len; tx0 = tx; ty0 = ty; } else { tx = tx0; ty = ty0; }
    const w = Math.max(0.3, widthAt(i, tx, ty)) / 2;
    W[i] = w;
    L.push(xs[i] - ty * w, ys[i] + tx * w);
    R.push(xs[i] + ty * w, ys[i] - tx * w);
  }
  ctx.beginPath();
  ctx.moveTo(L[0], L[1]);
  for (let i = 1; i < m; i++) ctx.lineTo(L[i * 2], L[i * 2 + 1]);
  // round cap at the end: from the left side around the tip to the right side
  const ae = Math.atan2(L[(m - 1) * 2 + 1] - ys[m - 1], L[(m - 1) * 2] - xs[m - 1]);
  ctx.arc(xs[m - 1], ys[m - 1], W[m - 1], ae, ae + Math.PI, true);
  for (let i = m - 1; i >= 0; i--) ctx.lineTo(R[i * 2], R[i * 2 + 1]);
  const as = Math.atan2(R[1] - ys[0], R[0] - xs[0]);
  ctx.arc(xs[0], ys[0], W[0], as, as + Math.PI, true);
  ctx.closePath();
  ctx.fill();
}

// Variable-width stroke with ROUND corners. Along gentle curves, neighbouring segments share an
// averaged normal, so the edge is one continuous smooth line. At real corners (turns > ~25°) each
// segment keeps its own normal and a disc fills the corner, like a round pen tip. All pieces are
// wound the same way, so one non-zero fill gives an exact union (no seams, no double-darkening).
function fillRoundStroke(ctx, xs, ys, widthAt) {
  const m = xs.length;
  const disc = (c, x, y, r) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2, false); };
  const quad = (c, ax, ay, bx, by, cx, cy, ex, ey) => {
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay) + (cx - ax) * (ey - ay) - (ex - ax) * (cy - ay);
    if (area >= 0) { c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(cx, cy); c.lineTo(ex, ey); }
    else { c.moveTo(ax, ay); c.lineTo(ex, ey); c.lineTo(cx, cy); c.lineTo(bx, by); }
    c.closePath();
  };
  const r = new Array(m);
  for (let i = 0; i < m; i++) r[i] = Math.max(0.15, widthAt(i) / 2);
  if (m < 2) { ctx.beginPath(); disc(ctx, xs[0], ys[0], r[0]); ctx.fill(); return; }
  // unit direction of each segment
  const dx = new Float64Array(m - 1), dy = new Float64Array(m - 1);
  for (let i = 0; i < m - 1; i++) {
    let x = xs[i + 1] - xs[i], y = ys[i + 1] - ys[i];
    const len = Math.hypot(x, y);
    if (len > 1e-6) { x /= len; y /= len; } else if (i) { x = dx[i - 1]; y = dy[i - 1]; } else { x = 1; y = 0; }
    dx[i] = x; dy[i] = y;
  }
  // per vertex: smooth (shared averaged normal) or a corner (disc)
  const corner = new Uint8Array(m), vnx = new Float64Array(m), vny = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1), b = Math.min(m - 2, i);
    const cos = dx[a] * dx[b] + dy[a] * dy[b];
    if (i === 0 || i === m - 1 || cos < 0.9) corner[i] = 1;
    let nx = -(dy[a] + dy[b]), ny = dx[a] + dx[b];
    const l = Math.hypot(nx, ny) || 1;
    vnx[i] = nx / l; vny[i] = ny / l;
  }
  // Segments [from, to) plus their corner discs, as one sub-path set.
  const piece = (x, from, to) => {
    x.beginPath();
    for (let i = from; i < to; i++) {
      const snx = -dy[i], sny = dx[i];
      const n0x = corner[i] ? snx : vnx[i], n0y = corner[i] ? sny : vny[i];
      const n1x = corner[i + 1] ? snx : vnx[i + 1], n1y = corner[i + 1] ? sny : vny[i + 1];
      quad(x, xs[i] + n0x * r[i], ys[i] + n0y * r[i], xs[i + 1] + n1x * r[i + 1], ys[i + 1] + n1y * r[i + 1],
        xs[i + 1] - n1x * r[i + 1], ys[i + 1] - n1y * r[i + 1], xs[i] - n0x * r[i], ys[i] - n0y * r[i]);
    }
    for (let i = from; i <= to; i++) if (corner[i]) disc(x, xs[i], ys[i], r[i]);
    x.fill('nonzero');
  };
  // One huge path fills in roughly quadratic time, so long strokes are filled in short
  // overlapping pieces (linear). Overlap hides the seams; for see-through fills (pencil grain,
  // dimmed replay) the pieces go to a solid mask first so overlaps can't darken.
  const CHUNK = 40;
  const all = (x) => { for (let a = 0; a < m - 1; a += CHUNK) piece(x, Math.max(0, a - 2), Math.min(m - 1, a + CHUNK)); };
  if (m - 1 <= CHUNK * 1.5) { piece(ctx, 0, m - 1); return; }
  if (typeof ctx.fillStyle === 'string' && ctx.globalAlpha === 1) { all(ctx); return; }
  let maxR = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < m; i++) { maxR = Math.max(maxR, r[i]); x0 = Math.min(x0, xs[i]); y0 = Math.min(y0, ys[i]); x1 = Math.max(x1, xs[i]); y1 = Math.max(y1, ys[i]); }
  const t = ctx.getTransform();
  const lx = Math.floor((x0 - maxR) * t.a + t.e) - 1, ly = Math.floor((y0 - maxR) * t.d + t.f) - 1;
  const lw = Math.ceil((x1 - x0 + 2 * maxR) * t.a) + 3, lh = Math.ceil((y1 - y0 + 2 * maxR) * t.d) + 3;
  if (lw <= 0 || lh <= 0 || lw * lh > 12e6) { piece(ctx, 0, m - 1); return; }
  const c = document.createElement('canvas'); c.width = lw; c.height = lh;
  const x = c.getContext('2d');
  x.setTransform(t.a, t.b, t.c, t.d, t.e - lx, t.f - ly);
  x.fillStyle = '#000';
  all(x);
  // paint the real fill (color or grain pattern) only where the mask is
  x.globalCompositeOperation = 'source-in';
  const fs = ctx.fillStyle;
  if (fs && typeof fs === 'object' && fs.setTransform) {
    // keep the grain anchored where it would be on the target canvas
    x.setTransform(1, 0, 0, 1, 0, 0);
    const pm = new DOMMatrix([1, 0, 0, 1, -lx, -ly]);
    const pat = x.createPattern(fs._src || null, 'repeat');
    x.fillStyle = pat ? (pat.setTransform(pm), pat) : fs;
  } else { x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = fs; }
  x.fillRect(0, 0, lw, lh);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(c, lx, ly); ctx.restore();
  c.width = c.height = 0;
}

export function drawStroke(ctx, s, alpha = 1) {
  if (s.tape && s.revealed) return;
  const p = s.pts, n = p.length / 3;
  if (!n) return;
  const brush = brushOf(s);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = s.color;
  if (s.tool === 'highlighter') {
    if (brush === 'chisel') {
      withLayer(ctx, s, 0.38 * alpha, (x) => { nibPath(x, p, n, s.size, () => 1, -Math.PI / 3); if (n === 1) x.fillRect(p[0] - s.size / 4, p[1] - s.size / 2, s.size / 2, s.size); });
    } else {
      ctx.globalAlpha = 0.38 * alpha;
      ctx.lineCap = brush === 'straight' ? 'butt' : 'square';
      ctx.lineWidth = s.size;
      trace(ctx, p, n, s.shape || brush === 'straight');
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  ctx.globalAlpha = alpha;
  const textured = brush === 'pencil' || brush === 'softpencil' || brush === 'crayon';
  if (textured) {
    const grain = grainCanvas(s.color, brush), pat = ctx.createPattern(grain, 'repeat');
    pat._src = grain;
    // keep the grain one device pixel regardless of zoom
    const m = ctx.getTransform();
    if (pat.setTransform && m.a) pat.setTransform(new DOMMatrix([1 / m.a, 0, 0, 1 / m.d, -m.e / m.a, -m.f / m.d]));
    ctx.strokeStyle = ctx.fillStyle = pat;
    ctx.globalAlpha = alpha * (brush === 'crayon' ? 0.92 : 1);
  }
  const wf = WIDTH[brush] || (() => 1);
  if (n === 1) {
    ctx.beginPath(); ctx.arc(p[0], p[1], (s.size * wf(p[2])) / 2, 0, 7); ctx.fill();
    ctx.restore();
    return;
  }
  if (brush === 'calligraphy') {
    // flat nib at 45°: wide when moving across the nib, thin along it
    const c = smoothCenterline(p, n), nx = Math.cos(-Math.PI / 4), ny = Math.sin(-Math.PI / 4);
    fillOutline(ctx, c.xs, c.ys, (i, tx, ty) => s.size * wf(c.ps[i]) * (0.18 + 0.82 * Math.abs(tx * ny - ty * nx)));
    ctx.restore();
    return;
  }
  if (brush === 'fineliner' || brush === 'felt' || brush === 'dashed' || brush === 'dotted') {
    ctx.lineWidth = s.size * (brush === 'felt' ? 1.6 : brush === 'fineliner' ? 0.85 : brush === 'dotted' ? 1.3 : 1);
    if (brush === 'felt') ctx.globalAlpha = alpha * 0.88;
    if (brush === 'dashed') { ctx.lineCap = 'butt'; ctx.setLineDash([s.size * 3 + 5, s.size * 2 + 5]); }
    if (brush === 'dotted') ctx.setLineDash([0.01, s.size * 2.4 + 4]);
    trace(ctx, p, n, s.shape);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // Snapped shapes keep crisp straight edges; everything hand-drawn gets the smooth outline.
  if (s.shape) {
    if (textured) ctx.globalAlpha = alpha * pencilAlpha(brush, p[2]);
    ctx.lineWidth = s.size * (s.shape && brush === 'ballpoint' ? 1 : wf(s.shape ? 0.5 : p[2]));
    trace(ctx, p, n, s.shape);
    ctx.stroke();
  } else {
    const c = smoothCenterline(p, n), m = c.xs.length;
    // taper over the first/last few units of length (brush pen, fountain pen)
    const taper = (TAPER[brush] || 0) * 2.2;
    let avg = 0;
    for (const v of c.ps) avg += v;
    if (textured) ctx.globalAlpha = alpha * pencilAlpha(brush, avg / m);
    fillRoundStroke(ctx, c.xs, c.ys, (i) => {
      const t = taper ? Math.min(1, (i + 1) / taper, (m - i) / taper) ** 0.6 : 1;
      return s.size * wf(c.ps[i]) * t;
    });
  }
  ctx.restore();
}
const pencilAlpha = (brush, p) => (brush === 'pencil' ? 0.4 + 0.55 * p : brush === 'softpencil' ? 0.3 + 0.5 * p : 0.92);

function trace(ctx, p, n, straight) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (straight || n < 3) {
    for (let i = 1; i < n; i++) ctx.lineTo(p[i * 3], p[i * 3 + 1]);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 3], y = p[i * 3 + 1];
    ctx.quadraticCurveTo(x, y, (x + p[i * 3 + 3]) / 2, (y + p[i * 3 + 4]) / 2);
  }
  ctx.lineTo(p[(n - 1) * 3], p[(n - 1) * 3 + 1]);
}

export function textFont(o) {
  return `${o.italic ? 'italic ' : ''}${o.bold ? 700 : 400} ${o.size}px ${FONT}`;
}

// Mirrors the .tbox CSS (padding 4px, line-height 1.35, pre-wrap) closely enough for export.
export function drawText(ctx, o) {
  ctx.save();
  ctx.font = textFont(o);
  ctx.fillStyle = o.color;
  ctx.textBaseline = 'top';
  const lh = o.size * 1.35, maxW = o.w - 8;
  let y = o.y + 4 + (lh - o.size) / 2;
  for (const para of (o.text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (ctx.measureText(test).width > maxW && line.trim()) {
        ctx.fillText(line.trimEnd(), o.x + 4, y); y += lh; line = word.trimStart();
      } else line = test;
    }
    ctx.fillText(line, o.x + 4, y); y += lh;
  }
  ctx.restore();
}

// ---------- PDF (pdf.js, Apache-2.0, loaded on demand) ----------
const PDFJS = 'vendor/pdfjs/'; // PDF.js 3.11.174 (Apache-2.0), bundled
let pdfjsP;
export function pdfjs() {
  if (!pdfjsP) {
    pdfjsP = loadScript(asset(PDFJS + 'pdf.min.js')).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = asset(PDFJS + 'pdf.worker.min.js');
      return window.pdfjsLib;
    });
    pdfjsP.catch(() => { pdfjsP = null; });
  }
  return pdfjsP;
}

const pdfDocs = new Map();
export function getPdf(blobId) {
  if (!pdfDocs.has(blobId)) {
    const p = (async () => {
      const lib = await pdfjs();
      const blob = await getBlob(blobId);
      if (!blob) throw new Error('PDF file missing');
      return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    })();
    p.catch(() => pdfDocs.delete(blobId));
    pdfDocs.set(blobId, p);
  }
  return pdfDocs.get(blobId);
}

// Render one PDF page into ctx (already transformed to logical page units) at `scale` device px per unit.
// Render one PDF page into ctx (already transformed to page units) at `scale` device px per unit.
// `reg` limits rendering to part of the page (used when zoomed in).
export async function drawPdfPage(ctx, page, scale, taskHolder, reg) {
  reg = reg || { x: 0, y: 0, w: page.w, h: page.h };
  const doc = await getPdf(page.pdf.blob);
  const pg = await doc.getPage(page.pdf.n);
  const vp = pg.getViewport({ scale: (scale * 96) / 72 });
  const k = vp.width / page.w; // device px per page unit
  const tmp = document.createElement('canvas');
  tmp.width = Math.max(1, Math.ceil(reg.w * k));
  tmp.height = Math.max(1, Math.ceil(reg.h * k));
  const task = pg.render({ canvasContext: tmp.getContext('2d'), viewport: vp, transform: [1, 0, 0, 1, -reg.x * k, -reg.y * k] });
  if (taskHolder) taskHolder.task = task;
  await task.promise;
  if (taskHolder && taskHolder.stale) return;
  ctx.drawImage(tmp, reg.x, reg.y, tmp.width / k, tmp.height / k);
  tmp.width = tmp.height = 0;
}

// Import a PDF file → pages + extracted text (for search).
export async function pdfToPages(blobId) {
  const doc = await getPdf(blobId);
  const pages = [];
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 96 / 72 });
    const page = { id: uid(), w: Math.round(vp.width), h: Math.round(vp.height), pdf: { blob: blobId, n: i }, objs: [] };
    pages.push(page);
    if (text.length < 200000) {
      try { page.text = (await pg.getTextContent()).items.map((t) => t.str).join(' ').slice(0, 20000); text += page.text + '\n'; } catch {}
    }
  }
  return { pages, text: text.slice(0, 200000) };
}

// Render a full page (paper, PDF, images, text, ink) onto a new canvas.
// cropH: render only the top cropH units of the page (library previews)
export async function renderPageCanvas(page, paper, scale, cropH = page.h) {
  const c = document.createElement('canvas');
  c.width = Math.round(page.w * scale);
  c.height = Math.round(Math.min(cropH, page.h) * scale);
  const ctx = c.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  await drawPaper(ctx, page, paper, Math.max(1, 0.45 / scale));
  if (page.pdf) {
    try { await drawPdfPage(ctx, page, scale, null, { x: 0, y: 0, w: page.w, h: Math.min(cropH, page.h) }); } catch (e) { console.warn(e); }
  }
  for (const o of page.objs) {
    if (o.type === 'image') {
      const img = await loadImage(o.blob);
      if (img) ctx.drawImage(img, o.x, o.y, o.w, o.h);
    }
  }
  for (const o of page.objs) if (o.type === 'text') drawText(ctx, o);
  for (const o of page.objs) if (o.type === 'stroke') drawStroke(ctx, o);
  return c;
}
