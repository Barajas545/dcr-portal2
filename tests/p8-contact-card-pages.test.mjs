// The Books release A3 (WP-P2): the contact card (site/js/pages/contact-card.js), the avatars (site/js/pages/avatar.js)
// and where they are drawn - The Books' payees (accounting.js) and Search's contacts - read from their source, plus the
// avatars' pure rules: DCR Desktop 2's initials and colours (dcrdesk/ui/widgets/avatar.py), database words always as
// text, a picture named only by a key of the database's own shape, the card only for contact editors (app.can_edit
// ('contacts'): admin, manager, accountant) and fetched only when it is opened (never offline-cached, never static).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "../site/js/pages/avatar.js";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const read = (p) => readFileSync(join(SITE, p), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const statics = (src) => [...src.matchAll(/(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/g)].map((m) => m[1]);
const KEY = "17/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d.jpg";
const EVIL = '<img src=x onerror=alert(1)>';

test("initials and colours are DCR Desktop 2's (avatar.py initials, tone_for = crc32 of the trimmed lower-case name)", () => {
  // zlib.crc32 values from Python (the same function Desktop 2 calls)
  assert.equal(A.crc32(""), 0);
  assert.equal(A.crc32("hello"), 907060870);
  assert.equal(A.crc32("sam rivera"), 3296938555);
  assert.equal(A.crc32("josé núñez"), 983254826, "UTF-8 bytes, as Python encodes them");
  assert.equal(A.toneFor("  Sam   Rivera "), A.TONES[3296938555 % 8], "trimmed, any case, spaces collapsed");
  assert.equal(A.toneFor("Quarryman Concrete"), A.TONES[2189925328 % 8]);
  assert.equal(A.toneFor("Rosewell Concrete"), A.TONES[2203494233 % 8]);
  assert.deepEqual(A.TONES, ["#16A34A", "#2563EB", "#D97706", "#7C3AED", "#0891B2", "#C026D3", "#2563EB", "#059669"], "Desktop 2's daylight tones");
  const cases = [["Sample Client", "SC"], ["admin@x.example", "A"], ["office.manager@x.example", "OM"], ["", "?"], ["  jo  ", "J"],
    ["Mary-Jane Watson", "MW"], ["(no name)", "N"], ["émile zola", "ÉZ"], ["Sam R.", "SR"], [null, "?"]];
  for (const [n, want] of cases) assert.equal(A.initials(n), want, String(n));
});

test("avatarHtml: database words only as text; a picture only by a key of the database's shape; a button only for a live contact when asked", () => {
  const c = { id: 17, name: EVIL, company: "Rose<b>well</b>", picture_path: KEY };
  const s = A.avatarHtml(c, { size: 40 });
  assert.ok(!/<img|<b>|onerror=/i.test(s), "escaped: " + s);
  assert.match(s, /^<span class="av" style="--av:40px;background:#[0-9A-F]{6}" data-av-path="17\/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d\.jpg" data-av-id="17" aria-hidden="true">/);
  assert.ok(!/<button/.test(s), "not editable unless asked");
  for (const bad of ['17/x.jpg" onload="alert(1)', "../17/" + KEY, "javascript:alert(1)", "https://evil.example/x.jpg"]) {
    const t = A.avatarHtml({ id: 17, name: "Sam", picture_path: bad });
    assert.ok(!/data-av-path/.test(t) && !/onload|javascript|evil/.test(t), "never named: " + bad);
  }
  const b = A.avatarHtml({ id: 17, name: "Sam Rivera", picture_path: null }, { edit: true });
  assert.match(b, /^<button type="button" class="av av-edit" [^>]*data-av-contact="17" title="Picture, phone and e-mail of Sam Rivera" aria-label="Picture, phone and e-mail of Sam Rivera"><span class="av-i" aria-hidden="true">SR<\/span><\/button>$/);
  assert.ok(!/<button/.test(A.avatarHtml({ id: 17, name: "Sam", deleted_at: "2026-10-01T00:00:00Z" }, { edit: true })), "a deleted contact is not opened");
  assert.ok(!/<button/.test(A.avatarHtml({ id: "17 or 1=1", name: "Sam" }, { edit: true })), "only a real id");
  assert.ok(!/<button/.test(A.avatarHtml(null, { name: "Hillside Equipment Rental", edit: true })), "no contact, nothing to open");
  assert.match(A.avatarHtml(null, { name: "Hillside Equipment Rental" }), />HR<\/span>/, "a payee nobody linked: its initials");
  assert.match(A.avatarHtml({ id: 9, name: "", company: "Marlow Lumber Supply" }), />MS<\/span>/, "no name: the company");
  assert.match(A.avatarHtml({ id: 9, name: "Pat" }, { size: 4000 }), /--av:160px/, "a sane size");
});

