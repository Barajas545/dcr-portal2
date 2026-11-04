// layout.js — where each sheet sits when the whole set is one long scroll.
//
// Pure arithmetic: no DOM, no canvas, no imports. That is deliberate. The one
// thing study mode must never get wrong is which sheet a gesture landed on
// and where on that sheet it landed — an error there does not crash, it files
// a wall measurement against the wrong drawing and saves it. Keeping the
// mapping in a module that runs under plain node means that invariant is an
// equality between two function calls, and can be tested without a browser.
//
// World space is the same space a single sheet already uses, with every page
// pushed down by the pages above it:
//
//     page 0   y = 0
//     page 1   y = h0 + gutter
//     page 2   y = h0 + h1 + 2*gutter        …and so on
//
// Sheets are centred horizontally on the widest one, because real sets are
// not uniform: two of the estimator's 22 jobs mix 5400px sheets with 1683px
// ones, and left-aligning those looks broken.

/** World pixels between one sheet and the next. About a finger's width at fit. */
export const GUTTER = 48;

/**
 * A sheet whose size is not known yet.
 *
 * Sizes are read from each page's PNG header before the first frame, but a
 * page added mid-session, or a probe that failed, still has to occupy space
 * or every sheet below it would jump when the answer arrived. Standing in
 * with the commonest size in the set keeps the scrollbar honest.
 */
function fallbackSize(sizes) {
  const seen = new Map();
  for (const s of sizes) {
    if (!s || !s.width || !s.height) continue;
    const k = `${s.width}x${s.height}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  let best = null, n = -1;
  for (const [k, c] of seen) if (c > n) { n = c; best = k; }
  if (!best) return { width: 5400, height: 3600, assumed: true };
  const [w, h] = best.split('x').map(Number);
  return { width: w, height: h, assumed: true };
}

/**
 * Lay the set out top to bottom.
 *
 * @param {Array<{width:number,height:number}|null>} sizes  one per sheet, in order
 * @returns {{pages: Array, width: number, height: number, gutter: number}}
 */
export function buildLayout(sizes, { gutter = GUTTER } = {}) {
  const list = Array.isArray(sizes) ? sizes : [];
  const fb = fallbackSize(list);
  const pages = [];
  let width = 0;
  for (const s of list) {
    const w = (s && s.width) || fb.width;
    if (w > width) width = w;
  }
  if (!width) width = fb.width;

  let y = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const w = (s && s.width) || fb.width;
    const h = (s && s.height) || fb.height;
    pages.push({
      index: i,
      x: Math.round((width - w) / 2),     // centred on the widest sheet
      y,
      width: w,
      height: h,
      assumed: !(s && s.width && s.height),
    });
    y += h + gutter;
  }
  // No trailing gutter: the document ends at the bottom of the last sheet.
  const height = pages.length ? y - gutter : 0;
  return { pages, width, height, gutter };
}

/** The rectangle a sheet occupies in world space. */
export function pageWorldRect(layout, index) {
  const p = layout && layout.pages[index];
  return p ? { x: p.x, y: p.y, w: p.width, h: p.height } : null;
}

/**
 * The sheet a world y belongs to.
 *
 * A y in a gutter belongs to the sheet ABOVE it, so a gesture that lands in
 * the gap between two drawings does not silently jump forward a page. The
 * last sheet owns everything past its bottom edge for the same reason.
 */
export function pageAtWorldY(layout, wy) {
  const pages = layout && layout.pages;
  if (!pages || !pages.length) return -1;
  if (wy < pages[0].y) return 0;
  // Binary search: a 240-sheet set is walked on every pointermove otherwise.
  let lo = 0, hi = pages.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].y <= wy) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

/**
 * A world point as a point on a sheet: { page, x, y }.
 *
 * `x` and `y` are in that sheet's own pixels — exactly the coordinates a
 * measurement is stored in, and exactly what the single-sheet view would
 * have produced for the same gesture. That equality is the whole contract.
 */
export function worldToPage(layout, wx, wy) {
  const index = pageAtWorldY(layout, wy);
  if (index < 0) return null;
  const p = layout.pages[index];
  return { page: index, x: wx - p.x, y: wy - p.y };
}

/** The inverse: a point on a sheet, in world space. */
export function pageToWorld(layout, index, px, py) {
  const p = layout && layout.pages[index];
  if (!p) return null;
  return { x: px + p.x, y: py + p.y };
}

/**
 * Every sheet intersecting a world y range, plus `pad` sheets either side.
 *
 * The pad is what gets decoded ahead of the scroll, so a sheet is ready
 * before it is looked at rather than after.
 */
export function visiblePages(layout, y0, y1, pad = 0) {
  const pages = layout && layout.pages;
  if (!pages || !pages.length) return [];
  let first = pageAtWorldY(layout, y0);
  let last = pageAtWorldY(layout, y1);
  // pageAtWorldY snaps a gutter to the sheet above, so a range that starts
  // in a gutter must not drop the sheet it actually shows first.
  while (first > 0 && pages[first].y > y0) first--;
  while (last < pages.length - 1 && pages[last].y + pages[last].height < y1) last++;
  first = Math.max(0, first - pad);
  last = Math.min(pages.length - 1, last + pad);
  const out = [];
  for (let i = first; i <= last; i++) {
    const p = pages[i];
    if (p.y + p.height >= y0 - 1e-6 && p.y <= y1 + 1e-6) out.push(i);
    else if (i < first + pad || i > last - pad) out.push(i);   // prefetch ring
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * The sheet the viewport is "on" — the one covering the middle of the screen.
 * This is what the title bar, the sheets panel highlight and last_viewed_page
 * follow, and it must not flicker as a boundary crosses the centre line.
 */
export function anchorPage(layout, y0, y1) {
  return pageAtWorldY(layout, (y0 + y1) / 2);
}
