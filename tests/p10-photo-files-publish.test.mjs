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
// the made-up ones (a zero group or one digit throughout, 01FAKE..., example.com / .test) pass. The job's place on the
// shoot schedule (DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4, P0) widens the street: a direction, a Spanish prefix, an
// all-capital word and the longer suffix list; step 1's review round 1 widens it again to the local shapes that still
// passed (a unit on the number, an ordinal, a lettered street, a route, three words with lower-case particles, a capital
// inside a word, a dot after one, an accented letter, more prefixes and suffixes), and pins its one known false positive
// (a year before a Spanish prefix and a name is refused). Every value the check looks for is built at run time, so no
// file here holds one (the photo files tests scan for that). Made-up values only.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, report, readDiff, find, publishedHosts, madeUpDriveId, madeUpAccount, madeUpGuid, madeUpItemId, madeUpEmail, STREET, SUFFIXES, SPANISH, PARTICLES, withCapitals, pictureFile, DRIVE_ID,
  SHORT_SUFFIXES, fold, foldLines, foldedHits, madeUpPicture, BASE64_PICTURE,
  PERSONAL, HOST, GUID, ITEM_ID, EMAIL, SECRET, PUBLIC_EMAILS, EXAMPLE_HOST, HOST_FILE, LOOKS_FOR } from "../tools/publish-check.mjs";
import * as PUBLISH_CHECK from "../tools/publish-check.mjs";

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

