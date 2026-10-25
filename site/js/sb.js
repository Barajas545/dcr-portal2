/* The one Supabase client of Portal 2, its sign-in storage, and the signed-in person.

   BLUEPRINT 2.2.3 / 2.2.4:
   - one client, storageKey "dcr2-auth" (never the old portal's session key);
   - "Keep me signed in on this device" decides where the session lives: localStorage when ticked,
     sessionStorage otherwise (the adapter below);
   - after signing in, the caller's own profiles row is read: a missing row, active = false or the
     role "agents" signs out again with "This account is not active";
   - signing out ends only THIS device's session (scope "local"; supabase-js defaults to "global",
     which would also sign the person out of DCR Desktop 2 and their other phones);
   - a password change re-checks the current password, needs 10+ characters with letters and digits,
     clears the temporary-password flag (rpc password_changed) and ends the other sessions.

   The supabase-js library (UMD build, pinned) is loaded from jsDelivr when the page did not load it
   already. Pages may include the same <script> tag in <head> to start the download earlier. */

export const SUPABASE_JS_VERSION = "2.117.2";
export const SUPABASE_JS_URL =
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@" + SUPABASE_JS_VERSION + "/dist/umd/supabase.js";
export const STORAGE_KEY = "dcr2-auth";
export const BUCKET = "project-files";
export const MIN_PASSWORD = 10;

const MODE_KEY = "dcr2-auth-mode";        // sessionStorage: "session" = not kept on this device
const PROFILE_KEY = "dcr2-auth-profile";  // the last profile read, kept next to the session (offline)
const PROFILE_COLUMNS =
  "id,full_name,email,phone,role,color,can_see_prices,can_see_financials,can_approve_payments,active,version";
// The Estimator and OneDrive upload switches (migration 20261028000100_estimator.sql): read when the database has
// them; before that update the sign-in reads the columns above and both switches count as off (an admin's are on).
const SWITCH_COLUMNS = ",can_estimate,can_upload_onedrive";

/* ── the sign-in storage ───────────────────────────────────────────────── */

function safeStore(get) {
  try {
    const s = get();
    if (!s) return null;
    const probe = "dcr2-probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch (e) {
    return null;          // private mode, blocked site data
  }
}

/** The storage adapter supabase-js keeps its session in. Pure apart from the two stores it is
    given, so the tests drive it with plain objects. A blocked store falls back to memory (the
    session then lasts as long as the page). */
export function makeAuthStorage(getLocal, getSession) {
  const mem = new Map();
  const memStore = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
    key: (i) => Array.from(mem.keys())[i] ?? null,
    get length() { return mem.size; },
  };
  let local = null, session = null, probed = false;
  function stores() {
    if (!probed) {
      probed = true;
      local = safeStore(getLocal) || memStore;
      session = safeStore(getSession) || memStore;
    }
    return { local, session };
  }
  function mode() {
    try { return stores().session.getItem(MODE_KEY) === "session" ? "session" : "local"; }
    catch (e) { return "local"; }
  }
  function store() { const s = stores(); return mode() === "session" ? s.session : s.local; }
  function ours(k) { return typeof k === "string" && k.indexOf(STORAGE_KEY) === 0; }
  function purge(st) {
    const keys = [];
    try {
      for (let i = 0; i < st.length; i++) { const k = st.key(i); if (ours(k)) keys.push(k); }
      keys.forEach((k) => st.removeItem(k));
    } catch (e) { /* nothing to purge */ }
  }
  return {
    getItem(k) { try { return store().getItem(k); } catch (e) { return null; } },
    setItem(k, v) { try { store().setItem(k, v); } catch (e) { /* quota: the session lasts this page */ } },
    removeItem(k) {
      const s = stores();
      try { s.local.removeItem(k); } catch (e) { /* */ }
      try { s.session.removeItem(k); } catch (e) { /* */ }
    },
    mode,
    /** "local" (keep me signed in) or "session"; the other store's sign-in is dropped. */
    setMode(m) {
      const s = stores();
      if (m === "session") {
        purge(s.local);
        try { s.session.setItem(MODE_KEY, "session"); } catch (e) { /* */ }
      } else {
        purge(s.session);
        try { s.session.removeItem(MODE_KEY); } catch (e) { /* */ }
      }
    },
    /** Every key of ours, both stores: this device is signed out whatever the network says. */
    clear() {
      const s = stores();
      purge(s.local);
      purge(s.session);
      try { s.session.removeItem(MODE_KEY); } catch (e) { /* */ }
    },
  };
}

export const authStorage = makeAuthStorage(
  () => (typeof localStorage !== "undefined" ? localStorage : null),
  () => (typeof sessionStorage !== "undefined" ? sessionStorage : null)
);

/* ── the library and the client ────────────────────────────────────────── */

function hasLibrary() {
  return !!(globalThis.supabase && typeof globalThis.supabase.createClient === "function");
}

