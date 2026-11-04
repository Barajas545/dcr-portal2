// pdf-import.js — turn a PDF into the page rasters a project is made of.
//
// The desktop app renders each page with PyMuPDF at the import DPI and stores
// the result as zlib(PNG). This does the same with pdf.js, so a project built
// in the browser is byte-compatible with one built on the desktop: same page
// pixel dimensions for the same DPI, therefore the same pixels-per-foot, and
// therefore the same measurements.
//
//   zoom = dpi / 72        (a PDF user-space unit is 1/72 inch)
//
// Pages are rendered one at a time and handed straight to the caller. A
// 300-sheet set at 150 DPI is far too much to hold decoded, so nothing is
// accumulated here — the caller compresses each page and lets it go.

import { DEFAULT_DPI } from './units.js';

const PDFJS_VERSION = '3.11.174';

// pdf.js ships with the app rather than coming off a CDN. Starting a new job
// from a PDF is something that happens in a site trailer on a phone hotspot,
// or on a contractor network that blocks jsdelivr, and a build that only
// works with a live connection to a third party is not a field tool. It also
// means the service worker can cache it, so the whole app runs offline.
//
// Resolved against this module's own URL, so it is correct whether the app
// is served from a domain root or from a project subpath on GitHub Pages.
const PDFJS_ROOT = new URL('../../vendor/pdfjs/', import.meta.url).href;
const PDFJS_BASE = `${PDFJS_ROOT}build`;

let pdfjsReady = null;

/** Load pdf.js once, and point it at its worker. */
export function loadPdfJs() {
  if (pdfjsReady) return pdfjsReady;
  pdfjsReady = new Promise((resolve, reject) => {
    if (globalThis.pdfjsLib) return resolve(configure(globalThis.pdfjsLib));
    const s = document.createElement('script');
    s.src = `${PDFJS_BASE}/pdf.min.js`;
    s.onload = () => {
      if (!globalThis.pdfjsLib) return reject(new Error('pdf.js loaded but did not register'));
      resolve(configure(globalThis.pdfjsLib));
    };
    s.onerror = () => reject(new Error(
      'Could not load the PDF engine. Check your connection and reload.'
    ));
    document.head.appendChild(s);
  });
  return pdfjsReady;
}

function configure(lib) {
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
  return lib;
}

/**
 * Open a PDF. The caller owns the returned document and must destroy() it.
 * @param {ArrayBuffer|Uint8Array} data
 */
export async function openPdf(data) {
  const pdfjsLib = await loadPdfJs();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return pdfjsLib.getDocument({
    data: bytes,
    // Sets from a plan printer are full of embedded CID fonts; letting pdf.js
    // fall back to system fonts renders sheet numbers as boxes.
    cMapUrl: `${PDFJS_ROOT}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ROOT}standard_fonts/`,
    isEvalSupported: false,
  }).promise;
}

/** The pixel size a page will raster to at this DPI. */
export function pageSizeAt(page, dpi) {
  const vp = page.getViewport({ scale: dpi / 72 });
  return { width: Math.round(vp.width), height: Math.round(vp.height) };
}

// A single sheet has a hard ceiling in every browser's canvas implementation.
// Arch E at 300 DPI is 14400 × 10800, which is over Chrome's 16384-per-side
// limit in neither direction but well past its total-area limit. Cap the
// render and tell the caller what it actually got, rather than handing back a
// blank canvas — which is what an over-size canvas silently produces.
const MAX_CANVAS_SIDE = 12000;
const MAX_CANVAS_AREA = 40e6;

/**
 * Raster one page.
 * @returns {{canvas, width, height, dpi, clampedFrom:number|null}}
 */
export async function renderPage(page, dpi = DEFAULT_DPI) {
  let scale = dpi / 72;
  let vp = page.getViewport({ scale });
  let clampedFrom = null;

  const overSide = Math.max(vp.width, vp.height) / MAX_CANVAS_SIDE;
  const overArea = Math.sqrt((vp.width * vp.height) / MAX_CANVAS_AREA);
  const over = Math.max(overSide, overArea, 1);
  if (over > 1) {
    clampedFrom = dpi;
    scale /= over;
    vp = page.getViewport({ scale });
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  // A PDF page is transparent where nothing is drawn; a drawing set is read
  // on white paper. Paint it before rendering rather than after.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // intent: 'print' is not a stylistic choice, it is the only one that works.
  //
  // pdf.js drives a DISPLAY render forward with requestAnimationFrame, and a
  // hidden tab never fires one — so importing a set in a background tab hangs
  // on page 1 forever behind a progress bar that never moves. Measured here:
  // display intent times out after 8s, print intent completes in 252ms, on the
  // same page in the same hidden tab.
  //
  // It is also the more faithful raster. A takeoff is measured off the printed
  // drawing, and print intent is what would come out of the plotter — without
  // the screen-only annotation widgets that are not part of the drawing.
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;

  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    dpi: clampedFrom ? (72 * scale) : dpi,
    clampedFrom,
  };
}

