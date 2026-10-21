/* The web console's Photo & Video tab (site/js/console/console-photo.js), run in
   a small stand-in for the browser with a stub shell (the §6.4 ctx) answering
   from the §6.1.9 shapes — every string from the "server" carries an
   <img src=x onerror=…>. Everything drawn must come out escaped; every
   button must send exactly what the DCR server computer's method takes; the
   changes the desktop asks about must go through ctx.act; the printout must
   say what the desktop's printout says (sections, ruled lines, boxes, the
   footer) and break pages where a person would. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../../site/js/console/console-photo.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../site/css/console-print.css", import.meta.url), "utf8");
const EVIL = "<img src=x onerror=alert(1)>";
const E = escHtml(EVIL);
const UPDATE = "Update DCR Agents on the server computer to use this";
function escHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function unesc(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

/* ── the §6.1.9 answers, every string poisoned ─────────────────────────── */

function shootRow(over = {}) {
  return { id: 40, project_id: 12, name: `Framing ${EVIL}`, status: "planned", planned_date: "2026-10-06", date_text: EVIL,
    when_text: EVIL, late: true, project_label: `Z101 ${EVIL}`, photographer: `Pat ${EVIL}`, weather: EVIL, golden: "6:05-6:39 pm",
    link: "javascript:alert(1)", chip: [`Late ${EVIL}`, "red"], time_of_day: EVIL, phase_words: EVIL, ...over };
}
function overview(over = {}) {
  return {
    ai: { ok: true, words: `Claude ${EVIL}` }, model_words: EVIL, dry_run: true, photographer: `Pat ${EVIL}`, photographer_auto: true,
    hint: { name: `Hint ${EVIL}`, count: 3 }, agent: { exists: true, enabled: false },
    projects: [
      { id: 12, label: `Z101 ${EVIL}`, status: "active", chip: [`Active ${EVIL}`, "green"], subtitle: `Next ${EVIL}`,
        counts: { total: 9, done: 1, overdue: 1 }, next_shoot: { date: "2026-10-12", date_text: "Mon Oct 12" } },
      { id: 13, label: `Z102 ${EVIL}`, status: "review", chip: ["To review", "amber"], subtitle: EVIL, counts: { total: 8 } },
      { id: 14, label: `Z103 ${EVIL}`, status: "interview", chip: ["Setting up", "amber"], subtitle: EVIL, counts: {} },
      { id: 15, label: `Old ${EVIL}`, status: "archived", chip: ["Archived", "grey"], subtitle: EVIL, counts: { total: 6 } },
    ],
    header: { active: 1, week: 2, overdue: 1 }, suggestions_open: 2, ...over,
  };
}
function upcoming() {
  return { groups: { overdue: [shootRow()], week: [shootRow({ id: 41, late: false, chip: ["Planned", "blue"] })], next: [], later: [],
    undated: [], done: [shootRow({ id: 42, status: "done", late: false, chip: ["Done", "green"] })] },
  order: ["overdue", "week", "next", "later", "undated", "done"],
  group_words: { overdue: `Overdue ${EVIL}`, week: "This week", next: "Next week", later: "Later", undated: "No date yet", done: "Done recently" },
  copied: { 12: [2, `Maria ${EVIL}`] }, plans: [{ id: 12, label: `Z101 ${EVIL}` }], title: EVIL, empty: false };
}
function calendar(args) {
  return { month: args.month, title: `October ${EVIL}`, first: "2026-09-28", last: "2026-11-08", today: "2026-10-10",
    shoot_days: [0, 1, 2, 3, 4, 5], days: { "2026-10-06": [shootRow()], "2026-10-12": [1, 2, 3, 4].map((i) => shootRow({ id: 50 + i, chip: ["Planned", "blue"] })) } };
}
function milestoneRows() {
  return [
    { key: "framing_start", name: `Framing start ${EVIL}`, date: "2026-09-28", confirmed: true, source: "admin", source_words: `from ${EVIL}`, note: "", tip: EVIL },
    { key: "delivery", name: "Delivery", date: "2026-09-25", confirmed: false, source: "estimate", source_words: "from an estimate", note: "", tip: EVIL },
    { key: "framing_complete", name: "Framing complete", date: null, confirmed: false, source: "", source_words: "the agent fills it in", note: "", tip: EVIL },
    { key: "house_complete", name: "House complete", date: null, confirmed: false, source: "", source_words: "the agent fills it in", note: "", tip: EVIL },
  ];
}
function brief() {
  return { time_of_day: EVIL, purpose: `Purpose ${EVIL}`, shots: [{ title: `Shot ${EVIL}`, description: EVIL, kind: "drone", priority: "must" },
    { title: "Wide", description: "", kind: "photo", priority: "nice" }], sample_shot: EVIL, tips: [EVIL], equipment: [EVIL],
  safety: [EVIL], caption_ideas: [EVIL], drone: { needed: true, notes: EVIL }, keep_me: "the PC keeps other keys" };
}
function project(over = {}) {
  return {
    id: 12, label: `Z101 ${EVIL}`, status: "active", chip: [`Active ${EVIL}`, "green"], subtitle: EVIL,
    plan: { title: `Plan ${EVIL}`, summary: `${EVIL} `.repeat(12), story: `Story ${EVIL}` }, facts: {}, brief: EVIL, photographer_own: false,
    photographer: "", header_words: `Town ${EVIL}`, who_words: `Photographer: ${EVIL}`, milestone_rows: milestoneRows(),
    made_by_words: `Made by ${EVIL}`, state_note: `Running ${EVIL}`, ai: { ok: true, words: EVIL },
    copies: { people: [], words: `Copies ${EVIL}`, count_words: `2 ${EVIL}` },
    shoots: [{ ...shootRow(), brief: brief(), notes: [], history: [], feedback: null },
      { ...shootRow({ id: 43, status: "skipped", late: false, chip: ["Skipped", "grey"] }), brief: {}, notes: [], history: [], feedback: null }],
    actions: {}, suggestions: [], notes: [], last_error: "",
    buttons: { print: true, sync: true, pause: true, pause_text: "Pause", archive_text: "Archive", approve: false, remake: false, revise: true, wizard: false },
    ...over,
  };
}
function shoot(over = {}) {
  return {
    ...shootRow({ status: "announced", link: "https://example.test/my-tasks.html?task=41" }), brief: brief(),
    notes: [{ day: "2026-10-05", text: EVIL, who: "office" }], history: [{ from: "2026-10-01", to: "2026-10-06", reason: EVIL }],
    feedback: { rating: 4, note: EVIL }, rev: "0123456789abcdef",
    actions: [{ action: "send", enabled: true, why: "" }, { action: "done", enabled: true, why: "" }, { action: "skip", enabled: true, why: "" },
      { action: "move", enabled: true, why: "" }, { action: "task", enabled: true, why: "" }, { action: "print", enabled: true, why: "" },
      { action: "post_kit", enabled: true, why: "" }, { action: "debrief", enabled: true, why: "" }],
    send_kinds: [{ kind: "heads_up", words: `Heads-up ${EVIL}` }, { kind: "day_before", words: "Day-before reminder" }],
    list_fields: [{ key: "tips", words: "Tips" }, { key: "equipment", words: "Bring" }, { key: "safety", words: "Safety" }, { key: "caption_ideas", words: "Caption ideas" }],
    shot_kinds: [{ kind: "photo", words: "Photo" }, { kind: "video", words: "Video" }, { kind: "drone", words: "Drone" }, { kind: "timelapse", words: "Time-lapse" }],
    light: `Golden ${EVIL}`, long_date: EVIL, dry_run: true, ratings: [1, 2, 3, 4, 5].map((n) => ({ n, words: `R${n} ${EVIL}` })),
    ...over,
  };
}
const CONFIRM = (title) => ({ confirm: { title, question: `Sure? ${EVIL}`, ok_text: "Yes", danger: false, twice: null, extra: [] } });
function printAnswer(args) {
  return {
    title: `Print schedule — ${EVIL}`, file_name: "Z101 photo & video schedule 2026-10-10.pdf",
    options: { include_done: !!args.include_done, notes: args.notes || "few", one_per_page: !!args.one_per_page, paper: args.paper || "letter" },
    model: {
      kind: args.shoot_id ? "shoot" : "schedule", code: `Z101 ${EVIL}`, label: `Label ${EVIL}`, address: `1 ${EVIL}`, city: "Town",
      photographer: `Pat ${EVIL}`, copies: `Maria ${EVIL}`, company: `DCR ${EVIL}`, office_phone: "(805) 555-0100", printed: "2026-10-10",
      made_by: `Made by ${EVIL}`, summary: `Summary ${EVIL}`, story: `Story ${EVIL}`,
      milestones: [{ key: "framing_start", name: `Framing start ${EVIL}`, date: "2026-10-02", sure: "firm", source: `office ${EVIL}` },
        { key: "house_complete", name: "House complete", date: "", sure: "unsure", source: "" }],
      light_where: `Town ${EVIL} (town)`,
      shoots: [
        { id: 1, n: 1, of: 3, name: `Done ${EVIL}`, phase: "Before framing", date: "2026-10-01", status: "done", status_words: "Done",
          window_days: 0, brief: { time_of_day: EVIL }, golden: "6:01-6:38 pm", sunset: "6:38 pm", weather: "", done_note: `120 photos ${EVIL}` },
        { id: 2, n: 2, of: 3, name: `Big ${EVIL}`, phase: "Framing progress", date: "2026-10-12", status: "planned", status_words: "Planned",
          window_days: 2, brief: brief(), golden: "5:56-6:30 pm", sunset: "6:30 pm", weather: `Sunny ${EVIL}`, done_note: "" },
        { id: 3, n: 3, of: 3, name: "Undated", phase: "", date: "", status: "planned", status_words: "Planned", window_days: 0, brief: {},
          golden: "", sunset: "", weather: "", done_note: "" },
      ].filter((r) => !args.shoot_id || r.id === args.shoot_id),
      hidden: { skipped: 1 }, visit: [EVIL], visit_groups: [["Pack", [`Batteries ${EVIL}`]], ["On site", [`Check in ${EVIL}`]]],
    },
    notes_lines: { none: 0, few: 6, half: 16 }[args.notes || "few"], drone_check: [`Airspace ${EVIL}`, "Wind under 20 mph"],
    light_note: `Light ${EVIL}`, hidden_note: `Not listed: 1 skipped shoot ${EVIL}`,
    footer: { left: `Z101 · Photo & Video schedule ${EVIL}`, right: "Printed Sat Oct 10, 2026" }, visit_basics: ["Batteries charged"],
  };
}
function agendaAnswer(args) {
  return { title: "Print this list", file_name: "Photo & video shoots 2026-10-10.pdf", options: { include_done: !!args.include_done, paper: "letter" },
    model: { kind: "agenda", title: `Every ${EVIL}`, photographers: [`Pat ${EVIL}`], count: 2, company: "DCR", office_phone: "", printed: "2026-10-10",
      hidden_done: 1, cut_note: `3 later shoots are not on this printout ${EVIL}`,
      groups: [{ title: `Overdue ${EVIL}`, rows: [{ id: 40, date: "2026-10-06", label: `Z101 ${EVIL}`, code: "Z101", city: EVIL, name: `N ${EVIL}`,
        time_of_day: EVIL, status_words: "Late", photographer: "Pat" }] },
      { title: "No date yet", rows: [{ id: 41, date: "", label: "Z101", code: "Z101", city: "", name: "Undated", time_of_day: "", status_words: "Planned", photographer: "" }] }] },
    footer: { left: "Photo & Video shoots", right: "Printed Sat Oct 10, 2026" }, drone_check: [], light_note: "", hidden_note: "", notes_lines: 6, visit_basics: [] };
}
function settingsAnswer() {
  return { sections: { general: { values: { "general.admin_email": `office@${EVIL}` }, rev: "1111111111111111", fields: [] },
    photo: { rev: "abcdefabcdefabcd", values: { "photo.photographer": "", "photo.admin_name": "Maria Ortiz", "photo.lead_days": 3,
      "photo.day_before": true, "photo.shoot_days": [0, 1, 2, 3, 4, 5], "photo.auto_apply": "safe", "photo.ai": true, "photo.model": "m1",
      "photo.cc": [{ name: `Joe ${EVIL}`, email: "joe@example.test" }], "photo.cc_kinds": ["heads_up", "followups"] },
    fields: [{ key: "photo.photographer", label: `Photographer ${EVIL}`, type: "person", help: EVIL },
      { key: "photo.admin_name", label: "Told when follow-ups get no answer", type: "person" },
      { key: "photo.lead_days", label: "Heads-up, days before", type: "int", lo: 0, hi: 14 },
      { key: "photo.day_before", label: "Also remind the day before", type: "bool" },
      { key: "photo.shoot_days", label: "Shoot days", type: "days" },
      { key: "photo.auto_apply", label: "Change plans by itself", type: "enum", choices: [{ key: "safe", label: "Only the safe things" }, { key: "none", label: "Nothing" }] },
      { key: "photo.ai", label: "Plan with Claude", type: "bool" },
      { key: "photo.model", label: "Model", type: "enum", choices: [{ key: "m1", label: `Model ${EVIL}` }] },
      { key: "photo.cc", label: "Also send copies to", type: "cc" }, { key: "photo.cc_kinds", label: "Copies go with", type: "cc_kinds" }] } },
  claude_words: [`A key is saved ${EVIL}`, "good"], server_note: "Change it on the DCR server computer." };
}
const PEOPLE = { rows: [{ name: "Pat Example", email: "pat@example.test", email_override: "", active: true },
  { name: "Maria Ortiz", email: "maria@example.test", email_override: "", active: true },
  { name: `Luis ${EVIL}`, email: "luis@example.test", email_override: "", active: true }] };

