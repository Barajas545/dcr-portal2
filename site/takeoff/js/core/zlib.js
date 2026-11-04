// zlib.js — the zlib streams the .takeoff container is built from.
//
// Page blobs in a project file are zlib(PNG). Browsers ship that codec:
// DecompressionStream('deflate') and CompressionStream('deflate') both speak
// the zlib wrapper (RFC 1950), which is exactly what Python's zlib writes.
// So there is no library to vendor and nothing to load over the network.
//
// The one thing the native API will not do is let us pick a compression level.
// Python writes level 1 for speed; the browser writes its default. The result
// is a slightly smaller, slightly slower save, and every reader is happy with
// either — the level is a property of the encoder, never of the stream.
//
// A pako fallback is used when the native streams are missing, so an older
// browser still opens a project as long as the page chose to load pako.

const hasNative =
  typeof DecompressionStream !== 'undefined' &&
  typeof CompressionStream !== 'undefined';

function pako() {
  const p = globalThis.pako;
  if (!p) {
    throw new Error(
      'This browser cannot read compressed project data. ' +
      'Update to a current version of Chrome, Edge, Firefox or Safari.'
    );
  }
  return p;
}

async function pipe(bytes, stream) {
  // A zero-length view still has to reach the stream as a real chunk.
  const src = new Blob([bytes]).stream().pipeThrough(stream);
  const out = await new Response(src).arrayBuffer();
  return new Uint8Array(out);
}

/** zlib-compressed bytes → the original bytes. */
export async function inflate(bytes) {
  if (hasNative) {
    try {
      return await pipe(bytes, new DecompressionStream('deflate'));
    } catch (err) {
      // A raw-deflate stream (no zlib header) reaches us from nothing this app
      // writes, but a hand-built file might carry one. Try it before failing.
      try {
        return await pipe(bytes, new DecompressionStream('deflate-raw'));
      } catch { throw err; }
    }
  }
  return pako().inflate(bytes);
}

/**
 * As much of the original as a TRUNCATED stream will give, up to `want`.
 *
 * inflate() above reads the whole stream through one Response, which
 * REJECTS when the input stops mid-stream — so reading a 4 KB prefix of a
 * sheet to get at its IHDR, which is what revisionPageSize wanted, could
 * never work through it. A reader taken chunk by chunk keeps what already
 * arrived and lets the error at the end stand for the tail: measured on a
 * 400 KB incompressible body (deflating to 400,155 bytes, so the prefix is
 * 1% of the stream), the whole-response read throws and this returns 4,089
 * bytes — far more than the 24 an IHDR needs.
 *
 * Returns null when nothing at all could be read.
 */
export async function inflatePartial(bytes, want = 4096) {
  if (!hasNative) {
    try { return pako().inflate(bytes); } catch { return null; }
  }
  for (const format of ['deflate', 'deflate-raw']) {
    const chunks = [];
    let n = 0;
    try {
      const reader = new Blob([bytes]).stream()
        .pipeThrough(new DecompressionStream(format)).getReader();
      try {
        while (n < want) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) { chunks.push(value); n += value.length; }
        }
      } finally {
        // Nothing downstream wants the rest, and an uncancelled reader on a
        // stream that is about to error is an unhandled rejection.
        try { await reader.cancel(); } catch { /* already gone */ }
      }
    } catch {
      // The tail is missing, which is the whole point. Keep what arrived.
    }
    if (n) {
      const out = new Uint8Array(n);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      return out;
    }
  }
  return null;
}

/** bytes → a zlib stream Python's zlib.decompress reads without complaint. */
export async function deflate(bytes) {
  if (hasNative) return pipe(bytes, new CompressionStream('deflate'));
  return pako().deflate(bytes, { level: 1 });
}

export const nativeCompression = hasNative;
