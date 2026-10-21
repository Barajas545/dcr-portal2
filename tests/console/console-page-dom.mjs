/* A small stand-in for the browser, for the DCR Agents console's page tests
   (lib/*console*-page.test.mjs). Not a test file itself (node --test runs
   lib/*.test.mjs only), and nothing in the API imports it.

   It parses the HTML the pages write into a real tree — elements, text,
   attributes — so the tests see what a browser would build: escaped text
   stays text, and an unescaped <img onerror> would become an element with an
   on* attribute (scan() finds those). It supports what the console uses:
   getElementById, querySelector(All) with simple selectors (tag, #id,
   .class, [attr], [attr="v"], descendant and child combinators, lists),
   closest/matches, events that bubble to the document, value / checked /
   disabled / hidden / open, classList, dataset, style, focus.

   openConsole() loads agents-console.html's body, runs the shell and the
   given modules in a vm context with window.__DCR_CONSOLE_TEST__ set, a
   fake clock, a fake DCR (api, requireAuth, modal, confirm) and storage. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);
const AUTO_CLOSE = { li: ["li"], option: ["option"], tr: ["tr"], td: ["td", "th"], th: ["td", "th"], p: ["p"] };
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“",
  rdquo: "”", mdash: "—", ndash: "–", hellip: "…", rarr: "→", larr: "←", middot: "·", times: "×" };

export const EVIL = "<img src=x onerror=alert(1)>";
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ── selectors ────────────────────────────────────────────────────────── */

function parseSelector(sel) {
  return String(sel).split(",").map((group) => {
    const steps = [];
    const re = /\s*(>)?\s*([^\s>]+)/g;
    let m;
    while ((m = re.exec(group.trim()))) steps.push({ child: !!m[1], simple: parseSimple(m[2]) });
    return steps;
  });
}
function parseSimple(s) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([\^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) out.tag = m[1].toLowerCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else if (m[4]) out.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] ?? m[7] ?? m[8] ?? "" });
  }
  return out;
}
function matchSimple(el, s) {
  if (!el || el.nodeType !== 1) return false;
  if (s.tag && el.localName !== s.tag) return false;
  if (s.id && el.getAttribute("id") !== s.id) return false;
  for (const c of s.classes) if (!el.classList.contains(c)) return false;
  for (const a of s.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === "=" && v !== a.value) return false;
    if (a.op === "^=" && !v.startsWith(a.value)) return false;
    if (a.op === "$=" && !v.endsWith(a.value)) return false;
    if (a.op === "*=" && !v.includes(a.value)) return false;
  }
  return true;
}
function matchSteps(el, steps) {
  let i = steps.length - 1;
  if (!matchSimple(el, steps[i].simple)) return false;
  let node = el;
  while (i > 0) {
    const child = steps[i].child;
    i--;
    let p = node.parentNode;
    if (child) {
      if (!matchSimple(p, steps[i].simple)) return false;
      node = p;
    } else {
      while (p && !matchSimple(p, steps[i].simple)) p = p.parentNode;
      if (!p) return false;
      node = p;
    }
  }
  return true;
}
function matches(el, sel) { return parseSelector(sel).some((steps) => steps.length && matchSteps(el, steps)); }

/* ── nodes ────────────────────────────────────────────────────────────── */

