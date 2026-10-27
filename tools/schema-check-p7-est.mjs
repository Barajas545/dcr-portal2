/* DCR Portal 2 — tools/schema-check.mjs's section for the web estimate editor (development only; owner 2026-10-24: Q12
   reversed - an Estimator edits estimates and change orders on the web too): Portal 2's own site/js/repo/estimate-edit.js,
   repo/estimates.js estimateAccess and map/estimate-edit.js against the REAL migration 20261028000100_estimator.sql
   (estimate_edit_read, save_estimate_item, the changed answers of add_estimate_item / move_estimate_items /
   reorder_estimate, the approval gate, the approved lock, the words guard, t25) - and, once DCR Desktop 2 has it,
   20261029000100_estimate_links_groups (owner 2026-10-27: estimate_edit_read's empty groups) - as each made-up person, through
   tools/pglite-rest.mjs. Mia Pricer (a manager with prices) and Max Manager (without) hold the Estimator switch for
   these checks only - Max is the quantities-only Estimator - and lose it again at the end. Made-up data only. */
import path from "node:path";
import { pathToFileURL } from "node:url";

const DOLLARS = /\$\s?\d/;
const MONEY_KEYS = ["labor", "material", "total", "labor_total", "material_total", "labor_per_area", "material_per_area", "client_notes", "notes",
  "labor_rate", "labor_unit_price", "labor_markup_pct", "material_unit_price", "material_markup_pct", "quoted_price", "unit_price", "amount"];

/** what in this answer a person without prices must never hold (key paths); "prices" only as the head's true / false,
    "totals" only {men_hours} */
function moneyIn(v, p, out, top) {
  out = out || [];
  if (Array.isArray(v)) { v.forEach((x, i) => moneyIn(x, p + "[" + i + "]", out, false)); return out; }
  if (!v || typeof v !== "object") return out;
  for (const k of Object.keys(v)) {
    const q = p + "." + k;
    if (MONEY_KEYS.includes(k)) out.push(q);
    else if (k === "prices" && !(top && typeof v[k] === "boolean")) out.push(q);
    else if (k === "totals" && Object.keys(v[k] || {}).some((x) => x !== "men_hours")) out.push(q);
    else moneyIn(v[k], q, out, false);
  }
  return out;
}

