// The photo files on the phone, read from their source (the photographer screen program, P5, the OneDrive edition; DCR
// Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md §3.3, §3.6, §8.4, §11.3, cited OD): the fourth view in shoots.html (hidden
// until the Ready list answers), shoots.html's connect-src naming exactly the OneDrive host the project pages already
// name (no new identifier), the service worker v8 keeping the modules for a cold start (a marketing phone opens the push
// notice's link), the page reading NO photo files table and never drawing a Realtime payload (OneDrive's own names stay
// in the tables), every OneDrive href through link_ok, [Check again] never pressed by the page itself, the drain, the
// styles (tones, the views wrapping at 375 px, light and dark), the Access tab's Microsoft account and sharing line (no
// share sync: the office shares by hand, OD §8.1), every name a page imports from the photo files modules exported, and
// Home's Ready badge.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsp, ONEDRIVE } from "./core-site-guard.test.mjs";

const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("shoots.html: the fourth view Ready for marketing, hidden until photo_ready_list answers; the views wrap on a phone", () => {
  const h = read("shoots.html");
  assert.match(h, /<button type="button" data-view="ready" aria-pressed="false" hidden>Ready for marketing<\/button>/);
  const css = read("css/shoots.css");
  for (const rule of [".sh-seg { flex-wrap:wrap; }", ".sh-seg button[hidden] { display:none; }", ".sh-fl.ok", ".sh-fl.wait", ".sh-fl.warn", ".sh-fl.problem",
    ".sh-chip.need", ".sh-rtabs", ".sh-rrow", ".rs-ticks", ".mv-reason + .mv-lab { margin-top:14px; }"]) assert.ok(css.includes(rule), rule);
});

test("shoots.html's connect-src (OD §3.3 step 10): exactly the OneDrive host the project pages already name, and the same as repo/onedrive.js's - the upload addresses repo/photo-files.js hands on are on it alone", async () => {
  const csp = parseCsp(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(read("shoots.html"))[1]);
  const project = parseCsp(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(read("project.html"))[1]);
  const hosts = (v) => v.split(" ").filter((x) => /sharepoint\.com/i.test(x));
  assert.deepEqual(hosts(csp["connect-src"]), [ONEDRIVE], "one OneDrive host");
  assert.deepEqual(hosts(csp["connect-src"]), hosts(project["connect-src"]), "the project page's own");
  for (const [d, v] of Object.entries(csp)) if (d !== "connect-src") assert.ok(!/sharepoint/i.test(v), d);
  const { ONEDRIVE_HOST } = await import("../site/js/repo/onedrive.js");
  const R = await import("../site/js/repo/photo-files.js");
  assert.equal("https://" + ONEDRIVE_HOST, ONEDRIVE);
  assert.equal(R.uploadUrlOk("https://" + ONEDRIVE_HOST + "/personal/x/_api/v2.0/drives/d/items/i/uploadSession?guid=1"), true);
  assert.equal(R.uploadUrlOk("https://example-my.sharepoint.com/personal/x/uploadSession?guid=1"), false, "another host: never used");
});

test("the service worker v8 (and v9 after it): the Files section's and the Ready view's modules are kept, so ?ready=<id> opens from a cold start", () => {
  const sw = read("sw.js");
  assert.match(sw, /^const CACHE = "dcr-portal2-v9";$/m);          // v9: the job's place and the files icon keep them
  assert.match(sw, /v8 \(the photo files in the Office OneDrive/);
  const shell = JSON.parse("[" + /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1].replace(/\/\/[^\n]*/g, "").replace(/,\s*$/, "") + "]");
  for (const f of ["js/pages/shoots-files.js", "js/repo/photo-files.js", "js/map/photo-files.js", "js/map/photo-words.js", "js/scrub-money.js", "js/money-mask.js",
    "js/repo/onedrive.js", "js/map/access.js"]) {
    assert.ok(shell.includes(f), f);
  }
  // every module the shoot page and the Access tab import (statically) is in the list
  for (const page of ["js/pages/shoots.js", "js/pages/shoots-files.js", "js/repo/photo-files.js", "js/map/photo-files.js", "js/map/access.js", "js/pages/admin.js",
    "js/photo-send.js"]) {
    const src = read(page);
    for (const m of src.matchAll(/^import [^;]*? from "(\.\.?\/[^"]+)";/gm)) {
      const abs = new URL(m[1], new URL("../site/" + page, import.meta.url)).pathname.replace(/^.*\/site\//, "");
      assert.ok(shell.includes(abs), page + " imports " + abs);
    }
  }
});

