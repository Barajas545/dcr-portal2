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
   * the plan buttons (owner 2026-10-26), once the broker has op plans_for (until then a line says the checks wait): the
     op and takeoff_not_configured in the drift; the takeoff folder not set up (no ONEDRIVE_TAKEOFF_ITEM_ID) is a quiet {}
     for repo/onedrive.js plansFor; set up (when test_world.ts's settings have it), a field person's answer carries the
     project's number and a count only, a deleted project left out; signed out 401, the agents account 403;
   * the iPad's save back (owner decisions Q1-Q3 of 2026-11-04; contract C1), once the broker has plan_save_session /
     plan_save_done (until then a line says the check waits): the ops and not_saved / plan_changed in the drift; an
     admin's save through Portal 2's own uploader replaces the made-up plan (its id kept, a new version as plans_list
     words it), a device with the old version saves a copy beside it ("<stem> - iPad <date> <time>.takeoff"), and a
     person without prices or without the switch is refused; and, once the broker has plan_save_commit (contract
     addendum 2, C1b), as Portal 2's library drives it - the plan's name to the session, a replace DEFERRED (every chunk
     202, the broker's commit with the session's address and the save's quickXorHash from site/js/quickxor.js, which
     must be OneDrive's - fake_graph.ts hashes with the broker's quickxor.ts), an office save during the upload made the
     same upload's copy, a desktop-style save (the old item moved into Backup, a new one on the name) a copy found by
     name, a byte-identical re-save saved, and a commit whose answer was lost settled by plan_save_done with the hash;
     and, once the broker has its repair round (contract addendum 3: save_back_off), the switch ONEDRIVE_PLAN_SAVE (off:
     save_back false and plan_save_session 503 save_back_off; only:<number>), and every replace checked by the plan's
     version history - OneDrive ignoring the deferral with an office save during the upload (the last chunk's 200 sent
     back as landed: crossed, the office save put back, the save a copy), the PUT commit refused (the POST commits it,
     verified), both refused (plan_changed why "refused": the copy without blame), no history (verified false) and a
     deferred replace's ticket past 48 hours without a hash (not_saved need "hash");
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
  await site("quickxor.js");                                  // the device's quickXorHash (a classic script: self.DCR2QuickXor)
  const QX = globalThis.DCR2QuickXor;
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
  // the plan buttons' op is in the broker (DCR Desktop 2) - before that its checks wait, and the drift is the older one
  const HAS_PLANS = Array.isArray(fn.OPS) && fn.OPS.includes("plans_for");
  // and the Plans Library's two (2026-10-26)
  const HAS_LIBRARY = Array.isArray(fn.OPS) && fn.OPS.includes("plans_list");
  // and the iPad's save back (owner decisions Q1-Q3 of 2026-11-04; contract C1): until DCR Desktop 2 has it, the drift
  // is the older one and its check waits
  const HAS_SAVE = Array.isArray(fn.OPS) && fn.OPS.includes("plan_save_session");
  // and the review round's deferred commit (contract addendum 2, C1b)
  const HAS_COMMIT = Array.isArray(fn.OPS) && fn.OPS.includes("plan_save_commit");
  // and the repair round (contract addendum 3): the switch, the version check, landed, why, need hash
  const HAS_SWITCH = !!(fn.ERRORS && fn.ERRORS.save_back_off);
  let takeoffSet = true;               // false: the settings without ONEDRIVE_TAKEOFF_ITEM_ID (the takeoff folder not set up)
  let planSave;                        // ONEDRIVE_PLAN_SAVE for a check (undefined: test_world.ts's own)
  const logs = [];                     // the broker's log lines (op, statuses, the save back's lines - never a name or an id)
  const deps = {
    settings: () => {
      const s = Object.assign({}, TW.SETTINGS_OK, { ONEDRIVE_HOST: od.ONEDRIVE_HOST });
      if (!takeoffSet) delete s.ONEDRIVE_TAKEOFF_ITEM_ID;
      if (planSave !== undefined) s.ONEDRIVE_PLAN_SAVE = planSave;
      return s;
    },
    caller: async (jwt) => { const s = subOf(jwt); return Object.values(PEOPLE).some((p) => p.id === s) ? { id: s } : null; },
    context: (jwt, p) => asCaller(jwt, "select public.onedrive_context(p_project_id => $1) as v", [p]),
    record: (jwt, a) => {
      const keys = Object.keys(a);
      return asCaller(jwt, "select public.record_onedrive_file(" + keys.map((k, i) => k + " => $" + (i + 1)).join(", ") + ") as v", keys.map((k) => a[k]));
    },
    // plans_for's select of the projects' id and number with the caller's token (projects RLS), as index.ts does it
    numbers: (jwt, ids) => client.run(async () => {
      try { return await sql("select id, number from public.projects where id = any($1::bigint[]) and deleted_at is null", [ids]); }
      catch (e) { throw Object.assign(new Error("database"), { code: e.code, hint: e.hint ?? null }); }
    }, subOf(jwt)),
    fetch: (url, init) => g.fetch(url, init),
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    log: (m) => { logs.push(String(m)); if (logs.length > 500) logs.shift(); },
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
  const parts = new Map();
  const seen = [];
  let loseFinal = false;
  let atLast = null;                   // a check's: run when a session's last chunk arrives (an office save during the upload)
  const transport = async (req) => {
    seen.push({ method: req.method, headers: Object.assign({}, req.headers), size: req.body ? req.body.size : 0 });
    const s = g.sessions.get(req.url);
    const res = (status, body) => ({ status, header: () => null, text: () => JSON.stringify(body) });
    if (!s || s.done) return res(404, { error: { code: "itemNotFound" } });
    const at = offsets.get(req.url) || 0;
    if (req.method === "GET") return res(200, { nextExpectedRanges: s.deferred && s.bytes ? [] : [at + "-"] });
    if (Object.keys(req.headers).some((k) => /authorization/i.test(k))) return res(401, { error: { code: "unauthenticated" } });
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["Content-Range"] || "");
    if (!m || Number(m[1]) !== at || Number(m[2]) - Number(m[1]) + 1 !== req.body.size) return res(416, { nextExpectedRanges: [at + "-"] });
    offsets.set(req.url, Number(m[2]) + 1);
    parts.set(req.url, (parts.get(req.url) || []).concat([req.body]));
    if (Number(m[2]) + 1 < Number(m[3])) return res(202, { nextExpectedRanges: [(Number(m[2]) + 1) + "-"] });
    const bytes = new Uint8Array(await new Blob(parts.get(req.url)).arrayBuffer());
    if (atLast) { const a = atLast; atLast = null; a(); }
    if (HAS_COMMIT && typeof g.lastChunk === "function") {
      // the broker's fake Graph as Microsoft's page has it: a deferred session's last chunk commits nothing (202)
      const last = g.lastChunk(req.url, bytes);
      if (last.status === 202) return res(202, { expirationDateTime: new Date(clock.t + 86400000).toISOString(), nextExpectedRanges: [] });
      if (loseFinal) { loseFinal = false; throw Object.assign(new Error("No connection"), { code: "offline" }); }
      // 200 (an existing file's new bytes: a replace OneDrive committed itself) or 201 (a new file), as the fake says
      return res(last.status, { id: last.item.id, name: last.item.name, size: last.item.size });
    }
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
  // the plan broker as js/plan-library.js has it: the plan's name to the session, the broker's commit of a deferred
  // replace (the session's own address, the save's hash), plan_save_done with the hash, plan_changed sent again as a copy
  const planUploader = (planId, base, meta) => createUploader({
    send: transport,
    broker: {
      session: (j) => od.planSaveSession({ projectId: j.projectId, itemId: (meta && meta.itemId) || planId, version: base, size: j.size,
        name: meta && meta.name, mode: meta && meta.mode === "copy" ? "copy" : undefined }),
      done: (j, itemId, ticket) => od.planSaveDone(j.projectId, itemId, ticket, meta && meta.hash),
      commit: async (j) => {
        try {
          return await od.planSaveCommit({ projectId: j.projectId, itemId: (meta && meta.itemId) || planId, ticket: j.session.ticket, uploadUrl: j.session.uploadUrl,
            hash: meta && meta.hash, landed: j.chunkLanded === true });
        } catch (x) {
          if (x && x.code === "plan_changed" && meta) { meta.mode = "copy"; meta.why = x.info && x.info.why === "refused" ? "refused" : "changed"; x.restart = true; }
          throw x;
        }
      },
      find: async () => [],
    },
    setTimeout: (f) => setTimeout(f, 0), wait: () => 1,
  });
  const settle = (up) => new Promise((resolve) => { const c = () => (up.active() ? setTimeout(c, 5) : resolve(up.list())); setTimeout(c, 5); });
  const file = (size, name) => new File([new Uint8Array(size)], name, { type: name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream" });

  try {
    await check("Part 4 OneDrive: drift - the broker's ops, error codes, CORS origin, chunk unit and cap, allowlist and blocklist are the ones Portal 2 knows", async () => {
      same(fn.OPS.slice().sort(), ["download", "ensure_folder", "list", "status", "upload_done", "upload_session"].concat(HAS_PLANS ? ["plans_for"] : [])
        .concat(HAS_LIBRARY ? ["plans_list", "plan_link"] : []).concat(HAS_SAVE ? ["plan_save_session", "plan_save_done"] : [])
        .concat(HAS_COMMIT ? ["plan_save_commit"] : []).sort(), "the ops");
      same(Object.keys(fn.ERRORS).sort(), od.CONTRACT.filter((c) => (HAS_PLANS || !/^takeoff_/.test(c)) &&
        (HAS_SAVE || (c !== "not_saved" && c !== "plan_changed")) && (HAS_SWITCH || c !== "save_back_off")).sort(), "every error code the broker answers is one repo/onedrive.js reads");
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

    if (!HAS_PLANS) {
      results.push({ section, name: "the plan buttons: op plans_for is not in DCR Desktop 2's broker yet - its checks wait for it", ok: true });
    } else {
      await check("the plan buttons: op plans_for - the takeoff folder not set up is a quiet {}; set up, a number and a count only", async () => {
        client.as(id("field"));
        takeoffSet = false;
        od.forgetPlans();
        same(await od.plansFor([pid]), {}, "not set up: nothing said");
        same((await refused(() => od.call({ op: "plans_for", project_ids: [pid] }), "takeoff_not_configured", "the raw answer")).status, 503, "503");
        takeoffSet = true;
        if ("ONEDRIVE_TAKEOFF_ITEM_ID" in (TW.SETTINGS_OK || {})) {
          // the made-up project's folder in the fake takeoff folder (when fake_graph.ts has one): a takeoff file right in
          // it - the only one that counts (the owner, 2026-10-27: never one in a sub-folder) - and one in Plans/Rev 2, one
          // in Backup, an autosave and a PDF that never count
          let want = null;
          if (g.takeoff && g.takeoff.id) {
            const tf = g.mkdir(g.takeoff.id, made.number + " - 1 Made Up Way - Testville");
            const plansDir = g.mkdir(tf.id, "Plans");
            g.file(tf.id, made.number + " Bid.takeoff", 10);
            g.file(g.mkdir(plansDir.id, "Rev 2").id, made.number + " Rev 2.takeoff", 10);
            g.file(g.mkdir(tf.id, "Backup").id, made.number + " Bid (old).takeoff", 10);
            g.file(plansDir.id, made.number + " Bid.takeoff.autosave", 10);
            g.file(plansDir.id, "A1 - Floor plan.pdf", 10);
            want = 1;
          }
          od.forgetPlans();
          const got = await od.plansFor([pid, Number(gone.id)]);
          same(Object.keys(got), [String(pid)], "the deleted project is left out");
          same(got[String(pid)].number, String(made.number), "the number, read under the caller's rules");
          ok(Number.isSafeInteger(got[String(pid)].plans) && got[String(pid)].plans >= 0, "a count");
          if (want !== null) same(got[String(pid)].plans, want, "the takeoff files right in its folder, never a sub-folder's, nothing else");
          const raw = await od.call({ op: "plans_for", project_ids: [pid] });
          same(Object.keys(raw).sort(), ["checked_at", "projects"], "the answer's fields");
          same(Object.keys(raw.projects[String(pid)]).sort(), ["number", "plans"], "no name, item id or link");
        }
        client.as(id("agents"));
        same((await refused(() => od.call({ op: "plans_for", project_ids: [pid] }), "forbidden", "the agents account")).status, 403, "agents");
        client.as(null);
        same((await refused(() => od.call({ op: "plans_for", project_ids: [pid] }), "auth", "signed out")).status, 401, "signed out");
      });
    }

    if (!HAS_SAVE || !HAS_LIBRARY) {
      results.push({ section, name: "the save back: ops plan_save_session / plan_save_done are not in DCR Desktop 2's broker yet - their check waits for them", ok: true });
    } else if (!(g.takeoff && g.takeoff.id && "ONEDRIVE_TAKEOFF_ITEM_ID" in (TW.SETTINGS_OK || {}))) {
      results.push({ section, name: "the save back: the fake Graph has no takeoff folder here - its check waits for one", ok: true });
    } else {
      await check("the save back (contract C1): Portal 2's repo and uploader over the REAL plan_save_session / plan_save_done - an admin's save replaces the plan (its id kept, a new version as plans_list says it); a device whose version is old saves a copy beside it; prices without the switch, or the switch without prices, 403", async () => {
        client.as(id("admin"));
        const listed = (await od.plansList([pid]))[String(pid)];
        const plan = listed && listed.files.find((f) => f.name === made.number + " Bid.takeoff");
        ok(!!plan, "the made-up project's plan (the plan buttons' check made it)");
        const saveOf = (base, meta) => planUploader(plan.id, base, meta);
        const up = saveOf(plan.version, HAS_COMMIT ? { name: plan.name, hash: QX.quickXorHash(new Uint8Array(3 * OD.CHUNK_UNIT + 7)) } : null);
        up.add({ projectId: pid, file: file(3 * OD.CHUNK_UNIT + 7, plan.name), name: plan.name });
        const [job] = await settle(up);
        same(job.state, "done", "replaced: " + job.error);
        same([job.result.mode, job.result.id, job.result.size], ["replace", plan.id, 3 * OD.CHUNK_UNIT + 7], "the plan itself, by its id");
        ok(job.result.version !== plan.version, "a new version");
        if (HAS_COMMIT) {
          const commits = g.calls.filter((c) => c.method === "PUT" && c.body && typeof c.body === "object" && "@microsoft.graph.sourceUrl" in c.body);
          same(commits.length, 1, "committed once, by the broker (Graph's PUT with the session as its source)");
          same(job.result.version, "qx:" + QX.quickXorHash(new Uint8Array(3 * OD.CHUNK_UNIT + 7)), "OneDrive's quickXorHash is the device's (site/js/quickxor.js = quickxor.ts)");
        }
        const now = (await od.plansList([pid]))[String(pid)].files.find((f) => f.id === plan.id);
        same(now.version, job.result.version, "in plans_list's form exactly");
        // the device still has the old version: a copy beside it, never over the newer save
        const up2 = saveOf(plan.version);
        up2.add({ projectId: pid, file: file(100, plan.name), name: plan.name });
        const [copy] = await settle(up2);
        same(copy.state, "done", "a copy: " + copy.error);
        same(copy.result.mode, "copy", "the plan changed since the device got it");
        ok(/ - iPad \d{4}-\d{2}-\d{2} \d{4}\.takeoff$/.test(copy.result.name), "the copy's name: " + copy.result.name);
        same((await od.plansList([pid]))[String(pid)].files.find((f) => f.id === plan.id).version, job.result.version, "the plan untouched");
        // the gate (Q2): prices AND "Can upload to OneDrive"
        for (const k of ["manager", "field"]) {
          client.as(id(k));
          same((await refused(() => od.planSaveSession({ projectId: pid, itemId: plan.id, version: now.version, size: 5 }), "forbidden", k)).status, 403, k);
        }
        client.as(null);
      });
      if (!HAS_COMMIT) {
        results.push({ section, name: "the save back's review round: op plan_save_commit is not in DCR Desktop 2's broker yet - its check waits for it", ok: true });
      } else {
        await check("the save back's review round (contract addendum 2, C1b) through Portal 2's parts over the REAL broker: an office save during the upload makes the same upload a copy; a desktop-style save (the old item into Backup, a new one on the name) a copy found by name; an identical re-save is saved; a commit whose answer was lost settles with plan_save_done and the hash", async () => {
          client.as(id("admin"));
          // plans_list answers are kept 2 minutes by the broker: each look is past that (the broker's own clock)
          const files = async () => { clock.t += 3 * 60 * 1000; return (await od.plansList([pid]))[String(pid)].files; };
          const tf = g.child(g.takeoff.id, made.number + " - 1 Made Up Way - Testville");
          ok(!!tf, "the made-up project's takeoff folder (the plan buttons' check made it)");
          const it = g.file(tf.id, made.number + " Walls.takeoff", 10);
          const plan = (await files()).find((x) => x.id === it.id);
          ok(!!plan, "a made-up plan for these checks");
          const bytesN = (n, v) => new Uint8Array(n).fill(v);
          const sendIt = async (base, meta, bytes) => {
            const up = planUploader(it.id, base, meta);
            up.add({ projectId: pid, file: new File([bytes], plan.name), name: plan.name });
            return (await settle(up))[0];
          };
          // (1) the office saves the plan in place while the iPad's replace goes up: the SAME upload is the copy
          const b1 = bytesN(2 * OD.CHUNK_UNIT + 3, 1);
          atLast = () => g.write(it.id, 77);
          const j1 = await sendIt(plan.version, { name: plan.name, hash: QX.quickXorHash(b1) }, b1);
          same([j1.state, j1.result && j1.result.mode], ["done", "copy"], "a copy: " + j1.error);
          ok(/ - iPad \d{4}-\d{2}-\d{2} \d{4}\.takeoff$/.test(j1.result.name), "the copy's name: " + j1.result.name);
          same(j1.result.version, "qx:" + QX.quickXorHash(b1), "the copy holds exactly the save");
          same((await files()).find((x) => x.id === it.id).size, 77, "the office's save is still the plan: never overwritten");
          // (2) a desktop-style save: the old item moved into Backup, a new item on the plan's name - found by the name
          const v2 = (await files()).find((x) => x.id === it.id).version;
          const backup = g.child(tf.id, "Backup") || g.mkdir(tf.id, "Backup");
          g.items.get(it.id).parent = backup.id;
          const fresh = g.file(tf.id, plan.name, 55);
          const b2 = bytesN(OD.CHUNK_UNIT + 9, 2);
          const j2 = await sendIt(v2, { name: plan.name, hash: QX.quickXorHash(b2) }, b2);
          same([j2.state, j2.result && j2.result.mode], ["done", "copy"], "found by name, a copy beside it: " + j2.error);
          same([g.items.get(it.id).size, g.items.get(it.id).parent], [77, backup.id], "the Backup item untouched");
          same((await refused(() => od.planSaveSession({ projectId: pid, itemId: it.id, version: v2, size: 5 }), "not_found", "no name")).status, 404, "without the name: 404");
          // (3) a byte-identical re-save of the new item: replace onto its own bytes - saved, no not_saved, no copy
          const v3 = (await files()).find((x) => x.id === fresh.id).version;
          const b3 = bytesN(OD.CHUNK_UNIT + 1, 3);
          const m3 = { itemId: fresh.id, name: plan.name, hash: QX.quickXorHash(b3) };
          const j3 = await sendIt(v3, m3, b3);
          same([j3.state, j3.result && j3.result.mode, j3.result && j3.result.id], ["done", "replace", fresh.id], "replaced: " + j3.error);
          const j3b = await sendIt(j3.result.version, m3, b3);
          same([j3b.state, j3b.result && j3b.result.mode, j3b.result && j3b.result.version], ["done", "replace", j3.result.version], "the identical re-save: " + j3b.error);
          // (4) the commit landed, its answer lost: plan_save_done with the hash finds it; the commit asked again settles too
          const b4 = bytesN(OD.CHUNK_UNIT + 5, 4);
          const h4 = QX.quickXorHash(b4);
          const s4 = await od.planSaveSession({ projectId: pid, itemId: fresh.id, version: j3b.result.version, size: b4.length, name: plan.name });
          same([s4.mode, s4.commit], ["replace", "broker"], "a deferred replace");
          const put = (a, z, body) => transport({ method: "PUT", url: s4.uploadUrl, headers: { "Content-Range": "bytes " + a + "-" + z + "/" + b4.length }, body });
          same((await put(0, OD.CHUNK_UNIT - 1, new Blob([b4.subarray(0, OD.CHUNK_UNIT)]))).status, 202, "a chunk");
          same((await put(OD.CHUNK_UNIT, b4.length - 1, new Blob([b4.subarray(OD.CHUNK_UNIT)]))).status, 202, "the last chunk commits nothing");
          same((await refused(() => od.planSaveDone(pid, fresh.id, s4.ticket, h4), "not_saved", "before the commit")).status, 409, "nothing landed yet");
          same((await od.planSaveCommit({ projectId: pid, itemId: fresh.id, ticket: s4.ticket, uploadUrl: s4.uploadUrl, hash: h4 })).mode, "replace", "committed");
          same((await od.planSaveDone(pid, fresh.id, s4.ticket, h4)).mode, "replace", "settled by plan_save_done with the hash");
          same((await od.planSaveCommit({ projectId: pid, itemId: fresh.id, ticket: s4.ticket, uploadUrl: s4.uploadUrl, hash: h4 })).mode, "replace", "the commit asked again: settled, no copy");
          same((await refused(() => od.planSaveDone(pid, fresh.id, s4.ticket, QX.quickXorHash(b3)), "not_saved", "another hash")).status, 409, "another hash is not this save");
          client.as(null);
        });
      }
      if (!HAS_SWITCH) {
        results.push({ section, name: "the save back's repair round: the broker has no save_back_off yet (contract addendum 3) - its check waits for it", ok: true });
      } else {
        await check("the save back's repair round (contract addendum 3) through Portal 2's parts over the REAL broker: the switch (off: save_back false, 503 save_back_off; only:<number>); every replace checked by the version history - OneDrive ignoring the deferral with an office save during the upload is put back and sent as a copy (landed), a refused PUT commits by the POST (verified), both refused is plan_changed why refused, no history is unverified; a hashless deferred ticket past 48 hours needs the hash", async () => {
          client.as(id("admin"));
          const files = async () => { clock.t += 3 * 60 * 1000; return (await od.plansList([pid]))[String(pid)]; };
          const tf = g.child(g.takeoff.id, made.number + " - 1 Made Up Way - Testville");
          ok(!!tf, "the made-up project's takeoff folder");
          const it = g.file(tf.id, made.number + " Roof.takeoff", 10);
          const planOf = async () => (await files()).files.find((x) => x.id === it.id);
          const reset = () => Object.assign(g.script, { deferCommit: "honoured", putCommit: "accepted", putIfMatch: "honoured", postIfMatch: "honoured", postStatus: 0,
            versions: "on", restoreStatus: 0 });
          const sendIt = async (meta, bytes) => {
            const plan = await planOf();
            const up = planUploader(it.id, plan.version, Object.assign(meta, { name: plan.name, hash: QX.quickXorHash(bytes) }));          // (meta: the check reads its why after)
            up.add({ projectId: pid, file: new File([bytes], plan.name), name: plan.name });
            return (await settle(up))[0];
          };
          const bytesN = (n, v) => new Uint8Array(n).fill(v);
          try {
            // (D1) the switch: off - save_back false for the admin, plan_save_session 503 save_back_off; only another project's
            // number - the same; only this one's - on
            for (const [v, on] of [["off", false], ["only:A999T9", false], ["only:" + made.number, true], ["not a setting", false], [undefined, true]]) {
              planSave = v;
              const p = await files();
              same(p.saveBack, on, "plans_list save_back, " + String(v));
              same((await od.planLink(pid, it.id)).saveBack, on, "plan_link save_back, " + String(v));
              if (!on) same((await refused(() => od.planSaveSession({ projectId: pid, itemId: it.id, version: p.files.find((x) => x.id === it.id).version, size: 5 }), "save_back_off", String(v))).status, 503, String(v));
            }
            ok(logs.some((l) => /ONEDRIVE_PLAN_SAVE not understood: off/.test(l)) && !logs.some((l) => /not a setting/.test(l)), "a setting not understood is said, never its value");
            planSave = undefined;
            // (D3) OneDrive ignoring the deferral, an office save landing during the upload: the last chunk commits over it (200);
            // Portal 2 says so (landed), the broker's version check finds the office save under it, puts it back, and the
            // same save goes again as a copy - the office save stays the plan
            reset();
            g.script.deferCommit = "ignored";
            logs.length = 0;
            atLast = () => { clock.t += 5000; g.write(it.id, 77); };
            const b1 = bytesN(2 * OD.CHUNK_UNIT + 5, 31);
            const m1 = {};
            const j1 = await sendIt(m1, b1);
            same([j1.state, j1.result && j1.result.mode, m1.why], ["done", "copy", "changed"], "a copy: " + j1.error);
            ok(logs.some((l) => /OneDrive committed at the last chunk: deferCommit not honoured here/.test(l)), "the broker heard landed");
            ok(logs.some((l) => /crossed: the office save was put back/.test(l)), "and put the office save back");
            same((await planOf()).size, 77, "the office save is the plan again");
            same(j1.result.version, "qx:" + QX.quickXorHash(b1), "the copy holds exactly the save");
            // (D2 attempt B) the PUT commit refused (a OneDrive that commits a deferred session by its POST only): the POST
            reset();
            g.script.putCommit = "refused";
            logs.length = 0;
            clock.t += 5000;
            const b2 = bytesN(OD.CHUNK_UNIT + 7, 32);
            const j2 = await sendIt({}, b2);
            same([j2.state, j2.result && j2.result.mode, j2.result && j2.result.verified], ["done", "replace", true], "replaced by the POST: " + j2.error);
            ok(logs.some((l) => /the PUT commit was refused \(400\): the POST commit/.test(l)), "the PUT, then the POST");
            // (D5) both refused: plan_changed {why: "refused"} - sent again as a copy, nobody blamed
            g.script.postStatus = 400;
            clock.t += 5000;
            const m3 = {};
            const j3 = await sendIt(m3, bytesN(OD.CHUNK_UNIT + 9, 33));
            same([j3.state, j3.result && j3.result.mode, m3.why], ["done", "copy", "refused"], "a copy: " + j3.error);
            // no version history to read: saved, verified false (the go-live self-test's line)
            reset();
            g.script.versions = "failing";
            logs.length = 0;
            clock.t += 5000;
            const j4 = await sendIt({}, bytesN(OD.CHUNK_UNIT + 11, 34));
            same([j4.state, j4.result && j4.result.mode, j4.result && j4.result.verified], ["done", "replace", false], "unverified: " + j4.error);
            ok(logs.some((l) => /version history not available: unverified/.test(l)), "said in the log");
            // (D4) a deferred replace's ticket past 48 hours without a hash: not_saved {need: "hash"}
            reset();
            const p5 = await planOf();
            const s5 = await od.planSaveSession({ projectId: pid, itemId: it.id, version: p5.version, size: 9, name: p5.name });
            same(s5.commit, "broker", "a deferred replace");
            clock.t += 49 * 3600 * 1000;
            const e5 = await refused(() => od.planSaveDone(pid, it.id, s5.ticket), "not_saved", "48 hours, no hash");
            same([e5.status, e5.info && e5.info.need], [409, "hash"], "the hash is needed");
          } finally {
            reset();
            atLast = null;
            planSave = undefined;
          }
          client.as(null);
        });
      }
    }
  } finally {
    takeoffSet = true;
    client.functions = before;
    client.as(null);
  }
}
