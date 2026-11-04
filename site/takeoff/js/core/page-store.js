// page-store.js — page pixels, fetched and decoded on demand.
//
// WHY THIS EXISTS AT ALL. Measured against the estimator's live library: one
// sheet is 6300 × 4500 at 150 DPI, which is 113 MB once it is decoded to RGBA,
// and a job runs to 240 of them. Fully decoded that is 27 GB. The container
// itself reaches 2.3 GB, so it cannot be held as bytes either.
//
// So this store holds NO pixels and NO file bytes. It holds a File and a list
// of {offset, size}, fetches one page's compressed blob when that page is
// drawn, and keeps a handful of decoded ImageBitmaps in an LRU that closes
// what it evicts. Thumbnails are decoded once at a fraction of the size and
// kept, because the sheet list needs them all and they are small.
//
// A page's SOURCE is one of four things, and knowing which is what makes
// saving nearly free:
//   'slice'  a Blob slice of the opened file. Untouched. On save it is passed
//            straight through — no fetch, no decode, no re-encode.
//   'raw'    zlib(PNG) bytes we already hold.
//   'png'    PNG bytes we produced (a freshly imported PDF page).
//   'bitmap' pixels with no encoded form yet (a blank sheet we drew).

import { pageBlob, readPagePng, decodePng, encodePageSource } from './takeoff-file.js';
import { canvasLimits, fitFactor } from './canvas-limits.js';

const DEFAULT_LRU = 4;
const THUMB_WIDTH = 176;

export class PageStore {
  constructor({ lruSize = DEFAULT_LRU } = {}) {
    this.file = null;
    this.lruSize = lruSize;

    // The plan-revision image sets, as Blob slices of the opened file — one
    // per sheet of each re-issue, fetched only when that sheet is looked at.
    // On the estimator's largest job this tail is 1.42 GB, more than the
    // original drawings, so it is never read as a whole and never held.
    // Untouched sets pass straight back through on a save.
    /** @type {Array<Array<Blob>>} */
    this.revisionSlices = [];

    // Revision sheets get their own cache, deliberately small and deliberately
    // separate. The main LRU holds four, which is what makes paging smooth;
    // letting a revision preview in would evict the very sheet it is being
    // compared against, and flipping between the two is what comparing IS.
    this.revLruSize = 2;
    /** @type {Map<string, ImageBitmap>} keyed `${set}:${page}` */
    this._revLru = new Map();
    this._revPending = new Map();
    /** @type {Map<string, {width:number,height:number}>} */
    this._revSizes = new Map();

    /** @type {Array<{kind:string,data:any,width:number,height:number}>} */
    this.sources = [];
    /** @type {Map<number, ImageBitmap>} insertion order is recency order */
    this._lru = new Map();
    /** @type {Map<number, ImageBitmap>} */
    this._thumbs = new Map();
    this._pending = new Map();
    this._thumbPending = new Map();
    // The last sheet inflated, kept whole. Reading one detail closely takes
    // several crops of the same sheet as the user pans and zooms, and for a
    // 'slice' source each pngBytes() re-read the Blob and re-inflated ~20 MB.
    // One entry: bounded, and dropped whenever the page set moves under it.
    /** @type {{index:number,bytes:Uint8Array,blob:Blob|null}|null} */
    this._bytes = null;
    /** @type {Map<number, Promise<Uint8Array>>} in-flight inflates */
    this._bytesPending = new Map();
    /** @type {WeakMap<object, Blob>} one Blob per already-in-memory sheet */
    this._pngBlobs = new WeakMap();
    // Bumped whenever a page is inserted, removed or moved. A decode that
    // was already in flight when the set changed underneath it must not
    // write its result into what is now a different sheet's slot.
    this._gen = 0;
  }

  get pageCount() { return this.sources.length; }

