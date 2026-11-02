/* Project log (activity) rows -> the old pages' log shape (BLUEPRINT 3.3.2, Appendix A):

     logDate <- created_at (an imported line keeps its original date there)
     logDescription <- text
     logUserName <- the author's profile name; "Juan · old portal" for an imported line
                    (created_by empty, author_name set); "" for the database's own lines
     projectID <- project_id   projectName / projectNumber <- the projects(number, name) embed

   An imported line may be up to 20,000 characters: foldText() cuts it for the list and the page
   offers "more". Amounts typed into notes are masked on screen for people without prices (Q28):
   the page passes its mask function (common2 DCR2.maskAmounts) as `mask`.

   Check-off notes (DCR Desktop 2.26, migration 20261103000100_activity_checkoff; the owner's request of
   2026-11-02): a note may be made as a to-do (todo) and any note can be ticked off — done_at / done_by,
   stamped by the database through set_note_done (anyone who may write notes ticks any note):
     todo <- todo (notes only)   done <- done_at set   doneAt <- done_at   doneBy <- done_by
     doneByName <- that person's profile name ("" when unknown or the account was removed)
   doneLabel() is "Done Nov 2 · Cristobal" (the Pacific day; the year when it is not this year);
   todosFirst() puts the open to-dos on top (oldest first), the rest as they came; withTodos() adds the open
   to-dos read on their own (any age) to a project's newest lines, each line once; checkHtml() /
   doneHtml() draw the box and the done line the three log views share.

   Pure module. */

import { activityAuthor } from "./legacy.js";
import { TZ } from "./pacific.js";

export const FOLD_AT = 600;          // characters shown before "more"
export const NOTE_MAX = 4000;        // activity_text_check for a person's note

export function toLogLine(row, nameOf, mask) {
  if (!row) return null;
  const pj = row.projects && !Array.isArray(row.projects) ? row.projects
    : (Array.isArray(row.projects) ? row.projects[0] : null);
  const text = String(row.text == null ? "" : row.text);
  return {
    id: row.id,
    projectID: row.project_id,
    projectName: pj ? (pj.name || "") : "",
    projectNumber: pj ? (pj.number || "") : "",
    logDate: row.created_at || null,
    logDescription: typeof mask === "function" ? mask(text) : text,
    logUserName: activityAuthor(row, nameOf),
    kind: row.kind || "note",
    imported: !row.created_by && !!row.author_name,
    createdBy: row.created_by || null,
    version: row.version == null ? 1 : Number(row.version),
    todo: (row.kind || "note") === "note" && !!row.todo,
    done: (row.kind || "note") === "note" && !!row.done_at,
    doneAt: row.done_at || null,
    doneBy: row.done_by || null,
    doneByName: row.done_by && typeof nameOf === "function" ? (nameOf(row.done_by) || "") : "",
  };
}

/** A to-do note not ticked off yet. */
export function isOpenTodo(line) {
  return !!line && line.kind === "note" && !!line.todo && !line.done;
}

/** "Nov 2" (the Pacific day), with the year when it is not `now`'s year. */
export function doneDay(v, now) {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d)) return "";
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" })
    .formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
  const nowYear = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric" }).format(now || new Date());
  return parts.month + " " + parts.day + (parts.year !== nowYear ? ", " + parts.year : "");
}

/** "Done Nov 2 · Cristobal" (the first name of whoever ticked it); "" when the note is not done. */
export function doneLabel(line, now) {
  if (!line || !line.done) return "";
  const first = String(line.doneByName || "").trim().split(/\s+/)[0] || "";
  return "Done " + doneDay(line.doneAt, now) + (first ? " · " + first : "");
}

/** The open to-dos first (oldest first: the order they were added), then the rest in the order given. */
export function todosFirst(lines) {
  const list = lines || [];
  const open = list.filter(isOpenTodo).slice().sort(function (a, b) {
    const x = String(a.logDate || ""), y = String(b.logDate || "");
    return x < y ? -1 : x > y ? 1 : Number(a.id) - Number(b.id);
  });
  return open.concat(list.filter(function (l) { return !isOpenTodo(l); }));
}

/** `lines` and the `todos` missing from them (by id; a line already there stays as it is): the Log tab's
    300 newest lines and every open to-do, however old. */
export function withTodos(lines, todos) {
  const list = (lines || []).slice();
  const have = new Set(list.map(function (l) { return String(l.id); }));
  (todos || []).forEach(function (t) {
    if (t && !have.has(String(t.id))) { have.add(String(t.id)); list.push(t); }
  });
  return list;
}

/** The box on a note: a button for people who may write notes (data-tick = the note's id, data-v = its
    version, data-done = "1" when ticked: a click asks for the other state); for everyone else a mark that
    only shows a to-do or a tick ("" on a plain note). Not on status or system lines. */
export function checkHtml(line, esc, canTick) {
  if (!line || line.kind !== "note") return "";
  const cls = "nt-box" + (line.done ? " done" : "") + (line.todo ? " todo" : "");
  const label = line.done ? "Take the tick off" : "Tick it off";
  if (canTick) {
    return '<button type="button" class="' + cls + '" data-tick="' + esc(String(line.id)) + '" data-v="' + esc(String(line.version)) +
      '" data-done="' + (line.done ? "1" : "0") + '" aria-pressed="' + (line.done ? "true" : "false") + '" aria-label="' + label +
      '" title="' + (line.done ? esc(doneLabel(line)) + " — tap to take the tick off" : "Tick it off — the date and your name are added") +
      '"></button>';
  }
  if (!line.done && !line.todo) return "";
  return '<span class="' + cls + ' ro" role="img" aria-label="' + (line.done ? esc(doneLabel(line)) : "To-do") + '"></span>';
}

/** The line under a ticked note ("✓ Done Nov 2 · Cristobal"), or the to-do mark of an open one. */
export function doneHtml(line, esc) {
  if (!line || line.kind !== "note") return "";
  if (line.done) return '<div class="nt-done" title="' + esc(line.doneAt ? new Date(line.doneAt).toLocaleString("en-US", { timeZone: TZ }) : "") +
    '">✓ ' + esc(doneLabel(line)) + "</div>";
  return line.todo ? '<div class="nt-todo">To-do</div>' : "";
}

/** {short, more}: the first FOLD_AT characters (cut at a word when one is near) and whether there
    is more to show. */
export function foldText(text, at) {
  const s = String(text == null ? "" : text);
  const n = at || FOLD_AT;
  if (s.length <= n) return { short: s, more: false };
  let cut = s.lastIndexOf(" ", n);
  if (cut < n * 0.7) cut = n;
  return { short: s.slice(0, cut).replace(/\s+$/, "") + "…", more: true };
}

/** A note as the database takes it: trimmed, 1..4000 characters; "" when there is nothing. */
export function cleanNote(text) {
  const t = String(text == null ? "" : text).replace(/\r\n?/g, "\n").trim();
  return t.length > NOTE_MAX ? t.slice(0, NOTE_MAX) : t;
}

/** Log lines grouped by project in the order they come (newest group first when the lines are
    newest first): [{pid, rows}]. */
export function groupByProject(lines) {
  const groups = [], idx = {};
  (lines || []).forEach(function (l) {
    const k = String(l.projectID == null ? "?" : l.projectID);
    if (!(k in idx)) { idx[k] = groups.length; groups.push({ pid: k, rows: [] }); }
    groups[idx[k]].rows.push(l);
  });
  return groups;
}
