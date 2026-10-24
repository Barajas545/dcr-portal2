/* DCR Portal 2 — DEMO MODE ONLY: the subcontractor form's side of migration M5c (20261027000100_office_lists.sql) and
   the public Edge Function "subform" (DCR Desktop 2 supabase/functions/subform) in the in-memory database, used by
   submit.html (no sign-in) and submissions.html. Loaded BEFORE engine.js and AFTER tools/fake/p5b-books.js (its accept
   files bills and change orders into their tables); installed into each engine (NS.extInstall). Never published.

   As migration M5c has them (BLUEPRINT 3.3.11, Appendix D, P5 acceptance checks 4 and 5):
   * sub_submissions (reference, kind invoice | change_order, state pending | accepted | rejected, project_id,
     project_label, vendor and contact, invoice number, amount, dates, description, signature_name / signed_at /
     signature_path, document_path / _name / _size / _mime / _attached_at, submitted_ip / _agent, reviewed_by / _at,
     review_note, bill_id, quote_id, document_file_id): written ONLY by the function; read by the money editors (an
     admin, or a manager or accountant with the financials switch); nobody writes a row directly (42501 / nothing
     matched); the review goes through
     rpc accept_submission(p_id, p_version, p_quote_id) -> the row: money editors (42501); a reviewed one "already done"
     (23514) whatever the version; the version as shown (PT409); an invoice needs its document attached (23514) and
     becomes a bill (kind Subcontractor, NOT approved, p_quote_id of the same job or nothing) whose document is a new
     receipts file (source subform); a change order becomes quotes (kind change_order, status awarded) + quote_prices
     (the amount and the words), p_quote_id refused (22023);
     rpc reject_submission(p_id, p_version, p_note) -> the row (the note one line, at most 300);
     rpc sub_submission_notices(p_ids) -> [{id, state sent | waiting | not_sent, sentAt, why}]: money editors (42501);
   * a new submission queues notifications_outbox rows (kind sub_submission, submission_id, submission_ids) to every
     active admin, accountant WITH financials and approver (a manager with the approve switch and financials), each once,
     e-mail only - ONE waiting notice per person (a later submission is folded into the person's notice nobody has taken
     yet); the body names the job, the reference, the sender AS TYPED, NOT VERIFIED (links and addresses removed) and the
     link - never the amount or the description (P5 acceptance check 5); settings.sub_email_enabled off: one row, set
     aside; nobody to tell: one row, set aside;
   * Storage: the anonymous upload lands in the private inbox (subform-inbox: 25 MB, a photo, scan or PDF, nobody reads
     it - kept here in the extension, not in the engine's project-files objects); "attached" checks it and copies it into
     project-files; a submission's signature, and its document once attached, are readable by whoever reads the
     submission (M5c's app.storage_can_read); nobody uploads there but the function (its signed upload: fake-supabase.js
     uploadToSignedUrl -> signedUpload here, the token minted for that path in that bucket, once, never over an object);
   * the function "subform" (engine.invoke with no sign-in; an upload never announced as attached is swept once its URL
     ran out): op projects (subform_projects: open jobs only - not deleted,
     not completed or closed -, every word matching the number, name, address, city or the client - searched, never
     returned -, at least 3 characters, at most 8: id, number, name, address, city), op submit (the handler's checks and
     messages: the honeypot, the amount 0 < x <= 5,000,000, a real PNG signature, the declaration, an open job; the
     signature stored at f/{job}/receipts/{uuid}/; ONE signed upload for the paperwork, its path kept as the row's
     document_path), op attached (that exact path, a real object of the announced type and an allowed size, once, while
     pending); the rate limits per this browser ("the caller's address": 198.51.100.23, a documentation address) and
     for the form as a whole.
   Made-up data only: an invoice waiting with its paperwork, one waiting without (it cannot be accepted), a change
   order waiting, and one rejected, on three made-up open jobs. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const SIGS = {
    accept_submission: ["p_id", "p_version", "p_quote_id"],
    reject_submission: ["p_id", "p_version", "p_note"],
    sub_submission_notices: ["p_ids"],
  };
  const OPTIONAL = { accept_submission: ["p_quote_id"], reject_submission: ["p_note"], sub_submission_notices: [] };
  const INBOX = "subform-inbox";
  const UPLOAD_STALE_MS = (2 * 3600 + 15 * 60) * 1000;
  NS.p5cSubSigs = SIGS;
  const DEMO_IP = "198.51.100.23";
  const OPEN_OUT = ["completed", "closed"];
  const DOC_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp" };
  const MAX_DOC = 25 * 1024 * 1024, MAX_SIG = 400 * 1024, MAX_AMOUNT = 5000000;
  const RATE = { projects: [60, 600], submit: [10, 3600], attached: [20, 3600], submitAll: [120, 3600] };
  const REF_ALPHABET = "23456789CDFGHJKMNPQRTVWXY";
  const SITE = "https://portal.dcrframing.com";
  const M = {
    bot: "That submission could not be accepted.",
    notOpen: "That project is not open for submissions. Search for it again.",
    badDocument: "That file cannot be accepted. Send a photo, a scan or a PDF of up to 25 MB.",
    unknownReference: "Unknown reference.",
    reviewed: "That submission has already been reviewed.",
    alreadyAttached: "A document is already attached to that submission.",
    noDocument: "That document could not be found.",
    rateLimited: "Too many tries from this connection. Wait a while and try again.",
    busy: "The form is very busy just now. Wait a while and try again.",
    received: "Received. Keep this reference.",
  };

  const COLS = {
    sub_submissions: { id: null, reference: null, kind: "invoice", state: "pending", project_id: null, project_label: null, vendor_company: null,
      contact_name: null, contact_email: null, contact_phone: null, invoice_number: null, amount: null, description: null, invoice_date: null,
      due_date: null, signature_name: null, signed_at: null, signature_path: null, document_path: null, document_name: null, document_size: null,
      document_mime: null, document_attached_at: null, submitted_ip: null, submitted_agent: null, reviewed_by: null, reviewed_at: null,
      review_note: null, bill_id: null, quote_id: null, document_file_id: null },
  };
  (NS.extTables = NS.extTables || []).push({
    tables: ["sub_submissions"], cols: COLS, pk: {}, uuid: [], noAudit: [],
    fks: [["sub_submissions", "project_id", "projects"], ["sub_submissions", "bill_id", "bills"], ["sub_submissions", "quote_id", "quotes"],
      ["sub_submissions", "document_file_id", "files"]],
  });

  /* ── the pure rules (handler.ts's, in plain JS) ─────────────────────────────────────────────── */
  const text = (v, cap) => String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim().slice(0, cap || 255);
  const oneLine = (v) => { const s = text(v, 100000); return s || null; };
  // eslint-disable-next-line no-control-regex
  const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
  const longText = (v, cap) => String(v === null || v === undefined ? "" : v).replace(/\r\n?/g, "\n").replace(CTRL, "").trim().slice(0, cap || 4000);
  function cleanKind(v) { const s = String(v || "").trim().toLowerCase(); return s === "invoice" ? "Invoice" : s === "change order" ? "Change order" : ""; }
  function amount(v) {
    const raw = String(v === null || v === undefined ? "" : v).replace(/[$,\s]/g, "");
    if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT ? Math.round(n * 100) / 100 : null;
  }
  function dateKey(v) {
    const s = String(v || "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
    const [y, m, d] = s.split("-").map(Number);
    if (y < 2000 || y > 2100) return "";
    return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s ? s : "";
  }
  function email(v) { const s = text(v, 200).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : ""; }
  function signatureBytes(dataUrl) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
    if (!m) return null;
    const b64 = m[1].replace(/\s+/g, "");
    if (b64.length > Math.ceil(MAX_SIG / 3) * 4) return null;
    let bin = "";
    try { bin = atob(b64); } catch (e) { return null; }
    const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!bin.length || bin.length > MAX_SIG || magic.some((b, i) => bin.charCodeAt(i) !== b) || bin.length < 200) return null;
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function documentMeta(meta) {
    const mime = String((meta && meta.type) || "").toLowerCase().split(";")[0].trim();
    const ext = DOC_TYPES[mime];
    const size = Number((meta && meta.size) || 0);
    return ext && Number.isFinite(size) && size > 0 && size <= MAX_DOC ? { mime, ext, size } : null;
  }
  const fileName = (ref, kind, ext, suffix) => "SUB " + (kind === "change_order" || kind === "Change order" ? "CHANGE-ORDER" : "INVOICE") + " " + ref + (suffix ? " " + suffix : "") + "." + ext;
  const isReference = (v) => /^SUB-[23456789CDFGHJKMNPQRTVWXY]{4}-[23456789CDFGHJKMNPQRTVWXY]{4}$/.test(String(v || "").trim().toUpperCase());
  const extOf = (name) => { const m = /\.([a-z0-9]+)$/.exec(String(name || "")); return m ? m[1] : ""; };
  function randomBytes(n) {
    const a = new Uint8Array(n);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    return a;
  }
  function newReference() {
    const b = randomBytes(8);
    let out = "";
    for (let i = 0; i < 8; i++) out += REF_ALPHABET[b[i] % REF_ALPHABET.length];
    return "SUB-" + out.slice(0, 4) + "-" + out.slice(4);
  }
  const uid32 = () => Array.from(randomBytes(16)).map((x) => x.toString(16).padStart(2, "0")).join("");
  function validate(b) {
    if (text(b.website, 100)) return { ok: false, errors: [M.bot], bot: true };
    const errors = [];
    const kind = cleanKind(b.kind);
    if (!kind) errors.push("Choose whether this is an invoice or a change order.");
    const pid = String(b.projectId === null || b.projectId === undefined ? "" : b.projectId).trim();
    if (!/^[1-9]\d{0,14}$/.test(pid)) errors.push("Pick the project this is for.");
    const vendor = text(b.vendorCompany, 200);
    if (vendor.length < 2) errors.push("Enter your company name.");
    const contact = text(b.contactName, 120);
    if (contact.length < 2) errors.push("Enter your name.");
    const mail = email(b.email);
    if (!mail) errors.push("Enter an email address we can reply to.");
    const amt = amount(b.amount);
    if (amt === null) errors.push("Enter the amount as a number, up to 5,000,000.");
    const desc = longText(b.description, 4000);
    if (desc.length < 5) errors.push(kind === "Change order" ? "Describe the extra work and why it is needed." : "Describe what the invoice is for.");
    const signed = text(b.signatureName, 120);
    if (signed.length < 2) errors.push("Type your full name to sign.");
    const sig = signatureBytes(b.signature);
    if (!sig) errors.push("Sign in the box before submitting.");
    if (b.agree !== true) errors.push("Confirm the declaration before submitting.");
    if (errors.length) return { ok: false, errors };
    return { ok: true, v: { kind, projectId: Number(pid), vendor, contact, email: mail, phone: text(b.phone, 40), invoiceNumber: text(b.invoiceNumber, 60),
      amount: amt, description: desc, invoiceDate: dateKey(b.invoiceDate), dueDate: dateKey(b.dueDate), signatureName: signed, sig } };
  }

  function install(E) {
    const { rows, COLS: ALL, PgErr, deny, rule, nowIso, today, clone, nextId, auditInsert, auditUpdate, commitInsert, commitUpdate, projectVisible, readable } = E;
    if (!rows.sub_submissions || !rows.bills || !rows.quotes) return null;
    if (ALL.notifications_outbox && !("submission_id" in ALL.notifications_outbox)) ALL.notifications_outbox.submission_id = null;
    if (ALL.notifications_outbox && !("submission_ids" in ALL.notifications_outbox)) ALL.notifications_outbox.submission_ids = null;
    const tables = new Set(["sub_submissions"]);
    const SERVICE = { uid: null, active: false, admin: false };
    const moneyEditor = (w) => !!w && w.active && (w.admin || ((w.role === "manager" || w.role === "accountant") && w.financials));
    const subOf = (id) => rows.sub_submissions.find((s) => s.id === Number(id)) || null;
    const projectOf = (id) => rows.projects.find((p) => p.id === Number(id)) || null;
    const open = (p) => !!p && !p.deleted_at && !p.completed_date && OPEN_OUT.indexOf(p.status) === -1;
    const rate = new Map();
    const tokens = new Map();      // token -> {path, used}
    const inbox = new Map();       // the private bucket subform-inbox: path -> {size, mime, blob, at}

    function canRead(w, table) { return table === "sub_submissions" && moneyEditor(w); }
    function canInsert() { return false; }
    function canUpdate() { return false; }
    function canDelete() { return false; }

    /* Storage: the objects a submission names (M5c's app.storage_can_read): its signature, and its document only once
       "attached" copied it out of the inbox */
    function ownsObject(key) { return rows.sub_submissions.some((s) => s.signature_path === key || s.document_path === key); }
    function canReadObject(w, key) {
      return readable(w, "files").some((f) => f.storage_path === key || f.preview_path === key) ||
        (moneyEditor(w) && rows.sub_submissions.some((s) => s.signature_path === key || (s.document_path === key && !!s.document_attached_at)));
    }
    function canUploadObject() { return false; }

    function checkArgs(name, args) {
      const keys = Object.keys(args || {});
      const want = SIGS[name];
      if (keys.some((k) => want.indexOf(k) === -1) || want.some((k) => keys.indexOf(k) === -1 && OPTIONAL[name].indexOf(k) === -1)) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404);
      }
    }
    function write(w, table, old, patch) {
      const r = Object.assign(clone(old), patch);
      auditUpdate(w, table, r, old);
      commitUpdate(table, old, r);
      return r;
    }
    function add(w, table, r) {
      const base = ALL[table] || {};
      const row = Object.assign(clone(base), r);
      if ("id" in base && (row.id === null || row.id === undefined)) row.id = nextId(table);
      auditInsert(w, table, row);
      commitInsert(table, row);
      return row;
    }
    const nameOf = (uid) => { const p = rows.profiles.find((x) => x.id === uid); return p ? (p.full_name || p.email) : ""; };

    /* app.sub_review_lock: a money editor; the row; reviewed -> "already done" (23514) whatever the version; the version */
    function reviewLock(w, a) {
      if (!moneyEditor(w)) throw deny("only an admin, or a manager or accountant who sees financials, reviews subcontractor submissions");
      const s = subOf(a.p_id);
      if (!s) throw new PgErr("PT404", "That submission no longer exists.", 404);
      if (s.state !== "pending") {
        const who = nameOf(s.reviewed_by);
        throw rule("23514", "already done: that submission was already " + s.state + (who ? " by " + who : ""));
      }
      if (a.p_version === null || a.p_version === undefined || Number(a.p_version) !== Number(s.version)) {
        throw new PgErr("PT409", "the submission was changed by someone else", 409, JSON.stringify({ table: "sub_submissions", id: s.id, version: s.version }));
      }
      return s;
    }

    function rpc(w, name, a) {
      switch (name) {
        case "accept_submission": {
          const s = reviewLock(w, a);
          const p = projectOf(s.project_id);
          if (!p || p.deleted_at) throw rule("23514", "That submission's project was deleted.");
          const words = s.description + "\n\nSubmitted by the subcontractor as " + s.reference + ", signed by " + s.signature_name + ".";
          const q0 = a.p_quote_id === null || a.p_quote_id === undefined || a.p_quote_id === "" ? null : Number(a.p_quote_id);
          let bill = null, quote = null, file = null;
          if (s.kind === "invoice") {
            if (!s.document_attached_at || !s.document_path) {
              throw rule("23514", "That invoice has no document attached, so it could never be approved for payment. Ask the subcontractor to send it, quoting " + s.reference + ".");
            }
            if (q0 !== null) {
              const q = rows.quotes.find((x) => x.id === q0);
              if (!q) throw rule("23514", "That quote or change order no longer exists.");
              if (q.project_id !== s.project_id) throw rule("23514", "That quote or change order belongs to a different project.");
            }
            // the vendor as typed, linked to NO contact (the e-mail the sender typed is nobody's proof)
            bill = add(w, "bills", { project_id: s.project_id, estimate_item_id: null, quote_id: q0, vendor_contact_id: null,
              vendor_name: s.vendor_company, invoice_number: s.invoice_number, invoice_date: s.invoice_date || today(), due_date: s.due_date,
              amount: s.amount, description: words, document_file_id: null, void: false, approved_by: null, approved_at: null, approved_amount: null,
              pay_method: null, approval_note: null, deleted_at: null, kind: "Subcontractor", qbo_entered_at: null, qbo_entered_by: null, qbo_ref: null });
          } else {
            if (q0 !== null) throw rule("22023", "a change order becomes its own change order: p_quote_id is for an invoice");
            quote = add(w, "quotes", { project_id: s.project_id, estimate_item_id: null, vendor_contact_id: null, vendor_name: s.vendor_company,
              kind: "change_order", status: "awarded", requested_date: today(), received_date: today(), follow_ups: 0, last_follow_up: null });
            add(w, "quote_prices", { quote_id: quote.id, amount: s.amount, document_url: null, notes: words });
          }
          if (s.document_attached_at && s.document_path) {
            file = add(w, "files", { project_id: s.project_id, estimate_item_id: null, journal_entry_id: null, bill_id: bill ? bill.id : null,
              folder: "receipts", subpath: "", name: String(s.document_name || s.document_path.replace(/^.*\//, "")).replace(/\//g, "-").slice(0, 255),
              storage_path: s.document_path, size: s.document_size, mime: s.document_mime, version_no: 1, previous_id: null, is_financial: true,
              storage: "cloud", source: "subform", deleted_at: null });
            if (bill) bill = write(w, "bills", bill, { document_file_id: file.id });
          }
          const r = write(w, "sub_submissions", s, { state: "accepted", reviewed_by: w.uid, reviewed_at: nowIso(),
            bill_id: bill ? bill.id : null, quote_id: quote ? quote.id : null, document_file_id: file ? file.id : null });
          return clone(r);
        }
        case "sub_submission_notices": {
          if (!moneyEditor(w)) throw deny("only an admin, or a manager or accountant who sees financials, reviews subcontractor submissions");
          const ids = Array.isArray(a.p_ids) ? a.p_ids.map(Number) : String(a.p_ids || "").replace(/[{}]/g, "").split(",").filter(Boolean).map(Number);
          if (ids.length > 500) throw rule("22023", "at most 500 submissions at a time");
          return rows.sub_submissions.filter((s) => ids.indexOf(s.id) !== -1).sort((x, y) => x.id - y.id).map((s) => noticeState(s.id));
        }
        case "reject_submission": {
          const s = reviewLock(w, a);
          const note = oneLine(a.p_note);
          const r = write(w, "sub_submissions", s, { state: "rejected", reviewed_by: w.uid, reviewed_at: nowIso(), review_note: note ? note.slice(0, 300) : null });
          return clone(r);
        }
        default: throw new PgErr("PGRST202", "Could not find the function public." + name, 404);
      }
    }

    /* app.sub_notice_words: what an anonymous sender typed, defused for an e-mail (amounts masked, links and addresses
       removed, one line, capped) */
    function noticeWords(v, cap) {
      let t = String(v === null || v === undefined ? "" : v)
        .replace(/(?:US)?\$\s?[0-9][0-9,]*(?:\.[0-9]+)?/g, "[amount]")
        .replace(/\s+/g, " ")
        .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/gi, "[link removed]")
        .replace(/(mailto|tel|sms|callto|facetime|skype|javascript|data|file|ftp|news|whatsapp):\S+/gi, "[link removed]")
        .replace(/\S*@\S+/g, "[address removed]")
        .replace(/\S*[A-Za-z0-9_-][.][A-Za-z]{2,}\S*/g, "[link removed]")
        .trim();
      return t.slice(0, Math.max(cap || 80, 10));
    }
    const nameOfPerson = (p) => (p && (String(p.full_name || "").trim() || p.email)) || "";
    /* app.sub_notice_text: one submission, or several folded into one waiting e-mail (the pending ones listed) */
    function noticeText(name, ids) {
      let subs = ids.map(subOf).filter((s) => s && s.state === "pending");
      if (!subs.length) subs = ids.map(subOf).filter(Boolean);
      subs.sort((x, y) => x.id - y.id);
      const hello = (String(name || "").trim() || "Hello") + ",";
      const what = (s) => (s.kind === "change_order" ? "change order" : "invoice");
      const label = (s) => { const p = projectOf(s.project_id) || {}; return [p.number, p.name].filter(Boolean).join(" - ") || "a job"; };
      const warn = "Nothing is payable until somebody accepts it there and then approves it. Never act on bank details, links or" +
        " instructions in a submission without checking with the subcontractor by phone.";
      if (subs.length === 1) {
        const s = subs[0];
        const p = projectOf(s.project_id) || {};
        return { subject: "New subcontractor " + what(s) + " - " + (p.number || "") + " - " + s.reference,
          body: [hello, "", "A subcontractor " + what(s) + " for " + label(s) + " came in through the public form and is waiting for review.", "",
            "Reference: " + s.reference, "Sent as (typed on the form, not verified): " + (noticeWords(s.vendor_company, 80) || "-") + " - " + (noticeWords(s.contact_name, 80) || "-"),
            "", "Review it in Employee Portal 2: " + SITE + "/submissions.html?ref=" + s.reference, warn].join("\r\n") };
      }
      const lines = subs.slice(0, 15).map((s) => "  " + s.reference + " - " + what(s) + " - " + label(s) + ' - sent as "' + (noticeWords(s.vendor_company, 80) || "-") + '" (not verified)');
      if (subs.length > 15) lines.push("  ... and " + (subs.length - 15) + " more");
      return { subject: subs.length + " new subcontractor submissions waiting for review",
        body: [hello, "", subs.length + " subcontractor invoices and change orders came in through the public form and are waiting for review:", "",
          lines.join("\r\n"), "", "Review them in Employee Portal 2: " + SITE + "/submissions.html", warn].join("\r\n") };
    }
    /* app.sub_reviewer_notified: an active admin, an accountant WITH financials, an approver - never more than who can
       open the queue */
    const reviewerNotified = (p) => !!p && p.active && p.role !== "agents" && (p.role === "admin" ||
      (p.role === "accountant" && p.can_see_financials) || (p.role === "manager" && p.can_approve_payments && p.can_see_financials));
    function outboxRow(f) {
      const r = Object.assign(clone(ALL.notifications_outbox), { id: nextId("notifications_outbox"), kind: "sub_submission", task_id: null,
        created_at: nowIso(), push_result: "e-mail only" }, f);
      commitInsert("notifications_outbox", r);
      return r;
    }
    /* t97_sub_submissions_notice: one waiting, amount-free e-mail per admin, accountant with financials and approver (a
       later submission folded into the person's notice nobody has taken yet); the switch off / nobody to tell: one row,
       set aside, saying so */
    function notify(s) {
      if (!rows.notifications_outbox) return;
      const settings = (rows.settings || [])[0] || {};
      if (settings.sub_email_enabled === false) {
        const t = noticeText(null, [s.id]);
        outboxRow({ submission_id: s.id, submission_ids: [s.id], to_profile_id: null, to_email: null, subject: t.subject, body: t.body,
          email_wanted: false, error: "not sent: e-mails about subcontractor submissions are turned off (DCR Desktop 2, Settings)" });
        return;
      }
      const seen = new Set();
      let told = 0;
      for (const person of rows.profiles.slice().sort((a, b) => String(a.email).localeCompare(String(b.email)))) {
        const addr = String(person.email || "").toLowerCase();
        if (!reviewerNotified(person) || !addr || seen.has(addr)) continue;
        seen.add(addr);
        told++;
        const open = rows.notifications_outbox.filter((o) => o.kind === "sub_submission" && o.to_profile_id === person.id && o.email_wanted && !o.sent_at &&
          !o.claimed_at && !(o.attempts > 0) && Date.now() - Date.parse(o.created_at) < 2 * 86400000).sort((x, y) => y.id - x.id)[0];
        if (open) {
          const ids = (open.submission_ids || [open.submission_id]).concat([s.id]);
          const t = noticeText(nameOfPerson(person), ids);
          const r = Object.assign(clone(open), { submission_ids: ids, subject: t.subject, body: t.body });
          commitUpdate("notifications_outbox", open, r);
          continue;
        }
        const t = noticeText(nameOfPerson(person), [s.id]);
        outboxRow({ submission_id: s.id, submission_ids: [s.id], to_profile_id: person.id, to_email: addr, subject: t.subject, body: t.body, email_wanted: true });
      }
      if (!told) {
        const t = noticeText(null, [s.id]);
        outboxRow({ submission_id: s.id, submission_ids: [s.id], to_profile_id: null, to_email: null, subject: t.subject, body: t.body, email_wanted: false,
          error: "not sent: nobody to tell (no active admin, accountant with financials or approver with an e-mail address)" });
      }
    }
    /* sub_submission_notices: sent / waiting / not_sent (why) */
    function noticeState(id) {
      const mine = (rows.notifications_outbox || []).filter((o) => o.kind === "sub_submission" && (o.submission_ids || [o.submission_id]).indexOf(id) !== -1);
      const sent = mine.filter((o) => o.sent_at).map((o) => o.sent_at).sort();
      if (sent.length) return { id, state: "sent", sentAt: sent[0], why: null };
      if (mine.some((o) => !o.sent_at && o.email_wanted && !(o.attempts >= 5))) return { id, state: "waiting", sentAt: null, why: null };
      const err = mine.slice().sort((x, y) => y.id - x.id).find((o) => o.error);
      return { id, state: "not_sent", sentAt: null, why: mine.length ? (err ? err.error : "not sent") : "no notice was written" };
    }

    /* ── the function "subform" ─────────────────────────────────────────────────────────────── */
    function take(bucket, key) {
      const [limit, seconds] = RATE[bucket];
      const now = Date.now();
      const k = bucket + "|" + key;
      const hits = (rate.get(k) || []).filter((t) => now - t < seconds * 1000);
      if (hits.length >= limit) { rate.set(k, hits); return false; }
      hits.push(now);
      rate.set(k, hits);
      return true;
    }
    const answer = (status, data) => ({ status, data });
    const bad = (message, errors) => answer(400, Object.assign({ error: "invalid", message }, errors ? { errors } : {}));
    const limited = (message) => answer(429, { error: "rate_limited", message });
    function invoke(ctx, name, body) {
      const b = body && typeof body === "object" && !Array.isArray(body) ? body : null;
      if (!b) return bad("the body must be a JSON object");
      const ip = DEMO_IP;
      if (b.op === "projects") {
        const q = text(b.q, 80).toLowerCase();
        if (q.length < 3) return answer(200, { projects: [], more: 0, min: 3 });
        if (!take("projects", ip)) return limited(M.rateLimited);
        const terms = q.split(" ");
        const hits = rows.projects.filter((p) => open(p) && terms.every((t) => [p.number, p.name, p.address, p.city, p.client_name].map((v) => String(v || "").toLowerCase()).join("\n").indexOf(t) !== -1))
          .sort((x, y) => String(y.number).localeCompare(String(x.number)) || x.id - y.id);
        return answer(200, { projects: hits.slice(0, 8).map((p) => ({ id: p.id, number: text(p.number, 40), name: text(p.name, 160), city: text(p.city, 80) })),
          more: Math.max(0, hits.length - 8), min: 3 });
      }
      if (b.op === "submit") {
        if (!take("submit", ip)) return limited(M.rateLimited);
        const c = validate(b);
        if (!c.ok) return bad(c.errors.join("\n"), c.errors);
        const v = c.v;
        let doc = null;
        if (b.document !== undefined && b.document !== null) {
          doc = documentMeta(b.document);
          if (!doc) return bad(M.badDocument, [M.badDocument]);
        }
        const project = projectOf(v.projectId);
        if (!open(project)) return bad(M.notOpen, [M.notOpen]);
        if (!take("submitAll", "*")) return limited(M.busy);
        let ref = newReference();
        while (rows.sub_submissions.some((s) => s.reference === ref)) ref = newReference();
        const kind = v.kind === "Change order" ? "change_order" : "invoice";
        const sigPath = "f/" + project.id + "/receipts/" + uid32() + "/" + fileName(ref, kind, "png", "signature");
        E.objectPut(sigPath, v.sig.length, "image/png", typeof Blob !== "undefined" ? new Blob([v.sig], { type: "image/png" }) : null);
        let upload = null;
        if (doc) {
          const docName = fileName(ref, kind, doc.ext);
          const path = "f/" + project.id + "/receipts/" + uid32() + "/" + docName;
          const token = "demo-" + uid32();
          tokens.set(token, { path, used: false });
          upload = { bucket: INBOX, path, token, signedUrl: "https://demo-ref.supabase.co/storage/v1/object/upload/sign/" + INBOX + "/" + encodeURI(path) + "?token=" + token,
            name: docName, size: doc.size };
        }
        const s = add(SERVICE, "sub_submissions", { reference: ref, kind, state: "pending", project_id: project.id,
          project_label: text([project.number, project.name].filter(Boolean).join(" — "), 300) || null, vendor_company: v.vendor, contact_name: v.contact,
          contact_email: v.email, contact_phone: v.phone || null, invoice_number: v.invoiceNumber || null, amount: v.amount, description: v.description,
          invoice_date: v.invoiceDate || null, due_date: v.dueDate || null, signature_name: v.signatureName, signed_at: nowIso(), signature_path: sigPath,
          document_path: upload ? upload.path : null, document_name: upload ? upload.name : null, document_size: upload ? doc.size : null,
          document_mime: upload ? doc.mime : null, document_attached_at: null, submitted_ip: ip,
          submitted_agent: root.navigator && root.navigator.userAgent ? String(root.navigator.userAgent).slice(0, 250) : null });
        notify(s);
        sweep();
        return answer(201, { ok: true, reference: ref, upload, message: M.received });
      }
      if (b.op === "attached") {
        if (!take("attached", ip)) return limited(M.rateLimited);
        const ref = String(b.reference || "").trim().toUpperCase().slice(0, 20);
        if (!isReference(ref)) return bad(M.unknownReference);
        const s = rows.sub_submissions.find((x) => x.reference === ref);
        if (!s) return bad(M.unknownReference);
        if (s.state !== "pending") return bad(M.reviewed);
        if (s.document_attached_at) return bad(M.alreadyAttached);
        const path = String(b.path || "");
        if (!s.document_path || path !== s.document_path) return bad(M.noDocument);
        const meta = inbox.get(path);
        if (!meta) return bad(M.noDocument);
        const mime = String(meta.mime || "").toLowerCase().split(";")[0].trim();
        if (!DOC_TYPES[mime] || DOC_TYPES[mime] !== extOf(s.document_name || path) || !(meta.size > 0) || meta.size > MAX_DOC) { inbox.delete(path); return bad(M.badDocument); }
        // checked: copied from the inbox to project-files at the same name, stamped, the inbox copy removed
        if (!E.objectMeta(path)) E.objectPut(path, meta.size, mime, meta.blob || null);
        write(SERVICE, "sub_submissions", s, { document_attached_at: nowIso(), document_size: meta.size, document_mime: mime });
        inbox.delete(path);
        sweep();
        return answer(200, { ok: true });
      }
      return bad("op must be projects, submit or attached");
    }
    /* the bucket subform-inbox (M5c): a token for that one path, once, never over an object; Storage's own limits - at most
       25 MB, a photo, a scan or a PDF (the bucket's file_size_limit and allowed_mime_types) */
    function signedUpload(key, token, size, mime, blob, bucket) {
      if (bucket && bucket !== INBOX) throw E.storageErr(400, 400, "InvalidJWT", "invalid signature");
      const t = tokens.get(String(token || ""));
      if (!t || t.path !== key) throw E.storageErr(400, 400, "InvalidJWT", "invalid signature");
      if (t.used || inbox.has(key)) throw E.storageErr(400, 409, "Duplicate", "The resource already exists");
      if (!(Number(size) <= MAX_DOC)) throw E.storageErr(413, 413, "Payload too large", "The object exceeded the maximum allowed size");
      const type = String(mime || "").toLowerCase().split(";")[0].trim();
      if (!DOC_TYPES[type]) throw E.storageErr(415, 415, "invalid_mime_type", "mime type " + type + " is not supported");
      t.used = true;
      inbox.set(key, { size: Number(size) || 0, mime: type, blob: blob || null, at: Date.now() });
      return { Key: INBOX + "/" + key };
    }
    /* the function's sweep: an upload never announced as attached, once its URL ran out - its inbox object removed and
       the reservation cleared (any state) */
    function sweep() {
      const now = Date.now();
      rows.sub_submissions.filter((x) => x.document_path && !x.document_attached_at && now - Date.parse(x.created_at || x.signed_at || nowIso()) > UPLOAD_STALE_MS)
        .slice(0, 25).forEach((x) => {
          inbox.delete(x.document_path);
          write(SERVICE, "sub_submissions", x, { document_path: null, document_name: null, document_size: null, document_mime: null });
        });
    }

    return {
      name: "p5c-sub", tables, canRead, canInsert, canUpdate, canDelete,
      handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc,
      ownsObject, canReadObject, canUploadObject,
      functions: ["subform"], invoke, signedUpload, inboxHas: (key) => inbox.has(key),
    };
  }
  (NS.extInstall = NS.extInstall || []).push(install);

  /* ── made-up data: three waiting, one rejected, on open made-up jobs ─────────────────────── */
  (NS.extSeed = NS.extSeed || []).push(function seedSubmissions(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const iso = (hoursAgo) => new Date(now.getTime() - hoursAgo * 3600000).toISOString();
    const day = (daysAgo) => {
      const [y, m, d] = h.today.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d - daysAgo)).toISOString().slice(0, 10);
    };
    out.sub_submissions = out.sub_submissions || [];
    out.objects = out.objects || {};
    if (out.sub_submissions.length) return;
    const jobs = (out.projects || []).filter((p) => !p.deleted_at && !p.completed_date && ["in_progress", "approved"].indexOf(p.status) !== -1 && p.number !== "A267")
      .sort((a, b) => String(b.number).localeCompare(String(a.number))).slice(0, 3);
    if (jobs.length < 3) return;
    let sid = 0;
    const audit = (hoursAgo) => ({ created_at: iso(hoursAgo), created_by: null, updated_at: iso(hoursAgo), updated_by: null, version: 1 });
    function object(project, name, size, mime, hoursAgo, n) {
      const key = "f/" + project.id + "/receipts/" + (String(n).padStart(4, "0") + "5c".repeat(14)) + "/" + name;
      out.objects[key] = { size, mime, owner: null, created_at: iso(hoursAgo) };
      return key;
    }
    function sub(project, ref, f, hoursAgo, doc) {
      const id = ++sid;
      const kind = f.kind || "invoice";
      const sig = object(project, fileName(ref, kind, "png", "signature"), 18400, "image/png", hoursAgo, id * 10 + 1);
      const name = doc ? fileName(ref, kind, doc) : null;
      const size = doc === "pdf" ? 182000 : 1240000, mime = doc === "pdf" ? "application/pdf" : "image/jpeg";
      const path = doc ? object(project, name, size, mime, hoursAgo, id * 10 + 2) : null;
      out.sub_submissions.push(Object.assign({}, COLS.sub_submissions, { id, reference: ref, kind, state: "pending", project_id: project.id,
        project_label: [project.number, project.name].filter(Boolean).join(" — "), signed_at: iso(hoursAgo), signature_path: sig,
        document_path: path, document_name: name, document_size: doc ? size : null, document_mime: doc ? mime : null,
        document_attached_at: doc ? iso(hoursAgo - 0.01) : null, submitted_ip: "203.0.113." + (20 + id),
        submitted_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148" }, f, audit(hoursAgo)));
    }
    sub(jobs[0], "SUB-7KQ4-HM3D", { vendor_company: "Northwind Roofing", contact_name: "Ari Northwind", contact_email: "ari@northwind-roofing.example",
      contact_phone: "(805) 555-0161", invoice_number: "1042", amount: 4250, description: "Roof framing, first draw: trusses set and braced on the main house.",
      invoice_date: day(2), due_date: day(-12), signature_name: "Ari Northwind" }, 5, "jpg");
    sub(jobs[1], "SUB-C9TX-2PWF", { vendor_company: "Bluejay Drywall", contact_name: "Bo Bluejay", contact_email: "bo@bluejay-drywall.example",
      invoice_number: "B-88", amount: 1980, description: "Hang and tape the garage walls (the photo of the invoice will follow).",
      invoice_date: day(1), due_date: null, signature_name: "Bo Bluejay" }, 26, null);
    sub(jobs[2], "SUB-RM6G-8JKV", { kind: "change_order", vendor_company: "Copperline Electric", contact_name: "Cy Copperline",
      contact_email: "cy@copperline-electric.example", contact_phone: "(805) 555-0175", invoice_number: "CO-3", amount: 860,
      description: "Six more outlets in the kitchen island and pantry, asked for on site by the owner.", invoice_date: day(0), due_date: null,
      signature_name: "Cy Copperline" }, 2, "pdf");
    sub(jobs[0], "SUB-W4FD-QX7N", { vendor_company: "Sagebrush Concrete", contact_name: "Sky Sagebrush", contact_email: "sky@sagebrush-concrete.example",
      invoice_number: "771", amount: 12500, description: "Foundation pour (sent twice by mistake).", invoice_date: day(9), due_date: day(-5),
      signature_name: "Sky Sagebrush", state: "rejected", reviewed_by: P.accountant, reviewed_at: iso(150), review_note: "Duplicate of their earlier invoice; told by phone." }, 170, "pdf");

    /* what became of their e-mail notices (rpc sub_submission_notices): the roofing invoice's went out; the change order's
       is still waiting for DCR Agents 2 (two hours: the queue says so quietly); the drywall invoice's failed five times
       (the queue warns "Nobody was e-mailed about this", as the old page did); the rejected one's went out */
    out.notifications_outbox = out.notifications_outbox || [];
    let oid = out.notifications_outbox.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
    const told = (out.profiles || []).filter((p) => p.id === P.admin || p.id === P.accountant);
    const notice = (sub, hoursAgo, f) => told.forEach((p) => out.notifications_outbox.push(Object.assign({ id: ++oid, kind: "sub_submission", task_id: null,
      submission_id: sub.id, submission_ids: [sub.id], to_profile_id: p.id, to_email: String(p.email || "").toLowerCase(),
      subject: "New subcontractor " + (sub.kind === "change_order" ? "change order" : "invoice") + " - " + sub.reference,
      body: "(the notice's words: tools/fake/p5c-sub.js noticeText)", created_at: iso(hoursAgo), claimed_at: null, sent_at: null, attempts: 0,
      error: null, sent_by: null, push_sent_at: null, push_result: "e-mail only", email_wanted: true }, f)));
    const byRef = (ref) => out.sub_submissions.find((x) => x.reference === ref);
    notice(byRef("SUB-7KQ4-HM3D"), 5, { claimed_at: iso(4.9), sent_at: iso(4.9), attempts: 1 });
    notice(byRef("SUB-RM6G-8JKV"), 2, {});
    notice(byRef("SUB-C9TX-2PWF"), 26, { claimed_at: iso(24), attempts: 5, error: "failed: the mail channel refused the address (5 tries)" });
    notice(byRef("SUB-W4FD-QX7N"), 170, { claimed_at: iso(169.9), sent_at: iso(169.9), attempts: 1 });
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
