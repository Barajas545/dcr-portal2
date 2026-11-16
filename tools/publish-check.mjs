#!/usr/bin/env node
/* DCR Portal 2 — what pushing a branch to main would publish, read for a numbered street address, a OneDrive drive id,
   a personal-site path, a OneDrive host, a tenant or client id, a OneDrive item id, an e-mail address or a client
   secret before it goes.

   This repository is PUBLIC and pushing `main` publishes every commit on the way: GitHub keeps each one (forks and
   caches too, after any later rewrite), so a value a later commit replaced is still published by the commit that added
   it. A branch whose own commits once held a real-looking address goes out as ONE squashed commit on its base (DCR
   Desktop 2 docs/PHOTO-FILES.md §14 step 7: the photo files' P5b on 6f40d5f), and this check reads what would be
   pushed first. It holds no value to look for - only the shape of one - so nothing it looks for is ever written into
   this repository:
     * a numbered street (a house number and a street: STREET, the photo files tests' own scan);
     * a OneDrive drive id (Graph's "b!" and its letters: DRIVE_ID), unless plainly made up (all zeros, or FAKE...);
     * a personal-site path that names an account ("/personal/<user>_<domain>_<tld>": PERSONAL), unless the account is
       a made-up one (its domain example.com, .test, .org or .net: office_example_com);
     * a OneDrive host ("<tenant>-my.sharepoint.com": HOST) other than the made-up example-my.sharepoint.com and the
       one host already published - the base's own site/js/repo/onedrive.js ONEDRIVE_HOST (read from the base, never
       written here);
     * a tenant or client id (a GUID: GUID), unless plainly made up (a group of all zeros, or one digit throughout but
       its version and variant: 11111111-1111-4111-8111-111111111111);
     * a OneDrive item id ("01" and 32 base-32 letters: ITEM_ID), unless FAKE...;
     * an e-mail address (EMAIL) but a made-up one (at example.com, .org or .net, or a .test domain) or one of the
       public ones a commit or a screen names (PUBLIC_EMAILS: the commits' Co-Authored-By trailer, the e-mail field's
       format hint) - so any other address, a DCR Framing one too, is refused;
     * a client secret of the shape Entra gives (three characters, a digit and "Q~", then 31 or more: SECRET).
     DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md §0.4 ("no tenant id, drive or item id, personal-site path, real e-mail,
     secret or client data; its publish check scans for them"), §10.4, §11.3 (the photo files on the Office OneDrive:
     made-up values only; OneDrive review round 1).

     node tools/publish-check.mjs [<branch>] [--base <ref>]
         every commit of <base>..<branch> as pushed one by one: the lines each one adds, its file names and its message
         (a value added by one commit and removed by a later one is still published - by the commit that added it)
     node tools/publish-check.mjs --squash [<branch>] [--base <ref>]
         ONE squashed commit of <base>..<branch> (git merge --squash): the tree's change, its file names, and every
         message of the range (a squash's message keeps them all)
     --repo <dir>   the repository to read (default: this one)

   <branch> defaults to HEAD, <base> to origin/main. Exit 0: nothing found (or nothing to publish); 1: found - each
   commit, file and line said, and which later commit removes it; 2: the base is not an ancestor of the branch, or git
   could not answer. Read-only: no ref, object or setting is written. Binary files are not read (their names are).
   Development only (tools/ is not part of the site). */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** A numbered street of a real-looking address: a house number (100 and up; "0000" is plainly made up) and a street.
    DCR Desktop 2's own scan (tests/test_v229_photo_review4.py STREET, the review's round 4 sync, §36). */
export const STREET = /\b[1-9][0-9]{2,5} [A-Z][a-z]+( [A-Z][a-z]+)? (Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Court|Ct|Canyon|Place|Terrace|Highway|Parkway)\b/;
/** A OneDrive (for Business) drive id as Graph writes one: "b!" and at least 16 of its letters (a real one has about 64). */
export const DRIVE_ID = /(?<![A-Za-z0-9_!-])b![A-Za-z0-9_-]{16,}/;
/** A personal-site path; its account is the part after /personal/ (a real one: user_domain_tld). */
export const PERSONAL = /\/personal\/([A-Za-z0-9._%-]*)/i;
/** A OneDrive host: "<tenant>-my.sharepoint.com". */
export const HOST = /(?<![A-Za-z0-9-])[A-Za-z0-9][A-Za-z0-9-]*-my\.sharepoint\.com(?![A-Za-z0-9-])/i;
/** The made-up OneDrive host of the cases, the fakes and the tests (OD §0.4). */
export const EXAMPLE_HOST = "example-my.sharepoint.com";
/** Where the one host already published is named (and project.html's security policy): read from the base. */
export const HOST_FILE = "site/js/repo/onedrive.js";
/** A GUID (an Entra tenant id, an app's client id): 8-4-4-4-12 hex digits. */
export const GUID = /(?<![0-9A-Fa-f-])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(?![0-9A-Fa-f-])/;
/** A OneDrive for Business item id as Graph writes one: "01" and 32 base-32 letters (A-Z, 2-7). */
export const ITEM_ID = /(?<![A-Za-z0-9])01[A-Z2-7]{32}(?![A-Za-z0-9])/;
/** An e-mail address. */
export const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/;
/** A client secret of the shape Entra ID gives one (e.g. "Abc8Q~" and about 34 more characters). */
export const SECRET = /(?<![A-Za-z0-9_~.-])[A-Za-z0-9_~.-]{3}[0-9]Q~[A-Za-z0-9_~.-]{31,}/;
/** The public e-mail addresses a commit or a screen may name: the Co-Authored-By trailer of the commits and the site's
    e-mail format hint (access.js PHOTO_BAD_EMAIL). Lower case. */
