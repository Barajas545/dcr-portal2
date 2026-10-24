/* DCR Portal 2 — P5c on PGlite (development only, never deployed): what tools/pglite-serve.mjs adds when it is started
   with {p5c: true} (tools/e2e-p5c-pglite.mjs walks it).

   1. Made-up office lists and sales tools in the REAL tables of migration M5c (20261027000100_office_lists.sql): the
      demo database's own made-up rows (tools/fake/p5c-lists.js and p5c-sales.js, through tests/pages-engine.mjs) are
      loaded into PGlite as the database owner - every column, constraint and trigger of the real tables has to take
      them, so a demo row the real database would refuse stops the walk here (drift between the demo and M5c). The
      demo's people and jobs are mapped onto pglite-serve's made-up people and jobs; the price and cost rows (made by
      M5c's own triggers with each list row) get the demo's amounts; every picture a row points at gets its
      storage.objects row in the private bucket sales-media. Plus a closed and a completed job (the public form must
      never offer them).
   2. The public form's Edge Function: DCR Desktop 2's OWN supabase/functions/subform/handler.ts with its sql.ts
      statements, each in its own transaction as the service role with no JWT (the way index.ts runs them), Storage as
      the function has it (storage.objects rows; one token per signed upload, in the private bucket subform-inbox with
      its limits; "attached" copies the checked upload into project-files), the caller's Origin and address as the
      browser stand-in reports them (default: https://portal.dcrframing.com, as in production).
   Made-up data only; nothing is sent anywhere. */
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", txt: "text/plain", webm: "audio/webm",
  m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", pdf: "application/pdf", json: "application/json" };
const mimeOf = (p) => MIME[String(p).split(".").pop().toLowerCase()] || "application/octet-stream";
const DEMO_KEYS = { "admin@demo.test": "admin", "manager@demo.test": "manager", "accountant@demo.test": "accountant", "lead@demo.test": "lead",
  "field@demo.test": "field", "viewer@demo.test": "viewer", "approver@demo.test": "approver", "sales@demo.test": "sales" };
/* the list tables with their own id, in the order their references need; the money rows M5c's triggers make with them */
const LISTS = ["leads", "vehicles", "vehicle_maintenance", "marketing_tasks", "sales_reference_projects", "sales_estimates", "sales_materials"];
const MADE_WITH = { vehicle_maintenance_costs: "maintenance_id", marketing_task_prices: "task_id", sales_reference_prices: "reference_id",
  sales_estimate_prices: "estimate_id" };
const NEVER = new Set(["version", "updated_at", "updated_by"]);

/** Every object path a gallery entry (or a media blob) points at: {path}, {audioPath}, {txtPath}, nested cme / ann. */
function objectPaths(v, out) {
  if (Array.isArray(v)) { v.forEach((x) => objectPaths(x, out)); return out; }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && /path$/i.test(k) && /^(estimates|references|materials)\//.test(x)) out.add(x);
      else if (x && typeof x === "object") objectPaths(x, out);
    }
  }
  return out;
}

