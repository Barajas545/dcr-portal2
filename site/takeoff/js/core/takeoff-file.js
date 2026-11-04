// takeoff-file.js — read and write the native ".takeoff" project container.
//
// Byte layout (little-endian throughout), identical to the desktop app:
//
//   "PDFCACHE1"                     9 bytes  magic
//   uint32  page_count
//   uint32  meta_len
//   bytes   meta_len                UTF-8 JSON metadata block
//   page_count × { uint64 offset, uint32 size }      the page index (12 B each)
//   ... zlib(PNG) page blobs, at the absolute offsets named by the index ...
//   optional trailing revision section:
//     "TKREVS01"                    8 bytes  magic
//     uint32  rev_count
//     rev_count × { uint32 n_pages, n_pages × uint32 blob_len }
//     ... every blob's bytes, in the same order ...
//
// ─────────────────────────────────────────────────────────────────────────
// THE ONE THING TO UNDERSTAND ABOUT THIS FILE
//
// Real projects are enormous. Measured against the estimator's live library:
// a 173-sheet job is 2.31 GB (887 MB of pages plus a 1.42 GB revision tail);
// a 240-sheet job is 1.75 GB; one sheet is 6300 × 4500, which is 113 MB once
// it is decoded to RGBA.
//
// The desktop loader does `data = f.read()` and decodes every page. A browser
// cannot do either. So NOTHING here reads the whole file:
//
//   · Opening reads the 17-byte header, the metadata block, and the
//     page_count × 12 index. On the 2.3 GB project that is about 2 KB.
//   · A page's bytes are fetched with File.slice() only when that page is
//     actually drawn.
//   · Saving copies an untouched page through as a Blob SLICE, never as
//     bytes. Page rasters are immutable in this app — nothing anywhere ever
//     writes into a decoded page — so a re-encode would be pure loss: slower,
//     and a generation of PNG quality for nothing. Composing the output from
//     slices means a 2.3 GB save never materialises 2.3 GB in memory.
// ─────────────────────────────────────────────────────────────────────────

import { inflate, deflate } from './zlib.js';

export const MAGIC = 'PDFCACHE1';
export const REVS_MAGIC = 'TKREVS01';
export const FILE_EXTENSION = '.takeoff';
export const LEGACY_EXTENSION = '.pdfcache';

// A takeoff item is filed under the page it was drawn on. This key is not a
// page: it holds items that belong to the job rather than to any one sheet.
// Page inserts, deletes and reorders must carry it through untouched.
export const STANDALONE_PAGE = -1000;

const td = new TextDecoder('utf-8');
const te = new TextEncoder();

function ascii(bytes, pos, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[pos + i]);
  return s;
}

/** True only for a key that names a page of the main set. */
export function isMainPageKey(key, nPages) {
  const k = Number(key);
  return Number.isInteger(k) && k >= 0 && k < nPages;
}

/**
 * Move a page-keyed bucket along when pages are inserted or removed.
 * Anything that is not a page number stays exactly where it is.
 */
export function shiftPageKey(key, after, delta) {
  const k = Number(key);
  if (!Number.isFinite(k) || k === STANDALONE_PAGE) return key;
  return k > after ? k + delta : k;
}

/**
 * Order a store's keys: real pages in page order, the standalone bucket after.
 * -1000 parses as an integer, so it sorts BEFORE page 0 — which is what the
 * desktop app does, and changing it would reorder every export.
 */
export function pageSortKey(key) {
  const k = Number(key);
  if (Number.isFinite(k)) return [0, k, ''];
  return [1, 0, String(key)];
}

export function comparePageKeys(a, b) {
  const ka = pageSortKey(a), kb = pageSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || String(ka[2]).localeCompare(String(kb[2]));
}

// ── header-only reads ─────────────────────────────────────────────────────

async function readHead(blob) {
  const head = new Uint8Array(await blob.slice(0, MAGIC.length + 8).arrayBuffer());
  if (head.length < MAGIC.length + 8 || ascii(head, 0, MAGIC.length) !== MAGIC) {
    throw new Error('Not a Takeoff project file');
  }
  const dv = new DataView(head.buffer);
  const pageCount = dv.getUint32(MAGIC.length, true);
  const metaLen = dv.getUint32(MAGIC.length + 4, true);
  const avail = blob.size - (MAGIC.length + 8);
  if (metaLen <= 0 || metaLen > Math.max(0, avail)) {
    throw new Error('Project header is not readable');
  }
  return { pageCount, metaLen, metaStart: MAGIC.length + 8 };
}

