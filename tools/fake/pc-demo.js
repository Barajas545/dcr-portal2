/* DCR Portal 2 — DEMO MODE ONLY: a made-up DCR server computer running DCR Agents 2.

   The console relay's other end (tools/fake/p6.js pc.step takes a request and asks answer() here) and
   the personal assistant's answers (pc.answerChats asks reply() here). The answers have the shapes the
   real DCR Agents 2 console handlers return (dcragents/console/handlers_*.py, the old console-spec
   §6.1), with made-up people, jobs and numbers only. A method that changes something answers in the
   PC's words and, where the real one asks first ("C"), asks first: the page shows the question and
   calls again with confirmed:true. Nothing here is ever published.

   METHODS is the real allowlist of DCR Agents 2 (read from its registry: name, area, R/W, confirm,
   lane, timeout, Claude), so console.methods answers what the real computer would. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  // [name, area, kind, confirm, lane, timeout, ai] - DCR Agents 2's dcragents/console/handlers_*.py @method(...)
  const METHODS = [
    ["activity.sends","activity","R","","q",15,false],
    ["activity.send","activity","R","","q",10,false],
    ["activity.events","activity","R","","q",15,false],
    ["activity.runs","activity","R","","q",15,false],
    ["activity.remote","activity","R","","q",15,false],
    ["agents.list","agents","R","","q",15,false],
    ["agents.form","agents","R","","q",10,false],
    ["agents.get","agents","R","","q",10,false],
    ["agents.new","agents","R","","q",10,false],
    ["agents.check","agents","R","","q",10,false],
    ["agents.save","agents","W","","q",15,false],
    ["agents.toggle","agents","W","C?","q",10,false],
    ["agents.duplicate","agents","W","","q",10,false],
    ["agents.delete","agents","W","C","q",10,false],
    ["agents.preview","agents","R","","s",180,true],
    ["agents.run_now","agents","W","C","s",300,false],
    ["assistants.list","assistants","R","","q",20,false],
    ["assistants.employee","assistants","R","","q",20,false],
    ["assistants.set_on","assistants","W","C","s",120,false],
    ["assistants.tell_pages","assistants","W","C","s",120,false],
    ["assistants.item.check","assistants","R","","q",10,false],
    ["assistants.item.add","assistants","W","","q",30,false],
    ["assistants.briefing.send","assistants","W","C","s",240,true],
    ["assistants.ask_as","assistants","R","","s",180,true],
    ["dashboard.status","dashboard","R","","q",15,false],
    ["dashboard.health","dashboard","R","","s",60,false],
    ["dashboard.first_run","dashboard","R","","q",15,false],
    ["dashboard.approve","dashboard","W","C","q",20,false],
    ["dashboard.pause","dashboard","W","C","q",10,false],
    ["console.methods","meta","R","","q",10,false],
    ["console.ping","meta","R","","q",5,false],
    ["people.list","people","R","","q",15,false],
    ["people.save","people","W","","q",10,false],
    ["people.refresh","people","W","","s",90,false],
    ["people.test_text","people","W","C","s",60,false],
    ["photo.overview","photo","R","","q",20,false],
    ["photo.project","photo","R","","q",20,false],
    ["photo.upcoming","photo","R","","q",20,false],
    ["photo.calendar","photo","R","","q",20,false],
    ["photo.suggestions","photo","R","","q",15,false],
    ["photo.suggestion.apply","photo","W","","s",60,false],
    ["photo.suggestion.dismiss","photo","W","","q",10,false],
    ["photo.suggestions.apply_safe","photo","W","","s",120,false],
    ["photo.shoot","photo","R","","q",15,false],
    ["photo.shoot.save","photo","W","","q",20,false],
    ["photo.shoot.conditions","photo","R","","s",30,false],
    ["photo.shoot.move_check","photo","R","","q",15,false],
    ["photo.shoot.send","photo","W","C","s",120,false],
    ["photo.shoot.done","photo","W","C","q",30,false],
    ["photo.shoot.skip","photo","W","C","q",30,false],
    ["photo.shoot.move","photo","W","C","q",30,false],
    ["photo.shoot.bring_back","photo","W","C","q",30,false],
    ["photo.shoot.post_kit","photo","R","","s",240,true],
    ["photo.shoot.debrief","photo","W","","s",240,true],
    ["photo.milestones.preview","photo","R","","q",20,false],
    ["photo.milestones.save","photo","W","","s",60,false],
    ["photo.plan.photographer","photo","W","","q",20,false],
    ["photo.plan.copies","photo","R","","q",15,false],
    ["photo.plan.copies.save","photo","W","","q",20,false],
    ["photo.plan.sync","photo","W","","s",120,false],
    ["photo.plan.status","photo","W","C?","q",30,false],
    ["photo.plan.revise","photo","W","","s",300,true],
    ["photo.plan.remake","photo","W","C","s",300,true],
    ["photo.plan.approve","photo","W","C","s",120,false],
    ["photo.wizard.projects","photo","R","","s",60,false],
    ["photo.wizard.facts","photo","R","","s",60,false],
    ["photo.wizard.create","photo","W","","s",60,false],
    ["photo.wizard.state","photo","R","","q",15,false],
    ["photo.wizard.start","photo","W","","s",300,true],
    ["photo.wizard.next","photo","W","","s",300,true],
    ["photo.wizard.finish","photo","W","","s",300,true],
    ["photo.rules","photo","R","","q",15,false],
    ["photo.rule.add","photo","W","","q",10,false],
    ["photo.rule.update","photo","W","","q",10,false],
    ["photo.rule.delete","photo","W","C","q",10,false],
    ["photo.coach","photo","R","","q",15,false],
    ["photo.coach.ask","photo","W","","s",240,true],
    ["photo.coach.accept","photo","W","","q",10,false],
    ["photo.debrief.accept","photo","W","","q",10,false],
    ["photo.playbook.export","photo","R","","q",20,false],
    ["photo.playbook.import","photo","W","C","q",30,false],
    ["photo.print","photo","R","","q",30,false],
    ["photo.print_agenda","photo","R","","q",30,false],
    ["recurring.history","agents","R","","q",15,false],
    ["recurring.run_now","agents","W","C","s",180,false],
    ["recurring.mark_done","agents","W","C","s",60,false],
    ["recurring.preview_info","agents","R","","s",240,true],
    ["recurring.projects","agents","R","","s",60,false],
    ["replies.list","replies","R","","q",15,false],
    ["replies.poll","replies","W","","s",150,false],
    ["replies.check","replies","R","","q",10,false],
    ["replies.reply","replies","W","C","s",60,false],
    ["replies.this_is","replies","W","C","s",90,false],
    ["replies.teach","replies","W","","q",15,false],
    ["settings.get","settings","R","","q",10,false],
    ["settings.save","settings","W","","q",20,false],
    ["settings.test","settings","R","","s",90,false],
    ["settings.test_claude","settings","R","","s",60,true],
    ["tasks.board","tasks","R","","s",60,false],
    ["tasks.task","tasks","R","","q",15,false],
    ["tasks.followup","tasks","R","","q",20,false],
    ["tasks.followup_send","tasks","W","C","s",300,false],
    ["timesheets.grid","timesheets","R","","s",60,false],
    ["timesheets.remind","timesheets","W","C","s",300,false],
    ["training.tree","training","R","","q",15,false],
    ["training.scope","training","R","","q",20,false],
    ["training.rule.add","training","W","","q",10,false],
    ["training.rule.update","training","W","","q",10,false],
    ["training.rule.delete","training","W","C","q",10,false],
    ["training.facts.save","training","W","","q",10,false],
    ["training.example.add","training","W","","q",10,false],
    ["training.example.delete","training","W","C","q",10,false],
    ["training.wording.forget","training","W","C?","q",10,false],
    ["training.wording.retry","training","W","","q",10,false],
    ["training.coach.ask","training","W","","s",240,true],
    ["training.coach.apply","training","W","","q",20,false],
    ["training.coach.dismiss","training","W","","q",10,false],
    ["training.smart","training","W","C","q",10,false],
    ["training.export","training","R","","q",30,false],
    ["training.import","training","W","C","q",60,false],
    ["wadesktop.status","wadesktop","R","","q",15,false],
    ["wadesktop.test","wadesktop","R","","s",30,false]
  ];
  const BY_NAME = {};
  for (const m of METHODS) BY_NAME[m[0]] = { name: m[0], area: m[1], kind: m[2], confirm: m[3], lane: m[4], timeout: m[5], ai: m[6], exclusive: "" };

  const HOST = "DCR-OFFICE-PC#agents2";
  const VERSION = "2.1.0";
  const pad = (n) => String(n).padStart(2, "0");
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const dayOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const addDay = (day, n) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayWord = (day) => { const d = new Date(day + "T12:00:00Z"); return WD[d.getUTCDay()] + " " + MO[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const saturdayOf = (day) => { const d = new Date(day + "T12:00:00Z").getUTCDay(); return addDay(day, -(d === 6 ? 0 : d + 1)); };
  const ask = (title, question, ok, danger) => ({ confirm: { title, question, ok_text: ok || "Yes", danger: !!danger, twice: null, extra: [] } });
  const done = (words, extra) => Object.assign({ words }, extra || {});
  const page = (rows, a) => ({ rows, page: { offset: Number(a.offset) || 0, limit: Number(a.limit) || 50, total: rows.length, next: null } });

  /* the people the made-up PC knows (the demo accounts, by their demo names) */
  function people(ctx) {
    const rows = (ctx.rows.profiles || []).filter((p) => p.role !== "agents" && p.full_name);
    return rows.map((p) => ({ name: p.full_name, role: ({ admin: "Admin", manager: "Manager", accountant: "Accountant", lead: "Lead", field: "Field", viewer: "ReadOnly" })[p.role] || p.role,
      phone: p.phone ? "+1" + String(p.phone).replace(/\D/g, "").slice(-10) : "", phone_override: "", email: p.email, email_override: "",
      app: p.role === "field" || p.role === "lead", active: !!p.active, channel_pref: "", muted: false, always_nudge: false,
      flags: p.active ? [] : ["inactive"] }));
  }

  function agentRow(id, name, when, on, extra) {
    return Object.assign({ id, name, when, channels: ["app", "sms"], on, notes: [], waiting: false, pending_review: false, last: null, next: null, next_today: false }, extra || {});
  }
  function agentsTree(ctx) {
    const day = ctx && ctx.now ? dayOf(ctx.now) : dayOf(new Date());
    return {
      feeds: [
        { feed: "timesheets", label: "Missing timesheets", n: 2, on: 1, people: [
          { key: "", label: "Everyone", include: [], n: 2, on: 1, agents: [
            agentRow("a1b2c3d4e5f6", "Timesheet — 5 pm", "weekdays at 17:00", true, { next: day + "T17:00-07:00", next_today: true, last: addDay(day, -1) + "T17:00-07:00" }),
            agentRow("b2c3d4e5f6a1", "Timesheet — second nudge", "weekdays at 19:00", false, { notes: ["dry run"] }),
          ] }] },
        { feed: "stale_tasks", label: "Tasks with no update", n: 1, on: 1, people: [
          { key: "", label: "Everyone", include: [], n: 1, on: 1, agents: [agentRow("c3d4e5f6a1b2", "Tasks — no update for 5 days", "weekdays at 08:00", true, { next: addDay(day, 1) + "T08:00-07:00", last: day + "T08:00-07:00" })] }] },
        { feed: "photo_shoots", label: "Photo & Video — shoot reminders", n: 1, on: 0, people: [
          { key: "", label: "Everyone", include: [], n: 1, on: 0, agents: [agentRow("d4e5f6a1b2c3", "Photo & Video — shoot reminders", "every day at 07:00", false)] }] },
        { feed: "assistant", label: "Personal assistants", n: 1, on: 0, people: [
          { key: "", label: "Everyone", include: [], n: 1, on: 0, agents: [agentRow("e5f6a1b2c3d4", "Personal assistant — briefings & reminders", "every 10 minutes", false)] }] },
        { feed: "estimates", label: "Estimates to follow up", n: 1, on: 0, people: [
          { key: "", label: "Everyone", include: [], n: 1, on: 0, agents: [agentRow("f6a1b2c3d4e5", "Estimate follow-up — 7 days", "weekdays at 09:00", false, { channels: ["email"] })] }] },
        { feed: "checks", label: "Checks ready for pickup", n: 1, on: 0, people: [
          { key: "", label: "Everyone", include: [], n: 1, on: 0, agents: [agentRow("a6b1c2d3e4f5", "Check ready — tell the sub", "weekdays at 10:00", false, { channels: ["sms", "email"] })] }] },
      ],
      feed_choices: [{ feed: "timesheets", label: "Missing timesheets" }, { feed: "stale_tasks", label: "Tasks with no update" },
        { feed: "photo_shoots", label: "Photo & Video — shoot reminders" }, { feed: "estimates", label: "Estimates to follow up" },
        { feed: "checks", label: "Checks ready for pickup" }, { feed: "assistant", label: "Personal assistants" }],
    };
  }
  function agentForm(feed) {
    return {
      feed: feed || "timesheets", who: "Field and Lead crew with a sign-in", vars: ["firstName", "date", "link"], global_vars: ["companyName"],
      roles: ["Admin", "Manager", "Accountant", "Lead", "Field", "ReadOnly"], days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      channel_kinds: [{ kind: "app", label: "DCR app on the phone" }, { kind: "sms", label: "Text message (SMS)" }, { kind: "whatsapp", label: "WhatsApp" }, { kind: "email", label: "Email" }],
      params: [{ name: "recent_days", label: "Only people who logged time in the last", kind: "int", lo: 1, hi: 60, default: 14, suffix: " days", placeholder: "" }],
      min_confidence: [{ key: "certain", label: "certain" }, { key: "likely", label: "likely" }, { key: "guess", label: "guess" }],
      smart: { offered: true, note: "Claude follows the rules on the Training tab." }, note_channels: "Tick the channels this agent may use, in order.",
    };
  }
  function agentGet(id) {
    return { agent: { id: id || "a1b2c3d4e5f6", name: "Timesheet — 5 pm", feed: "timesheets", enabled: true,
      schedule: { kind: "daily", at: "17:00", until: "19:00", days: "weekdays" }, audience: { roles: ["Field", "Lead"], include: [], exclude: [] },
      channels: ["app", "sms"], template: { subject: "Your hours for {{date}}", body: "Hi {{firstName}}, your hours for {{date}} are not in yet: {{link}}", sms: "Hi {{firstName}}, log today's hours: {{link}}",
        whatsapp_content_sid: "", whatsapp_vars: [] },
      rules: { repeat_after_hours: 20, max_reminders: 2, min_confidence: "likely", escalate_to: "", escalate_after: 0, dry_run: false, max_per_run: 25, first_run_reviewed: true },
      feed_params: { recent_days: 14 } }, rev: "0a1b2c3d4e5f6a7b", form: agentForm("timesheets") };
  }

  function dashboardStatus(ctx) {
    const today = dayOf(ctx.now);
    return {
      host: HOST, version: VERSION, paused: !!(ctx.engine && ctx.engine.server && ctx.engine.server() && (ctx.engine.server().payload || {}).paused), dry_run_all: false, last_tick: ctx.now.toISOString(), tick_error: "", zone_warning: "", heartbeat_error: "",
      cards: { sent: 4, failed: 0, replies: 1, agents_on: 2, agents_total: 7 },
      needs: [
        { level: "warn", text: "Set up: the Outlook mailbox for DCR Agents 2 (Settings → Email).", firstrun: null },
        { level: "warn", text: "'Timesheet — second nudge' is in dry run: it records what it would send.", firstrun: null },
      ],
      coming_up: [
        { group: "Timesheets · Everyone", agent_id: "a1b2c3d4e5f6", name: "Timesheet — 5 pm", watches: "Missing timesheets", on: true, next: today + "T17:00-07:00", last: addDay(today, -1) + "T17:00-07:00" },
        { group: "Tasks · Everyone", agent_id: "c3d4e5f6a1b2", name: "Tasks — no update for 5 days", watches: "Tasks with no update", on: true, next: addDay(today, 1) + "T08:00-07:00", last: today + "T08:00-07:00" },
        { group: "Photo & Video · Everyone", agent_id: "d4e5f6a1b2c3", name: "Photo & Video — shoot reminders", watches: "Shoots coming up", on: false, next: null, last: null },
      ],
      recent_runs: [
        { at: new Date(ctx.now.getTime() - 3 * 3600000).toISOString(), agent: "Tasks — no update for 5 days", found: 3, sent: 2, skipped: 1, failed: 0, dry: false, note: "1 already reminded today" },
        { at: new Date(ctx.now.getTime() - 26 * 3600000).toISOString(), agent: "Timesheet — 5 pm", found: 2, sent: 2, skipped: 0, failed: 0, dry: false, note: "" },
      ],
      health: { checked_at: new Date(ctx.now.getTime() - 50 * 60000).toISOString(), rows: [
        { key: "database (Supabase)", ok: true, detail: "signed in as the agents account" }, { key: "phone notifications", ok: true, detail: "the push function answers" },
        { key: "email", ok: false, detail: "Outlook: the DCR Agents mailbox is not added yet" }, { key: "Claude", ok: true, detail: "a key is saved" }] },
      extras: [{ key: "scheduled task", ok: true, detail: "registered correctly" }, { key: "last tick", ok: true, detail: "a few seconds ago" },
        { key: "heartbeat to the database", ok: true, detail: "every minute" }],
      lease: { host: HOST, since: new Date(ctx.now.getTime() - 5 * 3600000).toISOString(), by: "started as the DCR server" },
      console: { workers_busy: 1, fast_until: null },
    };
  }

  function timesheetsGrid(ctx) {
    const today = dayOf(ctx.now);
    const cur = saturdayOf(today), last = addDay(cur, -7);
    const days = (sat) => Array.from({ length: 7 }, (_, i) => { const d = addDay(sat, i); const w = new Date(d + "T12:00:00Z").getUTCDay();
      return { day: d, header: WD[w] + " " + Number(d.slice(8)), weekend: w === 0 || w === 6, ahead: d > today }; });
    const cell = (day, h, where) => (h ? { day, top: h + "h", bottom: where || "", hours: h, filed: true, leave: "", entries: [{ hours: h, leave: "", project: "A301 Hillside ADU", address: where || "", work: "framing" }] }
      : { day, top: "", bottom: "", hours: 0, filed: false, leave: "", entries: [] });
    const row = (name, sat, pattern) => { const ds = days(sat); const cells = ds.map((d, i) => cell(d.day, d.ahead ? 0 : pattern[i] || 0, pattern[i] ? "12 Oak Vista Rd" : ""));
      return { name, cells, total: cells.reduce((s, c) => s + c.hours, 0) }; };
    return { today, rows_count: 9, people_count: 3, weeks: [
      { label: "Last week · " + dayWord(last) + " – " + dayWord(addDay(last, 6)), days: days(last), rows: [row("Jordan Field", last, [0, 0, 8, 8, 8, 8, 8]),
        row("Riley Lead", last, [0, 0, 9, 8, 8, 0, 8]), row("Alex Crew", last, [0, 0, 8, 8, 0, 8, 6])] },
      { label: "This week · " + dayWord(cur) + " – " + dayWord(addDay(cur, 6)), days: days(cur), rows: [row("Jordan Field", cur, [0, 0, 8, 8, 0, 0, 0]),
        row("Riley Lead", cur, [0, 0, 8, 0, 0, 0, 0]), row("Alex Crew", cur, [0, 0, 0, 0, 0, 0, 0])] },
    ] };
  }

  function tasksBoard(ctx) {
    const open = (ctx.rows.tasks || []).filter((t) => t.status === "open" && !t.agent_kind).slice(0, 6);
    const nameOf = (uid) => { const p = (ctx.rows.profiles || []).find((x) => x.id === uid); return p ? p.full_name : "Nobody (unassigned)"; };
    const groups = {};
    for (const t of open) {
      const who = nameOf(t.assigned_to);
      (groups[who] = groups[who] || []).push({ task_id: String(t.id), name: t.title, person: who, assignee: who, reachable: who !== "Nobody (unassigned)",
        unreachable: who === "Nobody (unassigned)" ? "assigned to nobody" : "", stale: true, days_since: 6, days_text: "6 days ago",
        last_update_text: "6 days ago · note", last_note: "", project: "", city: "", category: t.category || "", priority: t.priority || "normal",
        requested_text: "", reminders: [], reminders_short: "", nagged: false, link: "my-tasks.html?task=" + t.id, why_not: "" });
    }
    const list = Object.keys(groups).map((k) => ({ person: k, label: k, key: "person:" + k.toLowerCase(), kind: k === "Nobody (unassigned)" ? "nobody" : "person",
      suffix: " — " + groups[k].length + " open with no update", n_tasks: groups[k].length, n_stale: groups[k].length, tasks: groups[k] }));
    return { stale_days: 5, threshold_words: "the setting of 'Tasks — no update for 5 days'", generated: "now",
      status: { text: open.length + " open tasks with no update — loaded just now", bad: false },
      lender: { id: "c3d4e5f6a1b2", name: "Tasks — no update for 5 days" }, dry: false, cap: 25, groups: list };
  }

  function photoOverview(ctx) {
    const today = dayOf(ctx.now);
    return { ai: { ok: true, words: "Claude Opus 5.5" }, model_words: "Claude Opus 5.5", dry_run: false, photographer: "Avery Admin", photographer_auto: false,
      hint: { name: "Avery Admin", count: 4 }, agent: { exists: true, enabled: false },
      projects: [
        { id: 1, label: "A301 Hillside ADU", status: "active", chip: ["Active", "green"], subtitle: "Next: framing progress " + dayWord(addDay(today, 3)),
          counts: { total: 9, done: 3, overdue: 0 }, next_shoot: { date: addDay(today, 3), date_text: dayWord(addDay(today, 3)) } },
        { id: 2, label: "A305 Cedar Flats garage", status: "review", chip: ["To review", "amber"], subtitle: "The plan was re-linked to DCR Desktop 2", counts: { total: 7 } },
        { id: 3, label: "A298 Sage Valley remodel", status: "active", chip: ["Active", "green"], subtitle: "5 shoots", counts: { total: 5, done: 2, overdue: 1 } },
      ],
      header: { active: 2, week: 1, overdue: 1 }, suggestions_open: 1 };
  }
  function shootRow(id, name, day, extra) {
    return Object.assign({ id, project_id: 1, name, status: "planned", planned_date: day, date_text: dayWord(day), when_text: dayWord(day) + " · morning",
      late: false, project_label: "A301 Hillside ADU", photographer: "Avery Admin", weather: "Sunny, 64°F", golden: "6:05-6:39 pm", link: "my-tasks.html",
      chip: ["Planned", "blue"], time_of_day: "morning", phase_words: "Framing progress" }, extra || {});
  }
  function photoUpcoming(ctx) {
    const today = dayOf(ctx.now);
    return { groups: { overdue: [shootRow(31, "Before drywall walk-through", addDay(today, -2), { project_id: 3, project_label: "A298 Sage Valley remodel", late: true, chip: ["Late", "red"] })],
      week: [shootRow(12, "Framing progress — second floor", addDay(today, 3))], next: [shootRow(13, "Roof framing with the drone", addDay(today, 9))], later: [],
      undated: [], done: [shootRow(11, "Before framing", addDay(today, -12), { status: "done", chip: ["Done", "green"] })] },
      order: ["overdue", "week", "next", "later", "undated", "done"],
      group_words: { overdue: "Overdue", week: "This week", next: "Next week", later: "Later", undated: "No date yet", done: "Done recently" },
      copied: {}, plans: [{ id: 1, label: "A301 Hillside ADU" }, { id: 3, label: "A298 Sage Valley remodel" }], title: "Shoots coming up", empty: false };
  }
  function photoCalendar(ctx, a) {
    const today = dayOf(ctx.now);
    const month = a.month || today.slice(0, 7);
    const days = {};
    days[addDay(today, 3)] = [shootRow(12, "Framing progress — second floor", addDay(today, 3))];
    days[addDay(today, -2)] = [shootRow(31, "Before drywall walk-through", addDay(today, -2), { late: true, chip: ["Late", "red"] })];
    const first = month + "-01";
    return { month, title: MO[Number(month.slice(5)) - 1] + " " + month.slice(0, 4), first: addDay(first, -((new Date(first + "T12:00:00Z").getUTCDay() + 6) % 7)),
      last: addDay(first, 41 - ((new Date(first + "T12:00:00Z").getUTCDay() + 6) % 7)), today, shoot_days: [0, 1, 2, 3, 4, 5], days };
  }

  function assistantsList(ctx) {
    const rows = (ctx.rows.assistant_profiles || []).map((ap) => {
      const p = (ctx.rows.profiles || []).find((x) => x.id === ap.profile_id) || {};
      const open = (ctx.rows.assistant_items || []).filter((i) => i.profile_id === ap.profile_id && !i.done).length;
      return { name: p.full_name || "", first: String(p.full_name || "").split(" ")[0], role: ({ admin: "Admin", manager: "Manager", accountant: "Accountant", lead: "Lead", field: "Field", viewer: "ReadOnly" })[p.role] || "", has_account: true, on_roster: true, on: !!ap.is_on,
        known: true, chip: ap.is_on ? ["On", "green"] : ["Off", "grey"], subtitle: open + " open items", unread: Number(ap.unread) || 0, waiting: false,
        open_items: open, office_reads: !!ap.office_reads, usage_words: ap.is_on ? "answers today: 2" : "", last_briefing: null };
    });
    return { agent_words: ["Briefings & reminders: off", "amber"], poll_words: ["Chats: answered as they arrive (Realtime)", "green"],
      on_here: true, office_reads: true, ai: { ok: true, words: "Claude Opus 5.5" }, dry_run: false, paused: false,
      counts: { on: rows.filter((r) => r.on).length, waiting: 0 }, can_turn_on_all: true, rows };
  }
  function assistantsEmployee(ctx, a) {
    const list = assistantsList(ctx);
    const row = list.rows.find((r) => r.name === a.name) || list.rows[0] || { name: a.name || "", first: "", role: "", on: false, chip: ["Off", "grey"] };
    const p = (ctx.rows.profiles || []).find((x) => x.full_name === row.name) || {};
    const ap = (ctx.rows.assistant_profiles || []).find((x) => x.profile_id === p.id) || {};
    const msgs = ap.office_reads ? (ctx.rows.assistant_messages || []).filter((m) => m.profile_id === p.id).map((m) => ({ id: m.id, role: m.role, text: m.text,
      at: m.created_at, status: m.status || "", meta: (m.role === "user" ? row.first : m.role === "office" ? "The office" : "Assistant"), cards_words: [] })) : [];
    const items = (ctx.rows.assistant_items || []).filter((i) => i.profile_id === p.id).map((i) => ({ id: i.id, kind: i.kind, text: i.text, at: String(i.at || "").slice(0, 16),
      end: String(i.end_at || "").slice(0, 16), due: i.due || "", location: i.location || "", notes: i.notes || "", remind: i.remind, done: !!i.done, by: i.added_by,
      when: i.kind === "todo" ? (i.due ? "due " + dayWord(i.due) : "no date") : String(i.at || "").slice(0, 16).replace("T", " "), status: i.done ? ["Done", "green"] : ["Coming up", "blue"],
      kind_words: { reminder: "Reminder", todo: "To-do", event: "Event" }[i.kind], by_words: { office: "The office", assistant: "The assistant", employee: row.first }[i.added_by] }));
    return { row, subtitle: "Evening briefing 18:00 · weekly briefing Sunday 18:00 · English", notice: null,
      conversation: msgs, hidden: ap.office_reads ? null : { words: row.first + " has not let the office read the chat." }, empty: msgs.length ? "" : "No messages yet.",
      items, items_note: items.filter((i) => !i.done).length + " open, " + items.filter((i) => i.done).length + " done.",
      notes: [], notes_scope: "employee:" + row.name, facts_words: "", briefings: [], log: [], usage_words: "Today: 2 answers", dry_run: false,
      ai: { ok: true, words: "Claude Opus 5.5" }, can: { toggle: true, briefing: true, add: true, ask_as: true } };
  }

  function trainingTree() {
    return { nodes: [
      { scope: "company", name: "The whole company", suffix: " · 2 rules", header: false, dim: false, tip: "Rules every agent and assistant follows", children: [] },
      { scope: "replies", name: "Reading replies", suffix: " · 1 rule", header: false, dim: false, tip: "", children: [] },
      { scope: null, name: "Agents", suffix: "  2", header: true, dim: false, tip: "", children: [
        { scope: "agent:a1b2c3d4e5f6", name: "Timesheet — 5 pm", suffix: " · 1 rule", header: false, dim: false, tip: "", children: [] },
        { scope: "photo:playbook", name: "Photo & Video Playbook", suffix: " · on its own tab", header: false, dim: false, tip: "", children: [] }] },
      { scope: "assistant", name: "Personal assistants", suffix: "", header: false, dim: false, tip: "", children: [] },
      { scope: null, name: "People", suffix: "  1", header: true, dim: false, tip: "", children: [
        { scope: "employee:Jordan Field", name: "Jordan Field", suffix: " · notes", header: false, dim: false, tip: "", children: [] }] },
    ], smart_on: true, coach: { ok: true, words: "Claude Opus 5.5" } };
  }
  function trainingScope(a) {
    const s = String(a.scope || "company");
    return { scope: s, photo: false,
      describe: { title: s === "company" ? "The whole company" : s, subtitle: "Every agent and assistant", head_button: "", example: "e.g. “We're closed the Friday after Thanksgiving”" },
      chips: [{ text: "On", tone: "green", tip: "" }], intro: "Tell the coach how the company works; it proposes rules you can apply.",
      rule_hint: "One short instruction", rules_title: "Rules", rules_hint: "Every agent and assistant follows these.", examples_hint: "", lessons_hint: "Everything taught lately",
      categories: ["tone", "language", "facts", "schedule", "wording", "watch", "privacy", "other"],
      rules: [{ id: 1, scope: s, text: "Use first names only", category: "tone", active: true, source: "admin", created_at: "x", category_words: "Tone", source_words: "you", added_words: "Oct 1" },
        { id: 2, scope: s, text: "Never mention amounts or prices", category: "privacy", active: true, source: "admin", created_at: "x", category_words: "Privacy", source_words: "you", added_words: "Oct 2" }],
      facts: null, examples: null, wording: null, lessons: [], coach: { ok: true, words: "Claude Opus 5.5", note: "", history: [] } };
  }

  function settingsGet() {
    return { sections: {
      general: { rev: "2b1faa833fe6c894", values: { "general.company_name": "DCR Framing", "general.timesheet_link": "https://portal.dcrframing.com/timesheet-mobile.html",
        "general.quiet_hours": ["20:00", "07:00"], "general.digest_time": "07:30", "general.min_gap_minutes": 30, "general.keep_awake": true },
        fields: [{ key: "general.company_name", label: "Company name", type: "text", max: 120 }, { key: "general.timesheet_link", label: "Timesheet link", type: "link", max: 300 },
          { key: "general.quiet_hours", label: "Quiet hours", type: "quiet" }, { key: "general.digest_time", label: "Daily digest at", type: "hhmm" },
          { key: "general.min_gap_minutes", label: "Never twice within (minutes)", type: "int", lo: 0, hi: 1440 }, { key: "general.keep_awake", label: "Keep this PC awake", type: "bool" }] },
      email: { rev: "b4f25bdacee572c1", values: { "email.backend": "outlook", "email.from_name": "DCR Framing" },
        fields: [{ key: "email.backend", label: "Send email", type: "backend", choices: [{ key: "outlook", label: "Through Outlook on this PC" }, { key: "none", label: "No email" }] },
          { key: "email.from_name", label: "From name", type: "text", max: 120 }] },
      claude: { rev: "80e0a103fe2adfda", values: { "llm.enabled": true, "photo.model": "claude-opus-5-5" },
        fields: [{ key: "llm.enabled", label: "Also use Claude", type: "bool" }, { key: "photo.model", label: "Model", type: "enum", choices: [{ key: "claude-opus-5-5", label: "Claude Opus 5.5 (recommended)" }] }] },
      photo: { rev: "74e82975ba2baced", values: { "photo.shoot_days": [0, 1, 2, 3, 4, 5], "photo.cc": [], "photo.cc_kinds": ["heads_up"], "photo.photographer": "Avery Admin" },
        fields: [{ key: "photo.photographer", label: "Photographer", type: "person" }, { key: "photo.shoot_days", label: "Shoot days", type: "days" },
          { key: "photo.cc", label: "Also send copies to", type: "cc" }, { key: "photo.cc_kinds", label: "Copies go with", type: "cc_kinds" }] },
      assistant: { rev: "03b61ecb0d048d2b", values: { "assistant.enabled": true, "assistant.office_reads": true, "assistant.evening_at": "18:00", "assistant.model": "claude-opus-5-5", "assistant.poll_seconds": 60 },
        fields: [{ key: "assistant.enabled", label: "Run the personal assistants on this PC", type: "bool" },
          { key: "assistant.office_reads", label: "The office can read the conversations (new assistants)", type: "bool" },
          { key: "assistant.evening_at", label: "Evening briefing at", type: "briefing" },
          { key: "assistant.model", label: "Model", type: "enum", choices: [{ key: "claude-opus-5-5", label: "Claude Opus 5.5" }] },
          { key: "assistant.poll_seconds", label: "Also check every (seconds)", type: "int", lo: 3, hi: 600, help: "Realtime tells this PC of a new message at once; this is the fallback." }] },
      training: { rev: "2b38217732e5a4db", values: { "training.smart_wording": true }, fields: [{ key: "training.smart_wording", label: "Smart wording", type: "bool" }] },
    },
    secrets: { "portal.password_enc": "set", "twilio.auth_token_enc": "not set", "email.smtp.password_enc": "not set", "llm.api_key_enc": "set" },
    claude_words: ["A key is saved", "good"],
    readonly: { portal_url: "https://<project>.supabase.co", portal_site: "https://portal.dcrframing.com", portal_email: "agents account", twilio: "not set up",
      email_smtp_host: "", email_graph_sender: "" },
    missing_setup: ["the Outlook mailbox of DCR Agents 2"], server_note: "Change it on the DCR server computer." };
  }

  function sends(ctx, a) {
    const t = (h) => new Date(ctx.now.getTime() - h * 3600000).toISOString();
    return page([
      { id: 3, at: t(2), agent: "Tasks — no update for 5 days", channel: "app", person: "Jordan Field", to: "phone app", status: "sent", dry: false, delivery: "delivered", note: "", key: "stale:12:" + dayOf(ctx.now) },
      { id: 2, at: t(3), agent: "Tasks — no update for 5 days", channel: "sms", person: "Riley Lead", to: "+18055550105", status: "sent", dry: false, delivery: "delivered", note: "", key: "stale:15:" + dayOf(ctx.now) },
      { id: 1, at: t(26), agent: "Timesheet — 5 pm", channel: "app", person: "Jordan Field", to: "phone app", status: "sent", dry: false, delivery: "delivered", note: "", key: "ts:jordan field:" + addDay(dayOf(ctx.now), -1) },
    ], a);
  }

  const READS = {
    "console.methods": () => ({ protocol: 1, version: VERSION, host: HOST, ai: { ok: true, words: "Claude Opus 5.5" },
      methods: METHODS.map((m) => ({ name: m[0], area: m[1], kind: m[2], confirm: m[3], lane: m[4], timeout: m[5], ai: m[6], exclusive: "" })) }),
    "console.ping": (ctx) => ({ pong: true, host: HOST, at: ctx.now.toISOString() }),
    "dashboard.status": dashboardStatus,
    "dashboard.health": (ctx) => dashboardStatus(ctx).health,
    "dashboard.first_run": () => ({ agent_id: "b2c3d4e5f6a1", name: "Timesheet — second nudge", rows: [], found: 0, would_send: 0 }),
    "agents.list": agentsTree,
    "agents.form": (ctx, a) => agentForm(a.feed),
    "agents.get": (ctx, a) => agentGet(a.agent_id),
    "agents.new": (ctx, a) => Object.assign(agentGet(""), { agent: Object.assign(agentGet("").agent, { id: "", name: "New agent", enabled: false, feed: a.feed || "timesheets" }), rev: "" }),
    "agents.check": () => ({ problems: [], warnings: [] }),
    "agents.preview": () => ({ rows: [{ person: "Jordan Field", channel: "app", subject: "Your hours for today", body: "Hi Jordan, your hours for today are not in yet." }], found: 1, would_send: 1 }),
    "recurring.projects": (ctx) => ({ projects: (ctx.rows.projects || []).filter((p) => !p.deleted_at && ["approved", "in_progress"].includes(p.status)).slice(0, 12)
      .map((p) => ({ id: String(p.id), code: p.number, label: p.number + " — " + p.name, status: p.status === "approved" ? "Approved" : "In Progress", active: true })), default: "" }),
    "recurring.history": () => ({ rows: [], can_run_now: false, run_now_words: "" }),
    "recurring.preview_info": () => ({ title: "Weekly report", body: "Made from the job log of the last 7 days.", made_by: "Claude" }),
    "timesheets.grid": timesheetsGrid,
    "tasks.board": tasksBoard,
    "tasks.task": (ctx, a) => ({ task: { task_id: String(a.task_id), name: "Task " + a.task_id, notes: [] } }),
    "photo.overview": photoOverview,
    "photo.upcoming": photoUpcoming,
    "photo.calendar": photoCalendar,
    "photo.suggestions": () => ({ rows: [{ id: 7, kind: "move_shoot", kind_words: "Move a shoot", tone: "blue", where: "A301 Hillside ADU · Framing progress",
      reason: "Rain is forecast that morning; the day after is clear.", confidence: "high", confidence_words: "fairly sure", source_words: "from the forecast" }], total: 1 }),
    "photo.rules": () => ({ rows: [{ id: 1, text: "Shoot the drone passes before 10 am (wind)", category: "shots", active: true }], categories: ["shots", "people", "safety", "other"] }),
    "assistants.list": assistantsList,
    "assistants.employee": assistantsEmployee,
    "training.tree": trainingTree,
    "training.scope": (ctx, a) => trainingScope(a),
    "activity.sends": sends,
    "activity.send": () => ({ subject: "Task with no update", body: "Hi Jordan, the task 'Check the north wall blocking' has had no update for 6 days. Tap to update it." }),
    "activity.events": (ctx, a) => page([{ at: ctx.now.toISOString(), level: "info", area: "console", message: "Realtime joined: agents2-console", detail: "" }], a),
    "activity.runs": (ctx, a) => page(dashboardStatus(ctx).recent_runs, a),
    "activity.remote": (ctx, a) => page([{ at: ctx.now.toISOString(), admin: "Avery Admin admin@demo.test", method: "dashboard.status", summary: "", kind: "R", ok: true, code: "", ms: 80, late: false }], a),
    "replies.list": (ctx, a) => page([{ sid: "SMdemo0001", at: new Date(ctx.now.getTime() - 5 * 3600000).toISOString(), from: "+18055550106", person: "Jordan Field", channel: "sms",
      body: "8 hrs A301 today", result: "filed a timesheet", reply: "Got it, Jordan — 8 hours on A301 today.", subject: "" }], a),
    "replies.check": () => ({ words: "Nothing new." }),
    "people.list": (ctx) => ({ rows: people(ctx), prefs: [{ key: "", label: "agent's order" }, { key: "sms", label: "text only" }, { key: "app", label: "the phone app only" },
      { key: "none", label: "nothing — do not contact" }], note: "Names, roles, phones and emails come from DCR Desktop 2 (Employees & crews)." }),
    "settings.get": settingsGet,
    "settings.test": (ctx, a) => ({ ok: true, words: (a.what || "That") + ": works." }),
    "settings.test_claude": () => ({ ok: true, words: "Claude answered." }),
    "wadesktop.status": () => ({ on: false, words: "WhatsApp Desktop is not read on this PC yet.", tone: "dim" }),
    "wadesktop.test": () => ({ ok: false, words: "WhatsApp Desktop is not set up on this PC." }),
  };

  const ASKS = {
    "dashboard.pause": (a) => ask(a.paused ? "Pause everything" : "Resume", a.paused ? "Pause every agent and assistant on the DCR server? Nothing is sent until someone resumes." : "Resume the agents and the assistants?", a.paused ? "Pause" : "Resume"),
    "dashboard.approve": () => ask("Start the agent", "Start this agent now? It sends what it found.", "Start"),
    "agents.toggle": null,
    "agents.delete": () => ask("Delete the agent", "Delete this agent? Its history stays in Activity.", "Delete", true),
    "agents.run_now": () => ask("Run it now", "Run this agent now, outside its schedule?", "Run now"),
    "people.test_text": () => ask("Send a test text", "Send a test text message to this person?", "Send"),
    "replies.reply": () => ask("Send the reply", "Send this reply now?", "Send"),
    "replies.this_is": () => ask("Link the reply", "File this reply for that person?", "Yes"),
    "recurring.run_now": () => ask("Run it now", "Make this week's task now?", "Run now"),
    "recurring.mark_done": () => ask("Mark done", "Mark this occurrence done?", "Mark done"),
    "tasks.followup_send": () => ask("Send the follow-up", "Send the follow-up now?", "Send"),
    "timesheets.remind": () => ask("Remind them", "Send the timesheet reminder to the people you picked?", "Send"),
  };

  function answer(method, args, ctx) {
    const m = BY_NAME[method];
    if (!m) return { error: { code: "unknown_method", message: "DCR Agents 2 on the DCR server does not know that yet — update it on the server computer." } };
    const a = args || {};
    if (READS[method]) return { data: READS[method](ctx, a) };
    if (m.confirm === "C" && !a.confirmed) {
      const q = ASKS[method] ? ASKS[method](a) : ask("Are you sure?", "Do this on the DCR server?", "Yes");
      return { data: q };
    }
    if (method === "dashboard.pause") {
      const s = ctx.engine && ctx.engine.server ? ctx.engine.server() : null;
      if (s) s.payload = Object.assign({}, s.payload || {}, { paused: !!a.paused });
      return { data: done(a.paused ? "Paused — nothing is sent until someone resumes." : "Resumed — the agents and the assistants run again.", { paused: !!a.paused }) };
    }
    if (method === "agents.toggle") return { data: done("Done (demo DCR server).", { changed: (a.ids || []).length }) };
    if (method === "settings.save") return { data: { rev: "f00dfeedf00dfeed", saved: Object.keys(a.values || {}), words: "Saved on the DCR server." } };
    if (method === "agents.save") return { data: { rev: "f00dfeedf00dfeed", agent_id: (a.agent && a.agent.id) || "c0ffee000001", words: "Saved." } };
    return { data: done("Done (demo DCR server).") };
  }

  /* ── the personal assistant's answers (no amount, nobody else's details, ever) ── */
  function reply(words, ctx) {
    const t = String(words || "").toLowerCase();
    const es = ctx && ctx.lang === "es";
    const first = String((ctx && ctx.person && ctx.person.full_name) || "").split(" ")[0] || "";
    const today = (ctx && ctx.today) || dayOf(new Date());
    const m = /remind me (?:at |a las )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to |a )?(.*)/i.exec(words || "");
    if (m) {
      let h = Number(m[1]) % 12;
      if ((m[3] || "").toLowerCase() === "pm" || (!m[3] && h < 7)) h += 12;
      const at = today + "T" + pad(h) + ":" + (m[2] || "00");
      const what = (m[4] || "the thing you asked").replace(/\s+$/, "").slice(0, 200) || "the thing you asked";
      return { text: es ? "Listo. Te lo recuerdo hoy a las " + h + ":" + (m[2] || "00") + "." : "Done. I'll remind you today at " + ((h % 12) || 12) + ":" + (m[2] || "00") + (h < 12 ? " am." : " pm."),
        cards: [{ type: "item", item: { kind: "reminder", text: what.charAt(0).toUpperCase() + what.slice(1), at } }] };
    }
    if (/tomorrow|mañana/.test(t)) return { text: es ? "Mañana tienes la inspección de la estructura a las 9:00 am." : "Tomorrow you have the framing inspection at 9:00 am. Your normal start is 7:00 am." };
    if (/week|semana/.test(t)) return { text: es ? "Esta semana: una inspección y una charla de seguridad en el taller." : "This week: the framing inspection tomorrow and a toolbox talk at the shop. One to-do is due today." };
    if (/task|tarea/.test(t)) return { text: es ? "Tienes una tarea que necesita actualización." : "One of your tasks needs an update: open it from here.", cards: [{ type: "link", href: "my-tasks.html", label: "My Tasks" }] };
    if (/email|correo/.test(t)) return { text: "Here is a draft. It opens in your own mail app; I never send anything myself.",
      cards: [{ type: "email", to: "office@example.com", subject: "A question from " + (first || "the crew"), body: "Hi,\n\n" + String(words || "").slice(0, 400) + "\n\nThanks" }] };
    if (/price|cost|\$|pay|precio|pago/.test(t)) return { text: es ? "No puedo hablar de precios ni de pagos; pregunta en la oficina." : "I can't talk about prices or pay — the office can help with that." };
    return { text: es ? "Entendido. Lo tengo en cuenta." : "Got it" + (first ? ", " + first : "") + ". Ask me about your day, your jobs, or to remind you of something." };
  }

  NS.pcDemo = {
    METHODS: BY_NAME, HOST, VERSION,
    answer, reply,
    timeoutOf: (method) => (BY_NAME[method] ? BY_NAME[method].timeout : 60),
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