// The widened rule (DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4, P0 - before any of the job's place was built): the
// shapes the first rule let through. Each is made up and built here from its pieces, never written as one.
const n = (k) => String(4000 + k);
const st = (...parts) => parts.join(" ");
const WIDENED = [
  ["a direction letter", st(n(11), "N", "Madeup", "Rd")],
  ["a direction letter with a dot", st(n(12), "S.", "Madeup", "Ave")],
  ["E and W too", st(n(13), "E", "Madeup", "St")],
  ["W, two words", st(n(14), "W", "Madeup", "Hollow", "Ln")],
  ["a Spanish prefix and a suffix", st(n(15), "Calle", "Madeup", "Real")],
  ["El, a word and Real", st(n(16), "El", "Madeup", "Real")],
  ["a Spanish prefix and nothing more", st(n(17), "Via", "Madeup")],
  ["Camino and two words", st(n(18), "Camino", "Madeup", "Alto")],
  ["Paseo", st(n(19), "Paseo", "Madeup")],
  ["La", st(n(20), "La", "Madeup")],
  ["Los", st(n(21), "Los", "Madeup")],
  ["Las", st(n(22), "Las", "Madeup")],
  ["a direction then a Spanish prefix", st(n(23), "N.", "Via", "Madeup")],
  ["an all-capital word", st(n(24), "MADEUP", "Way")],
  ["three digits", st("120", "Madeup", "Dr")],
  ["six digits", st("123456", "Madeup", "Drive")],
  ...["Dr", "Drive", "Way", "Circle", "Cir", "Real", "Trail", "Loop", "Ter", "Pl", "Hwy"].map((s, i) => ["the suffix " + s, st(n(30 + i), "Madeup", s)]),
];
// step 1's review round 1: the local shapes the widened rule above still let through (each made up, built from pieces)
const ROUND1 = [
  ["a numbered street", st(n(101), "24th", "St")],
  ["a direction and a numbered street", st(n(102), "W", "5th", "Ave")],
  ["a lettered street", st(n(103), "E", "St")],
  ["a direction, then 1st", st(n(104), "N", "1st", "St")],
  ["2nd", st(n(105), "2nd", "Ave")],
  ["3rd", st(n(106), "3rd", "St")],
  ["three words", st(n(107), "Rancho", "Madeup", "Grande", "Rd")],
  ["Del and two words", st(n(108), "Del", "Madeup", "Heights", "Rd")],
  ["three words, no prefix", st(n(109), "Madeup", "Oak", "Hollow", "Ln")],
  ["lower-case particles after a prefix", st(n(110), "Via", "de", "la", "Madeup")],
  ["Calle de", st(n(111), "Calle", "de", "Madeup")],
  ["Camino de los", st(n(112), "Camino", "de", "los", "Madeup")],
  ["a particle between two words and a suffix", st(n(113), "Madeup", "del", "Monte", "Way")],
  ["Camino and two words", st(n(114), "Camino", "Madeup", "Alto")],
  ["Avenida", st(n(115), "Avenida", "Madeup")],
  ["Rancho", st(n(116), "Rancho", "Madeup")],
  ["De", st(n(117), "De", "Madeup")],
  ["Corte", st(n(118), "Corte", "Madeup")],
  ["a capital inside the name", st(n(119), "McMadeup", "St")],
  ["a word with a dot", st(n(120), "Mt.", "Madeup", "Dr")],
  ["the suffix with a dot", st(n(121), "Madeup", "Ave.")],
  ["a unit letter on the number", n(122) + "B " + st("Madeup", "St")],
  ["a hyphen and a unit letter", n(123) + "-A " + st("Madeup", "St")],
  ["a hyphen and a number", n(124) + "-12 " + st("Madeup", "St")],
  ["an accented first letter", st(n(125), "Ñandu", "Way")],
  ["an accented letter inside", st(n(126), "Peña", "Madeup", "Rd")],
  // (the routes' numbers are made up - 0, 00, 000: the rule takes any 1 to 3 digits - so no case is a house on a real
  // road; step 1's review, round 3)
  ["Highway and its number", st(n(127), "Highway", "000")],
  ["Hwy and its number", st(n(128), "Hwy", "00")],
  ["Route", st(n(129), "Route", "0")],
  ["Rte", st(n(130), "Rte", "00")],
  ["SR", st(n(131), "SR", "000")],
  ["US", st(n(132), "US", "000")],
  ["a direction and a route", st(n(133), "N", "Hwy", "0")],
  ...["Pkwy", "Row", "Ridge", "Glen", "Pt", "Point", "Cv", "Cove", "Sq", "Path", "Grade", "Pass", "Run", "Walk", "Alley", "Bend", "Crest", "Heights", "Hts",
    "Knoll", "Mesa", "Vista"].map((s, i) => ["the suffix " + s, st(n(140 + i), "Madeup", s)]),
];
const PASSES = [
  ["the made-up house number", st("0000", "Sampleton", "Avenue")],
  ["the made-up number, a direction", st("0000", "N", "Sampleton", "Dr")],
  ["the made-up number, a Spanish prefix", st("0000", "Via", "Sampleton")],
  ["no house number", st("A267", "Sample", "Street")],
  ["seven digits", st("1234567", "Madeup", "Way")],
  ["no suffix and no Spanish prefix", st(n(40), "N", "Madeup", "ADU")],
  ["a Spanish prefix with no word after it", st(n(41), "La")],
  ["a year in a sentence", st("In", "2026", "the", "team", "framed", "it")],
  ["a count", st("Sent", "300", "Photos", "to", "OneDrive")],
  ["a lower-case suffix", st(n(42), "Madeup", "way")],
  // review round 1's shapes stay made up with 0000; seven digits stay passing with a unit's room; counts and sizes
  ["the made-up number, particles", st("0000", "Via", "de", "la", "Sampleton")],
  ["the made-up number, a numbered street", st("0000", "24th", "St")],
  ["the made-up number, a route", st("0000", "Hwy", "000")],
  ["the made-up number, a unit", "0000B " + st("Sampleton", "St")],
  ["seven digits, a unit letter's room", st("1234567", "B", "Way")],
  ["a size", st("500", "GB", "of", "room")],
  ["an error", st("HTTP", "404", "Not", "Found")],
  ["photos and videos", st("120", "photos", "·", "4", "videos", "in", "OneDrive")],
  ["a particle with nothing after it", st(n(43), "Calle", "de")],
  ["a route with no number", st(n(44), "Hwy")],
  ["a route with a four-digit number", st(n(45), "Route", "0000")],
  ["a lower-case word between", st(n(46), "Madeup", "and", "Oak", "Way")],
];
// the false positives the rule keeps on purpose (SE §1.4): a year (or a count) before a Spanish prefix and a name is
// refused - leaving out the numbers that look like years would let real house numbers through -, and since review round
// 2 a number before two capital words the second of which is a suffix in capitals - leaving out the capitals would let a
// title block's street through; such text is reworded
const YEAR_AND_PREFIX = [
  st("In", "2026", "Los", "Madeup", "the", "team"),
  st("the", "1999", "El", "Madeup", "job"),
  st("Sent", "300", "La", "Madeup"),
  st("HTTP", String(200), "OK", "PASS"),
  st(String(120), "TESTS", "RUN"),
];
// step 1's review round 2: a street in capitals (a plan's title block, a permit, a USPS-style record) and one taken from a
// Maps link or JSON (this page's mapsUrl quotes the address with encodeURIComponent) - each made up, built from pieces
const MAPS = "https://www.google.com/maps/search/?api=1&query=";
const ROUND2 = [
  ["capitals and RD", st(n(201), "MADEUP", "RD")],
  ["two words in capitals and RD", st(n(202), "MADEUP", "OAKS", "RD")],
  ["a Spanish prefix, a word and REAL in capitals", st(String(10000 + 500), "EL", "MADEUP", "REAL")],
  ["CALLE in capitals", st(n(203), "CALLE", "MADEUP")],
  ["a capitalised name and RD", st(n(204), "Madeup", "RD")],
  ["HWY in capitals", st(n(205), "HWY", "000")],
  ["a lettered street in capitals", st(n(206), "E", "ST")],
  ["a Maps search (encodeURIComponent)", MAPS + encodeURIComponent(st(n(207), "Madeup", "Rd") + ", Madeup, CA " + String(93000))],
  ["a Maps place link", "https://www.google.com/maps/place/" + [n(208), "Madeup", "Rd"].join("+")],
  ["a non-breaking space in JSON", JSON.stringify({ place: n(209) + " " + st("Madeup", "Rd") })],
  ["a narrow non-breaking space", n(210) + " " + st("Madeup", "Rd")],
  ["a tab", [n(211), "Madeup", "Rd"].join("\t")],
  ["two spaces", n(212) + "  " + st("Madeup", "Rd")],
];
const PASSES2 = [
  ["the made-up number in capitals", st("0000", "SAMPLETON", "RD")],
  ["the made-up number in a Maps link", MAPS + encodeURIComponent(st("0000", "Sampleton", "Rd"))],
  ["the made-up number, a place link", ["0000", "Sampleton", "Rd"].join("+")],
  ["the made-up number, a non-breaking space", "0000 " + st("Sampleton", "Rd")],
  ["capitals with no suffix", st(n(213), "MADEUP")],
  ["an error in capitals", st("HTTP", "404", "NOT", "FOUND")],
  ["a size in capitals", st("500", "GB", "OF", "ROOM")],
  ["all lower case", st(n(214), "madeup", "rd")],
  ["a sum in code", st("x", "=", "1200", "+", "34")],
  ["a status alone", st("HTTP", String(200), "OK")],
];

test("the widened street rule (DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4): a direction, a Spanish prefix, an all-capital word and the longer suffix list are found, by the rule and by find; the made-up 0000, ordinary years and counts pass", () => {
  for (const [what, s] of WIDENED.concat(ROUND1)) {
    assert.match(s, STREET, what);
    assert.deepEqual(find("job at " + s + ", by the gate").map((h) => h.kind), ["street"], what);
    assert.ok(find(JSON.stringify({ place: s }))[0].text.startsWith(s.split(" ")[0]), what + " in JSON");
  }
  for (const [what, s] of PASSES) {
    assert.doesNotMatch(s, STREET, what);
    assert.deepEqual(find(s), [], what);
  }
  assert.deepEqual(SUFFIXES.slice(0, 17), ["Street", "St", "Avenue", "Ave", "Road", "Rd", "Boulevard", "Blvd", "Lane", "Ln", "Court", "Ct", "Canyon",
    "Place", "Terrace", "Highway", "Parkway"], "the first rule's suffixes are all kept");
  for (const s of ["Dr", "Drive", "Way", "Circle", "Cir", "Real", "Trail", "Loop", "Ter", "Pl", "Hwy"]) assert.ok(SUFFIXES.includes(s), s);
  // the first rule missed every widened shape but the suffixes it knew: the widening is what finds them
  const FIRST = /\b[1-9][0-9]{2,5} [A-Z][a-z]+( [A-Z][a-z]+)? (Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Court|Ct|Canyon|Place|Terrace|Highway|Parkway)\b/;
  const missed = WIDENED.filter(([, s]) => !FIRST.test(s)).length;
  assert.ok(missed >= 20, "the first rule let " + missed + " of them through");
});

