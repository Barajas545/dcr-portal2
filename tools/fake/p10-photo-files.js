/* DCR Portal 2 — DEMO MODE ONLY: the photo files (the photographer screen program, P5, the OneDrive edition; DCR
   Desktop 2 migrations 20261111000100_photo_files and 20261114000100_photo_files_onedrive and the Edge Function
   photo-files; the contract is DCR Desktop 2's docs/PHOTO-FILES-ONEDRIVE.md, cited OD) in the in-memory database, read
   and written by site/js/repo/photo-files.js. Loaded AFTER tools/fake/p10-photo.js and BEFORE engine.js
   (tools/devserve.mjs FAKE_PARTS, tests/pages-engine.mjs); installed into each engine (NS.extInstall), its made-up rows
   join the seed (NS.extSeed). Never published (tools/ is not part of the site).

   The same names, rules, SQLSTATEs, hints and sentences as the migrations:
   * public.photo_drive_folders / photo_shoot_uploads / photo_marketing (read by admins and the photo team; written by
     nobody but the RPCs, the demo's ready check and the photo-files stand-in). A folder row here keeps its rollup counts
     itself (the database counts photo_shoot_files rows; the demo has none - no phone reads them); each shoot folder sits
     in its plan's job folder (kind job, parent_id), whose state and owner the ready rule's rule 3 reads;
   * photo_drive_status (app.photo_drive_status_json of the OneDrive edition, OD §5.5, §10.6: the uploads mode for the
     shoot - mode, mode_codes -, the four-valued access, can.add_files / add_from_phone, the hand-ins' sending fields,
     the shoot's job folder - its folder row's parent, or the plan's live job row while it has none, review round 1;
     that job folder gone while the shoot's own folder is not in OneDrive: the completion's job_gone and the help's
     folder_gone said as folder_gone_job; queued never over a lost or paused beat, nor over an outbox_away one under 2
     minutes old - review rounds 3 and 4; a stored waiting_turn - the PC's own word for a hand-in behind the one it
     sends - answered queued, or sending while nothing of that device sends, review round 4; the help lost - a sealed PC
     hand-in whose fresh beat says its files are lost, with rows to send: "Memory card needed" - review round 5;
     each hand-in's stalled - how many of its rows app.photo_row_stalled holds for, the stalled line's rows - review
     round 7; each hand-in's send_files / send_bytes - its rows not left out or removed, the sending line's totals - and
     files.stalled and the help stalled only while a stalled row is left - review round 8; a row stalled 14 days after
     its hand-in's own last progress too, and the help late and stalled only while the shoot's sealed files wait
     (app.photo_sealed_state: a problem speaks for the shoot) - review round 9; never a row of a hand-in queued behind a
     send of its own computer (its own last beat waiting_turn, another hand-in of that computer beating sending under 2
     minutes old) - review round 10; the ready rule, the completion code and
     files_state ported - NS.p10FilesRules, held to the shared cases' ready / completion / files_state sections by
     tests/p10-photo-files-demo.test.mjs), photo_ready_list and photo_marketing_act (every rule and refusal);
   * the ready check (app.photo_shoot_ready_check): ready once per shoot, the completer left out of who is told,
     withdrawn when the shoot is no longer done, back to its old state (no new notice) when it is done again;
   * marketing's culls after Ready (files.culled - a folder row's own count, answered only while the shoot is on the
     list - never a help notice), who was told answered to admins only, Not for posting of someone else's card an
     admin's (not_yours), and a card claimed by someone taken off marketing (set_photo_team, tools/fake/p10-photo.js) or
     turned off / no longer an admin (admin_set_profile, tools/fake/p7-web.js) back to ready (app.photo_release_claims_of);
   * Back on the list of a passed card sent again - back on the list, nobody on it, its last change (updated_by: the
     act's own writes carry who sent it) the sender's - is {again: true}; another person's send from that screen state
     stays PT409 changed; Posted… / Not for posting… sent again by their sender keep what the resend carries - the
     ticks, a corrected link, the note, the reason - checked as a first send (bad_where, bad_link); a field sent empty
     keeps the row's (photo_marketing_act's again);
   * the Edge Function photo-files (engine.invoke): check (20 s per shoot, 30 per 10 minutes per person; a demo check
     moves the seeded waiting files on to confirmed - dev.advance - and judges every file row whose item landed);
   * the phone's hand-in (OD §3.3, §4.5, §5.6; the build plan's P7): photo_upload_begin (p_source 'phone': the mode, the
     phone switch, the root, the folder; the shoot's folder rows claimed; the device registered - its id fixed by its
     key, so a reload finds it again; one open hand-in per shoot: open_elsewhere / stopped_elsewhere, the same key
     opening its own again; a job folder gone refused folder_gone first, the job in its detail), photo_upload_files
     (path, size, NO hash - a phone's file with its hash too; files[] with each file_id by i; a taken name refused
     name_taken; a phone's file a check sent back after its phone's seal, recorded with the same bytes, recopied and
     sent by this hand-in, OD §3.5 - what a cancel puts back kept; a phone's record asked again after its answer was
     lost the same row, sent by this hand-in, never " (2)" - review round 2), photo_upload_beat (beat_at while open -
     never for waiting_turn, review round 5, and a PC's only when bytes_sent grew, review round 6 -, the sending fields;
     outbox_away, disk_full - review round 10 - and waiting_turn too; its answer names the shoot the hand-in is in,
     review round 9), photo_upload_seal
     (the rows still without a hash removed, count_mismatch with the database's own count, empty), photo_upload_cancel (its uncounted rows removed; a recopied row given back to its
     earlier hand-in by OD §5.3's ONE put back rule - to be sent again over its item, at that step with its pending
     Replace; with an item waiting / committed, read by id at the check the cancel brings; an item of other bytes let go;
     missing again as it was; past sending with its item gone, its earlier item back and read by id; else to send at its
     earlier step under that hand-in; a row left out meanwhile stays removed, one kept with OneDrive's copy keeps that
     verdict; a resend over its item given back after a session of the row's own bytes, every row put back stamped
     back_at -; the answer's removed_sent - every removed row whose bytes may be in OneDrive, and the items let go - and
     put_back_ids - review rounds 4 - 7; photo_shoot_files_removed_shape held on every write) and
     photo_shoot_files_page (the rows, in id order, never an item id; each with its upload_id, upload_step and stalled -
     review round 7); photo-files sessions (the mode for the whole call: 503 uploads_off / uploads_test; the hand-in's
     own device; a row at committed -> found with its item, no session, review round 6; free -> a session on
     tools/fake/p7-onedrive.js's demo upload address, the same PUT / GET / 404 Microsoft answers; an item of the row's
     name by DCR of its size that this row had a session for or with its hash -> found {item_id}; anything else there ->
     the next free name, name_taken), done (the item read "by id": its size and OneDrive's quickXorHash of the bytes that landed against the
     row's, the phone's hash filled in - confirmed, checking while OneDrive has no hash yet (dev.hashLate), else
     {file_id, code} broken_upload / not_this_upload / gone with the row back to to_send, as handler.ts answers; a row of
     the hand-in LEFT OUT meanwhile answers not_waiting and keeps DCR's own item - by DCR, in the shoot folder, of the
     row's size, no other row's: drive_file_id, committed -, as app.gdrive_items_seen keeps it, review round 9) and find
     (an item of the row's name by DCR of its size, else null). dev.full: the demo's OneDrive answers 507 at a file's
     last chunk. The rows are photo_shoot_files rows and the landed items demo_photo_items rows (demo-only, read by
     nobody: kept with the demo's changes, so a reload finds them); the bytes are never kept.
   Dev hook: engine.exts.find((x) => x.name === "p10-photo-files").__dev - state({p5, root, shares, advance, down, mode,
   mode_at (a mode changed stamps it), phone, full, hashLate}), confirmAll(shootId), readyCheck(shootId), files(shootId),
   items(shootId), uploads(shootId), hashNow(), log (checks, drains asked). Made-up jobs, people and links (the example OneDrive host, office_example_com,
   every folder id 1FAKE) only; no amount anywhere. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  // every argument of the people's RPCs the phone calls, by name and in order (the schema check compares them)
  const SIGS = {
    photo_drive_status: ["p_shoot"],
    photo_ready_list: ["p_view"],
    photo_marketing_act: ["p_id", "p_action", "p_state", "p_note", "p_where", "p_link", "p_take_over"],
    photo_upload_begin: ["p_shoot", "p_client_key", "p_device_key", "p_device_label", "p_source", "p_replaces"],
    photo_upload_files: ["p_upload", "p_files"],
    photo_upload_beat: ["p_upload", "p_state", "p_bytes_sent", "p_sent_files", "p_rate_bps"],
    photo_upload_seal: ["p_upload", "p_files", "p_bytes"],
    photo_upload_cancel: ["p_upload"],
    photo_shoot_files_page: ["p_shoot", "p_filter", "p_after", "p_limit"],
  };
  const OPTIONAL = { photo_ready_list: ["p_view"], photo_marketing_act: ["p_note", "p_where", "p_link", "p_take_over"],
    photo_upload_begin: ["p_replaces"], photo_upload_beat: ["p_rate_bps"], photo_shoot_files_page: ["p_filter", "p_after", "p_limit"] };
  // every short code (HINT) the demo raises (the schema check finds each in the migrations)
  const CODES = ["forbidden", "no_shoot", "bad_action", "no_item", "withdrawn", "changed", "not_now", "taken", "not_yours", "bad_where",
    "bad_link", "reason_needed", "too_late", "rate", "bad_filter", "bad_source", "bad_key", "uploads_off", "uploads_test", "phone_off",
    "not_connected", "root_lost", "folder_gone", "open_elsewhere", "stopped_elsewhere", "too_many", "no_upload", "upload_closed",
    "bad_files", "empty", "count_mismatch", "bad_state", "sealed"];
  NS.p10FilesSigs = SIGS;
  NS.p10FilesOptional = OPTIONAL;
  NS.p10FilesCodes = CODES;

  const AUDIT = { created_at: null, created_by: null, updated_at: null, updated_by: null, version: 1 };
  const COLS = {
    photo_drive_folders: Object.assign({ id: null, kind: "shoot", parent_id: null, shoot_id: null, plan_id: null, tag: null, name: null, drive_name: null,
      drive_state: "not_seen", drive_state_at: null, drive_link: null, maker_pc: null, maker_pc_id: null, maker_at: null, made_at: null, drive_created_at: null,
      dup_folder_ids: [], limited: false, marker_ok: true, owner_ok: true, retired_at: null, retired_reason: null,
      files_state: "none", counted: 0, confirmed: 0, waiting: 0, mismatch: 0, missing: 0, wrong_owner: 0, not_checkable: 0, drive_only: 0,
      moved_in: 0, removed: 0, trashed_count: 0, bytes: 0, bytes_confirmed: 0, photos: 0, videos: 0, others: 0, media_confirmed: 0,
      // (the demo's own count: how many of `missing` are marketing's culls - the database counts them from its file rows,
      // app.photo_culled; answered only while the shoot is on the Ready list, v19 §42)
      culled: 0,
      late_at: null, stalled_at: null, busy_tries: 0, checked_at: null, complete_check_at: null, next_check_at: null, last_progress_at: null,
      last_code: null, files_rev: 0, help: [],
      // (the demo's own: the seeded counts, which have no file rows; the counts above are these plus the rows')
      seed: null }, AUDIT),
    photo_shoot_uploads: Object.assign({ id: null, folder_id: null, shoot_id: null, state: "open", source: "pc", pc_label: null, pc_id: null,
      started_by: null, sealed_by: null, files: null, bytes: null, recorded_files: 0, recorded_bytes: 0, client_key: null, started_at: null,
      sealed_at: null, beat_at: null, sent_files: 0, bytes_sent: 0, send_state: null, send_state_at: null, send_beat_at: null, rate_bps: null,
      progress_at: null }, AUDIT),
    // a phone's files (OD §5.3): its path, size and - once its done ran - the quickXorHash the phone computed while sending
    photo_shoot_files: Object.assign({ id: null, folder_id: null, last_upload_id: null, counted: false, source: "pc", path: null, path_key: null,
      kind: "other", size: 0, md5: null, modified: null, recorded_at: null, state: "waiting", removed_reason: null, removed_by: null,
      drive_file_id: null, drive_size: null, drive_md5: null, confirmed_at: null, verified_at: null, missing_since: null,
      upload_step: "to_send", session_at: null, sessions: 0, resends: 0,
      // (the item's cTag as DCR last read it - the demo's OneDrive gives none, so only a test sets it: a cancel's put back
      // reads a cTag changed since the earlier facts as the row's own bytes known in its item, review round 7)
      drive_ctag: null,
      // (what a cancel of the hand-in that took the row puts back - prev_drive: what the row was, review round 4 -, cleared
      // by its seal; the pending Replace's hand-in; when Keep OneDrive's copy settled it - the demo has no such act, a
      // cancel keeps that verdict all the same, review round 6)
      prev_size: null, prev_md5: null, prev_upload_id: null, prev_drive: null, replace_upload_id: null, resolved_at: null,
      // (when a put back last gave the row back - a cancel's put back here; the demo has no Put it back, the phone has no
      // file list to press it in: app.photo_row_stalled counts its 14 days from it as from the seal, review round 7)
      back_at: null }, AUDIT),
    photo_marketing: Object.assign({ id: null, folder_id: null, shoot_id: null, plan_id: null, shoot_key: null, job_label: null, city: null,
      shoot_name: null, shoot_day: null, photographer_name: null, handed_in_by: null, folder_link: null, files_at_ready: null, state: "ready",
      ready_at: null, completed_by: null, told: [], claimed_by: null, claimed_at: null, taken_from: null, posted_by: null, posted_at: null,
      posted_where: null, posted_link: null, posted_note: null, passed_by: null, passed_at: null, pass_reason: null, withdrawn_at: null,
      withdrawn_from: null, files_missing: 0, files_added: 0, files_added_at: null }, AUDIT),
  };
  NS.p10FilesCols = COLS;
  // the items that landed in the demo's OneDrive through the phone's upload addresses (a demo-only table nobody reads)
  const ITEMS = "demo_photo_items";
  const TABLES = Object.keys(COLS);
  (NS.extTables = NS.extTables || []).push({ tables: TABLES.concat([ITEMS]),
    cols: Object.assign({ [ITEMS]: { id: null, item_id: null, folder_id: null, path: null, size: 0, qx: null, later_qx: null, by_app: true, created_at: null } }, COLS),
    pk: {}, uuid: [], noAudit: [ITEMS],
    fks: [["photo_drive_folders", "shoot_id", "photo_shoots"], ["photo_shoot_uploads", "folder_id", "photo_drive_folders"],
      ["photo_shoot_files", "folder_id", "photo_drive_folders"]] });

  /* ── the pure rules, as the migration's (held to the shared cases) ── */

  const int = (v) => (typeof v === "number" && Number.isInteger(v) ? v : 0);
  const sumOf = (o, keys) => keys.reduce((n, k) => n + int((o || {})[k]), 0);
  /** app.photo_files_state */
  function filesState(p) {
    const c = p && typeof p.counted === "object" && p.counted ? p.counted : {};
    const total = Object.keys(c).reduce((n, k) => n + int(c[k]), 0);
    if (int(p && p.open) > 0) return "copying";
    if (int(p && p.sealed) === 0 || total === 0) return "none";
    if (sumOf(c, ["mismatch", "missing", "wrong_owner"]) > 0) return "problem";
    if (int(c.waiting) > 0) return "waiting";
    if (int(c.confirmed) > 0) return "confirmed";
    return "problem";
  }
  /** app.photo_ready_rule. Rule 3 (§10.1, v15 §38): a folder not in OneDrive yet (not_seen, its owner not known to be
      another account's - folder_owner_ok anything but false) is no folder problem yet - the rules after it say what the
      shoot needs (a hand-in, the copy, the upload), and folder_problem only once nothing waits. A shoot marked done at the
      site before its files were copied at home read "once this shoot's folder is back in DCR Photo & Video" for hours. */
  function readyRule(s) {
    const x = s || {};
    const c = x.counted && typeof x.counted === "object" ? x.counted : {};
    const notYet = x.folder === "not_seen" && x.folder_owner_ok !== false;
    let why = null;
    if (x.status !== "done") why = "not_done";
    else if (x.root_ok !== true) why = "root_problem";
    else if (!notYet && (x.folder !== "found" || x.folder_owner_ok !== true)) why = "folder_problem";
    else if (int(x.open) > 0) why = "copying";
    else if (int(x.sealed) === 0) why = "no_hand_in";
    else if (sumOf(c, ["mismatch", "missing", "wrong_owner"]) > 0) why = "files_problem";
    else if (int(c.waiting) > 0) why = "files_waiting";
    else if (notYet) why = "folder_problem";
    else if (int(x.media_confirmed) === 0) why = "no_media";
    else if (x.check_fresh !== true) why = "check_old";
    return { ready: why === null, why };
  }
  /** app.photo_completion_code */
  function completionCode(i) {
    const x = i || {};
    if (typeof x.marketing === "string") return x.marketing;
    if (x.status === "skipped" || x.status === "missed") {
      if (x.has_files !== true) return null;
      if (x.done_refused === true) return "closed_old_pc";
      if (x.plan_closed === true) return "closed_plan";
      if (x.folder_gone === true || x.root_lost === true) return null;
      // "its files are in OneDrive" only once they are (confirmed): never while they are sent, have a problem or a copy
      // is open - the Files line speaks
      return x.files_state === "confirmed" ? "closed_files" : null;
    }
    if (x.status === "planned" || x.status === "announced") {
      return x.files_state === "confirmed" && x.folder_gone !== true && x.root_lost !== true ? "not_done" : null;
    }
    if (x.status === "done") {
      const map = { root_problem: "root_problem", folder_problem: "folder_problem", copying: "done_copying", files_problem: "files_problem",
        files_waiting: "done_waiting", no_media: "no_media", check_old: "check_old" };
      // the shoot folder gone (or the root lost), or the uploads mode not on for the shoot: nothing can be handed in - no
      // line, the Files line says what is going on; files added in OneDrive without DCR are information only (OD §6.4)
      if (x.why === "no_hand_in") return x.folder_gone === true || x.root_lost === true || (x.mode !== undefined && x.mode !== null && x.mode !== "on") ? null : "no_hand_in";
      // its JOB folder gone while its own folder is not in OneDrive (job_gone): the line names the job folder - files
      // handed in wait for it, nothing handed in asks for the files once it is back, never "this shoot's folder"
      // (OD §6.6, §10.2; review round 3)
      if (x.why === "folder_problem" && x.job_gone === true) {
        if (x.has_files === true) return "job_folder_problem";
        return x.mode !== undefined && x.mode !== null && x.mode !== "on" ? null : "job_folder_no_hand_in";
      }
      if (map[x.why]) return map[x.why];
      return x.why === null || x.why === undefined ? "done_waiting" : null;
    }
    return null;
  }
  NS.p10FilesRules = { filesState, readyRule, completionCode };

  // OneDrive's personal-site shape (app.photo_drive_link_ok), on the made-up host and office account of the cases
  const ROOT_LINK = "https://example-my.sharepoint.com/personal/office_example_com/Documents/DCR%20Photo%20%26%20Video";
  const LINK = (id) => ROOT_LINK + "/" + id;
  const ROOT = { name: "DCR Photo & Video", link: ROOT_LINK };
  const WHERE = ["instagram", "facebook", "website", "houzz", "google", "other"];
  const MONEY = /(?:US)?\$\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd|bucks)\b|\b(?:usd|dollars)\s?\d/i;

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, PgErr, nowIso, clone, auditInsert, auditUpdate, commitInsert, commitUpdate, nextId } = E;
    if (!rows.photo_drive_folders || !rows.photo_marketing || !rows.photo_shoot_uploads || !rows.photo_shoots) return null;
    const STATUS = { "22023": 400, "42501": 403, PT404: 404, PT409: 409, PT429: 429, "42883": 404 };
    const err = (code, hint, message, detail) => new PgErr(code, message, STATUS[code] || 400, detail === undefined || detail === null ? null : JSON.stringify(detail), hint);
    const nowMs = () => Date.parse(nowIso());
    const iso = (v) => (v ? new Date(v).toISOString() : null);
    // (the phone switch, off at first as at go-live; in a browser localStorage "dcr2-demo-photo-phone" = "on" turns it on)
    const phoneOn = () => { try { return !!root.localStorage && root.localStorage.getItem("dcr2-demo-photo-phone") === "on"; } catch (e) { return false; } };
    // (mode_at: the uploads mode's last change, app.photo_drive.mode_at - null while the demo's mode is as it was before
    // any hand-in; __dev.state changing the mode stamps it, as photo_files_set_mode does: app.photo_row_stalled counts its
    // 14 days from it at the earliest)
    const dev = { p5: true, root: "found", shares: {}, advance: true, down: null, mode: "on", mode_at: null, phone: phoneOn(), full: false,
      hashLate: false, checks: 0, drains: 0 };
    const beats = [];

    /* who (app.photo_rights): admins, the photo team */
    const teamRow = (uid) => rows.photo_team.find((t) => t.profile_id === uid) || null;
    const profile = (uid) => rows.profiles.find((p) => p.id === uid) || null;
    const isPhotographer = (w) => !!(w && w.active && (teamRow(w.uid) || {}).photographer);
    const isMarketing = (w) => !!(w && w.active && (teamRow(w.uid) || {}).marketing);
    const canPhoto = (w) => !!(w && w.active && (w.admin || isPhotographer(w)));
    const canPhotoRead = (w) => !!(w && w.active && (w.admin || isPhotographer(w) || isMarketing(w)));
    const firstName = (uid) => {
      const e = (rows.employees || []).find((x) => x.profile_id === uid && x.active !== false);
      const p = profile(uid);
      const full = (e && String(e.full_name || "").trim()) || (p && String(p.full_name || "").trim()) || "";
      return full.split(/\s+/)[0] || "";
    };
    /** app.photo_drive_access (OD §5.5, §8.2): a marketing member's - shared (an admin marked their account shared:
        the demo's default), waiting (wanted, not marked yet) or not_company (an account outside the company's
        domains); everyone else none (the photographer is not on the share, M10) */
    function driveAccess(uid) {
      const t = teamRow(uid);
      const w = E.who({ uid });
      if (t && t.marketing && w && w.active) {
        const s = dev.shares[uid] || "shared";
        return ["shared", "waiting", "not_company"].indexOf(s) !== -1 ? s : "waiting";
      }
      return "none";
    }
    /** app.photo_files_mode (OD §4.3): the uploads mode for this shoot - dev.mode "on" | "off" | "only:<codes>" */
    function modeOf(s) {
      const m = String(dev.mode || "off");
      if (m === "on" || m === "off") return m;
      const codes = m.indexOf("only:") === 0 ? m.slice(5).split(",") : [];
      const plan = s ? planRow(s.plan_id) : null;
      return plan && codes.indexOf(plan.project_code) !== -1 ? "on" : "test";
    }
    const modeCodes = () => (String(dev.mode || "").indexOf("only:") === 0 ? String(dev.mode).slice(5).split(",") : []);
    /** an UPDATE; `by` - who made it (the audit trigger's auth.uid(): updated_by; null for the DCR server's and the
        demo's own) */
    function write(table, old, patch, by) {
      const r = Object.assign(clone(old), patch);
      // photo_shoot_files_removed_shape (20261111000100_photo_files.sql): removed exactly when it has a reason - the
      // migration refuses anything else, so the demo does too (the OneDrive review's round 6)
      if (table === "photo_shoot_files" && (r.state === "removed") !== (r.removed_reason !== null && r.removed_reason !== undefined)) {
        throw err("23514", "", 'new row for relation "photo_shoot_files" violates check constraint "photo_shoot_files_removed_shape"');
      }
      auditUpdate({ uid: by || null }, table, r, old);
      r.version = (Number(old.version) || 1) + 1;
      commitUpdate(table, old, r);
      return r;
    }
    function add(table, r) {
      const row = Object.assign({}, COLS[table], r);
      if (row.id === null || row.id === undefined) row.id = nextId(table);
      auditInsert({ uid: null }, table, row);
      commitInsert(table, row);
      return row;
    }
    function rate(uid, op, max, windowMs) {
      const t = nowMs();
      const mine = beats.filter((b) => b.uid === uid && b.op === op && b.at > t - windowMs);
      if (mine.length >= max) return Math.max(1, Math.ceil((mine[0].at + windowMs - t) / 1000));
      beats.push({ uid, op, at: t });
      return 0;
    }
    const missing = (name) => err("42883", "", "function public." + name + " does not exist");

    const shootRow = (id) => rows.photo_shoots.find((s) => s.id === Number(id)) || null;
    const planRow = (id) => rows.photo_plans.find((p) => p.id === Number(id)) || null;
    const liveFolder = (sid) => rows.photo_drive_folders.filter((f) => f.kind === "shoot" && f.shoot_id === Number(sid) && !f.retired_at)
      .sort((a, b) => b.id - a.id)[0] || null;
    const uploadsOf = (fid) => rows.photo_shoot_uploads.filter((u) => u.folder_id === fid && u.state !== "cancelled")
      .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)) || b.id - a.id);
    const marketingOf = (sid) => rows.photo_marketing.find((m) => m.shoot_id === Number(sid)) || null;
    const rootState = () => (dev.root === "none" ? null : dev.root);
    /** app.photo_shoot_day (company days): the done day when done, its planned day when that is today or earlier, else
        today - a shoot marked done before its planned day is never "shot" on a day still ahead */
    const shootDay = (s) => (s.status === "done" && s.done_at ? E.companyDay(new Date(s.done_at))
      : s.planned_date && s.planned_date <= E.today() ? s.planned_date : E.today());

    function roll(f) {
      const ups = f ? uploadsOf(f.id) : [];
      return {
        open: ups.filter((u) => u.state === "open" || u.state === "abandoned").length,
        sealed: ups.filter((u) => u.state === "sealed").length,
        counted: f ? { confirmed: f.confirmed, waiting: f.waiting, mismatch: f.mismatch, missing: f.missing, wrong_owner: f.wrong_owner,
          not_checkable: f.not_checkable } : {},
      };
    }
    /** app.photo_shoot_has_files: a sealed hand-in with counted files */
    function hasFiles(sid) {
      const f = liveFolder(sid);
      return !!(f && f.counted > 0 && uploadsOf(f.id).some((u) => u.state === "sealed"));
    }
    /** the ready rule's folder and folder_owner_ok, as photo_drive_status_json and app.photo_shoot_ready_check build them
        (§10.1, v15 §38): no row - not_seen, or the plan's live job folder's missing / trashed when that is gone (never
        "hand the files in" while nothing can be handed in to it - OD §2.3, review round 2), its owner not known (null);
        a row not in Drive yet - not_seen, or its job folder's missing / trashed when that is gone, its owner null unless
        it or its job folder is known to be another account's (false); otherwise its state, and owner_ok only when it AND
        its job folder are the company account's */
    function folderFacts(f, s) {
      if (!f) {
        const live = s ? rows.photo_drive_folders.find((x) => x.kind === "job" && x.plan_id === s.plan_id && !x.retired_at) || null : null;
        return { folder: live && (live.drive_state === "missing" || live.drive_state === "trashed") ? live.drive_state : "not_seen", folder_owner_ok: null };
      }
      const job = f.parent_id === null || f.parent_id === undefined ? null : rows.photo_drive_folders.find((x) => x.id === f.parent_id) || null;
      if (f.retired_at) return { folder: "retired", folder_owner_ok: f.owner_ok === true && !!job && job.owner_ok === true };
      if (f.drive_state === "not_seen") {
        const gone = !!job && (job.drive_state === "missing" || job.drive_state === "trashed");
        return { folder: gone ? job.drive_state : "not_seen", folder_owner_ok: f.owner_ok === false || (!!job && job.owner_ok === false) ? false : null };
      }
      return { folder: f.drive_state, folder_owner_ok: f.owner_ok === true && !!job && job.owner_ok === true };
    }
    function rule(s, f) {
      const r = roll(f);
      const ff = folderFacts(f, s);
      return readyRule({ status: s.status, root_ok: rootState() === "found", folder: ff.folder, folder_owner_ok: ff.folder_owner_ok,
        open: r.open, sealed: r.sealed, counted: r.counted, media_confirmed: f ? f.media_confirmed : 0,
        check_fresh: !!(f && f.complete_check_at && Date.parse(f.complete_check_at) > nowMs() - 24 * 3600e3) });
    }
    const ON_LIST = ["ready", "claimed", "posted", "passed"];
    /** app.photo_culled: how many of the folder's missing files are marketing's culls - files deleted or moved out after
        the shoot went on the Ready list (ready, claimed, posted, passed: never withdrawn), never more than missing; 0 off
        the list (§6.7, §13.1 rules 7 and 9; v19 §42) */
    function culledNow(f, m) {
      if (!f || !m || ON_LIST.indexOf(m.state) === -1 || !(f.missing > 0)) return 0;
      return Math.max(0, Math.min(int(f.culled), f.missing));
    }
    /** the help events that hold now (§10.8), the files' ones held while the shoot is marketing's (R9-L4); marketing's
        culls are never a problem (app.photo_sealed_state leaves them out - a second card sealed after ready lifts the hold
        for the photographer's own files only, v19 §42) */
    function helpNow(s, f, m) {
      if (!f) return [];
      const on = modeOf(s) === "on";
      const held = m && ON_LIST.indexOf(m.state) !== -1 &&
        !uploadsOf(f.id).some((u) => u.state === "sealed" && u.sealed_at && Date.parse(u.sealed_at) > Date.parse(m.ready_at || 0));
      // Bring the shoot back? (closed_files) only for a skipped or missed shoot whose files are confirmed - never while
      // they upload or have a problem (app.photo_help_now, v14 §37)
      const closedOk = (s.status === "skipped" || s.status === "missed") && filesState(roll(f)) === "confirmed";
      const problemOk = f.mismatch + f.missing + f.wrong_owner - culledNow(f, m) > 0;
      // late and stalled only while the shoot's sealed files wait (app.photo_sealed_state 'waiting': a problem speaks for
      // the shoot until it is sorted out, as app.photo_help_now and the notices say - review round 9)
      const waits = int(f.counted) > 0 && !problemOk && int(f.waiting) > 0;
      // stalled only while a stalled row is left, as the status's files.stalled (folderStalled; review round 8)
      const out = (Array.isArray(f.help) ? f.help : []).filter((h) => h !== "lost" && !(held && ["late", "problem", "stalled", "folder_gone"].indexOf(h) !== -1) &&
        (h !== "closed_files" || closedOk) && (h !== "problem" || problemOk) && (h !== "stalled" || folderStalled(f)) &&
        (waits || (h !== "late" && h !== "stalled")) && (on || ["late", "stalled", "no_hand_in"].indexOf(h) === -1));
      // lost (OD §6.6, review round 5): a sealed PC hand-in whose files left are lost on its PC while DCR Desktop is open
      // there - its beat, under 2 minutes old, says lost - with counted rows still to send, the mode on, the root found and
      // the folder there: only the memory card helps (late never comes for it), so the shoot keeps its chip "Memory card
      // needed" - after the files' own events, as app.photo_help_now answers it
      const lost = !held && on && rootState() === "found" && f.drive_state !== "missing" && f.drive_state !== "trashed" &&
        uploadsOf(f.id).some((u) => u.state === "sealed" && u.source === "pc" && u.send_state === "lost" &&
          Date.parse(u.send_beat_at || 0) > nowMs() - 120e3 &&
          rows.photo_shoot_files.some((x) => x.last_upload_id === u.id && x.counted && x.state === "waiting" && (x.upload_step === "to_send" || x.upload_step === "session")));
      if (lost) {
        let at = 0;
        out.forEach((h, i) => { if (["stopped", "late", "problem", "stalled"].indexOf(h) !== -1) at = i + 1; });
        out.splice(at, 0, "lost");
      }
      return out;
    }

    /* ── the phone's hand-in (OD §3.3, §4.5, §5.3, §5.6): the file rows, and the folder's counts from them ── */

    const QX = /^[A-Za-z0-9+/]{27}=$/;
    const DEVICE_KEY = /^pk_[A-Za-z0-9_-]{22}$/;
    const CLIENT_KEY = /^[A-Za-z0-9_-]{8,64}$/;
    const UNIT = 327680, PHONE_CHUNK = 16 * UNIT, PC_CHUNK = 64 * UNIT, MAX_CHUNK = 191 * UNIT, MAX_BYTES = 268435456000;
    const SEND_STATES = ["sending", "waiting_net", "busy", "onedrive_full", "onedrive_stopped", "paused", "lost", "outbox_away", "disk_full",
      "waiting_turn", "done"];
    const KINDS = {
      photo: ["jpg", "jpeg", "heic", "heif", "png", "tif", "tiff", "webp", "hif", "insp"],
      raw: ["dng", "cr2", "cr3", "nef", "arw", "raf", "orf", "rw2", "srw", "pef", "gpr", "nrw"],
      video: ["mp4", "mov", "m4v", "avi", "mts", "m2ts", "mxf", "insv", "360", "crm", "braw"],
    };
    const fold = (s) => String(s === null || s === undefined ? "" : s).normalize("NFC").replace(/[A-Z]/g, (c) => c.toLowerCase());
    const lastSeg = (p) => { const x = String(p || ""); return x.slice(x.lastIndexOf("/") + 1); };
    /** app.photo_drive_kind */
    function kindOf(path) {
      const l = lastSeg(path);
      if (l.indexOf(".") === -1 || l.endsWith(".")) return "other";
      const e = fold(l.slice(l.lastIndexOf(".") + 1));
      for (const k of ["photo", "raw", "video"]) if (KINDS[k].indexOf(e) !== -1) return k;
      return "other";
    }
    /** app.photo_free_name (cases free_name): " (2)", " (3)" ... before the last dot of the name */
    function freeName(path, taken) {
      const keys = new Set((taken || []).map(fold));
      if (!keys.has(fold(path))) return path;
      const slash = path.lastIndexOf("/");
      const prefix = slash >= 0 ? path.slice(0, slash + 1) : "";
      const name = path.slice(prefix.length);
      let stem = name, ext = "";
      if (name.slice(1).indexOf(".") !== -1) { const dot = name.lastIndexOf("."); stem = name.slice(0, dot); ext = name.slice(dot); }
      for (let n = 2; n < 10000; n++) { const p = prefix + stem + " (" + n + ")" + ext; if (!keys.has(fold(p))) return p; }
      return null;
    }
    /** app.photo_rel_path_problem, as far as a phone's Phone/<name> meets it (cases paths) */
    function pathProblem(path) {
      if (typeof path !== "string" || !path) return "bad_char";
      const segs = path.split("/");
      if (segs.length > 4) return "too_deep";
      if (Array.from(path).length > 100) return "too_long";
      for (const s of segs) {
        if (!s || s === "." || s === "..") return "dot_segment";
        if (/[\\:*?"<>|\u0000-\u001f]/.test(s)) return "bad_char";
        if (/^\s|[\s.]$/.test(s)) return "trailing";
        if (/^_dcr-/i.test(s)) return "reserved_prefix";
      }
      if (MONEY.test(path)) return "money";
      return null;
    }
    /** this device's app.photo_drive_pcs id: fixed by its key (a reload, the same phone, finds its own hand-in again) */
    function deviceId(key) {
      let h = 2166136261;
      for (const ch of String(key)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
      return 1000 + (h % 900000);
    }
    const filesOf = (fid) => rows.photo_shoot_files.filter((r) => r.folder_id === fid);
    const fileRow = (id) => rows.photo_shoot_files.find((r) => r.id === Number(id)) || null;
    const uploadRow = (id) => rows.photo_shoot_uploads.find((u) => u.id === Number(id)) || null;
    const folderRow = (id) => rows.photo_drive_folders.find((f) => f.id === Number(id)) || null;
    const itemById = (id) => rows[ITEMS].find((x) => x.item_id === String(id)) || null;
    const itemAt = (fid, path) => rows[ITEMS].find((x) => x.folder_id === fid && fold(x.path) === fold(path)) || null;
    const goneState = (x) => !!x && (x.drive_state === "missing" || x.drive_state === "trashed");
    /** a job folder as the status and begin's folder_gone name it: {id, name, drive_state, drive_state_at} */
    const jobJson = (j) => ({ id: j.id, name: j.drive_name || j.name, drive_state: j.drive_state, drive_state_at: iso(j.drive_state_at) });
    const ZERO = { counted: 0, confirmed: 0, waiting: 0, mismatch: 0, missing: 0, removed: 0, bytes: 0, bytes_confirmed: 0, photos: 0, videos: 0,
      others: 0, media_confirmed: 0 };
    const seedOf = (f) => {
      if (f.seed) return Object.assign({}, ZERO, f.seed);
      // a folder of the seed made before its counts were kept apart: its own counts, while no row of it counts
      if (filesOf(f.id).some((r) => r.counted)) return Object.assign({}, ZERO);
      const out = {};
      for (const k of Object.keys(ZERO)) out[k] = int(f[k]);
      return out;
    };
    /** app.photo_folder_recount: the folder's counts - its seeded ones and its counted rows' */
    function recount(f, extra, seed) {
      const base = seed || seedOf(f);
      const c = Object.assign({}, base);
      for (const r of filesOf(f.id)) {
        if (r.state === "removed") { c.removed++; continue; }
        if (!r.counted) continue;
        c.counted++;
        c.bytes += r.size;
        if (r.kind === "video") c.videos++; else if (r.kind === "photo" || r.kind === "raw") c.photos++; else c.others++;
        if (r.state === "confirmed") { c.confirmed++; c.bytes_confirmed += r.size; if (r.kind !== "other") c.media_confirmed++; }
        else if (c[r.state] !== undefined) c[r.state]++;
      }
      c.files_state = filesState(Object.assign(roll(f), { counted: { confirmed: c.confirmed, waiting: c.waiting, mismatch: c.mismatch, missing: c.missing } }));
      return write("photo_drive_folders", f, Object.assign(c, { seed: base, files_rev: f.files_rev + 1 }, extra || {}));
    }
    const TAGC = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    function newTag() {
      const n = rows.photo_drive_folders.length + 7;
      return "P" + TAGC[n % 24] + TAGC[(n * 5) % 24] + TAGC[(n * 11) % 24] + "Q" + (2 + (n % 7));
    }
    /** app.photo_folder_claim: the shoot's folder rows (its job folder's too), not in OneDrive yet */
    function claim(s) {
      const f = liveFolder(s.id);
      if (f) return f;
      const plan = planRow(s.plan_id) || {};
      let job = rows.photo_drive_folders.find((x) => x.kind === "job" && x.plan_id === s.plan_id && !x.retired_at) || null;
      if (!job) {
        const t = newTag();
        job = add("photo_drive_folders", { kind: "job", plan_id: s.plan_id, tag: t, name: (plan.project_label || "Sample job") + " [DCR-" + t + "]",
          drive_state: "not_seen", owner_ok: true, seed: Object.assign({}, ZERO) });
      }
      const t = newTag();
      const name = (s.planned_date || E.today()) + " " + s.name + " [DCR-" + t + "]";
      return add("photo_drive_folders", { kind: "shoot", parent_id: job.id, shoot_id: s.id, plan_id: s.plan_id, tag: t, name, drive_state: "not_seen",
        owner_ok: true, seed: Object.assign({}, ZERO) });
    }
    /** photo-files' folders made in OneDrive (app.gdrive_folders_seen): the job folder and the shoot folder found */
    function made(f) {
      const job = f.parent_id ? folderRow(f.parent_id) : null;
      if (job && job.drive_state === "not_seen") {
        write("photo_drive_folders", job, { drive_state: "found", drive_state_at: nowIso(), made_at: nowIso(), drive_name: job.name,
          drive_link: LINK("1FAKEjob" + String(job.id).padStart(15, "0")), drive_created_at: nowIso() });
      }
      if (f.drive_state === "not_seen") {
        return write("photo_drive_folders", f, { drive_state: "found", drive_state_at: nowIso(), made_at: nowIso(), drive_name: f.name,
          drive_link: LINK("1FAKEshoot" + String(f.id).padStart(13, "0")), drive_created_at: nowIso() });
      }
      return f;
    }
    function uploadAnswer(up) {
      return { id: up.id, state: up.state, folder_id: up.folder_id, source: up.source, device_id: up.pc_id, recorded_files: up.recorded_files,
        recorded_bytes: up.recorded_bytes };
    }
    function mineOrAdmin(w, up) {
      if (up.started_by !== w.uid && !w.admin) throw err("42501", "not_yours", "That hand-in was started by someone else.");
    }
    function uploadOf(a) {
      const up = uploadRow(a.p_upload);
      if (!up) throw err("PT404", "no_upload", "There is no such hand-in.", { table: "photo_shoot_uploads", id: Number(a.p_upload) });
      return up;
    }
    const forbidden = () => err("42501", "forbidden", "Only an admin or a photographer hands files in.");
    function recordedOf(up) {
      const mine = rows.photo_shoot_files.filter((r) => r.last_upload_id === up.id && r.state !== "removed");
      return { n: mine.length, b: mine.reduce((t, r) => t + r.size, 0) };
    }
    /** app.photo_upload_end (RE-MADE at review rounds 3 - 7; OD §5.3, §23 - §25): an open hand-in let go - its uncounted
        rows removed (cancelled) - and each counted row it recorded over (recopied: prev_* and prev_drive kept) given back
        to its earlier hand-in with its earlier size and hash, never with a verdict no read has made since - ONE rule:
          0. it was to be sent again over its item (a broken_upload waiting for its one resend, a sealed Replace not sent
             yet: an item, its earlier step to_send / session): back at that step with that item, its earlier facts, its
             resends and its pending Replace - its device sends it as the Replace it was - also when the row's own bytes
             were recorded again here and a session made for them (a cancel mid-upload: a resend given back, never a
             spent one; review round 7); only the row's own bytes KNOWN in its item (this hand-in's row committed or
             done, or its cTag changed since) or an earlier state with no resend pending over its item and a session made
             here go as 1, read by id (review round 6);
          1. it has an item (its earlier one, or one this hand-in made with the row's own bytes): waiting / committed, read
             by id at the check the cancel brings now (confirmed_at, verified_at and the pending Replace gone; the earlier
             item keeps its missing_since and resends) - never confirmed unread, never Ready before that read;
          2. an item this hand-in made with OTHER bytes: let go (counted in removed_sent, left out of put_back_ids), and
             the row goes on as 3, 4 or 5;
          3. no item, and it was missing: missing again, as it was (its item and dates);
          4. no item, and it was past sending (committed / done with an item: its item went during this hand-in): its
             EARLIER item back, then as 1 - read by id, never to send under a hand-in that sent it long ago (round 6);
          5. no item otherwise: waiting under its earlier hand-in at its earlier step (to_send, or session with its
             session_at), its tries from 0 - a sealed phone hand-in's row asks for that phone (resend_phone).
        What a person did meanwhile stays (round 6): a row left out while this hand-in held it stays removed (its reason
        and who; the rules give it its earlier size, hash, hand-in and send columns, so a later Put it back works -
        photo_shoot_files_removed_shape holds), one settled with Keep OneDrive's copy (resolved after this hand-in
        recorded it) keeps that verdict and goes back to its earlier hand-in. Every row put back is stamped back_at
        (app.photo_row_stalled's 14 days count from it as from the seal - review round 7).
        -> {removed, put_back, removed_sent (the removed rows whose bytes may be in OneDrive - a session handed out, or an
        item known - and the items let go: Cancel it's "ask the office to delete them"), put_back_ids (sorted: the put
        back rows whose bytes in OneDrive, if any, are the shoot's own - never to delete)}. (The demo keeps no
        item_confirmed_at, hash_wait_since or hash_differs_at: its verdict never waits on or finds a different hash - a
        broken copy is sent again. Its recopied is a phone's file sent back, a waiting row of the same bytes, and it has
        no Leave it out or Keep OneDrive's copy: rules 0, 2, 3 and 4 and the two kept rows are ported whole all the
        same.) */
    function endUpload(up, state, by) {
      let n = 0, sent = 0;
      const ids = [], let_ = [];
      const PREV = { prev_size: null, prev_md5: null, prev_upload_id: null, prev_drive: null };
      const stepOf = (x) => (x === "to_send" || x === "session" ? x : null);
      for (const r0 of rows.photo_shoot_files.slice()) {
        let r = r0;
        if (r.last_upload_id !== up.id) continue;
        if (!r.counted && r.state !== "removed") {
          if (r.drive_file_id || r.session_at || (r.upload_step || "to_send") !== "to_send") sent++;
          write("photo_shoot_files", r, Object.assign({ state: "removed", removed_reason: "cancelled", removed_by: by || null, upload_step: "to_send" }, PREV), by);
          n++;
          continue;
        }
        if (!(r.counted && r.prev_md5)) continue;
        const pd = r.prev_drive || {};
        // (a row left out while this hand-in held it stays left out: its reason and who - review round 6)
        const left = r.state === "removed";
        const st = (s) => (left ? "removed" : s);
        // (every row put back is stamped back_at: late and stalled count from it as from the seal - review round 7)
        const back = { size: r.prev_size, md5: r.prev_md5, last_upload_id: r.prev_upload_id, recorded_at: nowIso(), back_at: nowIso() };
        if (r.state === "confirmed" && r.resolved_at && r.recorded_at && Date.parse(r.resolved_at) > Date.parse(r.recorded_at)) {
          // (settled with Keep OneDrive's copy meanwhile: that verdict stays, back to its earlier hand-in)
          write("photo_shoot_files", r, Object.assign({ last_upload_id: r.prev_upload_id, replace_upload_id: null, recorded_at: nowIso(),
            back_at: nowIso() }, PREV), by);
          ids.push(r.id);
          continue;
        }
        let item = r.drive_file_id || null;
        let earlier = item !== null && item === (pd.drive_file_id || null);
        if (item !== null && !earlier && (r.size !== r.prev_size || r.md5 !== r.prev_md5)) {
          // 2. (the cancelled card's file: let go, counted)
          r = write("photo_shoot_files", r, { drive_file_id: null, drive_ctag: null, drive_md5: null, drive_size: null, verified_at: null }, by);
          let_.push(r.id);
          item = null;
        }
        if (item === null && pd.state === "missing") {
          // 3. (missing again, as it was)
          write("photo_shoot_files", r, Object.assign(back, { state: st("missing"), upload_step: "done", drive_file_id: pd.drive_file_id || null,
            drive_ctag: pd.drive_ctag || null, drive_md5: pd.drive_md5 || null, drive_size: pd.drive_size === undefined ? null : pd.drive_size,
            verified_at: pd.verified_at || null, confirmed_at: pd.confirmed_at || null, missing_since: pd.missing_since || nowIso(), replace_upload_id: null,
            session_at: null }, PREV), by);
          ids.push(r.id);
          continue;
        }
        if (item === null && (pd.upload_step === "committed" || pd.upload_step === "done") && pd.drive_file_id) {
          // 4. (its EARLIER item back, then as 1: read by id)
          r = write("photo_shoot_files", r, { drive_file_id: pd.drive_file_id, drive_ctag: pd.drive_ctag || null, drive_md5: pd.drive_md5 || null,
            drive_size: pd.drive_size === undefined ? null : pd.drive_size }, by);
          item = r.drive_file_id;
          earlier = true;
        }
        // (the row's own bytes KNOWN in its item go as 1, read by id: this hand-in's row committed or done, or a read since
        // showing another version of it - its cTag changed; so does an earlier state with no resend pending over its item
        // and a session made here. A resend pending over its item stays one after a session of the row's own bytes here -
        // a cancel mid-upload: the item may still hold the broken copy - given back, never spent; review round 7)
        const nz = (v) => (v === undefined ? null : v);
        const stepNow = r.upload_step || "to_send";
        const own = nz(r.size) === nz(r.prev_size) && nz(r.md5) === nz(r.prev_md5) &&
          (stepNow === "committed" || stepNow === "done" || nz(r.drive_ctag) !== nz(pd.drive_ctag) ||
            (nz(pd.replace_upload_id) !== nz(r.prev_upload_id) && (!!r.session_at || stepNow !== "to_send")));
        if (item !== null && earlier && stepOf(pd.upload_step) && !own) {
          // 0. (to be sent again over its item, at that step: its facts, its resends and its pending Replace)
          const step = pd.upload_step;
          const again = pd.replace_upload_id !== null && pd.replace_upload_id !== undefined && pd.replace_upload_id === r.prev_upload_id;
          write("photo_shoot_files", r, Object.assign(back, { state: st("waiting"), upload_step: step, session_at: step === "session" ? pd.session_at || null : null,
            sessions: 0, resends: pd.resends || 0, replace_upload_id: again ? r.prev_upload_id : null, drive_ctag: pd.drive_ctag || null,
            drive_md5: pd.drive_md5 || null, drive_size: pd.drive_size === undefined ? null : pd.drive_size, verified_at: pd.verified_at || null,
            confirmed_at: null, missing_since: null }, PREV), by);
        } else if (item !== null) {
          // 1. (waiting, read by id at the check now: the verdict decides)
          write("photo_shoot_files", r, Object.assign(back, { state: st("waiting"), upload_step: "committed", replace_upload_id: null, confirmed_at: null,
            verified_at: null, missing_since: earlier ? pd.missing_since || null : null,
            resends: earlier && "resends" in pd ? pd.resends : r.resends }, PREV), by);
        } else {
          // 5. (to send by its earlier hand-in, at its earlier step)
          const step = stepOf(pd.upload_step) || "to_send";
          write("photo_shoot_files", r, Object.assign(back, { state: st("waiting"), upload_step: step, session_at: step === "session" ? pd.session_at || null : null,
            sessions: 0, resends: pd.resends || 0, replace_upload_id: null, confirmed_at: null, verified_at: null, missing_since: null }, PREV), by);
        }
        ids.push(r.id);
      }
      write("photo_shoot_uploads", up, { state }, by);
      const f = folderRow(up.folder_id);
      // (a row put back: the folder checked now - the check reads it by id)
      if (f) recount(f, ids.length ? { next_check_at: nowIso() } : null);
      return { removed: n, put_back: ids.length, removed_sent: sent + let_.length,
        put_back_ids: ids.filter((id) => let_.indexOf(id) === -1).sort((a, b) => a - b) };
    }

    /** photo_upload_begin(p_shoot, p_client_key, p_device_key, p_device_label, p_source, p_replaces) */
    function begin(w, a) {
      if (!canPhoto(w)) throw forbidden();
      const s = shootRow(a.p_shoot);
      if (!s) throw err("PT404", "no_shoot", "That shoot isn't on the schedule any more.", { table: "photo_shoots", id: Number(a.p_shoot) });
      if (a.p_source !== "pc" && a.p_source !== "phone") throw err("22023", "bad_source", "A hand-in comes from a computer or a phone.");
      if (!DEVICE_KEY.test(String(a.p_device_key || ""))) throw err("22023", "bad_key", "That isn't a DCR device key.");
      if (!CLIENT_KEY.test(String(a.p_client_key || ""))) throw err("22023", "bad_key", "The hand-in needs a key of 8 to 64 letters, digits, - or _.");
      const mode = modeOf(s);
      if (mode === "off") throw err("PT409", "uploads_off", "Photo uploads are off.");
      if (mode === "test") throw err("PT409", "uploads_test", "Photo uploads are being tested on another job - not on for this job yet.");
      if (a.p_source === "phone" && !dev.phone) throw err("PT409", "phone_off", "Phone uploads are off - use DCR Desktop.");
      const rs = rootState();
      if (!rs) throw err("PT409", "not_connected", "OneDrive isn't set up for the photo files yet - an admin sets it up in Settings -> Photo & Video.");
      if (rs !== "found") throw err("PT409", "root_lost", "DCR can't reach DCR Photo & Video in OneDrive right now - the office is looking at it.");
      const label = a.p_source === "phone" ? (["iPhone", "Android phone", "phone"].indexOf(a.p_device_label) !== -1 ? a.p_device_label : "phone")
        : String(a.p_device_label || "").slice(0, 60) || "PC";
      const pcId = deviceId(a.p_device_key);
      const f = claim(s);
      const job = f.parent_id ? folderRow(f.parent_id) : null;
      // (the job folder first: it is the cause when both are gone - its detail names it, OD §2.3; review round 1)
      if (goneState(job)) {
        throw err("PT409", "folder_gone", "This job's folder left DCR Photo & Video - ask the office to put it back or restore it.", { job: jobJson(job) });
      }
      if (goneState(f)) throw err("PT409", "folder_gone", "This shoot's folder left DCR Photo & Video - ask the office to put it back or restore it.");
      let up = rows.photo_shoot_uploads.find((u) => u.started_by === w.uid && u.client_key === a.p_client_key) || null;
      let again = false;
      if (up) {
        if (up.folder_id !== f.id) throw err("22023", "bad_key", "That key was used for another shoot's hand-in.");
        if (up.state === "abandoned") up = write("photo_shoot_uploads", up, { state: "open", beat_at: nowIso() }, w.uid);
        again = true;
      } else {
        const other = rows.photo_shoot_uploads.filter((u) => u.folder_id === f.id && (u.state === "open" || u.state === "abandoned"))
          .sort((x, y) => x.id - y.id)[0] || null;
        if (other) {
          const d = { id: other.id, pc: other.pc_label, source: other.source, by: firstName(other.started_by), files: other.recorded_files };
          if (other.state === "open" && Date.parse(other.beat_at || other.started_at) > nowMs() - 120e3) {
            throw err("PT409", "open_elsewhere", "A hand-in into this shoot isn't finished yet.", Object.assign(d, { started_at: iso(other.started_at) }));
          }
          if (a.p_replaces === null || a.p_replaces === undefined || Number(a.p_replaces) !== other.id) {
            throw err("PT409", "stopped_elsewhere", "A hand-in into this shoot stopped - finish it first: Copy the rest, Hand in what's there or Cancel it.",
              Object.assign(d, { since: iso(other.beat_at || other.started_at), can_decide: other.started_by === w.uid || !!w.admin }));
          }
          if (!(other.started_by === w.uid || w.admin)) throw err("42501", "not_yours", "That hand-in was started by someone else.");
        }
        if (rows.photo_shoot_uploads.filter((u) => u.folder_id === f.id).length >= 20) throw err("PT429", "too_many", "This shoot has had 20 hand-ins - ask an admin.");
        up = add("photo_shoot_uploads", { folder_id: f.id, shoot_id: s.id, source: a.p_source, state: "open", client_key: a.p_client_key, pc_id: pcId,
          pc_label: label, started_by: w.uid, started_at: nowIso(), beat_at: nowIso() });
        if (other) endUpload(other, "cancelled", w.uid);
        recount(folderRow(f.id));
      }
      return { upload: uploadAnswer(up), replaced: null, again, closed: s.status === "skipped" || s.status === "missed" ? s.status : null };
    }

    /** photo_upload_files(p_upload, p_files): path, size, the hash (a phone's may come later, with its done) */
    function recordFiles(w, a) {
      if (!canPhoto(w)) throw forbidden();
      let up = uploadOf(a);
      mineOrAdmin(w, up);
      if (up.state !== "open") throw err("22023", "upload_closed", "That hand-in is already handed in or cancelled.");
      if (!Array.isArray(a.p_files)) throw err("22023", "bad_files", "The files are a list.");
      const f = folderRow(up.folder_id);
      const n = { added: 0, same: 0, replaced: 0, restored: 0, recopied: 0, copies: 0 };
      const refused = [], files = [];
      a.p_files.forEach((it, i) => {
        const x = it && typeof it === "object" ? it : {};
        let path = typeof x.path === "string" ? x.path : null;
        let code = pathProblem(path);
        const size = Number(x.size);
        if (!code && (!Number.isSafeInteger(size) || size < 0 || size > MAX_BYTES)) code = "bad_size";
        else if (!code && size === 0) code = "empty_file";
        const md5 = typeof x.md5 === "string" && x.md5 ? x.md5 : null;
        if (!code && ((md5 === null && (up.source !== "phone" || x.md5 !== undefined)) || (md5 !== null && !QX.test(md5)))) code = "bad_md5";
        if (code) { refused.push({ i, path: path === null ? null : path.slice(0, 400), code }); return; }
        path = path.normalize("NFC");
        const key = fold(path);
        const row = filesOf(f.id).find((r) => r.path_key === key) || null;
        const mod = typeof x.modified === "string" && !isNaN(Date.parse(x.modified)) ? new Date(x.modified).toISOString() : null;
        let verdict, id;
        if (!row) {
          verdict = "added";
          id = add("photo_shoot_files", { folder_id: f.id, last_upload_id: up.id, path, path_key: key, kind: kindOf(path), size, md5, modified: mod,
            recorded_at: nowIso(), state: "waiting", upload_step: "to_send" }).id;
        } else if (row.state === "removed") {
          verdict = "restored";
          id = write("photo_shoot_files", row, { state: "waiting", removed_reason: null, removed_by: null, size, md5, modified: mod, recorded_at: nowIso(),
            last_upload_id: up.id, counted: false, confirmed_at: null, drive_file_id: null, drive_md5: null, drive_size: null, upload_step: "to_send",
            session_at: null, sessions: 0, resends: 0 }, w.uid).id;
        } else if (md5 !== null && row.md5 === md5 && row.size === size) {
          verdict = "same";
          id = row.id;
          // a phone's file a check sent back to be sent after its phone's seal: nothing sends a sealed phone hand-in's
          // rows, so the next hand-in that records the same bytes takes it as its own (OD §3.5; review round 1) - never a
          // PC's (its own sender sends it)
          const last = row.last_upload_id === up.id ? null : uploadRow(row.last_upload_id);
          if (row.state === "waiting" && (row.upload_step === "to_send" || row.upload_step === "session") && last && last.state === "sealed" && last.source === "phone") {
            verdict = "recopied";
            // (kept as a replace is, so a cancel puts it back under its phone's hand-in - what the row was in prev_drive,
            // its session_at too: §5.3's one put back rule, review rounds 4 and 5; a pending Replace of its item while it
            // has one - the migration's recopied, review round 2)
            write("photo_shoot_files", row, { prev_size: row.size, prev_md5: row.md5, prev_upload_id: row.last_upload_id,
              prev_drive: { state: row.state, upload_step: row.upload_step, resends: row.resends || 0, replace_upload_id: row.replace_upload_id,
                drive_file_id: row.drive_file_id, drive_ctag: row.drive_ctag, drive_md5: row.drive_md5, drive_size: row.drive_size, verified_at: row.verified_at,
                confirmed_at: row.confirmed_at, missing_since: row.missing_since, session_at: row.session_at },
              replace_upload_id: row.drive_file_id ? up.id : null, last_upload_id: up.id, modified: mod || row.modified, recorded_at: nowIso(),
              confirmed_at: null, upload_step: "to_send", session_at: null, sessions: 0, resends: 0 }, w.uid);
          }
        } else if (md5 === null && up.source === "phone" && !row.md5 && row.last_upload_id === up.id && row.state === "waiting" &&
          (row.upload_step === "to_send" || row.upload_step === "session") && row.size === size) {
          // a phone's record asked again after its answer was lost (the page's ask() asks again): this hand-in's own row of
          // that name and size, still without a hash and not sent yet, is that file - the same, sent by this hand-in,
          // never name_taken and "… (2)" (OD §3.5; review round 2)
          verdict = "same";
          id = row.id;
        } else {
          refused.push({ i, path: path.slice(0, 400), code: "name_taken" });
          return;
        }
        n[verdict] += 1;
        const r = fileRow(id);
        files.push({ i, file_id: id, path: verdict === "added" ? path : r.path, verdict,
          send: verdict !== "same" || (r.last_upload_id === up.id && r.state === "waiting") });
      });
      const rec = recordedOf(up);
      up = write("photo_shoot_uploads", up, { recorded_files: rec.n, recorded_bytes: rec.b, beat_at: nowIso() }, w.uid);
      return Object.assign(n, { refused, recorded_files: up.recorded_files, recorded_bytes: up.recorded_bytes, files });
    }

    /** photo_upload_beat(p_upload, p_state, p_bytes_sent, p_sent_files, p_rate_bps) */
    function beat(w, a) {
      if (!canPhoto(w)) throw forbidden();
      const bytes = Number(a.p_bytes_sent), sent = Number(a.p_sent_files);
      const rateBps = a.p_rate_bps === null || a.p_rate_bps === undefined ? null : Number(a.p_rate_bps);
      if (SEND_STATES.indexOf(a.p_state) === -1 || !Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(sent) || sent < 0 || (rateBps !== null && !(rateBps >= 0))) {
        throw err("22023", "bad_state", "That isn't a sending state.");
      }
      let up = uploadOf(a);
      mineOrAdmin(w, up);
      if (up.state !== "open" && up.state !== "sealed") throw err("22023", "upload_closed", "That hand-in is already handed in or cancelled.");
      const wait = rate(w.uid, "upload_beat", 600, 3600e3);
      if (wait) throw err("PT429", "rate", "Too many tries - wait a minute.", { retryAfter: wait });
      const grew = bytes > (up.bytes_sent || 0);
      // (an open hand-in's running clock - never for waiting_turn, which says only that another hand-in goes first: an
      // open copy's stopped line stays, review round 5 -, and a PC's only when bytes_sent grew: a stopped copy whose files
      // wait on a hold, a lost file or a held file reads stopped and is abandoned in time, never "copying"; its copy's
      // own record moves the clock - review round 6)
      const clock = up.state === "open" && a.p_state !== "waiting_turn" && (up.source !== "pc" || grew);
      up = write("photo_shoot_uploads", up, { send_state: a.p_state, send_state_at: up.send_state !== a.p_state ? nowIso() : up.send_state_at, send_beat_at: nowIso(),
        beat_at: clock ? nowIso() : up.beat_at, bytes_sent: bytes, sent_files: sent, rate_bps: rateBps,
        progress_at: grew ? nowIso() : up.progress_at }, w.uid);
      if (grew) { const f = folderRow(up.folder_id); if (f) write("photo_drive_folders", f, { last_progress_at: nowIso(), late_at: null }); }
      // (the shoot it is in now: a plan dropped and mirrored again moves the hand-in to the shoot's new id - review round 9)
      return { ok: true, upload: { id: up.id, state: up.state, send_state: up.send_state, shoot_id: up.shoot_id } };
    }

    /** photo_upload_seal(p_upload, p_files, p_bytes): a phone's rows still without a hash are removed first */
    function seal(w, a) {
      if (!canPhoto(w)) throw forbidden();
      let up = uploadOf(a);
      mineOrAdmin(w, up);
      let again = false;
      let f = folderRow(up.folder_id);
      if (up.state === "sealed") again = true;
      else {
        if (up.state !== "open" && up.state !== "abandoned") throw err("22023", "upload_closed", "That hand-in is already handed in or cancelled.");
        for (const r of rows.photo_shoot_files.slice()) {
          if (r.last_upload_id === up.id && !r.md5 && !r.counted && r.state !== "removed") {
            write("photo_shoot_files", r, { state: "removed", removed_reason: "cancelled", removed_by: w.uid }, w.uid);
          }
        }
        const rec = recordedOf(up);
        if (rec.n === 0) throw err("22023", "empty", "Nothing was handed in.");
        if (rec.n !== Number(a.p_files) || rec.b !== Number(a.p_bytes)) {
          throw err("22023", "count_mismatch", "Some files didn't reach DCR's list - sending them again.", { files: rec.n, bytes: rec.b });
        }
        up = write("photo_shoot_uploads", up, { state: "sealed", sealed_by: w.uid, sealed_at: nowIso(), files: rec.n, bytes: rec.b, recorded_files: rec.n,
          recorded_bytes: rec.b }, w.uid);
        for (const r of rows.photo_shoot_files.slice()) {
          if (r.last_upload_id === up.id && r.state !== "removed") {
            write("photo_shoot_files", r, { counted: true, prev_size: null, prev_md5: null, prev_upload_id: null, prev_drive: null }, w.uid);
          }
        }
        const sending = rows.photo_shoot_files.some((r) => r.last_upload_id === up.id && r.counted && r.state === "waiting" && (r.upload_step === "to_send" || r.upload_step === "session"));
        const extra = { late_at: null, stalled_at: null };
        if (!sending) extra.next_check_at = nowIso();
        // nothing of it left to check: the complete check the function runs right after the hand-in's last file (§4.5)
        if (!rows.photo_shoot_files.some((r) => r.last_upload_id === up.id && r.counted && r.state === "waiting")) {
          Object.assign(extra, { checked_at: nowIso(), complete_check_at: nowIso(), next_check_at: new Date(nowMs() + 30 * 60e3).toISOString() });
        }
        f = recount(folderRow(up.folder_id), extra);
        readyCheck(up.shoot_id, null);
        f = folderRow(up.folder_id);
      }
      return { ok: true, again, upload: { id: up.id, state: up.state, files: up.files, bytes: up.bytes, sealed_at: iso(up.sealed_at) },
        folder: { files_state: f ? f.files_state : null, next_check_at: f ? iso(f.next_check_at) : null } };
    }

    /** photo_upload_cancel(p_upload) */
    function cancelUpload(w, a) {
      if (!canPhoto(w)) throw forbidden();
      const up = uploadOf(a);
      if (up.started_by !== w.uid && !w.admin) throw err("42501", "not_yours", "That copy was started by someone else.");
      if (up.state === "sealed") throw err("22023", "sealed", "That copy is already handed in.");
      if (up.state === "cancelled") return { ok: true, state: "cancelled", removed: 0, put_back: 0, again: true };
      const out = endUpload(up, "cancelled", w.uid);
      readyCheck(up.shoot_id, null);
      return Object.assign({ ok: true, state: "cancelled", again: false }, out);
    }

    /** photo_shoot_files_page(p_shoot, p_filter, p_after, p_limit): the shoot's rows in id order, never an item id - each
        with its hand-in (upload_id), its sending step (upload_step) and whether it is stalled (app.photo_row_stalled; the
        migration RE-MADE it at review round 7, OD §25) */
    function filesPage(w, a) {
      if (!canPhotoRead(w)) throw err("42501", "forbidden", "Only an admin or the photo team reads the shoot files.");
      const filter = a.p_filter === undefined || a.p_filter === null ? "all" : a.p_filter;
      if (["all", "problems", "waiting", "drive_only", "removed"].indexOf(filter) === -1) throw err("22023", "bad_filter", "The filter is all, problems, waiting, drive_only or removed.");
      const limit = a.p_limit === undefined || a.p_limit === null ? 200 : Number(a.p_limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw err("22023", "bad_filter", "A page holds 1 to 500 files.");
      const s = shootRow(a.p_shoot);
      if (!s) throw err("PT404", "no_shoot", "That shoot isn't on the schedule any more.", { table: "photo_shoots", id: Number(a.p_shoot) });
      const f = liveFolder(s.id);
      if (!f) return { files: [], next: null };
      const after = Number(a.p_after) || 0;
      const keep = (r) => (filter === "problems" ? ["mismatch", "missing", "wrong_owner"].indexOf(r.state) !== -1 : filter === "waiting" ? r.state === "waiting"
        : filter === "removed" ? r.state === "removed" : filter === "drive_only" ? false : true);
      const list = filesOf(f.id).filter((r) => r.id > after && keep(r)).sort((x, y) => x.id - y.id).slice(0, limit + 1);
      const out = list.slice(0, limit).map((r) => ({ id: r.id, path: r.path, kind: r.kind, size: r.size, md5: r.md5 || r.drive_md5 || null, state: r.state,
        source: r.source, counted: r.counted, drive_path: null, drive_size: r.drive_size, owner_ok: r.drive_file_id ? true : null, confirmed_at: iso(r.confirmed_at),
        missing_since: iso(r.missing_since), copy_of: null, dup_path: false, removed_reason: r.removed_reason, culled: false,
        upload_id: r.last_upload_id, upload_step: r.upload_step, stalled: rowStalled(r) }));
      return { files: out, next: list.length > limit ? out[out.length - 1].id : null };
    }

    /* the demo's OneDrive: what lands at an upload address (OneDrive's own quickXorHash of the bytes it got) */
    let itemN = 0;
    function qxOf(parts) {
      const Q = root.DCR2QuickXor;
      if (!Q || parts.some((p) => !(p instanceof ArrayBuffer) && !ArrayBuffer.isView(p) && typeof p !== "string")) return null;
      const q = new Q.QuickXorHash();
      for (const p of parts) q.update(typeof p === "string" ? new TextEncoder().encode(p) : p instanceof ArrayBuffer ? new Uint8Array(p) : new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
      return q.base64();
    }
    function landed(rowId, path, size, parts) {
      const r = fileRow(rowId);
      if (!r) return null;
      if (itemAt(r.folder_id, path)) return null;                 // the name was taken meanwhile: 409 nameAlreadyExists
      const id = "01FAKEPH" + String(Date.now() % 1e8).padStart(8, "0") + "N" + String(++itemN).padStart(4, "0");
      const qx = qxOf(parts);
      const it = { id: nextId(ITEMS), item_id: id, folder_id: r.folder_id, path, size, qx: dev.hashLate ? null : qx, later_qx: dev.hashLate ? qx : null,
        by_app: true, created_at: nowIso() };
      commitInsert(ITEMS, it);
      if (qx === null && typeof Blob !== "undefined") {
        // Blob parts: hashed a moment later, as OneDrive does
        Promise.all(parts.map((p) => (p && typeof p.arrayBuffer === "function" ? p.arrayBuffer() : p))).then((bufs) => {
          const old = rows[ITEMS].find((x) => x.item_id === id);
          if (old) commitUpdate(ITEMS, old, Object.assign(clone(old), dev.hashLate ? { later_qx: qxOf(bufs) } : { qx: qxOf(bufs) }));
        }, () => {});
      }
      const f = folderRow(r.folder_id);
      return { id, name: lastSeg(path), size, file: { mimeType: "application/octet-stream", hashes: it.qx ? { quickXorHash: it.qx } : {} },
        parentReference: { id: f && f.drive_link ? "1FAKEparent" + f.id : null },
        createdBy: { application: { id: "demo-app-dcr-photo-files", displayName: "DCR Photo Files" } }, createdDateTime: it.created_at };
    }
    /** OneDrive's hash of an item, revealed (dev.hashLate: it had none until a check or hashNow) */
    function settle(it) {
      if (it && !it.qx && it.later_qx) {
        commitUpdate(ITEMS, it, Object.assign(clone(it), { qx: it.later_qx, later_qx: null }));
        return itemById(it.item_id);
      }
      return it;
    }
    /** a row's verdict on its item (app.photo_item_verdict, as far as the demo meets it): -> {state} | {code} */
    function verdict(r, it, by) {
      const back = (code) => {
        write("photo_shoot_files", r, { upload_step: "to_send", session_at: null, drive_file_id: null, drive_size: null, resends: (r.resends || 0) + 1 }, by);
        return { code };
      };
      if (!it) return back("gone");
      if (it.folder_id !== r.folder_id || !it.by_app || rows.photo_shoot_files.some((x) => x.id !== r.id && x.drive_file_id === it.item_id && x.state !== "removed")) {
        return back("not_this_upload");
      }
      if (it.size !== r.size) return back("broken_upload");
      if (!it.qx) {
        write("photo_shoot_files", r, { drive_file_id: it.item_id, drive_size: it.size, upload_step: "committed" }, by);
        return { state: "checking" };
      }
      if (r.md5 && it.qx === r.md5) {
        write("photo_shoot_files", r, { state: "confirmed", confirmed_at: nowIso(), verified_at: nowIso(), drive_file_id: it.item_id, drive_size: it.size,
          drive_md5: it.qx, upload_step: "done" }, by);
        return { state: "confirmed" };
      }
      return back("broken_upload");
    }

    /** the hand-in of a photo-files sessions / done / find call, as app.gdrive_send_context gates it */
    function sendCtx(w, b) {
      if (!DEVICE_KEY.test(String(b.device_key || ""))) return { fail: [400, { error: "invalid", field: "device_key", message: "That request is not one photo-files takes." }] };
      const up = Number.isSafeInteger(Number(b.upload_id)) ? uploadRow(b.upload_id) : null;
      if (!up) return { fail: [404, { error: "no_upload", message: "There is no such hand-in." }] };
      if (up.started_by !== w.uid && !w.admin) return { fail: [403, { error: "not_yours", message: "That hand-in was started by someone else." }] };
      // (no root row yet: 409 not_connected, as handler.ts's gate answers it - OD §4.7)
      if (!rootState()) return { fail: [409, { error: "not_connected", message: "OneDrive isn't connected yet - an admin opens Settings -> Photo & Video." }] };
      if (rootState() !== "found") return { fail: [409, { error: "root_lost", message: "DCR can't reach DCR Photo & Video in OneDrive right now." }] };
      const f = folderRow(up.folder_id);
      const job = f && f.parent_id ? folderRow(f.parent_id) : null;
      if (!f || goneState(f) || goneState(job)) return { fail: [409, { error: "folder_gone", message: "This shoot's folder is no longer in DCR Photo & Video." }] };
      if (up.state !== "open" && up.state !== "sealed") return { fail: [409, { error: "upload_closed", message: "That hand-in is already handed in or cancelled." }] };
      return { up, f, s: shootRow(up.shoot_id), device_ok: up.pc_id === deviceId(b.device_key) };
    }
    const listOf = (v, max) => (Array.isArray(v) && v.length >= 1 && v.length <= max ? v : null);

    function opSessions(w, b) {
      const c = sendCtx(w, b);
      if (c.fail) return c.fail;
      const mode = modeOf(c.s);
      if (mode !== "on") return [503, { error: mode === "test" ? "uploads_test" : "uploads_off", message: "Photo uploads aren't on for this job." }];
      const list = listOf(b.files, 20);
      if (!list || list.some((x) => !x || !Number.isSafeInteger(Number(x.file_id)))) return [400, { error: "invalid", field: "files", message: "That request is not one photo-files takes." }];
      const out = [];
      for (const x of list) {
        const id = Number(x.file_id);
        if (!c.device_ok) { out.push({ file_id: id, code: "not_this_device" }); continue; }
        let r = fileRow(id);
        if (!r || r.last_upload_id !== c.up.id || r.state !== "waiting") { out.push({ file_id: id, code: "not_waiting" }); continue; }
        if (x.md5 && r.md5 && x.md5 !== r.md5) { out.push({ file_id: id, code: "not_same_file" }); continue; }
        // (a row at committed: its item known, its bytes in OneDrive - found with that item, no call to Microsoft, no
        // session; done reads it again - handler.ts's committedFor, OD §3.2.4 step 5, review round 6)
        if (r.upload_step === "committed" && r.drive_file_id) { out.push({ file_id: id, code: "found", item_id: r.drive_file_id }); continue; }
        if (!E.onedriveUpload) { out.push({ file_id: id, code: "onedrive_failed" }); continue; }
        const f = made(folderRow(r.folder_id));
        const there = itemAt(f.id, r.path);
        let code = null;
        if (there) {
          if (there.by_app && there.size === r.size && (r.session_at || (x.md5 && there.qx === x.md5))) {
            write("photo_shoot_files", r, { drive_file_id: there.item_id, upload_step: "committed" }, w.uid);
            out.push({ file_id: id, code: "found", item_id: there.item_id });
            continue;
          }
          // taken (a file of another size or hash, or not DCR's): the next free name, against the rows and OneDrive's names
          const next = freeName(r.path, filesOf(f.id).filter((y) => y.id !== r.id).map((y) => y.path).concat(rows[ITEMS].filter((y) => y.folder_id === f.id).map((y) => y.path), [r.path]));
          if (!next) { out.push({ file_id: id, code: "path_too_long" }); continue; }
          r = write("photo_shoot_files", r, { path: next, path_key: fold(next) }, w.uid);
          code = "name_taken";
        }
        const rowId = r.id, path = r.path, size = r.size;
        const s = E.onedriveUpload.open({ size, name: lastSeg(path), commit: (parts) => landed(rowId, path, size, parts), full: () => !!dev.full });
        write("photo_shoot_files", r, { session_at: nowIso(), upload_step: "session" }, w.uid);
        out.push(Object.assign({ file_id: id }, code ? { code } : {}, { upload_url: s.url, expires_at: s.expires_at, path }));
      }
      return [200, { chunk_multiple: UNIT, chunk_bytes: c.up.source === "phone" ? PHONE_CHUNK : PC_CHUNK, max_chunk_bytes: MAX_CHUNK, files: out }];
    }

    function opDone(w, b) {
      const c = sendCtx(w, b);
      if (c.fail) return c.fail;
      const list = listOf(b.items, 20);
      if (!list || list.some((x) => !x || !Number.isSafeInteger(Number(x.file_id)) || typeof x.item_id !== "string" || (x.md5 !== undefined && !QX.test(String(x.md5))))) {
        return [400, { error: "invalid", field: "items", message: "That request is not one photo-files takes." }];
      }
      if (!c.device_ok) return [200, { items: list.map((x) => ({ file_id: Number(x.file_id), code: "not_this_device" })), folder: null }];
      const out = [];
      let counted = false;
      for (const x of list) {
        const id = Number(x.file_id);
        let r = fileRow(id);
        if (!r || r.last_upload_id !== c.up.id || r.state !== "waiting") {
          // (a row of this hand-in LEFT OUT while its last chunk landed or its done waited: DCR's own item - made by this
          // app, in the shoot folder, of the row's size, no other row's - is kept on it, its bytes in OneDrive
          // (committed), so a check never counts it as added without DCR and a Put it back is confirmed by id; still
          // not_waiting - app.gdrive_items_seen, review round 9)
          const it = r && r.state === "removed" ? itemById(x.item_id) : null;
          if (it && r.folder_id === c.up.folder_id && r.last_upload_id === c.up.id && r.removed_reason === "left_out" && !r.drive_file_id &&
              it.folder_id === r.folder_id && it.by_app && it.size === r.size &&
              !rows.photo_shoot_files.some((o) => o.id !== r.id && o.drive_file_id === it.item_id)) {
            write("photo_shoot_files", r, { drive_file_id: it.item_id, upload_step: "committed" }, w.uid);
          }
          out.push({ file_id: id, code: "not_waiting" });
          continue;
        }
        if (x.md5) {
          if (r.md5 && r.md5 !== x.md5) { out.push({ file_id: id, code: "not_same_file" }); continue; }
          if (!r.md5) r = write("photo_shoot_files", r, { md5: x.md5 }, w.uid);
        }
        // (read by id: OneDrive's hash as it is now - a late one only comes with a later read, a check)
        const v = verdict(r, itemById(x.item_id), w.uid);
        if (r.counted) counted = true;
        out.push(Object.assign({ file_id: id }, v, v.state === "checking" ? { retry_after: 30 } : {}));
      }
      let f = counted ? recount(folderRow(c.up.folder_id)) : folderRow(c.up.folder_id);
      // the hand-in's last file confirmed: a complete check now, so a done shoot can fire at once (§4.5)
      if (c.up.state === "sealed" && !rows.photo_shoot_files.some((r) => r.last_upload_id === c.up.id && r.counted && r.state === "waiting")) {
        f = write("photo_drive_folders", f, { checked_at: nowIso(), complete_check_at: nowIso(), last_progress_at: nowIso(), late_at: null });
        readyCheck(c.up.shoot_id, null);
        f = folderRow(c.up.folder_id);
      }
      return [200, { items: out, folder: { files_state: f.files_state } }];
    }

    function opFind(w, b) {
      const c = sendCtx(w, b);
      if (c.fail) return c.fail;
      if (!c.device_ok) return [403, { error: "not_this_device", message: "Only the device that started this hand-in can send its files." }];
      const r = fileRow(b.file_id);
      if (!r || r.last_upload_id !== c.up.id) return [200, { item_id: null }];
      const it = itemAt(r.folder_id, r.path);
      return [200, { item_id: it && it.by_app && it.size === r.size ? it.item_id : null }];
    }

    /** a check's by-id reads: every row whose item landed and waits for OneDrive's hash - and a row whose item is no
        longer there (a put back row's earlier item gone meanwhile, OD §5.3's rule 1: the verdict decides - gone, sent
        again by its earlier hand-in's device; review round 5) */
    function judgeCommitted(f) {
      let n = 0;
      for (const r of filesOf(f.id)) {
        if (r.state !== "waiting" || r.upload_step !== "committed" || !r.drive_file_id) continue;
        const it = settle(itemById(r.drive_file_id));
        if (!it || it.qx) { verdict(r, it, null); n++; }
      }
      return n;
    }

    /** queued (OD §3.2.8, derived, never stored): a sealed hand-in with files still to send whose device is sending
        another hand-in now (that one's beat says sending, under 2 minutes old) -> the shoot it waits behind, or null -
        never over a hand-in whose own beat says lost or paused, fresh or not, nor outbox_away under 2 minutes old: only
        the card, the disk or a person moves it, and its own line says which (review round 3); a stale outbox_away was
        said in a turn of its own that has not come again (review round 4) */
    function queuedBehind(u, toSend) {
      const beatNow = (x) => Date.parse(x.send_beat_at || 0) > nowMs() - 120e3;
      const fresh = (x) => x.send_state === "sending" && beatNow(x);
      if (u.state !== "sealed" || !(toSend > 0) || u.pc_id === null || u.pc_id === undefined || fresh(u)) return null;
      if (u.send_state === "lost" || u.send_state === "paused" || (u.send_state === "outbox_away" && beatNow(u))) return null;
      const y = rows.photo_shoot_uploads.filter((x) => x.pc_id === u.pc_id && x.id !== u.id && fresh(x))
        .sort((a, b) => Date.parse(b.send_beat_at) - Date.parse(a.send_beat_at) || b.id - a.id)[0];
      if (!y) return null;
      const ys = shootRow(y.shoot_id);
      return ys ? String(ys.name || "").slice(0, 80) : "";
    }
    const waitingRows = (fid, steps) => filesOf(fid).filter((r) => r.counted && r.state === "waiting" && steps.indexOf(r.upload_step) !== -1).length;
    /** app.photo_row_stalled (OD §6.6, §25, §27, §28; review rounds 7, 9 and 10): a row counted, waiting and still to
        SEND (to_send / session) under a sealed PC hand-in, 14 days after the latest of that hand-in's seal, the row's own
        put back (back_at), the uploads mode's last change (dev.mode_at) and that hand-in's own newest progress
        (progress_at: a PC switched on again and sending it is never stalled - its own, never its computer's) - and never
        while that hand-in waits its turn on a computer that is sending now: its own last beat waiting_turn (its PC holds
        it behind the one it sends) and another hand-in of the same computer (pc_id) beating sending under 2 minutes old,
        the status's queued (review round 10) - the status's uploads[].stalled, the file list's stalled: the rows the
        stalled line counts, never a row in OneDrive nor a fresher hand-in's */
    function rowStalled(r) {
      if (!r || !r.counted || r.state !== "waiting" || (r.upload_step !== "to_send" && r.upload_step !== "session")) return false;
      const s = uploadRow(r.last_upload_id);
      if (!s || s.state !== "sealed" || s.source !== "pc") return false;
      const at = [s.sealed_at, r.back_at, dev.mode_at, s.progress_at].map((x) => Date.parse(x || "")).filter((t) => Number.isFinite(t));
      if (!(at.length > 0 && Math.max(...at) < nowMs() - 14 * 86400e3)) return false;
      // (queued behind a send of its own computer: review round 10)
      const queued = s.send_state === "waiting_turn" && s.pc_id !== null && s.pc_id !== undefined &&
        rows.photo_shoot_uploads.some((y) => y.pc_id === s.pc_id && y.id !== s.id && y.send_state === "sending" &&
          Date.parse(y.send_beat_at || "") > nowMs() - 120e3);
      return !queued;
    }
    /** a folder's stalled (OD §6.6, §10.6; review round 8): its stamp stalled_at AND a row rowStalled holds for left -
        the status's files.stalled and app.photo_help_now's stalled: never "0 files never reached OneDrive" between the
        stalled files' send and the next tick */
    const folderStalled = (f) => !!(f && f.stalled_at && filesOf(f.id).some(rowStalled));

    /** app.photo_drive_status_json as person uid sees it */
    function statusJson(sid, uid) {
      const s = shootRow(sid);
      if (!s) return null;
      const w = E.who({ uid });
      const f = liveFolder(s.id);
      const plan = planRow(s.plan_id);
      const rs = rootState();
      const access = driveAccess(uid);
      const ups = f ? uploadsOf(f.id).slice(0, 20) : [];
      const r = roll(f);
      const ru = f ? rule(s, f) : rule(s, null);
      const m = marketingOf(s.id);
      const lastDone = rows.photo_changes.filter((c) => c.plan_id === s.plan_id && c.kind === "done" && c.target_key === s.key)
        .sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)) || b.id - a.id)[0];
      const refused = !!(lastDone && lastDone.status === "refused" && lastDone.error && lastDone.error.code === "not_open" &&
        lastDone.expect && lastDone.expect.shoot && ["skipped", "missed"].indexOf(lastDone.expect.shoot.status) !== -1);
      const openOk = access === "shared" && !!(f && f.drive_link) && f.drive_state === "found";
      const state = f ? filesState(r) : "none";
      const mode = modeOf(s);
      // the shoot's job folder: its folder row's parent, or the plan's live job row while the shoot has none yet (OD §2.3,
      // §10.6; review round 1) - gone, it holds its new shoots too
      const job = f && f.parent_id !== null && f.parent_id !== undefined ? rows.photo_drive_folders.find((x) => x.id === f.parent_id) || null
        : f ? null : rows.photo_drive_folders.find((x) => x.kind === "job" && x.plan_id === s.plan_id && !x.retired_at) || null;
      const gone = !!((f && (f.drive_state === "missing" || f.drive_state === "trashed")) || (job && (job.drive_state === "missing" || job.drive_state === "trashed")));
      // its JOB folder gone while its own folder is not in OneDrive (no folder row, or one not in OneDrive yet): the
      // completion's job_gone, and the help's folder_gone said as folder_gone_job, "Job folder gone" (review round 3)
      const jobGone = !!(job && (job.drive_state === "missing" || job.drive_state === "trashed")) && (!f || f.drive_state === "not_seen");
      const add = canPhoto(w) && rs === "found" && !gone && mode === "on";
      const by = (u) => {
        const n = { ready: null, claimed: m && m.claimed_by, posted: m && m.posted_by, passed: m && m.passed_by }[m.state];
        return n ? firstName(n) : "";
      };
      return {
        shoot_id: s.id, shoot_status: s.status,
        root: rs ? { state: rs, name: ROOT.name, link: ROOT.link } : null,
        mode, mode_codes: modeCodes(),
        folder: f ? { id: f.id, tag: f.tag, name: f.name, drive_state: f.drive_state, drive_state_at: iso(f.drive_state_at || f.made_at || f.created_at),
          drive_name: f.drive_name, drive_path: f.drive_name ? f.drive_name : null, link: f.drive_link, made_at: iso(f.made_at),
          drive_created_at: iso(f.drive_created_at), duplicates: 0, owner_ok: !!f.owner_ok, retired_at: iso(f.retired_at) } : null,
        job: job ? jobJson(job) : null,
        files: { state, counted: f ? f.counted : 0, confirmed: f ? f.confirmed : 0, waiting: f ? f.waiting : 0,
          problem: f ? f.mismatch + f.missing : 0, mismatch: f ? f.mismatch : 0, missing: f ? f.missing : 0, culled: culledNow(f, m),
          drive_only: f ? f.drive_only : 0, removed: f ? f.removed : 0,
          // the counted rows still to send (to_send / session) and those in OneDrive waiting for its hash (committed); the
          // seeded waiting files have no rows - they wait as the seed made them
          to_send: f ? waitingRows(f.id, ["to_send", "session"]) : 0, committed: f ? waitingRows(f.id, ["committed"]) : 0, stalled_checking: false, busy: !!(f && f.last_code === "retry_later" && f.busy_tries > 0),
          copies: 0, bytes: f ? f.bytes : 0, bytes_confirmed: f ? f.bytes_confirmed : 0, photos: f ? f.photos : 0, videos: f ? f.videos : 0,
          // (stalled while a stalled row is left too - review round 8)
          others: f ? f.others : 0, late: !!(f && f.late_at), stalled: folderStalled(f), checked_at: f ? iso(f.checked_at) : null,
          complete_check_at: f ? iso(f.complete_check_at) : null, next_check_at: f ? iso(f.next_check_at) : null,
          last_progress_at: f ? iso(f.last_progress_at) : null, last_code: f ? f.last_code : null, rev: f ? f.files_rev : 0 },
        uploads: ups.map((u) => {
          const toSend = rows.photo_shoot_files.filter((r) => r.last_upload_id === u.id && r.state === "waiting" &&
            (r.upload_step === "to_send" || r.upload_step === "session")).length;
          const q = queuedBehind(u, toSend);
          // (the files that still count toward its send: its rows not left out or removed - the sending line's {total},
          // {total_size} and time left, as the beat's own sent_files / bytes_sent count them; review round 8)
          const mine = rows.photo_shoot_files.filter((r) => r.last_upload_id === u.id && r.state !== "removed");
          return { id: u.id, state: u.state, source: u.source, pc: u.pc_label, device: u.pc_label, pc_id: u.pc_id, by: firstName(u.started_by),
            files: u.files === null ? u.recorded_files : u.files, bytes: u.bytes === null ? u.recorded_bytes : u.bytes,
            send_files: mine.length, send_bytes: mine.reduce((t, r) => t + int(r.size), 0), started_at: iso(u.started_at),
            sealed_at: iso(u.sealed_at), running: u.state === "open" && Date.parse(u.beat_at || u.started_at) > nowMs() - 120e3, beat_at: iso(u.beat_at),
            recorded_files: u.recorded_files, yours: u.started_by === uid, can_decide: u.started_by === uid || !!(w && w.admin),
            sent_files: u.sent_files || 0, bytes_sent: u.bytes_sent || 0, to_send: toSend,
            // (how many of its rows are stalled, app.photo_row_stalled: the stalled line's rows - review round 7)
            stalled: rows.photo_shoot_files.filter((r) => r.last_upload_id === u.id && rowStalled(r)).length,
            // (a stored waiting_turn - its PC holds it behind the hand-in it sends - reads queued while that one beats
            // sending, else sending: the choosers' stale-beat rules then apply; review round 4)
            send_state: q ? "queued" : u.send_state === "waiting_turn" ? "sending" : u.send_state || null,
            seen_at: iso(u.send_beat_at), rate_bps: u.rate_bps === undefined ? null : u.rate_bps, behind: q };
        }),
        retired: null,
        closed: s.status === "skipped" || s.status === "missed" ? s.status : null,
        plan_status: plan ? plan.status : null,
        ready_why: ru.why,
        completion: completionCode({ status: s.status, why: ru.why, files_state: state, drive_only: f ? f.drive_only : 0, has_files: hasFiles(s.id),
          done_refused: refused, marketing: m ? m.state : null,
          folder_gone: !!(f && (f.drive_state === "missing" || f.drive_state === "trashed")), job_gone: jobGone,
          root_lost: rs === "missing" || rs === "trashed", plan_closed: !!(plan && ["active", "paused"].indexOf(plan.status) === -1), mode }),
        marketing: m ? { id: m.id, state: m.state, by: by(), at: iso({ claimed: m.claimed_at, posted: m.posted_at, passed: m.passed_at,
          withdrawn: m.withdrawn_at }[m.state] || m.ready_at), ready_at: iso(m.ready_at), files_missing: m.files_missing, files_added: m.files_added,
          files_added_at: iso(m.files_added_at), reason: m.state === "passed" ? m.pass_reason : null,
          // who was told and how (each member's phone and e-mail settings): an admin's - [] for everyone else (v19 §42)
          told: w && w.admin ? (m.told || []).map((t) => ({ name: t.name, email: t.email, push: t.push })) : [] } : null,
        me: { drive_access: access },
        help: helpNow(s, f, m).map((h) => (h === "folder_gone" && jobGone ? "folder_gone_job" : h)),
        can: { hand_in: canPhoto(w) && rs === "found", add_files: add, add_from_phone: add && !!dev.phone, check: canPhotoRead(w) && rs === "found",
          resolve: canPhoto(w) && !!f, open_folder: openOk },
      };
    }

    /** app.photo_shoot_ready_check (§10.2): fired once per shoot; withdrawn when not done any more; back when done again */
    function readyCheck(sid, completer) {
      const s = shootRow(sid);
      const f = s ? liveFolder(s.id) : null;
      const m = s ? marketingOf(s.id) : null;
      if (!s) return "none";
      if (s.status !== "done") {
        if (m && (m.state === "ready" || m.state === "claimed")) { write("photo_marketing", m, { state: "withdrawn", withdrawn_from: m.state, withdrawn_at: nowIso() }); return "withdrawn"; }
        return "none";
      }
      if (!f || !rule(s, f).ready) return "none";
      if (m) {
        if (m.state === "withdrawn") { write("photo_marketing", m, { state: m.withdrawn_from || "ready", withdrawn_from: null, withdrawn_at: null }); return "back"; }
        return "none";
      }
      const plan = planRow(s.plan_id) || {};
      const sealed = uploadsOf(f.id).filter((u) => u.state === "sealed").sort((a, b) => String(b.sealed_at).localeCompare(String(a.sealed_at)))[0];
      const told = rows.photo_team.filter((t) => t.marketing && t.profile_id !== completer && (E.who({ uid: t.profile_id }) || {}).active)
        // (each member's account: their Microsoft account field, else their DCR e-mail - OD §8.2: always one to send to)
        .map((t) => ({ name: firstName(t.profile_id), email: "queued", push: "queued", profile_id: t.profile_id }));
      add("photo_marketing", { folder_id: f.id, shoot_id: s.id, plan_id: s.plan_id, shoot_key: s.key, job_label: plan.project_label || "", city: plan.city || "",
        shoot_name: s.name, shoot_day: shootDay(s), photographer_name: plan.photographer_name || "", handed_in_by: sealed ? sealed.sealed_by : null,
        folder_link: f.drive_link, files_at_ready: { photos: f.photos, videos: f.videos, other: f.others, bytes: f.bytes }, state: "ready",
        ready_at: nowIso(), completed_by: completer || null, told });
      dev.drains += 1;
      return "ready";
    }

    /* ── the RPCs ── */

    function readyList(w, view) {
      const uid = w.uid;
      const t = nowMs();
      const access = driveAccess(uid);
      const admin = !!w.admin;
      const marketing = isMarketing(w);
      const day = 86400e3;
      const list = rows.photo_marketing.filter((m) => (view === "done" ? (m.state === "posted" || m.state === "passed") &&
        Date.parse(m.posted_at || m.passed_at) > t - 90 * day : m.state === "ready" || m.state === "claimed"));
      const key = (m) => (view === "done" ? [0, -Date.parse(m.posted_at || m.passed_at)] : [m.state === "ready" ? 0 : 1, Date.parse(m.ready_at)]);
      list.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || a.id - b.id; });
      const items = list.slice(0, 300).map((m) => {
        const f = rows.photo_drive_folders.find((x) => x.id === m.folder_id) || null;
        return {
          id: m.id, state: m.state, version: m.version, shoot_id: m.shoot_id, shoot_name: m.shoot_name, job_label: m.job_label, city: m.city,
          shoot_day: m.shoot_day, by: firstName(m.handed_in_by) || String(m.photographer_name || "").split(/\s+/)[0] || "",
          files: m.files_at_ready, ready_at: iso(m.ready_at),
          waiting_long: (m.state === "ready" || m.state === "claimed") && Date.parse(m.ready_at) < t - 14 * day,
          files_missing: m.files_missing, files_added: m.files_added, files_added_at: iso(m.files_added_at),
          claimed: m.state === "claimed" ? { name: firstName(m.claimed_by), at: iso(m.claimed_at), you: m.claimed_by === uid } : null,
          taken_from: m.state === "claimed" && m.taken_from ? firstName(m.taken_from) : null,
          posted: m.state === "posted" ? { name: firstName(m.posted_by), at: iso(m.posted_at), where: m.posted_where || [], link: m.posted_link,
            note: m.posted_note, you: m.posted_by === uid } : null,
          passed: m.state === "passed" ? { name: firstName(m.passed_by), at: iso(m.passed_at), reason: m.pass_reason, you: m.passed_by === uid } : null,
          // (an admin's only: each member's phone and e-mail settings, v19 §42)
          told: admin ? (m.told || []).map((x) => ({ name: x.name, email: x.email, push: x.push })) : [],
          folder: f ? { drive_state: f.drive_state, last_code: f.last_code, limited: false } : null,
          link: m.folder_link,
          can: {
            open: access === "shared" && !!m.folder_link && !!(f && f.drive_state === "found"),
            reopen: (admin || marketing) && ((m.state === "posted" && Date.parse(m.posted_at) > t - 14 * day && (admin || m.posted_by === uid)) ||
              (m.state === "passed" && Date.parse(m.passed_at) > t - 14 * day && (admin || m.passed_by === uid))),
          },
        };
      });
      const open = rows.photo_marketing.filter((m) => m.state === "ready" || m.state === "claimed");
      return { me: { drive_access: access, admin, marketing, can_act: admin || marketing }, view, items,
        counts: { ready: open.filter((m) => m.state === "ready").length, claimed: open.filter((m) => m.state === "claimed").length,
          mine: open.filter((m) => m.state === "claimed" && m.claimed_by === uid).length } };
    }

    function act(w, a) {
      const me = w.uid;
      const admin = !!w.admin;
      if (!(isMarketing(w) || admin)) throw err("42501", "forbidden", "Only marketing or an admin works the Ready for marketing list.");
      const action = a.p_action;
      if (["claim", "release", "posted", "pass", "reopen"].indexOf(action) === -1) throw err("22023", "bad_action", "The action is claim, release, posted, pass or reopen.");
      let m = rows.photo_marketing.find((x) => x.id === Number(a.p_id)) || null;
      if (!m) throw err("PT404", "no_item", "That shoot isn't on the Ready for marketing list any more.", { table: "photo_marketing", id: Number(a.p_id) });
      const wait = rate(me, "marketing_act", 120, 3600e3);
      if (wait) throw err("PT429", "rate", "Too many tries - wait a minute.", { retryAfter: wait });
      if (m.state === "withdrawn") throw err("22023", "withdrawn", "The shoot isn't done any more.");
      const note = a.p_note === null || a.p_note === undefined ? null : String(a.p_note).replace(/\s+/g, " ").trim().slice(0, 300) || null;
      const link = a.p_link === null || a.p_link === undefined ? null : String(a.p_link).trim() || null;
      const at = nowIso();
      let again = false;
      // the same action by the same person again - Back on the list of a passed card too: back on the list, nobody on
      // it, and the row's last change (updated_by) the sender's - the reopen itself, its answer lost on the way (P5b
      // review round 11, §11.2, §44; before, that resend was PT409 changed)
      const wr = (old, patch) => write("photo_marketing", old, patch, me);
      if ((action === "claim" && m.state === "claimed" && m.claimed_by === me) || (action === "posted" && m.state === "posted" && m.posted_by === me) ||
          (action === "pass" && m.state === "passed" && m.passed_by === me) ||
          (action === "reopen" && a.p_state === "posted" && m.state === "claimed" && m.claimed_by === me) ||
          (action === "reopen" && a.p_state === "passed" && m.state === "ready" && !m.claimed_by && !!me && m.updated_by === me) ||
          (action === "release" && a.p_state === "claimed" && m.state === "ready" && !m.claimed_by)) {
        again = true;
        // Posted… / Not for posting… sent again from the sheet that stayed open when its answer was lost: what it sends
        // now (the ticks, a link, a note or a reason corrected meanwhile) is what the card keeps, checked as a first send;
        // a field sent empty keeps the row's (P5b review round 12, §45 - the again answered and dropped the corrections)
        const where = Array.isArray(a.p_where) ? a.p_where : [];
        if (action === "posted" && (where.length > 0 || link !== null || note !== null)) {
          if (where.some((x) => x === null || WHERE.indexOf(x) === -1) || where.length > 6) throw err("22023", "bad_where", "Pick where it was posted from the list.");
          if (link !== null && (!/^https:\/\/\S+$/.test(link) || link.length > 300 || MONEY.test(link))) throw err("22023", "bad_link", "The post's link must start with https://");
          const ch = { posted_where: where.length ? Array.from(new Set(where)).sort() : m.posted_where,
            posted_link: link !== null ? link : m.posted_link, posted_note: note !== null ? note : m.posted_note };
          if (JSON.stringify([ch.posted_where, ch.posted_link, ch.posted_note]) !== JSON.stringify([m.posted_where, m.posted_link, m.posted_note])) m = wr(m, ch);
        } else if (action === "pass" && note !== null && note !== m.pass_reason) {
          m = wr(m, { pass_reason: note });
        }
      } else {
        if (a.p_state !== m.state) {
          const holder = { claimed: m.claimed_by, posted: m.posted_by, passed: m.passed_by }[m.state];
          throw err("PT409", "changed", "Someone changed this meanwhile - look again.",
            { table: "photo_marketing", id: m.id, version: m.version, state: m.state, by: holder ? firstName(holder) : "" });
        }
        const notNow = () => err("22023", "not_now", "That can't be done now - look again.");
        if (action === "claim") {
          if (m.state !== "ready" && m.state !== "claimed") throw notNow();
          if (m.state === "claimed" && m.claimed_by !== me && a.p_take_over !== true) {
            throw err("PT409", "taken", "Someone is already on it.", { table: "photo_marketing", id: m.id, version: m.version, by: firstName(m.claimed_by), at: iso(m.claimed_at) });
          }
          m = wr(m, { state: "claimed", taken_from: m.state === "claimed" ? m.claimed_by : m.taken_from, claimed_by: me, claimed_at: at });
        } else if (action === "release") {
          if (m.state !== "claimed") throw notNow();
          if (m.claimed_by !== me && !admin) throw err("42501", "not_yours", "Someone else is on it.");
          m = wr(m, { state: "ready", claimed_by: null, claimed_at: null });
        } else if (action === "posted") {
          if (m.state !== "ready" && m.state !== "claimed") throw notNow();
          if (m.state === "claimed" && m.claimed_by !== me && !admin) throw err("42501", "not_yours", "Someone else is on it.");
          const where = Array.isArray(a.p_where) ? a.p_where : [];
          if (where.some((x) => x === null || WHERE.indexOf(x) === -1) || where.length > 6) throw err("22023", "bad_where", "Pick where it was posted from the list.");
          if (link !== null && (!/^https:\/\/\S+$/.test(link) || link.length > 300 || MONEY.test(link))) throw err("22023", "bad_link", "The post's link must start with https://");
          m = wr(m, { state: "posted", posted_by: me, posted_at: at, posted_where: Array.from(new Set(where)).sort(), posted_link: link,
            posted_note: note, claimed_by: m.claimed_by || me, claimed_at: m.claimed_at || at });
        } else if (action === "pass") {
          if (m.state !== "ready" && m.state !== "claimed") throw notNow();
          // someone else's card: only an admin (as posted - the screens offer it to no one else; v19 §42)
          if (m.state === "claimed" && m.claimed_by !== me && !admin) throw err("42501", "not_yours", "Someone else is on it.");
          if (!note) throw err("22023", "reason_needed", "Say why it's not for posting.");
          m = wr(m, { state: "passed", passed_by: me, passed_at: at, pass_reason: note });
        } else {
          if (m.state !== "posted" && m.state !== "passed") throw notNow();
          const when = Date.parse((m.state === "posted" ? m.posted_at : m.passed_at) || at);
          if (when < nowMs() - 14 * 86400e3) throw err("22023", "too_late", "It was posted over 14 days ago - it can't be reopened.");
          if ((m.state === "posted" ? m.posted_by : m.passed_by) !== me && !admin) throw err("42501", "not_yours", "Only the person who marked it, or an admin, can reopen it.");
          m = m.state === "posted"
            ? wr(m, { state: "claimed", claimed_by: me, claimed_at: at, posted_by: null, posted_at: null, posted_where: null, posted_link: null, posted_note: null })
            : wr(m, { state: "ready", claimed_by: null, claimed_at: null, passed_by: null, passed_at: null, pass_reason: null });
          const s = shootRow(m.shoot_id);
          if (!s || s.status !== "done") m = wr(m, { state: "withdrawn", withdrawn_from: m.state, withdrawn_at: at });
        }
      }
      const atOf = { claimed: m.claimed_at, posted: m.posted_at, passed: m.passed_at }[m.state] || m.ready_at;
      return { id: m.id, state: m.state, version: m.version, again, claimed_by_name: m.claimed_by ? firstName(m.claimed_by) : null,
        posted_by_name: m.posted_by ? firstName(m.posted_by) : null, passed_by_name: m.passed_by ? firstName(m.passed_by) : null, at: iso(atOf) };
    }

    function checkArgs(name, args) {
      const want = SIGS[name] || [];
      const opt = OPTIONAL[name] || [];
      const got = Object.keys(args || {});
      const unknown = got.find((k) => want.indexOf(k) === -1);
      const lacking = want.find((k) => opt.indexOf(k) === -1 && got.indexOf(k) === -1);
      if (unknown || lacking) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + got.sort().join(", ") + ") in the schema cache", 404, null,
          "Perhaps you meant to call the function public." + name);
      }
    }

    function rpc(w, name, a) {
      if (!dev.p5) throw missing(name);
      switch (name) {
        case "photo_drive_status": {
          if (!canPhotoRead(w)) throw err("42501", "forbidden", "Only admins and the photo team see the shoot files.");
          const st = statusJson(a.p_shoot, w.uid);
          if (!st) throw err("PT404", "no_shoot", "That shoot isn't on the schedule any more.");
          return st;
        }
        case "photo_ready_list": {
          if (!canPhotoRead(w)) throw err("42501", "forbidden", "Only admins and the photo team see the Ready for marketing list.");
          const view = a.p_view === undefined ? "open" : a.p_view;
          if (view !== "open" && view !== "done") throw err("22023", "bad_filter", "The view is open or done.");
          return readyList(w, view);
        }
        case "photo_marketing_act": return act(w, a);
        case "photo_upload_begin": return begin(w, a);
        case "photo_upload_files": return recordFiles(w, a);
        case "photo_upload_beat": return beat(w, a);
        case "photo_upload_seal": return seal(w, a);
        case "photo_upload_cancel": return cancelUpload(w, a);
        case "photo_shoot_files_page": return filesPage(w, a);
        default: throw missing(name);
      }
    }

    /* ── the Edge Function photo-files: check, and the phone's sessions, done and find ── */
    const cache = new Map();
    function invoke(ctx, name, body) {
      const out = (status, data) => ({ status, data });
      if (!dev.p5) return out(404, { code: "NOT_FOUND", message: "Requested function was not found" });
      const w = E.who({ uid: ctx.uid });
      if (!w || !w.uid) return out(401, { error: "unauthorized", message: "sign in first" });
      const b = body && typeof body === "object" ? body : {};
      if (["health", "sessions", "done", "find", "check", "tick"].indexOf(b.op) === -1) return out(400, { error: "invalid", message: "op is not known" });
      if (!w.active) return out(403, { error: "forbidden", message: "You don't have the right to do that." });
      if (dev.down) return out(503, { error: dev.down, message: "OneDrive is busy - DCR tries again in a minute." });
      if (b.op === "sessions" || b.op === "done" || b.op === "find") {
        if (!canPhoto(w)) return out(403, { error: "forbidden", message: "You don't have the right to do that." });
        const lim = { sessions: 600, done: 600, find: 120 }[b.op];
        const held = rate(w.uid, b.op, lim, 600e3);
        if (held) return out(429, { error: "rate", message: "Too many tries - wait a minute.", retry_after: held });
        const r = (b.op === "sessions" ? opSessions : b.op === "done" ? opDone : opFind)(w, b);
        return out(r[0], r[1]);
      }
      if (b.op !== "check") return out(403, { error: "forbidden", message: "You don't have the right to do that." });
      if (!canPhotoRead(w)) return out(403, { error: "forbidden", message: "You don't have the right to do that." });
      const wait = rate(w.uid, "check", 30, 600e3);
      if (wait) return out(429, { error: "rate", message: "Too many tries - wait a minute.", retry_after: wait });
      const s = shootRow(b.shoot_id);
      if (!s) return out(404, { error: "no_shoot", message: "That shoot isn't on the schedule any more." });
      // (handler.ts's order: no folder, then no root row yet - 409 not_connected -, then the root lost; OD §4.7)
      let f = liveFolder(s.id);
      if (!f) return out(404, { error: "no_folder", message: "This shoot has no folder yet." });
      if (!rootState()) return out(409, { error: "not_connected", message: "OneDrive isn't connected yet - an admin opens Settings -> Photo & Video." });
      if (rootState() !== "found") return out(409, { error: "root_lost", message: "DCR can't reach DCR Photo & Video in OneDrive right now." });
      dev.checks += 1;
      const last = cache.get(s.id);
      const t = nowMs();
      if (last && t - last < 20e3) {
        return out(200, Object.assign(statusJson(s.id, w.uid), { complete: true, cached: true, ran_ms: 0, code: f.last_code, became_ready: false }));
      }
      cache.set(s.id, t);
      // a demo check: the seeded files still on their way arrive (dev.advance); every row whose item landed is read by id
      // (OneDrive's hash judged); the check stamped
      const patch = { checked_at: nowIso(), complete_check_at: nowIso(), next_check_at: new Date(t + 5 * 60e3).toISOString() };
      const seed = seedOf(f);
      if (dev.advance && seed.waiting > 0 && f.drive_state === "found") {
        Object.assign(seed, { confirmed: seed.confirmed + seed.waiting, waiting: 0, bytes_confirmed: seed.bytes, media_confirmed: seed.photos + seed.videos });
        Object.assign(patch, { late_at: null, last_progress_at: nowIso(), help: (f.help || []).filter((h) => h !== "late") });
      }
      if (f.drive_state === "found") judgeCommitted(f);
      f = recount(folderRow(f.id), patch, seed);
      const was = marketingOf(s.id);
      readyCheck(s.id, null);
      const now = marketingOf(s.id);
      const became = !was && !!now && now.state === "ready";
      return out(200, Object.assign(statusJson(s.id, w.uid), { complete: true, cached: false, ran_ms: 900, code: f.last_code, became_ready: became }));
    }

    /** app.photo_release_claims_of (§11.1, v19 §42): the Ready cards claimed by someone who can no longer act on them
        (taken off marketing, turned off, no longer an admin) go back to ready - taken_from keeps who had it - so they are
        in the others' Home number and buttons again, never "Sam is on it" for good; a withdrawn row that would come back
        claimed by them comes back ready. Fired by the photo team's and the profiles' changes (the database's triggers). */
    function releaseClaimsOf(uid) {
      const w = uid ? E.who({ uid }) : null;
      if (!uid || (w && w.active && (w.admin || isMarketing(w)))) return 0;
      let n = 0;
      for (const m of rows.photo_marketing.slice()) {
        if (m.claimed_by !== uid || !(m.state === "claimed" || (m.state === "withdrawn" && m.withdrawn_from === "claimed"))) continue;
        write("photo_marketing", m, { state: m.state === "claimed" ? "ready" : m.state, withdrawn_from: m.state === "withdrawn" ? "ready" : m.withdrawn_from,
          taken_from: m.claimed_by, claimed_by: null, claimed_at: null });
        n += 1;
      }
      return n;
    }

    const api = {
      hasFiles,
      /** the P3 part's DCR server marked a shoot done (or the schedule changed it): the ready check runs */
      statusChanged(sid, completer) { try { return readyCheck(sid, completer); } catch (e) { return "none"; } },
      /** someone was taken off marketing (set_photo_team), turned off or is no longer an admin (admin_set_profile) */
      rightsChanged(uid) { return releaseClaimsOf(uid); },
    };
    E.photoFiles = api;

    return {
      name: "p10-photo-files", tables: new Set(TABLES.concat([ITEMS])),
      // (photo_shoot_files has no read policy - the screens read it through photo_shoot_files_page; demo_photo_items is the
      // demo OneDrive's own)
      canRead(w, table) { return table !== "photo_shoot_files" && table !== ITEMS && canPhotoRead(w); },
      canInsert: () => false, canUpdate: () => false, canDelete: () => false,
      handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc,
      functions: ["photo-files"], invoke,
      __dev: {
        state(o) {
          if (o) {
            // (a mode changed stamps mode_at, as photo_files_set_mode does - unless the caller names it)
            if (o.mode !== undefined && o.mode !== dev.mode && !Object.prototype.hasOwnProperty.call(o, "mode_at")) dev.mode_at = nowIso();
            Object.assign(dev, o);
          }
          return { p5: dev.p5, root: dev.root, shares: Object.assign({}, dev.shares), advance: dev.advance, down: dev.down,
            mode: dev.mode, mode_at: dev.mode_at, phone: dev.phone, full: dev.full, hashLate: dev.hashLate };
        },
        log: () => ({ checks: dev.checks, drains: dev.drains }),
        readyCheck: (sid, completer) => readyCheck(sid, completer),
        status: (sid, uid) => statusJson(sid, uid),
        folder: (sid) => clone(liveFolder(sid)),
        /** every waiting file of a shoot arrives (as a check would see it), then the ready check */
        confirmAll(sid) {
          const f = liveFolder(sid);
          if (!f) return null;
          const seed = seedOf(f);
          Object.assign(seed, { confirmed: seed.confirmed + seed.waiting, waiting: 0, bytes_confirmed: seed.bytes, media_confirmed: seed.photos + seed.videos });
          recount(f, { late_at: null, checked_at: nowIso(), complete_check_at: nowIso() }, seed);
          return readyCheck(sid, null);
        },
        /** the shoot's file rows, its hand-ins and the items that landed in the demo's OneDrive (copies) */
        files: (sid) => { const f = liveFolder(sid); return f ? clone(filesOf(f.id)) : []; },
        uploads: (sid) => { const f = liveFolder(sid); return f ? clone(rows.photo_shoot_uploads.filter((u) => u.folder_id === f.id)) : []; },
        items: (sid) => { const f = liveFolder(sid); return f ? clone(rows[ITEMS].filter((x) => x.folder_id === f.id)) : []; },
        /** OneDrive has hashed every item that landed (dev.hashLate's wait over) -> how many */
        hashNow: () => rows[ITEMS].filter((x) => !x.qx && x.later_qx).map((x) => settle(x)).length,
        /** a session's address runs out now (tools/fake/p7-onedrive.js) */
        expire: (url) => !!(E.onedriveUpload && E.onedriveUpload.expire(url)),
        deviceId,
        rules: NS.p10FilesRules,
      },
    };
  });

  /* ── made-up data: the demo plans' shoots in every Files state, and the Ready for marketing list ── */
  (NS.extSeed = NS.extSeed || []).push(function seedFiles(out, h) {
    const P = h.P;
    if (!P || !P.field || !P.viewer || !P.admin || !Array.isArray(out.photo_shoots)) return;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const ago = (min) => new Date(now.getTime() - min * 60000).toISOString();
    const audit = (when) => ({ created_at: when, created_by: null, updated_at: when, updated_by: null, version: 1 });
    out.photo_drive_folders = [];
    out.photo_shoot_uploads = [];
    out.photo_marketing = [];
    out.photo_shoot_files = [];
    out.demo_photo_items = [];
    const byKey = (code, key) => {
      const plan = (out.photo_plans || []).find((p) => p.project_code === code);
      return plan ? out.photo_shoots.find((s) => s.plan_id === plan.id && s.key === key) || null : null;
    };
    const TAG = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let fid = 0, uid = 0, mid = 0;
    const PC = { label: "PHOTO-PC", id: 3 };
    /** one shoot folder with its counts; o.up: one sealed hand-in (o.open: a copy still open) */
    function folder(s, o) {
      if (!s) return null;
      fid += 1;
      const tag = "K7" + TAG[fid % TAG.length] + TAG[(fid * 7) % TAG.length] + "M" + (2 + (fid % 7));
      const name = s.planned_date + " " + s.name + " [DCR-" + tag + "]";
      const n = o.n || 0;
      const size = o.size || n * 4400000;
      const f = Object.assign({}, COLS.photo_drive_folders, { id: fid, shoot_id: s.id, plan_id: s.plan_id, tag, name, drive_name: name,
        drive_state: "found", drive_link: LINK("1FAKEshoot" + String(fid).padStart(13, "0")),
        made_at: ago(60 * 26), drive_state_at: ago(60 * 26), drive_created_at: ago(60 * 26), maker_pc: PC.label, maker_pc_id: PC.id, maker_at: ago(60 * 26),
        counted: n, confirmed: n, photos: Math.round(n * 0.92), videos: n - Math.round(n * 0.92), bytes: size, bytes_confirmed: size,
        media_confirmed: n, checked_at: ago(12), complete_check_at: ago(12), next_check_at: new Date(now.getTime() + 30 * 60000).toISOString(),
        files_rev: 3 }, o.f || {}, audit(ago(60 * 26)));
      out.photo_drive_folders.push(f);
      if (o.up !== false && n) {
        uid += 1;
        out.photo_shoot_uploads.push(Object.assign({}, COLS.photo_shoot_uploads, { id: uid, folder_id: f.id, shoot_id: s.id, state: "sealed",
          pc_label: PC.label, pc_id: PC.id, started_by: P.field, sealed_by: P.field, files: n, bytes: size, recorded_files: n,
          started_at: ago(60 * 25), sealed_at: ago(60 * 24), beat_at: ago(60 * 24) }, o.upF || {}, audit(ago(60 * 25))));
      }
      if (o.open) {
        uid += 1;
        out.photo_shoot_uploads.push(Object.assign({}, COLS.photo_shoot_uploads, { id: uid, folder_id: f.id, shoot_id: s.id, state: "open",
          pc_label: PC.label, pc_id: PC.id, started_by: P.field, recorded_files: 0, started_at: ago(30), beat_at: ago(0.2) }, o.open, audit(ago(30))));
      }
      return f;
    }
    function listed(s, f, o) {
      if (!s || !f) return null;
      const plan = (out.photo_plans || []).find((p) => p.id === s.plan_id) || {};
      mid += 1;
      const m = Object.assign({}, COLS.photo_marketing, { id: mid, folder_id: f.id, shoot_id: s.id, plan_id: s.plan_id, shoot_key: s.key,
        job_label: plan.project_label || "", city: plan.city || "", shoot_name: s.name, shoot_day: s.planned_date, photographer_name: plan.photographer_name || "",
        handed_in_by: P.field, folder_link: f.drive_link, files_at_ready: { photos: f.photos, videos: f.videos, other: f.others, bytes: f.bytes },
        ready_at: ago(60 * 20), completed_by: P.field, told: [{ name: "Taylor", email: "sent", push: "phone", profile_id: P.viewer }] }, o, audit(ago(60 * 20)));
      out.photo_marketing.push(m);
      return m;
    }
    // A000T9 Sample house
    const walk = byKey("A000T9", "site-walk");                                   // done, ready for marketing
    listed(walk, folder(walk, { n: 86 }), { state: "ready", ready_at: ago(60 * 5) });
    const permit = byKey("A000T9", "permit-board");                              // a copy running on the photographer's PC
    folder(permit, { n: 0, up: false, f: { counted: 0, confirmed: 0, photos: 0, videos: 0, bytes: 0, bytes_confirmed: 0, media_confirmed: 0 },
      open: { recorded_files: 41 } });
    const lot = byKey("A000T9", "lot-before");                                   // uploading
    folder(lot, { n: 300, f: { confirmed: 262, waiting: 38, bytes: 11811160064, bytes_confirmed: 9663676416, media_confirmed: 262, last_progress_at: ago(6) } });
    const delivery = byKey("A000T9", "delivery");                               // no progress for 2 hours
    folder(delivery, { n: 120, f: { confirmed: 80, waiting: 40, bytes_confirmed: 352000000, media_confirmed: 80, late_at: ago(30), last_progress_at: ago(60 * 3),
      help: ["late"] } });
    const before = byKey("A000T9", "before-framing");                            // files need a look
    folder(before, { n: 64, f: { confirmed: 58, mismatch: 2, missing: 4, trashed_count: 3, media_confirmed: 58, help: ["problem"] } });
    const p1 = byKey("A000T9", "progress-1");                                    // every file in OneDrive, not done yet
    folder(p1, { n: 52, f: { drive_only: 0 } });
    const p2 = byKey("A000T9", "progress-2");                                    // a copy that stopped
    folder(p2, { n: 0, up: false, f: { counted: 0, confirmed: 0, photos: 0, videos: 0, bytes: 0, bytes_confirmed: 0, media_confirmed: 0, help: ["stopped"] },
      open: { state: "abandoned", recorded_files: 17, started_at: ago(60 * 30), beat_at: ago(60 * 29) } });
    const p3 = byKey("A000T9", "progress-3");                                    // checks stopped after 14 days
    const f3 = folder(p3, { n: 40, f: { confirmed: 31, waiting: 9, media_confirmed: 31, stalled_at: ago(60 * 2), help: ["stalled"] },
      upF: { started_at: ago(60 * 24 * 16), sealed_at: ago(60 * 24 * 15), beat_at: ago(60 * 24 * 15) } });
    // (its 9 files never sent are rows of that hand-in, sealed 15 days ago: app.photo_row_stalled holds for them, so the
    // status's uploads[].stalled and the stalled line count them - OD §25; review round 7)
    if (f3) {
      for (let i = 1; i <= 9; i++) {
        const path = "IMG_" + (3300 + i) + ".JPG";
        out.photo_shoot_files.push(Object.assign({}, COLS.photo_shoot_files, { id: out.photo_shoot_files.length + 1, folder_id: f3.id, last_upload_id: uid,
          counted: true, source: "pc", path, path_key: path.toLowerCase(), kind: "photo", size: 4400000,
          md5: "FAKEqx" + String(3300 + i).padStart(21, "0") + "=", recorded_at: ago(60 * 24 * 16), state: "waiting", upload_step: "to_send" },
          audit(ago(60 * 24 * 16))));
      }
    }
    const fcA = byKey("A000T9", "framing-complete");                             // in OneDrive's recycle bin
    folder(fcA, { n: 30, f: { drive_state: "trashed", help: ["folder_gone"] } });
    const hcA = byKey("A000T9", "house-complete");                               // moved out of DCR Photo & Video
    folder(hcA, { n: 25, f: { drive_state: "missing", last_code: "moved_out" } });
    const drone = byKey("A000T9", "drone-check");                                // every file in OneDrive
    folder(drone, { n: 12 });
    // A000T8 Made-up garage
    const dB = byKey("A000T8", "delivery");                                      // claimed by the admin
    listed(dB, folder(dB, { n: 140, f: { drive_only: 0 } }), { state: "claimed", claimed_by: P.admin, claimed_at: ago(60 * 3), ready_at: ago(60 * 26) });
    // posted by marketing, who culled 6 of its files in OneDrive first: marketing's culls, a calm line (PF §42)
    const pB1 = byKey("A000T8", "progress-1");
    listed(pB1, folder(pB1, { n: 60, f: { confirmed: 54, missing: 6, culled: 6, media_confirmed: 54 } }), { state: "posted",
      ready_at: ago(60 * 24 * 4), claimed_by: P.viewer, claimed_at: ago(60 * 24 * 3),
      posted_by: P.viewer, posted_at: ago(60 * 24 * 2), posted_where: ["instagram", "website"], posted_link: "https://www.example.com/posts/garage-progress",
      posted_note: "Carousel of the wall framing", files_missing: 6 });
    const pB2 = byKey("A000T8", "progress-2");                                   // skipped, but its files are in OneDrive
    folder(pB2, { n: 33, f: { help: ["closed_files"] } });
    const fcB = byKey("A000T8", "framing-complete");                             // moved out of DCR Photo & Video
    folder(fcB, { n: 18, f: { drive_state: "missing", last_code: "moved_out" } });
    const hcB = byKey("A000T8", "house-complete");                               // files added in OneDrive without DCR
    folder(hcB, { n: 44, f: { drive_only: 3, owner_ok: true } });
    // A000T7 Old sample deck (archived): passed weeks ago (the Done tab, no way back)
    const hcC = byKey("A000T7", "house-complete");
    listed(hcC, folder(hcC, { n: 22 }), { state: "passed", ready_at: ago(60 * 24 * 30), passed_by: P.viewer, passed_at: ago(60 * 24 * 20),
      pass_reason: "Same angles as the last deck" });
    // the job folders (kind job, one per plan with shoot folders; §5.1): each shoot folder's parent_id, which the ready
    // rule's rule 3 reads (a folder not in OneDrive yet under a job folder that is gone, or of another account).
    // Made after the shoot folders, so their ids, tags and links stay as they were.
    const jobs = {};
    for (const f of out.photo_drive_folders.slice()) {
      if (f.kind !== "shoot") continue;
      if (!jobs[f.plan_id]) {
        const plan = (out.photo_plans || []).find((p) => p.id === f.plan_id) || {};
        fid += 1;
        const name = plan.project_label || "Sample job";
        jobs[f.plan_id] = Object.assign({}, COLS.photo_drive_folders, { id: fid, kind: "job", plan_id: f.plan_id, name, drive_name: name,
          drive_state: "found", drive_link: LINK("1FAKEjob" + String(fid).padStart(15, "0")), made_at: ago(60 * 24 * 40), drive_state_at: ago(60 * 24 * 40),
          drive_created_at: ago(60 * 24 * 40), maker_pc: PC.label, maker_pc_id: PC.id, maker_at: ago(60 * 24 * 40), owner_ok: true }, audit(ago(60 * 24 * 40)));
        out.photo_drive_folders.push(jobs[f.plan_id]);
      }
      f.parent_id = jobs[f.plan_id].id;
    }
    // each folder's seeded counts kept apart - its counts less its file rows' (progress-3's files never sent), so a recount
    // (a phone's hand-in into it) adds its rows to these, as app.photo_folder_recount counts them
    for (const f of out.photo_drive_folders) {
      const c = f.seed = {};
      for (const k of ["counted", "confirmed", "waiting", "mismatch", "missing", "removed", "bytes", "bytes_confirmed", "photos", "videos", "others", "media_confirmed"]) {
        c[k] = typeof f[k] === "number" ? f[k] : 0;
      }
      for (const r of out.photo_shoot_files) {
        if (r.folder_id !== f.id) continue;
        if (r.state === "removed") { c.removed--; continue; }
        if (!r.counted) continue;
        c.counted--;
        c.bytes -= r.size;
        if (r.kind === "video") c.videos--; else if (r.kind === "photo" || r.kind === "raw") c.photos--; else c.others--;
        if (r.state === "confirmed") { c.confirmed--; c.bytes_confirmed -= r.size; if (r.kind !== "other") c.media_confirmed--; }
        else if (c[r.state] !== undefined) c[r.state]--;
      }
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
