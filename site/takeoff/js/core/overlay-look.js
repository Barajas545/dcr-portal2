// overlay-look.js — what a SAVED overlay is made of, and which record can be
// shown. Pure: pixels in and pixels out, records in and answers out; no DOM.
//
// The desktop (3.06+) keeps an overlay per sheet in metadata.page_overlays
// [str(page)], in one of three shapes -- another sheet {overlay_page}, a
// revision page {rev_id, rev_page}, or a picture of this sheet {image_id} --
// each with its tint (color [r,g,b] 0..1), its fade (alpha) and, since 3.06,
// its LOOK: mode 'lines' | 'original', invert, cutoff 1..255 or null = Auto.
// This module is the desktop's own arithmetic for all of that, held to it by
// tests/overlay-look.mjs against the desktop's functions lifted out of
// pdf_fast_viewer.py by text (tests/overlay-python-truth.py):
//
//   overlayRgba     _overlay_rgba          the overlay's pixels, any source
//   autoCutoff      _overlay_auto_cutoff   Auto: the paper's shade, read off it
//   lookOfRecord    _apply_overlay_look + GLPageWidget.set_overlay_look
//   cadImageRect    _cad_image_rect        a picture's box, page px
//   ptsPair         _pts_pair
//   overlayPicture  GLPageWidget.overlay_picture   found BY ID, every time
//   overlayEntryLabel / pictureName        what the desktop calls a source
//   overlaySourceOf _restore_overlay_for_page's rule (reproduced, not lifted:
//                   the desktop function is UI; the truth runs it on stubs)
//   pngRgba / pngAutoCutoff / pngPlain / pngInfo / pngHeadInfo
//                   a PNG's pixels as PIL reads them (Image.open, and
//                   _picture_pil's convert("RGBA")), where a browser's
//                   decode would differ; Auto off the full-size rows
//
// UNITS. An offset and a picture's points are in PAGE PIXELS of the sheet the
// overlay is laid on -- the drawing's own image pixels, the same units every
// measurement in the file is in. A sheet or revision source is drawn at ITS
// OWN pixel size in those units (GLPageWidget._draw_overlay: size from the
// overlay image itself, times the zoom), so a 5400 px source over a 2592 px
// sheet is drawn 5400 page pixels wide, not stretched to the sheet. A picture
// is drawn at its own box, whatever its pixels.
//
// Viewing writes nothing: nothing here touches a record.

import { classStrip } from './classify.js';

/** Paper this light is white paper: Auto leaves it alone (255). */
export const OVERLAY_WHITE_PAPER = 248;
/** How far under the paper's own shade Auto's cut-off sits. */
export const OVERLAY_PAPER_MARGIN = 12;
/** In Original colours the paper fades out over this many shades. */
export const OVERLAY_ORIGINAL_KNEE = 16;
/** A record with no tint or fade: GLPageWidget's own defaults. */
export const OVERLAY_DEFAULT_COLOR = Object.freeze([1.0, 0.3, 0.3]);
export const OVERLAY_DEFAULT_ALPHA = 0.5;
/** The desktop's words for a picture that cannot be decoded (_KEPT_NOTE_UNREADABLE). */
export const KEPT_NOTE_UNREADABLE = 'A picture on this sheet could not be read, so '
  + 'it cannot be the overlay';

const isDict = v => !!v && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Python's truthiness of a JSON value. */
export function pyTruthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string' || Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return !!v;
}

/** Python's str() of a JSON scalar (True / False by their names); null for
 *  anything else, which no id can be. */
function pyStrScalar(v) {
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return null;
}

/** PIL's convert("L") of one RGB pixel: ITU-R 601-2 in 16-bit fixed point,
 *  rounded (Pillow's L24). Checked exact against PIL on every grey and on
 *  saturated colours; the old (r*299 + g*587 + b*114) / 1000 is not. */
