#!/usr/bin/env node
/* DCR Portal 2 — what pushing a branch to main would publish, read for a numbered street address, a OneDrive drive id,
   a personal-site path, a OneDrive host, a tenant or client id, a OneDrive item id, an e-mail address, a client secret
   or a picture before it goes.

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
     * a client secret of the shape Entra gives (three characters, a digit and "Q~", then 31 or more: SECRET);
     * a picture: a file named like a picture, a video or a PDF, or any binary file, a commit adds or changes (but the
       site's own icons, the takeoff copy's binaries that are no picture, and a file named as made up: pictureFile),
       and a picture written into a text file as a base64 data: URL (DATA_PICTURE) - DCR Desktop 2
       docs/PHOTO-SHOOT-EDITS.md §1.4 (step 1's review round 2).
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
   could not answer. Read-only: no ref, object or setting is written. A binary file's bytes are not read (its name is,
   and adding or changing one is a picture finding unless pictureFile allows it).
   Development only (tools/ is not part of the site). */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/* A numbered street of a real-looking address (DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4, widened before any address
   code was written - the job's place on the shoot schedule - and again by step 1's review round 1, which found the
   local shapes the first widening still let through; the same rule as DCR Desktop 2's own scan,
   tests/test_v229_photo_review4.py STREET): a house number of 3 to 6 digits that does not start with 0 ("0000" is
   plainly made up), with an optional unit on it (a letter, a hyphen and a letter, or a hyphen and up to 4 digits), then
     * an optional direction (N, S, E or W, with or without a dot),
     * then one of
       - an optional Spanish prefix (SPANISH), up to three street words (STREET_WORD: a capitalised word - a capital
         inside it and a dot after it too -, an all-capital word, a single capital letter, or an ordinal), lower-case
         particles (PARTICLES) before and between them, and a street suffix (SUFFIXES);
       - a Spanish prefix, its particles and one street word, nothing more;
       - a route: Highway, Hwy, Route, Rte, SR or US and its number.
   Step 1's review round 2 found what still passed: a street written in capitals (a plan's title block, a permit, a
   USPS-style record: "RD", "REAL", "CALLE", "HWY") and one taken from a Maps link or JSON (its words joined by "%20",
   "+", a tab or a non-breaking space). So every Spanish prefix, suffix and route word counts in capitals too (the lists
   below say each once, as written; the rule adds its upper-case form), and the parts of a street may be joined by one
   or more of a space, a tab, a non-breaking space (or the narrow one), a "+" or "%20" (SEP).
   Never "any number followed by a capitalised word": that would flag counts in ordinary text. Two known false
   positives are kept on purpose, so such text is reworded: a year followed by a Spanish prefix and a name (the year of
   a sentence, then "Los" and a town's second word) - leaving out the numbers that look like years would let real house
   numbers through -, and a number followed by two capital words the second of which is a suffix in capitals (an HTTP
   status, then "OK" and "PASS") - leaving out the capitals would let a title block's street through.
   Step 1's review round 3 found what still passed (STREET, Portal 2 first; DCR Desktop 2's D0 then took the same
   pieces, so its tests/test_v229_photo_review4.py STREET is this rule piece for piece again - the parity test):
     * a street joined as a slug ("-", "_": listing URLs, file and folder names), by an HTML or JSON non-breaking space
       ("&nbsp;", "&#160;", a literal " " escape) or by any other Unicode space (en to hair, the medium
       mathematical and the ideographic one) (SEP);
     * an apostrophe in a street word, straight or curly ("O'Madeup", "Madeup's": STREET_WORD);
     * a fraction after the house number ("1/2", "½": a half lot - STREET_NUMBER);
     * a 1- or 2-digit house number - only before up to three capitalised words and a plain street suffix
       (SHORT_SUFFIXES: a count before words, all capitals, a Spanish prefix, a route or a word such as "Grade" or
       "Pass" after them still passes);
     * and an address split over two lines (the 120-column wrap of every doc, comment and commit message here): the
       check reads each commit message, and each run of consecutive added lines, with a line break and the comment
       leader after it (//, /*, *, #, --, <!--) as one space (fold).
   The house number may follow a "_" too (a slug's "photos_1234_..."), and the street's end is any character that is no
   letter or digit (a slug's "_" too).
   The street scan is a backstop, not the rule (DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4): the rule is that only
   made-up 0000 addresses are ever written into a repo; a street shape the scan misses is a written limit, not a
   defect. */
