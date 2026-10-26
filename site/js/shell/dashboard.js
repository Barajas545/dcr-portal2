/* The home page: the same launcher as the old portal (search, then cards by section), with only the
   modules Portal 2 has so far (P1 projects, P2 timesheets, P3 tasks). Cards are gated by role and
   switch, as the database rules them (BLUEPRINT 3.2, Appendix D); later phases add their cards here.
   The My Tasks card carries the old badge: how many of your own tasks need an update (red: somebody's
   job today), else how many are open, else the crew's, dimmed (rpc my_tasks_summary, counts only).
   An admin also sees one line about DCR Agents 2's PC: "DCR Agents 2 PC - last seen N min ago" (rpc
   agents_server_status, an admin's only; M4).
   P6: everyone has My Assistant (their personal DCR assistant: the page says "ask the office" until the
   office turns it on), with the old badge: answers not read yet, else what is due today (their own rows);
   an admin also has DCR Agents 2 (the web console: the agents, photo plans, assistants and training on the
   DCR server, with the server's dot) and Assistants (who has one, the office reading, the office's items).
   P5a: everyone has the Progress Chart (pm.html: stages, estimate items, quotes and change orders; amounts only with
   the prices switch, the money tiles with financials too).
   P5b: The Books (accounting.html) for whoever has the financials switch; and, above the cards, the bills waiting
   for approval across every project - ONLY for an approver (an admin, or a manager with the approve switch and
   financials; never an accountant): vendor, job, due day, "needs the invoice attached", the amount, and a link to the
   bill page. Read through a dynamic import (repo/books.js), so a crew phone never loads the money code.
   P5c: Sales & Marketing - Leads (admin, manager, accountant, view-only: the leads table's readers) with the old badge of
   leads nobody has called in two weeks, and Marketing Tasks (the same readers; prices only with financials); the Vehicle
   Board in Field & Time for everyone, with how many oil changes, services and papers are due this month. The badges are
   counts only and read through dynamic imports (repo/leads.js, repo/vehicles.js), so a phone loads them only here.
   P5c sales (Q10): Sales Estimates in Sales & Marketing for whoever holds the Sales estimates switch (an admin always;
   anyone else once repo/sales.js salesAccess, a dynamic import, says so).
   P5c sub form: Sub submissions in Office for the money editors (an admin, or a manager or accountant with financials -
   the readers of sub_submissions), with "N waiting" (repo/submissions.js pendingCount, a dynamic import).
   Owner decision 2026-10-26 (4): Floor Plans in Projects for the people who see prices (an admin, or Sees prices:
   map/plans.js plansCardFor), opening the takeoff app's plans (takeoff-web #plans: the Plans Archive and the plans kept
   on that device) in a new tab - a link only, nothing is asked of the database or the broker for it. */
import { requireAuth, topbar, el, companyInfo, roleLabel, companyToday } from "../common2.js";
import { PLANS_HOME, plansCardFor } from "../map/plans.js";
import { crewOf } from "../repo/employees.js";
import { summary as taskSummary } from "../repo/tasks.js";
import { summaryOf, badgeOf } from "../map/tasks.js";
import { serverStatus } from "../repo/agents.js";
import { serverLine } from "../map/agents.js";
import { page as assistantPage } from "../repo/assistant.js";
import { assistantBadge } from "../map/assistant.js";
import { drain } from "../upload-queue2.js";
import { startSweeper } from "../pages/journal-sync.js";
import { mountSwitch } from "../push2.js";
import "../install.js";

const $ = (id) => document.getElementById(id);

/** The cards this person sees, in sections. opts.hasCrew: a lead has crew rows (Batch Entry is for
    the office and for leads with a crew — MODULES §4, the old portal's isLeadOrMgr). */