class Text {
  constructor(doc, data) { this.ownerDocument = doc; this.nodeType = 3; this.data = String(data); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class El {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.attrs = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.style = { cssText: "", setProperty() {}, removeProperty() {} };
    this._value = undefined;
    this._checked = undefined;
    this.scrollTop = 0;
    const self = this;
    this.classList = {
      contains: (c) => self.className.split(/\s+/).includes(c),
      add: (...cs) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.add(c)); self.className = [...s].join(" "); },
      remove: (...cs) => { self.className = self.className.split(/\s+/).filter((c) => c && !cs.includes(c)).join(" "); },
      toggle: (c, on) => { const want = on === undefined ? !self.classList.contains(c) : !!on; if (want) self.classList.add(c); else self.classList.remove(c); return want; },
    };
    this.dataset = new Proxy({}, {
      get: (_t, k) => self.getAttribute("data-" + String(k).replace(/[A-Z]/g, (x) => "-" + x.toLowerCase())) ?? undefined,
      set: (_t, k, v) => { self.setAttribute("data-" + String(k).replace(/[A-Z]/g, (x) => "-" + x.toLowerCase()), v); return true; },
      deleteProperty: (_t, k) => { self.removeAttribute("data-" + String(k)); return true; },
    });
  }
  getAttribute(k) { k = String(k).toLowerCase(); return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(String(k).toLowerCase(), String(v)); }
  removeAttribute(k) { this.attrs.delete(String(k).toLowerCase()); }
  hasAttribute(k) { return this.attrs.has(String(k).toLowerCase()); }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  get title() { return this.getAttribute("title") || ""; }
  set title(v) { this.setAttribute("title", v); }
  get name() { return this.getAttribute("name") || ""; }
  get href() { return this.getAttribute("href") || ""; }
  get type() { return (this.getAttribute("type") || (this.localName === "input" ? "text" : "")).toLowerCase(); }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }
  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(v) { if (v) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  get open() { return this.hasAttribute("open"); }
  set open(v) { if (v) this.setAttribute("open", ""); else this.removeAttribute("open"); }
  get checked() { return this._checked !== undefined ? this._checked : this.hasAttribute("checked"); }
  set checked(v) { this._checked = !!v; }
  get selected() { return this._selected !== undefined ? this._selected : this.hasAttribute("selected"); }
  set selected(v) { this._selected = !!v; }
  get options() { return this.querySelectorAll("option"); }
  get value() {
    if (this.localName === "select") {
      const opts = this.querySelectorAll("option");
      const pick = opts.find((o) => o.selected) || opts[0];
      return pick ? pick.value : "";
    }
    if (this.localName === "option") return this.hasAttribute("value") ? this.getAttribute("value") : this.textContent;
    if (this.localName === "textarea") return this._value !== undefined ? this._value : this.textContent;
    if (this._value !== undefined) return this._value;
    return this.getAttribute("value") ?? (this.type === "checkbox" ? "on" : "");
  }
  set value(v) {
    if (this.localName === "select") {
      for (const o of this.querySelectorAll("option")) o.selected = o.value === String(v);
      return;
    }
    this._value = String(v);
  }
  get selectionStart() { return this._selStart ?? this.value.length; }
  get selectionEnd() { return this._selEnd ?? this.value.length; }
  setSelectionRange(a, b) { this._selStart = a; this._selEnd = b; }
  get offsetHeight() { return 0; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(v) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; if (String(v) !== "") this.appendChild(new Text(this.ownerDocument, v)); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get innerHTML() { return this.childNodes.map(serialize).join(""); }
  set innerHTML(v) {
    this.childNodes.forEach((n) => { n.parentNode = null; });
    this.childNodes = [];
    parseInto(this, String(v));
    this.ownerDocument._mutated(this);
  }
  get outerHTML() { return serialize(this); }
  appendChild(n) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    this.ownerDocument._mutated(this);
    return n;
  }
  insertBefore(n, ref) {
    if (!ref) return this.appendChild(n);
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = this.childNodes.indexOf(ref);
    n.parentNode = this;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n);
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  replaceChild(n, old) { this.insertBefore(n, old); this.removeChild(old); return old; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  descendants() {
    const out = [];
    const walk = (node) => { for (const c of node.childNodes) if (c.nodeType === 1) { out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelectorAll(sel) { return this.descendants().filter((e) => matches(e, sel)); }
  querySelector(sel) { return this.descendants().find((e) => matches(e, sel)) || null; }
  matches(sel) { return matches(this, sel); }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (matches(n, sel)) return n; n = n.parentNode; } return null; }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(ev) { return this.ownerDocument._dispatch(this, ev); }
  click() {
    if (this.disabled) return;
    const box = this.localName === "input" && (this.type === "checkbox" || this.type === "radio");
    if (box) this.checked = !this.checked;
    this.dispatchEvent({ type: "click" });
    if (box) { this.dispatchEvent({ type: "input" }); this.dispatchEvent({ type: "change" }); }
  }
  focus() { this.ownerDocument.activeElement = this; this.dispatchEvent({ type: "focusin" }); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  select() {}
}

function serialize(n) {
  if (n.nodeType === 3) return n.parentNode && RAW.has(n.parentNode.localName) && n.parentNode.localName !== "textarea" ? n.data : escText(n.data);
  const attrs = [...n.attrs].map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  if (VOID.has(n.localName)) return `<${n.localName}${attrs}>`;
  return `<${n.localName}${attrs}>${n.childNodes.map(serialize).join("")}</${n.localName}>`;
}

function parseInto(root, html) {
  const doc = root.ownerDocument;
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  const len = html.length;
  while (i < len) {
    if (html.startsWith("<!--", i)) { const j = html.indexOf("-->", i + 4); i = j < 0 ? len : j + 3; continue; }
    if (html.startsWith("<!", i)) { const j = html.indexOf(">", i); i = j < 0 ? len : j + 1; continue; }
    if (html[i] === "<" && html[i + 1] === "/") {
      const j = html.indexOf(">", i);
      const tag = html.slice(i + 2, j < 0 ? len : j).trim().toLowerCase();
      i = j < 0 ? len : j + 1;
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].localName === tag) { stack.length = k; break; }
      continue;
    }
    if (html[i] === "<" && /[a-zA-Z]/.test(html[i + 1] || "")) {
      let j = i + 1, q = null;
      while (j < len) { const c = html[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === ">") break; j++; }
      const inner = html.slice(i + 1, j);
      i = j + 1;
      const m = /^([a-zA-Z][\w-]*)/.exec(inner);
      const tag = m[1].toLowerCase();
      const closers = AUTO_CLOSE[tag];
      if (closers && closers.includes(top().localName)) stack.pop();
      const el = new El(doc, tag);
      const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
      re.lastIndex = m[0].length;
      let a;
      while ((a = re.exec(inner))) {
        if (a[1] === "/") continue;
        el.attrs.set(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ""));
      }
      el.parentNode = top();
      top().childNodes.push(el);
      if (VOID.has(tag) || /\/\s*$/.test(inner)) continue;
      if (RAW.has(tag)) {
        const end = html.toLowerCase().indexOf(`</${tag}`, i);
        const body = html.slice(i, end < 0 ? len : end);
        if (body) { const t = new Text(doc, tag === "textarea" || tag === "title" ? decode(body) : body); t.parentNode = el; el.childNodes.push(t); }
        const close = end < 0 ? len : html.indexOf(">", end);
        i = close < 0 ? len : close + 1;
        continue;
      }
      stack.push(el);
      continue;
    }
    const j = html.indexOf("<", i + 1);
    const chunk = html.slice(i, j < 0 ? len : j);
    i = j < 0 ? len : j;
    const t = new Text(doc, decode(chunk));
    t.parentNode = top();
    top().childNodes.push(t);
  }
}