/** The Spanish prefixes a street name may start with (each in capitals too). */
export const SPANISH = Object.freeze(["Via", "Calle", "Camino", "El", "La", "Los", "Las", "Paseo", "Avenida", "Rancho", "Del", "De", "Corte"]);
/** The lower-case particles between a street's words ("de la"; in capitals they are street words). */
export const PARTICLES = Object.freeze(["de", "del", "la", "las", "los", "el"]);
const ROUTE_WORDS = "(?:Highway|Hwy|Route|Rte|SR|US|HIGHWAY|HWY|ROUTE|RTE)";
/** The street suffixes the rule knows (the first rule's, then the widened ones, then review round 1's; each in capitals
    too). */
export const SUFFIXES = Object.freeze(["Street", "St", "Avenue", "Ave", "Road", "Rd", "Boulevard", "Blvd", "Lane", "Ln", "Court", "Ct", "Canyon",
  "Place", "Terrace", "Highway", "Parkway", "Dr", "Drive", "Way", "Circle", "Cir", "Real", "Trail", "Loop", "Ter", "Pl", "Hwy",
  "Pkwy", "Row", "Ridge", "Glen", "Pt", "Point", "Cv", "Cove", "Sq", "Path", "Grade", "Pass", "Run", "Walk", "Alley", "Bend", "Crest", "Heights",
  "Hts", "Knoll", "Mesa", "Vista"]);
/** A list, then each of its words in capitals. */
export const withCapitals = (list) => list.concat(list.map((w) => w.toUpperCase()));
const STREET_ES = "(?:" + withCapitals(SPANISH).join("|") + ")";
const STREET_OF = "(?:" + PARTICLES.join("|") + ")";
const STREET_SUFFIX = "(?:" + withCapitals(SUFFIXES).join("|") + ")";
/** The street's words after its number and direction: words and a suffix, a Spanish prefix and one word, or a route. */
const streetTail = (sep, word) => ({
  suffixed: "(?:" + STREET_ES + "(?:" + sep + STREET_OF + "){0,2}" + sep + ")?" + word + "(?:(?:" + sep + STREET_OF + "){0,2}" + sep + word + "){0,2}" + sep + STREET_SUFFIX,
  spanish: STREET_ES + "(?:" + sep + STREET_OF + "){0,2}" + sep + word,
  route: ROUTE_WORDS + sep + "[0-9]{1,3}",
});
// the joins: a space, a tab, a non-breaking space (and the narrow one), the other Unicode spaces (en to hair, the medium
// mathematical, the ideographic), "+", "_", "-", "%20", and a non-breaking space written in HTML or escaped in JSON
const STREET_SEP = "(?:[ \\t\\u00A0\\u202F\\u2000-\\u200A\\u205F\\u3000+_-]|%20|&nbsp;|&#160;|&#[xX]0*[aA]0;|\\\\u00[aA]0)+";
const LETTER = "[A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE]", LOWER = "[a-z\\u00DF-\\u00F6\\u00F8-\\u00FF]", APOS = "['\\u2019]";
const STREET_WORD = "(?:(?:" + LETTER + APOS + ")?(?:" + LETTER + "(?:" + LOWER + "*" + LETTER + ")?" + LOWER + "+(?:" + APOS + "s)?\\.?|" + LETTER + "+(?:" + APOS + "S)?)" +
  "|[0-9]{1,3}(?:st|nd|rd|th))";
