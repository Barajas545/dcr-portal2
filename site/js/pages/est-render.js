/* The HTML of the read-only Estimate and Takeoffs tabs and of the printed Estimate, Change Order, Material
   List and Material Quote (ports of the old report-estimate.js / report-takeoff.js looks, with DCR Desktop
   2's printing/estimates.py and printing/takeoffs.py rules — the same paper from the office or a phone).

   Pure string builders: no DOM, no network (tests/p5a-estimates.test.mjs renders them for each role and
   checks that a copy without prices carries no amount at all).

   The one rule (BLUEPRINT 2.1 principle 8; P5 acceptance check 1): money is drawn only when `show` is
   true — a person with prices whose rows all came with their money (map/estimates.js moneyShown,
   map/takeoffs.js rowsPriced). Otherwise there is no amount column, no subtotal, no total, no terms and
   no signature lines, and a dollar amount typed into ANY of the words - names, descriptions, group names and
   codes, levels, categories, sub-categories, units - reads "(amount hidden)": the worksite copy. */

import {
  DASH, WORKSITE_TAG, moneyText, qtyText, pctText, wordsFor, crewText, crewPrint, ITEM_TYPES, isChangeOrder,
  estimateTitle, contractSummary, itemFlags, FLAG_LABELS, FLAG_ICONS,
} from "../map/estimates.js";
import { levelName, categoryBand, allRows, unitPrice, rowTotal, quoteTotals, rowItemName, rowUnit } from "../map/takeoffs.js";
import { fmtDay } from "../map/pacific.js";

export const DEFAULT_TERMS = "Estimate valid for 30 days. Prices include labor and materials as listed. Any changes to the " +
  "scope of work may affect the final price. A signed copy of this estimate is required to schedule work.";
export const CO_TERMS = "This change order adds to or changes the work of the original contract. All other terms of the " +
  "original contract stay the same.";
export const CO_APPROVAL = "By signing below, the client approves the change described above and the adjusted contract " +
  "total. Work on this change is scheduled once it is signed.";

export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/** Text as typed: pasted markup read as plain text (never live HTML), line endings normalised, outer
    blank lines dropped (printing/common.py plain). */
