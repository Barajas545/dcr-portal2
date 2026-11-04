#!/usr/bin/env node
/* DCR Portal 2 — the portal's own copy of the takeoff app (development only; owner decision Q4, 2026-11-04).

     node tools/vendor-takeoff.mjs <takeoff-web checkout> <commit> [--allow-inline-boot] [--out <dir>]

   On a phone or a tablet the takeoff app (Professional Takeoff Tools on the web, takeoff-web) opens INSIDE the portal,
   as a full-screen frame over the page (js/plan-frame.js): the home-screen app cannot hand a plan to another site (it
   opens other sites without an opener, in Safari, whose storage is not the app's), but a page of this site can be
   handed the Plans Library's File directly. So the portal publishes a pinned, reviewed copy of takeoff-web at
   site/takeoff/ - this tool makes that copy. It never follows takeoff-web's main by itself: a person names the commit,
   reads what changed, and runs this.

   What it does:
   * the files come from git AT THAT COMMIT (git ls-tree + git cat-file: the committed bytes, never the working tree, and
     never through a line-ending filter); each blob's git object id is checked against its bytes, so a copy is exactly
     the commit's or the tool stops;
   * only what the app ships: index.html, sw.js, manifest.webmanifest, css/, js/, icons/, data/ and of vendor/pdfjs/
     what the app loads (the two build files, the cmaps and the standard fonts) with pdf.js's licences - never tests/,
     docs or tools; a file of an unexpected kind in a shipped folder is left out and named;
   * a strict security policy is written into site/takeoff/index.html (TAKEOFF_CSP below: no inline script, nothing
     but this site, and the owner's OneDrive host in connect-src exactly as the portal's own pages carry it - read from
     js/repo/onedrive.js ONEDRIVE_HOST, so the two can never differ). The host is written only into the PORTAL's copy:
     takeoff-web's own repository must never carry it. frame-ancestors cannot be set from a meta tag (a page's own
     header only; GitHub Pages sends none), which is why takeoff-web is shown only by this site's own frame and the
     portal's pages refuse another site's frame themselves (js/common2.js);
   * it refuses a page that still has an inline <script> (the policy would block it): takeoff-web moves its UI-mode boot
     into js/ui-mode-boot.js (its iPad package P2). Until that commit exists, --allow-inline-boot (clearly an escape,
     for vendoring main f499435) moves the ONE inline script of the head into site/takeoff/js/ui-mode-boot.js itself,
     word for word, loaded by a plain <script src> where it stood (a classic script, so it still runs before the
     stylesheet paints), and adds that file to the app's own service-worker program so it opens offline too. Re-vendor
     P2's commit WITHOUT the flag;
   * site/takeoff/VERSION.json: the commit, the sha256 of every file as published (tests/p8-takeoff-frame.test.mjs checks
     them), and which files differ from the commit and why;
   * it reports what the portal's own code rules would say of the copy (a look-behind regular expression, eval, the old
     portal's names, SharePoint): the copy is exempt from those rules as a whole other program (tests/core-site-guard
     .test.mjs VENDORED), but each is worth knowing - nothing is fixed here, only reported (fix it in takeoff-web).

   The copy replaces site/takeoff/ whole (a file the new commit no longer has goes too), written beside it first so a
   failure leaves the old copy as it was. Nothing is fetched and nothing is pushed. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const OUT = join(ROOT, "site", "takeoff");
export const BOOT_FILE = "js/ui-mode-boot.js";

/** The owner's OneDrive host as the portal's own code names it (js/repo/onedrive.js; the pages' policies carry it). */
export function onedriveHost(src) {
  const m = /export const ONEDRIVE_HOST = "([a-z0-9-]+\.sharepoint\.com)";/.exec(String(src));
  if (!m) throw new Error("js/repo/onedrive.js names no ONEDRIVE_HOST");
  return "https://" + m[1];
}

