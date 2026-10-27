/* Shared helpers for every Portal 2 page: window.DCR2.

   Ported from the old portal's common.js (same names where they existed, same look and habits),
   with the data layer swapped for Supabase (sb.js). What changed and why:
   - requireAuth reads the Supabase session and the caller's profiles row; a missing / inactive /
     agents profile is signed out; a temporary password goes to change-password.html first;
     network errors NEVER sign anyone out (the offline overlay holds the page instead);
   - DCR2.live keeps the autosave contract (one write in flight per record, 800 ms debounce,
     retries on network / 5xx / 408 / 429) and adds versions: every write carries the version it
     read; an empty answer or PT409 re-reads the record, merges when someone else changed other
     fields and says "Changed by someone else" when they changed the same one;
   - errors are mapped like DCR Desktop 2's client (BLUEPRINT 2.2.3);
   - dates are the company day, America/Los_Angeles; a local midnight is never sent anywhere;
   - browser-side names are Portal 2's own (Appendix C): dcr2_theme, dcr-portal2-single-instance …
   - the guided-assist poll and the Plans Library offline button are not carried (Q21, Q20).

   No inline script or handler anywhere: the pages' security policy refuses them. */

import { sb, me, session, signOut, cachedMe, hasStoredSession, isNetworkError, onAuth, storedUserId, forgetSavedPlans } from "./sb.js";
import { maskAmounts, fmtMoney, DASH } from "./money-mask.js";
import { onPresence } from "./live.js";

const HAS_DOM = typeof document !== "undefined";
const cfg = (globalThis.DCR2_CONFIG || {});

export const companyInfo = Object.assign(
  { name: "DCR", legalName: "", logo: "icons/logo.jpg", address: "", phone: "", fax: "", email: "", website: "", license: "" },
  cfg.COMPANY || {}
);
export const company = companyInfo.name || cfg.COMPANY_NAME || "DCR";

/* ── small DOM helpers ─────────────────────────────────────────────────── */

/** Escape untrusted text before it goes into HTML. */
export function h(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** el("button", {class: "btn", type: "button", onclick: fn, dataset: {id: 4}}, "Save", childNode, …)
    Handlers are attached with addEventListener (no inline handler ever reaches the page). */
export function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class" || k === "className") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;             // callers escape with h()
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in n && typeof v !== "string" && k !== "list") n[k] = v;
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else n.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return n;
}

export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/* ── company time (America/Los_Angeles) ────────────────────────────────── */

export const TZ = "America/Los_Angeles";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const _parts = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  return new Date(String(v));
}

function wall(date) {
  const o = {};
  for (const p of _parts.formatToParts(date)) if (p.type !== "literal") o[p.type] = Number(p.value);
  if (o.hour === 24) o.hour = 0;
  return o;
}

const pad2 = (n) => String(n).padStart(2, "0");

/** The company day ("YYYY-MM-DD") of a moment; a "YYYY-MM-DD" stays as it is. */
export function companyDay(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string" && DAY_RE.test(v)) return v;
  const d = toDate(v);
  if (isNaN(d.getTime())) return "";
  const w = wall(d);
  return w.year + "-" + pad2(w.month) + "-" + pad2(w.day);
}

/** Today in the company's time zone, as "YYYY-MM-DD" (the database's app.today()). */
export function companyToday(now) {
  return companyDay(now || new Date());
}