function loadLibrary() {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SUPABASE_JS_URL;
    s.crossOrigin = "anonymous";
    s.onload = s.onerror = () => resolve(hasLibrary());
    document.head.appendChild(s);
  });
}

if (typeof document !== "undefined" && !hasLibrary()) {
  await loadLibrary();
  // A cold start with no signal and no kept copy: try again when the connection comes back, so this page
  // (Site Photos with a queue waiting, say) reaches the database without a reload.
  if (!hasLibrary() && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    let trying = false;
    const again = () => {
      if (hasLibrary()) { window.removeEventListener("online", again); return; }
      if (trying) return;
      trying = true;
      loadLibrary().then((ok) => { trying = false; if (ok) window.removeEventListener("online", again); });
    };
    window.addEventListener("online", again);
  }
}

let _client = null;

/** The single supabase client. Throws (status 0, an offline error) when the library could not be
    loaded: no connection on a cold start. */
export function sb() {
  if (_client) return _client;
  if (!hasLibrary()) {
    const e = new Error("Can't reach the portal: the page could not load what it needs. Check the connection.");
    e.code = "NO_LIBRARY";
    e.status = 0;
    throw e;
  }
  const c = globalThis.DCR2_CONFIG || {};
  _client = globalThis.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_KEY, {
    auth: {
      storage: authStorage,
      storageKey: STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return _client;
}

/* ── errors that are the connection, not a verdict ─────────────────────── */

/** A failure that says nothing about the account: no connection, a timeout, a gateway page. */
export function isNetworkError(err) {
  if (!err) return false;
  if (err.code === "NO_LIBRARY") return true;
  const name = String(err.name || "");
  if (name === "AuthRetryableFetchError" || name === "TypeError" || name === "AbortError") return true;
  const status = Number(err.status);
  if (err.status !== undefined && err.status !== null && (status === 0 || status >= 500 || status === 408)) return true;
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(String(err.message || ""));
}

function offline(err) {
  const e = new Error("Can't reach the server. Check the internet connection and try again.");
  e.status = 0;
  e.code = "offline";
  e.cause = err;
  return e;
}

/* ── the session ───────────────────────────────────────────────────────── */

/** True when this device holds a sign-in (whether or not it can be refreshed right now). */
export function hasStoredSession() {
  return !!authStorage.getItem(STORAGE_KEY);
}

/** The user id of the sign-in this device holds, read without any network (or null). */
export function storedUserId() {
  try {
    const raw = JSON.parse(authStorage.getItem(STORAGE_KEY) || "null");
    return (raw && raw.user && raw.user.id) || null;
  } catch (e) {
    return null;
  }
}

/** The current session or null. A connection problem THROWS (status 0) instead of answering
    "signed out": network errors never sign anyone out. */
export async function session() {
  const { data, error } = await sb().auth.getSession();
  if (error) {
    if (isNetworkError(error)) throw offline(error);
    return null;
  }
  return (data && data.session) || null;
}

/** onAuth((event, session) => …) -> unsubscribe */
export function onAuth(cb) {
  const { data } = sb().auth.onAuthStateChange((event, s) => {
    if (event === "SIGNED_OUT" || event === "USER_UPDATED") _me = null;
    try { cb(event, s); } catch (e) { /* a listener never breaks sign-in */ }
  });
  return () => { try { data.subscription.unsubscribe(); } catch (e) { /* */ } };
}

/* ── the signed-in person ──────────────────────────────────────────────── */

/** profiles row -> the shape every page uses. Admins always hold every switch (the database forces them on). */
export function shapeProfile(row) {
  if (!row) return null;
  const admin = row.role === "admin";
  return {
    id: row.id,
    name: String(row.full_name || "").trim() || String(row.email || ""),
    full_name: row.full_name || "",
    email: row.email || "",
    phone: row.phone || "",
    role: row.role || "viewer",
    color: row.color || "",
    can_see_prices: admin || !!row.can_see_prices,
    can_see_financials: admin || !!row.can_see_financials,
    can_approve_payments: admin || !!row.can_approve_payments,
    can_estimate: admin || !!row.can_estimate,
    can_upload_onedrive: admin || !!row.can_upload_onedrive,
    must_change_password: !!row.must_change_password,
    active: row.active !== false,
    version: row.version,
  };
}

export function isMissingColumn(error) {
  const code = String((error && error.code) || "");
  return code === "42703" || code === "PGRST204" ||
    /must_change_password|can_estimate|can_upload_onedrive/.test(String((error && error.message) || ""));
}

/** The column lists the sign-in tries, newest database first: a database without the newer columns is asked
    again with fewer (a missing column must never stop anybody signing in). */
export const PROFILE_SELECTS = Object.freeze([
  PROFILE_COLUMNS + SWITCH_COLUMNS + ",must_change_password",
  PROFILE_COLUMNS + ",must_change_password",            // before 20261028000100 (Estimator, OneDrive upload)
  PROFILE_COLUMNS,                                       // before migration M1
]);

let _me = null;

/** The signed-in person ({id, name, email, role, color, can_see_prices, can_see_financials,
    can_approve_payments, can_estimate, can_upload_onedrive, must_change_password, active, …}), or null when signed out or when the
    profiles row is missing. Network errors throw. Cached for the page; { fresh: true } re-reads. */
export function me({ fresh = false } = {}) {
  if (_me && !fresh) return _me;
  const p = loadMe();
  _me = p;
  p.catch(() => { if (_me === p) _me = null; });
  return p;
}

async function loadMe() {
  const s = await session();
  if (!s || !s.user) return null;
  const q = (cols) => sb().from("profiles").select(cols).eq("id", s.user.id).maybeSingle();
  let res = await q(PROFILE_SELECTS[0]);
  for (let i = 1; i < PROFILE_SELECTS.length && res.error && isMissingColumn(res.error); i++) res = await q(PROFILE_SELECTS[i]);
  if (res.error) {
    res.error.status = res.status;
    throw isNetworkError(res.error) || res.status === 0 ? offline(res.error) : res.error;
  }
  const p = shapeProfile(res.data);
  remember(p);
  return p;
}

function remember(p) {
  try {
    if (p) authStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    else authStorage.removeItem(PROFILE_KEY);
  } catch (e) { /* */ }
}

/** The profile read last on this device for the stored session (offline pages), or null. */
export function cachedMe() {
  try {
    const p = JSON.parse(authStorage.getItem(PROFILE_KEY) || "null");
    const raw = JSON.parse(authStorage.getItem(STORAGE_KEY) || "null");
    const uid = raw && raw.user && raw.user.id;
    return p && uid && p.id === uid ? p : null;
  } catch (e) {
    return null;
  }
}

export function inactiveError() {
  const e = new Error("This account is not active. Ask the office.");
  e.code = "account_inactive";
  e.status = 403;
  return e;
}

/** Sign in. keep = "Keep me signed in on this device". Resolves with the profile; an inactive,
    missing or agents profile is signed out again and rejected. One attempt only: Supabase allows
    30 sign-ins per 5 minutes per address, shared with the office PCs. */
export async function signIn(email, password, keep) {
  authStorage.setMode(keep ? "local" : "session");
  _me = null;
  const { error } = await sb().auth.signInWithPassword({
    email: String(email || "").trim().toLowerCase(),
    password: String(password || ""),
  });
  if (error) throw error;
  const p = await me({ fresh: true });
  if (!p || !p.active || p.role === "agents") {
    await signOut();
    throw inactiveError();
  }
  return p;
}

/** End this device's session only. Never fails: offline, the local copy is dropped anyway. */
export async function signOut() {
  _me = null;
  try { await sb().auth.signOut({ scope: "local" }); } catch (e) { /* offline */ }
  authStorage.clear();
}

/** Why Supabase Auth would refuse this password (a sentence), or "" — Desktop 2's rule. */
export function passwordProblem(pw) {
  const s = typeof pw === "string" ? pw : "";
  if (s.length < MIN_PASSWORD) return "Use at least " + MIN_PASSWORD + " characters.";
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) return "Use both letters and digits.";
  return "";
}

/** Change the password. currentPw (optional) is re-checked first; then the new one is set, the
    temporary-password flag cleared (rpc password_changed) and every OTHER session ended. */
export async function changePassword(newPw, currentPw) {
  const problem = passwordProblem(newPw);
  if (problem) {
    const e = new Error(problem);
    e.code = "weak_password";
    e.status = 400;
    throw e;
  }
  const p = await me();
  if (!p) {
    const e = new Error("Your sign-in has expired. Please sign in again.");
    e.status = 401;
    throw e;
  }
  if (currentPw !== undefined && currentPw !== null) {
    if (currentPw === newPw) {
      const e = new Error("That is already your password. Pick a different one.");
      e.code = "same_password";
      e.status = 400;
      throw e;
    }
    const check = await sb().auth.signInWithPassword({ email: p.email, password: String(currentPw) });
    if (check.error) {
      if (String(check.error.code || "") === "invalid_credentials") {
        const e = new Error("Your current password is not right.");
        e.code = "wrong_current_password";
        e.status = 400;
        throw e;
      }
      throw check.error;
    }
  }
  const { error } = await sb().auth.updateUser({ password: newPw });
  if (error) throw error;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await sb().rpc("password_changed");
    if (!r.error) break;
    const code = String(r.error.code || "");
    if (code === "PGRST202" || code === "42883") break;          // before migration M1: no flag to clear
    if (attempt === 1 || !isNetworkError(Object.assign(r.error, { status: r.status }))) throw r.error;
  }
  try { await sb().auth.signOut({ scope: "others" }); } catch (e) { /* the others expire on their own */ }
  _me = null;
  return true;
}