/** h: {check, results, section, as, client, sql, one, SITE, PEOPLE, ok, same, refused, catalog} */
export async function run(h) {
  const { check, results, as, client, sql, one, PEOPLE, ok, same, refused, catalog } = h;
  const site = (p) => import(pathToFileURL(path.join(h.SITE, "js", p)).href);
  const fns = catalog.functions;
  const profileCols = (catalog.tables.profiles && catalog.tables.profiles.cols) || {};
  if (!(fns.estimate_edit_read && fns.save_estimate_item && "can_estimate" in profileCols)) {
    results.push({ section: h.section, name: "20261028000100_estimator is not in DCR Desktop 2 yet: the estimate editor's checks wait for it", ok: true });
    return;
  }
  const edit = await site("repo/estimate-edit.js");
  const estRepo = await site("repo/estimates.js");
  const M = await site("map/estimate-edit.js");
  const { estimateEditor } = await site("map/estimates.js");
  const S = {};
  const meOf = (k) => ({ id: PEOPLE[k].id, role: PEOPLE[k].role, active: true });
  const raw = async (name, args) => { const r = await client.rpc(name, args); if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r.data; };
  const model = async () => edit.loadEditor(S.pid);
  const byName = (m, n) => m.estimates.find((e) => e.name === n);
  const itemOf = (e, n) => e.items.find((i) => i.name === n);

  await check("the RPCs as Portal 2 calls them (argument names), and the switch's column", async () => {
    same(fns.estimate_edit_read.map((f) => f.args.map((a) => a.name)), [["p_project_id"]], "estimate_edit_read(...)");
    same(fns.save_estimate_item.map((f) => f.args.map((a) => a.name)), [["p_item_id", "p_item_version", "p_fields", "p_prices", "p_price_version"]], "save_estimate_item(...)");
    same(fns.reorder_estimate.map((f) => f.args.map((a) => a.name)), [["estimate_id", "estimate_version", "group_order", "moves"]], "reorder_estimate(...)");
    same(fns.move_estimate_items.map((f) => f.args.map((a) => a.name)), [["moves"]], "move_estimate_items(moves)");
    same(fns.add_estimate_item.map((f) => f.args.map((a) => a.name)), [["estimate_id", "fields", "prices"]], "add_estimate_item(...)");
    same(fns.duplicate_estimate.map((f) => f.args.map((a) => a.name)), [["estimate_id", "new_name"]], "duplicate_estimate(...)");
  });

  try {
    await check("set-up (made-up): a project, an approved estimate whose words, terms and notes quote amounts, a sent one, a draft change order; Mia and Max made Estimators", async () => {
      await as("admin");
      const made = await client.rpc("create_project", { fields: { name: "Editor Check Job", address: "9 Sample Ct", city: "Templeton" } });
      ok(!made.error, "create_project: " + JSON.stringify(made.error));
      S.pid = (Array.isArray(made.data) ? made.data[0] : made.data).id;
      await sql("reset role");
      await sql("update public.project_prices set labor_rate = 90 where project_id = $1", [S.pid]);
      const main = await one(`insert into public.estimates (project_id, name, description, status, client_notes, group_order)
        values ($1, 'Main framing', 'Per plan set rev C.', 'approved', 'Includes a $2,500 hardware allowance.', array['Walls', 'Floor']) returning *`, [S.pid]);
      const deck = await one("insert into public.estimates (project_id, name, status) values ($1, 'Deck option', 'sent') returning *", [S.pid]);
      const co = await one("insert into public.estimates (project_id, kind, name, status) values ($1, 'change_order', 'Porch', 'draft') returning *", [S.pid]);
      const item = async (e, f, pr) => {
        const r = await one(`insert into public.estimate_items (estimate_id, group_name, group_code, name, description, labor_guys, labor_days,
            material_description, material_qty, notes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
        [e.id, f.group || null, f.code || null, f.name, f.desc || null, f.guys || null, f.days || null, f.mat || null, f.mqty === undefined ? 1 : f.mqty, f.notes || null]);
        if (pr) await sql("update public.estimate_item_prices set labor_markup_pct = $2, material_unit_price = $3, material_markup_pct = $4 where item_id = $1",
          [r.id, pr.lm || 0, pr.mup || null, pr.mm || 0]);
        return r;
      };
      await item(main, { group: "Floor", code: "06.11.00", name: "Floor joists", guys: 4, days: 3, mat: "3/4 T&G OSB", mqty: 64 }, { lm: 10, mup: 48.75, mm: 15 });
      await item(main, { group: "Walls", code: "06.11.00", name: "Exterior walls", desc: "Client asked about a $1,200 credit.", guys: 5, days: 6,
        mat: "2x6 studs", mqty: 420, notes: "Yard quoted $6.85 a stud." }, { lm: 10, mup: 6.85, mm: 12 });
      await item(deck, { group: "Deck", name: "Deck framing", guys: 2, days: 3, mat: "PT 2x8", mqty: 22 }, { mup: 18.4 });
      await item(deck, { group: "Deck", name: "Stairs", guys: 2, days: 1 }, {});
      await item(co, { group: "Porch", name: "Posts and beam", guys: 3, days: 2 }, {});
      // the switch, as an admin would tick it in Users / Access (D1: managers only; Max keeps prices off)
      await sql("update public.profiles set can_estimate = true where id = any($1::uuid[])", [[PEOPLE.manager.id, PEOPLE.manager2.id]]);
      S.main = main.id; S.deck = deck.id; S.co = co.id;
    });

    await check("who gets the editor: estimateAccess and estimateEditor per person, and estimate_edit_read's own can_edit agrees", async () => {
      const want = { admin: true, manager2: true, manager: true, accountant: false, lead: false, field: false, viewer: false };
      for (const [k, yes] of Object.entries(want)) {
        await as(k);
        const access = await estRepo.estimateAccess(meOf(k));
        same([k, estimateEditor(meOf(k), access)], [k, yes], "the page's gate");
        const m = await model();
        same([k, m.canEdit, m.prices], [k, yes, ["admin", "manager2", "accountant"].includes(k)], "the database's");
        same(m.estimates.map((e) => e.label), ["Estimate #1", "Estimate #2", "Change order #1"], k + ": the list");
      }
      client.as(PEOPLE.agents.id);
      await refused(() => edit.loadEditor(S.pid), "42501", "the agents account");
    });

    await check("an Estimator with prices (Mia): new estimate and change order numbered by the database, an item with prices, row and prices in one save, PT409 per table, approval", async () => {
      await as("manager2");
      const e = await edit.createEstimate(S.pid, "estimate", { name: "Garage", description: "Detached garage" });
      const c = await edit.createEstimate(S.pid, "change_order", { name: "Extra blocking" });
      same([e.number, e.co_number, c.number, c.co_number], [4, null, 5, 2], "the numbers");
      const added = await edit.addItem(e.id, { name: "Garage walls", item_type: "both", labor_guys: 4, labor_days: 2, material_qty: 100, group_name: "Walls" },
        { material_unit_price: 6.5, material_markup_pct: 10 }, { prices: true });
      same([Number(added.prices.labor_rate), Number(added.prices.material_unit_price)], [90, 6.5], "the project's rate, the price given");
      let it = itemOf((await model()).estimates.find((x) => x.id === e.id), "Garage walls");
      same(it.money, { labor: 576000, material: 71500, total: 647500 }, "the database's money in cents");
      const saved = await edit.saveItem(it, { labor_guys: 5 }, { labor_markup_pct: 10 }, { prices: true });
      same([saved.version, saved.prices.version, Number(saved.totals.total)], [it.version + 1, it.prices.version + 1, 8635], "both rows, one call");
      it = itemOf((await model()).estimates.find((x) => x.id === e.id), "Garage walls");
      await as("admin");
      await raw("save_estimate_item", { p_item_id: it.id, p_item_version: it.version, p_fields: { labor_days: 3 } });
      await as("manager2");
      let err = await refused(() => edit.saveItem(it, { labor_guys: 6 }, {}, { prices: true }), "PT409", "a stale row");
      same(edit.conflictInfo(err), { table: "estimate_items", id: it.id, version: it.version + 1 }, "the row named");
      it = itemOf((await model()).estimates.find((x) => x.id === e.id), "Garage walls");
      await as("admin");
      await raw("save_estimate_item", { p_item_id: it.id, p_prices: { material_unit_price: 6.75 }, p_price_version: it.prices.version });
      await as("manager2");
      err = await refused(() => edit.saveItem(it, {}, { material_unit_price: 7 }, { prices: true }), "PT409", "stale prices");
      same(edit.conflictInfo(err).table, "estimate_item_prices", "the price row named");
      const plan = M.conflictPlan(M.flatItem(it), M.flatItem(itemOf((await model()).estimates.find((x) => x.id === e.id), "Garage walls")), { material_unit_price: 7 });
      same(plan.kind, "clash", "the panel would show it");
      const est = (await model()).estimates.find((x) => x.id === e.id);
      const appr = await edit.updateEstimate(est, { status: "approved" }, { prices: true });
      ok(appr.status === "approved" && appr.approved_date, "approved, the day stamped");
    });

    await check("an Estimator with prices: Up / Down, a new group, rename, another estimate, duplicate, archive and restore, delete", async () => {
      await as("manager2");
      let deck = byName(await model(), "Deck option");
      const stairs = itemOf(deck, "Stairs");
      await edit.reorder(deck, null, M.planItemStep(M.slotsOf(deck), stairs.id, -1), { prices: true });
      deck = byName(await model(), "Deck option");
      same(deck.items.map((i) => i.name), ["Stairs", "Deck framing"], "Up");
      await edit.reorder(deck, null, M.planItemDrop(M.slotsOf(deck), stairs.id, { name: "Stairs" }, null), { prices: true });
      deck = byName(await model(), "Deck option");
      const ren = M.planRename(M.slotsOf(deck), deck.group_order, deck.groups[0].gid, "Deck framing");
      await edit.reorder(deck, ren.groupOrder, ren.moves, { prices: true });
      deck = byName(await model(), "Deck option");
      same(deck.groups.map((g) => g.title), ["Deck framing", "Stairs"], "renamed");
      const porch = byName(await model(), "Porch");
      await edit.moveItems(M.planMoveToEstimate(itemOf(deck, "Stairs"), porch), { prices: true });
      ok(itemOf(byName(await model(), "Porch"), "Stairs"), "moved to the change order");
      deck = byName(await model(), "Deck option");
      const copy = await edit.duplicateEstimate(deck);
      same([copy.name, copy.status, copy.items.length], ["Deck option (copy)", "draft", 1], "a draft copy");
      await edit.setArchived(deck, true);
      deck = byName(await model(), "Deck option");
      same(deck.archived, true, "archived");
      await edit.setArchived(deck, false);
      deck = byName(await model(), "Deck option");
      same(deck.archived, false, "taken out of the archive");
      const cp = (await model()).estimates.find((x) => x.id === copy.id);
      await edit.deleteEstimate(cp);
      ok(!(await model()).estimates.some((x) => x.id === copy.id), "deleted");
      await sql("reset role");
      same(Number((await one("select count(*) as n from public.estimate_items where estimate_id = $1 and deleted_at is null", [copy.id])).n), 0, "its items went with it");
    });

    // the empty groups (owner 2026-10-27; migration 20261029000100_estimate_links_groups: estimate_edit_read sends a name the
    // group order lists with no item) - known by the migration's other column, estimates.houzz_url
    const estCols = (catalog.tables.estimates && catalog.tables.estimates.cols) || {};
    if (!("houzz_url" in estCols)) {
      results.push({ section: h.section, name: "20261029000100_estimate_links_groups is not in DCR Desktop 2 yet: the empty-group checks wait for it", ok: true });
    } else {
      await check("empty groups (20261029000100): a new group is a name only - estimate_edit_read sends it empty in its place; Group up keeps it; rename (in capitals only too) and delete; never printed", async () => {
        await as("manager2");
        const made = await edit.createEstimate(S.pid, "estimate", { name: "Empty groups check" });
        S.emptyCheck = made.id;
        await edit.addItem(made.id, { name: "Posts", item_type: "labor", labor_guys: 1, labor_days: 1, group_name: "Porch posts" }, null, { prices: true });
        const est = () => model().then((m) => m.estimates.find((x) => x.id === made.id));
        let e = await est();
        let plan = M.planNewGroup(M.slotsOf(e), "Stair  rail ");
        same(plan.groupOrder, ["Porch posts", "Stair rail"], "the order as shown plus the name");
        await edit.reorder(e, plan.groupOrder, [], { prices: true });
        const head = await raw("estimate_edit_read", { p_project_id: S.pid });
        const mine = head.estimates.find((x) => x.id === made.id);
        same(mine.groups.map((g) => [g.gid, g.name, g.code, g.title, "locked" in g]), [["g1", "Porch posts", "", "Porch posts", false], ["g2", "Stair rail", "", "Stair rail", false]],
          "the database's groups, the empty one in its listed place (no lock key with prices)");
        same(mine.items.map((i) => [i.name, i.gid]), [["Posts", "g1"]], "no item in it");
        e = await est();
        same(e.groups.map((g) => [g.title, g.items.length, g.empty]), [["Porch posts", 1, false], ["Stair rail", 0, true]], "the model");
        await edit.reorder(e, M.planGroupStep(M.slotsOf(e), e.groups[1].gid, -1), [], { prices: true });
        e = await est();
        same(e.groups.map((g) => g.title), ["Stair rail", "Porch posts"], "Group up: the empty group moved, not dropped");
        const ren = M.planRename(M.slotsOf(e), e.group_order, e.groups[0].gid, "Stair rail and posts");
        same(ren.moves, [], "an empty group is renamed in the order alone");
        await edit.reorder(e, ren.groupOrder, [], { prices: true });
        e = await est();
        same(e.groups.map((g) => [g.title, g.empty]), [["Stair rail and posts", true], ["Porch posts", false]], "renamed, still empty");
        // a rename in capitals only is written too (20261029000100's reorder_estimate: the empty group's name lives in the
        // order alone), and back; the same order in another case while the items still spell their group so writes nothing
        for (const name of ["Stair Rail and Posts", "Stair rail and posts"]) {
          const caps = M.planRename(M.slotsOf(e), e.group_order, e.groups[0].gid, name);
          same(caps, { groupOrder: [name, "Porch posts"], moves: [] }, "a case-only rename: the order alone");
          const v0 = e.version;
          await edit.reorder(e, caps.groupOrder, [], { prices: true });
          e = await est();
          same([e.group_order, e.version, e.groups[0].title], [[name, "Porch posts"], v0 + 1, name], "a case-only rename of an empty group is written");
        }
        const v1 = e.version;
        await edit.reorder(e, ["Stair rail and posts", "PORCH POSTS"], [], { prices: true });
        e = await est();
        same([e.group_order, e.version], [["Stair rail and posts", "Porch posts"], v1], "the items' spelling: no new version");
        const printed = await raw("estimate_print", { p_estimate_id: made.id });
        same(printed.groups.map((g) => g.title), ["Porch posts"], "estimate_print never has an empty group");
        // the office's empty group whose name quotes an amount: locked for Max (quantities only)
        await as("admin");
        e = await est();
        await edit.reorder(e, e.groups.map((g) => g.name).concat(["Allowance $300"]), [], { prices: true });
        await as("manager");
        const head2 = await raw("estimate_edit_read", { p_project_id: S.pid });
        ok(!DOLLARS.test(JSON.stringify(head2)), "no typed amount in estimate_edit_read");
        const m2 = M.fromEditRead(head2, {}).estimates.find((x) => x.id === made.id);
        same([m2.groupOrderLocked, m2.groups.map((g) => [g.title, g.empty, g.locked])],
          [true, [["Stair rail and posts", true, false], ["Porch posts", false, false], ["Allowance [amount]", true, true]]], "locked by its own words");
        const del = M.planDeleteGroup(M.slotsOf(m2), m2.group_order, m2.groups[2].gid);
        same(M.wordsRefusal(m2, del, [], { prices: false }), M.LOCKED_HINT, "the page never sends it");
        await refused(() => edit.reorder(m2, del, [], { prices: false }), "42501", "Rule A: an amount name is not dropped from the order");
        // deleted by someone with prices: the order without them
        await as("manager2");
        e = await est();
        for (const title of ["Allowance $300", "Stair rail and posts"]) {
          const g = e.groups.find((x) => x.title === title);
          await edit.reorder(e, M.planDeleteGroup(M.slotsOf(e), e.group_order, g.gid), [], { prices: true });
          e = await est();
        }
        same(e.groups.map((g) => g.title), ["Porch posts"], "both empty groups deleted");
        same(M.planDeleteGroup(M.slotsOf(e), e.group_order, e.groups[0].gid), null, "a group with items is not");
        await edit.deleteEstimate(e);
      });
    }

    await check("the quantities-only Estimator (Max): no answer carries money, a note or the terms; the words come amount-free with their locks", async () => {
      await as("manager");
      const head = await raw("estimate_edit_read", { p_project_id: S.pid });
      same([head.prices, head.can_edit], [false, true], "the head");
      same(moneyIn(head, "estimate_edit_read", [], true), [], "estimate_edit_read");
      ok(!DOLLARS.test(JSON.stringify(head)), "no typed amount in estimate_edit_read");
      const m = M.fromEditRead(head, {});
      const walls = itemOf(byName(m, "Main framing"), "Exterior walls");
      ok(/\[amount\]/.test(walls.description) && walls.locked.includes("description"), "the $1,200 as [amount], locked: " + JSON.stringify(walls));
      same([byName(m, "Main framing").approvedLock, byName(m, "Main framing").addable], [true, false], "the approved lock in the model");
      const deck = byName(m, "Deck option");
      const fr = itemOf(deck, "Deck framing");
      const a = await raw("add_estimate_item", { estimate_id: S.deck, fields: { name: "Rail posts", item_type: "labor", labor_guys: 1, labor_days: 1 }, prices: null });
      const s = await raw("save_estimate_item", { p_item_id: fr.id, p_item_version: fr.version, p_fields: { labor_days: 4 } });
      const d2 = byName(M.fromEditRead(await raw("estimate_edit_read", { p_project_id: S.pid }), {}), "Deck option");
      const ro = await raw("reorder_estimate", { estimate_id: S.deck, estimate_version: null, group_order: null,
        moves: M.planItemStep(M.slotsOf(d2), itemOf(d2, "Rail posts").id, -1) });
      const d3 = byName(M.fromEditRead(await raw("estimate_edit_read", { p_project_id: S.pid }), {}), "Deck option");
      const mv = await raw("move_estimate_items", { moves: M.planMoveToEstimate(itemOf(d3, "Rail posts"), byName(m, "Porch")) });
      for (const [what, ans] of [["add_estimate_item", a], ["save_estimate_item", s], ["reorder_estimate", ro], ["move_estimate_items", mv]]) {
        same(moneyIn(ans, what, [], false), [], what + " carried money, a note or the terms");
        ok(!DOLLARS.test(JSON.stringify(ans)), what + ": a typed amount");
      }
      await sql("reset role");
      same(Number((await one("select labor_rate from public.estimate_item_prices where item_id = $1", [a.id])).labor_rate), 90, "the new item's price row: the project's rate");
    });

    await check("the quantities-only Estimator: every rule of the database refuses what the editor never sends (D5 approval and the approved lock, D6 the words)", async () => {
      await as("admin");
      let deckA = byName(await model(), "Deck option");
      await edit.addItem(S.deck, { name: "Hardware allowance", item_type: "material", group_name: "Allowance $500" }, null, { prices: true });
      deckA = byName(await model(), "Deck option");
      await edit.reorder(deckA, ["Allowance $500"].concat(deckA.groups.map((g) => g.name)), [], { prices: true });
      await as("manager");
      const m = await model();
      const main = byName(m, "Main framing"), deck = byName(m, "Deck option"), porch = byName(m, "Porch");
      const floor = itemOf(main, "Floor joists"), walls = itemOf(main, "Exterior walls"), fr = itemOf(deck, "Deck framing");
      same([deck.groupOrderLocked, deck.groups[0].locked, deck.groups[0].title], [true, true, "Allowance [amount]"], "the office's amount group, locked");
      await refused(() => raw("save_estimate_item", { p_item_id: fr.id, p_item_version: fr.version, p_prices: { labor_rate: 1 }, p_price_version: 1 }), "42501", "a crafted price save");
      await refused(() => raw("add_estimate_item", { estimate_id: S.deck, fields: { name: "x" }, prices: { material_unit_price: 1 } }), "42501", "a crafted price on a new item");
      await refused(() => edit.duplicateEstimate(deck), "42501", "Duplicate");
      await refused(() => edit.updateEstimate(deck, { status: "approved" }, { prices: false }), "42501", "Approved");
      await refused(() => edit.updateEstimate(main, { status: "sent" }, { prices: false }), "42501", "taking an approval back");
      await refused(() => edit.setArchived(main, true), "42501", "archiving an approved one");
      await refused(() => edit.deleteEstimate(main), "42501", "deleting an approved one");
      await refused(() => edit.saveItem(floor, { labor_guys: 9 }, null, { prices: false }), "42501", "a quantity of an approved one");
      await refused(() => edit.saveItem(floor, { item_type: "labor" }, null, { prices: false }), "42501", "its type");
      await refused(() => edit.addItem(S.main, { name: "Extra" }, null, { prices: false }), "42501", "an item into it");
      await refused(() => edit.deleteItem(floor), "42501", "an item out of it");
      await refused(() => edit.moveItems([{ id: fr.id, version: fr.version, estimate_id: S.main, sort: 99 }]), "42501", "a move into it");
      const named = await edit.saveItem(floor, { name: "Floor joists and blocking" }, null, { prices: false });
      same(named.name, "Floor joists and blocking", "its words (no amount) still change");
      await refused(() => edit.saveItem(walls, { description: "new words" }, null, { prices: false }), "42501", "Rule A");
      await refused(() => edit.saveItem(fr, { description: "Includes an [amount] allowance" }, null, { prices: false }), "22023", "Rule B");
      await refused(() => edit.saveItem(fr, { material_description: "PT 2x8, about $18 each" }, null, { prices: false }), "22023", "Rule C");
      await refused(() => edit.createEstimate(S.pid, "estimate", { name: "Deck $400 add" }), "22023", "Rule C on a new estimate");
      await refused(() => edit.addItem(S.deck, { name: "Rail", group_name: "Allowance $300" }, null, { prices: false }), "22023", "Rule C on a new group");
      await refused(() => raw("save_estimate_item", { p_item_id: fr.id, p_item_version: fr.version, p_fields: { notes: "x" } }), "42501", "item notes");
      await refused(() => edit.updateEstimate(deck, { client_notes: "Valid 30 days" }, { prices: true }), "42501", "the terms (a crafted call)");
      await refused(() => edit.reorder(deck, deck.groups.slice(1).map((g) => g.name), [], { prices: false }), "42501", "a group order dropping an amount name");
      await refused(() => edit.reorder(porch, ["Porch", "Deck [amount]"], [], { prices: false }), "22023", "a group order adding the hidden copy");
      const into = M.planItemDrop(M.slotsOf(deck), fr.id, { gid: deck.groups[0].gid }, null);
      same(M.wordsRefusal(deck, null, into, { prices: false }), M.LOCKED_HINT, "the page never sends a move into a locked group ...");
      await refused(() => edit.reorder(deck, null, into, { prices: false }), "22023", "... the database refuses it");
      // t25: the type switch clears the prices it hides; nobody here sees them
      const fresh = itemOf(byName(await model(), "Deck option"), "Deck framing");
      await edit.saveItem(fresh, { item_type: "labor", material_description: null, material_qty: 1 }, null, { prices: false });
      await sql("reset role");
      const pr = await one("select material_unit_price, material_markup_pct, labor_rate from public.estimate_item_prices where item_id = $1", [fr.id]);
      same([Number(pr.material_unit_price), Number(pr.material_markup_pct), Number(pr.labor_rate)], [0, 0, 90], "t25: material prices cleared, the rate kept");
    });

    await check("an accountant, a lead, field, view-only - and Max once his switch is off: no editor, every write refused", async () => {
      await sql("reset role");
      await sql("update public.profiles set can_estimate = false where id = $1", [PEOPLE.manager.id]);
      for (const k of ["accountant", "lead", "field", "viewer", "manager"]) {
        await as(k);
        same([k, estimateEditor(meOf(k), await estRepo.estimateAccess(meOf(k)))], [k, false], "the page's gate");
        const m = await model();
        same([k, m.canEdit], [k, false], "estimate_edit_read");
        const deck = byName(m, "Deck option");
        const it = itemOf(deck, "Deck framing");
        await refused(() => edit.createEstimate(S.pid, "estimate", { name: "x" }), "42501", k + " create");
        await refused(() => edit.updateEstimate(deck, { name: "x" }, { prices: m.prices }), "42501", k + " rename");
        await refused(() => edit.saveItem(it, { labor_guys: 3 }, null, { prices: m.prices }), "42501", k + " save");
        await refused(() => edit.addItem(S.deck, { name: "x" }, null, { prices: m.prices }), "42501", k + " add");
        await refused(() => edit.deleteItem(it), "42501", k + " delete an item");
        await refused(() => edit.reorder(deck, null, [{ id: it.id, version: it.version, sort: 9 }], { prices: m.prices }), "42501", k + " reorder");
        await refused(() => edit.moveItems([{ id: it.id, version: it.version, sort: 9 }], { prices: m.prices }), "42501", k + " move");
      }
    });
  } finally {
    // the switches as they were (the other sections' made-up managers are not Estimators)
    await sql("reset role");
    await sql("update public.profiles set can_estimate = false where id = any($1::uuid[])", [[PEOPLE.manager.id, PEOPLE.manager2.id]]);
  }
}
