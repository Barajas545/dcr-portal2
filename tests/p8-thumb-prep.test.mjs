// The Books release A3 (WP-P2): site/js/thumb-prep.js grows the options {maxSide, square} for the contact picture (Books
// plan §4.2: a 400 x 400 centre-crop JPEG, flattened on white - DCR Desktop 2's prepare_square), and its defaults stay
// the project picture's, byte for byte in behaviour: at most 800 px, never enlarged, PNG only for real transparency, the
// same sentences. prepare() is run here on a stand-in canvas (node has none) that records every drawing call.
import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../site/js/thumb-prep.js";

/* a PNG header saying w x h (the rest is never decoded: the stand-in createImageBitmap answers) */
function pngHead(w, h) {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w); dv.setUint32(20, h);
  return b;
}
function jpegHead(w, h) {
  const b = new Uint8Array(64);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  const dv = new DataView(b.buffer);
  dv.setUint16(7, h); dv.setUint16(9, w);
  return b;
}
const fileOf = (bytes, name, type) => new File([bytes], name, { type });

/** A canvas stand-in: every context call is recorded; getImageData answers `alpha` (a see-through pixel or not). */
function stage(opts) {
  const o = opts || {};
  const log = [];
  class Ctx {
    constructor(c) { this.c = c; this.fillStyle = ""; }
    fillRect(...a) { log.push({ c: this.c.n, op: "fillRect", a, fill: this.fillStyle }); }
    drawImage(...a) { log.push({ c: this.c.n, op: "drawImage", a: a.slice(1), src: a[0] && a[0].tag }); }
    getImageData(x, y, w, h) {
      log.push({ c: this.c.n, op: "getImageData", a: [x, y, w, h] });
      const d = new Uint8ClampedArray(w * h * 4).fill(255);
      if (o.alpha) d[3] = 10;
      return { data: d };
    }
  }
  let n = 0;
  class Canvas {
    constructor(w, h) { this.width = w; this.height = h; this.n = ++n; this.tag = "canvas" + this.n; log.push({ c: this.n, op: "canvas", a: [w, h] }); }
    getContext() { return new Ctx(this); }
    async convertToBlob(x) { log.push({ c: this.n, op: "encode", a: [x.type, x.quality] }); return new Blob([new Uint8Array(1234)], { type: x.type }); }
  }
  const saved = { OffscreenCanvas: globalThis.OffscreenCanvas, createImageBitmap: globalThis.createImageBitmap };
  globalThis.OffscreenCanvas = Canvas;
  globalThis.createImageBitmap = async () => ({ tag: "bitmap", width: o.w, height: o.h, close() { log.push({ op: "close" }); } });
  return { log, done() { globalThis.OffscreenCanvas = saved.OffscreenCanvas; globalThis.createImageBitmap = saved.createImageBitmap; } };
}

