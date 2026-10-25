// Part 4: the Files tab's OneDrive rules (site/js/map/onedrive.js) - the broker's own (DCR Desktop 2
// supabase/functions/onedrive/paths.ts) repeated so a person reads the reason before a byte is sent: names, paths,
// what is hidden from whom, the upload allowlist, where an upload may go, the files table's shape, the merge with the
// project's file list, and the upload session's arithmetic. Made-up names only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as OD from "../site/js/map/onedrive.js";

const STEMS = JSON.parse(readFileSync(new URL("./vectors/onedrive-stems.json", import.meta.url), "utf8")).stems;
const NONE = { prices: false, financials: false }, PRICES = { prices: true, financials: false }, ALL = { prices: true, financials: true };

test("stems: the shared answers of app.onedrive_stem / paths.ts stemOf (D9's word stems, NFKC, where a word starts)", () => {
  assert.ok(STEMS.length >= 40);
  for (const c of STEMS) assert.equal(OD.stemOf(c.in), c.stem, JSON.stringify(c.in) + (c.why ? " (" + c.why + ")" : ""));
});

test("stems: both groups read apart (paths.ts stems) - a name about prices AND money is a money name too", () => {
  for (const c of STEMS) {
    const s = OD.stems(c.in);
    assert.equal(s.priced, c.stem === "priced", "priced " + JSON.stringify(c.in));
    assert.equal(s.money, c.stem === "money" || c.money === true, "money " + JSON.stringify(c.in));
  }
  assert.ok(STEMS.filter((c) => c.money === true).length >= 4, "the mixed names are in the shared cases");
  assert.ok(STEMS.some((c) => c.in === "A253Estimate.pdf" && c.stem === "priced"), "a stem right after a number");
});

test("segments: what Windows, OneDrive or a look-alike could read as something else is refused", () => {
  for (const ok of ["Floor Plans", "Level 1", "A1 - Floor plan.pdf", "Planos ñ.pdf", "x"]) assert.equal(OD.segmentProblem(ok), null, ok);
  const bad = {
    "": "an empty name", "a/b": "a character that cannot be in a file name", "a\\b": "a character that cannot be in a file name",
    "a:b": "a character that cannot be in a file name", "..": "a name that means another folder", ".": "a name that means another folder",
    " x": "a name that starts with a space", "x ": "a name that ends with a space or a dot", "x.": "a name that ends with a space or a dot",
    "con": "a name Windows keeps for itself", "LPT1.txt": "a name Windows keeps for itself", "COM¹": "a name Windows keeps for itself",
    "a‮bcd": "a character that cannot be in a file name", "a​b": "a character that cannot be in a file name",
    "a∕b": "a character that looks like a path separator", "．．": "a character that looks like a path separator",
    "x\ud800": "a broken character", "\udc00x": "a broken character",
  };
  for (const [seg, why] of Object.entries(bad)) assert.equal(OD.segmentProblem(seg), why, JSON.stringify(seg));
  assert.equal(OD.segmentProblem("x".repeat(256)), "a name longer than 255 characters");
  assert.equal(OD.segmentProblem("😀".repeat(255)), null, "characters are code points");
});

test("hidden: lock and system files from everyone; priced, money, amounts and takeoffs by switch (paths.ts nameHidden)", () => {
  for (const n of ["~$Contract.docx", "desktop.ini", "Thumbs.db", ".DS_Store", ".~lock.plan.odt#", "x.tmp", "y.part", "_vti_cnf", ".hidden"]) {
    assert.ok(OD.nameHidden(n, ALL), n);
  }
  assert.ok(OD.nameHidden("Bid set.takeoff", NONE) && OD.nameHidden("Plan notes.pdfnotes", NONE));
  assert.ok(!OD.nameHidden("L1.takeoff", PRICES), "a takeoff with prices");
  assert.ok(OD.nameHidden("Estimates", NONE) && !OD.nameHidden("Estimates", PRICES));
  assert.ok(OD.nameHidden("Deck $4,500 option.pdf", NONE) && !OD.nameHidden("Deck $4,500 option.pdf", PRICES), "an amount");
  assert.ok(OD.nameHidden("Invoices", PRICES), "money names need financials too");
  assert.ok(!OD.nameHidden("Invoices", ALL));
  for (const n of ["Subcontractor Invoices", "Contract payments.xlsx", "Change order invoice 3.pdf", "Invoice for the estimate.pdf"]) {
    assert.ok(OD.nameHidden(n, NONE) && OD.nameHidden(n, PRICES) && !OD.nameHidden(n, ALL), "about prices and money: financials too - " + n);
  }
  for (const n of ["A253Estimate.pdf", "A305Quote.pdf", "2026Invoice.pdf"]) assert.ok(OD.nameHidden(n, NONE), "a stem after a digit - " + n);
  assert.ok(!OD.nameHidden("A253Estimate.pdf", PRICES) && OD.nameHidden("2026Invoice.pdf", PRICES));
  assert.ok(!OD.nameHidden("Old portal documents", NONE) && !OD.nameHidden("Floor Plans", NONE) && !OD.nameHidden("Permit.pdf", NONE));
  assert.ok(OD.quotesAmount("paid 4500") && OD.quotesAmount("$1,200") && !OD.quotesAmount("Level 2 framing.pdf"));
  assert.deepEqual(OD.viewerOf({ role: "admin" }), ALL);
  assert.deepEqual(OD.viewerOf({ role: "manager", can_see_prices: true }), PRICES);
  assert.deepEqual(OD.viewerOf(null), NONE);
});