export function makeDom(html = "<!doctype html><html><head></head><body></body></html>") {
  const doc = {
    nodeType: 9, readyState: "loading", visibilityState: "visible", hidden: false, title: "", listeners: {}, activeElement: null,
    _observers: [],
    _mutated(target) { for (const o of this._observers) o(target); },
    _dispatch(target, ev) {
      ev.target = target;
      ev.bubbles = ev.bubbles !== false;
      ev.defaultPrevented = false;
      let stopped = false;
      ev.preventDefault = () => { ev.defaultPrevented = true; };
      ev.stopPropagation = () => { stopped = true; };
      const path = [];
      for (let n = target; n && n.nodeType === 1; n = n.parentNode) path.push(n);
      path.push(this);
      const NOBUBBLE = new Set(["toggle", "focus", "blur", "load"]);
      for (const n of path) {
        ev.currentTarget = n;
        for (const fn of [...(n.listeners[ev.type] || [])]) fn(ev);
        if (stopped || NOBUBBLE.has(ev.type)) break;
      }
      return !ev.defaultPrevented;
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); },
    createElement(tag) { return new El(doc, tag); },
    createTextNode(t) { return new Text(doc, t); },
    getElementById(id) { return doc.documentElement.descendants().find((e) => e.getAttribute("id") === String(id)) || null; },
    querySelector(sel) { return doc.documentElement.querySelector(sel); },
    querySelectorAll(sel) { return doc.documentElement.querySelectorAll(sel); },
    getElementsByTagName(t) { return doc.documentElement.querySelectorAll(t); },
  };
  const holder = new El(doc, "#root");
  parseInto(holder, html);
  let htmlEl = holder.children.find((e) => e.localName === "html");
  if (!htmlEl) { htmlEl = new El(doc, "html"); holder.childNodes.forEach((n) => htmlEl.appendChild(n)); }
  htmlEl.parentNode = null;
  doc.documentElement = htmlEl;
  doc.head = htmlEl.querySelector("head") || htmlEl.appendChild(new El(doc, "head"));
  doc.body = htmlEl.querySelector("body") || htmlEl.appendChild(new El(doc, "body"));
  doc.activeElement = doc.body;
  return doc;
}

/* Every element under root with an on* attribute, a javascript: link, or
   an <img>/<script> the page did not mean to write. */
export function scan(root) {
  const bad = [];
  for (const e of root.descendants()) {
    for (const [k, v] of e.attrs) {
      if (/^on/i.test(k)) bad.push(`${e.localName}[${k}]`);
      if ((k === "href" || k === "src" || k === "action") && /^\s*javascript:/i.test(v)) bad.push(`${e.localName}[${k}=javascript:]`);
    }
    if (e.localName === "img" || e.localName === "script" || e.localName === "iframe") bad.push(e.localName);
  }
  return bad;
}

