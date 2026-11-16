/* DCR Portal 2 — the photo files' calls against the REAL database rules (development only): the photographer screen
   program, P5 part of tools/schema-check.mjs (it calls run() with its own helpers, after the P3 part), the OneDrive
   edition. site/js/repo/photo-files.js, site/js/map/photo-files.js and site/js/photo-send.js run over PGlite loaded with
   every DCR Desktop 2 migration - BOTH photo files migrations in order: 20261111000100_photo_files (live, Google-shaped,
   docs/PHOTO-FILES.md) and 20261114000100_photo_files_onedrive over it (the contract docs/PHOTO-FILES-ONEDRIVE.md, cited
   OD) - as made-up people of their own: an admin, a photographer, two marketing members (one marked shared), and a lead on
   no team. What photo-files would hand the database (OD §4, §5.5) is its own service-role SQL here - app.gdrive_root_seen,
   gdrive_folder_lease / gdrive_folders_seen, gdrive_send_context, gdrive_sessions_made, gdrive_items_seen,
   gdrive_check_apply - with made-up items (FAKEITEM...), quickXorHash-shaped made-up hashes (FAKEqx...=) and the made-up
   host example-my.sharepoint.com; nothing reaches Microsoft.

   * names: every argument repo/photo-files.js sends exists, in the migrations' order, with the demo's optional ones;
     every code photo-files answers (OD §4.7's table, and handler.ts when DCR Desktop 2 holds it) is known to the module;
     every completion code and every hint the phone's RPCs raise has words;
   * a world driven the way the apps drive it - DCR Agents 2's mirror (the lease holder), the root seen, the mode on with
     the phone switch, the company's e-mail domain and a member marked shared, a PC hand-in begun, recorded with its hashes
     and sealed, the folders made, its sessions, each file read by id (done) and a complete check - and the phone's ONE
     read, photo_drive_status, at each step put into words by the contract's chooser (every placeholder filled): sending,
     then all in OneDrive (mark it done), then sent to marketing with who was told (an admin's);
   * who reads: admins, the photographer and marketing; a lead reads nothing (42501 forbidden on both reads); Open in
     OneDrive only for the account marked shared (can.open_folder / can.open); the photographer gets no act;
   * the access lines (OD §8.2, §8.4, cases access_line): waiting (wanted, not marked yet), not_company (an account outside
     the company's domains) and shared, on the card and in the Files section, in the cases' words;
   * the Ready list's lifecycle as two marketing members and an admin (KEEP, PF §8.12): I'm on it, taken {by, at}, Take it
     over, not_yours, Posted (where, an https link, a note; bad_where, bad_link), Not posted yet, Not for posting (a
     reason), Back on the list, the same act again, a stale state (changed); who was told answered to admins only; the
     resends of rounds 11 and 12 - in both databases;
   * marketing's culls (cases v19, v20): a file read gone by id after the first complete check after Ready is files.culled
     and the phone's line calm (confirmed_culled), one first seen gone by that check the photographer's; the demo's culled
     shoot the same; a card claimed by someone taken off marketing or turned off back to ready, in both databases;
   * a skipped shoot with files: closed_files, Mark done… offered and the database's own preview of the done not refused;
   * the Realtime watch joining the three tables' private channels;
   * a shoot marked done before its folder is in OneDrive (§10.1 rule 3): no row, the rows claimed by a hand-in begun,
     handed in, sending - what the shoot needs, never folder_problem - and the demo database the same at each step;
   * the phone's hand-in (OD §3.3) over the real migrations: js/photo-send.js with repo/photo-files.js's RPCs
     (photo_upload_begin with p_source 'phone' - the phone switch first -, photo_upload_files with NO hash and files[] by
     i, photo_upload_beat, photo_upload_seal, photo_shoot_files_page) and photo-files' sessions / done / find played by
     their own service-role SQL (app.gdrive_send_context, gdrive_sessions_made, gdrive_items_seen) over an in-memory
     upload address: every file confirmed on the phone's own hash, the seal's counts, the phone's lines; the OneDrive
     review's round 5 (OD §23) over the real SQL - the page's Cancel it while it holds the files counts its own file in
     OneDrive, never the one in flight the cancel's removed_sent counts (a session handed out); waiting_turn never moves an
     open hand-in's running clock; a sealed PC hand-in's fresh lost beat is app.photo_help_now's lost, the chip "Memory
     card needed" beside lost_here, gone with a stale beat; the round 6 (OD §24) - Cancel it pressed as a one-chunk
     photo's last chunk lands, its answer cut off, counts that photo (find, gated as handler.ts gates it, asked before the
     cancel: after it, refused upload_closed); an open PC hand-in's running clock moves only when bytes_sent grew; the
     cancel's put back rule 0 (a broken copy waiting for its resend back at to_send with its item and pending Replace);
     the round 8 (OD §26) - files.stalled and app.photo_help_now's stalled only while a stalled row is left (the stalled
     files sent before the next tick: the stamp stays, the line and the help let it go), and the sending line's totals
     from uploads[].send_files / send_bytes (a file left out during the send, photo_files_resolve, out of them); the
     round 9 (OD §27) - a row stalled 14 days after its hand-in's own last progress too (its PC sending it again: no
     stalled row, files.stalled, help stalled nor stalled line), photo_upload_beat answering upload.shoot_id,
     app.photo_help_now's late and stalled only while the sealed files wait (a problem alone while it speaks), and
     app.gdrive_items_seen keeping DCR's own item on a row of its hand-in left out meanwhile (committed, still
     not_waiting; never an item not made by DCR nor another row's); the round 10 (OD §28) - photo_upload_beat taking
     disk_full (a PC's disk full while it sends) and the phone's line saying so while the beat is fresh, even once late
     is stamped (5 minutes old: late, or paused_pc), and app.photo_row_stalled never holding a row of a hand-in queued
     behind a send of its own computer (its own last beat waiting_turn, another hand-in of that computer beating sending
     under 2 minutes old) - stalled again once that send's beat is old, and for a hand-in with no such beat;
   * drift: the demo database's answers (tools/fake/p10-photo-files.js) have the real answers' keys - the status, the
     Ready list and its items, an act's answer and refusal, and the phone's RPCs (begin, files, beat, seal, cancel - its
     removed_sent and put_back_ids, review round 4 -, the files page) - and its codes are the migrations'; every beat
     state repo/photo-files.js knows (waiting_turn and disk_full too) taken by both; the cancel's removed_sent counting a session handed
     out in both (review round 5); an open PC hand-in's running clock and the put back's rule 0 the same in both (review
     round 6); the stalled line's rows (review round 7), files.stalled and the help stalled while a stalled row is left
     and send_files / send_bytes (review round 8), and the round 9 and round 10 worlds above (review rounds 9 and 10)
     the same in both.
   Made-up people, jobs, items and hashes only. */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOST = "SCHEMA-PHOTO-PC#agents2";                 // the P3 part's lease holder and ledger
const LEDGER = "c2100000-0000-4000-8000-0000000000a1";
const MIGRATION = "20261111000100_photo_files.sql";
const ONEDRIVE = "20261114000100_photo_files_onedrive.sql";
const DEV = { ph: "pk_SchemaPhotoPc000000001", phone: "pk_SchemaPhone00000000001" };
const QX = (n) => "FAKEqx" + String(n).padStart(21, "0") + "=";
const ITEM = (n) => "FAKEITEM" + String(n).padStart(14, "0");
const ROOT_LINK = "https://example-my.sharepoint.com/personal/office_example_com/Documents/DCR%20Photo%20%26%20Video";
const link = (...parts) => [ROOT_LINK].concat(parts.map((p) => encodeURIComponent(p).replace(/%5B/g, "[").replace(/%5D/g, "]"))).join("/");
const U = 327680;