test("uploads: the allowlist (no macros, no programs), .takeoff with prices, lock names, priced names and amounts", () => {
  for (const n of ["Plan.pdf", "IMG_1.JPG", "x.heic", "Deck.dwg", "Notes.txt", "Sheet.xlsx", "Clip.mov", "Scope.docx"]) {
    assert.equal(OD.uploadProblem(n, NONE), null, n);
  }
  for (const n of ["Macro.xlsm", "Macro.docm", "tool.exe", "run.bat", "x.js", "link.url", "shortcut.lnk", "page.html", "noext", "archive.zip"]) {
    assert.equal(OD.uploadProblem(n, ALL).code, "file_type", n);
  }
  assert.equal(OD.uploadProblem("L1.takeoff", NONE).message, OD.MESSAGES.takeoff);
  assert.equal(OD.uploadProblem("L1.takeoff", PRICES), null);
  assert.equal(OD.uploadProblem("~$Plan.docx", ALL).message, OD.MESSAGES.system);
  assert.equal(OD.uploadProblem("desktop.ini", ALL).message, OD.MESSAGES.system);
  assert.equal(OD.uploadProblem("Quote 3.pdf", NONE).message, OD.MESSAGES.priced);
  assert.equal(OD.uploadProblem("Deck $4,500.pdf", NONE).message, OD.MESSAGES.priced);
  assert.equal(OD.uploadProblem("Quote 3.pdf", PRICES), null);
  // a money name needs financials too: never an upload hidden from its own uploader (upload_done would answer not_found)
  for (const n of ["Invoice 12.pdf", "Contract payments.xlsx", "A253Receipt.jpg"]) {
    assert.equal(OD.uploadProblem(n, NONE).message, OD.MESSAGES.priced, n);
    assert.deepEqual(OD.uploadProblem(n, PRICES), { code: "invalid", message: OD.MESSAGES.money }, n);
    assert.equal(OD.uploadProblem(n, ALL), null, n);
  }
  assert.equal(OD.uploadProblem("A305Quote.pdf", NONE).message, OD.MESSAGES.priced, "a stem right after the project number");
  for (const v of [NONE, PRICES, ALL]) {
    for (const n of ["Invoice 12.pdf", "Estimate.pdf", "Subcontractor Invoices.pdf", "L1.takeoff", "A253Quote.pdf", "Plan.pdf", "Deck $4,500.pdf"]) {
      if (OD.uploadProblem(n, v) === null) assert.ok(!OD.nameHidden(n, v), n + " " + JSON.stringify(v));
      const folder = n.replace(/\.[a-z]+$/, "");
      if (OD.folderProblem(folder, v) === null) assert.ok(!OD.nameHidden(folder, v), folder + " " + JSON.stringify(v));
    }
  }
  assert.match(OD.uploadProblem("x".repeat(197) + ".pdf", ALL).message, /longer than 200/);
  assert.equal(OD.acceptFor(NONE).split(",").includes(".takeoff"), false);
  assert.equal(OD.acceptFor(PRICES).split(",").includes(".takeoff"), true);
  assert.ok(OD.acceptFor(NONE).split(",").every((e) => /^\.[a-z0-9]+$/.test(e)));
  for (const n of ["a.exe", "b.MSI", "c.ps1", "d.library-ms", "e.lnk", "f.url", "g.scf", "h.hta", "i.vbs", "j.cmd"]) assert.equal(OD.downloadable(n), false, n);
  for (const n of ["a.pdf", "b.dwg", "c", "d.takeoff"]) assert.equal(OD.downloadable(n), true, n);
});

