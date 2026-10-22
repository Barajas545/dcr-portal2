#!/usr/bin/env node
/* DCR Portal 2 — the site over PGlite with every DCR Desktop 2 migration: PGLITE mode (development only, never
   deployed).

     PGLITE_DIR=<folder with node_modules/@electric-sql/pglite> node tools/pglite-serve.mjs [port]

   Serves site/ as GitHub Pages would and, in every HTML page, swaps the supabase-js <script> for
   tools/fake/pglite-client.js: a stand-in that records each call a page makes and sends it here, where it is
   replayed on tools/pglite-rest.mjs (the SQL the Data API would run, as the signed-in person) against PGlite loaded
   with DCR Desktop 2's REAL migrations (M5a and M5b included). Nothing is imitated: row level security, triggers,
   grants, RPC argument names and refusals are the database's. tools/e2e-p5b-pglite.mjs walks the P5b pages on it.

   Seeds made-up people for every role (sign in as <key>@e2e.test with the password pglite-<key>-2026: admin,
   approver - a manager with the approve and financials switches, no prices -, manager - no switches, as Q1 -,
   accountant, lead, field, viewer) and a made-up job with bills in every state of The Books, payments, invoices,
   costs with receipts linked by files.cost_id, and employees. Binds to 127.0.0.1 only; sends nothing anywhere.

   POST /__pglite/q {op, token, ...}   from (a recorded chain), rpc, signIn, updateUser, signedUrl(s), channel
   GET  /__pglite/obj/<bucket>/<path>  a made-up placeholder for a signed URL (a small picture, a one-page PDF) */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCatalog, makeClient } from "./pglite-rest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SITE = path.join(REPO, "site");
const D2 = path.resolve(process.env.DCR_DESKTOP2_DIR || path.join(REPO, "..", "DCR Desktop 2"));
const LIB = path.join(D2, "tools", "pglite_check", "lib.mjs");
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".txt": "text/plain; charset=utf-8", ".map": "application/json", ".pdf": "application/pdf",
};
const SUPABASE_TAG = /<script\b[^>]*\bsrc=["'][^"']*@supabase\/supabase-js@[^"']*["'][^>]*>\s*<\/script>\s*/gi;
const CLIENT_TAG = '<script src="/__pglite/client.js"></script>\n';

/** The page as served in PGlite mode: the stand-in before the first script, the real library out. */
export function injectPglite(html) {
  const out = String(html).replace(SUPABASE_TAG, "");
  const at = out.search(/<script\b/i);
  const head = out.search(/<\/head>/i);
  const pos = at !== -1 && (head === -1 || at < head) ? at : head;
  return pos === -1 ? CLIENT_TAG + out : out.slice(0, pos) + CLIENT_TAG + out.slice(pos);
}

/* made-up people: <key>@e2e.test, password pglite-<key>-2026 */
export const PEOPLE = {
  admin: { id: "e5b00000-0000-4000-8000-000000000001", name: "Ada Admin", role: "admin" },
  approver: { id: "e5b00000-0000-4000-8000-000000000002", name: "Abe Approver", role: "manager", prices: false, financials: true, approve: true },
  manager: { id: "e5b00000-0000-4000-8000-000000000003", name: "Max Manager", role: "manager" },
  accountant: { id: "e5b00000-0000-4000-8000-000000000004", name: "Ace Accountant", role: "accountant" },
  lead: { id: "e5b00000-0000-4000-8000-000000000005", name: "Lee Lead", role: "lead" },
  field: { id: "e5b00000-0000-4000-8000-000000000006", name: "Flo Field", role: "field" },
  viewer: { id: "e5b00000-0000-4000-8000-000000000007", name: "Vi Viewer", role: "viewer" },
};
export const emailOf = (k) => k + "@e2e.test";
export const passwordOf = (k) => "pglite-" + k + "-2026";

/* a tiny made-up picture (a 64x40 PNG, two grey bands) and a one-page PDF, for every signed URL */
function png() {
  const W = 64, H = 40;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (W * 3 + 1) + 1 + x * 3;
      const v = y < 14 ? 214 : y < 16 ? 120 : 244;
      raw[o] = v; raw[o + 1] = v; raw[o + 2] = y < 14 ? 200 : v;
    }
  }
  const zlib = globalThis.__zlib;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj " +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 120]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

