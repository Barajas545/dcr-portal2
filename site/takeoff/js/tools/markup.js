// markup.js — the marking-up tools: pen, highlighter, box, eraser, note, callout.
//
// Markup is not takeoff. It goes in `annotations`, not `measurements`; it has
// no quantity, no unit and no cost; it appears in no report. It is what an
// estimator scribbles on a sheet to think with.
//
// TWO EXCEPTIONS, both inherited from the desktop and both load-bearing:
//
//   textnote  lives in MEASUREMENTS, not annotations, even though it is markup
//             in every other sense. Moving it would change where it lands in a
//             saved file and the desktop app would stop seeing it.
//   page_ref  the detail callout, likewise in measurements. It is the commonest
//             mark in the estimator's real library — 352 of them.
//
// Every one of these was already RENDERABLE before this file existed; what was
// missing was any way to make one.

import { distToSegment } from '../core/geom.js';

export const MARKUP_TOOLS = [
  ['draw', 'Pen'],
  ['highlight', 'Highlight'],
  ['highlight_rect', 'Box'],
  ['erase', 'Erase'],
  ['textnote', 'Note'],
  ['page_ref', 'Callout'],
];

export const MARKUP_HINTS = {
  draw: 'Drag to draw on the sheet.',
  highlight: 'Drag to highlight. Hold Shift to keep the stroke straight.',
  highlight_rect: 'Drag a box over what you want to highlight.',
  erase: 'Drag over a highlight or a pen stroke to remove it.\nTakeoff items are never erased by this.',
  textnote: 'Click what the note is about, then drag to where the note should sit.',
  page_ref: 'Click where the callout goes, then enter the detail and sheet it points to.',
};

/** The four highlighter colours, exactly the desktop's. */
export const HIGHLIGHT_COLORS = [
  ['Yellow', [1.0, 1.0, 0.0, 0.4]],
  ['Green', [0.0, 1.0, 0.0, 0.4]],
  ['Pink', [1.0, 0.0, 1.0, 0.4]],
  ['Blue', [0.2, 0.6, 1.0, 0.4]],
];

/** The three pen colours. */
export const PEN_COLORS = [
  ['Red', [1.0, 0.0, 0.0, 1.0]],
  ['Black', [0.0, 0.0, 0.0, 1.0]],
  ['Blue', [0.0, 0.3, 1.0, 1.0]],
];

export const DEFAULT_HIGHLIGHT_WIDTH = 14;
export const DEFAULT_PEN_WIDTH = 3;
export const ERASER_RADIUS_PX = 20;      // screen pixels
export const NOTE_DEFAULT_COLOR = [1.0, 220 / 255, 50 / 255, 1.0];

/** A stroke is only worth keeping once it has somewhere to go. */
export const MIN_STROKE_POINTS = 2;
/** A box highlight under a couple of pixels either way is a stray click. */
export const MIN_RECT_PX = 2;

/**
 * The live markup state: what is being drawn right now.
 *
 * Held apart from the takeoff controller's `current` because the two are
 * different shapes — a stroke is a growing point list with a colour and a
 * width, a box is two corners, a note is a tip and a destination.
 */
export class MarkupState {
  constructor() {
    this.stroke = null;      // {points, color, width, subtype}
    this.rectStart = null;
    this.rectCur = null;
    this.eraserPos = null;
    this.noteTip = null;
    this.noteCur = null;
    this.drawing = false;
  }

  clear() {
    this.stroke = null;
    this.rectStart = null;
    this.rectCur = null;
    this.eraserPos = null;
    this.noteTip = null;
    this.noteCur = null;
    this.drawing = false;
  }

  get active() {
    return this.drawing || !!this.noteTip;
  }
}

/** A new freehand stroke, ready to grow. */
export function beginStroke(page, color, width) {
  return {
    points: [page.slice()],
    color: color.slice(),
    width,
    visible: true,
    subtype: 'stroke',
  };
}

/**
 * Extend a stroke, dropping points too close to the last one.
 *
 * A pointer at 240 Hz over a 6000-pixel sheet produces thousands of points a
 * second, and every one is stored in the file and re-stroked every frame. One
 * page pixel of movement is well below what anyone can see.
 */
export function extendStroke(stroke, page, minStepPx = 1.0) {
  const last = stroke.points[stroke.points.length - 1];
  if (Math.hypot(page[0] - last[0], page[1] - last[1]) < minStepPx) return false;
  stroke.points.push(page.slice());
  return true;
}

/** The rect an in-progress box highlight describes, normalised. */
export function rectFrom(a, b) {
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    w: Math.abs(b[0] - a[0]),
    h: Math.abs(b[1] - a[1]),
  };
}

export function rectIsWorthKeeping(a, b) {
  return Math.abs(a[0] - b[0]) > MIN_RECT_PX && Math.abs(a[1] - b[1]) > MIN_RECT_PX;
}

/**
 * Which annotations the eraser is touching.
 *
 * CAD entities are never erased — the desktop's eraser does not touch them,
 * and this app cannot draw them yet, so silently deleting them would destroy
 * work with nothing on screen to show for it.
 */
export function annotationsUnderEraser(list, page, radiusPage) {
  const [px, py] = page;
  const hits = [];
  for (const a of list) {
    if (a.visible === false) continue;
    const subtype = a.subtype || 'stroke';
    if (subtype === 'cad') continue;
    const pts = a.points || [];
    if (subtype === 'rect') {
      if (pts.length < 2) continue;
      const x0 = Math.min(pts[0][0], pts[1][0]) - radiusPage;
      const x1 = Math.max(pts[0][0], pts[1][0]) + radiusPage;
      const y0 = Math.min(pts[0][1], pts[1][1]) - radiusPage;
      const y1 = Math.max(pts[0][1], pts[1][1]) + radiusPage;
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) hits.push(a);
      continue;
    }
    // A freehand stroke is hit when the eraser reaches any leg of its path,
    // widened by half the stroke's own width — a fat highlighter should erase
    // where it looks like it is, not where its centreline runs.
    const pad = radiusPage + (Number(a.width) || 0) / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      if (distToSegment(px, py, ax, ay, bx, by) <= pad) { hits.push(a); break; }
    }
    if (pts.length === 1 && Math.hypot(px - pts[0][0], py - pts[0][1]) <= pad) {
      hits.push(a);
    }
  }
  return hits;
}

/** A text note, in the shape the desktop writes. */
export function makeTextNote({ tip, notePos, text, color, fontSize, category }) {
  return {
    type: 'textnote',
    points: [tip.slice(), notePos.slice()],
    text: String(text || ''),
    color: (color || NOTE_DEFAULT_COLOR).slice(),
    font_size: Number(fontSize) || 12,
    note_category: String(category || ''),
    visible: true,
  };
}

/** A detail callout pin. */
export function makeCallout({ at, detail, sheet, refPage, color, arrow }) {
  const m = {
    type: 'page_ref',
    points: [at.slice()],
    detail: String(detail || '').trim(),
    ref_page_label: String(sheet || '').trim(),
    label: [String(detail || '').trim(), String(sheet || '').trim()]
      .filter(Boolean).join('/'),
    color: (color || [0.2, 0.55, 1.0, 1.0]).slice(),
    visible: true,
  };
  if (Number.isInteger(refPage) && refPage >= 0) m.ref_page = refPage;
  if (arrow && arrow.length >= 2) m.arrow = arrow.slice();
  return m;
}
