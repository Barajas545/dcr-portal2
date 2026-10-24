/* DCR Portal 2 — DEMO MODE ONLY: P5c's office lists of migration M5c (20261027000100_office_lists.sql) in the in-memory
   database — Leads, the Vehicle Board and Marketing Tasks — read and written by leads.html, vehicles.html and
   marketing.html. Loaded BEFORE engine.js (its column lists are read when the engine loads); installed into each engine
   (NS.extInstall). Never published (tools/ is not part of the site).

   The same tables, columns and rules as the migration (BLUEPRINT 3.3.11, Appendix D):
   * leads (client name / phone / address, project name, category, source, lead_date NOT NULL default today,
     last_contacted, notes, converted_project_id / converted_at / converted_by — convert_lead's only — legacy_sp_id — the
     import's only): read admin, manager, accountant, view-only; written by app.can_edit('leads') (admin, manager); a lead
     or field account reads none. The words tidied as app.one_line / app.text_block do; the phone formatted like every
     phone. rpc convert_lead(p_lead_id, p_project_fields) -> {lead, project}: admin, manager; create_project (the engine's
     own rules: the number, the folder, "Project A3xx created", the prices row) from the lead's words (name: its project
     name, else "<client> Residence"; its address; the client's name and phone) overridden by p_project_fields, the lead
     stamped converted and "Created from a lead" logged, in one step; a second convert is 23514 "already converted";
   * vehicles (only the used fields — NO insurance policy number; active) and vehicle_maintenance: every active person
     reads (not the agents account); app.can_edit('vehicles') (admin, manager) writes; a service stays with its vehicle;
     vehicle_maintenance_costs (maintenance_id the key, material_cost): made with every service by the database;
     financials reads; a vehicles editor with financials changes it; no delete;
     rpc complete_vehicle_maintenance(p_id, p_version, p_service_performed, p_mileage, p_oil_change) -> {maintenance,
     vehicle}: vehicles editors; the service as shown (PT409); done once (23514); today (company day); an oil change
     stamps the vehicle; its mileage only moves forward;
   * marketing_tasks (task_date default today - NULL for an old task the import brought without one; a task that BECOMES
     done stamps the completed day once, undone clears it; an imported done task without its day keeps none):
     read admin, manager, accountant, view-only (a deleted project's: admins); app.can_edit('marketing') writes;
     marketing_task_prices (task_id the key, price): made with every task; financials reads; a marketing editor with
     financials changes it (Q17);
   * nothing here writes an activity line except convert_lead's two (P5 check 5: no amount);
   * the DCR Agents 2 account reads none of them.
   Made-up data only: leads (open, converted, never contacted, imported), a fleet with oil, service and paperwork due
   this month and a retired van, maintenance history with material costs, marketing tasks in every state with and
   without prices. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const TABLES = ["leads", "vehicles", "vehicle_maintenance", "vehicle_maintenance_costs", "marketing_tasks", "marketing_task_prices"];
  const COLS = {
    leads: { id: null, client_name: null, client_phone: null, client_address: null, project_name: null, category: null, source: null,
      lead_date: null, last_contacted: null, notes: null, converted_project_id: null, converted_at: null, converted_by: null, legacy_sp_id: null },
    vehicles: { id: null, fleet_number: null, license_plate: null, year: null, make: null, model: null, vin: null, description: null, driver: null,
      oil_interval_months: null, oil_interval_miles: null, last_oil_date: null, last_oil_mileage: null, current_mileage: null,
      registration_due: null, emissions_due: null, dot_due: null, insurance_provider: null, notes: null, active: true, legacy_sp_id: null },
    vehicle_maintenance: { id: null, vehicle_id: null, next_service_date: null, next_service_requirements: null, service_description: null,
      recommendations: null, completed_date: null, service_performed: null, mileage: null, labor_time: null, legacy_sp_id: null },
    vehicle_maintenance_costs: { maintenance_id: null, material_cost: null },
    marketing_tasks: { id: null, project_id: null, name: null, category: null, description: null, task_date: null, done: false, completed_date: null,
      completed_work: null, invoiced: false, paid: false, legacy_sp_id: null },
    marketing_task_prices: { task_id: null, price: null },
  };
  const SIGS = {
    convert_lead: { args: ["p_lead_id", "p_project_fields"], required: ["p_lead_id"] },
    complete_vehicle_maintenance: { args: ["p_id", "p_version", "p_service_performed", "p_mileage", "p_oil_change"], required: ["p_id", "p_version"] },
  };
  // the columns' length checks and number ranges (the migration's CHECKs)
  const LEN = {
    leads: { client_name: 200, client_phone: 80, client_address: 500, project_name: 200, category: 100, source: 100, notes: 20000 },
    vehicles: { fleet_number: 40, license_plate: 20, make: 60, model: 80, vin: 40, description: 300, driver: 300, insurance_provider: 120, notes: 20000 },
    vehicle_maintenance: { next_service_requirements: 4000, service_description: 4000, recommendations: 4000, service_performed: 4000, labor_time: 100 },
    marketing_tasks: { name: 200, category: 100, description: 20000, completed_work: 20000 },
  };
  const RANGE = {
    vehicles: { year: [1900, 2100], oil_interval_months: [1, 120], oil_interval_miles: [1, 100000], last_oil_mileage: [0, 10000000], current_mileage: [0, 10000000] },
    vehicle_maintenance: { mileage: [0, 10000000] },
    vehicle_maintenance_costs: { material_cost: [0, 1e10] },
    marketing_task_prices: { price: [0, 1e10] },
  };
  const ONE_LINE = {
    leads: ["client_name", "client_phone", "client_address", "project_name", "category", "source"],
    vehicles: ["fleet_number", "license_plate", "make", "model", "vin", "description", "driver", "insurance_provider"],
    vehicle_maintenance: ["labor_time"],
    marketing_tasks: ["name", "category"],
  };
  const BLOCK = { leads: ["notes"], vehicles: ["notes"], vehicle_maintenance: ["next_service_requirements", "service_description", "recommendations", "service_performed"],
    marketing_tasks: ["description", "completed_work"] };
  const DATES = { leads: ["lead_date", "last_contacted"], vehicles: ["last_oil_date", "registration_due", "emissions_due", "dot_due"],
    vehicle_maintenance: ["next_service_date", "completed_date"], marketing_tasks: ["task_date", "completed_date"] };

  (NS.extTables = NS.extTables || []).push({
    tables: TABLES,
    cols: COLS,
    pk: { vehicle_maintenance_costs: "maintenance_id", marketing_task_prices: "task_id" },
    uuid: [],
    noAudit: [],
    fks: [
      ["leads", "converted_project_id", "projects"],
      ["vehicle_maintenance", "vehicle_id", "vehicles"],
      ["vehicle_maintenance_costs", "maintenance_id", "vehicle_maintenance", true],
      ["marketing_tasks", "project_id", "projects"],
      ["marketing_task_prices", "task_id", "marketing_tasks", true],
    ],
  });

  const DAYS = /^\d{4}-\d{2}-\d{2}$/;
  const oneLine = (v) => { const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim(); return s || null; };
  const block = (v) => {
    const s = String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/^[ \t\n]+|[ \t\n]+$/g, "");
    return s || null;
  };
  /* app.format_phone, for the plain cases: one US number, maybe a label and an extension; anything else as typed */
  function formatPhone(v) {
    const s = oneLine(v);
    if (!s) return null;
    const m = /^(?:([A-Za-z][A-Za-z.'& ]*[-:]?)\s*)?(?:\+?1[\s.-]*)?(?:\(\s*([2-9]\d{2})\s*\)|([2-9]\d{2}))[\s.+-]*(\d{3})[\s.+-]*(\d{4})(?:\s*,?\s*(?:extension|ext\.?|x|#)\s*[.:]?\s*(\d{1,6}))?$/i.exec(s);
    if (!m) return s;
    const label = (m[1] || "").replace(/[\s:.-]+$/, "");
    const names = { cell: "Cell:", c: "Cell:", mobile: "Cell:", m: "Cell:", office: "Office:", o: "Office:", work: "Office:", w: "Office:", home: "Home:", h: "Home:" };
    const lab = label ? (names[label.toLowerCase()] || label) + " " : "";
    return lab + "(" + (m[2] || m[3]) + ") " + m[4] + "-" + m[5] + (m[6] ? " ext. " + m[6] : "");
  }
  NS.p5cFormatPhone = formatPhone;

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, PgErr, deny, rule, clone, commitUpdate, commitInsert, auditInsert, auditUpdate, projectVisible, today, nowIso, logActivity } = E;
    const tables = new Set(TABLES);
    const office = (w) => w.active && ["admin", "manager", "accountant", "viewer"].includes(w.role);   // leads, marketing: read
    const editor = (w) => w.active && (w.role === "admin" || w.role === "manager");                  // can_edit leads / vehicles / marketing
    const moneyEditor = (w) => editor(w) && w.financials;                                              // the cost and price rows
    const maintOf = (id) => rows.vehicle_maintenance.find((m) => m.id === Number(id)) || null;
    const taskOf = (id) => rows.marketing_tasks.find((t) => t.id === Number(id)) || null;
    const vehicleOf = (id) => rows.vehicles.find((v) => v.id === Number(id)) || null;
    let viaRpc = 0;                                                                                     // convert_lead's own writes

    function canRead(w, table, r) {
      if (!w.active) return false;
      switch (table) {
        case "leads": return office(w);
        case "vehicles": case "vehicle_maintenance": return true;
        case "vehicle_maintenance_costs": return w.financials && !!maintOf(r.maintenance_id);
        case "marketing_tasks": return office(w) && projectVisible(w, r.project_id);
        case "marketing_task_prices": { const t = taskOf(r.task_id); return w.financials && !!t && canRead(w, "marketing_tasks", t); }
        default: return false;
      }
    }
    function canInsert(w, table, r) {
      switch (table) {
        case "leads": case "vehicles": case "vehicle_maintenance": return editor(w);
        case "marketing_tasks": return editor(w) && projectVisible(w, r.project_id);
        case "vehicle_maintenance_costs": return moneyEditor(w) && !!maintOf(r.maintenance_id);
        case "marketing_task_prices": return moneyEditor(w) && !!taskOf(r.task_id);
        default: return false;
      }
    }
    function canUpdate(w, table, r) { return canInsert(w, table, r); }
    function canDelete(w, table, r) {
      if (table === "vehicle_maintenance_costs" || table === "marketing_task_prices") return false;   // with their record
      return tables.has(table) && canInsert(w, table, r);
    }

    // the CHECKs, NOT NULLs and BEFORE triggers of the migration
    function tidy(w, table, r, old) {
      const bad = (col) => rule("23514", 'new row for relation "' + table + '" violates check constraint "' + table + "_" + col + '_check"');
      (ONE_LINE[table] || []).forEach((c) => { r[c] = oneLine(r[c]); });
      (BLOCK[table] || []).forEach((c) => { r[c] = block(r[c]); });
      if (table === "leads") r.client_phone = formatPhone(r.client_phone);
      if (table === "vehicles") { if (r.license_plate) r.license_plate = r.license_plate.toUpperCase(); if (r.vin) r.vin = r.vin.toUpperCase(); }
      (DATES[table] || []).forEach((c) => {
        if (r[c] === "") r[c] = null;
        if (r[c] !== null && r[c] !== undefined && !DAYS.test(String(r[c]))) throw rule("22007", 'invalid input syntax for type date: "' + r[c] + '"');
      });
      Object.entries(LEN[table] || {}).forEach(([c, n]) => { if (r[c] !== null && r[c] !== undefined && String(r[c]).length > n) throw bad(c); });
      Object.entries(RANGE[table] || {}).forEach(([c, lim]) => {
        if (r[c] === null || r[c] === undefined) return;
        const n = Number(r[c]);
        if (!Number.isFinite(n)) throw rule("22P02", 'invalid input syntax for type numeric: "' + r[c] + '"');
        if (n < lim[0] || n > lim[1]) throw bad(c);
        r[c] = c === "material_cost" || c === "price" ? Math.round(n * 100) / 100 : n;
      });
      const notNull = (c) => rule("23502", 'null value in column "' + c + '" of relation "' + table + '" violates not-null constraint');
      if (table === "leads") {
        if (!r.client_name) throw rule("23514", 'new row for relation "leads" violates check constraint "leads_client_name_check"');
        if (!old && !r.lead_date) r.lead_date = today();
        if (!r.lead_date) throw notNull("lead_date");
        const conv = ["converted_project_id", "converted_at", "converted_by"];
        if (!viaRpc && (old ? conv.some((c) => (r[c] || null) !== (old[c] || null)) : conv.some((c) => r[c] !== null && r[c] !== undefined))) {
          throw deny("a lead becomes a project with convert_lead()");
        }
      }
      if (table === "marketing_tasks") {
        if (!r.name) throw rule("23514", 'new row for relation "marketing_tasks" violates check constraint "marketing_tasks_name_check"');
        if (!old && !r.task_date) r.task_date = today();
        ["done", "invoiced", "paid"].forEach((c) => { if (r[c] === null || r[c] === undefined) throw notNull(c); r[c] = r[c] === true; });
        if (r.done) { if (!r.completed_date && (!old || !old.done)) r.completed_date = today(); }
        else if (!old || old.done) r.completed_date = null;
      }
      if (table === "vehicles" && (r.active === null || r.active === undefined)) throw notNull("active");
      if (table === "vehicle_maintenance") {
        if (old && r.vehicle_id !== old.vehicle_id) throw rule("23514", "a service stays with its vehicle");
        if (!vehicleOf(r.vehicle_id)) throw rule("23503", 'insert or update on table "vehicle_maintenance" violates foreign key constraint "vehicle_maintenance_vehicle_id_fkey"');
      }
      if (table === "vehicle_maintenance_costs" && old && r.maintenance_id !== old.maintenance_id) throw rule("23514", "a cost stays with its service");
      if (table === "marketing_task_prices" && old && r.task_id !== old.task_id) throw rule("23514", "a price stays with its task");
      // the old portal's id: the import's only
      if ("legacy_sp_id" in r && (old ? (r.legacy_sp_id || null) !== (old.legacy_sp_id || null) : r.legacy_sp_id !== null && r.legacy_sp_id !== undefined)) {
        throw deny("the old portal's id is written by the import only");
      }
    }
    function beforeInsert(w, table, r) { tidy(w, table, r, null); }
    function guardUpdate(w, table, old, r) { tidy(w, table, r, old); }
    // every service has its cost row, every task its price row (security definer: whatever the caller's switches)
    function afterInsert(w, table, r) {
      const make = (t, key, extra) => {
        if (rows[t].some((x) => x[key] === r.id)) return;
        const row = Object.assign(clone(E.COLS[t]), { [key]: r.id }, extra || {});
        auditInsert(w, t, row);
        commitInsert(t, row);
      };
      if (table === "vehicle_maintenance") make("vehicle_maintenance_costs", "maintenance_id");
      if (table === "marketing_tasks") make("marketing_task_prices", "task_id");
    }

    function checkArgs(name, args) {
      const keys = Object.keys(args || {});
      const sig = SIGS[name];
      if (keys.some((k) => !sig.args.includes(k)) || sig.required.some((k) => !keys.includes(k))) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404);
      }
    }
    function update(w, table, old, patch) {
      const r = Object.assign(clone(old), patch);
      tidy(w, table, r, old);
      auditUpdate(w, table, r, old);
      commitUpdate(table, old, r);
      return r;
    }
    function convertLead(w, args) {
      if (!editor(w)) throw deny("only an admin or a manager can turn a lead into a project");
      const pf = args.p_project_fields === undefined ? null : args.p_project_fields;
      if (pf !== null && (typeof pf !== "object" || Array.isArray(pf))) throw rule("22023", "p_project_fields must be a JSON object");
      const lead = rows.leads.find((l) => l.id === Number(args.p_lead_id));
      if (!lead) throw new PgErr("PT404", "lead not found", 404);
      if (lead.converted_project_id !== null && lead.converted_project_id !== undefined) {
        const p = rows.projects.find((x) => x.id === lead.converted_project_id);
        throw rule("23514", "already converted: this lead became project " + (p ? p.number : "#" + lead.converted_project_id));
      }
      const defaults = { name: lead.project_name || lead.client_name + " Residence", address: lead.client_address,
        client_name: lead.client_name, client_phone: lead.client_phone };
      Object.keys(defaults).forEach((k) => { if (defaults[k] === null || defaults[k] === undefined) delete defaults[k]; });
      const fields = Object.assign(defaults, pf || {});
      const project = E.callRpc(w, "create_project", { fields });                     // its rules; throws before anything is kept
      viaRpc++;
      let l;
      try { l = update(w, "leads", lead, { converted_project_id: project.id, converted_at: nowIso(), converted_by: w.uid }); }
      finally { viaRpc--; }
      logActivity(w, project.id, "system", "Created from a lead");
      return { lead: clone(l), project: clone(project) };
    }
    function completeMaintenance(w, args) {
      if (!editor(w)) throw deny("only an admin or a manager can complete a vehicle service");
      const miles = args.p_mileage === undefined || args.p_mileage === null ? null : Number(args.p_mileage);
      if (miles !== null && (!Number.isInteger(miles) || miles < 0 || miles > 10000000)) throw rule("22023", "the mileage is a whole number from 0 to 10,000,000");
      const m = maintOf(args.p_id);
      if (!m) throw new PgErr("PT404", "vehicle service not found", 404);
      if (Number(args.p_version) !== m.version) {
        throw new PgErr("PT409", "the service was changed by someone else", 409, JSON.stringify({ table: "vehicle_maintenance", id: m.id, version: m.version }));
      }
      if (m.completed_date) throw rule("23514", "already done: this service was completed on " + m.completed_date);
      const performed = block(args.p_service_performed);
      const done = update(w, "vehicle_maintenance", m, { completed_date: today(), service_performed: performed || m.service_performed,
        mileage: miles === null ? m.mileage : miles });
      let v = vehicleOf(done.vehicle_id);
      if (args.p_oil_change === true || args.p_oil_change === "true") {
        v = update(w, "vehicles", v, { last_oil_date: today(), last_oil_mileage: miles === null ? v.last_oil_mileage : miles,
          current_mileage: Math.max(miles === null ? (v.current_mileage || 0) : miles, v.current_mileage || 0) });
      } else if (miles !== null && (v.current_mileage === null || v.current_mileage < miles)) {
        v = update(w, "vehicles", v, { current_mileage: miles });
      }
      return { maintenance: clone(done), vehicle: clone(v) };
    }
    function rpc(w, name, args) {
      if (name === "convert_lead") return convertLead(w, args);
      if (name === "complete_vehicle_maintenance") return completeMaintenance(w, args);
      throw new PgErr("PGRST202", "Could not find the function public." + name, 404);
    }

    return {
      name: "p5c-lists", tables, canRead, canInsert, canUpdate, canDelete, beforeInsert, guardUpdate, afterInsert,
      handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc,
    };
  });

  /* ── made-up data ── */
  (NS.extSeed = NS.extSeed || []).push(function seedLists(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const today = h.today;
    TABLES.forEach((t) => { out[t] = out[t] || []; });
    const [ty, tm, td] = today.split("-").map(Number);
    const day = (days) => new Date(Date.UTC(ty, tm - 1, td - days)).toISOString().slice(0, 10);
    const monthDay = (offsetMonths, d) => {
      const last = new Date(Date.UTC(ty, tm + offsetMonths, 0)).getUTCDate();
      return new Date(Date.UTC(ty, tm - 1 + offsetMonths, Math.min(d, last))).toISOString().slice(0, 10);
    };
    const at = (days) => {
      const t = new Date(Date.UTC(ty, tm - 1, td - days, 17, 15, 0));
      return (t.getTime() > now.getTime() ? new Date(now.getTime() - 3600000) : t).toISOString();
    };
    const audit = (days, by) => ({ created_at: at(days), created_by: by || P.manager, updated_at: at(days), updated_by: null, version: 1 });
    const byNumber = (n) => out.projects.find((p) => p.number === n) || null;
    let id = 0;

    /* leads: open ones at every contact age, one converted to a made-up job, one imported */
    const conv = byNumber("A305") || out.projects[out.projects.length - 1];
    const lead = (f, days) => out.leads.push(Object.assign({}, COLS.leads, { id: ++id }, f, { client_phone: formatPhone(f.client_phone) }, audit(days)));
    lead({ client_name: "Rowan Thistlewood", client_phone: "(805) 555-0141", client_address: "120 Juniper Ln, Pine Hollow, CA 93401",
      project_name: "Thistlewood ADU", category: "ADU", source: "Website", lead_date: day(3), last_contacted: day(1),
      notes: "Wants a 600 sq ft ADU behind the garage. Plans drawn, waiting on the permit set." }, 3);
    lead({ client_name: "Marisol Quarry", client_phone: "805.555.0142", client_address: "48 Sage Valley Rd, Sage Valley",
      project_name: null, category: "Deck", source: "Referral — Rowan T.", lead_date: day(12), last_contacted: day(18),
      notes: "Two-level deck, redwood. Asked for a rough number before the site visit." }, 12);
    lead({ client_name: "Ezra Hollowell", client_phone: null, client_address: "Cedar Flats",
      project_name: "Barn conversion", category: "Remodel", source: "Yard sign", lead_date: day(40), last_contacted: null, notes: null }, 40);
    lead({ client_name: "Juniper & Vale Holdings", client_phone: "805-555-0144 ext 12", client_address: "9 Oak Vista Blvd, Suite B, Oak Vista, CA 93422",
      project_name: "Tenant improvement, suite B", category: "Commercial", source: "Website", lead_date: day(55), last_contacted: day(33),
      notes: "Property manager. Wants framing only; their GC does the rest." }, 55);
    lead({ client_name: "Delphine Arroyo", client_phone: "(805) 555-0145", client_address: "301 Cedar Flats Way, Cedar Flats",
      project_name: "Arroyo garage", category: "Garage", source: "Old portal", lead_date: day(120), last_contacted: day(95),
      notes: "Imported from the old portal.", legacy_sp_id: 4 }, 120);
    if (conv) {
      lead({ client_name: "Hollis Brightwater", client_phone: "(805) 555-0146", client_address: (conv.address || "77 Sandbox Rd") + ", " + (conv.city || "Sandbox"),
        project_name: conv.name, category: "Addition", source: "Referral", lead_date: day(70), last_contacted: day(60),
        notes: "Converted after the second site visit.", converted_project_id: conv.id, converted_at: at(58), converted_by: P.manager }, 70);
    }

    /* the fleet: oil, service and papers due this month; a retired van; history with material costs */
    id = 0;
    const veh = (f) => { out.vehicles.push(Object.assign({}, COLS.vehicles, { id: ++id }, f, audit(400, P.admin))); return id; };
    const v1 = veh({ fleet_number: "T-01", license_plate: "8ABC123", year: 2019, make: "Ford", model: "F-250", vin: "1FT7W2BT0KEC00001",
      description: "White F-250, ladder rack", driver: "Riley Lead",
      oil_interval_months: 4, oil_interval_miles: 5000, last_oil_date: monthDay(-4, 3), last_oil_mileage: 61200, current_mileage: 64980,
      registration_due: monthDay(2, 15), insurance_provider: "Made-up Mutual", notes: "Ladder rack. Tow package." });
    const v2 = veh({ fleet_number: "T-02", license_plate: "7DEF456", year: 2016, make: "Chevrolet", model: "Silverado 2500", vin: "1GC1KVEG0GF000002",
      driver: "Jordan Field", oil_interval_months: 6, oil_interval_miles: 5000, last_oil_date: monthDay(-2, 10), last_oil_mileage: 102300,
      current_mileage: 107850, registration_due: monthDay(0, 28), emissions_due: monthDay(0, 28), insurance_provider: "Made-up Mutual" });
    const v3 = veh({ fleet_number: "T-03", license_plate: "6GHJ789", year: 2021, make: "Ram", model: "3500 flatbed", vin: "3C7WRTCL0MG000003",
      description: "Flatbed", driver: "Shop", oil_interval_months: 6, oil_interval_miles: 7500, last_oil_date: monthDay(-1, 20), last_oil_mileage: 30100,
      current_mileage: 31950, registration_due: monthDay(5, 1), dot_due: monthDay(-1, 30), insurance_provider: "Made-up Mutual", notes: "DOT number on the doors." });
    const v4 = veh({ fleet_number: "T-04", license_plate: "5KLM012", year: 2012, make: "Toyota", model: "Tacoma", vin: "5TFNX4CN0CX000004",
      driver: "Morgan Manager", oil_interval_months: 6, last_oil_date: monthDay(-2, 1), last_oil_mileage: 188000, current_mileage: 189400,
      registration_due: monthDay(8, 9), insurance_provider: "Made-up Mutual" });
    const v5 = veh({ fleet_number: "TR-1", license_plate: "4PJ1234", year: 2018, make: "Big Tex", model: "14ft dump trailer", vin: "16VDX1426J0000005",
      description: "Dump trailer", registration_due: monthDay(1, 12), notes: "Trailer: no oil changes." });
    veh({ fleet_number: null, license_plate: "3NOP345", year: 2008, make: "Ford", model: "E-350 van", driver: "Spare",
      oil_interval_months: 6, oil_interval_miles: 5000, last_oil_date: monthDay(-9, 14), last_oil_mileage: 220500, current_mileage: 221300,
      registration_due: monthDay(-1, 3), insurance_provider: null, notes: "Sold — kept for its history.", active: false, legacy_sp_id: 27 });

    id = 0;
    const maint = (f, days, cost) => {
      out.vehicle_maintenance.push(Object.assign({}, COLS.vehicle_maintenance, { id: ++id }, f, audit(days, P.manager)));
      out.vehicle_maintenance_costs.push(Object.assign({}, COLS.vehicle_maintenance_costs, { maintenance_id: id, material_cost: cost === undefined ? null : cost },
        audit(days, P.manager)));
      return id;
    };
    maint({ vehicle_id: v2, next_service_date: monthDay(0, Math.min(td + 3, 28)), next_service_requirements: "Front brake pads and rotors; squeal on the left." }, 6);
    maint({ vehicle_id: v3, next_service_date: day(4), next_service_requirements: "Flatbed hinge pins and grease the fifth wheel." }, 20);
    maint({ vehicle_id: v4, next_service_date: monthDay(2, 10), next_service_requirements: "Timing belt at 190,000." }, 30);
    maint({ vehicle_id: v1, next_service_date: null, next_service_requirements: "Passenger mirror glass (cracked)." }, 2);
    maint({ vehicle_id: v1, next_service_date: day(130), next_service_requirements: "Oil change", completed_date: monthDay(-4, 3),
      service_performed: "Oil and filter, 10 qt 15W-40; topped off DEF.", mileage: 61200, labor_time: "1 h",
      recommendations: "Rear tires at 4/32 — replace within two months." }, 130, 96.4);
    maint({ vehicle_id: v1, next_service_date: day(60), next_service_requirements: "Rear tires", completed_date: day(58),
      service_performed: "Two rear tires, balanced.", mileage: 63400, labor_time: "1.5 h" }, 60, 612.88);
    maint({ vehicle_id: v2, next_service_date: day(75), next_service_requirements: "Oil change", completed_date: monthDay(-2, 10),
      service_performed: "Oil and filter.", mileage: 102300, labor_time: "45 min", recommendations: "Brakes soon." }, 75, 71.15);
    maint({ vehicle_id: v5, next_service_date: day(200), next_service_requirements: "Trailer lights", completed_date: day(190),
      service_performed: "Rewired the left tail light.", labor_time: "2 h" }, 200);

    /* marketing tasks: every state, with prices (the financials table) and without */
    id = 0;
    const sb = byNumber("A267"), kitchen = byNumber("A304"), shop = byNumber("A266");
    const task = (f, days, price) => {
      out.marketing_tasks.push(Object.assign({}, COLS.marketing_tasks, { id: ++id }, f, audit(days, P.manager)));
      out.marketing_task_prices.push(Object.assign({}, COLS.marketing_task_prices, { task_id: id, price: price === undefined ? null : price }, audit(days, P.admin)));
    };
    task({ project_id: sb ? sb.id : null, name: "Drone flyover, framing stage", category: "Video", description: "Two passes at 120 ft, 60 seconds each.",
      task_date: day(2) }, 2, 450);
    task({ project_id: sb ? sb.id : null, name: "Before / after photo set", category: "Photo", description: "Twelve photos from the same spots as the first set.",
      task_date: day(9), done: true, completed_date: day(4), completed_work: "Twelve photos delivered to the client folder." }, 9, 300);
    task({ project_id: kitchen ? kitchen.id : null, name: "Time-lapse camera, three weeks", category: "Video", task_date: day(30), done: true,
      completed_date: day(10), completed_work: "Camera picked up; 3 min edit sent.", invoiced: true }, 30, 1200);
    task({ project_id: shop ? shop.id : null, name: "Website case study", category: "Web", description: "Write-up with six photos and a client quote.",
      task_date: day(60), done: true, completed_date: day(45), completed_work: "Published.", invoiced: true, paid: true }, 60, 650);
    task({ project_id: null, name: "Yard signs, second batch", category: "Print", description: "Fifty signs, the new logo.", task_date: day(15) }, 15, 380.5);
    // an old-portal task the import brought done, without its date or its completion day (kept unknown, never made up)
    task({ project_id: null, name: "Truck door decals", category: "Print", description: "T-01 to T-04.", task_date: null, done: true, completed_date: null,
      legacy_sp_id: 61 }, 25);
    task({ project_id: kitchen ? kitchen.id : null, name: "Client testimonial interview", category: "Video", description: "Ten minutes, two questions.", task_date: day(5) }, 5);
    task({ project_id: null, name: "Home show booth (spring)", category: "Events", description: "Booth fee and banner. The quote said $1,800 for the booth.",
      task_date: day(90), done: true, completed_date: day(80), invoiced: true }, 90, 2100);
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
