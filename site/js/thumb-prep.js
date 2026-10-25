/* The project picture, made in the browser the way DCR Desktop 2 makes it (dcrdesk/backend/thumbnails.py; owner
   decision 2026-10-24 D13): at most 800 px on its longer side, always drawn again (which is what drops the
   camera's EXIF and GPS: no path hands the original bytes on), JPEG — PNG only for a picture that really has
   transparent pixels — never SVG (a script can hide in one).

   * imageSize(bytes)         the width and height a JPEG, PNG, GIF, WebP or HEIC/HEIF file's header says, read
                              BEFORE anything is decoded (a 200-megapixel picture would take the tab down while it
                              is decoded), or null — from the bytes given (the file's first HEAD_BYTES);
   * sizeOf(file, head)       the same for a whole file: a JPEG whose metadata before its frame header runs past the
                              first HEAD_BYTES (a large XMP, ICC or Photoshop block) is walked on segment by segment,
                              and a HEIC whose meta box lies further on (after its image data) box by box, with small
                              reads at most SCAN_BYTES into the file;
   * fitSize(w, h)            the size it is drawn at (never larger than it was);
   * looksLikeSvg(head)       an SVG or XML text, whatever its name and type say;
   * outputFor(mime, alpha)   {mime, ext}: image/png + .png only for a PNG, WebP or GIF with transparency;
   * prepare(file)            -> {blob, mime, ext, width, height}, or throws a sentence (err.message).
   Browser-only for prepare (createImageBitmap, canvas); the rest is pure (node tests import it). */

export const MAX_SIDE = 800;
export const MAX_BYTES = 40 * 1024 * 1024;
export const MAX_PIXELS = 60e6;
export const JPEG_QUALITY = 0.85;
export const HEAD_BYTES = 256 * 1024;
export const SCAN_BYTES = 8 * 1024 * 1024;            // how far into a file the header walk may read
const MAX_READS = 2048;                               // small reads of one walk (a JPEG segment is at most 64 KiB)
export const ACCEPT = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

function bad(message) { const e = new Error(message); e.code = "local_rule"; return e; }

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const ascii = (b, i, n) => { let s = ""; for (let k = 0; k < n && i + k < b.length; k++) s += String.fromCharCode(b[i + k]); return s; };

/** {width, height, type} from the first bytes of a picture (a Uint8Array), or null when they do not say. */
export function imageSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 16) return null;
  // PNG: the signature, then IHDR's width and height
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR" && b.length >= 24) {
    return { width: u32be(b, 16), height: u32be(b, 20), type: "image/png" };
  }
  // GIF: the logical screen
  if (ascii(b, 0, 4) === "GIF8") return { width: u16le(b, 6), height: u16le(b, 8), type: "image/gif" };
  // WebP: RIFF ... WEBP and its first chunk
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const c = ascii(b, 12, 4);
    if (c === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, type: "image/webp" };
    if (c === "VP8L") {
      return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)), type: "image/webp" };
    }
    if (c === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), type: "image/webp" };
    return null;
  }
  // JPEG: walk the segments to the first frame header
  if (b[0] === 0xff && b[1] === 0xd8) {
    const r = jpegWalk(b, 2);
    return r && r.size ? r.size : null;
  }
  // HEIC / HEIF (an iPhone's): ftyp, then the largest image spatial extent ("ispe") in the first bytes
  if (isHeif(b)) return largestIspe(b, 8);
  return null;
}

/* The JPEG segments of `b` from `i` (a segment's start) to the first frame header (SOF0..SOF15 but DHT, JPG, DAC):
   {size}; {more: offset} when `b` ends first (the walk goes on there); null when there is none (the image data
   before any frame header, or not a segment). */
function jpegWalk(b, i) {
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1]; }         // fill bytes
    if (i + 9 >= b.length) break;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xd9 || m === 0xda) return null;                           // the image data before any frame header
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { size: { width: u16be(b, i + 7), height: u16be(b, i + 5), type: "image/jpeg" } };
    }
    i += 2 + len;
  }
  return { more: i };
}

