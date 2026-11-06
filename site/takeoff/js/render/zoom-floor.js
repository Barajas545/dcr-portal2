// zoom-floor.js — zooming out stops at the whole sheet (desktop 3.06 / 3.07).
//
// A plain wheel notch out, a pinch or the minus button stops exactly at Fit,
// with the sheet centred: the notch that would cross Fit lands on it, one
// more notch with the sheet dragged aside at Fit centres it (as F does), and
// at Fit or below it a plain notch does nothing. Shift on the wheel goes
// past (Ctrl+Shift when the wheel is set to scroll the page). The readout
// says "Fit 21%" there, and the first refused notch of a session says why.
//
// This is a port of the desktop's own methods -- GLPageWidget.fit_view,
// zoom_floor, at_zoom_floor, shows_fit, land_on_fit, floor_takes_notch,
// _note_past_fit, below_fit_by_choice, _zoom_chosen, _is_turn_raise,
// _zoom_about, _canvas_resized, zoom_to_measurement, the pan a version flip
// keeps (set_page_preview), and
// PDFCacheViewer.zoom_in / zoom_out / _turn_zoom_settle / update_zoom_label
// -- held to them by tests/zoom-floor.mjs, which runs the desktop's own
// code (lifted by tests/zoom-floor-python-truth.py) through the same steps.
//
// THE ONE ANSWER TO "WHAT IS FIT". The F key, the Fit buttons, the floor, a
// jump to an item and a resize all ask fitView() here, of the drawing ON
// SCREEN (a revision on other paper is fitted by its own paper), so they can
// never disagree about where the sheet stops. The web's Fit keeps its 16 px
// margin, so the floor is exactly the web's F.
//
// THE TWO MODELS. The web's Viewport keeps `origin`, the page point at the
// canvas's top-left. The desktop keeps `pan`, the page centre's offset from
// the canvas centre, in screen pixels. Every comparison the desktop makes on
// pan is made here on _pan(), the same quantity worked out from the origin;
// a centred sheet is pan (0, 0) in both. A resize and a flip to a drawing on
// other paper keep the desktop's pan (Viewport.resize, keepPan).
//
// WHERE THE WEB DIFFERS, on purpose (tests/zoom-floor.mjs KNOWN): its Fit
// keeps a 16 px margin, and Zoom to item fits its box inside it; F stays inside the zoom limits (the desktop's F
// does not, so on a sheet whose Fit is past a limit the two differ until a
// settle); on a floor the minimum zoom raised the readout says no "Fit" and
// a refusal says nothing, since the sheet does not fit there; with the
// Settings box off the picture windows zoom OUT without limit, as they did;
// and, box or no box, they zoom IN until a drawing pixel is 32 screen pixels
// (the sheet's own most), where the desktop stops at ten times the whole
// picture.
//
// Pure: no DOM, no settings object. The host says which drawing is up and
// how big it is, whether the Settings box is ticked, which sheet this is,
// and how to say the once-a-session sentence.

/** Float noise, not a zoom anyone could pick: two answers this close are the same view. */
export const FIT_EPS = 1e-6;

/**
 * How far two fingers must spread past where they were before a pinch held
 * at Fit lets go (and before a pinch allowed past Fit loses that right).
 * A finger at rest trembles a pixel or two; a sheet that let go on that
 * would slide off-centre and snap back on every tremble.
 */
export const PINCH_SPREAD_PX = 8;

/**
 * How far above Fit a pinch allowed past it may zoom before it has "risen
 * above Fit" and loses that right. The spread alone (PINCH_SPREAD_PX) is a
 * few percent of zoom with the fingers wide apart but a tenth of it with
 * them close together, so a small zoom in from close fingers counts too.
 */
export const PINCH_RISE = 1.03;

/**
 * Zoom to item (the desktop's zoom_to_measurement): the box is ITEM_BOX
 * times the item, never under ITEM_MIN_SHARE of the drawing either way, and
 * the zoom is capped at ITEM_MAX_ZOOM.
 */
export const ITEM_BOX = 1.8;
export const ITEM_MIN_SHARE = 0.12;
export const ITEM_MAX_ZOOM = 8;

/** The picture windows (Diff, a revision page on its own): desktop _RefCanvas. */
export const PICTURE_STEP = 1.15;
export const PICTURE_MIN = 0.5;
export const PICTURE_MAX = 10;
/**
 * ...but zooming IN goes on until a drawing pixel is this many screen pixels:
 * the sheet's own most (viewport.js MAX_ZOOM). Ten times the whole picture
 * alone left the Diff on a phone at half a screen pixel per drawing pixel,
 * its fine print out of reach.
 */
export const PICTURE_PIXEL_MAX = 32;

const DASH = '—';

