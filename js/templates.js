// Paper templates. Families of designs with variants (spacing, size, layout), drawn in logical page units.
// Multiplied by paper colors (any RGB), line colors and page sizes this gives thousands of combinations,
// and any image or PDF page can be used as a custom template.

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

export const LINE_COLORS = {
  blue: { label: 'Blue', light: 'rgba(70,120,200,.30)', strong: 'rgba(60,100,175,.55)' },
  gray: { label: 'Gray', light: 'rgba(120,124,135,.32)', strong: 'rgba(90,94,105,.6)' },
  dark: { label: 'Dark', light: 'rgba(40,42,48,.42)', strong: 'rgba(30,32,36,.75)' },
  faint: { label: 'Faint', light: 'rgba(120,130,150,.16)', strong: 'rgba(110,120,140,.32)' },
  green: { label: 'Green', light: 'rgba(40,150,90,.30)', strong: 'rgba(30,120,70,.55)' },
  red: { label: 'Red', light: 'rgba(210,70,80,.28)', strong: 'rgba(190,50,60,.5)' },
};

function kit(ctx, w, h, dark, lineColor = 'blue', thick = 1) {
  const lc = LINE_COLORS[lineColor] || LINE_COLORS.blue;
  const line = dark ? 'rgba(255,255,255,.17)' : lc.light;
  const strong = dark ? 'rgba(255,255,255,.34)' : lc.strong;
  const accent = dark ? 'rgba(255,120,140,.42)' : 'rgba(225,80,100,.45)';
  const label = dark ? 'rgba(255,255,255,.42)' : 'rgba(70,90,130,.6)';
  const k = {
    w, h, line, strong, accent, label, ctx,
    stroke(c = line, lw = 1) { ctx.strokeStyle = c; ctx.lineWidth = lw * thick; },
    dash(on) { ctx.setLineDash(on ? (Array.isArray(on) ? on : [6, 6]) : []); },
    hl(y, x0 = 0, x1 = w) { ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); ctx.stroke(); },
    vl(x, y0 = 0, y1 = h) { ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, y1); ctx.stroke(); },
    seg(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); },
    rect(x, y, rw, rh, r = 0) {
      ctx.beginPath();
      if (r && ctx.roundRect) ctx.roundRect(x + 0.5, y + 0.5, rw, rh, r); else ctx.rect(x + 0.5, y + 0.5, rw, rh);
      ctx.stroke();
    },
    circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); },
    arc(x, y, r, a0, a1) { ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke(); },
    dot(x, y, r = 1.3, c = line) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r * Math.sqrt(thick), 0, 7); ctx.fill(); },
    text(s, x, y, size = 12, weight = 600, c = label, align = 'left') {
      ctx.fillStyle = c; ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.fillText(s, x, y); ctx.textAlign = 'left';
    },
    lines(top, step, x0 = 0, x1 = w, bottom = h - 24) { for (let y = top; y < bottom; y += step) k.hl(y, x0, x1); },
    grid(step, c = line, x0 = 0, y0 = 0, x1 = w, y1 = h) {
      k.stroke(c);
      for (let y = y0 + step; y < y1 - 0.5; y += step) k.hl(y, x0, x1);
      for (let x = x0 + step; x < x1 - 0.5; x += step) k.vl(x, y0, y1);
    },
    dots(step, r = 1.3, x0 = 0, y0 = 0, x1 = w, y1 = h) { for (let y = y0 + step; y < y1; y += step) for (let x = x0 + step; x < x1; x += step) k.dot(x, y, r); },
    // table: columns as x positions, header labels, rows below the header line
    table(cols, labels, top, rowH, bottom = h - 40, hdr = 12) {
      labels.forEach((l, i) => k.text(l.toUpperCase(), cols[i] + 8, top - 10, hdr - 1));
      k.stroke(strong); k.hl(top, cols[0], cols[cols.length - 1]);
      cols.forEach((x) => k.vl(x, top, bottom));
      k.stroke(); k.lines(top + rowH, rowH, cols[0], cols[cols.length - 1], bottom + 1);
      k.stroke(strong); k.hl(bottom, cols[0], cols[cols.length - 1]);
    },
    header(title, y = 54) { k.text(title, 40, y, 20, 700); },
    field(labelText, x, y, x1) { k.text(labelText, x, y, 12); k.stroke(); k.hl(y + 8, x + labelText.length * 7 + 14, x1); },
    box(x, y, bw, bh, title, r = 8) { k.stroke(strong); k.rect(x, y, bw, bh, r); if (title) k.text(title.toUpperCase(), x + 10, y + 20, 11); },
  };
  return k;
}

export const TEMPLATES = [];
const T = (id, name, cat, draw, tags = '') => TEMPLATES.push({ id, name, cat, draw, tags: (name + ' ' + cat + ' ' + tags).toLowerCase() });
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dshort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ============================================================ Basic
T('blank', 'Blank', 'Basic', () => {});
const ruled = [['narrow', 'Narrow ruled', 22], ['college', 'College ruled', 26], ['medium', 'Medium ruled', 30], ['lined', 'Lined', 32], ['wide', 'Wide ruled', 40], ['xwide', 'Extra-wide ruled', 52]];
for (const [id, name, sp] of ruled) {
  T(id, name, 'Basic', (k) => { k.stroke(); k.lines(96, sp); k.stroke(k.accent); k.vl(88); }, 'lined ruled paper margin');
  T(id + '-nomargin', name + ', no margin', 'Basic', (k) => { k.stroke(); k.lines(80, sp, 40, k.w - 40); }, 'lined ruled');
  T(id + '-header', name + ', header', 'Basic', (k) => {
    k.field('Title', 40, 52, k.w - 240); k.field('Date', k.w - 200, 52, k.w - 40);
    k.stroke(k.strong); k.hl(80, 0, k.w); k.stroke(); k.lines(80 + sp, sp); k.stroke(k.accent); k.vl(88, 80, k.h);
  }, 'lined title date');
}
T('legal-pad', 'Legal pad', 'Basic', (k) => { k.stroke(); k.lines(120, 30); k.stroke(k.accent); k.vl(92); k.vl(96); k.hl(96); }, 'yellow pad');
T('steno', 'Steno pad', 'Basic', (k) => { k.stroke(); k.lines(90, 30); k.stroke(k.accent); k.vl(k.w / 2); }, 'shorthand reporter');
T('two-column', 'Two columns, lined', 'Basic', (k) => { k.stroke(); k.lines(80, 30, 40, k.w / 2 - 14); k.lines(80, 30, k.w / 2 + 14, k.w - 40); });
T('three-column', 'Three columns, lined', 'Basic', (k) => { const cw = (k.w - 80) / 3; k.stroke(); for (let i = 0; i < 3; i++) k.lines(80, 30, 40 + i * cw + (i ? 10 : 0), 40 + (i + 1) * cw - 10); });
T('lined-dotted', 'Dotted lines', 'Basic', (k) => { for (let y = 96; y < k.h - 24; y += 30) for (let x = 40; x < k.w - 40; x += 8) k.dot(x, y, 0.9); });
T('lined-dashed', 'Dashed lines', 'Basic', (k) => { k.stroke(); k.dash([4, 6]); k.lines(96, 30, 40, k.w - 40); k.dash(false); });
T('lined-margin-both', 'Lined, both margins', 'Basic', (k) => { k.stroke(); k.lines(96, 30); k.stroke(k.accent); k.vl(88); k.vl(k.w - 88); });
T('border', 'Border', 'Basic', (k) => { k.stroke(k.strong, 1.5); k.rect(36, 36, k.w - 72, k.h - 72, 6); });
T('lined-border', 'Lined with border', 'Basic', (k) => { k.stroke(k.strong, 1.5); k.rect(36, 36, k.w - 72, k.h - 72, 6); k.stroke(); k.lines(84, 30, 36, k.w - 36, k.h - 36); });