/** The page policy of the takeoff copy: this site only, and the OneDrive host for a plan opened online (byte ranges).
    style-src keeps 'unsafe-inline': takeoff-web's reports are HTML with a <style> block and style attributes, shown in
    the page and in a print window (js/ui/reports.js, js/ui/report-html.js) - no script can come in that way.
    worker-src blob: for pdf.js's fallback worker; img-src blob: data: for sheet thumbnails and exports. */
export function takeoffCsp(onedrive) {
  if (!/^https:\/\/[a-z0-9-]+\.sharepoint\.com$/.test(String(onedrive))) throw new Error("not the OneDrive host: " + onedrive);
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; " +
    "connect-src 'self' " + onedrive + "; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'";
}

/* ── what ships ─────────────────────────────────────────────────────── */

const EXACT = ["index.html", "sw.js", "manifest.webmanifest"];
/** Folder -> the kinds of file the app ships from it (anything else there is left out, and named). */
const FOLDERS = [
  ["css/", /\.css$/],
  ["js/", /\.m?js$/],
  ["icons/", /\.(png|svg|ico|webp)$/],
  ["data/", /\.json$/],
];
/** pdf.js: what js/core/pdf-import.js loads (build/, cmaps/, standard_fonts/) and its licences (Apache-2.0 asks for the
    licence to travel with the copy; the fonts carry their own). Its viewer, maps and examples, if a later release
    brings them, stay out. */
const PDFJS = [
  /^vendor\/pdfjs\/LICENSE$/,
  /^vendor\/pdfjs\/build\/pdf\.min\.js$/,
  /^vendor\/pdfjs\/build\/pdf\.worker\.min\.js$/,
  /^vendor\/pdfjs\/cmaps\/[A-Za-z0-9_.-]+\.bcmap$/,
  /^vendor\/pdfjs\/cmaps\/LICENSE$/,
  /^vendor\/pdfjs\/standard_fonts\/[A-Za-z0-9_.-]+\.(pfb|ttf|otf)$/,
  /^vendor\/pdfjs\/standard_fonts\/LICENSE_[A-Z]+$/,
];
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/;

/** Whether a path of the commit is shipped: "ship", "skip" (in a shipped folder, but not a kind the app ships: named in
    the report) or "" (not part of the app at all: tests, docs, tools, the repository's own files). */
export function shipped(path) {
  const p = String(path);
  if (!SAFE_PATH.test(p) || p.indexOf("..") !== -1 || p.indexOf("//") !== -1) return "";
  if (EXACT.indexOf(p) !== -1) return "ship";
  for (const [dir, kind] of FOLDERS) if (p.indexOf(dir) === 0) return kind.test(p) ? "ship" : "skip";
  if (p.indexOf("vendor/pdfjs/") === 0) return PDFJS.some((re) => re.test(p)) ? "ship" : "skip";
  return "";
}

/* ── the page ───────────────────────────────────────────────────────── */

/** The same text with every HTML comment blanked out (same length): a <script> written inside a comment is no script. */
function uncommented(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
}

/** The page's <script> elements: {start, end, attrs, body, inline} (indices into the page as written). */
export function scriptsOf(html) {
  const text = uncommented(String(html));
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1];
    // the body as written (the comment-blanked text only finds where it is)
    const body = String(html).slice(m.index + m[0].indexOf(">") + 1, m.index + m[0].lastIndexOf("</"));
    out.push({ start: m.index, end: m.index + m[0].length, attrs, body, inline: !/\ssrc\s*=/i.test(" " + attrs) });
  }
  return out;
}

/** What the page policy would block in the page itself: an inline handler or a javascript: address (never moved
    for the author: those are takeoff-web's to fix). */