function answers(over = {}) {
  return {
    "photo.overview": overview(), "photo.upcoming": upcoming(), "photo.calendar": calendar,
    "photo.suggestions": { rows: [{ id: 7, kind: "move_shoot", kind_words: `Move ${EVIL}`, tone: "blue", where: `Where ${EVIL}`, reason: `Rain ${EVIL}`,
      confidence: "high", confidence_words: `sure ${EVIL}`, source_words: `from ${EVIL}` }], total: 1 },
    "photo.suggestion.apply": { words: `Suggestion: moved ${EVIL}` }, "photo.suggestion.dismiss": {},
    "photo.suggestions.apply_safe": { applied: [], words: "Nothing safe to apply by itself — the rest needs you." },
    "photo.project": project(), "photo.shoot": shoot(),
    "photo.shoot.save": (a) => ({ rev: "fedcba9876543210", words: `Saved “${a.name}”.` }),
    "photo.milestones.preview": (a) => ({ parts: [], text: `Framing start → ${a.changes[0].day}: 4 shoots move ${EVIL}` }),
    "photo.milestones.save": { moved: 4, told: 1, words: "Dates saved — 4 shoots moved." },
    "photo.shoot.move_check": (a) => ({ words: `${a.day}: no forecast ${EVIL}` }),
    "photo.shoot.send": (a) => (a.confirmed ? { words: "Framing: recorded" } : CONFIRM("Send reminder now")),
    "photo.shoot.done": (a) => (a.confirmed ? { words: "done" } : CONFIRM("Mark done")),
    "photo.shoot.skip": (a) => (a.confirmed ? { words: "skipped" } : CONFIRM("Skip the shoot")),
    "photo.shoot.move": (a) => (a.confirmed ? { change: {}, words: "moved" } : CONFIRM("Move the shoot")),
    "photo.shoot.bring_back": (a) => (a.confirmed ? { words: "back" } : CONFIRM("Bring it back")),
    "photo.shoot.post_kit": { instagram: `Insta ${EVIL}`, hashtags: ["#a", EVIL], best_time: "Tue 11 am", made_by: `Made by Claude ${EVIL}`, error: "" },
    "photo.shoot.debrief": { lessons: [`Lesson ${EVIL}`], proposed_rules: [{ text: `Rule ${EVIL}`, category: "shots", why: EVIL }], error: "", note: "", words: "debrief saved" },
    "photo.shoot.conditions": { conditions: {}, words: `Forecast ${EVIL}` },
    "photo.rule.add": { id: 9 },
    "photo.debrief.accept": { rule_id: 11, words: "Added to the Playbook." },
    "photo.plan.status": (a) => (a.action === "archive" && !a.confirmed ? CONFIRM("Archive the plan") : { status: "x", words: `${a.action} ${EVIL}` }),
    "photo.plan.sync": { words: `Read ${EVIL}`, error: false },
    "photo.plan.photographer": { words: "photographer changed" },
    "photo.plan.copies": { people: [{ name: "Maria", email: "maria@example.test", hold: `opted out ${EVIL}` }], kinds: ["heads_up"],
      every: { people: [], kinds: [], words: `Every plan ${EVIL}` }, roster: [{ name: "Joe", email: "joe@example.test" }], photographer: "Pat",
      intro: `Who else ${EVIL}`, groups: [{ key: "heads_up", words: "Heads-up" }, { key: "followups", words: "Follow-ups" }, { key: "day_before", words: "Evening" }],
      max_people: 20, undo_words: "START undoes it" },
    "photo.plan.copies.save": { words: "copies saved" },
    "photo.plan.revise": { summary: "", changes: [], words: `Claude revised ${EVIL}` },
    "photo.plan.remake": (a) => (a.confirmed ? { summary: "", words: "A fresh plan is ready to review." } : CONFIRM("Make it again")),
    "photo.plan.approve": (a) => (a.confirmed ? { counts: {}, words: "Plan started" } : CONFIRM("Approve & start")),
    "photo.wizard.projects": { projects: [{ id: "901", code: "Z101", label: `Z101 ${EVIL}`, status: "In Progress", city: "Town", active: true, has_plan: true },
      { id: "905", code: "Z105", label: `Z105 Hillside ${EVIL}`, status: "Aproved", city: "Sampletown", active: true, has_plan: false },
      { id: "904", code: "Z104", label: "Z104 Duplex", status: "Bidding", city: "Exampleton", active: false, has_plan: false }] },
    "photo.wizard.facts": { facts: {}, hint: {}, chips: [[`Z105 ${EVIL}`, "blue"], ["On a hill", "amber"]], note: `Also ${EVIL}` },
    "photo.wizard.create": { pid: 21, label: "Z105" },
    "photo.wizard.state": { pid: 14, status: "draft", label: "Z103", step: "brief", round: 0, questions: [], understanding: "", facts_needed: [], ready: false,
      made_by: "", brief: `Brief ${EVIL}`, photographer: "", photographer_usual: `Pat ${EVIL}`, milestones: milestoneRows(), facts: [[`Fact ${EVIL}`, "blue"]],
      has_plan: false, ai: { ok: true, words: "ready" }, steps: [] },
    "photo.wizard.start": { round: 1, questions: [{ id: "crane", question: `Crane ${EVIL}?`, why: EVIL, choices: ["Yes", `No ${EVIL}`] },
      { id: "framing_start", question: "When does framing start?", why: "", choices: [] }], understanding: `An ADU ${EVIL}`, facts_needed: [EVIL],
    ready: false, made_by: "ai", made_by_words: `Asked by ${EVIL}`, title: "A few questions — round 1 of 3" },
    "photo.wizard.next": { round: 2, questions: [{ id: "drone", question: "Drone?", why: "", choices: ["Yes"] }], understanding: "", facts_needed: [],
      ready: false, made_by: "standard", made_by_words: "Standard checklist", title: "A few questions — round 2 of 3" },
    "photo.wizard.finish": { summary: "", title: "", made_by: "", shoots: 6, words: "Here is the plan." },
    "photo.rules": { rules: [{ id: 1, text: `Rule ${EVIL}`, category: "shots", category_words: `Shots ${EVIL}`, active: true, source: "admin", source_words: `you ${EVIL}` },
      { id: 2, text: "Off rule", category: "style", category_words: "Style", active: false, source: "coach", source_words: "the coach" }], categories: ["shots", "style", "safety"] },
    "photo.rule.update": { words: "Saved." }, "photo.rule.delete": (a) => (a.confirmed ? { words: "Deleted." } : CONFIRM("Delete the rule")),
    "photo.coach": { history: [{ id: 5, role: "user", content: `Hi ${EVIL}`, created_at: "" }, { id: 6, role: "assistant", content: `Reply ${EVIL}`, created_at: "" }],
      proposals: [{ n: 0, text: `Vertical ${EVIL}`, category: "shots", why: EVIL, in_playbook: false }, { n: 1, text: "Had", category: "style", why: "", in_playbook: true }],
      chat_id: 6, ai: { ok: true, words: "ready" }, empty: EVIL, note: "" },
    "photo.coach.ask": { history: [{ id: 8, role: "assistant", content: `New ${EVIL}`, created_at: "" }], proposals: [], chat_id: 8, ai: { ok: true, words: "" }, empty: "", note: "" },
    "photo.coach.accept": { rule_id: 3, words: "Added to the Playbook." },
    "photo.playbook.export": { file_name: "photo-playbook.json", data: { kind: "dcr-photo-playbook", rules: [{ text: "a" }] } },
    "photo.playbook.import": (a) => (a.confirmed ? { added: 1, words: "Added 1 rule from the Playbook." } : CONFIRM("Import a Playbook")),
    "photo.print": printAnswer, "photo.print_agenda": agendaAnswer,
    "settings.get": settingsAnswer(), "settings.save": { rev: "0000000000000000", words: "Saved.", effects: [] }, "people.list": PEOPLE,
    ...over,
  };
}