test("review round 1's widening (SE §1.4): a unit on the number, an ordinal, a lettered street, a route, three words with lower-case particles, a capital inside a word, a dot after one, an accented letter, five more prefixes and 22 more suffixes - the first widening let all but two of them through", () => {
  // the rule as the first widening had it (337b622, D0)
  const ES = "(?:Via|Calle|Camino|El|La|Los|Las|Paseo)", W = "(?:[A-Z][a-z]+|[A-Z]{2,})";
  const BEFORE = new RegExp("\\b[1-9][0-9]{2,5} (?:[NSEW]\\.? )?(?:(?:" + ES + " )?" + W + "(?: " + W + ")? (?:" + SUFFIXES.slice(0, 28).join("|") + ")|" + ES + " " + W + ")\\b");
  assert.equal(SUFFIXES.slice(0, 28).at(-1), "Hwy", "the first widening's suffixes come first, in their order");
  assert.deepEqual(ROUND1.filter(([, s]) => BEFORE.test(s)).map(([what]) => what), ["Camino and two words", "the suffix with a dot"],
    "the first widening found only these two (the second by its first part)");
  for (const [what, s] of ROUND1) {
    // as a whole match, from the house number on: never only a part that would leave the street's name readable
    const m = ("job at " + s + ", by the gate").match(STREET);
    assert.ok(m && s.startsWith(m[0].split(" ")[0]), what);
  }
  assert.deepEqual(SPANISH.slice(), ["Via", "Calle", "Camino", "El", "La", "Los", "Las", "Paseo", "Avenida", "Rancho", "Del", "De", "Corte"]);
  assert.deepEqual(PARTICLES.slice(), ["de", "del", "la", "las", "los", "el"]);
  for (const s of ["Pkwy", "Row", "Ridge", "Glen", "Pt", "Point", "Cv", "Cove", "Sq", "Path", "Grade", "Pass", "Run", "Walk", "Alley", "Bend", "Crest", "Heights", "Hts",
    "Knoll", "Mesa", "Vista"]) assert.ok(SUFFIXES.includes(s), s);
});

test("review round 2's widening (SE §1.4): a street in capitals and one taken from a Maps link or JSON (joined by %20, +, a tab or a non-breaking space) are found, from the house number on - the round 1 rule let every one through; the made-up 0000 and ordinary capitals still pass", () => {
  // the rule as round 1 had it (62ec860), its pieces written out here
  const W1 = "(?:[A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE](?:[a-z\\u00DF-\\u00F6\\u00F8-\\u00FF]*[A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE])?[a-z\\u00DF-\\u00F6\\u00F8-\\u00FF]+\\.?" +
    "|[A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE]+|[0-9]{1,3}(?:st|nd|rd|th))";
  const ES1 = "(?:" + SPANISH.join("|") + ")", OF1 = "(?:" + PARTICLES.join("|") + ")";
  const ROUND1_RULE = new RegExp("\\b[1-9][0-9]{2,5}(?:-?[A-Z]|-[0-9]{1,4})? (?:[NSEW]\\.? )?(?:(?:" + ES1 + "(?: " + OF1 + "){0,2} )?" + W1 +
    "(?:(?: " + OF1 + "){0,2} " + W1 + "){0,2} (?:" + SUFFIXES.join("|") + ")|" + ES1 + "(?: " + OF1 + "){0,2} " + W1 + "|(?:Highway|Hwy|Route|Rte|SR|US) [0-9]{1,3})\\b");
  assert.match(st(n(200), "Madeup", "Rd"), ROUND1_RULE, "the round 1 rule as it was");
  assert.deepEqual(ROUND2.filter(([, s]) => ROUND1_RULE.test(s)).map(([what]) => what), [], "the round 1 rule let every one through");
  for (const [what, s] of ROUND2) {
    assert.match(s, STREET, what);
    const m = ("job at " + s + ", by the gate").match(STREET);
    assert.ok(m && /^[1-9][0-9]{2}/.test(m[0]) && s.includes(m[0].slice(0, 4)), what + ": from the house number on");
    assert.deepEqual(find("job at " + s + ", by the gate").map((h) => h.kind), ["street"], what);
  }
  for (const [what, s] of PASSES2) {
    assert.doesNotMatch(s, STREET, what);
    assert.deepEqual(find(s), [], what);
  }
  assert.deepEqual(withCapitals(["Via", "Rd"]), ["Via", "Rd", "VIA", "RD"], "each word, then each in capitals");
  assert.ok(SUFFIXES.every((s) => s !== s.toUpperCase()) && SPANISH.every((s) => s !== s.toUpperCase()), "the lists say each word once, as written");
});

// step 1's review round 3: what the round 2 rule still let through - a slug, an apostrophe, a fraction, a 1- or 2-digit
// number, an HTML or JSON non-breaking space, other Unicode spaces, a file name's slug and an address wrapped over two
// lines. Each made up and built here from its pieces.
const SLUG = (...parts) => parts.join("-");
// the rule as round 2 had it (afe53bf; DCR Desktop 2's 94464e1), its pieces written out here
const R2_SEP = "(?:[ \\t\\u00A0\\u202F+]|%20)+";
const R2_WORD = "(?:[A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE](?:[a-z\\u00DF-\\u00F6\\u00F8-\\u00FF]*[A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE])?" +
  "[a-z\\u00DF-\\u00F6\\u00F8-\\u00FF]+\\.?|[A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE]+|[0-9]{1,3}(?:st|nd|rd|th))";