/** (pageCount, metadata) of a project, read from its first few KB. */
export async function readHeader(blob) {
  const { pageCount, metaLen, metaStart } = await readHead(blob);
  const metaBytes = await blob.slice(metaStart, metaStart + metaLen).arrayBuffer();
  return { pageCount, metaLen, metadata: JSON.parse(td.decode(metaBytes)) };
}

// The project browser shows a dozen short fields, and in every real project the
// last of them ends well inside the first 64 KB — while the metadata block
// itself carries every annotation in the job and runs to 53 MB on the
// estimator's largest file. Scrape the fields out of a bounded prefix instead
// of parsing the block.
export const PROJECT_SUMMARY_KEYS = [
  'project_name', 'internal_id_number', 'client_name', 'project_address',
  'estimator_name', 'bid_date', 'project_type', 'project_status',
  'project_description', 'project_notes',
  'project_created', 'created',
  'project_modified', 'library_folder', 'source',
];
const PROJECT_SUMMARY_PREFIX = 64 * 1024;

// Each value is matched as a JSON string body, escapes and all. Anchoring on
// the opening quote is what keeps "created" from also matching the tail of
// "project_created".
const SUMMARY_RE = Object.fromEntries(
  PROJECT_SUMMARY_KEYS.map(k => [k, new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)])
);
const PROJECT_ID_RE = /"project_id"\s*:\s*(-?\d+)/;

function jsonUnescape(text) {
  if (!text.includes('\\')) return text;
  try { return JSON.parse('"' + text + '"'); } catch { return text; }
}

/** The fields a project list shows, read from the front of the file only. */
export async function readProjectSummary(blob, prefix = PROJECT_SUMMARY_PREFIX) {
  const { pageCount, metaLen, metaStart } = await readHead(blob);
  const want = prefix == null ? metaLen : Math.min(metaLen, prefix);
  const text = td.decode(await blob.slice(metaStart, metaStart + want).arrayBuffer());

  const out = { page_count: pageCount, project_id: null };
  for (const [key, rx] of Object.entries(SUMMARY_RE)) {
    const m = rx.exec(text);
    out[key] = m ? jsonUnescape(m[1]) : '';
  }
  const mid = PROJECT_ID_RE.exec(text);
  if (mid) out.project_id = parseInt(mid[1], 10);

  // The name is the one field with no sensible blank, and page_labels serialise
  // ahead of it. Pay the full read on that one file rather than list a
  // nameless project.
  if (!out.project_name && prefix != null && metaLen > want) {
    return readProjectSummary(blob, null);
  }
  return out;
}

// ── open ──────────────────────────────────────────────────────────────────

/**
 * Open a project from a File or Blob. Reads the header, the metadata block and
 * the page index — and nothing else. Page pixels are fetched later, one at a
 * time, through pageBlob() below.
 *
 * @returns {Promise<{
 *   file: Blob,
 *   pageCount: number,
 *   metadata: object,
 *   pages: Array<{offset:number,size:number}>,
 *   revisions: Array<Array<{offset:number,size:number}>>,
 *   annotations: object,
 *   measurements: object,
 *   bytesRead: number,
 * }>}
 */
export async function openProject(file) {
  const { pageCount, metaLen, metaStart } = await readHead(file);
  const metaBytes = await file.slice(metaStart, metaStart + metaLen).arrayBuffer();
  const metadata = JSON.parse(td.decode(metaBytes));

  const indexStart = metaStart + metaLen;
  const indexSize = pageCount * 12;
  if (indexStart + indexSize > file.size) {
    throw new Error('This project file is truncated — its page index runs past the end.');
  }
  const idxBuf = await file.slice(indexStart, indexStart + indexSize).arrayBuffer();
  const idv = new DataView(idxBuf);

  const pages = [];
  for (let i = 0, p = 0; i < pageCount; i++) {
    // The offset is a uint64. No file approaches 2^53 bytes, so narrowing to a
    // Number here is safe and keeps every downstream slice ordinary.
    const offset = Number(idv.getBigUint64(p, true)); p += 8;
    const size = idv.getUint32(p, true); p += 4;
    if (offset < 0 || size < 0 || offset + size > file.size) {
      throw new Error(`This project file is damaged — sheet ${i + 1} points outside the file.`);
    }
    pages.push({ offset, size });
  }

  const mainEnd = pages.length
    ? pages[pages.length - 1].offset + pages[pages.length - 1].size
    : indexStart + indexSize;
  const revisions = await readRevisionIndex(file, mainEnd);

  // Annotation and measurement keys are strings on disk and numbers in RAM.
  const annotations = intKeyed(metadata.annotations);
  const measurements = intKeyed(metadata.measurements);
  delete metadata.annotations;
  delete metadata.measurements;

  return {
    file, pageCount, metadata, pages, revisions, annotations, measurements,
    bytesRead: metaStart + metaLen + indexSize,
  };
}

