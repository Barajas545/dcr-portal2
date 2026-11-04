// markers.js — the four symbols the takeoff tools drop on a drawing.
//
// All four are drawn in SCREEN SPACE and sized by marker_scale only. They do
// NOT grow with zoom: a sheet carrying six hundred count bubbles has to stay
// readable at every magnification, and a marker that scaled would either
// vanish or swallow the drawing.
//
// marker_scale is a per-user View setting, 0.6 to 2.2, default 1.0.

import { rgba, brighten } from './theme.js';

export const MARKER_SCALE_MIN = 0.6;
export const MARKER_SCALE_MAX = 2.2;
export const MARKER_STEPS = [0.6, 0.8, 1.0, 1.35, 1.7, 2.2];

export function clampMarkerScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1.0;
  return Math.min(MARKER_SCALE_MAX, Math.max(MARKER_SCALE_MIN, n));
}

/** A plain filled dot. Used for vertices and as the door's hinge. */
export function drawEndpointDot(ctx, x, y, color, radius = 4.0, ms = 1) {
  const r = radius * ms;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = rgba(color, color.length > 3 ? color[3] : 1);
  ctx.fill();
}

/** The count bubble: a disc at 0.85 alpha under a brighter 1.5px rim. */
export function drawCountMarker(ctx, x, y, color, radius = 8.0, ms = 1) {
  const r = radius * ms;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = rgba(color, 0.85);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(brighten(color, 0.3), 1);
  ctx.stroke();
}

/** The window symbol: a glazed square with a mullion cross. */
export function drawWindowMarker(ctx, x, y, color, size = 9.0, ms = 1) {
  const s = size * ms;
  ctx.beginPath();
  ctx.rect(x - s, y - s, s * 2, s * 2);
  ctx.fillStyle = rgba(color, 0.30);
  ctx.fill();
  ctx.lineWidth = 2.0;
  ctx.strokeStyle = rgba(color, 1);
  ctx.stroke();

  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
  ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
  ctx.stroke();
}

/**
 * The door symbol: a leaf standing open at 90°, its threshold, and the swing
 * arc between them. The hinge is the bottom-left corner.
 */
export function drawDoorMarker(ctx, x, y, color, size = 9.0, ms = 1) {
  const s = size * ms;
  const hx = x - s, hy = y + s;

  ctx.lineWidth = 2.0;
  ctx.strokeStyle = rgba(color, 1);
  ctx.beginPath();
  ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - 2 * s);
  ctx.stroke();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.beginPath();
  ctx.moveTo(hx, hy); ctx.lineTo(hx + 2 * s, hy);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(hx, hy, 2 * s, -Math.PI / 2, 0);
  ctx.stroke();

  // The hinge dot takes marker_scale a second time, exactly as the desktop
  // app does — the pip stays proportional to the symbol rather than the sheet.
  drawEndpointDot(ctx, hx, hy, [color[0], color[1], color[2], 1], 3.0, ms);
}

/** Draw whichever marker a type calls for. */
export function drawMarkerFor(type, ctx, x, y, color, ms = 1, opts = {}) {
  switch (type) {
    case 'window':
      return drawWindowMarker(ctx, x, y, color, opts.size ?? 9.0, ms);
    case 'door':
      return drawDoorMarker(ctx, x, y, color, opts.size ?? 9.0, ms);
    case 'linear_count':
      return drawCountMarker(ctx, x, y, color, opts.radius ?? 6.0, ms);
    case 'count':
    default:
      return drawCountMarker(ctx, x, y, color, opts.radius ?? 8.0, ms);
  }
}

// ── selection and editing handles ─────────────────────────────────────────
//
// These are sized by the UI scale, not by marker_scale: they are chrome, and
// touch mode makes every grab target bigger without touching the drawing.

export const HANDLE_R = 7.0;
export const HANDLE_R_HOVER = 9.0;
export const GRAB_RADIUS = 10.0;

export function drawVertexHandle(ctx, x, y, { state = 'idle', uiScale = 1 } = {}) {
  const r = (state === 'idle' ? HANDLE_R : HANDLE_R_HOVER) * uiScale;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = state === 'drag' ? 'rgba(255,255,0,1)'
                : state === 'hover' ? 'rgba(255,255,255,1)'
                : 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(20,20,20,0.9)';
  ctx.stroke();
}

/** The small square grip a CAD entity or a bounding box shows. */
export function drawGrip(ctx, x, y, { hot = false, uiScale = 1 } = {}) {
  const r = 4 * uiScale;
  ctx.beginPath();
  ctx.rect(x - r, y - r, r * 2, r * 2);
  ctx.fillStyle = hot ? 'rgba(255,217,51,0.95)' : 'rgb(51,107,204)';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.stroke();
}

/** The green cross that marks an object snap. */
export function drawSnapMarker(ctx, x, y, kind = 'end') {
  const r = 6;
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = 'rgba(51,255,77,0.95)';
  ctx.beginPath();
  if (kind === 'mid') {
    ctx.moveTo(x - r, y + r * 0.7);
    ctx.lineTo(x, y - r * 0.8);
    ctx.lineTo(x + r, y + r * 0.7);
    ctx.closePath();
  } else if (kind === 'center') {
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
  } else if (kind === 'perp') {
    ctx.moveTo(x - r, y + r); ctx.lineTo(x - r, y - r);
    ctx.moveTo(x - r, y + r); ctx.lineTo(x + r, y + r);
  } else if (kind === 'intersect') {
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  } else {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  }
  ctx.stroke();
}
