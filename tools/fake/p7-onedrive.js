/* DCR Portal 2 — DEMO MODE ONLY: the OneDrive broker (DCR Desktop 2 supabase/functions/onedrive, the Edge Function
   "onedrive"; its docs/ONEDRIVE.md §15 is the contract) and the owner's OneDrive behind it, in the in-memory database,
   for the project page's Files tab. Loaded BEFORE engine.js (tools/devserve.mjs FAKE_PARTS, tests/pages-engine.mjs);
   installed into each engine (NS.extInstall: functions ["onedrive"], invoke, http). Never published (tools/ is not
   part of the site); nothing here reaches Microsoft: fake-supabase.js answers the OneDrive host in fetch and
   XMLHttpRequest from http() below, and a download is this page's own blob: (Node: a placeholder link nobody opens).

   The broker as the contract has it (the real one: handler.ts, paths.ts, graph.ts and their tests; tools/
   schema-check-p7-onedrive.mjs runs Portal 2's modules against IT on the real migrations):
   * who: any active person lists and opens (42501 -> 403 forbidden for the agents account and a turned-off one); a
     deleted project's folder is never listed (404, an admin's too); can_upload = an admin, or a manager, accountant,
     lead or field person with profiles.can_upload_onedrive (app.can_upload_onedrive()); can_make_folder = projects
     editors or can_upload;
   * list {project_id, path?, cursor?} -> {folder_exists, path, entries [{id, name, folder, size, modified, children?}],
     next, can_upload, can_make_folder}: folders first, then by name; PAGE entries a page (the demo's is small so
     "Show more" is seen: 25), a sealed cursor bound to the person, project and folder (15 minutes);
   * hidden (as missing): lock, temporary and system names; without prices .takeoff / .pdfnotes, names about
     estimates, change orders, quotes, proposals, bids, contracts or money, names quoting an amount; without
     financials every name with a money stem (one about prices too) - at every depth; a stem counts after a digit
     too ("A253Estimate.pdf"); children (a folder's count) only with prices;
   * download {project_id, item_id} -> {url, name, size}; programs and shortcuts 403 not_downloadable;
   * upload_session {project_id, folder, rel_dir?, name, size, modified?} -> {upload_url (https://<host>/__demo/up/<n>),
     expires_at, chunk_bytes, chunk_multiple, max_chunk_bytes, max_bytes, ticket, name}: the switch (403), Documents or
     Floor Plans (never Documents/Items), the allowlist (415; .takeoff with prices), the name rules (400), 2 GiB (413);
     the project's folder made first when missing (409 other_folder beside another folder with the number), then the
     rel_dir folders; the upload URL answers PUT with Content-Range (multiples of 320 KiB but the last, below 60 MiB,
     202 + nextExpectedRanges, the last 201 + the new driveItem, renamed "name 1.ext" on a clash) and GET (how far);
     404 once finished;
   * upload_done {project_id, item_id, ticket} -> {recorded, already, renamed, name, size, file?, reason?, message?}:
     the ticket's person, project, folder, name (or OneDrive's rename), size, made by the app, after the ticket (409
     not_this_upload otherwise); then record_onedrive_file as the person (the engine's own files rules: RLS, the version
     chain, the activity line): storage local, source portal2, rel_path folder_name + path, folder plans | documents,
     subpath the folders between; the caller's own same-size live row answered again (already); recorded false + the
     reason for a priced / money / amount name, a path too deep, Documents/Items; a takeoff without prices 403;
   * ensure_folder {project_id} -> {made_project_folder, created, existed, blocked}; status {} (admins) -> ok;
   * plans_for {project_ids: 1 to 50 different positive whole numbers} (the plan buttons, owner 2026-10-26) -> {projects:
     {"<id>": {number, plans}}, checked_at}: every active person; each project the caller may read (a deleted one is
     left out, an admin's too) with the count of .takeoff files right in its folder(s) of the takeoff folder - never in a
     sub-folder (a Backup folder of older copies: the owner, 2026-10-27)
     ("Projects-Takeoff-Files": "<number> - <address> - <city>", DCR Desktop 2's folder_candidates - a suffix number's
     folder is its own; "Materials Catalog" is nobody's) - never a name, an item id or a link; 503
     takeoff_not_configured while the demo's takeoff folder is switched off (setTakeoff(false) in node; in a browser
     localStorage "dcr2-demo-takeoff" = "off");
   * plans_list {project_ids: 1 to 20} (the Plans Library, owner 2026-10-26) -> {projects: {"<id>": {number, files:
     [{id, name, folder, size, modified, version}]}}, checked_at}: the same .takeoff files plans_for counts; ONLY an
     admin or a person with prices (403 forbidden "Plan files are for the people who see prices." otherwise);
   * plan_link {project_id, item_id} -> {url, id, name, folder, size, modified, version}: one of them (404 otherwise, a
     project the person may not see too) and this tab's own download link (a blob:; node: a placeholder on the host)
     answering byte ranges; its bytes start "PDFCACHE1" as a takeoff file does (made up: the takeoff app cannot open
     it). setPlanVersion(path, version) gives one a new version (a node test's "new save in OneDrive"); addPlanFile(number,
     name) puts one more in a project's folder (the house model copied into two lots' folders: an e2e's).
   * plan_save_session {project_id, item_id, version, size, modified?, mode?, name?} (the iPad's save back, owner
     decisions Q1-Q3 of 2026-11-04; contract C1, addendum 2 C1b and addendum 3, as DCR Desktop 2's handler.ts has them
     since the repair round) -> {mode, commit?, upload_url, expires_at, chunk_bytes, chunk_multiple, max_chunk_bytes,
     max_bytes, ticket, name}: an admin, or prices AND the upload switch (403 forbidden naming the switch when only it is
     missing), the project visible (404); then the broker's switch ONEDRIVE_PLAN_SAVE (planSaveSwitch: off, "only:<DCR
     number>,...", "all"; the demo's is "all", as the broker's test world - setPlanSave(v) in node, localStorage
     "dcr2-demo-plan-save" in a browser) - not allowing the project: 503 save_back_off, before anything else; at most
     4096 MiB (413 too_large {max_bytes}); one of the project's plans - else, when `name` is the name of exactly ONE of
     them (the office's desktop app moved the item into Backups and wrote a new one: desktopSave), that one, and always a
     copy - (404); "replace" while the plan's version is still `version` (or `version` is "sm:<size>:<time>" naming
     its size and time), DEFERRED: commit "broker", the ticket keeps the plan's tag, a tag of the upload URL and the base
     as it is now (bs, bm, bv: its size, time and version), and its last chunk answers 202 and commits nothing (unless
     the demo's OneDrive ignores deferCommit: graphModes); else a COPY beside it "<stem> - iPad YYYY-MM-DD
     HHMM.takeoff" (company time; " (2)" ... " (9)" when taken; all taken: 503 busy, Retry-After 60), whose last chunk
     adds it to the folder. The upload URL answers as upload_session's does;
   * plans_list / plan_link carry `save_back` (per project / top level): the person passes plan_save_session's gate
     and the switch allows the project - no OneDrive question;
   * plan_save_commit {project_id, item_id, ticket, upload_url, hash?, landed?} -> plan_save_done's answer and, on a
     replace, `verified`: the ticket of a deferred replace (48 hours to commit, 30 days to settle) and its own upload
     URL; never the switch. `landed` (the last chunk answered the file: OneDrive did not honour deferCommit) - nothing is
     committed, only checked. Else the plan still with the session's tag: attempt A, Example 7's PUT (If-Match the
     plan's tag as the walk read it; refused - graphModes putCommit "refused" - attempt B: the plan walked afresh, then the
     zero-length POST to the upload URL; both refused: the session dropped, 409 plan_changed {retry: "copy", why:
     "refused"}); the tag moved (an office save during the upload) or the plan left its folder: the SAME upload
     committed as the copy beside it (the copy name of the session's minute) - or, refuseCopyCommits(true) in a node
     test, 409 plan_changed {retry: "copy", why: "changed"} with the session dropped; the session gone (committed earlier,
     the answer lost): plan_save_done's checks. Every replace committed is then checked by the plan's version history
     (handler.ts verify, as DCR Desktop 2 has it since its repair round 2): this save the newest and the base right under
     it - verified true; the newest version the base itself, byte for byte this save (an identical re-save found landed
     without its commit) - verified true, nothing put back; any other version under it (the commit crossed an office
     save: one between the walk and the commit with the If-Match ignored - the PUT's, or the POST's - or at the last
     chunk of a session OneDrive committed itself) - put back (restoreVersion) only on the hash's proof (the device's
     hash and OneDrive's: until the demo's OneDrive has hashed the bytes, 503 busy - asked again - for 30 minutes after
     the plan's change; then nothing restored and 409 plan_changed {why: "unproved"} with the admin's log line, contract
     addendum 4 E1), then 409 plan_changed {why: "changed"}; a restore Microsoft refuses - 503 (busy, or
     onedrive_not_authorized for 401 / 403), asked again; no history to read - verified false; the listing in a moment's
     trouble (429, a 5xx but 501) - 503 busy. The check's own 503s (OneDrive's hash not there yet, a restore not done)
     carry why "checking" (DCR Desktop 2's repair round 3: checkWait), the listing's moment of trouble none. Yet another
     save on top by the time the check reads the history (the newest not this save): nothing put back, and the plain
     plan_changed {why: "changed"} only when the listing shows this save right on the base - shown over anything else, or
     not shown at all, "unproved" with the admin's line (shownUnder, THE PRINCIPLE over CONTRACT-3 D2's "the same 409");
     this save committed and the plan something else with no history to read - "unproved" too. No `hash`: 409 not_saved
     {need: "hash"} at any age, before anything of OneDrive's (E1). The plan's tag moved, or Microsoft's If-Match answered
     412 (read afresh: another request of the device's may have committed this very session a moment ago - repair round
     3), but the plan holds this save already (a commit that landed, asked again after the check's 503; E3): checked as a
     commit, never the same upload as a copy - by OneDrive's hash, else waited for as above; the plan provably not this
     save, the listing is read before the copy (overOffice: this save over an office save under a newer one - "unproved",
     never the copy). The 48 hours past, nothing is committed, and a replace found landed is checked too. The demo's OneDrive keeps
     each plan's versions (this tab), and graphModes({deferCommit, putCommit, putIfMatch, postIfMatch, postStatus,
     versions, versionsStatus, restoreStatus, hashes, afterCommit}) chooses what Microsoft does where its pages leave it
     open, as DCR Desktop 2's fake_graph.ts does; betweenWalkAndCommit(path) puts an office save between the walk a
     commit reads and that commit (attempt A's walk and its PUT; the PUT refused, attempt B's walk and its POST) -
     betweenWalkAndCommit(path, "self"): this very session's commit by another request of the device's, its retry while
     the first still ran (repair round 3, N6);
     passTime(ms) runs the broker's clock ahead (OneDrive's 30 minutes without a hash gone by); logLines() is the
     broker's log of the save back. (The demo's answers carry no Retry-After header: a 503 is asked again after the
     uploader's own wait.);
   * plan_save_done {project_id, item_id, ticket, hash?} -> {saved: true, mode, id, name, size, modified, version,
     verified?}: the ticket's person, project (30 days), plan (a replace) or copy (its folder and name); then the
     device's hash against OneDrive's when both are there (alone), else the size and - a replace - another version than
     the device's, changed since the ticket; a deferred replace's ticket with a hash also finds the copy its commit made;
     else 409 not_saved ({need: "hash"} for a deferred replace's ticket without a hash, at any age: contract addendum 4
     E1). A DEFERRED replace found landed as the plan (a later page settling a send whose commit it never heard) is found
     so only on OneDrive's hash of it (by its size alone: 503 busy for 30 minutes, then 409 not_saved {why: "unproved"})
     and is checked by the version history as a commit is (verify, its answer with `verified`; a crossing it put back is
     409 not_saved here, an unprovable one not_saved {why: "unproved"}, and verify's 503s pass through: DCR Desktop 2's
     repair round 2, S1, and 7fdd689); one not found as the plan has its history read before the not_saved (overOffice:
     this save over an office save under a newer one - not_saved {why: "unproved"}, DCR Desktop 2 9969d61). The version in
     plans_list's form: the "sm:" one until the demo's OneDrive has hashed the saved bytes - with site/js/quickxor.js,
     the device's own module: the REAL quickXorHash (hashed() waits for it) - then "qx:<it>".
   The takeoff folder (made up, the same every time): A267 three .takeoff files in its folder (and an autosave, a PDF
   and plan notes, never counted) and two older ones in Backup/ and Backup/Old/ (never counted); A024 one and A024-B
   two (apart; a third in Backup/); A120 one in its folder and one in an older second folder; the other A### numbers by
   their last digit: ending in 0 or 5 one (and one in Backup/), in 2 or 7 one (and one in Backup/), in 3 or 8 a folder
   with PDFs, an autosave and a Backup/ copy only (0); the rest no folder.
   The drive: /Projects with a made-up folder for most projects (folder_name), seeded the same way every time and
   built when first asked (Floor Plans with sheets, a level, a takeoff and plan notes; Photos/<a day>; Documents with
   permits, a contract, an estimate quoting an amount, invoices, a program, a lock file; the old portal's copy);
   A304 has only a folder of another name (other_folder), A305 and the test project A000T2 (added here for the
   admin's self-test) none yet. What people add (uploads, folders made) is a row of demo_onedrive_items - a demo-only
   table nobody reads (no policy), so it is kept with the demo's changes and reaches the other tabs - and its bytes
   stay in this tab's memory. So is a plan saved back from a device (a row with `takeoff`, its path in the takeoff
   folder, and its `version`): the next page's plans_list still knows its size, time and version, and a copy beside
   the plan. Made-up names only. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const HOST = "netorgft10120038-my.sharepoint.com";
  const APP = "demo-app-dcr-portal-onedrive";               // createdBy.application.id of what "the app" made (made up)
  const PROJECTS = "01DEMOPROJECTS000";
  const TABLE = "demo_onedrive_items";
  const PAGE = 25;
  const UNIT = 327680, MAX_CHUNK = 191 * UNIT, CHUNK = 32 * UNIT, MAX_BYTES = 2048 * 1024 * 1024;
  const TICKET_MS = 48 * 3600 * 1000, CURSOR_MS = 15 * 60 * 1000, SKEW_MS = 5 * 60 * 1000;
  const NO_FOLDER = ["A305", "A000T2"];
  const STRAY = { A304: "A304 - Old name of the job" };
  const TEST_PROJECT = { number: "A000T2", name: "Test project two", address: "2 Test Way", city: "Sandbox" };
  NS.ONEDRIVE_DEMO_HOST = HOST;

  (NS.extTables = NS.extTables || []).push({
    tables: [TABLE],
    cols: { [TABLE]: { id: null, item_id: null, project_id: null, parent_id: null, name: null, folder: false, size: null, mime: null,
      created_at: null, modified_at: null, by_app: false, takeoff: null, version: null } },
    pk: {}, uuid: [], noAudit: [TABLE], fks: [],
  });

  /* ── the broker's name rules (paths.ts), as far as the demo needs them ─────────────────────────────────── */
  const ERR = {
    invalid: [400, "That request is not valid."], unauthorized: [401, "Sign in first."], forbidden: [403, "You don't have permission to do that."],
    not_downloadable: [403, "Programs and shortcuts are not opened from the portal."], not_found: [404, "That file or folder was not found."],
    other_folder: [409, "OneDrive's Projects folder already has another folder for this project's number, so a second one is not made. An admin picks or renames the folder in DCR Desktop 2 (the project's Files tab) first."],
    not_a_folder: [409, "Something that is not a folder is in the way in OneDrive. Rename it there first."],
    not_this_upload: [409, "That file is not the one this upload made."], too_large: [413, "That file is too large to upload here."],
    file_type: [415, "That kind of file cannot be uploaded here (PDFs, pictures, videos, Office files, text and CAD files can)."],
    takeoff_not_configured: [503, "The takeoff folder is not set up yet."],
    not_saved: [409, "OneDrive did not get the whole file - send it again."],
    plan_changed: [409, "OneDrive's plan changed while the save was sent: it is sent again as a separate file."],
    busy: [503, "OneDrive is busy just now: try again in a minute."],
    save_back_off: [503, "Saving plans back to OneDrive is not on yet - your save waits on this device."],
  };
  /** handler.ts PLAN_REFUSED, NEED_HASH and PLAN_UNPROVED (contract addendum 3 D5, D4; addendum 4 E1) */
  const PLAN_REFUSED = "OneDrive would not replace the plan: the save is sent again as a separate file.";
  const NEED_HASH = "This save can be checked now only with the file's hash - send it again with the hash.";
  const PLAN_UNPROVED = "OneDrive could not show whether this save went over an office save: it is sent again as a separate file - check the plan's version history in OneDrive.";
  /** handler.ts planSaveSwitch (contract addendum 3 D1; DCR Desktop 2 f1376ea): the setting ONEDRIVE_PLAN_SAVE - unset,
      empty or "off": off; "only:<DCR number>[,...]" (any case; spaces around the words, the colon and each comma
      ignored; 1 to 20 numbers, each letters, digits and dashes with a digit): those projects; "all": every project;
      anything else off and not understood - a space INSIDE a part too ("only:A000T1 A000T2", "a ll"): never two
      numbers merged into one. */
  function planSaveSwitch(raw) {
    const off = (understood) => ({ on: "off", numbers: new Set(), understood });
    const v = String(raw == null ? "" : raw).trim();
    if (v === "" || v.toLowerCase() === "off") return off(true);
    if (v.toLowerCase() === "all") return { on: "all", numbers: new Set(), understood: true };
    const m = /^only\s*:([\s\S]*)$/i.exec(v);
    const parts = m ? m[1].split(",").map((x) => x.trim()).filter((x) => x !== "") : [];
    if (!parts.length || parts.length > 20 || !parts.every((x) => /^(?=[^0-9]*[0-9])[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(x))) return off(false);
    return { on: "only", numbers: new Set(parts.map((x) => nfc(x.trim()).toLowerCase())), understood: true };
  }
  NS.onedrivePlanSaveSwitch = planSaveSwitch;
  /** the demo's own setting: the broker's test world's (DCR Desktop 2 test_world.ts SETTINGS_OK) */
  const DEMO_PLAN_SAVE = "all";
  const NOT_RECORDED = {
    priced_name: "Saved in OneDrive. Its folder or name is about prices or money, so it is not added to the project's file list (people who see prices find it in OneDrive).",
    amount_name: "Saved in OneDrive. Its name quotes an amount, so it is not added to the project's file list.",
    path_shape: "Saved in OneDrive. It is in too many folders, or folders with names too long, for the project's file list.",
    item_folder: "Saved in OneDrive, in an estimate item's folder, so it is not added to the project's file list (add item files in DCR Desktop 2).",
  };
  const UPLOAD_EXTS = ["pdf", "jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "tif", "tiff", "mp4", "mov", "m4v", "doc", "docx",
    "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "dwg", "dxf", "takeoff"];
  const BLOCKED = ["exe", "bat", "cmd", "ps1", "lnk", "url", "scf", "hta", "js", "vbs", "msi", "library-ms", "com", "scr", "pif", "jse",
    "vbe", "wsf", "wsh", "reg", "cpl", "msp"];
  const MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", txt: "text/plain",
    csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", mov: "video/quicktime", mp4: "video/mp4",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", dwg: "image/vnd.dwg", takeoff: "application/octet-stream" };
  const folded = (s) => String(s == null ? "" : s).normalize("NFKC").toLowerCase();
  const nfc = (s) => String(s == null ? "" : s).normalize("NFC");
  const same = (a, b) => nfc(a).toLowerCase() === nfc(b).toLowerCase();
  /** A copy's name as the real broker makes it (DCR Desktop 2 handler.ts copyName + copySession's room; contract C1,
      the owner's Q3): "<stem> - iPad YYYY-MM-DD HHMM[ (n)].takeoff" - the stem NFC, cut by characters so the name fits
      200 and "<project folder>/<name>" fits 326, its trailing spaces and dots always dropped, "Plan" when nothing is
      left, the extension always lower case; null when the folder's name leaves no room. takeoff-web finds the draft of
      a copy it did not see made by this very rule (its save-route.js portalCopyKind / COPY_ROOM_MIN = 326 - 255 - 1):
      tests/p8-plan-save.test.mjs holds this to the broker's own when its checkout is here. */
  const MAX_NEW_FILE_NAME = 200, MAX_TAKEOFF_PATH = 326;
  function copyName(planName, stamp, n, folder) {
    const room = Math.min(MAX_NEW_FILE_NAME, MAX_TAKEOFF_PATH - Array.from(String(folder == null ? "" : folder)).length - 1);
    const stem = nfc(planName).replace(/\.takeoff$/i, "");
    const tail = " - iPad " + stamp + (n > 1 ? " (" + n + ")" : "") + ".takeoff";
    const fits = Math.min(room, MAX_NEW_FILE_NAME) - Array.from(tail).length;
    if (fits < 1) return null;
    const cut = Array.from(stem).slice(0, fits).join("").replace(/[\s.]+$/u, "");
    return (cut || "Plan") + tail;
  }
  NS.onedriveCopyName = copyName;
  const extOf = (n) => { const s = folded(n); const i = s.lastIndexOf("."); return i <= 0 || i === s.length - 1 ? "" : s.slice(i + 1); };
  function segmentProblem(seg, max) {
    if (typeof seg !== "string" || !seg) return "an empty name";
    if (Array.from(seg).length > (max || 255)) return "a name longer than " + (max || 255) + " characters";
    if (/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(seg)) return "a character that cannot be in a file name";
    if (seg === "." || seg === "..") return "a name that means another folder";
    if (/^ /.test(seg)) return "a name that starts with a space";
    if (/[ .]$/.test(seg)) return "a name that ends with a space or a dot";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9]) *(\..*)?$/i.test(seg)) return "a name Windows keeps for itself";
    return null;
  }
  function alwaysHidden(n) {
    const k = folded(n);
    return ["thumbs.db", "desktop.ini", ".ds_store", "ehthumbs.db", "ehthumbs_vista.db"].includes(k) || k.startsWith("~$") ||
      (k.startsWith(".~lock.") && k.endsWith("#")) || /\.(tmp|part)$/.test(k) || k.startsWith(".") || k.includes("_vti_");
  }
  // the stems where a word starts (after anything but a letter: a digit too); both groups read apart (paths.ts stems)
  function stems(n) {
    const k = folded(n);
    return { priced: /(^|[^a-z])(estimat|change[ _-]*order|quote|quotation|proposal|bid|contract|subcontract)/.test(k),
             money: /(^|[^a-z])(invoice|receipt|bill|payment|purchase[ _-]*order|money[ _-]*record|old[ _-]*portal[ _-]*record)/.test(k) };
  }
  const anyStem = (n) => { const s = stems(n); return s.priced || s.money; };
  const quotesAmount = (n) => /(?:US)?\$\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd|bucks)\b|\b(?:usd|dollars)\s?\d/i.test(folded(n));
  const isTakeoff = (n) => /\.(takeoff|pdfnotes)$/.test(folded(n));
  function hidden(n, v) {
    if (alwaysHidden(n)) return true;
    if (!v.prices && (anyStem(n) || quotesAmount(n) || isTakeoff(n))) return true;
    return !v.financials && stems(n).money;
  }
  function renamedFrom(actual, requested) {
    const a = nfc(actual).toLowerCase(), r = nfc(requested).toLowerCase();
    if (a === r) return true;
    const dot = r.lastIndexOf(".");
    const base = dot > 0 ? r.slice(0, dot) : r, ext = dot > 0 ? r.slice(dot) : "";
    return a.startsWith(base + " ") && a.endsWith(ext) && /^[1-9][0-9]{0,3}$/.test(a.slice(base.length + 1, a.length - ext.length));
  }
  // DCR Desktop 2's folder_candidates: "<number>", "<number> ...", "<number>-..." - never a suffix number's
  function candidates(names, number) {
    const want = String(number || "").toLowerCase();
    return names.filter((n) => {
      const low = String(n).toLowerCase();
      if (!(low === want || low.startsWith(want + " ") || low.startsWith(want + "-"))) return false;
      const lead = /^([A-Za-z][0-9]{3,}(?:-[A-Za-z]{1,2}|[Tt][0-9])?)(?=$|[\s\-_.,])/.exec(String(n));
      return !(lead && lead[1].toLowerCase() !== want);
    });
  }

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, COLS: ECOLS, clone, nowIso, who, canEdit, nextId, commitInsert, commitUpdate } = E;
    if (!rows[TABLE]) return null;
    if (ECOLS.profiles && !("can_upload_onedrive" in ECOLS.profiles)) ECOLS.profiles.can_upload_onedrive = false;
    const secret = "demo-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const sessions = new Map();          // token -> the upload session (this tab)
    const bytes = new Map();             // item id -> Blob (this tab)
    const links = new Map();             // a download link -> {id, name} or {plan} (a takeoff file) (this tab)
    let sessionN = 0, linkN = 0;
    const browser = typeof root.document !== "undefined" && root.URL && typeof root.URL.createObjectURL === "function";
    // the broker's clock: the demo's, or `ahead` ms ahead of it (passTime: OneDrive's 30 minutes without a hash, in a
    // walk that cannot wait them)
    let ahead = 0;
    const nowMs = () => Date.parse(nowIso()) + ahead;

    /* sealed tickets and cursors: the demo's stand-in for ticket.ts (tamper-evident, bound, short-lived) */
    function seal(kind, obj, exp) {
      const body = JSON.stringify(Object.assign({ k: kind, x: exp }, obj));
      const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(body))) : Buffer.from(body).toString("base64");
      return "demo." + b64.replace(/=+$/, "") + "." + (NS.md5 ? NS.md5(secret + body) : String(body.length));
    }
    function unseal(kind, text) {
      const m = /^demo\.([A-Za-z0-9+/]+)\.([0-9a-f]+|\d+)$/.exec(String(text || ""));
      if (!m) return null;
      let body;
      try { body = typeof atob === "function" ? decodeURIComponent(escape(atob(m[1]))) : Buffer.from(m[1], "base64").toString(); } catch (e) { return null; }
      if ((NS.md5 ? NS.md5(secret + body) : String(body.length)) !== m[2]) return null;
      let o;
      try { o = JSON.parse(body); } catch (e) { return null; }
      return o && o.k === kind && o.x > nowMs() ? o : null;
    }

    /* ── the drive: made-up folders, built when first asked, plus what people added ── */
    const gidOf = (pid, n) => "01DEMO" + Number(pid).toString(36).toUpperCase().padStart(5, "0") + "G" + String(n).padStart(4, "0");
    const hasSeeded = (p) => !!p && !!p.number && !!p.folder_name && !NO_FOLDER.includes(p.number) && !STRAY[p.number] &&
      (p.legacy_sp_id !== null && p.legacy_sp_id !== undefined || /^A30[0-3]$/.test(p.number));
    const built = new Map();             // project id -> its seeded items
    function dayOf(daysAgo) { return new Date(nowMs() - daysAgo * 86400000).toISOString().slice(0, 10); }
    function seeded(p) {
      if (built.has(p.id)) return built.get(p.id);
      const out = [];
      const at = (d) => new Date(Date.parse(p.created_at || nowIso()) + d * 86400000).toISOString();
      const add = (n, parent, name, folder, size, days) => {
        if (n === 0) { const top = topOf(p); out.push(top); return top; }
        const it = { id: gidOf(p.id, n), parent: parent === null ? PROJECTS : gidOf(p.id, parent), name, folder: !!folder,
          size: folder ? null : size, mime: folder ? null : MIME[extOf(name)] || "application/octet-stream", created: at(days || 1), modified: at(days || 1), app: false, pid: p.id };
        out.push(it);
        return it;
      };
      add(0, null, p.folder_name, true);
      add(1, 0, "Floor Plans", true);
      add(2, 1, "A1 - Floor plan.pdf", false, p.number === "A267" ? 2500000 : 2400000, 3);
      add(3, 1, "S1 - Foundation plan.pdf", false, 1850000, 3);
      add(4, 1, "Level 1", true, 0, 4);
      add(5, 4, "L1 framing plan.pdf", false, 1320000, 4);
      add(6, 1, p.number + " Bid.takeoff", false, 88000, 5);
      add(7, 1, "Plan notes.pdfnotes", false, 4200, 5);
      add(8, 0, "Photos", true);
      add(9, 8, dayOf(6), true);
      const shots = p.number === "A267" ? 40 : 3;
      for (let i = 1; i <= shots; i++) add(10 + i, 9, "IMG_" + String(i).padStart(4, "0") + ".jpg", false, 2100000 + i * 3700, 6);
      add(60, 0, "Documents", true);
      add(61, 60, "Permit application.pdf", false, 640000, 2);
      add(62, 60, "Soils report.pdf", false, 2200000, 2);
      add(63, 60, "Site notes.txt", false, 2100, 6);
      add(64, 60, "Permits", true, 0, 7);
      add(65, 64, "Building permit.pdf", false, 410000, 8);
      add(66, 60, "Estimate $12,400.pdf", false, 180000, 9);
      add(67, 60, "Invoices", true, 0, 9);
      add(68, 67, "Invoice 1043.pdf", false, 92000, 10);
      add(69, 60, "Installer.exe", false, 4800000, 10);
      add(70, 60, "~$Permit application.docx", false, 162, 11);
      add(71, 60, "desktop.ini", false, 120, 11);
      add(72, 0, "Contract signed.pdf", false, 300000, 2);
      add(80, 0, "Old portal documents", true);
      add(81, 80, "Scope of work.pdf", false, 210000);
      add(82, 80, "Proposal.pdf", false, 260000);
      built.set(p.id, out);
      return out;
    }
    /** a seeded project's own folder in Projects (without building what is inside it) */
    function topOf(p) {
      return { id: gidOf(p.id, 0), parent: PROJECTS, name: p.folder_name, folder: true, size: null, mime: null, created: p.created_at,
        modified: p.created_at, app: false, pid: p.id };
    }
    function stray() {
      return rows.projects.filter((p) => STRAY[p.number]).map((p) => ({ id: gidOf(p.id, 9999), parent: PROJECTS, name: STRAY[p.number],
        folder: true, size: null, mime: null, created: p.created_at, modified: p.created_at, app: false, pid: p.id }));
    }
    function stored() {
      // (a plan saved back is the takeoff folder's, never one of the Projects folder's items)
      return rows[TABLE].filter((r) => !r.takeoff).map((r) => ({ id: r.item_id, parent: r.parent_id, name: r.name, folder: !!r.folder, size: r.size, mime: r.mime,
        created: r.created_at, modified: r.modified_at, app: !!r.by_app, pid: r.project_id }));
    }
    function itemsOf(pid) {
      const p = rows.projects.find((x) => x.id === Number(pid));
      return (hasSeeded(p) ? seeded(p) : []).concat(stored().filter((x) => x.pid === Number(pid)));
    }
    function itemById(id) {
      const s = stored().find((x) => x.id === id);
      if (s) return s;
      const m = /^01DEMO([0-9A-Z]{5})G(\d{4})$/.exec(String(id));
      if (!m) return null;
      const pid = parseInt(m[1], 36);
      if (m[2] === "9999") return stray().find((x) => x.id === id) || null;
      return itemsOf(pid).find((x) => x.id === id) || null;
    }
    function kids(parentId, pid) {
      if (parentId === PROJECTS) {
        const top = rows.projects.filter(hasSeeded).map(topOf);
        return top.concat(stray(), stored().filter((x) => x.parent === PROJECTS));
      }
      return itemsOf(pid).filter((x) => x.parent === parentId);
    }
    const sorted = (list) => list.slice().sort((a, b) => Number(b.folder) - Number(a.folder) ||
      a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }));
    function projectFolder(p) {
      return kids(PROJECTS, p.id).find((x) => x.folder && x.pid === p.id && same(x.name, p.folder_name)) || null;
    }
    function lookup(pf, segs) {
      let at = pf;
      for (const s of segs) {
        at = kids(at.id, pf.pid).find((x) => same(x.name, s)) || null;
        if (!at) return null;
      }
      return at;
    }
    /** the names below the project's folder (proved by walking the parents) */
    function namesOf(item, pf) {
      const names = [];
      let at = item;
      for (let i = 0; at && i < 40; i++) {
        if (at.id === pf.id) return names;
        names.unshift(at.name);
        at = itemById(at.parent);
      }
      return null;
    }
    function keep(it) {
      const r = { id: nextId(TABLE), item_id: it.id, project_id: it.pid, parent_id: it.parent, name: it.name, folder: it.folder,
        size: it.folder ? null : it.size, mime: it.mime, created_at: it.created, modified_at: it.modified, by_app: !!it.app };
      commitInsert(TABLE, r);
      return it;
    }
    let made = 0;
    function newFolder(parent, name, pid) {
      return keep({ id: "01DEMOU" + String(Date.now() % 1e9).padStart(9, "0") + "F" + (++made), parent, name: nfc(name), folder: true,
        size: null, mime: null, created: nowIso(), modified: nowIso(), app: true, pid });
    }

    /* ── the takeoff folder (plans_for): a folder per project, files as paths below it - only counted, never sent ── */
    let takeoffSet = null;               // a node test's switch (setTakeoff); else the browser demo's localStorage one
    function takeoffOn() {
      if (takeoffSet !== null) return takeoffSet;
      if (!browser) return true;
      try { return root.localStorage.getItem("dcr2-demo-takeoff") !== "off"; } catch (e) { return true; }
    }
    let takeoffTree = null;
    function takeoffFolders() {
      if (takeoffTree) return takeoffTree;
      const out = [{ name: "Materials Catalog", files: ["Lumber catalog.takeoff", "Catalog.pdf"] }];
      for (const p of rows.projects) {
        const n = String(p.number || ""), at = n + " - " + p.address + " - " + p.city;
        const m = /^A(\d{3})$/.exec(n), last = m ? Number(m[1]) % 5 : -1;
        if (n === "A267") {
          out.push({ name: at, files: ["A267 Bid.takeoff", "A267 Bid.takeoff.autosave", "A1 - Floor plan.pdf", "A267 Rev 2.takeoff",
            "L1 walls.takeoff", "L1 walls.pdfnotes", "Backup/A267 Bid (Sep 1).takeoff", "Backup/Old/A267 First bid.takeoff"] });
        } else if (n === "A024") out.push({ name: at, files: ["A024 Framing.takeoff", "A024 plans.pdf"] });
        else if (n === "A024-B") out.push({ name: at, files: ["A024-B Framing.takeoff", "A024-B Roof.takeoff", "Backup/A024-B Framing (old).takeoff"] });
        else if (last === 0) out.push({ name: at, files: [n + " Bid.takeoff", n + " plans.pdf", "Backup/" + n + " Bid (old).takeoff"] });
        else if (last === 2) out.push({ name: at, files: [n + " Bid.takeoff", "Backup/" + n + " Rev 1.TAKEOFF"] });
        else if (last === 3) out.push({ name: at, files: ["Plans/" + n + " plans.pdf", n + " Bid.takeoff.autosave", "Backup/" + n + " Bid.takeoff"] });
        if (n === "A120") out.push({ name: "A120 - older plans", files: ["A120 First bid.takeoff"] });
      }
      // the copies saved back beside a plan (the demo's table), in the order they were made
      rows[TABLE].filter((r) => r.takeoff).forEach(function (r) {
        const i = r.takeoff.indexOf("/");
        const f = out.find((x) => x.name === r.takeoff.slice(0, i));
        if (f && f.files.indexOf(r.takeoff.slice(i + 1)) === -1) f.files.push(r.takeoff.slice(i + 1));
      });
      return (takeoffTree = out);
    }
    function plansFor(b, w) {
      const ids = b.project_ids;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 || new Set(ids).size !== ids.length ||
        ids.some((x) => typeof x !== "number" || !Number.isSafeInteger(x) || x <= 0)) {
        return bad("project_ids", "project_ids must be 1 to 50 different positive whole numbers");
      }
      if (!w.active) return fail("forbidden");
      if (!takeoffOn()) return fail("takeoff_not_configured");
      // the projects' numbers under the caller's own rules (a deleted project is left out, an admin's too)
      const mine = new Map(E.readable(w, "projects").filter((p) => !p.deleted_at).map((p) => [p.id, p]));
      const folders = takeoffFolders();
      const projects = {};
      for (const id of ids) {
        const p = mine.get(id);
        if (!p) continue;
        const names = candidates(folders.map((f) => f.name), p.number);
        const plans = folders.filter((f) => names.includes(f.name))
          .reduce((sum, f) => sum + f.files.filter((x) => /\.takeoff$/i.test(x) && !x.includes("/")).length, 0);
        projects[String(id)] = { number: p.number, plans };
      }
      return answer(200, { projects, checked_at: nowIso() });
    }
    /* the Plans Library: each .takeoff file of the takeoff folder as plans_list answers it (made up, the same every time) */
    const planVersions = new Map();      // path -> a version a test set (a "new save")
    const savedBytes = new Map();        // path -> the saved Blob (this tab; another tab serves made-up bytes of its size)
    const fixtures = new Map();          // path -> {size, version}: a real made-up .takeoff a browser e2e set (this tab)
    /** the last save back of the takeoff file at `full` (a row of the demo's table), or null */
    function savedPlan(full) {
      const all = rows[TABLE].filter((r) => r.takeoff === full);
      return all.length ? all[all.length - 1] : null;
    }
    /** the last desktop save of the takeoff file at `full` (desktopSave: its new item id), or null */
    function desktopItem(full) {
      const all = rows[TABLE].filter((r) => r.takeoff === full && r.parent_id === "desktop-save");
      return all.length ? all[all.length - 1] : null;
    }
    function planFilesOf(p) {
      const folders = takeoffFolders();
      const names = candidates(folders.map((f) => f.name), p.number);
      const out = [];
      folders.forEach(function (f, fi) {
        if (!names.includes(f.name)) return;
        f.files.forEach(function (path, i) {
          if (!/\.takeoff$/i.test(path) || path.includes("/")) return;     // a sub-folder's (Backup): never one of its plans
          const parts = (f.name + "/" + path).split("/");
          const name = parts.pop();
          const full = parts.concat(name).join("/");
          const size = 180000 + ((fi * 7 + i * 13) % 9) * 41000;
          // the office's desktop app saved it: a new item on the name (the old one went into Backups)
          const dk = desktopItem(full);
          out.push({ id: dk ? dk.item_id : "01DEMOTKO" + String(fi).padStart(3, "0") + "F" + String(i).padStart(3, "0"), name, folder: parts.join("/"),
            size, modified: new Date(Date.UTC(2026, 8, 1 + ((fi + i) % 27), 17, 0, 0)).toISOString(),
            version: planVersions.get(full) || "qx:demo" + full.length.toString(36) + i + fi, full, folderName: f.name });
          // a save back from a device (a row of the demo's table: every tab knows it): its bytes' size, time and version
          const sv = savedPlan(full);
          if (sv) Object.assign(out[out.length - 1], { size: sv.size, modified: sv.modified_at, version: sv.version });
          // a real made-up project file set by a browser e2e (setPlanFixture) - until a save of it lands, or the office's
          const fx = fixtures.get(full);
          if (fx) Object.assign(out[out.length - 1], { size: fx.size, version: planVersions.get(full) || fx.version, modified: fx.modified });
        });
      });
      return out;
    }
    function planBytes(f) {
      if (savedBytes.has(f.full)) return savedBytes.get(f.full);
      const head = "PDFCACHE1 made-up demo plan file - the takeoff app cannot open it: " + f.name + "\n";
      const text = head + ".".repeat(Math.max(0, f.size - head.length));
      return typeof Blob !== "undefined" ? new Blob([text], { type: "application/octet-stream" }) : text;
    }
    const pricesOnly = (w) => (!w.active ? fail("forbidden") : !(w.admin || w.prices) ? fail("forbidden", null, "Plan files are for the people who see prices.") : null);
    const shown = (f) => ({ id: f.id, name: f.name, folder: f.folder, size: f.size, modified: f.modified, version: f.version });
    function plansList(b, w) {
      const ids = b.project_ids;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length ||
        ids.some((x) => typeof x !== "number" || !Number.isSafeInteger(x) || x <= 0)) {
        return bad("project_ids", "project_ids must be 1 to 20 different positive whole numbers");
      }
      if (!takeoffOn()) return fail("takeoff_not_configured");
      const no = pricesOnly(w);
      if (no) return no;
      const mine = new Map(E.readable(w, "projects").filter((p) => !p.deleted_at).map((p) => [p.id, p]));
      const projects = {};
      for (const id of ids) {
        const p = mine.get(id);
        if (p) projects[String(id)] = { number: p.number, files: planFilesOf(p).map(shown), complete: true, save_back: saveBack(w, p.number, "plans_list") };
      }
      return answer(200, { projects, checked_at: nowIso() });
    }
    /* the iPad's save back (contract C1, addendum 2 C1b, addendum 3 - DCR Desktop 2's handler.ts since the repair round):
       the broker's switch first; a replace by the plan's id while it is still the device's version, DEFERRED (its last
       chunk commits nothing; plan_save_commit commits it onto that version only - else the same upload becomes the copy -
       and checks every replace by the plan's version history), else a copy beside it */
    const MAX_PLAN = 4096 * 1024 * 1024;
    const SETTLE_MS = 30 * 24 * 3600 * 1000;                 // a plan ticket settles this long (commits: TICKET_MS)
    const VERSION_SKEW_MS = 2000;                            // handler.ts VERSION_SKEW_MS
    const HASH_WAIT_MS = 30 * 60 * 1000;                     // handler.ts HASH_WAIT_MS (repair round 2)
    const MAX_VERSIONS = 10;                                 // graph.ts MAX_VERSIONS: what a versions listing shows at most
    const CHECK_RETRY_S = 30;                                // handler.ts CHECK_RETRY_S: verify's 503s ask again after this
    const STAMP = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : null;
    function companyStamp(ms) {
      const q = {};
      (STAMP ? STAMP.formatToParts(new Date(ms)) : []).forEach((x) => { q[x.type] = x.value; });
      return q.year + "-" + q.month + "-" + q.day + " " + (q.hour === "24" ? "00" : q.hour) + q.minute;
    }
    const saver = (w) => (!w.active ? fail("forbidden") : !(w.admin || w.prices) ? fail("forbidden", null, "Plan files are for the people who see prices.")
      : !(w.admin || (w.p && w.p.can_upload_onedrive)) ? fail("forbidden", null, 'Saving a plan back needs the "Can upload to OneDrive" switch (an admin turns it on).') : null);
    /* the broker's log of the save back (its lines, never a name, an id or a person): logLines() */
    const logs = [];
    const log = (op, m) => { logs.push("onedrive " + op + ": " + m); if (logs.length > 200) logs.shift(); };
    /* the switch (handler.ts switchOn / saveBack): the demo's setting, read at each request */
    let planSaveSet = null;              // a node test's (setPlanSave); else the browser demo's localStorage one, else "all"
    function planSaveRaw() {
      if (planSaveSet !== null) return planSaveSet;
      if (browser) { try { const v = root.localStorage.getItem("dcr2-demo-plan-save"); if (v !== null) return v; } catch (e) { /* the default */ } }
      return DEMO_PLAN_SAVE;
    }
    function switchOn(number, op) {
      const sw = planSaveSwitch(planSaveRaw());
      if (!sw.understood) log(op, "ONEDRIVE_PLAN_SAVE not understood: off");
      return sw.on === "all" || (sw.on === "only" && sw.numbers.has(nfc(String(number || "").trim()).toLowerCase()));
    }
    /** plans_list's and plan_link's save_back: plan_save_session's gate passed AND the switch allows the project */
    const saveBack = (w, number, op) => !saver(w) && switchOn(number, op);
    function planOf(b, w) {
      const p = E.readable(w, "projects").find((x) => x.id === b.project_id && !x.deleted_at);
      return p ? { p, f: planFilesOf(p).find((x) => x.id === b.item_id) || null } : { p: null, f: null };
    }
    /** handler.ts versionMatches (review BRK-7): the same string, or the device's "sm:<size>:<time>" naming the plan's
        size and time now */
    function versionMatches(device, f) {
      if (device === f.version) return true;
      const m = /^sm:([0-9]{1,16}):(.+)$/.exec(String(device || ""));
      return !!m && Number(m[1]) === f.size && Date.parse(m[2]) === Date.parse(f.modified || "");
    }
    /** the plan's tag (its cTag: what changes with its bytes - never with OneDrive's hash of them coming in later): the
        last save's row of it (every tab agrees), and this tab's own test hooks */
    const revs = new Map();              // path -> how often a node test's hook gave it new bytes (this tab)
    function tagOf(f) {
      const r = savedPlan(f.full);
      return "t" + (r ? r.id : 0) + "." + (revs.get(f.full) || 0);
    }
    /** handler.ts urlTag: the ticket keeps a tag of its session's upload URL, never the URL */
    const urlTag = (url) => (NS.md5 ? NS.md5("uh:" + url) : String(String(url).length));
    /** the first free copy name of the plan's in its folder, the minute `ms` (handler.ts copySession / plan_save_commit) */
    function freeCopyName(p, f, ms) {
      const taken = new Set(planFilesOf(p).filter((x) => x.folder === f.folder).map((x) => nfc(x.name).toLowerCase()));
      const stamp = companyStamp(ms);
      for (let n = 1; n <= 9; n++) {
        const want = copyName(f.name, stamp, n, f.folder);
        if (want === null) return { refuse: bad("item_id", "That plan's folder name is too long for a copy of the plan next to it.") };
        if (!taken.has(want.toLowerCase())) return { name: want };
      }
      return { refuse: answer(503, { error: "busy", message: "Several copies of this plan were saved this minute already. Try again in a minute." }) };
    }
    function planSaveSession(b, w) {
      if (typeof b.version !== "string" || !/^(qx|sm):/.test(b.version) || b.version.length > 200) return bad("version", "version must be the plan's version as the plan list gave it");
      if (typeof b.size !== "number" || !Number.isSafeInteger(b.size) || b.size < 1) return bad("size", "size must be the file's size in bytes");
      if (b.mode !== undefined && b.mode !== null && b.mode !== "replace" && b.mode !== "copy") return bad("mode", 'mode must be "replace" or "copy"');
      if (b.name !== undefined && b.name !== null && (typeof b.name !== "string" || !b.name || Array.from(b.name).length > 255)) {
        return bad("name", "name must be the plan's file name (at most 255 characters)");
      }
      if (!takeoffOn()) return fail("takeoff_not_configured");
      const no = saver(w);
      if (no) return no;
      const p = E.readable(w, "projects").find((x) => x.id === b.project_id && !x.deleted_at);
      if (!p) return fail("not_found");
      // the switch (contract addendum 3 D1): after the person's gate, before anything of OneDrive's
      if (!switchOn(p.number, "plan_save_session")) {
        log("plan_save_session", "the save back is not on for this project (ONEDRIVE_PLAN_SAVE): the save waits on the device");
        return fail("save_back_off");
      }
      if (b.size > MAX_PLAN) return fail("too_large", { max_bytes: MAX_PLAN });
      let f = planFilesOf(p).find((x) => x.id === b.item_id) || null;
      // the office's desktop app moved the item into Backups and wrote a new one: the ONE plan of that name, and a copy
      let byName = false;
      if (!f && typeof b.name === "string") {
        const same = planFilesOf(p).filter((x) => nfc(x.name).toLowerCase() === nfc(b.name).toLowerCase());
        if (same.length === 1) [f, byName] = [same[0], true];
      }
      if (!f) return fail("not_found");
      const mode = !byName && (b.mode || "replace") === "replace" && versionMatches(b.version, f) ? "replace" : "copy";
      let name = f.name;
      if (mode === "copy") {
        const c = freeCopyName(p, f, nowMs());
        if (c.refuse) return c.refuse;
        name = c.name;
      }
      const token = "s" + (++sessionN) + "-" + Math.random().toString(36).slice(2, 10);
      const exp = nowMs() + 24 * 3600 * 1000;
      const url = "https://" + HOST + "/__demo/up/" + token;
      const deferred = mode === "replace";
      sessions.set(token, { plan: true, mode, uid: w.uid, pid: p.id, item: f.id, full: f.full, folderName: f.folderName, folder: f.folder, name,
        size: b.size, offset: 0, parts: [], done: null, exp, deferred });
      // a replace's ticket keeps the base as it is now (contract addendum 3 D2): the version check expects it right under
      // the save
      const ticket = seal("plan", Object.assign({ u: w.uid, p: p.id, m: mode, t: mode === "replace" ? f.id : f.folder, v: b.version, s: b.size, n: name,
        i: Math.floor(nowMs() / 1000) }, deferred ? { tag: tagOf(f), uh: urlTag(url), dc: true, f: f.folder, bs: f.size, bm: f.modified, bv: f.version } : {}),
        nowMs() + SETTLE_MS);
      log("plan_save_session", "a " + mode + " session");
      return answer(200, Object.assign({ mode }, deferred ? { commit: "broker" } : {}, { upload_url: url, expires_at: new Date(exp).toISOString(),
        chunk_bytes: CHUNK, chunk_multiple: UNIT, max_chunk_bytes: MAX_CHUNK, max_bytes: MAX_PLAN, ticket, name }));
    }
    /** OneDrive's quickXorHash of saved bytes, a moment after they landed (js/quickxor.js - the very module the device
        hashes with): until then the version is the "sm:" form, as OneDrive's is before it hashed them */
    let hashing = Promise.resolve();
    async function hashOf(blob) {
      const Q = root.DCR2QuickXor;
      if (!Q || !blob || typeof blob.slice !== "function") return null;
      const h = new Q.QuickXorHash();
      for (let at = 0; at < blob.size; at += 8 * 1024 * 1024) h.update(new Uint8Array(await blob.slice(at, at + 8 * 1024 * 1024).arrayBuffer()));
      return h.base64();
    }
    function hashLater(rowId, blob) {
      hashing = hashing.then(() => hashOf(blob)).then(function (h) {
        const row = rows[TABLE].find((r) => r.id === rowId);
        if (h && row && /^sm:/.test(row.version)) commitUpdate(TABLE, row, Object.assign({}, row, { version: "qx:" + h }));
      }).catch(() => null);
      return hashing;
    }
    /* What Microsoft's pages leave open, as MODES (DCR Desktop 2 fake_graph.ts's, each default the documented way):
       deferCommit "honoured" | "ignored" (the last chunk of a deferred session commits it: 200 with the driveItem);
       putCommit "accepted" | "refused" (Example 7's PUT answers 400); putIfMatch / postIfMatch "honoured" | "ignored";
       postStatus (the zero-length POST answers that status); versions "on" | "off" (only the current one, nothing kept)
       | "failing" (the listing answers versionsStatus: 403 - a refusal, the history unreadable - by default; 429 or a
       5xx but 501 is a moment's trouble: handler.ts asks again, repair round 2 S6); restoreStatus (restoreVersion answers
       that status); hashes "on" | "off" (the demo's OneDrive never hashes what lands: its version stays the "sm:" form -
       Microsoft's pages promise no time for the hash); afterCommit "gone" | "usable" (DCR Desktop 2 fake_graph.ts's: a
       committed session's upload URL answers as gone, or still takes a commit - Microsoft's page does not say). */
    const GRAPH = { deferCommit: "honoured", putCommit: "accepted", putIfMatch: "honoured", postIfMatch: "honoured", postStatus: 0, versions: "on",
      versionsStatus: 403, restoreStatus: 0, hashes: "on", afterCommit: "gone" };
    const graph = Object.assign({}, GRAPH);
    /* each plan's version history (this tab): item id -> its earlier versions, oldest first ({size, modified, version,
       blob}: blob null for made-up bytes of that size) - the current one is the plan as planFilesOf lists it */
    const history = new Map();
    /** the plan at `full` gets new bytes: what it held goes into its history (unless history is off) */
    function keepVersion(full) {
      if (graph.versions === "off") return;
      const p = rows.projects.find((x) => !x.deleted_at && planFilesOf(x).some((f) => f.full === full));
      const f = p ? planFilesOf(p).find((x) => x.full === full) : null;
      if (!f) return;
      const h = history.get(f.id) || [];
      h.push({ size: f.size, modified: f.modified, version: f.version, blob: savedBytes.has(full) ? savedBytes.get(full) : null });
      history.set(f.id, h);
    }
    /** GET items/<id>/versions as Graph answers it - newest first, the current one first - or the status it failed with */
    function versionsOf(f) {
      if (graph.versions === "failing") return Number(graph.versionsStatus) || 403;
      const h = graph.versions === "off" ? [] : history.get(f.id) || [];
      const cur = { id: (h.length + 1) + ".0", modified: f.modified, size: f.size };
      return [cur].concat(h.map((v, i) => ({ id: (i + 1) + ".0", modified: v.modified, size: v.size })).reverse());
    }
    /** POST items/<id>/versions/<vid>/restoreVersion: that version's bytes become a new current one (the history keeps
        every version) -> the status */
    function restoreVersion(f, vid) {
      if (graph.restoreStatus) return graph.restoreStatus;
      const h = graph.versions === "off" ? [] : history.get(f.id) || [];
      const k = /^([0-9]+)\.0$/.exec(String(vid || ""));
      const v = k ? h[Number(k[1]) - 1] : null;
      if (!v) return 404;
      keepVersion(f.full);
      fixtures.delete(f.full);
      if (v.blob) savedBytes.set(f.full, v.blob); else savedBytes.delete(f.full);
      const p = rows.projects.find((x) => !x.deleted_at && planFilesOf(x).some((g) => g.full === f.full));
      commitInsert(TABLE, { id: nextId(TABLE), item_id: f.id, project_id: p ? p.id : null, parent_id: null, name: f.name, folder: false, size: v.size,
        mime: "application/octet-stream", created_at: nowIso(), modified_at: nowIso(), by_app: true, takeoff: f.full, version: v.version });
      return 204;
    }
    /** the plan's bytes replaced (a new version, the same id), or the copy added to its folder */
    function planSaveLanded(s) {
      const at = nowIso();
      let full = s.full;
      if (s.mode === "copy") {
        const folder = takeoffFolders().find((x) => x.name === s.folderName);
        if (folder && folder.files.indexOf(s.name) === -1) folder.files.push(s.name);
        full = s.folder + "/" + s.name;
      } else keepVersion(full);
      const blob = typeof Blob !== "undefined" ? new Blob(s.parts, { type: "application/octet-stream" }) : null;
      if (blob) savedBytes.set(full, blob);
      fixtures.delete(full);
      const p = rows.projects.find((x) => x.id === s.pid);
      const f = p ? planFilesOf(p).find((x) => x.full === full) : null;
      const id = f ? f.id : s.item;
      const rowId = nextId(TABLE);
      commitInsert(TABLE, { id: rowId, item_id: id, project_id: s.pid, parent_id: null, name: s.name, folder: false, size: s.size,
        mime: "application/octet-stream", created_at: at, modified_at: at, by_app: true, takeoff: full, version: "sm:" + s.size + ":" + at });
      if (blob && graph.hashes !== "off") hashLater(rowId, blob);
      return id;
    }
    /** handler.ts notLanded: the device's hash and OneDrive's decide alone when both are there (a byte-identical re-save
        is saved, an office save of the same size is not); else the size, the version (never the device's), the time */
    function landedAs(t, f, hash) {
      if (t.m === "replace" && f.id !== t.t) return false;
      if (t.m === "copy" && (f.folder !== t.t || !same(f.name, t.n))) return false;
      if (hash && /^qx:/.test(f.version)) return f.version === "qx:" + hash;
      if (f.size !== t.s) return false;
      if (t.m === "replace") return !versionMatches(t.v, f) && Date.parse(f.modified || "") >= t.i * 1000 - SKEW_MS;
      return true;
    }
    const savedAs = (mode, f, extra) => answer(200, Object.assign({ saved: true, mode, id: f.id, name: f.name, size: f.size, modified: f.modified, version: f.version }, extra || {}));
    /** the copy a deferred replace's commit made of this ticket's upload (handler.ts copyLanded: only with a hash) */
    function copyLanded(p, t, hash) {
      if (!hash) return null;
      const stem = nfc(t.n).replace(/\.takeoff$/i, "").toLowerCase() + " - ipad " + companyStamp(t.i * 1000);
      return planFilesOf(p).find((x) => x.folder === t.f && x.version === "qx:" + hash && nfc(x.name).toLowerCase().indexOf(stem) === 0) || null;
    }
    /** plan_save_done's checks (and a commit's settling): the item the ticket's save landed as - else, for a deferred
        replace with a hash, the copy its commit made of it (handler.ts settle). A deferred replace comes here only with
        the device's hash (needHash, contract addendum 4 E1) and is found landed as the plan only on OneDrive's hash of
        it: by its size alone (OneDrive has no hash of it yet) it is waited for, then "unproved" (hashWait) */
    function settled(p, t, id, hash, op) {
      const f = planFilesOf(p).find((x) => x.id === id) || null;
      if (f && landedAs(t, f, hash)) {
        if (t.dc === true && (!hash || !/^qx:/.test(f.version))) {
          return hashWait(op, f, "the plan is this save's size, but OneDrive has no hash of it yet, so it is not known to be this save");
        }
        return savedAs(t.m, f);
      }
      const c = t.m === "replace" && t.dc ? copyLanded(p, t, hash) : null;
      if (c) return savedAs("copy", c);
      // a deferred replace not on the plan now: did it go over an office save there before a newer save landed on top
      // (DCR Desktop 2 9969d61, THE PRINCIPLE: never the plain not_saved then)
      const over = f && t.m === "replace" && t.dc === true ? overOffice(p, t, f, op) : null;
      if (over) return over;
      return fail("not_saved");
    }
    const hashOk = (h) => h === undefined || h === null || (typeof h === "string" && /^[A-Za-z0-9+/]{27}=$/.test(h));
    function planSaveDone(b, w) {
      if (!hashOk(b.hash)) return bad("hash", "hash must be the file's quickXorHash in base64, as OneDrive reports it");
      if (!takeoffOn()) return fail("takeoff_not_configured");
      const no = saver(w);
      if (no) return no;
      const t = unseal("plan", b.ticket);
      if (!t || t.u !== w.uid || t.p !== b.project_id) return bad("ticket", "This save's ticket is not valid or has run out: save the plan again.");
      const { p } = planOf(b, w);
      if (!p) return fail("not_found");
      const hash = b.hash || null;
      // contract addendum 4 E1: a deferred replace is settled only with the device's hash - at any age
      if (t.m === "replace" && t.dc === true && !hash) return needHash("plan_save_done");
      const found = settled(p, t, b.item_id, hash, "plan_save_done");
      // handler.ts planSaveDone (repair round 2, S1): a DEFERRED replace found landed as the plan - settled by a later
      // page, whose upload address is gone - is checked by the version history exactly as a commit is; a crossing (put
      // back) is plan_save_done's own 409 not_saved: the device sends the save again (a copy: the plan's version moved);
      // a check OneDrive gives no hash to finish: 409 not_saved {why: "unproved"} (contract addendum 4 E1)
      const v = found.status === 200 && found.data.mode === "replace" && t.m === "replace" && t.dc === true ? verify(p, t, hash, "plan_save_done") : found;
      if (v.status !== 409 || v.data.error !== "plan_changed") return v;
      log("plan_save_done", "not saved as the plan (the check above): the save is sent again");
      return v.data.why === "unproved" ? fail("not_saved", { why: "unproved" }, PLAN_UNPROVED) : fail("not_saved");
    }
    /** 409 plan_changed {retry: "copy", why} (handler.ts planChanged; contract addendum 3 D5, addendum 4 E1) */
    const planChanged = (why) => answer(409, { error: "plan_changed", message: why === "refused" ? PLAN_REFUSED : why === "unproved" ? PLAN_UNPROVED : ERR.plan_changed[1],
      retry: "copy", why });
    /** handler.ts needHash (contract addendum 4 E1): a deferred replace committed or settled without the device's hash -
        409 not_saved {need: "hash"} at any age, before anything of OneDrive's */
    function needHash(op) {
      log(op, "a deferred replace is committed or settled only with the file's hash: not saved, the hash is needed");
      return fail("not_saved", { need: "hash" }, NEED_HASH);
    }
    /** handler.ts unproved (contract addendum 4 E1): nothing proves whether the plan's newest version is this save over
        an office save - nothing is put back, the admin's log line, 409 plan_changed {why: "unproved"} */
    function unproved(op, what) {
      log(op, (what || "crossed: not proved (OneDrive gave no hash)") + ": check the plan's version history by hand");
      return planChanged("unproved");
    }
    /** handler.ts hashWait: 503 busy (asked again) until HASH_WAIT_MS after the plan's last change, then unproved() */
    function hashWait(op, f, what) {
      const changed = Date.parse(f.modified || "");
      if (Number.isFinite(changed) && nowMs() - changed <= HASH_WAIT_MS) {
        log(op, what + ": asked again");
        return checkWait("busy");
      }
      return unproved(op);
    }
    /** handler.ts isBaseVersion: a listing's entry is the ticket's base (its bs, and bm within VERSION_SKEW_MS) */
    function isBaseVersion(t, v) {
      const bm = typeof t.bm === "string" ? Date.parse(t.bm) : NaN;
      const vm = Date.parse(v.modified || "");
      return typeof t.bs === "number" && v.size === t.bs && Number.isFinite(bm) && Number.isFinite(vm) && Math.abs(vm - bm) <= VERSION_SKEW_MS;
    }
    /** handler.ts shownUnder (DCR Desktop 2 9969d61): the versions of this save's size made since the ticket (never the
        base; the newest skipped when it is `top`, the plan now) - "office": one sits on anything but the base, or on
        nothing the listing shows; "base": each sits right on the base; "none": the listing shows none */
    function shownUnder(t, vs, top) {
      const at = (iso) => Date.parse(iso || "");
      const from = vs.length > 0 && vs[0].size === top.size && Math.abs(at(vs[0].modified) - at(top.modified)) <= VERSION_SKEW_MS ? 1 : 0;
      let shown = "none";
      for (let i = from; i < vs.length; i++) {
        const v = vs[i];
        if (v.size !== t.s || !(at(v.modified) >= t.i * 1000 - SKEW_MS) || isBaseVersion(t, v)) continue;
        if (i + 1 >= vs.length || !isBaseVersion(t, vs[i + 1])) return "office";
        shown = "base";
      }
      return shown;
    }
    /** handler.ts overOffice: the plan `f` as read now is provably not this save (a settle about to answer not_saved,
        a commit about to make the same upload the copy) - did this save go over an office save there before a newer one
        landed on top? The listing says (shownUnder): "office" -> unproved with the admin's line. No listing: nothing
        shows this save ever reached the plan (null: the caller's answer stands). Read only. -> that answer, or null */
    function overOffice(p, t, f, op) {
      const vs = listing(f);
      return Array.isArray(vs) && shownUnder(t, vs, f) === "office" ? unproved(op, "crossed: not put back (newer save)") : null;
    }
    /** what the broker's planVersions reads of the plan's history: at most MAX_VERSIONS (newest first), or null */
    function listing(f) {
      const vs = versionsOf(f);
      return Array.isArray(vs) ? vs.slice(0, MAX_VERSIONS) : null;
    }
    /** what plan_save_commit answers once Microsoft committed it AS THE COPY: the item afresh - the hash, else the size */
    function committed(p, t, found, hash) {
      const f = planFilesOf(p).find(found);
      if (!f || (hash && /^qx:/.test(f.version) ? f.version !== "qx:" + hash : f.size !== t.s)) return fail("not_saved");
      return savedAs("copy", f);
    }
    const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= VERSION_SKEW_MS;
    /** verify's 503s (handler.ts GraphFailure 503): busy, or onedrive_not_authorized (Microsoft refused the restore
        401 / 403) - asked again (the demo's functions answer no Retry-After header: the uploader's own waits) */
    const checkBusy = (code) => answer(503, { error: code || "busy", message: code === "onedrive_not_authorized"
      ? "The OneDrive connection is not allowed in just now: an admin checks it." : ERR.busy[1] });
    /** handler.ts checkWait (DCR Desktop 2's repair round 3): a 503 of the version check itself - OneDrive's hash not
        there yet, a restore not done - says why "checking" (Portal 2 tells it from OneDrive busy before anything was
        committed); the listing's moment of trouble does not */
    const checkWait = (code) => answer(503, Object.assign(checkBusy(code).data, { why: "checking" }));
    /** handler.ts verify (contract addendum 3 D2 step 4; DCR Desktop 2's repair round 2): after a replace's commit (or
        one found landed - by plan_save_commit, or by plan_save_done for a deferred replace a later page settles), the
        plan afresh, then its version history: this save the newest and the base right under it - saved, verified; any
        other version under it - crossed: put back (restoreVersion) only when the device's hash and OneDrive's prove the
        newest version is this save (no hash of OneDrive's yet but the device's: 503 busy, asked again, for HASH_WAIT_MS
        after the plan changed; else - or no device hash - 409 plan_changed, nothing restored), then 409 plan_changed
        {why: "changed"} once the restore answered 2xx (a restore that did not: 503, asked again); no history to read -
        saved, verified false; the listing in a moment's trouble (429, a 5xx but 501): 503 busy */
    function verify(p, t, hash, op) {
      const it = planFilesOf(p).find((x) => x.id === t.t) || null;
      if (!it) {
        log(op, "committed, but the plan is not right in its project folder now: the save is sent again as a copy");
        return planChanged("changed");
      }
      const theirs = /^qx:/.test(it.version) ? it.version.slice(3) : null;
      const proved = !!hash && theirs !== null;
      const ours = proved ? theirs === hash : it.size === t.s;
      const saved = (verified) => { log(op, "committed (replace)"); return savedAs("replace", it, { verified }); };
      let vs = versionsOf(it);
      if (typeof vs === "number") {
        // graph.ts planVersions: a moment's trouble is asked again; a refusal is no history to read
        if (vs === 429 || (vs >= 500 && vs !== 501)) return checkBusy("busy");
        vs = null;
      }
      if (vs) vs = vs.slice(0, MAX_VERSIONS);
      if (!vs || vs.length < 2) {
        if (!ours) {
          // this save was on the plan (Microsoft's 2xx, or found there) and is not now, and no listing shows what it went
          // over: never the plain "changed" (DCR Desktop 2 9969d61, THE PRINCIPLE)
          log(op, "committed, but the plan has " + (proved ? "another hash" : "another size") + ": the save is sent again as a copy");
          return unproved(op, "committed: not proved (no version history to read)");
        }
        log(op, "version history not available: unverified");
        return saved(false);
      }
      const top = vs[0], under = vs[1];
      const at = (iso) => Date.parse(iso || "");
      const bm = typeof t.bm === "string" ? at(t.bm) : NaN;
      const hasBase = typeof t.bs === "number" && Number.isFinite(bm);
      const isBase = hasBase && under.size === t.bs && near(at(under.modified), bm);
      const crossed = hasBase && !isBase;
      const topOurs = ours && top.size === it.size && near(at(top.modified), at(it.modified));
      if (!topOurs) {
        // a newer save on top: nothing is put back (never over it). The plain "changed" only when the listing shows this
        // save right on the base (DCR Desktop 2 9969d61: THE PRINCIPLE over CONTRACT-3 D2's "the same 409")
        const shown = shownUnder(t, vs, it);
        if (shown !== "base") return unproved(op, shown === "office" ? "crossed: not put back (newer save)" : "committed: not proved (this save is not in the version history)");
        log(op, "committed, but the newest version is not this save: the save is sent again as a copy");
        return planChanged("changed");
      }
      // the newest version IS the base, byte for byte this save by the hash: an identical re-save found landed without
      // its commit - nothing went over anything, and the older version under it is never put back (DCR Desktop 2 dd29c6a)
      if (proved && hasBase && top.size === t.bs && near(at(top.modified), bm)) {
        log(op, "the newest version is the base itself, byte for byte this save: nothing to put back, verified");
        return saved(true);
      }
      if (isBase) {
        log(op, "the version history shows the base right under this save: verified");
        return saved(true);
      }
      if (!crossed) {
        log(op, "the ticket names no base: unverified");
        return saved(false);
      }
      if (!proved) {
        // contract addendum 4 E1: never the plain "changed" - the device's hash is always here (needHash), so it is
        // OneDrive's that is missing: waited for, then "unproved" (nothing put back, the admin's log line)
        if (!hash) return unproved(op);
        return hashWait(op, it, "crossed: OneDrive has no hash of the newest version yet, so it is not known to be this save");
      }
      const status = restoreVersion(it, under.id);
      if (status >= 200 && status < 300) {
        log(op, "crossed: the office save was put back");
        return planChanged("changed");
      }
      log(op, "crossed: the office save could not be put back (" + status + "): asked again");
      return checkWait(status === 401 || status === 403 ? "onedrive_not_authorized" : "busy");
    }
    /** the session is gone (committed earlier, the answer lost; or run out): looked for as plan_save_done does, a replace
        then checked as a commit is */
    function goneCommit(p, t, id, hash) {
      log("plan_save_commit", "the upload session is gone (committed already, or run out): the save is looked for");
      const found = settled(p, t, id, hash, "plan_save_commit");
      return found.status === 200 && found.data.mode === "replace" ? verify(p, t, hash, "plan_save_commit") : found;
    }
    /** handler.ts dropped: the session dropped (DELETE of its upload URL); what OneDrive already holds of the save
        answered when the walk shows it, else 409 plan_changed {retry: "copy", why} */
    function dropped(p, token, t, hash, reason, why) {
      sessions.delete(token);
      const plan = planFilesOf(p).find((x) => x.id === t.t) || null;
      if (hash) {
        if (plan && landedAs(t, plan, hash)) { log("plan_save_commit", reason + "; OneDrive holds the save already: it is checked as a commit"); return verify(p, t, hash, "plan_save_commit"); }
        const c = copyLanded(p, t, hash);
        if (c) { log("plan_save_commit", reason + "; OneDrive holds the save already: saved (copy)"); return savedAs("copy", c); }
      }
      log("plan_save_commit", reason + ": the upload session is dropped and the save is sent again as a copy");
      return planChanged(why);
    }
    let refuseCopyCommit = false;        // a node test's: Microsoft will not commit a session as the copy (plan_changed)
    const between = new Map();           // path -> "office" | "self": its next commit meets an office save (or this very
                                         // session committed by another request of the device's) between walk and commit
    /** what comes between a commit's walk and its commit (betweenWalkAndCommit): an office save, or the session's own
        commit by another request (its bytes land on the plan: request 1's, before this request 2's) */
    function meet(path, s) {
      const what = between.get(path);
      between.delete(path);
      if (what === "self") s.done = planSaveLanded(s);
      else if (what) officeSave(path);
    }
    /** the SAME upload committed as the copy next to the plan (handler.ts asCopy) */
    function asCopy(p, s, token, t, plan, hash) {
      const where = plan || planFilesOf(p).find((x) => x.folder === t.f) || null;
      if (!where || refuseCopyCommit) return dropped(p, token, t, hash, "Microsoft did not commit the upload as the copy (400)", "changed");
      const c = freeCopyName(p, Object.assign({}, where, { name: plan ? plan.name : t.n }), t.i * 1000);
      if (c.refuse) return dropped(p, token, t, hash, "every copy name of the save's minute is taken", "changed");
      Object.assign(s, { mode: "copy", name: c.name, folder: where.folder, folderName: where.folderName });
      s.done = planSaveLanded(s);
      return committed(p, t, (x) => x.folder === where.folder && same(x.name, c.name), hash);
    }
    function planSaveCommit(b, w) {
      if (typeof b.upload_url !== "string" || !/^https:\/\//.test(b.upload_url) || (() => { try { return new URL(b.upload_url).hostname !== HOST; } catch (e) { return true; } })()) {
        return bad("upload_url", "upload_url must be the upload URL of this save's session");
      }
      if (!hashOk(b.hash)) return bad("hash", "hash must be the file's quickXorHash in base64, as OneDrive reports it");
      const landed = b.landed === undefined || b.landed === null ? false : b.landed;
      if (typeof landed !== "boolean") return bad("landed", "landed must be true (the last chunk answered the file) or false");
      if (!takeoffOn()) return fail("takeoff_not_configured");
      const no = saver(w);
      if (no) return no;
      const t = unseal("plan", b.ticket);
      if (!t || t.u !== w.uid || t.p !== b.project_id) return bad("ticket", "This save's ticket is not valid or has run out: save the plan again.");
      if (t.m !== "replace" || t.dc !== true || typeof t.tag !== "string" || typeof t.uh !== "string") return bad("ticket", "This save's session is not one the broker commits: finish it with plan_save_done.");
      if (b.item_id !== t.t) return bad("item_id", "item_id must be the plan this save's session was made for");
      if (urlTag(b.upload_url) !== t.uh) return bad("upload_url", "That is not the upload URL of this save's session.");
      const { p } = planOf(b, w);
      if (!p) return fail("not_found");
      const hash = b.hash || null;
      const op = "plan_save_commit";
      // contract addendum 4 E1: no deferred replace is committed or settled without the device's hash
      if (!hash) return needHash(op);
      // a ticket past 48 hours: nothing is committed, the save is only looked for - a replace found landed is checked
      // all the same (repair round 2: whenever it landed, a crossed office save is put back)
      if (nowMs() - t.i * 1000 > TICKET_MS) {
        log(op, "the ticket is older than 48 hours: nothing is committed, the save is only looked for");
        const found = settled(p, t, b.item_id, hash, op);
        return found.status === 200 && found.data.mode === "replace" ? verify(p, t, hash, op) : found;
      }
      // contract addendum 3 D3: the last chunk committed it already (OneDrive did not honour deferCommit) - only checked
      if (landed) {
        log(op, "OneDrive committed at the last chunk: deferCommit not honoured here");
        return verify(p, t, hash, op);
      }
      const m = /^\/__demo\/up\/([A-Za-z0-9-]+)$/.exec(new URL(b.upload_url).pathname);
      const token = m ? m[1] : "";
      const s = token ? sessions.get(token) : null;
      // the session gone (committed earlier, its answer lost; or run out): the save is looked for - unless a committed
      // session is still usable here (graphModes afterCommit "usable": Microsoft's page does not say)
      if (!s || (s.done && graph.afterCommit !== "usable") || s.exp < nowMs()) return goneCommit(p, t, b.item_id, hash);
      if (s.offset !== s.size) return fail("not_saved");
      const plan = planFilesOf(p).find((x) => x.id === t.t) || null;
      if (!(plan && tagOf(plan) === t.tag)) {
        return toCopy(p, s, token, t, plan, hash, op, plan ? "the plan changed during the upload: the same upload is committed as a copy"
          : "the plan left its project folder during the upload: the same upload is committed as a copy next to it");
      }
      const movedFrom = (walked) => () => { const now = planFilesOf(p).find((x) => x.id === t.t) || null; return !now || tagOf(now) !== walked; };
      // attempt A: Example 7's PUT, If-Match the plan's tag as the walk read it - an office save between that walk and
      // the PUT (a node test's / an e2e's betweenWalkAndCommit)
      if (graph.putCommit !== "refused") {
        const moved = movedFrom(tagOf(plan));
        meet(plan.full, s);
        if (graph.putIfMatch === "honoured" && moved()) return justChanged(p, s, token, t, hash, op);
        s.done = planSaveLanded(s);
        return verify(p, t, hash, op);
      }
      // attempt B: Example 4's zero-length POST (work or school), the plan walked afresh first (the PUT refused 400 was
      // never a commit: betweenWalkAndCommit's office save comes between THIS walk and the POST)
      log(op, "the PUT commit was refused (400): the POST commit");
      const p2 = planFilesOf(p).find((x) => x.id === t.t) || null;
      if (!(p2 && tagOf(p2) === t.tag)) {
        return toCopy(p, s, token, t, p2, hash, op, p2 ? "the plan changed: the same upload is committed as a copy"
          : "the plan left its project folder: the same upload is committed as a copy next to it");
      }
      const moved2 = movedFrom(tagOf(p2));
      meet(p2.full, s);
      if (graph.postStatus) return dropped(p, token, t, hash, "Microsoft did not commit the replace (" + graph.postStatus + ")", "refused");
      if (graph.postIfMatch === "honoured" && moved2()) return justChanged(p, s, token, t, hash, op);
      // the POST's If-Match ignored (undocumented there): it lands over the office save - verify finds it under ours
      s.done = planSaveLanded(s);
      return verify(p, t, hash, op);
    }

    /** handler.ts justChanged (DCR Desktop 2 9969d61): Microsoft's 412 to a commit (attempt A's PUT, attempt B's POST) -
        the plan changed just now, or another request of this very save committed it a moment ago: the plan read afresh
        decides, exactly as a tag that moved does (toCopy), never the copy on the walk before the commit */
    function justChanged(p, s, token, t, hash, op) {
      const plan = planFilesOf(p).find((x) => x.id === t.t) || null;
      return toCopy(p, s, token, t, plan, hash, op, plan ? "the plan changed just now (412): the same upload is committed as a copy"
        : "the plan left its project folder just now (412): the same upload is committed as a copy next to it");
    }
    /** handler.ts toCopy: the plan is not as the session left it - the same upload committed as the copy next to it,
        unless the plan holds this save already (holdsSave: the check) or its history shows this save over an office save
        under a newer one (overOffice: "unproved") */
    function toCopy(p, s, token, t, plan, hash, op, copying) {
      const held = plan ? holdsSave(p, t, plan, hash, op) : null;
      if (held) return held;
      const over = plan ? overOffice(p, t, plan, op) : null;
      if (over) return over;
      log(op, copying);
      return asCopy(p, s, token, t, plan, hash);
    }
    /** handler.ts holdsSave (contract addendum 4 E3): the walk shows the plan's tag moved, so the same upload would be
        committed as a copy - but is the plan THIS save already (its commit landed and the answer did not get through)?
        By the hash: the check (verify), never a copy; by its size alone (OneDrive has no hash of it): hashWait. -> that
        answer, or null: the plan provably does not hold this save (the copy) */
    function holdsSave(p, t, plan, hash, op) {
      if (!landedAs(t, plan, hash)) return null;
      if (!/^qx:/.test(plan.version)) {
        return hashWait(op, plan, "the plan changed during the upload, and OneDrive has no hash of it yet, so it is not known whether it is this save");
      }
      log(op, "the plan changed during the upload, and it holds this save already (its commit's answer was lost): it is checked as a commit");
      return verify(p, t, hash, op);
    }

    function planLink(b, w) {
      if (!takeoffOn()) return fail("takeoff_not_configured");
      const no = pricesOnly(w);
      if (no) return no;
      const p = E.readable(w, "projects").find((x) => x.id === b.project_id && !x.deleted_at);
      const f = p ? planFilesOf(p).find((x) => x.id === b.item_id) : null;
      if (!f) return fail("not_found");
      let url;
      if (browser) url = root.URL.createObjectURL(planBytes(f));
      else url = "https://" + HOST + "/__demo/dl/" + (++linkN) + "-" + f.id;
      links.set(url, { plan: f });
      return answer(200, Object.assign({ url }, shown(f), { save_back: saveBack(w, p.number, "plan_link") }));
    }

    /* ── answers ── */
    const answer = (status, data) => ({ status, data });
    const fail = (code, extra, message) => answer(ERR[code][0], Object.assign({ error: code, message: message || ERR[code][1] }, extra || {}));
    const bad = (field, message) => answer(400, { error: "invalid", message, field });

    function context(w, pid) {
      if (!w.active) return { refuse: fail("forbidden") };
      const p = rows.projects.find((x) => x.id === pid && !x.deleted_at);
      if (!p) return { refuse: fail("not_found") };
      const upload = w.admin || (["manager", "accountant", "lead", "field"].includes(w.role) && !!(w.p && w.p.can_upload_onedrive));
      return { p, v: { prices: w.prices, financials: w.financials }, upload, make: canEdit(w, "projects") || upload, admin: w.admin };
    }
    function parsePath(v, field, max) {
      if (v === undefined || v === null || v === "") return { segs: [] };
      if (typeof v !== "string") return { refuse: bad(field, field + " must be text") };
      if (Array.from(v).length > 400) return { refuse: bad(field, field + " is too long (at most 400 characters)") };
      const segs = v.split("/");
      for (const s of segs) {
        const p = segmentProblem(s, max);
        if (p) return { refuse: bad(field, field + " has " + p) };
      }
      return { segs };
    }
    function entry(it, v) {
      const out = { id: it.id, name: it.name, folder: it.folder, size: it.folder ? null : it.size, modified: it.modified || null };
      if (it.folder && v.prices) out.children = kids(it.id, it.pid).length;
      return out;
    }
    function makeProjectFolder(c) {
      const names = kids(PROJECTS, c.p.id).filter((x) => x.folder).map((x) => x.name);
      const others = candidates(names, c.p.number).filter((n) => !same(n, c.p.folder_name));
      if (others.length) return { refuse: fail("other_folder", Object.assign({ count: others.length }, c.admin ? { folders: others } : {})) };
      return { pf: newFolder(PROJECTS, c.p.folder_name, c.p.id) };
    }
    function standard(pf) {
      const out = { created: [], existed: [], blocked: [] };
      for (const n of ["Floor Plans", "Photos", "Documents"]) {
        const there = lookup(pf, [n]);
        if (there) (there.folder ? out.existed : out.blocked).push(n);
        else { newFolder(pf.id, n, pf.pid); out.created.push(n); }
      }
      return out;
    }

    function invoke(ctx, name, body) {
      const w = who(ctx);
      if (!w.uid) return fail("unauthorized");
      const b = body && typeof body === "object" && !Array.isArray(body) ? body : null;
      if (!b) return bad("body", "the body must be a JSON object");
      const ops = { list: ["path", "cursor"], download: ["item_id"], upload_session: ["folder", "rel_dir", "name", "size", "modified"],
        upload_done: ["item_id", "ticket"], ensure_folder: [], status: [], plans_for: ["project_ids"], plans_list: ["project_ids"],
        plan_link: ["item_id"], plan_save_session: ["item_id", "version", "size", "modified", "mode", "name"],
        plan_save_commit: ["item_id", "ticket", "upload_url", "hash", "landed"], plan_save_done: ["item_id", "ticket", "hash"] };
      if (!Object.prototype.hasOwnProperty.call(ops, b.op)) return bad("op", "op must be one of " + Object.keys(ops).join(", "));
      const allowed = ["op"].concat(b.op === "status" || b.op === "plans_for" || b.op === "plans_list" ? [] : ["project_id"], ops[b.op]);
      const extra = Object.keys(b).find((k) => !allowed.includes(k));
      if (extra) return bad(extra, "unknown field: " + extra);
      if (b.op === "plans_for") return plansFor(b, w);
      if (b.op === "plans_list") return plansList(b, w);
      if (b.op === "status") {
        if (!w.active) return fail("forbidden");
        if (!w.admin) return fail("forbidden", null, "The OneDrive status is for admins.");
        return answer(200, { ok: true, grant: "folder", checks: ["token", "tenant_and_app", "grant_exactly_selected", "projects_folder",
          "top_level_only_projects", "users_refused"].map((n) => ({ name: n, ok: true })) });
      }
      const pid = b.project_id;
      if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return bad("project_id", "project_id must be a positive whole number");
      if (b.item_id !== undefined && (typeof b.item_id !== "string" || !/^[A-Za-z0-9!_.-]{8,128}$/.test(b.item_id))) {
        return bad("item_id", "item_id must be an item id from the list");
      }
      if (b.op === "plan_link" || b.op === "plan_save_session" || b.op === "plan_save_done" || b.op === "plan_save_commit") {
        if (typeof b.item_id !== "string") return bad("item_id", "item_id must be an item id from the list");
        if (b.op === "plan_save_session") return planSaveSession(b, w);
        if (b.op === "plan_save_commit") return planSaveCommit(b, w);
        if (b.op === "plan_save_done") return planSaveDone(b, w);
        return planLink(b, w);
      }
      const c = context(w, pid);
      if (c.refuse) return c.refuse;
      switch (b.op) {
        case "list": return list(c, b, w);
        case "download": return download(c, b);
        case "upload_session": return uploadSession(c, b, w);
        case "upload_done": return uploadDone(c, b, w);
        case "ensure_folder": {
          if (!c.make) return fail("forbidden");
          let pf = projectFolder(c.p), madeIt = false;
          if (!pf) {
            const m = makeProjectFolder(c);
            if (m.refuse) return m.refuse;
            pf = m.pf; madeIt = true;
          }
          return answer(200, Object.assign({ made_project_folder: madeIt }, standard(pf)));
        }
      }
      return fail("invalid");
    }

    function list(c, b, w) {
      const pp = parsePath(b.path, "path");
      if (pp.refuse) return pp.refuse;
      if (pp.segs.some((s) => hidden(s, c.v))) return fail("not_found");
      const base = { path: pp.segs.join("/"), can_upload: c.upload, can_make_folder: c.make };
      const pf = projectFolder(c.p);
      if (!pf) return answer(200, Object.assign({ folder_exists: false }, base, { entries: [], next: null }));
      const folder = lookup(pf, pp.segs);
      if (!folder || !folder.folder) return fail("not_found");
      let from = 0;
      if (b.cursor !== undefined && b.cursor !== null) {
        const t = unseal("cursor", b.cursor);
        if (!t || t.u !== w.uid || t.p !== c.p.id || t.f !== folder.id) return bad("cursor", "That page of the list has run out: list the folder again.");
        from = t.s;
      }
      const all = sorted(kids(folder.id, pf.pid)).filter((x) => !hidden(x.name, c.v));
      const page = all.slice(from, from + PAGE).map((x) => entry(x, c.v));
      const next = from + PAGE < all.length ? seal("cursor", { u: w.uid, p: c.p.id, f: folder.id, s: from + PAGE }, nowMs() + CURSOR_MS) : null;
      return answer(200, Object.assign({ folder_exists: true }, base, { entries: page, next }));
    }

    function contentOf(it) {
      if (bytes.has(it.id)) return bytes.get(it.id);
      const text = "Made-up demo file: " + it.name + "\n";
      return typeof Blob !== "undefined" ? new Blob([text], { type: it.mime || "application/octet-stream" }) : text;
    }
    function download(c, b) {
      const pf = projectFolder(c.p);
      if (!pf) return fail("not_found");
      const it = itemById(b.item_id);
      if (!it || it.folder || it.pid !== c.p.id) return fail("not_found");
      const names = namesOf(it, pf);
      if (!names || names.some((n) => hidden(n, c.v))) return fail("not_found");
      if (BLOCKED.includes(extOf(it.name))) return fail("not_downloadable");
      let url;
      if (browser) url = root.URL.createObjectURL(contentOf(it));
      else url = "https://" + HOST + "/__demo/dl/" + (++linkN) + "-" + it.id;
      links.set(url, { id: it.id, name: it.name });
      return answer(200, { url, name: it.name, size: it.size });
    }

    function uploadSession(c, b, w) {
      if (!c.upload) return fail("forbidden", null, 'Uploading to OneDrive needs the "Can upload to OneDrive" switch (an admin turns it on).');
      const top = ["Documents", "Floor Plans"].find((f) => typeof b.folder === "string" && same(f, b.folder.trim()));
      if (!top) return bad("folder", "folder must be Documents or Floor Plans");
      const dir = parsePath(b.rel_dir, "rel_dir", 120);
      if (dir.refuse) return dir.refuse;
      for (const s of dir.segs) {
        if (alwaysHidden(s) || hidden(s, c.v)) {
          return bad("rel_dir", "rel_dir has a folder named for prices or money (someone who sees prices uploads there)");
        }
      }
      if (top === "Documents" && dir.segs.length && same(dir.segs[0], "Items")) return bad("rel_dir", "An estimate item's files are added from the item in DCR Desktop 2.");
      if (1 + dir.segs.length > 12) return bad("rel_dir", "At most 11 folders below " + top + ".");
      if (typeof b.name !== "string") return bad("name", "name must be text");
      const name = nfc(b.name);
      const sp = segmentProblem(name, 200);
      if (sp) return bad("name", "The file name has " + sp + ".");
      if (alwaysHidden(name)) return bad("name", "Lock, temporary and system files are not uploaded.");
      const ext = extOf(name);
      if (!UPLOAD_EXTS.includes(ext) || (ext === "takeoff" && !c.v.prices)) return fail("file_type", { field: "name" });
      if (!c.v.prices && (anyStem(name) || quotesAmount(name))) {
        return bad("name", "Files named for estimates, quotes, bids, contracts or money, or with an amount in the name, are uploaded by someone who sees prices.");
      }
      if (!c.v.financials && stems(name).money) {
        return bad("name", "Files named for invoices, receipts, bills, payments or other money records are uploaded by someone who sees financials.");
      }
      if (typeof b.size !== "number" || !Number.isSafeInteger(b.size) || b.size < 1) return bad("size", "size must be the file's size in bytes");
      if (b.size > MAX_BYTES) return fail("too_large", { max_bytes: MAX_BYTES });
      const rel = [c.p.folder_name, top].concat(dir.segs, [name]).join("/");
      if (Array.from(rel).length > 340) return bad("name", "That path is too long for OneDrive and the project's file list: use a shorter name or fewer folders.");
      let pf = projectFolder(c.p);
      if (!pf) {
        const m = makeProjectFolder(c);
        if (m.refuse) return m.refuse;
        pf = m.pf;
        standard(pf);
      }
      let parent = pf;
      for (const s of [top].concat(dir.segs)) {
        let next = kids(parent.id, pf.pid).find((x) => same(x.name, s));
        if (next && !next.folder) return fail("not_a_folder");
        if (!next) next = newFolder(parent.id, s, pf.pid);
        parent = next;
      }
      const token = "s" + (++sessionN) + "-" + Math.random().toString(36).slice(2, 10);
      const exp = nowMs() + 24 * 3600 * 1000;
      sessions.set(token, { uid: w.uid, pid: c.p.id, parent: parent.id, name, size: b.size, offset: 0, parts: [], done: null, exp,
        modified: typeof b.modified === "string" && !isNaN(Date.parse(b.modified)) ? new Date(b.modified).toISOString() : null });
      const ticket = seal("ticket", { u: w.uid, p: c.p.id, d: parent.id, n: name, s: b.size, i: Math.floor(nowMs() / 1000) }, nowMs() + TICKET_MS);
      return answer(200, { upload_url: "https://" + HOST + "/__demo/up/" + token, expires_at: new Date(exp).toISOString(), chunk_bytes: CHUNK,
        chunk_multiple: UNIT, max_chunk_bytes: MAX_CHUNK, max_bytes: MAX_BYTES, ticket, name });
    }

    function uploadDone(c, b, w) {
      if (!c.upload) return fail("forbidden");
      const t = unseal("ticket", b.ticket);
      if (!t || t.u !== w.uid || t.p !== c.p.id) return bad("ticket", "This upload's ticket is not valid or has run out: upload the file again.");
      const pf = projectFolder(c.p);
      if (!pf) return fail("not_found");
      const it = itemById(b.item_id);
      if (!it || it.folder || it.pid !== c.p.id) return fail("not_found");
      const made = Date.parse(it.created || "");
      if (it.parent !== t.d || !it.app || !renamedFrom(it.name, t.n) || it.size !== t.s || !(made >= t.i * 1000 - SKEW_MS)) return fail("not_this_upload");
      const names = namesOf(it, pf);
      if (!names || names.length < 2 || !["Documents", "Floor Plans"].some((f) => same(f, names[0]))) return fail("not_this_upload");
      if (names.some((n) => hidden(n, c.v))) return fail("not_found");
      const out = { recorded: false, already: false, renamed: !same(it.name, t.n), name: it.name, size: it.size };
      const kind = same(names[0], "Documents") ? "documents" : "plans";
      const notRecorded = (reason) => answer(200, Object.assign(out, { reason, message: NOT_RECORDED[reason] }));
      if (names.length > 13 || names.slice(0, -1).some((n) => Array.from(n).length > 120)) return notRecorded("path_shape");
      if (kind === "documents" && names.length >= 3 && same(names[1], "Items")) return notRecorded("item_folder");
      if (names.some(anyStem)) return notRecorded("priced_name");
      if (names.some((n) => quotesAmount(n))) return notRecorded("amount_name");
      if (isTakeoff(it.name) && !w.prices) return fail("forbidden");
      const relPath = c.p.folder_name + "/" + names.join("/");
      const mine = rows.files.filter((f) => f.project_id === c.p.id && f.storage === "local" && String(f.rel_path || "").toLowerCase() === relPath.toLowerCase() &&
        f.created_by === w.uid && f.source === "portal2" && Number(f.size) === Number(it.size) && !f.deleted_at &&
        !rows.files.some((n) => n.previous_id === f.id && !n.deleted_at)).sort((x, y) => y.version_no - x.version_no || y.id - x.id)[0];
      if (mine) return answer(200, Object.assign(out, { recorded: true, already: true, file: { id: mine.id, version_no: mine.version_no } }));
      let row;
      try {
        row = E.insertAs(w, "files", { project_id: c.p.id, folder: kind, storage: "local", storage_path: null, rel_path: relPath, name: it.name,
          subpath: names.slice(0, -1).join("/"), size: it.size, mime: it.mime || null, modified_at: it.modified || null, source: "portal2" });
      } catch (e) {
        if (String(e && e.code) === "42501") return fail("forbidden");
        return answer(200, Object.assign(out, { reason: "invalid", message: "Saved in OneDrive, but it could not be added to the project's file list." }));
      }
      return answer(200, Object.assign(out, { recorded: true, file: { id: row.id, version_no: row.version_no } }));
    }

    /* ── the OneDrive host: the upload URLs (PUT / GET), and this tab's download links (a ranged GET) ── */
    function graphJson(status, body, headers) { return { status, headers: Object.assign({ "content-type": "application/json" }, headers || {}), body: body === null ? "" : JSON.stringify(body) }; }
    function http(method, url, headers, body) {
      const h = {};
      Object.keys(headers || {}).forEach((k) => { h[k.toLowerCase()] = headers[k]; });
      if (links.has(url)) {
        const l = links.get(url);
        const it = l.plan ? { mime: "application/octet-stream" } : itemById(l.id);
        const blob = l.plan ? planBytes(l.plan) : it ? contentOf(it) : null;
        if (!blob || method !== "GET") return graphJson(404, { error: { code: "itemNotFound" } });
        const r = /^bytes=(\d+)-(\d*)$/.exec(String(h.range || ""));
        const size = typeof blob === "string" ? blob.length : blob.size;
        if (!r) return { status: 200, headers: { "content-type": it.mime || "application/octet-stream" }, body: blob };
        const a = Number(r[1]), z = r[2] === "" ? size - 1 : Math.min(size - 1, Number(r[2]));
        return { status: 206, headers: { "content-range": "bytes " + a + "-" + z + "/" + size }, body: blob.slice(a, z + 1) };
      }
      let u;
      try { u = new URL(url); } catch (e) { return null; }
      if (u.hostname !== HOST) return null;
      const m = /^\/__demo\/up\/([A-Za-z0-9-]+)$/.exec(u.pathname);
      const s = m ? sessions.get(m[1]) : null;
      if (!s || s.done || s.exp < nowMs()) return graphJson(404, { error: { code: "itemNotFound", message: "The upload session was not found" } });
      const nextRanges = () => ({ expirationDateTime: new Date(s.exp).toISOString(), nextExpectedRanges: s.offset < s.size ? [s.offset + "-"] : [] });
      if (method === "GET") return graphJson(200, nextRanges());
      if (method !== "PUT") return graphJson(405, { error: { code: "invalidRequest" } });
      if (h.authorization) return graphJson(401, { error: { code: "unauthenticated", message: "An upload URL takes no Authorization header" } });
      const cr = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(h["content-range"] || ""));
      const len = body && typeof body.size === "number" ? body.size : body && typeof body.length === "number" ? body.length : 0;
      if (!cr || Number(cr[3]) !== s.size) return graphJson(400, { error: { code: "invalidRange" } });
      const a = Number(cr[1]), z = Number(cr[2]);
      if (a !== s.offset) return graphJson(416, Object.assign({ error: { code: "invalidRange" } }, nextRanges()));
      if (z - a + 1 !== len || len > MAX_CHUNK || (z + 1 < s.size && len % UNIT !== 0)) return graphJson(400, { error: { code: "invalidRange" } });
      s.parts.push(body);
      s.offset = z + 1;
      if (s.offset < s.size) return graphJson(202, nextRanges());
      if (s.plan) {
        during(s);
        // a deferred replace: its last chunk commits nothing (202, nothing more wanted) - plan_save_commit does; unless
        // the demo's OneDrive ignores deferCommit (graphModes): then the last chunk commits it, 200 with the driveItem
        if (s.deferred && graph.deferCommit !== "ignored") return graphJson(202, nextRanges());
        if (s.deferred) {
          const id = planSaveLanded(s);
          s.done = id;
          return graphJson(200, { id, name: s.name, size: s.size, file: { mimeType: "application/octet-stream" } });
        }
        // a plan's save back: the copy beside the plan - never a Projects-folder item
        const id = planSaveLanded(s);
        s.done = id;
        return graphJson(201, { id, name: s.name, size: s.size, file: { mimeType: "application/octet-stream" } });
      }
      const taken = new Set(kids(s.parent, s.pid).map((x) => nfc(x.name).toLowerCase()));
      let name = s.name;
      if (taken.has(nfc(name).toLowerCase())) {
        const dot = name.lastIndexOf(".");
        const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
        for (let n = 1; ; n++) if (!taken.has(nfc(base + " " + n + ext).toLowerCase())) { name = base + " " + n + ext; break; }
      }
      const it = keep({ id: "01DEMOU" + String(Date.now() % 1e9).padStart(9, "0") + "U" + (++made), parent: s.parent, name, folder: false, size: s.size,
        mime: MIME[extOf(name)] || "application/octet-stream", created: nowIso(), modified: s.modified || nowIso(), app: true, pid: s.pid });
      if (typeof Blob !== "undefined") bytes.set(it.id, new Blob(s.parts, { type: it.mime }));
      s.done = it.id;
      return graphJson(201, { id: it.id, name: it.name, size: it.size, file: { mimeType: it.mime }, parentReference: { id: s.parent },
        createdBy: { application: { id: APP, displayName: "DCR Portal OneDrive" } }, createdDateTime: it.created });
    }

    /** fake-supabase.js asks before it lets a request out: every address on the OneDrive host is answered here (an
        unknown one 404), and this tab's download links */
    function owns(url) {
      if (links.has(String(url))) return true;
      try { return new URL(String(url)).hostname === HOST; } catch (e) { return false; }
    }

    /** someone saves the plan at `full` in the office, in place (its id stays): other bytes (made-up, of another size), a
        version of their own - after any save this tab sent. -> that version */
    function officeSave(full) {
      const p = rows.projects.find((x) => !x.deleted_at && planFilesOf(x).some((f) => f.full === full));
      const f = p ? planFilesOf(p).find((x) => x.full === full) : null;
      if (!f) return null;
      keepVersion(full);
      fixtures.delete(full);
      savedBytes.delete(full);
      const at = nowIso();
      const n = nextId(TABLE);
      commitInsert(TABLE, { id: n, item_id: f.id, project_id: p.id, parent_id: null, name: f.name, folder: false, size: f.size + 7,
        mime: "application/octet-stream", created_at: at, modified_at: at, by_app: false, takeoff: full, version: "qx:demo-office-" + n });
      return "qx:demo-office-" + n;
    }
    /** the office's DESKTOP app saves the plan at `full`: it moves the item into the folder's Backups and writes a new
        item on the name (a new id; made-up bytes of another size, a version of their own). -> {id, version} */
    function desktopSave(full) {
      const p = rows.projects.find((x) => !x.deleted_at && planFilesOf(x).some((f) => f.full === full));
      const f = p ? planFilesOf(p).find((x) => x.full === full) : null;
      if (!f) return null;
      fixtures.delete(full);
      savedBytes.delete(full);
      const at = nowIso();
      const n = nextId(TABLE);
      const id = "01DEMOTKD" + String(n).padStart(9, "0");
      commitInsert(TABLE, { id: n, item_id: id, project_id: p.id, parent_id: "desktop-save", name: f.name, folder: false, size: f.size + 11,
        mime: "application/octet-stream", created_at: at, modified_at: at, by_app: false, takeoff: full, version: "qx:demo-desktop-" + n });
      return { id, version: "qx:demo-desktop-" + n };
    }
    const arms = new Map();              // path -> "office" | "desktop": done when the next save of it has all its bytes in
    function during(s) {
      const what = arms.get(s.full);
      if (!what) return;
      arms.delete(s.full);
      if (what === "desktop") desktopSave(s.full); else officeSave(s.full);
    }

    return { name: "p7-onedrive", tables: new Set([TABLE]), canRead: () => false, functions: ["onedrive"], invoke, http, owns,
      host: HOST, handles: () => false,
      /** plans_for's takeoff folder: false = not set up (503 takeoff_not_configured), true = there, null = the default */
      setTakeoff(on) { takeoffSet = on === null || on === undefined ? null : !!on; },
      /** the Plans Library: a takeoff file's new version ("<folder>/<path>", as the takeoff folder lists it) */
      setPlanVersion(full, version) { if (version) planVersions.set(full, version); else planVersions.delete(full); revs.set(full, (revs.get(full) || 0) + 1); },
      /** a browser e2e that drives the REAL takeoff app (tools/e2e-p7-plans.mjs): `blob`, a made-up but real .takeoff
          project, is the first plan of project `number` (or its plan called `name`) in this tab from now on - its bytes,
          size and a version of its own - until a save of it lands or the office saves it (officeSave).
          -> {id, name, full, size, version} | null */
      setPlanFixture(number, blob, name) {
        const p = rows.projects.find((x) => x.number === number && !x.deleted_at);
        const f = p ? (name ? planFilesOf(p).find((x) => x.name === name) || null : planFilesOf(p)[0]) : null;
        if (!f || !blob || !(blob.size > 0)) return null;
        keepVersion(f.full);
        fixtures.set(f.full, { size: blob.size, version: "qx:demo-fixture-" + blob.size, modified: nowIso() });
        savedBytes.set(f.full, blob);
        revs.set(f.full, (revs.get(f.full) || 0) + 1);
        const g = planFilesOf(p).find((x) => x.full === f.full);
        return { id: g.id, name: g.name, full: g.full, size: g.size, version: g.version };
      },
      /** the bytes the demo's OneDrive holds now for the takeoff file `itemId` (a plan or a copy of one), or null */
      planBlobOf(itemId) {
        for (const p of rows.projects.filter((x) => !x.deleted_at)) {
          const f = planFilesOf(p).find((x) => x.id === itemId);
          if (f) return planBytes(f);
        }
        return null;
      },
      /** the office saves the plan at `full` in place (officeSave above) -> that version */
      officeSave,
      /** the office's desktop app saves it as a new item (desktopSave above) -> {id, version} */
      desktopSave,
      /** the next save of the plan at `full` to have all its bytes in OneDrive's upload session meets an office save
          ("office") or a desktop save ("desktop") just then - while it goes up, before the broker's commit */
      duringUpload(full, what) { if (what) arms.set(full, what); else arms.delete(full); },
      /** Microsoft will not commit a session as the copy (plan_save_commit's plan_changed, the session dropped) */
      refuseCopyCommits(on) { refuseCopyCommit = !!on; },
      /** the broker's switch ONEDRIVE_PLAN_SAVE in this tab ("off", "only:A267", "all"; null: the browser demo's
          localStorage "dcr2-demo-plan-save", else "all") */
      setPlanSave(v) { planSaveSet = v === undefined || v === null ? null : String(v); },
      /** what the demo's Microsoft does where its pages leave it open (see GRAPH): the modes given, the others as they
          were (reset: true - every one back to the documented way) -> the modes now */
      graphModes(o) { if (o && o.reset) Object.assign(graph, GRAPH); Object.keys(o || {}).forEach((k) => { if (k in GRAPH) graph[k] = o[k]; }); return Object.assign({}, graph); },
      /** the next commit of the plan at `full` meets an office save between its walk and its commit - or, on "self",
          this very session committed by another request of the device's just then (its retry while the first still ran) */
      betweenWalkAndCommit(full, on) { if (on === false) between.delete(full); else between.set(full, on === "self" ? "self" : "office"); },
      /** the broker's own clock runs `ms` ahead of the demo's from now on (0: with it again) - OneDrive's 30 minutes
          without a hash (HASH_WAIT_MS) gone by, in a walk that cannot wait them -> the ms ahead */
      passTime(ms) { ahead = Math.max(0, Number(ms) || 0); return ahead; },
      /** the office copies a plan into a project's folder (the house model in two lots' folders, contract addendum 4
          E4): project `number`'s first takeoff folder gets a .takeoff named `name` (this tab; made-up bytes until a
          fixture is set) -> its file {id, name, folder, full, size, version}, or null */
      addPlanFile(number, name) {
        const p = rows.projects.find((x) => x.number === number && !x.deleted_at);
        if (!p || typeof name !== "string" || !/\.takeoff$/i.test(name) || name.indexOf("/") !== -1) return null;
        const names = candidates(takeoffFolders().map((x) => x.name), p.number);
        const folder = takeoffFolders().find((x) => names.includes(x.name));
        if (!folder) return null;
        if (folder.files.indexOf(name) === -1) folder.files.push(name);
        const g = planFilesOf(p).find((x) => x.folderName === folder.name && x.name === name);
        return g ? { id: g.id, name: g.name, folder: g.folder, full: g.full, size: g.size, version: g.version } : null;
      },
      /** the plan `itemId`'s versions as Graph lists them (newest first), or null */
      versionsOf(itemId) {
        for (const p of rows.projects.filter((x) => !x.deleted_at)) {
          const f = planFilesOf(p).find((x) => x.id === itemId);
          if (f) return versionsOf(f);
        }
        return null;
      },
      /** the broker's log lines of the save back (oldest first; clear: true - emptied after) */
      logLines(clear) { const out = logs.slice(); if (clear) logs.length = 0; return out; },
      /** the demo's OneDrive has hashed every save that landed (their "qx:" versions are there) */
      hashed() { return hashing; } };
  });

  /* ── made-up data: the switch for two people, the admin's test project ── */
  (NS.extSeed = NS.extSeed || []).push(function seedOneDrive(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    out[TABLE] = out[TABLE] || [];
    // the OneDrive upload switch (D2): an admin always; Quinn Manager (prices) and Riley Lead have it (as tools/fake/
    // p7-web.js seeds them); a switch an earlier extension set is kept
    (out.profiles || []).forEach((p) => {
      if (p.role === "admin") p.can_upload_onedrive = true;
      else if (p.role === "agents") p.can_upload_onedrive = false;
      else if (typeof p.can_upload_onedrive !== "boolean") p.can_upload_onedrive = p.id === P.manager_prices || p.id === P.lead;
    });
    // the owner's test project for the admin's self-test (docs/ONEDRIVE.md §13), never a real one
    if (out.projects && !out.projects.some((p) => p.number === TEST_PROJECT.number)) {
      const id = out.projects.reduce((m, p) => Math.max(m, p.id), 0) + 1;
      const at = new Date(now.getTime() - 90 * 86400000).toISOString();
      const audit = { created_at: at, created_by: P.admin, updated_at: at, updated_by: null, version: 1 };
      out.projects.push(Object.assign({ id, number: TEST_PROJECT.number, name: TEST_PROJECT.name, address: TEST_PROJECT.address, city: TEST_PROJECT.city,
        state: "CA", zip: "93401", client_contact_id: null, client_name: "Test client", client_phone: null, client_email: null, status: "new_request",
        status_note: null, scope: "Test project for the OneDrive self-test", tags: [], plans_url: null, start_date: null, completed_date: null,
        lat: null, lng: null, location_source: null, thumbnail_file_id: null,
        folder_name: [TEST_PROJECT.number, TEST_PROJECT.address, TEST_PROJECT.city, TEST_PROJECT.name].join(" - "), legacy_sp_id: null, deleted_at: null }, audit));
      (out.project_prices = out.project_prices || []).push(Object.assign({ project_id: id, labor_rate: 90, rate_source: "local" }, audit));
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