test("thumb-prep defaults unchanged: fitSize is still 800 px, never enlarged; the constants are Desktop 2's", () => {
  assert.deepEqual(T.fitSize(4032, 3024), { width: 800, height: 600 });
  assert.deepEqual(T.fitSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(T.fitSize(10000, 10), { width: 800, height: 1 });
  assert.deepEqual(T.fitSize(4032, 3024, undefined), { width: 800, height: 600 }, "no maxSide: the default");
  assert.deepEqual(T.fitSize(4032, 3024, 0), { width: 800, height: 600 }, "a nonsense maxSide: the default");
  assert.deepEqual(T.fitSize(4032, 3024, 400), { width: 400, height: 300 });
  assert.deepEqual(T.fitSize(300, 200, 400), { width: 300, height: 200 }, "never enlarged");
  assert.deepEqual([T.MAX_SIDE, T.MAX_BYTES, T.MAX_PIXELS, T.JPEG_QUALITY], [800, 40 * 1024 * 1024, 60e6, 0.85]);
});

test("squareCrop: the centre square of the shorter side", () => {
  assert.deepEqual(T.squareCrop(1200, 800), { sx: 200, sy: 0, side: 800 });
  assert.deepEqual(T.squareCrop(800, 1200), { sx: 0, sy: 200, side: 800 });
  assert.deepEqual(T.squareCrop(401, 400), { sx: 0, sy: 0, side: 400 });
  assert.deepEqual(T.squareCrop(500, 500), { sx: 0, sy: 0, side: 500 });
});

test("prepare() with no options: the project picture, as before (fit 800, one canvas, the alpha test, PNG for transparency)", async () => {
  const s = stage({ w: 4000, h: 3000, alpha: true });
  try {
    const out = await T.prepare(fileOf(pngHead(4000, 3000), "logo.png", "image/png"));
    assert.deepEqual([out.mime, out.ext, out.width, out.height], ["image/png", ".png", 800, 600]);
    const ops = s.log.filter((x) => x.op !== "close");
    assert.deepEqual(ops.map((x) => x.op), ["canvas", "drawImage", "getImageData", "encode"]);
    assert.deepEqual(ops[0].a, [800, 600]);
    assert.deepEqual(ops[1].a, [0, 0, 800, 600], "the whole picture, scaled");
    assert.deepEqual(ops[3].a, ["image/png", 0.85]);
  } finally { s.done(); }
  const s2 = stage({ w: 1600, h: 1200, alpha: false });
  try {
    const out = await T.prepare(fileOf(pngHead(1600, 1200), "flat.png", "image/png"));
    assert.deepEqual([out.mime, out.width, out.height], ["image/jpeg", 800, 600]);
    const ops = s2.log.filter((x) => x.op !== "close").map((x) => x.op);
    assert.deepEqual(ops, ["canvas", "drawImage", "getImageData", "canvas", "fillRect", "drawImage", "encode"], "flattened on white on a second canvas");
  } finally { s2.done(); }
});

test("prepare(file, {maxSide: 400, square: true}): the centre square at exactly 400 x 400, a JPEG on white, no alpha test", async () => {
  const s = stage({ w: 1200, h: 800, alpha: true });
  try {
    const out = await T.prepare(fileOf(pngHead(1200, 800), "face.png", "image/png"), { maxSide: 400, square: true });
    assert.deepEqual([out.mime, out.ext, out.width, out.height], ["image/jpeg", ".jpg", 400, 400], "a see-through PNG still becomes a JPEG");
    const ops = s.log.filter((x) => x.op !== "close");
    assert.deepEqual(ops.map((x) => x.op), ["canvas", "fillRect", "drawImage", "encode"], "one canvas: white, then the square");
    assert.deepEqual(ops[0].a, [400, 400]);
    assert.equal(ops[1].fill, "#ffffff");
    assert.deepEqual(ops[1].a, [0, 0, 400, 400]);
    assert.deepEqual(ops[2].a, [200, 0, 800, 800, 0, 0, 400, 400], "the centre square of the shorter side");
    assert.deepEqual(ops[3].a, ["image/jpeg", 0.85]);
  } finally { s.done(); }
  const s2 = stage({ w: 120, h: 300 });
  try {
    const out = await T.prepare(fileOf(jpegHead(120, 300), "small.jpg", "image/jpeg"), { maxSide: 400, square: true });
    assert.deepEqual([out.width, out.height], [400, 400], "a small picture is drawn at 400 too (Desktop 2's prepare_square)");
    assert.deepEqual(s2.log.find((x) => x.op === "drawImage").a, [0, 90, 120, 120, 0, 0, 400, 400]);
  } finally { s2.done(); }
});

test("prepare's sentences: the project picture's unchanged by default; the contact picture's with square", async () => {
  const svg = fileOf(new TextEncoder().encode("<svg></svg>"), "x.svg", "image/svg+xml");
  await assert.rejects(T.prepare(svg), /^Error: SVG drawings can't be the project picture: use a photo \(JPEG, PNG, WebP or HEIC\)\.$/);
  await assert.rejects(T.prepare(svg, { square: true, maxSide: 400 }), /SVG drawings can't be a contact picture/);
  const sniffed = fileOf(new TextEncoder().encode("<svg></svg>"), "photo.jpg", "image/jpeg");
  await assert.rejects(T.prepare(sniffed, { square: true }), /a contact picture/, "sniffed too");
  await assert.rejects(T.prepare(fileOf(new Uint8Array(0), "a.jpg", "image/jpeg"), { square: true }), /empty/);
  await assert.rejects(T.prepare(fileOf(new TextEncoder().encode("just text, not a picture"), "a.jpg", "image/jpeg"), { square: true }), /not a picture/);
});