/**
 * Which way a wheel event zooms: 'in', 'out', or null for no zoom at all.
 *
 * A tilt wheel, a sideways swipe and Alt+wheel arrive with no up or down in
 * them, and reading "not in" as out is what all three wheel handlers used
 * to do. But a browser delivers Shift+wheel SIDEWAYS too -- Chromium and
 * Firefox swap the axes on Shift, macOS does it for Safari -- so with Shift
 * held the sideways delta is the notch. Without that, Shift-past-Fit would
 * never fire and this guard would swallow it.
 */
export function wheelInOut(ev) {
  const d = (ev && ev.deltaY) || (ev && ev.shiftKey ? ev.deltaX : 0);
  if (!d || !Number.isFinite(d)) return null;
  return d < 0 ? 'in' : 'out';
}

/** The keys that take a notch past Fit: Shift, or Ctrl+Shift when the wheel scrolls. */
export function floorKeys(wheelMode) {
  return wheelMode === 'scroll' ? 'Ctrl+Shift' : 'Shift';
}

/**
 * The Settings box's words. The standard layout says exactly what the
 * desktop's SettingsDialog._zoom_floor_words says; the touch layout says
 * how a finger goes past, and then how a mouse does.
 */
export function zoomFloorWords(wheelMode, touch = false) {
  const keys = floorKeys(wheelMode);
  if (touch) {
    return 'Stop zooming out when the whole sheet fits the screen '
      + `(pinch out again to go further; ${keys}+wheel with a mouse)`;
  }
  return 'Stop zooming out when the whole sheet fits the screen '
    + `(hold ${keys} while scrolling to go further)`;
}

/** The box's tooltip: the desktop's, word for word. */
export const ZOOM_FLOOR_TIP =
  'The wheel, a pinch and the − button stop at Fit, so a sheet '
  + 'never shrinks past readable by accident.\n'
  + 'Shift+wheel goes further (Ctrl+Shift+wheel when the wheel '
  + 'scrolls the page).\n'
  + 'Shift is also the 0° / 45° / 90° lock while you '
  + 'draw: a point clicked with it still held snaps.';

/** What the minus button says (PDFCacheViewer._zoom_out_tip). */
export function zoomOutTip(stops, wheelMode) {
  if (!stops) return 'Zoom out';
  return `Zoom out ${DASH} stops when the whole sheet fits the screen. `
    + `Hold ${floorKeys(wheelMode)} while you scroll to go further.`;
}

/** The Shortcuts window's wheel line (the desktop's _wheel_help). */
export function wheelHelp(wheelMode, stops) {
  const scroll = (wheelMode || 'zoom') === 'scroll';
  let help = scroll ? `Ctrl+scroll ${DASH} zoom toward cursor`
    : `Scroll wheel ${DASH} zoom toward cursor`;
  if (stops) {
    help += '; zooming out stops when the whole sheet fits, '
      + `${scroll ? 'Ctrl+Shift' : 'Shift'}+scroll goes further`;
  }
  return help;
}

/** The Shortcuts window's pinch line: the touch rule (web only). */
export function pinchHelp(stops) {
  return stops
    ? 'Zoom about the fingers; zooming out stops when the whole sheet fits, '
      + 'a new pinch from there goes further'
    : 'Zoom about the fingers';
}

/**
 * Why the zoom stopped, said once a session. The wheel's words are the
 * desktop's (_say_zoom_floor_once); a pinch, or the minus button pressed by
 * a finger (`finger`: the press was a touch, or there is no mouse or
 * trackpad to scroll with), says how a finger goes on. Chosen by the INPUT,
 * not the layout: the touch layout is every browser's until it picks one,
 * and a mouse user there cannot pinch.
 */
export function zoomFloorLine(via, wheelMode, finger = false) {
  if (via === 'pinch' || (via !== 'wheel' && finger)) {
    return `The whole sheet fits the screen ${DASH} pinch out again to zoom out further`;
  }
  return `The whole sheet fits the screen ${DASH} hold ${floorKeys(wheelMode)} `
    + 'while you scroll to zoom out further';
}

