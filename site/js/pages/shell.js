/* What every project page does first, in one place (PROJECT-PAGES):

   * boot(active, {roles})  loads the shared helpers (common2.js, which sets window.DCR2), signs the
                            person in or sends them to index.html?next=… (DCR2.requireAuth), draws the
                            Portal 2 top bar (DCR2.topbar) and returns me() — {id, name, email, role,
                            color, can_see_prices, can_see_financials, ...};
   * can(me, area)          the role matrix of app.can_edit (Desktop 2 foundation migration) for
                            HIDING controls only — the database decides every write (BLUEPRINT 2.1);
                            the areas a switch decides (RULES: estimates = an admin, or a manager with
                            the Estimator switch; money = an admin, or a manager or accountant with
                            financials; onedrive_upload = app.can_upload_onedrive()) are hints too;
   * maskFor(me)            amounts typed into notes read "(amount hidden)" for people without the
                            prices switch (Q28: on screen only); identity for the others;
   * esc / toast / confirm / errorText / modal: DCR2's, with a plain fallback so a page never
                            breaks over a missing helper.

   Browser-only module. */

import "../common2.js";
import { maskAmounts } from "../money-mask.js";

const W = typeof window !== "undefined" ? window : {};

export function D() { return W.DCR2 || {}; }

export function esc(v) {
  const h = D().h;
  if (typeof h === "function") return h(v);
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

export function el(id) { return document.getElementById(id); }

export function toast(text, kind) {
  const t = D().toast;
  if (typeof t === "function") { try { return t(text, kind); } catch (e) { /* fall through */ } }
  let box = document.getElementById("p2Toast");
  if (!box) {
    box = document.createElement("div");
    box.id = "p2Toast";
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;" +
      "padding:10px 16px;border-radius:10px;background:#1b2733;color:#fff;font-size:14px;box-shadow:0 6px 24px rgba(0,0,0,.3);max-width:90vw";
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.style.background = kind === "error" ? "#b3402f" : kind === "ok" ? "#1f7a4d" : "#1b2733";
  box.hidden = false;
  clearTimeout(box._t);
  box._t = setTimeout(function () { box.hidden = true; }, 4200);
}

export async function confirmBox(message, opts) {
  const c = D().confirm;
  if (typeof c === "function") return !!(await c(message, opts || {}));
  return W.confirm ? W.confirm(message) : false;
}

export function errorText(err) {
  const f = D().errorText;
  if (typeof f === "function") {
    try { const t = f(err); if (t) return typeof t === "string" ? t : (t.message || String(t)); } catch (e) { /* plain */ }
  }
  if (!err) return "Something went wrong.";
  if (err.code === "42501") return "You don't have permission.";
  if (err.code === "PT409" || err.code === "23505") return "Changed by someone else — showing the latest.";
  if (err.code === "PT404") return "Not found — it may have been deleted.";
  if (err.message && /fetch|network|Failed to/i.test(err.message)) return "No connection — try again in a moment.";
  return err.message || "Something went wrong.";
}

const EDIT = {
  projects: ["admin", "manager"],
  activity: ["admin", "manager", "accountant", "lead"],
  journal: ["admin", "manager", "lead", "field"],
  all_journal: ["admin", "manager", "lead"],
  files: ["admin", "manager", "accountant", "lead", "field"],
  all_files: ["admin", "manager"],
  location: ["admin", "manager", "accountant", "lead", "field"],     // set_project_location: any active non-viewer
  contacts: ["admin", "manager", "accountant"],                      // app.can_edit('contacts'): a picture, a phone, an e-mail
};

/* The areas a person's switch decides (migration 20261028000100_estimator.sql, M5b): they only hide buttons, the
   database decides (app.can_edit('estimates'), app.can_edit('money'), app.can_upload_onedrive()). */
const RULES = {
  estimates: function (me) { return me.role === "admin" || (me.role === "manager" && !!me.can_estimate); },
  money: function (me) { return me.role === "admin" || ((me.role === "manager" || me.role === "accountant") && !!me.can_see_financials); },
  onedrive_upload: function (me) {
    return me.role === "admin" || (["manager", "accountant", "lead", "field"].indexOf(String(me.role || "")) !== -1 && !!me.can_upload_onedrive);
  },
};

export function can(me, area) {
  if (!me || me.active === false || me.role === "agents") return false;
  if (Object.prototype.hasOwnProperty.call(RULES, area)) return RULES[area](me);
  const list = EDIT[area];
  return !!list && list.indexOf(String(me.role || "")) !== -1;
}

export function seesPrices(me) {
  return !!me && (me.role === "admin" || !!me.can_see_prices);
}

export function maskFor(me) {
  if (seesPrices(me)) return function (t) { return t == null ? "" : String(t); };
  return function (t) { return maskAmounts(t == null ? "" : String(t)); };   // money-mask.js: Desktop 2's rule
}

/** Sign in (or bounce to index.html), draw the top bar; -> me(). */
export async function boot(active, opts) {
  const DCR2 = D();
  let me = null;
  if (typeof DCR2.requireAuth === "function") me = await DCR2.requireAuth(opts || {});
  if (!me || !me.role) {
    try { const sbm = await import("../sb.js"); me = await sbm.me(); } catch (e) { /* requireAuth redirected */ }
  }
  if (!me) throw new Error("not signed in");
  if (opts && opts.roles && opts.roles.indexOf(me.role) === -1) {
    location.replace("dashboard.html");
    throw new Error("not for this role");
  }
  try {
    if (active !== null && typeof DCR2.topbar === "function") {          // null: a print page, no bar
      const bar = DCR2.topbar(active);
      if (bar && bar.nodeType === 1 && !bar.isConnected) document.body.insertBefore(bar, document.body.firstChild);
    }
  } catch (e) { /* a page without its bar still works */ }
  return me;
}

/** The page's ?query values. */
export function qs(name) {
  try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
}

export function setQs(name, value) {
  try {
    const u = new URL(location.href);
    if (value == null || value === "") u.searchParams.delete(name); else u.searchParams.set(name, value);
    history.replaceState(null, "", u);
  } catch (e) { /* not important */ }
}

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get: function (k, dflt) { try { const v = localStorage.getItem(k); return v == null ? dflt : v; } catch (e) { return dflt; } },
  set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) { /* page-only */ } },
};