// ============================================================ Grid & Dots
for (const s of [12, 16, 20, 24, 32, 40, 48]) {
  T(s === 24 ? 'grid' : s === 16 ? 'grid-small' : s === 40 ? 'grid-large' : 'grid-' + s, `Grid ${s}px`, 'Grid & Dots', (k) => k.grid(s), 'graph squares');
  T(s === 24 ? 'dotted' : s === 16 ? 'dotted-small' : 'dotted-' + s, `Dot grid ${s}px`, 'Grid & Dots', (k) => k.dots(s, s < 16 ? 0.9 : s > 32 ? 1.7 : 1.3), 'bullet journal dots');
}
T('dotted-large', 'Large dots', 'Grid & Dots', (k) => k.dots(36, 1.6));
T('engineering', 'Engineering', 'Grid & Dots', (k) => { k.grid(16); k.grid(80, k.strong); }, 'graph');
T('graph-5', 'Graph, bold every 5', 'Grid & Dots', (k) => { k.grid(20); k.grid(100, k.strong); });
T('graph-10', 'Graph, bold every 10', 'Grid & Dots', (k) => { k.grid(10); k.grid(100, k.strong); });
T('grid-margin', 'Grid with margin', 'Grid & Dots', (k) => { k.grid(20, k.line, 60, 60, k.w - 40, k.h - 40); k.stroke(k.strong); k.rect(60, 60, k.w - 100, k.h - 100); });
T('dot-border', 'Dot grid with border', 'Grid & Dots', (k) => { k.dots(20, 1.1, 40, 40, k.w - 40, k.h - 40); k.stroke(k.strong); k.rect(40, 40, k.w - 80, k.h - 80, 6); });
T('isometric-dots', 'Isometric dots', 'Grid & Dots', (k) => { const s = 24, rh = (s * Math.sqrt(3)) / 2; for (let r = 1, y = rh; y < k.h; r++, y += rh) for (let x = ((r % 2) * s) / 2 + s / 2; x < k.w; x += s) k.dot(x, y); });
for (const [id, s] of [['isometric', 28], ['isometric-small', 18], ['isometric-large', 42]]) {
  T(id, `Isometric grid${id === 'isometric' ? '' : id.endsWith('small') ? ', small' : ', large'}`, 'Grid & Dots', (k, ctx) => {
    k.stroke(); const t = Math.tan(Math.PI / 6), L = k.w + k.h;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, k.w, k.h); ctx.clip();
    for (let x = -L; x < L; x += s) { k.vl(x); k.seg(x, 0, x + k.h / t, k.h); k.seg(x, 0, x - k.h / t, k.h); }
    ctx.restore();
  }, '3d drawing');
}
for (const [id, r] of [['hex', 18], ['hex-small', 11], ['hex-large', 28]]) {
  T(id, `Hexagons${id === 'hex' ? '' : id.endsWith('small') ? ', small' : ', large'}`, 'Grid & Dots', (k, ctx) => {
    k.stroke(); const hw = r * Math.sqrt(3);
    for (let row = 0, y = 0; y < k.h + r; row++, y += r * 1.5) for (let x = ((row % 2) * hw) / 2; x < k.w + hw; x += hw) {
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx[i ? 'lineTo' : 'moveTo'](x + r * Math.cos(a), y + r * Math.sin(a)); } ctx.closePath(); ctx.stroke();
    }
  }, 'chemistry organic hexagonal');
}
T('triangle', 'Triangle grid', 'Grid & Dots', (k, ctx) => {
  k.stroke(); const s = 32, hh = (s * Math.sqrt(3)) / 2, t = Math.tan(Math.PI / 3);
  for (let y = 0; y < k.h; y += hh) k.hl(y);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, k.w, k.h); ctx.clip();
  for (let x = -k.h; x < k.w + k.h; x += s) { k.seg(x, 0, x + k.h / t, k.h); k.seg(x, 0, x - k.h / t, k.h); }
  ctx.restore();
});
T('polar', 'Polar graph', 'Grid & Dots', (k) => {
  k.stroke(); const cx = k.w / 2, cy = k.h / 2, R = Math.min(k.w, k.h) / 2 - 40;
  for (let r = R / 10; r <= R + 1; r += R / 10) k.circle(cx, cy, r);
  for (let a = 0; a < 360; a += 15) { const t = (a * Math.PI) / 180; k.seg(cx, cy, cx + R * Math.cos(t), cy + R * Math.sin(t)); }
}, 'math circle');
T('semilog', 'Semi-log graph', 'Grid & Dots', (k) => {
  k.grid(40, k.line, 40, 40, k.w - 40, k.h - 40); k.stroke();
  const x0 = 40, x1 = k.w - 40, y0 = 40, y1 = k.h - 40, dec = 3, dh = (y1 - y0) / dec;
  for (let d = 0; d < dec; d++) for (let i = 1; i <= 10; i++) { const y = y1 - d * dh - Math.log10(i) * dh; k.stroke(i === 1 ? k.strong : k.line); k.hl(y, x0, x1); }
  k.stroke(k.strong); k.rect(x0, y0, x1 - x0, y1 - y0);
}, 'logarithmic math');
T('loglog', 'Log-log graph', 'Grid & Dots', (k) => {
  const x0 = 40, x1 = k.w - 40, y0 = 40, y1 = k.h - 40, dw = (x1 - x0) / 2, dh = (y1 - y0) / 3;
  for (let d = 0; d < 3; d++) for (let i = 1; i <= 10; i++) { k.stroke(i === 1 ? k.strong : k.line); k.hl(y1 - d * dh - Math.log10(i) * dh, x0, x1); }
  for (let d = 0; d < 2; d++) for (let i = 1; i <= 10; i++) { k.stroke(i === 1 ? k.strong : k.line); k.vl(x0 + d * dw + Math.log10(i) * dw, y0, y1); }
  k.stroke(k.strong); k.rect(x0, y0, x1 - x0, y1 - y0);
}, 'logarithmic math');
for (const [id, name, n] of [['coord-1', 'Coordinate plane', 1], ['coord-2', 'Coordinate planes ×2', 2], ['coord-4', 'Coordinate planes ×4', 4], ['coord-6', 'Coordinate planes ×6', 6]]) {
  T(id, name, 'Grid & Dots', (k) => {
    const cols = n >= 4 ? 2 : 1, rows = n / cols, gw = (k.w - 60 - (cols - 1) * 30) / cols, gh = (k.h - 60 - (rows - 1) * 30) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = 30 + c * (gw + 30), y = 30 + r * (gh + 30), s = Math.min(gw, gh), ox = x + (gw - s) / 2, oy = y + (gh - s) / 2, step = s / 20;
      k.grid(step, k.line, ox, oy, ox + s, oy + s); k.stroke(k.strong, 1.5); k.hl(oy + s / 2, ox, ox + s); k.vl(ox + s / 2, oy, oy + s);
    }
  }, 'math axes graph xy quadrant');
}
T('number-lines', 'Number lines', 'Grid & Dots', (k) => {
  for (let y = 90; y < k.h - 40; y += 80) { k.stroke(k.strong, 1.5); k.hl(y, 50, k.w - 50); for (let i = 0; i <= 20; i++) { const x = 50 + (i * (k.w - 100)) / 20; k.seg(x, y - (i % 5 ? 6 : 10), x, y + (i % 5 ? 6 : 10)); } }
}, 'math');
T('perspective-1', 'One-point perspective', 'Grid & Dots', (k) => {
  const vx = k.w / 2, vy = k.h * 0.42; k.stroke(); k.hl(vy);
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; k.seg(vx, vy, vx + Math.cos(a) * 2000, vy + Math.sin(a) * 2000); }
}, 'drawing art');
T('perspective-2', 'Two-point perspective', 'Grid & Dots', (k) => {
  const vy = k.h * 0.45; k.stroke(); k.hl(vy);
  for (const vx of [-80, k.w + 80]) for (let i = -12; i <= 12; i++) { const a = (i / 12) * 0.9; k.seg(vx, vy, vx + (vx < 0 ? 1 : -1) * Math.cos(a) * 2000, vy + Math.sin(a) * 2000); }
}, 'drawing art');