export const PUBLIC_EMAILS = Object.freeze(["noreply@anthropic.com", "name@company.com"]);

const KINDS = { street: "a numbered street", drive_id: "a drive id", personal_path: "a personal-site path", host: "a OneDrive host",
  guid: "a tenant or client id (a GUID)", item_id: "a OneDrive item id", email: "an e-mail address", secret: "a client secret" };
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const all = (re) => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
const STREETS = all(STREET), DRIVE_IDS = all(DRIVE_ID), PERSONALS = all(PERSONAL), HOSTS = all(HOST);
const GUIDS = all(GUID), ITEM_IDS = all(ITEM_ID), EMAILS = all(EMAIL), SECRETS = all(SECRET);

/** A drive id plainly made up: all zeros after "b!", or FAKE... */
export function madeUpDriveId(id) {
  const body = String(id).slice(2);
  return /^0+$/.test(body) || /^fake/i.test(body);
}
/** A personal-site path's account plainly made up: none named (no "_": "/personal/x", "/personal//"), or a made-up domain. */
export function madeUpAccount(account) {
  const a = String(account || "");
  return a.indexOf("_") === -1 || /(^|_)example_(com|test|org|net)$/i.test(a);
}

/** A GUID plainly made up: a group of all zeros (00000000-0000-4000-8000-000000000161), or one digit throughout but its
    version and variant digits (11111111-1111-4111-8111-111111111111). */
export function madeUpGuid(g) {
  const parts = String(g).split("-");
  if (parts.some((p) => /^0+$/.test(p))) return true;
  const hex = parts.join("").toLowerCase();
  const rest = hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17);
  return rest.length === 30 && /^(.)\1*$/.test(rest);
}
/** An item id plainly made up: 01FAKE... */
export function madeUpItemId(id) { return /^01FAKE/.test(String(id)); }
/** An e-mail address plainly made up (example.com / .org / .net or a subdomain of one; a .test domain) or public
    (PUBLIC_EMAILS). */
export function madeUpEmail(address) {
  const a = String(address || "").toLowerCase();
  const domain = a.slice(a.lastIndexOf("@") + 1);
  return PUBLIC_EMAILS.indexOf(a) !== -1 || /(^|\.)example\.(com|org|net)$/.test(domain) || /(^|\.)test$/.test(domain);
}

/** Every value of the eight kinds in `text` that is not allowed: [{kind, text}]. allow.hosts: the hosts beside the
    example one that may appear (lower case; the one already published). */
export function find(text, allow) {
  const s = String(text || "");
  const hosts = new Set([EXAMPLE_HOST, ...((allow && allow.hosts) || [])].map((h) => String(h).toLowerCase()));
  const out = [];
  for (const m of s.matchAll(STREETS)) out.push({ kind: "street", text: m[0] });
  for (const m of s.matchAll(DRIVE_IDS)) if (!madeUpDriveId(m[0])) out.push({ kind: "drive_id", text: m[0] });
  for (const m of s.matchAll(PERSONALS)) if (!madeUpAccount(m[1])) out.push({ kind: "personal_path", text: m[0] });
  for (const m of s.matchAll(HOSTS)) if (!hosts.has(m[0].toLowerCase())) out.push({ kind: "host", text: m[0] });
  for (const m of s.matchAll(GUIDS)) if (!madeUpGuid(m[0])) out.push({ kind: "guid", text: m[0] });
  for (const m of s.matchAll(ITEM_IDS)) if (!madeUpItemId(m[0])) out.push({ kind: "item_id", text: m[0] });
  for (const m of s.matchAll(EMAILS)) if (!madeUpEmail(m[0])) out.push({ kind: "email", text: m[0] });
  for (const m of s.matchAll(SECRETS)) out.push({ kind: "secret", text: m[0] });
  return out;
}