export function cardsFor(p, opts) {
  const role = p.role;
  const hasCrew = !!(opts && opts.hasCrew);
  const sections = [];
  sections.push({ label: "Projects", cards: [
    { href: "board.html", ic: "📋", tt: "Project Board",
      ds: role === "admin" || role === "manager" ? "All projects by stage: drag to move, open details." : "All projects by stage; open any for details.",
      links: [["Sales view", "board.html?view=sales"], ["Marketing view", "board.html?view=marketing"], ["Accounting view", "board.html?view=accounting"]] },
    /* P5a: the progress chart (amounts only with the prices switch, the money tiles with financials too) */
    { href: "pm.html", ic: "📊", tt: "Progress Chart",
      ds: (role === "admin" || p.can_see_prices) && (role === "admin" || p.can_see_financials)
        ? "Every stage, item and dollar — bids to paid — on one chart."
        : "Every stage, estimate item and quote of a project on one chart." },
    { href: "search.html", ic: "🔎", tt: "Search", ds: "Projects, contacts, tasks and files, by name, number, address or phone." },
    /* 2026-10-26 (4): the takeoff app's plans, in a new tab (another site: ext) */
    { href: PLANS_HOME, ic: "📐", tt: "Floor Plans", ext: true, show: plansCardFor(p),
      ds: "Open plans in the takeoff app — the Plans Archive and the plans kept on this device." },
    { href: "logs.html", ic: "📜", tt: "Log History", ds: "Today's project logs, grouped by project, or any period." },
  ] });
  /* P5c: the office lists the database lets this person read (leads and marketing tasks: admin, manager, accountant,
     view-only — the old portal's rule; a marketing price needs financials) */
  const office = ["admin", "manager", "accountant", "viewer"].indexOf(role) !== -1;
  sections.push({ label: "Sales & Marketing", cards: [
    { href: "leads.html", ic: "📞", tt: "Leads", id: "hmLeads", show: office,
      ds: role === "admin" || role === "manager" ? "Sales pipeline: track contacts, convert to projects." : "The sales pipeline: who called, who to call back." },
    { href: "marketing.html", ic: "📣", tt: "Marketing Tasks", show: office,
      ds: role === "admin" || p.can_see_financials ? "Billable marketing work — done, invoiced, paid." : "Marketing work by project — done, invoiced, paid." },
    /* P5c sales (Q10): the Sales estimates switch — an admin always; anyone else once the database says so (salesCard) */
    { href: "estimates.html", ic: "💰", tt: "Sales Estimates", id: "hmSales", show: role === "admin" || !!(opts && opts.sales),
      ds: "Deck estimates from past projects, the comps library and the materials offered." },
  ] });
  const teams = ["admin", "manager", "accountant", "lead"].indexOf(role) !== -1;
  sections.push({ label: "Field & Time", cards: [
    /* first in the row: the one card that is somebody's job today; its badge says how many tasks are
       waiting for an update */
    { href: "my-tasks.html", ic: "✅", tt: "My Tasks", id: "hmMyTasks",
      ds: role === "viewer" ? "The tasks given to you and their updates." : "Your open tasks — send an update in a few taps." },
    { href: "tasks-map.html", ic: "🗺️", tt: "Tasks on Map", ds: "Open tasks by job on a map, with directions." },
    { href: "capture.html", ic: "📸", tt: "Site Photos", show: role !== "viewer",
      ds: "Photograph or film the job you're standing on, filed by day. Works with no signal." },
    { href: "timesheet.html", ic: "🕐", tt: "Time Sheet",
      ds: role === "viewer" ? "Your hours and leave days (view only)." : "Enter your daily hours, schedule, and leave days.",
      links: [["Time card", "report-timecard.html"]] },
    { href: "timesheet-manager.html", ic: "📆", tt: "Team Sheets", show: teams,
      ds: role === "accountant" ? "Everyone's week at a glance, sign-offs and the CSV for payroll (read only)."
        : role === "lead" ? "Your crew's week: hours, overtime, and your sign-off." : "Weekly grid of everyone's hours; edit any entry and sign off.",
      links: [["Time card", "report-timecard.html"]] },
    { href: "timesheet-batch.html", ic: "👥", tt: "Batch Entry", show: role === "admin" || role === "manager" || (role === "lead" && hasCrew),
      ds: "Submit time for a whole crew at once." },
    /* P5c: the fleet board (everyone reads it; the office schedules and completes services) */
    { href: "vehicles.html", ic: "🚚", tt: "Vehicles", id: "hmVehicles",
      ds: role === "admin" || role === "manager" ? "Fleet board: oil changes, services due, history." : "The trucks: oil changes and services due, and each one's history." },
  ] });
  /* P5b: the accountant's desk - the financials switch (bills, payments and invoices are refused without it) */
  if (role === "admin" || p.can_see_financials) {
    sections.push({ label: "Office", cards: [
      { href: "accounting.html", ic: "📒", tt: "The Books", id: "hmBooks",
        ds: "What is ready to enter in QuickBooks, the checks to write and who to tell, and what is already in." },
      /* P5c: what subcontractors send through the public form (submit.html) - the money editors review it (M5c) */
      { href: "submissions.html", ic: "📥", tt: "Sub submissions", id: "hmSubs",
        show: role === "admin" || ((role === "manager" || role === "accountant") && !!p.can_see_financials),
        ds: "Invoices and change orders subcontractors sent through the public form: accept as a bill or reject." },
    ] });
  }
  sections.push({ label: "You", cards: [
    /* beside Settings: the other card about the person's own day; its badge says how many answers they
       have not read, or what is due today */
    { href: "my-assistant.html", ic: "🤖", tt: "My Assistant", id: "hmMyAssistant",
      ds: "Your day, reminders and a chat with your DCR assistant." },
    { href: "settings.html", ic: "⚙️", tt: "Settings", ds: "Your name and phone, phone reminders, how Portal 2 looks, and your password." },
  ] });
  if (role === "admin" || role === "manager") {
    sections.push({ label: "Admin", cards: [
      { href: "admin.html", ic: "👷", tt: "Employees & crews",
        ds: "Everyone who logs time: phones, normal hours, the account each signs in with, and each lead's crew." },
      /* DCR Agents 2 on the DCR server computer, managed from here by every admin with their own
         account; its dot is the server's pulse (the same rpc agents_server_status as the line above) */
      { href: "agents-console.html", ic: "🛰️", tt: "DCR Agents 2", id: "hmAgentsConsole", show: role === "admin",
        ds: "Manage the reminder agents, photo plans, assistants and training on the DCR server." },
      { href: "assistant-admin.html", ic: "🤖", tt: "Assistants", show: role === "admin",
        ds: "Who has a personal assistant, whether the office reads the chat, and the office's reminders for each person." },
      { info: true, ic: "🔐", tt: "Users and roles", show: role === "admin",
        ds: "Invite people, set roles and switches, reset passwords and turn accounts off in DCR Desktop 2: Users." },
    ] });
  }
  return sections.map((s) => Object.assign(s, { cards: s.cards.filter((c) => c.show !== false) })).filter((s) => s.cards.length);
}

