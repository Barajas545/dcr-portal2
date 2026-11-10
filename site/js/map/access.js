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

/* ── the Photo team (the photographer screen program, P3; DCR Desktop 2 migration 20261110000100_photo_schedule,
   docs/DATABASE.md §39.1, the contract docs/PHOTO-SCHEDULE.md §3; the owner's decision 3 of 2026-11-09) ──────────────

   The same list as DCR Desktop 2 → Users → Photo team (dcrdesk/ui/pages/users_photo.py, backend/repos/photo_team.py):
   each person's Photographer tick (moves shoots on the shoot schedule), Marketing tick (reads it; the shoot files come
   later), exactly ONE default photographer whenever one is listed, and each marketing member's Google e-mail (checked
   here, kept in lower case). Every save is ONE set_photo_team of that person's whole row at the version shown (repo/
   photo.js setTeam - never a write of the table); a "changed" refusal reads the list again and says so. Admins can
   always act and are never listed automatically. The rules below are hints the database enforces anyway:
   * the first photographer becomes the default (ticked and locked);
   * the default stays the default until another photographer is made it ("Default photographer" moves it);
   * the default's Photographer tick cannot go while other photographers remain (pick_default_first);
   * the Google e-mail is for marketing only (turning Marketing off forgets it at the save);
   * both ticks off takes the person off the team. */

export const PHOTO_TITLE = "Photo team";
export const PHOTO_SUB = "Who moves shoots on the shoot schedule, and who gets the shoot files for marketing";
export const PHOTO_ADMINS_NOTE = "Admins can always move shoots and read the shoot schedule; they are on this list only when you tick them. " +
  "The same list as DCR Desktop 2 → Users → Photo team. The database checks every change.";
export const PHOTOGRAPHER_TIP = "Moves shoots and job dates on the shoot schedule. A move applies at once and stays in the shoot's history; " +
  "moving a Firm job date becomes a suggestion for the office.";
export const DEFAULT_TIP = "The plans with no photographer of their own go to the default photographer. There is exactly one.";
export const MARKETING_TIP = "Reads the shoot schedule. The shoot files and the Ready-for-marketing list come in a later update.";
export const EMAIL_TIP = "The Google account they open the shoot files with (shared in a later update). Only marketing needs one.";
export const FIRST_DEFAULT = "The first photographer is the default photographer.";
export const KEEP_DEFAULT = "This is the default photographer. To change it, make another photographer the default.";
export const PICK_DEFAULT_FIRST = "Make another photographer the default first - then take this one off.";
export const BOTH_OFF = "Both ticks off takes them off the photo team.";
export const PHOTO_CHANGED = "Someone changed the photo team meanwhile, so nothing was saved. The list is read again - look and try again.";
export const PHOTO_NOT_READY = "Not in the database yet";
export const PHOTO_NOT_READY_TEXT = "The photo team arrives with the database update 20261110000100 (DCR Desktop 2.27).";
export const PHOTO_BAD_EMAIL = "That doesn't look like an e-mail address (name@gmail.com, or the company's Google address).";
export const PHOTO_NO_TICK = "Tick Photographer, Marketing or both.";
export const PHOTO_EMAIL_MAX = 254;

// white space of every kind (app.scrub_money's class): trimmed at the edges, refused inside
const P_WS = "\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
const P_EDGE = new RegExp("^[" + P_WS + "]+|[" + P_WS + "]+$", "g");
const P_INSIDE = new RegExp("[" + P_WS + "\\u0001-\\u001f\\u007f]");
const P_GOOGLE = /^[^@]+@[^@]+\.[^@]+$/;

/** The Google e-mail as the database keeps it: trimmed of white space of every kind, lower case; "" = none. */
export function photoEmail(text) {
  return String(text === null || text === undefined ? "" : text).replace(P_EDGE, "").toLowerCase();
}

/** Why `text` is not a Google e-mail the photo team takes (Desktop 2's rule: one @, a dot in the domain, no white space
    or control character inside), or null (empty is fine: none yet). */
export function photoEmailProblem(text) {
  const e = photoEmail(text);
  if (!e) return null;
  if (e.length > PHOTO_EMAIL_MAX || !P_GOOGLE.test(e) || P_INSIDE.test(e)) return PHOTO_BAD_EMAIL;
  return null;
}

