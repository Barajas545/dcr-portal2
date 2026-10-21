/* DCR Agents 2, as an admin reads it (BLUEPRINT 2.3.5, migration M4 20261023000100_agents_core).

   * serverStatus()   rpc agents_server_status(): which computer runs DCR Agents 2 and when it was last seen
                      ({ready, server: {host, version, lastSeen, minutesAgo, online, standby, paused, lastError, …}
                      | null, lease, others, status, minutesAgo, generatedAt}). An admin only: anyone else is
                      refused (42501) by the database itself. */
import { db, must } from "./_db.js";

export async function serverStatus() {
  const c = await db();
  return must(await c.rpc("agents_server_status"));
}