const R2_ES = "(?:" + withCapitals(SPANISH).join("|") + ")", R2_OF = "(?:" + PARTICLES.join("|") + ")";
const ROUND2_RULE = new RegExp("\\b[1-9][0-9]{2,5}(?:-?[A-Z]|-[0-9]{1,4})?" + R2_SEP + "(?:[NSEW]\\.?" + R2_SEP + ")?(?:(?:" + R2_ES + "(?:" + R2_SEP +
  R2_OF + "){0,2}" + R2_SEP + ")?" + R2_WORD + "(?:(?:" + R2_SEP + R2_OF + "){0,2}" + R2_SEP + R2_WORD + "){0,2}" + R2_SEP + "(?:" +
  withCapitals(SUFFIXES).join("|") + ")|" + R2_ES + "(?:" + R2_SEP + R2_OF + "){0,2}" + R2_SEP + R2_WORD + "|(?:Highway|Hwy|Route|Rte|SR|US|HIGHWAY|HWY|ROUTE|RTE)" +
  R2_SEP + "[0-9]{1,3})\\b");
const ROUND3 = [
  ["a slug", SLUG(n(301), "Madeup", "Rd")],
  ["a slug in a listing URL", "https://www.example.com/homedetails/" + SLUG(n(302), "Madeup", "Rd", "Madeup", "CA", String(93000))],
  ["a file name's slug", "photos_" + [n(303), "Madeup", "Rd"].join("_") + ".jpg"],
  ["an underscore slug", [n(304), "Madeup", "Rd"].join("_")],
  ["an apostrophe: O'", st(n(305), "O'Madeup", "Way")],
  ["a curly apostrophe", st(n(306), "O\u2019Madeup", "Way")],
  ["a possessive", st(n(307), "Madeup's", "Way")],
  ["in capitals with an apostrophe", st(n(308), "O'MADEUP", "RD")],
  ["a half lot", st(n(309), "1/2", "Madeup", "St")],
  ["a half lot as ½", st(n(310), "\u00bd", "Madeup", "St")],
  ["½ on the number", n(311) + "\u00bd " + st("Madeup", "St")],
  ["two digits", st("45", "Madeup", "Way")],
  ["one digit", st("7", "Madeup", "Ct")],
  ["two digits, two words", st("12", "Madeup", "Oak", "Ln")],
  ["two digits, a direction", st("38", "N", "Madeup", "Ave")],
  ["two digits and an apostrophe", st("9", "O'Madeup", "Dr")],
  ["&nbsp;", [n(312), "Madeup", "Rd"].join("&nbsp;")],
  ["&#160;", [n(313), "Madeup", "Rd"].join("&#160;")],
  ["&#xA0;", [n(314), "Madeup", "Rd"].join("&#xA0;")],
  ["a JSON-escaped non-breaking space", [n(315), "Madeup", "Rd"].join("\\u00a0")],
  ["an em space", [n(316), "Madeup", "Rd"].join("\u2003")],
  ["a thin space", [n(317), "Madeup", "Rd"].join("\u2009")],
  ["an ideographic space", [n(318), "Madeup", "Rd"].join("\u3000")],
  ["a slug's end", [n(319), "Madeup", "Rd"].join("-") + "_photo"],
];
// wrapped over two lines (the 120-column wrap of every doc, comment and commit message) - found by find, which reads a
// text of several lines folded, and by the check, which reads each run of consecutive added lines folded
const WRAPPED = [
  ["a plain break", n(320) + "\n" + st("Madeup", "Rd")],
  ["a JS comment", "// the job at " + n(321) + "\n// " + st("Madeup", "Canyon", "Rd") + ", by the gate"],
  ["a doc comment", "   * the job at " + st(n(322), "Madeup") + "\n   * " + st("Canyon", "Rd")],
  ["a Python or shell comment", "# the job at " + st(n(323), "N") + "\n#   " + st("Madeup", "Ave")],
  ["an SQL comment", "-- the job at " + n(324) + "\n-- " + st("Via", "Madeup")],
  ["a markdown line", "the job at " + n(325) + "  \n" + st("Madeup", "Rd")],
  ["a break and CR", n(326) + "\r\n" + st("Madeup", "Rd")],
];
const PASSES3 = [
  ["the made-up number, a slug", SLUG("0000", "Sampleton", "Rd")],
  ["the made-up number, a half", st("0000", "1/2", "Sampleton", "St")],
  ["the made-up number, an apostrophe", st("0000", "O'Sampleton", "Way")],
  ["a count before words", st("Sent", "12", "Photos", "to", "OneDrive")],
  ["a count before capitals", st("2", "HP", "Madeup", "Drive")],
  ["two digits in capitals", st("12", "MADEUP", "WAY")],
  ["two digits before a word a count ends with", st("3", "Madeup", "Pass")],
  ["a product code", "60-Min " + "Grade"],
  ["two digits before a Spanish prefix", st("12", "Via", "Madeup")],
  ["two digits before a route", st("12", "Hwy", "000")],
  ["a version", st("v2", "Madeup", "Way")],
  ["a date", "the 2026-11-16 build"],
  ["a step", st("step", "2", "of", "3")],
  ["photos and videos", st("12", "photos", "·", "4", "videos", "in", "OneDrive")],
  ["a line break before a count", st("Sent", String(300)) + "\n" + st("Photos", "to", "OneDrive")],
  ["a line break, the made-up number", "0000\n" + st("Sampleton", "Rd")],
];

