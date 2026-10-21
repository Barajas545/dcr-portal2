/* A small stand-in for the browser and for the console shell's ctx
   (console-spec §6.4.3, §6.4.4), for the page tests of single console tabs
   (lib/console-assistants-page.test.mjs, lib/console-training-page.test.mjs).

   The tab's script runs in a vm with a document that knows every element
   by its id (made again from the markup each time innerHTML is set, with
   value / checked / disabled / hidden read from the tags), sessionStorage,
   a clipboard, timers the test runs by hand, and a ctx whose rpc answers
   from the test's own function — act() is the shell's confirm flow,
   modal() answers from a queue, and everything asked is recorded. Not a
   test file itself (no .test. in the name). */
// Company time for every console page test: the console shows times in the browser's own zone (the
// office's browsers are all on Pacific time), and GitHub's runner is UTC. Node applies a TZ change at once.
process.env.TZ = "America/Los_Angeles";
import vm from "node:vm";
import { readFileSync } from "node:fs";

export const EVIL = "<img src=x onerror=alert(1)>";
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function parseAttrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/([^\s=/>"']+)(?:="([^"]*)")?/g)) out[m[1]] = m[2] === undefined ? "" : unesc(m[2]);
  return out;
}
function selectedValue(inner) {
  const opts = [...String(inner).matchAll(/<option\b([^>]*)>/g)].map((m) => parseAttrs(m[1]));
  const sel = opts.find((o) => "selected" in o) || opts[0];
  return sel ? sel.value ?? "" : "";
}

export function makeDom() {
  const byId = new Map();
  function classList(el) {
    const set = () => new Set(String(el.className || "").split(/\s+/).filter(Boolean));
    return {
      add: (c) => { const s = set(); s.add(c); el.className = [...s].join(" "); },
      remove: (c) => { const s = set(); s.delete(c); el.className = [...s].join(" "); },
      toggle: (c, on) => { const s = set(); const want = on === undefined ? !s.has(c) : !!on; if (want) s.add(c); else s.delete(c); el.className = [...s].join(" "); return want; },
      contains: (c) => set().has(c),
    };
  }
  function makeEl(id, tag = "div", attrs = {}, inner = "") {
    const listeners = {};
    const a = { ...attrs };
    let html = "";
    const el = {
      id, tagName: tag.toUpperCase(), attrs: a, listeners,
      value: tag === "textarea" ? unesc(inner) : tag === "select" ? selectedValue(inner) : (a.value ?? ""),
      checked: "checked" in a, disabled: "disabled" in a, hidden: "hidden" in a, readOnly: "readonly" in a,
      textContent: "", className: a.class || "", style: {}, scrollTop: 0, scrollHeight: 400, files: null, children: [], clicks: 0,
      get innerHTML() { return html; },
      set innerHTML(v) { html = String(v); register(html); },
      setInner(v) { html = String(v); },
      setAttribute(k, v) { a[k] = String(v); },
      getAttribute(k) { return k in a ? a[k] : null; },
      removeAttribute(k) { delete a[k]; },
      addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
      fire(t, ev = {}) { (listeners[t] || []).forEach((fn) => fn({ type: t, target: el, preventDefault() {}, ...ev })); },
      closest(sel) { return matches(el, sel) ? el : null; },
      querySelector(sel) { return sel === "[type=submit]" ? el.submitButton || null : null; },
      querySelectorAll() { return []; },
      focus() { el.focused = true; },
      click() { el.clicks += 1; },
      appendChild(c) { el.children.push(c); return c; },
      remove() { el.removed = true; },
    };
    el.classList = classList(el);
    return el;
  }
  const VOID = new Set(["input", "img", "br", "hr", "meta", "link"]);
  /* The markup between an element's open tag and its matching close tag. */
  function innerOf(html, tag, from) {
    if (VOID.has(tag)) return "";
    const re = new RegExp("<(/?)" + tag + "\\b[^>]*>", "gi");
    re.lastIndex = from;
    let depth = 1, m;
    while ((m = re.exec(html))) {
      depth += m[1] ? -1 : 1;
      if (!depth) return html.slice(from, m.index);
    }
    return html.slice(from);
  }
  function register(html) {
    const made = [];
    for (const m of html.matchAll(/<([a-zA-Z0-9]+)\b([^>]*)>/g)) {
      const attrs = parseAttrs(m[2]);
      if (!attrs.id) continue;
      const tag = m[1].toLowerCase();
      const inner = innerOf(html, tag, m.index + m[0].length);
      const el = makeEl(attrs.id, tag, attrs, inner);
      byId.set(attrs.id, el);
      made.push([el, inner]);
    }
    /* each element holds its own markup too (without making its children again) */
    made.forEach(([el, inner]) => el.setInner(inner));
  }
  function matches(el, sel) {
    const m = /^\[([a-z-]+)\]$/.exec(sel);
    if (m) return el.getAttribute(m[1]) !== null;
    if (sel.startsWith(".")) return String(el.className).split(/\s+/).includes(sel.slice(1));
    return false;
  }
  const head = { children: [], appendChild(c) { this.children.push(c); return c; } };
  const body = { children: [], appendChild(c) { this.children.push(c); return c; } };
  const document = {
    head, body,
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => makeEl("", tag),
    addEventListener() {},
  };
  return { document, byId, makeEl, el: (id) => byId.get(id) || null, all: () => [...byId.values()] };
}

/* An element-like event target with these attributes (a button with
   data-ca="…", a checkbox …). */