export async function setupP5c({ db, client, catalog, sql, one, asPerson, J, people, REPO, D2 }) {
  /* ── 1. the made-up rows ─────────────────────────────────────────────── */
  J.closed = await one("insert into public.projects (name, address, city, client_name, status) values ('Madeup Shed', '9 Example Road', 'Sandbox', 'Orrin Example', 'closed') returning id, number");
  J.completed = await one("insert into public.projects (name, address, city, client_name, status) values ('Madeup Pergola', '3 Sample Street', 'Sandbox', 'Parke Sample', 'completed') returning id, number");
  const H = await import(pathToFileURL(path.join(REPO, "tests", "pages-engine.mjs")).href);
  const engine = await H.freshEngine(new Date());
  const R = engine.rows;
  const emailOfDemo = Object.fromEntries(R.profiles.map((p) => [p.id, p.email]));
  const uid = (id) => { const k = DEMO_KEYS[emailOfDemo[id]]; return k && people[k] ? people[k].id : null; };
  const jobs = [J.p1.id, J.p2.id];
  const jobOf = new Map();
  const job = (id) => { if (id === null || id === undefined) return null; if (!jobOf.has(id)) jobOf.set(id, jobs[jobOf.size % jobs.length]); return jobOf.get(id); };
  const fix = {
    leads: (r) => Object.assign(r, { converted_project_id: job(r.converted_project_id), converted_by: uid(r.converted_by) }),
    marketing_tasks: (r) => Object.assign(r, { project_id: job(r.project_id) }),
    sales_reference_projects: (r) => Object.assign(r, { project_id: job(r.project_id) }),
    sales_estimates: (r) => Object.assign(r, { project_id: job(r.project_id) }),
  };
  const loaded = {};
  const columns = (t, r) => Object.keys(r).filter((k) => k in catalog.tables[t].cols && !NEVER.has(k) && r[k] !== undefined);
  for (const t of LISTS) {
    loaded[t] = 0;
    for (const r0 of R[t] || []) {
      const r = (fix[t] || ((x) => x))(Object.assign({}, r0, { created_by: uid(r0.created_by) }));
      const keys = columns(t, r);
      const list = keys.map((k) => '"' + k + '"').join(", ");
      try {
        await sql("insert into public." + t + " (" + list + ") overriding system value select " + list +
          " from jsonb_populate_record(null::public." + t + ", $1::jsonb)", [JSON.stringify(Object.fromEntries(keys.map((k) => [k, r[k]])))]);
      } catch (e) {
        throw new Error("drift: the demo's made-up " + t + " row " + r0.id + " is refused by the real table (M5c): " + e.code + " " + e.message);
      }
      loaded[t]++;
    }
    await sql("select setval(pg_get_serial_sequence('public." + t + "', 'id'), greatest((select max(id) from public." + t + "), 1))");
  }
  for (const [t, key] of Object.entries(MADE_WITH)) {
    loaded[t] = 0;
    for (const r0 of R[t] || []) {
      const r = Object.assign({}, r0);
      const keys = columns(t, r).filter((k) => k !== key && k !== "created_at" && k !== "created_by");
      if (!keys.length) continue;
      const list = keys.map((k) => '"' + k + '"').join(", ");
      const got = await sql("update public." + t + " set (" + list + ") = (select " + list + " from jsonb_populate_record(null::public." + t +
        ", $1::jsonb)) where " + key + " = $2 returning " + key, [JSON.stringify(Object.fromEntries(keys.map((k) => [k, r[k]]))), String(r0[key])]);
      if (got.length !== 1) throw new Error("drift: M5c made no " + t + " row for the demo's " + key + " " + r0[key] + " (the demo says it is made with its list row)");
      loaded[t]++;
    }
  }
  const objects = new Set();
  for (const t of ["sales_reference_projects", "sales_materials"]) for (const r of R[t] || []) objectPaths(r.pictures, objects);
  for (const r of R.sales_estimates || []) objectPaths(r.media, objects);
  for (const p of objects) {
    await sql("insert into storage.objects (bucket_id, name, metadata) values ('sales-media', $1, $2::jsonb) on conflict do nothing",
      [p, JSON.stringify({ mimetype: mimeOf(p), size: 24000 })]);
  }
  J.p5c = { loaded, objects: objects.size, leads: (R.leads || []).length, vehicles: (R.vehicles || []).length,
    draft: ((R.sales_estimates || []).find((e) => e.estimate_ref === "EST-DEMO2") || {}).id || null,
    sent: ((R.sales_estimates || []).find((e) => e.estimate_ref === "EST-DEMO1") || {}).id || null,
    t01: ((R.vehicles || []).find((v) => v.fleet_number === "T-01") || {}).id || null,
    spare: ((R.vehicles || []).find((v) => v.fleet_number === "TR-1") || {}).id || null };

  /* ── 2. the public form's function ───────────────────────────────────── */
  const FN = path.join(D2, "supabase", "functions", "subform");
  const fn = await import(pathToFileURL(path.join(FN, "handler.ts")).href);
  const S = await import(pathToFileURL(path.join(FN, "sql.ts")).href);
  /* index.ts's run(): one statement in its own transaction, `set local role service_role`, no JWT */
  const service = (statement, params) => client.run(async () => {
    await db.exec("begin");
    try {
      await db.exec(S.SERVICE_ROLE);
      const rows = (await db.query(statement, params || [])).rows;
      await db.exec("commit");
      return rows;
    } catch (e) { await db.exec("rollback"); throw e; }
  }, "owner");
  const owner = (text, params) => client.run(async () => (await db.query(text, params || [])).rows, "owner");
  const tokens = new Map();
  const putObject = (p, size, mime, bucket = "project-files") => owner("insert into storage.objects (bucket_id, name, metadata) values ($3, $1, $2::jsonb)",
    [p, JSON.stringify({ size, mimetype: mime }), bucket]);
  const deps = {
    rateHit: async (a, b, c, d) => (await service(S.SQL.rateHit, [a, b, String(c), String(d)]))[0].r,
    searchProjects: async (q) => {
      const r = (await service(S.SQL.searchProjects, [q]))[0].r;
      return { projects: (r.projects || []).map((x) => ({ id: Number(x.id), number: x.number ?? null, name: x.name ?? null, address: x.address ?? null, city: x.city ?? null })),
        more: Number(r.more || 0) };
    },
    openProject: async (id) => {
      const r = (await service(S.SQL.openProject, [String(id)]))[0];
      return r ? { id: Number(r.id), number: r.number ?? null, name: r.name ?? null, address: r.address ?? null, city: r.city ?? null } : null;
    },
    putObject: async (p, bytes, mime) => { await putObject(p, bytes.length, mime); },
    insertSubmission: async (row) => ({ id: Number((await service(S.SQL.insertSubmission, S.insertParams(row)))[0].id) }),
    signedUploadUrl: async (p) => { const t = "tok-" + crypto.randomBytes(8).toString("hex"); tokens.set(t, p); return { signedUrl: "/__pglite/upload/" + t, token: t, path: p }; },
    findSubmission: async (ref) => {
      const r = (await service(S.SQL.findSubmission, [ref]))[0];
      return r ? { id: Number(r.id), project_id: Number(r.project_id), kind: String(r.kind), state: String(r.state), document_path: r.document_path ?? null,
        document_name: r.document_name ?? null, document_attached_at: r.document_attached_at ?? null } : null;
    },
    objectInfo: async (p) => { const r = await service(S.SQL.objectInfo, [fn.INBOX, p]); return r.length ? { size: Number(r[0].size || 0), mime: String(r[0].mime || "") } : null; },
    copyToFiles: async (p) => (await owner(`insert into storage.objects (bucket_id, name, metadata) select 'project-files', o.name, o.metadata
        from storage.objects o where o.bucket_id = $1 and o.name = $2 on conflict do nothing returning name`, [fn.INBOX, p])).length ? "ok" : "exists",
    removeUpload: async (p) => { await owner("delete from storage.objects where bucket_id = $1 and name = $2", [fn.INBOX, p]); },
    removeObject: async (p) => { await owner("delete from storage.objects where bucket_id = 'project-files' and name = $1", [p]); },
    staleUploads: async (seconds, max) => (await service(S.SQL.staleUploads, [String(seconds), String(max)])).map((r) => ({ id: Number(r.id), path: String(r.path) })),
    clearUpload: async (id, p) => (await service(S.SQL.clearUpload, [String(id), p])).length > 0,
    markAttached: async (id, p, size, mime) => String((await service(S.SQL.markAttached, S.markParams(id, p, size, mime)))[0].result),
    uuid: () => crypto.randomUUID().replace(/-/g, ""),
    randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
    log: () => {},
  };
  /** One request to the function as a browser at `origin` from `ip` would send it -> {status, body, headers}. */
  async function call(body, o) {
    const opt = o || {};
    const headers = { "Content-Type": "application/json", "user-agent": "Mozilla/5.0 (made-up phone; PGlite walk)",
      "x-forwarded-for": opt.ip || "203.0.113.50" };
    if (opt.origin !== false) headers.Origin = opt.origin || fn.SITE;
    const res = await fn.handle(new Request("https://pglite.invalid/functions/v1/subform", { method: opt.method || "POST",
      body: opt.method === "OPTIONS" ? undefined : JSON.stringify(body || {}), headers }), deps);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
    const out = {};
    res.headers.forEach((v, k) => { if (/^(retry-after|access-control-allow-origin|vary)$/i.test(k)) out[k.toLowerCase()] = v; });
    return { status: res.status, body: json, headers: out };
  }
  return {
    fn, S, deps, call, tokens,
    /** pglite-serve's op "fn" (supabase-js functions.invoke from the page) */
    async subform(body) {
      return { data: null, error: null, status: 200, fn: await call(body.body, { ip: body.ip || undefined, origin: body.origin || undefined }) };
    },
    /** pglite-serve's op "signedUpload" (Storage's uploadToSignedUrl): only the path the function signed, once, in the
     *  inbox, within the bucket's own limits (M5c: file_size_limit, allowed_mime_types) */
    async signedUpload(body) {
      if ((body.bucket && body.bucket !== fn.INBOX) || !body.token || tokens.get(body.token) !== body.path) {
        return { data: null, error: { message: "invalid signature", statusCode: "400" }, status: 400 };
      }
      const b = (await owner("select file_size_limit, allowed_mime_types from storage.buckets where id = $1", [fn.INBOX]))[0] || {};
      const size = Number(body.size) || 0, mime = String(body.contentType || "application/octet-stream").toLowerCase().split(";")[0].trim();
      if (b.file_size_limit && size > Number(b.file_size_limit)) return { data: null, error: { message: "The object exceeded the maximum allowed size", statusCode: "413" }, status: 413 };
      if (Array.isArray(b.allowed_mime_types) && b.allowed_mime_types.indexOf(mime) === -1) {
        return { data: null, error: { message: "mime type " + mime + " is not supported", statusCode: "415" }, status: 415 };
      }
      tokens.delete(body.token);
      try { await putObject(String(body.path), size, mime, fn.INBOX); }
      catch (e) { return { data: null, error: { message: "The resource already exists", statusCode: "409" }, status: 409 }; }
      return { data: { path: body.path, fullPath: fn.INBOX + "/" + body.path }, error: null, status: 200 };
    },
  };
}