/** A canvas as PNG bytes. */
export async function canvasToPng(canvas) {
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise(res => canvas.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// ── sheet numbers ─────────────────────────────────────────────────────────
//
// A drawing set's sheet number lives in the title block, bottom right on
// almost every set ever printed. Reading it saves the estimator from typing
// three hundred of them, and a wrong guess costs nothing because the label is
// editable. So the search is deliberately narrow: a sheet-number-shaped token,
// in the bottom-right corner, largest text first.

const SHEET_NUM_RE = /^[A-Z]{1,3}[- ]?\d{1,3}(\.\d{1,3})?[A-Z]?$/;

/**
 * A guess at this page's sheet number, from its own text layer.
 * Returns '' when nothing in the corner looks like one.
 */
export async function guessSheetNumber(page) {
  let content;
  try {
    content = await page.getTextContent();
  } catch {
    return '';
  }
  const vp = page.getViewport({ scale: 1 });
  const W = vp.width, H = vp.height;

  const candidates = [];
  for (const item of content.items) {
    const raw = String(item.str || '').trim().toUpperCase();
    if (!raw || raw.length > 10) continue;
    if (!SHEET_NUM_RE.test(raw)) continue;
    const t = item.transform;
    const x = t[4], y = t[5];
    const size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
    // pdf.js y grows upward from the bottom of the page.
    const inCorner = x > W * 0.62 && y < H * 0.30;
    if (!inCorner) continue;
    candidates.push({ text: raw.replace(/\s+/g, ''), size, x, y });
  }
  if (!candidates.length) return '';
  // Largest type wins; on a tie the lower-right one does, because that is
  // where the number sits and the discipline code sits above it.
  candidates.sort((a, b) => b.size - a.size || (a.y - b.y) || (b.x - a.x));
  return candidates[0].text;
}

/**
 * A guess at the sheet's title, from the title block.
 *
 * Deliberately timid. Tested against a prose PDF with no title block, the
 * loose version happily returned ", and the drawing takes" and "— no form, no"
 * as sheet names. A wrong sheet number costs nothing because it is obviously
 * wrong; a wrong sheet NAME looks like a real one and gets printed on reports.
 *
 * So a title is only accepted when the page actually has a title block —
 * signalled by a sheet number in the same corner — and when the text reads
 * like a drawing title rather than like a sentence.
 */
export async function guessSheetTitle(page, sheetNumber = null) {
  // No sheet number means no title block, which means nothing here is a title.
  const number = sheetNumber ?? await guessSheetNumber(page);
  if (!number) return '';

  let content;
  try {
    content = await page.getTextContent();
  } catch {
    return '';
  }
  const vp = page.getViewport({ scale: 1 });
  const W = vp.width, H = vp.height;

  const words = [];
  for (const item of content.items) {
    const raw = String(item.str || '').trim();
    if (!looksLikeSheetTitle(raw)) continue;
    const t = item.transform;
    const x = t[4], y = t[5];
    if (!(x > W * 0.55 && y < H * 0.42)) continue;
    if (SHEET_NUM_RE.test(raw.toUpperCase())) continue;
    const size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
    words.push({ text: raw, size, y });
  }
  if (!words.length) return '';
  words.sort((a, b) => b.size - a.size || b.y - a.y);
  return words[0].text.replace(/\s+/g, ' ').trim();
}

/**
 * Does this read like a drawing title? "FOUNDATION PLAN" yes; "and the
 * drawing takes" no.
 */
function looksLikeSheetTitle(raw) {
  if (raw.length < 3 || raw.length > 48) return false;
  const letters = raw.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  // Sentence punctuation is prose, not a title block.
  if (/[.,;:!?]/.test(raw.replace(/\.$/, ''))) return false;
  if (/[—–]/.test(raw)) return false;
  // A title block is set in capitals on essentially every drawing ever printed.
  const upper = letters.replace(/[^A-Z]/g, '').length / letters.length;
  if (upper < 0.7) return false;
  // Three or more common lower-case function words means it is a sentence.
  const stop = (raw.toLowerCase().match(/(the|and|of|to|a|is|in|for|no|with|that|it)/g) || []).length;
  return stop < 2;
}

/**
 * Import every page of a PDF, one at a time.
 *
 * `onPage` is called with each rendered page and must consume it before
 * returning — the canvas is released as soon as it resolves.
 */
export async function importPdf(data, {
  dpi = DEFAULT_DPI,
  readSheetNumbers = true,
  onPage,
  onProgress,
  signal,
} = {}) {
  const doc = await openPdf(data);
  const total = doc.numPages;
  const labels = [];
  const names = [];
  try {
    for (let i = 1; i <= total; i++) {
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
      const page = await doc.getPage(i);
      const raster = await renderPage(page, dpi);
      let label = '';
      let name = '';
      if (readSheetNumbers) {
        label = await guessSheetNumber(page);
        name = await guessSheetTitle(page, label);
      }
      labels.push(label);
      names.push(name);
      if (onPage) await onPage({ index: i - 1, raster, label, name, page });
      page.cleanup();
      if (onProgress) onProgress(i, total, 'Rendering');
      // Yield so the progress bar actually paints between sheets.
      await new Promise(r => setTimeout(r, 0));
    }
  } finally {
    doc.destroy();
  }
  return { pageCount: total, labels, names };
}