export function pilLuma(r, g, b) {
  return (r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16;
}

/**
 * The paper cut-off for a picture, read off the picture itself
 * (_overlay_auto_cutoff). `hist` is the 256-bin histogram of the grey,
 * counting only the pixels whose alpha is not 0 (a cut-out's empty
 * background is not paper). The commonest light shade (96 and up; a tie goes
 * to the lighter) is the paper: 248 or lighter is white paper and gives 255,
 * anything else sits 12 under it, never under 64. Nothing light at all: 255.
 */
export function autoCutoffOfHistogram(hist) {
  let paper = -1;
  let most = 0;
  for (let v = 96; v < 256; v++) {
    const n = hist[v] || 0;
    if (n > 0 && n >= most) { most = n; paper = v; }
  }
  if (paper < 0) return 255;
  if (paper >= OVERLAY_WHITE_PAPER) return 255;
  return Math.max(64, paper - OVERLAY_PAPER_MARGIN);
}

/** autoCutoff of a grey array, with an optional alpha mask (0 = left out). */
export function autoCutoff(gray, alpha = null) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) {
    if (!alpha || alpha[i]) hist[gray[i]] += 1;
  }
  return autoCutoffOfHistogram(hist);
}

/** The two alpha tables of _overlay_rgba, for a cut-off c (1..255). */
export function overlayLut(mode, c) {
  const lut = new Uint8Array(256);
  if (mode === 'original') {
    const k = OVERLAY_ORIGINAL_KNEE;
    for (let v = 0; v < 256; v++) lut[v] = v < c ? Math.min(255, Math.floor(((c - v) * 255) / k)) : 0;
  } else {
    // With c = 255 this is exactly 255 - v: the overlay as it always was.
    for (let v = 0; v < 256; v++) lut[v] = v < c ? Math.floor(((c - v) * 255) / c) : 0;
  }
  return lut;
}

/**
 * The overlay's pixels from any picture (_overlay_rgba), as straight RGBA.
 *
 * `src` is ImageData-shaped: {data (RGBA, not premultiplied), width,
 * height}. Lines: white, alpha = how dark the line is after `invert` and the
 * paper `cutoff`, times the picture's own alpha. Original: the picture's own
 * colours (inverted with `invert`) with the paper lighter than the cut-off
 * taken out over a 16-shade knee. The source's own alpha MULTIPLIES (PIL's
 * ImageChops.multiply, a*b // 255); nothing is ever laid on white first, so a
 * cut-out's empty background stays empty when inverted. A picture whose
 * every alpha is 255 has no alpha to multiply by, as PIL's RGB has none.
 *
 * `cutoff` null reads the paper's shade off the picture (autoCutoff); a
 * number is truncated and kept to 1..255. Returns {data, width, height,
 * cutoff} -- `cutoff` the one used, as the desktop leaves it in
 * .info["cutoff"].
 *
 * `out` may be `src.data` itself: two passes, the first only reads, and the
 * second reads each pixel before it writes it -- so a 28-megapixel sheet
 * costs no second buffer on an iPad.
 */
export function overlayRgba(src, mode = 'lines', invert = false, cutoff = null,
  out = new Uint8ClampedArray(src.width * src.height * 4)) {
  const d = src.data;
  const n = src.width * src.height;
  const original = mode === 'original';
  let hasAlpha = false;
  for (let i = 3; i < n * 4; i += 4) {
    if (d[i] !== 255) { hasAlpha = true; break; }
  }
  let c;
  if (cutoff === null || cutoff === undefined) {
    const hist = new Float64Array(256);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (hasAlpha && !d[i + 3]) continue;
      const g = pilLuma(d[i], d[i + 1], d[i + 2]);
      hist[invert ? 255 - g : g] += 1;
    }
    c = autoCutoffOfHistogram(hist);
  } else {
    c = Math.max(1, Math.min(255, Math.trunc(Number(cutoff))));
  }
  const lut = overlayLut(original ? 'original' : 'lines', c);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], sa = d[i + 3];
    const v = pilLuma(r, g, b);
    let a = lut[invert ? 255 - v : v];
    if (hasAlpha) a = Math.floor((a * sa) / 255);
    if (original) {
      out[i] = invert ? 255 - r : r;
      out[i + 1] = invert ? 255 - g : g;
      out[i + 2] = invert ? 255 - b : b;
    } else {
      out[i] = 255; out[i + 1] = 255; out[i + 2] = 255;
    }
    out[i + 3] = a;
  }
  return { data: out, width: src.width, height: src.height, cutoff: c };
}

