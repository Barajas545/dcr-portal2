/* The Accounting page's reads (books-home.html; the Books program, release B part 2a; design-portal §7.1 with the build
   plan's I24: no accountant_desk RPC - the page reuses The Books' tested reads). Everything is read under row level
   security as `me`, and nothing at all without the financials switch (seesBooks(me) refuses before any read).

   * loadHome(me, o)    repo/books.js loadDesk (books_desk, the payments, the jobs, the contacts and quotes the payee is
                        found through, ...) plus the money messages of the last 45 days (repo/money-messages.js), my
                        texts still to send, the pending sub submissions (money editors), the reminder PC's status,
                        the templates, and the files of the payments of the last 30 days and of their bills (📎) ->
                        map/books-home.js buildHome's payload, with .desk (buildDesk's, for the pay panel and
                        resolvePayee), .pc, .templates and .can;
   * loadCounts(me)     the home page's "N to do" (counts only): books_desk and the payments, through the same
                        buildDesk / buildHome as the page - null without the financials switch (nothing read);
   * askedBy(me, ids)   the home page's approvals card: the latest ask about each bill -> Map billId -> {by, byName, at}. */

import { db, must, idOf, forbidden, pageAll } from "./_db.js";
import { nameBook } from "./people.js";
import * as books from "./books.js";
import * as mm from "./money-messages.js";
import { list as subsList } from "./submissions.js";
import { buildDesk, seesBooks, canMoney, canApprove } from "../map/books.js";
import { buildHome, homeCounts, lastAsked, paid30 } from "../map/books-home.js";
import { canReview } from "../map/submissions.js";
import { ymd } from "../map/pacific.js";

function noBooks() {
  const e = forbidden();
  e.message = "The Accounting page needs the financials switch. Ask an admin.";
  return e;
}

/** rows of `table` whose `col` is one of `ids`, 150 ids a read. */
async function byIds(c, table, cols, col, list) {
  const want = Array.from(new Set((list || []).filter((v) => v !== null && v !== undefined).map((v) => idOf(v))));
  const out = [];
  for (let i = 0; i < want.length; i += 150) {
    (must(await c.from(table).select(cols).in(col, want.slice(i, i + 150))) || []).forEach((r) => out.push(r));
  }
  return out;
}

/** Everything the Accounting page shows, read as `me` (see the header). */
export async function loadHome(me, opts) {
  if (!seesBooks(me)) throw noBooks();
  const o = opts || {};
  const desk = await books.loadDesk(me, o);
  const money = canMoney(me);
  const [messages, drafts, subs, pc, templates] = await Promise.all([
    mm.messages(me, { days: 45 }),
    money ? mm.drafts(me) : Promise.resolve([]),
    canReview(me) ? subsList(me).then((r) => r.all).catch(() => []) : Promise.resolve([]),
    mm.pcStatus().catch(() => null),
    mm.templates().catch(() => null),
  ]);
  // the files of the payments of the last 30 days (their own, then their bills'): the 📎 of the Paid list
  const c = await db();
  const paid = paid30(desk.payments || [], desk.byId, [], desk.today);
  const payIds = paid.map((p) => p.id);
  const billIds = paid.map((p) => p.billId);
  const [own, ofBills] = await Promise.all([
    payIds.length ? byIds(c, "current_files", books.FILE_COLS, "payment_id", payIds) : Promise.resolve([]),
    billIds.length ? byIds(c, "current_files", books.FILE_COLS, "bill_id", billIds) : Promise.resolve([]),
  ]);
  const seen = new Set();
  const files = own.concat(ofBills).filter((f) => (seen.has(String(f.id)) ? false : (seen.add(String(f.id)), true)));
  const home = buildHome(desk, { messages, drafts, subs, files }, { today: desk.today, me });
  home.desk = desk;
  home.pc = pc;
  home.templates = templates;
  home.can = { pay: money, mark: money, money, approve: canApprove(me), review: canReview(me) };
  return home;
}

/** The home page's counts (map/books-home.js homeCounts) from books_desk and the payments; null without the switch. */
export async function loadCounts(me) {
  if (!seesBooks(me)) return null;
  const [desk, payments] = await Promise.all([
    pageAll((cl) => cl.from("books_desk").select(books.DESK_COLS).order("id", { ascending: true })),
    books.paymentRows((cols) => pageAll((cl) => cl.from("payments").select(cols).order("id", { ascending: true }))),
  ]);
  const d = buildDesk({ bills: desk, desk, payments }, { today: ymd(new Date()) });
  return homeCounts(buildHome(d, {}, { today: d.today }));
}

/** The latest ask about each of these bills: Map String(billId) -> {by, byName, at} (approvers read it on Home). An
    older database, or anyone without the switch: an empty map. */
export async function askedBy(me, billIds) {
  const out = new Map();
  if (!seesBooks(me) || !billIds || !billIds.length) return out;
  let list;
  try { list = await mm.messages(me, { days: 45, kind: "approval_request" }); } catch (e) { return out; }
  if (!list) return out;
  const nameOf = await nameBook();
  billIds.forEach((id) => {
    const la = lastAsked(id, list);
    if (la) out.set(String(id), { by: la.by, byName: nameOf(la.by) || "", at: la.at });
  });
  return out;
}