/**
 * One pinch's say about the floor, from the second finger down to the lift.
 *
 * The touch stand-in for Shift: a NEW pinch that STARTS at Fit (or already
 * below it) may go past Fit, and loses that right once it has risen above
 * Fit within the same gesture -- so in-then-out still stops. A pinch that
 * has stopped at Fit HOLDS there, centred, with the two-finger drift
 * ignored, until the fingers spread again. Pure: the sheet and the picture
 * windows each apply what it says to their own view.
 *
 * ONE FINGER AT A TIME. A browser reports each finger's move as an event of
 * its own, so between the two the pair is half moved: two fingers sliding
 * together read as a pinch in, then as a spread, frame after frame, by as
 * much as they slide. So the hold reads the last TWO distances: a pinch in
 * is both of them closer than where it held, a spread is both of them wider
 * by PINCH_SPREAD_PX, and anything in between -- a slide, a tremble -- is
 * drift. (Zooming, which multiplies the steps, telescopes back to the same
 * zoom by itself; only the stop, which drops the steps out, has to know.)
 *
 * TWO FINGERS RESTING AT FIT ARE NOT A PINCH. A pinch that starts AT Fit
 * starts held there, with the right to go past: nothing moves -- no zoom,
 * no drift -- until both of the last two distances are PINCH_SPREAD_PX
 * closer than where the fingers landed (then it goes past Fit) or that much
 * wider (then it zooms in, and has risen above Fit). Without that, a 1-3 px
 * tremble inward of two fingers laid on the sheet was "past Fit by choice":
 * the readout lost Fit, minus stopped working, and turning the iPad no
 * longer refitted.
 *
 * ONLY A SHEET WHERE FIT PUTS IT IS KEPT THERE. At the Fit zoom with the
 * sheet dragged aside ('aside': the readout still says Fit), the zoom holds
 * the same way, but the drift is his: two fingers are the only way to pan
 * in a drawing tool, and holding them there kept the sheet OFF centre.
 *
 * THE BAND IS A THRESHOLD, NOT A LOSS. When a hold lets go, the zoom goes
 * by the whole way from where it held -- the fingers' distance then -- and
 * not from the last move inside the band: dropping those few pixels left
 * every pinch from Fit, where each sheet opens, 5-7% behind the fingers to
 * the end of the gesture, what was under them sliding out from under them.
 * And the sheet goes with them (drift): the move that lets go is the second
 * of the two that decided it, and the first, one finger's, shifted the point
 * between them by half its length while the sheet stood still. That is
 * carried now -- but only when what the sheet stood still through is no
 * more than the move that lets go: a slide made while held is the drift
 * the hold ignored, and stays ignored.
 */
export class PinchHold {
  /**
   * @param {number} dist  the fingers' distance as the pinch starts
   * @param {'at'|'aside'|'below'|'above'|null} start  where the view stands
   *   against Fit then (pinchPlace); null when nothing stops a zoom out
   */
  constructor(dist, start) {
    this.lastDist = dist > 0 ? dist : 1;
    this.prevDist = this.lastDist;
    const atFit = start === 'at' || start === 'aside';
    this.pastOk = atFit || start === 'below';
    // The last finger distance at which the view stood at or below Fit.
    this.fitDist = this.pastOk ? this.lastDist : null;
    this.held = atFit;
    // Whether the hold keeps the sheet still too, or only the zoom.
    this.still = start !== 'aside';
    this.holdDist = this.lastDist;
    // How far the point between the fingers slid while the sheet stood still.
    this.lostX = 0;
    this.lostY = 0;
  }

  /**
   * How far the sheet (or the picture) moves for the step `s` just taken
   * (step's answer), the point between the fingers having slid (dx, dy).
   */
  drift(s, dx = 0, dy = 0) {
    if (s.refused || (s.ignore && !s.pan)) {      // held still: the slide is ignored
      this.lostX += dx;
      this.lostY += dy;
      return [0, 0];
    }
    if (s.ignore) return [dx, dy];                // the zoom held, the sheet his
    // A move half made inside the band, or (more than this move) a slide.
    const carry = (lost, d) => (Math.abs(lost) <= Math.abs(d) + 1e-9 ? lost : 0);
    const out = [dx + carry(this.lostX, dx), dy + carry(this.lostY, dy)];
    this.lostX = 0;
    this.lostY = 0;
    return out;
  }

  /**
   * The fingers moved to `dist` apart. Returns {factor, past} to zoom by
   * (past: whether this zoom may go below Fit), or {refused: true} -- held
   * at Fit and still pinching in -- or {ignore: true}: held, and the
   * fingers only drifted. {ignore: true, pan: true}: the zoom is held, but
   * the sheet is not where Fit puts it, so the drift still moves it.
   */
  step(dist) {
    const d = dist > 0 ? dist : 1;
    const last = this.lastDist;
    this.prevDist = last;
    this.lastDist = d;
    if (this.held) {
      const hi = Math.max(d, last), lo = Math.min(d, last);
      if (this.pastOk) {
        // Landed at Fit: held until the fingers mean it, either way.
        if (hi >= this.holdDist - PINCH_SPREAD_PX && lo <= this.holdDist + PINCH_SPREAD_PX) {
          return this.still ? { ignore: true } : { ignore: true, pan: true };
        }
      } else {
        if (hi < this.holdDist) { this.holdDist = hi; return { refused: true }; }
        if (lo <= this.holdDist + PINCH_SPREAD_PX) return { ignore: true };
      }
      // Let go (the fingers spread again, or pinched in past the band): by
      // the whole way from where it held, so the zoom catches up to them.
      this.held = false;
      return { factor: d / this.holdDist, past: this.pastOk };
    }
    return { factor: d / last, past: this.pastOk };
  }

