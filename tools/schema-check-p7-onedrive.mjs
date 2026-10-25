/* DCR Portal 2 — the Files tab's OneDrive part against the REAL broker and the REAL database rules (development only):
   Part 4's part of tools/schema-check.mjs (it calls run() with its own helpers). Portal 2's own site/js/repo/onedrive.js
   and site/js/onedrive-upload.js run through DCR Desktop 2's OWN Edge Function logic (supabase/functions/onedrive/
   handler.ts, with its fake Microsoft Graph - fake_graph.ts, made-up names - in place of Microsoft), whose two database
   questions go to PGlite loaded with every DCR Desktop 2 migration (20261028000100_estimator and 20261028000200_onedrive
   included) exactly as index.ts sends them: rpc onedrive_context and rpc record_onedrive_file WITH THE CALLER'S OWN
   TOKEN (here: SET ROLE authenticated + the person's claims). So the switch, the gates, the folder name, the files row,
   the version chain, the activity line and the hiding are the real ones:

   * drift: the broker's contract as Portal 2 knows it - the ops, every error code, the site's origin in CORS, the
     chunk unit and its 191 x 320 KiB cap, the upload allowlist and the download blocklist - and the page's rules
     (map/onedrive.js) answering as the broker's paths.ts on made-up names: stems, amounts, what is hidden from whom,
     segments, the upload names, the files table's shape;
   * every role lists (no folder yet: folder_exists false); can_upload and can_make_folder as the database answers them
     (the switch: an admin always; a lead, a field person and a manager with prices when it is ticked; never a manager
     without it, a viewer, the agents account or a turned-off person); a deleted project 404; signed out 401;
   * Make the folder (a manager; a viewer refused); an upload by a lead through the page's uploader - chunks straight to
     the (fake) upload URL with no Authorization header, the last one's driveItem, upload_done - becomes the lead's own
     files row (storage local, source portal2, Floor Plans, its rel_path) with the activity line, read back by
     repo/files.js and merged onto the OneDrive row; a lost last answer never makes a second file; the takeoff rule (a
     lead 415, a manager with prices recorded and read with prices only); a program never opened.
   Made-up people, project and files only. */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, client, sql, PEOPLE, ok, same, refused, catalog, SITE, D2 } = h;
  const FN = path.join(D2 || path.join(SITE, "..", "..", "DCR Desktop 2"), "supabase", "functions", "onedrive");
  const MIG = path.join(D2 || path.join(SITE, "..", "..", "DCR Desktop 2"), "supabase", "migrations", "20261028000200_onedrive.sql");
  const HAS = !!(catalog.functions.onedrive_context && catalog.functions.record_onedrive_file && existsSync(path.join(FN, "handler.ts")) &&
    existsSync(path.join(FN, "fake_graph.ts")) && existsSync(path.join(FN, "test_world.ts")));
  if (!HAS) {
    // only while the migration and the function are not written yet: once either is in DCR Desktop 2, a missing piece is drift
    const written = existsSync(MIG) || existsSync(path.join(FN, "handler.ts"));
    results.push({ section, name: written ? "Part 4: 20261028000200_onedrive or the onedrive function is in DCR Desktop 2, but a piece is missing (the RPCs, handler.ts, fake_graph.ts or test_world.ts)"
      : "Part 4: the onedrive migration and function are not in DCR Desktop 2 yet: the OneDrive checks wait for them", ok: !written });
    return;
  }
  const ts = (f) => import(pathToFileURL(path.join(FN, f)).href);
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const fn = await ts("handler.ts");
  const P = await ts("paths.ts");
  const { makeFakeGraph } = await ts("fake_graph.ts");
  const TW = await ts("test_world.ts");
  const od = await site("repo/onedrive.js");
  const OD = await site("map/onedrive.js");
  const { createUploader } = await site("onedrive-upload.js");
  const files = await site("repo/files.js");
  const id = (k) => PEOPLE[k].id;

  /* ── the made-up project and switches (the admin's, as DCR Desktop 2's Users page or the Access tab sets them) ── */
  const asAdmin = (text, params) => client.run(() => sql(text, params), id("admin"));
  await asAdmin("update public.profiles set can_upload_onedrive = true where id = any($1::uuid[])", [[id("lead"), id("field"), id("manager2")]]);
  const made = (await asAdmin(`select p.* from public.create_project(jsonb_build_object('name', 'OneDrive check', 'address', '1 Made Up Way', 'city', 'Testville')) p`))[0];
  const gone = (await asAdmin(`select p.* from public.create_project(jsonb_build_object('name', 'Gone check')) p`))[0];
  await asAdmin("select public.soft_delete($1, $2, $3)", ["projects", gone.id, gone.version]);
  const pid = Number(made.id);
  const folderName = String(made.folder_name);

  /* ── the broker as index.ts wires it, the caller's own token for the database; Microsoft is fake_graph.ts ── */
  const clock = { t: Date.now() };
  const g = makeFakeGraph({ tenantId: TW.TENANT, clientId: TW.CLIENT, clientSecret: TW.SECRET, driveId: TW.DRIVE, host: od.ONEDRIVE_HOST, now: () => clock.t });
  const b64u = (s) => Buffer.from(s).toString("base64url");
  const jwtOf = (uid) => b64u(JSON.stringify({ alg: "ES256", typ: "JWT" })) + "." + b64u(JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" })) + ".sig";
  const subOf = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub || ""; } catch (e) { return ""; } };
  const asCaller = (jwt, text, params) => client.run(async () => {
    try { return (await sql(text, params))[0].v; } catch (e) { throw Object.assign(new Error("database"), { code: e.code, hint: e.hint ?? null }); }
  }, subOf(jwt));
  const deps = {
    settings: () => Object.assign({}, TW.SETTINGS_OK, { ONEDRIVE_HOST: od.ONEDRIVE_HOST }),
    caller: async (jwt) => { const s = subOf(jwt); return Object.values(PEOPLE).some((p) => p.id === s) ? { id: s } : null; },
    context: (jwt, p) => asCaller(jwt, "select public.onedrive_context(p_project_id => $1) as v", [p]),
    record: (jwt, a) => {
      const keys = Object.keys(a);
      return asCaller(jwt, "select public.record_onedrive_file(" + keys.map((k, i) => k + " => $" + (i + 1)).join(", ") + ") as v", keys.map((k) => a[k]));
    },
    fetch: (url, init) => g.fetch(url, init),
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    log: () => {},
  };
  const before = client.functions;
  client.functions = {
    invoke: async (name, o) => {
      if (name !== "onedrive") return before ? before.invoke(name, o) : { data: null, error: { context: new Response("{}", { status: 404 }) } };
      const res = await fn.handle(new Request("https://pglite.invalid/functions/v1/onedrive", { method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://portal.dcrframing.com", Authorization: "Bearer " + jwtOf(client.uid) },
        body: JSON.stringify((o && o.body) || {}) }), deps);
      if (res.ok) return { data: await res.json(), error: null };
      return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { name: "FunctionsHttpError", context: res }) };
    },
  };
  /* Microsoft's upload URL (fake_graph.ts plays only the last chunk): the chunk semantics on top of it */
  const offsets = new Map();
  const seen = [];
  let loseFinal = false;
  const transport = async (req) => {
    seen.push({ method: req.method, headers: Object.assign({}, req.headers), size: req.body ? req.body.size : 0 });
    const s = g.sessions.get(req.url);
    const res = (status, body) => ({ status, header: () => null, text: () => JSON.stringify(body) });
    if (!s || s.done) return res(404, { error: { code: "itemNotFound" } });
    const at = offsets.get(req.url) || 0;
    if (req.method === "GET") return res(200, { nextExpectedRanges: [at + "-"] });
    if (Object.keys(req.headers).some((k) => /authorization/i.test(k))) return res(401, { error: { code: "unauthenticated" } });
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["Content-Range"] || "");
    if (!m || Number(m[1]) !== at || Number(m[2]) - Number(m[1]) + 1 !== req.body.size) return res(416, { nextExpectedRanges: [at + "-"] });
    offsets.set(req.url, Number(m[2]) + 1);
    if (Number(m[2]) + 1 < Number(m[3])) return res(202, { nextExpectedRanges: [(Number(m[2]) + 1) + "-"] });
    const it = g.completeUpload(req.url, Number(m[3]));
    if (loseFinal) { loseFinal = false; throw Object.assign(new Error("No connection"), { code: "offline" }); }
    return res(201, { id: it.id, name: it.name, size: it.size });
  };
  const uploader = () => createUploader({
    send: transport,
    broker: {
      session: (j) => od.uploadSession({ projectId: j.projectId, folder: j.folder, relDir: j.relDir, name: j.name, size: j.size }),
      done: (j, itemId, ticket) => od.uploadDone(j.projectId, itemId, ticket),
      find: (j) => od.findFile(j.projectId, [j.folder].concat(j.relDir ? j.relDir.split("/") : []), j.target || j.name, j.size),
    },
    setTimeout: (f) => setTimeout(f, 0), wait: () => 1,
  });
  const settle = (up) => new Promise((resolve) => { const c = () => (up.active() ? setTimeout(c, 5) : resolve(up.list())); setTimeout(c, 5); });
  const file = (size, name) => new File([new Uint8Array(size)], name, { type: name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream" });

  try {
    await check("Part 4 OneDrive: drift - the broker's ops, error codes, CORS origin, chunk unit and cap, allowlist and blocklist are the ones Portal 2 knows", async () => {
      same(fn.OPS.slice().sort(), ["download", "ensure_folder", "list", "status", "upload_done", "upload_session"], "the ops");
      same(Object.keys(fn.ERRORS).sort(), od.CONTRACT.slice().sort(), "every error code the broker answers is one repo/onedrive.js reads");
      ok(fn.ALLOWED_ORIGINS.includes("https://portal.dcrframing.com"), "the site's origin is allowed in CORS");
      same(fn.CHUNK_MULTIPLE, OD.CHUNK_UNIT, "320 KiB");
      same(fn.MAX_CHUNK_BYTES, OD.MAX_CHUNK, "191 x 320 KiB");
      same(Array.from(P.UPLOAD_EXTS).sort(), OD.UPLOAD_EXTS.slice().sort(), "the upload allowlist");
      same(Array.from(P.PRICED_UPLOAD_EXTS).sort(), OD.PRICED_UPLOAD_EXTS.slice().sort(), "the priced upload types");
      same(Array.from(P.BLOCKED_DOWNLOAD_EXTS).sort(), OD.BLOCKED_DOWNLOAD_EXTS.slice().sort(), "the download blocklist");
      same([P.MAX_NEW_FILE_NAME, P.MAX_FOLDER_NAME, P.MAX_SUBPATH, P.MAX_SUBPATH_PARTS, P.MAX_PROJECT_PATH, P.MAX_PATH_TEXT],
        [OD.MAX_NEW_FILE_NAME, OD.MAX_FOLDER_NAME, OD.MAX_SUBPATH, OD.MAX_SUBPATH_PARTS, OD.MAX_PROJECT_PATH, OD.MAX_PATH_TEXT], "the limits");
      const cors = fn.corsHeaders("https://portal.dcrframing.com");
      ok(cors["Access-Control-Allow-Origin"] === "https://portal.dcrframing.com" && !fn.corsHeaders("https://evil.example")["Access-Control-Allow-Origin"], "CORS");
      same(cors["Access-Control-Expose-Headers"], "Retry-After", "repo/onedrive.js reads a 503 busy's Retry-After across sites");    });
    await check("Part 4 OneDrive: drift - the page's rules answer as the broker's paths.ts (stems, amounts, hiding, segments, upload names, the table's shape)", async () => {
      const names = ["Estimates", "Change_Orders", "Ｅｓｔｉｍａｔｅｓ", "Morbid", "2026 bids", "Invoices", "Old portal records", "Old portal documents", "Deck $4,500.pdf",
        "paid 4500 cash.txt", "L1.takeoff", "notes.PDFNOTES", "~$x.docx", "desktop.ini", ".hidden", "x.tmp", "_vti_cnf", "Floor Plans", "Permit.pdf", "a∕b",
        "con", "COM¹.txt", "x.", " x", "..", "a:b", "a‮b", "．．", "Macro.xlsm", "tool.exe", "Plan.PDF", "x".repeat(201) + ".pdf", "Quote 3.pdf", "README",
        "Subcontractor Invoices", "Contract payments.xlsx", "Change order invoice 3.pdf", "Invoice 12.pdf", "A253Estimate.pdf", "2026Invoice.pdf",
        "A305Quote.pdf", "Old.takeoff", "Tabidze survey.pdf"];
      const viewers = [{ prices: false, financials: false }, { prices: true, financials: false }, { prices: true, financials: true }];
      for (const n of names) {
        same(OD.stemOf(n), P.stemOf(n), "stem " + n);
        same(OD.stems(n), P.stems(n), "stems " + n);
        same(OD.quotesAmount(n), P.quotesAmount(n), "amount " + n);
        same(OD.segmentProblem(n), P.segmentProblem(n), "segment " + n);
        same(OD.downloadable(n), P.downloadable(n), "download " + n);
        for (const v of viewers) {
          same(OD.nameHidden(n, v), P.nameHidden(n, v), "hidden " + n + " " + JSON.stringify(v));
          const mine = OD.uploadProblem(n, v), theirs = P.uploadName(n, v);
          same(mine ? mine.code : null, "code" in theirs ? theirs.code : null, "upload " + n + " " + JSON.stringify(v));
          same(OD.folderProblem(n, v), P.folderSegmentProblem(n, v), "folder " + n);
        }
      }
      for (const p of ["A/Floor Plans/A1.pdf", "A/", "/x/y", "A/ b", "A/b.", "A/con", "A/b:c", "x".repeat(1025), Array.from({ length: 33 }, () => "a").join("/")]) {
        same(OD.relPathOk(p), P.relPathOk(p), "rel_path " + p.slice(0, 30));
      }
      for (const s of ["", "Floor Plans/Level 1", "/a", "a//b", " a", "a./b", Array.from({ length: 13 }, () => "a").join("/"), "x".repeat(121)]) {
        same(OD.subpathOk(s), P.subpathOk(s), "subpath " + s.slice(0, 30));
      }
    });

    await check("Part 4 OneDrive: every role lists the project's folder through the broker; can_upload / can_make_folder are the database's", async () => {
      const want = { admin: [true, true], manager: [false, true], manager2: [true, true], accountant: [false, false], lead: [true, true],
        field: [true, true], field2: [false, false], viewer: [false, false] };
      for (const [k, flags] of Object.entries(want)) {
        client.as(id(k));
        const page = await od.list(pid);
        same([page.folderExists, page.entries.length, page.canUpload, page.canMakeFolder], [false, 0].concat(flags), k);
      }
      for (const k of ["agents", "inactive"]) { client.as(id(k)); same((await refused(() => od.list(pid), "forbidden", k)).status, 403, k); }
      client.as(id("admin"));
      same((await refused(() => od.list(Number(gone.id)), "not_found", "a deleted project")).status, 404, "deleted");
      client.as(null);
      same((await refused(() => od.list(pid), "auth", "signed out")).status, 401, "signed out");
    });

    await check("Part 4 OneDrive: Make the folder - a manager (projects editing); a viewer refused; the three folders", async () => {
      client.as(id("viewer"));
      same((await od.ensureFolder(pid)).state, "forbidden", "viewer");
      client.as(id("manager"));
      const r = await od.ensureFolder(pid);
      same([r.state, r.madeProjectFolder, r.created], ["made", true, ["Floor Plans", "Photos", "Documents"]], "made");
      same((await od.ensureFolder(pid)).state, "exists", "again");
      client.as(id("field2"));
      same((await od.list(pid)).entries.map((e) => [e.name, e.folder]), [["Documents", true], ["Floor Plans", true], ["Photos", true]], "listed");
    });

    let leadRow = null;
    await check("Part 4 OneDrive: a lead's upload through the page's uploader - chunks to the upload URL, no Authorization, the lead's own files row and the activity line", async () => {
      client.as(id("lead"));
      const up = uploader();
      const size = 2 * OD.CHUNK_UNIT + 99;
      up.add({ projectId: pid, file: file(size, "L2 framing.pdf"), folder: "Floor Plans", relDir: "Level 2", name: "L2 framing.pdf" });
      const [job] = await settle(up);
      same([job.state, job.error], ["done", ""], "the job");
      same([job.result.recorded, job.result.already, job.result.renamed, job.result.name], [true, false, false, "L2 framing.pdf"], "upload_done");
      ok(seen.filter((s) => s.method === "PUT").every((s) => !Object.keys(s.headers).some((k) => /authorization|apikey/i.test(k))), "no sign-in on a chunk");
      const row = (await client.run(() => sql("select * from public.files where id = $1", [job.result.file.id]), "owner"))[0];
      same([row.project_id, row.folder, row.storage, row.rel_path, row.subpath, row.name, Number(row.size), row.source, row.created_by, row.version_no],
        [pid, "plans", "local", folderName + "/Floor Plans/Level 2/L2 framing.pdf", "Floor Plans/Level 2", "L2 framing.pdf", size, "portal2", id("lead"), 1], "the row");
      const lines = await client.run(() => sql("select text, created_by from public.activity where project_id = $1 and text like 'Added%'", [pid]), "owner");
      same(lines, [{ text: "Added 1 file to Floor Plans", created_by: id("lead") }], "the activity line");
      // read back by the project's file list and merged onto the OneDrive row
      client.as(id("field2"));
      const items = await files.listCurrent(pid);
      leadRow = items.find((f) => f.id === row.id);
      ok(leadRow && !leadRow.cloud && leadRow.relPath === row.rel_path, "repo/files.js reads the local row");
      const listed = await od.list(pid, ["Floor Plans", "Level 2"]);
      const merged = OD.mergeLocal(listed.entries, items, ["Floor Plans", "Level 2"]);
      same(merged.map((e) => [e.name, e.fileId]), [["L2 framing.pdf", row.id]], "merged");
    });

    await check("Part 4 OneDrive: a lost LAST answer never makes a second file (the session gone: the broker is asked first)", async () => {
      client.as(id("field"));
      const up = uploader();
      loseFinal = true;
      up.add({ projectId: pid, file: file(OD.CHUNK_UNIT + 5, "Permit.pdf"), folder: "Documents", relDir: "", name: "Permit.pdf" });
      const [job] = await settle(up);
      same([job.state, job.result && job.result.recorded], ["done", true], job.error);
      const copies = Array.from(g.items.values()).filter((i) => /^Permit( \d+)?\.pdf$/.test(i.name));
      same(copies.length, 1, "one file in OneDrive");
      same(Number((await client.run(() => sql("select count(*)::int as n from public.files where name like 'Permit%' and project_id = $1", [pid]), "owner"))[0].n), 1, "one row");
    });

    await check("Part 4 OneDrive: who may upload what - a field person without the switch, a viewer, the allowlist, the takeoff rule (D8)", async () => {
      const ask = (o) => od.uploadSession(Object.assign({ projectId: pid, folder: "Documents", name: "a.pdf", size: 10 }, o));
      for (const k of ["field2", "viewer", "manager", "accountant"]) { client.as(id(k)); same((await refused(() => ask({}), "forbidden", k)).status, 403, k); }
      client.as(id("lead"));
      same((await refused(() => ask({ name: "tool.exe" }), "file_type", "a program")).status, 415, "exe");
      same((await refused(() => ask({ name: "L1.takeoff", folder: "Floor Plans" }), "file_type", "a takeoff without prices")).status, 415, "takeoff");
      same((await refused(() => ask({ name: "Quote 3.pdf" }), "invalid", "a priced name without prices")).field, "name", "quote");
      same((await refused(() => ask({ relDir: "Items/12 - Beam" }), "invalid", "Documents/Items")).field, "rel_dir", "items");
      same((await refused(() => ask({ folder: "Photos" }), "invalid", "Photos")).field, "folder", "photos");
      client.as(id("manager2"));
      const up = uploader();
      up.add({ projectId: pid, file: file(40, "L1.takeoff"), folder: "Floor Plans", relDir: "", name: "L1.takeoff" });
      const [job] = await settle(up);
      same([job.state, job.result && job.result.recorded], ["done", true], "a manager with prices records a takeoff");
      client.as(id("lead"));
      ok(!(await od.list(pid, "Floor Plans")).entries.some((e) => /takeoff/i.test(e.name)), "hidden in OneDrive for the lead");
      ok(!(await files.listCurrent(pid)).some((f) => /takeoff/i.test(f.name)), "and its row too (D8)");
      client.as(id("manager2"));
      ok((await od.list(pid, "Floor Plans")).entries.some((e) => e.name === "L1.takeoff"), "listed for prices");
    });

    await check("Part 4 OneDrive: opening a file - a link on the OneDrive host only; a program never", async () => {
      client.as(id("field2"));
      const level2 = (await od.list(pid, ["Floor Plans", "Level 2"])).entries[0];
      const link = await od.download(pid, level2.id);
      ok(od.linkOk(link.url) && new URL(link.url).hostname === od.ONEDRIVE_HOST, "the link's host");
      const docs = (await od.list(pid, "Documents")).entries;
      const docsFolder = Array.from(g.items.values()).find((i) => i.name === "Documents" && i.folder && Array.from(g.items.values()).some((p) => p.id === i.parent && p.name === folderName));
      const exe = g.file(docsFolder.id, "Installer.exe", 5);
      same((await refused(() => od.download(pid, exe.id), "not_downloadable", "a program")).status, 403, "exe");
      ok(docs.length >= 1, "Documents listed");
    });
  } finally {
    client.functions = before;
    client.as(null);
  }
}