test("where an upload goes: Documents or Floor Plans and their folders, never Documents/Items; the choices on screen", () => {
  assert.equal(OD.uploadPlace([]), null);
  assert.equal(OD.uploadPlace(["Photos", "2026-10-01"]), null, "photos keep the capture bar");
  assert.equal(OD.uploadPlace(["Old portal documents"]), null);
  assert.equal(OD.uploadPlace(["documents", "Items", "12 - Beam"]), null);
  assert.deepEqual(OD.uploadPlace(["floor plans", "Level 1"]), { folder: "Floor Plans", relDir: "Level 1" });
  assert.deepEqual(OD.uploadPlace(["Documents"]), { folder: "Documents", relDir: "" });
  assert.deepEqual(OD.targetChoices(["Floor Plans", "Level 1"]).map((c) => [c.value, c.folder, c.relDir, c.label]),
    [["here", "Floor Plans", "Level 1", "Floor Plans / Level 1"], ["Documents", "Documents", "", "Documents"], ["Floor Plans", "Floor Plans", "", "Floor Plans"]]);
  assert.deepEqual(OD.targetChoices(["Photos"]).map((c) => c.value), ["Documents", "Floor Plans"]);
  assert.equal(OD.defaultTarget(["Floor Plans", "Level 1"]), "here");
  assert.equal(OD.defaultTarget(["Floor Plans"]), "Floor Plans");
  assert.equal(OD.defaultTarget(["Photos"]), "Documents");
  assert.equal(OD.defaultTarget([]), "Documents");
  assert.ok(OD.isOldCopy(["old portal documents", "x"]) && !OD.isOldCopy(["Documents"]));
});

test("sessionProblem: every check the broker makes before it opens an upload session, in its words", () => {
  const base = { folder: "Floor Plans", relDir: "", name: "A1.pdf", size: 10, viewer: NONE, folderName: "A267 - 1 Test Way - Sandbox - Sandbox" };
  const p = (o) => OD.sessionProblem(Object.assign({}, base, o));
  assert.equal(p({}), null);
  assert.equal(p({ folder: "Photos" }), OD.MESSAGES.where);
  assert.equal(p({ folder: "Documents", relDir: "Items/12 - Beam" }), OD.MESSAGES.items);
  assert.match(p({ relDir: "Change Orders" }), /named for prices or money/);
  assert.equal(p({ relDir: "Change Orders", viewer: PRICES }), null);
  assert.match(p({ relDir: "Invoices", viewer: PRICES }), /named for money/);
  assert.match(p({ relDir: "Subcontractor Invoices", viewer: PRICES }), /named for money/, "about prices and money");
  assert.equal(p({ relDir: "Subcontractor Invoices", viewer: ALL }), null);
  assert.match(p({ relDir: "Old.takeoff" }), /named for prices or money/, "a folder hidden from its uploader");
  assert.equal(p({ name: "Change order invoice 3.pdf", viewer: PRICES }), OD.MESSAGES.money);
  assert.match(p({ relDir: "a/../b" }), /means another folder/);
  assert.match(p({ relDir: Array.from({ length: 12 }, (_, i) => "L" + i).join("/") }), /At most 11 folders/);
  assert.equal(p({ name: "x.exe" }), OD.MESSAGES.fileType);
  assert.equal(p({ size: 0 }), OD.MESSAGES.empty);
  assert.equal(p({ size: OD.MAX_UPLOAD_BYTES + 1 }), OD.MESSAGES.tooLarge);
  assert.equal(p({ size: 2000, maxBytes: 1000 }), OD.MESSAGES.tooLarge);
  assert.equal(p({ folderName: "A".repeat(120), relDir: Array.from({ length: 2 }, () => "x".repeat(110)).join("/"), name: "y".repeat(100) + ".pdf" }), OD.MESSAGES.tooLong, "340 characters below Projects");
  assert.equal(p({ folderName: null, relDir: "x".repeat(121) }) !== null, true, "a folder longer than 120");
});

test("the files table's shape (app.rel_path_ok, files_subpath_shape) as the database keeps it", () => {
  for (const ok of ["A267 - x/Floor Plans/A1.pdf", "P/a.pdf", "abc"]) assert.equal(OD.relPathOk(ok), ok !== "abc", ok);
  for (const bad of ["A/", "/x/y", "A//b", "A/ b", "A/b ", "A/b.", "A/con", "A/b:c", "A/b‮", "x".repeat(1025)]) assert.equal(OD.relPathOk(bad), false, bad);
  assert.equal(OD.relPathOk(Array.from({ length: 33 }, () => "a").join("/")), false, "32 parts at most");
  assert.equal(OD.relPathOk("A/" + "b".repeat(256)), false);
  for (const ok of ["", "Floor Plans", "Floor Plans/Level 1", Array.from({ length: 12 }, () => "a").join("/")]) assert.equal(OD.subpathOk(ok), true, ok);
  for (const bad of ["/a", "a/", "a//b", " a", "a /b", "a./b", "a|b", Array.from({ length: 13 }, () => "a").join("/"), "x".repeat(121), Array.from({ length: 5 }, () => "x".repeat(110)).join("/")]) {
    assert.equal(OD.subpathOk(bad), false, bad.slice(0, 40));
  }
});