/** {'3': x} → {3: x}, skipping anything that is not an index. */
export function intKeyed(d) {
  const out = {};
  for (const [k, v] of Object.entries(d || {})) {
    const n = parseInt(k, 10);
    if (Number.isFinite(n)) out[n] = v;
  }
  return out;
}

/**
 * The revision tail's INDEX only — offsets and sizes, never the blobs.
 * On the estimator's largest job that tail is 1.42 GB; reading it would be the
 * one thing that undoes everything else in this module.
 */
async function readRevisionIndex(file, mainEnd) {
  if (mainEnd + REVS_MAGIC.length > file.size) return [];
  const magicBytes = new Uint8Array(
    await file.slice(mainEnd, mainEnd + REVS_MAGIC.length).arrayBuffer()
  );
  if (ascii(magicBytes, 0, REVS_MAGIC.length) !== REVS_MAGIC) return [];

  try {
    let pos = mainEnd + REVS_MAGIC.length;
    const countBuf = await file.slice(pos, pos + 4).arrayBuffer();
    const revCount = new DataView(countBuf).getUint32(0, true);
    pos += 4;
    if (revCount > 10000) return [];   // a corrupt tail, not ten thousand revisions

    // The size table is variable length: one uint32 per revision set, then one
    // per sheet in it. A revision set is a re-issue of the drawing set, so its
    // sheet count is bounded by any sane project — 4096 is far past it, and
    // the whole read stays a few KB per set rather than touching the blobs.
    const MAX_SHEETS_PER_REVISION = 4096;
    const tableMax = Math.min(
      file.size - pos,
      revCount * 4 * (1 + MAX_SHEETS_PER_REVISION)
    );
    const tv = new DataView(await file.slice(pos, pos + tableMax).arrayBuffer());
    let t = 0;
    const sizeTable = [];
    for (let r = 0; r < revCount; r++) {
      const n = tv.getUint32(t, true); t += 4;
      const sizes = [];
      for (let p = 0; p < n; p++) { sizes.push(tv.getUint32(t, true)); t += 4; }
      sizeTable.push(sizes);
    }

    let blobPos = pos + t;
    const out = [];
    for (const sizes of sizeTable) {
      const entries = [];
      for (const sz of sizes) {
        entries.push({ offset: blobPos, size: sz });
        blobPos += sz;
      }
      out.push(entries);
    }
    if (blobPos > file.size) return [];   // truncated tail — the project still opens
    return out;
  } catch {
    return [];   // a corrupt revision tail must never cost the main project
  }
}

/** One page's compressed bytes, as a Blob slice. Reads nothing yet. */
export function pageBlob(file, entry) {
  return file.slice(entry.offset, entry.offset + entry.size);
}

/** One page's PNG bytes, read and inflated. */
export async function readPagePng(file, entry) {
  const buf = await pageBlob(file, entry).arrayBuffer();
  return inflate(new Uint8Array(buf));
}

/** PNG bytes → an ImageBitmap, decoded off the main thread where supported. */
export async function decodePng(pngBytes, opts) {
  const blob = new Blob([pngBytes], { type: 'image/png' });
  return createImageBitmap(blob, opts);
}

// ── write ─────────────────────────────────────────────────────────────────

/**
 * One page's pixels, as the writer wants them.
 *   { kind: 'slice',  data: Blob }        already zlib(PNG) — passed through
 *   { kind: 'raw',    data: Uint8Array }  already zlib(PNG) — passed through
 *   { kind: 'png',    data: Uint8Array }  PNG bytes, to be deflated
 *   { kind: 'bitmap', data: ImageBitmap|HTMLCanvasElement|OffscreenCanvas }
 *
 * A 'slice' is what every untouched imported page is, and it is why a save of
 * a 2 GB project neither decodes nor allocates anything.
 */
