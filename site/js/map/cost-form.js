/* The Add / Edit cost form's rules (project Expenses tab; owner decision 2026-10-24 D13): exactly DCR Desktop 2's
   CostDialog (dcrdesk/ui/pages/project/money_dialogs.py) — the same kinds, the labour rule, the same sentences.

   * Labour by the hour: hours > 0 and a rate > 0 make the amount hours × rate (to the cent, half up — the database's
     t10_costs works it out the same way and has the last word); the Amount box is then filled and locked.
   * Checks (validate): a date ("Pick the date of the cost."); labour hours without a rate and no amount ("Enter the
     hourly rate."); a new cost with no value ("Enter the amount (or hours and rate)."); a description or a vendor
     ("Say what this cost was."); and the column limits: hours and rate never negative, the amount under ten billion.
     An amount may be negative: a return or a credit — costs have no delete, a wrong one is corrected or credited.
   * What is sent (payload): a new cost — project, kind, date and amount, the words only when typed, hours and rate
     only when both are, the estimate line only when one is picked, "Paid with" only when it is not "Not tagged
     yet"; an edit — only the columns that changed (hours and rate cleared are sent as NULL, or the database would
     go on working the amount out from them).
   Pure module: no DOM, no network (node tests import it). */

import { KINDS, CARDS } from "./ledger.js";

export const CARD_IDS = Object.freeze(CARDS.map((c) => c.id));
export const LIMIT = 1e10;                                   // numeric(12,2)
export const MAX_RECEIPT_BYTES = 25 * 1024 * 1024;
/** the receipt pickers' accept list: photos and scans (an iPhone's HEIC too) and PDFs */
export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/heic,image/heif,image/webp,image/gif,image/tiff,application/pdf";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v) => String(v == null ? "" : v).trim();

/** A typed number ("1,250.50", "$95", " ") -> a number, 0 for blank, NaN for anything else. */
export function num(v) {
  if (typeof v === "number") return v;
  const t = text(v).replace(/[$,\s]/g, "");
  if (!t) return 0;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

/** To the cent, half away from zero (as numeric's round(x, 2)). */
export function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return NaN;
  const s = x < 0 ? -1 : 1;
  return s * Math.round(Number(Math.abs(x) + "e2")) / 100;
}

/** hours × rate to the cent: hours to the thousandth (numeric(12,3)), the rate to the cent, multiplied exactly. */
export function laborAmount(hours, rate) {
  const h = Math.round(Number(Math.abs(num(hours)) + "e3"));
  const r = Math.round(Number(Math.abs(num(rate)) + "e2"));
  return Math.round((h * r) / 1000) / 100;
}

export function isLabor(form) { return text(form && form.kind) === "labor"; }

/** Labour with hours and a rate: the amount is worked out (and the box locked). */
export function byTheHour(form) {
  return isLabor(form) && num(form.hours) > 0 && num(form.rate) > 0;
}

/** What the form says the cost is. */
export function costValue(form) {
  return byTheHour(form) ? laborAmount(form.hours, form.rate) : round2(num(form && form.amount) || 0);
}

/** The form -> the cost's columns as DCR Desktop 2 reads them (read_columns). */
export function columns(form) {
  const f = form || {};
  const labor = isLabor(f);
  const h = num(f.hours), r = num(f.rate);
  const line = text(f.estimate_item_id);
  return {
    kind: KINDS.indexOf(text(f.kind)) === -1 ? "other" : text(f.kind),
    cost_date: text(f.cost_date),
    description: text(f.description),
    vendor: text(f.vendor),
    amount: costValue(f),
    hours: labor && h > 0 ? Math.round(Number(h + "e3")) / 1000 : null,
    rate: labor && r > 0 ? round2(r) : null,
    estimate_item_id: line ? (/^\d+$/.test(line) ? Number(line) : line) : null,
    card: text(f.card) || "untagged",
  };
}