// ============================================================ Study
const cornell = (k, body) => {
  const top = 120, cue = Math.round(k.w * 0.28), sum = k.h - 200;
  k.field('Topic', 16, 44, k.w - 220); k.field('Date', k.w - 200, 44, k.w - 20);
  body(top, cue, sum);
  k.stroke(k.accent, 1.5); k.hl(top); k.vl(cue, top, sum); k.hl(sum);
  k.text('CUES', 16, top + 20); k.text('NOTES', cue + 16, top + 20); k.text('SUMMARY', 16, sum + 22);
};
T('cornell', 'Cornell notes', 'Study', (k) => cornell(k, (top, cue, sum) => { k.stroke(); k.lines(top + 28, 28, 0, k.w, sum); }), 'cornell method');
T('cornell-blank', 'Cornell, blank', 'Study', (k) => cornell(k, () => {}), 'cornell method');
T('cornell-grid', 'Cornell, grid', 'Study', (k) => cornell(k, (top, cue, sum) => k.grid(20, k.line, cue, top, k.w, sum)), 'cornell method');
T('cornell-dots', 'Cornell, dotted', 'Study', (k) => cornell(k, (top, cue, sum) => k.dots(20, 1, cue, top, k.w, sum)), 'cornell method');
T('lecture', 'Lecture notes', 'Study', (k) => {
  k.field('Course', 40, 48, k.w - 260); k.field('Date', k.w - 240, 48, k.w - 40); k.field('Topic', 40, 84, k.w - 40);
  k.stroke(k.strong); k.hl(110, 40, k.w - 40); k.stroke(); k.lines(150, 30, 40, k.w - 40);
}, 'class');
T('lecture-questions', 'Lecture + questions column', 'Study', (k) => {
  k.field('Course', 40, 48, k.w / 2); k.field('Date', k.w - 240, 48, k.w - 40);
  k.stroke(k.strong); k.hl(80, 40, k.w - 40); const qx = k.w - 230; k.vl(qx, 80, k.h - 40); k.text('QUESTIONS', qx + 12, 100, 11);
  k.stroke(); k.lines(120, 30, 40, k.w - 40, k.h - 40);
});
T('outline', 'Outline', 'Study', (k) => { k.stroke(); k.lines(96, 30, 40, k.w - 40); for (let y = 86; y < k.h - 24; y += 30) k.dot(56, y, 2.2, k.strong); k.stroke(k.accent); k.vl(72, 70, k.h - 30); }, 'bullet');
T('vocab', 'Vocabulary', 'Study', (k) => { const mid = Math.round(k.w * 0.38); k.text('TERM', 44, 70); k.text('DEFINITION', mid + 16, 70); k.stroke(k.strong); k.hl(84, 30, k.w - 30); k.vl(mid, 84, k.h - 40); k.stroke(); k.lines(130, 46, 30, k.w - 30, k.h - 40); }, 'words language');
T('vocab-3', 'Vocabulary, 3 columns', 'Study', (k) => k.table([30, 250, 560, k.w - 30], ['Word', 'Meaning', 'Example'], 90, 44), 'language');
T('language', 'Language learning', 'Study', (k) => k.table([30, 270, 520, k.w - 30], ['Word', 'Translation', 'Notes'], 90, 40), 'vocabulary foreign');
for (const [id, cols, rows] of [['flashcards', 2, 3], ['flashcards-4', 2, 2], ['flashcards-8', 2, 4], ['flashcards-12', 3, 4]]) {
  T(id, `Flashcards (${cols * rows})`, 'Study', (k) => {
    k.stroke(k.strong); const cw = (k.w - 30 * (cols + 1)) / cols, ch = (k.h - 40 - 20 * (rows + 1)) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = 30 + c * (cw + 30), y = 30 + r * (ch + 20); k.rect(x, y, cw, ch, 10); k.text(c % 2 ? 'BACK' : 'FRONT', x + 12, y + 22, 11); }
  }, 'cards study');
}
T('math', 'Math (grid + margin)', 'Study', (k) => { k.grid(20); k.stroke(k.accent, 1.5); k.vl(100); k.hl(80); });
T('math-problems', 'Math problems', 'Study', (k) => { for (let i = 0; i < 6; i++) { const y = 40 + i * ((k.h - 60) / 6); k.box(40, y, k.w - 80, (k.h - 60) / 6 - 14, `Problem ${i + 1}`); } }, 'homework');
T('math-2col', 'Math, two columns', 'Study', (k) => { k.grid(20, k.line, 30, 30, k.w / 2 - 10, k.h - 30); k.grid(20, k.line, k.w / 2 + 10, 30, k.w - 30, k.h - 30); });
T('lab', 'Lab notebook', 'Study', (k) => {
  k.field('Experiment', 40, 44, k.w - 240); k.field('Date', k.w - 220, 44, k.w - 40);
  k.grid(16, k.line, 40, 70, k.w - 40, k.h - 140); k.stroke(k.strong); k.rect(40, 70, k.w - 80, k.h - 210);
  k.field('Signed', 40, k.h - 90, k.w / 2 - 20); k.field('Witness', k.w / 2, k.h - 90, k.w - 40);
}, 'science');
T('lab-report', 'Lab report', 'Study', (k) => {
  const secs = ['Question', 'Hypothesis', 'Materials', 'Procedure', 'Data', 'Conclusion'], sh = (k.h - 80) / secs.length;
  secs.forEach((s, i) => { const y = 40 + i * sh; k.box(40, y, k.w - 80, sh - 12, s); k.stroke(); k.lines(y + 50, 28, 52, k.w - 52, y + sh - 16); });
}, 'science');
T('reading', 'Reading log', 'Study', (k) => k.table([40, 300, 470, 600, k.w - 40], ['Title', 'Author', 'Pages', 'Rating'], 82, 40), 'books');
T('book-report', 'Book report', 'Study', (k) => {
  k.field('Title', 40, 50, k.w - 40); k.field('Author', 40, 84, k.w / 2); k.field('Genre', k.w / 2 + 20, 84, k.w - 40);
  const secs = [['Characters', 200], ['Summary', 300], ['Favorite part', 160], ['My rating', 120]]; let y = 120;
  for (const [s, hh] of secs) { k.box(40, y, k.w - 80, hh - 14, s); k.stroke(); k.lines(y + 50, 28, 52, k.w - 52, y + hh - 18); y += hh; }
}, 'reading');
T('kwl', 'KWL chart', 'Study', (k) => { const cw = (k.w - 80) / 3; ['What I Know', 'What I Want to know', 'What I Learned'].forEach((t, i) => k.box(40 + i * cw, 60, cw - 10, k.h - 100, t)); }, 'chart');
T('venn-2', 'Venn diagram (2)', 'Study', (k) => { k.stroke(k.strong, 1.5); const r = k.w * 0.28, y = k.h * 0.42; k.circle(k.w / 2 - r * 0.55, y, r); k.circle(k.w / 2 + r * 0.55, y, r); k.stroke(); k.lines(y + r + 60, 30, 40, k.w - 40); }, 'compare');
T('venn-3', 'Venn diagram (3)', 'Study', (k) => { k.stroke(k.strong, 1.5); const r = k.w * 0.25, cx = k.w / 2, cy = k.h * 0.42; k.circle(cx - r * 0.55, cy - r * 0.35, r); k.circle(cx + r * 0.55, cy - r * 0.35, r); k.circle(cx, cy + r * 0.55, r); }, 'compare');
T('t-chart', 'T-chart', 'Study', (k) => { k.stroke(k.strong, 2); k.hl(110, 40, k.w - 40); k.vl(k.w / 2, 70, k.h - 40); k.stroke(); k.lines(150, 30, 40, k.w - 40); }, 'compare');
T('pros-cons', 'Pros & cons', 'Study', (k) => { k.text('PROS', k.w / 4, 96, 14, 700, k.label, 'center'); k.text('CONS', (3 * k.w) / 4, 96, 14, 700, k.label, 'center'); k.stroke(k.strong, 2); k.hl(110, 40, k.w - 40); k.vl(k.w / 2, 70, k.h - 40); k.stroke(); k.lines(150, 30, 40, k.w - 40); }, 'decision');
T('frayer', 'Frayer model', 'Study', (k) => {
  const cx = k.w / 2, cy = k.h / 2; k.box(40, 40, cx - 50, cy - 50, 'Definition'); k.box(cx + 10, 40, cx - 50, cy - 50, 'Characteristics');
  k.box(40, cy + 10, cx - 50, cy - 50, 'Examples'); k.box(cx + 10, cy + 10, cx - 50, cy - 50, 'Non-examples'); k.stroke(k.strong, 2); k.ctx.fillStyle = 'rgba(0,0,0,0)'; k.rect(cx - 110, cy - 50, 220, 100, 50);
}, 'vocabulary');
T('mindmap', 'Mind map', 'Study', (k) => {
  const cx = k.w / 2, cy = k.h / 2; k.stroke(k.strong, 2); k.rect(cx - 110, cy - 50, 220, 100, 50); k.stroke(k.line, 1.5);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2, x = cx + Math.cos(a) * 280, y = cy + Math.sin(a) * 340; k.seg(cx + Math.cos(a) * 110, cy + Math.sin(a) * 50, x, y); k.circle(x, y, 46); }
}, 'brainstorm');
T('concept-map', 'Concept map', 'Study', (k) => { k.stroke(k.strong); for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) k.rect(60 + c * 250, 80 + r * 240, 190, 80, 12); }, 'diagram');
T('timeline-h', 'Timeline', 'Study', (k) => { k.stroke(k.strong, 2); k.hl(k.h / 2, 40, k.w - 40); for (let i = 0; i <= 8; i++) { const x = 60 + (i * (k.w - 120)) / 8; k.seg(x, k.h / 2 - 12, x, k.h / 2 + 12); k.stroke(); k.rect(x - 40, i % 2 ? k.h / 2 + 40 : k.h / 2 - 160, 80, 120, 6); k.stroke(k.strong, 2); } }, 'history events');
T('timeline-v', 'Vertical timeline', 'Study', (k) => { k.stroke(k.strong, 2); k.vl(160, 40, k.h - 40); for (let y = 80; y < k.h - 40; y += 90) { k.dot(160, y, 6, k.strong); k.stroke(); k.hl(y, 180, k.w - 40); k.hl(y + 30, 180, k.w - 40); k.stroke(k.strong, 2); } }, 'history');
T('sq3r', 'SQ3R study', 'Study', (k) => { const s = ['Survey', 'Question', 'Read', 'Recite', 'Review'], sh = (k.h - 80) / 5; s.forEach((t, i) => { k.box(40, 40 + i * sh, k.w - 80, sh - 12, t); k.stroke(); k.lines(90 + i * sh, 28, 52, k.w - 52, 40 + (i + 1) * sh - 16); }); });
T('exam-prep', 'Exam prep', 'Study', (k, ctx) => {
  k.header('Exam prep'); k.field('Subject', 40, 90, k.w / 2); k.field('Exam date', k.w / 2 + 20, 90, k.w - 40);
  k.text('TOPICS TO REVIEW', 40, 140, 11); k.stroke(); for (let y = 170; y < 560; y += 34) { k.hl(y, 76, k.w - 40); ctx.strokeStyle = k.strong; ctx.strokeRect(46.5, y - 22.5, 16, 16); }
  k.box(40, 590, k.w - 80, k.h - 630, 'Key formulas & facts');
});
T('spelling', 'Spelling practice', 'Study', (k) => k.table([40, 300, 560, k.w - 40], ['Word', 'Practice', 'Practice'], 90, 46), 'school kids');
T('study-planner', 'Study planner', 'Study', (k) => { k.header('Study planner'); k.table([40, 160, 420, 620, k.w - 40], ['Day', 'Subject', 'Task', 'Done'], 110, 44); });
T('chem-hex', 'Organic chemistry', 'Study', (k, ctx) => { TEMPLATE_MAP['hex-small'].draw(k, ctx); }, 'molecules hexagon');

