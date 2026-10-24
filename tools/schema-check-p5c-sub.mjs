/* DCR Portal 2 — the subcontractor form and its review against the REAL database rules (development only): P5c's
   sub-form part of tools/schema-check.mjs (it calls run() with its own helpers). Portal 2's own site/js/repo/subform.js
   (the public page's module) runs through DCR Desktop 2's OWN Edge Function logic (supabase/functions/subform/handler.ts
   with its sql.ts statements run as the service role with no JWT, the way index.ts runs them), and site/js/repo/
   submissions.js (the review page's module) runs over PGlite loaded with every DCR Desktop 2 migration, M5c
   20261027000100_office_lists.sql included, as each role:

   * P5 acceptance check 4, signed out: only OPEN projects' id, number, name, address and city come back (3 characters at
     least, 8 at most; the client searched, never returned); every problem at once; the honeypot; the amount limits; a
     project that is not open; the signature and the document under f/{project}/receipts/ - a money editor reads them
     (app.storage_can_read), a lead, a field account and a manager without financials do not; "attached" once and only
     while pending; then accept files a bill that is NOT approved, with the paperwork as its document, and a second accept
     says "already done"; the rate limit (429);
   * the review page's names exist (SUB_COLS, the RPCs' arguments) and the queue is the money editors' only (admin,
     accountant; a manager - with or without prices -, a lead, field, view-only: refused before anything is asked, and the
     database answers them no row anyway); reject with a note; a change order -> an awarded change order with its amount
     under quote_prices; a stale version PT409; accept by a manager without financials 42501;
   * the notices: kind sub_submission to the admins and accountants (amount-free);
   * P5 check 5: no activity row and no outbox body written by any of this carries an amount;
   * drift: the demo database (tools/fake/p5c-sub.js) has exactly sub_submissions' columns and the RPCs' arguments.
   Made-up people and jobs only. */