function isHeif(b) {
  return ascii(b, 4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(ascii(b, 8, 4));
}

/** The largest "ispe" (image spatial extent) in `b` from `from`, or null. */
function largestIspe(b, from) {
  let best = null;
  for (let i = from; i + 16 <= b.length; i++) {
    if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {     // "ispe"
      const w = u32be(b, i + 8), h = u32be(b, i + 12);
      if (w > 0 && h > 0 && (!best || w * h > best.width * best.height)) best = { width: w, height: h, type: "image/heic" };
    }
  }
  return best;
}

async function bytesOf(part) {
  if (part && typeof part.arrayBuffer === "function") return new Uint8Array(await part.arrayBuffer());
  return new Uint8Array(await new Response(part).arrayBuffer());
}
function bytesAt(file, at, n) { return bytesOf(file.slice(at, at + n)); }

/** {width, height, type} for a picture file (see the header): its first bytes `head` (read here when not given),
    then — a JPEG or HEIC that does not say within them — the walk further in. null when the file does not say. */
export async function sizeOf(file, head) {
  const h = head || await headOf(file);
  const quick = imageSize(h);
  if (quick || !file || typeof file.slice !== "function" || h.length >= file.size) return quick;   // all of it was read
  if (h[0] === 0xff && h[1] === 0xd8) {
    let r = jpegWalk(h, 2);
    const end = Math.min(file.size, SCAN_BYTES);
    for (let reads = 0; r && r.more !== undefined; reads++) {
      const at = r.more;
      if (at + 10 > end || reads >= MAX_READS) return null;
      const s = jpegWalk(await bytesAt(file, at, 64), 0);                  // a marker, its length, a frame's size
      r = s && s.more !== undefined ? { more: at + s.more } : s;
    }
    return r && r.size ? r.size : null;
  }
  if (isHeif(h)) {
    // the top-level boxes (ftyp, mdat, meta …): only their headers are read, then the meta box itself
    let at = 0;
    for (let n = 0; n < 64 && at + 8 <= file.size; n++) {
      const box = await bytesAt(file, at, 16);
      if (box.length < 8) return null;
      let len = u32be(box, 0);
      if (len === 1) { if (box.length < 16) return null; len = u32be(box, 8) * 4294967296 + u32be(box, 12); }
      else if (len === 0) len = file.size - at;
      if (len < 8) return null;
      if (ascii(box, 4, 4) === "meta") return len > SCAN_BYTES ? null : largestIspe(await bytesAt(file, at, len), 8);
      at += len;
    }
  }
  return null;
}

/** The size a w × h picture is drawn at: at most MAX_SIDE on the longer side, never enlarged. */
export function fitSize(w, h) {
  const W = Math.max(1, Math.round(Number(w) || 0)), H = Math.max(1, Math.round(Number(h) || 0));
  const scale = Math.min(1, MAX_SIDE / Math.max(W, H));
  return { width: Math.max(1, Math.round(W * scale)), height: Math.max(1, Math.round(H * scale)) };
}

/** Text that is an SVG (or any XML), whatever the file says it is. */
export function looksLikeSvg(head) {
  const t = String(head || "").replace(/^﻿/, "").replace(/^\s+/, "").slice(0, 2048).toLowerCase();
  return t.startsWith("<?xml") || t.startsWith("<svg") || t.startsWith("<!doctype svg") || /<svg[\s>]/.test(t);
}

/** What the picture is stored as: PNG only for a PNG, WebP or GIF that has transparent pixels, else JPEG. */
export function outputFor(srcMime, hasAlpha) {
  const m = String(srcMime || "").toLowerCase();
  if (hasAlpha && (m === "image/png" || m === "image/webp" || m === "image/gif")) return { mime: "image/png", ext: ".png" };
  return { mime: "image/jpeg", ext: ".jpg" };
}

function nameOf(file) { return String((file && file.name) || ""); }

function headOf(file) {
  return bytesOf(file.slice ? file.slice(0, HEAD_BYTES) : file);
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* the <img> way below */ }
  }
  if (typeof document === "undefined" || typeof URL === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* */ } }, 1000);
  }
}

function canvasOf(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function encode(canvas, mime) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type: mime, quality: JPEG_QUALITY });
  return new Promise((resolve) => canvas.toBlob(resolve, mime, JPEG_QUALITY));
}

/** The picture to upload: {blob, mime, ext, width, height}. Throws a sentence for anything it will not take. */
export async function prepare(file) {
  if (!file || !file.size) throw bad("That file is empty.");
  if (file.size > MAX_BYTES) throw bad("That picture is larger than 40 MB: pick a smaller one.");
  const type = String(file.type || "").toLowerCase();
  if (type === "image/svg+xml" || /\.svgz?$/i.test(nameOf(file))) throw bad("SVG drawings can't be the project picture: use a photo (JPEG, PNG, WebP or HEIC).");
  const head = await headOf(file);
  if (looksLikeSvg(new TextDecoder().decode(head.slice(0, 2048)))) throw bad("SVG drawings can't be the project picture: use a photo (JPEG, PNG, WebP or HEIC).");
  const size = await sizeOf(file, head);
  if (!size) throw bad("That file is not a picture DCR can use: pick a JPEG, PNG, WebP, GIF or HEIC photo.");
  if (size.width * size.height > MAX_PIXELS) throw bad("That picture is too large (more than 60 megapixels): pick a smaller one.");
  const src = await decode(file);
  if (!src) {
    if (size.type === "image/heic") throw bad("This browser can't open HEIC pictures: take a JPEG photo, or pick one from the library in another format.");
    throw bad("That picture could not be opened.");
  }
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  if (!sw || !sh || sw * sh > MAX_PIXELS) { if (src.close) src.close(); throw bad("That picture is too large (more than 60 megapixels): pick a smaller one."); }
  const fit = fitSize(sw, sh);
  const canvas = canvasOf(fit.width, fit.height);
  const g = canvas.getContext("2d");
  g.drawImage(src, 0, 0, fit.width, fit.height);
  if (src.close) src.close();
  let alpha = false;
  if (size.type === "image/png" || size.type === "image/webp" || size.type === "image/gif") {
    const px = g.getImageData(0, 0, fit.width, fit.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { alpha = true; break; }
  }
  const out = outputFor(size.type, alpha);
  let target = canvas;
  if (out.mime === "image/jpeg" && size.type !== "image/jpeg" && size.type !== "image/heic") {
    // a JPEG has no transparency: a see-through corner of a PNG becomes white, not black
    target = canvasOf(fit.width, fit.height);
    const t = target.getContext("2d");
    t.fillStyle = "#ffffff";
    t.fillRect(0, 0, fit.width, fit.height);
    t.drawImage(canvas, 0, 0);
  }
  const blob = await encode(target, out.mime);
  if (!blob || !blob.size) throw bad("The picture could not be made: try another one.");
  return { blob, mime: out.mime, ext: out.ext, width: fit.width, height: fit.height };
}
