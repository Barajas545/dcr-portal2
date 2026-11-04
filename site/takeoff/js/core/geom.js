// geom.js — the measurement math, ported point for point from the desktop app.
//
// Every function here works in PAGE SPACE: pixels of the rendered sheet at the
// project's import DPI (150 by default). Screen space is the canvas after pan
// and zoom, and the two are never mixed — a value that crosses between them
// goes through the viewport's toPage/toScreen, never through this file.

export const DEG = Math.PI / 180;

export function pxDist(p1, p2) {
  return Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
}

/** Total run of an open path, in page pixels. */
export function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += pxDist(pts[i - 1], pts[i]);
  return d;
}

/** Run of a closed path — the open length plus the closing leg. */
export function perimeter(pts) {
  if (pts.length < 2) return 0;
  return pathLength(pts) + pxDist(pts[pts.length - 1], pts[0]);
}

/**
 * Signed shoelace area, in square page pixels.
 *
 * The sign carries the winding direction, which callers use to tell a hole
 * from an outline. Take Math.abs when you want a quantity.
 */
export function signedArea(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function polygonArea(pts) {
  return Math.abs(signedArea(pts));
}

export function centroid(pts) {
  if (!pts.length) return [0, 0];
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/**
 * Area centroid — where a label belongs on a filled shape.
 * Falls back to the vertex mean on a degenerate (zero-area) outline.
 */
export function areaCentroid(pts) {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-9) return centroid(pts);
  let cx = 0, cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function boundingBox(pts) {
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Ray-casting point-in-polygon, in page space. */
export function pointInPolygon(x, y, polygon) {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  let [px, py] = polygon[n - 1];
  for (const [qx, qy] of polygon) {
    if ((qy > y) !== (py > y) &&
        x < ((px - qx) * (y - qy)) / (py - qy + 1e-12) + qx) {
      inside = !inside;
    }
    px = qx; py = qy;
  }
  return inside;
}

/** Euclidean distance from a point to a segment. */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Shortest distance from a point to any leg of a path. */
export function distToPath(px, py, pts, closed = false) {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]);
  let best = Infinity;
  const n = pts.length;
  const legs = closed ? n : n - 1;
  for (let i = 0; i < legs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    best = Math.min(best, distToSegment(px, py, a[0], a[1], b[0], b[1]));
  }
  return best;
}

/** Lock the cursor to the nearest multiple of stepDeg measured from lastPt. */
export function constrainToStep(lastPt, cursorPt, stepDeg = 45) {
  const dx = cursorPt[0] - lastPt[0];
  const dy = cursorPt[1] - lastPt[1];
  if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return cursorPt;
  const step = stepDeg * DEG;
  const dist = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return [lastPt[0] + dist * Math.cos(ang), lastPt[1] + dist * Math.sin(ang)];
}

/** Snap to the nearest 0/45/90/135/180° from lastPt. */
export function constrainTo45(lastPt, cursorPt) {
  return constrainToStep(lastPt, cursorPt, 45);
}

/**
 * True when a closed outline crosses itself.
 *
 * A bow-tie reads as a small or even zero area under the shoelace formula, so
 * an outline that crosses must be flagged and never quietly totalled — the
 * number it produces is not the area anyone drew.
 */
export function selfIntersects(pts) {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip legs that share a vertex — touching at an endpoint is not a cross.
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function orient(a, b, c) {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : -1;
}

function onSegment(a, b, p) {
  return Math.min(a[0], b[0]) - 1e-9 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
         Math.min(a[1], b[1]) - 1e-9 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 1e-9;
}

export function segmentsCross(a1, a2, b1, b2) {
  const o1 = orient(a1, a2, b1), o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1), o4 = orient(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  if (o4 === 0 && onSegment(b1, b2, a2)) return true;
  return false;
}

// ── roof pitch ────────────────────────────────────────────────────────────
//
// Pitch is a ratio, so it needs no scale: two points along a slope in an
// elevation give it directly. rise/run is read as "6:12" — inches of rise per
// twelve inches of run.

/** Rise-over-run and angle for a line between two page-space points. */
export function pitchFromPoints(p1, p2) {
  const dx = Math.abs(p2[0] - p1[0]);
  const dy = Math.abs(p2[1] - p1[1]);
  const riseOver12 = dx < 1e-6 ? Infinity : (dy / dx) * 12;
  const angleDeg = Math.atan2(dy, dx || 1e-9) / DEG;
  return { rise: dy, run: dx, riseOver12, angleDeg };
}

/** "6:12" for a rise-per-twelve figure, rounded the way a roofer reads it. */
export function formatPitch(riseOver12, precision = 0) {
  if (!Number.isFinite(riseOver12)) return 'vertical';
  const r = precision > 0
    ? riseOver12.toFixed(precision)
    : String(Math.round(riseOver12 * 4) / 4);
  return `${r}:12`;
}

/**
 * The factor a flat (plan) area is multiplied by to get true sloped area.
 *
 * A roof measured on a plan view is the horizontal projection of the surface.
 * The real surface is longer up the slope by sqrt(run² + rise²) / run, which
 * for a pitch of r per 12 is sqrt(144 + r²) / 12.
 */
export function slopeFactor(riseOver12) {
  const r = Number(riseOver12) || 0;
  return Math.sqrt(144 + r * r) / 12;
}

/** Degrees of slope for a rise-per-twelve figure. */
export function slopeAngle(riseOver12) {
  return Math.atan2(Number(riseOver12) || 0, 12) / DEG;
}

// ── generated geometry ────────────────────────────────────────────────────

/**
 * Points spaced along a path, for the Array tool.
 *
 * THE SPACING RESETS AT EVERY CORNER, and every corner and both ends always get
 * a point. That is not an approximation of even spacing — it is what a framer
 * does. Studs restart at a corner; a run that carried its remainder around the
 * bend would put one half an inch from the corner post.
 *
 * This is the ONLY implementation. The renderer draws these exact points and
 * the estimate counts them, so a second one that spaced differently would make
 * the drawn dots and the billed quantity disagree.
 */
export function pointsAlongPath(pts, spacingPx) {
  if (pts.length < 2 || !(spacingPx > 1e-6)) return pts.map(p => p.slice());
  const out = [];
  const push = p => {
    // Never two dots on the same spot: a doubled vertex is one corner.
    const last = out[out.length - 1];
    if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.5) return;
    out.push(p);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const segLen = pxDist(a, b);
    if (segLen < 1e-6) {
      // A zero-length segment is still a corner, and a corner is still a dot.
      // Skipping it lost a count, and when it was the FIRST segment the run's
      // start point was never emitted at all.
      push([b[0], b[1]]);
      continue;
    }
    const ux = (b[0] - a[0]) / segLen, uy = (b[1] - a[1]) / segLen;
    // The first segment starts at 0; later ones skip the corner already emitted.
    let d = i === 0 ? 0 : spacingPx;
    while (d < segLen - 1e-9) {
      push([a[0] + ux * d, a[1] + uy * d]);
      d += spacingPx;
    }
    push([b[0], b[1]]);   // the corner or endpoint always gets one
  }
  if (!out.length && pts.length) push([pts[0][0], pts[0][1]]);
  return out;
}

/**
 * The grid a traced polygon carries: how many cells across and down its own
 * rotated bounding box, and where each cell sits.
 *
 * The polygon is the boundary the estimator drew, and `angleDeg` turns the
 * grid inside it. Everything is measured in the grid's own frame, so a grid
 * laid at 30° counts the same cells it would at 0°.
 *
 * @returns {{cols:number, rows:number, cells:Array, origin:[number,number]}}
 *          `cells` are 4-point quads in page space, clipped to the polygon.
 */
export function gridForPolygon(polygon, cellW, cellH, angleDeg = 0, {
  anchor = null, wholeOnly = false, cap = 60000,
} = {}) {
  const out = { cols: 1, rows: 1, cells: [], origin: anchor || polygon[0] || [0, 0] };
  if (!(cellW > 0) || !(cellH > 0) || polygon.length < 2) return out;

  const a = angleDeg * DEG;
  const ca = Math.cos(a), sa = Math.sin(a);
  const us = polygon.map(([x, y]) => x * ca + y * sa);
  const vs = polygon.map(([x, y]) => -x * sa + y * ca);
  const uMin = Math.min(...us), uMax = Math.max(...us);
  const vMin = Math.min(...vs), vMax = Math.max(...vs);

  out.cols = Math.max(1, Math.ceil((uMax - uMin) / cellW));
  out.rows = Math.max(1, Math.ceil((vMax - vMin) / cellH));
  if (out.cols * out.rows > cap) return out;   // still reports cols/rows

  // The pattern starts at the ANCHOR, not at the bounding-box corner. A grid
  // the estimator aligned to a joist run would otherwise land half a cell off.
  const anchorPt = anchor || polygon[0] || [0, 0];
  const u0 = anchorPt[0] * ca + anchorPt[1] * sa;
  const v0 = -anchorPt[0] * sa + anchorPt[1] * ca;
  const uStart = Math.floor((uMin - u0) / cellW) * cellW + u0;
  const vStart = Math.floor((vMin - v0) / cellH) * cellH + v0;
  out.cols = Math.max(1, Math.ceil((uMax - uStart) / cellW));
  out.rows = Math.max(1, Math.ceil((vMax - vStart) / cellH));
  if (out.cols * out.rows > cap) return out;

  const toPage = (u, v) => [u * ca - v * sa, u * sa + v * ca];
  for (let j = 0; j < out.rows; j++) {
    for (let i = 0; i < out.cols; i++) {
      const u = uStart + i * cellW;
      const v = vStart + j * cellH;
      const quad = [
        toPage(u, v), toPage(u + cellW, v),
        toPage(u + cellW, v + cellH), toPage(u, v + cellH),
      ];
      if (polygon.length >= 3) {
        const inside = quad.filter(([x, y]) => pointInPolygon(x, y, polygon)).length;
        const centre = toPage(u + cellW / 2, v + cellH / 2);
        const centreIn = pointInPolygon(centre[0], centre[1], polygon);
        if (wholeOnly ? inside < 4 : (inside === 0 && !centreIn)) continue;
      }
      out.cells.push(quad);
    }
  }
  return out;
}

/**
 * Cell centres between two corners. Kept for the live preview, which has a
 * rectangle and not yet a polygon.
 */
export function gridPoints(p0, p1, cellW, cellH, angleDeg = 0) {
  const out = [];
  if (!(cellW > 0) || !(cellH > 0)) return out;
  const a = angleDeg * DEG;
  const ca = Math.cos(a), sa = Math.sin(a);
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const lx = dx * ca + dy * sa;
  const ly = -dx * sa + dy * ca;
  const nx = Math.max(1, Math.round(Math.abs(lx) / cellW));
  const ny = Math.max(1, Math.round(Math.abs(ly) / cellH));
  const sx = lx < 0 ? -1 : 1, sy = ly < 0 ? -1 : 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const ux = sx * (i + 0.5) * cellW;
      const uy = sy * (j + 0.5) * cellH;
      out.push([p0[0] + ux * ca - uy * sa, p0[1] + ux * sa + uy * ca]);
    }
  }
  return out;
}

