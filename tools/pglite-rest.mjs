/* DCR Portal 2 — the supabase-js subset Portal 2 uses, answered by a PGlite database the way the
   Supabase Data API (PostgREST), Storage and Realtime would answer it (development only).

   tools/schema-check.mjs runs Portal 2's own modules (site/js/sb.js, repo/*.js, upload-queue2.js,
   live.js) over this client against PGlite loaded with every DCR Desktop 2 migration, as each role.
   Every call is translated to the SQL PostgREST would run and executed as that person
   (SET ROLE authenticated + request.jwt.claims), so row level security, triggers, grants, column
   names, RPC parameter names and embeds are the REAL database's — nothing is imitated:

   - from(t).select("*, alias:other(cols)") -> one SELECT with correlated sub-selects for embeds
     (many-to-one: an object or null; one-to-many: an array; a unique child key: an object), the
     relationship found from the foreign keys (none: PGRST200, several: PGRST201);
   - eq/neq/gt/gte/lt/lte/like/ilike/is/in, order, range, limit, single, maybeSingle;
   - insert / update / delete with .select(...) -> "WITH src AS (<dml> RETURNING *) SELECT ...";
     without .select() nothing is returned (return=minimal);
   - rpc(name, args) -> public.name(arg => $1 ...) matched by argument NAME (an unknown or missing
     argument: PGRST202, as PostgREST answers); set-returning -> array, composite -> object;
   - storage.from(bucket): upload (INSERT into storage.objects under its RLS), createSignedUrl(s)
     (the object must be visible to the caller: storage.objects SELECT policy);
   - channel(topic, {config: {private: true}}).subscribe(cb): SUBSCRIBED when the caller may read
     realtime.messages for that topic (Realtime's own check), CHANNEL_ERROR otherwise;
   - auth: signInWithPassword against made-up passwords given to the client, getSession, signOut,
     updateUser, onAuthStateChange.

   Values are sent as text and cast to the column's (or parameter's) own type. Errors come back as
   PostgREST shapes ({code, message, details, hint}, HTTP-like status). */

export const STATUS_OF = {
  "42501": 403, "PGRST116": 406, "PGRST200": 400, "PGRST201": 300, "PGRST202": 404, "PGRST204": 400,
  "23505": 409, "23503": 409, "23514": 400, "23502": 400, "22023": 400, "22P02": 400, "P0001": 400,
  "42703": 400, "42P01": 404, "42883": 404,
};

function statusFor(code) {
  if (STATUS_OF[code]) return STATUS_OF[code];
  const m = /^PT(\d{3})$/.exec(code || "");
  return m ? Number(m[1]) : 400;
}

function pgErr(e) {
  return { code: String(e.code || "XX000"), message: String(e.message || e), details: e.detail || e.details || null, hint: e.hint || null };
}

function restErr(code, message, details) {
  const e = new Error(message);
  e.code = code;
  e.details = details || null;
  return e;
}

const qi = (name) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) throw restErr("PGRST100", "bad identifier: " + name);
  return '"' + name + '"';
};

/* ── values ───────────────────────────────────────────────────────────── */

function pgArrayLiteral(list) {
  return "{" + list.map((v) => {
    if (v === null || v === undefined) return "NULL";
    if (Array.isArray(v)) return pgArrayLiteral(v);
    return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }).join(",") + "}";
}