const pid = (v) => (v === null || v === undefined ? "" : String(v));

/** The team row's ticks as the card edits them: {photographer, marketing, isDefault, googleEmail}. */
export function photoStateOf(row) {
  const r = row || {};
  return { photographer: r.photographer === true, marketing: r.marketing === true,
    isDefault: r.photographer === true && (r.defaultPhotographer === true || r.default_photographer === true),
    googleEmail: String(r.googleEmail || r.google_email || "") };
}

/** The default photographer's row of the saved team, or null. */
export function photoDefaultOf(team) {
  return (team || []).find((r) => r && r.photographer && (r.defaultPhotographer || r.default_photographer)) || null;
}

/** Every person the card lists: each active sign-in (never the DCR Agents 2 account) and anyone on the team (a turned-off
    member too, so they can be taken off), with their team row. The default photographer first, then the photographers,
    then marketing, then everyone else; by name. people: profiles rows {id, full_name, role, active}; team: repo/photo.js
    team() rows (toTeamMember). -> [{id, name, role, active, row}] */
export function photoPeople(people, team) {
  const byId = {};
  for (const r of team || []) if (r && r.profileId) byId[pid(r.profileId)] = r;
  const seen = new Set();
  const out = [];
  for (const p of people || []) {
    if (!p || !p.id || p.role === "agents") continue;
    const row = byId[pid(p.id)] || null;
    if (p.active === false && !row) continue;
    seen.add(pid(p.id));
    out.push({ id: pid(p.id), name: String(p.full_name || p.name || "").trim() || "(no name)", role: p.role || "", active: p.active !== false, row });
  }
  for (const r of team || []) {
    if (!r || !r.profileId || seen.has(pid(r.profileId))) continue;
    out.push({ id: pid(r.profileId), name: r.name || "Someone no longer listed", role: r.role || "", active: r.active !== false, row: r });
  }
  const rank = (x) => (x.row && x.row.photographer && x.row.defaultPhotographer ? 0 : x.row && x.row.photographer ? 1 : x.row && x.row.marketing ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.id < b.id ? -1 : 1));
}

/** What the card draws for one person: {photographer: {on, disabled, note}, marketing: {on, disabled}, def: {on, disabled,
    note}, email: {disabled, value, note}, offNote, dirty}. `edit`: what is ticked on screen (photoStateOf of the row until
    a box is changed); `team`: the saved team; `names`: {profileId: name} for "Now: ...". */
export function photoGate(person, edit, team, names) {
  const x = person || {};
  const e = edit || photoStateOf(x.row);
  const saved = photoStateOf(x.row);
  const others = (team || []).filter((r) => r && r.photographer && pid(r.profileId) !== x.id);
  const isDefaultNow = !!(x.row && saved.isDefault);
  const out = { photographer: { on: e.photographer, disabled: false, note: "" }, marketing: { on: e.marketing, disabled: false },
    def: { on: e.isDefault, disabled: false, note: "" }, email: { disabled: !e.marketing, value: e.googleEmail, note: "" }, offNote: "",
    dirty: photoChanged(x.row, e) };
  if (!x.active && !x.row) {
    out.photographer.disabled = out.marketing.disabled = out.def.disabled = out.email.disabled = true;
    return out;
  }
  if (!x.active) {
    out.photographer.disabled = !e.photographer;     // a turned-off person may stay or be taken off, never be added to
    out.marketing.disabled = !e.marketing;
  }
  if (isDefaultNow && others.length) {
    out.photographer.disabled = true;
    out.photographer.note = PICK_DEFAULT_FIRST;
  }
  if (!e.photographer) {
    out.def = { on: false, disabled: true, note: "" };
  } else if (!others.length) {
    out.def = { on: true, disabled: true, note: FIRST_DEFAULT };
  } else if (isDefaultNow) {
    out.def = { on: true, disabled: true, note: KEEP_DEFAULT };
  } else {
    const now = photoDefaultOf(team);
    const who = now ? (names && names[pid(now.profileId)]) || now.name || "" : "";
    out.def = { on: !!e.isDefault, disabled: !x.active, note: who ? "Now: " + who + " - ticking it moves the default here." : "" };
  }
  if (e.marketing) {
    const problem = photoEmailProblem(e.googleEmail);
    out.email.note = problem || (photoEmail(e.googleEmail) ? "" : "No Google e-mail yet");
  }
  if (x.row && !e.photographer && !e.marketing) out.offNote = BOTH_OFF;
  return out;
}