/**
 * The look a saved record brings up (_apply_overlay_look, then
 * GLPageWidget.set_overlay_look): {mode, invert, cutoff}, cutoff null = Auto.
 *
 * A record with no 'cutoff' key and no image_id is a 3.05 sheet or revision
 * overlay: Lines, not inverted, nothing cut (255) -- his big sets are scans,
 * and Auto would thin every comparison he had set up. A picture keeps Auto.
 * A bool or a non-number cut-off is Auto; a number is truncated into 1..255.
 * Invert only when it is True itself; Original only when it says so.
 */
export function lookOfRecord(state) {
  const st = isDict(state) ? state : {};
  let cut = st.cutoff;
  if (typeof cut === 'boolean' || typeof cut !== 'number') cut = null;
  if (!hasOwn(st, 'cutoff') && !pyTruthy(st.image_id)) cut = 255;
  let c = null;
  if (cut !== null && Number.isFinite(cut)) c = Math.max(1, Math.min(255, Math.trunc(cut)));
  return {
    mode: st.mode === 'original' ? 'original' : 'lines',
    invert: st.invert === true,
    cutoff: c,
  };
}

/** A picture's box in page px [x0, y0, x1, y1] (_cad_image_rect): min and
 *  max, its two corners being stored in whatever order they were drawn.
 *  null without two. */