  /**
   * After a zoom step was applied: `ratio` is where it left the view, as
   * zoom / Fit (null when nothing stops a zoom out). Rising above Fit -- the
   * fingers PINCH_SPREAD_PX wider than where it last stood at Fit, or the
   * zoom PINCH_RISE above it, both read at the closer of the last two
   * distances (a slide half moved is no rise) -- costs the right to go past.
   */
  after(factor, ratio) {
    if (ratio === null || ratio === undefined) return;
    const atOrBelow = ratio <= 1 + FIT_EPS;
    const lo = Math.min(this.lastDist, this.prevDist);
    if (atOrBelow) {
      if (this.pastOk) this.fitDist = this.lastDist;
    } else if (this.pastOk && this.fitDist !== null
        && (lo > this.fitDist + PINCH_SPREAD_PX || ratio * lo / this.lastDist > PINCH_RISE)) {
      this.pastOk = false;                // rose above Fit: in-then-out stops
    }
    if (!this.pastOk && factor < 1 && atOrBelow) {
      // Stopped on Fit, which centres the sheet: held there, sheet and all.
      this.held = true;
      this.still = true;
      this.holdDist = Math.max(this.lastDist, this.prevDist);
    }
  }
}

/**
 * Where a zoom stands against a floor: 'at' it (to within FIT_EPS),
 * 'below' or 'above' it, or null when there is no floor.
 */
export function fitPlace(zoom, floor) {
  if (floor === null || floor === undefined || !(floor > 0)) return null;
  if (zoom > floor * (1 + FIT_EPS)) return 'above';
  return zoom < floor * (1 - FIT_EPS) ? 'below' : 'at';
}

/**
 * Where a pinch starts against Fit (PinchHold): fitPlace's answer, but
 * 'aside' for the Fit zoom with the sheet (or picture) not where Fit puts
 * it -- `centred` says whether it is.
 */
export function pinchPlace(place, centred) {
  return place === 'at' && !centred ? 'aside' : place;
}

export class ZoomFloor {
  /**
   * @param {import('./viewport.js').Viewport} vp
   * @param {{ size: () => ({w:number,h:number}|null),
   *           enabled: () => boolean,
   *           page?: () => number,
   *           drawingKey?: () => string,
   *           refused?: (via: string) => void,
   *           margin?: number, min?: number, max?: number }} host
   *   size: the drawing ON SCREEN, in page pixels (null: no sheet up).
   *   enabled: the Settings box. margin, min, max: the web's 16 px and its
   *   zoom limits by default; the truth diff runs the desktop's 0, 0.05, 10.
   */
  constructor(vp, host) {
    this.vp = vp;
    this.host = host;
    this.margin = host.margin ?? 16;
    this.min = host.min ?? 0.02;
    this.max = host.max ?? 32;
    this.base = null;          // _zoom_base: the zoom he last set himself
    this.baseFit = false;      // _zoom_base_fit: ...and it was Fit
    this.pastFit = false;      // _past_fit_by_choice
    this.pastFitZoom = null;   // _past_fit_zoom
    this.raise = null;         // _raise_rec: {page, key, zoom, base, baseFit}
  }

  _clamp(z) { return Math.min(this.max, Math.max(this.min, z)); }

  _size() {
    const s = this.host.size?.();
    return s && s.w > 0 && s.h > 0 ? s : null;
  }

  _refused(via) {
    // On a floor the zoom limit raised (below), "the whole sheet fits the
    // screen" would be untrue: the notch is simply the end of the zoom.
    if (!this._floorFits()) return;
    try { this.host.refused?.(via); } catch { /* a sentence is never a reason to fail a zoom */ }
  }

  /** Fit's zoom for a canvas of (cw, ch), unclamped: the whole drawing, inside the margin. */
  _rawFit(cw, ch, s = this._size()) {
    if (!s) return null;
    const m = this.margin;
    return Math.min((cw - 2 * m) / Math.max(s.w, 1), (ch - 2 * m) / Math.max(s.h, 1));
  }

  /** Fit's zoom for a canvas of (cw, ch), kept inside the zoom limits. */
  _fitZoom(cw, ch, s = this._size()) {
    const z = this._rawFit(cw, ch, s);
    return z === null ? null : this._clamp(z);
  }

  /**
   * Whether the floor really puts the whole drawing on screen. Not when
   * the minimum zoom raised it: a 36x24 sheet at 600 dpi on a phone has its
   * Fit under 2%, and there the readout must not say "Fit" of a sheet that
   * hangs off both sides, nor the refusal claim that it fits. (The maximum
   * only ever lowers the floor, and a sheet smaller than Fit still fits.)
   */
  _floorFits() {
    const f = this.floor();
    if (f === null) return false;
    const raw = this._rawFit(this.vp.width, this.vp.height);
    return raw !== null && raw >= f * (1 - FIT_EPS);
  }

