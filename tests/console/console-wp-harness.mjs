/* A small stand-in for the browser, for the page tests of the DCR Agents
   console's Timesheets / Tasks (console-work.js) and Activity / Replies /
   People (console-people.js) tabs.

   A module is loaded in a vm context with a stand-in DCRConsole that keeps
   what it registers; a tab is rendered into a stand-in element with a stub
   ctx (console-spec §6.4.3/§6.4.4) whose rpc/act answer from the test's
   stubs and record every call. The drawing helpers (ctx.ui) are the shell's
   own (agents-console.js, loaded in its test mode without booting), so the
   tables and pagers are the real markup; ctx.ui.table is wrapped to keep
   each table's onRow so a test can "tap" a row.

   The DOM is only what the modules use: innerHTML (every element with an
   id inside it becomes a node findable with querySelector("#id"), with its
   value / checked / disabled / class taken from the markup), textContent,
   attributes, and listeners on the tab's element. A click is dispatched
   with a target whose closest() finds the element the test names by its
   attributes. Not a browser: enough to prove what is drawn, what is
   escaped and what is sent. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const EVIL = "<img src=x onerror=alert(1)>";
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const SHELL = readFileSync(new URL("../../site/js/console/shell.js", import.meta.url), "utf8");

/* The shell's ctx.ui, from its test mode (boot never runs: the document
   stays "loading" and its DOMContentLoaded never fires). */
export function shellUi() {
  const ctx = {
    document: { readyState: "loading", addEventListener() {}, getElementById: () => null, createElement: () => ({ style: {} }) },
    DCR: { esc, modal: async () => null, confirm: async () => false, requireAuth: () => new Promise(() => {}), api: () => new Promise(() => {}) },
    location: { hash: "", href: "https://portal.test/agents-console.html" },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 0, clearTimeout() {}, console, URL, Promise, Date, Math, JSON,
    __DCR_CONSOLE_TEST__: true,
  };
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(SHELL, ctx, { filename: "agents-console.js" });
  return ctx.DCRConsole._test.ctx.ui;
}

/* ── the stand-in DOM ─────────────────────────────────────────────────── */

