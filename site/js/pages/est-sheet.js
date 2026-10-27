/* The web estimate editor's sheets (owner 2026-10-24: Q12 reversed; pages/project-estimate-edit.js mounts them): the
   item, the estimate and the group, and the conflict panel. Pure string builders — no DOM, no network
   (tests/p7-est-edit-pages.test.mjs draws them for each kind of person).

   The rules they draw (DCR Desktop 2's item editor and Estimates tab; migration 20261028000100):
   * a person without prices gets NO price box at all (never a disabled one: there is no amount to show), no notes and
     no terms; a box whose stored words quote an amount ("locked" in the database's answer) is shown as the database
     sent it - amount-free - disabled, data-masked="1", with the reason in its title, and is never sent;
   * Approved is offered only with prices; an approved estimate without prices keeps its status (the select is
     disabled), its archive and deletion, its items' type and quantities, and no item moves in or out (D5);
   * the type shows only its fields (est_logic shown_keys): the boxes of the other types stay in the form, hidden, so a
     switch back finds them;
   * the item name is a text area of its own lines (owner 2026-10-27: a name of several lines, as DCR Desktop 2's
     item editor writes it - a one-line box would join them and the next Save would rewrite the name): one row per
     line, at most NAME_ROWS, and it grows as one types (estimates.css .es-grow; project-estimate-edit.js);
   * a group is a name only (owner 2026-10-27: no group code on the web, no first item for a new group); an empty
     group is deleted from its sheet, a group with items never is;
   * number boxes are inputmode="decimal" (a phone's number pad), every control at least 44 px high (estimates.css). */

import { esc, multiline } from "./est-render.js";
import {
  ITEM_TYPES, ITEM_TYPE_LABELS, FIELD_LABELS, LOCKED_TITLE, APPROVED_HINT, QTY_KEYS, shownKeys, numText, isLocked, statusesFor,
  itemMath,
} from "../map/estimate-edit.js";
import { STATUS_LABELS, moneyText, crewText, cleanName, isChangeOrder } from "../map/estimates.js";

const LABOR_BOXES = [["labor_guys", "labor_days"], ["labor_area", "labor_qty"]];
const LABOR_PRICES = [["labor_rate", "labor_unit_price"], ["labor_markup_pct"]];
const MATERIAL_BOXES = [["material_qty", "material_area"]];
const MATERIAL_PRICES = [["material_unit_price", "material_markup_pct"]];
const PLACEHOLDER = { labor_markup_pct: "0", material_markup_pct: "0", labor_rate: "project rate" };

function attr(k, v) { return v === undefined || v === null || v === false ? "" : " " + k + (v === true ? "" : '="' + esc(v) + '"'); }

export const NAME_ROWS = 6;
/** The rows of the item name's box: one per line of the name, at least 1, at most NAME_ROWS (then it scrolls). */
export function nameRows(text) {
  return Math.min(NAME_ROWS, Math.max(1, String(text == null ? "" : text).split(/\r\n|\r|\n/).length));
}

/** One box: its label, its value, why it is read only (a locked word, an approved quantity). */
function box(key, value, o) {
  const id = "ef_" + key;
  const locked = !!o.locked;
  const ro = locked || !!o.readonly;
  const title = locked ? LOCKED_TITLE : o.readonly ? o.why || "" : "";
  const label = o.label || FIELD_LABELS[key] || key;
  const common = attr("id", id) + attr("name", key) + attr("data-key", key) + attr("disabled", ro) + attr("data-masked", locked ? "1" : null) +
    attr("title", title || null) + attr("aria-describedby", locked ? "efLockedNote" : null);
  let input;
  if (o.textarea) {
    // the HTML parser drops ONE line break right after <textarea>: words that start with one get it back this way
    const words = String(value == null ? "" : value);
    input = "<textarea" + common + attr("class", o.cls || null) + ' rows="' + (o.rows || 2) + '">' + (/^[\r\n]/.test(words) ? "\n" : "") + esc(words) + "</textarea>";
  }
  else if (o.number) input = '<input type="text" inputmode="decimal" autocomplete="off"' + common + attr("value", numText(key, value)) + attr("placeholder", PLACEHOLDER[key] || null) + ">";
  else input = '<input type="text" autocomplete="off"' + common + attr("value", value == null ? "" : value) + attr("maxlength", o.max || null) + ">";
  return '<div class="es-f" data-f="' + esc(key) + '"><label for="' + id + '"' + (o.labelId ? attr("id", o.labelId) : "") + ">" + esc(label) +
    (locked ? ' <span class="es-lock" aria-hidden="true">🔒</span>' : "") + "</label>" + input + "</div>";
}

