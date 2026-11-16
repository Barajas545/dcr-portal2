// What pushing a branch to main publishes (tools/publish-check.mjs; the review of P5b round 4: this repository is PUBLIC,
// and the round 3 fix - cases v13's made-up job - changed only the tip of photo/p5b while six earlier commits still held
// the real-looking address; DCR Desktop 2 docs/PHOTO-FILES.md §14 step 7, §37). In a made-up repository: a value one
// commit adds and a later one removes is still published, by the commit that added it - the check finds it although the
// tip is clean, says which commit removes it and how many carry it, and a squash of the range is clean; a message or a
// file name with one is found too. The photo files on the Office OneDrive (DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md
// §0.4, §10.4, §11.3) widen it: a OneDrive drive id ("b!..."), a personal-site path naming an account and any OneDrive
// host but the made-up example one and the one already published (the base's site/js/repo/onedrive.js) are refused the
// same way; the made-up ones (all-zero or FAKE ids, office_example_com) pass, and so does this branch squashed. The
// OneDrive review's round 1 widens it to what OD §0.4 says it scans for: a tenant or client id (a GUID), a OneDrive item
// id, an e-mail address (any but a made-up one or the commits' public trailer) and a client secret of Entra's shape -
// the made-up ones (a zero group or one digit throughout, 01FAKE..., example.com / .test) pass. Every value the check
// looks for is built at run time, so no file here holds one (the photo files tests scan for that). Made-up values only.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, report, readDiff, find, publishedHosts, madeUpDriveId, madeUpAccount, madeUpGuid, madeUpItemId, madeUpEmail, STREET, DRIVE_ID, PERSONAL,
  HOST, GUID, ITEM_ID, EMAIL, SECRET, PUBLIC_EMAILS, EXAMPLE_HOST, HOST_FILE, LOOKS_FOR } from "../tools/publish-check.mjs";