/* ── a document, just big enough ────────────────────────────────────────── */

function parseAttrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) out[m[1].toLowerCase()] = m[2] === undefined ? "" : m[2];
  return out;
}
function makeDom() {
  const byId = new Map();
  let seq = 0;
  function makeEl(id, attrs = {}, tag = "div") {
    const listeners = {};
    let html = "";
    const cls = new Set(String(attrs.class || "").split(/\s+/).filter(Boolean));
    const el = {
      id, tag, attrs: { ...attrs }, seq: 0, style: {}, children: [], listeners, textContent: "",
      value: attrs.value !== undefined ? unesc(attrs.value) : "", checked: "checked" in attrs, disabled: "disabled" in attrs, hidden: "hidden" in attrs,
      files: null, clicked: 0, nodeType: undefined,
      get innerHTML() { return html; },
      set innerHTML(v) { html = String(v); el.seq = ++seq; register(html, el.seq); },
      init(v, s) { html = v; el.seq = s; },
      get className() { return [...cls].join(" "); },
      set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); },
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
        toggle: (c, on) => { const want = on === undefined ? !cls.has(c) : !!on; if (want) cls.add(c); else cls.delete(c); return want; } },
      setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute(k) { return k in el.attrs ? unesc(el.attrs[k]) : null; },
      removeAttribute(k) { delete el.attrs[k]; }, hasAttribute(k) { return k in el.attrs; },
      addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
      querySelector(sel) { const m = /^#([\w-]+)$/.exec(sel); return m ? byId.get(m[1]) || null : null; },
      appendChild(c) { el.children.push(c); return c; }, removeChild() {}, focus() {}, scrollIntoView() {},
      click() { el.clicked++; },
    };
    return el;
  }
  /* Every element with an id in new markup becomes an element, holding the
     markup between its tags (as a browser's would). */
  const VOID = new Set(["input", "br", "img", "hr", "meta", "link", "source", "col", "area", "base", "embed", "wbr", "track"]);
  function innerOf(html, from, tag) {
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    re.lastIndex = from;
    let depth = 1, m;
    while ((m = re.exec(html))) { depth += m[1] ? -1 : 1; if (!depth) return html.slice(from, m.index); }
    return html.slice(from);
  }
  function register(html, s) {
    const re = /<([a-z0-9]+)\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(html))) {
      const a = parseAttrs(m[2]);
      if (!a.id) continue;
      const tag = m[1].toLowerCase();
      const el = makeEl(a.id, a, tag);
      if (!VOID.has(tag)) {
        const inner = innerOf(html, re.lastIndex, tag);
        el.init(inner, s);
        if (tag === "textarea") el.value = unesc(inner);
      }
      byId.set(a.id, el);
    }
  }
  const document = {
    getElementById: (id) => byId.get(id) || null, createElement: (t) => makeEl("", {}, t), addEventListener() {},
    body: makeEl("body"), documentElement: { dataset: {} },
  };
  return { document, byId, makeEl };
}

