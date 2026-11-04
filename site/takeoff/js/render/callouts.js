// callouts.js — the detail-reference bubble.
//
// A callout is the commonest mark in a real project: 352 of them across the
// estimator's live library, more than every other item type combined. It is a
// translucent disc split across the middle, the detail number above the line
// and the sheet number below — drawn the way an architect draws it, so it
// reads as the thing it stands in for.
//
// TWO DELIBERATE CHOICES that look like bugs if you change them:
//
//  · The disc is TRANSLUCENT. It sits on top of the drawing, and an opaque one
//    would hide the very linework the callout points at.
//  · Every callout on a sheet is the SAME SIZE. The type shrinks to fit inside
//    the bubble rather than the bubble growing to fit the type, so "A2.1.03"
//    and "S4" come out identical instead of one being four times the other.
//
// A callout is a paper-space symbol: on the sheet it is a fixed fraction of an
// inch, so it grows and shrinks with the drawing. Drawn at a fixed pixel size
// it looked right at working zoom and swelled to cover a tenth of the sheet as
// soon as the estimator zoomed out to see the whole plan.

import { darken, rgba } from './theme.js';

export const CALLOUT_DEFAULT_IN = 0.75;   // a standard callout, in sheet inches
export const CALLOUT_MIN_PX = 9;          // never smaller than a legible dot…
export const CALLOUT_MAX_PX = 420;        // …and never big enough to hide the plan
export const CALLOUT_FILL_DEFAULT = '#cfe4f7';
export const CALLOUT_ALPHA = 165;

const FONT_FAMILY = "'Segoe UI', 'Inter', system-ui, sans-serif";

/**
 * Half the bubble's width ON SCREEN.
 * @param {object} o
 * @param {'paper'|'screen'} o.mode
 * @param {number} o.inches   size on the sheet, paper mode
 * @param {number} o.dpi      the resolution sheets were rendered at
 * @param {number} o.zoom
 * @param {number} o.markerScale  used only in screen mode
 */
export function calloutRadius({ mode = 'paper', inches = CALLOUT_DEFAULT_IN, dpi = 150, zoom = 1, markerScale = 1 }) {
  if (mode !== 'paper') return 13 * markerScale;
  const d = inches * dpi * zoom;
  return Math.max(CALLOUT_MIN_PX, Math.min(CALLOUT_MAX_PX, d)) / 2;
}

/** "#rrggbb" → [r,g,b], falling back rather than leaving the disc unpainted. */
export function calloutFillRgb(value) {
  const s = String(value || '').trim() || CALLOUT_FILL_DEFAULT;
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  const hex = m ? m[1] : CALLOUT_FILL_DEFAULT.slice(1);
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * Draw one callout, centred on a screen point.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx
 * @param {number} sy
 * @param {number} radius     half the bubble's screen width
 * @param {string} detail     the number above the line
 * @param {string} sheet      the number below it
 * @param {[number,number,number,number]} color  the item's colour, 0–1
 * @param {object} [opts]
 */
export function drawCallout(ctx, sx, sy, radius, detail, sheet, color, opts = {}) {
  const { fill = CALLOUT_FILL_DEFAULT, alpha = CALLOUT_ALPHA, selected = false } = opts;
  const r = Math.max(4, radius);
  const sc = Math.max(0.5, r / 26);
  const top = String(detail || '').trim();
  const bot = String(sheet || '').trim();

  // The ring takes the item's colour, darkened: the palette is picked to read
  // on a dark canvas, and this disc is light.
  const ink = darken(color, 0.45);
  const [fr, fg, fb] = calloutFillRgb(fill);

  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${fr},${fg},${fb},${alpha / 255})`;
  ctx.fill();
  ctx.lineWidth = Math.max(1.6, 2.0 * sc);
  ctx.strokeStyle = rgba(ink, 1);
  ctx.stroke();

  ctx.fillStyle = 'rgb(20,20,20)';
  ctx.textAlign = 'center';

  if (top && bot) {
    // The dividing line is a chord of the circle, not a full diameter.
    const half = r - 2;
    ctx.lineWidth = Math.max(1.4, 1.8 * sc);
    ctx.beginPath();
    ctx.moveTo(sx - half, sy);
    ctx.lineTo(sx + half, sy);
    ctx.stroke();

    const ptTop = fitPt(ctx, top, r * 2 - 8 * sc, 14 * sc, 5);
    const ptBot = fitPt(ctx, bot, r * 2 - 8 * sc, 12 * sc, 4);
    ctx.textBaseline = 'bottom';
    ctx.font = `bold ${ptTop}px ${FONT_FAMILY}`;
    ctx.fillText(top, sx, sy - 2 * sc);
    ctx.textBaseline = 'top';
    ctx.font = `bold ${ptBot}px ${FONT_FAMILY}`;
    ctx.fillText(bot, sx, sy + 2 * sc);
  } else {
    // Only one of the two is known — no line to draw, and the one number
    // there is gets the whole disc rather than half of it.
    const only = top || bot || '?';
    const pt = fitPt(ctx, only, r * 2 - 8 * sc, 16 * sc, 5);
    ctx.font = `bold ${pt}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(only, sx, sy);
  }

  if (selected) {
    ctx.beginPath();
    ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
    ctx.lineWidth = 3.0;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();
  }
  ctx.restore();
}

/** The largest point size at which `text` still fits inside `maxWidth`. */
function fitPt(ctx, text, maxWidth, startPt, minPt) {
  let pt = Math.max(minPt, startPt);
  ctx.font = `bold ${pt}px ${FONT_FAMILY}`;
  while (pt > minPt && ctx.measureText(text).width > maxWidth) {
    pt -= 0.5;
    ctx.font = `bold ${pt}px ${FONT_FAMILY}`;
  }
  return pt;
}

/**
 * A callout's leader, when it has one. `arrow` is the page-space point the
 * bubble points at; the line stops at the disc's edge rather than crossing it.
 */
export function drawCalloutLeader(ctx, sx, sy, r, tipX, tipY, color) {
  const dx = tipX - sx, dy = tipY - sy;
  const len = Math.hypot(dx, dy);
  if (len <= r + 2) return;
  const ux = dx / len, uy = dy / len;
  const ink = darken(color, 0.45);
  ctx.save();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = rgba(ink, 0.95);
  ctx.beginPath();
  ctx.moveTo(sx + ux * r, sy + uy * r);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  // A small solid head, so the callout reads as pointing rather than tethered.
  const hl = 9, hw = 4.5;
  const px = -uy, py = ux;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * hl + px * hw, tipY - uy * hl + py * hw);
  ctx.lineTo(tipX - ux * hl - px * hw, tipY - uy * hl - py * hw);
  ctx.closePath();
  ctx.fillStyle = rgba(ink, 0.95);
  ctx.fill();
  ctx.restore();
}