  /**
   * The view that puts the whole drawing on screen, as a zoom and an
   * origin: the ONE Fit. `cw, ch` is a canvas size to ask it for in place of
   * the canvas's size now (the size it had before a resize).
   */
  fitView(cw = this.vp.width, ch = this.vp.height) {
    const s = this._size();
    if (!s) return null;
    const zoom = this._fitZoom(cw, ch, s);
    return { zoom, x: s.w / 2 - cw / (2 * zoom), y: s.h / 2 - ch / (2 * zoom) };
  }

  /** The zoom a plain notch out stops at, or null when nothing stops it. */
  floor() {
    if (!this.host.enabled() || !this._size() || !this.vp.measured) return null;
    return this._fitZoom(this.vp.width, this.vp.height);
  }

  atFloor() {
    const f = this.floor();
    return f !== null && Math.abs(this.vp.zoom - f) <= f * FIT_EPS;
  }

  /** The desktop's pan: the page centre's offset from the canvas centre, screen px. */
  _pan(s = this._size()) {
    const vp = this.vp, z = vp.zoom;
    const cx = vp.origin.x + vp.width / (2 * z);
    const cy = vp.origin.y + vp.height / (2 * z);
    return [(s.w / 2 - cx) * z, (s.h / 2 - cy) * z];
  }

  /** The sheet where Fit puts it -- centred: the web's Fit has no free rect. */
  _onFitPan() {
    const [px, py] = this._pan();
    return Math.abs(px) <= 0.5 && Math.abs(py) <= 0.5;
  }

  /** The view IS Fit: on the floor with the sheet where Fit puts it. */
  showsFit() { return this.atFloor() && this._onFitPan(); }

  /** Exactly on the floor, centred the way Fit centres the sheet. */
  landOnFit(f = this.floor()) {
    if (f === null) return;
    const s = this._size();
    this.vp.zoom = f;
    this.vp.centerOn(s.w / 2, s.h / 2);
  }

  /**
   * A notch out (factor < 1) against the floor. True when it was dealt with
   * here -- landed on Fit, put the sheet back in the middle, or refused --
   * and false to zoom the usual way.
   */
  takesNotch(factor, via = 'wheel') {
    const f = this.floor();
    if (f === null || factor >= 1) return false;
    const z = this.vp.zoom;
    if (z < f * (1 - FIT_EPS)) {
      // Already past it, by choice: nothing. Jumping up to Fit would be a
      // notch out that zoomed in.
      this._refused(via);
      return true;
    }
    if (Math.abs(z - f) <= f * FIT_EPS) {
      if (!this._onFitPan()) this.landOnFit(f);   // dragged aside: back to the middle
      else this._refused(via);
      return true;
    }
    if (z * factor <= f * (1 + FIT_EPS)) {
      this.landOnFit(f);                          // this notch would cross it
      return true;
    }
    return false;
  }

  /** Keep pastFit true to its name after a zoom, and pastFitZoom the zoom it stands at. */
  notePastFit(shiftOut) {
    const f = this.floor();
    if (f === null) {
      this.pastFit = false;
      this.pastFitZoom = null;
    } else if (this.vp.zoom >= f * (1 - FIT_EPS)) {
      this.pastFit = false;
      if (this.pastFitZoom !== null && this.pastFitZoom < f * (1 - FIT_EPS)) {
        this.pastFitZoom = null;
      }
    } else if (shiftOut) {
      this.pastFit = true;
    }
    if (this.pastFit) this.pastFitZoom = this.vp.zoom;
  }

  /** True while the zoom he chose is one Shift (or a fresh pinch) took past Fit. */
  belowFitByChoice() {
    if (this.floor() === null) { this.pastFit = false; this.pastFitZoom = null; }
    return this.pastFit;
  }

  /**
   * He set this zoom himself. `before` is the zoom ahead of a notch: a notch
   * that changed nothing chose nothing. `fit`: he went to Fit himself.
   */
  chosen(before = null, fit = false) {
    const z = this.vp.zoom;
    if (before !== null && Math.abs(z - before) <= before * FIT_EPS) return;
    this.notePastFit(false);
    const pz = this.pastFitZoom;
    if (pz !== null && Math.abs(z - pz) <= pz * FIT_EPS) this.pastFit = true;
    const rec = this.isTurnRaise(z);
    if (rec) { this.base = rec.base; this.baseFit = rec.baseFit; return; }
    this.base = z;
    this.baseFit = !!fit;
  }

