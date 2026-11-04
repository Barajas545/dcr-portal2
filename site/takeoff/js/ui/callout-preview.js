// callout-preview.js — read a detail without leaving the plan.
//
// A callout bubble on a framing sheet says "see 3/S301". Following it means
// finding S301, finding detail 3 on it, reading it, and finding your way
// back — four navigations to answer one question, and you lose your place
// every time. The desktop program answers it in place, and the spec is blunt
// about why it matters: "reading a detail without leaving the plan IS the
// feature."
//
// Every callout in the estimator's library — 633 of 633 across 22 jobs —
// carries `ref_page` (the sheet it points at) and `ref_zone` (the rectangle
// on that sheet, in 0..1). So the preview opens on a crop of a real drawing,
// not a shrunken whole sheet: the median zone is 11% of a sheet's area, which
// at 480px is legible, where a whole 5400px sheet in the same box is a smudge.
//
// The crop is taken at decode time — see PageStore.cropRegion — so a 74 MB
// sheet is never held to take a corner out of it.
//
// ── it is a VIEWPORT, not a picture ───────────────────────────────────────
//
// The zone is where the preview OPENS, not the limit of what it can show.
// The window onto the sheet can be moved and zoomed with a finger, a wheel
// or the buttons, which is what makes the next detail along readable without
// going to the sheet — and none of it is saved. Panning a preview is looking,
// not editing: `ref_zone` is what the pin means and only the callout dialog
// may change it. Close the preview and it opens on the zone again.
//
// Three things decide how good it looks, and all three were wrong before:
//
//   1. The crop was decoded at CSS pixels and drawn into a canvas backed at
//      device pixels, so on any retina screen — the estimator reads these on
//      an iPad Pro, where devicePixelRatio is 2 — every detail was blown up
//      2x from half the resolution it could have had.
//   2. The picture was capped at 1:1 (`Math.min(1, ...)`), so a zone smaller
//      than the box was drawn small with the rest of the box left empty,
//      instead of filling the space the user chose.
//   3. The box was a fixed rectangle and the drawing was fitted inside it.
//      Now the box takes the ZONE's shape and fills the size budget, so a
//      wide section detail gets a wide window instead of two thick bars.

import { cropGeometry } from '../core/page-store.js';

/**
 * The size budgets, in CSS pixels. Width and height are a budget for the
 * picture, not its shape — see previewBox.
 *
 * 'huge' is for a 12.9" iPad and a desk monitor; every one of these is
 * clamped to the window it has to fit in, so choosing it on a phone is
 * harmless rather than a preview with its right-hand half off the screen.
 */
export const SIZES = {
  small: [320, 210],
  medium: [480, 320],
  large: [640, 430],
  'x-large': [800, 535],
  huge: [1040, 700],
};

/** For the Settings form: value, and what to call it. */
export const PREVIEW_SIZES = [
  ['small', 'Small'],
  ['medium', 'Medium'],
  ['large', 'Large'],
  ['x-large', 'Extra large'],
  ['huge', 'Huge'],
];

/** How long a mouse must rest on a bubble before we decode anything. */
const HOVER_DWELL_MS = 220;
/**
 * And how long an unpinned preview survives the pointer leaving the bubble.
 * The gap between a bubble and the preview beside it is plain canvas, which
 * reports "not on a callout" — without this, reaching for the preview to
 * zoom it closed the preview.
 */
const HOVER_GRACE_MS = 180;
/** Margin kept between the popup and the window edge. */
const EDGE = 10;
/** Everything that is not the picture: head, foot, padding, borders. */
const DEFAULT_CHROME = { w: 38, h: 118 };
/** Smallest picture worth drawing, whatever the window is. */
const MIN_BOX = 150;
/** How far the box's shape may stray from the budget's, each way. */
const ASPECT_SPREAD = 2.1;
/** How far in a zoom may go, against the view it opened on. */
const MAX_ZOOM = 8;
/** How much more than the view to decode, so a small pan draws instantly. */
const SRC_MARGIN = 1.35;
/** A ceiling on one decoded source: 6 MP is 24 MB held, on a tablet. */
const MAX_SRC_PIXELS = 6e6;
/** Device pixels per CSS pixel to decode for. An iPad Pro is exactly 2. */
const MAX_DPR = 2;
/** The decoded crops kept for re-opening: bounded by both count and bytes. */
const CACHE_MAX = 16;
const CACHE_BYTES = 48e6;
/** Paper, behind and around the drawing. */
const PAPER = '#ffffff';
/** A tap that is a double tap. */
const DBL_MS = 320;
const DBL_SLOP = 24;
/**
 * How far the pointer may travel and still have been a tap.
 *
 * These are controller.js's own two numbers, and they are two numbers for
 * a reason it already states: a finger is not as steady as a mouse. One
 * shared 2px threshold was deciding both "the pan has begun" and "that was
 * not a tap", which put the double-tap-to-reset that the hint advertises
 * out of reach of an actual fingertip.
 */
const TAP_SLOP = 11;
const CLICK_SLOP = 4;
/** How far the pointer must move before the drag takes over. */
const PAN_START = 2;
/** The quiet after a gesture before the real pixels are fetched. */
const SRC_IDLE_MS = 160;
/**
 * ...and the longest a continuing gesture may put that off. A long drag
 * clears the idle timer on every move, so without this nothing was asked
 * for until the finger stopped — and what is past the decoded rectangle
 * is blank paper.
 */