test("review round 3's widening (SE §1.4): a slug, an apostrophe, a fraction, a 1- or 2-digit number before a street suffix, an HTML or JSON non-breaking space and other Unicode spaces are found, from the house number on - the round 2 rule let every one through; the made-up 0000, counts, capitals and product codes still pass", () => {
  assert.match(st(n(300), "Madeup", "Rd"), ROUND2_RULE, "the round 2 rule as it was");
  assert.deepEqual(ROUND3.filter(([, s]) => ROUND2_RULE.test(s)).map(([what]) => what), [], "the round 2 rule let every one through");
  for (const [what, s] of ROUND3) {
    assert.match(s, STREET, what);
    const m = ("job at " + s + ", by the gate").match(STREET);
    assert.ok(m && /^[1-9]/.test(m[0]) && s.includes(m[0].slice(0, 2)), what + ": from the house number on");
    assert.deepEqual(find("job at " + s + ", by the gate").map((h) => h.kind), ["street"], what);
  }
  for (const [what, s] of PASSES3) {
    assert.doesNotMatch(s, STREET, what);
    assert.deepEqual(find(s), [], what);
  }
  // the round 2 shapes all still found, its passes still pass (the made-up 0000 above all)
  for (const [what, s] of WIDENED.concat(ROUND1, ROUND2)) assert.match(s, STREET, what);
  for (const [what, s] of PASSES.concat(PASSES2)) assert.deepEqual(find(s), [], what);
  // a short number only before the plain street suffixes, as written
  assert.deepEqual(SHORT_SUFFIXES.filter((x) => !SUFFIXES.includes(x)), [], "each a suffix the rule knows");
  for (const x of ["Grade", "Pass", "Run", "Walk", "Row", "Point", "Pt", "Vista", "Mesa", "Real", "Canyon", "Highway", "Hwy"]) assert.ok(!SHORT_SUFFIXES.includes(x), x);
});

test("review round 3: an address wrapped over two lines is found - by find (a commit message, a text of several lines) and folded with the comment leader after the break; fold and foldLines", () => {
  for (const [what, s] of WRAPPED) {
    assert.ok(!ROUND2_RULE.test(s), what + ": the round 2 rule let it through");
    assert.doesNotMatch(s, STREET, what + ": a line alone never joins over a break - the fold finds it");
    assert.deepEqual(find(s).map((h) => h.kind), ["street"], what);
    assert.match(find(s)[0].text, /^[1-9][0-9]{3}/, what + ": from the house number on");
  }
  assert.equal(fold("a\n  // b\n * c\n# d\n-- e\n<!-- f\n/* g"), "a b c d e f g");
  assert.equal(fold("ab \n  cd", true), "abcd");
  assert.deepEqual(foldLines(["one  ", "  // two", "three"]), { text: "one two three", starts: [0, 4, 8] });
  // a street on one line is said once, as before
  const one = st(n(327), "Madeup", "Rd");
  assert.deepEqual(find("at " + one + "\nand again").map((h) => h.text), [one]);
});

test("review round 3: the check reads each run of consecutive added lines folded - a street wrapped in a comment, a doc or a commit message is found, one by one and squashed, at the line it begins on; lines that are not consecutive are never joined", { skip }, () => {
  const r = repo();
  try {
    const base = r.commit({ "a.js": "// made up\n" }, "the base");
    const wrapped = "// the job at " + n(331) + "\n// " + st("Madeup", "Canyon", "Rd") + ", by the gate\n";
    const msg = "The job\n\nat " + n(332) + "\n" + st("Madeup", "Way") + " and nothing else";
    const tip = r.commit({ "a.js": "// made up\n" + wrapped, "b.md": "made up\n" }, msg);
    const one = check({ repo: r.dir, base, branch: tip });
    assert.deepEqual(one.findings.map((f) => [f.where, f.path, f.n, f.kind, f.text]), [
      ["message", null, null, "street", st(n(332), "Madeup", "Way")],
      ["line", "a.js", 2, "street", st(n(331), "Madeup", "Canyon", "Rd")],
    ], report(one));
    const sq = check({ repo: r.dir, base, branch: tip, squash: true });
    assert.deepEqual(sq.findings.map((f) => [f.where, f.n, f.text]).sort(), [["line", 2, st(n(331), "Madeup", "Canyon", "Rd")], ["message", null, st(n(332), "Madeup", "Way")]]);
    // two lines that are not consecutive (a line kept between them) are never read as one
    const base2 = r.commit({ "c.txt": "one\nkept\nthree\n" }, "c");
    const apart = r.commit({ "c.txt": n(333) + "\nkept\n" + st("Madeup", "Rd") + "\n" }, "apart");
    assert.deepEqual(check({ repo: r.dir, base: base2, branch: apart }).findings, []);
    // foldedHits alone: what the lines alone say is not said again
    const lines = [{ n: 1, text: "at " + st(n(334), "Madeup", "Rd") }, { n: 2, text: "and " + n(335) }, { n: 3, text: st("Madeup", "Way") }];
    assert.deepEqual(foldedHits(lines), [{ n: 2, kind: "street", text: st(n(335), "Madeup", "Way") }]);
  } finally { r.done(); }
});

test("the shape cases name no real road (step 1's review, round 3): every route's number is made up (zeros) and no case is on El Camino Real - each is still found, from its house number on", () => {
  const ROUTE = /\b(?:Highway|Hwy|Route|Rte|SR|US|HIGHWAY|HWY|ROUTE|RTE)[ \t]+([0-9]+)/;
  const all = WIDENED.concat(ROUND1, ROUND2, PASSES, PASSES2);
  const routes = all.filter(([, s]) => ROUTE.test(s));
  assert.ok(routes.length >= 9, "the route cases are read");
  for (const [what, s] of routes) assert.match(ROUTE.exec(s)[1], /^0+$/, what + ": a made-up route number");
  for (const [what, s] of all) assert.doesNotMatch(s, /camino[ \t]+real/i, what);
});

test("the street rule's known false positives, kept on purpose (SE §1.4): a year or a count before a Spanish prefix and a name IS refused, and so is a number before two capital words the second of which is a suffix in capitals - a sentence with one is reworded; the same number before anything else passes", () => {
  for (const s of YEAR_AND_PREFIX) {
    assert.match(s, STREET, s);
    assert.deepEqual(find(s).map((h) => h.kind), ["street"], s);
  }
  for (const s of [st("In", "2026", "the", "Los", "Madeup", "team"), st("the", "Los", "Madeup", "job", "of", "1999"), st("In", "2026", "the", "team"),
    st("HTTP", String(200), "OK"), st(String(120), "tests", "run")]) {
    assert.doesNotMatch(s, STREET, s);
  }
});

