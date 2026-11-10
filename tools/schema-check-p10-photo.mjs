/* DCR Portal 2 — the shoot schedule's calls against the REAL database rules (development only): the photographer screen
   program, P3 part of tools/schema-check.mjs (it calls run() with its own helpers). site/js/repo/photo.js and
   site/js/map/photo.js run over PGlite loaded with every DCR Desktop 2 migration - 20261110000100_photo_schedule
   (docs/DATABASE.md §39; the contract is DCR Desktop 2's docs/PHOTO-SCHEDULE.md) included - as each made-up role: an admin
   (never listed), two photographers (one the default), a marketing member, a lead / manager / field / viewer / accountant on
   no team, and the agents account:

   * names: every column the module selects (photo_plans, photo_shoots, photo_changes, photo_team and its profiles embed)
     and every argument it sends exist, in the migration's order; the map's lists (kinds, statuses, milestones) are the
     table checks' own;
   * the team: written only through set_photo_team at the row's version (the first photographer the default, p_default
     moving it, pick_default_first, bad_email, agents, inactive, no_person, forbidden; a "changed" refusal surfaced with
     its detail and nothing written over), read by admins and the team only;
   * who: photo_my_access per role; the mirror read by admins and the photo team only (archived plans on request);
   * the mirror seeded the way DCR Agents 2 writes it - the agents account, the lease holder, one ledger, a rising rev -
     from the demo database's own plans (tools/fake/p10-photo.js), which the real agents_photo_mirror takes as they are;
   * the preview: the database's answers put into words by map/photo.js with no code left without words, and equal to the
     demo database's answers for the same plan and the same change (ids aside);
   * the queue: request with base_rev and the client key (a retry after a dropped connection answers the same row, again:
     true), pending, key_reused, changed {table, id, rev}, the rule's refusals as typed errors, cancel, the agents' take /
     done / error lifecycle as the page reads it, undo within the rules, a Firm job date "suggested";
   * photo_pc_status's line; the Realtime watch joining the four tables' private channels and reading once;
   * the pages' parts: a My Tasks task's shoot (shootForTask: the team only); the Access tab's Photo team payloads
     (map/access.js photoPayload) through set_photo_team - the e-mail tidied, Marketing off forgets it, a stale row in the
     card's words, both ticks off removes the row;
   * drift: the demo database's columns, RPC arguments and codes equal the migration's, and its port of the shift rule
     answers the shared case file as app.photo_shift does.
   Made-up people and jobs only. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOST = "SCHEMA-PHOTO-PC#agents2";
const LEDGER = "c2100000-0000-4000-8000-0000000000a1";
const MIGRATION = "20261110000100_photo_schedule.sql";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE, D2 } = h;
  if (!(catalog.tables.photo_plans && catalog.tables.photo_team && catalog.functions.photo_change_request && catalog.functions.set_photo_team)) {
    results.push({ section, name: "The photo schedule (20261110000100_photo_schedule) is not in DCR Desktop 2 yet: the shoot schedule checks wait for it", ok: true });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const photo = await site("repo/photo.js");
  const M = await site("map/photo.js");
  const today = (await one("select app.today()::text as d")).d;
  const addDays = (k, d) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + d)).toISOString().slice(0, 10);
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v);
  const mem = new Map();
  photo.useKeyStore({ getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); } });

  /* ── made-up people of this part: two photographers and a marketing member (the others are schema-check.mjs's) ── */
  const MINE = {
    photo: { id: "c2000000-0000-4000-8000-0000000000c1", name: "Pia Lens", role: "field" },
    photo2: { id: "c2000000-0000-4000-8000-0000000000c2", name: "Roy Shutter", role: "lead" },
    market: { id: "c2000000-0000-4000-8000-0000000000c3", name: "Mo Market", role: "viewer" },
  };
  await sql("reset role");
  for (const [k, p] of Object.entries(MINE)) await sql("insert into auth.users (id, email) values ($1, $2)", [p.id, "p10-" + k + "@schema-check.test"]);
  await sql("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: PEOPLE.admin.id, role: "authenticated" })]);
  await sql("set role authenticated");
  for (const [k, p] of Object.entries(MINE)) {
    await sql("insert into public.profiles (id, full_name, email, role, active) values ($1, $2, $3, $4, true)", [p.id, p.name, "p10-" + k + "@schema-check.test", p.role]);
  }
  await sql("reset role");
  await sql("select set_config('request.jwt.claims', '', false)");
  Object.assign(PEOPLE, MINE);
  const NO_TEAM = ["lead", "manager", "field", "viewer", "accountant"];
  const asAgents = () => client.as(PEOPLE.agents.id);
  const rpcAs = async (who, name, args) => {
    client.as(who === "agents" ? PEOPLE.agents.id : PEOPLE[who].id);
    const r = await client.rpc(name, args);
    if (r.error) throw Object.assign(new Error(r.error.message), r.error);
    return r.data;
  };

  /* ── the demo database (its seed: the plans to mirror, and the answers to compare) ── */
  const H = await import(pathToFileURL(path.join(SITE, "..", "tests", "pages-engine.mjs")).href);
  const engine = await H.freshEngine(new Date());
  const NS = globalThis.DCR2Fake;
  const fakeId = (k) => NS.PEOPLE.find((p) => p.key === k).id;
  const fakePhoto = engine.exts.find((x) => x.name === "p10-photo");
  const _db = await site("repo/_db.js");

  const planJson = (p) => ({ local_id: p.local_id, status: p.status, project_code: p.project_code, project_label: p.project_label, city: p.city, title: p.title,
    photographer: p.photographer_name ? MINE.photo.name : "", photographer_source: p.photographer_source,
    milestones: Object.fromEntries(Object.entries(p.milestones).map(([k, m]) => [k, { date: m.date, source: m.source, confirmed: m.confirmed }])),
    shoot_days: p.shoot_days, lead_days: p.lead_days, series: p.series, open_suggestions: p.open_suggestions, activated_at: p.activated_at });
  const shootJson = (s) => ({ local_id: s.local_id, key: s.key, seq: s.seq, phase: s.phase, name: s.name, anchor: s.anchor, offset_days: s.offset_days,
    fixed_date: s.fixed_date, planned_date: s.planned_date, window_days: s.window_days, status: s.status, auto_skipped: s.auto_skipped, pin_day: s.pin_day,
    series: s.series, n: s.n, announced_for: s.announced_for, done_at: s.done_at, done_source: s.done_source, done_note: s.done_note, task_id: s.task_id,
    brief: s.brief, history: s.history });
  let REV = 1000;
  const mirror = (plan, shoots, rev) => rpcAs("agents", "agents_photo_mirror", { p_host: HOST, p_ledger: LEDGER, p_plan: plan, p_shoots: shoots, p_rev: rev });
  const P = {};      // the mirror's ids by project code

  try {
    await check("P10 photo: the names - every column repo/photo.js selects and every argument it sends exist (in the migration's order); the map's lists are the table checks' own", async () => {
      const cols = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
      for (const c of cols(photo.PLAN_COLS)) ok(catalog.tables.photo_plans.cols[c], "photo_plans." + c);
      for (const c of cols(photo.SHOOT_COLS)) ok(catalog.tables.photo_shoots.cols[c], "photo_shoots." + c);
      for (const c of cols(photo.CHANGE_COLS)) ok(catalog.tables.photo_changes.cols[c], "photo_changes." + c);
      for (const c of cols(photo.TEAM_COLS)) ok(catalog.tables.photo_team.cols[c], "photo_team." + c);
      for (const c of ["full_name", "role", "active"]) ok(catalog.tables.profiles.cols[c], "profiles." + c);
      for (const [fn, args] of Object.entries(photo.RPC_ARGS)) {
        same((catalog.functions[fn] || []).map((f) => f.args.map((a) => a.name)), [args], fn);
      }
      ok(!/\bhost\b|ledger_id|local_id|client_key/.test(photo.PLAN_COLS + photo.SHOOT_COLS + photo.CHANGE_COLS), "never the PC's host, the ledger or the client key");
      const check = async (table, name) => (await one("select pg_get_constraintdef(c.oid) as d from pg_constraint c where c.conrelid = $1::regclass and c.conname = $2",
        ["public." + table, name])).d;
      const listed = (d) => Array.from(d.matchAll(/'([a-z_]+)'::text/g)).map((m) => m[1]);
      same(listed(await check("photo_shoots", "photo_shoots_status_check")).sort(), M.SHOOT_STATUSES.slice().sort(), "the shoot statuses");
      same(listed(await check("photo_plans", "photo_plans_status_check")).sort(), M.PLAN_STATUSES.slice().sort(), "the plan statuses");
      same(listed(await check("photo_changes", "photo_changes_status_check")).sort(), M.CHANGE_STATUSES.slice().sort(), "the change statuses");
      same(listed(await check("photo_changes", "photo_changes_kind_check")).sort(), M.KINDS.slice().sort(), "the kinds");
      same(listed(await check("photo_shoots", "photo_shoots_anchor_check")).sort(), M.MILESTONES.concat(["fixed"]).sort(), "the anchors");
      same(listed(await check("photo_shoots", "photo_shoots_phase_check")).sort(), Object.keys(M.PHASE_LABEL).sort(), "the phases");
    });

    await check("P10 photo: the team - written ONLY through set_photo_team at the row's version (the first photographer the default, p_default moves it, pick_default_first, bad_email, agents, inactive, no_person, forbidden); a 'changed' refusal surfaced and nothing written over; read by admins and the team only", async () => {
      await as("admin");
      const a = await photo.setTeam(MINE.photo.id, { photographer: true, marketing: false }, null);
      same([a.defaultPhotographer, a.version, a.defaultProfileId], [true, 1, MINE.photo.id], "the first photographer is the default");
      const b = await photo.setTeam(MINE.photo2.id, { photographer: true, marketing: false }, null);
      same([b.defaultPhotographer, b.defaultProfileId], [false, MINE.photo.id], "the second is not");
      const moved = await photo.setTeam(MINE.photo2.id, { photographer: true, marketing: false, isDefault: true }, b.version);
      same([moved.defaultProfileId, moved.version], [MINE.photo2.id, 2], "p_default moves it");
      const stale = await refused(() => photo.setTeam(MINE.photo.id, { photographer: true, marketing: true }, 1), "PT409", "a stale version");
      same(canon([stale.hint, stale.reason, stale.detail]), canon(["changed", "changed", { table: "photo_team", id: MINE.photo.id, version: 2 }]), "changed, its detail parsed");
      same((await one("select marketing from public.photo_team where profile_id = $1", [MINE.photo.id])).marketing, false, "nothing written over");
      await photo.setTeam(MINE.photo.id, { photographer: true, marketing: false, isDefault: true }, 2);     // the default back to Pia
      same((await refused(() => photo.setTeam(MINE.photo.id, { photographer: false, marketing: false }, 3), "22023", "pick")).hint, "pick_default_first", "pick_default_first");
      same((await refused(() => photo.setTeam(MINE.market.id, { photographer: false, marketing: true, isDefault: true }, null), "22023", "dflt")).hint, "default_needs_photographer", "default_needs_photographer");
      same((await refused(() => photo.setTeam(MINE.market.id, { photographer: false, marketing: true, googleEmail: "mo market@example.test" }, null), "22023", "e-mail")).hint, "bad_email", "bad_email");
      same((await refused(() => photo.setTeam(PEOPLE.agents.id, { photographer: true, marketing: false }, null), "22023", "agents")).hint, "agents", "agents");
      same((await refused(() => photo.setTeam(PEOPLE.inactive.id, { photographer: true, marketing: false }, null), "22023", "inactive")).hint, "inactive", "inactive");
      same((await refused(() => photo.setTeam("c2000000-0000-4000-8000-0000000000ff", { photographer: true, marketing: false }, null), "PT404", "no_person")).hint, "no_person", "no_person");
      const em = M.googleEmailProblem("\t Mo.Market@Example.TEST \n\u00a0");
      const m = await photo.setTeam(MINE.market.id, { photographer: false, marketing: true, googleEmail: "\t Mo.Market@Example.TEST \n\u00a0" }, null);
      same([m.googleEmail, em.value, em.problem], ["mo.market@example.test", "mo.market@example.test", ""], "the e-mail tidied - the map's hint is the database's rule");
      for (const k of ["photo", "market", "lead"]) {
        await as(k);
        await refused(() => photo.setTeam(MINE.market.id, { photographer: true, marketing: true }, 1), "42501", k + ": only an admin");
      }
      for (const k of ["admin", "photo", "photo2", "market"]) {
        await as(k);
        const t = await photo.team();
        same(t.map((x) => x.name), ["Mo Market", "Pia Lens", "Roy Shutter"], k + ": the team with names (the profiles embed)");
        same(t.find((x) => x.name === "Mo Market").googleEmail, "mo.market@example.test", k + ": the marketing e-mail");
        same(M.teamSummary(t).defaultId, MINE.photo.id, k + ": one default photographer");
      }
      for (const k of NO_TEAM) {
        await as(k);
        same(await photo.team(), [], k + ": no team row");
      }
      same((await one("select count(*)::int as n from public.photo_team where profile_id = $1", [PEOPLE.admin.id])).n, 0, "an admin is never listed automatically");
    });

    await check("P10 photo: who - photo_my_access per role (an unlisted admin, the default photographer, a photographer, marketing, five people on no team), the agents account refused", async () => {
      const want = { admin: [true, false, false, false, true, true], photo: [false, true, false, true, true, true], photo2: [false, true, false, false, true, true],
        market: [false, false, true, false, false, true] };
      for (const k of NO_TEAM) want[k] = [false, false, false, false, false, false];
      for (const [k, w] of Object.entries(want)) {
        await as(k);
        const a = await photo.myAccess();
        same([a.admin, a.photographer, a.marketing, a.defaultPhotographer, a.canEdit, a.canRead, a.ready], w.concat([true]), k);
      }
      asAgents();
      const e = await refused(() => photo.myAccess(), "42501", "the agents account");
      same(e.reason, "forbidden", "typed");
    });

    await check("P10 photo: the mirror seeded the way DCR Agents 2 writes it (the agents account, the lease holder, one ledger, a rising rev) from the demo database's own plans - the real agents_photo_mirror takes them as they are", async () => {
      await sql("reset role");
      await sql("update app.agents_lease set host_id = $1, since = now(), lease_by = 'schema-check' where id = 1", [HOST]);
      await sql("delete from app.agents_hosts where host_id = $1", [HOST]);
      await sql("insert into app.agents_hosts (host_id, at, version, proto, standby, payload) values ($1, now() - interval '1 minute', '2.2.0', 1, false, '{\"paused\": false}')", [HOST]);
      for (const p of engine.rows.photo_plans.slice().sort((x, y) => x.local_id - y.local_id)) {
        const r = await mirror(planJson(p), engine.rows.photo_shoots.filter((s) => s.plan_id === p.id).map(shootJson), ++REV);
        ok(r.ok && !r.same && r.shoots.length === engine.rows.photo_shoots.filter((s) => s.plan_id === p.id).length, p.project_code + ": " + JSON.stringify(r).slice(0, 120));
        P[p.project_code] = r.plan_id;
      }
      same((await rpcAs("agents", "agents_photo_mirror", { p_host: "OTHER-PC#agents2", p_ledger: LEDGER, p_plan: planJson(engine.rows.photo_plans[0]), p_shoots: [], p_rev: ++REV })
        .catch((e) => e.hint)), "not_server", "the lease holder only");
      same(await mirror(planJson(engine.rows.photo_plans[0]), [], 5).catch((e) => e.hint), "stale_rev", "a lower rev");
      await as("photo");
      const s = await photo.loadSchedule();
      same(s.plans.map((p) => p.projectCode).sort(), ["A000T6", "A000T8", "A000T9"], "archived hidden");
      same((await photo.loadSchedule({ archived: true })).plans.length, 4, "archived on request");
      const a = s.plans.find((p) => p.projectCode === "A000T9");
      same([a.photographerName, a.photographerProfileId, a.milestones.framing_start.firm, a.milestones.delivery.firm, a.shootDays],
        ["Pia Lens", MINE.photo.id, true, false, [0, 1, 2, 3, 4, 5]], "the photographer resolved from the roster name; Firm");
      const fakeShoots = engine.rows.photo_shoots.filter((x) => x.plan_id === engine.rows.photo_plans.find((p) => p.project_code === "A000T9").id);
      same(s.shoots.filter((x) => x.planId === a.id).map((x) => [x.key, x.plannedDate, x.status, x.windowDays]).sort(),
        fakeShoots.map((x) => [x.key, x.planned_date, x.status, x.window_days]).sort(), "the demo's shoots, as mirrored");
      for (const k of ["admin", "photo2", "market"]) {
        await as(k);
        same((await photo.loadSchedule()).plans.length, 3, k + " reads the mirror");
      }
      for (const k of NO_TEAM) {
        await as(k);
        const x = await photo.loadSchedule({ archived: true });
        same([x.ready, x.plans.length, x.shoots.length], [true, 0, 0], k + " reads none of it");
      }
      asAgents();
      same(((await client.from("photo_plans").select("id")).data || []).length, 0, "the agents account reads no mirror row directly");
    });

    // the changes asked below, the same through the real database and the demo database (non-admins, plan A000T9)
    const CHANGES = (a) => {
      const sh = (k) => a.find((x) => x.key === k);
      const sunday = (d) => { let x = d; for (let i = 0; i < 7; i++) { if (new Date(x + "T00:00:00Z").getUTCDay() === 0) return x; x = addDays(x, 1); } return x; };
      return [
        ["move_one", { shoot: "delivery", to: addDays(sh("delivery").plannedDate, 2) }],
        ["move_later", { shoot: "delivery", to: addDays(sh("delivery").plannedDate, 2) }],
        ["move_later", { shoot: "before-framing", to: addDays(sh("before-framing").plannedDate, 1) }],
        ["move_one", { shoot: "drone-check", to: sunday(addDays(today, 2)) }],
        ["milestone", { shoot: "before-framing", to: addDays(sh("before-framing").plannedDate, 3) }],
        ["milestone", { milestone: "delivery", date: addDays(today, 9) }],
        ["milestone", { milestone: "framing_complete", date: addDays(today, 44) }],
        ["milestone", { milestone: "house_complete", date: addDays(today, 70) }],
        ["done", { shoot: "progress-1", note: "All shot" }],
        ["move_one", { shoot: "delivery", to: addDays(today, -1) }],
        ["move_one", { shoot: "delivery", to: addDays(today, 400) }],
        ["move_one", { shoot: "delivery", to: sh("delivery").plannedDate }],
        ["move_one", { shoot: "site-walk", to: addDays(today, 3) }],
        ["move_later", { shoot: "house-complete", to: addDays(today, 60) }],
        ["milestone", { shoot: "drone-check", to: addDays(today, 20) }],
        ["milestone", { milestone: "delivery", date: addDays(today, -70) }],
        ["done", { shoot: "site-walk" }],
      ];
    };

    await check("P10 photo: the preview - the database's answers put into words by map/photo.js (every shoot from -> to with its weekday, every note, stay, skip, series and the office's approval; no code left without words) and EQUAL to the demo database's for the same plan and change (ids aside)", async () => {
      await as("photo");
      const s = await photo.loadSchedule();
      const plan = s.plans.find((p) => p.projectCode === "A000T9");
      const shoots = s.shoots.filter((x) => x.planId === plan.id);
      const fakePlan = engine.rows.photo_plans.find((p) => p.project_code === "A000T9");
      const fakeClient = H.clientAs(engine, fakeId("field"));
      const strip = (pv) => {
        const out = Object.assign({}, pv);
        delete out.plan_id; delete out.rev;
        for (const k of ["moved", "stays", "passed"]) out[k] = (out[k] || []).map((x) => { const y = Object.assign({}, x); delete y.id; return y; });
        if (out.done) { out.done = Object.assign({}, out.done); delete out.done.id; }
        return canon(out);
      };
      let worded = 0;
      const seen = new Set();
      for (const [kind, args] of CHANGES(shoots)) {
        const real = await photo.preview(plan.id, kind, args);
        const fake = (await fakeClient.rpc("photo_change_preview", { p_plan: fakePlan.id, p_kind: kind, p_args: args })).data;
        same(strip(fake), strip(real), kind + " " + JSON.stringify(args) + ": the demo answers as the database");
        const w = M.previewWords(real, { plan, shoots, today });
        same(w.unknown, [], kind + ": every code has words");
        if (real.refused) { ok(w.refused.text && w.refused.text !== "The shoot schedule cannot make that change.", kind + ": " + real.refused); seen.add("refused:" + real.refused); continue; }
        for (const [i, m] of real.moved.entries()) {
          ok(w.moved[i].text === m.name + ": " + (m.from ? M.dayText(m.from, today) : "no date") + " → " + M.dayText(m.to, today), w.moved[i].text);
          for (const n of m.notes) seen.add("note:" + n);
        }
        for (const x of real.stays) seen.add("stay:" + x.reason);
        if (real.passed.length) seen.add("passed");
        if (real.replan.length) { seen.add("replan"); ok(w.replan[0].text === "Framing progress visits will be re-planned - some may be added or cancelled", w.replan[0].text); }
        if (real.needs_office) { seen.add("office"); same(w.office, "Framing start is Firm - the office will be asked to approve", "the office"); }
        if (real.done) same(w.done.text, "Framing progress #1 will be marked done", "done");
        worded += 1;
      }
      ok(worded >= 8, worded + " previews worded");
      for (const k of ["note:heads_up_sent", "note:not_shoot_day", "stay:fixed", "stay:undated", "replan", "office", "refused:past", "refused:too_far", "refused:no_change",
        "refused:not_open", "refused:undated", "refused:not_anchored"]) ok(seen.has(k), "the walk covered " + k);
      for (const k of ["market"].concat(NO_TEAM)) {
        await as(k);
        same((await refused(() => photo.preview(plan.id, "move_one", { shoot: "delivery", to: addDays(today, 5) }), "42501", k)).reason, "forbidden", k + ": typed");
      }
    });

    await check("P10 photo: the queue - request with base_rev and the client key (a retry after a dropped connection answers the same row, again: true), pending, key_reused, the rule's refusals as typed errors; cancel; the agents' take / done / error as the page reads them; changed {table, id, rev} once the PC re-mirrored", async () => {
      await as("photo");
      let s = await photo.loadSchedule();
      let plan = s.plans.find((p) => p.projectCode === "A000T9");
      const sh = (k) => s.shoots.find((x) => x.planId === plan.id && x.key === k);
      // a dropped connection: the database wrote the change, the page heard nothing
      const orig = client.rpc;
      let drop = true;
      client.rpc = async function (n, a) {
        const r = await orig.call(client, n, a);
        if (n === "photo_change_request" && drop) { drop = false; return { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 }; }
        return r;
      };
      const args = { shoot: "drone-check", to: addDays(sh("drone-check").plannedDate, 1), reason: "Wind - the $90 drone fee stays" };
      let lost;
      try {
        lost = await photo.request(plan.id, "move_one", args, plan.rev).then(() => null, (e) => e);
      } finally { client.rpc = orig; }
      ok(lost && lost.retryable && lost.reason === "offline", "no answer: " + (lost && lost.message));
      const again = await photo.request(plan.id, "move_one", args, plan.rev);
      same([again.again, again.key, again.status], [true, lost.key, "new"], "the same request");
      same((await one("select count(*)::int as n from public.photo_changes where target_key = 'drone-check'")).n, 1, "ONE row");
      const row = await one("select args, client_key, base_rev, requester_is_plan_photographer from public.photo_changes where id = $1", [again.id]);
      same([row.client_key, Number(row.base_rev), row.requester_is_plan_photographer, /\$|90/.test(row.args.reason)], [lost.key, plan.rev, true, false],
        "the key, the rev read, the plan's photographer, the reason scrubbed");
      ok(/^p2[a-z0-9]{12}-[a-z0-9]{10}$/.test(lost.key), lost.key);
      const pend = await refused(() => photo.request(plan.id, "done", { shoot: "drone-check" }, plan.rev), "PT409", "pending");
      same([pend.hint, pend.detail], ["pending", { id: again.id }], "pending {id}");
      await as("photo2");
      const own = await photo.request(plan.id, "move_one", { shoot: "progress-1", to: addDays(sh("progress-1").plannedDate, 1) }, plan.rev, { key: lost.key });
      same([own.again, own.status], [false, "new"], "each person has a key space of their own");
      same(await photo.cancel(own.id), { ok: true, status: "cancelled" }, "the requester cancels it");
      await as("photo");
      same((await refused(() => photo.request(plan.id, "move_one", { shoot: "progress-3", to: addDays(sh("progress-3").plannedDate, 1) }, plan.rev, { key: lost.key }), "PT409", "reused")).hint,
        "key_reused", "key_reused");
      for (const [kind, a, hint] of [["move_one", { shoot: "delivery", to: addDays(today, -1) }, "past"], ["move_one", { shoot: "site-walk", to: addDays(today, 3) }, "not_open"],
        ["move_later", { shoot: "house-complete", to: addDays(today, 60) }, "undated"], ["milestone", { milestone: "roof_on", date: addDays(today, 3) }, "bad_milestone"]]) {
        const e = await refused(() => photo.request(plan.id, kind, a, plan.rev), "22023", hint);
        same(e.hint, hint, hint);
        ok(M.refusalText(e.reason) !== "The shoot schedule cannot make that change.", hint + " in words");
      }
      same((await refused(() => photo.request(P.A000T6, "move_one", { shoot: "delivery", to: addDays(today, 30) }, REV), "22023", "review")).hint, "plan_not_active", "a plan in review");
      same((await refused(() => photo.request(plan.id, "move_one", { shoot: "delivery", to: addDays(today, 9) }, plan.rev + 9999), "22023", "rev")).hint, "bad_rev", "bad_rev");
      for (const k of ["market", "lead", "viewer"]) {
        await as(k);
        same((await refused(() => photo.request(plan.id, "move_one", { shoot: "delivery", to: addDays(today, 9) }, plan.rev), "42501", k)).hint, "forbidden", k + ": forbidden");
      }
      // who reads the queue: the requester and the schedule's editors; marketing and the rest read nothing
      for (const [k, n] of [["photo", 1], ["photo2", 1], ["admin", 1], ["market", 0], ["lead", 0]]) {
        await as(k);
        same((await photo.changes()).filter((c) => c.id === again.id).length, n, k + " reads the change");
      }
      // cancel: another photographer 42501, marketing PT404, an admin anyone's
      const c2 = await (async () => { await as("photo"); return photo.request(plan.id, "move_one", { shoot: "progress-2", to: addDays(sh("progress-2").plannedDate, 1) }, plan.rev); })();
      await as("photo2");
      await refused(() => photo.cancel(c2.id), "42501", "another photographer");
      await as("market");
      await refused(() => photo.cancel(c2.id), "PT404", "marketing");
      await as("admin");
      same(await photo.cancel(c2.id), { ok: true, status: "cancelled" }, "an admin cancels anyone's");
      await as("photo");
      const c2r = (await photo.changes()).find((c) => c.id === c2.id);
      same([c2r.state, M.changeStatusText(c2r).text, M.canCancel(c2r, MINE.photo.id, await photo.myAccess()).ok], ["cancelled", "Cancelled", false], "cancelled");
      // the PC takes the drone-check move: the page reads it taken (cancel too late), then applied
      const take = await rpcAs("agents", "agents_photo_change_take", { p_id: again.id, p_host: HOST, p_ledger: LEDGER });
      same([take.ok, take.change.requester.plan_photographer, take.change.requester.name], [true, true, "Pia Lens"], "taken by the PC");
      await as("photo");
      same((await photo.changes({ open: true })).find((c) => c.id === again.id).state, "taken", "the page reads it taken");
      same(await photo.cancel(again.id), { ok: false, status: "taken" }, "too late to cancel");
      // the PC re-mirrors the plan with the moved day and a higher rev, then answers
      const fp = engine.rows.photo_plans.find((p) => p.project_code === "A000T9");
      const local = engine.rows.photo_shoots.find((x) => x.plan_id === fp.id && x.key === "drone-check").local_id;
      const moved = [{ key: "drone-check", local_id: local, name: "Drone airspace check", from: sh("drone-check").plannedDate, to: args.to }];
      const fs = engine.rows.photo_shoots.filter((x) => x.plan_id === fp.id).map(shootJson).map((x) => (x.key === "drone-check" ? Object.assign(x, { planned_date: args.to, fixed_date: args.to, pin_day: args.to }) : x));
      await mirror(planJson(fp), fs, ++REV);
      same(await rpcAs("agents", "agents_photo_change_done", { p_id: again.id, p_host: HOST, p_result: { outcome: "applied", moved, passed: [], added: [], cancelled: [],
        suggestion: null, differs_from_preview: false, words: "1 shoot moved", rev: REV } }), { ok: true }, "done");
      await as("photo");
      const done = (await photo.myChanges(MINE.photo.id)).find((c) => c.id === again.id);
      same([done.state, M.changeStatusText(done).text, done.result.words, M.canUndo(done, MINE.photo.id, await photo.myAccess()).ok], ["applied", "Applied", "1 shoot moved", true],
        "applied, undoable by its requester");
      s = await photo.loadSchedule();
      plan = s.plans.find((p) => p.projectCode === "A000T9");
      same(s.shoots.find((x) => x.planId === plan.id && x.key === "drone-check").plannedDate, args.to, "the mirror moved");
      const stale = await refused(() => photo.request(plan.id, "move_one", { shoot: "drone-check", to: addDays(args.to, 1) }, REV - 1), "PT409", "a stale rev");
      const dc = await one("select id, rev from public.photo_shoots where plan_id = $1 and key = 'drone-check'", [plan.id]);
      same(canon([stale.hint, stale.detail]), canon(["changed", { table: "photo_shoots", id: Number(dc.id), rev: Number(dc.rev) }]), "changed {table, id, rev}");
      // the PC refuses one: the page reads the PC's code in words
      const r3 = await photo.request(plan.id, "move_one", { shoot: "progress-3", to: addDays(sh("progress-3").plannedDate, 2) }, plan.rev);
      await rpcAs("agents", "agents_photo_change_take", { p_id: r3.id, p_host: HOST, p_ledger: LEDGER });
      await rpcAs("agents", "agents_photo_change_error", { p_id: r3.id, p_host: HOST, p_error: { code: "changed", message: "The shoot changed meanwhile - look again ($90 more)" } });
      await as("photo");
      const r3r = (await photo.changes()).find((c) => c.id === r3.id);
      same([r3r.state, r3r.error.code, M.changeStatusText(r3r).text], ["refused", "changed", "Not done: The shoot changed meanwhile - look again."], "refused in words");
      P.undoable = again.id;
    });

    await check("P10 photo: undo and the office - the requester's undo previewed (the move reversed) and asked; another photographer refused (42501 forbidden); once answered the original is undone; a photographer's Firm job date asks the office (needs_office, outcome suggested)", async () => {
      await as("photo");
      let s = await photo.loadSchedule();
      const plan = s.plans.find((p) => p.projectCode === "A000T9");
      const pv = await photo.preview(plan.id, "undo", { change: P.undoable });
      const dc = s.shoots.find((x) => x.planId === plan.id && x.key === "drone-check");
      same([pv.refused, pv.moved.map((m) => [m.key, m.from, m.to])], [null, [["drone-check", dc.plannedDate, addDays(dc.plannedDate, -1)]]], "the move reversed");
      same(M.previewWords(pv, { plan, shoots: s.shoots, today }).moved[0].text, "Drone airspace check: " + M.dayText(dc.plannedDate, today) + " → " + M.dayText(addDays(dc.plannedDate, -1), today), "in words");
      await as("photo2");
      same((await refused(() => photo.preview(plan.id, "undo", { change: P.undoable }), "42501", "another photographer")).hint, "forbidden", "typed");
      const orig = (await photo.changes()).find((c) => c.id === P.undoable);
      same(M.canUndo(orig, MINE.photo2.id, await photo.myAccess()).ok, false, "the map says so too");
      await as("photo");
      const u = await photo.request(plan.id, "undo", { change: P.undoable }, plan.rev);
      same(u.status, "new", "asked");
      await rpcAs("agents", "agents_photo_change_take", { p_id: u.id, p_host: HOST, p_ledger: LEDGER });
      await rpcAs("agents", "agents_photo_change_done", { p_id: u.id, p_host: HOST, p_result: { outcome: "applied", moved: [], words: "Undone", rev: REV } });
      await as("photo");
      const was = (await photo.changes()).find((c) => c.id === P.undoable);
      same([was.undoneBy, M.canUndo(was, MINE.photo.id, await photo.myAccess()).why], [u.id, "It was undone already."], "undone");
      // a Firm job date moved by a photographer: the office is asked
      s = await photo.loadSchedule();
      const p2 = s.plans.find((p) => p.projectCode === "A000T9");
      const firm = await photo.request(p2.id, "milestone", { milestone: "framing_start", date: addDays(p2.milestones.framing_start.date, 2), firm: false }, p2.rev);
      same(firm.needsOffice, true, "needs_office");
      same((await one("select args from public.photo_changes where id = $1", [firm.id])).args.firm, undefined, "a photographer's firm is dropped");
      await rpcAs("agents", "agents_photo_change_take", { p_id: firm.id, p_host: HOST, p_ledger: LEDGER });
      await rpcAs("agents", "agents_photo_change_done", { p_id: firm.id, p_host: HOST, p_result: { outcome: "suggested", moved: [], suggestion: { local_id: 7 },
        milestone_before: { key: "framing_start", date: p2.milestones.framing_start.date, source: "admin", confirmed: true }, words: "Sent to the office: Framing start is Firm", rev: REV } });
      await as("photo");
      const sug = (await photo.changes()).find((c) => c.id === firm.id);
      same([M.changeStatusText(sug).text, sug.result.words, M.canUndo(sug, MINE.photo.id, await photo.myAccess()).ok], ["Sent to the office to approve",
        "Sent to the office: Framing start is Firm", false], "suggested: never undone here");
    });

    await check("P10 photo: photo_pc_status - the office computer's line for the photo team (online, then last seen 2 h ago and paused), no host name; 42501 for anyone else", async () => {
      await as("market");
      let st = await photo.pcStatus();
      same([st.online, st.paused, st.minutesAgo, M.pcLine(st).state], [true, false, 1, "on"], "seen a minute ago");
      ok(!JSON.stringify(st).includes("PC#"), "no host name");
      await sql("update app.agents_hosts set at = now() - interval '2 hours', payload = '{\"paused\": true}' where host_id = $1", [HOST]);
      st = await photo.pcStatus();
      same(M.pcLine(st).text, "The office computer is off - changes wait until it is back on (last seen 2 h ago, paused)", "the line");
      for (const k of NO_TEAM) {
        await as(k);
        same((await refused(() => photo.pcStatus(), "42501", k)).reason, "forbidden", k);
      }
      await sql("update app.agents_hosts set at = now(), payload = '{}' where host_id = $1", [HOST]);
    });

    await check("P10 photo: the Realtime watch - the four tables' private channels joined (live.js) and one read after the joins", async () => {
      await as("photo");
      const live = await site("live.js");
      let reads = [];
      let done;
      const joined = new Promise((r) => { done = r; });
      const stop = await photo.watchSchedule(async (what) => { reads.push(what); done(); }, { live, wait: 0 });
      await Promise.race([joined, new Promise((r) => setTimeout(r, 3000))]);
      await new Promise((r) => setTimeout(r, 400));
      stop();
      ok(reads.length >= 1 && reads[0].join, "a read after the join: " + JSON.stringify(reads));
      same(reads.reduce((all, r) => all.concat(r.tables), []).sort(), ["photo_changes", "photo_plans", "photo_shoots", "photo_team"], "all four joined");
      reads = [];
    });

    await check("P10 photo: the pages' parts - My Tasks' task finds its shoot (photo_shoots.task_id: the team only), the Access tab's Photo team payload (map/access.js) through set_photo_team: the e-mail tidied, Marketing off forgets it, both ticks off removes the row", async () => {
      const V = await site("map/shoots.js");
      const A = await site("map/access.js");
      const withTask = await one("select id, plan_id, task_id from public.photo_shoots where task_id is not null order by id limit 1");
      ok(withTask, "the mirror carries a task id");
      await as("photo");
      same(await photo.shootForTask(Number(withTask.task_id)), { id: Number(withTask.id), planId: Number(withTask.plan_id) }, "a photographer finds the task's shoot");
      same(await photo.shootForTask(987654321), null, "a task with no shoot");
      for (const k of ["lead", "viewer"]) { await as(k); same(await photo.shootForTask(Number(withTask.task_id)), null, k + " (on no team): nothing"); }
      // the Access tab: a lead put on marketing with a pasted Google e-mail, then Marketing off, then off the team
      await as("admin");
      const profiles = (await one("select json_agg(json_build_object('id', id, 'full_name', full_name, 'role', role, 'active', active)) as v from public.profiles")).v;
      let team = await photo.team();
      let x = A.photoPeople(profiles, team).find((r) => r.id === PEOPLE.lead.id);
      ok(x && !x.row, "the lead is listed, not on the team");
      ok(!A.photoPeople(profiles, team).some((r) => r.role === "agents"), "never the agents account");
      let ed = A.photoTick(A.photoTick(A.photoStateOf(null), "marketing", true, { id: x.id, team }), "googleEmail", " Ri.Lead@Example.TEST\t", { id: x.id, team });
      let pay = A.photoPayload(x, ed, team);
      same([pay.problem, pay.version, pay.next.googleEmail], [null, null, "ri.lead@example.test"], "the payload");
      let out = await photo.setTeam(x.id, pay.next, pay.version);
      same([out.marketing, out.googleEmail, out.photographer], [true, "ri.lead@example.test", false], "on marketing, the e-mail as the database keeps it");
      team = await photo.team();
      x = A.photoPeople(profiles, team).find((r) => r.id === PEOPLE.lead.id);
      pay = A.photoPayload(x, A.photoTick(A.photoTick(A.photoStateOf(x.row), "photographer", true, { id: x.id, team }), "marketing", false, { id: x.id, team }), team);
      out = await photo.setTeam(x.id, pay.next, pay.version);
      same([out.photographer, out.marketing, out.googleEmail, out.defaultPhotographer], [true, false, null, false], "Marketing off forgets the e-mail; the default stays the default's");
      team = await photo.team();
      x = A.photoPeople(profiles, team).find((r) => r.id === PEOPLE.lead.id);
      const stale = A.photoPayload(x, A.photoStateOf(x.row), team);
      await photo.setTeam(x.id, Object.assign({}, stale.next, { marketing: true }), stale.version);            // someone else's save meanwhile
      same(A.photoSaveProblem(await refused(() => photo.setTeam(x.id, stale.next, stale.version), "PT409", "a stale row")), A.PHOTO_CHANGED, "changed, in the card's words");
      team = await photo.team();
      x = A.photoPeople(profiles, team).find((r) => r.id === PEOPLE.lead.id);
      pay = A.photoPayload(x, Object.assign(A.photoStateOf(x.row), { photographer: false, marketing: false }), team);
      same([pay.removing, pay.problem], [true, null], "both ticks off");
      out = await photo.setTeam(x.id, pay.next, pay.version);
      same(out.removed, true, "off the team");
      ok(V.officeLine("framing_start").startsWith("This job date (Framing start) is Firm"), "the Move sheet's words load");
    });

    await check("P10 photo: drift - the demo database (tools/fake/p10-photo.js) has the real columns, the RPCs' arguments and the migration's codes, and its port of the shift rule answers the shared case file as app.photo_shift", async () => {
      for (const [name, want] of Object.entries(NS.p10PhotoSigs)) {
        same(want, (catalog.functions[name] || [])[0] ? catalog.functions[name][0].args.map((a) => a.name) : null, name);
      }
      for (const t of ["photo_team", "photo_plans", "photo_shoots", "photo_changes"]) {
        same(Object.keys(engine.COLS[t] || {}).sort(), Object.keys(catalog.tables[t].cols).sort(), "the demo's " + t + " columns");
      }
      const src = readFileSync(path.join(D2, "supabase", "migrations", MIGRATION), "utf8");
      const made = Array.from(src.matchAll(/create or replace function public\.([a-z_]+)\(/g)).map((m) => m[1]).sort();
      same(Object.keys(NS.p10PhotoSigs).sort(), made, "every RPC the migration makes, none more");
      for (const f of made) ok(catalog.functions[f], f + " is in the database");
      const codes = new Set();
      for (const re of [/hint = '([a-z_]+)'/g, /agents_refuse\(\d+, '([a-z_]+)'/g, /photo_bad\('([a-z_]+)'/g, /'refused', '([a-z_]+)'/g, /'code', '([a-z_]+)'/g,
        /when '([a-z_]+)' then (?:raise|'[A-Z])/g]) for (const m of src.matchAll(re)) codes.add(m[1]);
      // the code of the helper the migration calls from DCR Agents 2's phase 6 (app.console_host: 400 bad_host)
      const phase6 = readFileSync(path.join(D2, "supabase", "migrations", "20261024000100_agents_phase6.sql"), "utf8");
      ok(/agents_refuse\(400, 'bad_host'/.test(phase6), "app.console_host refuses bad_host");
      codes.add("bad_host");
      same(NS.p10PhotoCodes.slice().sort(), Array.from(codes).sort(), "the codes");
      const words = Array.from(codes).filter((c) => !["bad_host", "bad_plan", "bad_shoot", "bad_request", "bad_result", "foreign_ledger", "not_server", "not_yours",
        "stale_rev", "taken"].includes(c));
      for (const c of words) ok(M.REFUSAL_CODES.includes(c), "the page has words for " + c);
      const cases = path.join(D2, "tools", "pglite_check", "photo_shift_cases.json");
      if (!existsSync(cases)) { ok(true, "no shared case file"); return; }
      const file = JSON.parse(readFileSync(cases, "utf8"));
      const failed = [];
      for (const c of file.cases) {
        const db = (await one("select app.photo_shift($1::jsonb) as v", [JSON.stringify(c.input)])).v;
        const demo = NS.p10PhotoShift(c.input);
        if (JSON.stringify(canon(db)) !== JSON.stringify(canon(demo))) failed.push(c.name);
      }
      same(failed, [], file.cases.length + " shared cases: the demo's rule answers as the database's");
      // and the demo's own PC: a change applied there leaves a mirror the real agents_photo_mirror takes as it is
      _db.useClient(H.clientAs(engine, fakeId("field")));
      const fp = engine.rows.photo_plans.find((p) => p.project_code === "A000T9");
      const r = await photo.request(fp.id, "move_later", { shoot: "progress-1", to: addDays(engine.rows.photo_shoots.find((x) => x.plan_id === fp.id && x.key === "progress-1").planned_date, 1) }, fp.rev);
      fakePhoto.__dev.pc.run();
      _db.useClient(null);
      same(engine.rows.photo_changes.find((c) => c.id === r.id).status, "applied", "the demo's PC applied it");
      const after = await mirror(planJson(fp), engine.rows.photo_shoots.filter((s) => s.plan_id === fp.id).map(shootJson), ++REV);
      ok(after.ok, "taken by the real mirror");
    });
  } finally {
    _db.useClient(null);
    await sql("reset role");
    await sql("delete from app.agents_hosts where host_id = $1", [HOST]);
    await sql("update app.agents_lease set host_id = null, since = null, lease_by = null where id = 1");
    for (const k of Object.keys(MINE)) delete PEOPLE[k];
  }
}
