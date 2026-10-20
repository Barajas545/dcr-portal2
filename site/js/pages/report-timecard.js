/* The printable weekly Time Card (port of the old report-timecard.html / .js, itself the web form of
   Access' AccountingTimeSheetIndividualONTimeCARD; MODULES §4).

   An employee in scope (my_roster, then those who have left — "(left)" — so a final week can still
   be printed) and a Saturday-to-Friday week — this week, last week or any other (?emp=<employee
   id>&week=<YYYY-MM-DD>, as Team Sheets links it) — on a white sheet: each day with its jobs,
   schedule and work, the day's hours, the week's total, two signature lines. The week is the
   company's (America/Los_Angeles): a Friday evening never slips into next week. A ?emp= that names
   nobody this person may read shows "Choose an employee" — never somebody else's card. */

import { boot, el, esc, errorText, qs, setQs, D } from "./shell.js";
import { companyToday } from "../common2.js";
import * as tsRepo from "../repo/timesheets.js";
import * as employees from "../repo/employees.js";
import { weekDays, scheduleText, hoursText, shortDay, kindWord, withFormer, personLabel } from "../map/timesheets.js";
import { saturdayOfYmd, addDays } from "../map/pacific.js";

const state = { roster: [], emp: "", sat: "", entries: [], seq: 0 };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function company() {
  const c = (D().companyInfo) || ((window.DCR2_CONFIG || {}).COMPANY) || {};
  return Object.assign({ name: "DCR", legalName: "", logo: "icons/logo.jpg", address: "", phone: "", fax: "", license: "" }, c);
}
function coBlock(c) {
  const lines = ["<b>" + esc(c.legalName || c.name) + "</b>"];
  if (c.address) lines.push(esc(c.address));
  const pf = [c.phone ? "Ph " + c.phone : "", c.fax ? "Fax " + c.fax : ""].filter(Boolean).join(" · ");
  if (pf) lines.push(esc(pf));
  if (c.license) lines.push(esc(c.license));
  return lines.join("<br>");
}

function weekFromSelect() {
  const v = el("tcWeek").value;
  const thisSat = saturdayOfYmd(companyToday());
  if (v === "last") return addDays(thisSat, -7);
  if (v === "pick") return /^\d{4}-\d{2}-\d{2}$/.test(el("tcDate").value) ? saturdayOfYmd(el("tcDate").value) : thisSat;
  return thisSat;
}

function render() {
  const sheet = el("tcSheet");
  const emp = state.roster.find(function (r) { return String(r.id) === String(state.emp); });
  if (!emp) { sheet.innerHTML = '<div class="rp-loading">Choose an employee above.</div>'; return; }
  const c = company();
  const days = weekDays(state.sat);
  const fri = days[6];
  document.title = "DCR Time Card — " + emp.full_name;
  let total = 0;
  const rows = days.map(function (d) {
    const list = state.entries.filter(function (e) { return e.date === d && String(e.employeeId) === String(emp.id); });
    let dayHours = 0;
    const cells = list.map(function (e) {
      dayHours += e.hours;
      const sch = scheduleText(e);
      return (e.leave ? '<span class="leave">' + esc(kindWord(e.kind)) + "</span>" : esc(e.projectLabel)) +
        (sch ? '<br><span class="sub">' + esc(sch) + "</span>" : "") +
        (e.work ? '<br><span class="sub">' + esc(e.work) + "</span>" : "");
    }).join("<hr>");
    total += dayHours;
    const [y, m, dd] = d.split("-").map(Number);
    return "<tr><td style=\"width:120px\"><b>" + DAYS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()] + '</b><br><span class="sub">' + esc(shortDay(d)) + "</span></td>" +
      "<td>" + cells + '</td><td class="num">' + (dayHours ? hoursText(dayHours) : "") + "</td></tr>";
  }).join("");
  sheet.innerHTML =
    '<div class="lh"><img src="' + esc(c.logo) + '" alt="' + esc(c.name) + '" /><div class="co">' + coBlock(c) + "</div><h1>TIME CARD</h1></div>" +
    '<div class="who"><div>Employee: <b>' + esc(emp.full_name) + "</b>" + (emp.employee_no ? " · " + esc(emp.employee_no) : "") +
    (emp.active === false ? " (left)" : "") + "</div>" +
    "<div>Week: <b>" + esc(shortDay(state.sat)) + " – " + esc(shortDay(fri)) + ", " + fri.slice(0, 4) + "</b></div></div>" +
    '<table class="tc"><thead><tr><th>Day</th><th>Project / schedule / work</th><th>Hours</th></tr></thead><tbody>' + rows +
    '<tr class="tot"><td colspan="2">WEEK TOTAL</td><td class="num">' + hoursText(total) + "</td></tr></tbody></table>" +
    '<div class="sig"><div>Employee signature / date</div><div>Supervisor signature / date</div></div>' +
    '<div class="foot">Generated ' + esc(new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })) + " · " + esc(c.name) + " · Portal 2</div>";
}