  /** Adopt an opened project's page index. Nothing is fetched or decoded. */
  setFromProject({ file, pages, revisions = [] }) {
    this.clearCaches();
    this.file = file;
    this.sources = pages.map(entry => ({
      kind: 'slice', data: pageBlob(file, entry), width: 0, height: 0,
    }));
    this.revisionSlices = revisions.map(set => set.map(e => pageBlob(file, e)));
  }

  clearCaches() {
    // A decode in flight has captured _gen and will file its result under
    // the index it asked for. Swapping the project replaces `sources`
    // wholesale, so that index now names a different sheet in a different
    // job — the strongest reason there is for an in-flight read to stop
    // trusting its own index, and the one case this counter was not
    // covering. Without it an inflate straddling File > Open filed the OLD
    // project's bytes under the NEW project's number, and nativeSize()
    // then stamped the old sheet's dimensions onto the new source, where
    // they outlived the bytes.
    this._gen++;
    for (const bmp of this._lru.values()) bmp.close?.();
    for (const bmp of this._thumbs.values()) bmp.close?.();
    this._lru.clear();
    this._thumbs.clear();
    this._pending.clear();
    this._thumbPending.clear();
    this._bytes = null;
    this._bytesPending.clear();
    // The revision caches too. They are keyed `${set}:${page}` with no file in
    // the key, so opening a second project over the first would hand back the
    // FIRST one's revision sheets under the second one's numbers: a picture of
    // the wrong drawing, from the wrong job, with nothing to show it.
    this.clearRevisionCaches();
    this._revSizes.clear();
  }

  addPage(source, at = -1) {
    const entry = {
      kind: source.kind, data: source.data,
      width: source.width || 0, height: source.height || 0,
    };
    if (at < 0 || at >= this.sources.length) {
      this.sources.push(entry);
      return this.sources.length - 1;
    }
    this.sources.splice(at, 0, entry);
    this._shiftCaches(at, +1);
    return at;
  }

  removePage(index) {
    if (index < 0 || index >= this.sources.length) return false;
    this.sources.splice(index, 1);
    this._lru.get(index)?.close?.();
    this._lru.delete(index);
    // Every width this sheet was cached at, not just the default one.
    for (const k of [...this._thumbs.keys()]) {
      if (thumbKeyIndex(k) === index) {
        this._thumbs.get(k)?.close?.();
        this._thumbs.delete(k);
      }
    }
    this._shiftCaches(index, -1);
    return true;
  }

  movePage(from, to) {
    if (from === to) return;
    this._gen++;
    const [entry] = this.sources.splice(from, 1);
    this.sources.splice(to, 0, entry);
    // Cheaper to drop the caches than to permute two maps correctly.
    this.clearCaches();
  }

  _shiftCaches(at, delta) {
    this._gen++;
    // Two caches, two key shapes: _lru is the page index, _thumbs is
    // `${index}:${width}`. Shifting the second as if it were a number turns
    // every key into NaN and quietly leaves the whole cache pointing at the
    // wrong sheets, which is a picture of the wrong drawing, not a crash.
    const lruMoved = [];
    for (const [k, v] of this._lru) if (k >= at) lruMoved.push([k, v]);
    for (const [k] of lruMoved) this._lru.delete(k);
    for (const [k, v] of lruMoved) this._lru.set(k + delta, v);

    const thumbMoved = [];
    for (const [k, v] of this._thumbs) {
      const i = thumbKeyIndex(k);
      if (i >= at) thumbMoved.push([i, thumbKeyWidth(k), v]);
    }
    for (const [i, w] of thumbMoved) this._thumbs.delete(`${i}:${w}`);
    for (const [i, w, v] of thumbMoved) this._thumbs.set(`${i + delta}:${w}`, v);
    // Keyed by index like the LRU, but worth no shifting: it holds one sheet.
    this._bytes = null;
    this._bytesPending.clear();
    this._pending.clear();
    this._thumbPending.clear();
  }