// ============================================================ Planning
for (const [id, name, from, to] of [['planner', 'Daily planner', 7, 22], ['planner-early', 'Daily planner (5am–8pm)', 5, 20], ['planner-work', 'Daily planner (work hours)', 8, 18]]) {
  T(id, name, 'Planning', (k) => {
    const x0 = 110, top = 110, n = to - from, step = (k.h - top - 60) / n;
    k.field('Date', 40, 60, 320);
    k.stroke(); for (let i = 0; i <= n; i++) { const y = Math.round(top + i * step); k.hl(y, 40, k.w - 40); if (i < n) { const hr = (i + from) % 12 || 12; k.text(`${hr} ${i + from < 12 ? 'AM' : 'PM'}`, 44, y + 20, 13); } }
    k.stroke(k.accent); k.vl(x0, top, k.h - 60);
  }, 'schedule day hourly');
}
T('daily-todo', 'Daily planner + to-do', 'Planning', (k, ctx) => {
  k.field('Date', 40, 56, 320); const mid = k.w * 0.58, top = 90, n = 14, step = (k.h - top - 40) / n;
  k.stroke(); for (let i = 0; i <= n; i++) { const y = top + i * step; k.hl(y, 40, mid - 12); if (i < n) k.text(`${((i + 7) % 12) || 12}`, 44, y + 18, 12); }
  k.box(mid, top, k.w - mid - 40, (k.h - top) / 2 - 30, 'To do'); for (let y = top + 50; y < top + (k.h - top) / 2 - 40; y += 30) { ctx.strokeStyle = k.line; ctx.strokeRect(mid + 12.5, y - 14.5, 12, 12); }
  k.box(mid, top + (k.h - top) / 2 - 10, k.w - mid - 40, (k.h - top) / 2 - 30, 'Notes');
}, 'schedule');
T('weekly', 'Weekly planner', 'Planning', (k) => {
  k.field('Week of', 40, 50, 360); const top = 80, cw = (k.w - 80) / 2, rh = (k.h - top - 40) / 4;
  for (let i = 0; i < 8; i++) k.box(40 + (i % 2) * cw, top + Math.floor(i / 2) * rh, cw - 8, rh - 8, i < 7 ? days[i] : 'Notes', 4);
}, 'week');
T('weekly-columns', 'Weekly, vertical columns', 'Planning', (k) => {
  k.field('Week of', 40, 50, 360); const top = 80, cw = (k.w - 80) / 7;
  for (let i = 0; i < 7; i++) { k.box(40 + i * cw, top, cw - 4, k.h - top - 40, dshort[i], 4); k.stroke(); k.lines(top + 60, 28, 46 + i * cw, 36 + (i + 1) * cw, k.h - 44); }
}, 'week');
T('weekly-list', 'Weekly, horizontal', 'Planning', (k) => {
  k.field('Week of', 40, 50, 360); const top = 80, rh = (k.h - top - 40) / 7;
  for (let i = 0; i < 7; i++) { const y = top + i * rh; k.stroke(k.strong); k.hl(y, 40, k.w - 40); k.text(days[i].toUpperCase(), 44, y + 20, 11); k.stroke(); k.lines(y + 32, 26, 140, k.w - 40, y + rh - 4); }
}, 'week');
const monthGrid = (k, x, y, w, h, lab = true, notes = 0) => {
  const cw = (w - notes) / 7, rh = (h - 24) / 6;
  if (lab) dshort.forEach((d, i) => k.text(d.toUpperCase(), x + i * cw + cw / 2, y + 14, 10, 600, k.label, 'center'));
  k.stroke(k.strong); for (let r = 0; r <= 6; r++) k.hl(y + 24 + r * rh, x, x + 7 * cw); for (let c = 0; c <= 7; c++) k.vl(x + c * cw, y + 24, y + 24 + 6 * rh);
};
T('monthly', 'Monthly calendar', 'Planning', (k) => { k.field('Month', 40, 54, 360); monthGrid(k, 40, 80, k.w - 80, k.h - 120); }, 'month calendar');
T('monthly-notes', 'Monthly + notes', 'Planning', (k) => { k.field('Month', 40, 54, 360); monthGrid(k, 40, 80, k.w - 80, (k.h - 120) * 0.68); k.box(40, 80 + (k.h - 120) * 0.7, k.w - 80, (k.h - 120) * 0.3, 'Notes'); }, 'month calendar');
for (const m of months) T('month-' + m.slice(0, 3).toLowerCase(), m, 'Planning', (k) => { k.header(m, 60); monthGrid(k, 40, 84, k.w - 80, k.h - 124); }, 'month calendar ' + m);
T('yearly', 'Year at a glance', 'Planning', (k) => {
  k.field('Year', 40, 50, 260); const cw = (k.w - 80) / 3, rh = (k.h - 80) / 4;
  months.forEach((m, i) => { const x = 40 + (i % 3) * cw, y = 70 + Math.floor(i / 3) * rh; k.text(m.toUpperCase(), x + 6, y + 14, 11); monthGrid(k, x + 4, y + 18, cw - 16, rh - 30, false); });
}, 'year calendar');
T('todo', 'To-do list', 'Planning', (k, ctx) => { k.header('To do', 60); k.stroke(); for (let y = 110; y < k.h - 40; y += 40) { k.hl(y, 80, k.w - 40); ctx.strokeStyle = k.strong; ctx.strokeRect(46.5, y - 24.5, 18, 18); ctx.strokeStyle = k.line; } }, 'checklist tasks');
T('todo-2col', 'To-do, two columns', 'Planning', (k, ctx) => {
  k.header('To do', 60); for (const x0 of [40, k.w / 2 + 10]) { k.stroke(); for (let y = 110; y < k.h - 40; y += 36) { k.hl(y, x0 + 32, x0 + k.w / 2 - 50); ctx.strokeStyle = k.strong; ctx.strokeRect(x0 + 0.5, y - 20.5, 16, 16); ctx.strokeStyle = k.line; } }
}, 'checklist');
T('eisenhower', 'Priority matrix', 'Planning', (k) => {
  const cx = k.w / 2 + 20, cy = k.h / 2 + 20; k.text('URGENT', (cx + 60) / 2, 54, 12, 700, k.label, 'center'); k.text('NOT URGENT', (cx + k.w - 40) / 2, 54, 12, 700, k.label, 'center');
  k.box(60, 70, cx - 70, cy - 80, 'Do first'); k.box(cx + 10, 70, k.w - cx - 50, cy - 80, 'Schedule'); k.box(60, cy, cx - 70, k.h - cy - 40, 'Delegate'); k.box(cx + 10, cy, k.w - cx - 50, k.h - cy - 40, "Don't do");
}, 'eisenhower urgent important');
T('meeting', 'Meeting notes', 'Planning', (k) => {
  [['Meeting', 44], ['Date', 76], ['Attendees', 108]].forEach(([l, y]) => k.field(l, 40, y, k.w - 40));
  k.text('AGENDA', 40, 160, 11); k.stroke(); k.lines(184, 28, 40, k.w - 40, 330);
  k.text('NOTES', 40, 360, 11); k.lines(384, 28, 40, k.w - 40, k.h - 220);
  k.text('ACTION ITEMS', 40, k.h - 190, 11); k.lines(k.h - 166, 28, 40, k.w - 40, k.h - 30);
}, 'work');
T('meeting-minutes', 'Meeting minutes', 'Planning', (k) => { k.header('Meeting minutes'); k.field('Date', 40, 90, 300); k.field('Facilitator', 330, 90, k.w - 40); k.table([40, 470, 640, k.w - 40], ['Discussion / decision', 'Owner', 'Due'], 140, 40); }, 'work');
T('one-on-one', '1:1 meeting', 'Planning', (k) => { k.header('1:1'); k.field('With', 40, 90, k.w / 2); k.field('Date', k.w / 2 + 20, 90, k.w - 40); [['Updates', 120], ['Discussion', 360], ['Next steps', 600]].forEach(([t, y]) => { k.box(40, y, k.w - 80, 220, t); k.stroke(); k.lines(y + 52, 28, 52, k.w - 52, y + 214); }); }, 'work manager');
T('habit', 'Habit tracker', 'Planning', (k) => {
  k.header('Habits', 60); const x0 = 220, cw = (k.w - 40 - x0) / 31, top = 90, rh = 34;
  for (let d = 1; d <= 31; d++) k.text(String(d), x0 + (d - 0.5) * cw, top - 6, 9, 600, k.label, 'center');
  k.stroke(); for (let r = 0; r <= 26; r++) k.hl(top + r * rh, 40, k.w - 40); for (let d = 0; d <= 31; d++) k.vl(x0 + d * cw, top, top + 26 * rh); k.stroke(k.strong); k.vl(x0, top, top + 26 * rh);
}, 'tracker');
T('mood', 'Mood tracker', 'Planning', (k) => {
  k.header('Mood', 60); const cw = (k.w - 80) / 7, rh = (k.h - 140) / 5;
  for (let i = 0; i < 31; i++) { const x = 40 + (i % 7) * cw, y = 100 + Math.floor(i / 7) * rh; k.stroke(); k.circle(x + cw / 2, y + rh / 2, Math.min(cw, rh) / 2 - 10); k.text(String(i + 1), x + cw / 2, y + rh / 2 + 4, 11, 600, k.label, 'center'); }
}, 'tracker wellness');
T('workout', 'Workout log', 'Planning', (k) => { k.header('Workout'); k.field('Date', 40, 90, 300); k.table([40, 330, 430, 530, 640, k.w - 40], ['Exercise', 'Sets', 'Reps', 'Weight', 'Notes'], 140, 38); }, 'fitness gym');
T('meal', 'Meal planner', 'Planning', (k) => {
  k.field('Week of', 40, 50, 360); const top = 100, cols = [40, 150, 360, 570, k.w - 40], rh = (k.h - top - 40) / 7;
  ['Breakfast', 'Lunch', 'Dinner'].forEach((t, i) => k.text(t.toUpperCase(), cols[i + 1] + 8, top - 10, 11));
  k.stroke(k.strong); for (let r = 0; r <= 7; r++) k.hl(top + r * rh, 40, k.w - 40); cols.forEach((x) => k.vl(x, top, top + 7 * rh));
  dshort.forEach((d, i) => k.text(d.toUpperCase(), 48, top + i * rh + 22, 11));
}, 'food');
T('grocery', 'Grocery list', 'Planning', (k, ctx) => {
  k.header('Groceries', 54); const secs = ['Produce', 'Dairy', 'Meat & fish', 'Bakery', 'Pantry', 'Frozen', 'Household', 'Other'], cw = (k.w - 100) / 2, rh = (k.h - 90) / 4;
  secs.forEach((s, i) => { const x = 40 + (i % 2) * (cw + 20), y = 76 + Math.floor(i / 2) * rh; k.box(x, y, cw, rh - 12, s); k.stroke(); for (let yy = y + 50; yy < y + rh - 20; yy += 28) { k.hl(yy, x + 34, x + cw - 10); ctx.strokeStyle = k.strong; ctx.strokeRect(x + 12.5, yy - 14.5, 12, 12); ctx.strokeStyle = k.line; } });
}, 'shopping food');
T('project', 'Project plan', 'Planning', (k) => { k.field('Project', 40, 50, k.w - 40); k.table([40, 360, 500, 640, k.w - 40], ['Task', 'Owner', 'Due', 'Status'], 112, 36); }, 'work');
T('gantt', 'Gantt chart', 'Planning', (k) => {
  k.field('Project', 40, 50, k.w - 40); const x0 = 230, top = 100, cw = (k.w - 40 - x0) / 12, rh = 32;
  for (let i = 0; i < 12; i++) k.text('W' + (i + 1), x0 + (i + 0.5) * cw, top - 8, 10, 600, k.label, 'center');
  k.stroke(); for (let y = top; y <= k.h - 40; y += rh) k.hl(y, 40, k.w - 40); for (let i = 0; i <= 12; i++) k.vl(x0 + i * cw, top, k.h - 40); k.stroke(k.strong); k.vl(x0, top, k.h - 40); k.vl(40, top, k.h - 40);
}, 'timeline schedule');
for (const n of [3, 4]) T('kanban-' + n, `Kanban board (${n})`, 'Planning', (k) => { const labels = n === 3 ? ['To do', 'Doing', 'Done'] : ['Backlog', 'To do', 'Doing', 'Done'], cw = (k.w - 80) / n; labels.forEach((t, i) => k.box(40 + i * cw, 60, cw - 10, k.h - 100, t)); }, 'board tasks agile');
T('budget', 'Budget', 'Planning', (k) => { k.header('Budget', 50); k.table([40, 420, 580, k.w - 40], ['Item', 'Planned', 'Actual'], 108, 32, k.h - 80); k.text('TOTAL', 48, k.h - 56, 12); }, 'money finance');
T('expenses', 'Expense tracker', 'Planning', (k) => { k.header('Expenses', 50); k.table([40, 150, 470, 620, k.w - 40], ['Date', 'Description', 'Category', 'Amount'], 100, 32); }, 'money finance');
T('bills', 'Bill tracker', 'Planning', (k) => { k.header('Bills', 50); k.table([40, 330, 450, 580, k.w - 40], ['Bill', 'Due', 'Amount', 'Paid'], 100, 34); }, 'money finance');
T('goals', 'Goal setting', 'Planning', (k) => { k.header('Goals'); [['Goal', 80], ['Why it matters', 220], ['Steps', 380], ['Obstacles & solutions', 640], ['Deadline / reward', 840]].forEach(([t, y], i, a) => { const hh = (a[i + 1] ? a[i + 1][1] : k.h - 30) - y - 12; k.box(40, y, k.w - 80, hh, t); }); });
T('travel', 'Travel itinerary', 'Planning', (k) => { k.header('Trip'); k.field('Destination', 40, 90, k.w / 2); k.field('Dates', k.w / 2 + 20, 90, k.w - 40); k.table([40, 150, 260, k.w - 40], ['Day', 'Time', 'Plan'], 140, 36); }, 'vacation');
T('packing', 'Packing list', 'Planning', (k, ctx) => { k.header('Packing list'); const secs = ['Clothes', 'Toiletries', 'Electronics', 'Documents', 'Other', 'Last minute'], cw = (k.w - 100) / 2, rh = (k.h - 100) / 3; secs.forEach((s, i) => { const x = 40 + (i % 2) * (cw + 20), y = 80 + Math.floor(i / 2) * rh; k.box(x, y, cw, rh - 12, s); for (let yy = y + 50; yy < y + rh - 20; yy += 28) { ctx.strokeStyle = k.strong; ctx.strokeRect(x + 12.5, yy - 14.5, 12, 12); k.stroke(); k.hl(yy, x + 34, x + cw - 10); } }); }, 'travel checklist');
T('contacts', 'Contacts', 'Planning', (k) => k.table([40, 290, 480, k.w - 40], ['Name', 'Phone', 'Email'], 80, 40), 'address book');
T('recipe', 'Recipe', 'Planning', (k) => { k.field('Recipe', 40, 50, k.w - 40); k.field('Serves', 40, 84, 260); k.field('Time', 290, 84, k.w - 40); k.box(40, 110, 260, k.h - 150, 'Ingredients'); k.box(320, 110, k.w - 360, k.h - 150, 'Steps'); k.stroke(); k.lines(160, 28, 52, 290, k.h - 50); k.lines(160, 28, 332, k.w - 52, k.h - 50); }, 'cooking food');
T('gratitude', 'Gratitude journal', 'Planning', (k) => { k.field('Date', 40, 56, 320); ['Three things I am grateful for', 'Today was great because…', 'Tomorrow I will…'].forEach((t, i) => { const y = 90 + i * ((k.h - 120) / 3); k.text(t, 40, y + 20, 14, 600); k.stroke(); k.lines(y + 50, 30, 40, k.w - 40, y + (k.h - 120) / 3 - 10); }); }, 'journal wellness');