function fillPicker() {
  el("tcEmp").innerHTML = '<option value="">— Choose employee —</option>' + state.roster.map(function (r) {
    return '<option value="' + esc(r.id) + '"' + (String(r.id) === state.emp ? " selected" : "") + ">" + esc(personLabel(r)) + "</option>";
  }).join("");
}

async function load() {
  const seq = ++state.seq;
  state.sat = weekFromSelect();
  setQs("week", state.sat);
  setQs("emp", state.emp || null);
  if (!state.emp) { render(); return; }
  el("tcSheet").innerHTML = '<div class="rp-loading">Loading…</div>';
  try {
    const list = await tsRepo.list(state.sat, addDays(state.sat, 6), { employeeId: state.emp });
    if (seq !== state.seq) return;
    state.entries = list;
    // anyone whose rows came back but who is not in the list yet (as the old page added every name
    // found in the rows)
    const before = state.roster.length;
    state.roster = withFormer(state.roster, list);
    if (state.roster.length !== before) fillPicker();
    render();
  } catch (e) {
    if (seq !== state.seq) return;
    el("tcSheet").innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
  }
}

async function init() {
  const me = await boot(null);
  if (["admin", "manager", "accountant", "lead"].indexOf(me.role) !== -1) el("tcBack").href = "timesheet-manager.html";
  el("tcPrint").addEventListener("click", function () { window.print(); });
  try {
    const [roster, mine, former] = await Promise.all([employees.roster(), employees.mine(me.id).catch(function () { return null; }),
      employees.former().catch(function () { return []; })]);
    state.roster = withFormer(withFormer(roster, mine ? [mine] : []), former);
    const want = qs("emp");
    if (want) {
      // named in the address (Team Sheets' "Time card"): that person, or nobody — never one's own card
      if (!state.roster.some(function (r) { return String(r.id) === want; })) {
        const one = await employees.get(want).catch(function () { return null; });
        if (one) state.roster = withFormer(state.roster, [one]);
      }
      state.emp = state.roster.some(function (r) { return String(r.id) === want; }) ? want : "";
    } else {
      const active = state.roster.filter(function (r) { return r.active !== false; });
      state.emp = active.length === 1 ? String(active[0].id) : mine ? String(mine.id) : "";
    }
  } catch (e) {
    el("tcSheet").innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
    return;
  }
  fillPicker();
  const wk = qs("week");
  const thisSat = saturdayOfYmd(companyToday());
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(wk || ""))) {
    const sat = saturdayOfYmd(wk);
    if (sat === thisSat) el("tcWeek").value = "this";
    else if (sat === addDays(thisSat, -7)) el("tcWeek").value = "last";
    else { el("tcWeek").value = "pick"; el("tcDate").hidden = false; el("tcDate").value = sat; }
  }
  el("tcEmp").addEventListener("change", function () { state.emp = el("tcEmp").value; load(); });
  el("tcWeek").addEventListener("change", function () {
    el("tcDate").hidden = el("tcWeek").value !== "pick";
    if (el("tcWeek").value === "pick" && !el("tcDate").value) el("tcDate").value = addDays(thisSat, -14);
    load();
  });
  el("tcDate").addEventListener("change", load);
  await load();
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const s = document.getElementById("tcSheet");
  if (s) s.innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
});
