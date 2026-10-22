/* DCR Portal 2 — the supabase-js stand-in of PGLITE mode (development only; tools/pglite-serve.mjs serves it as
   /__pglite/client.js in place of the supabase-js <script> of every page).

   Unlike the demo (tools/fake/*: an in-browser imitation of the database), nothing is decided here: every call a
   page makes is RECORDED (from(t).select(..).eq(..)..., rpc(name, args), the sign-in, a signed URL, a private
   channel's join) and sent to the local server, which replays it on tools/pglite-rest.mjs against PGlite loaded
   with every DCR Desktop 2 migration, as the signed-in person (SET ROLE authenticated + request.jwt.claims). So row
   level security, triggers, grants, RPC argument names and the database's own refusals answer the page.

   Never the real project: fetch, XMLHttpRequest and WebSocket to *.supabase.co / .in / .net (and the address
   search) are refused in the page, and the walk's browser resolves those hosts nowhere. Made-up data only. */
(function (root) {
  "use strict";
  const ENDPOINT = "/__pglite/q";
  const BLOCKED = /(\.supabase\.(co|in|net)|nominatim\.openstreetmap\.org)$/i;

  function blocked(url) {
    try {
      const u = new URL(String(url), root.location ? root.location.href : "http://127.0.0.1/");
      return BLOCKED.test(u.hostname);
    } catch (e) { return false; }
  }
  const realFetch = root.fetch.bind(root);
  root.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    if (blocked(url)) return Promise.reject(new TypeError("Failed to fetch (PGlite mode: no network to Supabase)"));
    return realFetch(input, init);
  };
  if (root.XMLHttpRequest) {
    const open = root.XMLHttpRequest.prototype.open;
    root.XMLHttpRequest.prototype.open = function (method, url) {
      if (blocked(url)) throw new TypeError("PGlite mode: no network to Supabase");
      return open.apply(this, arguments);
    };
  }
  if (root.WebSocket) {
    const RealWS = root.WebSocket;
    const WS = function (url, protocols) {
      if (blocked(url)) throw new TypeError("PGlite mode: no network to Supabase");
      return protocols === undefined ? new RealWS(url) : new RealWS(url, protocols);
    };
    WS.prototype = RealWS.prototype;
    ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach((k) => { WS[k] = RealWS[k]; });
    root.WebSocket = WS;
  }

  async function call(body) {
    let r;
    try {
      r = await realFetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      throw new TypeError("Failed to fetch (the PGlite server is not answering)");
    }
    if (!r.ok) throw new TypeError("Failed to fetch (the PGlite server answered " + r.status + ")");
    return r.json();
  }
  const clone = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function authError(name, code, status, message) {
    const e = new Error(message);
    e.name = name; e.code = code; e.status = status; e.__isAuthError = true;
    return e;
  }

  class Auth {
    constructor(opts) {
      const a = (opts && opts.auth) || {};
      this.storage = a.storage || root.localStorage;
      this.key = a.storageKey || "sb-pglite-auth-token";
      this.listeners = new Set();
      setTimeout(() => this._emit("INITIAL_SESSION", this._read()), 0);
    }
    _read() {
      let s = null;
      try { s = JSON.parse(this.storage.getItem(this.key) || "null"); } catch (e) { s = null; }
      return s && s.user && /^pglite-/.test(String(s.access_token || "")) ? s : null;
    }
    _write(s) { if (s) this.storage.setItem(this.key, JSON.stringify(s)); else this.storage.removeItem(this.key); }
    _emit(event, s) { for (const cb of Array.from(this.listeners)) { try { cb(event, s); } catch (e) { /* */ } } }
    token() { const s = this._read(); return s ? s.access_token : null; }
    async getSession() { await sleep(2); return { data: { session: this._read() }, error: null }; }
    async getUser() {
      const s = this._read();
      return s ? { data: { user: s.user }, error: null } : { data: { user: null }, error: authError("AuthSessionMissingError", "session_missing", 400, "Auth session missing!") };
    }
    async refreshSession() { const s = this._read(); return { data: { session: s, user: s && s.user }, error: null }; }
    async signInWithPassword(creds) {
      const r = await call({ op: "signIn", email: creds && creds.email, password: creds && creds.password });
      if (r.error) return { data: { user: null, session: null }, error: authError("AuthApiError", r.error.code || "invalid_credentials", r.error.status || 400, r.error.message) };
      this._write(r.data.session);
      this._emit("SIGNED_IN", r.data.session);
      return { data: { user: r.data.session.user, session: r.data.session }, error: null };
    }
    async signOut(opts) {
      const scope = (opts && opts.scope) || "global";
      if (scope !== "others") { this._write(null); this._emit("SIGNED_OUT", null); }
      return { error: null };
    }
    async updateUser(attrs) {
      const s = this._read();
      if (!s) return { data: { user: null }, error: authError("AuthSessionMissingError", "session_missing", 400, "Auth session missing!") };
      const r = await call({ op: "updateUser", token: s.access_token, attrs: clone(attrs) });
      if (r.error) return { data: { user: null }, error: authError("AuthApiError", r.error.code, r.error.status || 400, r.error.message) };
      this._emit("USER_UPDATED", s);
      return { data: { user: s.user }, error: null };
    }
    onAuthStateChange(cb) {
      this.listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => this.listeners.delete(cb) } } };
    }
  }

  /** A query builder that records every call and sends the chain when it is awaited. */
  function recorder(client, table) {
    const chain = [];
    let sent = null;
    const go = () => { if (!sent) sent = call({ op: "from", token: client.auth.token(), table, chain: clone(chain) }); return sent; };
    const proxy = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (res, rej) => go().then(res, rej);
        if (prop === "catch") return (rej) => go().catch(rej);
        if (prop === "finally") return (f) => go().finally(f);
        if (typeof prop === "symbol") return undefined;
        return (...args) => { chain.push([prop, args]); return proxy; };
      },
    });
    return proxy;
  }

  class Channel {
    constructor(client, topic, opts) { this.c = client; this.topic = topic; this.opts = opts || {}; this.bindings = []; this.state = "closed"; this.cb = null; }
    on(type, filter, cb) { this.bindings.push({ type, filter, cb }); return this; }
    subscribe(cb) {
      this.cb = cb || null;
      const priv = !!(this.opts.config && this.opts.config.private);
      call({ op: "channel", token: this.c.auth.token(), topic: this.topic, private: priv }).then((r) => {
        if (this.state === "left") return;
        const ok = r && r.data && r.data.status === "SUBSCRIBED";
        this.state = ok ? "joined" : "errored";
        if (this.cb) this.cb(ok ? "SUBSCRIBED" : "CHANNEL_ERROR", ok ? undefined : new Error((r && r.error && r.error.message) || "refused"));
      }, (e) => { if (this.cb) this.cb("CHANNEL_ERROR", e); });
      return this;
    }
    async track() { return this.state === "joined" ? "ok" : "error"; }
    async untrack() { return "ok"; }
    presenceState() { return {}; }
    async send() { return "ok"; }
    async unsubscribe() { const was = this.state === "joined"; this.state = "left"; if (was && this.cb) this.cb("CLOSED"); return "ok"; }
  }

  class Client {
    constructor(url, key, opts) {
      this.supabaseUrl = url; this.supabaseKey = key;
      this.auth = new Auth(opts);
      this.list = [];
      const self = this;
      this.storage = {
        from(bucket) {
          return {
            async createSignedUrl(path, seconds) {
              const r = await call({ op: "signedUrl", token: self.auth.token(), bucket, path, seconds });
              return r.error ? { data: null, error: r.error } : { data: { signedUrl: root.location.origin + r.data.signedUrl }, error: null };
            },
            async createSignedUrls(paths, seconds) {
              const r = await call({ op: "signedUrls", token: self.auth.token(), bucket, paths, seconds });
              if (r.error) return { data: null, error: r.error };
              return { data: r.data.map((x) => Object.assign({}, x, { signedUrl: x.signedUrl ? root.location.origin + x.signedUrl : null })), error: null };
            },
            async upload() { return { data: null, error: { message: "uploads are not simulated in PGlite mode", statusCode: "400" } }; },
          };
        },
      };
      this.realtime = { setAuth: async () => {} };
      // Edge Functions: none here (the push function answers as an unconfigured project would)
      this.functions = {
        invoke: async () => ({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code",
          context: new Response(JSON.stringify({ error: "push_not_configured" }), { status: 503, headers: { "content-type": "application/json" } }) } }),
      };
    }
    from(table) { return recorder(this, table); }
    schema() { return this; }
    rpc(name, args) {
      const p = call({ op: "rpc", token: this.auth.token(), name, args: clone(args || {}) });
      return { then: (res, rej) => p.then(res, rej), catch: (rej) => p.catch(rej), finally: (f) => p.finally(f) };
    }
    channel(topic, opts) { const ch = new Channel(this, topic, opts); this.list.push(ch); return ch; }
    getChannels() { return this.list.slice(); }
    async removeChannel(ch) { if (ch) await ch.unsubscribe(); this.list = this.list.filter((c) => c !== ch); return "ok"; }
    async removeAllChannels() { for (const ch of this.list.slice()) await this.removeChannel(ch); return []; }
  }

  root.DCR2PGlite = { endpoint: ENDPOINT };
  root.supabase = { createClient: (url, key, opts) => new Client(url, key, opts) };
})(typeof window !== "undefined" ? window : globalThis);
