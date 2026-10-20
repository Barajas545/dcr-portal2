// PROJECT-PAGES test helper: the demo database (tools/fake/engine.js + seed.js, PORTAL-CORE) behind a
// node-sized supabase-js subset, signed in as one demo account, so the repo modules can be run over
// the same made-up data and the same rules the demo pages use. The browser stand-in
// (tools/fake/fake-supabase.js) needs a DOM; this is only the query / rpc / signed-URL part.
import { existsSync } from "node:fs";

const ENGINE = new URL("../tools/fake/engine.js", import.meta.url);
const SEED = new URL("../tools/fake/seed.js", import.meta.url);

export const available = existsSync(ENGINE) && existsSync(SEED);

let loaded = null;
export async function loadFake() {
  if (!available) return null;
  if (!loaded) {
    await import(ENGINE.href);
    await import(SEED.href);
    loaded = globalThis.DCR2Fake;
  }
  return loaded;
}

/** A fresh seeded engine. */
export async function freshEngine(now) {
  const F = await loadFake();
  const engine = F.createEngine({ maxFileSize: 500 * 1024 * 1024 });
  engine.load(F.seed({ now: now || new Date() }));
  return engine;
}

export async function person(key) {
  const F = await loadFake();
  return F.PEOPLE.find((p) => p.key === key);
}

const clone = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
const fail = (e) => ({ data: null, error: e && e.toJSON ? e.toJSON() : { code: "XX000", message: String(e && e.message) }, status: (e && e.status) || 500 });

/** A client over `engine` as the profile `uid`. */
export function clientAs(engine, uid) {
  const ctx = () => ({ uid });
  function Q(t) { this.t = t; this.m = "select"; this.ret = false; this.body = null; this.q = { columns: "*", filters: [], orders: [], foreignLimits: {} }; }
  Q.prototype.select = function (cols) { if (this.m !== "select") this.ret = true; this.q.columns = cols || "*"; return this; };
  Q.prototype.insert = function (v) { this.m = "insert"; this.body = v; return this; };
  Q.prototype.update = function (v) { this.m = "update"; this.body = v; return this; };
  ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in"].forEach((op) => {
    Q.prototype[op] = function (c, v) { this.q.filters.push({ col: c, op, val: v, neg: false }); return this; };
  });
  Q.prototype.is = function (c, v) { this.q.filters.push({ col: c, op: "is", val: v === null ? "null" : String(v), neg: false }); return this; };
  Q.prototype.order = function (c, o) { this.q.orders.push({ col: c, asc: !o || o.ascending !== false, foreign: null }); return this; };
  Q.prototype.range = function (a, b) { this.q.offset = a; this.q.limit = b - a + 1; return this; };
  Q.prototype.limit = function (n) { this.q.limit = n; return this; };
  Q.prototype.rowsBy = function (made) {
    const pk = this.t === "project_prices" ? "project_id" : "id";
    if (!made.length) return [];
    return engine.select(ctx(), this.t, { columns: this.q.columns, filters: [{ col: pk, op: "in", val: made.map((r) => r[pk]) }],
      orders: [{ col: pk, asc: true }], foreignLimits: {} }).data;
  };
  Q.prototype.run = function () {
    try {
      if (this.m === "select") return { data: clone(engine.select(ctx(), this.t, this.q).data), error: null, status: 200 };
      if (this.m === "insert") {
        const made = engine.insert(ctx(), this.t, clone(this.body));
        return { data: this.ret ? clone(this.rowsBy(made)) : null, error: null, status: 201 };
      }
      const changed = engine.update(ctx(), this.t, clone(this.body), this.q);
      return { data: this.ret ? clone(this.rowsBy(changed)) : null, error: null, status: 200 };
    } catch (e) { return fail(e); }
  };
  Q.prototype.then = function (ok, bad) { return Promise.resolve(this.run()).then(ok, bad); };
  function signOne(path) {
    try { engine.storage.sign(ctx(), path); return { data: { signedUrl: "blob:demo/" + path }, error: null }; }
    catch (e) { return { data: null, error: { message: e.message, status: e.status || 400 } }; }
  }
  return {
    from: (t) => new Q(t),
    rpc: (name, args) => {
      try { const d = engine.rpc(ctx(), name, clone(args)); return Promise.resolve({ data: d === undefined ? null : clone(d), error: null }); }
      catch (e) { return Promise.resolve(fail(e)); }
    },
    storage: {
      from: () => ({
        createSignedUrl: async (p) => signOne(p),
        createSignedUrls: async (paths) => ({ data: paths.map((p) => { const r = signOne(p); return { path: p, signedUrl: r.data && r.data.signedUrl, error: r.error ? r.error.message : null }; }), error: null }),
      }),
    },
  };
}
