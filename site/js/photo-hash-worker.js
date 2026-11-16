/* DCR Portal 2 — the phone hand-in's hash worker (the photographer screen program, P5, the OneDrive edition; DCR Desktop 2
   docs/PHOTO-FILES-ONEDRIVE.md §3.3 step 5 and §3.4, cited OD).

   OneDrive's quickXorHash of each file the phone sends, computed from the very chunks js/photo-send.js PUTs to the
   upload address (the hashing transport reads each chunk into an ArrayBuffer, hands the bytes past what it already
   hashed to this worker, and sends the same buffer), with the live js/quickxor.js - so a 6 GB video is hashed while it
   goes up, never read a second time, and the page stays responsive.

   One hash state per KEY: an opaque name the page gives each upload address ("h1", "h2" ...). The worker never sees an
   upload address, a file name or anything else of the file but its bytes; it posts nothing to anyone but the page.

   page -> worker  {op: "update", key, bytes}      the next bytes of that key's file, in order (an ArrayBuffer, handed
                                                   over: the page keeps its own buffer for the PUT)
                   {op: "digest", key, id}          the hash so far
                   {op: "drop", key}                forget that key (the address's session is over)
   worker -> page  {type: "digest", id, key, hash, length}   hash: base64 of the 20 bytes, as Graph reports it
                   {type: "error", id, key}         this browser could not load js/quickxor.js, or the bytes were not
                                                    bytes: the page hashes the file itself then (one more read)

   A key whose update failed stays failed: its digest answers an error, never a hash of only part of the file. */
"use strict";

try { importScripts("quickxor.js"); } catch (e) { /* no hash here: every digest answers an error */ }

var states = Object.create(null);
var failed = Object.create(null);

function keyOk(k) { return typeof k === "string" && /^[a-z][0-9]{1,9}$/.test(k); }

self.onmessage = function (ev) {
  var m = (ev && ev.data) || {};
  var key = m.key;
  if (!keyOk(key)) return;
  if (m.op === "drop") {
    delete states[key];
    delete failed[key];
    return;
  }
  if (m.op === "update") {
    if (failed[key]) return;
    try {
      if (!self.DCR2QuickXor) throw new Error("no hash");
      var bytes = m.bytes instanceof ArrayBuffer ? new Uint8Array(m.bytes) : null;
      if (!bytes) throw new Error("not bytes");
      var h = states[key] || (states[key] = new self.DCR2QuickXor.QuickXorHash());
      h.update(bytes);
    } catch (e) {
      failed[key] = true;
      delete states[key];
    }
    return;
  }
  if (m.op === "digest") {
    var id = typeof m.id === "number" ? m.id : 0;
    if (failed[key] || !self.DCR2QuickXor) {
      self.postMessage({ type: "error", id: id, key: key });
      return;
    }
    var s = states[key] || new self.DCR2QuickXor.QuickXorHash();
    self.postMessage({ type: "digest", id: id, key: key, hash: s.base64(), length: s.length });
  }
};
