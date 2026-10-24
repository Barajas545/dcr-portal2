/* The public subcontractor form's pure rules (submit.html): what each kind is called, which files can go, what is
   sent. The function (DCR Desktop 2 supabase/functions/subform/handler.ts) checks all of it again; these only save
   the sub a round trip and never decide anything. Pure: no DOM, no network (tests/p5c-sub-*.test.mjs). */

export const KINDS = ["Invoice", "Change order"];
export const SEARCH_MIN = 3;
export const MAX_DOC = 25 * 1024 * 1024;
export const OK_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "application/pdf"];
const BY_EXT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp", pdf: "application/pdf" };

/** The same fields mean different things for the two kinds, so they are relabelled rather than hidden: a change
    order still has a number and a date. */
export function kindCopy(kind) {
  const inv = kind !== "Change order";
  return {
    head: inv ? "The invoice" : "The change order",
    number: inv ? "Your invoice #" : "Your reference #",
    date: inv ? "Invoice date" : "Date of the change",
    desc: inv ? "What is this for?" : "What is the extra work, and why is it needed?",
    placeholder: inv ? "Describe the work you are billing for" : "Describe the extra work and what it covers",
  };
}

/** A file's type; a phone sometimes reports none for a HEIC, so the extension decides then. "" = not allowed. */
export function typeOf(file) {
  let type = String((file && file.type) || "").toLowerCase().split(";")[0].trim();
  if (!type) {
    const m = /\.([a-z0-9]+)$/i.exec(String((file && file.name) || ""));
    type = m ? BY_EXT[m[1].toLowerCase()] || "" : "";
  }
  return OK_TYPES.indexOf(type) === -1 ? "" : type;
}

export function fmtSize(n) {
  const b = Number(n) || 0;
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " MB";
  return Math.max(1, Math.round(b / 1024)) + " KB";
}

/** {ok: true, type, size, label} or {ok: false, message}. */
export function checkFile(file) {
  if (!file) return { ok: false, message: "" };
  const type = typeOf(file);
  if (!type) return { ok: false, message: "That file type cannot be accepted. Send a photo, a scan or a PDF." };
  if (!(file.size > 0)) return { ok: false, message: "That file is empty. Choose it again." };
  if (file.size > MAX_DOC) return { ok: false, message: "That file is larger than 25 MB. A photo of the invoice is usually enough." };
  return { ok: true, type, size: file.size, label: (file.name || "document") + " · " + fmtSize(file.size) };
}

/** How a found job reads in the list: "A041 — Deck rebuild" over "12 Cedar Ln, Pine Hollow". */
export function hitLines(p) {
  return {
    title: [p && p.number, p && p.name].filter(Boolean).join(" — "),
    where: [p && p.city].filter(Boolean).join(", "),       // the town only: the street is never sent (owner, 2026-10-23)
  };
}

export function pickedLabel(p) {
  const l = hitLines(p);
  return l.title + (l.where ? " · " + l.where : "");
}

/** What the page checks before sending anything: the three things only the page can know. */
export function localProblems(s) {
  const out = [];
  if (!s.project) out.push("Search for the job this is about, and pick it from the list.");
  if (!s.signed) out.push("Sign in the box before submitting.");
  if (!s.file) out.push("Attach a photo, scan or PDF of the paperwork.");
  return out;
}

/** The body of op "submit". f = the fields as typed; nothing is trimmed here (the function does it). */
export function payloadFor(s, f) {
  return {
    kind: KINDS.indexOf(s.kind) === -1 ? "Invoice" : s.kind,
    projectId: s.project ? String(s.project.id) : "",
    vendorCompany: f.company, contactName: f.contact, email: f.email, phone: f.phone,
    invoiceNumber: f.number, amount: f.amount, description: f.description,
    invoiceDate: f.date, dueDate: f.due,
    signatureName: f.signatureName, signature: f.signature,
    agree: f.agree === true,
    website: f.website,                              // the honeypot: always empty for a person
    document: s.file ? { type: s.file.type, size: s.file.size } : null,
  };
}
