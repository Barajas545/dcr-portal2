/* opfs-write-worker.js — writes one kept plan into this browser's own storage, for a browser whose page cannot.

   File › Keep on This Device copies the open plan into the origin-private file system (folder "plans-kept",
   js/core/device-plans.js keepFile). The page writes it with createWritable() where the browser has it: Chrome, Edge,
   Firefox, and Safari only from 26. An iPad on iPadOS 16.4 to 18 has none — the one OPFS writer every current browser
   has, Safari included, is the synchronous access handle, and it exists only in a worker. So on those this does the
   writing: the page names the file it has just created in "plans-kept" and hands over the plan (a File crosses into a
   worker by reference, no bytes copied); this reads it a slice at a time and writes each slice where it belongs. Only
   the slice in hand is ever in memory, so a 2 GB plan set is kept on an iPad as well as on a desktop.

   The same idea as the Plans Library's download worker in the portal (it writes downloads the same way), without its
   download: the bytes are already on this device.

   page -> worker  {op: "write", dir: "plans-kept", name, file}
   worker -> page  {type: "progress", done, size}      after every slice
                   {type: "done", size}                 written, flushed and closed; the size it has on disk
                   {type: "error", code, message}       code "unsupported": this browser cannot write here at all
                                                        (no access handle, or Safari before 16.4, whose handle
                                                        methods returned Promises); "no-room": the device is full;
                                                        "unreadable": the plan could not be read while copying;
                                                        "refused": not a file this app keeps; "failed": anything else

   The page made the file and removes it again if anything here fails — this never deletes, and never touches a name
   outside this app's own kept copies. A classic worker script, written so it also parses as a module
   (tests/modules-parse.mjs reads every file in js/ as one). */
"use strict";

var DIRS = ["plans-kept"];
var NAME_RE = /^k[a-z0-9]+-[a-z0-9]+\.takeoff$/;     // device-plans.js KEPT_FILE_RE: this app's kept copies only
var SLICE = 8 * 1024 * 1024;

function post(m) {
  try { self.postMessage(m); } catch (e) { /* nothing more can be said */ }
}
function failure(code, message) { var e = new Error(message); e.code = code; return e; }
function unsupported() {
  return failure("unsupported", "This browser cannot keep plan files on the device. On an iPhone or iPad it needs " +
    "Safari 16.4 or newer (iPadOS 16.4); on a computer, Chrome, Edge or Firefox.");
}

self.onmessage = function (ev) {
  var m = (ev && ev.data) || {};
  if (m.op !== "write") return;
  write(m).then(function (size) {
    post({ type: "done", size: size });
  }, function (e) {
    post({ type: "error", code: (e && e.code) || "failed", message: (e && e.message) || "The copy could not be written." });
  });
};

async function write(m) {
  if (DIRS.indexOf(m.dir) === -1 || !NAME_RE.test(String(m.name || ""))) {
    throw failure("refused", "That is not a file this app keeps.");
  }
  var file = m.file;
  if (!file || typeof file.slice !== "function") throw failure("failed", "No plan was handed over to keep.");
  var size = Number(file.size) || 0;
  if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") throw unsupported();

  var root = await navigator.storage.getDirectory();
  var dir = await root.getDirectoryHandle(m.dir);
  var fh = await dir.getFileHandle(m.name);           // the page created it; nothing is created here
  if (typeof fh.createSyncAccessHandle !== "function") throw unsupported();
  var ah;
  try {
    ah = await fh.createSyncAccessHandle();
  } catch (e) {
    throw failure("failed", "The kept copy could not be opened for writing (" + ((e && e.message) || e) + ").");
  }
  try {
    /* Safari 15.2 to 16.3 had the handle with Promise-returning methods. Writing through those as if they answered
       at once would write nothing and call it done, so a handle whose getSize() is not a number is not used. */
    if (typeof ah.getSize() !== "number") throw unsupported();
    ah.truncate(0);
    var pos = 0;
    while (pos < size) {
      var end = Math.min(pos + SLICE, size);
      var bytes;
      try {
        bytes = new Uint8Array(await file.slice(pos, end).arrayBuffer());
      } catch (e) {
        throw failure("unreadable", "The plan could not be read while it was being copied — it may have been " +
          "changed or moved. Nothing was kept.");
      }
      if (bytes.byteLength !== end - pos) {
        throw failure("unreadable", "The plan came out shorter than it is. Nothing was kept.");
      }
      var wrote;
      try {
        wrote = ah.write(bytes, { at: pos });
      } catch (e) {
        if (e && e.name === "QuotaExceededError") {
          throw failure("no-room", "This device does not have room for this plan. Remove a kept plan first.");
        }
        throw failure("failed", "The kept copy could not be written (" + ((e && e.message) || e) + ").");
      }
      if (wrote !== bytes.byteLength) {
        throw failure("no-room", "This device does not have room for this plan. Remove a kept plan first.");
      }
      pos = end;
      post({ type: "progress", done: pos, size: size });
    }
    ah.flush();
    return ah.getSize();
  } finally {
    try { ah.close(); } catch (e) { /* closing is all that is left */ }
  }
}