export function plain(v) {
  const s = String(v == null ? "" : v)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  const lines = s.split(/\r\n|\r|\n/).map(function (l) { return l.replace(/\s+$/, ""); });
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

/** Escaped, its line breaks kept. */
export function multiline(v) {
  return plain(v).split("\n").map(esc).join("<br>");
}

/** "October 6, 2026" for "YYYY-MM-DD". */
export function longDate(ymdText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymdText || ""));
  if (!m) return "";
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString("en-US",
    { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
}

function coBlock(co) {
  const lines = ["<b>" + esc(co.legalName || co.name) + "</b>"];
  if (co.address) lines.push(esc(co.address));
  const pf = [co.phone ? "Ph " + co.phone : "", co.fax ? "Fax " + co.fax : ""].filter(Boolean).join(" · ");
  if (pf) lines.push(esc(pf));
  if (co.license) lines.push(esc(co.license));
  if (co.website) lines.push(esc(co.website));
  if (co.email) lines.push(esc(co.email));
  return lines.join("<br>");
}

function projectLabel(p) {
  const n = (p && p.internalIDNumber) || "", name = (p && p.projectName) || "";
  return n && name ? "#" + n + " - " + name : n ? "#" + n : name;
}

/** "Pine Hollow, CA 93410" (printing/common.py city_line). */
function cityLine(p) {
  const tail = [p.projectState, p.projectZip].filter(Boolean).join(" ");
  return [p.projectCity, tail].filter(Boolean).join(", ");
}

/* ── the Estimate tab ───────────────────────────────────────────────── */

function itemTitleKey(it) {
  return ["name", "description", "material_description"].find(function (k) { return plain(it[k]).trim(); }) || null;
}

function flagChips(it, w) {
  return itemFlags(it).map(function (f) {
    const due = f.due_date ? " · due " + fmtDay(f.due_date) : "";
    const note = plain(f.note || "").trim();
    return '<span class="es-flag es-flag-' + esc(f.state) + '" title="' + esc(FLAG_LABELS[f.state] + (note ? ": " + w(note) : "") + due) + '">' +
      FLAG_ICONS[f.state] + " " + esc(FLAG_LABELS[f.state]) + (note ? " — " + esc(w(note)) : "") + esc(due) + "</span>";
  }).join("");
}

/** One item's words on screen: its title, what the title did not say, the crew line, its flags (and the
    internal notes, prices only). */
export function itemScreenHtml(it, show) {
  const w = wordsFor(show);
  const tk = itemTitleKey(it);
  const title = tk ? w(plain(it[tk])) : "(no description)";
  const rest = [];
  ["description", "material_description"].forEach(function (k) {
    if (k === tk) return;
    const t = plain(it[k]).trim();
    if (!t) return;
    let line = multilineMasked(it[k], w);
    if (k === "material_description" && qtyText(it.material_qty)) line += ' <span class="es-q">(qty ' + esc(qtyText(it.material_qty)) + ")</span>";
    rest.push(line);
  });
  if (tk === "material_description" && qtyText(it.material_qty)) rest.unshift('<span class="es-q">qty ' + esc(qtyText(it.material_qty)) + "</span>");
  const crew = crewText(it);
  const type = ITEM_TYPES[it.item_type] || "";
  const flags = flagChips(it, w);
  const notes = show && plain(it.notes).trim() ? '<div class="es-note">📝 ' + multiline(it.notes) + "</div>" : "";
  return '<div class="es-t">' + (type ? '<span class="es-type">' + esc(type) + "</span> " : "") + esc(title.split("\n")[0]) + "</div>" +
    (title.indexOf("\n") !== -1 ? '<div class="es-d">' + title.split("\n").slice(1).map(esc).join("<br>") + "</div>" : "") +
    rest.map(function (r) { return '<div class="es-d">' + r + "</div>"; }).join("") +
    (crew ? '<div class="es-crew">👷 ' + esc(crew) + "</div>" : "") +
    (flags ? '<div class="es-flags">' + flags + "</div>" : "") + notes;
}

function multilineMasked(v, w) { return plain(v).split("\n").map(function (l) { return esc(w(l)); }).join("<br>"); }

function statusChip(e) {
  const when = e.status === "approved" && e.approved_date ? " · " + fmtDay(e.approved_date)
    : e.status === "sent" && e.sent_date ? " · " + fmtDay(e.sent_date) : "";
  return '<span class="es-st es-st-' + esc(e.status) + '">' + esc(e.statusText) + esc(when) + "</span>";
}

/** The contract strip over the cards: money with prices, counts without. */
export function contractStripHtml(estimates, show) {
  const s = contractSummary(estimates);
  if (!s.estimates && !s.approvedCount && !s.pendingCount) return "";
  const n = function (k, one, many) { return k + " " + (k === 1 ? one : many); };
  if (show && s.money) {
    return '<div class="es-contract">' +
      '<div><span>Original estimates</span><b>' + esc(moneyText(s.money.original)) + "</b><i>" + esc(n(s.estimates, "estimate", "estimates")) + "</i></div>" +
      '<div><span>Approved change orders</span><b>' + esc(moneyText(s.money.approved)) + "</b><i>" + esc(n(s.approvedCount, "change order", "change orders")) + "</i></div>" +
      '<div class="es-k"><span>Contract</span><b>' + esc(moneyText(s.money.contract)) + "</b><i>estimates + approved changes</i></div>" +
      '<div><span>Pending change orders</span><b>' + esc(moneyText(s.money.pending)) + "</b><i>" + esc(n(s.pendingCount, "draft or sent", "draft or sent")) + "</i></div></div>";
  }
  return '<div class="es-contract es-nomoney">' +
    "<div><span>Estimates</span><b>" + s.estimates + "</b></div>" +
    "<div><span>Approved change orders</span><b>" + s.approvedCount + "</b></div>" +
    "<div><span>Pending change orders</span><b>" + s.pendingCount + "</b></div>" +
    '<div class="es-hid"><span>Prices</span><b>Hidden</b><i>your account does not show prices</i></div></div>';
}

/** The estimate cards (the old Estimate tab: one card per estimate, groups, items; Labor / Material /
    Total with prices). opts: {show, pid, edit}. With `edit` (the web editor, pages/project-estimate-edit.js; owner
    2026-10-24) the cards carry its hooks — "✎ Edit" on the estimate, "⋯" on a group (its database gid in data-grp,
    never its name), every item row a button, "＋ Item" under a group a person may add to (e.addable, g.addable: the
    approved lock and the locked groups without prices) and "＋ Item in a new group"; without it nothing changes. */
export function estimateCardsHtml(estimates, opts) {
  const o = opts || {};
  const show = !!o.show;
  const edit = !!o.edit;
  const m = function (c) { return c ? moneyText(c) : ""; };
  const cols = show ? 4 : 1;
  return (estimates || []).map(function (e) {
    const t = e.total;
    let html = '<div class="es-card' + (e.archived ? " es-archived" : "") + (isChangeOrder(e) ? " es-co" : "") + '" data-est="' + esc(e.id) + '">' +
      '<table class="pj-tbl es-tbl"><thead><tr class="es-head"><td>' +
      (edit ? '<button type="button" class="es-act es-edit" data-act="est" data-est="' + esc(e.id) + '" title="Name, description, status, archive, delete">✎ Edit</button>' : "") +
      '<div class="es-name">' + (isChangeOrder(e) ? "🧾 " : "📄 ") + esc(wordsFor(show)(e.displayName)) + "</div>" +
      '<div class="es-sub">' + esc(e.label) + " " + statusChip(e) + (e.archived ? ' <span class="es-st es-st-archived">Archived</span>' : "") +
      ' · <a class="es-print" href="report-estimate.html?id=' + encodeURIComponent(o.pid) + "&amp;est=" + encodeURIComponent(e.id) + '">🖨 Print</a></div>' +
      (plain(e.description).trim() ? '<div class="es-desc">' + multilineMasked(e.description, wordsFor(show)) + "</div>" : "") + "</td>" +
      (show && t ? '<td class="num es-mob-hide">' + esc(m(t.labor)) + '</td><td class="num es-mob-hide">' + esc(m(t.material)) + '</td><td class="num es-tot">' + esc(moneyText(t.total)) + "</td>" : "") + "</tr>" +
      '<tr class="es-colhead"><th>Item</th>' + (show ? '<th class="num es-mob-hide">Labor</th><th class="num es-mob-hide">Material</th><th class="num">Total</th>' : "") + "</tr></thead><tbody>";
    if (!e.items.length) html += '<tr><td colspan="' + cols + '" class="es-none">No items yet.</td></tr>';
    e.groups.forEach(function (g) {
      html += '<tr class="pj-grp"><td colspan="' + cols + '">' + esc(wordsFor(show)(g.label)) + (g.code ? ' <span class="es-code">' + esc(wordsFor(show)(g.code)) + "</span>" : "") +
        (edit ? '<button type="button" class="es-act es-grp-act" data-act="grp" data-est="' + esc(e.id) + '" data-grp="' + esc(g.gid) + '" aria-label="Group: rename, code, move">⋯</button>' : "") +
        "</td></tr>";
      g.items.forEach(function (it) {
        html += '<tr class="es-item' + (edit ? " es-item-edit" : "") + '" data-item="' + esc(it.id) + '"' +
          (edit ? ' data-act="item" data-est="' + esc(e.id) + '" tabindex="0" role="button" aria-label="Edit this item"' : "") + '><td class="pj-il">' + itemScreenHtml(it, show) + "</td>" +
          (show && it.money ? '<td class="num es-mob-hide">' + esc(m(it.money.labor)) + '</td><td class="num es-mob-hide">' + esc(m(it.money.material)) +
            '</td><td class="num"><b>' + esc(m(it.money.total)) + "</b></td>" : show ? '<td class="num es-mob-hide"></td><td class="num es-mob-hide"></td><td class="num"></td>' : "") + "</tr>";
      });
      if (edit && g.addable !== false && e.addable !== false) {
        html += '<tr class="es-add"><td colspan="' + cols + '"><button type="button" class="es-act" data-act="add" data-est="' + esc(e.id) + '" data-grp="' + esc(g.gid) + '">＋ Item</button></td></tr>';
      }
      if (show && g.total && e.groups.length > 1) {
        html += '<tr class="pj-grpTot"><td>Subtotal — ' + esc(wordsFor(show)(g.label)) + '</td><td class="num es-mob-hide">' + esc(m(g.total.labor)) +
          '</td><td class="num es-mob-hide">' + esc(m(g.total.material)) + '</td><td class="num">' + esc(moneyText(g.total.total)) + "</td></tr>";
      }
    });
    if (edit && e.addable !== false) {
      html += '<tr class="es-add es-add-grp"><td colspan="' + cols + '"><button type="button" class="es-act" data-act="addgrp" data-est="' + esc(e.id) + '">＋ Item in a new group</button></td></tr>';
    }
    return html + "</tbody></table></div>";
  }).join("");
}

/* ── the Takeoffs tab ───────────────────────────────────────────────── */

/** The takeoff cards (read only): name, date, the item it belongs to, its rows by level / category /
    sub-category; unit price and line total with prices. opts: {show, pid, open: id of the open one}. */
export function takeoffCardsHtml(takeoffs, opts) {
  const o = opts || {};
  const w = wordsFor(o.show);
  // unless one was opened, the first takeoff with rows is open
  const full = (takeoffs || []).find(function (t) { return t.lines > 0; });
  const firstFull = full ? full.id : null;
  return (takeoffs || []).map(function (t) {
    const show = !!o.show && t.priced && t.lines > 0;
    const cols = show ? 7 : 5;
    let ln = 0;
    let rows = "";
    t.levels.forEach(function (lvl) {
      rows += '<tr class="tk-lvl"><td colspan="' + cols + '">' + esc(w(levelName(lvl.name))) + "</td></tr>";
      lvl.children.forEach(function (cat) {
        if (categoryBand(cat)) rows += '<tr class="tk-cat"><td colspan="' + cols + '">' + esc(w(cat.name) || "(no category)") + "</td></tr>";
        cat.children.forEach(function (sub) {
          if (sub.name) rows += '<tr class="tk-sub"><td colspan="' + cols + '">' + esc(w(sub.name)) + "</td></tr>";
          sub.rows.forEach(function (r) {
            ln++;
            const note = plain(r.notes).trim();
            rows += "<tr><td class=\"tk-ln\">" + ln + '</td><td class="tk-qty">' + esc(qtyText(r.qty)) + '</td><td class="tk-un">' + esc(w(rowUnit(r))) + "</td>" +
              '<td class="tk-it">' + multilineMasked(rowItemName(r), w) + (note ? '<div class="es-d">' + multilineMasked(note, w) + "</div>" : "") + "</td>" +
              '<td class="tk-pu">' + esc(w(plain(r.purpose))) + "</td>" +
              (show ? '<td class="num es-mob-hide">' + esc(moneyText(unitPrice(r), true)) + '</td><td class="num">' + esc(moneyText(rowTotal(r), true)) + "</td>" : "") + "</tr>";
          });
        });
      });
    });
    const forItem = t.item && t.item.name ? '<div class="es-sub">For item: ' + esc(w(plain(t.item.name))) + (t.item.estimate_label ? " (" + esc(t.item.estimate_label) + ")" : "") + "</div>"
      : t.estimate_item_id ? '<div class="es-sub">For an estimate item</div>' : "";
    const href = "report-takeoff.html?id=" + encodeURIComponent(o.pid) + "&amp;tk=" + encodeURIComponent(t.id);
    const total = show ? quoteTotals(t.rows, 0).subtotal : null;
    return '<details class="es-card tk-card" data-tk="' + esc(t.id) + '"' + (String(o.open) === String(t.id) || (o.open === undefined && t.id === firstFull) ? " open" : "") + ">" +
      '<summary class="tk-sum"><span class="es-name">📐 ' + esc(w(plain(t.name)) || "(unnamed takeoff)") + "</span>" +
      '<span class="es-sub">' + esc(t.takeoff_date ? fmtDay(t.takeoff_date) : "") + " · " + t.lines + " line" + (t.lines === 1 ? "" : "s") +
      (show ? " · " + esc(moneyText(total)) + " before tax" : "") + "</span></summary>" +
      '<div class="tk-body">' + forItem +
      (plain(t.description).trim() ? '<div class="es-desc">' + multilineMasked(t.description, w) + "</div>" : "") +
      (plain(t.notes).trim() ? '<div class="es-d">📝 ' + multilineMasked(t.notes, w) + "</div>" : "") +
      '<div class="tk-acts"><a class="pj-btn pj-btn-sm" href="' + href + '">🖨 Material list</a>' +
      (show ? '<a class="pj-btn pj-btn-sm" href="' + href + '&amp;kind=quote">🖨 Material quote</a>' : "") + "</div>" +
      (t.lines ? '<div class="pj-tblwrap"><table class="pj-tbl tk-tbl"><thead><tr><th class="tk-ln">L#</th><th class="tk-qty">Qty</th><th class="tk-un">Unit</th><th>Item</th><th class="tk-pu">Purpose</th>' +
        (show ? '<th class="num es-mob-hide">Unit price</th><th class="num">Total</th>' : "") + "</tr></thead><tbody>" + rows + "</tbody></table></div>"
        : '<div class="pj-empty">This takeoff has no rows yet.</div>') + "</div></details>";
  }).join("");
}

/* ── the printed estimate / change order ────────────────────────────── */

function letterhead(co, title, meta, tag, tagClass) {
  return '<div class="lh">' + (co.logo ? '<img src="' + esc(co.logo) + '" alt="' + esc(co.name) + '" />' : "<span></span>") +
    '<div class="co">' + coBlock(co) + "</div></div>" +
    '<div class="rp-title"><h1>' + esc(title) + "</h1>" +
    '<div class="meta">' + meta.map(function (m) { return esc(m[0]) + ": <b>" + esc(m[1]) + "</b>"; }).join("<br>") +
    (tag ? '<br><span class="' + esc(tagClass || "doc-tag") + '">' + esc(tag) + "</span>" : "") + "</div></div>";
}

function blocks(list) {
  return '<div class="blocks">' + list.map(function (b) {
    return '<div class="blk"><h4>' + esc(b[0]) + "</h4><div>" + b[1].join("<br>") + "</div></div>";
  }).join("") + "</div>";
}

function clientBlock(p, label) {
  const lines = ["<b>" + esc(p.projectClientName || DASH) + "</b>"];
  if (p.projectPhoneNumber) lines.push(esc(p.projectPhoneNumber));
  if (p.projectEmailAddress) lines.push(esc(p.projectEmailAddress));
  return [label || "Prepared for", lines];
}

function projectBlock(p) {
  const lines = ["<b>" + esc(p.projectName || DASH) + "</b>"];
  if (p.projectAddress) lines.push(esc(p.projectAddress));
  if (cityLine(p)) lines.push(esc(cityLine(p)));
  if (p.internalIDNumber) lines.push(esc("Project #" + p.internalIDNumber));
  return ["Project", lines];
}

function statusTag(e, show) {
  if (!show) return [WORKSITE_TAG, "doc-tag"];
  if (e.status === "approved") return ["APPROVED" + (e.approved_date ? " · " + longDate(e.approved_date) : ""), "doc-tag"];
  if (e.status === "declined") return ["DECLINED", "doc-tag doc-tag-danger"];
  return ["", "doc-tag"];
}

/** One printed item: printing/estimates.py _item_cell. */
export function itemPrintHtml(it, detailed, show, notes) {
  const w = wordsFor(show);
  const words = function (k) { return plain(it[k]); };
  const parts = [];
  const name = words("name"), desc = words("description"), material = words("material_description");
  if (name) parts.push('<p class="it">' + multilineMasked(name, w) + "</p>");
  if (desc) parts.push('<p class="detail">' + multilineMasked(desc, w) + "</p>");
  if (material) {
    const q = qtyText(it.material_qty);
    parts.push("<p>" + multilineMasked(material, w) + (detailed && q ? ' <span class="detail">(qty ' + esc(q) + ")</span>" : "") + "</p>");
  }
  if (!parts.length) parts.push('<p class="muted">' + DASH + "</p>");
  if (detailed) {
    const bits = [];
    const crew = crewPrint(it);
    if (crew) bits.push(crew);
    if (show && it.money) {
      if (it.money.labor) bits.push((it.item_type === "sub" ? "Sub-contractor " : "Labor ") + moneyText(it.money.labor));
      if (it.money.material) bits.push("Material " + moneyText(it.money.material));
    }
    if (bits.length) parts.push('<p class="detail labor-detail">' + esc(bits.join("  ·  ")) + "</p>");
  }
  if (notes && show && plain(it.notes)) parts.push('<p class="note">' + multiline(it.notes) + "</p>");
  return parts.join("");
}

function linesTable(list, detailed, show, notes, sectionHeads) {
  const cols = show ? 2 : 1;
  let out = '<table class="est"><thead><tr><th>Description of work</th>' + (show ? '<th class="amt">Amount</th>' : "") + "</tr></thead>";
  list.forEach(function (e) {
    if (sectionHeads) out += '<tbody class="est-band"><tr class="estb"><td colspan="' + cols + '">' + esc(wordsFor(show)(estimateTitle(e))) + "</td></tr></tbody>";
    if (!e.groups.length) out += '<tbody><tr><td colspan="' + cols + '"><p class="empty">This estimate has no items yet.</p></td></tr></tbody>';
    e.groups.forEach(function (g) {
      out += '<tbody class="group-block">';
      out += show && !detailed && g.total
        ? '<tr class="grp"><td>' + esc(wordsFor(show)(g.title)) + '</td><td class="amt">' + esc(moneyText(g.total.total)) + "</td></tr>"
        : '<tr class="grp"><td colspan="' + cols + '">' + esc(wordsFor(show)(g.title)) + "</td></tr>";
      g.items.forEach(function (it) {
        out += "<tr><td>" + itemPrintHtml(it, detailed, show, notes) + "</td>" +
          (show ? '<td class="amt">' + (detailed && it.money ? esc(moneyText(it.money.total, true)) : "") + "</td>" : "") + "</tr>";
      });
      if (show && detailed && g.total) out += '<tr class="sub"><td>Subtotal — ' + esc(g.title) + '</td><td class="amt">' + esc(moneyText(g.total.total)) + "</td></tr>";
      out += "</tbody>";
    });
    if (sectionHeads && show && e.total) {
      out += '<tbody><tr class="sub"><td>Total — ' + esc(estimateTitle(e)) + '</td><td class="amt">' + esc(moneyText(e.total.total)) + "</td></tr></tbody>";
    }
  });
  return out + "</table>";
}

function totalsTable(rows) {
  return '<table class="tot"><tbody>' + rows.map(function (r) {
    return '<tr class="' + esc(r[2] || "") + '"><td>' + esc(r[0]) + '</td><td class="amt">' + esc(r[1]) + "</td></tr>";
  }).join("") + "</tbody></table>";
}

function termsBox(text, label) {
  return '<div class="terms" contenteditable="true" spellcheck="false"><h4>' + esc(label || "Terms & notes") + "</h4>" + multiline(text) + "</div>";
}

function sigLines(pairs) {
  return pairs.map(function (p) { return '<div class="sig"><div>' + esc(p[0]) + "</div><div>" + esc(p[1]) + "</div></div>"; }).join("");
}

function sheetFoot(co, kind, p, date) {
  return '<div class="foot">Generated ' + esc(longDate(date)) + " · " + esc(co.name) + " · " + esc(kind) +
    (projectLabel(p) ? " · " + esc(projectLabel(p)) : "") + "</div>";
}

/**
 * The printed estimate (one, or several with a GRAND TOTAL), or — one change order alone — the change
 * order with its contract figures (the database's). opts: {show (money shown), detailed (true) | simple,
 * notes (the internal item notes; prices only), company, date ("YYYY-MM-DD")}. -> {html, title}
 */
export function estimateSheetHtml(project, list, opts) {
  const o = opts || {};
  const p = project || {};
  const co = o.company || { name: "DCR" };
  const show = !!o.show;
  const detailed = o.detailed !== false;
  const notes = show && !!o.notes;
  const date = o.date || "";
  if (list.length === 1 && isChangeOrder(list[0])) return changeOrderSheet(p, list[0], o);
  const single = list.length === 1;
  const e0 = list[0] || {};
  const meta = [];
  if (single && e0.number !== null && e0.number !== undefined) meta.push(["Estimate #", String(e0.number)]);
  meta.push(["Date", longDate(date)], ["Project #", p.internalIDNumber || DASH]);
  const tag = single ? statusTag(e0, show) : show ? ["", ""] : [WORKSITE_TAG, "doc-tag"];
  let body = letterhead(co, "ESTIMATE", meta, tag[0], tag[1]) + blocks([clientBlock(p), projectBlock(p)]);
  if (single) {
    body += '<p class="h2">' + esc(wordsFor(show)(estimateTitle(e0))) + "</p>";
    if (plain(e0.description)) body += '<p class="muted">' + multilineMasked(e0.description, wordsFor(show)) + "</p>";
  }
  body += linesTable(list, detailed, show, notes, !single);
  if (show) {
    const total = list.reduce(function (s, e) { return s + (e.total ? e.total.total : 0); }, 0);
    body += totalsTable([[single ? "TOTAL" : "GRAND TOTAL", moneyText(total), "grand"]]);
    body += termsBox((single && plain(e0.client_notes)) || DEFAULT_TERMS);
    body += sigLines([["Client signature / date", co.name + " / date"]]);
  }
  const name = single ? estimateTitle(e0) : "Estimates";
  return {
    html: body + sheetFoot(co, show ? "Estimate" : "Estimate (worksite copy)", p, date),
    title: ("Estimate — " + (p.internalIDNumber || "") + " " + wordsFor(show)(name)).trim(),
  };
}

function changeOrderSheet(p, e, o) {
  const co = o.company || { name: "DCR" };
  const show = !!o.show;
  const detailed = o.detailed !== false;
  const notes = show && !!o.notes;
  const date = o.date || "";
  const w = wordsFor(show);
  const meta = [];
  if (e.co_number !== null && e.co_number !== undefined) meta.push(["Change order #", String(e.co_number)]);
  meta.push(["Date", longDate(date)], ["Project #", p.internalIDNumber || DASH]);
  const tag = statusTag(e, show);
  let body = letterhead(co, "CHANGE ORDER", meta, tag[0], tag[1]) + blocks([clientBlock(p, "Client"), projectBlock(p)]);
  const heading = e.co_number !== null && e.co_number !== undefined ? "Change Order #" + e.co_number : (plain(e.name) || "Change Order");
  body += '<p class="h2">' + esc(heading) + "</p>";
  const name = plain(e.name);
  if (name && name.toLowerCase() !== heading.toLowerCase()) body += '<p class="h3">' + multilineMasked(name, w) + "</p>";
  if (plain(e.description)) body += '<p class="muted">' + multilineMasked(e.description, w) + "</p>";
  body += linesTable([e], detailed, show, notes, false);
  if (show) {
    // the database's contract figures (estimate_print: original, previous approved change orders, this one)
    const f = e.contract || { original: null, previous: 0, self: e.total ? e.total.total : 0, newTotal: null };
    const rows = [];
    if (f.original !== null) {
      rows.push(["Original contract", moneyText(f.original), ""]);
      rows.push(["Previous change orders", moneyText(f.previous), ""]);
    }
    rows.push(["This change order", moneyText(f.self), rows.length ? "strong" : "grand"]);
    if (f.original !== null && f.newTotal !== null) rows.push(["NEW CONTRACT TOTAL", moneyText(f.newTotal), "grand"]);
    // the contract figures, the terms, the approval wording and the three signature lines are ONE block that never
    // splits (the terms and the approval side by side): the signatures are always on the sheet of the amount they
    // approve, and with the tighter sheet (.co-sheet in report-estimate.html) a short change order is one Letter page
    body += '<div class="co-sign">' + totalsTable(rows) + '<div class="co-two">' + termsBox(plain(e.client_notes) || CO_TERMS) +
      '<div class="terms appr"><h4>Client approval</h4>' + esc(CO_APPROVAL) + "</div></div>" +
      sigLines([["Client signature", "Date"], ["Printed name", "Title"], [co.name + " — authorized signature", "Date"]]) + "</div>";
  }
  return {
    html: '<div class="co-sheet">' + body + sheetFoot(co, show ? "Change order" : "Change order (worksite copy)", p, date) + "</div>",
    title: ("Change Order — " + (p.internalIDNumber || "") + " " + heading).trim(),
  };
}

/* ── the printed Material List / Material Quote ─────────────────────── */

/**
 * opts: {quote (the person sees prices AND every printed row carries its price — the caller checks),
 * rate (settings.tax_rate), company, date ("YYYY-MM-DD"), stamp (the footer's printed-at words)}.
 * -> {html, title, lines}
 */
export function takeoffSheetHtml(project, takeoffs, opts) {
  const o = opts || {};
  const p = project || {};
  const co = o.company || { name: "DCR" };
  const quote = !!o.quote;
  const w = wordsFor(quote);
  const list = (takeoffs || []).filter(Boolean);
  const printed = [];
  list.forEach(function (t) { t.rows.forEach(function (r) { printed.push(r); }); });
  const cols = quote ? 7 : 5;
  const word = quote ? "Material Quote" : "Material List";
  const num = p.internalIDNumber || "";
  let body = '<div class="ml-top"><div class="ml-topl"><div class="ml-h1">' + esc(word) + "</div>" +
    '<div class="ml-meta"><b>Project:</b> ' + esc(projectLabel(p) || DASH) + "<br>" +
    "<b>Address:</b> " + esc([p.projectAddress, p.projectCity].filter(Boolean).join(" - ") || DASH) + "<br>" +
    "<b>Date:</b> " + esc(longDate(o.date)) +
    (quote ? "<br><b>Prepared for:</b> " + esc(p.projectClientName || DASH) : "") + "</div></div>" +
    '<div class="ml-logo"><div class="ml-co">' + coBlock(co) + "</div>" + (co.logo ? '<img src="' + esc(co.logo) + '" alt="' + esc(co.name) + '" />' : "") + "</div></div>";
  // the takeoff's own words go under its band (one takeoff: the description, the item it is for, its date)
  const extraOf = function (t) {
    const extra = [];
    if (plain(t.description)) extra.push(multilineMasked(t.description, w));
    if (t.item && t.item.name) extra.push("For item: " + esc(w(plain(t.item.name))) + (t.item.estimate_label ? " (" + esc(t.item.estimate_label) + ")" : ""));
    if (t.takeoff_date) extra.push(esc(longDate(t.takeoff_date)));
    return extra.length ? '<div class="ml-tkx">' + extra.join(" · ") + "</div>" : "";
  };
  if (list.length === 1) body += '<div class="ml-tkl">Takeoff Name:</div>';
  if (!printed.length) {
    body += (list.length === 1 ? '<div class="ml-band ml-tk">' + esc((num ? "#" + num + " - " : "") + (w(plain(list[0].name)) || "Takeoff")) + "</div>" + extraOf(list[0]) : "") +
      '<div class="ml-none">' + (list.length === 1 ? "This takeoff has no rows yet." : "These takeoffs have no rows yet.") + "</div>";
  }
  let ln = 0;
  list.forEach(function (t) {
    if (!t.rows.length) return;
    const name = w(plain(t.name)) || "Takeoff";
    body += '<div class="ml-band ml-tk">' + esc(num ? "#" + num + " - " + name : name) + "</div>" + extraOf(t);
    let tkTotal = 0;
    t.levels.forEach(function (lvl, li) {
      let trs = "";
      lvl.children.forEach(function (cat) {
        if (categoryBand(cat)) trs += '<tr class="ml-cat"><td colspan="' + cols + '">' + esc(w(cat.name) || "(no category)") + "</td></tr>";
        cat.children.forEach(function (sub) {
          if (sub.name) trs += '<tr class="ml-sub"><td colspan="' + cols + '">' + esc(w(sub.name)) + "</td></tr>";
          sub.rows.forEach(function (r) {
            ln++;
            const note = plain(r.notes);
            trs += '<tr><td class="c-ln">' + ln + '</td><td class="c-qty">' + esc(qtyText(r.qty)) + '</td><td class="c-un">' + esc(w(rowUnit(r))) + "</td>" +
              '<td class="c-it">' + multilineMasked(rowItemName(r), w) + (note ? '<div class="c-note">' + multilineMasked(note, w) + "</div>" : "") + "</td>" +
              '<td class="c-pu">' + esc(w(plain(r.purpose))) + "</td>" +
              (quote ? '<td class="c-amt">' + esc(moneyText(unitPrice(r), true)) + '</td><td class="c-amt">' + esc(moneyText(rowTotal(r), true)) + "</td>" : "") + "</tr>";
          });
        });
      });
      if (quote) {
        const lt = allRows(lvl).reduce(function (s, r) { return s + rowTotal(r); }, 0);
        tkTotal += lt;
        trs += '<tr class="ml-subtot"><td colspan="' + (cols - 1) + '">Subtotal — ' + esc(w(levelName(lvl.name))) + '</td><td class="c-amt">' + esc(moneyText(lt)) + "</td></tr>";
        if (list.length > 1 && li === t.levels.length - 1) {
          trs += '<tr class="ml-subtot"><td colspan="' + (cols - 1) + '">Takeoff total — ' + esc(name) + '</td><td class="c-amt">' + esc(moneyText(tkTotal)) + "</td></tr>";
        }
      }
      // the widths live on <col>: with table-layout fixed the first row (the level band, one cell) would set none
      body += '<table class="ml' + (quote ? " q" : "") + '"><colgroup><col class="c-ln"><col class="c-qty"><col class="c-un"><col class="c-it"><col class="c-pu">' +
        (quote ? '<col class="c-amt"><col class="c-amt">' : "") + "</colgroup>" +
        '<thead><tr class="ml-lvl"><td colspan="' + cols + '">' + esc(w(levelName(lvl.name))) + "</td></tr>" +
        '<tr><th class="c-ln">L#:</th><th class="c-qty">Qty.:</th><th class="c-un"></th><th class="c-it">Item:</th><th class="c-pu">Purpose:</th>' +
        (quote ? '<th class="c-amt">Unit price</th><th class="c-amt">Total</th>' : "") + "</tr></thead><tbody>" + trs + "</tbody></table>";
    });
  });
  if (quote && printed.length) {
    const q = quoteTotals(printed, o.rate);
    body += '<table class="tot ml-tot"><tbody>' +
      '<tr><td>Subtotal</td><td class="amt">' + esc(moneyText(q.subtotal)) + "</td></tr>" +
      "<tr><td>Sales tax (" + esc(pctText(q.ratePct)) + ')</td><td class="amt">' + esc(moneyText(q.tax)) + "</td></tr>" +
      '<tr class="grand"><td>GRAND TOTAL</td><td class="amt">' + esc(moneyText(q.total)) + "</td></tr></tbody></table>" +
      '<p class="ml-small">Prices are estimates for the materials listed and may change with supplier pricing. Sales tax at the rate shown.</p>';
  }
  const title = word + " — " + (num + " " + (list.length === 1 ? (w(plain(list[0].name)) || "Takeoff") : "Takeoffs")).trim();
  return {
    html: body + '<div class="foot"><span>' + esc(o.stamp || longDate(o.date)) + "</span><span>" + ln + " line" + (ln === 1 ? "" : "s") +
      " · " + esc(co.name) + " · " + esc(word) + "</span></div>",
    title, lines: ln,
  };
}