  /** PNG bytes for a page, fetched and inflated. */
  async pngBytes(index) {
    const src = this.sources[index];
    if (!src) throw new Error(`No sheet ${index + 1}`);
    // Already in memory: hand it straight back, and do NOT let it into the
    // one-entry cache. Routing it through there made reading any imported
    // sheet evict the kept inflate of the scanned sheet a preview was
    // panning — paying a 20 MB re-read for a sheet that cost nothing.
    // pngBlob keeps the Blob for these somewhere that cannot evict anything.
    if (src.kind === 'png') return src.data;
    if (this._bytes && this._bytes.index === index) return this._bytes.bytes;
    // One inflate per sheet, however many callers want it at once. The
    // cache is only written when the inflate COMPLETES, so without this
    // every caller that arrives first — the preview's crop, a prefetched
    // neighbour, the sheets list — read the Blob and inflated 3-21 MB of
    // its own. getPage and getThumbnail have always shared their work this
    // way; this is the same map in the same shape.
    const already = this._bytesPending.get(index);
    if (already) return already;
    const job = this._inflateSheet(index, src);
    this._bytesPending.set(index, job);
    try {
      return await job;
    } finally {
      if (this._bytesPending.get(index) === job) this._bytesPending.delete(index);
    }
  }

  /** @private The read itself. Always go through pngBytes. */
  async _inflateSheet(index, src) {
    const gen = this._gen;
    // AWAIT it. `inflate` is async, and the code this replaced ended in
    // `return inflate(...)`, where an async function's return awaited it for
    // free. Assigning it to a variable does not: the cache then held a
    // PROMISE where the bytes should be, which still read back correctly
    // (an async return awaits that too) but made `_bytes.bytes.length`
    // undefined, so residentBytes() reported NaN and pngBlob's identity
    // check never matched.
    let out;
    if (src.kind === 'slice') {
      const { inflate } = await import('./zlib.js');
      out = await inflate(new Uint8Array(await src.data.arrayBuffer()));
    } else if (src.kind === 'raw') {
      const { inflate } = await import('./zlib.js');
      out = await inflate(src.data);
    } else {
      // A bitmap has no encoded form until it is asked for one.
      const { part } = await encodePageSource({ kind: 'bitmap', data: src.data });
      const { inflate } = await import('./zlib.js');
      out = await inflate(part);
    }
    // Pages may have been inserted, removed or moved while this was in
    // flight, and then `index` no longer names the sheet these bytes came
    // from. Hand them to the caller that asked; do not file them.
    if (gen === this._gen) this._bytes = { index, bytes: out, blob: null };
    return out;
  }

  /**
   * The same bytes as an image/png Blob, kept.
   *
   * `new Blob([bytes])` COPIES the buffer, and reading one detail closely
   * now takes a crop per settled gesture — each one was allocating a fresh
   * copy of a 3-21 MB inflated sheet. A Blob holds no decoded pixels, so
   * keeping it beside the bytes that are already being kept costs nothing
   * new, and it is dropped by exactly the same rules.
   */
  async pngBlob(index) {
    const src = this.sources[index];
    if (src && src.kind === 'png') {
      // Keyed by the SOURCE, not by an index: it cannot be stale after a
      // page move, it cannot evict anything, and it goes when the source
      // does.
      let held = this._pngBlobs.get(src);
      if (!held) {
        held = new Blob([src.data], { type: 'image/png' });
        this._pngBlobs.set(src, held);
      }
      return held;
    }
    const bytes = await this.pngBytes(index);
    const held = this._bytes;
    if (held && held.index === index && held.bytes === bytes) {
      if (!held.blob) held.blob = new Blob([bytes], { type: 'image/png' });
      return held.blob;
    }
    return new Blob([bytes], { type: 'image/png' });
  }