/* The page: the module loaded once, a stub shell around it. */
function openPage({ hash = "#/photo", over = {}, missing = [], store = new Map() } = {}) {
  const dom = makeDom();
  const page = { calls: [], toasts: [], confirms: [], modals: [], modalAnswers: [], printed: [], went: [], busy: [], accept: true, extra: null,
    confirmAnswer: true, timers: new Map(), downloads: [], clipboard: [] };
  const A = answers(over);
  let tid = 0;
  const ctx = {
    esc: escHtml, route: null,
    rpc(method, args, opts) { page.calls.push({ method, args: clone(args), via: "rpc", opts }); return answer(method, args); },
    act(method, args, opts) {
      page.calls.push({ method, args: clone(args), via: "act", opts });
      return answer(method, args).then((d) => {
        if (!d || !d.confirm) return d;
        page.confirms.push(d.confirm);
        if (!page.accept) return null;
        const next = { ...clone(args), ...(page.extra || {}), confirmed: true };
        page.calls.push({ method, args: clone(next), via: "act-confirmed" });
        return answer(method, next);
      });
    },
    has: (m) => !missing.includes(m), method: (m) => ({ ai: /revise|remake|wizard\.(start|next|finish)|coach\.ask|post_kit|debrief/.test(m) }),
    toast: (t, o) => page.toasts.push({ t, bad: !!(o && o.bad) }), busy: (el, w) => { page.busy.push(w); return () => {}; },
    print: (html, o) => page.printed.push({ html, o }), confirm: () => Promise.resolve(page.confirmAnswer),
    modal: (o) => { page.modals.push(o); return Promise.resolve(page.modalAnswers.length ? page.modalAnswers.shift() : null); },
    go: (path) => { page.went.push(path); show(String(path).replace(/^#?\/?/, "#/")); }, refresh: () => show(page.hash),
    canAct: () => true, onServer: () => () => {}, admin: { name: "Ana", email: "ana@example.test" },
  };
  function answer(method, args) {
    const a = A[method];
    if (a === undefined) return Promise.reject({ code: "failed", message: "no stub for " + method });
    const v = typeof a === "function" ? a(clone(args)) : clone(a);
    if (v && v.__reject) return Promise.reject(v.__reject);
    return Promise.resolve(v);
  }
  const win = {
    document: dom.document, console, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    Blob: class { constructor(parts) { page.downloads.push(parts.join("")); } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    navigator: { clipboard: { writeText: (t) => { page.clipboard.push(t); return Promise.resolve(); } } },
    location: { hash }, addEventListener() {}, FileReader: class { readAsText(f) { this.result = f.text; setImmediate(() => this.onload()); } },
    setTimeout: (fn, ms) => { const id = ++tid; page.timers.set(id, { fn, ms }); return id; }, clearTimeout: (id) => page.timers.delete(id),
    setInterval: () => 0, clearInterval() {}, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp, Error,
  };
  win.window = win;
  win.DCRConsole = { register: (def) => { page.def = def; return def; } };
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: "console-photo.js" });
  function parseHash(h) {
    let s = String(h).replace(/^#\/?/, ""), q = "";
    const i = s.indexOf("?");
    if (i >= 0) { q = s.slice(i + 1); s = s.slice(0, i); }
    const parts = s.split("/").filter(Boolean).map(decodeURIComponent);
    const tab = parts.shift() || "";
    const query = {};
    q.split("&").filter(Boolean).forEach((kv) => { const j = kv.indexOf("="); query[decodeURIComponent(kv.slice(0, j))] = decodeURIComponent(kv.slice(j + 1)); });
    return { tab, parts, query };
  }
  function show(h) {
    page.hash = h;
    win.location.hash = h;
    ctx.route = parseHash(h);
    page.root = dom.makeEl("root");
    page.done = page.def.render(page.root, ctx);
  }
  show(hash);
  Object.assign(page, {
    dom, ctx, win, store,
    get S() { return win.DCRConsolePhoto.state(); },
    calls_of: (m) => page.calls.filter((c) => c.method === m),
    last: (m) => { const l = page.calls.filter((c) => c.method === m); return l[l.length - 1]; },
    html() {
      const els = [page.root, ...dom.byId.values()].sort((a, b) => b.seq - a.seq);
      return els.map((e) => e.innerHTML).join("\n");
    },
    el: (id) => dom.byId.get(id),
    runTimers() { const due = [...page.timers.entries()]; page.timers.clear(); due.forEach(([, t]) => t.fn()); },
    /* the newest drawn element matching the attributes (and its tag) */
    find(match) {
      const els = [page.root, ...dom.byId.values()].sort((a, b) => b.seq - a.seq);
      for (const e of els) {
        for (const m of e.innerHTML.matchAll(/<([a-z0-9]+)\b([^>]*)>/gi)) {
          const a = parseAttrs(m[2]);
          if (Object.entries(match).every(([k, v]) => (v === true ? k in a : unesc(a[k] ?? "\u0000") === String(v)))) return { tag: m[1].toLowerCase(), a };
        }
      }
      return null;
    },
    target(found, extra = {}) {
      const a = found.a;
      const live = a.id ? dom.byId.get(a.id) : null;          // a drawn element the page has changed since
      const t = {
        tagName: found.tag.toUpperCase(), type: a.type || "", disabled: live ? !!live.disabled : "disabled" in a,
        value: unesc(a.value ?? ""), checked: "checked" in a,
        textContent: "", files: null,
        getAttribute: (k) => (k in a ? unesc(a[k]) : null), hasAttribute: (k) => k in a, removeAttribute: (k) => { delete a[k]; },
        closest: (sel) => (/data-ph/.test(sel) && "data-ph" in a ? t : null), ...extra,
      };
      return t;
    },
    async click(match, extra) {
      if (typeof match === "string") match = { "data-ph": match };
      const f = page.find(match);
      if (!f) throw new Error("nothing to click: " + JSON.stringify(match));
      const t = page.target(f, extra);
      (page.root.listeners.click || []).forEach((fn) => fn({ target: t, preventDefault() {} }));
      await flush();
      return t;
    },
    async edit(dataF, value, kind = "change") {
      const f = page.find({ "data-f": dataF });
      if (!f) throw new Error("no field " + dataF);
      const t = page.target(f, typeof value === "boolean" ? { checked: value } : { value: String(value) });
      if (f.a.id && dom.byId.get(f.a.id)) Object.assign(dom.byId.get(f.a.id), typeof value === "boolean" ? { checked: value } : { value: String(value) });
      ["input", kind === "input" ? null : "change"].filter(Boolean).forEach((type) => (page.root.listeners[type] || []).forEach((fn) => fn({ target: t })));
      await flush();
      return t;
    },
    async change(match, value, extra = {}) {
      const f = page.find(match);
      if (!f) throw new Error("no control " + JSON.stringify(match));
      const t = page.target(f, { value: String(value), ...extra });
      (page.root.listeners.change || []).forEach((fn) => fn({ target: t }));
      await flush();
      return t;
    },
    go: async (h) => { show(h); await flush(); },
  });
  return page;
}
async function open(opts) { const p = openPage(opts); await flush(); return p; }
function noRaw(html) {
  assert.ok(!/<img/i.test(html), "no raw <img anywhere");
  assert.ok(!/<script/i.test(html), "no raw <script anywhere");
  assert.ok(!/href="javascript:/i.test(html), "a javascript: link is never drawn");
  assert.ok(!/\son[a-z]+=/i.test(html.replace(/onerror=alert\(1\)/gi, "")), "no inline handlers");
}

/* ── registering, the overview, the lists ──────────────────────────────── */

test("the tab registers as photo, order 50, with render and leave", async () => {
  const p = await open();
  assert.equal(p.def.id, "photo");
  assert.equal(p.def.title, "Photo & Video");
  assert.equal(p.def.order, 50);
  assert.equal(typeof p.def.render, "function");
  assert.equal(typeof p.def.leave, "function");
  assert.ok(!("autoRefresh" in p.def), "no re-render under the admin's typing");
});

test("the plans: the counts, Claude, the photographer, every plan escaped, the filter and the archived ones", async () => {
  const p = await open();
  const html = p.html();
  noRaw(html);
  assert.ok(html.includes(E), "the words are still there, as text");
  for (const words of ["1 active plan", "2 shoots this week", "1 overdue", "2 suggestions", "+ New project plan", "Dry run — reminders are recorded, not sent"]) {
    assert.ok(html.includes(escHtml(words)), words);
  }
  assert.match(html, /href="#\/photo\/plan\/12"/);
  assert.match(html, /href="#\/photo\/print\/12"/, "a plan with shoots can be printed from the list");
  assert.ok(!/href="#\/photo\/print\/14"/.test(html), "a plan still being set up has nothing to print");
  assert.ok(!html.includes(escHtml(`Old ${EVIL}`)), "the archived plan is not under Active plans");
  assert.match(html, /The “Photo &amp; Video — shoot reminders” agent is off/);
  assert.equal(p.calls_of("photo.overview").length, 1);
  await p.change({ id: "cphShow" }, "archived");
  assert.equal(p.went.pop(), "#/photo/plans?show=archived");
  await flush();
  assert.ok(p.html().includes(escHtml(`Old ${EVIL}`)), "Archived shows it");
  assert.equal(p.calls_of("photo.overview").length, 1, "drawn again from memory, not asked again");
});

test("a method this server's build does not know is greyed with the update words, and every write carries data-act", async () => {
  const p = await open({ missing: ["photo.wizard.create"] });
  const b = p.find({ "data-ph": "new-plan" });
  assert.ok("disabled" in b.a);
  assert.equal(unesc(b.a.title), UPDATE);
  assert.ok(!("data-act" in b.a), "the shell never turns it back on");
  const who = p.find({ "data-ph": "who-default" });
  assert.equal(who.a["data-act"], "settings.save");
  assert.equal(who.a["data-method"], "settings.save");
});

test("Upcoming: the groups in order, cc words, rows linked to the shoot in its plan, print this list", async () => {
  const p = await open({ hash: "#/photo/upcoming?pid=12" });
  const html = p.html();
  noRaw(html);
  assert.deepEqual(p.last("photo.upcoming").args, { pid: 12 });
  assert.ok(html.indexOf(escHtml(`Overdue ${EVIL}`)) < html.indexOf("This week") && html.indexOf("This week") < html.indexOf("Done recently"));
  assert.match(html, /href="#\/photo\/plan\/12\/shoot\/40"/);
  assert.ok(html.includes(escHtml(`Pat ${EVIL} +2 cc`)));
  assert.ok(html.includes(escHtml(`Reminders go to Pat ${EVIL}; copies to Maria ${EVIL}.`)));
  assert.match(html, /href="#\/photo\/print\/agenda\?pid=12"/);
  assert.ok(html.includes("golden hour 6:05–6:39 pm"), "the span as print writes it");
  await p.change({ id: "cphUpPlan" }, "");
  assert.equal(p.went.pop(), "#/photo/upcoming");
});

test("the Calendar: a 6-week month from Monday, pills, +N more, a day's shoots, month links", async () => {
  const p = await open({ hash: "#/photo/calendar?month=2026-10" });
  assert.deepEqual(p.last("photo.calendar").args, { month: "2026-10" });
  const grid = p.el("cphGrid").innerHTML;
  assert.equal((grid.match(/data-ph="cal-day"/g) || []).length, 42);
  assert.match(grid, /data-day="2026-09-28"/, "starts on the Monday before the 1st");
  assert.match(grid, /\+2 more/, "four shoots: two pills and +2 more");
  assert.match(grid, /class="cph-cell[^"]*today[^"]*" data-ph="cal-day" data-day="2026-10-10"/, "today is marked");
  noRaw(p.html());
  assert.match(p.html(), /href="#\/photo\/calendar\?month=2026-09"/);
  assert.match(p.html(), /href="#\/photo\/calendar\?month=2026-11"/);
  await p.click({ "data-ph": "cal-day", "data-day": "2026-10-06" });
  assert.ok(p.el("cphDay").innerHTML.includes(escHtml(`Framing ${EVIL}`)));
  assert.match(p.el("cphDay").innerHTML, /href="#\/photo\/plan\/12\/shoot\/40"/);
  assert.equal(p.calls_of("photo.calendar").length, 1, "a day's list is drawn from what was read");
});

test("Suggestions: Apply, Dismiss and Apply all safe send the ids; the list is read again", async () => {
  const p = await open({ hash: "#/photo/suggestions" });
  noRaw(p.html());
  assert.deepEqual(p.last("photo.suggestions").args, { status: "open", pid: null });
  await p.click({ "data-ph": "sug-apply", "data-id": "7" });
  assert.deepEqual(p.last("photo.suggestion.apply").args, { id: 7 });
  assert.ok(p.toasts.some((t) => t.t === `Suggestion: moved ${EVIL}`), "the PC's sentence, as text");
  assert.equal(p.calls_of("photo.suggestions").length, 2, "read again after the change");
  await p.click({ "data-ph": "sug-dismiss", "data-id": "7" });
  assert.deepEqual(p.last("photo.suggestion.dismiss").args, { id: 7 });
  await p.click("sug-safe");
  assert.deepEqual(p.last("photo.suggestions.apply_safe").args, {});
});

/* ── one plan ─────────────────────────────────────────────────────────── */

test("a plan: its header buttons from the PC's buttons, the game plan, the milestones, the shoots", async () => {
  const p = await open({ hash: "#/photo/plan/12" });
  const html = p.html();
  noRaw(html);
  assert.deepEqual(p.last("photo.project").args, { pid: 12 });
  for (const ph of ["plan-who", "plan-copies", "plan-sync"]) assert.ok(p.find({ "data-ph": ph }), ph);
  assert.ok(p.find({ "data-ph": "plan-status", "data-action": "pause" }));
  assert.ok(p.find({ "data-ph": "plan-status", "data-action": "archive" }));
  assert.ok(!p.find({ "data-ph": "plan-approve" }), "Approve & start only while it waits for review");
  assert.match(html, /href="#\/photo\/print\/12"/);
  assert.ok(html.includes(escHtml(`Photographer: ${EVIL} ▾`)));
  assert.match(html, /cphMsD-framing_start" data-f="ms:framing_start.day" value="2026-09-28"/);
  assert.match(html, /id="cphMsD-framing_complete"[^>]*disabled/, "a date not known yet is 'Not sure'");
  assert.match(html, /href="#\/photo\/plan\/12\/shoot\/43"/);
  assert.ok(html.includes("Pick a shoot to see and edit its brief."));
  assert.ok(html.includes(escHtml(`Running ${EVIL}`)));
});

test("a milestone change says what it moves before anything is saved; Save sends the changes; Undo drops them", async () => {
  const p = await open({ hash: "#/photo/plan/12" });
  assert.equal(p.el("cphMsBar").hidden, true);
  await p.edit("ms:framing_start.day", "2026-10-05");
  assert.equal(p.el("cphMsBar").hidden, false);
  assert.equal(p.calls_of("photo.milestones.preview").length, 0, "asked once the admin stops changing it");
  p.runTimers();
  await flush();
  assert.deepEqual(p.last("photo.milestones.preview").args, { pid: 12, changes: [{ key: "framing_start", day: "2026-10-05", confirmed: true }] });
  assert.equal(p.el("cphMsPreview").innerHTML, escHtml(`Framing start → 2026-10-05: 4 shoots move ${EVIL}`));
  await p.edit("ms:framing_complete.unsure", false);
  assert.equal(p.el("cphMsD-framing_complete").disabled, false, "unticking Not sure opens the date");
  p.runTimers();
  await flush();
  assert.equal(p.last("photo.milestones.preview").args.changes.length, 2);
  await p.click("ms-save");
  const saved = p.last("photo.milestones.save").args;
  assert.equal(saved.pid, 12);
  assert.deepEqual(saved.changes.map((c) => c.key), ["framing_start", "framing_complete"]);
  assert.ok(p.toasts.some((t) => t.t === "Dates saved — 4 shoots moved."));
  assert.equal(p.calls_of("photo.project").length, 2, "the plan is read again");
  await p.edit("ms:delivery.firm", true);
  await p.click("ms-undo");
  assert.equal(p.el("cphMsBar").hidden, true);
});

test("a shoot's brief: edited, a shot added, saved with exactly the PC's arguments and the change check", async () => {
  const p = await open({ hash: "#/photo/plan/12/shoot/40" });
  noRaw(p.html());
  assert.deepEqual(p.last("photo.shoot").args, { sid: 40 });
  assert.match(p.html(), /href="https:\/\/example\.test\/my-tasks\.html\?task=41" target="_blank" rel="noopener"/, "its task: https only");
  await p.edit("shoot:name", "New name");
  await p.click("shot-add");
  await p.edit("shoot:shots.2.shot", "Crane lift");
  await p.edit("shoot:shots.2.kind", "video");
  await p.edit("shoot:shots.1.must", true);
  await p.edit("shoot:lists.tips", "one\n\n two ");
  await p.edit("shoot:window_days", "3");
  assert.equal(p.el("cphDirty").innerHTML, "Unsaved changes");
  await p.click("shoot-save");
  const a = p.last("photo.shoot.save").args;
  assert.equal(a.sid, 40);
  assert.equal(a.rev, "0123456789abcdef");
  assert.equal(a.name, "New name");
  assert.equal(a.window_days, 3);
  assert.deepEqual(a.brief.shots, [{ must: true, shot: `Shot ${EVIL}`, frame: EVIL, kind: "drone" }, { must: true, shot: "Wide", frame: "", kind: "photo" },
    { must: true, shot: "Crane lift", frame: "", kind: "video" }]);
  assert.deepEqual(a.brief.tips, ["one", "two"]);
  assert.deepEqual(a.brief.drone, { needed: true, notes: EVIL });
  assert.deepEqual(Object.keys(a.brief).sort(), ["caption_ideas", "drone", "equipment", "purpose", "safety", "sample_shot", "shots", "time_of_day", "tips"],
    "only the parts the editor shows; the PC keeps the brief's other keys");
  assert.equal(p.S.shoot[40].rev, "fedcba9876543210", "the next save carries the new rev");
  assert.equal(p.el("cphDirty").innerHTML, "");
});

test("a shoot save refused for its own words, and a rev the PC calls changed, say so", async () => {
  const p = await open({ hash: "#/photo/plan/12/shoot/40", over: { "photo.shoot.save": () => ({ __reject: { code: "changed", message: "Someone changed this since you opened it — reload and try again." } }) } });
  await p.edit("shoot:lists.tips", Array.from({ length: 11 }, (_, i) => "tip " + i).join("\n"));
  await p.click("shoot-save");
  assert.equal(p.calls_of("photo.shoot.save").length, 0, "eleven tips never leave the page");
  assert.ok(p.toasts.some((t) => t.t === "Tips: at most 10 lines." && t.bad));
  await p.edit("shoot:lists.tips", "ok");
  await p.click("shoot-save");
  assert.ok(p.toasts.some((t) => /Someone changed this/.test(t.t) && t.bad));
});

test("unsaved edits to a shoot are kept while the admin looks elsewhere — and set aside if the PC's copy changed", async () => {
  const p = await open({ hash: "#/photo/plan/12/shoot/40" });
  await p.edit("shoot:purpose", "Kept words");
  await p.go("#/photo/upcoming");
  await p.go("#/photo/plan/12/shoot/40");
  assert.match(p.html(), /Your unsaved changes from before are kept/);
  assert.match(p.html(), />Kept words<\/textarea>/);
  const q = await open({ hash: "#/photo/plan/12/shoot/40", over: { "photo.shoot": (() => { let n = 0; return () => shoot({ rev: n++ ? "9999999999999999" : "0123456789abcdef" }); })() } });
  await q.edit("shoot:purpose", "Old words");
  q.S.cache = {};
  await q.go("#/photo/plan/12/shoot/40");
  assert.match(q.html(), /changed on the DCR server while you were editing it/);
});

test("a shoot's actions: each one sends what its method takes, and the changes go through ctx.act", async () => {
  const p = await open({ hash: "#/photo/plan/12/shoot/40" });
  await p.click({ "data-ph": "act-open", "data-a": "send" });
  assert.ok(p.el("cphPanel").innerHTML.includes(escHtml(`Heads-up ${EVIL}`)));
  assert.match(p.el("cphPanel").innerHTML, /Dry run — nothing is really sent/);
  await p.click({ "data-ph": "send", "data-kind": "heads_up" });
  assert.deepEqual(p.calls.filter((c) => c.method === "photo.shoot.send").map((c) => [c.via, c.args]),
    [["act", { sid: 40, kind: "heads_up" }], ["act-confirmed", { sid: 40, kind: "heads_up", confirmed: true }]]);
  assert.equal(p.confirms.pop().title, "Send reminder now", "the PC's question");

  await p.click({ "data-ph": "act-open", "data-a": "done" });
  await p.edit("act:note", " 120 photos ");
  await p.click("done");
  assert.deepEqual(p.last("photo.shoot.done").args, { sid: 40, note: "120 photos", confirmed: true });

  await p.click({ "data-ph": "act-open", "data-a": "skip" });
  await p.click("skip");
  assert.equal(p.calls_of("photo.shoot.skip").length, 0, "a skip needs its reason");
  await p.edit("act:skip_m", true);
  await p.edit("act:reason", "rain all week");
  await p.click("skip");
  assert.deepEqual(p.last("photo.shoot.skip").args, { sid: 40, reason: "rain all week", status: "missed", confirmed: true });

  await p.click({ "data-ph": "act-open", "data-a": "move" });
  assert.match(p.el("cphPanel").innerHTML, /Tell the photographer/, "an announced shoot asks whether to tell the photographer");
  await p.edit("act:day", "2026-10-20");
  p.runTimers();
  await flush();
  assert.deepEqual(p.last("photo.shoot.move_check").args, { sid: 40, day: "2026-10-20" });
  assert.equal(p.el("cphMoveCheck").innerHTML, escHtml(`2026-10-20: no forecast ${EVIL}`));
  await p.edit("act:notify", false);
  await p.click("move");
  assert.deepEqual(p.last("photo.shoot.move").args, { sid: 40, day: "2026-10-20", reason: "", notify: false, confirmed: true });

  p.accept = false;
  const before = p.calls.length;
  await p.click({ "data-ph": "act-open", "data-a": "done" });
  await p.click("done");
  assert.equal(p.calls.slice(before).filter((c) => c.method === "photo.shoot.done").map((c) => c.via).join(), "act",
    "declined: asked, never done");
});

test("bring back asks for a day only when its own day has passed; a disabled action says why", async () => {
  const s = shoot({ status: "skipped", actions: [{ action: "send", enabled: false, why: `it is skipped ${EVIL}` },
    { action: "bring_back", enabled: true, why: "", needs_day: true }] });
  const p = await open({ hash: "#/photo/plan/12/shoot/40", over: { "photo.shoot": s } });
  await p.click({ "data-ph": "why" });
  assert.ok(p.el("cphPanel").innerHTML.includes(escHtml(`Not now — it is skipped ${EVIL}.`)));
  await p.click({ "data-ph": "act-open", "data-a": "bring_back" });
  await p.click("bring_back");
  assert.equal(p.calls_of("photo.shoot.bring_back").length, 0, "no day picked yet");
  await p.edit("act:day", "2026-10-21");
  await p.click("bring_back");
  assert.deepEqual(p.last("photo.shoot.bring_back").args, { sid: 40, day: "2026-10-21", confirmed: true });
  const bad = await open({ hash: "#/photo/plan/12/shoot/40", over: { "photo.shoot": shoot({ link: "javascript:alert(1)" }) } });
  noRaw(bad.html());
  assert.ok(!/Open its task ↗/.test(bad.html()), "a task link that is not https: is never drawn");
  assert.ok(bad.find({ "data-ph": "why", "aria-disabled": "true" }), "the entry stays, greyed");
  const q = await open({ hash: "#/photo/plan/12/shoot/40", over: { "photo.shoot": shoot({ status: "skipped",
    actions: [{ action: "bring_back", enabled: true, why: "", needs_day: false }] }) } });
  await q.click({ "data-ph": "act-open", "data-a": "bring_back" });
  await q.click("bring_back");
  assert.deepEqual(q.last("photo.shoot.bring_back").args, { sid: 40, day: null, confirmed: true });
});

test("post kit and debrief: Claude's words escaped, copy buttons, lessons and a rule added to the Playbook", async () => {
  const p = await open({ hash: "#/photo/plan/12/shoot/40" });
  await p.click({ "data-ph": "act-open", "data-a": "post_kit" });
  assert.deepEqual(p.last("photo.shoot.post_kit").args, { sid: 40 });
  const kit = p.el("cphKit").innerHTML;
  noRaw(kit);
  assert.ok(kit.includes(escHtml(`Insta ${EVIL}`)) && kit.includes(escHtml(`#a ${EVIL}`)));
  await p.click({ "data-ph": "kit-copy", "data-k": "hashtags" });
  assert.deepEqual(p.clipboard, [`#a ${EVIL}`], "the words themselves, not the markup");
  await p.click({ "data-ph": "act-open", "data-a": "debrief" });
  await p.click({ "data-ph": "star", "data-n": "5" });
  await p.edit("act:used.0", true);
  await p.edit("act:dnote", "Go earlier");
  await p.click("debrief");
  assert.deepEqual(p.last("photo.shoot.debrief").args, { sid: 40, rating: 5, note: "Go earlier", used: [`Shot ${EVIL}`] });
  const lessons = p.el("cphLessons").innerHTML;
  noRaw(lessons);
  assert.ok(lessons.includes(escHtml(`Lesson ${EVIL}`)));
  const t = await p.click({ "data-ph": "lesson-add", "data-i": "0" });
  /* the server looks the proposal up on the shoot and keeps it as a debrief rule; the page sends no words */
  assert.deepEqual(p.last("photo.debrief.accept").args, { sid: 40, n: 0 });
  assert.equal(p.last("photo.rule.add"), undefined);
  assert.equal(t.textContent, "Added ✓");
});

test("a debrief rule on an older DCR server (no photo.debrief.accept) is added by its words", async () => {
  const p = await open({ hash: "#/photo/plan/12/shoot/40", missing: ["photo.debrief.accept"] });
  await p.click({ "data-ph": "act-open", "data-a": "debrief" });
  await p.click({ "data-ph": "star", "data-n": "4" });
  await p.click("debrief");
  await p.click({ "data-ph": "lesson-add", "data-i": "0" });
  assert.deepEqual(p.last("photo.rule.add").args, { text: `Rule ${EVIL}`, category: "shots" });
});

test("the plan's header: pause, archive (asked), sync, the photographer, and its own copy list", async () => {
  const p = await open({ hash: "#/photo/plan/12" });
  await p.click({ "data-ph": "plan-status", "data-action": "pause" });
  assert.deepEqual(p.calls.filter((c) => c.method === "photo.plan.status").map((c) => c.via), ["act"], "pause is not asked (C?)");
  assert.deepEqual(p.last("photo.plan.status").args, { pid: 12, action: "pause" });
  await p.click({ "data-ph": "plan-status", "data-action": "archive" });
  assert.deepEqual(p.last("photo.plan.status").args, { pid: 12, action: "archive", confirmed: true });
  await p.click("plan-sync");
  assert.deepEqual(p.last("photo.plan.sync").args, { pid: 12 });
  assert.ok(p.toasts.some((t) => t.t === `Read ${EVIL}`));
  p.modalAnswers.push({ who: "Maria Ortiz" });
  await p.click("plan-who");
  assert.equal(p.modals.pop().fields[0].options[0].label, `The usual photographer (Pat ${EVIL})`);
  assert.deepEqual(p.last("photo.plan.photographer").args, { pid: 12, name: "Maria Ortiz" });

  await p.click("plan-copies");
  const panel = p.el("cphCopies").innerHTML;
  noRaw(panel);
  assert.ok(panel.includes(escHtml(`opted out ${EVIL}`)), "an opt-out keeps its chip and says so");
  await p.edit("pc:typed", "not an address");
  await p.click({ "data-ph": "cc-add-typed", "data-scope": "pc" });
  assert.equal(p.el("cphCcProblem-pc").innerHTML, "That is not an email address — it has no @.");
  await p.edit("pc:typed", "Ana Lopez <ANA@Example.test>");
  await p.click({ "data-ph": "cc-add-typed", "data-scope": "pc" });
  await p.edit("pc:pick", "joe@example.test");
  await p.click({ "data-ph": "cc-add-roster", "data-scope": "pc" });
  await p.edit("pc:kind|followups", true);
  await p.click({ "data-ph": "cc-del", "data-scope": "pc", "data-email": "maria@example.test" });
  await p.click("pc-save");
  assert.deepEqual(p.last("photo.plan.copies.save").args, { pid: 12, people: [{ name: "Ana Lopez", email: "ana@example.test" },
    { name: "Joe", email: "joe@example.test" }], kinds: ["heads_up", "followups"] });
});

test("Revise with AI, Make it again with the standard plan when Claude fails, Approve & start saving the shoot first", async () => {
  const p = await open({ hash: "#/photo/plan/12" });
  await p.edit("rev:words", "move the drone shoot after the roof");
  await p.click("plan-revise");
  assert.deepEqual(p.last("photo.plan.revise").args, { pid: 12, words: "move the drone shoot after the roof" });
  assert.ok(p.busy.some((w) => /Claude is revising the plan/.test(w)));

  let n = 0;
  const review = project({ status: "review", buttons: { ...project().buttons, approve: true, remake: true } });
  const q = await open({ hash: "#/photo/plan/12/shoot/40", over: { "photo.project": review,
    "photo.plan.remake": (a) => (!a.confirmed ? CONFIRM("Make it again") : a.use_ai ? { __reject: { code: "refused", message: `Claude is busy ${EVIL}` } } : { words: `fresh ${++n}` }) } });
  await q.click("plan-remake");
  assert.deepEqual(q.last("photo.plan.remake").args, { pid: 12, use_ai: true, confirmed: true });
  assert.ok(q.el("cphEscape").innerHTML.includes(escHtml(`Claude is busy ${EVIL}`)));
  await q.click("plan-remake-std");
  assert.deepEqual(q.last("photo.plan.remake").args, { pid: 12, use_ai: false, confirmed: true });
  const r = await open({ hash: "#/photo/plan/12/shoot/40", over: { "photo.project": review } });
  await r.edit("shoot:name", "Renamed");
  await r.click("plan-approve");
  const order = r.calls.filter((c) => ["photo.shoot.save", "photo.plan.approve"].includes(c.method)).map((c) => c.method);
  assert.deepEqual(order, ["photo.shoot.save", "photo.plan.approve", "photo.plan.approve"], "the edits are saved, then asked, then approved");
  assert.deepEqual(r.last("photo.plan.approve").args, { pid: 12, confirmed: true });
});

/* ── the setup wizard ─────────────────────────────────────────────────── */

test("a new plan: the portal's projects, search, one with a plan already is greyed, facts, then the draft", async () => {
  const p = await open({ hash: "#/photo/new" });
  noRaw(p.html());
  assert.match(p.el("cphWizList").innerHTML, /data-id="901"[^>]*disabled/, "a project with a photo plan cannot be picked");
  await p.edit("wiz:q", "hillside", "input");
  const list = p.el("cphWizList").innerHTML;
  assert.ok(list.includes("905") && !list.includes('data-id="904"'));
  await p.click({ "data-ph": "wiz-pick", "data-id": "905" });
  assert.deepEqual(p.last("photo.wizard.facts").args, { spid: "905" });
  assert.ok(p.el("cphFacts").innerHTML.includes(escHtml(`Z105 ${EVIL}`)));
  assert.equal(p.el("cphWizNext").disabled, false);
  await p.click("wiz-create");
  assert.deepEqual(p.last("photo.wizard.create").args, { spid: "905", label: `Z105 Hillside ${EVIL}` });
  assert.equal(p.went.pop(), "#/photo/plan/21");
});

test("the brief, Claude's questions with choices and own words, the next round, the plan — and the standard plan when Claude fails", async () => {
  const draft = project({ id: 14, status: "draft", chip: ["Setting up", "amber"] });
  const p = await open({ hash: "#/photo/plan/14", over: { "photo.project": draft } });
  noRaw(p.html());
  assert.deepEqual(p.last("photo.wizard.state").args, { pid: 14 });
  assert.ok(p.html().includes(escHtml(`Brief ${EVIL}`)));
  await p.edit("brief:text", "A barn");
  await p.edit("brief:ms.framing_complete.unsure", false);
  await p.edit("brief:ms.framing_complete.day", "2026-11-20");
  await p.edit("brief:ms.framing_complete.firm", true);
  await p.click("wiz-start");
  assert.deepEqual(p.last("photo.wizard.start").args, { pid: 14, brief: "A barn", photographer: "", milestones: [
    { key: "framing_start", day: "2026-09-28", confirmed: true }, { key: "delivery", day: "2026-09-25", confirmed: false },
    { key: "framing_complete", day: "2026-11-20", confirmed: true }, { key: "house_complete", day: null, confirmed: false }] });
  const round = p.el("cphWiz").innerHTML;
  noRaw(round);
  assert.ok(round.includes(escHtml(`What I understand so far: An ADU ${EVIL}`)));
  assert.ok(round.includes(escHtml(`Asked by ${EVIL}`)));
  assert.match(round, /type="date" data-f="ans:framing_start.date"/, "a date question has a date picker");
  await p.click({ "data-ph": "wiz-choice", "data-q": "crane", "data-i": "1" });
  await p.edit("ans:framing_start.date", "2026-10-19");
  await p.click("wiz-next");
  assert.deepEqual(p.last("photo.wizard.next").args, { pid: 14, answers: { crane: `No ${EVIL}`, framing_start: "2026-10-19" } });
  await p.edit("ans:drone.own", "Yes, at the end");
  await p.click("wiz-finish");
  assert.deepEqual(p.last("photo.wizard.finish").args, { pid: 14, answers: { drone: "Yes, at the end" } });
  assert.ok(p.toasts.some((t) => t.t === "Here is the plan."));

  const q = await open({ hash: "#/photo/plan/14", over: { "photo.project": draft,
    "photo.wizard.start": () => ({ __reject: { code: "refused", message: `Claude said no ${EVIL}` } }) } });
  await q.click("wiz-start");
  assert.ok(q.el("cphEscape").innerHTML.includes(escHtml(`Claude said no ${EVIL}`)));
  await q.click({ "data-ph": "wiz-escape", "data-step": "next" });
  assert.deepEqual(q.last("photo.wizard.next").args, { pid: 14, answers: {}, use_ai: false }, "the answers already given are on the PC");
  assert.match(q.el("cphWiz").innerHTML, /round 2 of 3/);
});

/* ── Playbook & Coach, settings ───────────────────────────────────────── */

test("the Playbook: tick, add, edit, delete (asked), export and import; the Coach: ask and accept by chat id", async () => {
  const p = await open({ hash: "#/photo/playbook" });
  noRaw(p.html());
  await p.change({ "data-ch": "rule-on", "data-id": "1" }, "", { checked: false });
  assert.deepEqual(p.last("photo.rule.update").args, { id: 1, active: false });
  p.modalAnswers.push({ text: "  Always a vertical clip  ", category: "shots" });
  await p.click("rule-add");
  assert.deepEqual(p.last("photo.rule.add").args, { text: "Always a vertical clip", category: "shots" });
  assert.equal(p.modals.pop().fields[1].options.length, 3);
  p.modalAnswers.push({ text: "Edited", category: "style" });
  await p.click({ "data-ph": "rule-edit", "data-id": "1" });
  assert.deepEqual(p.last("photo.rule.update").args, { id: 1, text: "Edited", category: "style" });
  await p.click({ "data-ph": "rule-del", "data-id": "2" });
  assert.deepEqual(p.last("photo.rule.delete").args, { id: 2, confirmed: true });
  await p.click("pb-export");
  assert.equal(JSON.parse(p.downloads.pop()).kind, "dcr-photo-playbook", "built in the browser; the PC writes no file");
  const file = p.find({ "data-ch": "pb-file" });
  const big = { kind: "dcr-photo-playbook", rules: Array.from({ length: 400 }, (_, i) => ({ text: "x".repeat(60) + i })) };
  const t = p.target(file, { files: [{ size: 30000, text: JSON.stringify(big) }] });
  (p.root.listeners.change || []).forEach((fn) => fn({ target: t }));
  await flush();
  assert.ok(p.toasts.some((x) => /too large for the web/.test(x.t)), "a big Playbook is imported on the server computer");
  const t2 = p.target(file, { files: [{ size: 50, text: JSON.stringify({ kind: "dcr-photo-playbook", rules: [{ text: "a" }] }) }] });
  (p.root.listeners.change || []).forEach((fn) => fn({ target: t2 }));
  await flush();
  assert.deepEqual(p.last("photo.playbook.import").args, { data: { kind: "dcr-photo-playbook", rules: [{ text: "a" }] }, confirmed: true });

  const q = await open({ hash: "#/photo/playbook" });
  assert.match(q.html(), /In the Playbook ✓/);
  const acc = await q.click({ "data-ph": "coach-accept", "data-n": "0" });
  assert.deepEqual(q.last("photo.coach.accept").args, { chat_id: 6, n: 0 }, "the proposal is looked up on the PC by its chat row");
  assert.equal(acc.textContent, "Added ✓");
  await q.edit("coach:words", "Crane lifts are the best");
  await q.click("coach-send");
  assert.deepEqual(q.last("photo.coach.ask").args, { words: "Crane lifts are the best" });
  assert.ok(q.el("cphCoach").innerHTML.includes(escHtml(`New ${EVIL}`)));
});

test("Photo & Video settings: drawn from settings.get, only what changed is saved with the rev, shoot days and copies checked first", async () => {
  const p = await open({ hash: "#/photo/settings" });
  const html = p.html();
  noRaw(html);
  assert.ok(html.includes(escHtml(`Photographer ${EVIL}`)) && html.includes(escHtml(`Automatic — the portal's best guess (Hint ${EVIL})`)));
  assert.ok(html.includes(escHtml(`The admin email (office@${EVIL})`)));
  assert.ok(html.includes(escHtml(`Joe ${EVIL}  ·  joe@example.test`)));
  await p.click("set-save");
  assert.equal(p.calls_of("settings.save").length, 0);
  assert.equal(p.el("cphSetMsg").textContent, "Nothing changed.");
  await p.edit("set:photo.lead_days", "5");
  await p.edit("set:photo.shoot_days|5", false);
  await p.edit("set:photo.cc_kinds|day_before", true);
  await p.edit("cc:typed", "pm@example.test");
  await p.click("set-save");
  const a = p.last("settings.save").args;
  assert.deepEqual(a, { section: "photo", rev: "abcdefabcdefabcd", values: { "photo.lead_days": 5, "photo.shoot_days": [0, 1, 2, 3, 4],
    "photo.cc": [{ name: `Joe ${EVIL}`, email: "joe@example.test" }, { name: "", email: "pm@example.test" }],
    "photo.cc_kinds": ["heads_up", "followups", "day_before"] } });
  assert.ok(p.toasts.some((t) => /New dates follow the new shoot days/.test(t.t)));

  const q = await open({ hash: "#/photo/settings", over: { "settings.save": () => ({ __reject: { code: "refused", message: "Nothing was saved." } }) } });
  for (let d = 0; d < 6; d++) await q.edit(`set:photo.shoot_days|${d}`, false);
  await q.click("set-save");
  assert.equal(q.el("cphSetMsg").textContent, "Pick at least one shoot day. Nothing was saved.");
  await q.edit("set:photo.shoot_days|2", true);
  await q.edit("cc:typed", "two@a.test, three@b.test");
  await q.click("set-save");
  assert.equal(q.el("cphSetMsg").textContent, "Also send copies to: One address at a time. Nothing was saved.");
  assert.equal(q.calls_of("settings.save").length, 0);
});

/* ── the printouts ────────────────────────────────────────────────────── */

test("Print schedule: the desktop printout's sections, ruled lines and boxes, escaped, with the paper and the footer", async () => {
  const p = await open({ hash: "#/photo/print/12" });
  assert.deepEqual(p.last("photo.print").args, { pid: 12, shoot_id: null, include_done: false, notes: "few", one_per_page: false, paper: "letter" });
  const doc = p.el("cphPreview").innerHTML;
  noRaw(doc);
  const order = ["PHOTO &amp; VIDEO SCHEDULE", "The game plan", "The story:", "Milestones", "The schedule at a glance", "SHOOT 1 OF 3",
    "SHOOT 2 OF 3 · FRAMING PROGRESS", "When:", "Light:", "Forecast:", "PURPOSE", "SHOT LIST", "SAMPLE SHOT", "TIPS", "BRING", "SAFETY",
    "DRONE", "CAPTION IDEAS", "NOTES · SHOOT 2 OF 3", "Before every visit", "PACK", "ON SITE", "General notes"];
  let at = -1;
  for (const w of order) { const i = doc.indexOf(w, at + 1); assert.ok(i > at, `${w} in order`); at = i; }
  assert.ok(doc.includes(escHtml(`DCR ${EVIL}`.toUpperCase()) + " · OFFICE (805) 555-0100"), "the company and its phone over the title");
  assert.ok(doc.includes("Sat Oct 10, 2026") && doc.includes("Fri Oct 2, 2026") && doc.includes("Not known yet"));
  assert.ok(doc.includes("6:01–6:38 pm"), "the golden hour with an en dash");
  assert.ok(doc.includes(escHtml(`Light ${EVIL}`)) && doc.includes(escHtml(`Not listed: 1 skipped shoot ${EVIL}`)));
  assert.ok(doc.includes(escHtml(`golden hour for Town ${EVIL} (town) 5:56–6:30 pm · sunset 6:30 pm`)));
  assert.ok(doc.includes("can slip up to 2 days"));
  assert.ok(doc.includes("Date to be set — the office will tell you the day"));
  assert.ok(doc.includes("<b>Done</b> " + escHtml(`— 120 photos ${EVIL}`)), "a done shoot says so, with its note");
  const lines = (doc.match(/class="cpr-line"/g) || []).length;
  assert.equal(lines, 3 * 6 + 5, "six lines under each of the three shoots, five general notes");
  assert.match(doc, /aria-label="done"/, "a done shoot is ticked");
  assert.equal((doc.match(/cpr-newpage/g) || []).length, 0);
  assert.ok(doc.includes(escHtml(`Airspace ${EVIL}`)), "the drone check under a drone shoot");

  await p.edit("pr:notes", "half");
  await p.edit("pr:one_per_page", true);
  const doc2 = p.el("cphPreview").innerHTML;
  assert.equal((doc2.match(/class="cpr-line"/g) || []).length, 3 * 16 + 5);
  assert.equal((doc2.match(/cpr-newpage/g) || []).length, 3, "each shoot on a page of its own, the first after the glance");
  assert.equal(p.calls_of("photo.print").length, 1, "the layout choices redraw from the same model");
  await p.edit("pr:notes", "none");
  assert.equal((p.el("cphPreview").innerHTML.match(/class="cpr-line"/g) || []).length, 5);
  await p.edit("pr:paper", "a4");
  await p.click("print-now");
  const pr = p.printed.pop();
  assert.deepEqual(clone(pr.o), { title: "Z101 photo & video schedule 2026-10-10", paper: "a4" }, "Save as PDF suggests the desktop's file name");
  assert.match(pr.html, /^<style>@page\{size:A4 portrait;/);
  assert.match(pr.html, /@bottom-left\{content:"Z101 · Photo & Video schedule \\3C img src=x onerror=alert\(1\)> · page " counter\(page\) " of " counter\(pages\)/);
  assert.match(pr.html, /@bottom-right\{content:"Printed Sat Oct 10, 2026"/);
  assert.ok(!/<\/style>.*<\/style>/s.test(pr.html), "nothing from the server can close the style early");
  assert.deepEqual(p.last("photo.print").args, { pid: 12, shoot_id: null, include_done: false, notes: "none", one_per_page: true, paper: "a4" },
    "the PC remembers the choices for next time, as the desktop does");
  assert.deepEqual(JSON.parse(p.store.get("dcr.console.photoPrint.v1")), { include_done: false, notes: "none", one_per_page: true, paper: "a4" });
  await p.edit("pr:include_done", true);
  assert.equal(p.last("photo.print").args.include_done, true, "done shoots: the model is read again");
});

test("Print this shoot's page and Print this list: the same header, one shoot; the agenda by group with a column to write in", async () => {
  const p = await open({ hash: "#/photo/print/12?shoot=2" });
  assert.deepEqual(p.last("photo.print").args, { pid: 12, shoot_id: 2, include_done: false, notes: "few", one_per_page: false, paper: "letter" });
  const doc = p.el("cphPreview").innerHTML;
  assert.ok(doc.includes("PHOTO &amp; VIDEO SCHEDULE") && doc.includes("SHOOT 2 OF 3"));
  assert.ok(!doc.includes("The schedule at a glance") && !doc.includes("Before every visit"));
  assert.equal((doc.match(/class="cpr-line"/g) || []).length, 6);
  assert.ok(!p.find({ "data-f": "pr:one_per_page" }) && !p.find({ "data-f": "pr:include_done" }));
  assert.match(p.html(), /href="#\/photo\/plan\/12\/shoot\/2"/);

  const q = await open({ hash: "#/photo/print/agenda?pid=12" });
  assert.deepEqual(q.last("photo.print_agenda").args, { pid: 12, include_done: false });
  const ag = q.el("cphPreview").innerHTML;
  noRaw(ag);
  for (const w of ["PHOTO &amp; VIDEO SHOOTS", "Shoots", "Done", "Project", "Shoot and time of day", "Notes", "To be set", "Not listed: 1 shoot done recently."]) {
    assert.ok(ag.includes(w), w);
  }
  assert.ok(ag.includes(escHtml(`3 later shoots are not on this printout ${EVIL}`)), "what was left off is said on the paper");
  assert.equal((ag.match(/class="cpr-write"/g) || []).length, 2);
  assert.ok(!q.find({ "data-f": "pr:notes" }));
  await q.click("print-now");
  assert.equal(q.printed.pop().o.title, "Photo & video shoots 2026-10-10");
});

test("the paper's CSS: rows, boxes and lines never split, headings kept with what follows, black on white", () => {
  for (const rule of [/\.cpr-tr\{[^}]*break-inside:avoid/, /\.cpr-line\{[^}]*break-inside:avoid/, /\.cpr-check\{[^}]*break-inside:avoid/,
    /\.cpr-keep\{break-inside:avoid/, /\.cpr-h2\{[^}]*break-after:avoid/, /\.cpr-label\{[^}]*break-after:avoid/, /\.cpr-newpage\{break-before:page/,
    /\.cpr\{color:#000; background:#fff/]) {
    assert.match(CSS.replace(/\s*\n\s*/g, " "), rule);
  }
  assert.match(CSS, /:root\[data-theme="dark"\] \.cph\{/, "the tab's own colours are redefined for an explicit dark theme");
});

/* ── when things go wrong ─────────────────────────────────────────────── */

test("a page the server cannot answer says why with Try again; a plan that is gone says so", async () => {
  const p = await open({ hash: "#/photo/upcoming", over: { "photo.upcoming": () => ({ __reject: { code: "offline", message: `The DCR server is offline ${EVIL}` } }) } });
  const body = p.el("cphBody").innerHTML;
  noRaw(body);
  assert.match(body, /The DCR server is not available right now\./);
  assert.ok(body.includes(escHtml(`The DCR server is offline ${EVIL}`)));
  assert.ok(p.find({ "data-ph": "reload" }));
  const q = await open({ hash: "#/photo/plan/99", over: { "photo.project": () => ({ __reject: { code: "not_found", message: "That plan no longer exists." } }) } });
  assert.match(q.el("cphPlan").innerHTML, /Not found\.<\/b><span>That plan no longer exists\./);
  const r = await open({ hash: "#/photo/plan/abc" });
  assert.ok(r.calls_of("photo.overview").length === 1 && !r.calls_of("photo.project").length, "a bad id is the plans list");
});
