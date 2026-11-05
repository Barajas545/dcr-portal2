// A made-up phone for the Plans Library's own module (site/js/plan-library.js) in node: just enough of a browser's
// IndexedDB, Origin Private File System (with the synchronous access handle a worker writes through, and a quota),
// Web Locks, Wake Lock and localStorage - and a Worker that runs the REAL site/js/plan-library-worker.js in a vm
// against that file system. Used by tests/p7-library.test.mjs (the save back: spool, adopt, send, purge). Nothing here
// is the site's; no network (fetch answers only what a test gives it). Made-up data only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const dom = (name, message) => Object.assign(new Error(message || name), { name });

/* ── IndexedDB: databases of stores of structured-cloned values, requests answered on a later turn ──
   As a browser's (the spec's connection queue): the opens and deletes of one database run one at a time in the order
   asked - an open asked while a delete waits runs only after that delete; a delete waits ("blocked") while a
   connection stays open after its versionchange; an open that creates a database fires upgradeneeded, and aborting
   that upgrade (request.transaction.abort()) leaves no database behind. ── */
export function fakeIndexedDB() {
  const dbs = new Map();              // name -> {version, stores: Map(name -> {keyPath, data: Map})}
  const conns = new Set();
  const queues = new Map();           // name -> the opens and deletes asked, in order (the first one runs)
  const later = (fn) => setTimeout(fn, 0);
  const openTo = (name) => Array.from(conns).filter((c) => c.name === name && !c.closed);
  function enqueue(name, run) {
    const q = queues.get(name) || [];
    queues.set(name, q);
    q.push(run);
    if (q.length === 1) later(function () { run(next); });
    function next() {
      q.shift();
      if (q.length) { const r = q[0]; later(function () { r(next); }); } else queues.delete(name);
    }
  }
  const closeWaiters = [];            // deletes waiting for the connections of a database to close
  function closedOne() { closeWaiters.slice().forEach((w) => w()); }
  function connection(name, entry) {
    const d = {
      name, version: entry.version, onversionchange: null, onclose: null, closed: false,
      objectStoreNames: { contains: (n) => entry.stores.has(n) },
      createObjectStore(n, o) { entry.stores.set(n, { keyPath: o && o.keyPath, data: new Map() }); return {}; },
      close() { if (d.closed) return; d.closed = true; conns.delete(d); closedOne(); },
      transaction(names, mode) {
        const tx = { mode, error: null, oncomplete: null, onerror: null, onabort: null, pending: 0, over: false };
        const settle = () => later(function () {
          if (tx.pending === 0 && !tx.over) { tx.over = true; if (tx.oncomplete) tx.oncomplete(); }
        });
        const ask = (op) => {
          const r = { result: undefined, error: null, onsuccess: null, onerror: null };
          tx.pending++;
          later(function () {
            try { r.result = op(); } catch (e) { r.error = e; }
            tx.pending--;
            const ev = { target: r };
            if (r.error) { if (r.onerror) r.onerror(ev); tx.error = r.error; if (tx.onerror) tx.onerror(); tx.over = true; return; }
            if (r.onsuccess) r.onsuccess(ev);
            settle();
          });
          return r;
        };
        tx.objectStore = function (n) {
          const st = entry.stores.get(n);
          if (!st) throw dom("NotFoundError", "no store " + n);
          const keyOf = (v, k) => (k !== undefined ? k : st.keyPath ? v[st.keyPath] : undefined);
          return {
            get: (k) => ask(() => (st.data.has(k) ? structuredClone(st.data.get(k)) : undefined)),
            getAll: () => ask(() => Array.from(st.data.values()).map((v) => structuredClone(v))),
            put: (v, k) => ask(() => { st.data.set(keyOf(v, k), structuredClone(v)); return keyOf(v, k); }),
            delete: (k) => ask(() => { st.data.delete(k); }),
            clear: () => ask(() => { st.data.clear(); }),
          };
        };
        settle();
        return tx;
      },
    };
    conns.add(d);
    return d;
  }
  return {
    dbs, conns, queues,
    open(name, version) {
      const r = { result: null, error: null, transaction: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      enqueue(name, function (next) {
        let entry = dbs.get(name);
        const created = !entry;
        const want = version === undefined ? (entry ? entry.version : 1) : version;
        const old = entry ? entry.version : 0;
        const fresh = !entry || entry.version < want;
        const before = entry ? new Set(entry.stores.keys()) : null;
        if (!entry) { entry = { version: want, stores: new Map() }; dbs.set(name, entry); }
        entry.version = want;
        const c = connection(name, entry);
        r.result = c;
        if (fresh) {
          let aborted = false;
          r.transaction = { abort() { aborted = true; } };
          if (r.onupgradeneeded) r.onupgradeneeded({ target: r, oldVersion: old, newVersion: want });
          r.transaction = null;
          if (aborted) {
            // the upgrade undone: a database it created is no more, an older one is as it was
            c.close();
            if (created) dbs.delete(name);
            else { entry.version = old; Array.from(entry.stores.keys()).forEach((k) => { if (!before.has(k)) entry.stores.delete(k); }); }
            r.result = undefined;
            r.error = dom("AbortError", "the upgrade was aborted");
            if (r.onerror) r.onerror({ target: r });
            next();
            return;
          }
        }
        if (r.onsuccess) r.onsuccess({ target: r });
        next();
      });
      return r;
    },
    deleteDatabase(name) {
      const r = { onsuccess: null, onerror: null, onblocked: null };
      enqueue(name, function (next) {
        openTo(name).forEach((c) => { if (c.onversionchange) c.onversionchange({ oldVersion: c.version, newVersion: null }); });
        const go = function () {
          dbs.delete(name);
          if (r.onsuccess) r.onsuccess({});
          next();
        };
        if (!openTo(name).length) { go(); return; }
        // blocked: it stays queued (and every open asked after it waits) until the last connection closes
        if (r.onblocked) r.onblocked({});
        const wait = function () {
          if (openTo(name).length) return;
          closeWaiters.splice(closeWaiters.indexOf(wait), 1);
          later(go);
        };
        closeWaiters.push(wait);
      });
      return r;
    },
    /** every value of a store, as kept (a test's look) */
    rows(name, store) {
      const e = dbs.get(name);
      return e && e.stores.get(store) ? Array.from(e.stores.get(store).data.values()).map((v) => structuredClone(v)) : [];
    },
  };
}

/* ── the private file system: folders of files of bytes; one synchronous access handle a file; a quota ── */
export function fakeOPFS(opts) {
  const fs = { quota: (opts && opts.quota) || 1024 * 1024 * 1024, used: () => 0, root: null };
  class FileHandle {
    constructor(name) { this.kind = "file"; this.name = name; this.bytes = new Uint8Array(0); this.open = false; this.at = Date.now(); }
    async getFile() { return new File([this.bytes.slice()], this.name, { lastModified: this.at }); }
    async createSyncAccessHandle() {
      if (this.open) throw dom("NoModificationAllowedError", "already open");
      this.open = true;
      const f = this;
      let shut = false;
      return {
        getSize: () => f.bytes.length,
        truncate(n) { const b = new Uint8Array(n); b.set(f.bytes.subarray(0, Math.min(n, f.bytes.length))); f.bytes = b; },
        write(buf, o) {
          if (shut) throw dom("InvalidStateError", "the handle is closed");
          const at = (o && o.at) || 0;
          const src = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
          const end = at + src.byteLength;
          const grow = Math.max(0, end - f.bytes.length);
          if (fs.used() + grow > fs.quota) throw dom("QuotaExceededError", "the device is full");
          if (end > f.bytes.length) { const b = new Uint8Array(end); b.set(f.bytes); f.bytes = b; }
          f.bytes.set(src, at);
          f.at = Date.now();
          return src.byteLength;
        },
        read(buf, o) { const at = (o && o.at) || 0; const part = f.bytes.subarray(at, at + buf.byteLength); buf.set(part); return part.byteLength; },
        flush() {},
        close() { if (!shut) { shut = true; f.open = false; } },
      };
    }
  }
  class DirHandle {
    constructor(name) { this.kind = "directory"; this.name = name; this.entries = new Map(); }
    async getDirectoryHandle(n, o) {
      let e = this.entries.get(n);
      if (!e) { if (!(o && o.create)) throw dom("NotFoundError", n); e = new DirHandle(n); this.entries.set(n, e); }
      if (e.kind !== "directory") throw dom("TypeMismatchError", n);
      return e;
    }
    async getFileHandle(n, o) {
      let e = this.entries.get(n);
      if (!e) { if (!(o && o.create)) throw dom("NotFoundError", n); e = new FileHandle(n); this.entries.set(n, e); }
      if (e.kind !== "file") throw dom("TypeMismatchError", n);
      return e;
    }
    async removeEntry(n, o) {
      const e = this.entries.get(n);
      if (!e) throw dom("NotFoundError", n);
      if (e.kind === "file" && e.open) throw dom("NoModificationAllowedError", n);
      if (e.kind === "directory" && e.entries.size && !(o && o.recursive)) throw dom("InvalidModificationError", n);
      this.entries.delete(n);
    }
    async *keys() { for (const k of Array.from(this.entries.keys())) yield k; }
  }
  fs.root = new DirHandle("");
  const sizeOf = (d) => Array.from(d.entries.values()).reduce((n, e) => n + (e.kind === "file" ? e.bytes.length : sizeOf(e)), 0);
  fs.used = () => sizeOf(fs.root);
  fs.FileHandle = FileHandle;
  fs.DirHandle = DirHandle;
  /** the files of a folder: {name: bytes} */
  fs.files = (dir) => {
    const d = fs.root.entries.get(dir);
    const out = {};
    if (d) d.entries.forEach((e, k) => { if (e.kind === "file") out[k] = e.bytes; });
    return out;
  };
  return fs;
}

/* ── Web Locks: exclusive, one holder a name, a queue; ifAvailable answers null when held ── */
export function fakeLocks() {
  const held = new Map();              // name -> queue of waiters
  return {
    held,
    async request(name, o, cb) {
      if (typeof o === "function") { cb = o; o = {}; }
      if (held.has(name)) {
        if (o && o.ifAvailable) return cb(null);
        await new Promise((go) => held.get(name).push(go));
      } else held.set(name, []);
      try { return await cb({ name }); } finally {
        const q = held.get(name);
        if (q && q.length) q.shift()(); else held.delete(name);
      }
    },
    async query() { return { held: Array.from(held.keys()).map((name) => ({ name })) }; },
  };
}

export function fakeStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => Array.from(m.keys())[i] ?? null, get length() { return m.size; } };
}