export function pageProblems(html) {
  const text = uncommented(String(html)).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (s) => s.replace(/>[\s\S]*<\//, (x) => ">" + " ".repeat(x.length - 3) + "</"));
  const out = [];
  const handler = /<[a-z][^>]*\son[a-z]+\s*=/i.exec(text);
  if (handler) out.push("an inline event handler (" + handler[0].slice(0, 60) + ")");
  if (/javascript:/i.test(text)) out.push("a javascript: address");
  if (/<meta\s+http-equiv\s*=\s*["']?Content-Security-Policy/i.test(text)) out.push("its own security-policy meta tag (the copy's is written here)");
  return out;
}

/**
 * The published page: the policy meta right after <meta charset>, and (allowInlineBoot) the one inline script of the
 * head moved into BOOT_FILE. -> {html, boot: the moved script's text or null}. Throws when an inline script is left
 * (without the flag), when there is more than one, when it is not in the head, or when the page has its own policy.
 */
export function publishPage(html, csp, allowInlineBoot) {
  let page = String(html);
  const problems = pageProblems(page);
  if (problems.length) throw new Error("takeoff-web's index.html has " + problems.join("; ") + " - fix it in takeoff-web, then vendor again");
  const inline = scriptsOf(page).filter((s) => s.inline && s.body.trim() !== "");
  let boot = null;
  if (inline.length) {
    if (!allowInlineBoot) {
      throw new Error("takeoff-web's index.html still has " + inline.length + " inline <script> (the page policy blocks it). Vendor the " +
        "takeoff-web commit that moves it into " + BOOT_FILE + " (its iPad package P2), or - for main f499435 only - run with --allow-inline-boot");
    }
    if (inline.length > 1) throw new Error("--allow-inline-boot moves ONE inline script (the UI-mode boot); this page has " + inline.length);
    const s = inline[0];
    const headEnd = page.search(/<\/head>/i);
    if (headEnd === -1 || s.start > headEnd) throw new Error("--allow-inline-boot moves the head's inline script only");
    if (/\btype\s*=\s*["']?module/i.test(s.attrs)) throw new Error("--allow-inline-boot moves a classic script only");
    boot = s.body;
    page = page.slice(0, s.start) + '<script src="' + BOOT_FILE + '"></script>' + page.slice(s.end);
  }
  const charset = /<meta\s+charset\s*=\s*["']?utf-8["']?\s*\/?>/i.exec(page);
  if (!charset) throw new Error("takeoff-web's index.html has no <meta charset=\"utf-8\"> to put the policy after");
  const nl = /\r\n/.test(page) ? "\r\n" : "\n";
  const at = charset.index + charset[0].length;
  page = page.slice(0, at) + nl + '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' + page.slice(at);
  const first = page.search(/<script\b/i);
  if (first !== -1 && first < page.indexOf("Content-Security-Policy")) throw new Error("a script comes before the policy");
  return { html: page, boot };
}

/** The moved boot script as its own file: the page's words, unchanged, under a note of where they came from. */
export function bootFile(body, commit) {
  return "/* The UI-mode boot of takeoff-web's index.html at " + commit + ", moved out of the page word for word by\n" +
    "   DCR Portal 2's tools/vendor-takeoff.mjs --allow-inline-boot (the portal's page policy allows no inline script).\n" +
    "   takeoff-web's own iPad package (P2) makes this file itself; vendor that commit without the flag. */\n" +
    String(body).replace(/^\r?\n/, "") + (/\n$/.test(body) ? "" : "\n");
}

/** takeoff-web's service worker with the moved boot file in its program (PROGRAM: installed all or nothing), so the
    copy opens offline from a cold start with its boot too. */
export function swWithBoot(src) {
  const s = String(src);
  if (s.indexOf("'" + BOOT_FILE + "'") !== -1) return s;
  const m = /(const PROGRAM = \[[^\]]*?\n(\s*)'index\.html',)/.exec(s);
  if (!m) throw new Error("takeoff-web's sw.js has no PROGRAM list with 'index.html' to add " + BOOT_FILE + " to");
  return s.slice(0, m.index + m[1].length) + "\n" + m[2] + "'" + BOOT_FILE + "',   // moved out of index.html by DCR Portal 2's vendor-takeoff.mjs" +
    s.slice(m.index + m[1].length);
}

/* ── what the portal's own rules would say (a report; the copy is exempt as a whole other program) ── */

const RULES = [
  [/\(\?<[!=]/, "a look-behind regular expression (Safari before 16.4 refuses the whole module)"],
  [/\beval\s*\(|new Function\s*\(/, "eval / new Function (refused by the page policy; pdf.js only tests for it)"],
  [/sharepoint\.com/i, "a SharePoint name (takeoff-web's own link check)"],
  [/dcr_portal_token|["'`]dcr-portal-v\d|\/api\/portal\b/, "an old portal name (copies saved before the move)"],
];

/** [{file, line, what}] of every rule hit in the copy's scripts (the report). */
export function audit(files) {
  const out = [];
  for (const [path, bytes] of files) {
    if (!/\.m?js$/.test(path)) continue;
    const lines = bytes.toString("latin1").split("\n");
    lines.forEach(function (text, i) {
      for (const [re, what] of RULES) if (re.test(text)) out.push({ file: path, line: i + 1, what });
    });
  }
  return out;
}

/* ── git, exactly ───────────────────────────────────────────────────── */

function git(dir, args, input) {
  return execFileSync("git", ["-C", dir, "-c", "core.autocrlf=false", "-c", "core.safecrlf=false"].concat(args),
    { input, maxBuffer: 512 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}

/** A git object id of these bytes (sha1, or sha256 for a sha256 repository). */
export function objectId(bytes, len) {
  return createHash(len === 64 ? "sha256" : "sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The commit's tree: [{mode, type, id, path}] (ls-tree -r -z: names with any character come back whole). */
function treeOf(dir, commit) {
  return git(dir, ["ls-tree", "-r", "-z", "--full-tree", commit]).toString("utf8").split("\0").filter(Boolean).map(function (line) {
    const tab = line.indexOf("\t");
    const [mode, type, id] = line.slice(0, tab).split(" ");
    return { mode, type, id, path: line.slice(tab + 1) };
  });
}

/** The raw bytes of these blobs (cat-file --batch: no filter, no line-ending change), each checked against its id. */
function blobsOf(dir, ids) {
  const out = git(dir, ["cat-file", "--batch"], ids.join("\n") + "\n");
  const got = new Map();
  let at = 0;
  for (const id of ids) {
    const nl = out.indexOf(10, at);
    const head = out.slice(at, nl).toString("utf8").split(" ");
    if (head[0] !== id || head[1] !== "blob") throw new Error("git cat-file: " + head.join(" "));
    const size = Number(head[2]);
    const bytes = out.slice(nl + 1, nl + 1 + size);
    if (objectId(bytes, id.length) !== id) throw new Error("the bytes of " + id + " are not that object");
    got.set(id, bytes);
    at = nl + 1 + size + 1;
  }
  return got;
}

/* ── the run ────────────────────────────────────────────────────────── */

export function vendor(opts) {
  const dir = resolve(opts.dir);
  const commit = git(dir, ["rev-parse", "--verify", String(opts.commit) + "^{commit}"]).toString("utf8").trim();
  const tree = treeOf(dir, commit);
  const skipped = [];
  const take = [];
  for (const e of tree) {
    const kind = shipped(e.path);
    if (!kind) continue;
    if (kind === "skip") { skipped.push(e.path); continue; }
    // a link or another repository inside a shipped folder: not a file the commit holds - never followed
    if (e.type !== "blob" || !/^100(644|755)$/.test(e.mode)) throw new Error(e.path + " is not a plain file in " + commit + " (" + e.mode + " " + e.type + ")");
    take.push(e);
  }
  for (const need of EXACT) if (!take.some((e) => e.path === need)) throw new Error(need + " is not in " + commit);
  if (opts.allowInlineBoot && take.some((e) => e.path === BOOT_FILE)) {
    throw new Error(commit + " already has " + BOOT_FILE + " (takeoff-web moved its boot itself): vendor it without --allow-inline-boot");
  }
  const blobs = blobsOf(dir, take.map((e) => e.id));
  const files = new Map(take.map((e) => [e.path, blobs.get(e.id)]));
  const csp = takeoffCsp(onedriveHost(readFileSync(opts.onedriveSrc || join(ROOT, "site", "js", "repo", "onedrive.js"), "utf8")));
  const edits = {};
  const page = publishPage(files.get("index.html").toString("utf8"), csp, !!opts.allowInlineBoot);
  files.set("index.html", Buffer.from(page.html, "utf8"));
  edits["index.html"] = "the portal's page policy (a meta tag after <meta charset>)" + (page.boot !== null ? "; its inline UI-mode boot moved into " + BOOT_FILE : "");
  if (page.boot !== null) {
    files.set(BOOT_FILE, Buffer.from(bootFile(page.boot, commit), "utf8"));
    edits[BOOT_FILE] = "made here: index.html's inline UI-mode boot, word for word (--allow-inline-boot)";
    files.set("sw.js", Buffer.from(swWithBoot(files.get("sw.js").toString("utf8")), "utf8"));
    edits["sw.js"] = BOOT_FILE + " added to PROGRAM (the moved boot opens offline too)";
  }
  const paths = Array.from(files.keys()).sort();
  const version = { commit, from: "takeoff-web", inlineBootMoved: page.boot !== null, csp, edits,
    files: Object.fromEntries(paths.map((p) => [p, sha256(files.get(p))])) };

  const out = resolve(opts.out || OUT);
  const tmp = out + ".new-" + process.pid;
  rmSync(tmp, { recursive: true, force: true });
  for (const p of paths) {
    const f = join(tmp, p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, files.get(p));
  }
  writeFileSync(join(tmp, "VERSION.json"), JSON.stringify(version, null, 2) + "\n");
  rmSync(out, { recursive: true, force: true });
  renameSync(tmp, out);
  return { commit, out, files: paths.length, bytes: paths.reduce((n, p) => n + files.get(p).length, 0), skipped, edits, findings: audit(files), version };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); if (i === -1) return false; args.splice(i, 1); return true; };
  const value = (n) => { const i = args.indexOf(n); if (i === -1) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const allowInlineBoot = flag("--allow-inline-boot");
  const out = value("--out");
  if (args.length !== 2) {
    console.error("usage: node tools/vendor-takeoff.mjs <takeoff-web checkout> <commit> [--allow-inline-boot] [--out <dir>]");
    process.exit(2);
  }
  if (!existsSync(join(args[0], ".git"))) { console.error(args[0] + " is not a git checkout"); process.exit(2); }
  const r = vendor({ dir: args[0], commit: args[1], allowInlineBoot, out });
  console.log("takeoff-web " + r.commit + " -> " + r.out + ": " + r.files + " files, " + (r.bytes / 1048576).toFixed(1) + " MB");
  if (allowInlineBoot) console.log("ESCAPE USED: --allow-inline-boot moved index.html's inline boot into " + BOOT_FILE + " - re-vendor takeoff-web's P2 commit without it");
  for (const [f, why] of Object.entries(r.edits)) console.log("  changed " + f + ": " + why);
  if (r.skipped.length) console.log("  left out (not a kind the app ships): " + r.skipped.join(", "));
  if (r.findings.length) {
    console.log("What the portal's own code rules would say of the copy (exempt as another program; fix in takeoff-web, not here):");
    for (const x of r.findings) console.log("  " + x.file + ":" + x.line + "  " + x.what);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error("vendor-takeoff: " + (e && e.message)); process.exit(1); }
}
