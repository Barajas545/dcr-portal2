/**
 * A File-shaped handle to a project that lives on a server.
 *
 * The reader never wants a whole file. It wants `size` up front and then a
 * handful of small `slice()`s — opening the estimator's 2.3 GB job costs about
 * 2 KB, and each sheet is fetched only when it is drawn. HTTP has had exactly
 * that operation since 1999, so a project on a server needs no download at
 * all: one Range request per slice. Opening a 155 MB plan set over the
 * network reads the same ~2 KB it reads from disk.
 *
 * That is why this exists rather than `await res.blob()`. Downloading first
 * would undo decision 1 of the whole port — nothing reads the whole file — and
 * a phone cannot hold 2.3 GB no matter how patient the estimator is.
 *
 * Measured against SharePoint's pre-authed download URLs, which is what the
 * portal hands over: `206 Partial Content`, `accept-ranges: bytes`,
 * `access-control-allow-origin: *`, and a preflight that allows `range`.
 *
 * Two things a server may do that would otherwise corrupt a read, both handled:
 *
 *   · **Ignore Range and answer 200 with the whole body.** The bytes are then
 *     the entire file, not the slice asked for. Trusting them would hand sheet
 *     1's pixels back for every sheet. The body is kept and sliced locally
 *     instead — one download, not one per sheet.
 *
 *   · **Expire the URL mid-session.** SharePoint's last about an hour and an
 *     afternoon on a plan set outruns that, so a slice that comes back 401/403
 *     mints a fresh URL and retries. Every slice that failed on the same
 *     expiry shares one renewal, and a slice that failed on a URL already
 *     replaced skips straight to the retry.
 *
 * Offsets are clamped into the file and treated as non-negative. `Blob.slice`
 * accepts negative offsets to mean "from the end"; nothing in the reader uses
 * them, and silently mapping them wrong is worse than not supporting them.
 */

/** A stale pre-authed URL, versus a genuinely missing or broken file. */
const EXPIRED = new Set([401, 403, 410]);

export class RemoteFile {
  /**
   * @param {object}   o
   * @param {string}   o.url           current download URL
   * @param {string}   o.name          file name, for the title bar and drafts
   * @param {number}   o.size          total bytes — the reader needs this up front
   * @param {number}  [o.lastModified] ms epoch; 0 means unknown
   * @param {Function}[o.renew]        async () => a fresh URL, when this one expires
   */
  constructor({ url, name, size, lastModified = 0, renew = null }) {
    if (!url) throw new Error('A project on the server needs a download link.');
    this.name = String(name || 'project.takeoff');
    this.size = Math.max(0, Number(size) || 0);
    this.lastModified = Number(lastModified) || 0;
    this.type = 'application/octet-stream';
    this.remote = true;              // save can tell it will have to pull pages down

    this._url = String(url);
    this._renew = typeof renew === 'function' ? renew : null;
    this._renewing = null;
    this._gen = 0;                   // bumped whenever _url is replaced
    this._whole = null;              // set only if the server ignores Range
  }

  /** End-exclusive, like `Blob.slice`. Reads nothing until `arrayBuffer()`. */
  slice(start = 0, end = this.size) {
    return new RemoteSlice(this, start, end);
  }

  async _bytes(start, end) {
    if (end <= start) return new ArrayBuffer(0);

    // A server that ignored Range once will ignore it again.
    if (this._whole) {
      const blob = await this._whole;
      return blob.slice(start, end).arrayBuffer();
    }

    const gen = this._gen;
    let res = await this._raw(start, end);
    if (!res.ok && EXPIRED.has(res.status) && this._renew) {
      // Only renew if this really was the URL that failed; another slice may
      // already have replaced it while this request was in flight.
      if (this._gen === gen) await this._renewUrl();
      res = await this._raw(start, end);
    }
    if (!res.ok) {
      throw new Error(
        `Could not read this project from the server (${res.status}). ` +
        'The link may have expired — reopen it from the portal.'
      );
    }

    const buf = await res.arrayBuffer();
    if (res.status === 206) return buf;

    // 200: Range was ignored and this is the entire file. Hold on to it, or
    // the next slice downloads all of it again, and the one after that.
    const blob = new Blob([buf]);
    this._whole = Promise.resolve(blob);
    return blob.slice(start, end).arrayBuffer();
  }

  _raw(start, end) {
    return fetch(this._url, {
      // HTTP ranges are inclusive at both ends; Blob.slice is not.
      headers: { Range: `bytes=${start}-${end - 1}` },
      credentials: 'omit',
    });
  }

  _renewUrl() {
    if (!this._renewing) {
      this._renewing = Promise.resolve()
        .then(() => this._renew())
        .then(url => {
          if (url) { this._url = String(url); this._gen += 1; }
        })
        .catch(() => { /* the retry will surface the real status */ })
        .then(() => { this._renewing = null; });
    }
    return this._renewing;
  }
}

/** One range of a RemoteFile. Blob-shaped for everything the reader does. */
class RemoteSlice {
  constructor(file, start, end) {
    const n = file.size;
    this._file = file;
    this._start = clamp(start, 0, n);
    this._end = clamp(end == null ? n : end, this._start, n);
    this.size = this._end - this._start;
    this.type = '';
    this.remote = true;
  }

  slice(start = 0, end = this.size) {
    return new RemoteSlice(this._file, this._start + clamp(start, 0, this.size),
                           this._start + clamp(end == null ? this.size : end, 0, this.size));
  }

  arrayBuffer() {
    return this._file._bytes(this._start, this._end);
  }

  /** Real bytes, for the one place that needs a genuine Blob: saving. */
  async blob() {
    return new Blob([await this.arrayBuffer()]);
  }
}

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
