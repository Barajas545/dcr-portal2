/* Marketing tasks, billable (BLUEPRINT 3.3.11 "Marketing tasks", Q17, Appendix A "mtasks"; migration M5c
   `marketing_tasks` + `marketing_task_prices`).

   * loadMarketing({prices})     every task the person may read (RLS: admin, manager, accountant, view-only); with the
                                 financials switch each task embeds its price row ('prices:marketing_task_prices(*)').
                                 Without it the embed is not even asked for: no answer carries the price column;
                                 plus the projects (names only, the shared read) for the groups and the project box;
   * addTask(fields, price)      an INSERT (admin, manager); the date defaults to today (company day); a price (financials)
                                 goes into its own row after the task (a refused price leaves the task, and says so);
   * updateTask(task, fields, price)   a versioned PATCH, then the price row at its own version;
   * toggleMark(task, key)       Done / Invoiced / Paid flipped, versioned (Done: the database stamps the completed day);
   * deleteTask(task)            a versioned DELETE. */

import { versioned, pageAll, idOf, db, must } from "./_db.js";
import { insertOne, removeVersioned, savePrice } from "./_rows.js";
import { loadProjects } from "./projects.js";
import { toTask, toTaskRow, togglePatch, checkTask, parsePrice, PRICE_TABLE, PRICE_KEY, PRICE_COL } from "../map/marketing.js";
import { ymd } from "../map/pacific.js";

export const TABLE = "marketing_tasks";
export const PRICE_EMBED = "*, prices:" + PRICE_TABLE + "(*)";

function bad(message) { return Object.assign(new Error(message), { code: "22023", status: 400 }); }

export async function loadMarketing(opts) {
  const withPrices = !!(opts && opts.prices);
  const [rows, projects] = await Promise.all([
    pageAll(function (c) { return c.from(TABLE).select(withPrices ? PRICE_EMBED : "*").order("id", { ascending: true }); }),
    loadProjects().catch(function () { return []; }),
  ]);
  return { tasks: rows.map(toTask), projects };
}

async function reRead(id, withPrices) {
  const c = await db();
  const rows = must(await c.from(TABLE).select(withPrices ? PRICE_EMBED : "*").eq("id", id)) || [];
  return rows.length ? toTask(rows[0]) : null;
}

async function writePrice(task, price) {
  if (price === undefined) return { task, priceError: null };
  try {
    const n = parsePrice(price);
    if (n === task.marketingTaskPrice || (n === null && task.prices === null)) return { task, priceError: null };
    const row = await savePrice(PRICE_TABLE, PRICE_KEY, idOf(task.id), PRICE_COL, n, task.priceVersion);
    return { task: Object.assign({}, task, { prices: row, marketingTaskPrice: row[PRICE_COL] === null || row[PRICE_COL] === undefined ? null : Number(row[PRICE_COL]), priceVersion: row.version }), priceError: null };
  } catch (e) {
    return { task, priceError: e };
  }
}

/** fields: {oldKey: value}; price: the typed price (financials only) or undefined. -> {task, priceError} */
export async function addTask(fields, price, today) {
  const why = checkTask(fields);
  if (why) throw bad(why);
  if (price !== undefined) parsePrice(price);                 // a bad amount stops the form before anything is sent
  const row = toTaskRow(fields);
  if (!row.task_date) row.task_date = today || ymd(new Date());
  const made = toTask(await insertOne(TABLE, row));
  if (price === undefined) return { task: made, priceError: null };
  made.prices = null;
  const got = await writePrice(made, price);
  return got.priceError ? got : { task: (await reRead(made.id, true).catch(function () { return null; })) || got.task, priceError: null };
}

/** -> {task, priceError} */
export async function updateTask(task, fields, price) {
  const why = checkTask(Object.assign({}, task, fields));
  if (why) throw bad(why);
  if (price !== undefined) parsePrice(price);
  const patch = toTaskRow(fields);
  const before = toTaskRow(Object.keys(fields || {}).reduce(function (m, k) { m[k] = task[k]; return m; }, {}));
  Object.keys(patch).forEach(function (col) { if (JSON.stringify(patch[col]) === JSON.stringify(before[col])) delete patch[col]; });
  let t = task;
  if (Object.keys(patch).length) {
    try {
      t = toTask(await versioned(TABLE, idOf(task.id), task.version, patch, task.prices !== undefined ? PRICE_EMBED : "*"));
      if (task.prices !== undefined && t.prices === undefined) t.prices = null;
    } catch (e) {
      if (e && e.current) e.current = toTask(e.current);
      throw e;
    }
  }
  return writePrice(t, price);
}

export async function toggleMark(task, key) {
  const patch = togglePatch(task, key);
  try {
    const t = toTask(await versioned(TABLE, idOf(task.id), task.version, patch, task.prices !== undefined ? PRICE_EMBED : "*"));
    return t;
  } catch (e) {
    if (e && e.current) e.current = toTask(e.current);
    throw e;
  }
}

export async function deleteTask(task) {
  try {
    return await removeVersioned(TABLE, { id: idOf(task.id), version: task.version });
  } catch (e) {
    if (e && e.current) e.current = toTask(e.current);
    throw e;
  }
}