  /**
   * How big a sheet really is, without decoding it.
   *
   * pageSize() falls back to getPage() — a full decode — for any source
   * that does not already know its dimensions, which is every sheet of a
   * file that has just been opened. The PNG says so in its IHDR, 16 bytes
   * in, and a sheet about to be cropped has to be inflated anyway.
   */
  async nativeSize(index) {
    const src = this.sources[index];
    if (!src) return null;
    // A ReducedPage reports its sheet's TRUE size, which is what this is.
    const live = this._lru.get(index);
    if (live && live.width && live.height) {
      return { width: live.width, height: live.height };
    }
    if (src.width && src.height) return { width: src.width, height: src.height };
    const nat = pngSize(await this.pngBytes(index));
    if (nat && this.sources[index] === src) {
      src.width = nat.width; src.height = nat.height;
    }
    return nat;
  }

  /**
   * The full-resolution page, decoded. Repeated calls for the same page while
   * one decode is in flight all await that single decode.
   */
  async getPage(index) {
    const hit = this._lru.get(index);
    if (hit) {
      this._lru.delete(index);        // re-insert to mark it most recent
      this._lru.set(index, hit);
      return hit;
    }
    const inflight = this._pending.get(index);
    if (inflight) return inflight;

    const gen = this._gen;
    let job;
    const mine = () => this._pending.get(index) === job;
    job = this._decode(index).then(bmp => {
      // Only if it is still OURS. clearCaches and _shiftCaches both empty
      // this map, so a job registered AFTER a page change sits under the
      // same key — deleting it here left a decode in flight that nothing
      // knew about, and the next ask started a second one. pngBytes guards
      // its own map exactly this way.
      if (mine()) this._pending.delete(index);
      // A sheet was inserted, removed or moved — or another project was
      // opened — while this was decoding, so `index` no longer means what
      // it meant when the job started. pngBytes and getThumbnail have both
      // checked this for a long time; this one never did, and it is the
      // worst place to miss it, because it files a DRAWING under that index
      // and stamps the sheet's dimensions on whatever source is there now,
      // where they outlive the pixels. Deleting a sheet during a prefetch
      // was enough.
      if (bmp && gen !== this._gen) {
        queueMicrotask(() => bmp.close?.());
        return null;
      }
      if (bmp) {
        const src = this.sources[index];
        if (src) { src.width = bmp.width; src.height = bmp.height; }
        this._lru.set(index, bmp);
        this._evict(index);
      }
      return bmp;
    }).catch(err => {
      if (mine()) this._pending.delete(index);
      throw err;
    });
    this._pending.set(index, job);
    return job;
  }

  /** The decoded page if it happens to be resident, else null. Never decodes. */
  peekPage(index) {
    return this._lru.get(index) || null;
  }

  async _decode(index) {
    const src = this.sources[index];
    if (!src) return null;
    if (src.kind === 'bitmap') return src.data;
    const bytes = await this.pngBytes(index);
    return decodeSheet(bytes);
  }

  // ── revision sheets ────────────────────────────────────────────────────
  //
  // A revision set is another drawing set living in the same file, and it is
  // where most of the bytes are: on the estimator's largest job the eleven
  // revision sets come to 1.42 GB against 887 MB of original sheets. So they
  // are read exactly like the main pages — one Blob slice at a time, decoded
  // only when looked at — and they get their OWN small cache.
  //
  // The separate cache is the point. The main LRU holds four sheets, which is
  // what makes paging through a set smooth. Letting a revision preview into it
  // would evict the sheet the user is comparing against, so flipping between
  // the two would re-decode both every time: measured, a 6300x4500 sheet is
  // 21-120 ms to decode, and flipping is exactly what comparing IS.

  /** Has this project got a revision set at `set` with a page at `page`? */
  hasRevisionPage(set, page) {
    const s = this.revisionSlices[set];
    return !!(s && page >= 0 && page < s.length);
  }

  /** How many sheets a revision set holds. Reads nothing. */
  revisionPageCount(set) {
    return (this.revisionSlices[set] || []).length;
  }

  /** zlib-inflated PNG bytes for one revision sheet. */
  async revisionPngBytes(set, page) {
    const blob = (this.revisionSlices[set] || [])[page];
    if (!blob) throw new Error(`No page ${page + 1} in revision set ${set + 1}`);
    const { inflate } = await import('./zlib.js');
    return inflate(new Uint8Array(await blob.arrayBuffer()));
  }

