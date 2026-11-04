// viewport.js — the pan/zoom transform between page space and the screen.
//
// PAGE SPACE is pixels of the rendered sheet at the project's import DPI.
// Every stored coordinate lives there and never changes when the user zooms.
// SCREEN SPACE is CSS pixels inside the canvas element.
//
//   screen = (page - origin) * zoom
//   page   = screen / zoom + origin
//
// Device pixel ratio is handled once, in resize(), by scaling the backing
// store and the context. Nothing downstream ever has to think about it.

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.zoom = 1;
    this.origin = { x: 0, y: 0 };    // page-space point at the canvas top-left
    this.width = 0;                  // CSS pixels
    this.height = 0;
    this.dpr = 1;
    // Where the sheet currently being drawn sits in the continuous view.
    // null in the ordinary single-sheet view, and every method below takes
    // an early return on that, so single-sheet arithmetic is not merely
    // equivalent to what it was — it is the same expression.
    this._frame = null;
  }

  /**
   * Draw the next passes as if this sheet's top-left were the world origin.
   *
   * Page coordinates in, page coordinates out: a measurement stored at
   * (13, 907) on sheet 40 converts exactly as it would if sheet 40 were the
   * only sheet open. That is what lets every tool, every hit test and every
   * label keep working in a continuous view with no changes.
   */
  setPageFrame(ox, oy) { this._frame = { x: ox || 0, y: oy || 0 }; }

  clearPageFrame() { this._frame = null; }

  get pageFrame() { return this._frame; }

  /** Match the backing store to the element's box. Returns true if it changed. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === this.width && h === this.height && dpr === this.dpr) return false;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    return true;
  }

  toScreen(px, py) {
    const f = this._frame;
    if (!f) return [(px - this.origin.x) * this.zoom, (py - this.origin.y) * this.zoom];
    return [(px + f.x - this.origin.x) * this.zoom,
            (py + f.y - this.origin.y) * this.zoom];
  }

  toPage(sx, sy) {
    const f = this._frame;
    if (!f) return [sx / this.zoom + this.origin.x, sy / this.zoom + this.origin.y];
    return [sx / this.zoom + this.origin.x - f.x,
            sy / this.zoom + this.origin.y - f.y];
  }

  /** A length in page pixels, as it appears on screen. */
  scaleLength(pageLen) { return pageLen * this.zoom; }

  /** A length in screen pixels, as page pixels — for hit radii and grab targets. */
  unscaleLength(screenLen) { return screenLen / this.zoom; }

  /** Pointer position in page space, from any mouse or pointer event. */
  eventToPage(ev) {
    const rect = this.canvas.getBoundingClientRect();
    return this.toPage(ev.clientX - rect.left, ev.clientY - rect.top);
  }

  panBy(dxScreen, dyScreen) {
    this.origin.x -= dxScreen / this.zoom;
    this.origin.y -= dyScreen / this.zoom;
  }

  /** Zoom about a screen point, so the page point under it does not move. */
  zoomAt(sx, sy, factor) {
    const [px, py] = this.toPage(sx, sy);
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) return;
    this.zoom = next;
    this.origin.x = px - sx / this.zoom;
    this.origin.y = py - sy / this.zoom;
  }

  /** Zoom about the middle of the canvas. */
  zoomBy(factor) {
    this.zoomAt(this.width / 2, this.height / 2, factor);
  }

  setZoomAt(sx, sy, zoom) {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) return;
    this.zoomAt(sx, sy, next / this.zoom);
  }

  /** True once the canvas has a real size to fit anything into. */
  get measured() { return this.width > 1 && this.height > 1; }

  /** Fit a page-space rect into the canvas, with a margin in screen pixels. */
  fit(rect, margin = 16) {
    if (!rect || !(rect.w > 0) || !(rect.h > 0)) return false;
    // Fitting into a box that has not been measured yet gives a 2% zoom and a
    // blank screen. A hidden tab runs no animation frames, so this is the
    // ordinary state of a project opened in the background — not an edge case.
    if (!this.measured) return false;
    const zx = (this.width - margin * 2) / rect.w;
    const zy = (this.height - margin * 2) / rect.h;
    this.zoom = clamp(Math.min(zx, zy), MIN_ZOOM, MAX_ZOOM);
    this.centerOn(rect.x + rect.w / 2, rect.y + rect.h / 2);
    return true;
  }

  /** Fill the canvas width with a page-space rect. */
  fitWidth(rect, margin = 16) {
    if (!rect || !(rect.w > 0)) return false;
    if (!this.measured) return false;
    this.zoom = clamp((this.width - margin * 2) / rect.w, MIN_ZOOM, MAX_ZOOM);
    this.origin.x = rect.x - margin / this.zoom;
    // Keep the top of the sheet in view rather than centring it vertically.
    this.origin.y = rect.y - margin / this.zoom;
    return true;
  }

  centerOn(px, py) {
    this.origin.x = px - this.width / (2 * this.zoom);
    this.origin.y = py - this.height / (2 * this.zoom);
  }

  /** Bring a page-space rect into view without changing the zoom. */
  ensureVisible(rect, margin = 40) {
    const [sx0, sy0] = this.toScreen(rect.x, rect.y);
    const [sx1, sy1] = this.toScreen(rect.x + rect.w, rect.y + rect.h);
    let dx = 0, dy = 0;
    if (sx0 < margin) dx = margin - sx0;
    else if (sx1 > this.width - margin) dx = this.width - margin - sx1;
    if (sy0 < margin) dy = margin - sy0;
    else if (sy1 > this.height - margin) dy = this.height - margin - sy1;
    if (dx || dy) this.panBy(dx, dy);
  }

  /** The page-space rectangle currently on screen. */
  visibleRect() {
    const [x0, y0] = this.toPage(0, 0);
    const [x1, y1] = this.toPage(this.width, this.height);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Apply the transform to a 2D context, device pixel ratio included. */
  applyTransform(ctx) {
    const f = this._frame;
    const ox = f ? this.origin.x - f.x : this.origin.x;
    const oy = f ? this.origin.y - f.y : this.origin.y;
    ctx.setTransform(
      this.zoom * this.dpr, 0,
      0, this.zoom * this.dpr,
      -ox * this.zoom * this.dpr,
      -oy * this.zoom * this.dpr
    );
  }

  /** Reset to plain CSS-pixel coordinates, for screen-space drawing. */
  applyScreenTransform(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  serialize() {
    return { zoom: this.zoom, x: this.origin.x, y: this.origin.y };
  }

  restore(state) {
    if (!state) return;
    this.zoom = clamp(Number(state.zoom) || 1, MIN_ZOOM, MAX_ZOOM);
    this.origin.x = Number(state.x) || 0;
    this.origin.y = Number(state.y) || 0;
  }
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