  /** The raise that put this sheet up at `zoom` on a page turn, or null. */
  isTurnRaise(zoom) {
    const r = this.raise;
    if (!r || r.page !== this.host.page?.()
        || Math.abs(zoom - r.zoom) > r.zoom * FIT_EPS) return null;
    return r;
  }

  /** Zoom to `next` keeping the page point under (sx, sy) where it is. */
  _zoomAbout(sx, sy, next) {
    const vp = this.vp;
    const [px, py] = vp.toPage(sx, sy);
    vp.zoom = next;
    vp.origin.x = px - sx / next;
    vp.origin.y = py - sy / next;
  }

  // ── what the inputs call ──────────────────────────────────────────────

  /**
   * Every anchored zoom: the wheel and the pinch (the desktop's _zoom_about).
   * `pastFit` is Shift on the wheel, or a pinch allowed past: it goes on.
   * `via` says which words a refusal is said in.
   */
  zoomAt(sx, sy, factor, pastFit = false, via = 'wheel') {
    if (!this._size()) return;
    const before = this.vp.zoom;
    if (factor < 1 && !pastFit && this.takesNotch(factor, via)) {
      this.chosen(before, true);   // the only zoom the floor moves him to is Fit
      return;
    }
    this._zoomAbout(sx, sy, this._clamp(before * factor));
    this.notePastFit(pastFit && factor < 1);
    this.chosen(before);
  }

  /** The minus button (zoom_out): the wheel's floor, and never past it. */
  zoomOut() {
    const before = this.vp.zoom;
    if (this.takesNotch(1 / 1.2, 'button')) { this.chosen(before, true); return; }
    this._zoomAbout(this.vp.width / 2, this.vp.height / 2,
      Math.max(before / 1.2, this.min));
    this.chosen();
  }

  /** The plus button (zoom_in). */
  zoomIn() {
    this._zoomAbout(this.vp.width / 2, this.vp.height / 2,
      Math.min(this.vp.zoom * 1.2, this.max));
    this.chosen();
  }

  /** F and every Fit button (zoom_fit). False while there is nothing to fit into. */
  fit() {
    if (!this.vp.measured) return false;
    const fv = this.fitView();
    if (!fv) return false;
    this.vp.zoom = fv.zoom;
    this.vp.origin.x = fv.x;
    this.vp.origin.y = fv.y;
    this.pastFit = false;
    this.pastFitZoom = null;
    this.raise = null;             // F is Fit on purpose, on a raised sheet too
    this.chosen(null, true);
    return true;
  }

  /** A job (or, until page turns keep the zoom, a sheet) comes up at its default zoom. */
  opening() { this.pastFit = false; this.pastFitZoom = null; this.raise = null; }

  /**
   * Zoom to an item at `z`, centred on (cx, cy) -- but never out past the
   * whole sheet while the floor is on (zoom_to_measurement): a count spread
   * across the sheet asks for a box bigger than the sheet, and lands on Fit.
   * The zoom is then a number, not Fit, exactly as on the desktop.
   */
  zoomToZoom(z, cx, cy) {
    const f = this.floor();
    if (f !== null && z < f) { this.landOnFit(f); this.chosen(); return; }
    this.vp.zoom = this._clamp(z);
    this.vp.centerOn(cx, cy);
    this.chosen();
  }

  /**
   * Zoom to an item (zoom_to_measurement), from its points and its type:
   * centred on its box, ITEM_BOX times its size but never under
   * ITEM_MIN_SHARE of the drawing either way -- so a single count and a
   * straight run have a box too -- the zoom capped at ITEM_MAX_ZOOM, inside
   * the margin, and never out past the whole sheet (zoomToZoom). A note is
   * framed by its box, its second point. False when there is nothing to
   * zoom to: no drawing up, no canvas yet, or no points.
   */
  zoomToItem(points, type = '') {
    const s = this._size();
    const pts = Array.isArray(points)
      ? points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
    if (!s || !this.vp.measured || !pts.length) return false;
    let cx, cy, bw, bh;
    if (type === 'textnote' && pts.length >= 2) {
      [cx, cy] = pts[1];
      bw = s.w * ITEM_MIN_SHARE;
      bh = s.h * ITEM_MIN_SHARE;
    } else {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      cx = (x0 + x1) / 2;
      cy = (y0 + y1) / 2;
      bw = Math.max(x1 - x0, 1) * ITEM_BOX;
      bh = Math.max(y1 - y0, 1) * ITEM_BOX;
    }
    bw = Math.max(bw, s.w * ITEM_MIN_SHARE);
    bh = Math.max(bh, s.h * ITEM_MIN_SHARE);
    const m = this.margin;
    const z = Math.min((this.vp.width - 2 * m) / bw, (this.vp.height - 2 * m) / bh, ITEM_MAX_ZOOM);
    if (!(z > 0)) return false;
    this.zoomToZoom(z, cx, cy);
    return true;
  }