  /** One revision sheet, decoded. Concurrent calls share one decode. */
  async getRevisionPage(set, page) {
    const key = `${set}:${page}`;
    const hit = this._revLru.get(key);
    if (hit) {
      this._revLru.delete(key);
      this._revLru.set(key, hit);
      return hit;
    }
    const inflight = this._revPending.get(key);
    if (inflight) return inflight;

    const job = (async () => {
      const bmp = await decodeSheet(await this.revisionPngBytes(set, page));
      this._revPending.delete(key);
      this._revLru.set(key, bmp);
      while (this._revLru.size > this.revLruSize) {
        const oldest = this._revLru.keys().next().value;
        if (oldest === key) break;
        const old = this._revLru.get(oldest);
        this._revLru.delete(oldest);
        queueMicrotask(() => old?.close?.());
      }
      return bmp;
    })().catch(err => {
      this._revPending.delete(key);
      throw err;
    });
    this._revPending.set(key, job);
    return job;
  }

  /** The decoded revision sheet if it is resident, else null. Never decodes. */
  peekRevisionPage(set, page) {
    return this._revLru.get(`${set}:${page}`) || null;
  }

  // There is deliberately NO getRevisionThumbnail here.
  //
  // A revision blob is a whole compressed sheet: measured over the real tail
  // of the 2.3 GB job, 3.52 MB on average and 21.14 MB at the worst, and a
  // PNG is already deflated so inflating buys nothing back. One 96px tile
  // would cost that whole read, a second copy to hand it to the decoder, and
  // a 28-megapixel decode — and the matrix on that job is 2,568 cells.
  //
  // So the grid is text and state, and a picture is fetched only when one
  // cell is actually chosen: getRevisionPage, one sheet, on demand. If a
  // preview picture is ever wanted here, it must be per-row-on-click with a
  // single-slot queue, never a scroll-driven fill — on a project opened from
  // the portal every one of those bytes is an HTTP range request.

  /**
   * A revision sheet's size when it is already known — on screen, or read
   * before — and null otherwise. Synchronous: the counting rule asks it in
   * the middle of a sentence and must never start a fetch to answer.
   */
  peekRevisionPageSize(set, page) {
    const live = this.peekRevisionPage(set, page);
    if (live) return { width: live.width, height: live.height };
    return this._revSizes.get(`${set}:${page}`) || null;
  }

  /** A revision sheet's true size, from the PNG's IHDR. No decode. */
  async revisionPageSize(set, page) {
    const live = this.peekRevisionPage(set, page);
    if (live) return { width: live.width, height: live.height };
    const cached = this._revSizes.get(`${set}:${page}`);
    if (cached) return cached;
    const blob = (this.revisionSlices[set] || [])[page];
    if (!blob) return null;
    // The IHDR is 16 bytes into the PNG, but the PNG is deflated. zlib has no
    // random access, so the smallest honest read is a prefix big enough to
    // inflate the first chunk out of — 4 KB covers it on every real sheet.
    // inflatePartial, not inflate: a 4 KB prefix of a sheet IS a truncated
    // deflate stream, and inflate() reads the whole thing through one
    // Response, which rejects. So this path has been dead in every build —
    // first because the Promise was never awaited, and then, once it was,
    // because the read it awaited could only ever throw. A chunked read
    // keeps what arrived before the end ran out, which on a real sheet is
    // thousands of bytes where 24 would do.
    const { inflatePartial } = await import('./zlib.js');
    let size = null;
    try {
      size = pngSize(await inflatePartial(
        new Uint8Array(await blob.slice(0, 4096).arrayBuffer()), 64));
    } catch {
      size = null;                       // a truncated stream tells us nothing
    }
    if (!size) size = pngSize(await this.revisionPngBytes(set, page));
    if (size) this._revSizes.set(`${set}:${page}`, size);
    return size;
  }

