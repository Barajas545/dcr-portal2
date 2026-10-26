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
     left out, an admin's too) with the count of .takeoff files at any depth in its folder(s) of the takeoff folder
     ("Projects-Takeoff-Files": "<number> - <address> - <city>", DCR Desktop 2's folder_candidates - a suffix number's
     folder is its own; "Materials Catalog" is nobody's) - never a name, an item id or a link; 503
     takeoff_not_configured while the demo's takeoff folder is switched off (setTakeoff(false) in node; in a browser
     localStorage "dcr2-demo-takeoff" = "off").
   The takeoff folder (made up, the same every time): A267 three .takeoff files 1 to 3 folders down (and an autosave, a
   PDF and plan notes, never counted); A024 one and A024-B two (apart); A120 one in its folder and one in an older second
   folder; the other A### numbers by their last digit: ending in 0 or 5 one, in 2 or 7 two, in 3 or 8 a folder with
   PDFs and an autosave only (0); the rest no folder.
   The drive: /Projects with a made-up folder for most projects (folder_name), seeded the same way every time and
   built when first asked (Floor Plans with sheets, a level, a takeoff and plan notes; Photos/<a day>; Documents with
   permits, a contract, an estimate quoting an amount, invoices, a program, a lock file; the old portal's copy);
   A304 has only a folder of another name (other_folder), A305 and the test project A000T2 (added here for the
   admin's self-test) none yet. What people add (uploads, folders made) is a row of demo_onedrive_items - a demo-only
   table nobody reads (no policy), so it is kept with the demo's changes and reaches the other tabs - and its bytes
   stay in this tab's memory. Made-up names only. */
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
      created_at: null, modified_at: null, by_app: false } },
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
  };
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
    const { rows, COLS: ECOLS, clone, nowIso, who, canEdit, nextId, commitInsert } = E;
    if (!rows[TABLE]) return null;
    if (ECOLS.profiles && !("can_upload_onedrive" in ECOLS.profiles)) ECOLS.profiles.can_upload_onedrive = false;
    const secret = "demo-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const sessions = new Map();          // token -> the upload session (this tab)
    const bytes = new Map();             // item id -> Blob (this tab)
    const links = new Map();             // a download link -> {id, name} (this tab)
    let sessionN = 0, linkN = 0;
    const browser = typeof root.document !== "undefined" && root.URL && typeof root.URL.createObjectURL === "function";
    const nowMs = () => Date.parse(nowIso());

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
      return rows[TABLE].map((r) => ({ id: r.item_id, parent: r.parent_id, name: r.name, folder: !!r.folder, size: r.size, mime: r.mime,
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
          out.push({ name: at, files: ["Plans/A267 Bid.takeoff", "Plans/A267 Bid.takeoff.autosave", "Plans/A1 - Floor plan.pdf",
            "Plans/Rev 2/A267 Rev 2.takeoff", "Plans/Rev 2/Level 1/L1 walls.takeoff", "Plans/Rev 2/Level 1/L1 walls.pdfnotes"] });
        } else if (n === "A024") out.push({ name: at, files: ["A024 Framing.takeoff", "A024 plans.pdf"] });
        else if (n === "A024-B") out.push({ name: at, files: ["Plans/A024-B Framing.takeoff", "Plans/A024-B Roof.takeoff"] });
        else if (last === 0) out.push({ name: at, files: ["Plans/" + n + " Bid.takeoff", "Plans/" + n + " plans.pdf"] });
        else if (last === 2) out.push({ name: at, files: ["Plans/" + n + " Bid.takeoff", "Plans/Rev 1/" + n + " Rev 1.TAKEOFF"] });
        else if (last === 3) out.push({ name: at, files: ["Plans/" + n + " plans.pdf", "Plans/" + n + " Bid.takeoff.autosave"] });
        if (n === "A120") out.push({ name: "A120 - older plans", files: ["A120 First bid.takeoff"] });
      }
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
          .reduce((sum, f) => sum + f.files.filter((x) => /\.takeoff$/i.test(x)).length, 0);
        projects[String(id)] = { number: p.number, plans };
      }
      return answer(200, { projects, checked_at: nowIso() });
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
        upload_done: ["item_id", "ticket"], ensure_folder: [], status: [], plans_for: ["project_ids"] };
      if (!Object.prototype.hasOwnProperty.call(ops, b.op)) return bad("op", "op must be one of " + Object.keys(ops).join(", "));
      const allowed = ["op"].concat(b.op === "status" || b.op === "plans_for" ? [] : ["project_id"], ops[b.op]);
      const extra = Object.keys(b).find((k) => !allowed.includes(k));
      if (extra) return bad(extra, "unknown field: " + extra);
      if (b.op === "plans_for") return plansFor(b, w);
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
        const it = itemById(l.id);
        const blob = it ? contentOf(it) : null;
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
      const nextRanges = () => ({ expirationDateTime: new Date(s.exp).toISOString(), nextExpectedRanges: [s.offset + "-"] });
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

    return { name: "p7-onedrive", tables: new Set([TABLE]), canRead: () => false, functions: ["onedrive"], invoke, http, owns,
      host: HOST, handles: () => false,
      /** plans_for's takeoff folder: false = not set up (503 takeoff_not_configured), true = there, null = the default */
      setTakeoff(on) { takeoffSet = on === null || on === undefined ? null : !!on; } };
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