/**
 * startPgliteServer({port}) -> {server, base, sql (as the database owner), J (the made-up job's ids), calls, close()}.
 * calls: every request answered, [{uid, op, table | name}] - who asked for what.
 */
export async function startPgliteServer(opts) {
  const o = opts || {};
  if (!existsSync(LIB)) throw new Error("DCR Desktop 2 not found at " + D2 + " (set DCR_DESKTOP2_DIR)");
  globalThis.__zlib = await import("node:zlib");
  const { freshDatabase } = await import(pathToFileURL(LIB).href);
  const { db } = await freshDatabase();
  const catalog = await loadCatalog(db);
  const passwords = Object.fromEntries(Object.keys(PEOPLE).map((k) => [emailOf(k), passwordOf(k)]));
  const client = makeClient({ db, catalog, passwords });
  /** SQL as the database owner, in turn with the pages' calls (PGlite has one connection) */
  const sql = (text, params) => client.run(async () => (await db.query(text, params || [])).rows, "owner");
  const one = async (text, params) => (await sql(text, params))[0];
  const asPerson = (uid, text, params) => client.run(async () => (await db.query(text, params || [])).rows, uid);
  const J = await seed({ sql, one, asPerson });
  const PICTURE = png();

  const calls = [];
  let lock = Promise.resolve();
  const serial = (fn) => { const p = lock.then(fn); lock = p.catch(() => {}); return p; };
  const uidOf = (token) => (/^pglite-[0-9a-f-]{36}$/.test(String(token || "")) ? String(token).slice(7) : null);
  const objUrl = (bucket, p) => "/__pglite/obj/" + encodeURIComponent(bucket) + "/" + p.split("/").map(encodeURIComponent).join("/") + "?sig=made-up";

  /** One call, as the person whose token it carries; noted in `calls` with what it answered (rows, refusal). */
  async function answer(body) {
    const uid = uidOf(body.token);
    const rec = { uid, op: body.op, table: body.table || body.name || body.topic || null };
    calls.push(rec);
    client.as(uid);
    const out = await reply(body, uid);
    rec.rows = out && Array.isArray(out.data) ? out.data.length : out && out.data ? 1 : 0;
    rec.error = (out && out.error && out.error.code) || null;
    return out;
  }
  async function reply(body, uid) {
    switch (body.op) {
      case "from": {
        let b = client.from(String(body.table));
        for (const [m, args] of body.chain || []) {
          if (["then", "exec", "sql", "constructor"].includes(m) || typeof b[m] !== "function") {
            return { data: null, error: { code: "PGRST100", message: "not simulated in PGlite mode: ." + m + "()" }, status: 400 };
          }
          b = b[m](...(args || []));
        }
        return await b;
      }
      case "rpc": return await client.rpc(String(body.name), body.args || {});
      case "signIn": {
        const email = String(body.email || "").trim().toLowerCase();
        const want = passwords[email];
        const rows = want && want === body.password ? await sql("select u.id from auth.users u where lower(u.email) = $1", [email]) : [];
        if (!rows.length) return { data: null, error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 }, status: 400 };
        const id = rows[0].id;
        return { data: { session: { access_token: "pglite-" + id, token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400,
          refresh_token: "pglite-refresh-" + id, user: { id, email, aud: "authenticated", role: "authenticated" } } }, error: null, status: 200 };
      }
      case "updateUser": {
        if (!uid) return { data: null, error: { code: "session_missing", message: "Auth session missing!", status: 400 }, status: 400 };
        if (body.attrs && body.attrs.password) {
          const r = await sql("select email from auth.users where id = $1", [uid]);
          passwords[String(r[0].email).toLowerCase()] = String(body.attrs.password);
        }
        return { data: { ok: true }, error: null, status: 200 };
      }
      case "signedUrl": {
        const r = await client.storage.from(String(body.bucket)).createSignedUrl(String(body.path), body.seconds);
        return r.error ? { data: null, error: r.error, status: 400 } : { data: { signedUrl: objUrl(body.bucket, String(body.path)) }, error: null, status: 200 };
      }
      case "signedUrls": {
        const r = await client.storage.from(String(body.bucket)).createSignedUrls(body.paths || [], body.seconds);
        return { data: (r.data || []).map((x) => Object.assign({}, x, { signedUrl: x.signedUrl ? objUrl(body.bucket, x.path) : null })), error: null, status: 200 };
      }
      case "channel": {
        const ch = client.channel(String(body.topic), { config: { private: !!body.private } });
        const status = await new Promise((res) => ch.subscribe((s) => res(s)));
        client.channels.delete(ch);
        return { data: { status }, error: null, status: 200 };
      }
      default: return { data: null, error: { code: "PGRST100", message: "unknown op " + body.op }, status: 400 };
    }
  }

  const server = createServer(async (req, res) => {
    const send = (status, body, type, extra) => {
      res.writeHead(status, Object.assign({ "content-type": type || "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }, extra || {}));
      res.end(body);
    };
    try {
      const url = new URL(req.url, "http://" + HOST);
      let p = decodeURIComponent(url.pathname);
      if (p === "/__pglite/q" && req.method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const out = await serial(() => answer(body)).catch((e) => ({ data: null, error: { code: String(e.code || "XX000"), message: String(e.message || e) }, status: 500 }));
        return send(200, JSON.stringify(out), TYPES[".json"]);
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(405, "GET only");
      if (p === "/__pglite/client.js") return send(200, await readFile(path.join(HERE, "fake", "pglite-client.js"), "utf8"), TYPES[".js"]);
      if (p.startsWith("/__pglite/obj/")) {
        return /\.pdf$/i.test(p) ? send(200, PDF, TYPES[".pdf"]) : send(200, PICTURE, TYPES[".png"]);
      }
      if (p === "/__dev/health") return send(200, JSON.stringify({ ok: true, pglite: true }), TYPES[".json"]);
      if (p.endsWith("/")) p += "index.html";
      const file = path.normalize(path.join(SITE, p));
      if (file !== SITE && !file.startsWith(SITE + path.sep)) return send(403, "outside the site");
      let st;
      try { st = await stat(file); } catch (e) { return send(404, "Not found: " + p); }
      if (st.isDirectory()) return send(302, "", "text/plain", { location: p.replace(/\/?$/, "/") });
      const ext = path.extname(file).toLowerCase();
      let body = await readFile(file);
      if (ext === ".html") body = injectPglite(body.toString("utf8"));
      return send(200, req.method === "HEAD" ? "" : body, TYPES[ext] || "application/octet-stream", p === "/sw.js" ? { "service-worker-allowed": "/" } : {});
    } catch (e) {
      return send(500, "pglite-serve: " + (e && e.message));
    }
  });
  await new Promise((r) => server.listen(o.port || 0, HOST, r));
  const base = "http://" + HOST + ":" + server.address().port;
  const close = async () => {
    server.closeAllConnections && server.closeAllConnections();
    await new Promise((r) => server.close(() => r()));
    await lock.catch(() => {});
    try { await db.close(); } catch (e) { /* already closed */ }
  };
  return { server, base, sql, one, asPerson, J, calls, client, catalog, close };
}

/* ── the made-up job ─────────────────────────────────────────────────── */
async function seed({ sql, one, asPerson }) {
  for (const [k, p] of Object.entries(PEOPLE)) await sql("insert into auth.users (id, email) values ($1, $2)", [p.id, emailOf(k)]);
  await sql("insert into public.profiles (id, full_name, email, role) values ($1, $2, $3, 'admin')", [PEOPLE.admin.id, PEOPLE.admin.name, emailOf("admin")]);
  for (const [k, p] of Object.entries(PEOPLE)) {
    if (k === "admin") continue;
    await asPerson(PEOPLE.admin.id, `insert into public.profiles (id, full_name, email, role, can_see_prices, can_see_financials, can_approve_payments)
      values ($1, $2, $3, $4, $5, $6, $7)`, [p.id, p.name, emailOf(k), p.role, p.prices === undefined ? null : p.prices,
      p.financials === undefined ? null : p.financials, p.approve === undefined ? null : p.approve]);
  }
  const today = (await one("select app.today()::text as d")).d;
  const ago = (n) => { const [y, m, d] = today.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); };
  const J = { today, people: Object.fromEntries(Object.entries(PEOPLE).map(([k, p]) => [k, p.id])) };
  J.p1 = await one("insert into public.projects (name, address, city, client_name, status) values ('Madeup Garage', '12 Example Lane', 'Sandbox', 'Pat Example', 'in_progress') returning id, number");
  J.p2 = await one("insert into public.projects (name, address, city, client_name, status) values ('Madeup Porch', '40 Sample Road', 'Sandbox', 'Sam Sample', 'in_progress') returning id, number");
  J.est = (await one("insert into public.estimates (project_id, name, status) values ($1, 'Garage framing', 'approved') returning id", [J.p1.id])).id;
  J.item = (await one("insert into public.estimate_items (estimate_id, name, group_name) values ($1, 'Rafters', 'Roof') returning id", [J.est])).id;
  J.emp = (await one("insert into public.employees (full_name, employee_no) values ('Quill Ledgerton', 'E-9101') returning id")).id;
  J.emp2 = (await one("insert into public.employees (full_name, employee_no) values ('Wren Tallymark', 'E-9102') returning id")).id;
  await sql("insert into public.employees (full_name, employee_no, profile_id) values ('Flo Field', 'E-9103', $1)", [PEOPLE.field.id]);
  J.vendor = (await one("insert into public.contacts (name, company, kind, email, phone) values ('Rory Madeup', 'Madeup Framing LLC', 'subcontractor', 'rory@example.com', '(805) 555-0199') returning id")).id;
  J.yard = (await one("insert into public.contacts (name, company, kind, email) values ('Lou Yard', 'Madeup Lumber Supply', 'supplier', 'yard@example.com') returning id")).id;

  let n = 0;
  const file = async (project, name, mime, extra) => {
    n++;
    const key = "f/" + project + "/receipts/" + (0x5b000 + n).toString(16).padStart(32, "0") + "/" + name;
    await sql("insert into storage.objects (bucket_id, name, metadata) values ('project-files', $1, $2::jsonb)", [key, JSON.stringify({ mimetype: mime, size: 1000 })]);
    const e = extra || {};
    const text = `insert into public.files (project_id, folder, name, storage_path, mime, size, cost_id) values ($1, 'receipts', $2, $3, $4, 1000, $5) returning id`;
    const args = [project, name, key, mime, e.cost || null];
    // a cost's receipt goes in the way DCR Desktop 2 2.19's "Attach receipt..." puts it: the accountant's own insert
    // (the Data API's way - the files policies, t13_files_cost and the version chain per cost), never the owner's
    if (e.cost) return (await asPerson(PEOPLE.accountant.id, text, args))[0].id;
    return (await one(text, args)).id;
  };
  const bill = async (f) => (await one(`insert into public.bills (project_id, vendor_contact_id, vendor_name, invoice_number, invoice_date, amount, due_date, description, document_file_id, kind)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [f.project || J.p1.id, f.vendor || null, f.name, f.no, f.date || ago(12), f.amount, f.due || ago(-10), f.description || null, f.doc || null, f.kind || null])).id;
  const approve = (id, method, by) => sql("update public.bills set approved_by = $2, approved_at = now(), approved_amount = amount, pay_method = $3 where id = $1",
    [id, by || PEOPLE.admin.id, method]);

  J.waiting = await bill({ vendor: J.vendor, name: "Madeup Framing LLC", no: "S-1", amount: 3850, doc: await file(J.p1.id, "framing invoice S-1.pdf", "application/pdf"),
    kind: "Subcontractor", description: "Footings and stem wall, phase 1", due: ago(3) });
  J.nodoc = await bill({ vendor: J.yard, name: "Madeup Lumber Supply", no: "S-2", amount: 1264.18, kind: "Material supplier", description: "Roof framing package (back order)" });
  J.ready = await bill({ vendor: J.vendor, name: "Madeup Framing LLC", no: "S-3", amount: 2400, doc: await file(J.p1.id, "retainage S-3.png", "image/png"),
    kind: "Subcontractor", description: "-10% retainage held until the final walk" });
  await approve(J.ready, "check");
  J.either = await bill({ name: "Madeup Equipment Rental", no: "S-4", amount: 1200, doc: await file(J.p1.id, "rental S-4.pdf", "application/pdf"),
    kind: "Equipment", description: "Telehandler, one week" });
  await approve(J.either, "both");
  await sql("insert into public.payments (bill_id, amount, method, reference, payee, memo) values ($1, 400, 'cash', 'slip 18', 'Madeup Equipment Rental', 'deposit')", [J.either]);
  J.entered = await bill({ vendor: J.yard, name: "Madeup Lumber Supply", no: "S-5", amount: 812.4, doc: await file(J.p1.id, "lumber S-5.pdf", "application/pdf"),
    kind: "Material supplier", description: "Garage door header and hardware" });
  await approve(J.entered, "check");
  await sql("update public.bills set qbo_entered_at = now(), qbo_entered_by = $2, qbo_ref = 'QB-77' where id = $1", [J.entered, PEOPLE.accountant.id]);
  J.second = await bill({ vendor: J.vendor, name: "Madeup Framing LLC", no: "S-6", amount: 680, doc: await file(J.p1.id, "slab patch S-6.pdf", "application/pdf"),
    kind: "Subcontractor", description: "Slab patch at the roll-up door" });
  J.victim = await bill({ name: "Madeup Concrete Pumping", no: "S-7", amount: 950, doc: await file(J.p1.id, "pump S-7.pdf", "application/pdf"),
    kind: "Subcontractor", description: "Concrete pump, half day" });
  await approve(J.victim, "cash");
  J.porch = await bill({ project: J.p2.id, vendor: J.vendor, name: "Madeup Framing LLC", no: "P-1", amount: 2950, doc: await file(J.p2.id, "porch P-1.pdf", "application/pdf"),
    kind: "Subcontractor", description: "Porch footings" });

  J.inv = (await one("insert into public.invoices (project_id, status, sent_date, invoice_date, due_date) values ($1, 'sent', $2, $2, $3) returning id", [J.p1.id, ago(5), ago(-25)])).id;
  await sql("insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Garage framing, first draw', 1, 8400)", [J.inv]);
  await sql("insert into public.client_payments (invoice_id, amount, method) values ($1, 1000, 'check')", [J.inv]);
  // a draft past its due day: never "Overdue", never invoiced (DCR Desktop 2's Invoices tab - the Payments tab says the same)
  J.draft = (await one("insert into public.invoices (project_id, status, due_date) values ($1, 'draft', $2) returning id", [J.p1.id, ago(10)])).id;
  await sql("insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Option: loft', 1, 900)", [J.draft]);

  const cost = async (f) => (await one(`insert into public.costs (project_id, estimate_item_id, cost_date, kind, description, vendor, amount, hours, rate)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [f.project || J.p1.id, f.item || null, f.date || ago(2), f.kind, f.description || null, f.vendor || null, f.amount === undefined ? null : f.amount, f.hours || null, f.rate || null])).id;
  J.mat = await cost({ kind: "material", description: "Rafter lumber", vendor: "Madeup Lumber Supply", amount: 512.4, item: J.item });
  J.lab = await cost({ kind: "labor", description: "Quill - cut rafters", hours: 4, rate: 50, date: ago(1) });
  J.sub = await cost({ kind: "subcontractor", description: "Roofer, half day", vendor: "Madeup Roofing", amount: 900, date: ago(3) });
  J.eq = await cost({ kind: "equipment", description: "Lift rental", amount: 120, date: ago(4) });
  J.credit = await cost({ kind: "material", description: "Returned blocks", amount: -40.5, date: ago(4) });
  J.formula = await cost({ kind: "material", description: "=2x6 studs, 40 more for the north wall", vendor: "Madeup Lumber Supply", amount: 311.6, date: ago(6) });
  J.porchCost = await cost({ project: J.p2.id, kind: "material", description: "Porch decking", vendor: "Madeup Lumber Supply", amount: 640, date: ago(8) });
  J.r1 = await file(J.p1.id, "yard receipt.png", "image/png", { cost: J.mat });
  J.r2 = await file(J.p1.id, "roofer invoice.pdf", "application/pdf", { cost: J.sub });
  J.r3 = await file(J.p1.id, "yard receipt 2.png", "image/png", { cost: J.mat });
  return J;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startPgliteServer({ port: Number(process.argv[2] || process.env.PORT || 8793) });
  console.log("DCR Portal 2 over PGlite (made-up data, every DCR Desktop 2 migration) at " + s.base + "/  - sign in as <role>@e2e.test / pglite-<role>-2026");
}