const TOOL = fileURLToPath(new URL("../tools/publish-check.mjs", import.meta.url));
const hasGit = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
const skip = !hasGit && "git is not here";
// made up, and never written as one piece in a file of this repository
const FAKE = [String(1200 + 34), "Madeup", "Canyon", "Avenue"].join(" ");
const FAKE2 = [String(9000 + 87), "Example", "Street"].join(" ");
// a drive id, an account's personal-site path and two tenants' OneDrive hosts of the shapes the check refuses, built here
const SP = ["my", "sharepoint", "com"].join(".");
const DRIVE = "b" + "!" + "Qm9ndXNEcml2ZUlkT2ZBTWFkZVVwVGVuYW50MDEyMzQ1Njc4OWFiY2RlZmdoaWpr";
const ACCOUNT = ["sam", "contoso", "test2"].join("_");
const PERSONAL_PATH = "/" + "personal" + "/" + ACCOUNT;
const TENANT = "contoso" + "-" + SP;
const PUBLISHED = "madeupone" + "-" + SP;
const EXAMPLE = "example" + "-" + SP;
// a tenant id, a OneDrive item id, a company address and a client secret in their real shapes, built here (the review's
// made-up values; each piece alone is none of them)
const TENANT_ID = ["3f2a9c41", "7d2e", "4b8a", "9e1f", "0c5d6a7b8e9f"].join("-");
const ITEM = "0" + "1" + "BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K";
const ADDRESS = "lou.realperson" + "@" + ["dcrframing", "com"].join(".");
const OTHER_ADDRESS = "sam" + "@" + ["contoso", "com"].join(".");
const SECRET_VALUE = "Abc" + "8" + "Q~" + "xYz0123456789abcdefghijKLMNOPqrstu";

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "p2-publish-"));
  const g = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=Sample Person", "-c", "user.email=sample@example.com", "-c", "commit.gpgsign=false",
    "-c", "core.autocrlf=false", "-c", "init.defaultBranch=main", ...args], { encoding: "utf8" }).trim();
  g("init", "-q");
  const commit = (files, msg) => {
    for (const [name, body] of Object.entries(files)) {
      if (body === null) g("rm", "-q", name);
      else { mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); writeFileSync(path.join(dir, name), body); g("add", name); }
    }
    g("commit", "-q", "--allow-empty", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  return { dir, g, commit, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" });

test("the made-up streets have the shape the check looks for; this file holds none as one piece", () => {
  assert.match(FAKE, STREET);
  assert.match(FAKE2, STREET);
  assert.doesNotMatch("A267 0000 Sampleton Canyon Avenue Residence", STREET, "0000 is plainly made up (the cases' long label)");
  assert.doesNotMatch("A267 Sample Street", STREET);
});

test("readDiff: each file's added lines with their numbers, removed lines, and both names", () => {
  const files = readDiff(["diff --git a/x.json b/x.json", "index 1..2 100644", "--- a/x.json", "+++ b/x.json", "@@ -3 +3,2 @@", "-old", "+new", "+two",
    "diff --git a/p.png b/p.png", "new file mode 100644", "Binary files /dev/null and b/p.png differ"].join("\n"));
  assert.deepEqual(files[0].added, [{ n: 3, text: "new" }, { n: 4, text: "two" }]);
  assert.deepEqual(files[0].removed, ["old"]);
  assert.equal(files[0].path, "x.json");
  assert.equal(files[1].path, "p.png");
  assert.ok(files[1].names.some((n) => n.includes("Binary files")));
});

test("a street one commit adds and a later one removes is published by the commit that added it: found although the tip is clean; a squash of the range is clean", { skip }, () => {
  const r = repo();
  try {
    const base = r.commit({ "cases.json": '{"job": "A267 Sample Street"}\n', "README.md": "made up\n" }, "the base");
    const added = r.commit({ "cases.json": '{"job": "A301 ' + FAKE + ' Residence",\n "body": "A301 ' + FAKE + ' Residence"}\n' }, "a long label");
    r.commit({ "README.md": "made up, again\n" }, "another change");
    const removed = r.commit({ "cases.json": '{"job": "A267 0000 Sampleton Canyon Avenue Residence"}\n' }, "a made-up job");
    const tip = r.commit({ "README.md": "made up, a third time\n" }, "the tip");
    assert.doesNotMatch(r.g("show", tip + ":cases.json"), STREET, "the tip is clean");
    assert.equal(r.g("diff", base, tip).match(STREET), null, "and so is the range's own change (what a tip-only look reads)");
    const one = check({ repo: r.dir, base, branch: tip });
    assert.equal(one.commits.length, 4);
    assert.equal(one.findings.length, 1, report(one));
    const f = one.findings[0];
    assert.deepEqual([f.commit, f.path, f.n, f.text, f.where, f.lines, f.removedBy, f.carried], [added, "cases.json", 1, FAKE, "line", 2, removed, 2]);
    const text = report(one);
    assert.match(text, new RegExp("^  " + added.slice(0, 7) + " cases\\.json:1: adds a numbered street .* - removed by " + removed.slice(0, 7) + ", so 2 commits carry it$", "m"));
    assert.match(text, /^FOUND 1: pushing this publishes it - publish the branch as ONE squashed commit/m);
    const sq = check({ repo: r.dir, base, branch: tip, squash: true });
    assert.deepEqual(sq.findings, [], report(sq));
    assert.match(report(sq), /^clean: no numbered street, drive id, personal-site path, OneDrive host, tenant or client id, item id, e-mail address or client secret in the squashed commit$/m);
    // the command: 1 as pushed one by one, 0 as one squashed commit
    const a = run(["--repo", r.dir, "--base", base, tip]);
    assert.equal(a.status, 1, a.stdout + a.stderr);
    assert.match(a.stdout, /removed by/);
    const b = run(["--repo", r.dir, "--base", base, "--squash", tip]);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    // still at the tip: said so
    const kept = r.commit({ "notes.txt": "visit " + FAKE2 + "\n" }, "a note");
    const k = check({ repo: r.dir, base: tip, branch: kept });
    assert.deepEqual([k.findings.length, k.findings[0].removedBy, k.findings[0].carried], [1, null, 1]);
    assert.match(report(k), /still at the tip \(1 commit carry it\)/);
    assert.equal(check({ repo: r.dir, base: tip, branch: kept, squash: true }).findings.length, 1, "a squash keeps what the tip holds");
  } finally { r.done(); }
});

test("a commit's message and a file's name are published too: both found, one by one and squashed", { skip }, () => {
  const r = repo();
  try {
    const base = r.commit({ "a.txt": "made up\n" }, "the base");
    const msg = r.commit({ "a.txt": "made up, again\n" }, "the job at " + FAKE2);
    const named = r.commit({ ["photos " + FAKE2 + ".txt"]: "made up\n" }, "a file");
    r.commit({ ["photos " + FAKE2 + ".txt"]: null }, "the file gone");
    const tip = r.g("rev-parse", "HEAD");
    const one = check({ repo: r.dir, base, branch: tip });
    assert.deepEqual(one.findings.map((f) => [f.commit, f.where]), [[msg, "message"], [named, "name"], [r.g("rev-parse", "HEAD"), "name"]], report(one));
    const sq = check({ repo: r.dir, base, branch: tip, squash: true });
    assert.deepEqual(sq.findings.map((f) => [f.commit, f.where]), [[msg, "message"]], "a squash's message keeps every message; the file name is gone from its tree");
  } finally { r.done(); }
});

test("a clean range is clean; nothing to publish says so; a base that is not an ancestor, or not a commit, is refused (exit 2)", { skip }, () => {
  const r = repo();
  try {
    const base = r.commit({ "a.txt": "made up\n" }, "the base");
    const tip = r.commit({ "a.txt": "A267 Sample Street\n" }, "a made-up job");
    assert.equal(run(["--repo", r.dir, "--base", base, tip]).status, 0);
    assert.match(run(["--repo", r.dir, "--base", base, tip]).stdout, /clean: no numbered street, drive id, personal-site path, OneDrive host, tenant or client id, item id, e-mail address or client secret in any of them/);
    const none = run(["--repo", r.dir, "--base", tip, tip]);
    assert.equal(none.status, 0);
    assert.match(none.stdout, /nothing to publish/);
    const back = run(["--repo", r.dir, "--base", tip, base]);
    assert.equal(back.status, 2);
    assert.match(back.stderr, /is not an ancestor of/);
    const gone = run(["--repo", r.dir, "--base", "no-such-ref", tip]);
    assert.equal(gone.status, 2);
    assert.match(gone.stderr, /is not a commit here/);
    assert.equal(run(["--repo", r.dir, "--base"]).status, 2, "a flag with no value");
    assert.equal(run(["--repo", r.dir, "--nope"]).status, 2, "an unknown flag");
  } finally { r.done(); }
});

test("the check writes nothing: no ref, no object (read-only)", { skip }, () => {
  const r = repo();
  try {
    const base = r.commit({ "a.txt": "made up\n" }, "the base");
    const tip = r.commit({ "a.txt": "visit " + FAKE + "\n" }, "a note");
    const before = [r.g("for-each-ref"), r.g("count-objects", "-v")];
    run(["--repo", r.dir, "--base", base, tip]);
    run(["--repo", r.dir, "--base", base, "--squash", tip]);
    assert.deepEqual([r.g("for-each-ref"), r.g("count-objects", "-v")], before);
  } finally { r.done(); }
});

test("find: the four kinds; a made-up drive id (all zeros, FAKE...), account (none, or example.com / .test) and the example host pass", () => {
  assert.match(DRIVE, DRIVE_ID);
  assert.match(PERSONAL_PATH, PERSONAL);
  assert.match(TENANT, HOST);
  assert.equal(EXAMPLE, EXAMPLE_HOST);
  const kinds = (text, allow) => find(text, allow).map((h) => [h.kind, h.text]);
  assert.deepEqual(kinds("drive " + DRIVE + " here"), [["drive_id", DRIVE]]);
  assert.deepEqual(kinds('{"drive_id": "' + DRIVE + '"}'), [["drive_id", DRIVE]], "in JSON");
  for (const made of ["b" + "!" + "0".repeat(64), "b" + "!" + "FAKEdrive000000000000", "b" + "!" + "fake-office-drive-000"]) {
    assert.ok(madeUpDriveId(made), made);
    assert.deepEqual(kinds("drive " + made), [], made);
  }
  assert.deepEqual(kinds("if (a.b!==c) x; y = b!.z; q = !b"), [], "code is not a drive id");
  assert.deepEqual(kinds("b" + "!" + "short"), [], "too short to be one");
  assert.deepEqual(kinds("https://" + EXAMPLE + PERSONAL_PATH + "/Documents/x"), [["personal_path", PERSONAL_PATH]], "an account's path, even on the example host");
  for (const made of ["office_example_com", "sam_ortiz_example_test", "x", ""]) {
    assert.ok(madeUpAccount(made), made);
    assert.deepEqual(kinds("https://" + EXAMPLE + "/personal/" + made + "/Documents/DCR%20Photo%20%26%20Video"), [], made);
  }
  assert.deepEqual(kinds("the office account's path (`/personal/<office path>`)"), [], "a placeholder names no account");
  assert.deepEqual(kinds("https://" + TENANT + "/x"), [["host", TENANT]]);
  assert.deepEqual(kinds("connect-src https://" + TENANT.toUpperCase()), [["host", TENANT.toUpperCase()]], "whatever the case");
  assert.deepEqual(kinds("*." + TENANT), [["host", TENANT]], "behind a dot too");
  assert.deepEqual(kinds("https://" + EXAMPLE + "/a https://" + EXAMPLE + ".example.test/b"), [], "the example host, also as a look-alike's start");
  assert.deepEqual(kinds("https://" + PUBLISHED + "/x"), [["host", PUBLISHED]], "a host not allowed");
  assert.deepEqual(kinds("https://" + PUBLISHED + "/x", { hosts: [PUBLISHED.toUpperCase()] }), [], "the host already published");
  assert.deepEqual(kinds("https://" + TENANT + PERSONAL_PATH + " " + DRIVE + " " + FAKE).map((k) => k[0]).sort(), ["drive_id", "host", "personal_path", "street"]);
  assert.match(LOOKS_FOR, /numbered street, drive id, personal-site path, OneDrive host, tenant or client id, item id, e-mail address or client secret/);
});

test("find, widened (OD §0.4; the OneDrive review's round 1): a tenant or client id, a OneDrive item id, an e-mail address and a client secret in their real shapes are found; the made-up ones (a zero group or one digit throughout, 01FAKE..., example.com / .org / .net, .test) and the commits' public trailer pass", () => {
  const kinds = (text) => find(text).map((h) => [h.kind, h.text]);
  assert.match(TENANT_ID, GUID);
  assert.match(ITEM, ITEM_ID);
  assert.match(ADDRESS, EMAIL);
  assert.match(SECRET_VALUE, SECRET);
  assert.deepEqual(kinds("PHOTO_OD_TENANT_ID=" + TENANT_ID), [["guid", TENANT_ID]], "a tenant id");
  assert.deepEqual(kinds('{"client_id": "' + TENANT_ID.toUpperCase() + '"}'), [["guid", TENANT_ID.toUpperCase()]], "whatever the case, in JSON");
  for (const made of [["00000000", "0000", "4000", "8000", "000000000161"].join("-"), ["11111111", "1111", "4111", "8111", "111111111111"].join("-"),
    ["e5b00000", "0000", "4000", "8000", "0000000000a9"].join("-"), ["c2000000", "0000", "4000", "8000", "0000000000d1"].join("-")]) {
    assert.ok(madeUpGuid(made), made);
    assert.deepEqual(kinds("profile " + made), [], made);
  }
  assert.ok(!madeUpGuid(["22222222", "2222", "4222", "8222", "222222222223"].join("-")), "one digit off: not plainly made up");
  assert.deepEqual(kinds("a-" + TENANT_ID + "-b"), [], "inside a longer id: not one GUID");
  assert.deepEqual(kinds("item " + ITEM + " in the log"), [["item_id", ITEM]], "a OneDrive item id");
  for (const made of ["01" + "FAKE" + "ITEM".repeat(7), "01" + "FAKEPHOTOS" + "A".repeat(24)]) {
    assert.ok(madeUpItemId(made), made);
    assert.deepEqual(kinds(made), [], made);
  }
  assert.deepEqual(kinds("x" + ITEM), [], "inside a longer word: not one");
  assert.deepEqual(kinds("to: " + ADDRESS), [["email", ADDRESS]], "a DCR Framing address");
  assert.deepEqual(kinds("<" + OTHER_ADDRESS + ">"), [["email", OTHER_ADDRESS]], "any other real-looking address");
  for (const made of ["sam" + "@" + "example.com", "ana.r" + "@" + "mail.example.org", "pat" + "@" + "example.net", "kim" + "@" + "demo.test",
    "Sam.Home" + "@" + "Example.test", ...PUBLIC_EMAILS]) {
    assert.ok(madeUpEmail(made), made);
    assert.deepEqual(kinds("mail " + made), [], made);
  }
  assert.ok(PUBLIC_EMAILS.includes("noreply" + "@" + "anthropic.com"), "the commits' Co-Authored-By trailer");
  assert.ok(!madeUpEmail("lou" + "@" + "example.com.contoso.com"), "a look-alike of the example domain");
  assert.deepEqual(kinds("icon" + "@" + "2x"), [], "no domain: not an address");
  assert.deepEqual(kinds("secret: " + SECRET_VALUE), [["secret", SECRET_VALUE]], "a client secret of Entra's shape");
  assert.deepEqual(kinds("Abc" + "8" + "Q~" + "short"), [], "too short to be one");
  assert.deepEqual(kinds([TENANT_ID, ITEM, ADDRESS, SECRET_VALUE].join(" ")).map((k) => k[0]).sort(), ["email", "guid", "item_id", "secret"]);
});

test("the widened kinds are refused as the first four are: in an added line (one by one and squashed), a file name and a commit message", { skip }, () => {
  const r = repo();
  try {
    const base = r.commit({ "README.md": "made up\n" }, "the base");
    const line = r.commit({ "tests/fixture.json": '{"tenant": "' + TENANT_ID + '", "item": "' + ITEM + '"}\n' }, "a fixture");
    const gone = r.commit({ "tests/fixture.json": '{"tenant": "' + ["00000000", "0000", "4000", "8000", "000000000001"].join("-") + '"}\n' }, "made up again");
    const named = r.commit({ ["notes " + OTHER_ADDRESS + ".txt"]: "made up\n" }, "a file named after an address");
    const tip = r.commit({ "a.txt": "made up\n" }, "ask " + ADDRESS + " for " + SECRET_VALUE);
    const one = check({ repo: r.dir, base, branch: tip });
    assert.deepEqual(one.findings.map((f) => [f.commit, f.where, f.kind, f.removedBy]), [
      [line, "line", "guid", gone], [line, "line", "item_id", gone], [named, "name", "email", null], [tip, "message", "email", null], [tip, "message", "secret", null],
    ], report(one));
    const text = report(one);
    assert.match(text, /adds a tenant or client id \(a GUID\) \(/);
    assert.match(text, /adds a OneDrive item id \(/);
    assert.match(text, /: a file name with an e-mail address \(/);
    assert.match(text, /its message: a client secret \(/);
    const sq = check({ repo: r.dir, base, branch: tip, squash: true });
    assert.deepEqual(sq.findings.map((f) => [f.where, f.kind]), [["name", "email"], ["message", "email"], ["message", "secret"]],
      "squashed: the ids are gone from the tree; the file name and the message stay");
    assert.equal(run(["--repo", r.dir, "--base", base, "--squash", tip]).status, 1);
    // a made-up range passes: the made-up GUIDs, item ids and addresses of the fakes, and the commits' public trailer
    const ok0 = r.commit({ "tests/ok.json": '{"profile": "' + ["11111111", "1111", "4111", "8111", "111111111111"].join("-") + '", "item": "01' + "FAKEPH" + "0".repeat(10) +
      '", "mail": "' + "ana" + "@" + "example.com" + '"}\n' }, "made-up values\n\nCo-Authored-By: Sample <" + PUBLIC_EMAILS[0] + ">");
    assert.deepEqual(check({ repo: r.dir, base: tip, branch: ok0 }).findings, []);
  } finally { r.done(); }
});

test("the made-up values of the photo files pass: the shared cases, the check itself, this file", () => {
  const root = new URL("../", import.meta.url);
  for (const f of ["tests/vectors/photo_files_cases.json", "tools/publish-check.mjs", "tests/p10-photo-files-publish.test.mjs"]) {
    assert.deepEqual(find(readFileSync(new URL(f, root), "utf8")), [], f);
  }
});

test("the one host already published is the base's own " + HOST_FILE + " ONEDRIVE_HOST: allowed there, refused when the base has none; any other host, a drive id and an account's path refused - one by one and squashed, in lines, names and messages", { skip }, () => {
  const r = repo();
  const bare = repo();
  try {
    const base = r.commit({ [HOST_FILE]: 'export const ONEDRIVE_HOST = "' + PUBLISHED + '";\n', "README.md": "made up\n" }, "the base");
    assert.deepEqual(publishedHosts(r.dir, base), [PUBLISHED]);
    const same = r.commit({ "site/a.html": '<meta content="connect-src https://' + PUBLISHED + '">\n' }, "the published host again");
    const c1 = check({ repo: r.dir, base, branch: same });
    assert.deepEqual([c1.hosts, c1.findings], [[PUBLISHED], []], report(c1));
    const drive = r.commit({ "tests/x.json": '{"drive": "' + DRIVE + '", "ok": "https://' + EXAMPLE + '/personal/office_example_com/x"}\n' }, "a drive id");
    const gone = r.commit({ "tests/x.json": '{"drive": "' + "b" + "!" + "0".repeat(64) + '"}\n' }, "a made-up one");
    const named = r.commit({ ["notes " + TENANT + ".txt"]: "made up\n" }, "a file named after a host");
    const tip = r.commit({ "a.txt": "made up\n" }, "see https://" + TENANT + PERSONAL_PATH);
    const one = check({ repo: r.dir, base, branch: tip });
    assert.deepEqual(one.findings.map((f) => [f.commit, f.where, f.kind, f.text, f.removedBy]), [
      [drive, "line", "drive_id", DRIVE, gone],
      [named, "name", "host", TENANT, null],
      [tip, "message", "personal_path", PERSONAL_PATH, null],
      [tip, "message", "host", TENANT, null],
    ], report(one));
    const text = report(one);
    assert.match(text, new RegExp("^  " + drive.slice(0, 7) + " tests/x\\.json:1: adds a drive id \\(.*\\) - removed by " + gone.slice(0, 7) + ", so 1 commit carry it$", "m"));
    assert.match(text, /: a file name with a OneDrive host \(/);
    assert.match(text, /its message: a personal-site path \(/);
    const sq = check({ repo: r.dir, base, branch: tip, squash: true });
    assert.deepEqual(sq.findings.map((f) => [f.where, f.kind]), [["name", "host"], ["message", "personal_path"], ["message", "host"]],
      "squashed: the drive id is gone from the tree; the file name and the message stay");
    assert.equal(run(["--repo", r.dir, "--base", base, "--squash", tip]).status, 1);
    // a base that names no host: the same host is refused (nothing published yet)
    const b0 = bare.commit({ "README.md": "made up\n" }, "the base");
    const b1 = bare.commit({ "site/a.html": "https://" + PUBLISHED + "/x\n" }, "a host");
    assert.deepEqual(publishedHosts(bare.dir, b0), []);
    const c2 = check({ repo: bare.dir, base: b0, branch: b1 });
    assert.deepEqual(c2.findings.map((f) => [f.kind, f.text]), [["host", PUBLISHED]], report(c2));
    assert.equal(run(["--repo", bare.dir, "--base", b0, b1]).status, 1);
  } finally { r.done(); bare.done(); }
});

// this repository's branch as it would be published: ONE squashed commit on origin/main (the photo files' publish plan,
// OD §11.3) is clean - skipped where origin/main is not here (a shallow checkout) or not this branch's base
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const here = hasGit && spawnSync("git", ["-C", ROOT, "rev-parse", "--verify", "--quiet", "origin/main^{commit}"], { encoding: "utf8" }).status === 0 &&
  spawnSync("git", ["-C", ROOT, "merge-base", "--is-ancestor", "origin/main", "HEAD"], { encoding: "utf8" }).status === 0;
test("this branch, squashed on origin/main, publishes none of the four kinds", { skip: !here && "origin/main is not this checkout's base" }, () => {
  const sq = check({ repo: ROOT, squash: true });
  assert.deepEqual(sq.findings, [], report(sq));
});
