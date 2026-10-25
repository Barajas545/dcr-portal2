// Part 3: the pages' static rules (owner decisions 2026-10-24 D1, D2, D12, D13) — one New Project dialog for the Board
// and the project page (the Board's own modal gone, its Escape handler fixed), the Access tab for admins only, the
// project picture's controls (no capture attribute: camera and library), the picture never uploaded as it came, the
// cost dialog fetched on demand only (money code off crew phones, out of the offline list) with no delete, the
// Takeoffs tab's encoded Plans Archive link, the lead conversion's folder step and the service worker's list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const read = (rel) => readFileSync(join(SITE, rel), "utf8");
const code = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
const statics = (js) => Array.from(code(js).matchAll(/(?:^|[;\n])\s*import\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/g)).map((m) => m[1]);
function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p); }
  return out;
}

test("New Project: one shared dialog — the Board's own modal is gone, both pages import new-project.js, the Board's Escape no longer reads #bdNewModal", () => {
  const board = read("board.html");
  assert.ok(!/bdNewModal|id="npName"/.test(board), "board.html has no modal of its own");
  assert.match(board, /id="bdNewBtn"[^>]*hidden/);
  const bjs = read("js/pages/board.js");
  assert.ok(statics(bjs).includes("./new-project.js"));
  assert.ok(statics(read("js/pages/project.js")).includes("./new-project.js"));
  assert.ok(!/bdNewModal|npCreate|projectsRepo\.createProject/.test(code(bjs)), "the Board creates nothing itself");
  assert.match(code(bjs), /e\.key === "Escape" && !isNewOpen\(\) && el\("bdPanel"\)\.classList\.contains\("open"\)/);
  assert.match(code(bjs), /qs\("new"\) === "1"/, "board.html?new=1 opens it");
  const html = read("project.html");
  assert.match(html, /<button class="pj-btn" id="pjNew" type="button" hidden/);
  assert.match(code(read("js/pages/project.js")), /el\("pjNew"\)\.hidden = !ctx\.canWrite/);
});