import crypto from "node:crypto";
import zlib from "node:zlib";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE, D2 } = h;
  const FN = path.join(D2 || path.join(SITE, "..", "..", "DCR Desktop 2"), "supabase", "functions", "subform");
  const HAS = !!(catalog.tables.sub_submissions && catalog.functions.accept_submission && catalog.functions.subform_projects &&
    existsSync(path.join(FN, "handler.ts")) && existsSync(path.join(FN, "sql.ts")));
  if (!HAS) {
    // only while M5c and the function are not written yet: once either is in DCR Desktop 2, a missing piece is drift, never a pass
    const m5c = path.join(D2 || path.join(SITE, "..", "..", "DCR Desktop 2"), "supabase", "migrations", "20261027000100_office_lists.sql");
    const written = existsSync(m5c) || existsSync(path.join(FN, "handler.ts"));
    results.push({ section, name: written ? "M5c (20261027000100_office_lists) or the subform function is in DCR Desktop 2, but a piece is missing (the tables, the RPCs, handler.ts or sql.ts)"
      : "M5c (20261027000100_office_lists) or the subform function is not in DCR Desktop 2 yet: the sub-form checks wait for them", ok: !written });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const fn = await import(pathToFileURL(path.join(FN, "handler.ts")).href);
  const S = await import(pathToFileURL(path.join(FN, "sql.ts")).href);
  const subform = await site("repo/subform.js");
  const subs = await site("repo/submissions.js");
  const M = await site("map/submissions.js");
  const sbm = await site("sb.js");
  const me = async () => sbm.me({ fresh: true });

  /* index.ts's run(): its own transaction, `set local role service_role`, no JWT */
  const db = { exec: (t) => sql(t) };
  const service = (statement, params) => client.run(async () => {
    await sql("begin");
    try {
      await sql(S.SERVICE_ROLE);
      const rows = await sql(statement, params);
      await sql("commit");
      return rows;
    } catch (e) { await sql("rollback"); throw e; }
  }, "owner");
  /* Storage as the function has it (the service role): storage.objects rows; one token per signed upload, in the private
     inbox (M5c's subform-inbox, with its limits); "attached" copies the checked upload into project-files */
  const tokens = new Map();
  const putObject = (p, size, mime, bucket = "project-files") => client.run(() => sql(`insert into storage.objects (bucket_id, name, metadata) values ($3, $1, $2::jsonb)`,
    [p, JSON.stringify({ size, mimetype: mime }), bucket]), "owner");
  let ip = "203.0.113.90", uuidN = 0;
  const deps = {
    rateHit: async (a, b, c, d) => (await service(S.SQL.rateHit, [a, b, String(c), String(d)]))[0].r,
    searchProjects: async (q) => (await service(S.SQL.searchProjects, [q]))[0].r,
    openProject: async (id) => { const r = await service(S.SQL.openProject, [String(id)]); return r[0] || null; },
    putObject: async (p, bytes, mime) => putObject(p, bytes.length, mime),
    insertSubmission: async (row) => ({ id: (await service(S.SQL.insertSubmission, S.insertParams(row)))[0].id }),
    signedUploadUrl: async (p) => { const t = "tok-" + crypto.randomBytes(6).toString("hex"); tokens.set(t, p); return { signedUrl: "pglite://upload/" + t, token: t, path: p }; },
    findSubmission: async (ref) => (await service(S.SQL.findSubmission, [ref]))[0] || null,
    objectInfo: async (p) => { const r = await service(S.SQL.objectInfo, [fn.INBOX, p]); return r.length ? { size: Number(r[0].size), mime: r[0].mime } : null; },
    copyToFiles: async (p) => ((await client.run(() => sql(`insert into storage.objects (bucket_id, name, metadata) select 'project-files', o.name, o.metadata
        from storage.objects o where o.bucket_id = $1 and o.name = $2 on conflict do nothing returning name`, [fn.INBOX, p]), "owner")).length ? "ok" : "exists"),
    removeUpload: (p) => client.run(() => sql("delete from storage.objects where bucket_id = $1 and name = $2", [fn.INBOX, p]), "owner"),
    removeObject: (p) => client.run(() => sql("delete from storage.objects where bucket_id = 'project-files' and name = $1", [p]), "owner"),
    staleUploads: async (seconds, max) => (await service(S.SQL.staleUploads, [String(seconds), String(max)])).map((r) => ({ id: r.id, path: r.path })),
    clearUpload: async (id, p) => (await service(S.SQL.clearUpload, [String(id), p])).length > 0,
    markAttached: async (id, p, size, mime) => (await service(S.SQL.markAttached, S.markParams(id, p, size, mime)))[0].result,
    uuid: () => crypto.createHash("md5").update("p5c-sub-" + (++uuidN)).digest("hex"),
    randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
  };
  /* supabase-js as the public page has it: no session at all; functions.invoke -> the real handler; the one signed upload */
  subform.useSubformClient({
    functions: { invoke: async (name, o) => {
      if (name !== "subform") return { data: null, error: { context: new Response("{}", { status: 404 }) } };
      const res = await fn.handle(new Request("https://pglite.invalid/functions/v1/subform", { method: "POST", body: JSON.stringify((o && o.body) || {}),
        headers: { "Content-Type": "application/json", Origin: "https://portal.dcrframing.com", "cf-connecting-ip": ip, "user-agent": "Mozilla/5.0 (iPhone)" } }), deps);
      if (res.ok) return { data: await res.json(), error: null };
      return { data: null, error: { name: "FunctionsHttpError", context: res } };
    } },
    storage: { from: (bucket) => ({ uploadToSignedUrl: async (p, token, blob, o) => {
      if (bucket !== fn.INBOX || tokens.get(token) !== p) return { data: null, error: { message: "invalid signature", statusCode: "400" } };
      tokens.delete(token);
      try { await putObject(p, blob.size, (o && o.contentType) || blob.type, fn.INBOX); return { data: { path: p }, error: null }; }
      catch (e) { return { data: null, error: { message: "The resource already exists", statusCode: "409" } }; }
    } }) },
  });
  const png = () => {
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : 0);
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", Buffer.alloc(400, 7)), chunk("IEND", Buffer.alloc(0))]);
  };
  const SIG = "data:image/png;base64," + png().toString("base64");

  /* ── made-up jobs: an open one with a client, a closed one, one completed ── */
  await sql("reset role");
  const job = async (name, street, client, status) => {
    const r = await one("insert into public.projects (name, address, city, client_name, status) values ($1, $2, 'Sandbox', $3, $4) returning id, number", [name, street, client, status]);
    return { id: Number(r.id), number: r.number };
  };
  const J = {
    open: await job("Subform Schema Deck", "12 Madeup Ln", "Quillon Family", "in_progress"),
    closed: await job("Subform Schema Shed", "9 Madeup Rd", "Orrin Family", "closed"),
    done: await job("Subform Schema Porch", "3 Madeup St", "Parke Family", "completed"),
  };
  const counts = async () => one(`select (select coalesce(max(id), 0) from public.activity)::int as act, (select coalesce(max(id), 0) from public.notifications_outbox)::int as outbox`);
  const before = await counts();
  const payload = (extra) => Object.assign({ kind: "Invoice", projectId: String(J.open.id), vendorCompany: "Madeup Glass", contactName: "Mo Deup",
    email: "mo@madeup-glass.example", phone: "", invoiceNumber: "G-7", amount: "2,345.67", description: "Shower glass, fitted.", invoiceDate: "", dueDate: "",
    signatureName: "Mo Deup", signature: SIG, agree: true, website: "", document: { type: "application/pdf", size: 3000 } }, extra || {});

  await check("P5c sub form: the names the pages use - sub_submissions' columns (SUB_COLS), the RPCs' arguments, the function's statements", async () => {
    for (const c of subs.SUB_COLS.split(",").map((x) => x.trim())) ok(catalog.tables.sub_submissions.cols[c], "sub_submissions." + c);
    const args = (f) => (catalog.functions[f] || []).map((x) => x.args.map((a) => a.name));
    same(args("accept_submission"), [["p_id", "p_version", "p_quote_id"]], "accept_submission");
    same(args("reject_submission"), [["p_id", "p_version", "p_note"]], "reject_submission");
    same(args("sub_submission_notices"), [["p_ids"]], "sub_submission_notices");
    for (const c of S.INSERT_COLUMNS) ok(catalog.tables.sub_submissions.cols[c], "the function inserts sub_submissions." + c);
  });

  let ref = null, up = null;
  await check("P5c sub form: acceptance check 4 signed out - open projects only, the five fields, the limits, the honeypot, the paperwork under f/ once", async () => {
    await as(null);
    const found = await subform.searchProjects(J.open.number);
    same(found.projects.map((p) => p.id), [J.open.id], "the open job by its number");
    same(Object.keys(found.projects[0]).sort(), ["address", "city", "id", "name", "number"], "the five public fields");
    same((await subform.searchProjects("Quillon")).projects.map((p) => p.id), [J.open.id], "the client's name finds it");
    ok(!JSON.stringify(await subform.searchProjects("Quillon")).includes("Quillon"), "the client is never returned");
    same((await subform.searchProjects(J.closed.number)).projects, [], "a closed job is not offered");
    same((await subform.searchProjects(J.done.number)).projects, [], "a completed job is not offered");
    same((await subform.searchProjects("Su")).projects, [], "fewer than 3 characters");
    const many = await refused(() => subform.submit({ kind: "", projectId: "", amount: "x" }), "invalid", "every problem");
    ok(many.errors.length >= 7, "every problem at once: " + many.errors.length);
    same((await refused(() => subform.submit(payload({ website: "x" })), "invalid", "honeypot")).errors, ["That submission could not be accepted."], "the honeypot");
    for (const amount of ["0", "5000000.01"]) await refused(() => subform.submit(payload({ amount })), "invalid", "amount " + amount);
    ok(/not open/.test((await refused(() => subform.submit(payload({ projectId: String(J.closed.id) })), "invalid", "closed")).message), "a closed job");
    same((await one("select count(*)::int as n from public.sub_submissions")).n, 0, "nothing stored for a refused try");
    const out = await subform.submit(payload());
    ref = out.reference; up = out.upload;
    ok(new RegExp("^f/" + J.open.id + "/receipts/[0-9a-f]{32}/SUB INVOICE " + ref + "\\.pdf$").test(up.path), "the upload path: " + up.path);
    ok(await subform.sendDocument(ref, up, new Blob([Buffer.alloc(3000, 1)], { type: "application/pdf" }), "application/pdf"), "uploaded and attached");
    const r = await one("select state, amount::text as amount, signature_path, document_path, document_attached_at is not null as attached, submitted_ip from public.sub_submissions where reference = $1", [ref]);
    same([r.state, r.amount, r.document_path, r.attached, r.submitted_ip], ["pending", "2345.67", up.path, true, "203.0.113.90"], "a pending submission with its paperwork");
    ok(new RegExp("^f/" + J.open.id + "/receipts/[0-9a-f]{32}/SUB INVOICE " + ref + " signature\\.png$").test(r.signature_path), "the signature under f/");
    const again = await refused(() => subform.call({ op: "attached", reference: ref, path: up.path }), "invalid", "attached twice");
    same(again.message, "A document is already attached to that submission.", "attached only once");
    same((await one("select count(*)::int as n from public.bills where description like $1", ["%" + ref + "%"])).n, 0, "never a bill by itself");
  });

  await check("P5c sub form: who reads the paperwork under f/ - the money editors (M5c's app.storage_can_read), nobody else", async () => {
    const paths = [up.path, (await one("select signature_path from public.sub_submissions where reference = $1", [ref])).signature_path];
    for (const k of ["admin", "accountant"]) {
      await as(k);
      for (const p of paths) ok((await client.storage.from("project-files").createSignedUrl(p, 120)).data, k + " reads " + p);
    }
    for (const k of ["manager", "manager2", "lead", "field", "viewer"]) {
      await as(k);
      for (const p of paths) ok(!(await client.storage.from("project-files").createSignedUrl(p, 120)).data, k + " reads nothing");
    }
    await as(null);
    for (const p of paths) ok(!(await client.storage.from("project-files").createSignedUrl(p, 120)).data, "signed out: nothing");
  });

  await check("P5c sub form: the anonymous upload sits in the private inbox (M5c's subform-inbox) - nobody, not even an admin, opens it there or under its project-files name until 'attached' copies it; the review queue reads what became of each e-mail (rpc sub_submission_notices) - the money editors only", async () => {
    await as(null);
    ip = "203.0.113.93";
    const out = await subform.submit(payload({ document: { type: "application/pdf", size: 2000 } }));
    same(out.upload.bucket, fn.INBOX, "the upload names the inbox");
    tokens.delete(out.upload.token);
    await putObject(out.upload.path, 2000, "application/pdf", fn.INBOX);        // the browser's upload to the signed URL
    await as("admin");
    ok(!(await client.storage.from("project-files").createSignedUrl(out.upload.path, 120)).data, "before 'attached': not even an admin opens it");
    ok(!(await client.storage.from(fn.INBOX).createSignedUrl(out.upload.path, 120)).data, "and the inbox is nobody's");
    await as(null);
    same(await subform.call({ op: "attached", reference: out.reference, path: out.upload.path }), { ok: true }, "attached");
    await as("admin");
    ok((await client.storage.from("project-files").createSignedUrl(out.upload.path, 120)).data, "copied: now a money editor opens it");
    same((await one("select count(*)::int as n from storage.objects where bucket_id = $1", [fn.INBOX])).n, 0, "the inbox emptied");
    const id = Number((await one("select id from public.sub_submissions where reference = $1", [out.reference])).id);
    const r = await client.rpc("sub_submission_notices", { p_ids: [id] });
    same([r.error, (r.data || []).map((x) => x.state)], [null, ["waiting"]], "its e-mail waits for DCR Agents 2");
    const d = await subs.list(await me());
    same(d.all.find((x) => x.reference === out.reference).notice, null, "just in: the card says nothing yet");
    for (const k of ["manager", "lead"]) {
      await as(k);
      same(((await client.rpc("sub_submission_notices", { p_ids: [id] })).error || {}).code, "42501", k + " is refused");
    }
    await as(null);
  });

  await check("P5c sub form: the review queue is the money editors' (repo/submissions.js); nothing is asked for anyone else", async () => {
    for (const k of ["admin", "accountant"]) {
      await as(k);
      const d = await subs.list(await me());
      ok(d.all.some((s) => s.reference === ref && s.hasDocument && s.canAccept && s.amount === 2345.67), k + " sees the submission");
      same(await subs.pendingCount(await me()), d.counts.pending, k + ": the badge");
    }
    for (const k of ["manager", "manager2", "lead", "field", "viewer"]) {
      await as(k);
      await refused(async () => subs.list(await me()), "42501", k);
      same(await subs.pendingCount(await me()), null, k + ": no badge, nothing asked");
      same(((await client.from("sub_submissions").select("id")).data || []).length, 0, k + ": the database answers no row");
    }
  });

  await check("P5c sub form: accept is NOT approve (a bill waiting for approval with the paperwork); a second accept is 'already done'; PT409; 42501 without financials", async () => {
    await as("manager");
    const raw = await client.rpc("accept_submission", { p_id: 1, p_version: 1, p_quote_id: null });
    same(raw.error && raw.error.code, "42501", "a manager without financials");
    await as("accountant");
    let d = await subs.list(await me());
    const s = d.all.find((x) => x.reference === ref);
    await refused(() => subs.accept(Object.assign({}, s, { version: s.version + 3 }), null), "PT409", "a stale version");
    const row = await subs.accept(s, null);
    same(row.state, "accepted", "accepted");
    const b = await one("select amount::text as amount, approved_at, approved_by, kind, document_file_id from public.bills where id = $1", [row.bill_id]);
    same([b.amount, b.approved_at, b.approved_by, b.kind], ["2345.67", null, null, "Subcontractor"], "a bill NOT approved");
    const f = await one("select storage_path, folder, source from public.files where id = $1", [b.document_file_id]);
    same([f.storage_path, f.folder, f.source], [up.path, "receipts", "subform"], "its document is the paperwork");
    const e = await refused(() => subs.accept(s, null), "23514", "a second accept");
    ok(/already done/.test(e.message) && M.isStale(e), "already done: " + e.message);
    ok(/^Already done — that submission was already accepted/.test(M.refusalText(e)), M.refusalText(e));
    d = await subs.list(await me());
    const a = d.all.find((x) => x.reference === ref);
    same([a.state, a.billId, !!a.reviewedByName], ["accepted", row.bill_id, true], "the queue shows it accepted, by whom");
  });

  await check("P5c sub form: a change order -> the job's change order (awarded, its amount under quote_prices); reject with a note", async () => {
    await as(null);
    const co = await subform.submit(payload({ kind: "Change order", amount: "860", description: "Six more outlets.", document: null }));
    same(co.upload, null, "no document asked for");
    const n = await subform.submit(payload({ document: null }));
    await as("admin");
    let d = await subs.list(await me());
    const c = d.all.find((x) => x.reference === co.reference);
    ok(c.isCo && c.canAccept, "a change order can be accepted without paperwork");
    const row = await subs.accept(c, null);
    const q = await one("select q.kind, q.status, p.amount::text as amount from public.quotes q join public.quote_prices p on p.quote_id = q.id where q.id = $1", [row.quote_id]);
    same([q.kind, q.status, q.amount], ["change_order", "awarded", "860.00"], "the job's change order");
    const inv = d.all.find((x) => x.reference === n.reference);
    same(inv.canAccept, false, "an invoice without paperwork cannot be accepted");
    ok(/no document attached/.test((await refused(() => subs.accept(inv, null), "23514", "no paperwork")).message), "refused by the database too");
    const r = await subs.reject(inv, "  Sent to   the wrong company ");
    same([r.state, r.review_note], ["rejected", "Sent to the wrong company"], "rejected with its note (one line)");
    const qs = await subs.quotesFor(J.open.id, await me());
    ok(qs.some((x) => x.id === row.quote_id && x.amount === 860), "the change order is there to bill against (the amount with prices)");
    await as("lead");
    ok((await subs.quotesFor(J.open.id, await me())).some((x) => x.id === row.quote_id && x.amount === null), "a lead sees it exists, never its amount");
  });

  await check("P5c sub form: the rate limit (429 with Retry-After from the rate table) and the notices (admins and accountants, amount-free); P5 check 5", async () => {
    await as(null);
    ip = "198.51.100.91";
    for (let i = 0; i < fn.RATE.projects.limit; i++) await subform.searchProjects(J.open.number);
    same((await refused(() => subform.searchProjects(J.open.number), "rate_limited", "rate")).status, 429, "over the limit");
    ip = "198.51.100.92";
    same((await subform.searchProjects(J.open.number)).projects.length, 1, "another address");
    const notes = await sql("select o.kind, p.role, o.subject, o.body from public.notifications_outbox o join public.profiles p on p.id = o.to_profile_id where o.id > $1", [before.outbox]);
    ok(notes.length >= 3 && notes.every((x) => x.kind === "sub_submission" && (x.role === "admin" || x.role === "accountant" || x.role === "manager")), "to reviewers: " + notes.map((x) => x.role));
    const texts = (await sql("select text as t from public.activity where id > $1", [before.act])).map((x) => x.t).concat(notes.map((x) => x.subject + " " + x.body));
    for (const t of texts) ok(!/\$\s?\d|2,?345|\b860\b/.test(String(t)), "an amount in: " + t);
  });

  await check("P5c sub form: drift - the demo database (tools/fake/p5c-sub.js) has exactly sub_submissions' columns and the RPCs' arguments", async () => {
    await import(pathToFileURL(path.join(SITE, "..", "tools", "fake", "p5c-sub.js")).href);
    const NS = globalThis.DCR2Fake;
    const H = await import(pathToFileURL(path.join(SITE, "..", "tests", "pages-engine.mjs")).href);
    const engine = await H.freshEngine(new Date());
    same(Object.keys(engine.COLS.sub_submissions).sort(), Object.keys(catalog.tables.sub_submissions.cols).sort(), "sub_submissions columns");
    for (const [name, want] of Object.entries(NS.p5cSubSigs)) same(want, catalog.functions[name][0].args.map((a) => a.name), name);
  });
  void db;
  await as(null);
}