export function cadImageRect(ent) {
  const raw = isDict(ent) ? ent.pts : null;
  const pts = Array.isArray(raw) ? raw : [];
  if (pts.length < 2) return null;
  const [a, b] = pts;
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
    Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** The first two points of `raw` as [[x0, y0], [x1, y1]] numbers, or null
 *  when they are not two finite points (_pts_pair; a string that reads as a
 *  number reads, as Python's float() reads it). */
export function ptsPair(raw) {
  const num = v => {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string' && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(v)) return Number(v);
    return NaN;
  };
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out = [];
  for (const p of [raw[0], raw[1]]) {
    if (!Array.isArray(p) || p.length < 2) return null;
    out.push([num(p[0]), num(p[1])]);
  }
  if (out.some(p => p.some(v => !Number.isFinite(v)))) return null;
  return out;
}

/** The CAD pictures on a sheet, numbered 1, 2... in stacking order
 *  (_pictures_on_sheet): [[n, entity]]. */
export function picturesOnSheet(annots) {
  const pics = (Array.isArray(annots) ? annots : [])
    .filter(e => isDict(e) && e.subtype === 'cad' && e.etype === 'image');
  return pics.map((e, i) => [i + 1, e]);
}

/** What the desktop calls a picture: 'Picture 2', or 'The picture'. */
export function pictureName(annots, eid) {
  for (const [n, e] of picturesOnSheet(annots)) {
    if (entityId(e) === String(eid)) return `Picture ${n}`;
  }
  return 'The picture';
}

/** `str(e.get("id") or "")`. */
function entityId(e) {
  return pyTruthy(e.id) ? (pyStrScalar(e.id) ?? '') : '';
}

/**
 * The picture serving as the overlay, by id (GLPageWidget.overlay_picture):
 * the FIRST CAD picture with that id, and only while it is flagged
 * as_overlay -- a picture shown as a picture again, or gone, is null. Looked
 * up every time, never held: an undo replaces every dict.
 */
export function overlayPicture(annots, eid) {
  if (!pyTruthy(eid)) return null;
  const want = String(eid);
  for (const e of Array.isArray(annots) ? annots : []) {
    if (isDict(e) && e.subtype === 'cad' && e.etype === 'image' && entityId(e) === want) {
      return pyTruthy(e.as_overlay) ? e : null;
    }
  }
  return null;
}

/**
 * What a sheet is called in the overlay's list (_overlay_entry_label):
 * 'P3  X1.2  Foundation' -- the page, the sheet number (his corrected one
 * first) and the name he typed, two spaces apart.
 */
export function overlayEntryLabel(md, i) {
  const m = isDict(md) ? md : {};
  const custom = isDict(m.page_labels_custom) ? m.page_labels_custom : {};
  let num = custom[String(i)] || '';
  if (!num) {
    const labels = Array.isArray(m.page_labels) ? m.page_labels : [];
    num = i < labels.length ? labels[i] : '';
  }
  const names = isDict(m.page_names) ? m.page_names : {};
  const name = classStrip(names[String(i)] || '');
  num = classStrip(num || '');
  const bits = [`P${i + 1}`];
  if (num) bits.push(num);
  if (name && name !== num) bits.push(name);
  return bits.join('  ');
}

/**
 * A picture's img_b64 as bytes, read as the desktop reads it
 * (base64.b64decode, not strict): a character outside the alphabet is
 * dropped, and what is left must be whole quads. null when it cannot be
 * read -- the picture is then unreadable, as on the desktop.
 */
export function pictureBytes(b64) {
  if (typeof b64 !== 'string') return null;
  const s = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (s.length % 4 !== 0) return null;
  let bin;
  try { bin = atob(s); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The fade as the desktop's label says it: int(alpha * 100), truncated
 *  (so a saved 0.29 reads 28%, as it does on the desktop). */
export function fadePercent(alpha) {
  return Math.trunc(alpha * 100);
}

/** A record's tint: three numbers, else the desktop's default. */
export function overlayColor(state) {
  const c = isDict(state) ? state.color : undefined;
  if (Array.isArray(c) && c.length === 3 && c.every(isNum)) return c.slice();
  return OVERLAY_DEFAULT_COLOR.slice();
}

/** A record's fade as saved (its label is said from this), else 0.5. */
export function overlayAlphaSaved(state) {
  const a = isDict(state) ? state.alpha : undefined;
  return isNum(a) ? a : OVERLAY_DEFAULT_ALPHA;
}

/** ...and as drawn (set_overlay_alpha: kept to 0..1). */
export function overlayAlpha(state) {
  return Math.max(0, Math.min(1, overlayAlphaSaved(state)));
}

/** A sheet or revision record's Align offset, page px; [0, 0] when it has
 *  none (or none that is two numbers). */
export function overlayOffset(state) {
  const o = isDict(state) ? state.offset : undefined;
  if (Array.isArray(o) && o.length >= 2 && isNum(o[0]) && isNum(o[1])) return [o[0], o[1]];
  return [0, 0];
}

/** A tint as canvas wants it. GL keeps a colour to 0..1. */
export function tintCss(color) {
  const c = (Array.isArray(color) ? color : OVERLAY_DEFAULT_COLOR)
    .map(v => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * What a sheet's saved record can put up, or null when it names nothing
 * (the desktop's _restore_overlay_for_page, reproduced):
 *
 *   {image_id}  the FIRST of this sheet's pictures with that id, flagged
 *               as_overlay, with pixels to read -- else nothing;
 *   {rev_id}    a revision of the job with drawings in this file (not a set
 *               with no record, not one whose drawings were lost) whose
 *               rev_page is a whole number inside it -- else nothing;
 *   otherwise   overlay_page, a whole number (not a bool) naming a sheet of
 *               the job -- else nothing (an old file's -1 among them).
 *
 * `ctx`: {pageCount, revisions (the project's adopted list: id, pageCount,
 * _setIndex, _orphanSet), pictures (annotations[page])}. The answer carries
 * the look, the tint and the fade for the record, and what it names:
 *   {kind:'sheet', page} | {kind:'revision', revId, revPage, set, rev}
 *   | {kind:'picture', imageId, entity}
 *
 * DECLARED, a record no build of the desktop writes: an overlay_page or a
 * rev_page saved as a JSON float (3.0, by hand or another program). Python's
 * json keeps it a float, and the desktop shows nothing for it (a float
 * rev_page raises there); JSON.parse hands JavaScript 3, which cannot be
 * told from 3 -- so the web shows sheet 3 (tests/overlay-look.mjs pins both
 * answers, 'sheet 2.0' and 'revision page 1.0'). A true or '3' names
 * nothing on both.
 *
 * A record that names nothing stays in the file untouched: the web reads,
 * it never prunes what the desktop wrote. Unlike the desktop's revision
 * branch ('return # revision gone', which leaves the LAST sheet's overlay
 * up -- reported for 3.08), the caller has taken the last sheet's down
 * before it asks.
 */
export function overlaySourceOf(state, { pageCount = 0, revisions = [], pictures = [] } = {}) {
  if (!pyTruthy(state) || !isDict(state)) return null;
  const common = {
    look: lookOfRecord(state),
    color: overlayColor(state),
    alpha: overlayAlpha(state),
    alphaSaved: overlayAlphaSaved(state),
    offset: overlayOffset(state),
  };
  if (pyTruthy(state.image_id)) {
    const eid = pyStrScalar(state.image_id);
    if (eid === null) return null;
    const entity = overlayPicture(pictures, eid);
    if (!entity || !pyTruthy(entity.img_b64) || typeof entity.img_b64 !== 'string') return null;
    return { kind: 'picture', imageId: eid, entity, ...common, offset: [0, 0] };
  }
  if (state.rev_id !== null && state.rev_id !== undefined) {
    const id = state.rev_id;
    if (typeof id !== 'string' || !id) return null;
    const rev = (Array.isArray(revisions) ? revisions : []).find(r => isDict(r)
      && !r._orphanSet && String(r.id) === id && (r.pageCount || 0) > 0);
    const rp = state.rev_page;
    if (!rev || !Number.isInteger(rp) || rp < 0 || rp >= rev.pageCount) return null;
    return { kind: 'revision', revId: id, revPage: rp, set: rev._setIndex, rev, ...common };
  }
  const op = state.overlay_page;
  if (!Number.isInteger(op) || op < 0 || op >= pageCount) return null;
  return { kind: 'sheet', page: op, ...common };
}

/** Where a source is drawn, page px [x0, y0, x1, y1] (overlay_rect): a
 *  picture at its own box (read off the entity each time it is asked), any
 *  other source at its own pixel size from the Align offset. null when it
 *  cannot be drawn. */
export function overlayRect(src, size, pictures = null) {
  if (!src) return null;
  if (src.kind === 'picture') {
    const ent = pictures ? overlayPicture(pictures, src.imageId) : src.entity;
    const r = cadImageRect(ent);
    return r && r.every(isNum) ? r : null;
  }
  if (!size || !isNum(size[0]) || !isNum(size[1])) return null;
  const [ox, oy] = src.offset || [0, 0];
  return [ox, oy, ox + size[0], oy + size[1]];
}

/* ── a PNG's pixels as PIL reads them ─────────────────────────────────────
 *
 * The desktop hands _overlay_rgba what PIL decodes: the file's RAW samples --
 * no colour management (an ICC profile, gAMA or cHRM is ignored), no
 * premultiplied alpha, a 16-bit sample cut to its high byte (a 16-bit grey
 * one, I;16, clipped to 255 as convert("L") clips it). A browser's decode is
 * not that: it colour-manages a tagged picture (a phone photo in Display P3,
 * a scan in Adobe RGB), and a 2D canvas keeps premultiplied pixels, so a
 * semi-transparent picture's colours come back rounded -- enough to move
 * Auto from 255 to 235, or to take Original's paper out. So the overlay reads
 * a PNG here, the way PIL does, whenever the browser's read could differ
 * (pngPlain); the browser's own decode is exact for a plain one -- 8 bits,
 * opaque, untagged -- and is used for it (a 28-megapixel sheet decodes there
 * far faster than here).
 *
 * `colourKey`: a tRNS colour key on an RGB or grey PNG makes those pixels
 * transparent for a PICTURE (_picture_pil converts it to RGBA, which applies
 * the key) and NOTHING for a sheet or a revision page (_overlay_rgba is
 * handed the image as opened, and an RGB or L image has no alpha band).
 *
 * Declines (null) what it cannot read exactly as PIL would: an interlaced
 * PNG, a picture's key on a 16-bit or under-8-bit one, a palette index past
 * the palette, a damaged stream. The caller then reads the browser's decode,
 * as before.
 */

/** The PNG's header and its compressed rows, or null when it is not a PNG
 *  this can read. Reads only the chunk table: no pixels. */
export function pngInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : null;
  if (!b || b.length < 33) return null;
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) return null;
  const u32 = o => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const info = {
    width: 0, height: 0, depth: 0, ctype: -1, interlace: 0,
    plte: null, trns: null, idat: [], colour: [],
  };
  let o = 8;
  while (o + 8 <= b.length) {
    const len = u32(o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const at = o + 8;
    if (at + len > b.length) return null;
    const data = b.subarray(at, at + len);
    if (type === 'IHDR') {
      if (len < 13) return null;
      info.width = u32(at);
      info.height = u32(at + 4);
      info.depth = b[at + 8];
      info.ctype = b[at + 9];
      info.interlace = b[at + 12];
    } else if (type === 'PLTE') info.plte = data;
    else if (type === 'tRNS') info.trns = data;
    else if (type === 'IDAT') info.idat.push(data);
    else if (type === 'iCCP' || type === 'gAMA' || type === 'cHRM' || type === 'cICP') info.colour.push(type);
    else if (type === 'IEND') break;
    o = at + len + 4;
  }
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[info.ctype];
  if (!depths || !depths.includes(info.depth) || !info.width || !info.height || !info.idat.length) return null;
  if (info.ctype === 3 && !info.plte) return null;
  info.channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[info.ctype];
  info.rowBytes = Math.ceil((info.width * info.channels * info.depth) / 8);
  info.bpp = Math.max(1, (info.channels * info.depth) >> 3);
  return info;
}

/** pngInfo's header alone, from a PREFIX of the PNG (page-store pngHead):
 *  every chunk before the first IDAT -- where the IHDR, PLTE, tRNS and the
 *  colour chunks must be -- and nothing of the pixels. null unless the
 *  prefix reaches that IDAT, so a header cut short is never taken as whole. */
export function pngHeadInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : null;
  if (!b || b.length < 33) return null;
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) return null;
  const u32 = o => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const head = { width: 0, height: 0, depth: 0, ctype: -1, interlace: 0, trns: null, colour: [] };
  for (let o = 8; o + 8 <= b.length;) {
    const len = u32(o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const at = o + 8;
    if (type === 'IDAT') return head.ctype >= 0 ? head : null;
    if (at + len > b.length) return null;
    if (type === 'IHDR' && len >= 13) {
      head.width = u32(at);
      head.height = u32(at + 4);
      head.depth = b[at + 8];
      head.ctype = b[at + 9];
      head.interlace = b[at + 12];
    } else if (type === 'tRNS') head.trns = b.subarray(at, at + len);
    else if (type === 'iCCP' || type === 'gAMA' || type === 'cHRM' || type === 'cICP') head.colour.push(type);
    o = at + len + 4;
  }
  return null;
}

/**
 * Whether the browser's own decode, read through a 2D canvas, gives exactly
 * what PIL reads: 8 bits a sample, opaque (no alpha channel and no tRNS, so
 * nothing is premultiplied), and no colour chunk a browser would act on (an
 * sRGB chunk is sRGB, which a browser leaves as it is). Of pngInfo's answer
 * or pngHeadInfo's.
 */
export function pngPlain(info) {
  return !!info && info.depth === 8 && (info.ctype === 0 || info.ctype === 2 || info.ctype === 3)
    && !info.trns && !info.colour.length;
}

/** Undo one row's PNG filter in place (`prev` the row above, unfiltered). */
function unfilterRow(type, cur, prev, bpp) {
  const n = cur.length;
  if (type === 0) return;
  if (type === 1) {
    for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255;
  } else if (type === 2) {
    for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 255;
  } else if (type === 3) {
    for (let i = 0; i < n; i++) cur[i] = (cur[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 255;
  } else if (type === 4) {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + up - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - c);
      cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)) & 255;
    }
  } else {
    throw new Error(`a PNG row with filter ${type}`);
  }
}

/** The rows, unfiltered, one at a time, through the browser's own zlib
 *  (DecompressionStream): a 28-megapixel sheet never holds more than two of
 *  its rows. The row handed to `each(row, y)` is reused for the next. */
async function eachPngRow(info, each) {
  if (typeof DecompressionStream === 'undefined') throw new Error('no zlib stream here');
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const feeding = (async () => {
    for (const part of info.idat) await writer.write(part);
    await writer.close();
  })();
  feeding.catch(() => {});
  const reader = ds.readable.getReader();
  const n = info.rowBytes;
  let prev = new Uint8Array(n);
  let cur = new Uint8Array(n);
  let filter = -1;
  let filled = 0;
  let y = 0;
  try {
    while (y < info.height) {
      const { value, done } = await reader.read();
      if (done) break;
      let i = 0;
      while (i < value.length && y < info.height) {
        if (filter < 0) { filter = value[i++]; filled = 0; continue; }
        const take = Math.min(n - filled, value.length - i);
        cur.set(value.subarray(i, i + take), filled);
        filled += take;
        i += take;
        if (filled === n) {
          unfilterRow(filter, cur, prev, info.bpp);
          each(cur, y);
          const t = prev; prev = cur; cur = t;
          filter = -1;
          y += 1;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (y < info.height) throw new Error('the PNG stops short');
}

/** A row's samples as straight RGBA into `out` at `o`, the way PIL reads
 *  them (see above). False when PIL's answer is not known here. */
function rowRgba(row, info, colourKey, out, o) {
  const { width: w, depth, ctype } = info;
  const t = info.trns;
  const k16 = i => (t[i] << 8) | t[i + 1];
  if (ctype === 3) {
    const p = info.plte;
    const entries = (p.length / 3) | 0;
    const mask = (1 << depth) - 1;
    const per = 8 / depth;
    for (let x = 0; x < w; x++) {
      const idx = depth === 8 ? row[x]
        : (row[(x / per) | 0] >> (8 - depth * ((x % per) + 1))) & mask;
      if (idx >= entries) return false;
      out[o] = p[idx * 3]; out[o + 1] = p[idx * 3 + 1]; out[o + 2] = p[idx * 3 + 2];
      out[o + 3] = t && idx < t.length ? t[idx] : 255;
      o += 4;
    }
    return true;
  }
  if (ctype === 0) {
    const key = t && colourKey && t.length >= 2 ? k16(0) : -1;
    if (depth === 16) {
      // I;16, cut to 0..255 (convert("L") and convert("RGBA") clip it)
      for (let x = 0; x < w; x++) {
        const v = Math.min(255, (row[x * 2] << 8) | row[x * 2 + 1]);
        out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
        o += 4;
      }
      return true;
    }
    const mask = (1 << depth) - 1;
    const per = 8 / depth;
    const scale = 255 / mask;
    for (let x = 0; x < w; x++) {
      const s = depth === 8 ? row[x] : (row[(x / per) | 0] >> (8 - depth * ((x % per) + 1))) & mask;
      const v = depth === 8 ? s : s * scale;
      out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = s === key ? 0 : 255;
      o += 4;
    }
    return true;
  }
  if (ctype === 2) {
    const keyed = !!t && colourKey && t.length >= 6;
    const kr = keyed ? k16(0) : -1;
    const kg = keyed ? k16(2) : -1;
    const kb = keyed ? k16(4) : -1;
    const step = depth === 16 ? 6 : 3;
    const hi = depth === 16 ? 2 : 1;
    for (let x = 0, i = 0; x < w; x++, i += step) {
      const r = row[i]; const g = row[i + hi]; const b2 = row[i + 2 * hi];
      out[o] = r; out[o + 1] = g; out[o + 2] = b2;
      out[o + 3] = r === kr && g === kg && b2 === kb ? 0 : 255;
      o += 4;
    }
    return true;
  }
  if (ctype === 4) {
    const step = depth === 16 ? 4 : 2;
    const hi = depth === 16 ? 2 : 1;
    for (let x = 0, i = 0; x < w; x++, i += step) {
      const v = row[i];
      out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = row[i + hi];
      o += 4;
    }
    return true;
  }
  // ctype 6
  if (depth === 8) {
    out.set(row.subarray(0, w * 4), o);
    return true;
  }
  for (let x = 0, i = 0; x < w; x++, i += 8) {
    out[o] = row[i]; out[o + 1] = row[i + 2]; out[o + 2] = row[i + 4]; out[o + 3] = row[i + 6];
    o += 4;
  }
  return true;
}

/** Whether PIL's reading of this PNG is known here (rowRgba). */
function readableHere(info, colourKey) {
  if (!info || info.interlace) return false;
  // a picture's key on a grey or RGB PNG that is not 8 bits a sample: PIL's
  // convert_transparent compares it with what it unpacked, not with the file
  if (info.trns && colourKey && (info.ctype === 0 || info.ctype === 2) && info.depth !== 8) return false;
  return true;
}

/**
 * The PNG's pixels as straight RGBA, as PIL reads them -- {data, width,
 * height}, ImageData-shaped, for overlayRgba -- or null when this cannot
 * read it exactly (see above). `info` from pngInfo, or read here.
 */
export async function pngRgba(bytes, { colourKey = false, info = pngInfo(bytes) } = {}) {
  if (!readableHere(info, colourKey)) return null;
  const { width: w, height: h } = info;
  const data = new Uint8ClampedArray(w * h * 4);
  let fine = true;
  try {
    await eachPngRow(info, (row, y) => {
      if (fine && !rowRgba(row, info, colourKey, data, y * w * 4)) fine = false;
    });
  } catch {
    return null;
  }
  return fine ? { data, width: w, height: h } : null;
}

/**
 * Auto's cut-off read off the PNG at its FULL size, row by row, the way
 * _overlay_auto_cutoff reads the desktop's full-size picture -- for a decode
 * the browser had to make smaller (an iPad over its canvas cap), whose
 * resampled pixels move the paper's commonest shade (4 to 20 levels, or
 * white paper's 255 to a grey's). What is transparent is left out, as there.
 * null when this cannot read it (the caller then reads the decode it has).
 */
export async function pngAutoCutoff(bytes, { colourKey = false, invert = false, info = pngInfo(bytes) } = {}) {
  if (!readableHere(info, colourKey)) return null;
  const w = info.width;
  const px = new Uint8ClampedArray(w * 4);
  const hist = new Float64Array(256);
  let fine = true;
  try {
    await eachPngRow(info, row => {
      if (!fine || !rowRgba(row, info, colourKey, px, 0)) { fine = false; return; }
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const g = pilLuma(px[i], px[i + 1], px[i + 2]);
        hist[invert ? 255 - g : g] += 1;
      }
    });
  } catch {
    return null;
  }
  return fine ? autoCutoffOfHistogram(hist) : null;
}