test("New Project: one attempt — Create is blocked while its answer is on the way, a lost answer blocks every later Create, a dialog closed mid-create still says the number", () => {
  const js = code(read("js/pages/new-project.js"));
  assert.match(js, /if \(st\.busy\) \{/);
  assert.match(js, /if \(st\.lost\) \{ say\(LOST\); return; \}/);
  assert.match(read("js/pages/new-project.js"), /the project may have been created/);
  assert.match(js, /createdToast\(p\)/, "closed while creating: the number with its link");
  assert.match(js, /makeFolder\(p\)/);
  assert.match(js, /FOLDER_WAIT_MS = 8000/);
  assert.ok(!/console\./.test(js), "nothing typed is logged");
  assert.ok(!/\.rpc\(|\.from\(|functions\.invoke/.test(js), "through repo/ only");
  assert.match(code(read("js/pages/leads.js")), /makeFolder\(got\.project\)/, "a converted lead gets its folder too");
});

test("the Access tab: an admin's only (the button hidden for managers), ?tab=access, the repo's rpc", () => {
  const html = read("admin.html");
  assert.match(html, /id="tabAcc"[^>]*hidden>Access</);
  assert.match(html, /<section id="paneAcc" role="tabpanel"[^>]*hidden>/);
  assert.match(html, /Admins set prices, Estimator and OneDrive upload on <b>Access<\/b>/);
  const js = code(read("js/pages/admin.js"));
  assert.match(js, /el\("tabAcc"\)\.hidden = !\(state\.me && state\.me\.role === "admin"\)/);
  assert.match(js, /if \(which === "acc" && !\(state\.me && state\.me\.role === "admin"\)\) which = "emp"/);
  assert.match(js, /tab=access/);
  assert.match(js, /employees\.setAccess\(a, changes\)/);
});

test("the picture: 📷 and ✕ for project editors, a file input without capture (camera and library), JPEG / PNG / WebP / GIF / HEIC offered", () => {
  const html = read("project.html");
  const input = /<input type="file" id="pjThumbIn"[^>]*>/.exec(html);
  assert.ok(input, "the picture's input");
  assert.ok(!/capture/.test(input[0]), "no capture attribute");
  assert.match(input[0], /accept="image\/jpeg,image\/png,image\/webp,image\/gif,image\/heic,image\/heif"/);
  assert.match(html, /id="pjThumbEdit" type="button" hidden/);
  assert.match(html, /id="pjThumbDel" type="button" hidden/);
  const js = code(read("js/pages/project.js"));
  assert.match(js, /el\("pjThumbEdit"\)\.hidden = !ctx\.canWrite/);
  assert.match(js, /import\("\.\.\/thumb-prep\.js"\)/, "fetched when a picture is changed");
  assert.ok(!statics(read("js/pages/project.js")).some((s) => /thumb-prep/.test(s)));
  assert.match(js, /filesRepo\.removeFile\(row\)/, "a pointer that could not be set takes its file back");
});

test("the picture is always drawn again: prepare() has no path that hands the original file on", () => {
  const js = code(read("js/thumb-prep.js"));
  const body = js.slice(js.indexOf("export async function prepare("));
  assert.ok(body.length > 100);
  assert.ok(!/return\s+file\b|blob:\s*file\b|return\s*\{\s*blob:\s*file/.test(body), "never the original bytes");
  assert.match(body, /const blob = await encode\(target, out\.mime\)/);
  assert.match(body, /imageSize\(head\)/, "the size is read from the header first");
  assert.ok(body.indexOf("imageSize(head)") < body.indexOf("await decode(file)"), "before decoding");
});

test("the cost dialog: fetched on demand from the Expenses tab only (never statically, never on project.js), no delete anywhere, out of the offline list", () => {
  for (const f of walk(SITE).filter((p) => /\.(m?js|html)$/.test(p))) {
    const src = readFileSync(f, "utf8");
    for (const s of statics(src)) assert.ok(!/expense-dialog\.js|cost-form\.js/.test(s) || /project-expenses\.js$|expense-dialog\.js$/.test(f.replace(/\\/g, "/")),
      f + ": a static import of " + s);
  }
  const pj = code(read("js/pages/project.js"));
  assert.ok(!/expense-dialog/.test(pj), "project.js never names it");
  assert.match(code(read("js/pages/project-expenses.js")), /import\("\.\/expense-dialog\.js"\)/);
  const dlg = read("js/pages/expense-dialog.js");
  assert.ok(!/\.delete\(|soft_delete|Delete/.test(dlg), "no delete in the dialog");
  assert.ok(!/\.delete\(|soft_delete|removeVersioned/.test(read("js/repo/ledger.js")), "no delete in the repo");
  const tab = read("js/pages/project-expenses.js");
  assert.ok(!/\.delete\(|soft_delete|>Delete</.test(tab));
  assert.match(tab, /Costs can be added here or in DCR Desktop 2/);
  assert.match(tab, /Costs have no delete: correct one, /);
  assert.match(code(tab), /canTag\(ctx\.me\) \? '<button class="pj-btn pj-btn-sm pj-btn-primary" id="exAdd"/, "the button for money editors only");
  const sw = read("sw.js");
  for (const f of ["js/pages/expense-dialog.js", "js/map/cost-form.js", "js/pages/project-expenses.js"]) assert.ok(!sw.includes('"' + f + '"'), f + " is not kept on phones");
  for (const f of ["js/pages/new-project.js", "js/repo/onedrive.js", "js/map/access.js", "js/thumb-prep.js"]) assert.ok(sw.includes('"' + f + '"'), f + " is in SHELL");
});

test("the Takeoffs tab: the Plans Archive link is built with encodeURIComponent, and the old 'stay on the old portal' text is gone", () => {
  const js = read("js/pages/project-takeoffs.js");
  assert.match(js, /"#plans=" \+ encodeURIComponent\(n\)/);
  assert.match(js, /https:\/\/barajas545\.github\.io\/takeoff-web\/index\.html/);
  assert.match(js, /target="_blank" rel="noopener"/);
  assert.ok(!/stay on the old portal/.test(js));
  assert.match(js, /Floor-plan PDFs added in the Files tab go to the project's OneDrive/);
});

test("OneDrive: the pages reach the function only through repo/onedrive.js, which names no Microsoft host and no secret", () => {
  const od = read("js/repo/onedrive.js");
  assert.match(code(od), /op: "ensure_folder", project_id: pid/);
  assert.ok(!/sharepoint|graph\.microsoft|login\.microsoftonline|client_secret|tenant/i.test(code(od)));
  for (const f of walk(join(SITE, "js", "pages"))) assert.ok(!/functions\.invoke/.test(code(readFileSync(f, "utf8"))), f);
});