// ── tiles ─────────────────────────────────────────────────────────────────
//
// Tile counting is a purchasing number, so this is the desktop app's algorithm
// exactly, not an approximation of it.
//
// Three things here are easy to get wrong and expensive to get wrong:
//
//  · A TILE CELL INCLUDES ITS GROUT. The generated quad is (tile + grout) on
//    each side — joint centrelines are what repeat, and laying out bare tile
//    faces drifts by one joint width per course.
//  · A tile that merely TOUCHES the boundary is not a tile anyone buys. Each
//    cell is shrunk toward its own centre before the overlap test, so a floor
//    that is a whole number of tiles wide comes out at exactly that number
//    instead of one course wider.
//  · Above the cap the answer is area / cell — not zero, and not a hang. That
//    is how sheet-mounted mosaic gets estimated anyway.

export const TILE_COUNT_CAP = 60000;

/** Rotation actually applied to the pattern — diagonal is grid turned 45°. */
export function tileEffectiveAngle(pattern, angleDeg) {
  return angleDeg + (pattern === 'diagonal' ? 45 : 0);
}

/**
 * One 4-point cell per tile, in UNROTATED pattern space, covering a window.
 * `tw`/`th` are the tile face and `g` the grout; the emitted cell is the pitch.
 */
function* tilePlacements(pattern, tw, th, g, uMin, vMin, uMax, vMax) {
  const pu = tw + g, pv = th + g;
  if (pu <= 0 || pv <= 0 || uMax - uMin <= 0 || vMax - vMin <= 0) return;

  if (pattern === 'grid' || pattern === 'diagonal' || pattern === 'half' || pattern === 'third') {
    const div = { grid: 0, diagonal: 0, half: 0.5, third: 1 / 3 }[pattern];
    const j0 = Math.floor(vMin / pv) - 1;
    const j1 = Math.ceil(vMax / pv) + 1;
    for (let j = j0; j < j1; j++) {
      // JavaScript's % keeps the sign of the dividend and Python's does not.
      // A course below the origin would shift the wrong way without this.
      const mod = n => ((j % n) + n) % n;
      const off = pattern === 'third' ? mod(3) * pu * div : mod(2) * pu * div;
      const i0 = Math.floor((uMin - off) / pu) - 1;
      const i1 = Math.ceil((uMax - off) / pu) + 1;
      for (let i = i0; i < i1; i++) {
        const u = off + i * pu;
        const v = j * pv;
        if (u < uMax && u + pu > uMin && v < vMax && v + pv > vMin) {
          yield [[u, v], [u + pu, v], [u + pu, v + pv], [u, v + pv]];
        }
      }
    }
    return;
  }

  if (pattern === 'herringbone') {
    // 90° herringbone. Unit cell: a horizontal a×b tile at the origin plus a
    // vertical b×a tile at (a, b−a); lattice T1 = (a+b, b−a), T2 = (b, b).
    // That lattice covers the plane exactly, with no overlaps, |det| = 2ab.
    const a = Math.max(pu, pv), b = Math.min(pu, pv);
    const T1 = [a + b, b - a], T2 = [b, b];
    const det = T1[0] * T2[1] - T1[1] * T2[0];
    if (!det) return;
    const ks = [], ls = [];
    for (const [cu, cv] of [[uMin, vMin], [uMax, vMin], [uMax, vMax], [uMin, vMax]]) {
      ks.push((cu * T2[1] - cv * T2[0]) / det);
      ls.push((T1[0] * cv - T1[1] * cu) / det);
    }
    const k0 = Math.floor(Math.min(...ks)) - 2, k1 = Math.ceil(Math.max(...ks)) + 2;
    const l0 = Math.floor(Math.min(...ls)) - 2, l1 = Math.ceil(Math.max(...ls)) + 2;
    for (let k = k0; k <= k1; k++) {
      for (let l = l0; l <= l1; l++) {
        const ox = k * T1[0] + l * T2[0];
        const oy = k * T1[1] + l * T2[1];
        if (ox < uMax && ox + a > uMin && oy < vMax && oy + b > vMin) {
          yield [[ox, oy], [ox + a, oy], [ox + a, oy + b], [ox, oy + b]];
        }
        const vx = ox + a, vy = oy + b - a;
        if (vx < uMax && vx + b > uMin && vy < vMax && vy + a > vMin) {
          yield [[vx, vy], [vx + b, vy], [vx + b, vy + a], [vx, vy + a]];
        }
      }
    }
    return;
  }

  if (pattern === 'chevron') {
    // 45° chevron: columns of parallelograms with alternating lean. A column
    // width of a/√2 and a vertical pitch of b·√2 make the per-tile area a·b.
    const a = Math.max(pu, pv), b = Math.min(pu, pv);
    const w = a / Math.SQRT2;
    const st = b * Math.SQRT2;
    const c0 = Math.floor(uMin / w) - 1, c1 = Math.ceil(uMax / w) + 1;
    for (let c = c0; c < c1; c++) {
      const x0 = c * w;
      const j0 = Math.floor((vMin - w) / st) - 1;
      const j1 = Math.ceil((vMax + w) / st) + 1;
      for (let j = j0; j < j1; j++) {
        const y0 = j * st;
        const poly = (((c % 2) + 2) % 2 === 0)
          ? [[x0, y0], [x0 + w, y0 - w], [x0 + w, y0 - w + st], [x0, y0 + st]]
          : [[x0, y0 - w], [x0 + w, y0], [x0 + w, y0 + st], [x0, y0 - w + st]];
        const ys = poly.map(p => p[1]);
        if (x0 < uMax && x0 + w > uMin
            && Math.min(...ys) < vMax && Math.max(...ys) > vMin) {
          yield poly;
        }
      }
    }
  }
}