/** A tick on screen -> the next edit: Photographer off takes the default off; the first photographer is the default.
    ctx: {id (the person), team (the saved team)}. */
export function photoTick(edit, key, value, ctx) {
  const next = Object.assign({}, edit || {});
  if (key === "googleEmail") next.googleEmail = String(value === null || value === undefined ? "" : value);
  else next[key] = !!value;
  if (!next.photographer) next.isDefault = false;
  const others = ((ctx && ctx.team) || []).filter((r) => r && r.photographer && pid(r.profileId) !== pid(ctx && ctx.id));
  if (next.photographer && !others.length) next.isDefault = true;
  return next;
}

/** Whether the edit differs from the saved row (the e-mail only while marketing). */
export function photoChanged(row, edit) {
  const a = photoStateOf(row);
  const b = edit || a;
  const mail = (s) => (s.marketing ? photoEmail(s.googleEmail) : "");
  if (!row) return !!(b.photographer || b.marketing);
  return a.photographer !== !!b.photographer || a.marketing !== !!b.marketing || a.isDefault !== !!(b.photographer && b.isDefault) || mail(a) !== mail(b);
}

/** What one save sends: {next: {photographer, marketing, isDefault, googleEmail}, version, removing, problem}. A problem
    (a sentence) means nothing is sent. */
export function photoPayload(person, edit, team) {
  const x = person || {};
  const e = edit || photoStateOf(x.row);
  const next = { photographer: !!e.photographer, marketing: !!e.marketing, isDefault: !!(e.photographer && e.isDefault),
    googleEmail: e.marketing ? photoEmail(e.googleEmail) || null : null };
  const version = x.row && x.row.version !== undefined && x.row.version !== null ? Number(x.row.version) : null;
  const others = (team || []).filter((r) => r && r.photographer && pid(r.profileId) !== x.id);
  let problem = null;
  if (!x.row && !next.photographer && !next.marketing) problem = PHOTO_NO_TICK;
  else if (x.row && photoStateOf(x.row).isDefault && !next.photographer && others.length) problem = PICK_DEFAULT_FIRST;
  else if (next.marketing && photoEmailProblem(e.googleEmail)) problem = photoEmailProblem(e.googleEmail);
  return { next, version: x.row ? version : null, removing: !!x.row && !next.photographer && !next.marketing, problem };
}

/** The card's subtitle: "1 photographer · 1 on marketing · default photographer: Jordan Field". rows: photoPeople. */
export function photoSummary(rows) {
  const list = (rows || []).filter((x) => x.row);
  const ph = list.filter((x) => x.row.photographer).length;
  const mk = list.filter((x) => x.row.marketing).length;
  const def = list.find((x) => x.row.photographer && x.row.defaultPhotographer);
  const parts = [ph + " photographer" + (ph === 1 ? "" : "s"), mk + " on marketing"];
  if (def) parts.push("default photographer: " + def.name);
  return parts.join(" · ");
}

/** set_photo_team's refusal in words (repo/photo.js PhotoError: reason = the database's short code). */
export function photoSaveProblem(err) {
  const e = err || {};
  const r = e.reason || "";
  if (r === "changed" || e.code === "PT409") return PHOTO_CHANGED;
  if (e.missing || r === "not_ready") return PHOTO_NOT_READY + ". " + PHOTO_NOT_READY_TEXT;
  if (r === "offline" || e.retryable) return "No connection - nothing was saved. Try again when the connection is back.";
  const words = {
    forbidden: "Only an admin can change the photo team.", agents: "The DCR Agents 2 account is not a person on the photo team.",
    inactive: "A turned-off person cannot be added to the photo team.", no_person: "There is no such person.", bad_email: PHOTO_BAD_EMAIL,
    default_needs_photographer: "The default photographer must be a photographer.", pick_default_first: PICK_DEFAULT_FIRST,
    bad_args: PHOTO_NO_TICK,
  };
  return words[r] || String(e.message || "") || "That change was not saved.";
}
