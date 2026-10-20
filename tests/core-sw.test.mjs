// The service worker (site/sw.js, BLUEPRINT 2.2.6) run in a node vm with a small imitation of the
// worker globals: what it keeps, under which key, and what it never keeps.
//  - a sign-in form sent by the browser itself (index.html?email=…&password=…) is never stored;
//  - the site's own files are kept under their path (a page with ?id= falls back to its one copy);
//  - every pinned jsDelivr library the site loads (scoped packages included) is kept and used first;
//  - *.supabase.co and non-GET requests are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const SRC = readFileSync(join(SITE, "sw.js"), "utf8");
const ORIGIN = "https://portal.example.test";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

/** A worker with Cache Storage in memory and a fetch that answers 200 (or fails when offline). */
function worker() {
  const stores = new Map();
  const handlers = {};
  const net = { offline: false, calls: [] };
  const keyOf = (r) => (typeof r === "string" ? r : r.url);
  const strip = (u) => { const x = new URL(u); return x.origin + x.pathname; };
  function cacheOf(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      async put(r, res) { m.set(keyOf(r), res); },
      async match(r, o) {
        const k = keyOf(r);
        if (m.has(k)) return m.get(k);
        if (o && o.ignoreSearch) { for (const [kk, v] of m) if (strip(kk) === strip(k)) return v; }
        return undefined;
      },
      async keys() { return Array.from(m.keys()).map((url) => ({ url })); },
      async delete(r) { return m.delete(keyOf(r)); },
    };
  }
  const caches = {
    async open(name) { return cacheOf(name); },
    async keys() { return Array.from(stores.keys()); },
    async delete(name) { return stores.delete(name); },
    async match(r, o) { for (const name of stores.keys()) { const v = await cacheOf(name).match(r, o); if (v) return v; } return undefined; },
  };
  const response = (url) => ({ ok: true, type: url.startsWith(ORIGIN) ? "basic" : "cors", url, clone() { return response(url); } });
  const self = {
    location: new URL(ORIGIN + "/sw.js"),
    registration: { scope: ORIGIN + "/", showNotification: async () => {} },
    clients: { claim: async () => {}, matchAll: async () => [] },
    skipWaiting() {},
    addEventListener(type, fn) { handlers[type] = fn; },
  };
  const ctx = vm.createContext({
    self, caches, URL, Promise, console,
    fetch: async (r) => {
      const url = keyOf(r);
      net.calls.push(url);
      if (net.offline) throw new TypeError("Failed to fetch");
      return response(url);
    },
  });
  vm.runInContext(SRC, ctx);
  async function fire(type, event) {
    let done = Promise.resolve();
    const ev = Object.assign({ waitUntil(p) { done = p; }, respondWith(p) { done = p; ev.responded = true; } }, event);
    handlers[type](ev);
    const out = await done;
    await new Promise((r) => setTimeout(r, 5));     // the background cache.put
    return { responded: !!ev.responded, out };
  }
  const get = (url, mode) => fire("fetch", { request: { url, method: "GET", mode: mode || "no-cors" } });
  return { stores, net, fire, get, ctx };
}

test("sw: a sign-in sent by the browser itself is never stored, only the page's path is", async () => {
  const w = worker();
  await w.fire("install", {});
  await w.fire("activate", {});
  const url = ORIGIN + "/index.html?email=field%40example.com&password=Made-up-Pass-2026";
  const r = await w.get(url, "navigate");
  assert.ok(r.responded);
  const kept = Array.from(w.stores.get("dcr-portal2-v1").keys());
  assert.ok(kept.every((k) => !/password=|email=/.test(k)), kept.join("\n"));
  assert.ok(kept.every((k) => !new URL(k).search), "no key carries a query string");
  assert.ok(kept.includes(ORIGIN + "/index.html"));
});

test("sw: offline, a page with ?id= gets the one kept copy of its path", async () => {
  const w = worker();
  await w.get(ORIGIN + "/project.html?id=268", "navigate");
  w.net.offline = true;
  const r = await w.get(ORIGIN + "/project.html?id=999&tab=journal", "navigate");
  assert.equal(r.out.url, ORIGIN + "/project.html?id=268");
});

test("sw: an older worker's copies with a query string are dropped on activate", async () => {
  const w = worker();
  const c = w.ctx.caches;
  const cache = await c.open("dcr-portal2-v1");
  await cache.put(ORIGIN + "/index.html?email=a%40b.c&password=x", { ok: true });
  await cache.put(ORIGIN + "/board.html", { ok: true });
  await cache.put("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js", { ok: true });
  await w.fire("activate", {});
  const kept = Array.from(w.stores.get("dcr-portal2-v1").keys());
  assert.deepEqual(kept.sort(), [ORIGIN + "/board.html", "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"].sort());
});

test("sw: every pinned jsDelivr library the site loads is kept (scoped packages too) and used first", async () => {
  const urls = new Set();
  for (const f of walk(SITE)) {
    if (!/\.(html|m?js)$/.test(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^"'\s`)]+/g)) urls.add(m[0]);
    // sb.js builds its URL from the version constant
    const v = /SUPABASE_JS_VERSION = "(\d+\.\d+\.\d+)"/.exec(src);
    if (v) urls.add("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@" + v[1] + "/dist/umd/supabase.js");
  }
  const lib = Array.from(urls).filter((u) => /@\d+\.\d+\.\d+\//.test(u));
  assert.ok(lib.some((u) => u.includes("@supabase/supabase-js@")), "supabase-js is among them");
  for (const u of lib) {
    const w = worker();
    const first = await w.get(u);
    assert.ok(first.responded, u + ": the worker must keep it");
    w.net.offline = true;
    const again = await w.get(u);
    assert.ok(again.responded && again.out && again.out.url === u, u + ": the kept copy answers offline");
  }
});

test("sw: the database and non-GET requests are never touched; an unpinned CDN path is not kept", async () => {
  const w = worker();
  assert.equal((await w.get("https://abcdefghijklmnop.supabase.co/rest/v1/projects?select=*")).responded, false);
  assert.equal((await w.fire("fetch", { request: { url: ORIGIN + "/index.html", method: "POST", mode: "navigate" } })).responded, false);
  assert.equal((await w.get("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js")).responded, false);
  assert.equal((await w.get("https://cdn.jsdelivr.net/gh/someone/repo@1.0.0/x.js")).responded, false);
});