function pairs(list, item, o) {
  return list.map(function (row) {
    return '<div class="es-f2">' + row.map(function (k) {
      const p = o.prices && item.prices ? item.prices : {};
      const v = k.indexOf("_rate") !== -1 || k.indexOf("unit_price") !== -1 || k.indexOf("markup") !== -1 ? p[k] : item[k];
      const qty = QTY_KEYS.indexOf(k) !== -1;
      return box(k, v, { number: true, readonly: qty && o.approved, why: APPROVED_HINT });
    }).join("") + "</div>";
  }).join("");
}

/** What the sheet shows of an item's work: the crew line, and with prices the money as the boxes are now. */
export function liveLineHtml(values, prices) {
  const crew = crewText(values || {});
  let money = "";
  if (prices) {
    const m = itemMath(values || {}, prices);
    money = "Labor " + moneyText(m.labor) + " · Material " + moneyText(m.material) + " · <b>Total " + moneyText(m.total) + "</b>";
  }
  return (crew ? "<span>👷 " + esc(crew) + "</span>" : "") + (money ? "<span>" + money + "</span>" : "") || "<span>No crew or quantities yet.</span>";
}

/**
 * The item sheet. item: the model's item (map/estimate-edit.js fromEditRead), or {} for a new one; opts: {prices, est
 * (its estimate), estimates (the project's, for Move to estimate), isNew, gid (a new item's group), type (the type to
 * show), canMove}.
 */