  /** Release every decoded revision sheet. The slices stay — they hold nothing. */
  clearRevisionCaches() {
    for (const b of this._revLru.values()) b?.close?.();
    this._revLru.clear();
    this._revPending.clear();
  }

  /**
   * A crop of one sheet, decoded straight out of the PNG at preview size.
   *
   * `zone` is [x0, y0, x1, y1] in 0..1 of the sheet, which is what a callout
   * stores in ref_zone. The crop overload of createImageBitmap decodes only
   * the rectangle asked for, so this costs about the same as a full decode
   * (~96ms on a 5400x3600 sheet, measured) and allocates 1 MB instead of 74:
   * the whole sheet is never held to take a corner out of it.
   *
   * Note the argument order — resizeWidth applies to the CROP, not the
   * sheet. Do not reach for the plain {resizeWidth} form instead: measured,
   * it is SLOWER than a full decode, because it decodes everything and then
   * resamples.
   */
  async cropRegion(index, zone, maxWidth = 480) {
    const src = this.sources[index];
    if (!src || !Array.isArray(zone) || zone.length < 4) return null;

    const nat = await this.nativeSize(index);
    if (!nat) return null;

    const { sx, sy, sw, sh } = cropGeometry(zone, nat);
    if (sw < 2 || sh < 2) return null;          // an empty zone is no preview

    const scale = Math.min(1, maxWidth / sw);
    const opts = scale < 1
      ? { resizeWidth: Math.max(1, Math.round(sw * scale)),
          resizeHeight: Math.max(1, Math.round(sh * scale)),
          resizeQuality: 'high' }
      : undefined;

    // A resident full-size sheet is the fast path: crop it in ~1ms rather
    // than re-reading and re-inflating megabytes we already have.
    const live = this._lru.get(index);
    if (live) {
      const inner = live.bitmap || live;
      const k = live.reduced ? inner.width / live.width : 1;
      // ...unless it is a REDUCED sheet holding fewer pixels than were
      // asked for. iOS caps a canvas, so on the device this preview is
      // read on, the big sheets are exactly the ones held at less than
      // their own resolution: cropping from there would answer a request
      // for a sharp detail with a soft one, for ever. The encoded page
      // still has every pixel, so go and get them.
      if (sw * k >= Math.min(maxWidth, sw) - 1) {
        return createImageBitmap(inner, Math.floor(sx * k), Math.floor(sy * k),
                                 Math.max(1, Math.round(sw * k)),
                                 Math.max(1, Math.round(sh * k)), opts);
      }
    }
    return createImageBitmap(await this.pngBlob(index), sx, sy, sw, sh, opts);
  }

  _evict(keep) {
    while (this._lru.size > this.lruSize) {
      const oldest = this._lru.keys().next().value;
      if (oldest === keep) break;
      const bmp = this._lru.get(oldest);
      this._lru.delete(oldest);
      // A bitmap still being painted this frame must not be closed under the
      // renderer, so release it on the next turn of the loop instead.
      queueMicrotask(() => bmp?.close?.());
    }
  }

  /** Page size without paying for a full decode when the source knows it. */
  async pageSize(index) {
    const src = this.sources[index];
    if (!src) return null;
    if (src.width && src.height) return { width: src.width, height: src.height };
    const bmp = await this.getPage(index);
    return bmp ? { width: bmp.width, height: bmp.height } : null;
  }