/** {field: sentence} for what is wrong, or null. editing: an existing cost (a zero value is then allowed). */
export function validate(form, editing) {
  const f = form || {};
  const errs = {};
  const day = text(f.cost_date);
  if (!DAY.test(day) || isNaN(Date.parse(day + "T12:00:00Z"))) errs.cost_date = "Pick the date of the cost.";
  const h = num(f.hours), r = num(f.rate), a = num(f.amount);
  if (isLabor(f)) {
    if (Number.isNaN(h)) errs.hours = "Hours must be a number.";
    else if (h < 0) errs.hours = "Hours can't be negative.";
    if (Number.isNaN(r)) errs.rate = "The rate must be a number.";
    else if (r < 0) errs.rate = "The rate can't be negative.";
    else if (h > 0 && r <= 0 && !(a !== 0 && !Number.isNaN(a))) errs.rate = "Enter the hourly rate.";
  }
  if (Number.isNaN(a) && !byTheHour(f)) errs.amount = "The amount must be a number.";
  else if (Math.abs(costValue(f)) >= LIMIT) errs.amount = "That amount is too large.";
  else if (!editing && costValue(f) === 0) errs.amount = "Enter the amount (or hours and rate).";
  if (!text(f.description) && !text(f.vendor)) errs.description = "Say what this cost was.";
  if (CARD_IDS.indexOf(text(f.card) || "untagged") === -1) errs.card = "Pick how it was paid.";
  return Object.keys(errs).length ? errs : null;
}

const same = (a, b) => (a === null || a === undefined || a === "" ? null : a) === (b === null || b === undefined || b === "" ? null : b);
const numSame = (a, b) => (a === null || a === undefined || a === "") ? (b === null || b === undefined || b === "")
  : (b !== null && b !== undefined && b !== "" && Number(a) === Number(b));

/** What to send. opts: {projectId} for a new cost; {editing: true, before: the raw costs row} for an edit (only
    the changed columns; {} when nothing changed). */
export function payload(form, opts) {
  const o = opts || {};
  const c = columns(form);
  if (!o.editing) {
    const out = { project_id: o.projectId, kind: c.kind, cost_date: c.cost_date, amount: c.amount };
    if (c.description) out.description = c.description;
    if (c.vendor) out.vendor = c.vendor;
    if (c.hours !== null && c.rate !== null) { out.hours = c.hours; out.rate = c.rate; }
    if (c.estimate_item_id !== null) out.estimate_item_id = c.estimate_item_id;
    if (c.card !== "untagged") out.card = c.card;
    return out;
  }
  const b = o.before || {};
  const out = {};
  if (c.kind !== b.kind) out.kind = c.kind;
  if (c.cost_date !== String(b.cost_date || "").slice(0, 10)) out.cost_date = c.cost_date;
  if (!same(c.description, text(b.description))) out.description = c.description || null;
  if (!same(c.vendor, text(b.vendor))) out.vendor = c.vendor || null;
  if (!numSame(c.amount, b.amount)) out.amount = c.amount;
  if (!numSame(c.hours, b.hours)) out.hours = c.hours;
  if (!numSame(c.rate, b.rate)) out.rate = c.rate;
  if (!same(c.estimate_item_id === null ? null : String(c.estimate_item_id), b.estimate_item_id == null ? null : String(b.estimate_item_id))) {
    out.estimate_item_id = c.estimate_item_id;
  }
  if (c.card !== (text(b.card) || "untagged")) out.card = c.card;
  return out;
}

/** "IMG_4412.jpg", "image.jpg", "photo.png": a camera's own name says nothing; the queue names it "Receipt <time>". */
export function genericName(name) {
  return /^(image|img_?\d+|photo|scan|document)(\s*\(\d+\))?\.\w+$/i.test(text(name));
}

/** A receipt file this tab takes: a picture or a PDF, at most 25 MB -> "" or the sentence. */
export function receiptProblem(file) {
  if (!file || !file.size) return "That file is empty.";
  if (file.size > MAX_RECEIPT_BYTES) return "A receipt can be at most 25 MB.";
  const t = String(file.type || "").toLowerCase();
  const n = String(file.name || "").toLowerCase();
  if (t === "image/svg+xml" || /\.svgz?$/.test(n)) return "A receipt is a photo, a scan or a PDF.";
  if (t.indexOf("image/") === 0 || t === "application/pdf" || /\.(pdf|jpe?g|png|heic|heif|webp|gif|tiff?)$/.test(n)) return "";
  return "A receipt is a photo, a scan or a PDF.";
}