export function itemFormHtml(item, opts) {
  const o = opts || {};
  const it = item || {};
  const prices = !!o.prices;
  const est = o.est || {};
  const approved = !!est.approvedLock;
  const type = o.type || it.item_type || "labor";
  const shown = shownKeys(type);
  const lk = function (k) { return !prices && isLocked(it, k); };
  const group = o.isNew ? (est.groups || []).find(function (g) { return g.gid === o.gid; }) : null;
  let h = '<form class="es-form" id="esItemForm" autocomplete="off" novalidate data-type="' + esc(type) + '">';
  if (o.isNew) h += '<p class="es-sheet-sub">Group: <b>' + esc(group ? group.title : "General") + "</b></p>";
  h += box("name", it.name, { label: "Item name", textarea: true, rows: nameRows(it.name), cls: "es-grow", locked: lk("name") });
  h += '<div class="es-f"><label for="ef_item_type">Type</label><select id="ef_item_type" name="item_type" data-key="item_type"' +
    attr("disabled", approved && !o.isNew) + attr("title", approved && !o.isNew ? APPROVED_HINT : null) + ">" +
    ITEM_TYPES.map(function (t) { return '<option value="' + t + '"' + (t === type ? " selected" : "") + ">" + esc(ITEM_TYPE_LABELS[t]) + "</option>"; }).join("") +
    "</select></div>";

  // the labor card (a sub-contractor's line uses the labor columns: its scope, area, qty and unit price)
  h += '<fieldset class="es-part" data-part="labor"' + attr("hidden", !(shown.has("description") || shown.has("labor_qty"))) + '><legend id="efLaborLegend">' +
    (type === "sub" ? "Sub-contractor" : "Labor") + "</legend>" +
    box("description", it.description, { textarea: true, label: type === "sub" ? "Scope of work" : "Labor description", labelId: "efDescLabel", locked: lk("description") }) +
    pairs(LABOR_BOXES, it, { approved, prices }) + (prices ? pairs(LABOR_PRICES, it, { approved, prices }) : "") + "</fieldset>";
  // the material card
  h += '<fieldset class="es-part" data-part="material"' + attr("hidden", !shown.has("material_qty")) + "><legend>Material</legend>" +
    box("material_description", it.material_description, { textarea: true, locked: lk("material_description") }) +
    pairs(MATERIAL_BOXES, it, { approved, prices }) + (prices ? pairs(MATERIAL_PRICES, it, { approved, prices }) : "") + "</fieldset>";

  h += box("assigned_text", it.assigned_text, { label: "Assigned to (crew or sub)", locked: lk("assigned_text") });
  if (it.assigned_contact_id !== null && it.assigned_contact_id !== undefined && !o.isNew) {
    h += '<div class="es-f es-contact" id="efContact"><span>Contact: <b>' + esc(it.assigned_name || "a contact") + '</b></span>' +
      '<button type="button" class="es-act" data-act="clearContact">Clear</button></div>';
  }
  if (prices) {
    h += box("notes", it.notes, { textarea: true, rows: 3, label: "Notes (internal, with prices only)" });
    const q = it.prices && it.prices.quoted_price;
    if (q !== null && q !== undefined && q !== "") h += '<p class="es-sheet-sub">Quoted price ' + esc(moneyText(Math.round(Number(q) * 100))) + " (set in DCR Desktop 2)</p>";
  }
  h += '<div class="es-live" id="esLive" aria-live="polite">' + liveLineHtml(Object.assign({}, it, { item_type: type }), prices ? (it.prices || {}) : null) + "</div>";
  if (!prices && (it.locked || []).length) {
    h += '<p class="es-sheet-sub" id="efLockedNote">🔒 Boxes with a lock quote an amount: someone who sees prices changes them.</p>';
  }
  if (approved) h += '<p class="es-sheet-sub">' + esc(est.statusText || "Approved") + ": " + esc(APPROVED_HINT) + "</p>";

  if (!o.isNew) {
    const groups = (est.groups || []).filter(function (g) { return g.gid !== it.gid && (prices || !g.locked); });
    const others = (o.estimates || []).filter(function (e) { return String(e.id) !== String(est.id) && !e.archived && (prices || !e.approvedLock); });
    const here = (est.groups || []).find(function (g) { return g.gid === it.gid; });
    const fixedGroup = !prices && here && here.locked;
    h += '<div class="es-moves"><div class="es-row"><button type="button" class="es-act" data-act="up">▲ Up</button>' +
      '<button type="button" class="es-act" data-act="down">▼ Down</button></div>' +
      '<div class="es-row"><label class="es-inl" for="efToGroup">Move to group</label><select id="efToGroup"' + attr("disabled", fixedGroup) +
      attr("title", fixedGroup ? LOCKED_TITLE : null) + '><option value="">—</option>' +
      groups.map(function (g) { return '<option value="' + esc(g.gid) + '">' + esc(g.title) + "</option>"; }).join("") +
      '<option value="*new">New group…</option></select><input type="text" id="efToGroupName" placeholder="New group name" maxlength="200" hidden>' +
      '<button type="button" class="es-act" data-act="toGroup"' + attr("disabled", fixedGroup) + ">Move</button></div>" +
      (others.length ? '<div class="es-row"><label class="es-inl" for="efToEst">Move to</label><select id="efToEst"' + attr("disabled", approved) + '><option value="">—</option>' +
        others.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.label + (cleanName(e.name) ? " — " + e.name : "")) + "</option>"; }).join("") +
        '</select><button type="button" class="es-act" data-act="toEst"' + attr("disabled", approved) + ">Move</button></div>" : "") +
      "</div>";
  }
  return h + '<div class="es-err" id="esSheetErr" role="alert"></div></form>';
}

