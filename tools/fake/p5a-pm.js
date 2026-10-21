/* DCR Portal 2 — DEMO MODE ONLY: P5a's progress-chart tables in the in-memory database (migration M5a
   20261025000100_office_pm.sql and the money tables of 20261007000500_money.sql), read by pm.html and
   report-pm.html. Loaded BEFORE engine.js and AFTER tools/fake/p5a-est.js (whose estimates and items these rows
   hang off); installed into each engine (NS.extInstall). Never published (tools/ is not part of the site).

   The same tables, columns and rules as the migrations:
   * estimate_item_flags - one per item (item_id the key; project_id copied; state blocked | complete |
     important; note 1..300 characters, tidied; due_date; by / at the database's). Read by whoever reads the
     item; added, changed and cleared by app.can_edit('item_flags') - admin, manager, lead - on a live item.
     Setting it, changing its state or due day and clearing it write ONE amount-free activity line
     ('Item "Framing" flagged blocked (due 2026-10-30)', '… flag cleared');
   * quotes - every active person reads them (Q11), no money and no notes in the row; quote_prices (amount,
     document_url, notes - the quote's notes name its price) - the prices switch; rpc quote_follow_up(p_id): quote editors (admin; a manager or accountant with prices),
     one more follow-up stamped with the company's day, the quote back (PT404 for one not readable);
   * bills, payments, invoices, invoice_lines, client_payments, costs - the financials switch (Portal 2 writes
     none of them in 5a);
   * quote_commitments - a security-invoker view: no row without financials; committed NULL without prices;
     billed, approved, paid, the waiting bills, pct_billed / pct_paid, over_billed / over_billed_by, over_paid and
     paid_unapproved reported, never clamped (old lib/commitments.js);
   * the DCR Agents 2 account reads none of them.
   Made-up data only: the sandbox A267 (the chart in every state), A304, A301 (bidding) and A302 (sent). */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const TABLES = ["estimate_item_flags", "quotes", "quote_prices", "bills", "payments", "invoices", "invoice_lines",
    "client_payments", "costs", "quote_commitments"];
  const FLAG_STATES = ["blocked", "complete", "important"];
  const QUOTE_STATUSES = ["requested", "received", "declined", "awarded", "self"];

  (NS.extTables = NS.extTables || []).push({
    tables: TABLES,
    cols: {
      estimate_item_flags: { item_id: null, project_id: null, state: null, note: null, due_date: null, by: null, at: null },
      quotes: { id: null, project_id: null, estimate_item_id: null, vendor_contact_id: null, vendor_name: null, kind: "quote", status: "requested",
        requested_date: null, received_date: null, follow_ups: 0, last_follow_up: null },
      quote_prices: { quote_id: null, amount: null, document_url: null, notes: null },
      bills: { id: null, project_id: null, estimate_item_id: null, quote_id: null, vendor_contact_id: null, vendor_name: null, invoice_number: null,
        invoice_date: null, due_date: null, amount: 0, description: null, document_file_id: null, void: false, approved_by: null, approved_at: null,
        approved_amount: null, pay_method: null, approval_note: null, payee: null, memo: null, deleted_at: null },
      payments: { id: null, bill_id: null, project_id: null, paid_date: null, amount: null, method: "check", check_number: null, reference: null, notes: null },
      invoices: { id: null, project_id: null, number: null, invoice_date: null, due_date: null, description: null, status: "draft", sent_date: null,
        terms: null, notes: null, deleted_at: null },
      invoice_lines: { id: null, invoice_id: null, sort: 0, description: "", qty: 1, unit_price: 0, amount: 0, estimate_id: null },
      client_payments: { id: null, invoice_id: null, paid_date: null, amount: null, method: "check", reference: null },
      costs: { id: null, project_id: null, estimate_item_id: null, cost_date: null, kind: "material", description: null, vendor: null, amount: 0,
        hours: null, rate: null },
      quote_commitments: { quote_id: null, project_id: null, estimate_item_id: null, kind: null, status: null, vendor_contact_id: null, vendor_name: null,
        committed: null, billed: null, approved: null, paid: null, remaining: null, outstanding: null, bill_count: null, waiting_count: null,
        waiting_amount: null, pct_billed: null, pct_paid: null, over_billed: null, over_billed_by: null, over_paid: null, paid_unapproved: null },
    },
    pk: { estimate_item_flags: "item_id", quote_prices: "quote_id", quote_commitments: "quote_id" },
    uuid: [],
    noAudit: ["quote_commitments"],
    fks: [
      ["estimate_item_flags", "item_id", "estimate_items", true],
      ["estimate_item_flags", "project_id", "projects"],
      ["quotes", "project_id", "projects"],
      ["quotes", "estimate_item_id", "estimate_items"],
      ["quotes", "vendor_contact_id", "contacts"],
      ["quote_prices", "quote_id", "quotes", true],
      ["bills", "project_id", "projects"],
      ["bills", "estimate_item_id", "estimate_items"],
      ["bills", "quote_id", "quotes"],
      ["bills", "vendor_contact_id", "contacts"],
      ["payments", "bill_id", "bills"],
      ["payments", "project_id", "projects"],
      ["invoices", "project_id", "projects"],
      ["invoice_lines", "invoice_id", "invoices"],
      ["invoice_lines", "estimate_id", "estimates"],
      ["client_payments", "invoice_id", "invoices"],
      ["costs", "project_id", "projects"],
      ["costs", "estimate_item_id", "estimate_items"],
    ],
  });

  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, projectVisible, PgErr, deny, rule, today, nowIso, clone, commitUpdate, logActivity } = E;
    const tables = new Set(TABLES);
    const scrub = NS.p6ScrubMoney || ((t) => String(t == null ? "" : t).replace(/\$\s?[0-9][0-9,]*(\.[0-9]+)?/g, "[amount]"));
    const items = () => rows.estimate_items || [];
    const itemOf = (id) => items().find((x) => x.id === Number(id)) || null;
    const itemReadable = (w, it) => !!it && (!it.deleted_at || w.admin) && projectVisible(w, it.project_id);
    const flagger = (w) => w.active && ["admin", "manager", "lead"].includes(w.role);                     // app.can_edit('item_flags')
    const quoteEditor = (w) => w.active && (w.admin || ((w.role === "manager" || w.role === "accountant") && w.prices)); // 'quotes'
    const quoteOf = (id) => rows.quotes.find((q) => q.id === Number(id)) || null;

    function canRead(w, table, r) {
      if (!w.active) return false;
      switch (table) {
        case "estimate_item_flags": return itemReadable(w, itemOf(r.item_id));
        case "quotes": return projectVisible(w, r.project_id);
        case "quote_prices": { const q = quoteOf(r.quote_id); return w.prices && !!q && projectVisible(w, q.project_id); }
        case "bills": case "invoices": return w.financials && (!r.deleted_at || w.admin) && projectVisible(w, r.project_id);
        case "payments": case "costs": return w.financials && projectVisible(w, r.project_id);
        case "invoice_lines": case "client_payments": {
          const iv = rows.invoices.find((x) => x.id === r.invoice_id);
          return w.financials && !!iv && projectVisible(w, iv.project_id);
        }
        case "quote_commitments": return w.financials && projectVisible(w, r.project_id);
        default: return false;
      }
    }
    // only the flags are written by people from Portal 2 (Q12); every other table here is Desktop 2's to write
    function canInsert(w, table, r) {
      if (table !== "estimate_item_flags") return false;
      const it = itemOf(r.item_id);
      return flagger(w) && !!it && !it.deleted_at && itemReadable(w, it);
    }
    function canUpdate(w, table, r) { return canInsert(w, table, r); }
    function canDelete(w, table, r) {
      if (table !== "estimate_item_flags") return false;
      return flagger(w) && itemReadable(w, itemOf(r.item_id));
    }
    function tidyFlag(r) {
      if (!FLAG_STATES.includes(r.state)) throw rule("23514", 'new row for relation "estimate_item_flags" violates check constraint "estimate_item_flags_state_check"');
      const n = r.note === null || r.note === undefined ? "" : String(r.note).trim();
      r.note = n || null;
      if (r.note !== null && r.note.length > 300) throw rule("23514", 'new row for relation "estimate_item_flags" violates check constraint "estimate_item_flags_note_check"');
      if (r.due_date !== null && r.due_date !== undefined && r.due_date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.due_date))) {
        throw rule("22007", 'invalid input syntax for type date: "' + r.due_date + '"');
      }
      if (r.due_date === "") r.due_date = null;
    }
    function beforeInsert(w, table, r) {
      if (table !== "estimate_item_flags") return;
      const it = itemOf(r.item_id);
      if (!it || it.deleted_at) throw rule("23503", "estimate item " + r.item_id + " not found");
      r.project_id = it.project_id;
      tidyFlag(r);
      r.by = w.uid;
      r.at = nowIso();
    }
    function guardUpdate(w, table, old, r) {
      if (table !== "estimate_item_flags") return;
      if (r.item_id !== old.item_id) throw rule("23514", "a flag stays on its item");
      r.project_id = old.project_id;
      tidyFlag(r);
      r.by = w.uid;
      r.at = nowIso();
    }
    function words(itemId) {
      const it = itemOf(itemId);
      if (it && String(it.name || "").trim()) return 'Item "' + scrub(String(it.name).trim()).trim() + '"';
      const e = it && (rows.estimates || []).find((x) => x.id === it.estimate_id);
      return "An item of " + (e ? (e.kind === "change_order" ? "Change Order #" + e.co_number : "Estimate #" + e.number) : "an estimate");
    }
    function flagLine(w, r) {
      logActivity(w, r.project_id, "system", words(r.item_id) + " flagged " + r.state + (r.due_date ? " (due " + r.due_date + ")" : ""));
    }
    function afterInsert(w, table, r) { if (table === "estimate_item_flags") flagLine(w, r); }
    function afterUpdate(w, table, old, r) {
      if (table === "estimate_item_flags" && (r.state !== old.state || r.due_date !== old.due_date)) flagLine(w, r);
    }
    function afterDelete(w, table, old) {
      if (table !== "estimate_item_flags") return;
      const it = itemOf(old.item_id);
      if (it && !it.deleted_at) logActivity(w, old.project_id, "system", words(old.item_id) + " flag cleared");
    }

    /* quote_commitments (security invoker): the caller's rows */
    function commitments(w) {
      if (!w || !w.financials) return [];
      const live = rows.bills.filter((b) => b.quote_id !== null && b.quote_id !== undefined && !b.void && !b.deleted_at && Number(b.amount) > 0);
      const paidOn = (b) => rows.payments.filter((p) => p.bill_id === b.id).reduce((s, p) => s + Number(p.amount || 0), 0);
      const out = [];
      for (const q of rows.quotes) {
        if (!projectVisible(w, q.project_id)) continue;
        const linked = live.filter((b) => b.quote_id === q.id);
        if (!(linked.length || q.status === "awarded" || (q.kind === "change_order" && q.status !== "declined"))) continue;
        const pr = rows.quote_prices.find((x) => x.quote_id === q.id);
        const committed = w.prices ? r2(pr && pr.amount !== null ? pr.amount : 0) : null;
        const billed = r2(linked.reduce((s, b) => s + Number(b.amount), 0));
        const approved = r2(linked.filter((b) => b.approved_at).reduce((s, b) => s + Number(b.approved_amount !== null ? b.approved_amount : b.amount), 0));
        const paid = r2(linked.reduce((s, b) => s + paidOn(b), 0));
        const waiting = linked.filter((b) => !b.approved_at);
        out.push({
          quote_id: q.id, project_id: q.project_id, estimate_item_id: q.estimate_item_id, kind: q.kind, status: q.status,
          vendor_contact_id: q.vendor_contact_id, vendor_name: q.vendor_name,
          committed, billed, approved, paid,
          remaining: committed === null ? null : Math.max(committed - billed, 0), outstanding: r2(approved - paid),
          bill_count: linked.length, waiting_count: waiting.length, waiting_amount: r2(waiting.reduce((s, b) => s + Number(b.amount), 0)),
          pct_billed: committed > 0 ? r2(billed / committed * 100) : null, pct_paid: committed > 0 ? r2(paid / committed * 100) : null,
          over_billed: committed === null ? null : committed > 0 && billed > committed,
          over_billed_by: committed === null ? null : committed > 0 ? Math.max(r2(billed - committed), 0) : 0,
          over_paid: paid > approved + 0.005, paid_unapproved: r2(waiting.reduce((s, b) => s + paidOn(b), 0)),
        });
      }
      return out;
    }

    const SIGS = { quote_follow_up: ["p_id"] };
    function checkArgs(name, args) {
      const keys = Object.keys(args || {});
      const want = SIGS[name];
      if (keys.length !== want.length || keys.some((k) => !want.includes(k))) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404);
      }
    }
    function rpc(w, name, args) {
      if (name === "quote_follow_up") {
        if (!quoteEditor(w)) throw deny("You don't have permission to edit quotes.");
        const q = quoteOf(args.p_id);
        if (!q || !projectVisible(w, q.project_id)) throw new PgErr("PT404", "quote not found", 404);
        const r = Object.assign(clone(q), { follow_ups: Number(q.follow_ups || 0) + 1, last_follow_up: today() });
        E.auditUpdate(w, "quotes", r, q);
        commitUpdate("quotes", q, r);
        return clone(r);
      }
      throw new PgErr("PGRST202", "Could not find the function public." + name, 404);
    }

    return {
      name: "p5a-pm", tables, canRead, canInsert, canUpdate, canDelete, beforeInsert, guardUpdate, afterInsert, afterUpdate, afterDelete,
      views: { quote_commitments: commitments }, handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc,
    };
  });

  /* ── made-up data (after tools/fake/p5a-est.js has made the estimates) ── */
  (NS.extSeed = NS.extSeed || []).push(function seedPm(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const today = h.today;
    const iso = (d) => new Date(d).toISOString();
    const at = (days, hour) => {
      const [y, m, d] = today.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d - days, 17 + (hour || 0), 15, 0));
      return t.getTime() > now.getTime() ? iso(now.getTime() - 60000 * (days + 5)) : iso(t);
    };
    const day = (days) => {
      const [y, m, d] = today.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
    };
    const audit = (days, by) => ({ created_at: at(days), created_by: by || P.admin, updated_at: at(days), updated_by: null, version: 1 });
    for (const t of TABLES.filter((x) => x !== "quote_commitments")) out[t] = out[t] || [];
    ["estimates", "estimate_items", "estimate_item_prices", "takeoffs", "takeoff_rows"].forEach((t) => { out[t] = out[t] || []; });
    const maxId = (t, k) => out[t].reduce((m, r) => Math.max(m, Number(r[k || "id"]) || 0), 0);
    const ids = { q: maxId("quotes"), b: maxId("bills"), p: maxId("payments"), i: maxId("invoices"), l: maxId("invoice_lines"),
      c: maxId("client_payments"), k: maxId("costs"), e: maxId("estimates"), it: maxId("estimate_items"),
      a: maxId("activity"), f: maxId("files") };
    const byNumber = (n) => out.projects.find((p) => p.number === n);
    const vendors = out.contacts.filter((c) => c.kind === "subcontractor" || c.kind === "supplier");
    const vendor = (i) => vendors[i % Math.max(1, vendors.length)] || null;
    const vname = (c) => (c ? c.company || c.name : null);

    function quote(project, itemId, f, amount, days) {
      const id = ++ids.q;
      const v = f.vendor === undefined ? vendor(id) : f.vendor;
      const row = Object.assign({ id, project_id: project.id, estimate_item_id: itemId, vendor_contact_id: v ? v.id : null, vendor_name: f.vendor_name || vname(v),
        kind: "quote", status: "requested", requested_date: day(days || 10), received_date: null, follow_ups: 0, last_follow_up: null },
        f, audit(days || 10, P.manager_prices));
      const notes = row.notes === undefined ? null : row.notes;                      // M5a: the notes are with the price
      delete row.vendor;
      delete row.notes;
      out.quotes.push(row);
      out.quote_prices.push(Object.assign({ quote_id: id, amount: amount === undefined ? null : amount,
        document_url: f.status === "received" || f.status === "awarded" ? "https://example.com/demo/quote-" + id + ".pdf" : null, notes },
        audit(days || 10, P.manager_prices)));
      return row;
    }
    function bill(project, f, days) {
      const id = ++ids.b;
      const row = Object.assign({ id, project_id: project.id, estimate_item_id: null, quote_id: null, vendor_contact_id: null, vendor_name: null,
        invoice_number: "INV-" + (4100 + id), invoice_date: day(days), due_date: day(days - 30), amount: 0, description: null, document_file_id: null,
        void: false, approved_by: null, approved_at: null, approved_amount: null, pay_method: null, approval_note: null, payee: null, memo: null,
        deleted_at: null }, f, audit(days, P.accountant));
      out.bills.push(row);
      return row;
    }
    function approve(b, days, by) { Object.assign(b, { approved_by: by || P.admin, approved_at: at(days), approved_amount: b.amount, pay_method: "check" }); }
    function pay(b, amount, days) {
      out.payments.push(Object.assign({ id: ++ids.p, bill_id: b.id, project_id: b.project_id, paid_date: day(days), amount, method: "check",
        check_number: String(5200 + ids.p), reference: null, notes: null }, audit(days, P.accountant)));
    }
    function flag(itemId, project, f, days, by) {
      out.estimate_item_flags.push(Object.assign({ item_id: itemId, project_id: project.id, state: "important", note: null, due_date: null,
        by: by || P.lead, at: at(days) }, f, audit(days, by || P.lead)));
    }
    function status(project, from, to, days) {
      const lbl = (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      out.activity.push(Object.assign({ id: ++ids.a, project_id: project.id, kind: "status", text: "Status: " + lbl(from) + " → " + lbl(to),
        from_status: from, to_status: to, author_name: null, legacy_sp_id: null }, audit(days, P.manager)));
    }
    function receipt(project, name, days) {
      const id = ++ids.f;
      const key = "f/" + project.id + "/receipts/" + (id.toString(16).padStart(8, "0") + "0".repeat(24)) + "/" + name.replace(/[^A-Za-z0-9._ -]+/g, "_");
      out.files.push(Object.assign({ id, project_id: project.id, estimate_item_id: null, journal_entry_id: null, bill_id: null, folder: "receipts", subpath: "",
        name, storage_path: key, size: 182000, mime: "application/pdf", version_no: 1, previous_id: null, is_financial: true, storage: "cloud", rel_path: null,
        modified_at: null, description: null, preview_path: null, source: "desktop", deleted_at: null }, audit(days, P.accountant)));
      out.objects[key] = { size: 182000, mime: "application/pdf", owner: P.accountant, created_at: at(days) };
      return id;
    }
    function itemFile(project, itemId, name, days, local) {
      const id = ++ids.f;
      const key = local ? null : "p/" + project.id + "/item/" + (id.toString(16).padStart(8, "0") + "1".repeat(24)) + "/" + name.replace(/[^A-Za-z0-9._ -]+/g, "_");
      out.files.push(Object.assign({ id, project_id: project.id, estimate_item_id: itemId, journal_entry_id: null, bill_id: null, folder: "item", subpath: "",
        name, storage_path: key, size: 96000, mime: "application/pdf", version_no: 1, previous_id: null, is_financial: false, storage: local ? "local" : "cloud",
        rel_path: local ? project.folder_name + "/Items/" + name : null, modified_at: local ? at(days) : null, description: null, preview_path: null,
        source: local ? "desktop" : "portal2", deleted_at: null }, audit(days, P.manager)));
      if (key) out.objects[key] = { size: 96000, mime: "application/pdf", owner: P.manager, created_at: at(days) };
    }
    // the item's tasks: the job's own seeded tasks, tied to an item (no new task: the P3 counts stay as they are)
    const linked = new Set();
    function linkTask(project, itemId, n) {
      const t = out.tasks.filter((x) => x.project_id === project.id && !x.estimate_item_id && !linked.has(x.id))
        .sort((x, y) => x.id - y.id)[n || 0];
      if (t) { t.estimate_item_id = itemId; linked.add(t.id); }
    }
    function estimate(project, f, days) {
      const id = ++ids.e;
      const number = out.estimates.filter((e) => e.project_id === project.id).length + 1;
      out.estimates.push(Object.assign({ id, project_id: project.id, number, kind: "estimate", co_number: null, name: "", description: null, status: "draft",
        sent_date: null, approved_date: null, client_notes: null, group_order: [], archived_at: null, deleted_at: null }, f, audit(days, P.manager_prices)));
      return id;
    }
    function item(project, estimateId, f, prices) {
      const id = ++ids.it;
      const sort = out.estimate_items.filter((x) => x.estimate_id === estimateId).length + 1;
      out.estimate_items.push(Object.assign({ id, estimate_id: estimateId, project_id: project.id, group_name: null, group_code: null, sort, name: "",
        description: null, labor_area: null, labor_guys: null, labor_days: null, labor_qty: 1, material_description: null, material_qty: 1, material_area: null,
        assigned_contact_id: null, assigned_text: null, notes: null, item_type: "both", deleted_at: null }, f, audit(12, P.manager_prices)));
      out.estimate_item_prices.push(Object.assign({ item_id: id, labor_rate: 90, labor_unit_price: null, labor_markup_pct: 10, material_unit_price: null,
        material_markup_pct: 15, quoted_price: null }, prices || {}, audit(12, P.manager_prices)));
      return id;
    }
    const itemsOf = (project, estName) => {
      const e = out.estimates.find((x) => x.project_id === project.id && x.name === estName && !x.deleted_at);
      return e ? out.estimate_items.filter((i) => i.estimate_id === e.id && !i.deleted_at).sort((a, b) => a.sort - b.sort) : [];
    };

    // these four jobs get one coherent stage history (the base seed's random status lines would put "sent" after
    // "approved" on the chart's spine)
    const sb = byNumber("A267"), other = byNumber("A304"), bid = byNumber("A301"), sent = byNumber("A302");
    const staged = new Set([sb, other, bid, sent].filter(Boolean).map((p) => p.id));
    out.activity = out.activity.filter((a) => !(a.kind === "status" && staged.has(a.project_id)));

    /* the sandbox (A267, in progress): every state the chart can show */
    if (sb) {
      status(sb, "new_request", "estimating", 44);
      status(sb, "estimating", "sent", 30);
      status(sb, "sent", "approved", 21);
      status(sb, "approved", "in_progress", 15);
      const main = itemsOf(sb, "Main house framing");
      const deck = itemsOf(sb, "Deck option");
      const co1 = itemsOf(sb, "Extra window on the north wall");
      const [floor, ext, inner, crane, roof] = main;
      if (floor) {
        floor.assigned_contact_id = vendor(1) ? vendor(1).id : null;
        const q1 = quote(sb, floor.id, { status: "awarded", received_date: day(26), vendor: vendor(1) }, 9150, 29);
        quote(sb, floor.id, { status: "declined", received_date: day(25), vendor: vendor(2), notes: "Came in higher; kept for comparison." }, 9875, 29);
        const b = bill(sb, { estimate_item_id: floor.id, quote_id: q1.id, vendor_contact_id: q1.vendor_contact_id, vendor_name: q1.vendor_name,
          amount: 9150, description: "Floor package delivered", document_file_id: receipt(sb, "Floor package invoice.pdf", 18) }, 18);
        approve(b, 16);
        pay(b, 9150, 12);
        out.costs.push(Object.assign({ id: ++ids.k, project_id: sb.id, estimate_item_id: floor.id, cost_date: day(14), kind: "material",
          description: "Extra blocking lumber", vendor: vname(vendor(1)), amount: 412.18, hours: null, rate: null }, audit(14, P.accountant)));
        flag(floor.id, sb, { state: "complete", note: "Subfloor nailed off and inspected" }, 9);
      }
      if (ext) {
        quote(sb, ext.id, { status: "self", vendor: null, vendor_name: "DCR crew", requested_date: null }, undefined, 24);
        flag(ext.id, sb, { state: "important", note: "Shear nailing inspection - call the inspector", due_date: day(-3) }, 2);
        itemFile(sb, ext.id, "Shear wall schedule S-2.pdf", 20, true);
        linkTask(sb, ext.id);
      }
      if (inner) {
        // asked 20 days ago, chased 16 days ago, still nothing: the chart asks about it
        quote(sb, inner.id, { status: "requested", follow_ups: 1, last_follow_up: day(16), vendor: vendor(3) }, undefined, 20);
      }
      if (crane) {
        crane.assigned_text = "Crane service (sub)";
        const qc = quote(sb, crane.id, { status: "awarded", received_date: day(19), vendor: vendor(4), notes: "Half day, operator included. Quoted $1,850." }, 1850, 22);
        // billed, waiting for the paperwork and an approval
        bill(sb, { estimate_item_id: crane.id, quote_id: qc.id, vendor_contact_id: qc.vendor_contact_id, vendor_name: qc.vendor_name, amount: 1850,
          description: "Crane, half day" }, 4);
        itemFile(sb, crane.id, "Crane lift plan.pdf", 19, false);
      }
      if (roof) {
        const qr = quote(sb, roof.id, { status: "awarded", received_date: day(17), vendor: vendor(5) }, 6400, 21);
        const b = bill(sb, { estimate_item_id: roof.id, quote_id: qr.id, vendor_contact_id: qr.vendor_contact_id, vendor_name: qr.vendor_name, amount: 4200,
          description: "Roof sheathing, first draw", due_date: day(3), document_file_id: receipt(sb, "Roof draw 1.pdf", 10) }, 10);
        approve(b, 8);
        pay(b, 1500, 6);
        flag(roof.id, sb, { state: "blocked", note: "Waiting on the truss delivery (pushed to next week)" }, 1, P.manager);
        linkTask(sb, roof.id);
      }
      if (deck[0]) quote(sb, deck[0].id, { status: "requested", vendor: vendor(2) }, undefined, 3);
      if (co1[0]) {
        const qco = quote(sb, co1[0].id, { kind: "change_order", status: "awarded", received_date: day(11), vendor: vendor(6), notes: "Header and trim-out for the new window" }, 860, 12);
        const b = bill(sb, { estimate_item_id: co1[0].id, quote_id: qco.id, vendor_contact_id: qco.vendor_contact_id, vendor_name: qco.vendor_name, amount: 980,
          description: "Window opening - billed past the change order", document_file_id: receipt(sb, "CO window invoice.pdf", 6) }, 6);
        approve(b, 5);
      }
      // a quote no item accounts for, a bill against nothing, an unplanned cost
      quote(sb, null, { status: "received", received_date: day(7), vendor: vendor(0), notes: "Dumpster, two pulls" }, 640, 9);
      bill(sb, { vendor_name: "Hillside Equipment Rental", amount: 650, description: "Concrete pump rental (not estimated)",
        document_file_id: receipt(sb, "Pump rental.pdf", 13) }, 13);
      out.costs.push(Object.assign({ id: ++ids.k, project_id: sb.id, estimate_item_id: null, cost_date: day(11), kind: "equipment",
        description: "Generator fuel", vendor: "Fuel stop", amount: 86.4, hours: null, rate: null }, audit(11, P.accountant)));
      // money in: the main estimate invoiced (sent, past due, part paid), the change order paid
      const estMain = out.estimates.find((e) => e.project_id === sb.id && e.name === "Main house framing");
      const estCo = out.estimates.find((e) => e.project_id === sb.id && e.name === "Extra window on the north wall");
      if (estMain) {
        const inv = ++ids.i;
        out.invoices.push(Object.assign({ id: inv, project_id: sb.id, number: sb.number + "-01", invoice_date: day(20), due_date: day(5), description: "Framing, first draw",
          status: "sent", sent_date: day(20), terms: "Net 15", notes: null, deleted_at: null }, audit(20, P.accountant)));
        out.invoice_lines.push(Object.assign({ id: ++ids.l, invoice_id: inv, sort: 1, description: "Framing - 40% of the contract", qty: 1, unit_price: 14800, amount: 14800,
          estimate_id: estMain.id }, audit(20, P.accountant)));
        out.client_payments.push(Object.assign({ id: ++ids.c, invoice_id: inv, paid_date: day(8), amount: 5000, method: "check", reference: "2231" }, audit(8, P.accountant)));
      }
      if (estCo) {
        const inv = ++ids.i;
        out.invoices.push(Object.assign({ id: inv, project_id: sb.id, number: sb.number + "-02", invoice_date: day(9), due_date: day(-6), description: "Change order #1",
          status: "paid", sent_date: day(9), terms: "Net 15", notes: null, deleted_at: null }, audit(9, P.accountant)));
        out.invoice_lines.push(Object.assign({ id: ++ids.l, invoice_id: inv, sort: 1, description: "Change order #1 - extra window", qty: 1, unit_price: 1450, amount: 1450,
          estimate_id: estCo.id }, audit(9, P.accountant)));
        out.client_payments.push(Object.assign({ id: ++ids.c, invoice_id: inv, paid_date: day(3), amount: 1450, method: "check", reference: "2240" }, audit(3, P.accountant)));
      }
    }

    /* A304 (in progress, p5a-est's second job): one quote in, one still out */
    if (other) {
      const its = out.estimate_items.filter((i) => i.project_id === other.id && !i.deleted_at);
      if (its[0]) quote(other, its[0].id, { status: "received", received_date: day(4), vendor: vendor(2) }, 5200, 9);
      if (its[1]) quote(other, its[1].id, { status: "requested", vendor: vendor(5) }, undefined, 6);
      status(other, "new_request", "estimating", 30);
      status(other, "estimating", "sent", 16);
      status(other, "sent", "approved", 10);
      status(other, "approved", "in_progress", 6);
    }

    /* A301 (estimating): the bidding region in full */
    if (bid) {
      status(bid, "new_request", "estimating", 9);
      const e = estimate(bid, { name: "Framing bid", description: "Framing and sheathing per the architect's set." }, 8);
      const a = item(bid, e, { group_name: "Walls", group_code: "06.11.00", name: "Walls and plates", labor_guys: 4, labor_days: 5,
        material_description: "2x6 package", material_qty: 300 }, { material_unit_price: 6.85 });
      const b = item(bid, e, { group_name: "Floor", group_code: "06.10.00", name: "Floor system", labor_guys: 3, labor_days: 3, item_type: "labor" });
      const c = item(bid, e, { group_name: "Roof", group_code: "06.17.00", name: "Trusses (supplier)", item_type: "sub", assigned_text: "Truss supplier" },
        { labor_rate: null });
      item(bid, e, { group_name: "Roof", group_code: "06.17.00", name: "Roof sheathing", labor_guys: 3, labor_days: 2, material_qty: 80,
        material_description: "1/2\" CDX" }, { material_unit_price: 32.5 });
      quote(bid, a, { status: "received", received_date: day(2), vendor: vendor(1) }, 2050, 7);
      quote(bid, a, { status: "requested", vendor: vendor(2) }, undefined, 7);
      quote(bid, c, { status: "requested", vendor: vendor(4) }, undefined, 5);
      quote(bid, c, { status: "requested", vendor: vendor(6) }, undefined, 5);
      flag(b, bid, { state: "important", note: "Confirm the joist size with the engineer", due_date: day(-1) }, 1, P.manager);
    }

    /* A302 (sent): the estimate went to the client five days ago */
    if (sent) {
      status(sent, "new_request", "estimating", 20);
      status(sent, "estimating", "sent", 5);
      const e = estimate(sent, { name: "Garage framing", status: "sent", sent_date: day(5) }, 12);
      const a = item(sent, e, { group_name: "Walls", name: "Garage walls", labor_guys: 3, labor_days: 3, material_qty: 140,
        material_description: "2x6 studs" }, { material_unit_price: 6.85 });
      item(sent, e, { group_name: "Roof", name: "Garage roof framing", labor_guys: 3, labor_days: 2 });
      quote(sent, a, { status: "received", received_date: day(8), vendor: vendor(3) }, 1180, 11);
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