function dayUtc(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function utcDay(date) {
  return date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" + pad2(date.getUTCDate());
}

export function addDays(day, n) {
  const d = dayUtc(companyDay(day));
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return utcDay(d);
}

/** 0 = Sunday … 6 = Saturday, of a company day. */
export function weekday(day) {
  return dayUtc(companyDay(day)).getUTCDay();
}

/** The Saturday that starts the company week (Saturday to Friday) holding this day. */
export function saturdayOf(v) {
  const day = companyDay(v || new Date());
  const wd = weekday(day);
  return addDays(day, -(wd === 6 ? 0 : wd + 1));
}

/** The company week of a day: Saturday, Friday and its number (week #01 holds January 1, so the
    week across New Year belongs to the year January 1 falls in). */
export function weekOf(v) {
  const saturday = saturdayOf(v);
  let year = Number(saturday.slice(0, 4)) + 1;
  let anchor = saturdayOf(year + "-01-01");
  if (saturday < anchor) {
    year -= 1;
    anchor = saturdayOf(year + "-01-01");
  }
  const week = Math.round((dayUtc(saturday) - dayUtc(anchor)) / 604800000) + 1;
  return { saturday, friday: addDays(saturday, 6), year, week, label: year + "-Week #" + pad2(week) };
}

/** The UTC moment (ISO) when the company's wall clock reads `day` `time`. */
export function pacificToUtc(day, time) {
  const [y, m, d] = companyDay(day).split("-").map(Number);
  const [H = 0, M = 0, S = 0] = String(time || "00:00:00").split(":").map(Number);
  const target = Date.UTC(y, m - 1, d, H, M, S);
  let guess = target + 8 * 3600000;
  for (let i = 0; i < 3; i++) {
    const w = wall(new Date(guess));
    const seen = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    if (seen === target) break;
    guess += target - seen;
  }
  return new Date(guess).toISOString();
}

/** Log History windows, computed in company time: {from, to} as UTC ISO (to is exclusive).
    today, morning, afternoon, yesterday, week (Saturday to now), lastweek, month. */
export function logWindow(name, now) {
  const today = companyToday(now);
  const tomorrow = addDays(today, 1);
  const at = (day, t) => pacificToUtc(day, t);
  switch (name) {
    case "morning": return { from: at(today), to: at(today, "12:00:00") };
    case "afternoon": return { from: at(today, "12:00:00"), to: at(tomorrow) };
    case "yesterday": return { from: at(addDays(today, -1)), to: at(today) };
    case "week": return { from: at(saturdayOf(today)), to: at(tomorrow) };
    case "lastweek": { const s = saturdayOf(today); return { from: at(addDays(s, -7)), to: at(s) }; }
    case "month": return { from: at(today.slice(0, 8) + "01"), to: at(tomorrow) };
    case "today":
    default: return { from: at(today), to: at(tomorrow) };
  }
}

const _fmt = {};
function fmtWith(key, opts) {
  return _fmt[key] || (_fmt[key] = new Intl.DateTimeFormat("en-US", opts));
}

/** "Oct 19, 2026" — a "YYYY-MM-DD" is a calendar day (no time zone shift); a moment is shown as
    its company day. opts: {weekday: true} "Mon, Oct 19, 2026"; {short: true} "10/19/2026";
    {noYear: true} "Oct 19". */
export function fmtDate(v, opts) {
  if (v === null || v === undefined || v === "") return "";
  const o = opts || {};
  const isDay = typeof v === "string" && DAY_RE.test(v);
  const d = isDay ? dayUtc(v) : toDate(v);
  if (isNaN(d.getTime())) return "";
  const zone = isDay ? "UTC" : TZ;
  const spec = o.short
    ? { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }
    : Object.assign({ timeZone: zone, month: "short", day: "numeric" },
      o.noYear ? {} : { year: "numeric" }, o.weekday ? { weekday: "short" } : {});
  return fmtWith(JSON.stringify(spec), spec).format(d);
}

/** "2:30 PM" in company time. */
export function fmtTime(v) {
  if (v === null || v === undefined || v === "") return "";
  const d = toDate(v);
  if (isNaN(d.getTime())) return "";
  return fmtWith("time", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);
}

/** "Oct 19, 2026, 2:30 PM" in company time. */
export function fmtDateTime(v, opts) {
  if (v === null || v === undefined || v === "") return "";
  const d = toDate(v);
  if (isNaN(d.getTime())) return "";
  return fmtDate(d, opts) + ", " + fmtTime(d);
}

/** "just now", "5 min ago", "3 h ago", "Yesterday 2:30 PM", else the date. */
export function ago(v, now) {
  const d = toDate(v);
  if (isNaN(d.getTime())) return "";
  const n = now ? toDate(now) : new Date();
  const mins = Math.round((n - d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min ago";
  if (companyDay(d) === companyDay(n)) return Math.round(mins / 60) + " h ago";
  if (companyDay(d) === addDays(companyDay(n), -1)) return "Yesterday " + fmtTime(d);
  return fmtDate(d, { noYear: companyDay(d).slice(0, 4) === companyDay(n).slice(0, 4) });
}

/* ── money and amounts in text ─────────────────────────────────────────── */

export function canSeePrices(p) {
  const who = p || DCR2.profile;
  return !!(who && (who.role === "admin" || who.can_see_prices));
}

/** A price for the screen: "—" when it is hidden (no prices switch, or the embed came back null),
    otherwise "$1,234.56". opts.prices overrides the switch (e.g. a page that already knows). */
export function money(v, opts) {
  const allowed = opts && "prices" in opts ? !!opts.prices : canSeePrices();
  if (!allowed || v === null || v === undefined || v === "") return DASH;
  return fmtMoney(v) || DASH;
}

/** Free text as this person may see it: amounts masked without the prices switch (display only). */
export function shownText(text, p) {
  return canSeePrices(p) ? String(text ?? "") : maskAmounts(text);
}

/* ── errors (BLUEPRINT 2.2.3; DCR Desktop 2's backend/errors.py) ────────── */

const AUTH_SENTENCES = {
  invalid_credentials: "Wrong e-mail address or password.",
  email_not_confirmed: "This e-mail address has not been confirmed yet.",
  user_banned: "This account has been turned off. Ask an admin.",
  user_not_found: "This account does not exist any more.",
  session_not_found: "Your sign-in has expired. Please sign in again.",
  session_expired: "Your sign-in has expired. Please sign in again.",
  refresh_token_not_found: "Your sign-in has expired. Please sign in again.",
  refresh_token_already_used: "Your sign-in has expired. Please sign in again.",
  bad_jwt: "Your sign-in has expired. Please sign in again.",
  reauthentication_needed: "Sign in again before changing the password.",
};
const SQLSTATE_TEXT = {
  "23505": "That value is already used by another record.",
  "23503": "That record is still in use, or refers to a record that does not exist.",
  "23502": "A required value is missing.",
  "23514": "One of the values is not allowed.",
  "22P02": "One of the values has the wrong format.",
  "22003": "A number is too large.",
  "22007": "A date has the wrong format.",
  "22008": "A date is out of range.",
  "428C9": "A calculated column cannot be set.",
};
const SCHEMA_CODES = new Set(["PGRST200", "PGRST201", "PGRST202", "PGRST203", "PGRST204", "PGRST205",
  "42P01", "42703", "42883"]);
const OFFLINE_CODES = new Set(["PGRST000", "PGRST001", "PGRST002", "PGRST003", "57014"]);
const RULE_CODES = new Set(["P0001", "22023", "23514", "23503", "23502"]);

const T = {
  offline: "Can't reach the server. Check the internet connection and try again.",
  auth: "Your sign-in has expired. Please sign in again.",
  forbidden: "You don't have permission to do that.",
  notfound: "That record no longer exists.",
  conflict: "Someone else saved this record while you were editing it.",
  validation: "Some of the values were not accepted.",
  busy: "The server is busy. Wait a moment and try again.",
  schema: "The website and the database do not match (a table, column or function is missing). Reload the page; if it keeps happening, tell the office.",
  error: "The server could not do that.",
  paused: "The DCR database is paused. The owner must restore the project from the Supabase dashboard; until then nothing can be read or saved.",
  tooLarge: "The file is larger than the DCR file storage accepts per file.",
  rate: "Too many attempts. Wait a few minutes and try again.",
};

/** "the bill is void" -> "The bill is void." */
export function sentence(text) {
  const t = String(text ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (!t) return "";
  const s = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : s + ".";
}

/* A message a trigger or RPC wrote for people, as opposed to Postgres' own wording. */
function ownSentence(raw) {
  const low = raw.toLowerCase();
  return !!raw && !["violates", "duplicate key", "constraint", "relation ", "invalid input syntax",
    "null value in column"].some((w) => low.includes(w));
}

function out(status, kind, message, extra) {
  return Object.assign({ status, kind, message, retryable: kind === "offline" || kind === "busy" }, extra || {});
}

/** Any error (PostgREST, Auth, Storage, fetch, ours) -> {status, kind, message, retryable, code}.
    kind: offline | auth | forbidden | notfound | conflict | validation | busy | schema | error. */
export function mapError(err) {
  if (!err) return out(500, "error", T.error);
  if (typeof err === "string") return out(400, "error", sentence(err) || T.error);
  const code = err.code === undefined || err.code === null ? "" : String(err.code);
  const raw = String(err.message || "");
  const low = raw.toLowerCase();
  const st = Number(err.status ?? err.statusCode ?? 0) || 0;
  const x = { code };

  if (code === "account_inactive") return out(403, "auth", raw || "This account is not active.", x);
  if (err.own && raw) return out(st || 400, err.kind || "error", raw, x);
  const sqlish = /^[0-9A-Z]{5}$/.test(code) && !OFFLINE_CODES.has(code);
  if (code === "offline" || code === "NO_LIBRARY" || (isNetworkError(err) && !sqlish && !OFFLINE_CODES.has(code))) {
    if (st === 540) return out(540, "offline", T.paused, x);
    return out(0, "offline", code === "NO_LIBRARY" ? raw : T.offline, x);
  }
  // our own sentences (sb.js, upload-queue2.js) keep their words
  if (["weak_password", "same_password", "wrong_current_password", "too_large", "local_rule"].includes(code) && raw) {
    return out(st || 400, "validation", raw, x);
  }
  // Supabase Auth
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return out(429, "busy", T.rate, x);
  if (code === "weak_password") return out(400, "validation", "That password is too weak. Use a longer one with letters and digits.", x);
  if (code === "same_password") return out(400, "validation", "The new password must be different from the old one.", x);
  if (AUTH_SENTENCES[code]) return out(st || 401, "auth", AUTH_SENTENCES[code], x);
  // PostgREST / Postgres
  if (code === "PGRST301" || code === "PGRST302" || code === "PGRST303" || low.includes("jwt expired") || low.includes("invalid jwt")) {
    return out(401, "auth", T.auth, x);
  }
  if (code === "42501" || code === "PGRST403") {
    const own = code === "42501" && ownSentence(raw) && !low.includes("row-level security") && !low.includes("permission denied");
    return out(403, "forbidden", own ? sentence(raw) : T.forbidden, x);
  }
  if (code === "PGRST116" || code === "P0002" || code === "PT404") {
    const own = code !== "PGRST116" && ownSentence(raw) && low !== "record not found";
    return out(404, "notfound", own ? sentence(raw) : T.notfound, x);
  }
  if (code === "PT409" || code === "40001") return out(409, "conflict", code === "PT409" && raw ? sentence(raw) : T.conflict, x);
  if (OFFLINE_CODES.has(code)) return out(503, "offline", "The database is not answering right now. Try again in a moment.", x);
  if (code === "23505") return out(409, "validation", SQLSTATE_TEXT["23505"], x);
  if (RULE_CODES.has(code) && ownSentence(raw)) return out(400, "validation", sentence(raw), x);
  if (SQLSTATE_TEXT[code]) return out(400, "validation", SQLSTATE_TEXT[code], x);
  if (/^2[23]/.test(code) || code === "P0001") return out(400, "validation", T.validation, x);
  if (SCHEMA_CODES.has(code)) return out(500, "schema", T.schema, x);
  // bare HTTP statuses (Storage, Edge Functions, gateways)
  const msg = sentence(raw);
  if (st === 540) return out(540, "offline", T.paused, x);
  if (st === 544) return out(544, "offline", "The database did not answer in time. Try again in a moment.", x);
  if (st === 546) return out(546, "error", "The server ran out of resources for that request. Try again in a moment.", x);
  if (st === 401) return out(401, "auth", T.auth, x);
  if (st === 403) return out(403, "forbidden", T.forbidden, x);
  if (st === 404) return out(404, "notfound", T.notfound, x);
  if (st === 409) return out(409, "validation", msg || "That already exists.", x);
  if (st === 413) return out(413, "validation", T.tooLarge, x);
  if (st === 400 || st === 422) return out(st, "validation", msg || T.validation, x);
  if (st === 429) return out(429, "busy", T.busy, x);
  if (st === 408 || st === 502 || st === 503 || st === 504 || (st >= 520 && st <= 530)) return out(st, "offline", T.offline, x);
  return out(st || 500, "error", msg || T.error, x);
}

/** The sentence to show for an error. */
export function errorText(err) {
  return mapError(err).message;
}

/* ── sign-in bounce ────────────────────────────────────────────────────── */

const NEXT_RE = /^[a-z][a-z0-9-]*\.html(\?[A-Za-z0-9=&_%.,:+-]*)?$/;

/** Where to go after signing in: only a bare page of this site ("my-tasks.html?task=12"), never a
    URL, never the sign-in page itself. Anything else -> "dashboard.html". */
export function safeNext(raw, fallback) {
  let next = "";
  try { next = raw ? decodeURIComponent(String(raw)) : ""; } catch (e) { next = ""; }
  if (!NEXT_RE.test(next) || /^index\.html/.test(next) || /^change-password\.html/.test(next)) {
    return fallback || "dashboard.html";
  }
  return next;
}

/** The sign-in page's query without anything a native form submit could have put there (an e-mail
    address, a password): only ?next= and ?inactive= are kept. "" when nothing is left. */
export function scrubbedSearch(search) {
  const q = String(search || "").replace(/^\?/, "");
  if (!q) return "";
  const keep = q.split("&").filter((part) => /^(next|inactive)=/.test(part));
  return keep.length ? "?" + keep.join("&") : "";
}

/** This page's own name plus query, for a sign-in bounce to come back to. */
export function thisPage() {
  if (!HAS_DOM) return "dashboard.html";
  const name = location.pathname.split("/").pop() || "dashboard.html";
  return name + (location.search || "");
}

/* ── toasts and dialogs ────────────────────────────────────────────────── */

/** A short message at the bottom of the screen. kind: "ok" | "error" | "info". */
export function toast(message, opts) {
  if (!HAS_DOM) return;
  const o = typeof opts === "string" ? { kind: opts } : (opts || {});
  let host = document.getElementById("dcr2Toasts");
  if (!host) {
    host = el("div", { id: "dcr2Toasts", class: "dcr2-toasts", role: "status", "aria-live": "polite" });
    document.body.appendChild(host);
  }
  const t = el("div", { class: "dcr2-toast " + (o.kind || "info") }, String(message ?? ""));
  host.appendChild(t);
  const ms = o.ms || (o.kind === "error" ? 6500 : 3500);
  const done = () => { t.classList.add("out"); setTimeout(() => t.remove(), 250); };
  t.addEventListener("click", done);
  setTimeout(done, ms);
  return t;
}

/* DCR2.modal — the app's own dialogs (never the browser's prompt/confirm, which carry the host
   name and the browser's chrome). Ported from common.js.
     await DCR2.confirm("Delete this row?", {danger: true})  -> true/false
     await DCR2.ask("What needs to happen?")                  -> string|null
     await DCR2.alert("Saved.")
     await DCR2.modal({title, message, fields: […], okText})  -> {name: value}|null
   altText (optional) adds a third button between Cancel and OK that answers "alt" (Save changes?: Cancel | Don't
   save | Save); Esc and the backdrop stay null, OK stays true / the values.                     */
const modalStack = [];

function modalHost() {
  let host = document.getElementById("dcrModalHost");
  if (host) return host;
  host = el("div", { id: "dcrModalHost", class: "dcr-mo" },
    el("div", { class: "dcr-mo-card", role: "dialog", "aria-modal": "true" }));
  document.body.appendChild(host);
  return host;
}

export function modal(opts) {
  const o = opts || {};
  const fields = o.fields || [];
  return new Promise((resolve) => {
    const host = modalHost();
    const card = host.querySelector(".dcr-mo-card");
    const lastFocus = document.activeElement;
    card.innerHTML =
      '<div class="dcr-mo-hd">' + (companyInfo.logo ? '<img src="' + h(companyInfo.logo) + '" alt="">' : "") +
        "<span>" + h(company) + '</span><span class="p2-badge sm">Portal 2</span></div>' +
      (o.title ? '<div class="dcr-mo-t">' + h(o.title) + "</div>" : "") +
      (o.message ? '<div class="dcr-mo-m">' + h(o.message) + "</div>" : "") +
      fields.map((f, i) => {
        const id = "dcrMoF" + i;
        const lab = f.label ? '<label for="' + id + '">' + h(f.label) + "</label>" : "";
        if (f.type === "textarea") {
          return '<div class="dcr-mo-f">' + lab + '<textarea id="' + id + '" rows="' + (Number(f.rows) || 3) +
            '" placeholder="' + h(f.placeholder || "") + '">' + h(f.value || "") + "</textarea></div>";
        }
        if (f.type === "checkbox") {
          return '<div class="dcr-mo-f dcr-mo-chk"><label for="' + id + '"><input id="' + id + '" type="checkbox"' +
            (f.value ? " checked" : "") + "> " + h(f.label || "") + "</label></div>";
        }
        if (f.type === "select") {
          return '<div class="dcr-mo-f">' + lab + '<select id="' + id + '">' +
            (f.options || []).map((op) => {
              const v = op && op.value !== undefined ? op.value : op;
              const t = op && op.label !== undefined ? op.label : op;
              return '<option value="' + h(v) + '"' + (String(v) === String(f.value) ? " selected" : "") + ">" + h(t) + "</option>";
            }).join("") + "</select></div>";
        }
        return '<div class="dcr-mo-f">' + lab + '<input id="' + id + '" type="' + h(f.type || "text") +
          '" placeholder="' + h(f.placeholder || "") + '" value="' + h(f.value || "") + '"' +
          (f.autocomplete ? ' autocomplete="' + h(f.autocomplete) + '"' : "") +
          (f.step ? ' step="' + h(f.step) + '"' : "") + "></div>";
      }).join("") +
      '<div class="dcr-mo-err" id="dcrMoErr"></div><div class="dcr-mo-ft">' +
      (o.cancel === false ? "" : '<button type="button" class="btn btn-ghost btn-sm" id="dcrMoNo">' + h(o.cancelText || "Cancel") + "</button>") +
      (o.altText ? '<button type="button" class="btn btn-ghost btn-sm" id="dcrMoAlt">' + h(o.altText) + "</button>" : "") +
      '<button type="button" class="btn btn-sm' + (o.danger ? " dcr-mo-danger" : "") + '" id="dcrMoYes">' + h(o.okText || "OK") + "</button></div>";

    host.classList.add("open");
    const entry = { done: false };
    modalStack.push(entry);

    function close(value) {
      if (entry.done) return;
      entry.done = true;
      modalStack.pop();
      host.classList.remove("open");
      document.removeEventListener("keydown", onKey, true);
      host.removeEventListener("click", onBackdrop);
      try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) { /* */ }
      resolve(value);
    }
    function values() {
      const v = {};
      fields.forEach((f, i) => {
        const n = document.getElementById("dcrMoF" + i);
        v[f.name || String(i)] = f.type === "checkbox" ? !!(n && n.checked) : n ? n.value : "";
      });
      return v;
    }
    async function submit() {
      const v = values();
      if (o.validate) {
        const problem = await o.validate(v);
        if (problem) { document.getElementById("dcrMoErr").textContent = problem; return; }
      }
      close(fields.length ? v : true);
    }
    function onKey(e) {
      if (modalStack[modalStack.length - 1] !== entry) return;
      if (e.key === "Escape") { e.preventDefault(); close(null); }
      else if (e.key === "Enter" && !e.shiftKey) {
        if (e.target && e.target.tagName === "TEXTAREA") return;
        e.preventDefault();
        submit();
      }
    }
    function onBackdrop(e) { if (e.target === host) close(null); }
    document.addEventListener("keydown", onKey, true);
    host.addEventListener("click", onBackdrop);
    card.querySelector("#dcrMoYes").addEventListener("click", submit);
    const no = card.querySelector("#dcrMoNo");
    if (no) no.addEventListener("click", () => close(null));
    const alt = card.querySelector("#dcrMoAlt");
    if (alt) alt.addEventListener("click", () => close("alt"));
    const first = card.querySelector("input, textarea, select");
    setTimeout(() => {
      if (first) { first.focus(); if (first.select) first.select(); }
      else card.querySelector("#dcrMoYes").focus();
    }, 20);
  });
}

export function ask(message, opts) {
  const o = opts || {};
  return modal({
    title: o.title || "", message, okText: o.okText || "OK", danger: o.danger,
    fields: [{ name: "v", type: o.type || "text", value: o.value || "", placeholder: o.placeholder || "", label: o.label || "" }],
    validate: o.validate,
  }).then((r) => (r ? r.v : null));
}

export function confirm(message, opts) {
  const o = opts || {};
  return modal({
    title: o.title || "", message, okText: o.okText || "Yes", cancelText: o.cancelText || "Cancel",
    danger: o.danger, fields: [],
  }).then((r) => r === true);
}

export function alert(message, opts) {
  const o = opts || {};
  return modal({ title: o.title || "", message, okText: o.okText || "OK", cancel: false, fields: [] }).then(() => {});
}

/* ── theme (per device, Settings) ──────────────────────────────────────── */

const THEME_KEY = "dcr2_theme";
export const theme = {
  get() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch (e) { return "system"; }
  },
  set(v) {
    const want = v === "light" || v === "dark" ? v : "system";
    try {
      if (want === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, want);
    } catch (e) { /* a private window still gets the change for this page */ }
    theme.apply();
    return want;
  },
  apply() {
    if (!HAS_DOM) return;
    const want = theme.get();
    if (want === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = want;
  },
};

/* ── the offline overlay ───────────────────────────────────────────────── */

/** One offline notice for every screen: "you are still signed in — this is the connection". */
export function offlineOverlay(on) {
  if (!HAS_DOM) return;
  let n = document.getElementById("dcrOffline");
  if (!on) { if (n) n.remove(); return; }
  if (n) return;
  n = el("div", { id: "dcrOffline", class: "dcr2-offline", role: "alertdialog", "aria-modal": "true" },
    el("div", { class: "dcr2-offline-card" },
      el("div", { class: "t" }, "Can’t reach the portal"),
      el("div", { class: "s" }, "You are still signed in — this looks like the connection, not your account."),
      el("button", { type: "button", class: "btn btn-block p2", onclick: () => location.reload() }, "Try again"),
      el("button", { type: "button", class: "linkish", onclick: () => logout() }, "Sign out")));
  (document.body || document.documentElement).appendChild(n);
}

/* ── requireAuth ───────────────────────────────────────────────────────── */

const hold = () => new Promise(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bounceToSignIn(extra) {
  location.replace("index.html?next=" + encodeURIComponent(thisPage()) + (extra || ""));
  return hold();
}

async function withRetry(fn) {
  try { return await fn(); }
  catch (e) {
    if (!isNetworkError(e)) throw e;
    await sleep(1500);                   // one quiet retry: a dropped packet is not worth a notice
    return fn();
  }
}

let _authWired = false;

/** Load the signed-in person or send them to sign in. Resolves with the profile.
    opts.roles: only these roles (others see a notice and a way home).
    opts.offline: when the connection is down but this device holds a sign-in, carry on with the
    profile read last (pages that work offline, such as Site Photos) instead of holding.
    opts.allowMustChange: the change-password page itself.
    Network errors never sign anyone out: the page holds behind the offline overlay. */
export async function requireAuth(opts) {
  const o = opts || {};
  let p;
  try {
    const s = await withRetry(() => session());
    if (!s) return bounceToSignIn();
    p = await withRetry(() => me());
  } catch (e) {
    if (isNetworkError(e)) {
      const cached = o.offline && hasStoredSession() ? cachedMe() : null;
      if (cached && cached.active && cached.role !== "agents") {
        DCR2.profile = cached;
        DCR2.offline = true;
        paintUser(cached);
        toast("Offline — what you do is kept on this device until the connection is back.", { kind: "info", ms: 5000 });
        return cached;
      }
      offlineOverlay(true);
      return hold();
    }
    const m = mapError(e);
    if (m.kind === "auth") return bounceToSignIn();
    offlineOverlay(false);
    await alert(m.message, { title: "Could not open this page" });
    return hold();
  }
  offlineOverlay(false);
  if (!p || !p.active || p.role === "agents") {
    if (p && p.id && p.id === storedUserId()) await forgetSavedPlans(p.id);   // its saved plans go (never a newer sign-in's)
    await signOut();
    location.replace("index.html?inactive=1");
    return hold();
  }
  if (p.must_change_password && !o.allowMustChange) {
    location.replace("change-password.html?next=" + encodeURIComponent(thisPage()));
    return hold();
  }
  DCR2.profile = p;
  DCR2.offline = false;
  paintUser(p);
  if (!_authWired) {
    _authWired = true;
    // Signed out elsewhere (a password change ends the other sessions; an admin turned the account
    // off and its refresh failed): go to the sign-in page instead of showing empty lists.
    onAuth((event) => { if (event === "SIGNED_OUT") bounceToSignIn(); });
  }
  if (o.roles && o.roles.length && o.roles.indexOf(p.role) === -1) {
    await alert("This page is not available for your role (" + roleLabel(p.role) + ").", { title: "Not available", okText: "Go home" });
    location.replace("dashboard.html");
    return hold();
  }
  return p;
}

export async function logout() {
  // A shared phone: this person's notices stop reaching it (push2.js forgetOnSignOut - their own row for this
  // device and the browser's subscription). Loaded only now (push2.js imports this module), best effort and
  // bounded: signing out never waits more than a few seconds on it.
  let timer = null;
  try {
    await Promise.race([
      import("./push2.js").then(function (p) { return p.forgetOnSignOut(3000); }),
      new Promise(function (res) { timer = setTimeout(res, 3500); }),
    ]);
  } catch (e) { /* signing out goes on */ } finally { clearTimeout(timer); }
  await signOut();
  location.replace("index.html");
}

export const ROLE_LABELS = {
  admin: "Admin", manager: "Manager", accountant: "Accountant", lead: "Lead",
  field: "Field", viewer: "View only", agents: "DCR Agents",
};
export function roleLabel(role) { return ROLE_LABELS[role] || String(role || ""); }

/* ── the top bar ───────────────────────────────────────────────────────── */

/** The pages, by role. Field and view-only people read the Board; only a viewer cannot take site
    photos (the database refuses their uploads). Everyone has a Time Sheet (a viewer reads theirs);
    Team Sheets is for admin, manager, accountant (read only) and lead. Everyone has My Tasks (P3: a
    view-only account reads the tasks given to it). Later phases add theirs. */
export function navItems(p) {
  const role = p && p.role;
  return [
    { key: "home", href: "dashboard.html", text: "Home" },
    { key: "tasks", href: "my-tasks.html", text: "My Tasks" },
    { key: "board", href: "board.html", text: "Board" },
    { key: "search", href: "search.html", text: "Search" },
    { key: "logs", href: "logs.html", text: "Log History" },
    { key: "capture", href: "capture.html", text: "Site Photos", show: role !== "viewer" },
    { key: "timesheet", href: "timesheet.html", text: "Time Sheet" },
    { key: "teamsheets", href: "timesheet-manager.html", text: "Team Sheets", show: ["admin", "manager", "accountant", "lead"].indexOf(role) !== -1 },
    { key: "settings", href: "settings.html", text: "Settings" },
  ].filter((i) => i.show !== false);
}

/** Draw the top bar: back/forward, the company mark with the "Portal 2" badge, the pages this role
    may open (`active` is the key of this page), the presence avatars, the person and Log out.
    Fills an existing <div class="topbar" id="dcr2Topbar"> or puts a new bar at the top of <body>.
    opts.actions: extra nodes for the right-hand side (page buttons). Returns the bar. */
export function topbar(active, opts) {
  const o = opts || {};
  let bar = document.getElementById("dcr2Topbar");
  if (!bar) {
    bar = el("div", { id: "dcr2Topbar" });
    document.body.insertBefore(bar, document.body.firstChild);
  }
  bar.className = "topbar dcr2-topbar";
  bar.innerHTML = "";
  const p = DCR2.profile;
  const items = navItems(p);
  const nav = el("nav", { class: "dcr2-nav", id: "dcr2Nav", "aria-label": "Pages" },
    items.map((i) => el("a", { href: i.href, class: i.key === active ? "on" : "", "aria-current": i.key === active ? "page" : null }, i.text)));
  const menuBtn = el("button", {
    type: "button", class: "dcr2-menu-btn btn btn-ghost btn-sm", "aria-expanded": "false", "aria-controls": "dcr2Nav",
    title: "Pages", onclick: () => {
      const open = !nav.classList.contains("open");
      nav.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    },
  }, el("span", { "aria-hidden": "true" }, "☰"), el("span", { class: "lbl" }, "Menu"));
  if (!_menuWired) {
    _menuWired = true;
    // a tap anywhere else closes the phone menu (whichever bar is drawn now)
    document.addEventListener("click", (e) => {
      const n = document.getElementById("dcr2Nav");
      const b = document.querySelector(".dcr2-menu-btn");
      if (n && b && n.classList.contains("open") && !n.contains(e.target) && !b.contains(e.target)) {
        n.classList.remove("open");
        b.setAttribute("aria-expanded", "false");
      }
    });
  }
  const brand = el("a", { class: "brand", href: "dashboard.html", title: company + " Portal 2" },
    el("img", { class: "brand-logo", src: "icons/logo.png", alt: "" }),
    el("span", { class: "brand-name" }, o.title || company + " Portal"),
    el("span", { class: "p2-badge" }, "Portal 2"));
  const actions = el("div", { class: "top-actions" },
    el("div", { class: "dcr2-presence", id: "dcr2Presence", "aria-label": "Who else is here" }),
    o.actions || null,
    el("a", { class: "pill", id: "userPill", href: "settings.html", title: "Your settings" }, p ? p.name + " · " + roleLabel(p.role) : ""),
    el("button", { type: "button", class: "btn btn-ghost btn-sm", id: "logoutBtn", onclick: () => logout() }, "Log out"));
  bar.appendChild(brand);
  bar.appendChild(menuBtn);
  bar.appendChild(nav);
  bar.appendChild(actions);
  buildNav();
  fitTopbar(bar);
  if (!_fitWired) {
    _fitWired = true;
    window.addEventListener("resize", queueFit);
    window.addEventListener("load", queueFit);
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueFit, () => null); } catch (e) { /* */ }
  }
  // Who else is here: on a desk by default; on a phone only when the page asks (a project page),
  // so a crew phone holds no Realtime connection it does not need.
  const wantPresence = o.presence === undefined
    ? !!(window.matchMedia && window.matchMedia("(min-width: 761px) and (pointer: fine)").matches)
    : !!o.presence;
  if (wantPresence) {
    if (_presenceOff) _presenceOff();
    _presenceOff = onPresence((states) => paintPresence(states));
  }
  return bar;
}
let _presenceOff = null;
let _menuWired = false;
let _fitWired = false;
let _fitQueued = false;

/** The desk bar stays ONE row (as the phone's does: below 861 px the menu is always used). When the
    page links do not fit beside Back / Forward, the brand and the person (a narrow window, a long
    name, several people online, the office roles' eight links), the bar first gives up the words
    "DCR Portal" (the logo and the Portal 2 badge stay) and some padding ("tight"), then folds the
    links into the ☰ menu ("fold"). Measured, not guessed: each step is laid out and compared.
    -> "" | "tight" | "fold". */
export function fitTopbar(bar) {
  if (!HAS_DOM) return "";
  const b = bar || document.querySelector(".dcr2-topbar");
  if (!b || !b.isConnected) return "";
  b.classList.remove("dcr2-fold", "dcr2-tight");
  const nav = b.querySelector(".dcr2-nav");
  if (!nav || (window.matchMedia && window.matchMedia("(max-width: 860px)").matches)) return "";
  const oneRow = () => {
    const parts = [];
    Array.from(b.children).forEach((n) => {
      if (n === nav || n.classList.contains("dcr2-menu-btn")) return;
      if (n.classList.contains("top-actions")) parts.push(...Array.from(n.children)); else parts.push(n);
    });
    parts.push(...Array.from(nav.children));
    const mids = [];
    parts.forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.width && r.height) mids.push(r.top + r.height / 2);
    });
    return mids.length < 2 || Math.max(...mids) - Math.min(...mids) <= 12;
  };
  if (oneRow()) return "";
  b.classList.add("dcr2-tight");
  if (oneRow()) return "tight";
  b.classList.remove("dcr2-tight");
  b.classList.add("dcr2-fold");
  return "fold";
}
function queueFit() {
  if (_fitQueued || !HAS_DOM) return;
  _fitQueued = true;
  requestAnimationFrame(() => { _fitQueued = false; fitTopbar(); });
}

