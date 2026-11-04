// theme.js — every colour the drawing surface uses, taken from the desktop app.
//
// Item colours are stored as RGBA FLOATS 0–1, four to an array, because that is
// what the OpenGL renderer wanted and what is already sitting in every saved
// project. Nothing here converts them on load; they are converted at the point
// of painting.

/** Colours cycled through new takeoff items. The 0.35 alpha IS the fill alpha. */
export const TAKEOFF_PALETTE = [
  [0.20, 0.75, 0.35, 0.35],   // green
  [0.20, 0.55, 1.00, 0.35],   // blue
  [1.00, 0.65, 0.10, 0.35],   // orange
  [0.85, 0.20, 0.85, 0.35],   // magenta
  [0.95, 0.25, 0.25, 0.35],   // red
  [0.15, 0.90, 0.90, 0.35],   // cyan
  [0.95, 0.95, 0.20, 0.35],   // yellow
  [0.55, 0.35, 1.00, 0.35],   // purple
];

/** The colour an item gets when its own is missing or malformed. */
export const FALLBACK_ITEM_COLOR = [0, 0.8, 1, 0.5];

let paletteIndex = 0;
export function nextPaletteColor() {
  const c = TAKEOFF_PALETTE[paletteIndex % TAKEOFF_PALETTE.length];
  paletteIndex += 1;
  return c.slice();
}
export function peekPaletteColor() {
  return TAKEOFF_PALETTE[paletteIndex % TAKEOFF_PALETTE.length].slice();
}
export function setPaletteIndex(i) { paletteIndex = i | 0; }

/** A stored colour, always four floats. */
export function itemColor(m) {
  const c = m && m.color;
  return Array.isArray(c) && c.length === 4 ? c : FALLBACK_ITEM_COLOR;
}

/** Floats 0–1 → a CSS colour, with an alpha override. */
export function rgba(c, alpha = null) {
  const r = Math.round(clamp01(c[0]) * 255);
  const g = Math.round(clamp01(c[1]) * 255);
  const b = Math.round(clamp01(c[2]) * 255);
  const a = alpha == null ? (c.length > 3 ? clamp01(c[3]) : 1) : clamp01(alpha);
  return `rgba(${r},${g},${b},${a})`;
}

/** Floats 0–1 → "#rrggbb", dropping alpha. */
export function hex(c) {
  const h = v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

/** "#rrggbb" or "#rrggbbaa" → floats 0–1. */
export function fromHex(s, alpha = 1) {
  const t = String(s || '').replace('#', '');
  if (t.length < 6) return FALLBACK_ITEM_COLOR.slice();
  const r = parseInt(t.slice(0, 2), 16) / 255;
  const g = parseInt(t.slice(2, 4), 16) / 255;
  const b = parseInt(t.slice(4, 6), 16) / 255;
  const a = t.length >= 8 ? parseInt(t.slice(6, 8), 16) / 255 : alpha;
  return [r, g, b, a];
}

/** Each channel brightened, the way the count marker's rim is. */
export function brighten(c, by = 0.3) {
  return [
    Math.min(c[0] + by, 1), Math.min(c[1] + by, 1), Math.min(c[2] + by, 1),
    c.length > 3 ? c[3] : 1,
  ];
}

export function darken(c, k = 0.45) {
  return [c[0] * k, c[1] * k, c[2] * k, c.length > 3 ? c[3] : 1];
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ── the UI's own colours ──────────────────────────────────────────────────

export const UI = {
  canvasBg: '#1e1e1e',
  panelBg: '#141414',
  headerBg: '#0d0d0d',
  filterBg: '#101010',
  border: '#2a2a2a',
  borderSoft: '#252525',
  text: '#d0d0d0',
  textDim: '#9a9a9a',
  textFaint: '#585858',
  textGhost: '#383838',
  hidden: '#484848',
  value: '#4aa8d8',
  accent: '#4772b3',
  selection: '#28486e',
  rowA: '#191919',
  rowB: '#1e1e1e',
  labor: '#8a6d2a',
  material: '#2c5a8c',
  eyeOn: '#4aad52',
  eyeOff: '#d95555',
  materials: '#a0a040',
  scroll: '#3c3c3c',
  scrollHover: '#505050',
};

/** One hue per floor, cycled by display order. */
export const GROUP_HUES = [
  '#4aa3e8', '#52b788', '#e8a04a', '#c678dd',
  '#e06c75', '#56b6c2', '#d4c04a', '#8a9cf0',
];

/** Blend a hex colour toward a base. t=1 is the pure colour, t=0 the base. */
export function mix(hexColor, t, base = '#141414') {
  const p = h => [
    parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
  ];
  const [hr, hg, hb] = p(hexColor);
  const [br, bg, bb] = p(base);
  const c = (a, b) => Math.round(b + (a - b) * t).toString(16).padStart(2, '0');
  return `#${c(hr, br)}${c(hg, bg)}${c(hb, bb)}`;
}

export function lighten(hexColor, by = 18) {
  const p = h => [
    parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
  ];
  const [r, g, b] = p(hexColor);
  const c = v => Math.min(255, v + by).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// Selection, hover and the drawing aids. These are not item colours and never
// come out of a file.
export const MARKS = {
  selection: 'rgba(255,255,255,0.5)',
  selectionStrong: 'rgba(255,255,255,0.9)',
  selectionGlow: 'rgba(255,255,255,0.6)',
  strokeGlow: 'rgba(255,255,255,0.45)',
  calloutRing: 'rgba(255,255,255,0.75)',
  hover: 'rgba(255,217,51,0.9)',
  vertexHover: 'rgba(255,255,255,1)',
  vertexDrag: 'rgba(255,255,0,1)',
  constraintDot: 'rgba(255,255,102,0.9)',
  snapHalo: 'rgba(255,255,255,0.4)',
  snapMarker: 'rgba(51,255,77,0.95)',
  eraser: 'rgba(255,77,77,0.85)',
  textnoteDrag: 'rgba(255,230,77,0.85)',
  gridInkAlpha: 0.95,
  zoneLine: 'rgba(0,204,255,0.9)',
  zoneFill: 'rgba(0,128,255,0.15)',
};

/** The in-progress colour for each drawing tool. */
export const PREVIEW_COLORS = {
  distance:     [0, 1, 1, 0.7],
  calibrate:    [0, 1, 1, 0.7],
  pitch:        [0.4, 0.7, 1, 1],
  area:         [0, 0.8, 0, 1],
  slope_area:   [0.9, 0.55, 0.1, 1],
  polyline:     [1, 0.55, 0, 1],
  linear_count: [0.3, 0.9, 1, 1],
  grid:         [0.3, 1.0, 0.4, 1],
  tile:         [0.3, 1.0, 0.4, 1],
};

/** Label chip colours for the live read-out of each tool. */
export const PREVIEW_LABEL_RGB = {
  pitch: [150, 200, 255],
  distance: [0, 200, 200],
  calibrate: [0, 200, 200],
  area: [255, 140, 0],
  slope_area: [255, 140, 0],
  tile: [255, 140, 0],
  polyline: [255, 140, 0],
  linear_count: [80, 230, 255],
};
