/* DCR Portal 2 — DEMO MODE ONLY: the Books program's money files (DCR Desktop 2 migration 20261030000100_money_files,
   docs/DATABASE.md §31; the build plan's decisions I1-I4 and I37) in the in-memory database, read and written by the
   bill page's paperwork, the expense dialog, a project's Expenses tab, the ledger and (release A) the payment panel.
   Loaded BEFORE engine.js and AFTER tools/fake/p5b-books.js (whose bills and payments it reads); installed into each
   engine (NS.extInstall), answering the engine's file hooks (fileHook: filesBeforeInsert, filesCanDelete,
   filesBeforeRemove, filesGuardUpdate). Never published (tools/ is not part of the site).

   The same names and rules as the migration:
   * files.payment_id: a payment's file is a file of the payment's OWN bill (bill_id) in the receipts folder, never a
     cost's receipt (files_payment_link, 23514); only a money editor attaches one (42501), the payment of that very
     bill and project (23514 "the payment belongs to another bill" - the same sentence for a payment of a job the
     person cannot see); a person never moves it, nor a file's bill (42501);
   * a cloud file with bill_id, cost_id or payment_id is NEVER a version: its own row (version 1, no previous_id), its
     name made unique among its live siblings (the same project, bill, cost and payment): "image.jpg" taken becomes
     "image (2).jpg" (app.unique_file_name: " (n)" before an extension of at most 20 characters, the stem cut so the
     name stays <= 255, any case); the row that comes back carries it;
   * a person's money file has a safe shape (t14_files_money_shape, 22023 "this kind of file can't be attached to
     money: save it as a PDF or a picture", the detail naming the rule): f/<project>/<folder>/<32 hex>/<slug> (the
     preview too), a name with no control or bidi character, an extension DCR Desktop 2 opens;
   * money editors (an admin, or a manager or accountant with financials) remove ANY money file of a job they see (a
     soft delete); the document of a live bill that is entered in QuickBooks, paid or approved stays - for everyone
     (t40_files_money_guard, 23514, a sentence for each).
   No made-up rows are added: the column is filled in (NULL) on the seed's files. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  // DCR Desktop 2 backend/files.py OPENABLE_EXTS, as the migration lists them
  const OPENABLE = ["pdf", "jpg", "jpeg", "png", "gif", "bmp", "webp", "heic", "heif", "tif", "tiff", "jfif",
    "mp4", "mov", "m4v", "avi", "3gp", "mkv", "wmv", "mp3", "m4a", "wav", "aac", "ogg", "oga", "weba", "flac", "webm",
    "dwg", "dxf", "dwf", "rvt", "skp", "doc", "docx", "rtf", "odt", "xls", "xlsx", "csv", "ods", "ppt", "pptx", "odp",
    "txt", "md", "log", "takeoff", "pdfnotes", "eml", "msg", "zip"];
  const SHAPE = "this kind of file can't be attached to money: save it as a PDF or a picture";
  const KEY = /^[^/]*\/[^/]*\/[^/]*\/[0-9a-f]{32}\/[A-Za-z0-9._ ()-]{1,120}$/;
  const BAD_CHAR = /[\u0001-\u001f\u007f‎‏‪-‮⁦-⁩]/;
  NS.p8FilesOpenable = OPENABLE;

  /** app.unique_file_name(p_name, p_taken): a name not in `taken` (any case). */
  function uniqueName(name, taken) {
    const low = new Set((taken || []).filter((t) => t !== null && t !== undefined).map((t) => String(t).toLowerCase()));
    if (name === null || name === undefined || !low.has(String(name).toLowerCase())) return name;
    const m = /^\.*[^.].*(\.[^.]*)$/.exec(name);
    let ext = m ? m[1] : "";
    if (ext.length > 20) ext = "";
    const stem = name.slice(0, name.length - ext.length);
    let tryName = name;
    for (let n = 2; low.has(tryName.toLowerCase()) && n < 10000; n++) {
      tryName = stem.slice(0, 255 - ext.length - String(n).length - 3) + " (" + n + ")" + ext;
    }
    return tryName;
  }
  NS.uniqueFileName = uniqueName;

  /** The extension as DCR Desktop 2's can_open finds it (trimmed, trailing dots and spaces off, Python's splitext). */
  function extOf(name) {
    let b = String(name || "").replace(/^\s+|\s+$/g, "").replace(/[. ]+$/, "");
    b = b.replace(/^.*\\/, "");
    const m = /^\.*[^.].*\.([^.]*)$/.exec(b);
    return m ? m[1].toLowerCase() : null;
  }

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, COLS, PgErr, deny, rule, projectVisible } = E;
    if (COLS.files && !("payment_id" in COLS.files)) COLS.files.payment_id = null;      // current_files shares the object
    if (!rows.bills || !rows.payments) return null;

    // app.can_edit('money')
    const moneyEditor = (w) => w.active && (w.admin || ((w.role === "manager" || w.role === "accountant") && w.financials));
    const isMoney = (r) => r.bill_id !== null && r.bill_id !== undefined || (r.cost_id !== null && r.cost_id !== undefined) ||
      (r.payment_id !== null && r.payment_id !== undefined);
    const paidOn = (id) => rows.payments.filter((p) => p.bill_id === Number(id) && !p.voided_at).reduce((s, p) => s + Number(p.amount || 0), 0);

    function shape(r, old) {
      const dir = "f/" + r.project_id + "/" + r.folder + "/";
      const judged = (k) => !old || r[k] !== old[k];
      let what = null;
      const bad = (k) => !!r[k] && String(r[k]).indexOf(dir) === 0 && (!KEY.test(String(r[k])) || /^\./.test(String(r[k]).split("/")[4] || ""));
      if (judged("storage_path") && bad("storage_path")) what = "the storage key";
      else if (r.preview_path && judged("preview_path") && bad("preview_path")) what = "the preview key";
      else if (r.name && judged("name")) {
        if (BAD_CHAR.test(r.name)) what = "the name";
        else { const e = extOf(r.name); if (!e || OPENABLE.indexOf(e) === -1) what = "the file type"; }
      }
      if (what) throw Object.assign(rule("22023", SHAPE), { details: what });
    }

    function guard(old) {
      for (const b of rows.bills.filter((x) => x.document_file_id === old.id && !x.deleted_at && !x.void).sort((a, c) => a.id - c.id)) {
        if (b.qbo_entered_at) throw rule("23514", "this file is the document of a bill entered in QuickBooks: it stays while the bill is marked entered");
        if (paidOn(b.id) > 0) throw rule("23514", "this file is the document of a paid bill: it stays with the bill's payments");
        if (b.approved_at) throw rule("23514", "this file is the approved document of a bill: replace the document first (that withdraws the approval), or void the bill");
      }
    }

    return {
      name: "p8-files", tables: new Set(), canRead: () => false,
      /* before the version chain: true when this is a money file (its own row, its name unique) */
      filesBeforeInsert(w, r, o) {
        const quiet = !!(o && o.quiet);
        const person = !quiet && !!w.uid;
        if (r.payment_id !== null && r.payment_id !== undefined) {
          if (r.bill_id === null || r.bill_id === undefined || r.folder !== "receipts" || (r.cost_id !== null && r.cost_id !== undefined)) {
            throw rule("23514", 'new row for relation "files" violates check constraint "files_payment_link"');
          }
          if (person && !moneyEditor(w)) throw deny("only an admin, or a manager or accountant who sees financials, attaches a file to a payment");
          const p = rows.payments.find((x) => x.id === Number(r.payment_id));
          if (!p || p.bill_id !== Number(r.bill_id) || p.project_id !== Number(r.project_id) || (person && !projectVisible(w, r.project_id))) {
            throw rule("23514", "the payment belongs to another bill");
          }
          r.payment_id = Number(r.payment_id);
        }
        if (r.bill_id !== null && r.bill_id !== undefined) {
          const b = rows.bills.find((x) => x.id === Number(r.bill_id));
          if (!b || b.project_id !== Number(r.project_id) || b.deleted_at) throw rule("23514", "the bill belongs to another project");
          r.bill_id = Number(r.bill_id);
        }
        if (r.storage !== "cloud" || !isMoney(r)) {
          if (person && r.storage === "cloud" && r.folder === "receipts" && moneyEditor(w)) shape(r, null);
          return false;
        }
        const taken = rows.files.filter((f) => !f.deleted_at && f.storage === "cloud" && f.project_id === Number(r.project_id) &&
          (f.bill_id ?? null) === (r.bill_id ?? null) && (f.cost_id ?? null) === (r.cost_id ?? null) &&
          (f.payment_id ?? null) === (r.payment_id ?? null)).map((f) => f.name);
        r.name = uniqueName(r.name, taken);
        if (person && moneyEditor(w)) shape(r, null);
        return true;
      },
      /* "files: money editors remove money files" */
      filesCanDelete(w, r) {
        return !!(r.is_financial && moneyEditor(w) && projectVisible(w, r.project_id));
      },
      /* t40_files_money_guard: before the soft delete, for everyone */
      filesBeforeRemove(w, old) { guard(old); return undefined; },
      /* t10_files_update: a file's bill and payment stay; t40 on an update that sets deleted_at; t14 on a rename */
      filesGuardUpdate(w, old, r, patch, o) {
        const person = !(o && o.quiet) && !!w.uid;
        const p = patch || {};
        for (const k of ["bill_id", "payment_id"]) {
          if (person && k in p && (p[k] === null || p[k] === undefined ? null : Number(p[k])) !== (old[k] ?? null)) {
            throw deny("only the name and the item / journal links of a file can change");
          }
        }
        if ("deleted_at" in p && p.deleted_at && !old.deleted_at) guard(old);
        if (person && "name" in p && (isMoney(old) || old.folder === "receipts") && old.storage === "cloud") shape(r, old);
        return undefined;
      },
    };
  });

  /* the seed's files: the new column, NULL (no made-up row is added) */
  (NS.extSeed = NS.extSeed || []).push(function seedMoneyFiles(out) {
    (out.files || []).forEach((f) => { if (!("payment_id" in f)) f.payment_id = null; });
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