test("paintAvatars draws a picture as an <img> it makes itself (never markup); a click opens the card, never the row around it", () => {
  const js = code(read("js/pages/avatar.js"));
  const paint = js.slice(js.indexOf("export async function paintAvatars"));
  assert.ok(paint.length > 200);
  assert.ok(!/innerHTML/.test(paint), "no markup built from a signed address");
  assert.match(paint, /document\.createElement\("img"\)/);
  assert.match(paint, /img\.src = url;/);
  assert.match(paint, /img\.addEventListener\("error", \(\) => img\.remove\(\)\)/, "a picture that will not load: initials again");
  assert.match(paint, /e\.stopPropagation\(\);/, "the check desk's row never opens from the avatar");
  assert.match(paint, /if \(e\.key === "Enter" \|\| e\.key === " "\) e\.stopPropagation\(\);/);
  assert.match(js, /const m = await import\("\.\/contact-card\.js"\);/, "the card is fetched when it is first opened");
  assert.ok(!/style=/.test(js.replace(/" style="--av:' \+ size \+ "px;background:" \+ toneFor\(name\) \+ '"'/, "")), "the only inline style: the size and a fixed tone");
});

test("the card: contact editors only; the contact read fresh; every database word as text; Ctrl+V on the card, never the page", () => {
  const js = code(read("js/pages/contact-card.js"));
  assert.match(js, /if \(!can\(o\.me, "contacts"\)\) \{ toast\(NOT_YOURS, "error"\); return null; \}/, "refused before anything is read");
  assert.match(js, /const got = await repo\.getContact\(contactId\);/);
  assert.match(js, /\$\("ccName"\)\.textContent = /);
  assert.match(js, /\$\("ccSub"\)\.textContent = subLine\(r\);/);
  assert.match(js, /\$\("ccPhone"\)\.value = r\.phone \|\| "";/);
  assert.match(js, /\$\("ccEmail"\)\.value = r\.email \|\| "";/);
  // no database value is concatenated into markup: the only innerHTML is the fixed frame, the escaped accept list, the
  // avatar (escaped) and the limits
  for (const m of js.matchAll(/innerHTML = ([\s\S]*?);\n/g)) {
    assert.ok(!/\br\.(name|company|phone|email|kind|notes)|st\.row\.(name|company|phone|email)/.test(m[1]), "markup from a row: " + m[1].slice(0, 120));
  }
  assert.match(js, /h\.addEventListener\("paste", /, "the card listens, not the document");
  assert.ok(!/document\.addEventListener\("paste"/.test(js));
  assert.match(js, /const pic = await prepare\(file, \{ maxSide: repo\.PICTURE_SIDE, square: true \}\);/, "400 x 400, square");
  assert.match(js, /saved\(await repo\.setPicture\(st\.row, pic\)\);/);
  assert.match(js, /saved\(await repo\.updateReach\(st\.row, change\)\);/);
  assert.match(js, /saved\(await repo\.clearPicture\(st\.row\)\);/);
  assert.match(js, /The rest of the contact is edited in DCR Desktop 2\./);
  assert.ok(!/capture=/.test(js), "a phone offers its camera and its library (no capture attribute)");
  assert.ok(!/\.from\(|\.rpc\(|storage\./.test(js), "the card writes only through repo/contacts.js");
});

test("the card takes only pictures from a paste or a drop (files or image items, never text)", async () => {
  // stand-ins for what the browser hands the page (pictureFiles needs no page)
  const { pictureFiles } = await import("../site/js/pages/contact-card.js");
  const png = new File([new Uint8Array(8)], "Screenshot.png", { type: "image/png" });
  const txt = new File(["hello"], "notes.txt", { type: "text/plain" });
  assert.deepEqual(pictureFiles(null), []);
  assert.deepEqual(pictureFiles({ files: [txt], items: [] }), [], "text never becomes a picture");
  assert.deepEqual(pictureFiles({ files: [txt, png], items: [] }), [png]);
  assert.deepEqual(pictureFiles({ files: [], items: [{ kind: "string", type: "text/html", getAsFile: () => png },
    { kind: "file", type: "image/png", getAsFile: () => png }] }), [png], "an image item, not the HTML");
  const heic = new File([new Uint8Array(8)], "IMG_0001.HEIC", { type: "" });
  assert.deepEqual(pictureFiles({ files: [heic] }), [heic], "an iPhone's picture without a type: its name says");
});

test("who sees the card: EDIT.contacts mirrors app.can_edit('contacts') (admin, manager, accountant)", async () => {
  const sh = code(read("js/pages/shell.js"));
  assert.match(sh, /contacts: \["admin", "manager", "accountant"\],/);
  const pages = code(read("js/pages/accounting.js")) + code(read("js/pages/search.js"));
  assert.match(pages, /allowed\(state\.me, "contacts"\)/, "The Books: only a contact editor's avatar opens the card");
  assert.match(pages, /avatarHtml\(it\.contact, \{ size: 40, edit: can\(me, "contacts"\) \}\)/, "Search too");
});

test("The Books: the payee's picture on the check desk and on the tell list, [Add phone / e-mail] for a contact editor; the desk read again after a save", () => {
  const js = code(read("js/pages/accounting.js"));
  assert.match(js, /'<td><div class="ck-payee">' \+ payeeHtml\(b, b\.payee, "\(no payee on file\)"\) \+ "<\/div>"/);
  assert.match(js, /function payeeHtml\(x, words, shown\) \{\n\s+if \(!words\) return h\(shown\);/, "no payee: the words alone, escaped");
  assert.match(js, /'<span class="av-t">' \+ h\(words\) \+ "<\/span><\/span>"/);
  assert.match(js, /state\.d\.links\.contacts\.get\(String\(x\.vendorContactId\)\)/, "the bill's OWN vendor contact (I20), never a guessed one");
  assert.match(js, /paintAvatars\(box, \{ me: state\.me, onSaved: contactSaved \}\);/);
  // release B (P5): the tell list is the Accounting page's own (js/pages/tell-payee.js) - its picture, its [Add phone /
  // e-mail] for a contact editor, and everything read again after a save (a phone just added is offered at once)
  assert.match(js, /groups\.map\(\(g\) => groupHtml\(g, ctx\)\)/);
  assert.match(js, /wireTell\(box, \{ me: state\.me, links: state\.d\.links,[^]*?onChanged: \(\) => \{ state\.refused = null; return load\(\); \} \}\);/);
  assert.match(js, /function contactSaved\(\) \{ return load\(\); \}/);
  const tp = code(read("js/pages/tell-payee.js"));
  assert.match(tp, /avatarHtml\(shown, \{ size: 28, name: g\.payee, edit: can\(c\.me, "contacts"\) \}\)/);
  assert.match(tp, /const edit = !!open && can\(c\.me, "contacts"\);/);
  assert.match(tp, /data-reach="' \+ h\(open\.id\) \+ '">Add phone \/ e-mail<\/button>/);
  assert.match(tp, /openCard\(b\.getAttribute\("data-reach"\), \{ me: c\.me, onSaved: changed \}\)/);
  assert.ok(!/\.approve\(|approve_bill/.test(js), "still approves nothing");
});

test("Search: a contact's picture or initials; the card from a contact editor's; read again after a save", () => {
  const js = code(read("js/pages/search.js"));
  assert.match(js, /if \(it\.contact\) \{\n\s+return '<div class="se-item se-contact">' \+ avatarHtml\(/);
  assert.match(js, /paintAvatars\(el\("seResults"\), \{ me: me, onSaved: function \(\) \{ setTimeout\(function \(\) \{ run\(el\("seInput"\)\.value\.trim\(\)\); \}, 0\); \} \}\);/);
  assert.match(read("search.html"), /\.se-item\.se-contact\{display:flex; align-items:center; gap:12px;\}/);
});

test("offline and money rules: avatar.js and repo/contacts.js are in the service worker's list (Search draws them), the card is not; nothing imports the card statically; no money code in them", () => {
  const sw = read("sw.js");
  for (const f of ["js/pages/avatar.js", "js/repo/contacts.js"]) assert.ok(sw.includes('"' + f + '"'), f + " in SHELL");
  assert.ok(!sw.includes('"js/pages/contact-card.js"'), "the card is fetched when opened");
  for (const f of walk(SITE).filter((p) => /\.(m?js|html)$/.test(p))) {
    const src = readFileSync(f, "utf8");
    for (const s of statics(src)) assert.ok(!/contact-card\.js/.test(s), f + ": a static import of the card");
  }
  for (const f of ["js/pages/avatar.js", "js/repo/contacts.js", "js/pages/contact-card.js"]) {
    const s = code(read(f));
    assert.ok(!/(repo|map)\/books\.js|money-mask|scrub-money|payments|bills/.test(statics(read(f)).join(" ")), f + ": no money code");
    assert.ok(!/[A-Za-z0-9._%+-]+@(?!example\.com\b)[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(s), f + ": no e-mail address but a made-up example.com one");
  }
  const repo = code(read("js/repo/contacts.js"));
  assert.match(repo, /c\.storage\.from\(PICTURE_BUCKET\)\.upload\(key, pic\.blob, \{ upsert: false, contentType: mime, cacheControl: "3600" \}\)/);
  assert.match(repo, /export const PICTURE_BUCKET = "contact-pictures";/);
  assert.ok(!/project-files/.test(repo), "never the project files' bucket (I5)");
});