// ============================================================ Creative
for (const [id, cols, rows, ratio] of [['storyboard', 2, 3, 0.7], ['storyboard-4', 2, 2, 0.75], ['storyboard-8', 2, 4, 0.66], ['storyboard-9', 3, 3, 0.66], ['storyboard-wide', 1, 4, 0.72]]) {
  T(id, `Storyboard (${cols * rows} frames)`, 'Creative', (k) => {
    const cw = (k.w - 60 - 20 * (cols - 1)) / cols, ch = (k.h - 60 - 20 * (rows - 1)) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = 30 + c * (cw + 20), y = 30 + r * (ch + 20); k.stroke(k.strong); k.rect(x, y, cw, ch * ratio, 4); k.stroke(); k.lines(y + ch * ratio + 22, 22, x, x + cw, y + ch); }
  }, 'film video animation');
}
const comics = {
  comic: [[0, 0, 1, 1 / 3], [0, 1 / 3, 0.4, 1 / 3], [0.4, 1 / 3, 0.6, 1 / 3], [0, 2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 1 / 3, 1 / 3], [2 / 3, 2 / 3, 1 / 3, 1 / 3]],
  'comic-4': [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  'comic-strip': [[0, 0, 1 / 3, 0.25], [1 / 3, 0, 1 / 3, 0.25], [2 / 3, 0, 1 / 3, 0.25], [0, 0.25, 1 / 3, 0.25], [1 / 3, 0.25, 1 / 3, 0.25], [2 / 3, 0.25, 1 / 3, 0.25], [0, 0.5, 1 / 3, 0.25], [1 / 3, 0.5, 1 / 3, 0.25], [2 / 3, 0.5, 1 / 3, 0.25], [0, 0.75, 1 / 3, 0.25], [1 / 3, 0.75, 1 / 3, 0.25], [2 / 3, 0.75, 1 / 3, 0.25]],
  'comic-manga': [[0, 0, 0.6, 0.3], [0.6, 0, 0.4, 0.3], [0, 0.3, 1, 0.25], [0, 0.55, 0.35, 0.45], [0.35, 0.55, 0.65, 0.2], [0.35, 0.75, 0.65, 0.25]],
  'comic-splash': [[0, 0, 1, 0.65], [0, 0.65, 0.5, 0.35], [0.5, 0.65, 0.5, 0.35]],
  'comic-grid9': Array.from({ length: 9 }, (_, i) => [(i % 3) / 3, Math.floor(i / 3) / 3, 1 / 3, 1 / 3]),
};
for (const [id, panels] of Object.entries(comics)) {
  T(id, { comic: 'Comic page', 'comic-4': 'Comic, 4 panels', 'comic-strip': 'Comic strips', 'comic-manga': 'Manga layout', 'comic-splash': 'Comic, splash panel', 'comic-grid9': 'Comic, 9 panels' }[id], 'Creative', (k) => {
    const m = 30, g = 12, W = k.w - 2 * m, H = k.h - 2 * m; k.stroke(k.strong, 2);
    for (const [x, y, w, h] of panels) k.rect(m + x * W + g / 2, m + y * H + g / 2, w * W - g, h * H - g);
  }, 'comic manga panels');
}
for (const [id, name, gap, n] of [['music', 'Music staff', 90, 0], ['music-12', 'Music staff (12)', 80, 12], ['music-8', 'Music staff (8), wide', 118, 8]]) {
  T(id, name, 'Creative', (k) => { k.stroke(); let c = 0; for (let y = 90; y + 40 < k.h - 40 && (!n || c < n); y += gap, c++) for (let i = 0; i < 5; i++) k.hl(y + i * 10, 48, k.w - 48); }, 'music notation sheet');
}
T('grand-staff', 'Piano grand staff', 'Creative', (k) => { k.stroke(); for (let y = 80; y + 110 < k.h - 30; y += 150) { for (let i = 0; i < 5; i++) { k.hl(y + i * 10, 48, k.w - 48); k.hl(y + 70 + i * 10, 48, k.w - 48); } k.stroke(k.strong, 2); k.vl(48, y, y + 110); k.stroke(); } }, 'music');
T('guitar', 'Guitar tab', 'Creative', (k) => { k.stroke(); for (let y = 90; y + 60 < k.h - 40; y += 120) { for (let i = 0; i < 6; i++) k.hl(y + i * 12, 48, k.w - 48); k.text('T', 34, y + 14, 12, 700); k.text('A', 34, y + 36, 12, 700); k.text('B', 34, y + 58, 12, 700); } }, 'music tablature');
T('guitar-chords', 'Guitar chord charts', 'Creative', (k) => {
  const cw = (k.w - 80) / 4, rh = (k.h - 80) / 5;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) { const x = 40 + c * cw + cw / 2 - 50, y = 60 + r * rh; k.stroke(); for (let s = 0; s < 6; s++) k.vl(x + s * 20, y, y + 100); for (let f = 0; f <= 5; f++) { k.stroke(f ? k.line : k.strong, f ? 1 : 3); k.hl(y + f * 20, x, x + 100); } k.stroke(); k.hl(y - 26, x, x + 100); }
}, 'music');
T('drum-tab', 'Drum tab', 'Creative', (k) => { k.stroke(); for (let y = 90; y + 60 < k.h - 40; y += 110) { for (let i = 0; i < 6; i++) k.hl(y + i * 12, 70, k.w - 48); ['CC', 'HH', 'SD', 'T1', 'FT', 'BD'].forEach((l, i) => k.text(l, 40, y + i * 12 + 4, 9, 700)); } }, 'music');
for (const [id, name, sp] of [['handwriting', 'Handwriting practice', 72], ['handwriting-large', 'Handwriting practice, large', 110], ['handwriting-small', 'Handwriting practice, small', 50]]) {
  T(id, name, 'Creative', (k, ctx) => { for (let y = 100; y + sp * 0.67 < k.h - 30; y += sp) { k.stroke(k.strong); k.hl(y, 40, k.w - 40); k.hl(y + sp * 0.67, 40, k.w - 40); ctx.setLineDash([6, 6]); k.stroke(k.line); k.hl(y + sp * 0.33, 40, k.w - 40); ctx.setLineDash([]); } }, 'kids school letters');
}
for (const [id, name, ang] of [['calligraphy', 'Calligraphy', 35], ['calligraphy-55', 'Calligraphy (55°)', 55], ['lettering', 'Hand lettering grid', 0]]) {
  T(id, name, 'Creative', (k, ctx) => {
    k.stroke(); for (let y = 80; y < k.h - 30; y += 60) { k.hl(y, 30, k.w - 30); k.hl(y + 30, 30, k.w - 30); }
    ctx.save(); ctx.beginPath(); ctx.rect(30, 0, k.w - 60, k.h); ctx.clip(); k.stroke(k.line);
    if (ang) { const dx = k.h / Math.tan((ang * Math.PI) / 180); for (let x = -dx; x < k.w; x += 40) k.seg(x, k.h, x + dx, 0); } else for (let x = 30; x < k.w; x += 30) k.vl(x);
    ctx.restore();
  }, 'lettering brush');
}
T('sketch', 'Sketch frame', 'Creative', (k) => { k.stroke(k.strong, 1.5); k.rect(36, 36, k.w - 72, k.h - 120, 6); k.field('Title', 40, k.h - 50, k.w - 260); k.field('Date', k.w - 220, k.h - 50, k.w - 40); }, 'drawing art');
T('sketch-4', 'Sketch frames (4)', 'Creative', (k) => { k.stroke(k.strong, 1.5); const cw = (k.w - 90) / 2, ch = (k.h - 90) / 2; for (let i = 0; i < 4; i++) k.rect(30 + (i % 2) * (cw + 30), 30 + Math.floor(i / 2) * (ch + 30), cw, ch, 6); }, 'drawing art');
T('journal', 'Journal', 'Creative', (k) => { k.field('Date', 40, 56, 320); k.text('Today I am grateful for…', 40, 110, 13, 500); k.stroke(); k.lines(136, 30, 40, k.w - 40, 260); k.text('Thoughts', 40, 300, 13, 500); k.lines(326, 30, 40, k.w - 40, k.h - 30); }, 'diary');
T('journal-photo', 'Photo journal', 'Creative', (k) => { k.field('Date', 40, 56, 320); k.box(40, 80, k.w - 80, 380, 'Photo / sketch'); k.stroke(); k.lines(500, 30, 40, k.w - 40); }, 'diary scrapbook');
T('bullet-journal', 'Bullet journal', 'Creative', (k) => { k.dots(20, 1, 0, 70); k.field('Date', 40, 46, 300); }, 'bujo dots');
T('poetry', 'Poetry', 'Creative', (k) => { k.field('Title', k.w / 2 - 200, 70, k.w / 2 + 200); k.stroke(); k.lines(140, 34, 120, k.w - 120, k.h - 60); }, 'writing');
T('screenplay', 'Screenplay', 'Creative', (k) => { k.stroke(k.faint || k.line); k.vl(150, 40, k.h - 40); k.vl(300, 40, k.h - 40); k.vl(k.w - 150, 40, k.h - 40); k.stroke(); k.lines(80, 24, 120, k.w - 100); }, 'film writing');
T('zine', 'Zine (8 pages)', 'Creative', (k, ctx) => { ctx.setLineDash([5, 5]); k.stroke(k.strong); for (let i = 1; i < 4; i++) k.hl((k.h * i) / 4); k.vl(k.w / 2); ctx.setLineDash([]); }, 'fold booklet');