export function target(attrs = {}, extra = {}) {
  const t = {
    attrs: { ...attrs }, disabled: false, checked: false, value: "", ...extra,
    getAttribute(k) { return k in this.attrs ? String(this.attrs[k]) : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    closest(sel) { const m = /^\[([a-z-]+)\]$/.exec(sel); return m && m[1] in this.attrs ? this : null; },
  };
  return t;
}

/* Runs one console tab's script and renders it. `answer(method, args)`
   gives each rpc's data (or throws {code, message}); `confirm(c, method)`
   answers ctx.act's question (true, false, or an object of extra values). */
export function loadTab(file, { answer = () => ({}), confirm = () => true, modal = [], storage = new Map(), wide = false } = {}) {
  const SRC = readFileSync(new URL("../../site/js/console/" + file, import.meta.url), "utf8");
  const dom = makeDom();
  const timers = new Map();
  let next = 1;
  let def = null;
  const calls = [], confirms = [], modals = [], toasts = [], gone = [], busy = [], clipboard = [], downloads = [];
  const modalAnswers = [...modal];
  const store = storage;
  const win = {
    document: dom.document,
    __DCR_CONSOLE_TEST__: true,
    DCRConsole: { register(d) { if (def) throw new Error("registered twice"); def = d; return d; } },
    sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    navigator: { clipboard: { writeText: (t) => { clipboard.push(t); return Promise.resolve(); } } },
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    matchMedia: wide ? () => ({ matches: true }) : undefined,
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = o && o.type; } },
    URL: { createObjectURL: (b) => { downloads.push({ blob: b }); return "blob:x"; }, revokeObjectURL() {} },
    console, Promise, Date, JSON, Math, Object, Array, String, Number, Error, encodeURIComponent, decodeURIComponent, isFinite, isNaN, parseInt,
  };
  win.window = win;
  const ctx = {
    route: { tab: "", parts: [], query: {} },
    esc,
    calls, confirms, modals, toasts, gone, busy,
    rpc(method, args = {}, opts = {}) {
      const plain = JSON.parse(JSON.stringify(args));        // out of the vm's realm, as it would go over the wire
      calls.push({ method, args: plain, opts });
      try {
        const v = answer(method, JSON.parse(JSON.stringify(args)), opts);
        return Promise.resolve(v).then((d) => (d === undefined ? {} : JSON.parse(JSON.stringify(d))));
      } catch (e) {
        return Promise.reject(Object.assign(new Error(e.message || "refused"), { code: e.code || "refused" }));
      }
    },
    act(method, args = {}, opts = {}) {
      return ctx.rpc(method, args, opts).then((data) => {
        if (!data || !data.confirm) return data;
        confirms.push({ method, confirm: data.confirm });
        const ans = confirm(data.confirm, method);
        if (!ans) return null;
        return ctx.rpc(method, { ...args, ...(ans === true ? {} : ans), confirmed: true }, opts);
      });
    },
    has: () => true,
    go(path) { gone.push(path); },
    toast(text, o) { toasts.push({ text, bad: !!(o && o.bad) }); },
    busy(el, text) { busy.push(text); return () => {}; },
    press(btn, fn) { return Promise.resolve().then(fn); },
    guard(fn) { ctx.guardFn = fn; },
    modal(o) {
      modals.push(o);
      const a = modalAnswers.length ? modalAnswers.shift() : null;
      const v = typeof a === "function" ? a(o) : a;
      if (v && typeof v === "object" && o.validate) {
        const problem = o.validate(v);
        if (problem) { o.problem = problem; return Promise.resolve(null); }
      }
      return Promise.resolve(v);
    },
    ui: {
      failed: (e) => '<div class="c-error" role="alert"><b>That did not work.</b><span>' + esc(e && e.message) + '</span><button data-c-retry>Try again</button></div>',
      table: (o) => (o.rows || []).length ? '<table class="c-table">' + o.rows.map((r) => "<tr>" + o.cols.map((c) =>
        '<td data-label="' + esc(c.label) + '">' + (c.render ? c.render(r) : esc(r[c.key])) + "</td>").join("") + "</tr>").join("") + "</table>"
        : '<div class="c-empty">' + esc(o.empty) + "</div>",
    },
    modalAnswers,
  };
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: file });
  const root = dom.makeEl("root");
  const page = {
    def, ctx, dom, root, win, store, timers, calls, confirms, modals, toasts, gone, busy, clipboard, downloads, modalAnswers,
    async open(parts = [], query = {}) {
      ctx.route = { tab: def.id, parts, query };
      page.root = dom.makeEl("root");
      await def.render(page.root, ctx);
      await flush();
      return page;
    },
    el: dom.el,
    html: () => [page.root.innerHTML, ...dom.all().map((n) => n.innerHTML)].join("\n"),
    text: (id) => (dom.el(id) || {}).textContent,
    async click(attrs, extra) { page.root.fire("click", { target: target(attrs, extra) }); await flush(); },
    async change(t) { page.root.fire("change", { target: t }); await flush(); },
    async input(t) { page.root.fire("input", { target: t }); await flush(); },
    async key(t, ev) { page.root.fire("keydown", { target: t, ...ev }); await flush(); },
    async submit(id) {
      const f = dom.el(id) || { id };
      page.root.fire("submit", { target: { id, getAttribute: (k) => (k === "id" ? id : null), querySelector: () => null, ...f, id } });
      await flush();
    },
    runTimers(maxMs = Infinity) {
      const due = [...timers.entries()].filter(([, t]) => t.ms <= maxMs);
      due.forEach(([id]) => timers.delete(id));
      due.forEach(([, t]) => t.fn());
    },
    last: (method) => [...calls].reverse().find((c) => c.method === method),
    count: (method) => calls.filter((c) => c.method === method).length,
  };
  return page;
}

/* An rpc refusal as ctx.rpc rejects it. */
export function refusal(code, message) { return Object.assign(new Error(message), { code }); }
