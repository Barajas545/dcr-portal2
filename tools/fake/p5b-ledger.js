/* DCR Portal 2 — DEMO MODE ONLY: P5b's ledger side of migration M5b (20261026000100_books_ledger.sql) in the
   in-memory database, read and written by ledger.html, report-expenses.html and the project's Expenses and
   Payments tabs. Loaded BEFORE engine.js and AFTER tools/fake/p5a-pm.js (whose money tables — costs, bills,
   payments, invoices — these rules and rows extend); installed into each engine (NS.extInstall). Never
   published (tools/ is not part of the site).

   The columns and rules, as the shared P5b contract names them:
   * costs: card (one of the 8 card ids, NOT NULL, 'untagged' for none), card_by / card_at (the database's stamp;
     NULL while untagged), reconciled_by / reconciled_at, employee_id and employee_source ('inferred' | 'confirmed'):
     a labour row's crew member INFERRED by the database (app.cost_employee_guess: its "who", else the first words
     of its description before a dash; exactly one active employee - none active: exactly one turned-off one), the
     existing rows inferred once (the seed does it the same way); read with the financials switch (Desktop 2's RLS,
     tools/fake/p5a-pm.js); written from Portal 2 only through:
     - rpc tag_costs(p_ids, p_card): app.can_edit('money') — an admin, or a manager or accountant with financials
       (42501 otherwise); the card one of the 8 ids (22023); 1..1,000 ids (22023); stamps card_by / card_at; a
       reconciled row whose card changes is not reconciled any more; answers {changed: [ids], unchanged: [ids],
       refused: [{id, reason: "No such cost."}], card};
     - rpc reconcile_costs(p_ids, p_on default true): the same callers; reconciled_by / _at set or cleared;
       {changed, unchanged, refused, on};
     - rpc confirm_cost_employee(p_ids, p_employee_id): the same callers; the employee must exist (22023 "That is
       not somebody on the employee list."), NULL for nobody; employee_source 'confirmed'; {changed, unchanged,
       refused, employeeId};
     none of them writes an activity line (P5 acceptance check 5: no amount in any activity row);
   * files.cost_id: a receipt's link to its cost row (financial files under f/{project}/receipts/…);
   * payments: payee, memo and the pick-up stamp (M4, 20261023000100_agents_core.sql) — read by the project's
     Payments tab.
   Made-up data only: costs on the sandbox job and five other made-up jobs over fourteen months (so every
   period chip has its own count), cards, reconciled rows, stored and confirmed employees and descriptions a
   first name can be read from, receipts (images with a preview, PDFs, a row with two), a credit (a negative
   amount), a row with no amount, a description a spreadsheet would run as a formula, and an older paid
   invoice (billed out). */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const CARD_IDS = ["untagged", "card-amex", "card-visa", "card-fuel", "check", "account", "employee", "cash"];
  const COST_EXTRA = { card: "untagged", card_by: null, card_at: null, reconciled_by: null, reconciled_at: null, employee_id: null, employee_source: null };
  const PAYMENT_EXTRA = { payee: null, memo: null, pickup_told_at: null, pickup_told_by: null, pickup_told_how: null };
  const SIGS = { tag_costs: ["p_ids", "p_card"], reconcile_costs: ["p_ids", "p_on"], confirm_cost_employee: ["p_ids", "p_employee_id"] };
  const OPTIONAL = { reconcile_costs: ["p_on"] };

  /* app.cost_employee_guess(kind, vendor, description) of M5b: the one employee a labour cost's words name, or null */
  function costEmployeeGuess(employees, kind, vendor, description) {
    if (kind !== "labor") return null;
    const tries = [String(vendor || ""), String(description || "").split(/\s*[-\u2013\u2014]\s*/)[0]];
    for (let head of tries) {
      head = head.replace(/\s+/g, " ").trim();
      if (!head || head.length > 30 || !/^[A-Za-z][A-Za-z .']*$/.test(head)) continue;
      const want = head.toLowerCase();
      const named = (e) => String(e.full_name || "").toLowerCase() === want || String(e.full_name || "").toLowerCase().split(" ")[0] === want;
      let ids = (employees || []).filter((e) => e.active !== false && named(e)).map((e) => e.id);
      if (!ids.length) ids = (employees || []).filter(named).map((e) => e.id);
      if (ids.length === 1) return ids[0];
    }
    return null;
  }
  NS.costEmployeeGuess = costEmployeeGuess;

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, COLS, PgErr, deny, rule, nowIso, clone, commitUpdate, projectVisible } = E;
    // M5b's columns on the tables p5a-pm.js and engine.js declared (idempotent: every engine shares COLS)
    if (COLS.costs) Object.keys(COST_EXTRA).forEach((k) => { if (!(k in COLS.costs)) COLS.costs[k] = COST_EXTRA[k]; });
    if (COLS.payments) Object.keys(PAYMENT_EXTRA).forEach((k) => { if (!(k in COLS.payments)) COLS.payments[k] = PAYMENT_EXTRA[k]; });
    if (COLS.files && !("cost_id" in COLS.files)) COLS.files.cost_id = null;          // current_files shares the object
    if (COLS.bills && !("kind" in COLS.bills)) COLS.bills.kind = null;                // M5b (its rules: tools/fake/p5b-books.js)
    if (!rows.costs) return null;

    // app.can_edit('money')
    const moneyEditor = (w) => w.active && (w.admin || ((w.role === "manager" || w.role === "accountant") && w.financials));
    const readable = (w, c) => !!c && w.financials && projectVisible(w, c.project_id);
    const costOf = (id) => rows.costs.find((c) => c.id === Number(id)) || null;

    // app.books_ids: distinct, no NULL, in id order; 1 .. 1,000
    function idList(v) {
      if (!Array.isArray(v)) throw rule("22023", "p_ids must be a list of row ids");
      const ids = Array.from(new Set(v.filter((n) => n !== null && n !== undefined).map(Number).filter((n) => Number.isInteger(n)))).sort((a, b) => a - b);
      if (!ids.length) throw rule("22023", "Nothing was selected.");
      if (ids.length > 1000) throw rule("22023", "At most 1,000 at a time.");
      return ids;
    }
    // each row locked in id order: unreadable -> refused, already so -> unchanged, else changed
    function each(w, ids, same, change) {
      const changed = [], unchanged = [], refused = [];
      ids.forEach((id) => {
        const c = costOf(id);
        if (!readable(w, c)) { refused.push({ id, reason: "No such cost." }); return; }
        if (same(c)) { unchanged.push(id); return; }
        const r = Object.assign(clone(c), change(c));
        E.auditUpdate(w, "costs", r, c);
        commitUpdate("costs", c, r);
        changed.push(id);
      });
      return { changed, unchanged, refused };
    }

    function checkArgs(name, args) {
      const keys = Object.keys(args || {});
      const want = SIGS[name];
      const opt = OPTIONAL[name] || [];
      if (keys.some((k) => !want.includes(k)) || want.some((k) => !opt.includes(k) && !keys.includes(k))) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404);
      }
    }
    function rpc(w, name, args) {
      if (!moneyEditor(w)) throw deny("You don't have permission to change the ledger.");
      if (name === "tag_costs") {
        const card = String(args.p_card == null ? "" : args.p_card).trim().toLowerCase();
        if (!CARD_IDS.includes(card)) throw rule("22023", "That is not one of the payment methods.");
        const ids = idList(args.p_ids);
        const at = nowIso();
        const out = each(w, ids, (c) => (c.card || "untagged") === card, (c) => Object.assign(
          card === "untagged" ? { card, card_by: null, card_at: null } : { card, card_by: w.uid, card_at: at },
          // a different card is not what was reconciled (tg_costs_ledger)
          c.reconciled_at ? { reconciled_at: null, reconciled_by: null } : {}));
        return Object.assign(out, { card });
      }
      if (name === "reconcile_costs") {
        const on = args.p_on === undefined || args.p_on === null ? true : args.p_on === true || args.p_on === "true";
        const ids = idList(args.p_ids);
        const at = nowIso();
        const out = each(w, ids, (c) => !!c.reconciled_at === on,
          () => (on ? { reconciled_by: w.uid, reconciled_at: at } : { reconciled_by: null, reconciled_at: null }));
        return Object.assign(out, { on });
      }
      if (name === "confirm_cost_employee") {
        const empId = args.p_employee_id === null || args.p_employee_id === undefined ? null : Number(args.p_employee_id);
        if (empId !== null && !rows.employees.some((e) => e.id === empId)) throw rule("22023", "That is not somebody on the employee list.");
        const ids = idList(args.p_ids);
        const src = empId === null ? null : "confirmed";
        const out = each(w, ids, (c) => (c.employee_id === undefined ? null : c.employee_id) === empId && (c.employee_source || null) === src,
          () => ({ employee_id: empId, employee_source: src }));
        return Object.assign(out, { employeeId: empId });
      }
      throw new PgErr("PGRST202", "Could not find the function public." + name, 404);
    }

    return { name: "p5b-ledger", tables: new Set(), canRead: () => false, handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc };
  });

  /* ── made-up data (after tools/fake/p5a-pm.js made the sandbox's first two costs and its bills) ── */
  (NS.extSeed = NS.extSeed || []).push(function seedLedger(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const today = h.today;
    const iso = (d) => new Date(d).toISOString();
    const at = (days, hour) => {
      const [y, m, d] = today.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d - days, 17 + (hour || 0), 20, 0));
      return t.getTime() > now.getTime() ? iso(now.getTime() - 60000 * (days + 7)) : iso(t);
    };
    const day = (days) => {
      const [y, m, d] = today.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
    };
    const audit = (days, by) => ({ created_at: at(days), created_by: by || P.accountant, updated_at: at(days), updated_by: null, version: 1 });
    const roster = out.employees || [];
    ["costs", "files", "invoices", "invoice_lines", "client_payments", "payments"].forEach((t) => { out[t] = out[t] || []; });
    out.objects = out.objects || {};
    const maxId = (t) => out[t].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const ids = { k: maxId("costs"), f: maxId("files"), i: maxId("invoices"), l: maxId("invoice_lines"), c: maxId("client_payments") };
    const byNumber = (n) => out.projects.find((p) => p.number === n);
    const emp = (name) => (out.employees || []).find((e) => e.full_name === name) || null;
    out.costs.forEach((c) => {
      Object.keys(COST_EXTRA).forEach((k) => { if (!(k in c) || (k === "card" && !c.card)) c[k] = COST_EXTRA[k]; });
      // the existing labour costs: their crew member inferred once (the migration's one-time update)
      if (c.employee_id === null) {
        const g = costEmployeeGuess(roster, c.kind, c.vendor, c.description);
        if (g !== null) Object.assign(c, { employee_id: g, employee_source: "inferred" });
      }
    });
    out.payments.forEach((p) => Object.keys(PAYMENT_EXTRA).forEach((k) => { if (!(k in p)) p[k] = PAYMENT_EXTRA[k]; }));
    out.files.forEach((f) => { if (!("cost_id" in f)) f.cost_id = null; });

    function cost(project, f, days) {
      if (!project) return null;
      const row = Object.assign({ id: ++ids.k, project_id: project.id, estimate_item_id: null, cost_date: day(days), kind: "material", description: null,
        vendor: null, amount: 0, hours: null, rate: null }, COST_EXTRA, f, audit(days, f.by));
      delete row.by;
      // a labour cost's crew member, inferred by the database when the cost is added (tg_costs_ledger)
      if (row.employee_id === null) {
        const g = costEmployeeGuess(roster, row.kind, row.vendor, row.description);
        if (g !== null) Object.assign(row, { employee_id: g, employee_source: "inferred" });
      }
      out.costs.push(row);
      return row;
    }
    function tag(c, card, days, by) { if (c) Object.assign(c, { card, card_by: by || P.accountant, card_at: at(days, 1) }); }
    function reconcile(c, days, by) { if (c) Object.assign(c, { reconciled_by: by || P.accountant, reconciled_at: at(days, 2) }); }
    function receipt(c, name, days, image) {
      if (!c) return null;
      const id = ++ids.f;
      const hex = (id.toString(16).padStart(8, "0") + "c".repeat(24));
      const leaf = name.replace(/[^A-Za-z0-9._ -]+/g, "_");
      const key = "f/" + c.project_id + "/receipts/" + hex + "/" + leaf;
      const prev = image ? "f/" + c.project_id + "/receipts/" + hex + "/preview-" + leaf.replace(/\.[^.]+$/, "") + ".jpg" : null;
      out.files.push(Object.assign({ id, project_id: c.project_id, estimate_item_id: null, journal_entry_id: null, bill_id: null, cost_id: c.id,
        folder: "receipts", subpath: "", name, storage_path: key, size: image ? 412000 : 188000, mime: image ? "image/jpeg" : "application/pdf",
        version_no: 1, previous_id: null, is_financial: true, storage: "cloud", rel_path: null, modified_at: null, description: null,
        preview_path: prev, source: "desktop", deleted_at: null }, audit(days, P.accountant)));
      out.objects[key] = { size: image ? 412000 : 188000, mime: image ? "image/jpeg" : "application/pdf", owner: P.accountant, created_at: at(days) };
      if (prev) out.objects[prev] = { size: 21000, mime: "image/jpeg", owner: P.accountant, created_at: at(days) };
      return id;
    }

    const sb = byNumber("A267"), kitchen = byNumber("A304"), addition = byNumber("A305"), shop = byNumber("A266"),
      deck = byNumber("A229"), second = byNumber("A211");
    const blair = emp("Blair Sycamore"), lead = emp("Riley Lead"), emery = emp("Emery Chaparral");

    /* the sandbox job: every state a row can be in */
    if (sb) {
      const first = out.costs.find((c) => c.project_id === sb.id && c.kind === "material");
      const fuel = out.costs.find((c) => c.project_id === sb.id && c.kind === "equipment");
      if (first) { tag(first, "card-amex", 13); receipt(first, "Lumber yard receipt.jpg", 14, true); }
      if (fuel) { tag(fuel, "card-fuel", 10); receipt(fuel, "Fuel stop.jpg", 11, true); }
      // a labour row priced by the hour, whose description names a first name nobody stored yet
      cost(sb, { kind: "labor", description: "Alex - pick up hangers and nails at the yard", hours: 3, rate: 45, amount: 135 }, 6);
      // stored by the import as inferred, and one confirmed
      cost(sb, { kind: "labor", description: "Cleanup and dump run", amount: 270, employee_id: blair ? blair.id : null,
        employee_source: blair ? "inferred" : null }, 9);
      const ot = cost(sb, { kind: "labor", description: "Saturday crew - trusses", amount: 640, employee_id: lead ? lead.id : null,
        employee_source: lead ? "confirmed" : null }, 16);
      reconcile(ot, 12);
      const pump = cost(sb, { kind: "subcontractor", description: "Concrete pump operator, half day", vendor: "Sagebrook Pumping", amount: 475 }, 13);
      tag(pump, "check", 12); reconcile(pump, 12); receipt(pump, "Pump operator invoice.pdf", 13, false);
      const hangers = cost(sb, { kind: "material", description: "Simpson hangers, nails and straps", vendor: "Kestrel Lumber Supply", amount: 228.4 }, 2);
      receipt(hangers, "Hangers receipt page 1.pdf", 2, false); receipt(hangers, "Hangers receipt photo.jpg", 2, true);
      const credit = cost(sb, { kind: "material", description: "Returned lumber (credit)", vendor: "Kestrel Lumber Supply", amount: -64.25 }, 5);
      tag(credit, "card-amex", 4);
      cost(sb, { kind: "other", description: "Permit copies", vendor: "County counter", amount: 18 }, 20);
      cost(sb, { kind: "material", description: "Lumber placeholder (no amount yet)", amount: 0 }, 8);
      // typed the way a bookkeeper would; a spreadsheet would run it as a formula without the guard
      const formula = cost(sb, { kind: "material", description: "=2x6 studs, 40 more for the north wall", vendor: "Marlow Lumber Supply", amount: 311.6 }, 3);
      tag(formula, "card-visa", 3);
    }
    /* five other made-up jobs, over fourteen months */
    if (kitchen) {
      const a = cost(kitchen, { kind: "material", description: "Cabinet blocking lumber", vendor: "Wilder Lumber Supply", amount: 312.55 }, 40);
      tag(a, "card-visa", 38); reconcile(a, 30); receipt(a, "Wilder blocking.pdf", 40, false);
      cost(kitchen, { kind: "labor", description: "Devon - demo old cabinets", amount: 360 }, 35);
      const b = cost(kitchen, { kind: "subcontractor", description: "Electrician rough-in", vendor: "Coldwater Electric", amount: 2150 }, 28);
      tag(b, "account", 27);
    }
    if (addition) {
      const a = cost(addition, { kind: "material", description: "Engineered beam, 5-1/4 x 11-7/8", vendor: "Hollis Lumber Supply", amount: 1284 }, 75);
      tag(a, "card-amex", 74); receipt(a, "Beam invoice.pdf", 75, false);
      cost(addition, { kind: "labor", description: "Layout and plates", amount: 405, employee_id: emery ? emery.id : null,
        employee_source: emery ? "confirmed" : null }, 70);
      cost(addition, { kind: "equipment", description: "Scissor lift rental, two days", vendor: "Hillside Equipment Rental", amount: 395 }, 68);
    }
    if (shop) {
      const a = cost(shop, { kind: "material", description: "Wall sheathing", vendor: "Larkspur Lumber Supply", amount: 2210.1 }, 130);
      tag(a, "account", 128); reconcile(a, 120);
      const b = cost(shop, { kind: "subcontractor", description: "Roofing sub - shop roof", vendor: "Greystone Roofing", amount: 5400 }, 200);
      tag(b, "check", 198); reconcile(b, 190);
      const iv = ++ids.i;
      out.invoices.push(Object.assign({ id: iv, project_id: shop.id, number: shop.number + "-01", invoice_date: day(180), due_date: day(165),
        description: "Shop framing", status: "paid", sent_date: day(180), terms: "Net 15", notes: null, deleted_at: null }, audit(180)));
      out.invoice_lines.push(Object.assign({ id: ++ids.l, invoice_id: iv, sort: 1, description: "Shop framing - complete", qty: 1, unit_price: 12500,
        amount: 12500, estimate_id: null }, audit(180)));
      out.client_payments.push(Object.assign({ id: ++ids.c, invoice_id: iv, paid_date: day(170), amount: 12500, method: "check", reference: "1180" }, audit(170)));
    }
    if (deck) {
      cost(deck, { kind: "material", description: "Deck boards and screws", vendor: "Kestrel Lumber Supply", amount: 1876.33 }, 300);
      cost(deck, { kind: "labor", description: "Harper - deck stain", amount: 520 }, 320);
    }
    if (second) {
      cost(second, { kind: "material", description: "Joist hangers (older record)", vendor: "Marlow Lumber Supply", amount: 145 }, 420);
      cost(second, { kind: "labor", description: "Jordan and Alex - framing", amount: 960 }, 390);
    }
    // the sandbox's check payment: a payee, a memo and a pick-up stamp, as the books' check desk leaves them
    const chk = out.payments.find((p) => sb && p.project_id === sb.id && p.method === "check");
    if (chk) Object.assign(chk, { payee: null, memo: "Floor package", pickup_told_at: at(11, 3), pickup_told_by: "Casey Accounts", pickup_told_how: "phone" });
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