const TAG = /<([a-zA-Z][\w-]*)((?:\s+[\w:.-]+(?:="[^"]*")?)*)\s*\/?>/g;
const ATTR = /([\w:.-]+)(?:="([^"]*)")?/g;

export function parseAttrs(s) {
  const out = {};
  for (const m of String(s).matchAll(ATTR)) out[m[1]] = m[2] === undefined ? "" : unesc(m[2]);
  return out;
}

/* Every tag in the markup, with its attributes. */
export function tags(html) {
  const out = [];
  for (const m of String(html).matchAll(TAG)) out.push({ tag: m[1].toLowerCase(), attrs: parseAttrs(m[2]), at: m.index, end: m.index + m[0].length });
  return out;
}

export function makeDom() {
  const map = new Map();
  let focused = null;
  function node(id, attrs = {}, tag = "div") {
    let html = "";
    let text = "";
    const listeners = {};
    const n = {
      id, tag, attrs, __ids: [], listeners, scrollLeft: 0, style: {},
      className: attrs.class || "",
      value: attrs.value ?? "",
      checked: "checked" in attrs,
      disabled: "disabled" in attrs,
      hidden: "hidden" in attrs,
      get innerHTML() { return html; },
      set innerHTML(v) { drop(n); html = String(v); text = ""; n.__ids = register(html); },
      get textContent() { return text || unesc(html.replace(/<[^>]*>/g, "")); },
      set textContent(v) { drop(n); html = ""; text = String(v ?? ""); },
      /* what the browser would show as markup: text set as text is escaped */
      get markup() { return text ? esc(text) : html; },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return k in attrs ? attrs[k] : null; },
      removeAttribute(k) { delete attrs[k]; },
      querySelector(sel) { const m = /^#([\w-]+)$/.exec(sel); return m ? map.get(m[1]) || null : null; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      appendChild() {},
      focus() { focused = n; },
      closest() { return null; },
    };
    return n;
  }
  function drop(n) {
    for (const id of n.__ids) {
      const c = map.get(id);
      if (c && c !== n) { drop(c); map.delete(id); }
    }
    n.__ids = [];
  }
  function register(html) {
    const ids = [];
    for (const t of tags(html)) {
      if (!t.attrs.id) continue;
      const n = node(t.attrs.id, { ...t.attrs }, t.tag);
      if (t.tag === "select") {
        const close = html.indexOf("</select>", t.end);
        const inner = html.slice(t.end, close < 0 ? undefined : close);
        const opts = tags(inner).filter((o) => o.tag === "option");
        const sel = opts.find((o) => "selected" in o.attrs) || opts[0];
        n.value = sel ? sel.attrs.value ?? "" : "";
      }
      map.set(t.attrs.id, n);
      ids.push(t.attrs.id);
    }
    return ids;
  }
  const root = node("root");
  return { root, map, node, focused: () => focused };
}

/* ── a module, a tab, a stub ctx ──────────────────────────────────────── */

/* answers: {method: data | Error | (args) => data|Promise}. An Error with
   .code rejects like the shell does. */
export function loadModule(file) {
  const src = readFileSync(new URL(`../../site/js/console/${file}`, import.meta.url), "utf8");
  const defs = {};
  const timers = new Map();
  let nextTimer = 1;
  const downloads = [];
  const context = {
    console, URL, Blob, Date, Math, JSON, Promise, encodeURIComponent, decodeURIComponent,
    location: { href: "https://portal.test/agents-console.html", origin: "https://portal.test", hash: "" },
    navigator: { clipboard: { writeText: async () => {} } },
    document: {
      head: null, body: { appendChild(a) { downloads.push(a); } }, activeElement: null,
      getElementById: () => null,
      createElement: (tag) => ({ tag, style: {}, click() { this.clicked = true; }, parentNode: null }),
    },
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    DCRConsole: { register(def) { if (defs[def.id]) throw new Error("twice: " + def.id); defs[def.id] = def; } },
  };
  context.window = context;
  /* new URL() as usual; createObjectURL keeps what a download would save */
  context.URL = Object.assign(function (u, b) { return new URL(u, b); }, { createObjectURL: (b) => { downloads.push(b); return "blob:x"; }, revokeObjectURL() {} });
  vm.createContext(context);
  vm.runInContext(src, context, { filename: file });
  return { defs, timers, context, downloads };
}

export function makeCtx({ answers = {}, route = {}, has = null, canAct = true, ui = shellUi(), modal = null, confirmAnswer = true } = {}) {
  const calls = [];
  const gone = [];
  const modals = [];
  const tables = [];
  const pagers = [];
  const toasts = [];
  function answer(method, args) {
    const a = answers[method];
    if (a === undefined) return Promise.reject(Object.assign(new Error(`no stub for ${method}`), { code: "unknown_method" }));
    if (a instanceof Error) return Promise.reject(a);
    if (typeof a === "function") return Promise.resolve().then(() => a(structuredClone(args)));
    return Promise.resolve(structuredClone(a));
  }
  const wrapped = {
    ...ui,
    table(o) { tables.push(o); return ui.table(o); },
    pager(p, onPage) { pagers.push({ page: p, onPage }); return ui.pager(p, onPage); },
  };
  const ctx = {
    route: { tab: route.tab || "", parts: route.parts || [], query: route.query || {} },
    esc, ui: wrapped,
    rpc(method, args = {}, opts = {}) { calls.push({ kind: "rpc", method, args: structuredClone(args), opts }); return answer(method, args); },
    act(method, args = {}, opts = {}) {
      calls.push({ kind: "act", method, args: structuredClone(args), opts });
      if (!ctx.confirmAnswer) return Promise.resolve(null);
      return answer(method, { ...args, confirmed: true });
    },
    has(m) { return has ? has(m) : true; },
    canAct() { return canAct; },
    go(path) { gone.push(path); },
    toast(t, o) { toasts.push({ t, o }); },
    busy() { return () => {}; },
    press(_btn, fn) { return Promise.resolve().then(fn); },
    modal(o) { modals.push(o); return Promise.resolve(modal ? modal(o) : (o.fields && o.fields.length ? null : true)); },
    confirm() { return Promise.resolve(true); },
    confirmAnswer,
    admin: { name: "Admin Fake", email: "admin@dcr.test" },
  };
  return { ctx, calls, gone, modals, tables, pagers, toasts };
}

/* Renders a tab and gives the test its handles. */
export async function openTab(file, tab, opts = {}) {
  const mod = opts.mod || loadModule(file);
  const dom = makeDom();
  const c = makeCtx({ ...opts, route: { tab, ...(opts.route || {}) } });
  const def = mod.defs[tab];
  if (!def) throw new Error(`${file} did not register ${tab}`);
  await def.render(dom.root, c.ctx);
  await settle();
  const page = {
    mod, dom, def, ...c, el: dom.root,
    byId: (id) => dom.map.get(id) || null,
    /* everything drawn: the tab's own markup plus every node's */
    html: () => [dom.root.innerHTML, ...[...dom.map.values()].map((n) => n.markup)].join("\n"),
    rpcs: (method) => c.calls.filter((x) => x.method === method),
    find(attrs) {
      const want = Object.entries(attrs);
      for (const src of [dom.root.innerHTML, ...[...dom.map.values()].map((n) => n.innerHTML)]) {
        for (const t of tags(src)) {
          if (want.every(([k, v]) => t.attrs[k] === v)) {
            const live = t.attrs.id ? dom.map.get(t.attrs.id) : null;
            return live || {
              tag: t.tag, attrs: t.attrs, disabled: "disabled" in t.attrs, checked: "checked" in t.attrs, value: t.attrs.value ?? "",
              getAttribute: (k) => (k in t.attrs ? t.attrs[k] : null),
            };
          }
        }
      }
      return null;
    },
    async fire(type, attrs, props = {}) {
      const target = page.find(attrs);
      if (!target) throw new Error(`nothing drawn matches ${JSON.stringify(attrs)}`);
      Object.assign(target, props);
      const ev = { type, key: props.key, preventDefault() { ev.prevented = true; }, prevented: false,
        target: { ...target, getAttribute: (k) => target.getAttribute(k), value: target.value, checked: target.checked,
          closest: () => target } };
      (dom.root.listeners[type] || []).forEach((fn) => fn(ev));
      await settle();
      return ev;
    },
    click: (attrs, props) => page.fire("click", attrs, props),
    async rerender(route) {
      const d2 = makeDom();
      Object.assign(dom, d2);
      page.el = d2.root;
      c.ctx.route = { tab, parts: [], query: {}, ...route };
      await def.render(d2.root, c.ctx);
      await settle();
    },
    async runTimers(maxMs = Infinity) {
      const due = [...mod.timers.entries()].filter(([, t]) => t.ms <= maxMs);
      due.forEach(([id]) => mod.timers.delete(id));
      due.forEach(([, t]) => t.fn());
      await settle();
    },
    /* a row of a ctx.ui table, tapped (the newest table when no index) */
    async tapRow(rowIndex, tableIndex = c.tables.length - 1) {
      const t = c.tables[tableIndex];
      t.onRow(t.rows[rowIndex]);
      await settle();
    },
    /* a ctx.ui pager's button, pressed (the newest pager) */
    async pageTo(offset) {
      c.pagers[c.pagers.length - 1].onPage(offset);
      await settle();
    },
  };
  return page;
}