class CheckError extends Error {}

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, "-c", "core.quotepath=false", ...args], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const why = String((e && e.stderr) || (e && e.message) || "").trim().split(/\r?\n/)[0];
    throw new CheckError("git " + args[0] + " failed: " + why);
  }
}
const ok = (repo, args) => { try { git(repo, args); return true; } catch (e) { return false; } };
const short = (sha) => String(sha).slice(0, 7);

/** The one OneDrive host already published: the base's own HOST_FILE names it as ONEDRIVE_HOST (none when the base has
    no such file or line). Lower case. */
export function publishedHosts(repo, base) {
  let text = "";
  try { text = git(repo, ["show", base + ":" + HOST_FILE]); } catch (e) { return []; }
  const m = /\bONEDRIVE_HOST\s*=\s*"([A-Za-z0-9][A-Za-z0-9-]*-my\.sharepoint\.com)"/.exec(text);
  return m ? [m[1].toLowerCase()] : [];
}

/** The lines a diff adds and removes, by file: [{path, added: [{n, text}], removed: [text]}] (paths of both sides read too). */
export function readDiff(patch) {
  const files = [];
  let cur = null, n = 0;
  for (const line of String(patch || "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = { path: line.replace(/^diff --git a\/(.*) b\/(.*)$/, "$2"), names: [line.slice(11)], added: [], removed: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const p = line.slice(4);
      if (p !== "/dev/null") cur.names.push(p);
      if (line.startsWith("+++ b/")) cur.path = line.slice(6);
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) { n = Number(h[1]); continue; }
    if (line.startsWith("+")) { cur.added.push({ n, text: line.slice(1) }); n += 1; }
    else if (line.startsWith("-")) cur.removed.push(line.slice(1));
    else if (/^(Binary files|rename |similarity |new file|deleted file|old mode|new mode|index )/.test(line)) cur.names.push(line);
  }
  return files;
}

const DIFF = ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"];

/** What publishing <base>..<branch> would put in the public repository, read for the eight kinds.
    o: {repo, base, branch, squash}. -> {base, branch, commits, hosts, findings: [{commit, path, n, kind, text, where,
    lines, removedBy, carried}]} - where: "line" | "name" | "message"; kind: "street" | "drive_id" | "personal_path" |
    "host" | "guid" | "item_id" | "email" | "secret"; hosts: the one already published (allowed). */
export function check(o) {
  const repo = o.repo || ".";
  const branch = o.branch || "HEAD";
  const base = o.base || "origin/main";
  if (!ok(repo, ["rev-parse", "--verify", "--quiet", base + "^{commit}"])) throw new CheckError("the base " + base + " is not a commit here (git fetch first?)");
  if (!ok(repo, ["rev-parse", "--verify", "--quiet", branch + "^{commit}"])) throw new CheckError("the branch " + branch + " is not a commit here");
  if (!ok(repo, ["merge-base", "--is-ancestor", base, branch])) throw new CheckError(base + " is not an ancestor of " + branch + ": the range would not be what is pushed");
  const hosts = publishedHosts(repo, base);
  const hits = (text) => find(text, { hosts });
  const commits = git(repo, ["rev-list", "--reverse", "--topo-order", base + ".." + branch]).split("\n").filter(Boolean);
  const findings = [];
  const add = (f) => findings.push(Object.assign({ commit: null, path: null, n: null, lines: 1, removedBy: null, carried: 0 }, f));
  const id = (h) => h.kind + " " + h.text;
  if (o.squash) {
    if (commits.length) {
      for (const file of readDiff(git(repo, [...DIFF, base, branch]))) {
        const named = new Map();
        for (const h of file.names.flatMap(hits)) named.set(id(h), h);
        for (const h of named.values()) add({ path: file.path, kind: h.kind, text: h.text, where: "name" });
        const got = new Map();
        for (const a of file.added) {
          for (const h of hits(a.text)) {
            if (got.has(id(h))) { got.get(id(h)).lines += 1; continue; }
            add({ path: file.path, n: a.n, kind: h.kind, text: h.text, where: "line" });
            got.set(id(h), findings[findings.length - 1]);
          }
        }
      }
      for (const c of commits) for (const h of hits(git(repo, ["log", "-1", "--format=%B", c]))) add({ commit: c, kind: h.kind, text: h.text, where: "message" });
    }
    return { base, branch, commits, hosts, findings, squash: true };
  }
  // one by one: each commit against each of its parents (a merge's own lines too); what it adds is published by it
  const open = [];
  commits.forEach((c, i) => {
    const parents = git(repo, ["rev-list", "--parents", "-n", "1", c]).trim().split(/\s+/).slice(1);
    for (const h of hits(git(repo, ["log", "-1", "--format=%B", c]))) add({ commit: c, kind: h.kind, text: h.text, where: "message" });
    const seen = new Set();
    for (const p of parents.length ? parents : [EMPTY_TREE]) {
      for (const file of readDiff(git(repo, [...DIFF, p, c]))) {
        for (const h of file.names.flatMap(hits)) {
          const key = "name " + file.path + " " + id(h);
          if (!seen.has(key)) { seen.add(key); add({ commit: c, path: file.path, kind: h.kind, text: h.text, where: "name" }); }
        }
        for (const a of file.added) {
          for (const h of hits(a.text)) {
            const key = "line " + file.path + " " + id(h);
            if (seen.has(key)) {
              const was = findings.find((x) => x.commit === c && x.where === "line" && x.path === file.path && x.kind === h.kind && x.text === h.text);
              if (was) was.lines += 1;
              continue;
            }
            seen.add(key);
            add({ commit: c, path: file.path, n: a.n, kind: h.kind, text: h.text, where: "line" });
            open.push({ f: findings[findings.length - 1], at: i });
          }
        }
        // a later commit that removes it: said, and how many commits carried it until then
        for (const r of file.removed) {
          for (const h of hits(r)) {
            for (const x of open) {
              if (!x.f.removedBy && x.at < i && x.f.path === file.path && x.f.kind === h.kind && x.f.text === h.text) { x.f.removedBy = c; x.f.carried = i - x.at; }
            }
          }
        }
      }
    }
  });
  for (const x of open) if (!x.f.removedBy) x.f.carried = commits.length - x.at;
  return { base, branch, commits, hosts, findings, squash: false };
}