/**
 * The whole made-up device, installed as the globals the site's modules read (window = globalThis, navigator,
 * localStorage, indexedDB, Worker; no BroadcastChannel, no document). -> {idb, fs, locks, store, nav, wake, workers,
 * uninstall()}. ua: the user agent (an iPad that calls itself a Mac, with touch, by default).
 */
export function installDevice(o) {
  const opt = o || {};
  const idb = fakeIndexedDB();
  const fs = fakeOPFS({ quota: opt.quota });
  const locks = fakeLocks();
  const store = fakeStorage();
  const wake = { held: 0, asked: 0 };
  const workers = [];
  const nav = {
    userAgent: opt.ua || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
    maxTouchPoints: 5, onLine: true, locks,
    storage: {
      getDirectory: async () => fs.root,
      estimate: async () => ({ quota: fs.quota, usage: fs.used() }),
      persist: async () => true, persisted: async () => true,
    },
    wakeLock: { request: async () => { wake.asked++; wake.held++; let gone = false; return { release: async () => { if (!gone) { gone = true; wake.held--; } }, addEventListener() {} }; } },
  };
  // the private file system as one worker sees it: every synchronous access handle it opens is noted, so that ending the
  // worker lets go of them as a browser's does (a test of a worker ended part way can then see its file removed)
  const scopedFile = (f, owned) => new Proxy(f, { get(t, p) {
    if (p === "createSyncAccessHandle") return async () => { const h = await t.createSyncAccessHandle(); owned.add(h); return h; };
    const v = t[p];
    return typeof v === "function" ? v.bind(t) : v;
  } });
  const scopedDir = (d, owned) => new Proxy(d, { get(t, p) {
    if (p === "getDirectoryHandle") return async (n, o) => scopedDir(await t.getDirectoryHandle(n, o), owned);
    if (p === "getFileHandle") return async (n, o) => scopedFile(await t.getFileHandle(n, o), owned);
    const v = t[p];
    return typeof v === "function" ? v.bind(t) : v;
  } });
  class FakeWorker {
    constructor(url) {
      const src = readFileSync(fileURLToPath(url), "utf8");
      const me = this;
      this.onmessage = null; this.onerror = null; this.terminated = false;
      this.owned = new Set();
      // the worker's own timers: dev.workerSpeed runs them this many times faster (a test's); ending the worker ends them
      const timers = this.timers = new Set();
      const ms = (n) => Math.max(0, Number(n) || 0) / (dev.workerSpeed || 1);
      const later = (cb, n, ...a) => { const id = setTimeout(() => { timers.delete(id); cb(...a); }, ms(n)); timers.add(id); return id; };
      const every = (cb, n, ...a) => { const id = setInterval(cb, ms(n), ...a); timers.add(id); return id; };
      const clear = (id) => { timers.delete(id); clearTimeout(id); clearInterval(id); };
      const self = { onmessage: null, postMessage(m) { setTimeout(function () { if (!me.terminated && me.onmessage) me.onmessage({ data: m }); }, 0); } };
      this.self = self;
      const ctx = vm.createContext({ self, navigator: { storage: { getDirectory: async () => scopedDir(fs.root, me.owned) } }, FileSystemFileHandle: fs.FileHandle,
        setTimeout: later, clearTimeout: clear, setInterval: every, clearInterval: clear,
        fetch: opt.fetch || (async () => { throw new Error("no network here"); }),
        AbortController, Blob, File, Promise, Uint8Array, ArrayBuffer, Date, Math, String, Number, Array, Error, Object, console });
      vm.runInContext(src, ctx, { filename: "plan-library-worker.js" });
      workers.push(this);
    }
    postMessage(m) { const s = this.self; const me = this; setTimeout(function () { if (!me.terminated && s.onmessage) s.onmessage({ data: m }); }, 0); }
    /** as a browser's: nothing more runs in it, and its access handles are let go */
    terminate() {
      this.terminated = true;
      this.timers.forEach((id) => { clearTimeout(id); clearInterval(id); });
      this.timers.clear();
      this.owned.forEach((h) => { try { h.close(); } catch (e) { /* closed */ } });
    }
  }
  const saved = {};
  const names = ["window", "navigator", "localStorage", "indexedDB", "Worker", "BroadcastChannel"];
  names.forEach((k) => { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); });
  const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  const apply = () => {
    set("window", globalThis);
    set("navigator", nav);
    set("localStorage", store);
    set("indexedDB", idb);
    set("Worker", FakeWorker);
    set("BroadcastChannel", undefined);
  };
  apply();
  const dev = {
    idb, fs, locks, store, nav, wake, workers, workerSpeed: 1,
    /** the globals put back (a test before may have deleted one) */
    apply,
    uninstall() {
      names.forEach((k) => { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; });
    },
  };
  return dev;
}

/** A Blob of `size` bytes starting `head` (a takeoff project's: "PDFCACHE1"), every slice asked and every whole read
    noted (the spool reads slices only). */
export function savedProject(size, head, seed) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (seed || 7)) & 255;
  const h = new TextEncoder().encode(head === undefined ? "PDFCACHE1" : head);
  bytes.set(h.subarray(0, Math.min(h.length, size)));
  const log = { slices: [], whole: 0 };
  class Watched extends Blob {
    slice(a, b, t) { log.slices.push([a, b]); return super.slice(a, b, t); }
    arrayBuffer() { log.whole++; return super.arrayBuffer(); }
    text() { log.whole++; return super.text(); }
    stream() { log.whole++; return super.stream(); }
  }
  return { blob: new Watched([bytes]), bytes, log };
}
