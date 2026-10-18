// Turns a rough hand-drawn stroke into a clean shape: line, circle/ellipse, triangle,
// rectangle or polygon. Input/output: flat [x, y, pressure, ...] arrays.

function pathLength(p) {
  let L = 0;
  for (let i = 3; i < p.length; i += 3) L += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]);
  return L;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Ramer–Douglas–Peucker on an array of [x, y] points.
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let max = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}

const flat = (pts) => pts.flatMap(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, 0.5]);

function snapAngle(x0, y0, x1, y1) {
  const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.PI / 4, snapped = Math.round(a / step) * step;
  if (Math.abs(a - snapped) < 0.09) return [x0 + Math.cos(snapped) * L, y0 + Math.sin(snapped) * L];
  return [x1, y1];
}

export function recognize(p, lineOnly = false) {
  const n = p.length / 3;
  if (n < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  const bw = x1 - x0, bh = y1 - y0, D = Math.hypot(bw, bh);
  if (D < 14) return null;
  const L = pathLength(p);
  const sx = p[0], sy = p[1], ex = p[p.length - 3], ey = p[p.length - 2];
  const gap = Math.hypot(ex - sx, ey - sy);

  // Straight line
  if (gap / L > 0.9) {
    const [tx, ty] = snapAngle(sx, sy, ex, ey);
    return flat([[sx, sy], [tx, ty]]);
  }
  if (lineOnly) return null;

  const closed = gap < Math.max(22, 0.22 * D);
  const pts = [];
  for (let i = 0; i < p.length; i += 3) pts.push([p[i], p[i + 1]]);

  if (closed) {
    // Ellipse / circle: how well do points fit the bounding ellipse?
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = bw / 2 || 1, ry = bh / 2 || 1;
    let sum = 0, sum2 = 0;
    for (const [x, y] of pts) {
      const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
      sum += r; sum2 += r * r;
    }
    const mean = sum / pts.length, sd = Math.sqrt(Math.max(0, sum2 / pts.length - mean * mean));
    const simp = rdp(pts.concat([pts[0]]), D * 0.07);
    const corners = simp.length - 1;
    if (sd < 0.085 && corners > 4) {
      let RX = rx, RY = ry;
      if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.14) RX = RY = (rx + ry) / 2;
      const out = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        out.push([cx + Math.cos(a) * RX, cy + Math.sin(a) * RY]);
      }
      return flat(out);
    }
    let verts = simp.slice(0, -1);
    // merge vertices that are very close together
    verts = verts.filter((v, i) => i === 0 || Math.hypot(v[0] - verts[i - 1][0], v[1] - verts[i - 1][1]) > D * 0.08);
    if (verts.length === 3) return flat([...verts, verts[0]]);
    if (verts.length === 4) {
      // Rectangle if all angles are near 90°
      let right = true;
      for (let i = 0; i < 4; i++) {
        const a = verts[i], b = verts[(i + 1) % 4], c = verts[(i + 2) % 4];
        const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
        const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
        if (Math.abs(cos) > 0.3) right = false;
      }
      const e = verts[1][0] - verts[0][0], f = verts[1][1] - verts[0][1];
      const axis = Math.abs(Math.atan2(f, e)) % (Math.PI / 2);
      if (right && (axis < 0.2 || axis > Math.PI / 2 - 0.2)) return flat([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
      return flat([...verts, verts[0]]);
    }
    if (verts.length >= 5 && verts.length <= 8) return flat([...verts, verts[0]]);
    return null;
  }

  // Open shapes: angle / zig-zag / arrow-like polylines
  const simp = rdp(pts, D * 0.06);
  if (simp.length >= 3 && simp.length <= 5) return flat(simp);
  return null;
}