function paintUser(p) {
  if (!HAS_DOM) return;
  const pill = document.getElementById("userPill");
  if (pill && p) pill.textContent = p.name + " · " + roleLabel(p.role);
}

function initials(name) {
  const parts = String(name || "?").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const VIEW_WORDS = {
  "web:board": "on the Board", "web:project": "in a project", "web:search": "searching", "web:logs": "in Log History",
  "web:capture": "taking site photos", "web:dashboard": "on the home page", "board": "on the Board",
  "web:timesheet": "in the Time Sheet", "web:teamsheets": "in Team Sheets",
};
function viewWords(s) {
  const v = String(s.view || "");
  if (VIEW_WORDS[v]) return VIEW_WORDS[v];
  if (/^project:/.test(v)) return s.app === "portal2" ? "in a project (Portal 2)" : "in a project (Desktop 2)";
  return v ? "online" : "online";
}

/** A presence colour as it may be drawn: only "#rrggbb". Each device reports its own presence
    payload, so anything else (it could carry CSS: "#fff;position:fixed;…") is drawn grey. */
export function presenceColor(c) {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : "#6b7a8c";
}

/** Draw the others who are online (merged presence states, see live.js) into the top bar.
    Those inside the same project are drawn first with a ring; a pencil means editing. */
export function paintPresence(states, slot) {
  const box = slot || (HAS_DOM && document.getElementById("dcr2Presence"));
  if (!box) return;
  const mine = DCR2.profile && DCR2.profile.id;
  const here = DCR2.presenceProject ? String(DCR2.presenceProject) : "";
  const others = Object.values(states || {}).filter((s) => String(s.user_id) !== String(mine));
  others.sort((a, b) => {
    const ah = here && (a.projects || []).includes(here) ? 0 : 1;
    const bh = here && (b.projects || []).includes(here) ? 0 : 1;
    return ah - bh || String(a.name).localeCompare(String(b.name));
  });
  box.innerHTML = "";
  const max = 5;
  others.slice(0, max).forEach((s) => {
    const inHere = here && (s.projects || []).includes(here);
    const a = el("span", {
      class: "dcr2-av" + (inHere ? " here" : "") + (s.editing ? " editing" : ""),
      title: (s.name || "Someone") + " — " + (s.editing ? "editing " : "") + viewWords(s),
      style: { background: presenceColor(s.color) },
    }, initials(s.name));
    box.appendChild(a);
  });
  if (others.length > max) box.appendChild(el("span", { class: "dcr2-av more", title: others.slice(max).map((s) => s.name).join(", ") }, "+" + (others.length - max)));
  if (!slot) queueFit();                 // more or fewer faces: the links may (no longer) fit
}

/* ── DCR2.live — the autosave engine, with versions ─────────────────────── */

const LIVE_DELAY = 800;          // idle after the last keystroke
const LIVE_NOW = 120;            // discrete controls: a burst of clicks is one write
const LIVE_CEILING = 4000;       // never wait longer than this while typing
const LIVE_BACKOFF = [2000, 6000, 15000];
const MAX_MERGES = 3;
const liveRecords = {};
const livePageNodes = [];

export function liveNorm(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "1" : "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const count = (o) => Object.keys(o).length;

/** Worth trying again? The connection, throttling and server faults are; refusals are not. */
export function liveRetryable(e) {
  if (HAS_DOM && typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const m = mapError(e);
  return m.kind === "offline" || m.kind === "busy";
}

function liveClock(d) {
  return fmtTime(d).replace(" ", "").toLowerCase();
}

export class LiveRecord {
  constructor(record, opts) {
    this.opts = opts;
    this.base = Object.assign({}, record || {});   // last values known to be on the server
    this.version = record ? record.version : undefined;
    this.pend = {};
    this.bad = {};
    this.timer = null;
    this.retryTimer = null;
    this.firstDirtyAt = 0;
    this.inflight = null;
    this.tries = 0;
    this.merges = 0;
    this.state = "idle";       // idle | dirty | saving | saved | error | invalid | conflict
    this.savedAt = null;
    this.err = null;
    this.conflict = null;
    this.nodes = [];
    this.inputs = [];
  }

  get row() { return Object.assign({}, this.base, this.pend); }

  /** A newer copy of the record arrived (Realtime, a re-read). Fields with unsaved edits keep the
      edit; the version is taken only when nothing is waiting (otherwise a save would silently
      overwrite what came in; the save's conflict check handles it). */
  baseline(row) {
    if (!row) return this;
    const idle = !this.inflight && !count(this.pend);
    for (const k of Object.keys(row)) {
      if (!(k in this.pend)) this.base[k] = row[k];
    }
    if (idle && row.version !== undefined) this.version = row.version;
    for (const p of Object.keys(this.pend)) {
      if (liveNorm(this.pend[p]) === liveNorm(this.base[p])) delete this.pend[p];
    }
    this.repaintInputs(Object.keys(row).filter((k) => !(k in this.pend)));
    return this;
  }

  set(field, value, o) {
    const opt = o || {};
    if (this.opts.validate && !this.opts.validate(field, value)) {
      this.bad[field] = true;
      delete this.pend[field];
      this.state = "invalid";
      this.paint();
      return this;
    }
    delete this.bad[field];
    if (this.state === "conflict") { this.state = "idle"; this.conflict = null; }
    if (liveNorm(value) === liveNorm(this.base[field])) delete this.pend[field];
    else this.pend[field] = value;
    if (!count(this.pend)) {
      if (this.state === "dirty" || this.state === "invalid") this.state = this.savedAt ? "saved" : "idle";
      clearTimeout(this.timer); this.timer = null; this.firstDirtyAt = 0;
      this.paint();
      return this;
    }
    if (this.state !== "saving") this.state = "dirty";
    this.paint();
    this.arm(opt.now ? LIVE_NOW : 0);
    return this;
  }

  arm(fixed) {
    if (!this.firstDirtyAt) this.firstDirtyAt = Date.now();
    clearTimeout(this.timer);
    const delay = this.opts.debounce || this.opts.delay || LIVE_DELAY;
    const wait = fixed || Math.max(0, Math.min(delay, LIVE_CEILING - (Date.now() - this.firstDirtyAt)));
    this.timer = setTimeout(() => this.flush(), wait);
  }

  flush() {
    clearTimeout(this.timer); this.timer = null;
    clearTimeout(this.retryTimer); this.retryTimer = null;
    if (this.inflight) return this.inflight;           // one write at a time, in order
    if (!count(this.pend)) return Promise.resolve();
    const fields = this.pend;
    const version = this.version;
    this.pend = {};
    this.firstDirtyAt = 0;
    this.state = "saving";
    this.paint();
    this.inflight = Promise.resolve()
      .then(() => this.opts.save(Object.assign({}, fields), version))
      .then((res) => {
        const row = Array.isArray(res) ? res[0] : res;
        if (!row) return this.resolveEmpty(fields, version);
        this.inflight = null; this.tries = 0; this.err = null; this.merges = 0;
        Object.assign(this.base, fields, row);
        if (row.version !== undefined) this.version = row.version;
        this.state = "saved"; this.savedAt = new Date();
        try { if (this.opts.onSaved) this.opts.onSaved(row, fields); } catch (e) { /* never break the page */ }
        this.paint();
        if (count(this.pend)) return this.flush();      // typed while saving
        return undefined;
      })
      .catch((e) => {
        if (e && String(e.code) === "PT409") return this.resolveEmpty(fields, version);
        this.inflight = null;
        this.requeue(fields);
        this.err = e;
        this.state = "error";
        this.paint();
        if (liveRetryable(e) && this.tries < LIVE_BACKOFF.length) {
          const wait = LIVE_BACKOFF[this.tries];
          this.tries++;
          this.retryTimer = setTimeout(() => this.flush(), wait);
        }
        return undefined;
      });
    return this.inflight;
  }

  requeue(fields) {
    // the failed values go back UNDER anything newer the person typed meanwhile
    this.pend = Object.assign({}, fields, this.pend);
  }

  /* The write matched nothing (or PT409): read the record again.
     - gone: "no longer exists";
     - same version: the database refused it (row level security answers with nothing);
     - someone else changed one of OUR fields: keep theirs, say "Changed by someone else";
     - they changed other fields only: take their version and send ours again (merge). */
  async resolveEmpty(fields, version) {
    let cur;
    try {
      cur = this.opts.reread ? await this.opts.reread() : null;
    } catch (e) {
      this.inflight = null;
      this.requeue(fields);
      this.err = e; this.state = "error"; this.paint();
      if (liveRetryable(e) && this.tries < LIVE_BACKOFF.length) {
        this.retryTimer = setTimeout(() => this.flush(), LIVE_BACKOFF[this.tries++]);
      }
      return;
    }
    this.inflight = null;
    if (!cur) {
      this.err = { message: "This record no longer exists.", code: "PT404", own: true, kind: "error" };
      this.state = "error"; this.paint();
      return;
    }
    if (cur.version !== undefined && cur.version === version) {
      this.err = { message: "You don't have permission to change this.", code: "42501", own: true, kind: "error" };
      for (const k of Object.keys(fields)) if (!(k in this.pend)) { /* drop: it can't be saved */ }
      this.state = "error"; this.paint();
      this.repaintInputs(Object.keys(fields), cur);
      return;
    }
    const theirs = Object.keys(fields).filter((k) =>
      liveNorm(cur[k]) !== liveNorm(this.base[k]) && liveNorm(cur[k]) !== liveNorm(fields[k]));
    const ours = Object.keys(fields).filter((k) => theirs.indexOf(k) === -1);
    Object.assign(this.base, cur);
    this.version = cur.version;
    if (theirs.length) {
      for (const k of theirs) delete this.pend[k];
      this.conflict = { fields: theirs, current: cur, mine: fields };
      this.state = "conflict";
      this.repaintInputs(theirs, cur);
      try { if (this.opts.onConflict) this.opts.onConflict(this.conflict); } catch (e) { /* */ }
      const keep = {};
      for (const k of ours) if (liveNorm(fields[k]) !== liveNorm(cur[k])) keep[k] = fields[k];
      this.pend = Object.assign(keep, this.pend);
      this.paint();
      if (count(this.pend)) this.arm(LIVE_NOW);
      return;
    }
    if (++this.merges > MAX_MERGES) {
      this.requeue(fields);
      this.err = { message: "The record keeps changing. Wait a moment, then try again.", code: "PT409", own: true, kind: "error" };
      this.state = "error"; this.paint();
      return;
    }
    const resend = {};
    for (const k of ours) if (liveNorm(fields[k]) !== liveNorm(cur[k])) resend[k] = fields[k];
    this.pend = Object.assign(resend, this.pend);
    if (!count(this.pend)) { this.state = "saved"; this.savedAt = new Date(); this.paint(); return; }
    this.state = "dirty";
    this.paint();
    return this.flush();
  }

  retry() { this.tries = 0; this.merges = 0; return this.flush(); }
  busy() { return !!(this.inflight || count(this.pend)); }
  dispose() {
    const p = this.flush();
    if (liveRecords[this.opts.key] === this) delete liveRecords[this.opts.key];
    return p.then(() => { this.nodes = []; this.inputs = []; });
  }

  /** Wire every [data-key] control under root. Discrete controls (checkbox, select, date) save on
      change; typed fields debounce and flush on blur. */
  bind(root) {
    if (!root) return this;
    root.querySelectorAll("[data-key]").forEach((inp) => {
      if (inp._dcr2Live) return;
      inp._dcr2Live = this;
      // disabled only because it was drawn masked is not this control's own state
      inp._dcr2Dis = inp.hasAttribute("data-masked") ? false : !!inp.disabled;
      this.inputs.push(inp);
      const discrete = inp.type === "checkbox" || inp.type === "radio" || inp.tagName === "SELECT" || inp.type === "date";
      inp.addEventListener(discrete ? "change" : "input", () => {
        if (inp._dcr2Masked) return;                     // a masked text is never saved
        this.set(inp.getAttribute("data-key"), inputValue(inp), { now: discrete });
      });
      if (!discrete) {
        inp.addEventListener("blur", () => {
          if (inp._dcr2Masked) return;
          this.set(inp.getAttribute("data-key"), inputValue(inp));
          this.flush();
        });
      }
      if (this.opts.mask) this.showValue(inp, this.row[inp.getAttribute("data-key")]);
    });
    this.paint();
    return this;
  }

  /** Put a value into one bound control. opts.mask(key, value) -> the text to show instead (an
      amount this person may not see, Q28: on screen only) or null. A masked control is read-only and
      never saves; it turns editable again when a later value has no amount. */
  showValue(inp, value) {
    const k = inp.getAttribute("data-key");
    const masked = this.opts.mask ? this.opts.mask(k, value) : null;
    if (masked !== null && masked !== undefined) {
      inp._dcr2Masked = true;
      inp.setAttribute("data-masked", k);
      inp.disabled = true;
      inp.title = "Contains an amount — hidden for you";
      inp.value = String(masked);
      return;
    }
    if (inp._dcr2Masked || inp.hasAttribute("data-masked")) {
      inp._dcr2Masked = false;
      inp.removeAttribute("data-masked");
      inp.removeAttribute("title");
      inp.disabled = !!inp._dcr2Dis;
    }
    if (inp.type === "checkbox") inp.checked = !!value;
    else inp.value = value === null || value === undefined ? "" : String(value);
  }

  /** Show `value` in the control(s) of `key` (through the mask: "Use mine" after a conflict). */
  showField(key, value) {
    for (const inp of this.inputs) if (inp.getAttribute("data-key") === key) this.showValue(inp, value);
  }

  repaintInputs(keys, row) {
    const src = row || this.base;
    for (const inp of this.inputs) {
      const k = inp.getAttribute("data-key");
      if (keys.indexOf(k) === -1) continue;
      const v = src[k];
      const hides = !!this.opts.mask && this.opts.mask(k, v) !== null && this.opts.mask(k, v) !== undefined;
      // someone typing keeps their field, unless what arrived must be hidden from them
      if (!hides && HAS_DOM && document.activeElement === inp && !row) continue;
      this.showValue(inp, v);
    }
  }

  summary() {
    const bad = Object.keys(this.bad);
    if (this.state === "conflict") {
      return { state: "conflict", text: "⚠ Changed by someone else — their version is shown" };
    }
    if (this.state === "error") {
      const off = HAS_DOM && typeof navigator !== "undefined" && navigator.onLine === false;
      const m = errorText(this.err);
      return { state: "error", retry: !off && liveRetryable(this.err), text: off ? "Offline — saves when you reconnect" : "⚠ " + m };
    }
    if (bad.length) return { state: "invalid", text: "Can't save " + bad[0] + " — check the value" };
    if (this.state === "saving") return { state: "saving", text: this.tries ? "Saving… (retry " + this.tries + ")" : "Saving…" };
    if (this.state === "dirty") return { state: "dirty", text: "• Unsaved" };
    if (this.state === "saved") return { state: "saved", text: "✓ Saved " + liveClock(this.savedAt) };
    return { state: "idle", text: "" };
  }

  paint() {
    if (!HAS_DOM) return;
    const s = this.summary();
    this.nodes.forEach((n) => livePaint(n, s, this));
    livePaintPage();
  }
}

const LIVE_STATES = /\b(dcr-live|idle|dirty|saving|saved|error|invalid|conflict)\b/g;
function livePaint(node, s, rec) {
  if (!node) return;
  if (node._dcrBase === undefined) node._dcrBase = node.className.replace(LIVE_STATES, "").trim();
  node.className = ("dcr-live " + node._dcrBase + " " + s.state).replace(/\s+/g, " ").trim();
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.textContent = s.text;
  if (s.retry && rec) {
    const b = el("button", { type: "button", class: "dcr-live-retry", onclick: () => rec.retry() }, "Retry");
    node.appendChild(document.createTextNode(" "));
    node.appendChild(b);
  }
}

const LIVE_RANK = { error: 6, conflict: 5, invalid: 4, saving: 3, dirty: 2, saved: 1, idle: 0 };
function livePaintPage() {
  if (!livePageNodes.length) return;
  let worst = null, rec = null;
  for (const k of Object.keys(liveRecords)) {
    const s = liveRecords[k].summary();
    if (!worst || LIVE_RANK[s.state] > LIVE_RANK[worst.state]) { worst = s; rec = liveRecords[k]; }
  }
  livePageNodes.forEach((n) => livePaint(n, worst || { state: "idle", text: "" }, rec));
}

function liveNode(x) { return typeof x === "string" ? document.getElementById(x) : x; }

/** The value a [data-key] control holds: data-type="num" -> number|null, "bool"/checkbox ->
    true/false, a date input -> "YYYY-MM-DD"|null (a calendar day, never a moment). */
export function inputValue(inp) {
  const type = inp.getAttribute && inp.getAttribute("data-type");
  if (type === "bool" || inp.type === "checkbox") return inp.checked;
  if (type === "num" || inp.type === "number") return inp.value === "" ? null : Number(inp.value);
  if (type === "date" || inp.type === "date") return inp.value || null;
  if (type === "null" && inp.value === "") return null;
  return inp.value;
}

/** The default versioned writer for a table row:
    PATCH <table>?<idColumn>=eq.<id>&version=eq.<v> returning the row; re-read by id. */
export function versionedWriter(table, id, idColumn) {
  const col = idColumn || "id";
  return {
    async save(patch, version) {
      let q = sb().from(table).update(patch).eq(col, id);
      if (version !== undefined && version !== null) q = q.eq("version", version);
      const { data, error, status } = await q.select();
      if (error) { error.status = status; throw error; }
      return (data && data[0]) || null;
    },
    async reread() {
      const { data, error, status } = await sb().from(table).select("*").eq(col, id).maybeSingle();
      if (error) { error.status = status; throw error; }
      return data || null;
    },
  };
}

/** DCR2.live(record, {save, reread, debounce: 800, status, key, onSaved, onConflict, validate})
    or DCR2.live(record, {table: "projects"}) for the default versioned PATCH of that table.
    The same key returns the same saver: that IS the coalescing guarantee. */
export function live(record, opts) {
  const o = Object.assign({}, opts || {});
  const idCol = o.idColumn || "id";
  const id = record ? record[idCol] : undefined;
  if (!o.save && o.table) { const w = versionedWriter(o.table, id, idCol); o.save = w.save; if (!o.reread) o.reread = w.reread; }
  if (!o.save) throw new Error("DCR2.live needs a save function or a table.");
  o.key = o.key || (o.table || "record") + ":" + id;
  let rec = liveRecords[o.key];
  if (rec) {
    Object.assign(rec.opts, o);
    if (record) rec.baseline(record);
  } else {
    rec = liveRecords[o.key] = new LiveRecord(record, o);
  }
  if (HAS_DOM && o.status) {
    const n = liveNode(o.status);
    if (n && rec.nodes.indexOf(n) === -1) rec.nodes.push(n);
  }
  rec.paint();
  return rec;
}
live.get = (key) => liveRecords[key] || null;
live.inputValue = inputValue;
live.busy = () => Object.keys(liveRecords).some((k) => liveRecords[k].busy());
live.flushAll = () => Promise.all(Object.keys(liveRecords).map((k) => liveRecords[k].flush()));
live.mountBadge = (x) => {
  const n = liveNode(x);
  if (n && livePageNodes.indexOf(n) === -1) livePageNodes.push(n);
  livePaintPage();
  return n;
};
live.versionedWriter = versionedWriter;
live._reset = () => { for (const k of Object.keys(liveRecords)) delete liveRecords[k]; };

/* ── window.DCR2 ───────────────────────────────────────────────────────── */

export const DCR2 = {
  version: "0.1.0",
  company, companyInfo,
  profile: null,
  offline: false,
  presenceProject: null,
  el, h, esc: h, $, $$,
  toast, modal, confirm, alert, ask, theme,
  TZ, companyToday, companyDay, addDays, weekday, saturdayOf, weekOf, pacificToUtc, logWindow,
  fmtDate, fmtDateTime, fmtTime, ago,
  money, canSeePrices, maskAmounts, shownText,
  mapError, errorText, sentence,
  safeNext, thisPage,
  requireAuth, logout, roleLabel, navItems, topbar, paintPresence, offlineOverlay,
  live,
  sb, me,
};

if (HAS_DOM) {
  window.DCR2 = DCR2;
  theme.apply();

  // Not inside another site's frame (frame-ancestors cannot be set from a meta tag): a page framed
  // by anything but Portal 2 itself shows nothing.
  try {
    if (window.top !== window.self && window.top.location.origin !== location.origin) throw new Error("framed");
  } catch (e) {
    document.documentElement.innerHTML = "";
    throw new Error("Portal 2 does not open inside another site.");
  }

  // One guard for the whole app: warn only while something is genuinely unsaved.
  window.addEventListener("beforeunload", (e) => {
    if (!live.busy()) return;
    live.flushAll();
    e.preventDefault();
    e.returnValue = "";
  });
  window.addEventListener("pagehide", () => { live.flushAll(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") live.flushAll(); });
  window.addEventListener("online", () => { live.flushAll(); });

  // The service worker, registered against this file's own folder (js/ -> the site root).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      try {
        const root = new URL("../", import.meta.url);
        navigator.serviceWorker.register(new URL("sw.js", root).href, { scope: root.href }).catch(() => {});
      } catch (e) { /* non-fatal */ }
    });
  }

  singleInstance();
}

/* ── single-instance guard (installed app only) ─────────────────────────── */
function singleInstance() {
  let inFrame = false;
  try { inFrame = window.top !== window.self; } catch (e) { inFrame = true; }
  if (inFrame) return;
  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  if (!standalone || !navigator.locks || !navigator.locks.request) return;
  const LOCK = "dcr-portal2-single-instance";
  let overlay = null;
  function show() {
    if (overlay) { overlay.style.display = "flex"; return; }
    overlay = el("div", { class: "dcr2-single" },
      el("div", { class: "t" }, "DCR Portal 2 is already open"),
      el("div", { class: "s" }, "It’s running in another window. Switch to that window — this one activates automatically when you close the other."),
      el("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => location.reload() }, "Reload this window"));
    (document.body || document.documentElement).appendChild(overlay);
  }
  const primary = () => { if (overlay) overlay.style.display = "none"; return new Promise(() => {}); };
  navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
    if (lock) return primary();
    const t = setTimeout(() => {
      if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
    }, 400);
    return navigator.locks.request(LOCK, { mode: "exclusive" }, () => { clearTimeout(t); return primary(); });
  });
}

/* ── Back / Forward (ported) ───────────────────────────────────────────── */
function buildNav() {
  const bar = document.querySelector(".topbar");
  if (!bar || bar.querySelector(".dcr-nav")) return;
  const chev = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="' + d + '"/></svg>';
  const nav = el("div", { class: "dcr-nav" });
  nav.innerHTML =
    '<button type="button" class="dcr-navbtn" data-nav="back" title="Back" aria-label="Go back">' + chev("15 18 9 12 15 6") + "</button>" +
    '<button type="button" class="dcr-navbtn" data-nav="fwd" title="Forward" aria-label="Go forward">' + chev("9 18 15 12 9 6") + "</button>";
  bar.insertBefore(nav, bar.firstChild);
  const back = nav.querySelector('[data-nav="back"]');
  const fwd = nav.querySelector('[data-nav="fwd"]');
  back.addEventListener("click", () => { if (!back.disabled) history.back(); });
  fwd.addEventListener("click", () => { if (!fwd.disabled) history.forward(); });
  const paint = () => {
    const idx = navPosition();
    const max = Math.max(navNum(navGet(NAV_MAX)), idx);
    back.disabled = idx <= 1;
    fwd.disabled = idx >= max;
  };
  paint();
  window.addEventListener("pageshow", paint);
  window.addEventListener("popstate", paint);
}

const NAV_LAST = "dcr2_nav_last";
const NAV_MAX = "dcr2_nav_max";
function navNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function navGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function navSet(k, v) { try { sessionStorage.setItem(k, String(v)); } catch (e) { /* */ } }
function stamped(st) { return st && typeof st.dcrNav === "number" ? st.dcrNav : null; }
function isSignInPage() {
  const p = String(location.pathname || "");
  if (/\/$/.test(p) || p === "") return true;
  const leaf = p.slice(p.lastIndexOf("/") + 1);
  return /^(index|change-password)\.html$/i.test(leaf) || leaf.indexOf(".") === -1;
}
function navPosition() {
  let idx = stamped(history.state);
  if (idx === null) {
    idx = navNum(navGet(NAV_LAST)) + 1;
    try { history.replaceState(Object.assign({}, history.state || {}, { dcrNav: idx }), ""); } catch (e) { /* */ }
    navSet(NAV_MAX, idx);
  }
  navSet(NAV_LAST, idx);
  return idx;
}
if (HAS_DOM) {
  ["pushState", "replaceState"].forEach((name) => {
    const orig = history[name];
    if (typeof orig !== "function") return;
    history[name] = function (st, title, url) {
      const idx = name === "replaceState" ? stamped(history.state) : navNum(navGet(NAV_LAST)) + 1;
      if (idx !== null) {
        try { st = Object.assign({}, st || {}, { dcrNav: idx }); } catch (e) { /* */ }
        if (name === "pushState") { navSet(NAV_LAST, idx); navSet(NAV_MAX, idx); }
      }
      return orig.call(history, st, title, url);
    };
  });
  if (!isSignInPage()) navPosition();
}

export default DCR2;