  /**
   * A small bitmap for the sheets list. Decoded once, then kept.
   *
   * Keyed by index AND width. It used to be keyed by index alone while
   * taking a width argument, so the first caller's size won: ask for 1024
   * anywhere and the 176px sheets list would be handed the 1024 one for the
   * rest of the session — 240 sheets x 3 MB pinned, and nothing evicts this
   * cache. Two callers at two sizes is exactly what a continuous view wants,
   * so the key has to carry the size.
   */
  async getThumbnail(index, width = THUMB_WIDTH) {
    const key = `${index}:${width}`;
    const hit = this._thumbs.get(key);
    if (hit) return hit;
    const inflight = this._thumbPending.get(key);
    if (inflight) return inflight;

    const gen = this._gen;
    const job = (async () => {
      const src = this.sources[index];
      if (!src) return null;
      let out;
      if (src.kind === 'bitmap') {
        out = src.data.width > width
          ? await createImageBitmap(src.data, { resizeWidth: width, resizeQuality: 'medium' })
          : src.data;
      } else {
        // resizeWidth lets the decoder downsample straight out of the PNG, so
        // the 113 MB full-size surface is never allocated at all.
        out = await decodePng(await this.pngBytes(index), {
          resizeWidth: width, resizeQuality: 'medium',
        });
      }
      // The resize options are OPTIONAL in the spec, and a browser that ignores
      // them hands back the full-size bitmap instead. That is not a cosmetic
      // difference: a 6300×4500 sheet is 113 MB, one is kept per page for the
      // life of the project, and a 240-sheet set would be 27 GB. So check what
      // actually came back rather than trusting the request.
      if (out && out.width > width * 1.5) {
        out = await shrinkBitmap(out, width, src.kind !== 'bitmap');
      }
      this._thumbPending.delete(key);
      // A sheet was inserted, removed or moved while this was decoding, so
      // `index` no longer means what it meant when the job started. Hand the
      // caller its bitmap but do not file it under a key that now points at
      // a different drawing.
      if (gen !== this._gen) { queueMicrotask(() => out?.close?.()); return null; }
      this._thumbs.set(key, out);
      return out;
    })().catch(err => {
      this._thumbPending.delete(key);
      console.warn('thumbnail decode failed for sheet', index + 1, err);
      return null;
    });

    this._thumbPending.set(key, job);
    return job;
  }

  /**
   * Warm the pages either side of the current one, so paging through a set
   * does not stall. Failures here are silent by design — a prefetch that
   * cannot run is not an error the user should ever be told about.
   */
  prefetchAround(index, radius = 1) {
    for (let d = 1; d <= radius; d++) {
      for (const i of [index - d, index + d]) {
        if (i >= 0 && i < this.sources.length && !this._lru.has(i)) {
          this.getPage(i).catch(() => {});
        }
      }
    }
  }

  /**
   * The page sources in the shape the writer wants.
   *
   * Every untouched page comes back as its original Blob slice, so a save is a
   * composition rather than a copy. That is what makes saving a 2 GB project
   * possible in a tab at all.
   */
  saveSources() {
    return this.sources.map(src => ({ kind: src.kind, data: src.data }));
  }

  /** The revision image sets, ready for the writer. Pass-through slices. */
  saveRevisionSources() {
    return this.revisionSlices.map(set => set.map(b => ({ kind: 'slice', data: b })));
  }

  /** How many revision sheets are being carried through a save. */
  revisionSheetCount() {
    return this.revisionSlices.reduce((n, s) => n + s.length, 0);
  }

  /** Rough resident pixel cost, for the status bar and for tuning lruSize. */
  residentBytes() {
    let n = 0;
    for (const b of this._lru.values()) n += b.width * b.height * 4;
    for (const b of this._thumbs.values()) n += b.width * b.height * 4;
    for (const b of this._revLru.values()) n += b.width * b.height * 4;
    // The kept sheet counts too. It is the largest single thing this store
    // holds that is not a decoded page — 3-21 MB of inflated PNG — and it
    // was invisible to the only function that reports what is resident.
    // ...and the Blob beside them, which is a SECOND copy of the sheet:
    // `new Blob([bytes])` snapshots the buffer, which is the whole reason
    // keeping one is worth it.
    if (this._bytes) {
      n += this._bytes.bytes.length;
      if (this._bytes.blob) n += this._bytes.blob.size;
    }
    return n;
  }
}

/**
 * Decode one sheet's PNG bytes, reduced if this browser cannot hold it.
 *
 * Shared by the main pages and the revision sheets: a revision set is another
 * drawing set, and iOS caps a canvas just as hard whichever set a sheet came
 * from. `ReducedPage` still reports the sheet's TRUE size, so page space and
 * every measurement on it are unchanged.
 */