const UNIT = "(?:-?[A-Z]|-[0-9]{1,4})?";
const FRACTION = "(?:(?:" + STREET_SEP + ")?(?:[1-3]/[24]|[\\u00BC-\\u00BE]))?";
const STREET_NUMBER = "(?<![0-9A-Za-z])[1-9][0-9]{2,5}" + UNIT + FRACTION;
const SHORT_NUMBER = "(?<![0-9A-Za-z/.,_-])[1-9][0-9]?" + UNIT + FRACTION;
const STREET_DIRECTION = "(?:[NSEW]\\.?" + STREET_SEP + ")?";
const TAIL = streetTail(STREET_SEP, STREET_WORD);
/** The suffixes a 1- or 2-digit house number is read before (round 3): the plain street ones, as written - never a word
    a count or a product name ends with too ("Grade", "Pass", "Run", "Walk", "Point", "Vista"...). */
export const SHORT_SUFFIXES = Object.freeze(["Street", "St", "Avenue", "Ave", "Road", "Rd", "Boulevard", "Blvd", "Lane", "Ln", "Court", "Ct", "Place",
  "Terrace", "Parkway", "Dr", "Drive", "Way", "Circle", "Cir", "Trail", "Loop", "Ter", "Pl", "Pkwy"]);
// after a short number, up to three capitalised words (never all capitals: "2 HP Chain Drive" is a motor) and one of them
const SHORT_WORD = "(?:(?:" + LETTER + APOS + ")?" + LETTER + "(?:" + LOWER + "*" + LETTER + ")?" + LOWER + "+(?:" + APOS + "s)?\\.?)";
const SHORT_TAIL = SHORT_WORD + "(?:" + STREET_SEP + SHORT_WORD + "){0,2}" + STREET_SEP + "(?:" + SHORT_SUFFIXES.join("|") + ")\\.?";
export const STREET = new RegExp("(?:" + STREET_NUMBER + STREET_SEP + STREET_DIRECTION + "(?:" + TAIL.suffixed + "|" + TAIL.spanish + "|" + TAIL.route + ")" +
  "|" + SHORT_NUMBER + STREET_SEP + STREET_DIRECTION + SHORT_TAIL + ")(?![0-9A-Za-z])");
/** Lines as one text: each line break, the spaces around it and a comment leader after it (//, /*, *, #, --, <!--)
    as one space (round 3: an address wrapped at 120 columns in a doc, a comment or a commit message), or as nothing at
    all (`join`: a picture's base64 wrapped over lines). -> {text, starts: where each line begins in it} */
