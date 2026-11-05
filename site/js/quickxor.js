/* DCR Portal 2 — OneDrive's quickXorHash (file.hashes.quickXorHash), the iPad save back's proof that the bytes OneDrive
   holds are the bytes this device sent (contract addendum 2, C3b; review BRK-2, BRK-5, LW-7).

   The Plans Library's worker (js/plan-library-worker.js, op "spool") computes it WHILE it copies a save of the takeoff
   app into this device's storage, one 8 MiB slice at a time - never the whole file - and the record keeps it with the
   save (`local.hash`); the broker's plan_save_commit and plan_save_done take it and compare it with OneDrive's own
   hash of the item (DCR Desktop 2 supabase/functions/onedrive/handler.ts). The demo's broker (tools/fake/p7-onedrive.js)
   hashes what it is sent with this same file, as OneDrive would.

   This mirrors the broker's pure module (DCR Desktop 2 supabase/functions/onedrive/quickxor.ts, a port of Microsoft's
   reference C# sample, https://learn.microsoft.com/en-us/onedrive/developer/code-snippets/quickxorhash): a 160-bit
   block; the k-th byte of the file (from 0) is XORed in at bit (11 * k) mod 160, the block taken as one circular
   160-bit number; at the end the block's 20 bytes, little-endian, have the file's length (a 64-bit little-endian
   number) XORed into their last 8; Graph gives the 20 bytes in base64 (28 characters, one "="). The vectors of the
   broker's quickxor_test.ts (made by an independent Python port of the C#) are tests/p8-quickxor.test.mjs's.

   One difference of method, none of result: the C# (and quickxor.ts) gathers each update's bytes i, i + 160, i + 320 ...
   in 160 passes over the slice; a byte's place in the block depends only on its index mod 160, so this gathers them in
   ONE pass in memory order (whole 32-bit words where the slice is aligned: 160 bytes are 40 words), then puts the 160
   gathered bytes into the block exactly as the C# does. An 8 MiB slice is read once, not 160 times.

     const h = new QuickXorHash(); h.update(slice1); h.update(slice2); ... h.base64()

   A classic script (no import, no export): the worker takes it with importScripts("quickxor.js"), node and the demo
   read it as a module; either way it defines self.DCR2QuickXor = {QuickXorHash, quickXorHash, QX_RE}. */
(function (root) {
  "use strict";

  var WIDTH = 160;
  var SHIFT = 11;
  /** quickXorHash as Graph reports it: 20 bytes in base64, 28 characters with the one "=". */
  var QX_RE = /^[A-Za-z0-9+/]{27}=$/;
  // whole words are gathered only where they lay out as the bytes do (every browser and node this runs on)
  var LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function QuickXorHash() {
    this.cells = new Uint32Array(5);
    /** (11 x the bytes so far) mod 160: where the next update's first byte goes. */
    this.shift = 0;
    /** The bytes so far (a whole number below 2^53). */
    this.length = 0;
    this.gathered = new Uint32Array(WIDTH / 4);
  }

  /** Adds the next bytes of the file (a Uint8Array; any size, in order). */
  QuickXorHash.prototype.update = function (bytes) {
    var n = bytes.length;
    if (!n) return this;
    var g = this.gathered;
    g.fill(0);
    var acc = new Uint8Array(g.buffer);
    var k = 0;
    if (LITTLE && bytes.byteOffset % 4 === 0 && n >= WIDTH) {
      // byte k goes to acc[k % 160]: word w (bytes 4w .. 4w + 3) to lane w % 40
      var words = n >>> 2;
      var u = new Uint32Array(bytes.buffer, bytes.byteOffset, words);
      var w = 0;
      for (; w + 40 <= words; w += 40) {
        for (var lane = 0; lane < 40; lane++) g[lane] ^= u[w + lane];
      }
      for (var l2 = 0; w < words; w++, l2++) g[l2] ^= u[w];
      k = words * 4;
    }
    for (var at = k % WIDTH; k < n; k++) {
      acc[at] ^= bytes[k];
      if (++at === WIDTH) at = 0;
    }
    var rounds = Math.min(n, WIDTH);
    for (var i = 0; i < rounds; i++) {
      var x = acc[i];
      if (x === 0) continue;
      var bit = (this.shift + SHIFT * i) % WIDTH;
      var word = bit >>> 5, off = bit & 31;
      this.cells[word] ^= x << off;
      if (off > 24) this.cells[(word + 1) % 5] ^= x >>> (32 - off);    // the byte runs into the next word (circular)
    }
    this.shift = (this.shift + SHIFT * (n % WIDTH)) % WIDTH;
    this.length += n;
    return this;
  };

  /** The 20 bytes of the hash (the length XORed in). */
  QuickXorHash.prototype.digest = function () {
    var out = new Uint8Array(20);
    for (var w = 0; w < 5; w++) {
      var v = this.cells[w];
      out[w * 4] = v & 255;
      out[w * 4 + 1] = (v >>> 8) & 255;
      out[w * 4 + 2] = (v >>> 16) & 255;
      out[w * 4 + 3] = (v >>> 24) & 255;
    }
    var low = this.length % 4294967296, high = Math.floor(this.length / 4294967296);
    for (var i = 0; i < 4; i++) {
      out[12 + i] ^= (low >>> (8 * i)) & 255;
      out[16 + i] ^= (high >>> (8 * i)) & 255;
    }
    return out;
  };

  /** The hash as Graph reports it (base64 with its padding, 28 characters). */
  QuickXorHash.prototype.base64 = function () {
    var d = this.digest(), s = "";
    for (var i = 0; i < d.length; i += 3) {
      var a = d[i], b = i + 1 < d.length ? d[i + 1] : 0, c = i + 2 < d.length ? d[i + 2] : 0;
      s += B64[a >>> 2] + B64[((a & 3) << 4) | (b >>> 4)] + (i + 1 < d.length ? B64[((b & 15) << 2) | (c >>> 6)] : "=") +
        (i + 2 < d.length ? B64[c & 63] : "=");
    }
    return s;
  };

  /** The quickXorHash of these bytes, as Graph reports it. */
  function quickXorHash(bytes) {
    return new QuickXorHash().update(bytes).base64();
  }

  root.DCR2QuickXor = { QuickXorHash: QuickXorHash, quickXorHash: quickXorHash, QX_RE: QX_RE };
})(typeof self !== "undefined" ? self : globalThis);