/* ── the fake clock ───────────────────────────────────────────────────── */

export function fakeClock(start = Date.parse("2026-10-10T17:00:00Z")) {
  let now = start, seq = 1;
  const timers = new Map();
  const flush = async () => { for (let k = 0; k < 12; k++) await new Promise((r) => setImmediate(r)); };
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = seq++; timers.set(id, { fn, at: now + Math.max(0, Number(ms) || 0), id }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    timers,
    flush,
    /* Moves time on by ms, running every timer that falls due on the way,
       in order, with the promises they start settled in between. */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        let next = null;
        for (const t of timers.values()) if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
        if (!next) break;
        timers.delete(next.id);
        now = Math.max(now, next.at);
        next.fn();
      }
      now = end;
      await flush();
    },
  };
}

function storage(map = new Map()) {
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

/* Portal 2's ported files: the shell is site/js/console/shell.js (the old agents-console.js), the tabs
   site/js/console/console-*.js, the page site/agents-console.html. */
const SITE = new URL("../../site/", import.meta.url);
const PATHS = { "agents-console.js": "js/console/shell.js", "agents-console.html": "agents-console.html" };
const read = (f) => readFileSync(new URL(PATHS[f] || (/^console-[a-z]+\.js$/.test(f) ? "js/console/" + f : f), SITE), "utf8");

/* Portal 2's shell reaches the database through window.DCRConsoleBridge (js/console/bridge.js); here the
   bridge is built over the old relay fake the tests give as `api` (DCR.api), so every request, read,
   cancel and status read is the same call the old tests answer. Its sleeps are the shell's own (the fake
   clock): sleepOnClock. */
const EP = "/api/portal?action=console";
function bridgeOver(DCR) {
  return {
    status: () => DCR.api(EP + "&server=1"),
    request: (method, args) => DCR.api(EP, { method: "POST", body: { method, args } }),
    read: (id) => DCR.api(EP + "&id=" + encodeURIComponent(id)),
    cancel: (id) => DCR.api(EP, { method: "POST", body: { cancel: id } }),
    live: () => false,
  };
}

/* Opens agents-console.html with the shell and `modules` (file names) in a
   vm. `api(path, opts)` answers DCR.api; `rpc(method, args, opts)` (when
   given) replaces the relay; `server` is set as the last status before the
   page boots. modal/confirm answers come from `answers` (a list of values or
   functions taking the options), else the dialog stays open in `dialogs`. */
export async function openConsole({ modules = [], role = "Admin", api = null, rpc = null, server = undefined, methods = undefined,
  hash = "", answers = [], session = new Map(), local = new Map(), clock = fakeClock(), boot = true } = {}) {
  const page = read("agents-console.html");
  const body = page.slice(page.indexOf("<body>"), page.indexOf("</body>") + 7).replace(/<script[\s\S]*?<\/script>/g, "");
  const doc = makeDom(`<!doctype html><html><head></head>${body}</html>`);
  const calls = [];
  const dialogs = [];
  const toasts = () => doc.getElementById("cToasts").children.map((t) => ({ text: t.textContent, bad: t.classList.contains("bad") }));
  const winListeners = {};
  const loc = new URL("http://127.0.0.1:8787/agents-console.html" + (hash ? "#" + String(hash).replace(/^#/, "") : ""));
  let printed = 0;
  const location = {
    get hash() { return loc.hash; },
    set hash(v) {
      const before = loc.hash;
      loc.hash = String(v).replace(/^#?/, "#");
      if (loc.hash === "#") loc.hash = "";
      if (loc.hash !== before) clock.setTimeout(() => (winListeners.hashchange || []).forEach((fn) => fn({ type: "hashchange" })), 0);
    },
    get href() { return loc.href; },
    set href(v) { loc.href = new URL(v, loc).href; },
    get pathname() { return loc.pathname; },
    get search() { return loc.search; },
    reload() {},
  };
  const answer = (opts, kind) => {
    const a = answers.length ? answers.shift() : undefined;
    if (a === undefined) {
      return new Promise((resolve) => dialogs.push({ kind, opts, resolve }));
    }
    dialogs.push({ kind, opts, resolve: () => {}, answered: true });
    return Promise.resolve(typeof a === "function" ? a(opts) : a);
  };
  const DCR = {
    esc,
    getToken: () => "t",
    companyInfo: { name: "DCR", logo: "" },
    requireAuth: async () => ({ displayName: "Ada Admin", email: "admin@dcr.test", role }),
    api: async (path, opts = {}) => {
      calls.push({ path, method: opts.method || "GET", body: opts.body === undefined ? undefined : JSON.parse(JSON.stringify(opts.body)) });
      if (!api) throw Object.assign(new Error("no api"), { status: 500, data: { error: "no api" } });
      return api(path, opts);
    },
    modal: (opts) => answer(opts, "modal"),
    confirm: (msg, opts) => answer({ message: msg, ...(opts || {}) }, "confirm"),
    alert: async () => {},
  };
  const ctx = {
    document: doc, DCR, location, console,
    history: { state: null, replaceState() {}, pushState() {} },
    localStorage: storage(local), sessionStorage: storage(session),
    navigator: { onLine: true },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    addEventListener: (type, fn) => { (winListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { winListeners[type] = (winListeners[type] || []).filter((f) => f !== fn); },
    print: () => { printed++; },
    URL, URLSearchParams, structuredClone,
    __DCR_CONSOLE_TEST__: true,
  };
  ctx.window = ctx;
  ctx.DCRConsoleBridge = bridgeOver(DCR);
  vm.createContext(ctx);
  vm.runInContext("Date.now = function () { return __clockNow(); };", Object.assign(ctx, { __clockNow: clock.now }));
  vm.runInContext(read("agents-console.js"), ctx, { filename: "agents-console.js" });
  const C = ctx.DCRConsole;
  C._test.sleepOnClock(true);
  C._test.clock.now = clock.now;
  C._test.clock.setTimeout = clock.setTimeout;
  C._test.clock.clearTimeout = clock.clearTimeout;
  if (rpc) C._test.setRpc(rpc);
  for (const m of modules) vm.runInContext(read(m), ctx, { filename: m });
  if (methods !== undefined) C._test.setMethods(methods);
  const h = {
    doc, ctx, C, calls, dialogs, clock, toasts, winListeners, session, local,
    $: (id) => doc.getElementById(id),
    view: () => doc.getElementById("cView"),
    html: (id = "cView") => doc.getElementById(id).innerHTML,
    printed: () => printed,
    async settle(ms = 0) { await clock.advance(ms); },
    click(el) { if (typeof el === "string") el = doc.getElementById(el) || doc.querySelector(el); if (!el) throw new Error("nothing to click"); el.click(); return clock.flush(); },
    change(el, value) {
      if (typeof el === "string") el = doc.getElementById(el) || doc.querySelector(el);
      if (value !== undefined) { if (el.type === "checkbox") el.checked = !!value; else el.value = value; }
      el.dispatchEvent({ type: "input" });
      el.dispatchEvent({ type: "change" });
      return clock.flush();
    },
    async boot() {
      doc.readyState = "interactive";
      (doc.listeners.DOMContentLoaded || []).forEach((fn) => fn({ type: "DOMContentLoaded" }));
      await clock.flush();
      if (server !== undefined) C._test.setServer(server);
      await clock.flush();
    },
    async go(hashPath) { location.hash = "#/" + hashPath; await clock.advance(1); },
    answerDialog(value) { const d = dialogs.find((x) => !x.answered); if (!d) throw new Error("no dialog open"); d.answered = true; d.resolve(value); return clock.flush(); },
  };
  if (boot) await h.boot();
  return h;
}

/* A status from GET ?action=console&server=1 with the server online. */
export function onlineStatus(over = {}, serverOver = {}) {
  return {
    ready: true,
    server: { host: "DCR-SERVER", version: "2.0.0", proto: 1, lastSeen: "2026-10-10T16:59:30.000Z", minutesAgo: 0, online: true,
      standby: false, paused: false, lastError: "", sentToday: 3, failedToday: 0, repliesToday: 1, enabledAgents: 4,
      consoleAt: "2026-10-10T16:59:50.000Z", consoleOn: true, assistantAt: "", ...serverOver },
    lease: { host: "DCR-SERVER", since: "2026-10-09T12:00:00.000Z", by: "started as the DCR server" },
    others: [], generatedAt: "2026-10-10T17:00:00.000Z", ...over,
  };
}

/* The pages answer through a fake that only knows the status read, for the
   module tests whose calls go through setRpc. */
export function statusApi(status) {
  return async (path) => {
    if (/[?&]server=1/.test(path)) return typeof status === "function" ? status() : JSON.parse(JSON.stringify(status));
    throw Object.assign(new Error("unexpected " + path), { status: 500, data: { error: "unexpected" } });
  };
}

/* Plain data out of the vm (another realm's objects fail deepStrictEqual). */
export const plain = (v) => JSON.parse(JSON.stringify(v));
