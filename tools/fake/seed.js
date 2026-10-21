/* DCR Portal 2 — DEMO MODE ONLY: made-up data for the in-memory database.

   Everything here is invented: people (@demo.test), clients (@example.com, 555-01xx phone numbers),
   streets and towns. No real client, name, address, amount or password. Project numbers follow the
   real pattern (A000…A296 imported from the old portal with legacy ids, suffixed numbers such as
   A024-B … A024-G, A056-AB, A000T1 and A004-B, then A300… made in DCR Desktop 2), and A267 is the
   sandbox project, as in both systems.

   Deterministic for a given company day: the same ids every time the page loads, so the demo's
   change log (kept in the browser) applies cleanly on top. Dates are spread back from today so the
   Log History windows (today, morning, afternoon, yesterday, this week …) always have something. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const UID = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");

  /** The demo accounts. Any password works except "wrong" (to see the refusal). */
  const PEOPLE = [
    { key: "admin", id: UID(1), full_name: "Avery Admin", email: "admin@demo.test", role: "admin", color: "#c8371f", phone: "(805) 555-0101" },
    { key: "manager", id: UID(2), full_name: "Morgan Manager", email: "manager@demo.test", role: "manager", color: "#2f80d8", phone: "(805) 555-0102" },
    { key: "manager_prices", id: UID(3), full_name: "Quinn Manager", email: "manager2@demo.test", role: "manager", color: "#7b5cd6", phone: "(805) 555-0103", can_see_prices: true },
    { key: "accountant", id: UID(4), full_name: "Casey Accounts", email: "accountant@demo.test", role: "accountant", color: "#b8860b", phone: "(805) 555-0104" },
    { key: "lead", id: UID(5), full_name: "Riley Lead", email: "lead@demo.test", role: "lead", color: "#1f9d55", phone: "(805) 555-0105" },
    { key: "field", id: UID(6), full_name: "Jordan Field", email: "field@demo.test", role: "field", color: "#0f8b7d", phone: "(805) 555-0106" },
    { key: "viewer", id: UID(7), full_name: "Taylor Viewer", email: "viewer@demo.test", role: "viewer", color: "#6b7a8c", phone: null },
    { key: "agents", id: UID(8), full_name: "", email: "agents@demo.test", role: "agents", color: "#444444", phone: null },
    { key: "inactive", id: UID(9), full_name: "Sam Former", email: "inactive@demo.test", role: "field", color: "#999999", phone: null, active: false },
    { key: "newhire", id: UID(10), full_name: "Pat Newhire", email: "newhire@demo.test", role: "field", color: "#d4652f", phone: "(805) 555-0110", must_change_password: true },
  ];
  const DEFAULTS = {   // Q1: managers do not see prices unless switched on per person
    admin: [true, true, true], manager: [false, false, false], accountant: [true, true, false],
    lead: [false, false, false], field: [false, false, false], viewer: [false, false, false], agents: [false, false, false],
  };

  const SURNAMES = ["Oakfield", "Brightwater", "Stonebrook", "Fernhill", "Ashgrove", "Kestrel", "Wilder", "Marlow", "Hollis",
    "Larkspur", "Quillon", "Thornbury", "Redcliff", "Silverton", "Pinecrest", "Ravensworth", "Elmstead", "Sagebrook", "Westerly",
    "Coldwater", "Amberly", "Birchwood", "Calloway", "Dunmore", "Everly", "Foxglove", "Greystone", "Harrowgate", "Ironwood",
    "Juniperhill", "Kingsley", "Lockridge", "Meadowlark", "Northcote", "Orchardson", "Primrose", "Quarryman", "Rosewell"];
  const FIRST = ["Alex", "Blair", "Cameron", "Devon", "Emery", "Finley", "Harper", "Jamie", "Kendall", "Logan", "Marley",
    "Noel", "Parker", "Reese", "Rowan", "Skyler", "Sydney", "Teagan", "Toby", "Wren"];
  const KINDS = ["Residence", "Remodel", "ADU", "Addition", "Barn", "Garage", "Deck", "Kitchen", "Roof", "Shop", "Studio",
    "Cabin", "Porch", "Second Story", "Tenant Improvement", "Pergola", "Carport"];
  const STREETS = ["Juniper", "Oak Hollow", "Sycamore", "Cedar Ridge", "Manzanita", "Vista", "Ranchita", "Laurel", "Madrone",
    "Chaparral", "Coyote", "Alder", "Hillcrest", "Mesa", "Willow Creek", "Quail Run", "Sunset", "Granite"];
  const SUFFIX = ["Ln", "Rd", "Ave", "Way", "Ct", "Dr"];
  const TOWNS = [
    ["Pine Hollow", 35.49, -120.67], ["Cedar Flats", 35.56, -120.71], ["Oak Vista", 35.63, -120.69], ["Mesa Verde", 35.28, -120.66],
    ["Coyote Springs", 35.36, -120.85], ["Laurel Bay", 35.37, -120.84], ["Sage Valley", 35.45, -120.60], ["Willow Creek", 35.12, -120.58],
    ["Juniper Hills", 35.73, -120.75], ["Rocky Point", 35.22, -120.63],
  ];
  const OLD_AUTHORS = ["Lee Office", "Ana Crew", "Max Estimator", "Office"];
  const NOTE_LINES = [
    "Called the client, walk-through set for next week.", "Plans received, takeoff started.", "Lumber package ordered.",
    "Inspection passed for framing.", "Waiting on the engineer's revision.", "Client asked about adding a covered porch.",
    "Crew on site, walls going up.", "Trusses delivered, set tomorrow.", "Hold-downs ordered ($1,240 at the yard).",
    "Change order discussed: extra window on the north wall.", "Roof sheathing done, ready for nailing inspection.",
    "Punch list sent to the GC.", "Final walk-through done, client happy.", "Rain day, no work on site.",
    "Quoted $8,900 for the deck framing.", "Permit pulled.", "Shear wall nailing corrected per inspector.",
  ];
  const JOURNAL = [
    ["progress", "Walls framed", "First-floor walls framed and braced. Top plates nailed off."],
    ["delivery", "Lumber drop", "Second lumber drop arrived; stacked on the north side."],
    ["inspection", "Framing inspection", "Inspector signed off on the framing. Two notes on blocking, fixed same day."],
    ["weather", "Rain", "Rain from 10am; covered the deck and sent the crew home at noon."],
    ["issue", "Wrong beam size", "The delivered beam is a 4x10, plans call for 4x12. Supplier is swapping it."],
    ["safety", "Toolbox talk", "Ladder safety reviewed with the crew."],
    ["visitor", "Client visit", "Client walked the site with the designer."],
    ["change_order", "Extra window", "Client asked for an extra window on the north wall; waiting for the office."],
    ["delay", "Waiting on trusses", "Truss delivery pushed two days."],
    ["progress", "Roof sheathing", "Roof sheathed; ready for nailing inspection."],
  ];

  function seed(options) {
    const o = options || {};
    const now = o.now ? new Date(o.now) : new Date();
    const companyDay = NS.companyDay || ((d) => d.toISOString().slice(0, 10));
    const today = companyDay(now);
    const dayNum = Number(today.replace(/-/g, ""));
    const rnd = mulberry32(o.seed || dayNum);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const iso = (d) => new Date(d).toISOString();
    const minutesAgo = (m) => iso(now.getTime() - m * 60000);
    const daysAgo = (d, hour) => {
      // counted back from the COMPANY day, not the UTC one: after 5 pm Pacific the UTC date is already
      // tomorrow, and "7 days ago" landed 6 company days back (the task clock tests failed every evening)
      const [ty, tm, td] = today.split("-").map(Number);
      const base = new Date(Date.UTC(ty, tm - 1, td - d));
      base.setUTCHours(15 + (hour === undefined ? between(0, 8) : hour), between(0, 59), between(0, 59), 0);
      return base.getTime() > now.getTime() ? iso(now.getTime() - between(5, 300) * 60000) : iso(base);
    };
    const dayOf = (ts) => companyDay(new Date(ts));
    // minutes since midnight, company time: "today" rows stay inside today
    const sinceMidnight = (() => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit",
        hourCycle: "h23" }).formatToParts(now);
      const get = (k) => Number((parts.find((x) => x.type === k) || {}).value || 0);
      return (get("hour") % 24) * 60 + get("minute");
    })();
    const todayAgo = () => minutesAgo(between(1, Math.max(2, sinceMidnight - 1)));
    const hex = (n) => {
      let s = "";
      for (let i = 0; i < n; i++) s += Math.floor(rnd() * 16).toString(16);
      return s;
    };

    const audit = (created_at, created_by) => ({ created_at, created_by: created_by || null, updated_at: created_at, updated_by: null, version: 1 });
    const out = { profiles: [], settings: [], settings_prices: [], contacts: [], projects: [], project_prices: [], activity: [],
      journal_entries: [], files: [], tasks: [], task_notes: [], deletions: [], objects: {} };
    const ids = { contacts: 0, projects: 0, activity: 0, journal_entries: 0, files: 0, tasks: 0, task_notes: 0 };
    const nid = (t) => ++ids[t];
    const P = {};
    for (const p of PEOPLE) {
      const d = DEFAULTS[p.role];
      P[p.key] = p.id;
      out.profiles.push(Object.assign({
        id: p.id, full_name: p.full_name, email: p.email, phone: p.phone, role: p.role, color: p.color,
        can_see_prices: p.can_see_prices !== undefined ? p.can_see_prices : d[0], can_see_financials: d[1], can_approve_payments: d[2],
        active: p.active !== false, must_change_password: !!p.must_change_password,
      }, audit(iso(now.getTime() - 400 * 86400000), PEOPLE[0].id)));
    }
    const staff = [P.admin, P.manager, P.manager_prices, P.lead, P.field, P.accountant];

    out.settings.push(Object.assign({ id: 1, company_name: "DCR Framing LLC", address: null, phone: null, email: null, license: null,
      tax_rate: 8, next_project_number: 306, invoice_terms: null, agents_checks_enabled: false }, audit(iso(now.getTime() - 400 * 86400000))));
    out.settings_prices.push(Object.assign({ id: 1, default_labor_rate: 110, local_labor_rate: 90, out_of_area_labor_rate: 110 },
      audit(iso(now.getTime() - 400 * 86400000))));

    // contacts: clients and a few subcontractors and suppliers
    for (let i = 0; i < 48; i++) {
      const first = pick(FIRST), last = SURNAMES[i % SURNAMES.length];
      const kind = i < 36 ? "client" : i < 43 ? "subcontractor" : "supplier";
      out.contacts.push(Object.assign({
        id: nid("contacts"), name: first + " " + last, company: kind === "client" ? null : last + (kind === "supplier" ? " Lumber Supply" : " Concrete"),
        kind, trade: kind === "subcontractor" ? pick(["Concrete", "Electrical", "Plumbing", "Roofing"]) : null,
        phone: "(805) 555-01" + String(10 + (i % 90)).padStart(2, "0"), email: (first + "." + last).toLowerCase() + "@example.com",
        address: between(100, 9800) + " " + pick(STREETS) + " " + pick(SUFFIX), city: pick(TOWNS)[0], notes: null, deleted_at: null,
      }, audit(iso(now.getTime() - between(200, 700) * 86400000), P.admin)));
    }

    // projects
    const numbers = [];
    for (let i = 0; i <= 296; i++) numbers.push({ n: "A" + String(i).padStart(3, "0"), legacy: true, i });
    ["B", "C", "D", "E", "F", "G"].forEach((s) => numbers.push({ n: "A024-" + s, legacy: true, i: 24 }));
    numbers.push({ n: "A056-AB", legacy: true, i: 56 }, { n: "A000T1", legacy: true, i: 0 }, { n: "A004-B", legacy: true, i: 4 });
    for (let i = 300; i <= 305; i++) numbers.push({ n: "A" + i, legacy: false, i });
    let legacyId = 1000, logLegacy = 50000;

    const statusFor = (x) => {
      if (!x.legacy) return ["new_request", "estimating", "sent", "approved", "in_progress", "in_progress"][x.i - 300];
      if (x.n === "A267") return "in_progress";
      const r = rnd();
      if (x.i < 200) return r < 0.68 ? "completed" : r < 0.88 ? "closed" : r < 0.94 ? "on_hold" : "follow_up";
      return r < 0.1 ? "new_request" : r < 0.25 ? "estimating" : r < 0.4 ? "sent" : r < 0.55 ? "approved" : r < 0.8 ? "in_progress"
        : r < 0.85 ? "on_hold" : r < 0.9 ? "follow_up" : "completed";
    };

    for (const x of numbers) {
      const id = nid("projects");
      const town = pick(TOWNS);
      const sandbox = x.n === "A267";
      const contact = out.contacts[between(0, 35)];
      const name = sandbox ? "Sandbox — test project" : contact.name.split(" ")[1] + " " + pick(KINDS);
      const address = sandbox ? "1 Test Way" : between(100, 9800) + " " + pick(STREETS) + " " + pick(SUFFIX);
      const city = sandbox ? "Sandbox" : town[0];
      const status = statusFor(x);
      const ageDays = x.legacy ? Math.max(1, Math.round((300 - x.i) * 2.3) + between(0, 20)) : 30 - (x.i - 300) * 4;
      const created = iso(now.getTime() - ageDays * 86400000);
      const hasPin = sandbox || (x.legacy ? rnd() < 0.42 : rnd() < 0.5);
      const gps = hasPin && rnd() < 0.25;
      const p = Object.assign({
        id, number: x.n, name, address, city, state: "CA", zip: "934" + between(10, 99),
        client_contact_id: sandbox ? null : contact.id, client_name: sandbox ? "Sandbox client" : contact.name,
        client_phone: sandbox ? null : contact.phone, client_email: sandbox ? null : contact.email,
        status, status_note: rnd() < 0.2 ? pick(["Waiting on plans", "Client reviewing the estimate", "Crew starts Monday", "Quoted $12,400 to the client"]) : null,
        scope: pick(["Framing", "Framing and sheathing", "Framing, sheathing and roof", "Deck framing", "Remodel framing"]),
        tags: rnd() < 0.3 ? [pick(["residential", "commercial", "repeat client", "rush"])] : [],
        plans_url: null, start_date: ["in_progress", "completed", "closed"].includes(status) ? dayOf(now.getTime() - (ageDays - 5) * 86400000) : null,
        completed_date: status === "completed" || status === "closed" ? dayOf(now.getTime() - Math.max(0, ageDays - 40) * 86400000) : null,
        lat: hasPin ? +(town[1] + (rnd() - 0.5) * 0.06).toFixed(6) : null,
        lng: hasPin ? +(town[2] + (rnd() - 0.5) * 0.06).toFixed(6) : null,
        location_source: hasPin ? (gps ? "gps" : "geocode") : null,
        thumbnail_file_id: null,
        folder_name: (x.n + " - " + address + " - " + city + " - " + name).replace(/[\\/:*?"<>|—]/g, "-").slice(0, 120),
        legacy_sp_id: x.legacy ? ++legacyId : null, deleted_at: null,
      }, audit(created, x.legacy ? null : pick([P.admin, P.manager])));
      if (!x.legacy && x.i === 305) p.lat = p.lng = p.location_source = null;
      out.projects.push(p);
      out.project_prices.push(Object.assign({ project_id: id, labor_rate: ["Pine Hollow", "Cedar Flats", "Oak Vista", "Sage Valley", "Sandbox"].includes(city) ? 90 : 110,
        rate_source: ["Pine Hollow", "Cedar Flats", "Oak Vista", "Sage Valley", "Sandbox"].includes(city) ? "local" : "out_of_area" }, audit(created)));

      // the activity of the project
      const act = (ts, kind, text, by, extra) => out.activity.push(Object.assign({ id: nid("activity"), project_id: id, kind, text,
        from_status: null, to_status: null, author_name: null, legacy_sp_id: null }, audit(ts, by), extra || {}));
      if (x.legacy) {
        const author = pick(OLD_AUTHORS);
        let notes = "Client: " + p.client_name + ". Scope: " + p.scope + ".";
        if (x.i % 41 === 7) notes += "\n\n" + Array.from({ length: 140 }, () => pick(NOTE_LINES)).join(" ");   // long imported notes fold with "more"
        act(created, "note", "Notes from the old portal\n" + notes, null, { author_name: author, legacy_sp_id: ++logLegacy });
        const lines = between(1, 7);
        for (let k = 0; k < lines; k++) {
          act(iso(Date.parse(created) + (k + 1) * between(1, 9) * 86400000), "note", pick(NOTE_LINES), null,
            { author_name: pick(OLD_AUTHORS), legacy_sp_id: ++logLegacy });
        }
      } else {
        act(created, "system", "Project " + x.n + " created", p.created_by);
      }
    }

    const byNumber = (n) => out.projects.find((p) => p.number === n);
    const sandbox = byNumber("A267");
    const busy = out.projects.filter((p) => ["in_progress", "approved", "estimating", "sent"].includes(p.status) && p.id !== sandbox.id);
    const recentProjects = [sandbox].concat(busy.slice(-14));

    // recent activity across projects (today, yesterday, this week, last week, this month)
    const statusSteps = ["estimating", "sent", "approved", "in_progress"];
    const label = (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const plan = [[0, 14], [1, 8], [2, 6], [3, 5], [5, 6], [8, 8], [12, 8], [20, 10]];
    for (const [d, n] of plan) {
      for (let k = 0; k < n; k++) {
        const p = recentProjects[(k + d) % recentProjects.length];
        const ts = d === 0 ? todayAgo() : daysAgo(d);
        if (k % 4 === 3) {
          const from = statusSteps[k % 3], to = statusSteps[(k % 3) + 1];
          out.activity.push(Object.assign({ id: nid("activity"), project_id: p.id, kind: "status",
            text: "Status: " + label(from) + " → " + label(to), from_status: from, to_status: to, author_name: null, legacy_sp_id: null },
          audit(ts, pick([P.admin, P.manager]))));
        } else {
          out.activity.push(Object.assign({ id: nid("activity"), project_id: p.id, kind: "note", text: pick(NOTE_LINES),
            from_status: null, to_status: null, author_name: null, legacy_sp_id: null }, audit(ts, pick([P.admin, P.manager, P.lead, P.accountant]))));
        }
      }
    }
    // this morning and this afternoon (company time) so both windows always show something
    out.activity.push(Object.assign({ id: nid("activity"), project_id: sandbox.id, kind: "note", text: "Morning check-in on the sandbox project.",
      from_status: null, to_status: null, author_name: null, legacy_sp_id: null }, audit(minutesAgo(2), P.lead)));

    // journal entries
    const jProjects = [sandbox].concat(busy.slice(-10));
    jProjects.forEach((p, pi) => {
      const n = p === sandbox ? 8 : between(2, 5);
      for (let k = 0; k < n; k++) {
        const [category, title, body] = JOURNAL[(pi + k) % JOURNAL.length];
        const d = k * between(1, 3);
        const ts = d === 0 ? todayAgo() : daysAgo(d);
        const by = pick([P.lead, P.field, P.manager]);
        const j = Object.assign({ id: nid("journal_entries"), project_id: p.id, entry_date: dayOf(ts), category, title, body,
          weather: pick(["Sunny", "Overcast", "Windy", "Rain", null]), crew_size: between(2, 6), hours: between(4, 9),
          follow_up: category === "issue" || category === "change_order", deleted_at: null }, audit(ts, by));
        out.journal_entries.push(j);
        out.activity.push(Object.assign({ id: nid("activity"), project_id: p.id, kind: "system", text: "Journal entry: " + title,
          from_status: null, to_status: null, author_name: null, legacy_sp_id: null }, audit(ts, by)));
        if (k < 2) {
          for (let m = 0; m < 2; m++) addFile(p, "journal", dayOf(ts), "IMG " + dayOf(ts) + " 0" + (8 + m) + ".1" + m + ".2" + k + ".jpg",
            "image/jpeg", by, ts, { journal_entry_id: j.id, description: m === 0 ? "Before" : "After", preview: true });
        }
      }
    });

    function addFile(p, folder, subpath, name, mime, by, ts, extra) {
      const e = extra || {};
      const uid = hex(32);
      const local = e.local;
      const slug = name.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").replace(/[^A-Za-z0-9._ ()-]+/g, "_").replace(/^[ ._]+|[ ._]+$/g, "") || "file";
      const key = local ? null : (folder === "receipts" ? "f/" : "p/") + p.id + "/" + folder + "/" + uid + "/" + slug;
      const f = Object.assign({
        id: nid("files"), project_id: p.id, estimate_item_id: null, journal_entry_id: e.journal_entry_id || null, bill_id: null,
        folder, subpath: subpath || "", name, storage_path: key, size: e.size || between(800000, 4800000), mime,
        version_no: e.version_no || 1, previous_id: e.previous_id || null, is_financial: folder === "receipts",
        storage: local ? "local" : "cloud", rel_path: local ? p.folder_name + "/" + (subpath ? subpath + "/" : "") + name : null,
        modified_at: local ? ts : null, description: e.description || null,
        preview_path: e.preview && key ? key.slice(0, key.lastIndexOf("/")) + "/preview-320.jpg" : null,
        source: local ? "desktop" : e.source || "portal2", deleted_at: null,
      }, audit(ts, by));
      out.files.push(f);
      if (key) out.objects[key] = { size: f.size, mime, owner: by, created_at: ts };
      if (f.preview_path) out.objects[f.preview_path] = { size: 24000, mime: "image/jpeg", owner: by, created_at: ts };
      return f;
    }

    // project pictures for about two projects in three
    out.projects.forEach((p, i) => {
      if (i % 3 === 2) return;
      const f = addFile(p, "thumbnail", "", "Project picture.jpg", "image/jpeg", P.admin, p.created_at, { size: between(60000, 180000), source: "import" });
      p.thumbnail_file_id = f.id;
    });

    // site photos (cloud, uploaded from phones) and plans and documents on the office PCs (local)
    recentProjects.forEach((p, pi) => {
      const days = p === sandbox ? 4 : between(1, 3);
      for (let d = 0; d < days; d++) {
        const ts = d === 0 ? todayAgo() : daysAgo(d * between(2, 6));
        const day = dayOf(ts);
        const n = between(2, 6);
        for (let k = 1; k <= n; k++) {
          addFile(p, "photos", day, "IMG " + day + " 1" + (pi % 10) + "." + String(10 + k).slice(-2) + ".0" + k + (k > 1 ? "-" + k : "") + ".jpg",
            "image/jpeg", pick([P.lead, P.field]), ts, { preview: true, description: k === 1 && d === 0 ? "North wall before sheathing" : null });
        }
        if (d === 0 && pi % 3 === 0) addFile(p, "photos", day, "VID " + day + " 11.02.33.mov", "video/quicktime", P.field, ts, { size: 38000000 });
      }
      addFile(p, "documents", "Site Notes", "Voice note " + dayOf(now) + " 07.45.10.webm", "audio/webm", P.lead, minutesAgo(90 + pi), { size: 240000 });
      const v1 = addFile(p, "plans", "Floor Plans", "A1 - Floor plan.pdf", "application/pdf", P.manager, daysAgo(30), { local: true, size: 2400000 });
      v1.deleted_at = null;
      if (p === sandbox) {
        const v2 = addFile(p, "plans", "Floor Plans", "A1 - Floor plan.pdf", "application/pdf", P.manager, daysAgo(4),
          { local: true, size: 2500000, version_no: 2, previous_id: v1.id });
        v2.rel_path = v1.rel_path;
      }
      addFile(p, "documents", "", "Contract signed.pdf", "application/pdf", P.manager, daysAgo(25), { local: true, size: 300000 });
      addFile(p, "estimates", "", "Estimate 1.pdf", "application/pdf", P.manager, daysAgo(20), { size: 180000, source: "desktop" });
      if (pi % 2 === 0) addFile(p, "receipts", "", "Receipt lumber yard.jpg", "image/jpeg", P.accountant, daysAgo(10), { size: 900000, source: "desktop" });
    });
    // a deleted photo (only an admin sees it)
    const gone = addFile(sandbox, "photos", dayOf(daysAgo(6)), "IMG deleted by mistake.jpg", "image/jpeg", P.field, daysAgo(6));
    gone.deleted_at = daysAgo(5);
    out.deletions.push({ id: 1, table_name: "files", row_id: gone.id, project_id: sandbox.id, deleted_at: gone.deleted_at, deleted_by: P.field });

    // a few uploads in the last hour on the sandbox, with their "Files uploaded to" lines
    out.activity.push(Object.assign({ id: nid("activity"), project_id: sandbox.id, kind: "system", text: "Files uploaded to " + today,
      from_status: null, to_status: null, author_name: null, legacy_sp_id: null }, audit(minutesAgo(41), P.field)));

    /* ── phase 3: tasks and their updates (M3) ───────────────────────────
       Made-up work for the demo accounts, spread over the sandbox and the busy jobs so the tasks map
       has several pins: quiet tasks (more than five days: "needs an update"), new ones, a task due
       tomorrow morning, a Photo & Video Agent shoot (agent_kind photo, its brief and shot list), a
       Recurring Tasks agent task ("Weekly on Mondays"), a task imported from the old portal with its
       old notes (via import) and a texted reply DCR Agents filed for Jordan (via sms, on his behalf),
       a task with an amount in its words (masked without the prices switch), tasks without a project,
       finished ones, and the ones a field person made for nobody. The old generator's random draws
       are spent as before, so the later sections' made-up values stay as they were. */
    for (let i = 0; i < 104; i++) rnd();
    const AG = PEOPLE.find((x) => x.key === "agents").id;
    const tAt = (d, hour, minute) => {
      const [ty, tm, td] = today.split("-").map(Number);       // from the company day (see daysAgo)
      const base = new Date(Date.UTC(ty, tm - 1, td - d));
      base.setUTCHours(15 + (hour || 0), minute || 7, 0, 0);
      return base.getTime() > now.getTime() ? iso(now.getTime() - (d === 0 ? 20 : 5) * 60000) : iso(base);
    };
    const pinned = busy.filter((p) => p.lat !== null && p.lng !== null);
    const unpinned = busy.filter((p) => p.lat === null || p.lng === null);
    const J = (k) => (pinned.length ? pinned[k % pinned.length] : busy[k % busy.length]);
    const noteRow = (t, d, hour, by, words, extra) => {
      const at = tAt(d, hour, 31);
      out.task_notes.push(Object.assign({ id: nid("task_notes"), task_id: t.id, text: words, via: "portal", on_behalf_of: null,
        source_key: null, author_name: null }, audit(at, by), extra || {}));
    };
    const addTask = (o) => {
      const at = o.at || tAt(o.ago, o.hour === undefined ? 1 : o.hour);
      const t = Object.assign({ id: nid("tasks"), project_id: o.p === null ? null : (o.p || sandbox).id, estimate_item_id: null,
        title: o.title, description: o.desc || null, category: o.cat || null, sub_category: o.sub || null, priority: o.pri || "normal",
        assigned_to: o.to === undefined ? null : o.to, due_date: o.due || null, due_time: o.dueTime || null, status: o.done ? "done" : "open",
        completed_at: null, completed_by: null, legacy_sp_id: o.legacy || null, author_name: o.author || null,
        agent_kind: o.kind || null, agent_ref: o.ref || null, agent_date: o.agentDate || null }, audit(at, o.by === undefined ? P.manager : o.by));
      if (o.done) {
        t.completed_at = tAt(o.done, 3);
        t.completed_by = o.to || P.manager;
        t.updated_at = t.completed_at; t.updated_by = t.completed_by; t.version = 2;
      }
      out.tasks.push(t);
      (o.notes || []).forEach((n) => noteRow(t, n[0], n[1], n[2], n[3], n[4]));
      return t;
    };
    const shootDay = dayOf(now.getTime() + 2 * 86400000);
    const pastShoot = dayOf(now.getTime() - 2 * 86400000);
    const monday = (() => { const d = new Date(today + "T12:00:00Z"); const back = (d.getUTCDay() + 6) % 7; return dayOf(now.getTime() - back * 86400000); })();
    // Jordan Field (field)
    addTask({ title: "Shoot the framing progress", p: sandbox, to: P.field, by: AG, cat: "Photos & Video", sub: "Photo Agent", pri: "high", ago: 1,
      kind: "photo", ref: "PV-A267-03", agentDate: shootDay,
      desc: "WHEN: " + shootDay + ", morning light\nWHERE: 1 Test Way, Sandbox\n• Map: https://www.google.com/maps/search/?api=1&query=1+Test+Way+Sandbox\n\n" +
        "SHOT LIST\n• Wide shot of the street side\n• Second-floor walls from the north corner\n• Hold-downs and straps close up\n• Crew at work (ask first)\n\n" +
        "TIPS\n• Keep the horizon level\n• No faces without asking\n\nShoot date: " + shootDay + " · Ref: PV-A267-03 · Planned by the DCR Photo & Video Agent" });
    addTask({ title: "Measure the deck ledger", p: J(0), to: P.field, by: P.lead, cat: "General Task", ago: 9,
      notes: [[7, 2, P.field, "Measured the north side, 18 ft 4 in. South side next."]] });
    addTask({ title: "Pick up the permit card", p: J(1), to: P.field, by: P.manager, cat: "Office Work", pri: "urgent", ago: 2, due: dayOf(now.getTime() + 86400000) });
    addTask({ title: "Order hold-downs ($1,240 at the yard)", p: J(2), to: P.field, by: null, author: "Lee Office", legacy: 4001, cat: "Change Order", pri: "high", ago: 30,
      desc: "Simpson HDU5 x 12. Ask for the contractor price.<br>Pick up at the yard &amp; bring the receipt.",
      notes: [[20, 1, null, "Called the yard, back-ordered.", { via: "import", author_name: "Ana Crew", source_key: "import:4001:1" }],
        [14, 2, null, "Yard says Thursday.", { via: "import", author_name: "Lee Office", source_key: "import:4001:2" }],
        [3, 4, AG, "Got them, in the truck now", { via: "sms", on_behalf_of: P.field, source_key: "sms:demo-1" }]] });
    addTask({ title: "Send this week's site photos to the office", p: J(3), to: P.field, by: AG, cat: "Office Work", sub: "Recurring Agent", ago: 0, hour: 0,
      kind: "recurring", ref: "ag_3f9c", agentDate: monday,
      desc: "Upload this week's photos from every job you were on.\nRecurring: ag_3f9c · " + monday + " · Weekly on Mondays · Made by the DCR Recurring Tasks agent" });
    addTask({ title: "Clean up the lumber pile", p: J(0), to: P.field, by: P.lead, ago: 8, done: 3,
      notes: [[3, 3, P.field, "Done, the scraps went to the bin."]] });
    addTask({ title: "Bring the long ladder back", p: null, to: null, by: P.field, cat: "General Task", pri: "low", ago: 1 });
    // Riley Lead (lead)
    addTask({ title: "Schedule the framing inspection", p: sandbox, to: P.lead, by: P.manager, cat: "General Task", pri: "urgent", ago: 3,
      due: dayOf(now.getTime() + 86400000), dueTime: "07:30:00", notes: [[1, 2, P.manager, "The inspector prefers mornings.", { via: "desktop" }]] });
    addTask({ title: "Confirm truss delivery", p: J(4), to: P.lead, by: P.manager, cat: "Sales", ago: 8 });
    addTask({ title: "Check the beam size with the supplier", p: null, to: P.lead, by: P.lead, pri: "low", ago: 1,
      desc: "Plans call for a 4x12; the delivered one is a 4x10." });
    addTask({ title: "Walk the punch list with the client", p: J(5), to: P.lead, by: P.manager, cat: "Customer Relations", ago: 11, done: 2 });
    // Pat Newhire (field, in Riley's crew)
    addTask({ title: "Stack the second lumber drop", p: J(1), to: P.newhire, by: P.lead, cat: "General Task", ago: 6 });
    addTask({ title: "Photograph the north wall", p: J(2), to: P.newhire, by: AG, cat: "Photos & Video", sub: "Photo Agent", ago: 10,
      kind: "photo", ref: "PV-DEMO-07", agentDate: pastShoot,
      desc: "WHEN: " + pastShoot + "\nSHOT LIST\n• The north wall, straight on\n• The window openings\n\nShoot date: " + pastShoot + " · Ref: PV-DEMO-07 · Planned by the DCR Photo & Video Agent" });
    // Morgan Manager (manager)
    addTask({ title: "Send the punch list to the GC", p: J(3), to: P.manager, by: P.admin, cat: "Customer Relations", pri: "high", ago: 15,
      notes: [[9, 3, P.manager, "Draft done, waiting on the photos."], [2, 5, P.manager, "Sent to the GC; they answer Friday.", { via: "desktop" }]] });
    addTask({ title: "Call the client about the extra window", p: J(4), to: P.manager, by: P.admin, cat: "Change Order", ago: 6 });
    addTask({ title: "Review the change order wording", p: sandbox, to: P.manager, by: P.admin, cat: "Estimate", pri: "low", ago: 1 });
    // Quinn Manager, Casey Accounts, Taylor Viewer
    addTask({ title: "Quote the pergola framing", p: unpinned[0] || J(5), to: P.manager_prices, by: P.admin, cat: "Estimate", ago: 4 });
    addTask({ title: "Collect the lumber yard receipts", p: J(5), to: P.accountant, by: P.manager, cat: "Office Work", ago: 4 });
    addTask({ title: "Read the new safety plan", p: null, to: P.viewer, by: P.admin, cat: "General Task", pri: "low", ago: 2 });
    // nobody's yet; more jobs on the map
    addTask({ title: "Find a crew for the pergola", p: unpinned[1] || J(6), to: null, by: P.manager, cat: "General Task", ago: 3 });
    addTask({ title: "Sheathing on the garage", p: J(6), to: P.field, by: P.lead, cat: "General Task", ago: 4,
      notes: [[2, 1, P.field, "Half done, finishing tomorrow."]] });
    addTask({ title: "Fix the blocking the inspector flagged", p: J(7), to: P.newhire, by: P.lead, pri: "urgent", ago: 1 });
    addTask({ title: "Deliver the stair stringers", p: J(8), to: P.lead, by: P.manager, ago: 7, notes: [[6, 2, P.lead, "Cut two of three."]] });
    addTask({ title: "Order the porch posts", p: J(9), to: P.manager, by: P.admin, cat: "Sales", ago: 2, done: 1 });

    /* ── phase 2: employees, crews, timesheets and sign-offs (M2) ─────────
       Made-up people: five linked to the demo accounts, the rest crew without an account (they file
       by text with DCR Agents). Riley Lead's crew is Jordan Field, Pat Newhire, Alex Juniper, Blair
       Sycamore and Devon Madrone; Emery Chaparral and Harper Alder are in nobody's crew; Finley
       Coyote has left (inactive). Four weeks of hours up to today, with overtime, a Saturday, leave
       days, a day split across two jobs and one imported row whose job did not match a project.
       Last week: two crews signed by the lead, one by the manager, one signature gone stale. */
    const addD = (t, n) => {
      const [y, mo, d] = t.split("-").map(Number);
      const x = new Date(Date.UTC(y, mo - 1, d + n));
      return x.getUTCFullYear() + "-" + String(x.getUTCMonth() + 1).padStart(2, "0") + "-" + String(x.getUTCDate()).padStart(2, "0");
    };
    const dow = (t) => { const [y, mo, d] = t.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); };
    const thisSat = addD(today, -(dow(today) === 6 ? 0 : dow(today) + 1));
    const crewSched = { normal_start1: "07:00:00", normal_end1: "11:00:00", normal_start2: "12:00:00", normal_end2: "15:30:00", normal_lunch_hours: 1 };
    const officeSched = { normal_start1: "08:00:00", normal_end1: "12:00:00", normal_start2: "13:00:00", normal_end2: "17:00:00", normal_lunch_hours: 1 };
    const EMP = [
      { key: "lead", name: "Riley Lead", no: "E-104", profile: P.lead, phone: "(805) 555-0105", sched: crewSched },
      { key: "field", name: "Jordan Field", no: "E-117", profile: P.field, phone: "(805) 555-0106", sched: crewSched },
      { key: "newhire", name: "Pat Newhire", no: "E-131", profile: P.newhire, phone: "(805) 555-0110", sched: crewSched },
      { key: "accountant", name: "Casey Accounts", no: "E-102", profile: P.accountant, phone: "(805) 555-0104", sched: officeSched },
      { key: "viewer", name: "Taylor Viewer", no: "E-140", profile: P.viewer, phone: null, sched: officeSched },
      { key: "alex", name: "Alex Juniper", no: "E-120", phone: "(805) 555-0121 / (805) 555-0191", sched: crewSched },
      { key: "blair", name: "Blair Sycamore", no: "E-121", phone: "805.555.0122", sched: crewSched },
      { key: "devon", name: "Devon Madrone", no: "E-122", phone: "555-0123", sched: crewSched },
      { key: "emery", name: "Emery Chaparral", no: "E-123", phone: "(805) 555-0124", sched: { normal_start1: "06:30:00", normal_end1: "10:30:00",
        normal_start2: "11:00:00", normal_end2: "15:00:00", normal_lunch_hours: 0.5 } },
      { key: "harper", name: "Harper Alder", no: "E-126", phone: null, sched: {} },
      { key: "finley", name: "Finley Coyote", no: "E-125", phone: "(805) 555-0125", sched: crewSched, inactive: true },
    ];
    out.employees = []; out.crew_members = []; out.timesheets = []; out.timesheet_confirmations = [];
    const E = {};
    EMP.forEach((x, i) => {
      const r = Object.assign({ id: i + 1, profile_id: x.profile || null, contact_id: null, full_name: x.name, employee_no: x.no,
        phone: x.phone, phone_e164: NS.e164 ? NS.e164(x.phone) : null, email: x.profile ? (x.key + "@demo.test") : null,
        address: between(100, 9800) + " " + pick(STREETS) + " " + pick(SUFFIX) + ", " + pick(TOWNS)[0],
        normal_start1: null, normal_end1: null, normal_start2: null, normal_end2: null, normal_lunch_hours: 1,
        active: !x.inactive, notes: x.inactive ? "Left in the spring." : null, legacy_sp_id: 700 + i }, x.sched,
      audit(iso(now.getTime() - 380 * 86400000), P.admin));
      out.employees.push(r);
      E[x.key] = r;
    });
    ["field", "newhire", "alex", "blair", "devon"].forEach((k, i) => {
      out.crew_members.push(Object.assign({ id: i + 1, lead_profile_id: P.lead, employee_id: E[k].id }, audit(iso(now.getTime() - 200 * 86400000), P.admin)));
    });

    const jobs = [sandbox].concat(busy.slice(-6));
    const WORK = ["Framed walls on the second floor.", "Set trusses and braced them.", "Sheathing on the north side.", "Blocking and hold-downs per the inspector.",
      "Punch list items.", "Stood the garage walls.", "Roof sheathing, nailing pattern checked.", "Deck ledger and joists.", "Cleanup and lumber sorting."];
    let tsId = 0;
    const tsRow = (emp, day, extra) => {
      const r = Object.assign({ id: ++tsId, employee_id: emp.id, work_date: day, kind: "work", project_id: null, legacy_project_text: null,
        hours: 8, work_completed: null, start1: null, end1: null, start2: null, end2: null, lunch_hours: null, calculated_hours: null,
        notes: null, source: "portal", source_key: null, legacy_sp_id: null }, extra || {},
      audit(day + "T23:" + String(10 + (tsId % 40)).padStart(2, "0") + ":00.000Z", emp.profile_id || P.lead));
      if (r.kind === "work" && emp.normal_start1 && r.start1 === null) {
        const h = Number(r.hours);
        const s1 = 7 * 60 + (emp.normal_start1 === "06:30:00" ? -30 : emp.normal_start1 === "08:00:00" ? 60 : 0);
        const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0") + ":00";
        if (h <= 4) Object.assign(r, { start1: hhmm(s1), end1: hhmm(s1 + h * 60), lunch_hours: 0 });
        else Object.assign(r, { start1: hhmm(s1), end1: hhmm(s1 + 240), lunch_hours: Number(emp.normal_lunch_hours) || 1,
          start2: hhmm(s1 + 240 + (Number(emp.normal_lunch_hours) || 1) * 60), end2: hhmm(s1 + 240 + (Number(emp.normal_lunch_hours) || 1) * 60 + (h - 4) * 60) });
        r.calculated_hours = h;
      }
      out.timesheets.push(r);
      return r;
    };
    const filers = ["lead", "field", "newhire", "alex", "blair", "devon", "emery", "harper", "accountant", "viewer"];
    for (let wk = -3; wk <= 0; wk++) {
      const sat = addD(thisSat, wk * 7);
      for (let i = 0; i < 7; i++) {
        const day = addD(sat, i);
        if (day > today) break;
        const weekend = i < 2;
        filers.forEach((k, fi) => {
          const emp = E[k];
          if (weekend && !(i === 0 && (k === "lead" || k === "alex") && wk === -1)) return;   // a Saturday last week
          if (day === today && fi % 3 === 1) return;                                      // some have not filed today yet
          if (k === "newhire" && wk < -1) return;                                          // started two weeks ago
          if (k === "viewer" && (wk !== -1 || weekend)) return;                           // filed by the office, last week only
          const job = jobs[(fi + Math.max(0, wk + 3)) % jobs.length];
          if (wk === -2 && i === 2 && k !== "accountant" && k !== "viewer") { tsRow(emp, day, { kind: "holiday", hours: 8 }); return; }   // a Monday holiday
          if (k === "alex" && wk === -1 && (i === 5 || i === 6)) { tsRow(emp, day, { kind: "vacation", hours: 8 }); return; }
          if (k === "devon" && wk === 0 && i === 3) { tsRow(emp, day, { kind: "sick", hours: 0, work_completed: "Called in sick." }); return; }
          if (k === "harper" && wk === -1 && i === 4) { tsRow(emp, day, { kind: "day_off", hours: 0 }); return; }
          if (k === "lead" && i === 4) {                                                   // a day split across two jobs
            tsRow(emp, day, { project_id: job.id, hours: 4, work_completed: "Morning: layout and walls." });
            tsRow(emp, day, { project_id: sandbox.id, hours: 4, work_completed: "Afternoon on the sandbox job." });
            return;
          }
          if (k === "accountant" || k === "viewer") { tsRow(emp, day, { project_id: sandbox.id, hours: 8, work_completed: "Office: bills and payroll." }); return; }
          const hours = k === "blair" && i === 3 ? 10 : k === "emery" && i % 2 ? 9 : k === "devon" && wk === -1 && i === 6 ? 6.5 : 8;
          tsRow(emp, day, { project_id: job.id, hours, work_completed: weekend ? "Saturday catch-up on the trusses." : WORK[(fi + i + wk + 9) % WORK.length] });
        });
      }
    }
    // an imported row whose job did not match a project (legacy_project_text, source import)
    tsRow(E.emery, addD(thisSat, -19), { project_id: null, legacy_project_text: "Hillside barn (old portal)", hours: 7.5,
      work_completed: "Imported from the old portal.", source: "import", legacy_sp_id: 9001 });
    out.timesheets.sort((a, b) => a.id - b.id);

    // last week's sign-offs: the lead signed Jordan and Alex, the manager signed Riley; then one of
    // Alex's days was changed, so that signature is stale
    const lastSat = addD(thisSat, -7);
    let cId = 0;
    const sign = (empKey, by, at) => {
      const emp = E[empKey];
      const list = out.timesheets.filter((t) => t.employee_id === emp.id && t.work_date >= lastSat && t.work_date <= addD(lastSat, 6));
      const fp = NS.tsFingerprint ? NS.tsFingerprint(list) : "";
      out.timesheet_confirmations.push(Object.assign({ id: ++cId, employee_id: emp.id, week_start: lastSat, confirmed_by: by,
        confirmed_at: at, hours_at_confirm: Math.round(list.reduce((s, t) => s + Number(t.hours), 0) * 100) / 100, fingerprint: fp }, audit(at, by)));
    };
    const friEve = addD(lastSat, 6) + "T23:40:00.000Z";
    sign("field", P.lead, friEve);
    sign("alex", P.lead, friEve);
    sign("lead", P.manager, addD(lastSat, 7) + "T17:05:00.000Z");
    sign("field", P.manager, addD(lastSat, 7) + "T17:06:00.000Z");
    const changed = out.timesheets.find((t) => t.employee_id === E.alex.id && t.work_date === addD(lastSat, 3) && t.kind === "work");
    if (changed) { changed.hours = 9; changed.calculated_hours = null; changed.version = 2; changed.updated_at = addD(lastSat, 8) + "T16:00:00.000Z"; changed.updated_by = P.manager; }

    out.activity.sort((a, b) => a.id - b.id);
    // the DCR Agents 2 PC (M4): beat two minutes ago, the DCR server since this morning (made up)
    out.agents_server = { host_id: "DCR-OFFICE-PC#agents2", at: minutesAgo(2), since: minutesAgo(300), version: "2.0.0", proto: 1,
      standby: false, payload: { version: "2.0.0", sentToday: 4, failedToday: 0, repliesToday: 1, enabledAgents: 4, lastError: "", paused: false } };
    return out;
  }

  NS.seed = seed;
  NS.TOWNS = TOWNS.map((t) => ({ name: t[0], lat: t[1], lng: t[2] }));
  NS.PEOPLE = PEOPLE.map((p) => ({ key: p.key, id: p.id, email: p.email, name: p.full_name || "DCR Agents PC", role: p.role,
    note: p.active === false ? "deactivated" : p.must_change_password ? "temporary password" : p.can_see_prices ? "prices switched on" : "" }));
})(typeof globalThis !== "undefined" ? globalThis : this);