async function decodeSheet(bytes) {
  // How big is this sheet, before anything tries to hold it? The PNG says so
  // in its IHDR, 16 bytes in — far cheaper than finding out by failing.
  const nat = pngSize(bytes);
  const limits = await canvasLimits();
  const factor = nat ? fitFactor(nat.width, nat.height, limits) : 1;
  if (!nat || factor >= 1) return decodePng(bytes);

  const w = Math.max(1, Math.floor(nat.width * factor));
  const h = Math.max(1, Math.floor(nat.height * factor));
  let small = null;
  if (limits.resizeOnDecode) {
    small = await decodePng(bytes, {
      resizeWidth: w, resizeHeight: h, resizeQuality: 'high',
    });
    // Asked for, not necessarily given. A decoder that ignored the request
    // just handed back the full-size bitmap we were trying to avoid.
    if (small.width !== w) small = await shrinkBitmap(small, w, true);
  } else {
    small = await shrinkBitmap(await decodePng(bytes), w, true);
  }
  return new ReducedPage(small, nat.width, nat.height);
}

/**
 * Downscale a bitmap the decoder refused to downscale for us.
 *
 * `closeSource` says whether the input is ours to release — a thumbnail we
 * just decoded is, a page the caller still owns is not.
 */
/**
 * A sheet decoded smaller than it really is.
 *
 * It reports the sheet's TRUE width and height, because the page rect and
 * every measurement in the file are in native sheet pixels. Only the pixels
 * are fewer. Drawn with an explicit destination size, it lands exactly where
 * the full-size sheet would have.
 */
export class ReducedPage {
  constructor(bitmap, width, height) {
    this.bitmap = bitmap;
    this.width = width;
    this.height = height;
    this.reduced = true;
  }

  /** The LRU closes what it evicts; the inner bitmap is what holds memory. */
  close() { this.bitmap?.close?.(); }
}

/** The page index out of a `${index}:${width}` thumbnail cache key. */
function thumbKeyIndex(key) {
  return Number(String(key).slice(0, String(key).indexOf(':')));
}

/** The width out of a `${index}:${width}` thumbnail cache key. */
function thumbKeyWidth(key) {
  return String(key).slice(String(key).indexOf(':') + 1);
}

/**
 * A 0..1 zone on a sheet, as whole sheet pixels.
 *
 * The ONE definition. The callout preview draws the bitmap it gets back at
 * a position it works out from this rectangle, so a second copy of the
 * arithmetic — floor here, round there — would slide the picture under
 * the drawing it claims to be, by an error that grows with every zoom step.
 */
export function cropGeometry(zone, nat) {
  const x0 = Math.max(0, Math.min(1, Number(zone[0]) || 0));
  const y0 = Math.max(0, Math.min(1, Number(zone[1]) || 0));
  const x1 = Math.max(0, Math.min(1, Number(zone[2]) || 0));
  const y1 = Math.max(0, Math.min(1, Number(zone[3]) || 0));
  const sx = Math.floor(Math.min(x0, x1) * nat.width);
  const sy = Math.floor(Math.min(y0, y1) * nat.height);
  const sw = Math.max(1, Math.round(Math.abs(x1 - x0) * nat.width));
  const sh = Math.max(1, Math.round(Math.abs(y1 - y0) * nat.height));
  return { sx, sy, sw, sh };
}

/** Width and height out of a PNG's IHDR, without decoding a single pixel. */
export function pngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  // 8-byte signature, then the IHDR chunk: length, type, then w and h.
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  if (!width || !height) return null;
  return { width, height };
}

async function shrinkBitmap(bmp, width, closeSource) {
  const scale = width / bmp.width;
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
  else {
    canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(bmp, 0, 0, w, h);
  const small = await createImageBitmap(canvas);
  if (closeSource) bmp.close?.();
  return small;
}