const D2_SCAN = process.env.DCR_DESKTOP2_DIR ? path.join(process.env.DCR_DESKTOP2_DIR, "tests", "test_v229_photo_review4.py") : "";
test("the street rule is DCR Desktop 2's own, piece for piece (its tests/test_v229_photo_review4.py STREET, D0; DCR_DESKTOP2_DIR) - strict: one rule in both repositories since DCR Desktop 2 took round 3's pieces", { skip: !(D2_SCAN && existsSync(D2_SCAN)) && "DCR_DESKTOP2_DIR does not name DCR Desktop 2" }, () => {
  const py = readFileSync(D2_SCAN, "utf8").replace(/\r\n/g, "\n");
  const tuple = (name) => { const m = new RegExp("^" + name + " = \\(([\\s\\S]*?)\\)$", "m").exec(py); assert.ok(m, name); return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]); };
  const spanish = tuple("SPANISH"), particles = tuple("PARTICLES"), suffixes = tuple("SUFFIXES"), short = tuple("SHORT_SUFFIXES");
  assert.deepEqual(suffixes, SUFFIXES.slice(), "the same suffixes, in the same order");
  assert.deepEqual(spanish, SPANISH.slice(), "the same Spanish prefixes, in the same order");
  assert.deepEqual(particles, PARTICLES.slice(), "the same particles, in the same order");
  assert.deepEqual(short, SHORT_SUFFIXES.slice(), "the same suffixes a short number is read before, in the same order");
  // the lists joined as here: each word, then each in capitals (review round 2); the particles and the short number's
  // suffixes as written (round 3)
  assert.match(py, /^def with_capitals\(words: tuple\) -> tuple:\n {4}"""[^\n]*"""\n {4}return words \+ tuple\(w\.upper\(\) for w in words\)$/m, "with_capitals: withCapitals");
  assert.match(py, /^_ES = "\(\?:" \+ "\|"\.join\(with_capitals\(SPANISH\)\) \+ "\)"$/m, "_ES");
  assert.match(py, /^_OF = "\(\?:" \+ "\|"\.join\(PARTICLES\) \+ "\)"$/m, "_OF");
  assert.match(py, /^_SUFFIX = "\(\?:" \+ "\|"\.join\(with_capitals\(SUFFIXES\)\) \+ "\)"$/m, "_SUFFIX");
  assert.match(py, /^_SHORT_SUFFIX = "\(\?:" \+ "\|"\.join\(SHORT_SUFFIXES\) \+ "\)"$/m, "_SHORT_SUFFIX");
  const pieces = { _ES: "(?:" + withCapitals(spanish).join("|") + ")", _OF: "(?:" + particles.join("|") + ")", _SUFFIX: "(?:" + withCapitals(suffixes).join("|") + ")",
    _SHORT_SUFFIX: "(?:" + short.join("|") + ")" };
  // an r"..." or rf"..." string (or several side by side: Python joins them); in an rf one {_X} is that piece and "{{" and
  // "}}" a brace each
  const resolve = (body, f) => (!f ? body : body
    .replace(/\{(_[A-Z_]+)\}/g, (all, name) => { assert.ok(name in pieces, name); return "\u0000" + name + "\u0000"; })
    .replace(/\{\{/g, "{").replace(/\}\}/g, "}")
    .replace(/\u0000(_[A-Z_]+)\u0000/g, (all, name) => pieces[name]));
  // every other piece: one top-level line, an r"..." or rf"..." string, in the file's order - each from the pieces above it
  for (const m of py.matchAll(/^(_[A-Z_]+) = (rf?)"([^"\n]+)"$/gm)) pieces[m[1]] = resolve(m[3], m[2] === "rf");
  for (const name of ["_SEP", "_LETTER", "_LOWER", "_APOS", "_WORD", "_UNIT", "_FRACTION", "_NUMBER", "_SHORT_NUMBER", "_DIRECTION", "_ROUTE", "_SHORT_WORD",
    "_SHORT_TAIL"]) assert.ok(name in pieces, name);
  const tpl = /^STREET = re\.compile\(((?:\s*rf"[^"\n]*")+)\)$/m.exec(py);
  assert.ok(tpl, "Desktop 2's STREET");
  const theirs = resolve(Array.from(tpl[1].matchAll(/rf"([^"\n]*)"/g)).map((x) => x[1]).join(""), true);
  // compared as RegExp sources (a source writes a "/" outside a class as "\/", here and there alike)
  assert.equal(new RegExp(theirs).source, STREET.source, "one rule in both repositories");
});

test("one street rule in the check: round 2's copy is gone since DCR Desktop 2 took round 3's pieces (SE §1.4) - the scan is a backstop, not the rule", () => {
  assert.deepEqual(Object.keys(PUBLISH_CHECK).filter((k) => /STREET/.test(k)), ["STREET"]);
  assert.match(readFileSync(TOOL, "utf8").replace(/\s+/g, " "), /The street scan is a backstop, not the rule .* the rule is that only made-up 0000 addresses are ever written into a repo; a street shape the scan misses is a written limit, not a defect\./);
});

test("a widened shape a commit adds is published by it: found in a line and in a message, one by one and squashed", { skip }, () => {
  const r = repo();
  try {
    const base = r.commit({ "a.txt": "made up\n" }, "the base");
    const spanish = st(n(51), "Via", "Madeup");
    const north = st(n(52), "N", "Madeup", "Way");
    const tip = r.commit({ "a.txt": "made up\nthe job at " + spanish + "\n" }, "the job at " + north);
    const one = check({ repo: r.dir, base, branch: tip });
    assert.deepEqual(one.findings.map((f) => [f.where, f.kind, f.text]), [["message", "street", north], ["line", "street", spanish]], report(one));
    const sq = check({ repo: r.dir, base, branch: tip, squash: true });
    assert.deepEqual(sq.findings.map((f) => [f.where, f.text]).sort(), [["line", spanish], ["message", north]], report(sq));
  } finally { r.done(); }
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

// step 1's review round 2: the check read no binary file, so a job's picture saved as a test fixture passed clean (DCR
// Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4: no picture is ever in this repository). Made-up bytes only.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5]);
const BIN_BYTES = Buffer.from([0, 1, 2, 3, 0, 250, 251, 0]);
const DATA_URL = "data:image/jpeg;base64," + Buffer.alloc(600, 7).toString("base64");

test("pictureFile: a file named like a picture, a video or a PDF, or any binary, that a diff adds or changes - but the site's icons, the takeoff copy's binaries that are no picture, a made-up name and a deleted file", () => {
  const bin = (p, o) => ({ path: p, names: [p, "Binary files /dev/null and b/" + p + " differ"].concat((o && o.names) || []), added: [] });
  const text = (p) => ({ path: p, names: [p], added: [{ n: 1, text: "<svg/>" }] });
  assert.equal(pictureFile(bin("tests/fixtures/thumb.jpg")), "a .jpg file");
  assert.equal(pictureFile(bin("tests/fixtures/Thumb.JPEG")), "a .jpeg file");
  assert.equal(pictureFile(bin("tests/fixtures/walk.mov")), "a .mov file");
  assert.equal(pictureFile(bin("tests/fixtures/plan.pdf")), "a .pdf file");
  assert.equal(pictureFile(bin("tests/fixtures/house.heic")), "a .heic file");
  assert.equal(pictureFile(text("site/img/logo.svg")), "a .svg file", "an SVG is a picture though git reads it as text");
  assert.equal(pictureFile(bin("tests/fixtures/thumb.bin")), "a binary file", "any binary");
  assert.equal(pictureFile(bin("site/takeoff/house.jpg")), "a .jpg file", "a picture in the takeoff copy");
  for (const allowed of ["site/icons/icon-192.png", "site/takeoff/icons/icon-512.png", "site/takeoff/vendor/pdfjs/cmaps/Add-H.bcmap",
    "site/takeoff/js/render/labels.js", "tests/fixtures/fake-thumb.jpg", "tests/fixtures/madeup_house.png", "tests/fixtures/made-up.mp4"]) {
    assert.equal(pictureFile(bin(allowed)), "", allowed);
  }
  assert.equal(pictureFile(bin("tests/fixtures/thumb.jpg", { names: ["deleted file mode 100644"] })), "", "a deleted file publishes nothing new");
  assert.equal(pictureFile({ path: "tests/fixtures/thumb.jpg", names: ["tests/fixtures/thumb.jpg", "old mode 100644", "new mode 100755"], added: [] }), "",
    "a mode change alone");
  assert.equal(pictureFile(text("tests/a.json")), "", "a text file is read line by line");
  // a picture inside a text file: a base64 data: URL, said by its start only; a tiny test pixel passes
  assert.deepEqual(find('{"thumb": "' + DATA_URL + '"}').map((h) => [h.kind, h.text]), [["picture", "data:image/jpeg;base64,BwcHBwcH…"]]);
  assert.deepEqual(find("signature: data:image/png;base64,AAA"), [], "a tiny made-up pixel");
  assert.deepEqual(find("data:image/svg+xml;charset=utf-8,%3Csvg%3E"), [], "a drawn SVG, not base64");
});

test("a picture a commit adds is published by it: found as a file one by one and squashed (a binary too), and in a data: URL; the site's icons, the takeoff copy's binaries and a made-up name pass; removing it later still leaves the commit that added it", { skip }, () => {
  const r = repo();
  try {
    const base = r.commit({ "README.md": "made up\n" }, "the base");
    const pic = r.commit({ "tests/fixtures/thumb.jpg": JPEG_BYTES, "tests/fixtures/blob.bin": BIN_BYTES }, "a fixture");
    const ok = r.commit({ "site/icons/icon-64.png": JPEG_BYTES, "site/takeoff/vendor/x.bcmap": BIN_BYTES, "tests/fixtures/fake-thumb.jpg": JPEG_BYTES }, "icons");
    const url = r.commit({ "tests/fixtures/thumb.json": '{"thumb": "' + DATA_URL + '"}\n' }, "a data URL");
    const tip = r.commit({ "tests/fixtures/thumb.jpg": null, "tests/fixtures/blob.bin": null, "tests/fixtures/thumb.json": null }, "gone again");
    const one = check({ repo: r.dir, base, branch: tip });
    assert.deepEqual(one.findings.map((f) => [f.commit, f.where, f.path, f.kind, f.text]), [
      [pic, "file", "tests/fixtures/blob.bin", "picture", "a binary file"],
      [pic, "file", "tests/fixtures/thumb.jpg", "picture", "a .jpg file"],
      [url, "line", "tests/fixtures/thumb.json", "picture", "data:image/jpeg;base64,BwcHBwcH…"],
    ], report(one));
    assert.ok(!one.findings.some((f) => f.commit === ok), "the icons, the takeoff copy's binary and a made-up name");
    // (round 3) the made-up name is said in the report, so a real picture named so is seen before it goes
    assert.deepEqual(one.notes.map((x) => [x.commit, x.path, x.text]), [[ok, "tests/fixtures/fake-thumb.jpg", "a .jpg file"]]);
    assert.match(report(one), new RegExp("^  note: " + ok.slice(0, 7) + " tests/fixtures/fake-thumb\\.jpg: a \\.jpg file let through by its made-up name - look at it before it goes$", "m"));
    assert.match(report(one), new RegExp("^  " + pic.slice(0, 7) + " tests/fixtures/thumb\\.jpg: adds a picture, video, PDF or other binary file \\(a \\.jpg file\\)$", "m"));
    assert.equal(run(["--repo", r.dir, "--base", base, tip]).status, 1);
    // squashed: the tip no longer holds them - clean; while it does, found
    assert.deepEqual(check({ repo: r.dir, base, branch: tip, squash: true }).findings, []);
    const sq = check({ repo: r.dir, base, branch: url, squash: true });
    assert.deepEqual(sq.findings.map((f) => [f.where, f.path]).sort(), [["file", "tests/fixtures/blob.bin"], ["file", "tests/fixtures/thumb.jpg"], ["line", "tests/fixtures/thumb.json"]]);
    assert.equal(run(["--repo", r.dir, "--base", base, "--squash", url]).status, 1);
    // a changed picture is one too
    const again = r.commit({ "site/img/house.png": JPEG_BYTES }, "a picture");
    const changed = r.commit({ "site/img/house.png": Buffer.concat([JPEG_BYTES, BIN_BYTES]) }, "the picture changed");
    assert.deepEqual(check({ repo: r.dir, base: again, branch: changed }).findings.map((f) => [f.commit, f.path, f.text]), [[changed, "site/img/house.png", "a .png file"]]);
  } finally { r.done(); }
});

// step 1's review round 3: a picture the data: rule missed - its base64 alone (a fixture's "thumb"), the URL-safe kind,
// and a data: URL wrapped over lines. Made-up bytes, each starting as its kind of picture does.
const PICTURE_START = { jpeg: [0xff, 0xd8, 0xff, 0xe0], png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  webp: [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50], mp4: [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d],
  heic: [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63] };
const madeUpBytes = (kind, n) => Buffer.concat([Buffer.from(PICTURE_START[kind]), Buffer.alloc(n || 600, 7)]);
const urlSafe = (b64) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const wrap = (text, w) => text.match(new RegExp(".{1," + w + "}", "g")).join("\n");

test("review round 3's picture rule: a run of base64 that starts as a picture does - a JPEG, PNG, GIF, WebP, MP4 or HEIC, standard or URL-safe - is found without its data: prefix too; a data: URL or a base64 run wrapped over lines is found folded; a run that starts as no picture, and a short one, pass", () => {
  for (const kind of Object.keys(PICTURE_START)) {
    const b64 = madeUpBytes(kind).toString("base64");
    assert.deepEqual(find(JSON.stringify({ thumb: b64 })).map((h) => h.kind), ["picture"], kind);
    assert.deepEqual(find("export const THUMB = '" + urlSafe(b64) + "';").map((h) => h.kind), ["picture"], kind + ", URL-safe");
    assert.ok(find(JSON.stringify({ thumb: b64 }))[0].text.length < 20, kind + ": said by its start only");
  }
  // a data: URL: found once (the data: rule), never twice
  assert.deepEqual(find(DATA_URL).map((h) => h.kind), ["picture"]);
  assert.deepEqual(find("data:image/png;base64," + madeUpBytes("png").toString("base64")).map((h) => h.kind), ["picture"]);
  // wrapped at 76 characters a line (MIME), a data: URL and a bare run: found folded
  const jpeg = madeUpBytes("jpeg").toString("base64");
  for (const [what, t] of [["a wrapped data: URL", wrap("data:image/jpeg;base64," + jpeg, 76)], ["a wrapped run", "thumb =\n" + wrap(jpeg, 76)],
    ["a wrapped run in a comment", wrap(jpeg, 76).split("\n").map((l) => "// " + l).join("\n")]]) {
    assert.ok(!DATA_URL_ONE_LINE(t), what + ": no line alone holds one");
    assert.deepEqual(find(t).map((h) => h.kind), ["picture"], what);
  }
  // passes: base64 that starts as no picture (a hash, a font, random bytes), a short picture, and the data: rule's own
  assert.deepEqual(find(JSON.stringify({ blob: Buffer.alloc(900, 9).toString("base64") })), [], "no picture's start");
  assert.deepEqual(find(JSON.stringify({ thumb: madeUpBytes("jpeg", 200).toString("base64") })), [], "under 400 letters");
  assert.deepEqual(find("signature: data:image/png;base64,AAA"), [], "a tiny made-up pixel");
  assert.match("/9j/" + "A".repeat(400), BASE64_PICTURE);
  assert.doesNotMatch("x/9j/" + "A".repeat(400), BASE64_PICTURE, "inside a longer run: not its start");
});
const DATA_URL_ONE_LINE = (t) => t.split("\n").some((l) => find(l).length > 0);

test("review round 3: a picture wrapped over consecutive added lines is found by the check, one by one and squashed, at the line it begins on; a made-up name's picture is let through and said", { skip }, () => {
  const r = repo();
  try {
    const base = r.commit({ "README.md": "made up\n" }, "the base");
    const jpeg = madeUpBytes("jpeg").toString("base64");
    const tip = r.commit({ "tests/fixtures/thumb.json": '{"name": "x",\n "thumb": "' + "\n" + wrap("data:image/jpeg;base64," + jpeg, 76) + '"}\n',
      "tests/fixtures/thumb.js": "export const THUMB =\n" + wrap(urlSafe(jpeg), 76).split("\n").map((l) => "  '" + l + "' +").join("\n") + "\n  '';\n" }, "fixtures");
    const one = check({ repo: r.dir, base, branch: tip });
    assert.deepEqual(one.findings.map((f) => [f.where, f.path, f.n, f.kind]), [["line", "tests/fixtures/thumb.json", 3, "picture"]], report(one));
    const sq = check({ repo: r.dir, base, branch: tip, squash: true });
    assert.deepEqual(sq.findings.map((f) => [f.where, f.path, f.n, f.kind]), [["line", "tests/fixtures/thumb.json", 3, "picture"]], report(sq));
    // (a picture cut into quoted strings over lines is not one run: only a fold of plain lines is read - the check is no
    // parser; the review's shapes are the bare run, the URL-safe one and the wrapped data: URL)
    // madeUpPicture: what a made-up name let through, and nothing else
    const bin = (pth) => ({ path: pth, names: [pth, "Binary files /dev/null and b/" + pth + " differ"], added: [] });
    assert.equal(madeUpPicture(bin("tests/fixtures/fake-thumb.jpg")), "a .jpg file");
    assert.equal(madeUpPicture(bin("tests/fixtures/madeup.bin")), "a binary file");
    assert.equal(madeUpPicture(bin("tests/fixtures/thumb.jpg")), "", "refused, not let through");
    assert.equal(madeUpPicture(bin("site/icons/fake-icon.png")), "", "an icon: no note");
    assert.equal(madeUpPicture({ path: "tests/fake.json", names: ["tests/fake.json"], added: [{ n: 1, text: "{}" }] }), "", "a text file");
  } finally { r.done(); }
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
    assert.match(report(sq), /^clean: no numbered street, drive id, personal-site path, OneDrive host, tenant or client id, item id, e-mail address, client secret or picture in the squashed commit$/m);
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
    assert.match(run(["--repo", r.dir, "--base", base, tip]).stdout, /clean: no numbered street, drive id, personal-site path, OneDrive host, tenant or client id, item id, e-mail address, client secret or picture in any of them/);
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
  assert.match(LOOKS_FOR, /numbered street, drive id, personal-site path, OneDrive host, tenant or client id, item id, e-mail address, client secret or picture/);
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