// ============================================================ Sports (line art for coaches)
T('basketball-full', 'Basketball court', 'Sports', (k) => {
  const m = 60, W = k.w - 2 * m, H = k.h - 2 * m, cx = k.w / 2, cy = k.h / 2; k.stroke(k.strong, 2); k.rect(m, m, W, H); k.hl(cy, m, m + W); k.circle(cx, cy, 60);
  for (const s of [1, -1]) { const by = s > 0 ? m : m + H, ky = by + s * 190; k.rect(cx - 80, Math.min(by, ky), 160, 190); k.circle(cx, ky, 60); k.arc(cx, by + s * 50, 300, s > 0 ? 0.25 : Math.PI + 0.25, s > 0 ? Math.PI - 0.25 : 2 * Math.PI - 0.25); k.circle(cx, by + s * 50, 10); }
}, 'coach play');
T('basketball-half', 'Basketball half court', 'Sports', (k) => { const m = 60, W = k.w - 2 * m, cx = k.w / 2; k.stroke(k.strong, 2); k.rect(m, m, W, k.h - 2 * m); k.rect(cx - 90, m, 180, 260); k.circle(cx, m + 260, 70); k.arc(cx, m + 60, 330, 0.18, Math.PI - 0.18); k.circle(cx, m + 60, 12); k.arc(cx, k.h - m, 70, Math.PI, 2 * Math.PI); }, 'coach play');
T('soccer', 'Soccer field', 'Sports', (k) => { const m = 50, W = k.w - 2 * m, H = k.h - 2 * m, cx = k.w / 2, cy = k.h / 2; k.stroke(k.strong, 2); k.rect(m, m, W, H); k.hl(cy, m, m + W); k.circle(cx, cy, 80); for (const y of [m, m + H]) { const s = y === m ? 1 : -1; k.rect(cx - 200, Math.min(y, y + s * 160), 400, 160); k.rect(cx - 90, Math.min(y, y + s * 55), 180, 55); k.dot(cx, y + s * 110, 3, k.strong); } }, 'football coach');
T('football', 'American football field', 'Sports', (k) => { const m = 40, W = k.w - 2 * m, H = k.h - 2 * m; k.stroke(k.strong, 2); k.rect(m, m, W, H); const step = H / 12; for (let i = 1; i < 12; i++) { k.stroke(i === 1 || i === 11 ? k.strong : k.line, i === 1 || i === 11 ? 2 : 1); k.hl(m + i * step, m, m + W); if (i > 1 && i < 11) k.text(String((i <= 6 ? i - 1 : 11 - i) * 10), m + 30, m + i * step - 4, 12); } }, 'coach play');
T('baseball', 'Baseball diamond', 'Sports', (k, ctx) => { const cx = k.w / 2, hy = k.h - 120, d = 260; k.stroke(k.strong, 2); ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(cx + d, hy - d); ctx.lineTo(cx, hy - 2 * d); ctx.lineTo(cx - d, hy - d); ctx.closePath(); ctx.stroke(); k.circle(cx, hy - d, 24); k.seg(cx, hy, cx - 380, hy - 380); k.seg(cx, hy, cx + 380, hy - 380); k.arc(cx, hy, 540, -Math.PI * 0.75, -Math.PI * 0.25); }, 'softball coach');
T('hockey', 'Hockey rink', 'Sports', (k) => { const m = 60, W = k.w - 2 * m, H = k.h - 2 * m, cx = k.w / 2, cy = k.h / 2; k.stroke(k.strong, 2); k.rect(m, m, W, H, 120); k.hl(cy, m, m + W); k.hl(m + H * 0.32, m, m + W); k.hl(m + H * 0.68, m, m + W); k.circle(cx, cy, 60); for (const y of [m + H * 0.18, m + H * 0.82]) for (const x of [cx - 160, cx + 160]) k.circle(x, y, 60); }, 'ice coach');
T('tennis', 'Tennis court', 'Sports', (k) => { const m = 80, W = k.w - 2 * m, H = k.h - 2 * m, cx = k.w / 2, cy = k.h / 2, sw = W * 0.125; k.stroke(k.strong, 2); k.rect(m, m, W, H); k.vl(m + sw, m, m + H); k.vl(m + W - sw, m, m + H); k.stroke(k.strong, 3); k.hl(cy, m - 20, m + W + 20); k.stroke(k.strong, 2); k.hl(cy - H * 0.27, m + sw, m + W - sw); k.hl(cy + H * 0.27, m + sw, m + W - sw); k.vl(cx, cy - H * 0.27, cy + H * 0.27); }, 'coach');
T('volleyball', 'Volleyball court', 'Sports', (k) => { const m = 100, W = k.w - 2 * m, H = k.h - 2 * m, cy = k.h / 2; k.stroke(k.strong, 2); k.rect(m, m, W, H); k.stroke(k.strong, 3); k.hl(cy, m - 20, m + W + 20); k.stroke(k.strong, 2); k.hl(cy - H / 6, m, m + W); k.hl(cy + H / 6, m, m + W); }, 'coach');

