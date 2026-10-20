/* The home page: the same launcher as the old portal (search, then cards by section), with only the
   modules Portal 2 has in phase 1. Cards are gated by role and switch, as the database rules them
   (BLUEPRINT 3.2, Appendix D); later phases add their cards here. */
import { requireAuth, topbar, el, companyInfo, roleLabel } from "../common2.js";
import { drain } from "../upload-queue2.js";
import { startSweeper } from "../pages/journal-sync.js";
import { mountSwitch } from "../push2.js";
import "../install.js";

const $ = (id) => document.getElementById(id);

/** The cards this person sees, in sections. */
export function cardsFor(p) {
  const role = p.role;
  const sections = [];
  sections.push({ label: "Projects", cards: [
    { href: "board.html", ic: "📋", tt: "Project Board",
      ds: role === "admin" || role === "manager" ? "All projects by stage: drag to move, open details." : "All projects by stage; open any for details.",
      links: [["Sales view", "board.html?view=sales"], ["Marketing view", "board.html?view=marketing"], ["Accounting view", "board.html?view=accounting"]] },
    { href: "search.html", ic: "🔎", tt: "Search", ds: "Projects, contacts, tasks and files, by name, number, address or phone." },
    { href: "logs.html", ic: "📜", tt: "Log History", ds: "Today's project logs, grouped by project, or any period." },
  ] });
  sections.push({ label: "Field", cards: [
    { href: "capture.html", ic: "📸", tt: "Site Photos", show: role !== "viewer",
      ds: "Photograph or film the job you're standing on, filed by day. Works with no signal." },
  ] });
  sections.push({ label: "You", cards: [
    { href: "settings.html", ic: "⚙️", tt: "Settings", ds: "Your name and phone, how Portal 2 looks, and your password." },
  ] });
  if (role === "admin") {
    sections.push({ label: "Admin", cards: [
      { info: true, ic: "🔐", tt: "Users and roles",
        ds: "Invite people, set roles and switches, reset passwords and turn accounts off in DCR Desktop 2: Users." },
    ] });
  }
  return sections.map((s) => Object.assign(s, { cards: s.cards.filter((c) => c.show !== false) })).filter((s) => s.cards.length);
}

function render(p) {
  const host = $("hmSections");
  host.innerHTML = "";
  for (const sec of cardsFor(p)) {
    host.appendChild(el("div", { class: "hm-sec" }, sec.label));
    const grid = el("div", { class: "hm-cards" });
    for (const c of sec.cards) {
      const body = [el("span", { class: "ic", "aria-hidden": "true" }, c.ic), el("span", { class: "tt" }, c.tt), el("span", { class: "ds" }, c.ds)];
      const card = c.info
        ? el("div", { class: "hm-card info" }, el("div", { class: "hm-card-go" }, body))
        : el("div", { class: "hm-card" }, el("a", { class: "hm-card-go", href: c.href }, body),
          c.links ? el("div", { class: "links" }, c.links.map((l) => el("a", { href: l[1] }, l[0]))) : null);
      grid.appendChild(card);
    }
    host.appendChild(grid);
  }
}

function notes() {
  const box = $("hmNotes");
  box.innerHTML = "";
  box.appendChild(el("div", { class: "hm-note", html:
    "<b>Portal 2</b> works on the DCR Desktop 2 database. Old estimates, money and documents of projects " +
    "that came from the old portal stay there: each such project has an <b>Old portal</b> link." }));
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
  render(p);
  notes();
  mountSwitch("pushSlot");
  // journal entries written with no signal are created (the app may have been killed since), then
  // the photos waiting on this phone go up — both as soon as the home page is open
  startSweeper(p);
  drain();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