function render(p, opts) {
  const host = $("hmSections");
  host.innerHTML = "";
  for (const sec of cardsFor(p, opts)) {
    host.appendChild(el("div", { class: "hm-sec" }, sec.label));
    const grid = el("div", { class: "hm-cards" });
    for (const c of sec.cards) {
      const body = [el("span", { class: "ic", "aria-hidden": "true" }, c.ic), el("span", { class: "tt" }, c.tt), el("span", { class: "ds" }, c.ds)];
      const card = c.info
        ? el("div", { class: "hm-card info" }, el("div", { class: "hm-card-go" }, body))
        : el("div", { class: "hm-card", id: c.id || null }, el("a", { class: "hm-card-go", href: c.href,
          target: c.ext ? "_blank" : null, rel: c.ext ? "noopener" : null, title: c.ext ? "Opens in a new tab" : null }, body),
          c.links ? el("div", { class: "links" }, c.links.map((l) => el("a", { href: l[1] }, l[0]))) : null);
      grid.appendChild(card);
    }
    host.appendChild(grid);
  }
}

/** The My Tasks badge, drawn after the cards from the counts-only answer; any failure leaves the card. */
async function myTasksBadge() {
  let b = null;
  try { b = badgeOf(summaryOf(await taskSummary())); } catch (e) { return; }
  const card = $("hmMyTasks");
  if (!card || !b) return;
  const tt = card.querySelector(".tt");
  const old = tt.querySelector(".hm-badge");
  if (old) old.remove();
  tt.appendChild(el("span", { class: "hm-badge " + b.cls }, b.text));
}