/** A JS value -> the text PostgREST would hand Postgres for a column / parameter of `type`. */
export function wire(value, type) {
  if (value === null || value === undefined) return null;
  const t = String(type || "text");
  if (/\[\]$/.test(t)) return Array.isArray(value) ? pgArrayLiteral(value) : String(value);
  if (/^jsonb?$/.test(t)) return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/* ── the select string ────────────────────────────────────────────────── */

function splitTop(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of String(s)) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

export function parseSelect(s) {
  return splitTop(s || "*").map((item) => {
    if (item === "*") return { kind: "star" };
    const m = /^(?:([A-Za-z_][A-Za-z0-9_]*):)?([A-Za-z_][A-Za-z0-9_]*)((?:![A-Za-z_][A-Za-z0-9_]*)*)(?:\(([\s\S]*)\))?$/.exec(item);
    if (!m) throw restErr("PGRST100", "could not parse the select item: " + item);
    const hints = (m[3] || "").split("!").filter(Boolean);
    if (m[4] !== undefined) {
      return { kind: "embed", alias: m[1] || m[2], name: m[2], inner: hints.includes("inner"),
        hint: hints.filter((h) => h !== "inner")[0] || null, items: parseSelect(m[4] || "*") };
    }
    return { kind: "col", name: m[2], alias: m[1] || null };
  });
}

/* ── the catalog (read once, as the database owner) ───────────────────── */

export async function loadCatalog(db) {
  const cols = (await db.query(`
    select c.relname as tbl, c.relkind as kind, a.attname as col, format_type(a.atttypid, a.atttypmod) as type
      from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
       and a.attnum > 0 and not a.attisdropped order by c.relname, a.attnum`)).rows;
  const fks = (await db.query(`
    select con.conname, cl.relname as child, pl.relname as parent,
           array(select a.attname from unnest(con.conkey) with ordinality k(n, i)
                   join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i) as child_cols,
           array(select a.attname from unnest(con.confkey) with ordinality k(n, i)
                   join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.i) as parent_cols
      from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_class pl on pl.oid = con.confrelid
     where con.contype = 'f' and cl.relnamespace = 'public'::regnamespace and pl.relnamespace = 'public'::regnamespace`)).rows;
  const uniq = (await db.query(`
    select cl.relname as tbl,
           array(select a.attname from unnest(con.conkey) k(n) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n) as cols
      from pg_constraint con join pg_class cl on cl.oid = con.conrelid
     where con.contype in ('p', 'u') and cl.relnamespace = 'public'::regnamespace`)).rows;
  const fns = (await db.query(`
    select p.proname as name, p.proretset as setof, t.typtype as rettyp, format_type(p.prorettype, null) as rettype,
           p.pronargs as nargs, p.pronargdefaults as ndefaults,
           coalesce(p.proargnames, '{}') as argnames, coalesce(p.proargmodes::text[], '{}') as argmodes,
           array(select format_type(x, null) from unnest(p.proargtypes) x) as argtypes
      from pg_proc p join pg_type t on t.oid = p.prorettype
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'`)).rows;
  const tables = {};
  for (const c of cols) {
    const t = tables[c.tbl] || (tables[c.tbl] = { kind: c.kind, cols: {} });
    t.cols[c.col] = c.type;
  }
  const functions = {};
  for (const f of fns) {
    const names = f.argmodes.length ? f.argnames.filter((_n, i) => ["i", "b", "v"].includes(f.argmodes[i])) : f.argnames.slice(0, f.nargs);
    (functions[f.name] || (functions[f.name] = [])).push({
      name: f.name, setof: f.setof, composite: f.rettyp === "c", rettype: f.rettype,
      args: names.map((n, i) => ({ name: n, type: f.argtypes[i], required: i < f.nargs - f.ndefaults })),
    });
  }
  return { tables, fks, uniq, functions };
}

function relationship(cat, from, to, hint) {
  const out = [];
  for (const fk of cat.fks) {
    if (fk.child === from && fk.parent === to) out.push({ dir: "m2o", fk });
    if (fk.child === to && fk.parent === from) out.push({ dir: "o2m", fk });
  }
  const picked = hint ? out.filter((r) => r.fk.conname === hint || r.fk.child_cols.includes(hint)) : out;
  if (!picked.length) {
    throw restErr("PGRST200", `Could not find a relationship between '${from}' and '${to}' in the schema cache`);
  }
  if (picked.length > 1) {
    throw restErr("PGRST201", `Could not embed because more than one relationship was found for '${from}' and '${to}'`,
      picked.map((r) => r.fk.conname).join(", "));
  }
  const r = picked[0];
  if (r.dir === "o2m") {
    const key = r.fk.child_cols.slice().sort().join(",");
    r.toOne = cat.uniq.some((u) => u.tbl === to && u.cols.slice().sort().join(",") === key);
  } else {
    r.toOne = true;
  }
  return r;
}

/* ── SQL building ─────────────────────────────────────────────────────── */

class Sql {
  constructor() { this.params = []; this.n = 0; }
  param(value, type) {
    this.params.push(wire(value, type));
    return "$" + this.params.length + "::" + (type || "text");
  }
  alias() { return "t" + (++this.n); }
}

function typeOf(cat, table, col) {
  const t = cat.tables[table];
  if (!t) throw restErr("42P01", `relation "public.${table}" does not exist`);
  if (!(col in t.cols)) throw restErr("42703", `column ${table}.${col} does not exist`);
  return t.cols[col];
}

function selectList(cat, sql, table, alias, items) {
  const parts = [];
  for (const it of items) {
    if (it.kind === "star") { parts.push(alias + ".*"); continue; }
    if (it.kind === "col") { typeOf(cat, table, it.name); parts.push(alias + "." + qi(it.name) + (it.alias ? " as " + qi(it.alias) : "")); continue; }
    const rel = relationship(cat, table, it.name, it.hint);
    const a = sql.alias();
    const join = rel.dir === "m2o"
      ? rel.fk.parent_cols.map((pc, i) => a + "." + qi(pc) + " = " + alias + "." + qi(rel.fk.child_cols[i]))
      : rel.fk.child_cols.map((cc, i) => a + "." + qi(cc) + " = " + alias + "." + qi(rel.fk.parent_cols[i]));
    const inner = "select " + selectList(cat, sql, it.name, a, it.items) + " from public." + qi(it.name) + " " + a + " where " + join.join(" and ");
    parts.push(rel.toOne
      ? "(select row_to_json(_e) from (" + inner + " limit 1) _e) as " + qi(it.alias)
      : "coalesce((select json_agg(_e) from (" + inner + ") _e), '[]'::json) as " + qi(it.alias));
  }
  return parts.join(", ");
}

function whereList(cat, sql, table, alias, filters) {
  return filters.map((f) => {
    const col = alias + "." + qi(f.col);
    const type = typeOf(cat, table, f.col);
    switch (f.op) {
      case "eq": return col + " = " + sql.param(f.val, type);
      case "neq": return col + " <> " + sql.param(f.val, type);
      case "gt": return col + " > " + sql.param(f.val, type);
      case "gte": return col + " >= " + sql.param(f.val, type);
      case "lt": return col + " < " + sql.param(f.val, type);
      case "lte": return col + " <= " + sql.param(f.val, type);
      case "like": return col + "::text like " + sql.param(f.val, "text");
      case "ilike": return col + "::text ilike " + sql.param(f.val, "text");
      case "is": {
        const v = f.val === null || f.val === "null" ? "null" : f.val === true || f.val === "true" ? "true" : f.val === false || f.val === "false" ? "false" : null;
        if (!v) throw restErr("PGRST100", "is() takes null, true or false");
        return col + " is " + v;
      }
      case "in": {
        const list = Array.isArray(f.val) ? f.val : [f.val];
        if (!list.length) return "false";
        return col + " in (" + list.map((v) => sql.param(v, type)).join(", ") + ")";
      }
      default: throw restErr("PGRST100", "operator not supported here: " + f.op);
    }
  });
}

/* ── the client ───────────────────────────────────────────────────────── */

/**
 * makeClient({db, catalog, passwords: {email: password}, onQuery?}) -> a supabase-js-like client.
 * client.as(uid | null) switches who is calling (null: signed out). Every call runs as that person.
 */
export function makeClient({ db, catalog, passwords, onQuery }) {
  let uid = null;
  let chain = Promise.resolve();

  /** Run fn with the caller's role; one at a time (PGlite has one connection). */
  function run(fn, who) {
    const w = who === undefined ? uid : who;
    const p = chain.then(async () => {
      await db.exec("reset role");
      if (w === "owner") {
        await db.query("select set_config('request.jwt.claims', '', false)");
      } else if (w === "service") {
        await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "service_role" })]);
        await db.exec("set role service_role");
      } else if (w) {
        await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: w, role: "authenticated" })]);
        await db.exec("set role authenticated");
      } else {
        await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "anon" })]);
        await db.exec("set role anon");
      }
      try { return await fn(); } finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims', '', false)"); }
    });
    chain = p.catch(() => {});
    return p;
  }

  async function exec(text, params) {
    if (onQuery) onQuery(text, params);
    return (await db.query(text, params)).rows;
  }

  class Builder {
    constructor(table) {
      this.table = table; this.method = "select"; this.cols = "*"; this.returning = false;
      this.filters = []; this.orders = []; this.lim = null; this.off = null; this.mode = "many"; this.body = null;
    }
    select(cols) { if (this.method !== "select") this.returning = true; this.cols = cols || "*"; return this; }
    insert(body) { this.method = "insert"; this.body = body; return this; }
    update(body) { this.method = "update"; this.body = body; return this; }
    delete() { this.method = "delete"; return this; }
    order(col, o) { this.orders.push({ col, asc: !o || o.ascending !== false, nullsFirst: o && o.nullsFirst }); return this; }
    range(a, b) { this.off = a; this.lim = b - a + 1; return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.mode = "single"; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    then(res, rej) { return this.exec().then(res, rej); }
    async exec() {
      try {
        const rows = await run(() => this.sql());
        let data = rows === null ? null : rows.map((r) => r.j);
        if (this.mode !== "many" && data !== null) {
          if (data.length > 1 || (this.mode === "single" && data.length === 0)) {
            const e = restErr("PGRST116", "JSON object requested, multiple (or no) rows returned",
              "The result contains " + data.length + " rows");
            return { data: null, error: pgErr(e), status: 406, statusText: "Not Acceptable" };
          }
          data = data[0] || null;
        }
        return { data, error: null, status: this.method === "insert" ? 201 : 200 };
      } catch (e) {
        const err = pgErr(e);
        return { data: null, error: err, status: statusFor(err.code) };
      }
    }
    async sql() {
      const cat = catalog;
      if (!cat.tables[this.table]) throw restErr("42P01", `relation "public.${this.table}" does not exist`);
      const sql = new Sql();
      const items = parseSelect(this.cols);
      if (this.method === "select") {
        const a = sql.alias();
        let text = "select " + selectList(cat, sql, this.table, a, items) + " from public." + qi(this.table) + " " + a;
        const where = whereList(cat, sql, this.table, a, this.filters);
        if (where.length) text += " where " + where.join(" and ");
        if (this.orders.length) {
          text += " order by " + this.orders.map((o) => {
            typeOf(cat, this.table, o.col);
            return a + "." + qi(o.col) + (o.asc ? " asc" : " desc") + (o.nullsFirst === true ? " nulls first" : o.nullsFirst === false ? " nulls last" : "");
          }).join(", ");
        }
        if (this.lim !== null) text += " limit " + Number(this.lim);
        if (this.off !== null) text += " offset " + Number(this.off);
        return exec("select row_to_json(_r) as j from (" + text + ") _r", sql.params);
      }
      let dml;
      if (this.method === "insert") {
        const list = Array.isArray(this.body) ? this.body : [this.body];
        const keys = Array.from(new Set(list.flatMap((r) => Object.keys(r || {}))));
        if (!keys.length) throw restErr("PGRST100", "nothing to insert");
        keys.forEach((k) => typeOf(cat, this.table, k));
        dml = "insert into public." + qi(this.table) + " (" + keys.map(qi).join(", ") + ") values " +
          list.map((r) => "(" + keys.map((k) => (k in r ? sql.param(r[k], cat.tables[this.table].cols[k]) : "default")).join(", ") + ")").join(", ");
      } else if (this.method === "update") {
        const keys = Object.keys(this.body || {});
        if (!keys.length) throw restErr("PGRST100", "nothing to update");
        const a = "t0";
        dml = "update public." + qi(this.table) + " " + a + " set " +
          keys.map((k) => qi(k) + " = " + sql.param(this.body[k], typeOf(cat, this.table, k))).join(", ");
        const where = whereList(cat, sql, this.table, a, this.filters);
        if (where.length) dml += " where " + where.join(" and ");
      } else {
        const a = "t0";
        dml = "delete from public." + qi(this.table) + " " + a;
        const where = whereList(cat, sql, this.table, a, this.filters);
        if (!where.length) throw restErr("21000", "DELETE requires a WHERE clause");
        dml += " where " + where.join(" and ");
      }
      if (!this.returning) {
        await exec(dml, sql.params);
        return null;
      }
      const s = sql.alias();
      return exec("with _src as (" + dml + " returning *) select row_to_json(_r) as j from (select " +
        selectList(cat, sql, this.table, s, items) + " from _src " + s + ") _r", sql.params);
    }
  }
  ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in"].forEach((op) => {
    Builder.prototype[op] = function (col, val) { this.filters.push({ col, op, val }); return this; };
  });
  Builder.prototype.is = function (col, val) { this.filters.push({ col, op: "is", val }); return this; };

  async function rpc(name, args) {
    const a = args || {};
    try {
      const overloads = catalog.functions[name];
      const keys = Object.keys(a);
      const fn = (overloads || []).find((f) => keys.every((k) => f.args.some((x) => x.name === k)) &&
        f.args.every((x) => !x.required || keys.includes(x.name)));
      if (!fn) {
        throw restErr("PGRST202", `Could not find the function public.${name}(${keys.join(", ")}) in the schema cache`,
          "Searched for the function public." + name + " with parameters " + keys.join(", "));
      }
      const sql = new Sql();
      const call = "public." + qi(name) + "(" + keys.map((k) => qi(k) + " => " + sql.param(a[k], fn.args.find((x) => x.name === k).type)).join(", ") + ")";
      const text = fn.setof
        ? "select coalesce(json_agg(_r), '[]'::json) as j from " + call + " _r"
        : fn.composite ? "select row_to_json(_r) as j from " + call + " _r"
          : "select to_json(" + call + ") as j";
      const rows = await run(() => exec(text, sql.params));
      let data = rows[0] ? rows[0].j : null;
      if (fn.composite && data && Object.values(data).every((v) => v === null)) data = null;
      return { data, error: null, status: 200 };
    } catch (e) {
      const err = pgErr(e);
      return { data: null, error: err, status: statusFor(err.code) };
    }
  }

  function bucket(id) {
    const visible = (path) => run(() => exec("select 1 from storage.objects where bucket_id = $1 and name = $2", [id, path]));
    return {
      async upload(path, _body, opts) {
        try {
          await run(() => exec("insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, auth.uid(), auth.uid()::text, $3::jsonb)",
            [id, path, JSON.stringify({ mimetype: (opts && opts.contentType) || "application/octet-stream" })]));
          return { data: { path, fullPath: id + "/" + path }, error: null };
        } catch (e) {
          const dup = String(e.code) === "23505";
          return { data: null, error: { message: dup ? "The resource already exists" : "new row violates row-level security policy",
            statusCode: dup ? "409" : "403", code: e.code } };
        }
      },
      async createSignedUrl(path, seconds) {
        const r = await visible(path);
        if (!r.length) return { data: null, error: { message: "Object not found", statusCode: "400" } };
        return { data: { signedUrl: "pglite://" + id + "/" + path + "?expires=" + (seconds || 0) }, error: null };
      },
      async createSignedUrls(paths, seconds) {
        const out = [];
        for (const p of paths) {
          const r = await visible(p);
          out.push(r.length ? { path: p, signedUrl: "pglite://" + id + "/" + p + "?expires=" + (seconds || 0), error: null }
            : { path: p, signedUrl: null, error: "Either the object does not exist or you do not have access to it" });
        }
        return { data: out, error: null };
      },
    };
  }

  const listeners = new Set();
  function emit(event) {
    const s = uid ? { user: { id: uid }, access_token: "pglite-" + uid } : null;
    listeners.forEach((cb) => { try { cb(event, s); } catch (e) { /* */ } });
  }

  const auth = {
    async getSession() { return { data: { session: uid ? { user: { id: uid }, access_token: "pglite-" + uid } : null }, error: null }; },
    async signInWithPassword({ email, password }) {
      const want = passwords[String(email || "").toLowerCase()];
      if (!want || want !== password) {
        return { data: { user: null, session: null }, error: Object.assign(new Error("Invalid login credentials"), { status: 400, code: "invalid_credentials" }) };
      }
      const r = await run(() => exec("select id from auth.users where lower(email) = lower($1)", [email]), "owner");
      if (!r.length) return { data: { user: null, session: null }, error: Object.assign(new Error("Invalid login credentials"), { status: 400, code: "invalid_credentials" }) };
      uid = r[0].id;
      emit("SIGNED_IN");
      return { data: { user: { id: uid }, session: { user: { id: uid } } }, error: null };
    },
    async signOut(opts) { const scope = (opts && opts.scope) || "global"; if (scope !== "others") { uid = null; emit("SIGNED_OUT"); } return { error: null }; },
    async updateUser(attrs) {
      if (!uid) return { data: { user: null }, error: Object.assign(new Error("Auth session missing!"), { status: 401 }) };
      if (attrs && attrs.password) {
        const r = await run(() => exec("select email from auth.users where id = $1", [uid]), "owner");
        passwords[String(r[0].email).toLowerCase()] = attrs.password;
      }
      emit("USER_UPDATED");
      return { data: { user: { id: uid } }, error: null };
    },
    onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe() { listeners.delete(cb); } } } }; },
  };

  /** A private channel: joinable when the caller may read realtime.messages for the topic. */
  function channel(topic, opts) {
    const priv = !!(opts && opts.config && opts.config.private);
    const ch = {
      topic, bindings: [], state: "closed",
      on(type, filter, cb) { ch.bindings.push({ type, filter, cb }); return ch; },
      subscribe(cb) {
        (async () => {
          let ok = !priv;
          if (priv) {
            // Realtime's own check: a broadcast and a presence probe row, read back as the caller;
            // the join is refused when the caller can read neither
            await run(async () => {
              await exec("delete from realtime.messages where topic = $1", [topic]);
              await exec("insert into realtime.messages (topic, extension, payload) values ($1, 'broadcast', '{}'), ($1, 'presence', '{}')", [topic]);
            }, "service");
            const r = await run(async () => {
              await exec("select set_config('realtime.topic', $1, false)", [topic]);
              try { return await exec("select count(*)::int as n from realtime.messages where topic = $1", [topic]); }
              finally { await exec("select set_config('realtime.topic', '', false)"); }
            }).catch(() => [{ n: 0 }]);
            ok = r[0].n > 0;
          }
          ch.state = ok ? "joined" : "errored";
          if (cb) cb(ok ? "SUBSCRIBED" : "CHANNEL_ERROR", ok ? undefined : new Error("Unauthorized: You do not have permissions to read from this Channel topic: " + topic));
        })();
        return ch;
      },
      track() { return Promise.resolve(ch.state === "joined" ? "ok" : "error"); },
      untrack() { return Promise.resolve("ok"); },
      presenceState() { return {}; },
      unsubscribe() { ch.state = "closed"; return Promise.resolve("ok"); },
    };
    channels.add(ch);
    return ch;
  }
  const channels = new Set();

  /* Storage's HTTP API, the part upload-queue2.js speaks (simple POST, TUS create / PATCH / HEAD).
     The caller is the bearer token "pglite-<uid>". Bytes are counted, not kept. The object row is
     written under the caller's RLS when the upload completes; a TUS upload is also checked when it
     is created (Storage refuses an upload it would not accept at the end). */
  const tus = new Map();
  let tusN = 0;
  async function canInsert(who, bucketId, key) {
    return run(async () => {
      await exec("begin");
      try {
        await exec("insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, auth.uid(), auth.uid()::text)", [bucketId, key]);
        return { ok: true };
      } catch (e) {
        return { ok: false, dup: String(e.code) === "23505" };
      } finally { await exec("rollback"); }
    }, who);
  }
  async function putObject(who, bucketId, key, mime, size) {
    try {
      await run(() => exec("insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, auth.uid(), auth.uid()::text, $3::jsonb)",
        [bucketId, key, JSON.stringify({ mimetype: mime, size })]), who);
      return null;
    } catch (e) {
      return String(e.code) === "23505" ? 409 : 403;
    }
  }
  const sjson = (status, obj, extra) => ({ status, headers: Object.assign({ "content-type": "application/json" }, extra || {}), text: obj ? JSON.stringify(obj) : "" });
  const refusal = (code) => (code === 409
    ? sjson(409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" })
    : sjson(403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }));
  async function storageHttp(method, path, hdrs, body) {
    const h = {};
    for (const k of Object.keys(hdrs || {})) h[k.toLowerCase()] = hdrs[k];
    const tok = String(h.authorization || "").replace(/^Bearer\s+/i, "");
    const who = /^pglite-/.test(tok) ? tok.slice(7) : null;
    const size = body && body.size !== undefined ? body.size : body && body.byteLength !== undefined ? body.byteLength : 0;
    let m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(path);
    if (m && method === "POST") {
      const key = m[2].split("/").map(decodeURIComponent).join("/");
      const bad = await putObject(who, m[1], key, h["content-type"] || "application/octet-stream", size);
      return bad ? refusal(bad) : sjson(200, { Key: m[1] + "/" + key, Id: "obj-" + key.length });
    }
    if (path === "/storage/v1/upload/resumable" && method === "POST") {
      const meta = {};
      String(h["upload-metadata"] || "").split(",").forEach((kv) => {
        const [k, v] = kv.trim().split(" ");
        if (k) meta[k] = Buffer.from(v || "", "base64").toString("utf8");
      });
      const can = await canInsert(who, meta.bucketName, meta.objectName);
      if (!can.ok) return refusal(can.dup ? 409 : 403);
      const id = "u" + (++tusN);
      tus.set(id, { who, bucket: meta.bucketName, key: meta.objectName, length: Number(h["upload-length"]), offset: 0, mime: meta.contentType || "application/octet-stream" });
      return { status: 201, headers: { location: "/storage/v1/upload/resumable/" + id, "tus-resumable": "1.0.0" }, text: "" };
    }
    m = /^\/storage\/v1\/upload\/resumable\/([^/]+)$/.exec(path);
    if (m && (method === "PATCH" || method === "HEAD")) {
      const u = tus.get(m[1]);
      if (!u || u.who !== who) return { status: 404, headers: {}, text: "" };
      if (method === "HEAD") return { status: 200, headers: { "upload-offset": String(u.offset), "upload-length": String(u.length), "tus-resumable": "1.0.0" }, text: "" };
      if (Number(h["upload-offset"]) !== u.offset) return { status: 409, headers: { "upload-offset": String(u.offset) }, text: "" };
      u.offset += size;
      if (u.offset >= u.length) {
        const bad = await putObject(who, u.bucket, u.key, u.mime, u.length);
        tus.delete(m[1]);
        if (bad) return refusal(bad);
      }
      return { status: 204, headers: { "upload-offset": String(u.offset), "tus-resumable": "1.0.0" }, text: "" };
    }
    return { status: 400, headers: {}, text: JSON.stringify({ message: "not simulated: " + method + " " + path }) };
  }

  return {
    as(who) { uid = who || null; },
    get uid() { return uid; },
    from: (t) => new Builder(t),
    rpc,
    storage: { from: bucket },
    storageHttp,
    auth,
    channel,
    channels,
    removeChannel(ch) { channels.delete(ch); return Promise.resolve("ok"); },
    run,
  };
}
