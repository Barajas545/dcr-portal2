/* DCR Portal 2 — DEMO MODE ONLY: Part 3's profile switches (migration 20261028000100_estimator.sql; owner decisions
   2026-10-24 D1-D3) in the in-memory database, read by the sign-in and the admin page's Access tab. Loaded BEFORE
   engine.js (tools/devserve.mjs FAKE_PARTS, tests/pages-engine.mjs); installed into each engine (NS.extInstall), its
   people added to the seed (NS.extSeed). Never published (tools/ is not part of the site).

   The same columns and rules as the migration:
   * profiles.can_estimate (the Estimator switch: app.can_edit('estimates') for a manager; tools/fake/engine.js
     canEdit) and profiles.can_upload_onedrive (the OneDrive upload switch: the web broker only), both NOT NULL;
     an admin always holds both, the agents account neither; a new person and a role change take the role's
     default (an admin's: on; everyone else: off) unless the same save sets them; nobody but an admin changes them
     (the engine's profiles rule: a person changes their name, phone and colour only — 42501);
   * the checks (23514): Estimator only for an admin or a manager (profiles_estimate_needs_manager), OneDrive upload
     only for admin, manager, accountant, lead and field (profiles_onedrive_needs_writer), approving payments only
     for an admin or a manager with financials (profiles_approve_needs_manager_and_financials);
   * rpc admin_set_profile(p_id, p_role, p_switches, p_active, p_version): an admin's (42501 for anyone else); the
     switch names whitelisted (22023 "unknown switch"), true / false only; a stale version PT409, nobody PT404;
     "turn myself off" and the last active admin refused; role and active first (its defaults), then the switches
     asked for; -> the profiles row.
   Made-up people only: Robin Estimator (…000000000013, a manager with the Estimator switch and no prices — the
   quantities-only estimator), Quinn Manager (prices) also an estimator and an OneDrive uploader, Riley Lead an
   OneDrive uploader. Robin is added here only when no earlier extension added him (D11 puts him in p5a-est.js on
   the estimate-editor branch, which loads first): the same id, name and switches either way, and a switch an
   earlier extension set is never reset here. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const ESTIMATOR = { key: "estimator", id: "00000000-0000-4000-8000-000000000013", full_name: "Robin Estimator", email: "estimator@demo.test",
    role: "manager", color: "#9c4dcc", phone: "(805) 555-0113" };
  const NEW_SWITCHES = { can_estimate: false, can_upload_onedrive: false };
  const SWITCHES = ["can_see_prices", "can_see_financials", "can_approve_payments", "can_sales_estimates", "can_estimate", "can_upload_onedrive"];
  const ROLES = ["admin", "manager", "lead", "accountant", "field", "viewer", "agents"];
  const SIGS = { admin_set_profile: { args: ["p_id", "p_role", "p_switches", "p_active", "p_version"], required: ["p_id"] } };

  /* app.role_defaults + app.role_sales_default + app.role_estimate_default / app.role_onedrive_default */
  function roleDefaults(role) {
    const admin = role === "admin";
    return { can_see_prices: admin || role === "accountant", can_see_financials: admin || role === "accountant", can_approve_payments: admin,
      can_sales_estimates: admin, can_estimate: admin, can_upload_onedrive: admin };
  }
  NS.p7RoleDefaults = roleDefaults;

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, COLS: ECOLS, PgErr, deny, rule, clone } = E;
    if (ECOLS.profiles) Object.keys(NEW_SWITCHES).forEach((k) => { if (!(k in ECOLS.profiles)) ECOLS.profiles[k] = NEW_SWITCHES[k]; });

    /** the profiles checks, on the row as it would be */
    function checks(p) {
      if (p.can_estimate && !["admin", "manager"].includes(p.role)) {
        throw rule("23514", 'new row for relation "profiles" violates check constraint "profiles_estimate_needs_manager"');
      }
      if (p.can_upload_onedrive && !["admin", "manager", "accountant", "lead", "field"].includes(p.role)) {
        throw rule("23514", 'new row for relation "profiles" violates check constraint "profiles_onedrive_needs_writer"');
      }
      if (p.can_approve_payments && !(["admin", "manager"].includes(p.role) && p.can_see_financials)) {
        throw rule("23514", 'new row for relation "profiles" violates check constraint "profiles_approve_needs_manager_and_financials"');
      }
    }
    /** what tg_profiles_before forces: an admin every switch, the agents account none */
    function forced(p) {
      if (p.role === "admin") SWITCHES.forEach((k) => { p[k] = true; });
      else if (p.role === "agents") { SWITCHES.forEach((k) => { p[k] = false; }); p.must_change_password = false; }
    }
    function save(w, old, next) {
      forced(next);
      checks(next);
      E.auditUpdate(w, "profiles", next, old);
      E.commitUpdate("profiles", old, next);
      return next;
    }

    function checkArgs(name, args) {
      const sig = SIGS[name];
      const keys = Object.keys(args || {});
      if (keys.some((k) => !sig.args.includes(k)) || sig.required.some((k) => !keys.includes(k))) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404);
      }
    }

    function rpc(w, name, args) {
      if (name !== "admin_set_profile") throw new PgErr("PGRST202", "Could not find the function public." + name, 404);
      if (!w.admin) throw deny("only an admin can change role, switches or active");
      const id = args.p_id;
      if (id === null || id === undefined || id === "") throw rule("22023", "p_id is required");
      const sw = args.p_switches === null || args.p_switches === undefined ? {} : args.p_switches;
      if (typeof sw !== "object" || Array.isArray(sw)) throw rule("22023", "switches must be a JSON object");
      for (const k of Object.keys(sw)) {
        if (!SWITCHES.includes(k)) throw rule("22023", "unknown switch: " + k);
        if (typeof sw[k] !== "boolean") throw rule("22023", k + " must be true or false");
      }
      const role = args.p_role === undefined ? null : args.p_role;
      if (role !== null && !ROLES.includes(role)) throw rule("22023", "role must be admin, manager, lead, accountant, field, viewer or agents");
      const old = rows.profiles.find((p) => p.id === id);
      if (!old) throw new PgErr("PT404", "person not found", 404);
      if (args.p_version !== null && args.p_version !== undefined && Number(args.p_version) !== Number(old.version)) {
        throw new PgErr("PT409", "the person was changed by someone else", 409, JSON.stringify({ table: "profiles", id, version: old.version }));
      }
      const active = args.p_active === undefined ? null : args.p_active;
      if (active === false && id === w.uid) throw rule("22023", "you cannot turn off your own account");
      let cur = old;
      // 1. role and active: a new role takes its default switches
      if ((role !== null && role !== cur.role) || (active !== null && active !== cur.active)) {
        const next = Object.assign(clone(cur), { role: role !== null ? role : cur.role, active: active !== null ? active : cur.active });
        if (cur.role === "admin" && cur.active && !(next.role === "admin" && next.active) &&
            !rows.profiles.some((p) => p.id !== cur.id && p.role === "admin" && p.active)) {
          throw rule("23514", "this is the last active admin; make someone else admin first");
        }
        if (next.role !== cur.role) Object.assign(next, roleDefaults(next.role));
        cur = save(w, cur, next);
      }
      // 2. the switches asked for (an admin holds them all, the agents account none: nothing to set)
      if (Object.keys(sw).length && !["admin", "agents"].includes(cur.role)) {
        const next = Object.assign(clone(cur), sw);
        if (SWITCHES.some((k) => next[k] !== cur[k])) cur = save(w, cur, next);
      }
      return clone(cur);
    }

    return { name: "p7-web", tables: new Set(), canRead: () => false, handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc };
  });

  /* ── made-up people and switches (after seed.js made the profiles) ── */
  (NS.extSeed = NS.extSeed || []).push(function seedP7(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    // what tg_profiles_before forces (an admin on, the agents account off); anyone else keeps a switch an earlier
    // extension set (p5a-est.js, loaded first, may seed the Estimator switch and Robin Estimator himself) and gets
    // the role's default (off) only where nothing set it
    (out.profiles || []).forEach((p) => {
      Object.keys(NEW_SWITCHES).forEach((k) => {
        if (p.role === "admin") p[k] = true;
        else if (p.role === "agents") p[k] = false;
        else if (typeof p[k] !== "boolean") p[k] = NEW_SWITCHES[k];
      });
    });
    const row = (id) => (out.profiles || []).find((p) => p.id === id);
    if (row(P.manager_prices)) { row(P.manager_prices).can_estimate = true; row(P.manager_prices).can_upload_onedrive = true; }
    if (row(P.lead)) row(P.lead).can_upload_onedrive = true;
    if (out.profiles && !out.profiles.some((p) => p.id === ESTIMATOR.id)) {
      const at = new Date(now.getTime() - 120 * 86400000).toISOString();
      out.profiles.push({ id: ESTIMATOR.id, full_name: ESTIMATOR.full_name, email: ESTIMATOR.email, phone: ESTIMATOR.phone, role: ESTIMATOR.role,
        color: ESTIMATOR.color, can_see_prices: false, can_see_financials: false, can_approve_payments: false, can_sales_estimates: false,
        can_estimate: true, can_upload_onedrive: false, active: true, must_change_password: false,
        created_at: at, created_by: P.admin, updated_at: at, updated_by: null, version: 1 });
    }
    if (Array.isArray(NS.PEOPLE) && !NS.PEOPLE.some((p) => p.key === ESTIMATOR.key || p.id === ESTIMATOR.id)) {
      NS.PEOPLE.push({ key: ESTIMATOR.key, id: ESTIMATOR.id, email: ESTIMATOR.email, name: ESTIMATOR.full_name, role: ESTIMATOR.role,
        note: "Estimator switched on (no prices)" });
    }
    P.estimator = ESTIMATOR.id;
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