/** The My Assistant badge (map/assistant.js assistantBadge) from the counts-only answer (rpc my_assistant
    p_summary: {enabled, unread, dueToday}); an assistant that is not on, or any failure (M6 not deployed yet,
    offline), leaves the card. */
async function myAssistantBadge() {
  let b = null;
  try { b = assistantBadge(await assistantPage({ summary: true })); } catch (e) { return; }
  const card = $("hmMyAssistant");
  if (!card || !b) return;
  const tt = card.querySelector(".tt");
  const old = tt.querySelector(".hm-badge");
  if (old) old.remove();
  tt.appendChild(el("span", { class: "hm-badge " + b.cls }, b.text));
}

/** A card's badge (counts only); a card that is not there, or no badge, leaves it. */
function cardBadge(id, b) {
  const card = $(id);
  if (!card || !b) return;
  const tt = card.querySelector(".tt");
  const old = tt.querySelector(".hm-badge");
  if (old) old.remove();
  tt.appendChild(el("span", { class: "hm-badge " + b.cls, title: b.title || null }, b.text));
}

/** P5c: Leads — "N to call" (open leads nobody has called in two weeks, red), else the open leads (dim); Vehicles —
    "N due" this month (oil changes, services and papers). Read on demand; any failure (M5c not deployed yet, offline)
    leaves the cards as they are. */
async function listBadges() {
  const today = companyToday();
  if ($("hmLeads")) {
    try {
      const [repo, map] = await Promise.all([import("../repo/leads.js"), import("../map/leads.js")]);
      const s = map.leadsSummary(await repo.loadLeads({ names: false }), today);
      cardBadge("hmLeads", s.stale ? { cls: "warn", text: s.stale + " to call", title: "Open leads nobody has called in two weeks" }
        : s.open ? { cls: "dim", text: s.open + " open" } : null);
    } catch (e) { /* no badge */ }
  }
  if ($("hmVehicles")) {
    try {
      const [repo, map] = await Promise.all([import("../repo/vehicles.js"), import("../map/vehicles.js")]);
      const d = await repo.loadFleet({ costs: false });
      const b = map.board(d.vehicles, d.maintenance, today, "");
      cardBadge("hmVehicles", b.dueCount ? { cls: "", text: b.dueCount + " due", title: "Oil changes, services and papers due this month" } : null);
    } catch (e) { /* no badge */ }
  }
  /* Sub submissions — "N waiting" (the subcontractors' invoices and change orders nobody has reviewed yet) */
  if ($("hmSubs")) {
    try {
      const repo = await import("../repo/submissions.js");
      const n = await repo.pendingCount((window.DCR2 || {}).profile);
      cardBadge("hmSubs", n ? { cls: "warn", text: n + " waiting", title: "Submissions waiting for review" } : null);
    } catch (e) { /* no badge */ }
  }
}

/** P5c (Q10): the Sales Estimates card for someone holding the Sales estimates switch. The switch is read on its own
    (repo/sales.js salesAccess, through a dynamic import: a crew phone loads it only here); no switch, M5c not deployed
    yet or offline: no card. */
async function salesCard(p, homeOpts) {
  try {
    const repo = await import("../repo/sales.js");
    const a = await repo.salesAccess(p);
    if (!a.sales) return;
    homeOpts.sales = true;
    render(p, homeOpts);
    myTasksBadge();
    myAssistantBadge();
    listBadges();
  } catch (e) { /* no card */ }
}

/** The DCR Agents 2 card's dot: green while the server reports, amber once it has gone quiet. */
function agentsConsoleDot(line) {
  const card = $("hmAgentsConsole");
  if (!card || !line) return;
  const tt = card.querySelector(".tt");
  const old = tt.querySelector(".hm-dot");
  if (old) old.remove();
  tt.appendChild(el("span", { class: "hm-dot " + line.cls, title: line.text, "aria-label": line.text }));
}

/** An admin's line about DCR Agents 2's PC; any failure (the RPC not deployed yet, offline) leaves it hidden. */
async function agentsLine() {
  let line = null;
  try { line = serverLine(await serverStatus(), new Date()); } catch (e) { return; }
  agentsConsoleDot(line);
  const box = $("hmAgents");
  if (!box || !line) return;
  box.innerHTML = "";
  box.appendChild(el("div", { class: "hm-agents " + line.cls, title: line.title || null },
    el("span", { class: "dot", "aria-hidden": "true" }), el("span", { text: line.text })));
  box.hidden = false;
}