// ============================================================ Business & Design
T('swot', 'SWOT analysis', 'Business', (k) => { const cx = k.w / 2, cy = k.h / 2 + 20; k.header('SWOT'); k.box(40, 80, cx - 50, cy - 90, 'Strengths'); k.box(cx + 10, 80, k.w - cx - 50, cy - 90, 'Weaknesses'); k.box(40, cy + 10, cx - 50, k.h - cy - 50, 'Opportunities'); k.box(cx + 10, cy + 10, k.w - cx - 50, k.h - cy - 50, 'Threats'); }, 'strategy');
T('bmc', 'Business model canvas', 'Business', (k) => {
  const W = k.w - 80, x = 40, y = 60, H = k.h - 220, c = W / 5; k.header('Business model canvas', 44);
  k.box(x, y, c, H, 'Key partners'); k.box(x + c, y, c, H / 2, 'Key activities'); k.box(x + c, y + H / 2, c, H / 2, 'Key resources'); k.box(x + 2 * c, y, c, H, 'Value proposition');
  k.box(x + 3 * c, y, c, H / 2, 'Relationships'); k.box(x + 3 * c, y + H / 2, c, H / 2, 'Channels'); k.box(x + 4 * c, y, c, H, 'Customer segments');
  k.box(x, y + H, W / 2, 140, 'Cost structure'); k.box(x + W / 2, y + H, W / 2, 140, 'Revenue streams');
}, 'startup strategy');
T('lean', 'Lean canvas', 'Business', (k) => {
  const W = k.w - 80, x = 40, y = 60, H = k.h - 220, c = W / 5; k.header('Lean canvas', 44);
  k.box(x, y, c, H, 'Problem'); k.box(x + c, y, c, H / 2, 'Solution'); k.box(x + c, y + H / 2, c, H / 2, 'Key metrics'); k.box(x + 2 * c, y, c, H, 'Unique value');
  k.box(x + 3 * c, y, c, H / 2, 'Unfair advantage'); k.box(x + 3 * c, y + H / 2, c, H / 2, 'Channels'); k.box(x + 4 * c, y, c, H, 'Customers');
  k.box(x, y + H, W / 2, 140, 'Costs'); k.box(x + W / 2, y + H, W / 2, 140, 'Revenue');
}, 'startup strategy');
T('persona', 'User persona', 'Business', (k) => { k.header('Persona'); k.stroke(k.strong); k.circle(130, 170, 70); k.field('Name', 230, 130, k.w - 40); k.field('Age / role', 230, 170, k.w - 40); k.field('Location', 230, 210, k.w - 40); [['Goals', 280], ['Frustrations', 500], ['Behaviors', 720]].forEach(([t, yy]) => k.box(40, yy, k.w - 80, 200, t)); }, 'ux design');
T('retro', 'Retrospective', 'Business', (k) => { k.header('Retro'); const cw = (k.w - 80) / 3; ['Start', 'Stop', 'Continue'].forEach((t, i) => k.box(40 + i * cw, 80, cw - 10, k.h - 120, t)); }, 'agile team');
T('brainstorm', 'Brainstorm', 'Business', (k) => { k.header('Ideas'); k.stroke(k.strong); for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) k.rect(40 + c * 250, 80 + r * 190, 230, 170, 12); }, 'sticky notes ideas');
T('org-chart', 'Org chart', 'Business', (k) => { k.stroke(k.strong); const box = (x, y) => k.rect(x - 70, y, 140, 60, 8); box(k.w / 2, 60); k.vl(k.w / 2, 120, 170); k.hl(170, k.w / 6, (5 * k.w) / 6); for (let i = 0; i < 3; i++) { const x = k.w / 6 + (i * 2 * k.w) / 6; k.vl(x, 170, 200); box(x, 200); k.vl(x, 260, 300); for (let j = 0; j < 3; j++) box(x, 300 + j * 100); } }, 'team diagram');
T('flowchart', 'Flowchart grid', 'Business', (k) => { k.dots(24, 1); k.stroke(k.strong); k.rect(k.w / 2 - 80, 60, 160, 56, 28); }, 'diagram process');
T('phone-wireframe', 'Phone wireframes', 'Business', (k) => { k.stroke(k.strong, 2); const pw = (k.w - 120) / 3, ph = pw * 2.05; for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { const x = 40 + c * (pw + 20), y = 50 + r * (ph + 50); if (y + ph < k.h) { k.rect(x, y, pw, ph, 22); k.stroke(k.line); k.hl(y + 40, x, x + pw); k.stroke(k.strong, 2); } } }, 'ux design app mockup');
T('tablet-wireframe', 'Tablet wireframe', 'Business', (k) => { k.stroke(k.strong, 2); k.rect(50, 80, k.w - 100, (k.w - 100) * 0.75, 24); k.stroke(); k.lines(80 + (k.w - 100) * 0.75 + 50, 30, 50, k.w - 50); }, 'ux design ipad mockup');
T('browser-wireframe', 'Website wireframe', 'Business', (k) => { for (const y of [50, 550]) { k.stroke(k.strong, 2); k.rect(40, y, k.w - 80, 440, 10); k.hl(y + 34, 40, k.w - 40); for (let i = 0; i < 3; i++) k.dot(62 + i * 16, y + 17, 5, k.strong); } }, 'ux design web mockup');
T('invoice', 'Invoice', 'Business', (k) => { k.header('Invoice'); k.field('Bill to', 40, 100, k.w / 2); k.field('Invoice #', k.w / 2 + 20, 100, k.w - 40); k.field('Date', k.w / 2 + 20, 134, k.w - 40); k.table([40, 470, 560, 670, k.w - 40], ['Description', 'Qty', 'Rate', 'Amount'], 190, 34, k.h - 140); k.field('Total', k.w - 280, k.h - 100, k.w - 40); }, 'billing');
T('call-log', 'Call log', 'Business', (k) => k.table([40, 140, 330, 470, k.w - 40], ['Date', 'Name', 'Phone', 'Notes'], 80, 40), 'phone');

// ============================================================ lookup
export const TEMPLATE_MAP = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
export const TEMPLATE_CATS = [...new Set(TEMPLATES.map((t) => t.cat))];

// thick > 1 draws heavier lines, for small previews.
export function drawTemplate(ctx, type, w, h, dark, lineColor, thick = 1) {
  const t = TEMPLATE_MAP[type] || TEMPLATE_MAP.lined;
  ctx.save();
  ctx.lineWidth = thick;
  try { t.draw(kit(ctx, w, h, dark, lineColor, thick), ctx); } catch (e) { console.warn('template', type, e); }
  ctx.restore();
}
