// A tiny in-memory stand-in for the supabase-js subset the repo modules use, for the PROJECT-PAGES
// node tests only (tests/pages-*.test.mjs). It is not the demo fake (tools/fake, PORTAL-CORE): it
// records every call so a test can check exactly what a repo function sent.
//
// Supported: from(t).select(cols)/insert(obj)/update(patch) . eq/in/gte/lt/order/range . then;
// embeds "prices:project_prices(*)" and "projects(number, name)"; rpc(name, args) through a handler
// map; storage.from(b).createSignedUrl(s). Versioned updates bump version like t90_audit.
// Made-up sandbox data only.

export function makeClient(seed, handlers) {
  const tables = {};
  Object.keys(seed || {}).forEach(function (k) { tables[k] = (seed[k] || []).map(function (r) { return Object.assign({}, r); }); });
  const calls = [];
  const rpcs = handlers || {};

  function embed(row, cols) {
    const out = Object.assign({}, row);
    if (/prices:project_prices\(\*\)/.test(cols)) {
      const pr = (tables.project_prices || []).find(function (p) { return String(p.project_id) === String(row.id); });
      out.prices = pr ? Object.assign({}, pr) : null;
    }
    if (/projects\(number,\s*name\)/.test(cols)) {
      const pj = (tables.projects || []).find(function (p) { return String(p.id) === String(row.project_id); });
      out.projects = pj ? { number: pj.number, name: pj.name } : null;
    }
    return out;
  }

  function Query(table) {
    this.table = table; this.op = "select"; this.cols = "*"; this.filters = []; this.orders = [];
    this.rangeFrom = null; this.rangeTo = null; this.payload = null; this.returning = false;
  }
  Query.prototype.select = function (cols) {
    if (this.op === "select") this.cols = cols || "*"; else { this.returning = true; this.cols = cols || "*"; }
    return this;
  };
  Query.prototype.insert = function (obj) { this.op = "insert"; this.payload = obj; return this; };
  Query.prototype.update = function (patch) { this.op = "update"; this.payload = patch; return this; };
  Query.prototype.eq = function (c, v) { this.filters.push(["eq", c, v]); return this; };
  Query.prototype.in = function (c, v) { this.filters.push(["in", c, v]); return this; };
  Query.prototype.gte = function (c, v) { this.filters.push(["gte", c, v]); return this; };
  Query.prototype.lt = function (c, v) { this.filters.push(["lt", c, v]); return this; };
  Query.prototype.order = function (c, o) { this.orders.push([c, !o || o.ascending !== false]); return this; };
  Query.prototype.range = function (a, b) { this.rangeFrom = a; this.rangeTo = b; return this; };
  Query.prototype.match = function (r) {
    return this.filters.every(function (f) {
      const v = r[f[1]];
      if (f[0] === "eq") return String(v) === String(f[2]);
      if (f[0] === "in") return f[2].map(String).indexOf(String(v)) !== -1;
      if (f[0] === "gte") return String(v) >= String(f[2]);
      if (f[0] === "lt") return String(v) < String(f[2]);
      return true;
    });
  };
  Query.prototype.run = function () {
    const self = this;
    calls.push({ table: this.table, op: this.op, cols: this.cols, filters: this.filters.slice(), payload: this.payload,
      range: this.rangeFrom == null ? null : [this.rangeFrom, this.rangeTo], orders: this.orders.slice() });
    const src = this.table === "current_files" ? "files" : this.table;
    const rows = tables[src] = tables[src] || [];
    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const made = list.map(function (o) {
        const id = rows.reduce(function (m, r) { return Math.max(m, Number(r.id) || 0); }, 0) + 1;
        const r = Object.assign({ id: id, version: 1, created_at: "2026-10-19T17:00:00.000Z", created_by: "u-me" }, o);
        rows.push(r);
        return r;
      });
      return { data: this.returning ? made.map(function (r) { return embed(r, self.cols); }) : null, error: null };
    }
    if (this.op === "update") {
      const hit = rows.filter(function (r) { return self.match(r); });
      hit.forEach(function (r) { Object.assign(r, self.payload); r.version = Number(r.version || 1) + 1; });
      return { data: this.returning ? hit.map(function (r) { return embed(r, self.cols); }) : null, error: null };
    }
    let out = rows.filter(function (r) { return self.match(r); });
    if (this.table === "current_files") out = out.filter(function (r) { return !r.deleted_at; });
    this.orders.slice().reverse().forEach(function (o) {
      out.sort(function (a, b) {
        const x = a[o[0]], y = b[o[0]];
        const r = x < y ? -1 : x > y ? 1 : 0;
        return o[1] ? r : -r;
      });
    });
    if (this.rangeFrom != null) out = out.slice(this.rangeFrom, this.rangeTo + 1);
    return { data: out.map(function (r) { return embed(r, self.cols); }), error: null };
  };
  Query.prototype.then = function (ok, bad) {
    let res;
    try { res = this.run(); } catch (e) { return Promise.reject(e).then(ok, bad); }
    return Promise.resolve(res).then(ok, bad);
  };

  return {
    calls: calls,
    tables: tables,
    from: function (t) { return new Query(t); },
    rpc: function (name, args) {
      calls.push({ rpc: name, args: args });
      const h = rpcs[name];
      if (!h) return Promise.resolve({ data: null, error: { code: "PGRST202", message: "no such function " + name } });
      try { return Promise.resolve(h(args, tables)); }
      catch (e) { return Promise.resolve({ data: null, error: { code: e.code || "P0001", message: e.message } }); }
    },
    storage: {
      from: function (bucket) {
        return {
          createSignedUrl: function (path, s) {
            calls.push({ sign: path, seconds: s, bucket: bucket });
            return Promise.resolve({ data: { signedUrl: "https://signed.test/" + path + "?s=" + s }, error: null });
          },
          createSignedUrls: function (paths, s) {
            calls.push({ signMany: paths.slice(), seconds: s, bucket: bucket });
            return Promise.resolve({ data: paths.map(function (p) { return { path: p, signedUrl: "https://signed.test/" + p + "?s=" + s, error: null }; }), error: null });
          },
        };
      },
    },
  };
}
