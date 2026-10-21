/* DCR Agents 2 console: the bridge between the old console's shell (js/console/shell.js, a classic script,
   unchanged apart from its four network points) and Portal 2's data layer (migration M6).

   Installed during module evaluation, which a browser finishes before DOMContentLoaded, when the shell boots
   (no top-level await here, so nothing delays that):

   * window.DCR               what the old modules call on the old common.js: esc, modal, confirm, alert and
                              requireAuth (Portal 2's sign-in, the top bar, then the person in the old shape
                              {displayName, email, role})
   * window.DCRConsoleBridge  status()          rpc agents_server_status -> the old server=1 answer
                              request(m, args)  rpc console_request -> {id, at}
                              read(id)          rpc console_get -> the old ?id= answer (expired and lost are
                                                worked out by the database on read)
                              cancel(id)        rpc console_cancel -> {ok, status}
                              wait(id, ms)      a sleep that ends early when Realtime says the row changed (or
                                                the channel joined again: read then)
                              live()            whether the Realtime channel on this admin's rows is joined (the
                                                shell then polls only every few seconds)

   Every refusal is handed to the shell as the old DCR.api threw it (map/console.js httpError), so its words
   and codes are the old ones. */
import { h, modal, confirm, alert, requireAuth, topbar } from "../common2.js";
import * as repo from "../repo/console.js";
import { requestOf, consoleServer, httpError } from "../map/console.js";

let me = null;
let joined = false;
let unwatch = null;
let watching = null;
const waiters = new Map();    // id -> Set of wake functions

function wake(id) {
  const list = id === null ? Array.from(waiters.values()) : [waiters.get(String(id))].filter(Boolean);
  for (const set of list) for (const fn of Array.from(set)) fn();
}

/* One channel for the page: this admin's own requests (RLS lets nothing else through anyway). */
function ensureWatch() {
  if (watching || !me) return watching;
  watching = repo.watchMine(me.id, (evt) => {
    if (!evt) return;
    if (evt.type === "SUBSCRIBED") { joined = true; wake(null); return; }
    /* the channel went (refused, timed out, closed): not live until it joins again - the shell polls at its own
       pace meanwhile, and every waiter reads now (a change while it was gone is never announced) */
    if (evt.type === "LOST") { joined = false; wake(null); return; }
    const row = evt.new || evt.old || null;
    if (row && row.id !== undefined && row.id !== null) wake(row.id);
  }).then((stop) => { unwatch = stop; return stop; }, () => { watching = null; return null; });
  return watching;
}

async function call(fn) {
  try { return await fn(); } catch (e) { throw httpError(e); }
}

const bridge = {
  async status() {
    return consoleServer(await call(() => repo.status()));
  },
  async request(method, args) {
    const r = requestOf(await call(() => repo.request(method, args)));
    ensureWatch();
    return r;
  },
  read(id) { return call(() => repo.get(id)); },
  async cancel(id) {
    const r = await call(() => repo.cancel(id));
    return r && typeof r === "object" ? r : { ok: !!r, status: r ? "cancelled" : "" };
  },
  wait(id, ms, clock) {
    const key = String(id);
    const set = waiters.get(key) || new Set();
    waiters.set(key, set);
    const st = clock && typeof clock.setTimeout === "function" ? clock : { setTimeout, clearTimeout };
    return new Promise((resolve) => {
      let timer = null;
      const done = () => {
        st.clearTimeout(timer);
        set.delete(done);
        if (!set.size) waiters.delete(key);
        resolve();
      };
      set.add(done);
      timer = st.setTimeout(done, ms);
    });
  },
  live() { return joined; },
  /* the page is left: the channel goes */
  stop() { if (unwatch) { try { unwatch(); } catch (e) { /* */ } } unwatch = null; watching = null; joined = false; },
};

window.DCRConsoleBridge = bridge;
window.DCR = {
  esc: h,
  modal: (o) => modal(o),
  confirm: (m, o) => confirm(m, o),
  alert: (m, o) => alert(m, o),
  async requireAuth() {
    const p = await requireAuth();
    me = p;
    topbar("console", { title: "DCR Agents 2" });
    return { id: p.id, displayName: p.name, email: p.email, role: p.role };
  },
};
window.addEventListener("pagehide", () => bridge.stop());