  /**
   * The drawing on screen was swapped for one of another size -- a
   * revision on other paper flipped up, or back -- from `old` ({w, h}).
   * The desktop's flip keeps zoom and pan (set_page_preview), and its pan
   * is the page centre's offset from the canvas centre: so the new drawing
   * sits where the old one's centre did, a centred sheet stays centred.
   * The web's origin is the page point at the top-left, which on its own
   * left a smaller drawing off in the corner.
   */
  keepPan(old) {
    const s = this._size();
    if (!old || !(old.w > 0) || !(old.h > 0) || !s || !this.vp.measured) return;
    if (old.w === s.w && old.h === s.h) return;
    const [px, py] = this._pan(old);
    const z = this.vp.zoom;
    this.vp.centerOn(s.w / 2 - px / z, s.h / 2 - py / z);
  }

  /**
   * Where the view stands now, to ask later whether anything has moved it
   * (unmoved): the drawing on screen, whether it is at Fit, the zoom and the
   * desktop's pan. Null while there is no drawing or no canvas.
   */
  mark() {
    const s = this._size();
    if (!s || !this.vp.measured) return null;
    return { size: s, fit: this.showsFit(), zoom: this.vp.zoom, pan: this._pan(s) };
  }

  /**
   * Whether the view is still where `m` (mark) left it -- the drawing on
   * screen swapped for one on other paper meanwhile or not: that swap keeps
   * the zoom and the pan (keepPan), so it is no move. A view that was at
   * Fit is still there when it is at that drawing's Fit for the canvas NOW,
   * centred: a change of size keeps Fit as Fit (resized), and that is no
   * move of his either. Anything else he did -- a zoom, a drag -- is.
   */
  unmoved(m) {
    const s = this._size();
    if (!m || !s || !this.vp.measured) return false;
    const zoom = m.fit ? this._fitZoom(this.vp.width, this.vp.height, m.size) : m.zoom;
    const [ox, oy] = m.fit ? [0, 0] : m.pan;
    const [px, py] = this._pan(s);
    return Math.abs(this.vp.zoom - zoom) <= zoom * FIT_EPS
      && Math.abs(px - ox) <= 0.5 && Math.abs(py - oy) <= 0.5;
  }

  /**
   * A page turn has landed (_turn_zoom_settle). `chose` is belowFitByChoice()
   * asked of the sheet being LEFT; the caller has already centred the new
   * drawing at the zoom it had (what the desktop's set_page does). Not wired
   * yet: page turns keeping his zoom is the next round of the port.
   */
  turnSettle(chose) {
    this.raise = null;
    const f = this.floor();
    if (f === null) return;
    const s = this._size();
    if (!chose && this.baseFit) { this.landOnFit(f); return; }
    if (!chose && this.base !== null) {
      this.vp.zoom = this.base;
      this.vp.centerOn(s.w / 2, s.h / 2);
    }
    const z = this.vp.zoom;
    if (Math.abs(z - f) <= f * FIT_EPS) this.landOnFit(f);
    else if (z < f * (1 - FIT_EPS) && !chose) {
      this.raise = { page: this.host.page?.(), key: this.host.drawingKey?.() ?? '',
                     zoom: f, base: this.base, baseFit: this.baseFit };
      this.landOnFit(f);
    }
  }

  /**
   * The canvas changed size from (pw, ph): _canvas_resized. The viewport
   * has already kept the centre (as the desktop's pan model does by itself),
   * so a view at the old Fit is pan (0, 0) at the old Fit's zoom, and is put
   * at the NEW Fit. Any other view is left as it was.
   */
  resized(pw, ph) {
    if (!this.host.enabled() || !this._size() || !this.vp.measured) return;
    if (pw === this.vp.width && ph === this.vp.height) return;
    const old = this._fitZoom(pw, ph);
    const eps = old * FIT_EPS;
    const z = this.vp.zoom;
    const [px, py] = this._pan();
    if (Math.abs(z - old) <= eps && Math.abs(px) <= 0.5 && Math.abs(py) <= 0.5) {
      // His own Fit stays his choice at the new size; a Fit a page turn
      // raised him to stays the turn's.
      const his = !this.baseFit && this.base !== null && Math.abs(this.base - z) <= eps;
      const raised = this.isTurnRaise(z);
      this.landOnFit();
      if (his) this.chosen();
      else if (raised) this.raise = { ...raised, zoom: this.vp.zoom };
    }
  }

  /** A pinch starts: its say about the floor (see PinchHold). */
  pinchStart(dist) {
    const f = this.floor();
    return new PinchHold(dist, pinchPlace(fitPlace(this.vp.zoom, f), f !== null && this._onFitPan()));
  }

