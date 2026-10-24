/* Opens the Construction Modeling Engine (cme.html) over the deck estimate (port of the old cme-launcher.js).

   An overlay iframe rather than a navigation: the estimate holds unsaved form state, and sending a rep away from
   it to draw and then back would either lose that or need a whole save-and-restore dance.

   open({entry, fresh, estimateId, clientName, title, upload(blob, name, {stable}) -> Promise<entry>,
         onNumbers(numbers), onSave(patch)})

   What changed from the old launcher:
   * the PNG goes into the private sales-media bucket through the page's own `upload` (repo/sales.js), not to the
     old server; a re-save of one drawing asks for the same object name (cme-<drawing id>.png) so one drawing owns
     one file (upload decides whether the bucket lets it replace the earlier one);
   * the message is taken only from the drawing's own frame (event.source), on this site's origin;
   * the handed-over drawing travels under a dcr2: sessionStorage key (Appendix C), and so does the client's name
     (personal data never goes into the frame's URL: a URL lands in the static host's access log and in the Referer
     of the drawing page's own requests);
   * the shell's buttons are listeners (no inline handler under the security policy).

   The drawing is written to the gallery entry's `cme` key, NEVER to `cad`: `cad` holds drawings made by the old
   portal's sketch tool, in a format this one cannot read, and overwriting it would leave those drawings unopenable
   by either tool. Browser-only module. */

export const HANDOFF_PREFIX = "dcr2:cmeHandoff:";

function el(id) { return document.getElementById(id); }
function dcr2() { return window.DCR2 || {}; }

let active = null;
let listening = false;

function ensureShell() {
  let shell = el("cmeShell");
  if (shell) return shell;
  shell = document.createElement("div");
  shell.id = "cmeShell";
  shell.innerHTML =
    '<div class="cme-backdrop"></div>' +
    '<div class="cme-frame-wrap">' +
      '<div class="cme-bar">' +
        '<span class="cme-title" id="cmeTitle"></span>' +
        '<span class="cme-hint">Save from inside the drawing to bring the numbers back.</span>' +
        '<button type="button" class="cme-close" id="cmeClose">✕ Close</button>' +
      "</div>" +
      '<iframe id="cmeFrame" title="Drawing" allow="fullscreen"></iframe>' +
    "</div>";
  document.body.appendChild(shell);

  const style = document.createElement("style");
  style.textContent =
    "#cmeShell{position:fixed;inset:0;z-index:4000;display:none;}" +
    "#cmeShell.open{display:block;}" +
    "#cmeShell .cme-backdrop{position:absolute;inset:0;background:rgba(5,8,10,.72);}" +
    "#cmeShell .cme-frame-wrap{position:absolute;inset:0;display:flex;flex-direction:column;}" +
    "#cmeShell .cme-bar{display:flex;align-items:center;gap:12px;padding:8px 12px;" +
      "background:#0d1114;color:#e6edf3;border-bottom:1px solid #223038;font:600 13px system-ui,Segoe UI,Arial;}" +
    "#cmeShell .cme-title{font-weight:800;}" +
    "#cmeShell .cme-hint{font-weight:400;color:#8aa0ad;margin-left:auto;}" +
    "@media (max-width:700px){#cmeShell .cme-hint{display:none;}}" +
    "#cmeShell .cme-close{background:#1b2733;color:#e6edf3;border:1px solid #33454f;border-radius:8px;" +
      "padding:6px 12px;font-weight:700;cursor:pointer;}" +
    "#cmeShell .cme-close:hover{background:#243544;}" +
    "#cmeShell iframe{flex:1;width:100%;border:0;background:#0d1114;}";
  document.head.appendChild(style);

  el("cmeClose").addEventListener("click", async () => {
    const c = dcr2().confirm;
    const leave = typeof c === "function"
      ? await c("Anything you have not saved to the estimate stays in the drawing on this device, " +
          "but it will not reach the estimate until you save.", { title: "Close the drawing?", okText: "Close" })
      : true;
    if (leave) close();
  });
  return shell;
}

export function close() {
  const shell = el("cmeShell");
  if (shell) {
    shell.classList.remove("open");
    el("cmeFrame").src = "about:blank";
  }
  document.body.style.overflow = "";
  for (const k of [active && active._handoffKey, active && active._contextKey]) {
    if (k) { try { sessionStorage.removeItem(k); } catch (e) { /* */ } }
  }
  active = null;
}