export async function run(h) {
  const { check, results, section, as, client, sql, PEOPLE, ok, same, refused, catalog, SITE, D2 } = h;
  const migFile = (f) => path.join(D2, "supabase", "migrations", f);
  if (!(catalog.functions.photo_drive_status && catalog.functions.photo_ready_list && catalog.functions.photo_marketing_act)) {
    results.push({ section, name: "The photo files (" + MIGRATION + ") are not in DCR Desktop 2 yet: these checks wait for them", ok: true });
    return;
  }
  if (!existsSync(migFile(ONEDRIVE)) || !catalog.functions.photo_upload_beat) {
    results.push({ section, name: "The photo files' OneDrive edition (" + ONEDRIVE + ") is not in DCR Desktop 2 yet: these checks wait for it", ok: true });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const R = await site("repo/photo-files.js");
  const F = await site("map/photo-files.js");
  const photo = await site("repo/photo.js");
  const M = await site("map/photo.js");
  const P = await site("photo-send.js");
  await site("quickxor.js");
  const { ONEDRIVE_HOST } = await site("repo/onedrive.js");
  // both migrations' text: a function's body is the last one written (the OneDrive edition's when it re-made it)
  const texts = [readFileSync(migFile(ONEDRIVE), "utf8"), readFileSync(migFile(MIGRATION), "utf8")];
  const body = (name) => {
    for (const t of texts) {
      const at = t.lastIndexOf("create or replace function " + name + "(");
      if (at === -1) continue;
      const end = t.indexOf("$$;", t.indexOf("$$", at) + 2);
      return t.slice(at, end);
    }
    return "";
  };
  const contract = (() => { try { return readFileSync(path.join(D2, "docs", "PHOTO-FILES-ONEDRIVE.md"), "utf8"); } catch (e) { return ""; } })();
  const handlerFile = path.join(D2, "supabase", "functions", "photo-files", "handler.ts");
  const handler = existsSync(handlerFile) ? readFileSync(handlerFile, "utf8") : "";
  const keysOf = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).sort() : null);

  /* ── made-up people of this part ── */
  const MINE = {
    fph: { id: "c2000000-0000-4000-8000-0000000000d1", name: "Pat Lens", role: "field" },
    fmk1: { id: "c2000000-0000-4000-8000-0000000000d2", name: "Mo Ready", role: "viewer" },
    fmk2: { id: "c2000000-0000-4000-8000-0000000000d3", name: "Kim Post", role: "viewer" },
  };
  await sql("reset role");
  for (const [k, p] of Object.entries(MINE)) await sql("insert into auth.users (id, email) values ($1, $2)", [p.id, "p5b-" + k + "@schema-check.test"]);
  await sql("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: PEOPLE.admin.id, role: "authenticated" })]);
  await sql("set role authenticated");
  for (const [k, p] of Object.entries(MINE)) {
    await sql("insert into public.profiles (id, full_name, email, role, active) values ($1, $2, $3, $4, true)", [p.id, p.name, "p5b-" + k + "@schema-check.test", p.role]);
  }
  await sql("reset role");
  await sql("select set_config('request.jwt.claims', '', false)");
  Object.assign(PEOPLE, MINE);

  const rpcAs = async (who, name, args) => {
    client.as(PEOPLE[who].id);
    const r = await client.rpc(name, args);
    if (r.error) throw Object.assign(new Error(r.error.message), r.error);
    return r.data;
  };
  /** photo-files' own SQL: the service role, no JWT on the connection (sql.ts) - in the client's turn (PGlite has one
      connection: a phone's beat may be on its way meanwhile) */
  const svc = (fn, args) => client.run(async () => {
    await sql("set role service_role");
    try {
      const text = "select app." + fn + "(" + args.map((a, i) => "$" + (i + 1) + "::" + a[1]).join(", ") + ") as v";
      return (await sql(text, args.map((a) => (a[0] === null || a[0] === undefined ? null : a[1] === "jsonb" ? JSON.stringify(a[0])
        : a[1].endsWith("[]") && Array.isArray(a[0]) ? "{" + a[0].join(",") + "}" : a[0]))))[0].v;
    } finally { await sql("reset role"); }
  }, "owner");
  /** a read of the tables as their owner, in the client's turn */
  const q = (text, params) => client.run(() => sql(text, params), "owner");
  const today = (await sql("select app.today()::text as d"))[0].d;
  const addDays = (k, d) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + d)).toISOString().slice(0, 10);
  let REV = 7000;
  const PLAN = { local_id: 901, status: "active", project_code: "A000T5", project_label: "A000T5 Sample cabin", city: "Pine Hollow", title: "Cabin photo plan",
    photographer: "Pat Lens", photographer_source: "plan",
    milestones: { framing_start: { date: addDays(today, -10), source: "admin", confirmed: true }, delivery: { date: addDays(today, -12), source: "admin", confirmed: true },
      framing_complete: { date: addDays(today, 20), source: "estimate", confirmed: false }, house_complete: { date: null, source: "estimate", confirmed: false } },
    shoot_days: [0, 1, 2, 3, 4, 5], lead_days: 3, series: [], open_suggestions: 0, activated_at: new Date(Date.now() - 20 * 86400e3).toISOString() };
  const SHOOTS = {
    delivery: { local_id: 1, key: "delivery", seq: 100, phase: "delivery", name: "Delivery day", anchor: "fixed", offset_days: 0, fixed_date: addDays(today, -1),
      planned_date: addDays(today, -1), window_days: 0, status: "planned" },
    skipped: { local_id: 2, key: "before-framing", seq: 50, phase: "before_framing", name: "Before framing", anchor: "fixed", offset_days: 0,
      fixed_date: addDays(today, -12), planned_date: addDays(today, -12), window_days: 1, status: "skipped", auto_skipped: true, done_source: "schedule",
      done_note: "phase already passed" },
    phone: { local_id: 4, key: "framing-progress", seq: 120, phase: "framing_progress", name: "Framing progress", anchor: "fixed", offset_days: 0, fixed_date: today,
      planned_date: today, window_days: 0, status: "planned" },
  };
  const shootJson = (s) => Object.assign({ auto_skipped: false, pin_day: null, series: null, n: 0, announced_for: null, done_at: null, done_source: null,
    done_note: null, task_id: null, brief: {}, history: [] }, s);
  const mirror = async () => rpcAs("agents", "agents_photo_mirror", { p_host: HOST, p_ledger: LEDGER, p_plan: PLAN, p_shoots: Object.values(SHOOTS).map(shootJson), p_rev: ++REV });
  const S = {};
  const W = {};

  /* the OneDrive side, as photo-files hands it to the database (DCR Desktop 2's tools/pglite_check/photo_files_world.mjs) */
  let FOLDER_N = 0;
  /** the shoot's job and shoot folders made in OneDrive (each with its lease) -> {job, shoot} folder ids */
  const foldersMade = async (shootId) => {
    const f = (await q("select id, parent_id, name, drive_id from public.photo_drive_folders where shoot_id = $1 and kind = 'shoot' and retired_at is null", [shootId]))[0];
    const j = (await q("select id, name, drive_id from public.photo_drive_folders where id = $1", [f.parent_id]))[0];
    const made = [];
    if (!j.drive_id) {
      await svc("gdrive_folder_lease", [[j.id, "bigint"], [120, "integer"]]);
      made.push({ folder_id: Number(j.id), drive_id: ITEM(9000 + (++FOLDER_N)), name: j.name, path: j.name, link: link(j.name) });
    }
    if (!f.drive_id) {
      await svc("gdrive_folder_lease", [[f.id, "bigint"], [120, "integer"]]);
      made.push({ folder_id: Number(f.id), drive_id: ITEM(9500 + (++FOLDER_N)), name: f.name, path: j.name + "/" + f.name, link: link(j.name, f.name) });
    }
    if (made.length) await svc("gdrive_folders_seen", [[made, "jsonb"]]);
    return { job: Number(j.id), shoot: Number(f.id) };
  };
  /** an item read by id: DCR's, in the shoot folder, a plain file - unless said otherwise */
  const okItem = (id, size, md5, extra) => Object.assign({ status: "ok", id, file: true, in_folder: true, by_app: true, size, md5,
    ctag: "FAKEctag-" + id.slice(-4), path: "IMG.JPG" }, extra || {});
  const rowsOf = (upload) => q("select id, path, size, md5, state, upload_step from public.photo_shoot_files where last_upload_id = $1 order by id", [upload]);
  const begin = (who, shoot, clientKey, device, o) => rpcAs(who, "photo_upload_begin", { p_shoot: shoot, p_client_key: clientKey, p_device_key: device,
    p_device_label: (o && o.label) || "PHOTO-PC", p_source: (o && o.source) || "pc", p_replaces: null });
  /** a PC hand-in all the way to confirmed in OneDrive: begun, recorded with its hashes, sealed, the folders made, a
      session per file, each item read by id (done) and a complete check that lists them -> {upload, folder, rows} */
  async function handInConfirmed(who, shoot, clientKey, list) {
    const b = await begin(who, shoot, clientKey, DEV.ph);
    const up = Number(b.upload.id);
    await rpcAs(who, "photo_upload_files", { p_upload: up, p_files: list.map((f) => ({ path: f.path, size: f.size, md5: f.md5 })) });
    await rpcAs(who, "photo_upload_seal", { p_upload: up, p_files: list.length, p_bytes: list.reduce((t, f) => t + f.size, 0) });
    const folders = await foldersMade(shoot);
    const rows = await rowsOf(up);
    await svc("gdrive_sessions_made", [[PEOPLE[who].id, "uuid"], [up, "bigint"], [rows.map((r) => ({ file_id: Number(r.id), step: "session" })), "jsonb"]]);
    await svc("gdrive_items_seen", [[PEOPLE[who].id, "uuid"], [up, "bigint"], [rows.map((r, k) => ({ file_id: Number(r.id),
      item: okItem(list[k].item, list[k].size, list[k].md5, { path: list[k].path }) })), "jsonb"]]);
    const check = await svc("gdrive_check_apply", [[folders.shoot, "bigint"], [{ complete: true, folder: { state: "found" }, reads: [],
      items: list.map((f) => ({ id: f.item, size: f.size, md5: f.md5 })) }, "jsonb"], [null, "uuid"]]);
    return { upload: up, folder: folders.shoot, job: folders.job, rows: rows.map((r) => Number(r.id)), check };
  }

  /* the demo database: the same states, to compare the answers' shapes */
  const H = await import(pathToFileURL(path.join(SITE, "..", "tests", "pages-engine.mjs")).href);
  const demo = await H.freshEngine(new Date());
  const NS = globalThis.DCR2Fake;
  const _db = await site("repo/_db.js");
  const demoAs = async (key, fn) => {
    _db.useClient(H.clientAs(demo, NS.PEOPLE.find((p) => p.key === key).id));
    try { return await fn(); } finally { _db.useClient(null); }
  };
  const demoShoot = (code, key) => {
    const plan = demo.rows.photo_plans.find((p) => p.project_code === code);
    return demo.rows.photo_shoots.find((s) => s.plan_id === plan.id && s.key === key).id;
  };

  try {
    await check("P10 photo files: the names - every argument repo/photo-files.js sends exists in the migrations' order, with the demo's optional ones; every code photo-files answers (OD §4.7) is the module's", async () => {
      for (const [fn, args] of Object.entries(R.RPC_ARGS)) {
        const real = (catalog.functions[fn] || []).map((f) => f.args.map((a) => a.name));
        same(real, [args], fn);
        // (photo_drive_overview, the Access tab's share lines: not in the demo database - its Access tab shows none)
        if (fn === "photo_drive_overview") { same(NS.p10FilesSigs[fn], undefined, "the demo has no " + fn); continue; }
        same(NS.p10FilesSigs[fn], args, "the demo's " + fn);
        const defaults = (catalog.functions[fn] || [])[0].args.filter((a) => !a.required).map((a) => a.name);
        if (defaults.length) same((NS.p10FilesOptional[fn] || []).slice().sort(), defaults.slice().sort(), "the demo's optional arguments of " + fn);
      }
      // OD §4.7's table: each row's codes
      const at = contract.indexOf("### 4.7 Errors");
      const table = at === -1 ? "" : contract.slice(at, contract.indexOf("Graph's answers map once", at));
      const codes = new Set(Array.from(table.matchAll(/`([a-z_]+)`/g)).map((m) => m[1]).filter((c) => !/^\d/.test(c)));
      ok(codes.size >= 15, "OD §4.7's codes read: " + Array.from(codes).join(", "));
      for (const c of codes) {
        if (["field", "max_bytes", "why"].indexOf(c) !== -1) continue;        // (an answer's extra keys, not codes)
        ok(R.CODES.indexOf(c) !== -1 || c === "upload_closed" || c === "bad_files", "photo-files' " + c + " is known to repo/photo-files.js");
      }
      if (handler) {
        for (const m of handler.matchAll(/fail\('([a-z_]+)'/g)) ok(R.CODES.indexOf(m[1]) !== -1, "handler.ts's " + m[1] + " is known to repo/photo-files.js");
        ok(/Access-Control-Expose-Headers/.test(handler) && /Retry-After/.test(handler), "photo-files exposes Retry-After to Portal 2's origin (OD §4.4)");
      }
    });

    await check("P10 photo files: the words - every completion code of app.photo_completion_code (the OneDrive edition's), and every hint the phone's RPCs raise, has its words", async () => {
      const cc = body("app.photo_completion_code");
      ok(cc.length > 100 && cc.indexOf("mode") !== -1, "app.photo_completion_code found (the OneDrive edition's: its mode)");
      const said = new Set(Array.from(cc.matchAll(/(?:then|else) '([a-z_]+)'/g)).map((m) => m[1]));
      ok(said.size >= 12, "its codes: " + Array.from(said).join(", "));
      for (const c of said) ok(typeof F.WORDS.completion[c] === "string", "completion." + c);
      for (const st of ["ready", "claimed", "posted", "passed", "withdrawn"]) ok(typeof F.WORDS.completion[st] === "string", "completion." + st + " (the list row's state)");
      const hints = new Set();
      for (const fn of ["public.photo_drive_status", "public.photo_ready_list", "public.photo_marketing_act", "app.photo_drive_status_json", "public.photo_upload_begin",
        "public.photo_upload_files", "public.photo_upload_beat", "public.photo_upload_seal", "public.photo_upload_cancel", "public.photo_shoot_files_page"]) {
        const b = body(fn);
        ok(b.length > 50, fn + " found");
        for (const m of b.matchAll(/hint = '([a-z_]+)'/g)) hints.add(m[1]);
        for (const m of b.matchAll(/photo_refuse\('[0-9A-Z]{5}', '([a-z_]+)'/g)) hints.add(m[1]);
      }
      // the phone says every refusal in the cases' words (js/photo-send.js stopLine): hint.<code>, or what it does
      // instead (count_mismatch: sealed with the database's own count; empty: cancelled; bad_*: shapes it never sends;
      // no_upload / too_big: its own hand-in gone or a call too big - hint.other, "that couldn't be done")
      const SAID_OTHERWISE = ["count_mismatch", "empty", "too_big", "no_upload"];
      const without = Array.from(hints).filter((c) => typeof F.WORDS.hint[c] !== "string" && !c.startsWith("bad_") && SAID_OTHERWISE.indexOf(c) === -1);
      same(without, [], "the refusals without words");
      for (const c of NS.p10FilesCodes) ok(hints.has(c) || texts.some((t) => t.includes("'" + c + "'")), "the demo's " + c + " is the migrations'");
      ok(["taken", "not_yours", "too_late", "changed", "phone_off", "uploads_off", "uploads_test", "open_elsewhere", "stopped_elsewhere"].every((c) => hints.has(c)),
        "the refusals found: " + Array.from(hints).join(", "));
    });

    await check("P10 photo files: a world as the apps make it - the team, DCR Agents 2's mirror, the root seen, the mode on with the phone switch, the company's domain and a member marked shared, a PC hand-in sealed, its folders made and its sessions (photo-files' own SQL for what OneDrive says)", async () => {
      await as("admin");
      await photo.setTeam(MINE.fph.id, { photographer: true, marketing: false }, null);
      await photo.setTeam(MINE.fmk1.id, { photographer: false, marketing: true, googleEmail: "mo.ready@example.com" }, null);
      await photo.setTeam(MINE.fmk2.id, { photographer: false, marketing: true, googleEmail: "kim.post@example.com" }, null);
      // DCR Agents 2 holds the DCR server lease (the P3 part's host and ledger)
      await sql("reset role");
      await sql("update app.agents_lease set host_id = $1, since = now(), lease_by = 'schema-check' where id = 1", [HOST]);
      await sql("delete from app.agents_hosts where host_id = $1", [HOST]);
      await sql("insert into app.agents_hosts (host_id, at, version, proto, standby, payload) values ($1, now() - interval '1 minute', '2.2.0', 1, false, '{\"paused\": false}')", [HOST]);
      const m = await mirror();
      ok(m.ok, "mirrored: " + JSON.stringify(m).slice(0, 160));
      W.plan = m.plan_id;
      for (const s of m.shoots) S[Object.keys(SHOOTS).find((k) => SHOOTS[k].local_id === s.local_id)] = s.id;
      ok(S.delivery && S.skipped && S.phone, "the three shoots");
      // before any root: not connected (the phone's line), nothing to check; the mode answered always (OD §10.6)
      await as("fmk1");
      const none = await R.status(S.delivery);
      same([none.root, none.folder, none.files.state, none.mode], [null, null, "none", "off"], "no root yet, uploads off");
      same(F.filesLine(none, { app: "portal2" }), ["not_connected"], "not_connected");
      // photo-files' health: the root seen (that IS connect, OD §4.5); an admin turns uploads on, and phones too
      const seen = await svc("gdrive_root_seen", [[{ state: "found", drive_id: ITEM(1), name: "DCR Photo & Video", link: ROOT_LINK }, "jsonb"]]);
      ok(seen.ok && seen.root && seen.root.state === "found", "connected: " + JSON.stringify(seen).slice(0, 160));
      await as("fph");
      await refused(() => rpcAs("fph", "photo_files_set_mode", { p_mode: "on", p_phone: true }), "42501", "the mode is an admin's");
      const md = await rpcAs("admin", "photo_files_set_mode", { p_mode: "on", p_phone: true });
      ok(md && typeof md === "object", "the mode set: " + JSON.stringify(md).slice(0, 160));
      // the company's e-mail domain; Mo's account marked shared by an admin (the office shares by hand, OD §8)
      const dm = await rpcAs("admin", "photo_drive_set_domains", { p_domains: "example.com" });
      ok(Array.isArray(dm.share_list), "the share list: " + JSON.stringify(dm).slice(0, 160));
      const mo = dm.share_list.find((x) => x.profile_id === MINE.fmk1.id);
      same([mo && mo.account, mo && mo.not_company, mo && mo.todo], ["mo.ready@example.com", false, "give"], "Mo: to give");
      const mk = await rpcAs("admin", "photo_share_mark", { p_profile: MINE.fmk1.id, p_marked: "shared", p_version: null });
      same(mk.share_list.find((x) => x.profile_id === MINE.fmk1.id).marked, "shared", "Mo marked shared");
      // a PC hand-in: begun (the rows claimed), three files recorded with their hashes, sealed; the folders made
      const u = await begin("fph", S.delivery, "schema-hand-in-1", DEV.ph);
      W.upload = Number(u.upload.id);
      same([u.upload.state, u.upload.source], ["open", "pc"], "begun");
      const r = await rpcAs("fph", "photo_upload_files", { p_upload: W.upload, p_files: [{ path: "IMG_1.JPG", size: 1048576, md5: QX(1) },
        { path: "IMG_2.JPG", size: 2097152, md5: QX(2) }, { path: "Video/C0001.MP4", size: 3145728, md5: QX(3) }] });
      same([r.recorded_files, r.files.map((f) => [f.i, f.verdict, f.send])], [3, [[0, "added", true], [1, "added", true], [2, "added", true]]], "recorded, the ids by i");
      await rpcAs("fph", "photo_upload_seal", { p_upload: W.upload, p_files: 3, p_bytes: 6291456 });
      const fm = await foldersMade(S.delivery);
      W.job = fm.job;
      W.folder = fm.shoot;
      W.rows = (await rowsOf(W.upload)).map((x) => Number(x.id));
      // its sender asks a session for each, and beats: sending
      await svc("gdrive_sessions_made", [[MINE.fph.id, "uuid"], [W.upload, "bigint"], [W.rows.map((id) => ({ file_id: id, step: "session" })), "jsonb"]]);
      await rpcAs("fph", "photo_upload_beat", { p_upload: W.upload, p_state: "sending", p_bytes_sent: 524288, p_sent_files: 0, p_rate_bps: 2000000 });
    });

    await check("P10 photo files: the phone's one read at each step, in the contract's words (every placeholder filled) - sending from the PC, then all in OneDrive (mark it done), then sent to marketing and who was told (an admin's)", async () => {
      F.setStrict(true);
      try {
        await as("fmk1");
        const up = await R.status(S.delivery);
        same([up.mode, up.files.state, up.files.counted, up.files.waiting, up.files.to_send, up.me.drive_access, up.can.open_folder, up.can.check, up.can.hand_in],
          ["on", "waiting", 3, 3, 3, "shared", true, true, false], "sending, as marketing");
        const v = F.filesView(up, { today });
        same(v.lines.map((l) => l.code), ["sending"], "the lines");
        ok(/^Sending to OneDrive from PHOTO-PC: 0 of 3 files \(512 KB of 6 MB\) - about \d+ min left\.$/.test(v.lines[0].text), v.lines[0].text);
        same(v.open, up.folder.link, "Open in OneDrive: the folder's link, link_ok");
        ok(F.linkOk(up.folder.link), "link_ok: " + up.folder.link);
        await as("fph");
        const ph = await R.status(S.delivery);
        same([ph.me.drive_access, ph.can.open_folder, ph.can.hand_in, ph.can.add_from_phone], ["none", false, true, true], "the photographer: not on the share list (M10); may add from a phone");
        same(F.filesLine(ph, { app: "portal2" }), ["sending", "no_access"], "the access line in the link's place");
        // each file read by id (done), then a complete check lists them
        const sizes = [1048576, 2097152, 3145728];
        const paths = ["IMG_1.JPG", "IMG_2.JPG", "Video/C0001.MP4"];
        const seen = await svc("gdrive_items_seen", [[MINE.fph.id, "uuid"], [W.upload, "bigint"], [W.rows.map((id, k) => ({ file_id: id,
          item: okItem(ITEM(100 + k), sizes[k], QX(k + 1), { path: paths[k] }) })), "jsonb"]]);
        same(seen.items.map((x) => x.state), ["confirmed", "confirmed", "confirmed"], "done: read by id, confirmed on the hash");
        const a = await svc("gdrive_check_apply", [[W.folder, "bigint"], [{ complete: true, folder: { state: "found" }, reads: [],
          items: sizes.map((size, k) => ({ id: ITEM(100 + k), size, md5: QX(k + 1) })) }, "jsonb"], [MINE.fmk1.id, "uuid"]]);
        same([a.files.state, a.completion, a.became_ready], ["confirmed", "not_done", false], "confirmed, not done");
        await as("fmk1");
        const conf = await R.status(S.delivery);
        const cv = F.filesView(conf, { today });
        same(cv.lines.map((l) => l.code), ["confirmed"], "all in OneDrive");
        ok(/^All 3 files are in OneDrive ✓ \(checked .+\)\.$/.test(cv.lines[0].text), cv.lines[0].text);
        same(cv.completion && cv.completion.text, F.WORDS.completion.not_done, "mark the shoot done");
        // the office marks it done: DCR Agents 2 mirrors it, the ready check fires once
        SHOOTS.delivery.status = "done";
        SHOOTS.delivery.done_at = new Date().toISOString();
        SHOOTS.delivery.done_source = "shoot page";
        await mirror();
        await as("fmk1");
        const done = await R.status(S.delivery);
        same([done.completion, done.marketing && done.marketing.state], ["ready", "ready"], "sent to marketing");
        // who was told and how is an admin's (P5b review rounds 8 and 9, §41, §42)
        same(done.marketing.told, [], "marketing: who was told is not answered");
        const dv = F.filesView(done, { today });
        ok(/^Sent to marketing .+\.$/.test(dv.completion.text), dv.completion.text);
        same(dv.told, null, "marketing: no told line naming them");
        await as("fph");
        same((await R.status(S.delivery)).marketing.told, [], "the photographer: who was told is not answered");
        await as("admin");
        const ad = await R.status(S.delivery);
        const told = ad.marketing.told.map((t) => t.name);
        ok(told.indexOf("Kim") !== -1 && told.indexOf("Mo") !== -1 && told.length >= 2, "marketing told: " + told.join(", "));
        const av = F.filesView(ad, { today, admin: true });
        ok(/^Told (Mo|Kim) \(.+\) and (Mo|Kim) \(.+\)\.$/.test(av.told) || /^Told .+\.$/.test(av.told), av.told);
        W.done = done;
        W.doneAdmin = ad;
      } finally { F.setStrict(false); }
    });

    await check("P10 photo files: who reads - admins, the photographer and marketing read the status and the Ready list; a lead reads nothing (42501 forbidden); the photographer gets no act; Open in OneDrive only for the account marked shared", async () => {
      await as("lead");
      same((await refused(() => R.status(S.delivery), "42501", "a lead's status")).hint, "forbidden", "status");
      same((await refused(() => R.readyList("open"), "42501", "a lead's list")).hint, "forbidden", "the list");
      await as("admin");
      ok((await R.status(S.delivery)).shoot_id === S.delivery, "an admin reads");
      const la = await R.readyList("open");
      same([la.me.admin, la.me.can_act], [true, true], "an admin acts");
      ok(la.items[0].told.length >= 2, "an admin's card: who was told");
      await as("fph");
      const lp = await R.readyList("open");
      same([lp.me.can_act, lp.items.length], [false, 1], "the photographer reads the list, no act");
      same(lp.items[0].told, [], "the photographer's card: who was told is an admin's (P5b review round 9, §42)");
      same(F.readyCard(lp.items[0], lp.me).buttons, [], "no button: the photographer's account has no folder access either");
      await refused(() => R.act(lp.items[0].id, "claim", "ready"), "42501", "the photographer cannot act");
      await as("fmk1");
      const l1 = await R.readyList("open");
      same([l1.me.drive_access, l1.items[0].can.open], ["shared", true], "Mo's account is marked shared");
      same(l1.items[0].told, [], "marketing's card: who was told is an admin's (§42)");
      ok(F.linkOk(l1.items[0].link), "the card's link passes link_ok");
      same(F.readyView(l1.items[0], l1.me, { today }).link, l1.items[0].link, "the card's Open in OneDrive");
      await as("fmk2");
      same((await R.readyList("open")).items[0].can.open, false, "Kim's account is not marked yet: no link");
      same((await R.status(S.delivery)).me.drive_access, "waiting", "Kim: access on its way");
      W.item = l1.items[0];
    });

    await check("P10 photo files (OD §8.2, §8.4, cases access_line): the access lines - waiting (wanted, not marked yet), not_company (an account outside the company's domains), shared once an admin marks it - on the card and in the Files section, in the cases' words; Open in OneDrive only when shared", async () => {
      F.setStrict(true);
      const team = async (id) => { await sql("reset role"); return (await sql("select version from public.photo_team where profile_id = $1", [id]))[0].version; };
      try {
        for (const [account, access, line, tone] of [["kim.post@example.com", "waiting", "access_waiting", "wait"], ["kim@elsewhere.test", "not_company", "access_not_company", "warn"]]) {
          await as("admin");
          await photo.setTeam(MINE.fmk2.id, { photographer: false, marketing: true, googleEmail: account }, await team(MINE.fmk2.id));
          await as("fmk2");
          const st = await R.status(S.delivery);
          same([st.me.drive_access, st.can.open_folder], [access, false], account + ": " + access + ", no link");
          const v = F.filesView(st, { today });
          same(v.lines.filter((l) => l.code === line).map((l) => [l.text, l.tone]), [[F.WORDS.files[line], tone]], account + ": the Files line");
          same(v.open, null, account + ": no Open in OneDrive");
          const l = await R.readyList("open");
          same([l.me.drive_access, l.items[0].can.open], [access, false], account + ": the Ready list's me");
          const card = F.readyView(l.items[0], l.me, { today });
          same(card.warnings.filter((w) => w.access).map((w) => [w.code, w.text]), [[line, F.WORDS.ready[line]]], account + ": the card");
          ok(!card.buttons.some((b) => b.code === "btn_open") && card.buttons.some((b) => b.code === "btn_claim"), account + ": the acts, no Open in OneDrive");
        }
        // an admin may not mark an account outside the company shared (N3: inside the company only)
        await as("admin");
        const nc = await refused(() => rpcAs("admin", "photo_share_mark", { p_profile: MINE.fmk2.id, p_marked: "shared", p_version: null }), "22023", "not_company");
        same(nc.hint, "not_company", "refused: not a company account");
        // back to the company account, marked shared: the link; then marked removed again (the lifecycle below expects Kim
        // without the folders)
        await photo.setTeam(MINE.fmk2.id, { photographer: false, marketing: true, googleEmail: "kim.post@example.com" }, await team(MINE.fmk2.id));
        const ml = await rpcAs("admin", "photo_share_mark", { p_profile: MINE.fmk2.id, p_marked: "shared", p_version: null });
        const kim = ml.share_list.find((x) => x.profile_id === MINE.fmk2.id);
        same([kim.marked, kim.todo], ["shared", null], "Kim marked shared: nothing to do");
        await as("fmk2");
        const sh = await R.status(S.delivery);
        same([sh.me.drive_access, sh.can.open_folder], ["shared", true], "shared: the link");
        same(F.filesView(sh, { today }).open, sh.folder.link, "Open in OneDrive");
        await as("admin");
        const rm = await rpcAs("admin", "photo_share_mark", { p_profile: MINE.fmk2.id, p_marked: "removed", p_version: kim.version });
        same(rm.share_list.find((x) => x.profile_id === MINE.fmk2.id).todo, "give", "removed while still wanted: to give again");
        await as("fmk2");
        same((await R.status(S.delivery)).me.drive_access, "waiting", "Kim: back to on its way");
      } finally { F.setStrict(false); }
    });

    await check("P10 photo files: the Ready list's lifecycle as two marketing members and an admin - claim, taken {by, at}, take over, not_yours, posted (bad_where, bad_link), reopen, pass (reason_needed), back on the list, again, changed", async () => {
      const id = W.item.id;
      await as("fmk1");
      same((await R.act(id, "claim", "ready")).state, "claimed", "Mo is on it");
      same((await R.act(id, "claim", "ready")).again, true, "the same act again");
      await as("fmk2");
      const t = await refused(() => R.act(id, "claim", "claimed"), "PT409", "taken");
      same([t.hint, t.detail.by, typeof t.detail.at], ["taken", "Mo", "string"], "taken {by, at}");
      ok(/^Mo is already on it \(since .+\)\.$/.test(F.actText(t, "claim", "claimed", { today })), F.actText(t, "claim", "claimed", { today }));
      same((await refused(() => R.act(id, "release", "claimed"), "42501", "not yours")).hint, "not_yours", "not_yours");
      same((await refused(() => R.act(id, "posted", "claimed"), "42501", "not yours")).hint, "not_yours", "posted of another's claim");
      const over = await R.act(id, "claim", "claimed", { takeOver: true });
      same([over.state, over.claimed_by_name], ["claimed", "Kim"], "taken over");
      const ch = await refused(() => R.act(id, "release", "ready"), "PT409", "a stale state");
      same([ch.hint, ch.detail.state, ch.detail.by], ["changed", "claimed", "Kim"], "changed {state, by}");
      same((await refused(() => R.act(id, "posted", "claimed", { where: ["myspace"] }), "22023", "bad where")).hint, "bad_where", "bad_where");
      same((await refused(() => R.act(id, "posted", "claimed", { link: "http://example.com/x" }), "22023", "bad link")).hint, "bad_link", "bad_link");
      const posted = await R.act(id, "posted", "claimed", { where: ["website", "instagram"], link: "https://www.example.com/p/1", note: "The cabin's framing" });
      same(posted.state, "posted", "posted");
      const done = await R.readyList("done");
      const it = done.items.find((x) => x.id === id);
      same([it.posted.where, it.posted.link, it.posted.note, it.posted.you, it.can.reopen], [["instagram", "website"], "https://www.example.com/p/1", "The cabin's framing", true, true],
        "the Done tab's card");
      const pv = F.readyView(it, done.me, { today });
      ok(/^Posted .+ by Kim$/.test(pv.chip.text), pv.chip.text);
      same(pv.buttons.map((b) => b.code), ["btn_reopen"], "Not posted yet (Kim's account has no folder access: no link)");
      // Posted… sent again by who sent it - its first answer lost, the sheet corrected (P5b review round 12, §45): the
      // again keeps what it carries, checked as a first send; a field sent empty keeps the row's
      same((await refused(() => R.act(id, "posted", "claimed", { link: "http://www.example.com/p/2" }), "22023", "a resend's bad link")).hint, "bad_link",
        "a resend is checked as a first send");
      same((await refused(() => R.act(id, "posted", "claimed", { where: ["myspace"] }), "22023", "a resend's bad where")).hint, "bad_where", "bad_where too");
      const pa = await R.act(id, "posted", "claimed", { where: ["facebook", "instagram"], link: "https://www.example.com/p/2", note: "The cabin's framing, all sides" });
      same([pa.again, pa.state], [true, "posted"], "Posted sent again: again");
      same((await R.act(id, "posted", "posted")).again, true, "sent again with nothing: again");
      const pc2 = (await R.readyList("done")).items.find((x) => x.id === id);
      same([pc2.posted.where, pc2.posted.link, pc2.posted.note], [["facebook", "instagram"], "https://www.example.com/p/2", "The cabin's framing, all sides"],
        "the resend's corrections kept; a field sent empty keeps the row's");
      await as("fmk1");
      same((await refused(() => R.act(id, "reopen", "posted"), "42501", "reopen of another's")).hint, "not_yours", "only who posted it, or an admin");
      await as("fmk2");
      same((await R.act(id, "reopen", "posted")).state, "claimed", "Not posted yet: claimed by me");
      // Not for posting… of a card someone else is on: an admin's only, as Posted… (P5b review round 9, §11.2, §42)
      await as("fmk1");
      const np = await refused(() => R.act(id, "pass", "claimed", { note: "Too dark" }), "42501", "pass of another's claim");
      same(np.hint, "not_yours", "not_yours");
      same(F.actText(np, "pass", "claimed", { today }), F.WORDS.ready.not_yours, "in words");
      const fakeNp = await demoAs("viewer", async () => R.act(demo.rows.photo_marketing.find((m) => m.state === "claimed").id, "pass", "claimed",
        { note: "Too dark" }).then(() => null, (e) => e));
      same([fakeNp && fakeNp.code, fakeNp && fakeNp.hint], ["42501", "not_yours"], "the demo database: the same refusal");
      await as("fmk2");
      same((await refused(() => R.act(id, "pass", "claimed", { note: " " }), "22023", "reason")).hint, "reason_needed", "reason_needed");
      same((await R.act(id, "pass", "claimed", { note: "Too dark - reshoot" })).state, "passed", "not for posting");
      same((await R.act(id, "pass", "claimed", { note: "Too dark - reshoot in May" })).again, true, "Not for posting sent again, its reason corrected: again");
      same((await R.readyList("done")).items.find((x) => x.id === id).passed.reason, "Too dark - reshoot in May", "the corrected reason kept");
      await as("admin");
      same((await R.act(id, "reopen", "passed")).state, "ready", "an admin: back on the list");
      // Back on the list sent again, its first answer lost on the way (P5b review round 11, §11.2, §44): {again: true},
      // never "changed" - but another person's send from that same screen state is changed; the demo database the same
      const ag = await R.act(id, "reopen", "passed");
      same([ag.again, ag.state], [true, "ready"], "Back on the list sent again: again");
      await as("fmk2");
      const other = await refused(() => R.act(id, "reopen", "passed"), "PT409", "another person's Back on the list of that screen state");
      same([other.hint, other.detail.state], ["changed", "ready"], "another person's: changed");
      const dm = demo.rows.photo_marketing.find((m) => m.state === "ready");
      await demoAs("viewer", () => R.act(dm.id, "pass", "ready", { note: "Too dark - reshoot" }));
      same((await demoAs("admin", () => R.act(dm.id, "reopen", "passed"))).state, "ready", "the demo: an admin's Back on the list");
      const dag = await demoAs("admin", () => R.act(dm.id, "reopen", "passed"));
      same([dag.again, dag.state], [true, "ready"], "the demo: Back on the list sent again is again");
      const dother = await demoAs("viewer", () => R.act(dm.id, "reopen", "passed").then(() => null, (e) => e));
      same([dother && dother.code, dother && dother.hint], ["PT409", "changed"], "the demo: another person's is changed");
      await as("admin");
      W.act = await R.act(id, "claim", "ready");
      same(W.act.state, "claimed", "an admin is on it");
      // the demo database's again keeps what the resend carries too (round 12, §45) - on a demo of its own, so the checks
      // below still meet the seed's cards (and after the card the checks below read is set)
      const d12 = await H.freshEngine(new Date());
      const d12As = async (key, fn) => {
        _db.useClient(H.clientAs(d12, NS.PEOPLE.find((p) => p.key === key).id));
        try { return await fn(); } finally { _db.useClient(null); }
      };
      const dc = d12.rows.photo_marketing.find((m) => m.state === "ready");
      await d12As("viewer", () => R.act(dc.id, "posted", "ready", { where: ["instagram"], link: "https://www.example.com/p/typo1", note: "Reel" }));
      const dbad = await d12As("viewer", () => R.act(dc.id, "posted", "ready", { link: "http://www.example.com/p/right1" }).then(() => null, (e) => e));
      same([dbad && dbad.code, dbad && dbad.hint], ["22023", "bad_link"], "the demo: a resend checked as a first send");
      const dpa = await d12As("viewer", () => R.act(dc.id, "posted", "ready", { where: ["facebook", "instagram"], link: "https://www.example.com/p/2",
        note: "The cabin's framing, all sides" }));
      same([dpa.again, dpa.state], [true, "posted"], "the demo: Posted sent again is again");
      same((await d12As("viewer", () => R.act(dc.id, "posted", "posted"))).again, true, "the demo: sent again with nothing");
      const dpc = (await d12As("viewer", () => R.readyList("done"))).items.find((x) => x.id === dc.id);
      same([dpc.posted.where, dpc.posted.link, dpc.posted.note], [pc2.posted.where, pc2.posted.link, pc2.posted.note], "the demo keeps what the database keeps");
      await d12As("viewer", () => R.act(dc.id, "reopen", "posted"));
      await d12As("viewer", () => R.act(dc.id, "pass", "claimed", { note: "Too dark - reshoot" }));
      same((await d12As("viewer", () => R.act(dc.id, "pass", "claimed", { note: "Too dark - reshoot in May" }))).again, true, "the demo: Not for posting sent again");
      same((await d12As("viewer", () => R.readyList("done"))).items.find((x) => x.id === dc.id).passed.reason, "Too dark - reshoot in May",
        "the demo: the corrected reason kept");
      await as("admin");
    });

    await check("P10 photo files (cases v19 and v20, §42, §43): marketing's culls - a file read gone by id after the first complete check after Ready is files.culled, and the phone's line is calm (confirmed_culled), never problem_missing; one first found gone by that check is the photographer's (it may have gone before); the demo database's culled shoot reads the same line; put back, the ✓ line again", async () => {
      F.setStrict(true);
      const sizes = [1048576, 2097152, 3145728];
      const ALL = sizes.map((size, k) => ({ id: ITEM(100 + k), size, md5: QX(k + 1) }));
      const okReads = () => W.rows.map((id, k) => ({ file_id: id, item: okItem(ITEM(100 + k), sizes[k], QX(k + 1)) }));
      const goneRead = { file_id: W.rows[1], item: { status: "gone" } };
      const apply = (items, reads) => svc("gdrive_check_apply", [[W.folder, "bigint"], [{ complete: true, folder: { state: "found" }, items, reads }, "jsonb"], [null, "uuid"]]);
      const cullsFrom = async () => { await sql("reset role"); return (await sql("select m.culls_from from public.photo_marketing m where m.id = $1", [W.item.id]))[0].culls_from; };
      try {
        // the hand-in settled: sealed and the last progress hours ago
        await sql("reset role");
        await sql("update public.photo_shoot_uploads set sealed_at = now() - interval '3 hours' where id = $1", [W.upload]);
        await sql("update public.photo_drive_folders set last_progress_at = now() - interval '3 hours' where id = $1", [W.folder]);
        // the shoot went on the list when the office marked it done (no check since): IMG_2.JPG first found gone by the
        // first complete check after that may have gone before it - the photographer's, never marketing's cull (§43)
        same(await cullsFrom(), null, "no culls before a check after Ready");
        await apply([ALL[0], ALL[2]], [goneRead]);
        ok((await cullsFrom()) !== null, "that check set culls_from");
        for (const who of ["fmk1", "fph"]) {
          await as(who);
          const st = await R.status(S.delivery);
          same([st.files.missing, st.files.culled], [1, 0], who + ": first found gone by the check after Ready - the photographer's");
          same(F.filesView(st, { today }).lines[0].code, "problem_missing", who + ": the photographer's problem line");
        }
        // put back (from OneDrive's recycle bin, the same item); then someone in marketing deletes IMG_2.JPG: photo-files'
        // next complete check no longer lists it and reads it gone by id
        await apply(ALL, okReads());
        await as("fmk1");
        same((await R.status(S.delivery)).files.missing, 0, "put back");
        await apply([ALL[0], ALL[2]], [goneRead]);
        for (const who of ["fmk1", "fph", "admin"]) {
          await as(who);
          const st = await R.status(S.delivery);
          same([st.files.missing, st.files.culled], [1, 1], who + ": one file missing, marketing's cull");
          const v = F.filesView(st, { today });
          same(v.lines[0].code, "confirmed_culled", who + ": " + v.lines.map((l) => l.code).join(", "));
          ok(/^All the files left in the folder are in OneDrive ✓ \(checked .+\)\. 1 was deleted or moved out of it after the shoot went to marketing\.$/.test(v.lines[0].text),
            v.lines[0].text);
          same(v.lines[0].tone, "ok", who + ": the confirmed line's tone");
          ok(!v.lines.some((l) => /^problem_/.test(l.code)), who + ": no problem line");
          if (who === "admin") ok((st.help || []).indexOf("problem") === -1, "no help notice about marketing's culls: " + JSON.stringify(st.help));
        }
        // the demo database: its shoot whose files marketing culled before posting answers files.culled the same way
        const fake = await demoAs("viewer", () => R.status(demoShoot("A000T8", "progress-1")));
        same([fake.files.missing, fake.files.culled], [6, 6], "the demo's culls");
        same(F.filesLine(fake, { app: "portal2" })[0], "confirmed_culled", "the demo: the same calm line");
        // put back: the ✓ line again, nothing culled
        await apply(ALL, okReads());
        await as("fmk1");
        const back = await R.status(S.delivery);
        same([back.files.missing, back.files.culled, F.filesLine(back, { app: "portal2" })[0]], [0, 0, "confirmed"], "put back");
      } finally { F.setStrict(false); }
    });

    await check("P10 photo files (§11.1, §42): a card claimed by someone taken off marketing goes back to ready (taken_from keeps them), and one claimed by someone turned off; the demo database the same", async () => {
      const id = W.item.id;
      const row = async () => { await sql("reset role"); return (await sql("select state, claimed_by, taken_from from public.photo_marketing where id = $1", [id]))[0]; };
      const kimTeam = async () => { await sql("reset role"); return (await sql("select version from public.photo_team where profile_id = $1", [MINE.fmk2.id]))[0]; };
      // Kim takes the admin's card over, then an admin takes Kim off marketing (the Access tab)
      await as("fmk2");
      same((await R.act(id, "claim", "claimed", { takeOver: true })).claimed_by_name, "Kim", "Kim is on it");
      await as("admin");
      await photo.setTeam(MINE.fmk2.id, { photographer: false, marketing: false }, (await kimTeam()).version);
      same(await row(), { state: "ready", claimed_by: null, taken_from: MINE.fmk2.id }, "back to ready, taken_from kept");
      await as("admin");
      same((await R.readyList("open")).items.find((i) => i.id === id).state, "ready", "the list says ready");
      // back on marketing, on it again, then turned off
      await photo.setTeam(MINE.fmk2.id, { photographer: false, marketing: true, googleEmail: "kim.post@example.com" }, null);
      await as("fmk2");
      same((await R.act(id, "claim", "ready")).state, "claimed", "Kim is on it again");
      client.as(PEOPLE.admin.id);
      const off = await client.rpc("admin_set_profile", { p_id: MINE.fmk2.id, p_active: false });
      same(off.error, null, "Kim turned off");
      same(await row(), { state: "ready", claimed_by: null, taken_from: MINE.fmk2.id }, "turned off: back to ready");
      const on = await client.rpc("admin_set_profile", { p_id: MINE.fmk2.id, p_active: true });
      same(on.error, null, "Kim turned on again");
      // an admin keeps theirs (they can still act on it): the card as the drift check below reads it
      await as("admin");
      same((await R.act(id, "claim", "ready")).state, "claimed", "an admin is on it");
      // the demo database: the same rule
      const dr = demo.rows;
      const ready = dr.photo_marketing.find((m) => m.state === "ready");
      const viewer = NS.PEOPLE.find((p) => p.key === "viewer").id;
      await demoAs("viewer", () => R.act(ready.id, "claim", "ready"));
      await demoAs("admin", () => photo.setTeam(viewer, { photographer: false, marketing: false }, dr.photo_team.find((t) => t.profile_id === viewer).version));
      const fr = dr.photo_marketing.find((m) => m.id === ready.id);
      same([fr.state, fr.claimed_by, fr.taken_from], ["ready", null, viewer], "the demo: back to ready, taken_from kept");
      await demoAs("admin", () => photo.setTeam(viewer, { photographer: false, marketing: true, googleEmail: "taylor.viewer.demo@example.com" }, null));
    });

    await check("P10 photo files: a skipped shoot with files - closed_files in words, Mark done… offered (shootActions), the database's done preview not refused (was 'skipped', §7.10)", async () => {
      const h = await handInConfirmed("fph", S.skipped, "schema-hand-in-2", [{ path: "IMG_9.JPG", size: 4096, md5: QX(9), item: ITEM(209) }]);
      same(h.check.files.state, "confirmed", "the skipped shoot's files in OneDrive");
      await as("fph");
      const st = await R.status(S.skipped);
      same([st.closed, st.completion, st.files.state], ["skipped", "closed_files", "confirmed"], "closed_files");
      ok(F.filesView(st, { today }).completion.text.indexOf("marked skipped, but its files are in OneDrive") !== -1, "in words");
      const plan = (await photo.loadPlan(W.plan)).plan;
      const shoot = (await photo.loadPlan(W.plan)).shoots.find((s) => s.id === S.skipped);
      const access = await photo.myAccess();
      same(M.shootActions(shoot, plan, access, { files: st }).done.ok, true, "Mark done… offered");
      same(M.shootActions(shoot, plan, access, { files: st }).move.ok, false, "Move… still refused");
      const pv = await photo.preview(W.plan, "done", { shoot: shoot.key });
      same([pv.refused, pv.done && pv.done.was], [null, "skipped"], "the database's preview of the done");
    });

    await check("P10 photo files: the Realtime watch - the three tables' private channels joined (live.js) and one read after the joins", async () => {
      await as("fmk1");
      let reads = 0;
      let done;
      const joined = new Promise((r) => { done = r; });
      const stop = await R.watchFiles(async (w) => { reads += 1; if (w.join) done(); }, { wait: 50 });
      await Promise.race([joined, new Promise((r) => setTimeout(r, 3000))]);
      stop();
      ok(reads >= 1, "read after the joins");
    });

    await check("P10 photo files: a shoot marked done before its folder is in OneDrive (§10.1 rule 3, §38) - no row, the rows claimed by a hand-in begun, handed in and still to send: no_hand_in, done_copying, done_waiting (never folder_problem); the demo database answers the same at each step", async () => {
      F.setStrict(true);
      try {
        // the usual order: Mark done at the site (DCR Agents 2 mirrors it), the hand-in at home
        SHOOTS.walk = { local_id: 3, key: "site-walk", seq: 10, phase: "special", name: "Site walk", anchor: "fixed", offset_days: 0, fixed_date: addDays(today, -2),
          planned_date: addDays(today, -2), window_days: 0, status: "done", done_at: new Date().toISOString(), done_source: "shoot page" };
        const m = await mirror();
        ok(m.ok, "mirrored: " + JSON.stringify(m).slice(0, 160));
        for (const s of m.shoots) S[Object.keys(SHOOTS).find((k) => SHOOTS[k].local_id === s.local_id)] = s.id;
        ok(S.walk, "the shoot marked done");
        // the demo: a made-up shoot of its own in the same states (its seed's folder and hand-in taken away)
        const dr = demo.rows;
        const ds = demoShoot("A000T9", "progress-1");
        for (const t of ["photo_shoot_uploads", "photo_drive_folders"]) for (let i = dr[t].length - 1; i >= 0; i -= 1) if (dr[t][i].shoot_id === ds) dr[t].splice(i, 1);
        const dShoot = dr.photo_shoots.find((x) => x.id === ds);
        Object.assign(dShoot, { status: "done", done_at: new Date().toISOString(), done_source: "shoot page" });
        const dJob = dr.photo_drive_folders.find((x) => x.kind === "job" && x.plan_id === dShoot.plan_id);
        ok(dJob && dJob.drive_state === "found", "the demo's job folder");
        const step = async (want, what) => {
          await as("fph");
          const real = await R.status(S.walk);
          same([real.ready_why, real.completion], want, what);
          same(F.filesView(real, { today }).completion.text, F.WORDS.completion[want[1]], what + ": in words");
          const fake = await demoAs("field", () => R.status(ds));
          same([fake.ready_why, fake.completion], [real.ready_why, real.completion], "the demo: " + what);
          return real;
        };
        const none = await step(["no_hand_in", "no_hand_in"], "no folder row yet");
        same(none.folder, null, "no folder row");
        // the hand-in begun at home: the rows claimed (under the plan's job folder), the shoot folder not in OneDrive yet
        const u = await begin("fph", S.walk, "schema-hand-in-3", DEV.ph);
        await sql("reset role");
        const fr = (await sql("select id, parent_id, drive_state from public.photo_drive_folders where shoot_id = $1 and kind = 'shoot'", [S.walk]))[0];
        same([Number(fr.parent_id), fr.drive_state], [W.job, "not_seen"], "claimed by the hand-in, under the plan's job folder, not in OneDrive yet");
        const df = Object.assign({}, NS.p10FilesCols.photo_drive_folders, { id: 9301, kind: "shoot", parent_id: dJob.id, shoot_id: ds, plan_id: dShoot.plan_id,
          tag: "K7ZZM9", name: "Site walk", drive_state: "not_seen", owner_ok: true });
        dr.photo_drive_folders.push(df);
        const du = Object.assign({}, NS.p10FilesCols.photo_shoot_uploads, { id: 9301, folder_id: df.id, shoot_id: ds, state: "open", source: "pc", pc_label: "PHOTO-PC", pc_id: 3,
          started_by: NS.PEOPLE.find((p) => p.key === "field").id, recorded_files: 0, started_at: new Date().toISOString(), beat_at: new Date().toISOString() });
        dr.photo_shoot_uploads.push(du);
        const copying = await step(["copying", "done_copying"], "the hand-in open");
        same(copying.folder && copying.folder.drive_state, "not_seen", "not in OneDrive yet");
        // handed in: still to send to OneDrive
        await rpcAs("fph", "photo_upload_files", { p_upload: u.upload.id, p_files: [{ path: "IMG_31.JPG", size: 4096, md5: QX(31) }] });
        await rpcAs("fph", "photo_upload_seal", { p_upload: u.upload.id, p_files: 1, p_bytes: 4096 });
        Object.assign(du, { state: "sealed", sealed_by: du.started_by, files: 1, bytes: 4096, recorded_files: 1, sealed_at: new Date().toISOString() });
        Object.assign(df, { counted: 1, waiting: 1, photos: 1, bytes: 4096 });
        await step(["files_waiting", "done_waiting"], "handed in, still to send");
        // the folders made by its first sessions: still waiting for the file
        await foldersMade(S.walk);
        Object.assign(df, { drive_state: "found", drive_link: link("Sample job", "Site walk") });
        await step(["files_waiting", "done_waiting"], "the folder made, the file on its way");
      } finally { F.setStrict(false); }
    });

    await check("P10 photo files (OD §3.3): the phone's hand-in over the real migrations - js/photo-send.js with repo/photo-files.js's RPCs (begin with p_source 'phone' after the phone switch, files with NO hash and their ids by i, beat, seal, the files page) and photo-files' sessions / done / find played by its own service-role SQL: every file confirmed on the phone's own hash, the seal's counts, the phone's lines", async () => {
      await as("fph");
      const store = new Map();
      const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => store.delete(k) };
      const ups = new Map();           // an upload address -> what lands there
      const landed = new Map();        // an item id -> {fileId, size, qx (OneDrive's own hash of what it got), path}
      let n = 0;
      W.answers = {};
      const keep = (k, v) => { if (W.answers[k] === undefined) W.answers[k] = v; return v; };
      const stand = {
        begin: async (shootId, o) => keep("begin", await R.begin(shootId, o)),
        record: async (uploadId, list) => keep("files", await R.record(uploadId, list)),
        beat: async (uploadId, o) => keep("beat", await R.beat(uploadId, o)),
        seal: async (uploadId, nf, nb) => keep("seal", await R.seal(uploadId, nf, nb)),
        // photo-files sessions (OD §4.5) as its SQL decides: the mode for the whole call, the device, the folders made, a
        // session per file (app.gdrive_sessions_made) on an address of this check's own
        async sessions(uploadId, key, files) {
          const ids = files.map((f) => Number(f.file_id));
          const c = await svc("gdrive_send_context", [[MINE.fph.id, "uuid"], [uploadId, "bigint"], [key, "text"], [ids, "bigint[]"]]);
          if (c.mode !== "on") throw new R.FilesError(c.mode === "test" ? "uploads_test" : "uploads_off", c.mode === "test" ? "uploads_test" : "uploads_off", 503);
          if (!c.upload.device_ok) return { files: ids.map((id) => ({ file_id: id, code: "not_this_device" })) };
          if (!c.folder || c.folder.drive_state !== "found") await foldersMade(Number(c.upload.shoot_id));
          const made = await svc("gdrive_sessions_made", [[MINE.fph.id, "uuid"], [uploadId, "bigint"], [ids.map((id) => ({ file_id: id, step: "session" })), "jsonb"]]);
          const out = [];
          for (const f of made.files) {
            if (!f.ok) { out.push({ file_id: f.file_id, code: f.code || "not_waiting" }); continue; }
            const row = c.files.find((x) => Number(x.file_id) === Number(f.file_id));
            const url = "https://" + ONEDRIVE_HOST + "/__schema/up/" + (++n);
            ups.set(url, { fileId: Number(f.file_id), size: Number(row.size), got: new Uint8Array(Number(row.size)), offset: 0, path: f.path || row.path, item: null });
            out.push({ file_id: f.file_id, upload_url: url, expires_at: new Date(Date.now() + 3600e3).toISOString(), path: f.path || row.path });
          }
          return { chunk_multiple: U, chunk_bytes: 16 * U, max_chunk_bytes: 191 * U, files: out };
        },
        // photo-files done: each item "read by id" (what landed) and judged by app.gdrive_items_seen
        async done(uploadId, key, items) {
          const seen = await svc("gdrive_items_seen", [[MINE.fph.id, "uuid"], [uploadId, "bigint"], [items.map((it) => {
            const x = landed.get(it.item_id);
            return Object.assign({ file_id: Number(it.file_id), item: x ? okItem(it.item_id, x.size, x.qx, { path: x.path }) : { status: "gone" } }, it.md5 ? { md5: it.md5 } : {});
          }), "jsonb"]]);
          return { items: seen.items.map((e) => (e.state === "confirmed" || e.state === "checking" ? { file_id: e.file_id, state: e.state }
            : e.state === "waiting" && e.code ? { file_id: e.file_id, code: e.code } : e)), folder: seen.folder };
        },
        // photo-files find as handler.ts gates it over the send context (review round 6): an open, sealed or abandoned
        // hand-in of this device, a row of it not removed - then the item that landed at its name with its size
        async find(uploadId, key, fileId) {
          const c = await svc("gdrive_send_context", [[MINE.fph.id, "uuid"], [uploadId, "bigint"], [key, "text"], [[Number(fileId)], "bigint[]"]]);
          if (["open", "sealed", "abandoned"].indexOf(c.upload.state) === -1) throw new R.FilesError("upload_closed", "upload_closed", 409);
          if (!c.upload.device_ok) throw new R.FilesError("not_this_device", "not_this_device", 403);
          const f = c.files[0];
          if (!f || !f.found || !f.mine || f.state === "removed") return null;
          for (const [id, x] of landed) if (x.fileId === Number(fileId) && x.size === Number(f.size)) return id;
          return null;
        },
      };
      const transport = async (req) => {
        const s = ups.get(req.url);
        const res = (status, b) => ({ status, header: () => null, text: () => (b === undefined ? "" : JSON.stringify(b)) });
        if (!s || s.item) return res(404, { error: { code: "itemNotFound" } });
        if (req.method === "GET") return res(200, { nextExpectedRanges: [s.offset + "-"] });
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["Content-Range"]);
        const a = Number(m[1]), z = Number(m[2]);
        if (a !== s.offset) return res(416, { nextExpectedRanges: [s.offset + "-"] });
        s.got.set(new Uint8Array(req.body), a);
        s.offset = z + 1;
        if (s.offset < s.size) return res(202, { nextExpectedRanges: [s.offset + "-"] });
        const id = ITEM(700 + landed.size);
        s.item = id;
        landed.set(id, { fileId: s.fileId, size: s.size, qx: globalThis.DCR2QuickXor.quickXorHash(s.got), path: s.path });
        return res(201, { id, name: s.path.split("/").pop(), size: s.size });
      };
      const file = (name, size, seed) => {
        const bytes = new Uint8Array(size);
        let x = seed >>> 0;
        for (let k = 0; k < size; k++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; bytes[k] = (x >>> 16) & 255; }
        return { name, size, lastModified: Date.now() - 3600e3, type: "", bytes,
          slice: (a, b) => { const p = bytes.slice(a, b); return { size: p.length, arrayBuffer: async () => p.buffer }; } };
      };
      const phone = () => P.createPhoneSend({ repo: Object.assign({}, R, stand), transport, hasher: P.createHasher({ worker: null }), storage, window: null,
        document: null, navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }, by: "Pat", today, uploader: { wait: () => 1 },
        ms: { beat: 20, soon: 0, again: 20, pause: 1000, waits: [1] } });
      const until = async (fn, what) => { const end = Date.now() + 20000; while (!(await fn())) { if (Date.now() > end) throw new Error("timed out: " + what); await new Promise((r) => setTimeout(r, 10)); } };
      // the phone switch off: no phone hand-in starts (phone_off, in words)
      await rpcAs("admin", "photo_files_set_mode", { p_mode: "on", p_phone: false });
      await as("fph");
      const off = phone();
      await off.start(await off.plan(S.phone, [file("IMG_0001.HEIC", 1000, 1)]));
      same([off.view().phase, off.view().lines.map((l) => l.text)], ["refused", [F.WORDS.hint.phone_off]], "phone_off in words, nothing opened");
      await off.dispose();
      await rpcAs("admin", "photo_files_set_mode", { p_mode: "on", p_phone: true });
      await as("fph");
      // the pick: two photos and a video (a text file left out), sent, done, sealed
      const a = file("IMG_0001.HEIC", U + 17, 2), b = file("IMG_0002.JPG", 2 * U + 3, 3), c = file("C0001.MOV", 3 * U + 5, 4), t = file("notes.txt", 20, 5);
      const ps = phone();
      const p = await ps.plan(S.phone, [a, b, c, t]);
      same([p.notMedia, p.send.map((x) => x.path)], [1, ["Phone/IMG_0001.HEIC", "Phone/IMG_0002.JPG", "Phone/C0001.MOV"]], "the plan: Phone/<name>, the text file left out");
      await ps.start(p);
      await until(() => ps.view().phase === "sealed", "sealed: " + JSON.stringify(ps.view().lines.map((l) => l.code)) + " " + JSON.stringify(ps.view()).slice(0, 600));
      same(W.answers.files.files.map((f) => [f.i, f.verdict, f.send]), [[0, "added", true], [1, "added", true], [2, "added", true]], "recorded with NO hash: the ids by i");
      same(W.answers.begin.upload.source, "phone", "begun as a phone");
      same(W.answers.seal.upload.files, 3, "the seal's counts");
      ok(W.answers.beat && W.answers.beat.ok === true, "beat: " + JSON.stringify(W.answers.beat));
      const rows = await R.rows(S.phone);
      same(rows.map((r) => [r.path, r.md5, r.state, r.counted]), [["Phone/IMG_0001.HEIC", globalThis.DCR2QuickXor.quickXorHash(a.bytes), "confirmed", true],
        ["Phone/IMG_0002.JPG", globalThis.DCR2QuickXor.quickXorHash(b.bytes), "confirmed", true], ["Phone/C0001.MOV", globalThis.DCR2QuickXor.quickXorHash(c.bytes), "confirmed", true]],
        "every file confirmed on the phone's own hash (filled in by its done)");
      ok(/^All 3 files are in OneDrive ✓ \(checked .+\)\.$/.test(ps.view().lines.at(-1).text), ps.view().lines.at(-1).text);
      const st = await R.status(S.phone);
      same([st.files.state, st.files.counted, st.files.confirmed], ["confirmed", 3, 3], "the status");
      same(F.filesView(st, { today }).lines[0].code, "confirmed", "the phone's line");
      await ps.dispose();
      // a second hand-in of the same shoot, cancelled (the drift check below compares its answer)
      const b2 = await R.begin(S.phone, { clientKey: "schema-phone-2", deviceKey: DEV.phone, label: "iPhone" });
      await R.record(b2.upload.id, [{ path: "Phone/IMG_0009.JPG", size: 100 }]);
      W.answers.cancel = await R.cancel(b2.upload.id);
      same(W.answers.cancel.state, "cancelled", "cancelled");
      client.as(MINE.fph.id);
      W.answers.page = (await client.rpc("photo_shoot_files_page", { p_shoot: S.phone, p_filter: null, p_after: null, p_limit: 500 })).data;
      ok(W.answers.page && Array.isArray(W.answers.page.files) && W.answers.page.files.length === 4, "the files page: " + JSON.stringify(W.answers.page).slice(0, 120));
      ok(!JSON.stringify(W.answers.page).includes("FAKEITEM"), "never an item id");
      // every beat state the repo knows is one the migration's photo_upload_beat takes (waiting_turn: a PC's own, review
      // round 4; disk_full: a PC's own, review round 10) - the drift check below beats the demo with the same
      const b3 = await R.begin(S.phone, { clientKey: "schema-phone-3", deviceKey: DEV.phone, label: "iPhone" });
      for (const s of R.SEND_STATES) same((await R.beat(b3.upload.id, { state: s, bytesSent: 0, sentFiles: 0 })).upload.send_state, s, "photo_upload_beat takes " + s);
      same(keysOf(await R.cancel(b3.upload.id)), keysOf(W.answers.cancel), "the cancel's answer, with nothing recorded");

      // review round 5 (OD §5.5, §23): Cancel it on the page that holds the hand-in's files counts its own files in
      // OneDrive - never the file in flight whose session the migration's removed_sent counts (it counts every removed row
      // whose bytes may be in OneDrive: a session handed out, or an item known)
      const d = file("IMG_0051.JPG", U + 7, 51), e = file("C0051.MOV", 16 * U + 5, 52);   // (e: two chunks of the phone's 16 x 320 KiB)
      let pressed = null;
      const ps5 = P.createPhoneSend({ repo: Object.assign({}, R, stand, { cancel: async (id) => (W.answers.cancel5 = await R.cancel(id)) }),
        transport: async (req) => {
          const s = ups.get(req.url);
          const m = req.method === "PUT" ? /^bytes (\d+)-/.exec(req.headers["Content-Range"]) : null;
          if (s && s.size === e.size && m && Number(m[1]) === 0 && !pressed) pressed = ps5.cancel();      // (its first chunk: never its last)
          return transport(req);
        }, hasher: P.createHasher({ worker: null }), storage, window: null, document: null,
        navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }, by: "Pat", today, uploader: { wait: () => 1 },
        ms: { beat: 20, soon: 0, again: 20, pause: 1000, waits: [1] } });
      await ps5.start(await ps5.plan(S.phone, [d, e]));
      await until(() => pressed, "Cancel it pressed while C0051.MOV goes");
      await pressed;
      same(ps5.view().phase, "cancelled", "Cancel it while sending");
      same([W.answers.cancel5.removed, W.answers.cancel5.removed_sent, W.answers.cancel5.put_back_ids], [2, 2, []],
        "the migration's removed_sent: IMG_0051 in OneDrive and C0051 whose session was handed out (review round 5)");
      same(ps5.view().lines.filter((l) => /^cancelled_sent/.test(l.code)).map((l) => l.text), [F.WORDS.copy.cancelled_sent_one],
        "the page that holds both files counts the one in OneDrive");
      await ps5.dispose();
      // review round 6: Cancel it pressed as a one-chunk photo's last chunk lands, its answer cut off - the page asks find
      // BEFORE the cancel (photo-files' find answers nothing once the hand-in is cancelled) and counts the photo in Phone/
      const g = file("IMG_0071.JPG", U + 9, 71);
      let pressed6 = null, up6 = null;
      const ps6 = P.createPhoneSend({ repo: Object.assign({}, R, stand, { cancel: async (id) => { up6 = id; return (W.answers.cancel6 = await R.cancel(id)); } }),
        transport: async (req) => {
          const s = ups.get(req.url);
          const res = await transport(req);
          if (s && s.size === g.size && req.method === "PUT" && s.item && !pressed6) {
            pressed6 = ps6.cancel();                                   // (pressed as it lands: its 201 never comes back)
            throw Object.assign(new Error("No connection"), { code: "offline" });
          }
          return res;
        }, hasher: P.createHasher({ worker: null }), storage, window: null, document: null,
        navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }, by: "Pat", today, uploader: { wait: () => 1 },
        ms: { beat: 20, soon: 0, again: 20, pause: 1000, waits: [1] } });
      await ps6.start(await ps6.plan(S.phone, [g]));
      await until(() => pressed6, "Cancel it pressed as IMG_0071 lands");
      await pressed6;
      same(ps6.view().phase, "cancelled", "Cancel it as the last chunk lands");
      same(ps6.view().lines.filter((l) => /^cancelled_sent/.test(l.code)).map((l) => l.text), [F.WORDS.copy.cancelled_sent_one],
        "the photo left in Phone/ is counted (review round 6) - never a bare \"Cancelled\"");
      const gid = [...landed.values()].find((x) => x.size === g.size).fileId;
      let after = null;
      try { after = await stand.find(up6, JSON.parse(store.get(P.STORE_KEY)).device_key, gid); } catch (e2) { after = e2.code; }
      same(after, "upload_closed", "the same find after the cancel: refused - the page asks it first");
      await ps6.dispose();
      // the same count the demo database must answer (the drift check below): a removed row whose session was handed out
      const b6 = await R.begin(S.phone, { clientKey: "schema-phone-6", deviceKey: DEV.phone, label: "iPhone" });
      const f6 = await R.record(b6.upload.id, [{ path: "Phone/IMG_0061.JPG", size: 100 }, { path: "Phone/IMG_0062.JPG", size: 101 }]);
      await stand.sessions(b6.upload.id, DEV.phone, [{ file_id: f6.byIndex[0].file_id }]);
      const c6 = await R.cancel(b6.upload.id);
      W.answers.cancelSession = [c6.removed, c6.removed_sent, c6.put_back_ids];
      same(W.answers.cancelSession, [2, 1, []], "a removed row whose session was handed out is in removed_sent; one never sent is not");
      // waiting_turn never moves an open hand-in's running clock (review round 5): a stopped copy stays stopped
      const b4 = await R.begin(S.phone, { clientKey: "schema-phone-4", deviceKey: DEV.phone, label: "iPhone" });
      await R.record(b4.upload.id, [{ path: "Phone/IMG_0041.JPG", size: 100 }]);
      await q("update public.photo_shoot_uploads set beat_at = now() - interval '5 minutes' where id = $1", [b4.upload.id]);
      const runs = async () => (await R.status(S.phone)).uploads.find((x) => Number(x.id) === Number(b4.upload.id)).running;
      same(await runs(), false, "stopped: its last beat 5 minutes ago");
      await R.beat(b4.upload.id, { state: "waiting_turn", bytesSent: 0, sentFiles: 0 });
      same(await runs(), false, "a waiting_turn beat leaves it stopped");
      await R.beat(b4.upload.id, { state: "sending", bytesSent: 0, sentFiles: 0 });
      same(await runs(), true, "any other beat runs it");
      W.answers.beatTurn = true;
      await R.cancel(b4.upload.id);
      // review round 6 (OD §3.2.8, §5.6, L44): an open PC hand-in's running clock moves only when bytes_sent grew - a
      // stopped copy whose files wait on a hold beats on and stays stopped (the drift check below beats the demo the same)
      const pc6 = await rpcAs("fph", "photo_upload_begin", { p_shoot: S.phone, p_client_key: "schema-pc-clock", p_device_key: DEV.ph,
        p_device_label: "SCHEMA-PC", p_source: "pc", p_replaces: null });
      await rpcAs("fph", "photo_upload_files", { p_upload: pc6.upload.id, p_files: [{ path: "IMG_66.JPG", size: 4096, md5: QX(66) }] });
      await as("fph");
      await q("update public.photo_shoot_uploads set beat_at = now() - interval '5 minutes', bytes_sent = 500 where id = $1", [pc6.upload.id]);
      const runs6 = async () => (await R.status(S.phone)).uploads.find((x) => Number(x.id) === Number(pc6.upload.id)).running;
      const clock = [await runs6()];
      await R.beat(pc6.upload.id, { state: "onedrive_full", bytesSent: 500, sentFiles: 0 });
      clock.push(await runs6());
      await R.beat(pc6.upload.id, { state: "sending", bytesSent: 900, sentFiles: 0 });
      clock.push(await runs6());
      W.answers.pcClock = clock;
      same(clock, [false, false, true], "a PC's beat with nothing more sent leaves it stopped; bytes that grew run it");
      await R.cancel(pc6.upload.id);
      // review round 6 (OD §5.3 rule 0): a row to be sent again over its item (a broken copy waiting for its one resend -
      // its item kept, a pending Replace by its own hand-in), taken by a second hand-in and cancelled, is back at that
      // step with its item, its resends and its pending Replace (the drift check below cancels the demo's the same)
      const r0a = await R.begin(S.phone, { clientKey: "schema-phone-r0a", deviceKey: DEV.phone, label: "iPhone" });
      const r0id = (await R.record(r0a.upload.id, [{ path: "Phone/IMG_0081.JPG", size: 100, md5: QX(81) }])).byIndex[0].file_id;
      await R.seal(r0a.upload.id, 1, 100);
      await q("update public.photo_shoot_files set state = 'waiting', upload_step = 'to_send', confirmed_at = null, drive_file_id = $2, drive_size = 100, " +
        "drive_md5 = $3, resends = 1, replace_upload_id = $4 where id = $1", [r0id, ITEM(81), QX(82), r0a.upload.id]);
      const r0b = await R.begin(S.phone, { clientKey: "schema-phone-r0b", deviceKey: DEV.phone, label: "iPhone" });
      same((await R.record(r0b.upload.id, [{ path: "Phone/IMG_0081.JPG", size: 100, md5: QX(81) }])).byIndex[0].verdict, "recopied", "taken by the second hand-in");
      await R.cancel(r0b.upload.id);
      const r0 = (await q("select last_upload_id, state, upload_step, drive_file_id, replace_upload_id, resends from public.photo_shoot_files where id = $1", [r0id]))[0];
      W.answers.rule0 = [Number(r0.last_upload_id) === Number(r0a.upload.id), r0.state, r0.upload_step, r0.drive_file_id === ITEM(81),
        Number(r0.replace_upload_id) === Number(r0a.upload.id), Number(r0.resends)];
      same(W.answers.rule0, [true, "waiting", "to_send", true, true, 1], "back under its hand-in at to_send, with its item, its pending Replace and its resends");
      // review round 7 (OD §5.3 rule 0, §25): the same, with a session made for the row's own bytes before the cancel (a
      // cancel mid-upload - the item may still hold the broken copy): still a resend given back, never a spent one; the
      // row stamped back_at (the drift check below cancels the demo's the same)
      const r7b = await R.begin(S.phone, { clientKey: "schema-phone-r7b", deviceKey: DEV.phone, label: "iPhone" });
      same((await R.record(r7b.upload.id, [{ path: "Phone/IMG_0081.JPG", size: 100, md5: QX(81) }])).byIndex[0].verdict, "recopied", "taken again by a third hand-in");
      const s7 = await stand.sessions(r7b.upload.id, DEV.phone, [{ file_id: r0id }]);
      ok(s7.files.length === 1 && s7.files[0].upload_url, "a session made for the row's own bytes: " + JSON.stringify(s7.files).slice(0, 160));
      same((await q("select upload_step from public.photo_shoot_files where id = $1", [r0id]))[0].upload_step, "session", "its session made");
      const t7 = Date.now();
      await R.cancel(r7b.upload.id);
      const r7 = (await q("select last_upload_id, state, upload_step, drive_file_id, replace_upload_id, resends, back_at from public.photo_shoot_files where id = $1", [r0id]))[0];
      W.answers.rule0Session = [Number(r7.last_upload_id) === Number(r0a.upload.id), r7.state, r7.upload_step, r7.drive_file_id === ITEM(81),
        Number(r7.replace_upload_id) === Number(r0a.upload.id), Number(r7.resends), !!r7.back_at && new Date(r7.back_at).getTime() >= t7 - 60e3];
      same(W.answers.rule0Session, [true, "waiting", "to_send", true, true, 1, true],
        "after a session of the row's own bytes: back at to_send with its item, its pending Replace and its one resend - and back_at stamped");
      // the help lost (OD §6.6, L51): a sealed PC hand-in whose fresh beat says its files are lost, with rows to send -
      // the chip "Memory card needed" beside lost_here; gone with a stale beat
      const pc = await rpcAs("fph", "photo_upload_begin", { p_shoot: S.phone, p_client_key: "schema-pc-lost", p_device_key: DEV.ph, p_device_label: "SCHEMA-PC",
        p_source: "pc", p_replaces: null });
      await rpcAs("fph", "photo_upload_files", { p_upload: pc.upload.id, p_files: [{ path: "IMG_61.JPG", size: 4096, md5: QX(61) }, { path: "IMG_62.JPG", size: 4097, md5: QX(62) }] });
      await rpcAs("fph", "photo_upload_seal", { p_upload: pc.upload.id, p_files: 2, p_bytes: 8193 });
      await as("fph");
      await R.beat(pc.upload.id, { state: "lost", bytesSent: 0, sentFiles: 0 });
      let st5 = await R.status(S.phone);
      same(st5.help, ["lost"], "app.photo_help_now's lost");
      const v5 = F.filesView(st5, { today });
      same([v5.lines[0].code, v5.help], ["lost_here", [F.WORDS.help.lost]], "lost_here and the chip " + F.WORDS.help.lost);
      await q("update public.photo_shoot_uploads set send_beat_at = now() - interval '3 minutes' where id = $1", [pc.upload.id]);
      st5 = await R.status(S.phone);
      same(st5.help, [], "a beat over 2 minutes old: no lost");
      // review round 7 (OD §6.6, §10.6, §25): the stalled line counts the stalled rows alone (app.photo_row_stalled: the
      // status's uploads[].stalled) and names their computer - that hand-in's 2 files, sealed 20 days ago (its beat no
      // longer says lost), the mode changed 20 days ago - never a fresher hand-in's 3 files still sending on OFFICE-PC;
      // the file list's rows carry upload_id, upload_step and stalled (the drift check below asks the demo the same)
      const mode0 = (await q("select mode_at from app.photo_drive where id = 1"))[0].mode_at;
      await q("update public.photo_shoot_uploads set sealed_at = now() - interval '20 days', send_state = 'sending' where id = $1", [pc.upload.id]);
      await q("update app.photo_drive set mode_at = now() - interval '20 days' where id = 1");
      const fresh = await rpcAs("fph", "photo_upload_begin", { p_shoot: S.phone, p_client_key: "schema-pc-fresh", p_device_key: "pk_SchemaOfficePc00000001",
        p_device_label: "OFFICE-PC", p_source: "pc", p_replaces: null });
      await rpcAs("fph", "photo_upload_files", { p_upload: fresh.upload.id, p_files: [{ path: "IMG_71.JPG", size: 4096, md5: QX(71) },
        { path: "IMG_72.JPG", size: 4097, md5: QX(72) }, { path: "IMG_73.JPG", size: 4098, md5: QX(73) }] });
      await rpcAs("fph", "photo_upload_seal", { p_upload: fresh.upload.id, p_files: 3, p_bytes: 12291 });
      await as("fph");
      await R.beat(fresh.upload.id, { state: "sending", bytesSent: 100, sentFiles: 0 });
      await q("update public.photo_drive_folders set stalled_at = now() where shoot_id = $1 and kind = 'shoot' and retired_at is null", [S.phone]);
      const st7 = await R.status(S.phone);
      const of7 = Object.fromEntries(st7.uploads.map((x) => [Number(x.id), x.stalled]));
      const v7 = F.filesView(st7, { today, now: Date.now() });
      W.answers.stalled = [of7[Number(pc.upload.id)], of7[Number(fresh.upload.id)], v7.lines[0].code, v7.lines[0].text];
      same(W.answers.stalled, [2, 0, "stalled", F.word("files", "stalled", { waiting: 2, pc: "SCHEMA-PC" })],
        "the stalled line: SCHEMA-PC's 2 stalled files, never OFFICE-PC's 3 still sending");
      client.as(MINE.fph.id);
      const pg7 = (await client.rpc("photo_shoot_files_page", { p_shoot: S.phone, p_filter: null, p_after: null, p_limit: 500 })).data;
      same(pg7.files.filter((x) => x.stalled === true).map((x) => [Number(x.upload_id), x.upload_step]),
        [[Number(pc.upload.id), "to_send"], [Number(pc.upload.id), "to_send"]], "the file list's stalled rows: that hand-in's, still to send");
      ok(pg7.files.every((x) => typeof x.stalled === "boolean" && "upload_id" in x && "upload_step" in x), "every row carries upload_id, upload_step and stalled");
      // review round 8 (OD §6.6, §10.6, §26): files.stalled and app.photo_help_now's stalled hold only while a stalled row
      // is left - SCHEMA-PC's 2 stalled files sent (in OneDrive, checking) before the next tick: the stamp stays, the
      // status and the help let it go (never "0 files never reached OneDrive"); the drift check below asks the demo the same
      const r8 = { before: [st7.files.stalled, st7.help.includes("stalled")] };
      same(r8.before, [true, true], "the stamp and SCHEMA-PC's 2 stalled rows: files.stalled and the help stalled");
      await q("update public.photo_shoot_files set upload_step = 'committed', drive_file_id = 'FAKEITEM' || lpad(id::text, 14, '0') where last_upload_id = $1",
        [pc.upload.id]);
      const st8 = await R.status(S.phone);
      const stamp8 = (await q("select stalled_at from public.photo_drive_folders where shoot_id = $1 and kind = 'shoot' and retired_at is null", [S.phone]))[0].stalled_at;
      r8.sent = [st8.files.stalled, st8.help.includes("stalled"), st8.uploads.reduce((t, x) => t + Number(x.stalled || 0), 0),
        F.filesView(st8, { today, now: Date.now() }).lines.some((l) => l.code === "stalled")];
      ok(!!stamp8, "the stamp is still there (the tick's to clear)");
      same(r8.sent, [false, false, 0, false], "their rows sent: no files.stalled, no help stalled, no stalled row, no stalled line before the next tick");
      // review round 8 (OD §3.2.8, §10.6, §26): the sending line's totals are the files that still count - the status's
      // uploads[].send_files / send_bytes, the hand-in's rows not left out or removed: OFFICE-PC's 3 files, one left out
      // during the send (DCR Desktop's Leave them out, photo_files_resolve), read 2 files and their bytes; files / bytes
      // keep the seal's figures for the history line
      const left8 = pg7.files.find((x) => Number(x.upload_id) === Number(fresh.upload.id) && x.path === "IMG_73.JPG");
      ok(!!left8, "OFFICE-PC's IMG_73.JPG in the file list");
      await rpcAs("fph", "photo_files_resolve", { p_shoot: S.phone, p_file_ids: [left8.id], p_action: "leave_out", p_note: null });
      await as("fph");
      await R.beat(fresh.upload.id, { state: "sending", bytesSent: 4096, sentFiles: 1, rateBps: 1000 });
      const st8b = await R.status(S.phone);
      const uf8 = st8b.uploads.find((x) => Number(x.id) === Number(fresh.upload.id));
      const v8 = F.filesView(st8b, { today, now: Date.now() });
      r8.send = [Number(uf8.files), Number(uf8.bytes), Number(uf8.send_files), Number(uf8.send_bytes), v8.lines[0].code, v8.lines[0].text];
      same(r8.send, [3, 12291, 2, 8193, "sending", F.word("files", "sending", { pc: "OFFICE-PC", sent: 1, total: 2, sent_size: F.sizeWords(4096),
        total_size: F.sizeWords(8193), left: F.leftWords(4097 / 1000) })], "the sending line: 1 of 2 files, the left-out file out of its totals and time left");
      W.answers.round8 = r8;
      // review round 9 (OD §6.6, §27): a row is stalled 14 days after its hand-in's own last progress too - NINE-PC's 2
      // files sealed 20 days ago, then its PC switched on again and sending them: no stalled row, no files.stalled, no
      // help stalled, no stalled line (the stamp still there); 15 days after that progress, stalled again
      const r9 = {};
      const nine = await rpcAs("fph", "photo_upload_begin", { p_shoot: S.phone, p_client_key: "schema-pc-nine", p_device_key: "pk_SchemaPcRoundNine00001",
        p_device_label: "NINE-PC", p_source: "pc", p_replaces: null });
      await rpcAs("fph", "photo_upload_files", { p_upload: nine.upload.id, p_files: [{ path: "IMG_91.JPG", size: 4091, md5: QX(91) },
        { path: "IMG_92.JPG", size: 4092, md5: QX(92) }] });
      await rpcAs("fph", "photo_upload_seal", { p_upload: nine.upload.id, p_files: 2, p_bytes: 8183 });
      await as("fph");
      await q("update public.photo_shoot_uploads set sealed_at = now() - interval '20 days' where id = $1", [nine.upload.id]);
      await q("update public.photo_drive_folders set stalled_at = now() where shoot_id = $1 and kind = 'shoot' and retired_at is null", [S.phone]);
      const facts9 = async () => {
        const st = await R.status(S.phone);
        return [Number(st.uploads.find((x) => Number(x.id) === Number(nine.upload.id)).stalled), st.files.stalled, st.help.includes("stalled"),
          F.filesView(st, { today, now: Date.now() }).lines.some((l) => l.code === "stalled")];
      };
      r9.progress = [await facts9()];
      const b9 = await R.beat(nine.upload.id, { state: "sending", bytesSent: 400, sentFiles: 0, rateBps: 1000 });
      r9.progress.push(await facts9());
      await q("update public.photo_shoot_uploads set progress_at = now() - interval '15 days' where id = $1", [nine.upload.id]);
      r9.progress.push(await facts9());
      same(r9.progress, [[2, true, true, true], [0, false, false, false], [2, true, true, true]],
        "NINE-PC's 2 stalled files; its PC sending them again: never stalled while it moves; 15 days after that progress: stalled again");
      // the beat names the shoot the hand-in is in now (a plan dropped and mirrored again moves it; the phone reads none)
      r9.beat = [keysOf(b9.upload), Number(b9.upload.shoot_id) === Number(S.phone)];
      same(r9.beat, [["id", "send_state", "shoot_id", "state"], true], "photo_upload_beat answers upload.shoot_id");
      // late and stalled only while the shoot's sealed files wait (app.photo_help_now): a problem speaks for the shoot
      // until it is sorted out - a confirmed phone file read different in OneDrive, then sorted out again
      await q("update public.photo_drive_folders set late_at = now() where shoot_id = $1 and kind = 'shoot' and retired_at is null", [S.phone]);
      const fold9 = Number((await q("select id from public.photo_drive_folders where shoot_id = $1 and kind = 'shoot' and retired_at is null", [S.phone]))[0].id);
      const odd9 = (await q("select id from public.photo_shoot_files where folder_id = $1 and counted and state = 'confirmed' order by id limit 1", [fold9]))[0].id;
      const help9 = async () => (await R.status(S.phone)).help;
      r9.help = [await help9()];
      await q("update public.photo_shoot_files set state = 'mismatch' where id = $1", [odd9]);
      await q("select app.photo_folder_recount($1)", [fold9]);
      r9.help.push(await help9());
      await q("update public.photo_shoot_files set state = 'confirmed' where id = $1", [odd9]);
      await q("select app.photo_folder_recount($1)", [fold9]);
      r9.help.push(await help9());
      same(r9.help, [["late", "stalled"], ["problem"], ["late", "stalled"]], "late and stalled while the sealed files wait; a problem alone while it speaks");
      // done on a row of its hand-in LEFT OUT meanwhile (OD §4.5): DCR's own item kept on it (drive_file_id, committed),
      // still not_waiting - never an item not made by DCR, nor another row's (H: F's item, the same size)
      const ten = await rpcAs("fph", "photo_upload_begin", { p_shoot: S.phone, p_client_key: "schema-pc-ten", p_device_key: "pk_SchemaPcRoundNine00001",
        p_device_label: "NINE-PC", p_source: "pc", p_replaces: null });
      await rpcAs("fph", "photo_upload_files", { p_upload: ten.upload.id, p_files: [{ path: "IMG_93.JPG", size: 4093, md5: QX(93) },
        { path: "IMG_94.JPG", size: 4094, md5: QX(94) }, { path: "IMG_95.JPG", size: 4093, md5: QX(95) }] });
      await rpcAs("fph", "photo_upload_seal", { p_upload: ten.upload.id, p_files: 3, p_bytes: 12280 });
      const tenRows = await rowsOf(ten.upload.id);
      await svc("gdrive_sessions_made", [[MINE.fph.id, "uuid"], [ten.upload.id, "bigint"], [tenRows.map((r) => ({ file_id: Number(r.id), step: "session" })), "jsonb"]]);
      await rpcAs("fph", "photo_files_resolve", { p_shoot: S.phone, p_file_ids: tenRows.map((r) => Number(r.id)), p_action: "leave_out", p_note: null });
      const seen9 = await svc("gdrive_items_seen", [[MINE.fph.id, "uuid"], [ten.upload.id, "bigint"], [[
        { file_id: Number(tenRows[0].id), item: okItem(ITEM(9301), 4093, QX(93), { path: "IMG_93.JPG" }) },
        { file_id: Number(tenRows[1].id), item: okItem(ITEM(9302), 4094, QX(94), { path: "IMG_94.JPG", by_app: false }) },
        { file_id: Number(tenRows[2].id), item: okItem(ITEM(9301), 4093, QX(93), { path: "IMG_93.JPG" }) }], "jsonb"]]);
      const after9 = await q("select id, state, removed_reason, drive_file_id, upload_step from public.photo_shoot_files where last_upload_id = $1 order by id", [ten.upload.id]);
      r9.kept = [seen9.items.map((x) => x.state || x.code), after9.map((r) => [r.state, r.removed_reason, r.drive_file_id === null ? null : r.drive_file_id === ITEM(9301), r.upload_step])];
      same(r9.kept, [["not_waiting", "not_waiting", "not_waiting"], [["removed", "left_out", true, "committed"], ["removed", "left_out", null, "session"],
        ["removed", "left_out", null, "session"]]], "F keeps DCR's own item; G's item not DCR's and H's another row's: never kept");
      W.answers.round9 = r9;
      // review round 10 (OD §3.2.5, §6.6, §28), in a shoot of its own on a computer of its own (TEN-PC): 1. a PC's disk
      // full while it sends - photo_upload_beat takes disk_full, the status answers it and the phone's line says so while
      // the beat is fresh, even once late is stamped; 5 minutes old: late, or paused_pc without the stamp. 2. a hand-in
      // queued behind a send of its own computer is never stalled: A sealed 20 days ago (the mode changed 20 days ago,
      // above), its own last beat waiting_turn, B of TEN-PC beating sending now - no stalled row, files.stalled, help
      // stalled, file-list stalled nor stalled line; B's beat 3 minutes old: stalled again; A beating paused (no
      // waiting_turn of its own) while B sends: stalled. The drift check below asks the demo the same
      const r10 = {};
      SHOOTS.ten = { local_id: 5, key: "framing-ten", seq: 130, phase: "framing_progress", name: "Framing ten", anchor: "fixed", offset_days: 0,
        fixed_date: today, planned_date: today, window_days: 0, status: "planned" };
      const m10 = await mirror();
      ok(m10.ok, "mirrored: " + JSON.stringify(m10).slice(0, 160));
      for (const s of m10.shoots) S[Object.keys(SHOOTS).find((k) => SHOOTS[k].local_id === s.local_id)] = s.id;
      ok(S.ten, "the round 10 shoot");
      const pc10 = async (tag, list) => {
        const b = await rpcAs("fph", "photo_upload_begin", { p_shoot: S.ten, p_client_key: "schema-pc-r10-" + tag, p_device_key: "pk_SchemaPcRoundTen000001",
          p_device_label: "TEN-PC", p_source: "pc", p_replaces: null });
        await rpcAs("fph", "photo_upload_files", { p_upload: b.upload.id, p_files: list });
        await rpcAs("fph", "photo_upload_seal", { p_upload: b.upload.id, p_files: list.length, p_bytes: list.reduce((t, f) => t + f.size, 0) });
        return Number(b.upload.id);
      };
      const fold10 = (set) => q("update public.photo_drive_folders set " + set + " where shoot_id = $1 and kind = 'shoot' and retired_at is null", [S.ten]);
      const K = await pc10("k", [{ path: "IMG_101.JPG", size: 4101, md5: QX(101) }, { path: "IMG_102.JPG", size: 4102, md5: QX(102) }]);
      await foldersMade(S.ten);
      await as("fph");
      const bk = await R.beat(K, { state: "disk_full", bytesSent: 0, sentFiles: 0 });
      const line10 = async () => F.filesView(await R.status(S.ten), { today, now: Date.now() }).lines[0];
      const lk = await line10();
      r10.disk = [bk.upload.send_state, (await R.status(S.ten)).uploads.find((x) => Number(x.id) === K).send_state, lk.code, lk.text, lk.tone];
      same(r10.disk, ["disk_full", "disk_full", "disk_full", F.word("files", "disk_full", { pc: "TEN-PC" }), "warn"],
        "a fresh disk_full beat: \"TEN-PC is out of disk space…\"");
      await fold10("late_at = now()");
      r10.disk.push((await line10()).code);
      await q("update public.photo_shoot_uploads set send_beat_at = now() - interval '5 minutes' where id = $1", [K]);
      r10.disk.push((await line10()).code);
      await fold10("late_at = null");
      r10.disk.push((await line10()).code);
      same(r10.disk.slice(5), ["disk_full", "late", "paused_pc"], "late stamped: still disk_full while fresh; 5 minutes old: late, else paused_pc");
      // (K's files sent, so the queued world below is A's and B's alone)
      await q("update public.photo_shoot_files set upload_step = 'committed', drive_file_id = 'FAKEITEM' || lpad(id::text, 14, '0') where last_upload_id = $1", [K]);
      const A10 = await pc10("a", [{ path: "IMG_103.JPG", size: 4103, md5: QX(103) }, { path: "IMG_104.JPG", size: 4104, md5: QX(104) }]);
      const B10 = await pc10("b", [{ path: "IMG_105.JPG", size: 4105, md5: QX(105) }]);
      await q("update public.photo_shoot_uploads set sealed_at = now() - interval '20 days' where id = $1", [A10]);
      await fold10("stalled_at = now()");
      await as("fph");
      const facts10 = async () => {
        const st = await R.status(S.ten);
        client.as(MINE.fph.id);
        const pg = (await client.rpc("photo_shoot_files_page", { p_shoot: S.ten, p_filter: null, p_after: null, p_limit: 500 })).data;
        await as("fph");
        return [Number(st.uploads.find((x) => Number(x.id) === A10).stalled), st.files.stalled, st.help.includes("stalled"),
          pg.files.filter((x) => x.stalled === true).length, F.filesView(st, { today, now: Date.now() }).lines.some((l) => l.code === "stalled")];
      };
      r10.queued = [await facts10()];
      await R.beat(A10, { state: "waiting_turn", bytesSent: 0, sentFiles: 0 });
      await R.beat(B10, { state: "sending", bytesSent: 0, sentFiles: 0, rateBps: 1000 });
      r10.queued.push(await facts10());
      r10.queuedState = (await R.status(S.ten)).uploads.find((x) => Number(x.id) === A10).send_state;
      await q("update public.photo_shoot_uploads set send_beat_at = now() - interval '3 minutes' where id = $1", [B10]);
      r10.queued.push(await facts10());
      await R.beat(B10, { state: "sending", bytesSent: 0, sentFiles: 0, rateBps: 1000 });
      await R.beat(A10, { state: "paused", bytesSent: 0, sentFiles: 0 });
      r10.queued.push(await facts10());
      same([r10.queued, r10.queuedState], [[[2, true, true, 2, true], [0, false, false, 0, false], [2, true, true, 2, true], [2, true, true, 2, true]], "queued"],
        "A's 2 stalled rows; queued behind B on TEN-PC: never stalled; B's beat 3 minutes old: stalled again; A's own beat paused: stalled");
      W.answers.round10 = r10;
      await q("update public.photo_drive_folders set late_at = null where shoot_id = $1 and kind = 'shoot' and retired_at is null", [S.phone]);
      await q("update app.photo_drive set mode_at = $1 where id = 1", [mode0]);
      await q("update public.photo_drive_folders set stalled_at = null where shoot_id = $1 and kind = 'shoot' and retired_at is null", [S.phone]);
    });

    await check("P10 photo files: drift - the demo database's answers have the real answers' keys (the status and its parts, the Ready list and an item, an act's answer, the taken refusal's detail, the phone's RPCs)", async () => {
      await as("fmk1");
      const real = W.done;
      const fake = await demoAs("viewer", () => R.status(demoShoot("A000T9", "site-walk")));
      same(keysOf(fake), keysOf(real), "photo_drive_status");
      for (const k of ["root", "folder", "files", "me", "can", "marketing"]) same(keysOf(fake[k]), keysOf(real[k]), "photo_drive_status." + k);
      // (the real status lists the open hand-ins and the sealed ones still sending; one of the phone's own for the keys)
      await as("fph");
      const realUp = (await R.status(S.walk)).uploads[0];
      same(keysOf((fake.uploads || [])[0]), keysOf(realUp), "photo_drive_status.uploads[]");
      await as("fmk1");
      same([fake.marketing.told, real.marketing.told], [[], []], "photo_drive_status.marketing.told for marketing");
      const fakeAdmin = await demoAs("admin", () => R.status(demoShoot("A000T9", "site-walk")));
      ok(fakeAdmin.marketing.told.length > 0 && W.doneAdmin.marketing.told.length > 0, "an admin reads who was told in both");
      same(keysOf(fakeAdmin.marketing.told[0]), keysOf(W.doneAdmin.marketing.told[0]), "photo_drive_status.marketing.told[]");
      const rl = await R.readyList("done");
      const fl = await demoAs("viewer", () => R.readyList("done"));
      same(keysOf(fl), keysOf(rl), "photo_ready_list");
      same(keysOf(fl.me), keysOf(rl.me), "photo_ready_list.me");
      same(keysOf(fl.counts), keysOf(rl.counts), "photo_ready_list.counts");
      await as("admin");
      const ro = await R.readyList("open");
      const fo = await demoAs("viewer", () => R.readyList("open"));
      const realItem = ro.items[0];
      const fakeItem = fo.items.find((i) => i.state === "claimed");
      same(keysOf(fakeItem), keysOf(realItem), "photo_ready_list.items[]");
      for (const k of ["files", "claimed", "folder", "can"]) same(keysOf(fakeItem[k]), keysOf(realItem[k]), "photo_ready_list.items[]." + k);
      const fakeAct = await demoAs("viewer", async () => R.act(fo.items.find((i) => i.state === "ready").id, "claim", "ready"));
      same(keysOf(fakeAct), keysOf(W.act), "photo_marketing_act's answer");
      const fakeTaken = await demoAs("viewer", async () => R.act(fakeItem.id, "claim", "claimed").then(() => null, (e) => e));
      same([fakeTaken.code, fakeTaken.hint, keysOf(fakeTaken.detail)], ["PT409", "taken", ["at", "by", "id", "table", "version"]], "the demo's taken");
      await as("fmk2");
      const realTaken = await refused(() => R.act(realItem.id, "claim", "claimed"), "PT409", "taken");
      same(keysOf(realTaken.detail), keysOf(fakeTaken.detail), "the taken detail");
      // the phone's RPCs (OD §5.6), on a demo shoot with no files yet and the demo's phone switch on
      const dev = demo.exts.find((x) => x.name === "p10-photo-files").__dev;
      dev.state({ phone: true });
      const bare = demo.rows.photo_shoots.find((s) => s.status === "planned" && !demo.rows.photo_drive_folders.some((f) => f.shoot_id === s.id));
      const A = W.answers;
      await demoAs("field", async () => {
        const db = await R.begin(bare.id, { clientKey: "drift-phone-1", deviceKey: DEV.phone, label: "iPhone" });
        same([keysOf(db), keysOf(db.upload)], [keysOf(A.begin), keysOf(A.begin.upload)], "photo_upload_begin's answer");
        const df = await R.record(db.upload.id, [{ path: "Phone/IMG_0001.JPG", size: 100, md5: QX(41) }]);
        same([keysOf(df), keysOf(df.files[0])], [keysOf(A.files), keysOf(A.files.files[0])], "photo_upload_files' answer");
        const dbt = await R.beat(db.upload.id, { state: "sending", bytesSent: 10, sentFiles: 0 });
        same([keysOf(dbt), keysOf(dbt.upload)], [keysOf(A.beat), keysOf(A.beat.upload)], "photo_upload_beat's answer");
        const dsl = await R.seal(db.upload.id, 1, 100);
        same([keysOf(dsl), keysOf(dsl.upload), keysOf(dsl.folder)], [keysOf(A.seal), keysOf(A.seal.upload), keysOf(A.seal.folder)], "photo_upload_seal's answer");
        const db2 = await R.begin(bare.id, { clientKey: "drift-phone-2", deviceKey: DEV.phone, label: "iPhone" });
        for (const s of R.SEND_STATES) same((await R.beat(db2.upload.id, { state: s, bytesSent: 0, sentFiles: 0 })).upload.send_state, s, "the demo's photo_upload_beat takes " + s);
        same(keysOf(await R.cancel(db2.upload.id)), keysOf(A.cancel), "photo_upload_cancel's answer");
        // (review round 5) the same count as the migration's: a removed row whose session was handed out is in removed_sent
        const db3 = await R.begin(bare.id, { clientKey: "drift-phone-3", deviceKey: DEV.phone, label: "iPhone" });
        const df3 = await R.record(db3.upload.id, [{ path: "Phone/IMG_0061.JPG", size: 100 }, { path: "Phone/IMG_0062.JPG", size: 101 }]);
        await R.sessions(db3.upload.id, DEV.phone, [{ file_id: df3.byIndex[0].file_id }]);
        const dc3 = await R.cancel(db3.upload.id);
        same([dc3.removed, dc3.removed_sent, dc3.put_back_ids], A.cancelSession, "the demo's removed_sent counts a session handed out, as the migration's");
        // (review round 6) an open PC hand-in's running clock, as the migration's: only bytes that grew move it
        const dpc = await R.begin(bare.id, { clientKey: "drift-pc-clock", deviceKey: DEV.phone, label: "iPhone" });
        await R.record(dpc.upload.id, [{ path: "Phone/IMG_0066.JPG", size: 4096 }]);
        Object.assign(demo.rows.photo_shoot_uploads.find((u) => u.id === dpc.upload.id), { source: "pc", pc_label: "SCHEMA-PC",
          beat_at: new Date(Date.now() - 5 * 60e3).toISOString(), bytes_sent: 500 });
        const druns = async () => (await R.status(bare.id)).uploads.find((x) => Number(x.id) === Number(dpc.upload.id)).running;
        const dclock = [await druns()];
        await R.beat(dpc.upload.id, { state: "onedrive_full", bytesSent: 500, sentFiles: 0 });
        dclock.push(await druns());
        await R.beat(dpc.upload.id, { state: "sending", bytesSent: 900, sentFiles: 0 });
        dclock.push(await druns());
        same(dclock, A.pcClock, "the demo's open PC hand-in's running clock, as the migration's");
        await R.cancel(dpc.upload.id);
        // (review round 6) the cancel's put back rule 0, as the migration's
        const d0a = await R.begin(bare.id, { clientKey: "drift-phone-r0a", deviceKey: DEV.phone, label: "iPhone" });
        const d0id = (await R.record(d0a.upload.id, [{ path: "Phone/IMG_0081.JPG", size: 100, md5: QX(81) }])).byIndex[0].file_id;
        await R.seal(d0a.upload.id, 1, 100);
        Object.assign(demo.rows.photo_shoot_files.find((r) => r.id === d0id), { state: "waiting", upload_step: "to_send", confirmed_at: null,
          drive_file_id: ITEM(81), drive_size: 100, drive_md5: QX(82), resends: 1, replace_upload_id: d0a.upload.id });
        const d0b = await R.begin(bare.id, { clientKey: "drift-phone-r0b", deviceKey: DEV.phone, label: "iPhone" });
        same((await R.record(d0b.upload.id, [{ path: "Phone/IMG_0081.JPG", size: 100, md5: QX(81) }])).byIndex[0].verdict, "recopied", "the demo's recopied");
        await R.cancel(d0b.upload.id);
        const d0 = demo.rows.photo_shoot_files.find((r) => r.id === d0id);
        same([d0.last_upload_id === d0a.upload.id, d0.state, d0.upload_step, d0.drive_file_id === ITEM(81), d0.replace_upload_id === d0a.upload.id, d0.resends],
          A.rule0, "the demo's put back rule 0, as the migration's");
        // (review round 7) the same after a session of the row's own bytes: a resend given back, back_at stamped
        const d7b = await R.begin(bare.id, { clientKey: "drift-phone-r7b", deviceKey: DEV.phone, label: "iPhone" });
        same((await R.record(d7b.upload.id, [{ path: "Phone/IMG_0081.JPG", size: 100, md5: QX(81) }])).byIndex[0].verdict, "recopied", "the demo's recopied, again");
        await R.sessions(d7b.upload.id, DEV.phone, [{ file_id: d0id }]);
        same(demo.rows.photo_shoot_files.find((r) => r.id === d0id).upload_step, "session", "the demo's session made");
        const t7 = Date.now();
        await R.cancel(d7b.upload.id);
        const d7 = demo.rows.photo_shoot_files.find((r) => r.id === d0id);
        same([d7.last_upload_id === d0a.upload.id, d7.state, d7.upload_step, d7.drive_file_id === ITEM(81), d7.replace_upload_id === d0a.upload.id, d7.resends,
          !!d7.back_at && Date.parse(d7.back_at) >= t7 - 60e3], A.rule0Session, "the demo's put back rule 0 after a session of the row's own bytes, as the migration's");
        // (review round 7) the stalled line's rows, as the migration's: a PC hand-in's 2 files sealed 20 days ago beside a
        // fresher one's 3 still sending on OFFICE-PC (the demo's phone RPCs record them; the hand-ins made PCs')
        const bare2 = demo.rows.photo_shoots.find((s) => s.status === "planned" && s.id !== bare.id && !demo.rows.photo_drive_folders.some((f) => f.shoot_id === s.id));
        const pcOf = async (tag, n, label, sealedAt) => {
          const b = await R.begin(bare2.id, { clientKey: "drift-stall-" + tag, deviceKey: DEV.phone, label: "iPhone" });
          const list = Array.from({ length: n }, (_, i) => ({ path: "IMG_" + tag + i + ".JPG", size: 4096 + i, md5: QX(7100 + 10 * n + i) }));
          await R.record(b.upload.id, list);
          await R.seal(b.upload.id, n, list.reduce((t, f) => t + f.size, 0));
          Object.assign(demo.rows.photo_shoot_uploads.find((u) => u.id === b.upload.id), { source: "pc", pc_label: label, sealed_at: sealedAt,
            send_state: "sending", send_beat_at: tag === "fresh" ? new Date().toISOString() : null });
          return b.upload.id;
        };
        const ds = await pcOf("old", 2, "SCHEMA-PC", new Date(Date.now() - 20 * 86400e3).toISOString());
        const dfr = await pcOf("fresh", 3, "OFFICE-PC", new Date().toISOString());
        demo.rows.photo_drive_folders.find((f) => f.shoot_id === bare2.id && f.kind === "shoot").stalled_at = new Date().toISOString();
        const dst = await R.status(bare2.id);
        const dof = Object.fromEntries(dst.uploads.map((x) => [x.id, x.stalled]));
        const dv = F.filesView(dst, { today, now: Date.now() });
        same([dof[ds], dof[dfr], dv.lines[0].code, dv.lines[0].text], A.stalled, "the demo's stalled line and its rows, as the migration's");
        // (review round 8) files.stalled and the help stalled only while a stalled row is left, and the sending line's
        // send_files / send_bytes, as the migration's: the stalled rows sent before the next tick, then the fresher
        // hand-in's third file left out during its send (the demo has no photo_files_resolve: the row is left out as it
        // leaves one out)
        const dfold = demo.rows.photo_drive_folders.find((f) => f.shoot_id === bare2.id && f.kind === "shoot");
        dfold.help = ["stalled"];                                         // (the tick's event with its stamp)
        const d8b = await R.status(bare2.id);
        const d8 = { before: [d8b.files.stalled, d8b.help.includes("stalled")] };
        demo.rows.photo_shoot_files.filter((r) => r.last_upload_id === ds).forEach((r) => { Object.assign(r, { upload_step: "committed", drive_file_id: ITEM(8000 + r.id) }); });
        const d8s = await R.status(bare2.id);
        d8.sent = [d8s.files.stalled, d8s.help.includes("stalled"), d8s.uploads.reduce((t, x) => t + Number(x.stalled || 0), 0),
          F.filesView(d8s, { today, now: Date.now() }).lines.some((l) => l.code === "stalled")];
        Object.assign(demo.rows.photo_shoot_files.filter((r) => r.last_upload_id === dfr).sort((x, y) => x.id - y.id)[2],
          { state: "removed", removed_reason: "left_out", removed_by: PEOPLE.fph.id });
        await R.beat(dfr, { state: "sending", bytesSent: 4096, sentFiles: 1, rateBps: 1000 });
        const d8c = await R.status(bare2.id);
        const du8 = d8c.uploads.find((x) => x.id === dfr);
        const dv8 = F.filesView(d8c, { today, now: Date.now() });
        d8.send = [du8.files, du8.bytes, du8.send_files, du8.send_bytes, dv8.lines[0].code, dv8.lines[0].text];
        same(d8, A.round8, "the demo's round 8 (stalled while a stalled row is left; send_files / send_bytes), as the migration's");
        // (review round 9) stalled from the hand-in's own last progress too, the beat's shoot_id, late and stalled only
        // while the sealed files wait, and done keeping DCR's own item on a left-out row - as the migration's (the demo's
        // rows read again each time: its writes put a new row in its place; no photo_files_resolve: a row is left out as
        // it leaves one out; a problem and the tick's events set on the folder row as a recount and the help pass would)
        const dfold9 = () => demo.rows.photo_drive_folders.find((f) => f.shoot_id === bare2.id && f.kind === "shoot" && !f.retired_at);
        const dup9 = (id) => demo.rows.photo_shoot_uploads.find((u) => u.id === id);
        const pc9 = async (tag, list, sealedAt) => {
          const b = await R.begin(bare2.id, { clientKey: "drift-r9-" + tag, deviceKey: DEV.phone, label: "iPhone" });
          await R.record(b.upload.id, list);
          await R.seal(b.upload.id, list.length, list.reduce((t, f) => t + f.size, 0));
          Object.assign(dup9(b.upload.id), { source: "pc", pc_label: "NINE-PC", sealed_at: sealedAt });
          return b.upload.id;
        };
        const dn = await pc9("nine", [{ path: "IMG_91.JPG", size: 4091, md5: QX(91) }, { path: "IMG_92.JPG", size: 4092, md5: QX(92) }],
          new Date(Date.now() - 20 * 86400e3).toISOString());
        Object.assign(dfold9(), { stalled_at: new Date().toISOString(), help: ["stalled"] });
        const dfacts9 = async () => {
          const st = await R.status(bare2.id);
          return [Number(st.uploads.find((x) => x.id === dn).stalled), st.files.stalled, st.help.includes("stalled"),
            F.filesView(st, { today, now: Date.now() }).lines.some((l) => l.code === "stalled")];
        };
        const d9 = { progress: [await dfacts9()] };
        const db9 = await R.beat(dn, { state: "sending", bytesSent: 400, sentFiles: 0, rateBps: 1000 });
        d9.progress.push(await dfacts9());
        dup9(dn).progress_at = new Date(Date.now() - 15 * 86400e3).toISOString();
        d9.progress.push(await dfacts9());
        d9.beat = [keysOf(db9.upload), Number(db9.upload.shoot_id) === Number(bare2.id)];
        Object.assign(dfold9(), { late_at: new Date().toISOString(), help: ["late", "problem", "stalled"] });
        const dhelp9 = async () => (await R.status(bare2.id)).help;
        d9.help = [await dhelp9()];
        dfold9().mismatch = 1;
        d9.help.push(await dhelp9());
        dfold9().mismatch = 0;
        d9.help.push(await dhelp9());
        const dt = await pc9("ten", [{ path: "IMG_93.JPG", size: 4093, md5: QX(93) }, { path: "IMG_94.JPG", size: 4094, md5: QX(94) },
          { path: "IMG_95.JPG", size: 4093, md5: QX(95) }], new Date().toISOString());
        const dtRows = () => demo.rows.photo_shoot_files.filter((r) => r.last_upload_id === dt).sort((x, y) => x.id - y.id);
        await R.sessions(dt, DEV.phone, dtRows().map((r) => ({ file_id: r.id })));
        const dtIds = dtRows().map((r) => r.id);
        for (const id of dtIds) Object.assign(demo.rows.photo_shoot_files.find((r) => r.id === id), { state: "removed", removed_reason: "left_out", removed_by: PEOPLE.fph.id });
        const ditem = (id, size, path, byApp) => ({ id: 9300 + size, item_id: id, folder_id: dfold9().id, path, size, qx: null, later_qx: null, by_app: byApp,
          created_at: new Date().toISOString() });
        demo.rows.demo_photo_items.push(ditem(ITEM(9301), 4093, "IMG_93.JPG", true), ditem(ITEM(9302), 4094, "IMG_94.JPG", false));
        const dd9 = await R.done(dt, DEV.phone, [{ file_id: dtIds[0], item_id: ITEM(9301) }, { file_id: dtIds[1], item_id: ITEM(9302) },
          { file_id: dtIds[2], item_id: ITEM(9301) }]);
        d9.kept = [dd9.items.map((x) => x.state || x.code), dtRows().map((r) => [r.state, r.removed_reason, r.drive_file_id === null ? null : r.drive_file_id === ITEM(9301),
          r.upload_step])];
        same(d9, A.round9, "the demo's round 9 (stalled from the hand-in's own progress, the beat's shoot_id, late and stalled while the files wait, done keeping DCR's item on a left-out row), as the migration's");
        // (review round 10) disk_full and the queued rule, as the migration's: a shoot and a computer of their own - in a
        // demo database of its own (the seed has two shoots without files, both taken above), the field person's
        const demo10 = await H.freshEngine(new Date());
        demo10.exts.find((x) => x.name === "p10-photo-files").__dev.state({ phone: true });
        _db.useClient(H.clientAs(demo10, NS.PEOPLE.find((p) => p.key === "field").id));
        const bare3 = demo10.rows.photo_shoots.find((s) => s.status === "planned" && !demo10.rows.photo_drive_folders.some((f) => f.shoot_id === s.id));
        const TEN = "pk_DriftRoundTen000000001";
        const dfold10 = () => demo10.rows.photo_drive_folders.find((f) => f.shoot_id === bare3.id && f.kind === "shoot" && !f.retired_at);
        const dup10 = (id) => demo10.rows.photo_shoot_uploads.find((u) => u.id === id);
        const pc10d = async (tag, list) => {
          const b = await R.begin(bare3.id, { clientKey: "drift-r10-" + tag, deviceKey: TEN, label: "iPhone" });
          await R.record(b.upload.id, list);
          await R.seal(b.upload.id, list.length, list.reduce((t, f) => t + f.size, 0));
          Object.assign(dup10(b.upload.id), { source: "pc", pc_label: "TEN-PC" });
          return b.upload.id;
        };
        const dK = await pc10d("k", [{ path: "IMG_101.JPG", size: 4101, md5: QX(101) }, { path: "IMG_102.JPG", size: 4102, md5: QX(102) }]);
        Object.assign(dfold10(), { drive_state: "found" });
        const dbk = await R.beat(dK, { state: "disk_full", bytesSent: 0, sentFiles: 0 });
        const dline10 = async () => F.filesView(await R.status(bare3.id), { today, now: Date.now() }).lines[0];
        const dlk = await dline10();
        const d10 = { disk: [dbk.upload.send_state, (await R.status(bare3.id)).uploads.find((x) => x.id === dK).send_state, dlk.code, dlk.text, dlk.tone] };
        dfold10().late_at = new Date().toISOString();
        d10.disk.push((await dline10()).code);
        dup10(dK).send_beat_at = new Date(Date.now() - 300e3).toISOString();
        d10.disk.push((await dline10()).code);
        dfold10().late_at = null;
        d10.disk.push((await dline10()).code);
        demo10.rows.photo_shoot_files.filter((r) => r.last_upload_id === dK).forEach((r) => { Object.assign(r, { upload_step: "committed", drive_file_id: ITEM(10000 + r.id) }); });
        const dA = await pc10d("a", [{ path: "IMG_103.JPG", size: 4103, md5: QX(103) }, { path: "IMG_104.JPG", size: 4104, md5: QX(104) }]);
        const dB = await pc10d("b", [{ path: "IMG_105.JPG", size: 4105, md5: QX(105) }]);
        dup10(dA).sealed_at = new Date(Date.now() - 20 * 86400e3).toISOString();
        Object.assign(dfold10(), { stalled_at: new Date().toISOString(), help: ["stalled"] });
        const c10 = await _db.db();
        const dfacts10 = async () => {
          const st = await R.status(bare3.id);
          const pg = (await c10.rpc("photo_shoot_files_page", { p_shoot: bare3.id, p_filter: null, p_after: null, p_limit: 500 })).data;
          return [Number(st.uploads.find((x) => x.id === dA).stalled), st.files.stalled, st.help.includes("stalled"),
            pg.files.filter((x) => x.stalled === true).length, F.filesView(st, { today, now: Date.now() }).lines.some((l) => l.code === "stalled")];
        };
        d10.queued = [await dfacts10()];
        await R.beat(dA, { state: "waiting_turn", bytesSent: 0, sentFiles: 0 });
        await R.beat(dB, { state: "sending", bytesSent: 0, sentFiles: 0, rateBps: 1000 });
        d10.queued.push(await dfacts10());
        d10.queuedState = (await R.status(bare3.id)).uploads.find((x) => x.id === dA).send_state;
        dup10(dB).send_beat_at = new Date(Date.now() - 180e3).toISOString();
        d10.queued.push(await dfacts10());
        await R.beat(dB, { state: "sending", bytesSent: 0, sentFiles: 0, rateBps: 1000 });
        await R.beat(dA, { state: "paused", bytesSent: 0, sentFiles: 0 });
        d10.queued.push(await dfacts10());
        same(d10, A.round10, "the demo's round 10 (a fresh disk_full beat's line, the queued rule of app.photo_row_stalled), as the migration's");
        _db.useClient(H.clientAs(demo, NS.PEOPLE.find((p) => p.key === "field").id));
        const c = await _db.db();
        const dp = (await c.rpc("photo_shoot_files_page", { p_shoot: bare.id, p_filter: null, p_after: null, p_limit: 500 })).data;
        same([keysOf(dp), keysOf(dp.files[0])], [keysOf(A.page), keysOf(A.page.files[0])], "photo_shoot_files_page's answer");
      });
    });
  } finally {
    _db.useClient(null);
  }
}