function notes() {
  const box = $("hmNotes");
  box.innerHTML = "";
  box.appendChild(el("div", { class: "hm-note", html:
    "<b>Portal 2</b> works on the DCR Desktop 2 database. Old estimates, money and documents of projects " +
    "that came from the old portal stay there: each such project has an <b>Old portal</b> link." }));
}

/** An approver: an admin, or a manager with the approve switch and financials (app.can_approve - UI only). */
export function isApprover(p) {
  return !!p && p.active !== false && (p.role === "admin" || (p.role === "manager" && !!p.can_approve_payments && !!p.can_see_financials));
}

const AP_MAX = 8;
/** The bills waiting for approval (approvers only); nothing waiting, no access or offline: says nothing. */
async function approvalsCard(p) {
  const slot = $("hmApprovals");
  if (!slot || !isApprover(p)) return;
  let d = null, M = null;
  try {
    const [repo, map] = await Promise.all([import("../repo/books.js"), import("../map/books.js")]);
    M = map;
    d = await repo.approvals(p);
  } catch (e) { return; }
  if (!d || !d.count) return;
  const money = M.fmtMoney;
  const rows = d.queue.slice(0, AP_MAX).map((b) => el("tr", null,
    el("td", null,
      el("span", { class: "who" }, b.vendor || "(no vendor)"),
      b.invoiceNumber ? el("span", { class: "meta no" }, " #" + b.invoiceNumber) : null,
      el("div", { class: "meta" }, (b.projectLabel || "") + (b.dueText ? " · due " + b.dueText : "")),
      b.late ? el("span", { class: "late" }, "OVERDUE ") : null,
      b.hasDocument ? null : el("span", { class: "nodoc" }, "needs the invoice attached")),
    el("td", { class: "amt" }, money(b.amount)),
    el("td", { class: "amt" }, el("a", { class: "go", href: M.billHref(b.id) }, "Open →"))));
  slot.innerHTML = "";
  slot.appendChild(el("div", { class: "hm-ap", id: "hmApprovalsCard" },
    el("h3", null, "⚑ " + d.count + (d.count === 1 ? " bill waiting for approval" : " bills waiting for approval")),
    el("div", { class: "sub" }, money(d.amount) + " in total" + (d.missingDocument ? " · " + d.missingDocument + " still need the invoice attached" : "")),
    el("table", null, el("tbody", null, rows)),
    d.count > AP_MAX ? el("div", { class: "more" }, "and " + (d.count - AP_MAX) + " more… (The Books lists them all)") : null));
  slot.hidden = false;
}

async function start() {
  const p = await requireAuth();
  const wide = window.matchMedia && window.matchMedia("(min-width: 761px) and (pointer: fine)").matches;
  topbar("home", { presence: wide });
  $("hmGreeting").textContent = "Welcome, " + String(p.name || "").split(" ")[0].split("@")[0];
  if (companyInfo.logo) $("hmLogo").src = companyInfo.logo;
  document.title = "DCR Portal 2 — Home (" + roleLabel(p.role) + ")";
  $("hmSearchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("hmSearch").value.trim();
    if (q.length >= 2) location.href = "search.html?q=" + encodeURIComponent(q);
  });
  const homeOpts = {};
  render(p, homeOpts);
  // a lead's Batch Entry card waits for their crew (crew_members: their own rows)
  if (p.role === "lead") crewOf(p.id).then((ids) => { if (ids.length) { homeOpts.hasCrew = true; render(p, homeOpts); myTasksBadge(); myAssistantBadge(); listBadges(); } }).catch(() => null);
  if (p.role !== "admin") salesCard(p, homeOpts);
  myTasksBadge();
  myAssistantBadge();
  if (p.role === "admin") agentsLine();
  approvalsCard(p);
  listBadges();
  notes();
  mountSwitch("pushSlot");
  // journal entries written with no signal are created (the app may have been killed since), then
  // the photos waiting on this phone go up — both as soon as the home page is open
  startSweeper(p);
  drain();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