/** What the check looks for, in words (the report's clean line). */
export const LOOKS_FOR = "no numbered street, drive id, personal-site path, OneDrive host, tenant or client id, item id, e-mail address or client secret";

/** The report in words (the terminal's: it names what it found, never into a file of this repository). */
export function report(r) {
  const out = [];
  const range = r.base + ".." + r.branch;
  out.push("publish-check: " + (r.squash ? "one squashed commit of " + r.commits.length + " commit" + (r.commits.length === 1 ? "" : "s") + " in " + range
    : r.commits.length + " commit" + (r.commits.length === 1 ? "" : "s") + " in " + range + ", as pushed one by one"));
  if (!r.commits.length) { out.push("nothing to publish"); return out.join("\n"); }
  for (const f of r.findings) {
    const who = f.commit ? short(f.commit) + " " : "";
    const what = KINDS[f.kind] || KINDS.street;
    if (f.where === "message") out.push("  " + who + "its message: " + what + " (" + f.text + ")");
    else if (f.where === "name") out.push("  " + who + f.path + ": a file name with " + what + " (" + f.text + ")");
    else {
      const tail = r.squash ? "" : f.removedBy ? " - removed by " + short(f.removedBy) + ", so " + f.carried + " commit" + (f.carried === 1 ? "" : "s") + " carry it"
        : " - still at the tip (" + f.carried + " commit" + (f.carried === 1 ? "" : "s") + " carry it)";
      out.push("  " + who + f.path + ":" + f.n + ": adds " + what + " (" + f.text + (f.lines > 1 ? ", " + f.lines + " lines" : "") + ")" + tail);
    }
  }
  if (r.findings.length) {
    out.push("FOUND " + r.findings.length + ": pushing this publishes it" + (r.squash ? " - take it out of the tree first"
      : " - publish the branch as ONE squashed commit on its base instead (git merge --squash), then run this with --squash"));
  } else out.push("clean: " + LOOKS_FOR + " in " + (r.squash ? "the squashed commit" : "any of them"));
  return out.join("\n");
}

function main(argv) {
  const o = { repo: fileURLToPath(new URL("../", import.meta.url)), squash: false };
  const rest = [];
  let bad = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--squash") o.squash = true;
    else if (argv[i] === "--base" || argv[i] === "--repo") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) bad = true;
      else o[argv[i - 1].slice(2)] = v;
    } else if (argv[i].startsWith("--")) bad = true;
    else rest.push(argv[i]);
  }
  if (bad || rest.length > 1) { console.error("usage: node tools/publish-check.mjs [--squash] [--base <ref>] [--repo <dir>] [<branch>]"); return 2; }
  if (rest.length) o.branch = rest[0];
  let r;
  try { r = check(o); } catch (e) {
    if (e instanceof CheckError) { console.error("publish-check: " + e.message); return 2; }
    throw e;
  }
  console.log(report(r));
  return r.findings.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