export async function encodePageSource(src) {
  if (src.kind === 'slice') {
    // A project opened over the network has slices that are handles, not
    // Blobs, and `new Blob([handle])` would stringify it into the file. Those
    // pages are pulled down here, one at a time as they are packed — a remote
    // save costs the whole project on the wire, which is the honest price of
    // writing back bytes the browser never had.
    const part = src.data instanceof Blob ? src.data : await src.data.blob();
    return { part, size: part.size };
  }
  if (src.kind === 'raw') return { part: src.data, size: src.data.length };
  let png = src.data;
  if (src.kind === 'bitmap') png = new Uint8Array(await bitmapToPng(src.data));
  const packed = await deflate(png);
  return { part: packed, size: packed.length };
}

async function bitmapToPng(bitmap) {
  const w = bitmap.width, h = bitmap.height;
  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(w, h);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise(res => canvas.toBlob(res, 'image/png'));
  return blob.arrayBuffer();
}

/**
 * Build the whole project file as a Blob.
 *
 * The result is a composition of parts, most of them slices of the file that
 * was opened. The browser streams those to disk when the Blob is written; they
 * are never all resident at once.
 *
 * @param {object} opts
 * @param {object} opts.metadata      the complete metadata block, annotations
 *                                    and measurements already folded in with
 *                                    STRING keys
 * @param {Array}  opts.pageSources   one entry per page, see encodePageSource
 * @param {Array<Array>} [opts.revisionSources]  page sources per revision set
 * @param {(done:number,total:number,label:string)=>void} [opts.onProgress]
 * @returns {Promise<Blob>}
 */
export async function writeProject({
  metadata, pageSources, revisionSources = [], onProgress,
}) {
  const metaBytes = te.encode(JSON.stringify(metadata));
  const pageCount = pageSources.length;

  const encoded = new Array(pageCount);
  for (let i = 0; i < pageCount; i++) {
    encoded[i] = await encodePageSource(pageSources[i]);
    if (onProgress) onProgress(i + 1, pageCount, 'Packing sheets');
    // Yield so a long save cannot freeze the tab. A pass-through page costs
    // nothing, so only stop for real work.
    if (pageSources[i].kind !== 'slice' && pageSources[i].kind !== 'raw') {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  const headerSize = MAGIC.length + 4 + 4 + metaBytes.length;
  const indexSize = pageCount * 12;
  const dataStart = headerSize + indexSize;

  const head = new Uint8Array(headerSize + indexSize);
  const hv = new DataView(head.buffer);
  head.set(te.encode(MAGIC), 0);
  hv.setUint32(MAGIC.length, pageCount, true);
  hv.setUint32(MAGIC.length + 4, metaBytes.length, true);
  head.set(metaBytes, MAGIC.length + 8);

  let cursor = dataStart;
  let ip = headerSize;
  for (const e of encoded) {
    hv.setBigUint64(ip, BigInt(cursor), true); ip += 8;
    hv.setUint32(ip, e.size, true); ip += 4;
    cursor += e.size;
  }

  const parts = [head, ...encoded.map(e => e.part)];

  // Revision images are appended past the indexed main blocks, so an older
  // build of the desktop app simply never reads them.
  if (revisionSources.length) {
    const sets = [];
    for (const set of revisionSources) {
      const out = [];
      for (const src of set) out.push(await encodePageSource(src));
      sets.push(out);
    }
    let tableLen = REVS_MAGIC.length + 4;
    for (const s of sets) tableLen += 4 + s.length * 4;
    const table = new Uint8Array(tableLen);
    const tv = new DataView(table.buffer);
    table.set(te.encode(REVS_MAGIC), 0);
    let tp = REVS_MAGIC.length;
    tv.setUint32(tp, sets.length, true); tp += 4;
    for (const s of sets) {
      tv.setUint32(tp, s.length, true); tp += 4;
      for (const e of s) { tv.setUint32(tp, e.size, true); tp += 4; }
    }
    parts.push(table);
    for (const s of sets) for (const e of s) parts.push(e.part);
  }

  if (onProgress) onProgress(pageCount, pageCount, 'Writing');
  return new Blob(parts, { type: 'application/octet-stream' });
}
