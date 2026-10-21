/* The DCR Agents 2 console relay, as an admin's page calls it (BLUEPRINT 3.3.10, migration M6
   20261024000100_agents_phase6). The only code that talks to the database for agents-console.html.

   * request(method, args)  rpc console_request(p_method, p_args): a new row of public.agents_console for the DCR
                            server to run -> {id, at}. The database re-reads the caller's role (an admin, live),
                            allows 20 open per admin, 60 a minute and 900 an hour.
   * get(id)                rpc console_get(p_id): one of the caller's OWN requests as the old GET
                            ?action=console&id= answered it {id, status, method, at, takenAt, doneAt, host, result
                            (the PC's data), error} - expired (new for more than 15 minutes) and lost (taken past its
                            timeout plus 2 minutes) worked out by the database on read; someone else's id and an
                            unknown one are the same PT404
   * cancel(id)             rpc console_cancel(p_id) -> {ok, status}: only while nobody has taken it
   * watchMine(uid, cb)     Realtime on this admin's own rows (live.js watch; RLS lets nobody else's through):
                            cb({type, new, old}) for each change, cb({type: "SUBSCRIBED"}) after each join
   * status()               rpc agents_server_status() (an admin's only; M6: ready, and consoleOn from the PC's
                            own heartbeat) */
import { db, must } from "./_db.js";
import { serverStatus } from "./agents.js";

export async function request(method, args) {
  const c = await db();
  return must(await c.rpc("console_request", { p_method: String(method || ""), p_args: args && typeof args === "object" ? args : {} }));
}

export async function get(id) {
  const c = await db();
  return must(await c.rpc("console_get", { p_id: String(id || "") }));
}

export async function cancel(id) {
  const c = await db();
  return must(await c.rpc("console_cancel", { p_id: String(id || "") }));
}

export async function watchMine(uid, cb) {
  const live = await import("../live.js");
  /* {lost: true}: the bridge hears {type: "LOST"} when the channel goes and the shell polls at its own pace again */
  return live.watch("agents_console", uid ? "admin_id=eq." + uid : "", cb, { lost: true });
}

export { serverStatus as status };