const SRC_MAX_WAIT_MS = 420;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ── the view maths, kept pure so it can be tested without a browser ───────

/** The size budget for the picture, clamped to the window it must fit in. */
export function previewBudget(sizeName, vw, vh, chrome = DEFAULT_CHROME) {
  const [W, H] = SIZES[sizeName] || SIZES.medium;
  return {
    w: Math.max(MIN_BOX, Math.min(W, vw - chrome.w)),
    h: Math.max(MIN_BOX, Math.min(H, vh - chrome.h)),
  };
}

/** The shape of a zone: wide details get wide windows. */
export function zoneAspect(zone, nat) {
  const g = cropGeometry(zone, nat);
  return g.sw / Math.max(1, g.sh);
}

/**
 * The picture's own rectangle: the zone's shape, filling the budget.
 *
 * Fitting every detail into one fixed rectangle frames most of them in thick
 * empty bars, so the box takes the drawing's shape — but only so far. A zone
 * ten times wider than it is tall would otherwise give a 60px-tall slot that
 * nothing can be panned around in, so the shape is held within a factor of
 * the budget's own and fitView widens the view to make up the difference.
 */
export function previewBox(budget, aspect) {
  const ba = budget.w / budget.h;
  const a = clamp(aspect > 0 ? aspect : ba, ba / ASPECT_SPREAD, ba * ASPECT_SPREAD);
  let w = budget.w;
  let h = w / a;
  if (h > budget.h) { h = budget.h; w = h * a; }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** The zone as a rectangle in sheet pixels. */
export function zoneRect(zone, nat) {
  const g = cropGeometry(zone, nat);
  return { x: g.sx, y: g.sy, w: g.sw, h: g.sh };
}

/**
 * Where the preview opens: the whole zone, in the box's shape.
 *
 * Contain, never cover. A view narrower than the zone would hide part of the
 * detail the pin was placed for, and the one thing this must always show is
 * the thing it points at.
 */
export function fitView(zone, nat, box) {
  const g = zoneRect(zone, nat);
  const a = box.w / box.h;
  let w = g.w;
  let h = g.h;
  if (w / h < a) w = h * a; else h = w / a;
  return clampView({ x: g.x + g.w / 2 - w / 2, y: g.y + g.h / 2 - h / 2, w, h }, nat);
}

/**
 * A view, kept on the sheet and within its zoom range.
 *
 * Zoomed out, it stops at the whole drawing; there is nothing past the edge
 * of the paper to slide to, and letting the view wander off it would hand
 * the estimator a blank white window with no way to tell why.
 */
export function clampView(v, nat, minW = 1) {
  const a = v.w / Math.max(1e-9, v.h);
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  const maxW = Math.min(nat.width, nat.height * a);
  const w = clamp(v.w, Math.min(minW, maxW), maxW);
  const h = w / a;
  const x = w >= nat.width ? (nat.width - w) / 2 : clamp(cx - w / 2, 0, nat.width - w);
  const y = h >= nat.height ? (nat.height - h) / 2 : clamp(cy - h / 2, 0, nat.height - h);
  return { x, y, w, h };
}

/**
 * Zoom about a point, given as a fraction of the box (0..1 across, down).
 * The sheet pixel under that point does not move, which is what makes a
 * pinch feel attached to the drawing rather than to the window.
 */
export function zoomView(v, factor, fx = 0.5, fy = 0.5) {
  const f = factor > 0 ? factor : 1;
  const px = v.x + v.w * fx;
  const py = v.y + v.h * fy;
  const w = v.w / f;
  const h = v.h / f;
  return { x: px - w * fx, y: py - h * fy, w, h };
}

/** Drag the drawing: fractions of the box, in the direction of the finger. */
export function panView(v, fx, fy) {
  return { x: v.x - fx * v.w, y: v.y - fy * v.h, w: v.w, h: v.h };
}

/**
 * Which rectangle to decode, and at what resolution.
 *
 * Bigger than the view by a margin, so an ordinary pan draws from pixels
 * already in hand; at the resolution the screen can actually show, capped
 * at the sheet's own pixels (there are no more) and at a pixel budget (a
 * tablet has to hold this). `pxWide` is the canvas's backing store width,
 * device pixels and not CSS pixels — getting that wrong is the whole of
 * defect 1 at the top of this file.
 */
export function sourceRequest(view, nat, pxWide, opts = {}) {
  const margin = opts.margin ?? SRC_MARGIN;
  const maxPixels = opts.maxPixels ?? MAX_SRC_PIXELS;
  const w = Math.min(nat.width, view.w * margin);
  const h = Math.min(nat.height, view.h * margin);
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  const x = clamp(cx - w / 2, 0, Math.max(0, nat.width - w));
  const y = clamp(cy - h / 2, 0, Math.max(0, nat.height - h));
  const need = pxWide / Math.max(1e-6, view.w);        // bitmap px per sheet px
  let scale = Math.min(1, need);
  if (w * scale * h * scale > maxPixels) scale = Math.sqrt(maxPixels / (w * h));

  // Out to whole sheet pixels, always OUTWARD, and expressed so that
  // cropGeometry's own floor-and-round lands back on exactly these
  // integers. Rounding the region to nearest let the crop fall up to 1.5px
  // short of the view at the edge of the paper, where the margin that
  // normally hides such a thing has been clamped away: a white seam along
  // the bottom of every detail taken from the bottom of a sheet. The
  // quarter-pixel offset is what makes floor() robust to the float error
  // in x/W*W, and it keeps the round() off a .5 tie in the clamped case.
  const ix = Math.max(0, Math.floor(x));
  const iy = Math.max(0, Math.floor(y));
  const iw = Math.min(nat.width, Math.ceil(x + w)) - ix;
  const ih = Math.min(nat.height, Math.ceil(y + h)) - iy;
  const zone = [
    (ix + 0.25) / nat.width,
    (iy + 0.25) / nat.height,
    (ix + 0.25 + iw) / nat.width,
    (iy + 0.25 + ih) / nat.height,
  ];
  const rect = zoneRect(zone, nat);
  return {
    zone,
    rect,
    maxWidth: Math.max(1, Math.round(rect.w * scale)),
    need,
  };
}

/**
 * The canvas behind a picture of this size: backing store, and the CSS
 * size to show it at.
 *
 * Both, from one place, because the whole defect this feature started
 * from was the two disagreeing: the crop was decoded for the CSS box
 * while the canvas was backed at device pixels, so every detail was an
 * upscale of half the resolution the screen could show. The CSS size is
 * derived BACK from the backing store so the two have the same shape to
 * the last fraction — a canvas whose CSS box is a different aspect is
 * stretched by the browser, and a stretched drawing is a wrong drawing.
 */
export function canvasPixels(box, dpr = 1) {
  const r = Math.min(Math.max(dpr || 1, 1), MAX_DPR);
  const cw = Math.max(1, Math.round(box.w * r));
  const ch = Math.max(1, Math.round(box.h * r));
  return { cw, ch, cssW: cw / r, cssH: ch / r, dpr: r };
}

/** Does a decoded rectangle hold everything the view is about to draw? */
export function covers(rect, view, eps = 0.75) {
  if (!rect) return false;
  return view.x >= rect.x - eps && view.y >= rect.y - eps
    && view.x + view.w <= rect.x + rect.w + eps
    && view.y + view.h <= rect.y + rect.h + eps;
}

// ── the widget ────────────────────────────────────────────────────────────

export class CalloutPreview {
  /**
   * @param {object} host
   *   pages        PageStore
   *   sheetLabel   (index) => string
   *   goToSheet    (index) => void
   *   sizeName     () => 'small'|'medium'|'large'|'x-large'|'huge'
   *   hoverEnded   () => void   optional; see hide()
   */
  constructor(host) {
    this.host = host;
    this.pinned = false;
    this.item = null;
    this.page = null;
    this.nat = null;
    this.view = null;
    this.initW = 0;
    this.box = { w: 0, h: 0 };
    this._token = 0;
    this._srcSeq = 0;
    this._src = null;             // {bmp, rect, k, native, owned}
    this._srcKey = null;
    this._cache = new Map();      // `${page}:${zone}:${w}` -> ImageBitmap
    this._cacheBytes = 0;
    this._hoverTimer = null;
    this._leaveTimer = null;
    this._idleTimer = null;
    this._resizeTimer = null;
    this._askedAt = 0;
    this._tries = 0;
    this._failed = false;
    this._anchor = { x: 0, y: 0 };
    this._down = null;
    this._travel = 0;
    this._pinched = false;
    this._inside = false;
    this._ptrs = new Map();
    this._pinch = null;
    this._last = null;
    this._moved = false;
    this._lastTap = 0;
    this._lastTapAt = null;
    this._build();
  }

  // ── the DOM ─────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.className = 'cpv';
    el.id = 'calloutPreview';
    // `hidden` alone is not enough to trust — an author rule that sets
    // display outranks it, which is how a fixed full-screen layer once ate
    // every click in this app. app.css sets [hidden] { display:none
    // !important }, and this element additionally has no size and no
    // pointer-events of its own when closed.
    el.hidden = true;
    el.innerHTML = `
      <div class="cpv-head" id="cpvHead">
        <span class="cpv-title" id="cpvTitle"></span>
        <span class="cpv-zoomer" id="cpvZoomer">
          <button class="cpv-zb" data-cpv="out" title="Zoom out" aria-label="Zoom out">−</button>
          <span class="cpv-pct" id="cpvPct">100%</span>
          <button class="cpv-zb" data-cpv="in" title="Zoom in" aria-label="Zoom in">+</button>
          <button class="cpv-zb" data-cpv="reset" title="Back to the detail" aria-label="Back to the detail">⟲</button>
        </span>
        <button class="cpv-x" data-cpv="close" title="Close" aria-label="Close">✕</button>
      </div>
      <div class="cpv-body" id="cpvBody"></div>
      <div class="cpv-foot">
        <button class="cpv-go" data-cpv="go">Go to sheet</button>
        <span class="cpv-hint" id="cpvHint"></span>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.headEl = el.querySelector('#cpvHead');
    this.footEl = el.querySelector('.cpv-foot');
    this.titleEl = el.querySelector('#cpvTitle');
    this.bodyEl = el.querySelector('#cpvBody');
    this.hintEl = el.querySelector('#cpvHint');
    this.pctEl = el.querySelector('#cpvPct');
    this.zoomerEl = el.querySelector('#cpvZoomer');

    el.addEventListener('pointerdown', ev => ev.stopPropagation());
    el.addEventListener('click', ev => {
      const act = ev.target.closest('[data-cpv]')?.dataset.cpv;
      if (!act) return;
      if (act === 'close') { this.hide(); return; }
      if (act === 'go') {
        const page = this._targetPage(this.item);
        this.hide();
        if (page != null) this.host.goToSheet(page);
        return;
      }
      if (act === 'in') { this._adopt(); this._zoomBy(1.4); return; }
      if (act === 'out') { this._adopt(); this._zoomBy(1 / 1.4); return; }
      if (act === 'reset') { this._adopt(); this._resetView(); }
    });

    // Reaching for the preview must not close it — see HOVER_GRACE_MS.
    el.addEventListener('pointerenter', () => {
      this._inside = true;
      this._clearLeave();
    });
    el.addEventListener('pointerleave', () => {
      this._inside = false;
      if (!this.pinned) this.hide();
    });

    this._bindGestures();

    // Rotating an iPad with a preview open left it sized and placed for the
    // orientation before — and since the drag moves the picture inside the
    // window rather than the window itself, there was no gesture that could
    // bring a half-off-screen one back.
    this._onResize = () => {
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        this._resizeTimer = null;
        this._remeasure();
      }, 150);
    };
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
  }

  get open() { return !this.el.hidden; }

  // ── resolving where a callout points ────────────────────────────────

  /**
   * The sheet a callout refers to.
   *
   * `ref_page` is authoritative and present on every real pin. The label
   * fallback exists only for a file whose sheets were reordered by something
   * that did not remap the index — measured, a label resolves uniquely for
   * as few as 8% of pins on some jobs, so it is a last resort, never first.
   */
  _targetPage(m) {
    if (!m) return null;
    const n = this.host.pages?.pageCount ?? 0;
    if (Number.isInteger(m.ref_page) && m.ref_page >= 0 && m.ref_page < n) {
      return m.ref_page;
    }
    const want = String(m.ref_page_label || '').trim().toLowerCase();
    if (!want) return null;
    let found = null;
    for (let i = 0; i < n; i++) {
      const lab = String(this.host.sheetLabel(i) || '').trim().toLowerCase();
      if (lab === want) {
        if (found != null) return null;      // ambiguous: refuse to guess
        found = i;
      }
    }
    return found;
  }

  // ── showing ─────────────────────────────────────────────────────────

  /** A mouse resting on a bubble. Cheap until the dwell elapses. */
  hoverIn(item, x, y) {
    if (this.pinned) return;                 // a pinned preview is the user's
    this._clearLeave();
    if (this.item === item && this.open) return;
    this._clearHover();
    this._hoverTimer = setTimeout(() => {
      this._hoverTimer = null;
      void this.show(item, x, y, { pinned: false });
    }, HOVER_DWELL_MS);
  }

  hoverOut() {
    this._clearHover();
    if (this.pinned || !this.open) return;
    // Not at once: the pointer may be on its way to the preview, and the
    // ground in between is canvas, which is "not on a callout".
    this._clearLeave();
    this._leaveTimer = setTimeout(() => {
      this._leaveTimer = null;
      if (!this.pinned && !this._inside) this.hide();
    }, HOVER_GRACE_MS);
  }

  _clearHover() {
    if (this._hoverTimer) { clearTimeout(this._hoverTimer); this._hoverTimer = null; }
  }

  _clearLeave() {
    if (this._leaveTimer) { clearTimeout(this._leaveTimer); this._leaveTimer = null; }
  }

  /** A tap or a click. Opens and stays until dismissed. */
  async show(item, x, y, { pinned = true } = {}) {
    this._clearHover();
    this._clearLeave();
    this._releaseSource();
    this._anchor = { x, y };
    // performance.now() is milliseconds since navigation, so 0 does not
    // read as "never asked" — it reads as "asked at page load", which put
    // the first gesture of every preview past the SRC_MAX_WAIT_MS cap.
    this._askedAt = performance.now();
    this._tries = 0;
    this._failed = false;
    this.item = item;
    this.pinned = pinned;
    this.page = null;
    this.nat = null;
    this.view = null;
    this._srcKey = null;
    const token = ++this._token;

    const page = this._targetPage(item);
    const label = page != null ? this.host.sheetLabel(page) : (item.ref_page_label || '');
    this.titleEl.textContent = `→ ${label || 'unknown sheet'}`;
    this.el.querySelector('.cpv-go').disabled = page == null;
    this._setHint();
    this._showZoomer(false);
    this._setBody(this._msg('Loading…'));
    this.el.hidden = false;
    this._place(x, y);

    if (page == null) { this._setBody(this._msg('No preview')); this._place(x, y); return; }
    if (!Array.isArray(item.ref_zone) || item.ref_zone.length < 4) {
      this._setBody(this._msg('No area selected'));
      this._place(x, y);
      return;
    }

    try {
      // The sheet's true size, without decoding it. Needed before anything
      // is drawn, because the window takes the detail's shape.
      const nat = await this.host.pages.nativeSize(page);
      if (token !== this._token) return;
      if (!nat || !nat.width || !nat.height) {
        this._setBody(this._msg('No preview'));
        this._place(x, y);
        return;
      }
      this.page = page;
      this.nat = nat;

      const budget = previewBudget(this.host.sizeName?.() || 'medium',
                                   window.innerWidth, window.innerHeight,
                                   this._chrome());
      const box = previewBox(budget, zoneAspect(item.ref_zone, nat));
      this._mountCanvas(box);
      this.view = fitView(item.ref_zone, nat, this.box);
      this.initW = this.view.w;
      this._showZoomer(true);
      this._updateZoomUi();
      this._draw();
      this._place(x, y);

      // The opening crop, remembered: re-opening the same bubble is then a
      // single draw. Keyed by the RECTANGLE that was decoded, not by the
      // zone it came from: the rectangle is the zone plus a margin fitted
      // to the window, so the same pin in a window of another size is a
      // different picture, and a cached bitmap handed back under the wrong
      // footprint would be drawn in the wrong place.
      const req = sourceRequest(this.view, nat, this._canvasWidth());
      const key = `${page}:${this._keyOf(req)}`;
      const seq = ++this._srcSeq;
      let bmp = this._cache.get(key);
      if (!bmp) {
        bmp = await this.host.pages.cropRegion(page, req.zone, req.maxWidth);
        if (token !== this._token || seq !== this._srcSeq) { bmp?.close?.(); return; }
        if (bmp) this._remember(key, bmp);
      }
      if (token !== this._token) return;
      if (!bmp) { this._setBody(this._msg('No preview')); this._place(x, y); return; }
      // He can drag or pinch while the opening crop is still decoding — the
      // window is up and live from the moment the canvas is mounted — and
      // this used to land on top of him and then claim, through _srcKey,
      // that the view he had moved to was already in hand. Same rule as
      // _ensureSource: install it, but only call it current if it covers
      // what is on screen, and go and get the rest if it does not.
      const fits = covers(req.rect, this.view);
      this._srcKey = fits ? this._keyOf(req) : null;
      this._setSource({
        bmp,
        rect: req.rect,
        k: bmp.width / Math.max(1, req.rect.w),
        native: bmp.width >= req.rect.w - 1,
        owned: false,                       // the cache owns this one
      });
      this._draw();
      if (!fits) this._scheduleSource();
    } catch (err) {
      if (token !== this._token) return;
      console.warn('callout preview failed', err);
      this._setBody(this._msg('Preview error'));
      this._place(x, y);
    }
  }

  _msg(text) {
    const d = document.createElement('div');
    d.className = 'cpv-msg';
    d.textContent = text;
    return d;
  }

  _setBody(node) {
    this.canvasEl = null;
    this.viewEl = null;
    this.bodyEl.textContent = '';
    this.bodyEl.appendChild(node);
  }

  /** How much of the window the popup spends on things that are not the
   *  drawing. Measured when it can be, so a change in the CSS cannot leave
   *  a preview wider than the screen. */
  _chrome() {
    const head = this.headEl?.offsetHeight || 0;
    const foot = this.footEl?.offsetHeight || 0;
    if (!head || !foot) return DEFAULT_CHROME;
    // 8px of body padding each side, 1px of border each side, EDGE either end.
    return { w: 2 * EDGE + 18, h: 2 * EDGE + head + foot + 18 };
  }

  /**
   * The picture's canvas, sized in device pixels and shown at CSS pixels.
   *
   * The CSS size is derived back from the backing store so the two have the
   * same shape to the last fraction: a canvas whose CSS box is a different
   * aspect is stretched by the browser, and a stretched drawing is a wrong
   * drawing.
   */
  _mountCanvas(box) {
    const { cw, ch, cssW, cssH, dpr } = canvasPixels(box, window.devicePixelRatio);
    const wrap = document.createElement('div');
    wrap.className = 'cpv-view';
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    wrap.style.width = `${cssW}px`;
    wrap.style.height = `${cssH}px`;
    const wait = document.createElement('div');
    wait.className = 'cpv-wait';
    wait.textContent = 'Loading…';
    wrap.appendChild(c);
    wrap.appendChild(wait);
    this.bodyEl.textContent = '';
    this.bodyEl.appendChild(wrap);
    this.canvasEl = c;
    this.viewEl = wrap;
    this.waitEl = wait;
    this._failed = false;
    this.dpr = dpr;
    this.box = { w: cssW, h: cssH };
  }

  _canvasWidth() { return this.canvasEl ? this.canvasEl.width : 480; }

  /**
   * The "fetching" badge. Driven from _draw alone, by whether the pixels
   * on screen actually reach the edges of the window — it used to be
   * turned off when the first crop landed and never turned on again, so a
   * pan into undecoded paper looked exactly like an empty preview.
   */
  _waiting(on) {
    if (this.waitEl) this.waitEl.style.display = on ? '' : 'none';
  }

  _setHint() {
    // Not "Esc to close": the iPad this is read on has no Esc key, and on
    // a tablet every preview is pinned, because hover is mouse-only.
    const hint = this.pinned
      ? 'Drag to move · double-tap to reset · tap outside to close'
      : '';
    if (this.hintEl) this.hintEl.textContent = hint;
  }

  _showZoomer(on) {
    if (this.zoomerEl) this.zoomerEl.style.display = on ? '' : 'none';
  }

  // ── drawing ─────────────────────────────────────────────────────────

  _draw() {
    const c = this.canvasEl;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, c.width, c.height);
    const s = this._src;
    const v = this.view;
    if (!s || !v) { this._waiting(true); return; }
    const k = c.width / v.w;                 // device pixels per sheet pixel
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(s.bmp, (s.rect.x - v.x) * k, (s.rect.y - v.y) * k,
                  s.rect.w * k, s.rect.h * k);
    // One rule for the badge: it is up when the pixels do not reach the
    // edges of the window, or when we have given up fetching them. Setting
    // its TEXT somewhere that did not also own its visibility left the
    // failure message on a badge _draw would hide a frame later.
    this._waiting(this._failed || !covers(s.rect, v));
  }

  /** Is what we hold enough to fill the window, at the resolution wanted? */
  _enough(req) {
    const s = this._src;
    if (!s || !this.view) return false;
    if (!covers(s.rect, this.view)) return false;
    return s.native || !req || s.k >= req.need * 0.92;
  }

  _setSource(src) {
    const old = this._src;
    this._src = src;
    if (old && old.owned && old.bmp !== src.bmp) old.bmp?.close?.();
  }

  _releaseSource() {
    if (this._src && this._src.owned) this._src.bmp?.close?.();
    this._src = null;
    this._srcKey = null;
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
  }

  _keyOf(req) {
    return `${req.zone.map(v => v.toFixed(6)).join(',')}:${req.maxWidth}`;
  }

  /**
   * After a gesture settles, make sure what is on screen is the real thing.
   *
   * ...but a gesture that does not settle may not postpone it for ever. A
   * long drag re-armed this on every pointermove, so a finger travelling
   * steadily across the sheet asked for nothing at all while the window
   * filled up with blank paper.
   */
  _scheduleSource() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    const waited = performance.now() - this._askedAt;
    const wait = waited > SRC_MAX_WAIT_MS ? 0 : SRC_IDLE_MS;
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      void this._ensureSource();
    }, wait);
  }

  async _ensureSource() {
    if (!this.view || !this.nat || this.page == null || !this.canvasEl) return;
    this._askedAt = performance.now();
    const req = sourceRequest(this.view, this.nat, this._canvasWidth());
    const key = this._keyOf(req);
    if (key === this._srcKey) return;                  // already asked for it
    if (this._enough(req)) return;                     // and what we hold fits
    this._srcKey = key;
    const token = this._token;
    const seq = ++this._srcSeq;
    let bmp = null;
    try {
      bmp = await this.host.pages.cropRegion(this.page, req.zone, req.maxWidth);
    } catch (err) {
      // The guard FIRST. _retryLater and _srcKey are shared, un-ticketed
      // state: a read belonging to a preview he has already closed was
      // spending the NEXT preview's retry budget, cancelling its pending
      // fetch, and writing "Could not load that part" across a preview
      // that had not failed at anything. Every other exit from here sits
      // behind this line; this one was written in front of it.
      if (token !== this._token || seq !== this._srcSeq) return;
      console.warn('callout preview source failed', err);
      if (key === this._srcKey) this._srcKey = null;
      this._retryLater();
      return;
    }
    if (token !== this._token || seq !== this._srcSeq) { bmp?.close?.(); return; }
    if (!bmp) {
      if (key === this._srcKey) this._srcKey = null;
      this._retryLater();
      return;
    }
    this._tries = 0;
    this._failed = false;

    // The view may have moved on while this was decoding, and this request
    // was still the newest one: the guards above only ask whether anything
    // NEWER was asked for, and the "what we hold is enough" early return
    // deliberately asks for nothing. So a decode taken for a view he has
    // since left could replace a source that covered the window with one
    // that does not, and nothing was left to fetch the right pixels. Zoom
    // in and straight back out on a slow decode and the preview went 87%
    // blank paper until the next gesture.
    const fits = covers(req.rect, this.view);
    if (!fits && this._src && covers(this._src.rect, this.view)) {
      bmp.close?.();                       // what we already hold is better
      this._srcKey = null;
      this._scheduleSource();
      return;
    }
    this._setSource({
      bmp,
      rect: req.rect,
      k: bmp.width / Math.max(1, req.rect.w),
      native: bmp.width >= req.rect.w - 1,
      owned: true,
    });
    this._draw();
    if (!fits) { this._srcKey = null; this._scheduleSource(); }
  }

  /**
   * A decode failed. Try again, a couple of times, then say so.
   *
   * These two exits said "let it be tried again" and left nothing to try
   * again with: the badge is driven by whether the pixels reach the edge of
   * the window, so a failure left a "Loading..." pill lit for ever under a
   * window that was never going to fill.
   */
  _retryLater() {
    if (this._tries >= 2) {
      this._failed = true;
      if (this.waitEl) this.waitEl.textContent = 'Could not load that part';
      this._waiting(true);
      return;
    }
    this._tries++;
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      void this._ensureSource();
    }, 600);
  }

  /**
   * The window changed shape under an open preview — a rotation, a split
   * view, a browser resize. Keep where he had got to; re-cut the window.
   */
  _remeasure() {
    if (!this.open || !this.view || !this.nat || !this.item) return;
    // Was he still looking at the detail the pin points at? If so the
    // re-cut must land him back on it whole. Carrying the width across and
    // deriving the height from the new shape quietly CROPS a tall detail
    // when the window gets wider — a rotation he did not ask anything of.
    const wasHome = this._atHome();
    const v = this.view;
    const budget = previewBudget(this.host.sizeName?.() || 'medium',
                                 window.innerWidth, window.innerHeight,
                                 this._chrome());
    this._mountCanvas(previewBox(budget, zoneAspect(this.item.ref_zone, this.nat)));
    const home = fitView(this.item.ref_zone, this.nat, this.box);
    this.initW = home.w;
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    const w = v.w;
    const h = w * (this.box.h / this.box.w);
    this.view = wasHome
      ? home
      : clampView({ x: cx - w / 2, y: cy - h / 2, w, h },
                  this.nat, Math.max(4, home.w / MAX_ZOOM));
    this._srcKey = null;              // the resolution wanted has changed
    this._updateZoomUi();
    this._draw();
    this._place(this._anchor.x, this._anchor.y);
    this._scheduleSource();
  }

  // ── moving the window ───────────────────────────────────────────────

  _setView(v) {
    if (!this.nat) return;
    this._tries = 0;                  // a deliberate move is worth a retry
    const minW = Math.max(4, (this.initW || v.w) / MAX_ZOOM);
    this.view = clampView(v, this.nat, minW);
    this._updateZoomUi();
    this._draw();
    this._scheduleSource();
  }

  _zoomBy(factor, fx = 0.5, fy = 0.5) {
    if (!this.view) return;
    this._setView(zoomView(this.view, factor, fx, fy));
  }

  _resetView() {
    if (!this.nat || !this.item) return;
    this.view = fitView(this.item.ref_zone, this.nat, this.box);
    this.initW = this.view.w;
    this._updateZoomUi();
    this._draw();
    this._scheduleSource();
  }

  _atHome() {
    if (!this.view || !this.initW) return true;
    const home = fitView(this.item.ref_zone, this.nat, this.box);
    return Math.abs(home.x - this.view.x) < 0.5
      && Math.abs(home.y - this.view.y) < 0.5
      && Math.abs(home.w - this.view.w) < 0.5;
  }

  _updateZoomUi() {
    if (!this.pctEl || !this.view || !this.initW) return;
    const pct = Math.round((this.initW / this.view.w) * 100);
    this.pctEl.textContent = `${pct}%`;
    const reset = this.el.querySelector('[data-cpv="reset"]');
    if (reset) reset.disabled = this._atHome();
  }

  /** Once he has moved the picture, it is his until he dismisses it. */
  _adopt() {
    if (this.pinned) return;
    this.pinned = true;
    this._clearHover();
    this._clearLeave();
    this._setHint();
  }

  _bindGestures() {
    const body = this.bodyEl;

    const frac = ev => {
      const r = this.viewEl.getBoundingClientRect();
      return {
        fx: clamp((ev.clientX - r.left) / Math.max(1, r.width), 0, 1),
        fy: clamp((ev.clientY - r.top) / Math.max(1, r.height), 0, 1),
      };
    };

    // Re-seeded from whatever fingers are actually down, after EVERY
    // change to the set. Seeding only at the two-finger boundary meant a
    // third finger landing, or one of the original two lifting while a
    // third stayed down, left _pinch describing a pair that no longer
    // existed — and the next move then zoomed by the ratio between two
    // unrelated distances, which is a jump, not a pinch.
    const reseed = () => {
      const pts = [...this._ptrs.values()];
      if (pts.length >= 2) {
        const [a, b] = pts;
        this._pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        };
        this._last = null;
      } else if (pts.length === 1) {
        this._pinch = null;
        this._last = { x: pts[0].x, y: pts[0].y };
      } else {
        this._pinch = null;
        this._last = null;
      }
    };

    body.addEventListener('pointerdown', ev => {
      if (!this.view || !this.viewEl) return;
      // The whole picture area, not just the canvas: a second finger
      // landing on the padding beside a narrow drawing was invisible to
      // the gesture, so the pinch it was half of became a one-finger pan.
      if (!body.contains(ev.target)) return;
      ev.preventDefault();
      this._adopt();
      body.setPointerCapture?.(ev.pointerId);
      this._ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this._ptrs.size === 1) {
        // Only a gesture STARTING resets what the gesture has done. A
        // second finger arriving mid-drag used to clear it, and the lift
        // then read a long drag as a tap.
        this._down = { x: ev.clientX, y: ev.clientY, type: ev.pointerType || 'mouse' };
        this._travel = 0;
        this._moved = false;
        this._pinched = false;
      }
      if (this._ptrs.size >= 2) this._pinched = true;
      reseed();
    });

    body.addEventListener('pointermove', ev => {
      // viewEl too: _setBody() swaps the canvas for a message and nulls it
      // while this.view, this.box and the captured pointer all survive, so
      // the pinch branch dereferenced null, and the pan branch would have
      // moved a view with nothing left to draw it on.
      if (!this.view || !this.viewEl || !this._ptrs.has(ev.pointerId)) return;
      this._ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this._down) {
        this._travel = Math.max(this._travel,
                                Math.hypot(ev.clientX - this._down.x,
                                           ev.clientY - this._down.y));
      }
      if (this._ptrs.size >= 2 && this._pinch) {
        const [a, b] = [...this._ptrs.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const r = this.viewEl.getBoundingClientRect();
        // Pan by where the two fingers moved together, then zoom about where
        // they are now — the midpoint is the thing the hand is holding.
        let v = panView(this.view, (mx - this._pinch.mx) / Math.max(1, r.width),
                        (my - this._pinch.my) / Math.max(1, r.height));
        const fx = clamp((mx - r.left) / Math.max(1, r.width), 0, 1);
        const fy = clamp((my - r.top) / Math.max(1, r.height), 0, 1);
        v = zoomView(v, dist / this._pinch.dist, fx, fy);
        this._pinch = { dist, mx, my };
        this._moved = true;
        this._setView(v);
        return;
      }
      if (this._ptrs.size === 1 && this._last) {
        const dx = ev.clientX - this._last.x;
        const dy = ev.clientY - this._last.y;
        if (!this._moved && this._travel < PAN_START) return;
        this._moved = true;
        this._last = { x: ev.clientX, y: ev.clientY };
        this._setView(panView(this.view, dx / Math.max(1, this.box.w),
                              dy / Math.max(1, this.box.h)));
      }
    });

    const up = ev => {
      if (!this._ptrs.has(ev.pointerId)) return;
      body.releasePointerCapture?.(ev.pointerId);
      this._ptrs.delete(ev.pointerId);
      // Picks the pan back up from the finger that is still down, so
      // lifting one of two does not jump the drawing by their separation.
      reseed();
      if (this._ptrs.size === 0) {
        // A tap is judged by how far the pointer travelled, against the
        // slop for the thing that made it — 11px for a finger, 4px for a
        // mouse. Judging it by the same 2px that starts the pan put
        // double-tap-to-reset out of a fingertip's reach.
        const slop = this._down && this._down.type === 'touch'
          ? TAP_SLOP : CLICK_SLOP;
        if (!this._pinched && this._travel <= slop && ev.type === 'pointerup') {
          this._tap(ev);
        }
        this._down = null;
        this._travel = 0;
        this._moved = false;
        this._pinched = false;
      }
    };
    body.addEventListener('pointerup', up);
    body.addEventListener('pointercancel', up);

    body.addEventListener('wheel', ev => {
      if (!this.view || !this.viewEl || !body.contains(ev.target)) return;
      ev.preventDefault();
      this._adopt();
      // The same two meanings the wheel has on the sheet, from the same
      // setting, including "Ctrl always zooms" — which is what the
      // Settings hint already promises.
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? this.box.h : 1;
      const mode = this.host.wheelMode?.() || 'zoom';
      // Ctrl, and only Ctrl: that is the sheet's rule (controller._onWheel)
      // and the one the Settings hint states.
      if (mode === 'scroll' && !ev.ctrlKey) {
        let dx = ev.deltaX * unit;
        let dy = ev.deltaY * unit;
        if (ev.shiftKey && dx === 0) { dx = dy; dy = 0; }
        this._setView(panView(this.view, -dx / Math.max(1, this.box.w),
                              -dy / Math.max(1, this.box.h)));
        return;
      }
      const step = 1 + clamp(Number(this.host.zoomStep?.()) || 15, 2, 50) / 100;
      const { fx, fy } = frac(ev);
      this._zoomBy(ev.deltaY < 0 ? step : 1 / step, fx, fy);
    }, { passive: false });

    body.addEventListener('dblclick', ev => {
      if (!this.view || !this.viewEl || !body.contains(ev.target)) return;
      ev.preventDefault();
      this._resetView();
    });

    // Safari's own pinch, which would zoom the whole page out from under it.
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
      body.addEventListener(t, ev => ev.preventDefault());
    }

    // A double TAP: a finger produces no dblclick with touch-action none.
    this._tap = ev => {
      const now = ev.timeStamp || 0;
      const at = this._lastTapAt;
      if (at && now - this._lastTap < DBL_MS
          && Math.hypot(ev.clientX - at.x, ev.clientY - at.y) <= DBL_SLOP) {
        this._lastTap = 0;
        this._lastTapAt = null;
        this._resetView();
        return;
      }
      this._lastTap = now;
      this._lastTapAt = { x: ev.clientX, y: ev.clientY };
    };
  }

  /** Beside the bubble, flipped and clamped so it is always fully on screen. */
  _place(x, y) {
    const el = this.el;
    el.style.left = '0px';
    el.style.top = '0px';
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + 18;
    if (left + r.width > vw - EDGE) left = x - 18 - r.width;
    left = Math.max(EDGE, Math.min(left, vw - r.width - EDGE));
    let top = y - r.height / 2;
    top = Math.max(EDGE, Math.min(top, vh - r.height - EDGE));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  hide() {
    this._clearHover();
    this._clearLeave();
    this._token++;
    this._releaseSource();
    this.pinned = false;
    this.item = null;
    this.page = null;
    this.nat = null;
    this.view = null;          // where he had got to is not saved: it reopens
    this.initW = 0;            // on the detail the pin points at, every time
    this._ptrs.clear();
    this._pinch = null;
    this._last = null;
    this._down = null;
    this._travel = 0;
    this._pinched = false;
    this._tries = 0;
    this._lastTap = 0;
    this._lastTapAt = null;
    this._inside = false;
    this.el.hidden = true;
    this.canvasEl = null;
    this.viewEl = null;
    this.waitEl = null;
    this.bodyEl.textContent = '';
    // The canvas only tells us about a callout when the one under the
    // pointer CHANGES, and it saw no movement at all while the pointer was
    // in here. Unless it is told, its hover state still names the bubble
    // this preview was opened from, and hovering that same bubble again
    // — the obvious thing to do — emits nothing and opens nothing.
    try { this.host.hoverEnded?.(); } catch { /* never block a close */ }
  }

  _remember(key, bmp) {
    this._cache.set(key, bmp);
    this._cacheBytes += bmp.width * bmp.height * 4;
    while (this._cache.size > CACHE_MAX || this._cacheBytes > CACHE_BYTES) {
      const oldest = this._cache.keys().next().value;
      if (oldest === key) break;             // never the one just put in
      const b = this._cache.get(oldest);
      this._cache.delete(oldest);
      if (b) {
        this._cacheBytes -= b.width * b.height * 4;
        // If it is what is on screen, hand the closing over to the view
        // rather than blanking the preview the user is reading.
        if (this._src && this._src.bmp === b) this._src.owned = true;
        else b.close?.();
      }
    }
  }

  /** Drop every decoded crop — on closing a project, or opening another. */
  clearCache() {
    this._releaseSource();
    for (const b of this._cache.values()) b?.close?.();
    this._cache.clear();
    this._cacheBytes = 0;
  }
}