  /**
   * A pinch moved: (sx, sy) the point between the fingers on the canvas,
   * (dx, dy) how far it slid, `dist` the fingers' distance now.
   */
  pinchMove(hold, { sx, sy, dx = 0, dy = 0, dist }) {
    const s = hold.step(dist);
    // Held at Fit the drift is ignored -- unless the sheet is not where Fit
    // puts it, and then there is nothing to keep it at (PinchHold.drift).
    const [mx, my] = hold.drift(s, dx, dy);
    if (s.refused) { this._refused('pinch'); return; }
    if (mx || my) this.vp.panBy(mx, my);
    if (s.ignore) return;
    this.zoomAt(sx, sy, s.factor, s.past, 'pinch');
    const f = this.floor();
    hold.after(s.factor, f === null ? null : this.vp.zoom / f);
  }

  /**
   * The readout: "Fit 21%" on the floor, the number alone anywhere else --
   * and on a floor the minimum zoom raised, where the sheet does not fit.
   */
  label() {
    const pct = `${Math.round(this.vp.zoom * 100)}%`;
    return this.atFloor() && this._floorFits() ? `Fit ${pct}` : pct;
  }
}

// ── the picture windows ────────────────────────────────────────────────────
//
// The Diff and a revision page on its own (desktop _RefCanvas). A view is
// { vz, px, py }: vz the zoom relative to the picture's own fit -- 1 IS the
// whole picture -- and (px, py) how far the picture sits off centre, screen
// px. Fit has no margin there, as on the desktop.

/** The scale that puts the whole picture in the box. */
export function pictureFit(box, pic) {
  return Math.min(Math.max(box.w, 1) / Math.max(pic.w, 1),
                  Math.max(box.h, 1) / Math.max(pic.h, 1));
}

/** Where the picture is drawn for a view: its top-left and its scale. */
export function pictureRect(v, box, pic) {
  const scale = pictureFit(box, pic) * v.vz;
  return { scale, x: (box.w - pic.w * scale) / 2 + v.px,
           y: (box.h - pic.h * scale) / 2 + v.py };
}

/**
 * How far in a picture window zooms: until a drawing pixel is
 * PICTURE_PIXEL_MAX screen pixels, the sheet's own most -- or ten times the
 * whole picture (the desktop's _RefCanvas), if that is further.
 */
export function pictureMaxZoom(box, pic) {
  return Math.max(PICTURE_MAX, PICTURE_PIXEL_MAX / pictureFit(box, pic));
}

/**
 * One zoom step in a picture window (_RefCanvas.wheelEvent). A plain step
 * out stops at the whole picture, centred; `past` (Shift, or a fresh pinch
 * from Fit) goes on down to half of it. `stops` is the Settings box, which
 * is about zooming OUT: unticked, nothing stops a zoom out, as the web's
 * picture windows never did (the desktop keeps its half whatever the box
 * says -- a declared difference). Zooming in stops at pictureMaxZoom, box
 * or no box; the desktop's ten times the whole picture left the Diff on a
 * phone short of the drawing's own pixels.
 * `dead`: a step this small is no step (the desktop's 0.001; a pinch,
 * whose steps are a few pixels each, passes 0 so none is lost).
 * Returns { v, refused }.
 */
export function pictureZoom(v, factor, sx, sy, box, pic,
  { past = false, stops = true, dead = 0.001 } = {}) {
  if (factor < 1 && !past && stops) {
    if (v.vz < 1 - 1e-6) return { v, refused: true };   // past it by choice: never jump up
    if (v.vz * factor <= 1 + 1e-6) {
      // Landing on it, or on it already with the picture dragged aside.
      if (v.vz === 1 && v.px === 0 && v.py === 0) return { v, refused: true };
      return { v: { vz: 1, px: 0, py: 0 }, refused: false };
    }
  }
  // In stops at the limit -- but never below where it is: a window grown
  // since (an iPad turned) lowers the limit under a picture zoomed in, and a
  // step in that zoomed it out would be a step in the wrong way.
  const want = factor > 1 ? Math.max(v.vz, Math.min(pictureMaxZoom(box, pic), v.vz * factor)) : v.vz * factor;
  const nz = stops ? Math.max(PICTURE_MIN, want) : want;
  if (!(nz > 0) || !Number.isFinite(nz)) return { v, refused: false };
  if (Math.abs(nz - v.vz) < dead || nz === v.vz) return { v, refused: false };
  const base = pictureFit(box, pic);
  const oldS = base * v.vz, newS = base * nz;
  const ox = (box.w - pic.w * oldS) / 2 + v.px;
  const oy = (box.h - pic.h * oldS) / 2 + v.py;
  const ratio = newS / oldS;
  return {
    v: { vz: nz,
         px: sx - ratio * (sx - ox) - (box.w - pic.w * newS) / 2,
         py: sy - ratio * (sy - oy) - (box.h - pic.h * newS) / 2 },
    refused: false,
  };
}
