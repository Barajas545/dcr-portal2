// The iPad save back's proof (contract addendum 2, C3b; review BRK-2, BRK-5, LW-7): site/js/quickxor.js - OneDrive's
// quickXorHash, as the Plans Library's spool worker computes it from its 8 MiB slices - against the vectors of DCR
// Desktop 2's supabase/functions/onedrive/quickxor_test.ts (made by tools/onedrive/quickxor_ref.py, an independent
// Python port of Microsoft's C# sample), against a line-by-line port of that C# here (random bytes, random slices), and
// - when DCR Desktop 2's checkout is on this machine (DCR_DESKTOP2_DIR, else next to this repository) - against the
// broker's own module and its own list of vectors. Made-up bytes only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

await import("../site/js/quickxor.js");
const { QuickXorHash, quickXorHash, QX_RE } = globalThis.DCR2QuickXor;

const hex = (s) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));
/** Byte k is (7k + 3) mod 256 (the Python's pattern()). */
const pattern = (n) => Uint8Array.from({ length: n }, (_, k) => (k * 7 + 3) & 255);
/** The Python's lcg(): x = (1103515245 x + 12345) mod 2^32, byte = (x >> 16) mod 256. */
function lcg(n, seed) {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let k = 0; k < n; k++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[k] = (x >>> 16) & 255;
  }
  return out;
}

// exactly the broker's quickxor_test.ts VECTORS (checked against that file below when it is here)
const VECTORS = [
  ["empty", hex(""), "AAAAAAAAAAAAAAAAAAAAAAAAAAA="],
  ["one J", hex("4a"), "SgAAAAAAAAAAAAAAAQAAAAAAAAA="],
  ["abc", hex("616263"), "YRDDGAAAAAAAAAAAAwAAAAAAAAA="],
  ["hello world", hex("68656c6c6f20776f726c64"), "aCgDG9jwBhDc4Q1yawMZAAAAAAA="],
  ["0xff x 20", hex("ffffffffffffffffffffffffffffffffffffffff"), "HOc4xznOcX784x//7Mc//vGPf/w="],
  ["pattern 19", pattern(19), "gl0z1HPQARO0gAY7A0ISoHAFL5Q="],
  ["pattern 20", pattern(20), "gl0z1HPQERK0gAY7BEISoHAFL5Q="],
  ["pattern 21", pattern(21), "gl0z1HPQEeK8gAY7BUISoHAFL5Q="],
  ["pattern 159", pattern(159), "7gi7SoTZMRx5gfdOM7shn/kHQ6E="],
  ["pattern 160", pattern(160), "7gi7SoTZMRx5gfdODLshn/kHw6o="],
  ["pattern 161", pattern(161), "jQi7SoTZMRx5gfdODbshn/kHw6o="],
  ["pattern 200", pattern(200), "GZWrgXFBpLrziBRlwHSVv45M7Lw="],
  ["pattern 319", pattern(319), "UDaz+YSVrQw+YhHrvIxsRPpkpww="],
  ["pattern 320", pattern(320), "UDaz+YSVrQw+YhHrw4xsRPpkJxs="],
  ["pattern 321", pattern(321), "kzaz+YSVrQw+YhHrwoxsRPpkJxs="],
  ["pattern 1000", pattern(1000), "dgD8j0n8sM0aPE5CUJ8tqmilX/E="],
  ["pattern 65536", pattern(65536), "XhQes7LH2XNgLdVXMMezlbw5oAI="],
  ["lcg 4097", lcg(4097, 1), "HSFcnvUbofLYDBJvWA9o1pD0bMI="],
  ["lcg 100000", lcg(100000, 2), "yFs0jgkcbheVjGhM2Q5vIOpZpes="],
  ["lcg 983045", lcg(983045, 3), "PbG6uWfEwQF5DpbKoNh7NwBgQ+0="],
];

/** Microsoft's C# sample, line by line (three 64-bit cells, the last 32 bits wide; BigInt for the 64-bit ones). */
function reference(chunks) {
  const W = 160n, cells = [0n, 0n, 0n];
  let shiftSoFar = 0, length = 0;
  const M64 = (1n << 64n) - 1n;
  for (const array of chunks) {
    const cbSize = array.length;
    let currentShift = shiftSoFar;
    let vectorArrayIndex = Math.floor(currentShift / 64);
    let vectorOffset = currentShift % 64;
    const iterations = Math.min(cbSize, 160);
    for (let i = 0; i < iterations; i++) {
      const isLastCell = vectorArrayIndex === cells.length - 1;
      const bitsInVectorCell = isLastCell ? 32 : 64;
      if (vectorOffset <= bitsInVectorCell - 8) {
        for (let j = i; j < cbSize; j += 160) cells[vectorArrayIndex] = (cells[vectorArrayIndex] ^ (BigInt(array[j]) << BigInt(vectorOffset))) & M64;
      } else {
        const index1 = vectorArrayIndex;
        const index2 = isLastCell ? 0 : vectorArrayIndex + 1;
        const low = bitsInVectorCell - vectorOffset;
        let xoredByte = 0;
        for (let j = i; j < cbSize; j += 160) xoredByte ^= array[j];
        cells[index1] = (cells[index1] ^ (BigInt(xoredByte) << BigInt(vectorOffset))) & M64;
        cells[index2] = (cells[index2] ^ (BigInt(xoredByte) >> BigInt(low))) & M64;
      }
      vectorOffset += 11;
      while (vectorOffset >= bitsInVectorCell) {
        vectorArrayIndex = isLastCell ? 0 : vectorArrayIndex + 1;
        vectorOffset -= bitsInVectorCell;
      }
    }
    shiftSoFar = Number((BigInt(shiftSoFar) + 11n * (BigInt(cbSize) % W)) % W);
    length += cbSize;
  }
  const rgb = new Uint8Array(20);
  for (let i = 0; i < 2; i++) for (let b = 0; b < 8; b++) rgb[i * 8 + b] = Number((cells[i] >> BigInt(8 * b)) & 255n);
  for (let b = 0; b < 4; b++) rgb[16 + b] = Number((cells[2] >> BigInt(8 * b)) & 255n);
  const len = BigInt(length);
  for (let b = 0; b < 8; b++) rgb[12 + b] ^= Number((len >> BigInt(8 * b)) & 255n);
  return Buffer.from(rgb).toString("base64");
}