/** The estimate sheet: name, description, the terms (prices only), the status; archive / restore, duplicate (prices
    only), delete. */
export function estimateFormHtml(est, opts) {
  const o = opts || {};
  const e = est || {};
  const prices = !!o.prices;
  const statuses = statusesFor(e, prices);
  const approved = !!e.approvedLock;
  const lk = function (k) { return !prices && isLocked(e, k); };
  const co = isChangeOrder(e);
  let h = '<form class="es-form" id="esEstForm" autocomplete="off" novalidate>' +
    '<p class="es-sheet-sub">' + esc(e.label || "") + " · " + esc(e.statusText || "") + (e.archived ? " · Archived" : "") + "</p>" +
    box("name", e.name, { label: co ? "Change order name" : "Estimate name", locked: lk("name") }) +
    box("description", e.description, { textarea: true, rows: 3, label: "Description", locked: lk("description") });
  if (prices) h += box("client_notes", e.client_notes, { textarea: true, rows: 4, label: "Terms & notes (printed with prices)" });
  h += '<div class="es-f"><label for="ef_status">Status</label><select id="ef_status" name="status" data-key="status"' +
    attr("disabled", !statuses.length) + attr("title", !statuses.length ? "Approved: someone who sees prices changes its status." : null) + ">" +
    Object.keys(STATUS_LABELS).filter(function (s) { return s === e.status || statuses.indexOf(s) !== -1; }).map(function (s) {
      return '<option value="' + s + '"' + (s === e.status ? " selected" : "") + ">" + esc(STATUS_LABELS[s]) + "</option>";
    }).join("") + "</select></div>";
  if (!prices) h += '<p class="es-sheet-sub">Approved is set by someone who sees prices.</p>';
  h += '<div class="es-moves"><div class="es-row">' +
    '<button type="button" class="es-act" data-act="archive"' + attr("disabled", approved) + attr("title", approved ? "Approved: someone who sees prices archives it." : null) + ">" +
    (e.archived ? "Take out of the archive" : "Archive") + "</button>" +
    (prices ? '<button type="button" class="es-act" data-act="duplicate">Duplicate</button>' : "") +
    '<button type="button" class="es-act es-danger" data-act="delete"' + attr("disabled", approved) + attr("title", approved ? "Approved: someone who sees prices deletes it." : null) + ">Delete</button>" +
    "</div></div>";
  return h + '<div class="es-err" id="esSheetErr" role="alert"></div></form>';
}

export const DELETE_GROUP_HINT = "Move or delete its items first.";

/** The group sheet: rename, Up / Down, a new item in it; Delete for an empty group (owner 2026-10-27: a group with
    items is never deleted here - its items are moved or deleted first). opts: {prices, est}. */