/** Shrink a polygon toward its centroid, so a mere touch is not an overlap. */
export function shrinkPoly(poly, eps = 0.05) {
  const cx = poly.reduce((n, p) => n + p[0], 0) / poly.length;
  const cy = poly.reduce((n, p) => n + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const f = Math.max(0, 1 - eps / d);
    return [cx + dx * f, cy + dy * f];
  });
}

/** True when two simple polygons share area or cross. */
export function polysOverlap(a, b) {
  for (const [x, y] of a) if (pointInPolygon(x, y, b)) return true;
  for (const [x, y] of b) if (pointInPolygon(x, y, a)) return true;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The tile cells whose footprint may matter for a polygon, in PAGE space.
 * Generated over the boundary's rotated bounding box, anchored at `anchor`.
 */
export function tilePlacementsForPolygon(polygon, {
  anchor, tileW, tileH, grout = 0, angleDeg = 0, pattern = 'grid', cap = TILE_COUNT_CAP,
}) {
  if (!(tileW > 0) || !(tileH > 0) || polygon.length < 3) {
    return { polys: [], capped: false };
  }
  const ang = tileEffectiveAngle(pattern, angleDeg) * DEG;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const us = polygon.map(([x, y]) => x * ca + y * sa);
  const vs = polygon.map(([x, y]) => -x * sa + y * ca);
  const u0 = anchor[0] * ca + anchor[1] * sa;
  const v0 = -anchor[0] * sa + anchor[1] * ca;
  const uMin = Math.min(...us) - u0, uMax = Math.max(...us) - u0;
  const vMin = Math.min(...vs) - v0, vMax = Math.max(...vs) - v0;

  // A rough census before generating anything: herringbone and chevron
  // over-scan their windows, so the estimate has to come first.
  const est = ((uMax - uMin) / (tileW + grout) + 2)
            * ((vMax - vMin) / (tileH + grout) + 2);
  if (est > cap) return { polys: [], capped: true };

  const out = [];
  for (const poly of tilePlacements(pattern, tileW, tileH, grout, uMin, vMin, uMax, vMax)) {
    out.push(poly.map(([u, v]) => [
      (u + u0) * ca - (v + v0) * sa,
      (u + u0) * sa + (v + v0) * ca,
    ]));
  }
  return { polys: out, capped: false };
}

/**
 * The tiles a polygon needs. A partial tile counts as a whole one — every
 * boundary cut consumes a tile.
 *
 * @returns {{whole:Array, cut:Array, count:number, capped:boolean}}
 */
export function tileLayout(polygon, opts) {
  const result = { whole: [], cut: [], count: 0, capped: false };
  const { polys, capped } = tilePlacementsForPolygon(polygon, opts);
  if (capped) {
    const cell = (opts.tileW + (opts.grout || 0)) * (opts.tileH + (opts.grout || 0));
    result.capped = true;
    result.count = cell > 0 ? Math.ceil(polygonArea(polygon) / cell) : 0;
    return result;
  }
  const bb = boundingBox(polygon);
  const bx0 = bb.x, bx1 = bb.x + bb.w, by0 = bb.y, by1 = bb.y + bb.h;
  for (const poly of polys) {
    const pxs = poly.map(p => p[0]), pys = poly.map(p => p[1]);
    if (Math.max(...pxs) < bx0 || Math.min(...pxs) > bx1
        || Math.max(...pys) < by0 || Math.min(...pys) > by1) continue;
    if (!polysOverlap(shrinkPoly(poly), polygon)) continue;
    // A cell every one of whose corners is inside needs no cutting.
    const whole = poly.every(([x, y]) => pointInPolygon(x, y, polygon));
    (whole ? result.whole : result.cut).push(poly);
  }
  result.count = result.whole.length + result.cut.length;
  return result;
}

/** Move every point of a path by (dx, dy). */
export function translatePts(pts, dx, dy) {
  return pts.map(([x, y]) => [x + dx, y + dy]);
}

/** Rotate a path about a pivot. */
export function rotatePts(pts, pivot, angleDeg) {
  const a = angleDeg * DEG, ca = Math.cos(a), sa = Math.sin(a);
  return pts.map(([x, y]) => {
    const dx = x - pivot[0], dy = y - pivot[1];
    return [pivot[0] + dx * ca - dy * sa, pivot[1] + dx * sa + dy * ca];
  });
}

/** Scale a path about a pivot. */
export function scalePts(pts, pivot, k) {
  return pts.map(([x, y]) => [pivot[0] + (x - pivot[0]) * k, pivot[1] + (y - pivot[1]) * k]);
}