export function foldLines(lines, join) {
  let text = "";
  const starts = [];
  (lines || []).forEach((line, i) => {
    let t = String(line);
    if (i > 0) {
      t = t.replace(/^[ \t]*(?:(?:\/\/+|\/\*+|\*+|#+|--+|<!--)[ \t]*)?/, "");
      text = text.replace(/[ \t]+$/, "") + (join ? "" : " ");
    }
    starts.push(text.length);
    text += t;
  });
  return { text, starts };
}
/** A text with its line breaks folded (foldLines). */
export function fold(text, join) {
  return foldLines(String(text || "").split(/\r?\n/), join).text;
}
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

/* A picture (DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4: no picture is ever in this repository; step 1's review round 2:
   the check read no binary file, so a job's picture saved from the Board as a test fixture passed clean). A file a
   commit adds or changes is itself a finding when its name ends like a picture, a video or a PDF (MEDIA), or when git
   reads it as binary - unless it is one of the site's own icons (site/icons/, site/takeoff/icons/: ICON_DIRS), a
   binary of the takeoff app's byte-exact copy that is not a picture (site/takeoff/: VENDOR_DIR, where every file reads
   as binary - .gitattributes), or its name says it is made up ("fake", "madeup", "made-up" or "made_up" in it). A
   picture written into a text file as a data: URL (DATA_PICTURE: base64, longer than a tiny test pixel) is one too. */
export const MEDIA = /\.(?:jpe?g|jfif|png|gif|webp|heic|heif|avif|bmp|tiff?|ico|svg|dng|cr2|cr3|nef|arw|raf|orf|rw2|mp4|mov|m4v|avi|mkv|webm|3gp|mts|m2ts|wmv|pdf)$/i;
export const ICON_DIRS = Object.freeze(["site/icons/", "site/takeoff/icons/"]);
export const VENDOR_DIR = "site/takeoff/";
const MADE_UP_NAME = /fake|made[-_]?up/i;
export const DATA_PICTURE = /data:(?:image\/[A-Za-z0-9.+-]+|video\/[A-Za-z0-9.+-]+|application\/pdf);base64,[A-Za-z0-9+/]{400,}/i;
/* Step 1's review round 3 found pictures the data: rule missed: the base64 alone (a JSON or JS fixture's "thumb"), the
   URL-safe kind, and a data: URL wrapped over lines (76 characters a line, MIME style). So a run of 400 or more base64
   letters (standard or URL-safe) that starts as a picture does is one too - a JPEG (/9j/, _9j_), a PNG (iVBORw0KGgo),
   a GIF (R0lGODdh, R0lGODlh), a WebP or AVI (RIFF: UklGR), an MP4, MOV or HEIC (a box size, then ftyp) -, and each
   commit message and run of consecutive added lines is read with its line breaks folded away (foldLines with join). */
export const BASE64_PICTURE = /(?<![A-Za-z0-9+/_-]|base64,)(?:\/9j\/|_9j_|iVBORw0KGgo|R0lGOD[dl]h|UklGR|AAAA[A-Za-z0-9+/_-][GWm2]Z0eX)[A-Za-z0-9+/_-]{400,}/;

/** Why a file a diff adds or changes is a picture finding ("a .jpg file", "a binary file"), or "" when it is not one.
    file: readDiff's {path, names, added}. */
export function pictureFile(file) {
  const f = file || {};
  const path = String(f.path || "");
  const names = f.names || [];
  if (names.some((l) => /^deleted file mode/.test(l))) return "";
  const binary = names.some((l) => /^Binary files /.test(l));
  if (!binary && !(f.added && f.added.length)) return "";             // a mode change alone, or nothing added
  const ext = MEDIA.exec(path);
  if (!ext && !binary) return "";
  if (ICON_DIRS.some((d) => path.startsWith(d))) return "";
  if (!ext && path.startsWith(VENDOR_DIR)) return "";
  if (MADE_UP_NAME.test(path.slice(path.lastIndexOf("/") + 1))) return "";
  return ext ? "a " + ext[0].toLowerCase() + " file" : "a binary file";
}

/** A picture, video, PDF or binary file let through by its made-up name alone ("a .jpg file"), or "" - the report says
    each one (round 3: so a real picture named so is seen before it goes). */
export function madeUpPicture(file) {
  const f = file || {};
  const path = String(f.path || "");
  if (pictureFile(f) || !MADE_UP_NAME.test(path.slice(path.lastIndexOf("/") + 1))) return "";
  return pictureFile(Object.assign({}, f, { path: path.slice(0, path.lastIndexOf("/") + 1) + "x" + (MEDIA.exec(path) || [""])[0] }));
}

const KINDS = { street: "a numbered street", drive_id: "a drive id", personal_path: "a personal-site path", host: "a OneDrive host",
  guid: "a tenant or client id (a GUID)", item_id: "a OneDrive item id", email: "an e-mail address", secret: "a client secret",
  picture: "a picture, video, PDF or other binary file" };
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const all = (re) => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
const STREETS = all(STREET), DRIVE_IDS = all(DRIVE_ID), PERSONALS = all(PERSONAL), HOSTS = all(HOST);
const GUIDS = all(GUID), ITEM_IDS = all(ITEM_ID), EMAILS = all(EMAIL), SECRETS = all(SECRET), DATA_PICTURES = all(DATA_PICTURE);
const BASE64_PICTURES = all(BASE64_PICTURE);

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

/** A picture found in text, said by its start only. */
const pictureText = (m) => (m.indexOf(",") !== -1 ? m.slice(0, m.indexOf(",") + 9) : m.slice(0, 12)) + "…";

/** The streets and pictures of `text` with where each begins: [{kind, text, index}] (a street in the text as it is, a
    picture in it as it is). */
function located(text, which) {
  const out = [];
  if (which !== "pictures") for (const m of text.matchAll(STREETS)) out.push({ kind: "street", text: m[0], index: m.index });
  if (which !== "streets") {
    for (const m of text.matchAll(DATA_PICTURES)) out.push({ kind: "picture", text: pictureText(m[0]), index: m.index });
    for (const m of text.matchAll(BASE64_PICTURES)) out.push({ kind: "picture", text: pictureText(m[0]), index: m.index });
  }
  return out;
}

/** Every value of the nine kinds in `text` that is not allowed: [{kind, text}] (a picture said by its start only). A text
    of several lines is read with its line breaks folded too (round 3: a street wrapped at 120 columns, a picture's
    base64 wrapped over lines - fold), each such value said once beside what the lines alone say. allow.hosts: the
    hosts beside the example one that may appear (lower case; the one already published). */
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
  for (const h of located(s, "pictures")) out.push({ kind: h.kind, text: h.text });
  if (/\n/.test(s)) {
    const said = new Set(out.map((h) => h.kind + " " + h.text));
    for (const h of located(fold(s), "streets").concat(located(fold(s, true), "pictures"))) {
      if (!said.has(h.kind + " " + h.text)) { said.add(h.kind + " " + h.text); out.push({ kind: h.kind, text: h.text }); }
    }
  }
  return out;
}

/** A file's runs of consecutive added lines (two or more), each read folded (foldLines): the streets and pictures the
    lines alone do not show, each at the line it begins on -> [{n, kind, text}]. */
export function foldedHits(added) {
  const runs = [];
  let run = [];
  for (const a of added || []) {
    if (run.length && a.n !== run[run.length - 1].n + 1) { runs.push(run); run = []; }
    run.push(a);
  }
  if (run.length) runs.push(run);
  const out = [];
  for (const r of runs.filter((x) => x.length > 1)) {
    const alone = new Set(r.flatMap((a) => located(a.text).map((h) => h.kind + " " + h.text)));
    for (const [which, join] of [["streets", false], ["pictures", true]]) {
      const f = foldLines(r.map((a) => a.text), join);
      for (const h of located(f.text, which)) {
        if (alone.has(h.kind + " " + h.text)) continue;
        let i = 0;
        while (i + 1 < f.starts.length && f.starts[i + 1] <= h.index) i += 1;
        out.push({ n: r[i].n, kind: h.kind, text: h.text });
      }
    }
  }
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

/** What publishing <base>..<branch> would put in the public repository, read for the nine kinds.
    o: {repo, base, branch, squash}. -> {base, branch, commits, hosts, findings: [{commit, path, n, kind, text, where,
    lines, removedBy, carried}]} - where: "line" | "name" | "message" | "file" (a picture file: pictureFile); kind:
    "street" | "drive_id" | "personal_path" | "host" | "guid" | "item_id" | "email" | "secret" | "picture"; hosts: the
    one already published (allowed). */
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
  // (round 3) the files a made-up name alone let through, each said in the report
  const notes = [];
  const add = (f) => findings.push(Object.assign({ commit: null, path: null, n: null, lines: 1, removedBy: null, carried: 0 }, f));
  const id = (h) => h.kind + " " + h.text;
  // each added line's own, then the runs of consecutive lines folded (round 3: a street or a picture wrapped over lines)
  const lineHits = (file) => file.added.flatMap((a) => hits(a.text).map((h) => Object.assign({ n: a.n }, h)))
    .concat(foldedHits(file.added).filter((h) => h.kind === "picture" || h.kind === "street"));
  if (o.squash) {
    if (commits.length) {
      for (const file of readDiff(git(repo, [...DIFF, base, branch]))) {
        const pic = pictureFile(file);
        if (pic) add({ path: file.path, kind: "picture", text: pic, where: "file" });
        const madeUp = madeUpPicture(file);
        if (madeUp) notes.push({ commit: null, path: file.path, text: madeUp });
        const named = new Map();
        for (const h of file.names.flatMap(hits)) named.set(id(h), h);
        for (const h of named.values()) add({ path: file.path, kind: h.kind, text: h.text, where: "name" });
        const got = new Map();
        for (const h of lineHits(file)) {
          if (got.has(id(h))) { got.get(id(h)).lines += 1; continue; }
          add({ path: file.path, n: h.n, kind: h.kind, text: h.text, where: "line" });
          got.set(id(h), findings[findings.length - 1]);
        }
      }
      for (const c of commits) for (const h of hits(git(repo, ["log", "-1", "--format=%B", c]))) add({ commit: c, kind: h.kind, text: h.text, where: "message" });
    }
    return { base, branch, commits, hosts, findings, notes, squash: true };
  }
  // one by one: each commit against each of its parents (a merge's own lines too); what it adds is published by it
  const open = [];
  commits.forEach((c, i) => {
    const parents = git(repo, ["rev-list", "--parents", "-n", "1", c]).trim().split(/\s+/).slice(1);
    for (const h of hits(git(repo, ["log", "-1", "--format=%B", c]))) add({ commit: c, kind: h.kind, text: h.text, where: "message" });
    const seen = new Set();
    for (const p of parents.length ? parents : [EMPTY_TREE]) {
      for (const file of readDiff(git(repo, [...DIFF, p, c]))) {
        const pic = pictureFile(file);
        if (pic && !seen.has("file " + file.path)) { seen.add("file " + file.path); add({ commit: c, path: file.path, kind: "picture", text: pic, where: "file" }); }
        const madeUp = madeUpPicture(file);
        if (madeUp && !seen.has("note " + file.path)) { seen.add("note " + file.path); notes.push({ commit: c, path: file.path, text: madeUp }); }
        for (const h of file.names.flatMap(hits)) {
          const key = "name " + file.path + " " + id(h);
          if (!seen.has(key)) { seen.add(key); add({ commit: c, path: file.path, kind: h.kind, text: h.text, where: "name" }); }
        }
        for (const h of lineHits(file)) {
          const key = "line " + file.path + " " + id(h);
          if (seen.has(key)) {
            const was = findings.find((x) => x.commit === c && x.where === "line" && x.path === file.path && x.kind === h.kind && x.text === h.text);
            if (was) was.lines += 1;
            continue;
          }
          seen.add(key);
          add({ commit: c, path: file.path, n: h.n, kind: h.kind, text: h.text, where: "line" });
          open.push({ f: findings[findings.length - 1], at: i });
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
  return { base, branch, commits, hosts, findings, notes, squash: false };
}

/** What the check looks for, in words (the report's clean line). */
export const LOOKS_FOR = "no numbered street, drive id, personal-site path, OneDrive host, tenant or client id, item id, e-mail address, client secret or picture";

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
    else if (f.where === "file") out.push("  " + who + f.path + ": adds " + what + " (" + f.text + ")");
    else {
      const tail = r.squash ? "" : f.removedBy ? " - removed by " + short(f.removedBy) + ", so " + f.carried + " commit" + (f.carried === 1 ? "" : "s") + " carry it"
        : " - still at the tip (" + f.carried + " commit" + (f.carried === 1 ? "" : "s") + " carry it)";
      out.push("  " + who + f.path + ":" + f.n + ": adds " + what + " (" + f.text + (f.lines > 1 ? ", " + f.lines + " lines" : "") + ")" + tail);
    }
  }
  for (const x of r.notes || []) {
    out.push("  note: " + (x.commit ? short(x.commit) + " " : "") + x.path + ": " + x.text + " let through by its made-up name - look at it before it goes");
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
