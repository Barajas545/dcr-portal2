/* The printable project status report (port of the old report-pm.html / .js; MODULES §5a "report-pm.html").
   The same data and the same chart engine as pm.html (js/pm-chart.js), on paper: the letterhead, the
   chart scaled to the page (no lane labels), the item table with its totals.

   Money (BLUEPRINT 2.1 principle 8, P5 acceptance check 1): a person without the prices switch gets the
   worksite copy and nothing else - repo/pm.js never read an amount for them, the table has no money
   column at all (not empty ones), and the words people typed are masked. A person with prices prints the
   full copy, or ticks "Hide prices (worksite copy)": the chart and table are drawn again from a payload with
   every amount taken out AND every typed word masked again (map/pm.js worksitePayload), so not even the page's
   own HTML keeps one - an item named "credit asked $1,200" prints "(amount hidden)". Every worksite copy is drawn
   that way (the project's own words too). Billed and paid need the financials switch too. On a phone the item
   table scrolls inside its sheet. */

import { boot, el, esc, errorText, maskFor, qs, D } from "./shell.js";
import * as pmRepo from "../repo/pm.js";
import * as C from "../pm-chart.js";
import { seesPrices, worksitePayload } from "../map/pm.js";
import { ymd, fmtDay } from "../map/pacific.js";

const state = { me: null, pid: null, payload: null, worksite: false };

function co() {
  const c = (D().companyInfo) || ((window.DCR2_CONFIG || {}).COMPANY) || {};
  return Object.assign({ name: "DCR", legalName: "", logo: "icons/logo.jpg", address: "", phone: "", license: "" }, c);
}

function flagWords(l) {
  const f = l.flag;
  if (!f || f.state !== "important") return "";
  return " · ⚑ " + (f.note || "Important") + (f.due ? " (due " + C.fmtDay(f.due) + ")" : "");
}

