#!/usr/bin/env node
/* DCR Portal 2 — the local DEMO server (development only, never deployed).

     node tools/devserve.mjs            -> http://127.0.0.1:8792/

   Serves site/ as GitHub Pages would, and, in every HTML page it serves, swaps the supabase-js
   <script> for the demo stand-in (/__dev/fake-supabase.js = tools/fake/p6.js + p5a-est.js + p5a-pm.js + engine.js + pc-demo.js +
   seed.js + fake-supabase.js + push-demo.js): made-up data in the browser, no request to Supabase at all. The files in site/
   are never changed; the published site has no switch that could turn this on.

   The Files tab's OneDrive part (site/js/repo/onedrive.js LIVE, off until its go-live) is served switched ON in demo mode
   (tools/fake/p7-onedrive.js answers it: nothing reaches Microsoft); --onedrive-off serves the module as published.

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
// p6.js and p5a-est.js first: engine.js reads their column lists when it loads (phase 6: the console relay and the
// assistants; P5a: estimates, change orders, takeoffs; p5a-pm.js after p5a-est.js: the progress chart's flags, quotes
// and money, made on top of those estimates; P5b: p5b-ledger.js after p5a-pm.js - the ledger's columns, RPCs and rows;
// p5b-books.js after it - the books' rules of bills, payments and invoices, their RPCs, books_desk and rows;
// P5c: p5c-lists.js - the office lists: leads and convert_lead, the vehicle board, marketing tasks and their prices;
// p5c-sub.js after p5b-books.js - sub_submissions, accept / reject, and the public "subform" function's stand-in;
// p5c-sales.js - the sales switch, the comps, the saved sales estimates, the materials library and sales-media;
// Part 3: p7-web.js after them - the Estimator and OneDrive upload switches, admin_set_profile and the estimator)
// Part 4: p7-onedrive.js - the OneDrive broker's stand-in and the owner's OneDrive behind it, for the Files tab;
// the Books program, release A: p8-files.js after p5b-books.js - the money files (payment_id, no version for a money
// file but "name (2)", its safe shape, money editors remove, the bill's guarded document); p8-contacts.js - contact
// pictures (contacts.picture_path, the bucket contact-pictures) and a contact's reach, for the contact card: it has no
// table list for engine.js to read when it loads, so it comes after it - its install and its seed are read only when
// fake-supabase.js makes the engine)
const FAKE_PARTS = ["p6.js", "p5a-est.js", "p5a-pm.js", "p5b-ledger.js", "p5b-books.js", "p5c-lists.js", "p5c-sub.js", "p5c-sales.js", "p7-web.js", "p7-onedrive.js", "p8-files.js", "engine.js", "p8-contacts.js", "pc-demo.js", "seed.js", "fake-supabase.js", "push-demo.js"];
const HOST = "127.0.0.1";
const PORT = Number(process.env.DCR2_DEV_PORT || process.env.PORT || 8792);
const DEMO = !process.argv.includes("--no-demo");
const ONEDRIVE_ON = !process.argv.includes("--onedrive-off");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};

const SUPABASE_TAG = /<script\b[^>]*\bsrc=["'][^"']*@supabase\/supabase-js@[^"']*["'][^>]*>\s*<\/script>\s*/gi;
const FAKE_TAG = '<script src="/__dev/fake-supabase.js"></script>\n';

/** site/js/repo/onedrive.js as served in demo mode: its OneDrive part switched on (the demo's broker answers it). */
export function onedriveLive(src) {
  return String(src).replace(/export const LIVE = false;/, "export const LIVE = true;   // (demo server: tools/fake/p7-onedrive.js answers)");
}

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
      if (DEMO && ONEDRIVE_ON && path === "/js/repo/onedrive.js") body = onedriveLive(body.toString("utf8"));
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