test("quickXorHash (js/quickxor.js): the broker's vectors (an independent Python port of Microsoft's C#), in Graph's base64 form", () => {
  for (const [label, bytes, want] of VECTORS) {
    assert.equal(quickXorHash(bytes), want, label);
    assert.match(want, QX_RE, label);
    assert.equal(reference([bytes]), want, "the C# port here agrees: " + label);
  }
  assert.deepEqual([...new QuickXorHash().update(hex("4a")).digest()], [0x4a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
});

test("quickXorHash in slices: any slice sizes, in order, give the one-shot hash - aligned slices (whole words) and slices at any byte offset alike", () => {
  for (const [label, bytes, want] of VECTORS) {
    for (const piece of [1, 2, 7, 11, 159, 160, 161, 333, 4096, 327680]) {
      const h = new QuickXorHash();
      for (let at = 0; at < bytes.length; at += piece) h.update(bytes.subarray(at, at + piece));
      assert.equal(h.base64(), want, label + " in pieces of " + piece);
    }
  }
  // uneven slices with empty ones between, at offsets 1, 2 and 3 of their buffer (the bytes-only path) and 0 (words)
  const big = VECTORS[VECTORS.length - 1];
  for (const lead of [0, 1, 2, 3]) {
    const buf = new Uint8Array(big[1].length + lead);
    buf.set(big[1], lead);
    const view = buf.subarray(lead);
    const h = new QuickXorHash();
    let at = 0;
    for (const n of [0, 5, 0, 1000003 % view.length, 3, 327680, 0]) {
      h.update(view.subarray(at, at + n));
      at += n;
    }
    h.update(view.subarray(at));
    assert.equal(h.base64(), big[2], "offset " + lead);
  }
});

test("quickXorHash: random bytes in random slices (8 MiB-like and odd ones) equal the C# port's - the one-pass gathering is the C#'s 160 passes", () => {
  let seed = 7;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  for (let round = 0; round < 40; round++) {
    const size = round < 5 ? [0, 1, 159, 160, 161][round] : 1 + rnd(200000);
    const bytes = lcg(size, round + 11);
    const cuts = [];
    for (let at = 0; at < size;) {
      const n = Math.min(size - at, rnd(4) === 0 ? 1 + rnd(7) : 1 + rnd(60000));
      cuts.push(bytes.subarray(at, at + n));
      at += n;
    }
    const h = new QuickXorHash();
    cuts.forEach((c) => h.update(c));
    assert.equal(h.base64(), reference(cuts), "round " + round + " (" + size + " bytes, " + cuts.length + " slices)");
  }
  // a length past 2^32 fills the high word (bytes 16-19)
  const h = new QuickXorHash();
  h.length = 2 ** 32 + 5;
  assert.deepEqual([...h.digest()].slice(12), [5, 0, 0, 0, 1, 0, 0, 0]);
  // one changed byte changes it, and the length is in it
  const a = pattern(1000), b = a.slice();
  b[777] ^= 1;
  assert.notEqual(quickXorHash(a), quickXorHash(b));
  assert.notEqual(quickXorHash(new Uint8Array(20)), quickXorHash(new Uint8Array(21)));
});

test("quickXorHash: the same as DCR Desktop 2's broker module (quickxor.ts) and its very list of vectors, when its checkout is here", async () => {
  const d2 = process.env.DCR_DESKTOP2_DIR || fileURLToPath(new URL("../../DCR Desktop 2/", import.meta.url));
  const dir = join(d2, "supabase", "functions", "onedrive");
  let broker = null, listed = "";
  try {
    broker = await import(pathToFileURL(join(dir, "quickxor.ts")).href);
    listed = readFileSync(join(dir, "quickxor_test.ts"), "utf8");
  } catch (e) { broker = null; }
  if (!broker || typeof broker.quickXorHash !== "function") return;     // not on this machine: the vectors above stand
  const theirs = Array.from(listed.matchAll(/\['([^']+)', [^\]]*?, '([A-Za-z0-9+/]{27}=)'\]/g)).map((m) => [m[1], m[2]]);
  assert.deepEqual(theirs, VECTORS.map(([l, , w]) => [l, w]), "the broker's vectors are these, in this order");
  assert.equal(String(broker.QX_RE), String(QX_RE));
  for (let n = 0; n < 30; n++) {
    const bytes = lcg(1 + n * 9173, n + 3);
    assert.equal(quickXorHash(bytes), broker.quickXorHash(bytes), "random " + n);
  }
});
