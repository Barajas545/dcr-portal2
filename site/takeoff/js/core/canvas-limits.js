/**
 * How big a canvas will this device actually give us?
 *
 * A real framing sheet in this estimator's library is 6300 × 4500 — 28.35
 * megapixels. iOS Safari refuses a canvas past roughly 16.8 MP, and it does
 * not throw: it hands back a canvas full of transparent black. So a sheet
 * that is too big does not fail, it renders BLANK, with the measurements
 * floating over nothing and no error anywhere to explain it.
 *
 * There is no way to ask the browser for the number, and the user agent
 * cannot be used as a proxy — iPadOS Safari reports itself as desktop macOS
 * Safari, which is exactly the device that has the cap. So we measure it:
 * paint the last pixel of a candidate canvas and read it back. A canvas over
 * the cap reads back empty.
 *
 * Descending ladder rather than a bisection, deliberately. Bisecting from
 * 32768 asks a phone for a four-gigabyte allocation on the first probe; the
 * ladder starts at a size we might plausibly want and stops at the first one
 * that works, so the largest allocation ever attempted is one step above
 * what the device supports.
 */

/** Square sides to try, largest first. 4096² is 16.8 MP — the iOS figure. */
const AREA_LADDER = [8192, 6144, 5120, 4096, 3072, 2048, 1024, 512];
/** Single-dimension probes. An N × 1 canvas costs almost nothing. */
const SIDE_LADDER = [32767, 16384, 11000, 8192, 4096, 2048];

let cached = null;

/** Paint the far corner and read it back. A capped canvas comes back empty. */
function canDraw(w, h) {
  let c = null;
  try {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(w - 1, h - 1, 1, 1);
    const d = ctx.getImageData(w - 1, h - 1, 1, 1).data;
    return d[0] > 200 && d[3] > 200;
  } catch {
    return false;                 // some engines do throw; both count as no
  } finally {
    // Release before the next probe, or the ladder measures memory pressure
    // it created itself.
    if (c) { c.width = 0; c.height = 0; }
  }
}

/**
 * `{ maxArea, maxSide, resizeOnDecode }` for this device, measured once.
 *
 * `resizeOnDecode` says whether createImageBitmap honours resizeWidth. When
 * it does not, a too-large sheet has to be decoded whole before it can be
 * shrunk — which is the allocation we were trying to avoid — so the caller
 * falls back to drawing through a clamped canvas instead.
 */
export async function canvasLimits() {
  if (cached) return cached;

  let maxArea = 512 * 512;
  for (const side of AREA_LADDER) {
    if (canDraw(side, side)) { maxArea = side * side; break; }
  }

  let maxSide = Math.floor(Math.sqrt(maxArea));
  for (const side of SIDE_LADDER) {
    if (side <= maxSide) break;
    if (canDraw(side, 1)) { maxSide = side; break; }
  }

  let resizeOnDecode = false;
  try {
    const px = new Uint8ClampedArray(16 * 16 * 4).fill(255);
    const bmp = await createImageBitmap(new ImageData(px, 16, 16),
                                        { resizeWidth: 8, resizeHeight: 8 });
    resizeOnDecode = bmp.width === 8;
    bmp.close?.();
  } catch {
    resizeOnDecode = false;
  }

  cached = { maxArea, maxSide, resizeOnDecode };
  return cached;
}

/**
 * The factor a `w × h` sheet must be decoded at to fit, or 1 when it fits.
 * Never returns more than 1: a small sheet is never blown up.
 */
export function fitFactor(w, h, limits) {
  if (!w || !h || !limits) return 1;
  return Math.min(
    1,
    Math.sqrt(limits.maxArea / (w * h)),
    limits.maxSide / w,
    limits.maxSide / h,
  );
}

/** Test seam: forget the measurement and probe again. */
export function _resetCanvasLimits() { cached = null; }