test("every name a page imports from the photo files modules is one they export (a name gone from them would stop the page loading)", async () => {
  const mods = { "../repo/photo-files.js": await import("../site/js/repo/photo-files.js"), "../map/photo-files.js": await import("../site/js/map/photo-files.js"),
    "../map/access.js": await import("../site/js/map/access.js"), "./photo-files.js": await import("../site/js/map/photo-files.js") };
  const pages = ["js/pages/shoots.js", "js/pages/shoots-files.js", "js/pages/admin.js", "js/shell/dashboard.js", "js/map/access.js"];
  let seen = 0;
  for (const page of pages) {
    const src = read(page);
    for (const m of src.matchAll(/^import \{([^}]*)\} from "([^"]+)";/gm)) {
      if (!mods[m[2]]) continue;
      for (const part of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
        const name = part.split(/\s+as\s+/)[0].trim();
        assert.ok(Object.prototype.hasOwnProperty.call(mods[m[2]], name), page + " imports " + name + " from " + m[2]);
        seen += 1;
      }
    }
  }
  assert.ok(seen > 20, "the imports are read");
});

test("shoots.js and its parts read no photo files table but the folders' rollup (its counts only) and what the Ready list holds, and never draw a Realtime payload; OneDrive hrefs pass link_ok; the check is a person's press", () => {
  const page = code(read("js/pages/shoots.js"));
  const parts = code(read("js/pages/shoots-files.js"));
  const repo = code(read("js/repo/photo-files.js"));
  // the table reads (DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.6, the files icon): photo_drive_folders' rollup by its
  // explicit columns - files_state, the counts and drive_state, never a OneDrive name, path or link - live shoot folders
  // only; and, for a folder with a problem, what app.photo_help_held_by_list reads (step 1's review, round 3): the shoots'
  // Ready list rows (shoot, state, ready_at) and the folders' sealed hand-ins (folder, state, sealed_at)
  const READ = 'c.from("photo_drive_folders").select(FOLDER_COLUMNS.join(", ")).eq("kind", "shoot").is("retired_at", null)';
  const LIST = 'c.from("photo_marketing").select(LISTED_COLUMNS.join(", ")).in("shoot_id", ';
  const SEALED = 'c.from("photo_shoot_uploads").select(SEALED_COLUMNS.join(", ")).in("folder_id", ';
  assert.equal(Array.from(repo.matchAll(/(?<!Array)\.from\(/g)).length, 3, "three table reads in repo/photo-files.js");
  for (const r of [READ, LIST, SEALED]) assert.ok(repo.includes(r), r);
  assert.match(repo, /export const FOLDER_COLUMNS = Object\.freeze\(\["id", "shoot_id", "files_state", "files_counted", "files_confirmed", "files_waiting", "files_problem", "photos", "videos",\s+"files_rev", "drive_state"\]\);/);
  assert.match(repo, /export const LISTED_COLUMNS = Object\.freeze\(\["id", "shoot_id", "state", "ready_at", "version"\]\);/);
  assert.match(repo, /export const SEALED_COLUMNS = Object\.freeze\(\["id", "folder_id", "state", "sealed_at"\]\);/);
  for (const s of [page, parts, repo.replace(READ, "").replace(LIST, "").replace(SEALED, "")]) {
    assert.ok(!/(?<!Array)\.from\(/.test(s), "no other table read");
    // (photo_shoot_files_page is the RPC the phone's pick reads - its paths scrubbed, never an item id - not the table)
    assert.ok(!/photo_drive_folders"\)|photo_shoot_files(?!_page)|drive_path|drive_name|drive_link/.test(s.replace(/TABLES = Object\.freeze\(\[[^\]]*\]\)/, "")
      .replace(/ \(drive_name, drive_path, drive_link, name\)/, "")), "no OneDrive name read");
  }
  // a Realtime event: only its type, id and ready_at reach code (the drain's memory) - nothing of it is drawn
  assert.ok(!/evt\.new|\.new\./.test(page + parts), "the page never touches a payload");
  assert.match(repo, /if \(t === "photo_marketing" && opt\.drainer\) opt\.drainer\.event\(evt\);/);
  assert.match(repo, /const row = evt\.new \|\| \{\};[\s\S]{0,200}row\.ready_at/);
  // every OneDrive link the phone shows comes through map/photo-files.js linkOk (filesView.open, readyView.link)
  const map = code(read("js/map/photo-files.js"));
  assert.match(map, /const open = can\.open_folder && folder && linkOk\(folder\.link\) \? folder\.link : null;/);
  assert.match(map, /const link = pick\.buttons\.indexOf\("btn_open"\) !== -1 && linkOk\(it\.link\) \? it\.link : null;/);
  assert.match(parts, /href="' \+ esc\(v\.open\) \+ '" target="_blank" rel="noopener noreferrer"/);
  assert.match(parts, /href="' \+ esc\(v\.link\) \+ '" target="_blank" rel="noopener noreferrer"/);
  // photo-files check: only from the button (never a timer, never on open); no Use what's in Drive (OD §15)
  const checks = Array.from(page.matchAll(/files\.check\(/g)).length;
  assert.equal(checks, 1, "checkNow alone");
  assert.match(page, /if \(act === "files-check"\) \{ if \(state\.sel\) checkNow\(state\.sel\); return; \}/);
  assert.ok(!/setInterval\([^)]*check/.test(page));
  assert.ok(!/use_drive|useDrive|files-use-drive/.test(page + parts), "no Use what's in Drive");
  // every text of the parts is escaped
  for (const m of parts.matchAll(/'>' \+ ([a-zA-Z.()[\]]+) \+/g)) assert.match(m[1], /^esc\(/, m[1]);
  // the upload address is never kept (OD §3.6): no storage, no log in the repo
  assert.ok(!/localStorage|sessionStorage|indexedDB|console\./.test(repo), "repo/photo-files.js keeps nothing");
});

test("the phone's hand-in on the shoot sheet (OD §3.3, the build plan's P5): js/photo-send.js made once, on a status that needs it; the picker the page's own input outside the redrawn sheet (photos and videos, HEIC named: photo-send.js ACCEPT); every phone act through the module - never an upload address in the page - and the Files section's buttons Add photos and videos, Hand in what's there, Cancel it (no Stop), Pick the rest again / Pick them again, Hand in without them, as the cases name them", () => {
  const page = code(read("js/pages/shoots.js"));
  const parts = code(read("js/pages/shoots-files.js"));
  assert.match(page, /import \{ createPhoneSend, ACCEPT as PICK_ACCEPT \} from "\.\.\/photo-send\.js";/);
  assert.equal(Array.from(page.matchAll(/createPhoneSend\(/g)).length, 1, "one module for the page");
  assert.match(page, /n\.setAttribute\("accept", PICK_ACCEPT\);/);
  assert.match(page, /document\.body\.appendChild\(n\);/, "the picker outside #shDScroll: a redraw never loses the pick");
  assert.ok(!/upload_url|uploadUrl|files\.(sessions|done|find|begin|record|seal|cancel|beat)\(/.test(page + parts),
    "the page never holds an upload address nor calls the hand-in's RPCs or the function's send ops itself");
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(parts), "the parts keep nothing");
  for (const [code, act] of [["add_phone", "files-add-phone"], ["pick_rest", "files-pick-rest"], ["pick_them_again", "files-pick-rest"], ["hand_in_there", "files-hand-in"],
    ["cancel_copy", "files-cancel"], ["hand_in_without", "files-hand-in-without"]]) {
    assert.ok(parts.includes(code + ': "' + act + '"'), code);
    assert.ok(page.includes('act === "' + act + '"'), act);
  }
  assert.ok(!/files_buttons\.stop\b|"stop"/.test(parts), "no separate Stop (locking the phone is the pause)");
  // Hand in what's there and Cancel it ask first (OD §3.3 step 8; the OneDrive review's round 1), in the page's own sheet
  // with Keep it focused - never a press that ends the hand-in at once
  assert.match(page, /if \(act === "files-hand-in"\) \{ if \(state\.sel\) phoneAsk\(state\.sel, "hand_in"\); return; \}/);
  assert.match(page, /if \(act === "files-cancel"\) \{ if \(state\.sel\) phoneAsk\(state\.sel, "cancel"\); return; \}/);
  assert.match(page, /keep: FW\.copy\.cancel_keep, cls: cancel \? "warn" : "ok",/);
  assert.match(page, /function phoneAsk\(id, what\) \{[\s\S]*?first: '#shMo \.sh-mo-ft \[data-act="mv-close"\]' \}\);\n\}/, "Keep it has the focus");
  const css = read("css/shoots.css");
  for (const rule of [".sh-fprog {", ".sh-fbar {", ".sh-pick {"]) assert.ok(css.includes(rule), rule);
});

test("the Ready card draws its open tip under the buttons (ready.open_tip, OD §8.4; the OneDrive review's round 1: worked out, never drawn)", async () => {
  const parts = code(read("js/pages/shoots-files.js"));
  assert.match(parts, /if \(v\.tip\) out\.push\('<p class="sh-rtip" data-tip="open_tip">' \+ esc\(v\.tip\) \+ "<\/p>"\);/);
  assert.ok(read("css/shoots.css").includes(".sh-rtip {"));
  const { readyCardHtml } = await import("../site/js/pages/shoots-files.js");
  const { WORDS } = await import("../site/js/map/photo-words.js");
  const item = { id: 4, state: "ready", shoot_id: 51, shoot_name: "Delivery day", job_label: "A267 Sample Street", shoot_day: "2026-11-12", by: "Lou",
    files: { photos: 2, videos: 0, other: 0, bytes: 1000 }, folder: { drive_state: "found" }, can: { open: true },
    link: "https://example-my.sharepoint.com/personal/office_example_com/Documents/DCR%20Photo%20%26%20Video/x" };
  const html = readyCardHtml(item, { can_act: true }, { today: "2026-11-12" });
  const tip = /<p class="sh-rtip" data-tip="open_tip">([^<]*)<\/p>/.exec(html);
  assert.ok(tip, html);
  const unesc = (t) => t.replace(/&#39;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  assert.equal(unesc(tip[1]), WORDS.ready.open_tip);
  assert.ok(html.indexOf('class="sh-rtip"') > html.indexOf('class="sh-acts"'), "under the buttons");
  assert.ok(!readyCardHtml(Object.assign({}, item, { can: { open: false } }), { can_act: true }, { today: "2026-11-12" }).includes("sh-rtip"), "no Open in OneDrive: no tip");
});

test("the drain and the polls: a Ready row's arrival drains once per (id, ready_at); the Ready view every 60 s, an open shoot's files while it uploads", () => {
  const page = code(read("js/pages/shoots.js"));
  assert.match(page, /state\.stopFiles = await files\.watchFiles\(onFilesWatch, \{ drainer: state\.drainer \}\)/);
  assert.match(page, /state\.drainer\.saw\(it\.id, it\.ready_at\)/, "the ready_at seen per row, from every list read");
  assert.match(page, /const READY_POLL_MS = 60000;/);
  assert.match(page, /const UPLOAD_POLL_MS = 60000;/);
  assert.match(page, /const DONE_POLL_MS = 3 \* 60000;/);
});

test("the Access tab (OD §8.2, §8.4): the Microsoft account field's label and tip are the contract's, each marketing member's sharing line comes from photo_drive_overview (read with the team, never in the way of it), and nothing shares by itself", () => {
  const admin = code(read("js/pages/admin.js"));
  assert.ok(!/shareSync|share_sync|sharesChange/.test(admin), "no share sync: the office shares by hand (OD §8.1)");
  assert.match(admin, /import \{ overview as filesOverview \} from "\.\.\/repo\/photo-files\.js";/);
  assert.match(admin, /Promise\.all\(\[photo\.team\(\), filesOverview\(\)\.catch\(function \(\) \{ return null; \}\)\]\)/, "a failed overview never stops the team");
  assert.match(admin, /const share = shareLine\(x, state\.photo\.share, companyToday\(\)\);/);
  assert.match(admin, /placeholder="' \+ esc\(ACCOUNT_LABEL\) \+ '"/);
  assert.match(admin, /title="' \+ esc\(ACCOUNT_TIP\) \+ '"/);
  assert.match(admin, /<span>' \+ esc\(ACCOUNT_LABEL\) \+ "<\/span><\/div>"/, "the column's head");
  // a phone (the column's head hidden, the placeholder cut at 375 px - "Microsoft account (if not their DCR e-ma"; the final
  // screenshots): the field's label shows whole above it, a label for the field (its aria-label, with the person's name,
  // starts with the same words)
  assert.match(admin, /'<div class="ad-ph-mail"><label class="ad-ph-lab" for="adPhMail' \+ esc\(x\.id\) \+ '">' \+ esc\(ACCOUNT_LABEL\) \+ "<\/label>" \+\s*'<input type="email" id="adPhMail' \+ esc\(x\.id\) \+ '" data-ph="googleEmail"/);
  const css = read("admin.html");
  assert.match(css, /\n {6}\.ad-ph-lab \{ display: none; \}/, "the desk: the column's head says it");
  const narrow = /@media \(max-width: 900px\) \{([\s\S]*?)\n {6}\}/.exec(css);
  assert.ok(narrow && /\.ad-ph-head \{ display: none; \}/.test(narrow[1]) && /\.ad-ph-lab \{ display: block;/.test(narrow[1]), "shown where the head is hidden");
  assert.ok(!/Google/.test(read("js/pages/admin.js")), "no Google word left on the page");
  assert.match(admin, /marketingOffAsk\(x\.name\)/);
});

test("Home: marketing's badge is the Ready list (ready.home_badge), linking to shoots.html?view=ready", () => {
  const dash = code(read("js/shell/dashboard.js"));
  assert.match(dash, /if \(a\.marketing\) \{[\s\S]*?import\("\.\.\/repo\/photo-files\.js"\)[\s\S]*?filesMap\.homeBadge\(list\.counts\)/);
  assert.match(dash, /b && b\.ready \? "shoots\.html\?view=ready"/);
});