/** "data:image/png;base64,…" -> Blob */
export function dataUrlBlob(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(String(dataUrl || ""));
  if (!m) throw new Error("The drawing image is not readable.");
  const mime = m[1] || "application/octet-stream";
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** The entry patch a saved drawing becomes (pure: the tests check it never names `cad`). */
export function drawingPatch(uploaded, payload, savedAt) {
  const patch = {
    path: uploaded.path,
    name: uploaded.name,
    mime: uploaded.mime || "image/png",
    cme: {
      version: 1,
      project: payload.project,
      numbers: payload.numbers,
      takeoff: payload.takeoff,
      breakdown: payload.breakdown,
      savedAt: savedAt || new Date().toISOString(),
    },
  };
  if ("cad" in patch) throw new Error("refusing to overwrite a legacy drawing");
  return patch;
}

/** One drawing, one file: its object name comes from the drawing's own id when that id is a plain one. */
export function drawingName(projectId) {
  const stable = Boolean(projectId) && /^[0-9a-zA-Z-]{8,64}$/.test(String(projectId));
  return { name: stable ? "cme-" + projectId + ".png" : "drawing-" + Date.now() + ".png", stable };
}

async function onMessage(event) {
  if (event.origin !== location.origin) return;
  const frame = el("cmeFrame");
  if (!frame || event.source !== frame.contentWindow) return;
  const data = event.data || {};
  if (data.type !== "dcr.cme.save" || !active) return;

  const payload = data.payload || {};
  const handlers = active;
  try {
    const projectId = payload.project && payload.project.id;
    const nm = drawingName(projectId);
    const blob = dataUrlBlob(payload.png);
    const ext = blob.type === "image/jpeg" ? ".jpg" : ".png";
    const up = await handlers.upload(blob, nm.name.replace(/\.png$/, ext), { stable: nm.stable });
    const patch = drawingPatch(up, payload);
    if (payload.removedRecordings) {
      console.warn("[CME] " + payload.removedRecordings + " voice recording(s) were not saved with the drawing.");
    }
    /* Numbers land only AFTER the upload succeeded - applying them first put quantities on the estimate for a
       drawing whose save then failed. */
    if (payload.numbers && handlers.onNumbers) handlers.onNumbers(payload.numbers);
    if (handlers.onSave) handlers.onSave(patch);
    /* Close only the session this save belongs to: a slow save finishing after the person closed and opened a
       SECOND drawing must not tear the second session down mid-edit. */
    if (active === handlers) close();
  } catch (error) {
    console.error("[CME] could not save the drawing", error);
    const a = dcr2().alert;
    if (typeof a === "function") {
      await a((error && error.message) || "The drawing could not be saved.", { title: "Not saved" });
    }
  }
}

export function open(options) {
  options = options || {};
  if (!listening) { window.addEventListener("message", onMessage); listening = true; }
  const shell = ensureShell();
  active = options;

  const entry = options.entry;
  const params = new URLSearchParams();
  if (options.estimateId) params.set("estimateId", options.estimateId);
  if (options.fresh) params.set("cmeFresh", "1");
  if (entry && entry.path) params.set("entryId", String(entry.path).split("/").pop());

  /* Sweep strays first: a key left by an open-then-close (the iframe never consumed it) would sit forever, and stale
     handoffs quietly beat fresher saved copies on later opens. */
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.indexOf(HANDOFF_PREFIX) === 0) sessionStorage.removeItem(k);
    }
  } catch (e) { /* no storage: nothing to sweep */ }

  /* The client's name (personal data) travels the same way - never in the URL, which the static host logs and the
     drawing page's requests would carry as their Referer. */
  if (options.clientName) {
    const key = HANDOFF_PREFIX + "ctx-" + Date.now();
    try {
      sessionStorage.setItem(key, JSON.stringify({ clientName: String(options.clientName).slice(0, 200) }));
      params.set("cmeContext", key);
      options._contextKey = key;
    } catch (e) {
      console.warn("[CME] could not hand over the client's name", e);
    }
  }

  /* An existing drawing travels through sessionStorage: same-origin, survives the iframe load, no length limit,
     read once and deleted — none of which is true of a URL or a race-prone message. */
  if (entry && entry.cme && entry.cme.project) {
    const key = HANDOFF_PREFIX + Date.now();
    try {
      sessionStorage.setItem(key, JSON.stringify(entry.cme.project));
      params.set("cmeHandoff", key);
      options._handoffKey = key;
    } catch (e) {
      console.warn("[CME] could not hand over the existing drawing", e);
    }
  }

  el("cmeTitle").textContent = options.title || "Drawing";
  el("cmeFrame").src = "cme.html?" + params.toString();
  shell.classList.add("open");
  document.body.style.overflow = "hidden";
}

export default { open, close, drawingPatch, drawingName, dataUrlBlob };