export function groupFormHtml(group, opts) {
  const o = opts || {};
  const g = group || {};
  const prices = !!o.prices;
  const est = o.est || {};
  const locked = !prices && !!g.locked;
  const orderLocked = !prices && (est.groupOrderLocked || (est.groups || []).some(function (x) { return x.locked; }));
  const n = (g.items || []).length;
  let h = '<form class="es-form" id="esGrpForm" autocomplete="off" novalidate>' +
    '<p class="es-sheet-sub">' + esc(est.label || "") + " · " + (n ? n + " item" + (n === 1 ? "" : "s") : "Empty: no items yet") + "</p>";
  if (!g.name) {
    h += '<p class="es-sheet-sub">These items have no group ("General"). Move them into a group from each item.</p>';
  } else {
    h += '<div class="es-row es-f-act">' + box("group_name", g.name, { label: "Group name", locked, max: 200 }) +
      '<button type="button" class="es-act" data-act="rename"' + attr("disabled", locked) + ">Rename</button></div>";
  }
  // deleting an empty group sends the group order without its name: refused while a name in it quotes an amount
  const noDelete = n ? DELETE_GROUP_HINT : locked || orderLocked ? LOCKED_TITLE : null;
  h += '<div class="es-moves"><div class="es-row">' +
    '<button type="button" class="es-act" data-act="gup"' + attr("disabled", orderLocked) + attr("title", orderLocked ? LOCKED_TITLE : null) + ">▲ Group up</button>" +
    '<button type="button" class="es-act" data-act="gdown"' + attr("disabled", orderLocked) + attr("title", orderLocked ? LOCKED_TITLE : null) + ">▼ Group down</button>" +
    (g.addable !== false && est.addable !== false ? '<button type="button" class="es-act" data-act="addHere">＋ Item in this group</button>' : "") +
    (g.name ? '<button type="button" class="es-act es-danger" data-act="gdelete"' + attr("disabled", !!noDelete) + attr("title", noDelete) + ">Delete group</button>" : "") +
    "</div></div>";
  if (locked || orderLocked) h += '<p class="es-sheet-sub">🔒 A group here quotes an amount: someone who sees prices renames, reorders or deletes those groups.</p>';
  return h + '<div class="es-err" id="esSheetErr" role="alert"></div></form>';
}

/** The New group sheet (owner 2026-10-27): a name only - the group starts empty, its items are added with ＋ Item. */
export function newGroupFormHtml(est) {
  const e = est || {};
  return '<form class="es-form" id="esNewGrpForm" autocomplete="off" novalidate>' +
    '<p class="es-sheet-sub">' + esc(e.label || "") + ": the group starts empty; add its items with ＋ Item.</p>" +
    box("group_name", "", { label: "Group name", max: 200 }) + '<div class="es-err" id="esSheetErr" role="alert"></div></form>';
}

/** The conflict panel: one line per field both changed; [Keep theirs] [Use mine]. lines: [{label, theirs, mine}]. */
export function conflictHtml(lines, who) {
  const name = who || "Someone else";
  return '<div class="es-clash" id="esClash" role="alert"><p><b>' + esc(name) + " saved this first.</b> Pick what stays:</p><ul>" +
    (lines || []).map(function (l) {
      return "<li>" + esc(name) + " changed " + esc(l.label) + ": theirs <b>" + esc(l.theirs) + "</b> · yours <b>" + esc(l.mine) + "</b></li>";
    }).join("") + '</ul><div class="es-row"><button type="button" class="es-act" data-act="keepTheirs">Keep theirs</button>' +
    '<button type="button" class="es-act es-primary" data-act="useMine">Use mine</button></div></div>';
}

/** A sheet: its title, its body, its footer (Save / Cancel). */
export function sheetHtml(title, body, opts) {
  const o = opts || {};
  return '<div class="es-sheet-bg" data-act="close"></div><div class="es-sheet-card" role="dialog" aria-modal="true" aria-labelledby="esSheetTitle">' +
    '<div class="es-sheet-hd"><h3 id="esSheetTitle">' + esc(title) + '</h3><button type="button" class="es-x" data-act="close" aria-label="Close">✕</button></div>' +
    '<div class="es-notice" id="esSheetNotice" hidden></div><div class="es-sheet-bd">' + body + "</div>" +
    '<div class="es-sheet-ft">' + (o.danger ? '<button type="button" class="es-act es-danger" data-act="' + esc(o.danger.act) + '"' +
      attr("disabled", !!o.danger.disabled) + attr("title", o.danger.title || null) + ">" + esc(o.danger.text) + "</button>" : "") +
    '<span class="es-sp"></span><button type="button" class="es-act" data-act="close">' + esc(o.cancel || "Cancel") + "</button>" +
    (o.save === false ? "" : '<button type="button" class="es-act es-primary" data-act="save" id="esSave">' + esc(o.save || "Save") + "</button>") + "</div></div>";
}

export { multiline };
