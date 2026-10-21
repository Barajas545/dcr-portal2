/* The DCR Agents 2 console relay, the pure pieces of an admin's page (BLUEPRINT 3.3.10, migration M6
   20261024000100_agents_phase6). The database answers in the old relay's JSON (rpc console_get works out
   expired and lost on read), so the console shell (js/console/shell.js, the old agents-console.js) and its
   eight tabs run unchanged; what is left here:

   * requestOf(answer)          rpc console_request's answer -> {id, at}
   * consoleServer(answer)      rpc agents_server_status's answer -> the old ?action=console&server=1 shape: ready
                                once the relay is in the database, consoleOn from the PC's own heartbeat when an
                                older status line did not lift it
   * httpError(err)             a database refusal -> the old portal's error ({status, message, data: {code,
                                error, retryAfter}}) the shell maps; a lost connection -> an Error with no status
   * isNetwork(err)             no answer from the database at all */

export const NOT_SET_UP = "Remote management is not in the database yet (it comes with Portal 2's phase 6).";
const CODE_RE = /^[a-z_]{2,20}$/;

const text = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** rpc console_request's answer -> {id, at}. */
export function requestOf(answer) {
  if (typeof answer === "string") return { id: text(answer), at: "" };
  if (!isObj(answer)) return { id: "", at: "" };
  return { id: text(answer.id), at: text(answer.at) };
}

/** rpc agents_server_status's answer -> the old ?action=console&server=1 answer. M6's status says ready and
    consoleOn itself; an M4-only database (ready false, consoleOn false) still names the PC's own heartbeat in
    `status`, so the console can say what the PC reports. */
export function consoleServer(answer) {
  if (!isObj(answer)) return answer;
  const out = Object.assign({}, answer);
  out.ready = true;
  const pay = isObj(answer.status) ? answer.status : {};
  if (isObj(answer.server)) {
    const srv = Object.assign({}, answer.server);
    if (srv.consoleOn !== true && pay.consoleOn === true && srv.standby !== true) srv.consoleOn = true;
    if (!text(srv.consoleAt) && text(pay.consoleAt)) srv.consoleAt = text(pay.consoleAt);
    if (!text(srv.assistantAt) && text(pay.assistantAt)) srv.assistantAt = text(pay.assistantAt);
    out.server = srv;
  }
  return out;
}

/* PostgREST and Postgres codes -> the old portal's HTTP status and code word (M4/M6 app.agents_refuse: 400 ->
   22023, 403 -> 42501, 404 -> PT404, 409 -> PT409, 413 -> PT413, 429 -> PT429, the word in the hint). */
const STATUS_OF = { "42501": 403, PGRST301: 401, PGRST302: 401, PGRST303: 401, PT404: 404, PGRST116: 404, PT409: 409, PT413: 413,
  PT429: 429, "22023": 400, "22P02": 400, "23514": 400, "23502": 400, "23503": 400, P0001: 400, PGRST202: 503, "42883": 503,
  "42P01": 503, PGRST205: 503 };
const WORD_OF = { 403: "forbidden", 401: "forbidden", 404: "not_found", 409: "changed", 413: "too_big", 429: "rate", 400: "bad_request", 503: "not_set_up" };

function parseJson(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch (e) { return null; }
}
function retryAfterOf(e) {
  const d = text(e && e.details);
  if (!d) return 0;
  const j = parseJson(d);
  if (isObj(j) && Number(j.retryAfter) > 0) return Math.ceil(Number(j.retryAfter));
  const m = /retry[ _-]?after\D{0,4}(\d{1,5})/i.exec(d) || /^(\d{1,5})$/.exec(d);
  return m ? Number(m[1]) : 0;
}

/** Is this a lost connection (no answer from the database at all)? */
export function isNetwork(e) {
  if (!e) return false;
  const code = text(e.code);
  if (code && (STATUS_OF[code] || /^[0-9A-Z]{5}$/.test(code))) return false;
  const msg = text(e.message).toLowerCase();
  return code === "NETWORK" || code === "offline" || e.name === "TypeError" || /failed to fetch|network|load failed|fetch failed|offline/.test(msg);
}

/** A database refusal as the old DCR.api threw it: {status, message, data: {code, error, retryAfter}}. */
export function httpError(e) {
  if (isNetwork(e)) {
    const x = new Error(text(e && e.message) || "Failed to fetch");
    x.code = "network";
    return x;
  }
  const code = text(e && e.code);
  let status = STATUS_OF[code] || Number(e && e.status) || 500;
  if (status === 406) status = 404;
  const hint = text(e && e.hint);
  const word = CODE_RE.test(hint) ? hint : WORD_OF[status] || "failed";
  const message = status === 503 ? NOT_SET_UP : text(e && e.message) || "That did not work.";
  const x = new Error(message);
  x.status = status;
  x.data = { code: word, error: message };
  const ra = retryAfterOf(e);
  if (ra) x.data.retryAfter = ra;
  return x;
}