function render() {
  // a worksite copy (ticked, or a person without prices) is drawn from the masked payload: no "$" on the sheet
  const payload = state.worksite || !seesPrices(state.me) ? worksitePayload(state.payload) : state.payload;
  const m = C.derive(payload, { expandedA: true, expandedB: true });
  const proj = m.project;
  const prices = !m.pricesHidden;
  const money = m.showMoney;
  const L = C.layout(m, { compact: true, labels: false });
  const lanes = m.lanes;
  const $ = function (n) { return C.money(n || 0); };
  const $0 = function (n) { return n ? C.money(n) : "—"; };              // nothing awarded / billed / paid yet
  const c = co();

  const rows = lanes.map(function (l) {
    const awardedTo = [];
    l.quotes.forEach(function (q) {
      if (q.status === "awarded") awardedTo.push(q.vendor);
      if (q.status === "self") awardedTo.push("Self-performed");
    });
    const nQuotes = l.quotes.filter(function (q) { return q.status !== "self"; }).length;
    const cos = l.quotes.filter(function (q) { return q.kind === "change_order"; }).length;
    return "<tr><td><span class=\"gdot\" style=\"background:var(--gc" + (l.colorSlot || 0) + ')"></span>' + esc(l.name) +
        (l.groupName ? ' <span class="mut">· ' + esc(l.groupName) + "</span>" : "") + "</td>" +
      "<td>" + esc(l.estimateName) + "</td>" +
      "<td>" + esc(l.assignees.map(function (a) { return a.name; }).join(", ") || "—") + "</td>" +
      '<td class="num">' + nQuotes + (cos ? ' <span class="mut">(' + cos + " CO)</span>" : "") + "</td>" +
      "<td>" + esc(awardedTo.join(", ") || "—") + "</td>" +
      (prices ? '<td class="num">' + (l.estTotal != null ? $(l.estTotal) : "") + '</td><td class="num">' + $0(l.awarded) + "</td>" : "") +
      (money ? '<td class="num">' + $0(l.billed) + '</td><td class="num">' + $0(l.paidOut) + "</td>" : "") +
      "<td>" + esc(C.laneStatus(l, money) + flagWords(l)) + "</td></tr>";
  }).join("");
  const tot = { est: 0, aw: 0, bil: 0, paid: 0 };
  lanes.forEach(function (l) { tot.est += l.estTotal || 0; tot.aw += l.awarded || 0; tot.bil += l.billed || 0; tot.paid += l.paidOut || 0; });
  const totRow = prices
    ? '<tr class="tot"><td colspan="5">Totals</td><td class="num">' + $(tot.est) + '</td><td class="num">' + $(tot.aw) + "</td>" +
      (money ? '<td class="num">' + $(tot.bil) + '</td><td class="num">' + $(tot.paid) + "</td>" : "") + "<td></td></tr>"
    : "";

  el("rpSheet").innerHTML =
    '<div class="lh">' + (c.logo ? '<img src="' + esc(c.logo) + '" alt="">' : "") +
      '<div class="co">' + esc(c.legalName || c.name) + (c.address ? "<br>" + esc(c.address) : "") +
        (c.phone ? "<br>" + esc(c.phone) : "") + (c.license ? " · " + esc(c.license) : "") + "</div>" +
      '<div class="sp"></div><div class="ttl"><b>PROJECT STATUS</b><br><span style="font-size:12.5px">' +
        esc([proj.number, proj.name].filter(Boolean).join(" — ")) + "</span><br>" +
        '<span style="font-size:11px" class="mut">' + esc(fmtDay(m.today)) + "</span>" +
        (prices ? "" : '<br><span class="wk">WORKSITE COPY · NO PRICES</span>') + "</div></div>" +
    '<div class="meta">' + esc([proj.address, proj.city, proj.client].filter(Boolean).join(" · ")) +
      " · Stage: <b>" + esc(m.statusLabel) + "</b> · Overall <b>" + m.overall + "%</b></div>" +
    '<div class="chartwrap">' + C.svg(m, L, { interactive: false }) + "</div>" +
    "<h2>Estimate items — " + lanes.length + "</h2>" +
    (lanes.length
      ? '<div class="tblwrap"><table><thead><tr><th>Item</th><th>Estimate / CO</th><th>Assigned</th><th class="num">Quotes</th><th>Awarded to</th>' +
        (prices ? '<th class="num">Estimate</th><th class="num">Awarded</th>' : "") +
        (money ? '<th class="num">Billed to us</th><th class="num">Paid out</th>' : "") +
        "<th>Status</th></tr></thead><tbody>" + rows + totRow + "</tbody></table></div>"
      : '<div class="mut" style="font-size:12px">No estimate items yet.</div>') +
    '<div class="foot"><span>' + esc(c.name) + " · generated " + esc(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })) + "</span>" +
      "<span>" + esc([proj.number, proj.name].filter(Boolean).join(" — ")) + "</span></div>";
  document.title = "DCR Project Status — " + (proj.number || "");
}

async function init() {
  const me = await boot(null);
  state.me = me;
  const pid = qs("id");
  el("rpPrint").addEventListener("click", function () { window.print(); });
  if (!pid || !/^\d{1,15}$/.test(pid)) { el("rpSheet").innerHTML = '<div class="rp-loading">No project selected.</div>'; return; }
  state.pid = pid;
  el("rpBack").href = "pm.html?id=" + encodeURIComponent(pid);
  if (seesPrices(me)) {
    el("rpHideWrap").hidden = false;
    state.worksite = qs("copy") === "worksite";
    el("rpHideMoney").checked = state.worksite;
    el("rpHideMoney").addEventListener("change", function () { state.worksite = this.checked; render(); });
  }
  try {
    const got = await pmRepo.load(pid, me, { mask: maskFor(me), today: ymd(new Date()) });
    state.payload = got.payload;
  } catch (e) {
    el("rpSheet").innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
    return;
  }
  render();
}

if (typeof document !== "undefined") {
  init().catch(function (e) {
    if (e && /not signed in|not for this role/.test(e.message || "")) return;
    const s = document.getElementById("rpSheet");
    if (s) s.innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
  });
}