test("the browser's shapes: crumbs, icons, the project file list's caption and version on the OneDrive row", () => {
  assert.deepEqual(OD.crumbs(["Floor Plans", "Level 1"]), [{ name: "Project folder", path: [] }, { name: "Floor Plans", path: ["Floor Plans"] },
    { name: "Level 1", path: ["Floor Plans", "Level 1"] }]);
  assert.equal(OD.folderIcon([], "Floor Plans"), "📐");
  assert.equal(OD.folderIcon(["Floor Plans"], "Level 1"), "📁");
  assert.equal(OD.belowProject("A267 - x/Floor Plans/A1.pdf"), "Floor Plans/A1.pdf");
  assert.deepEqual(["IMG_1.JPG", "clip.mov", "A1.pdf", "Bid.xlsx", "Deck.dwg", "notes.txt"].map(OD.fileIconOf), ["🖼️", "🎬", "📕", "📊", "📐", "📄"]);
  const items = [
    { id: 1, cloud: false, relPath: "A267 - x/Floor Plans/A1 - Floor plan.pdf", description: "the old set", versionNo: 1 },
    { id: 2, cloud: false, relPath: "A267 - x/floor plans/a1 - floor plan.pdf", description: "the new set", versionNo: 2 },
    { id: 3, cloud: true, relPath: null, name: "A1 - Floor plan.pdf", description: "cloud", versionNo: 1 },
  ];
  const merged = OD.mergeLocal([{ id: "x1", name: "A1 - Floor plan.pdf", folder: false }, { id: "x2", name: "Level 1", folder: true },
    { id: "x3", name: "Other.pdf", folder: false }], items, ["Floor Plans"]);
  assert.deepEqual([merged[0].caption, merged[0].versionNo, merged[0].fileId], ["the new set", 2, 2], "the newest version, any case");
  assert.equal(merged[1].caption, undefined);
  assert.equal(merged[2].caption, undefined);
  assert.equal(OD.mergeLocal([{ id: "x1", name: "A1 - Floor plan.pdf", folder: false }], items, [])[0].caption, undefined, "another folder");
});

test("the upload session's arithmetic: chunks of 320 KiB multiples, at most 191 of them; the next byte; OneDrive's renames", () => {
  assert.equal(OD.MAX_CHUNK, 191 * 327680);
  assert.ok(OD.MAX_CHUNK < 60 * 1024 * 1024);
  assert.equal(OD.chunkBytes({ chunk_bytes: 10485760, max_chunk_bytes: 62586880 }), 10485760);
  assert.equal(OD.chunkBytes({ chunk_bytes: 999999999, max_chunk_bytes: 999999999 }), OD.MAX_CHUNK, "never above 191 x 320 KiB");
  assert.equal(OD.chunkBytes({ chunk_bytes: 400000 }), 327680, "down to a multiple");
  assert.equal(OD.chunkBytes({ chunk_bytes: 10 }), 327680, "at least one unit");
  assert.equal(OD.chunkBytes({}), OD.DEFAULT_CHUNK);
  assert.deepEqual(OD.chunkPlan(700000, 0, 327680), { start: 0, end: 327680, last: false, range: "bytes 0-327679/700000" });
  assert.deepEqual(OD.chunkPlan(700000, 655360, 327680), { start: 655360, end: 700000, last: true, range: "bytes 655360-699999/700000" });
  assert.equal(OD.chunkPlan(700000, 700000, 327680), null);
  assert.equal(OD.chunkPlan(0, 0, 327680), null);
  assert.equal(OD.parseNext(["327680-"]), 327680);
  assert.equal(OD.parseNext(["12-55", "80-"]), 12);
  assert.equal(OD.parseNext([]), null);
  assert.equal(OD.parseNext(["x"]), null);
  assert.ok(OD.renamedFrom("plan 1.pdf", "plan.pdf") && OD.renamedFrom("PLAN 12.PDF", "plan.pdf") && OD.renamedFrom("plan.pdf", "plan.pdf"));
  assert.ok(!OD.renamedFrom("plan 0.pdf", "plan.pdf") && !OD.renamedFrom("plan copy.pdf", "plan.pdf") && !OD.renamedFrom("plan 1.txt", "plan.pdf"));
  assert.ok(OD.renamedFrom("README 2", "README"));
});

test("the module has no look-behind (older iPhones refuse a module with one)", () => {
  const src = readFileSync(new URL("../site/js/map/onedrive.js", import.meta.url), "utf8");
  assert.ok(!/\(\?<[!=]/.test(src));
});
