/* The Access tab's switches (admin.html, an admin only; owner decisions 2026-10-24 D1, D2; migration
   20261028000100_estimator.sql). What each person may be given here, and what a tick changes:

   * Sees prices (can_see_prices)            every role but the agents account;
   * Estimator (can_estimate)                managers only (an admin always has it): edits project estimates and
                                             change orders (app.can_edit('estimates')); ticking it ticks "Sees
                                             prices" too, which the admin may untick again for a quantities-only
                                             estimator;
   * Can upload to OneDrive (can_upload_onedrive)
                                             every role but view-only (an admin always has it): adds files to the
                                             project's OneDrive folder from Portal 2 (the web broker only — DCR
                                             Desktop 2 writes through each PC's OneDrive sync and does not ask);
   * Sees financials, Approves payments, Sales estimates
                                             shown, never changed here: DCR Desktop 2 → Users.
   An admin holds every switch (shown ticked, "always"). The database decides all of it (admin_set_profile, the
   profiles checks: 23514 for a role a switch is not for); this module only draws and words it.

   Pure module: no DOM, no network (node tests import it). */

export const SWITCHES = Object.freeze([
  { key: "can_see_prices", label: "Sees prices", edit: true },
  { key: "can_estimate", label: "Estimator", edit: true, newer: true },
  { key: "can_upload_onedrive", label: "Can upload to OneDrive", edit: true, newer: true },
  { key: "can_see_financials", label: "Sees financials", edit: false },
  { key: "can_approve_payments", label: "Approves payments", edit: false },
  { key: "can_sales_estimates", label: "Sales estimates", edit: false },
]);
export const EDITABLE = Object.freeze(SWITCHES.filter((s) => s.edit).map((s) => s.key));

export const HINT_PRICES = "Prices ticked too; untick them for a quantities-only estimator.";
export const IN_DESKTOP = "Changed in DCR Desktop 2 → Users";
export const NOT_YET = "Arrives with the database update (20261028000100)";

const ESTIMATOR_ROLES = ["manager"];
const ONEDRIVE_ROLES = ["manager", "accountant", "lead", "field"];

/** Is this switch one the role can hold (an admin holds them all)? */
export function allowed(role, key) {
  if (role === "agents") return false;
  if (role === "admin") return true;
  if (key === "can_estimate") return ESTIMATOR_ROLES.indexOf(role) !== -1;
  if (key === "can_upload_onedrive") return ONEDRIVE_ROLES.indexOf(role) !== -1;
  return true;
}

/** The switch values of one profiles row (an admin's: all on). */
export function stateOf(acc) {
  const a = acc || {};
  const admin = a.role === "admin";
  const out = {};
  SWITCHES.forEach((s) => { out[s.key] = admin || a[s.key] === true; });
  return out;
}

/** One person's switches to draw: [{key, label, on, disabled, note}]. A switch the role cannot hold is left out
    (Estimator for anyone but a manager or an admin, OneDrive upload for view-only); `ready` false: the database has
    no Estimator / OneDrive columns yet. `state` (optional): what is ticked on screen now. */
export function offers(acc, ready, state) {
  const a = acc || {};
  const admin = a.role === "admin";
  const now = state || stateOf(a);
  return SWITCHES.filter((s) => allowed(a.role, s.key)).map((s) => {
    if (admin) return { key: s.key, label: s.label, on: true, disabled: true, note: "always (admin)" };
    if (s.newer && ready === false) return { key: s.key, label: s.label, on: false, disabled: true, note: NOT_YET };
    if (!s.edit) return { key: s.key, label: s.label, on: !!now[s.key], disabled: true, note: IN_DESKTOP };
    return { key: s.key, label: s.label, on: !!now[s.key], disabled: false, note: "" };
  });
}

/** A tick on screen: {state, hint}. Turning Estimator on while prices are off turns prices on too and says so;
    unticking prices afterwards is the admin's choice and stays. */
export function tick(state, key, on) {
  const next = Object.assign({}, state || {});
  let hint = "";
  next[key] = !!on;
  if (key === "can_estimate" && on && !next.can_see_prices) {
    next.can_see_prices = true;
    hint = HINT_PRICES;
  }
  return { state: next, hint };
}

/** Only the editable switches that differ from the row: {key: boolean}. */
export function diff(acc, state) {
  const before = stateOf(acc);
  const out = {};
  if (!acc || acc.role === "admin" || acc.role === "agents") return out;
  EDITABLE.forEach((k) => {
    if (state && Object.prototype.hasOwnProperty.call(state, k) && !!state[k] !== !!before[k] && allowed(acc.role, k)) out[k] = !!state[k];
  });
  return out;
}

/** The database's refusal of a save, in words (null: use the page's usual error text). */
export function saveProblem(err) {
  const e = err || {};
  const m = String(e.message || "") + " " + String(e.details || "");
  if (e.code === "PT409" || e.status === 409) return "Someone changed this person meanwhile: showing the latest.";
  if (e.code === "23514") {
    if (/estimat/i.test(m)) return "Estimator is for managers only.";
    if (/onedrive|upload|writer/i.test(m)) return "View-only accounts can't upload.";
    return "That switch is not for this person's role.";
  }
  if (e.code === "22023" && /unknown switch/i.test(m)) return "The database does not have this switch yet (update 20261028000100).";
  if (e.code === "PT404") return "This person was not found — they may have been removed.";
  return null;
}
