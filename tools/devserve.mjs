#!/usr/bin/env node
/* DCR Portal 2 — the local DEMO server (development only, never deployed).

     node tools/devserve.mjs            -> http://127.0.0.1:8792/

   Serves site/ as GitHub Pages would, and, in every HTML page it serves, swaps the supabase-js
   <script> for the demo stand-in (/__dev/fake-supabase.js = tools/fake/engine.js + seed.js +
   fake-supabase.js + push-demo.js): made-up data in the browser, no request to Supabase at all. The files in site/
   are never changed; the published site has no switch that could turn this on.

   Binds to 127.0.0.1 only. PORT / DCR2_DEV_PORT override the port; --no-demo serves site/ untouched
   (it would then talk to the real project: do not sign in with real accounts from here). */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..");
const SITE = resolve(ROOT, "site");
const FAKE_DIR = resolve(HERE, "fake");
const FAKE_PARTS = ["engine.js", "seed.js", "fake-supabase.js", "push-demo.js"];
const HOST = "127.0.0.1";
const PORT = Number(process.env.DCR2_DEV_PORT || process.env.PORT || 8792);
const DEMO = !process.argv.includes("--no-demo");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};

const SUPABASE_TAG = /<script\b[^>]*\bsrc=["'][^"']*@supabase\/supabase-js@[^"']*["'][^>]*>\s*<\/script>\s*/gi;
const FAKE_TAG = '<script src="/__dev/fake-supabase.js"></script>\n';

/** The page as served in demo mode: the stand-in before the first script, the real library out. */
export function injectDemo(html) {
  let out = String(html).replace(SUPABASE_TAG, "");
  const at = out.search(/<script\b/i);
  const head = out.search(/<\/head>/i);
  const pos = at !== -1 && (head === -1 || at < head) ? at : head;
  if (pos === -1) return FAKE_TAG + out;
  return out.slice(0, pos) + FAKE_TAG + out.slice(pos);
}

async function fakeBundle() {
  const parts = await Promise.all(FAKE_PARTS.map((f) => readFile(join(FAKE_DIR, f), "utf8")));
  return "/* DCR Portal 2 demo mode: tools/fake/" + FAKE_PARTS.join(" + ") + " (development only) */\n" +
    parts.map((p, i) => "/* ── " + FAKE_PARTS[i] + " ── */\n" + p).join("\n;\n");
}

function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({
    "content-type": type || "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  }, extra || {}));
  res.end(body);
}

export function startServer(port = PORT) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://" + HOST);
      let path = decodeURIComponent(url.pathname);
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "GET only");
      if (path === "/__dev/fake-supabase.js") {
        if (!DEMO) return send(res, 404, "demo mode is off");
        return send(res, 200, await fakeBundle(), TYPES[".js"]);
      }
      if (path === "/__dev/health") return send(res, 200, JSON.stringify({ ok: true, demo: DEMO }), TYPES[".json"]);
      if (path.endsWith("/")) path += "index.html";
      const file = normalize(join(SITE, path));
      if (file !== SITE && !file.startsWith(SITE + sep)) return send(res, 403, "outside the site");
      let st;
      try { st = await stat(file); } catch (e) { return send(res, 404, "Not found: " + path); }
      if (st.isDirectory()) return send(res, 302, "", "text/plain", { location: path.replace(/\/?$/, "/") });
      const ext = extname(file).toLowerCase();
      let body = await readFile(file);
      if (ext === ".html" && DEMO) body = injectDemo(body.toString("utf8"));
      const extra = path === "/sw.js" ? { "service-worker-allowed": "/" } : {};
      return send(res, 200, req.method === "HEAD" ? "" : body, TYPES[ext] || "application/octet-stream", extra);
    } catch (e) {
      return send(res, 500, "devserve: " + (e && e.message));
    }
  });
  server.listen(port, HOST, () => {
    if (port) console.log("DCR Portal 2 " + (DEMO ? "DEMO (made-up data, no Supabase)" : "site (no demo)") + " at http://" + HOST + ":" + server.address().port + "/");
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
