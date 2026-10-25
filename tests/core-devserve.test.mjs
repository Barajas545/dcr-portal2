// The local demo server: 127.0.0.1 only, the stand-in in place of supabase-js in every page,
// site/ files never changed, nothing outside site/ served.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { injectDemo, startServer } from "../tools/devserve.mjs";

test("injectDemo swaps the library for the stand-in, before the first script", () => {
  const page = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="x">' +
    '<script src="js/config.js"></script>\n<script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js" crossorigin="anonymous"></script>\n' +
    '<script type="module" src="js/shell/index.js"></script></head><body></body></html>';
  const out = injectDemo(page);
  assert.ok(!/@supabase\/supabase-js@/.test(out), "the real library is not loaded in demo mode");
  const fake = out.indexOf('<script src="/__dev/fake-supabase.js"></script>');
  assert.ok(fake > out.indexOf("Content-Security-Policy"), "after the policy");
  assert.ok(fake < out.indexOf('src="js/config.js"'), "before every other script");
  assert.match(injectDemo("<html><head><title>x</title></head><body></body></html>"), /fake-supabase\.js"><\/script>\n<\/head>/);
});

test("the server: pages with the stand-in, the bundle, 404s, no way out of site/", async (t) => {
  const port = 18792 + Math.floor(Math.random() * 1000);
  const server = startServer(port);
  t.after(() => server.close());
  await new Promise((r) => server.once("listening", r));
  assert.equal(server.address().address, "127.0.0.1");
  const base = "http://127.0.0.1:" + port;
  const index = await (await fetch(base + "/")).text();
  assert.match(index, /\/__dev\/fake-supabase\.js/);
  assert.ok(!/<script\b[^>]*@supabase\/supabase-js@/.test(index), "the library's script tag is out (the policy still names its file)");
  const onDisk = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  assert.match(onDisk, /@supabase\/supabase-js@/, "site/ itself is untouched");
  assert.ok(!/__dev/.test(onDisk));
  const bundle = await fetch(base + "/__dev/fake-supabase.js");
  assert.equal(bundle.status, 200);
  const js = await bundle.text();
  assert.match(js, /DCR2Fake/);
  assert.match(js, /createClient/);
  assert.equal((await fetch(base + "/nope.html")).status, 404);
  assert.equal((await fetch(base + "/..%2F..%2Fpackage.json")).status, 403);
  assert.equal((await fetch(base + "/..%2fdocs%2fBLUEPRINT.md")).status, 403);
  // the Files tab's OneDrive part: served switched on in demo mode (tools/fake/p7-onedrive.js answers it); site/ untouched
  assert.match(await (await fetch(base + "/js/repo/onedrive.js")).text(), /^export const LIVE = true;/m);
  assert.match(readFileSync(new URL("../site/js/repo/onedrive.js", import.meta.url), "utf8"), /^export const LIVE = false;$/m);
  assert.match(js, /p7-onedrive\.js/, "the OneDrive broker's stand-in is in the bundle");
  const css = await fetch(base + "/css/styles.css");
  assert.match(css.headers.get("content-type"), /text\/css/);
  assert.equal(css.headers.get("cache-control"), "no-store");
});
