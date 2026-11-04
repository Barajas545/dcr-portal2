// plans-archive.js — the Plans Archive: plan files from a folder on this computer.
//
// The screens over js/core/plans-folder.js: the start-screen section that
// walks a person through choosing the folder once and reconnecting to it
// after each browser restart, the browser that lists every project in it and
// each project's plan files, and the short list of folders this device knows.
// Where no folder is opened (Firefox or Safari on a computer, any phone or
// tablet — even one whose browser has showDirectoryPicker), the panel a
// #plans link shows instead: linkPanel, over js/core/plans-link.js.
//
// Opening a file is not done here. The host (main.js) opens a .takeoff with
// its file handle — so Save writes back into the folder — and starts a new
// takeoff from a PDF, with Save As starting in that PDF's folder.
//
// Two browser rules shape every click handler below:
//
//   · showDirectoryPicker() and requestPermission() only run inside a click,
//     so each handler that needs one calls it FIRST, before anything else
//     it awaits;
//   · a folder handle's permission lasts until the browser closes, unless the
//     person ticks "Allow on every visit" — so "Reconnect" is an ordinary
//     step of starting the app, not an error, and is worded as one.

import * as D from './dialogs.js';
import {
  describeChosenFolder, listTopFolders, walkPlans, isOneDriveArchive,
  permissionOf, askPermission, parseProjectCode, projectCodeOf, compareCodes, restOfName,
} from '../core/plans-folder.js';
import {
  INVALID_LINK, isPhoneOrTablet, canOpenArchiveFolder, linkPanelModel, copyText,
} from '../core/plans-link.js';

const UNSUPPORTED =
  'Opening plans from a folder needs Chrome or Edge on a computer. On a phone '
  + 'or a tablet, use “Open a .takeoff project” and pick the file in the '
  + 'OneDrive app — then File › Keep on This Device keeps it here, to open '
  + 'with no internet from the list below.';

// The twin: a computer that synced the old SharePoint library has a folder of
// the same name there, and a save into it goes to SharePoint.
const NOT_ONEDRIVE =
  'This computer may also have the old SharePoint copy of the Plans Archive, '
  + 'with the same name, inside the synced SharePoint library\'s folder. Saving '
  + 'there would write into SharePoint. Choose “DCR - Floor Plans - Archive” '
  + 'in the company OneDrive — the one in your own OneDrive folder, or the one '
  + 'shared with you from it.';

export class PlansArchive {
  /**
   * @param {object} o
   * @param {import('../core/plans-folder.js').PlansFolders} o.store
   * @param {object} o.host  { mode() → 'folder'|'sharepoint', status(text),
   *                           refreshStart(), openTakeoff(entry) → Promise<bool>,
   *                           startFromPdf(entry) → Promise,
   *                           devicePlans() → { kept, portal },
   *                           devicePlanRows({ kept, portal }, { beforeOpen }) → Node[],
   *                           openFile({ beforeOpen }) — the start screen's "Open a .takeoff project" }
   *        (`beforeOpen` runs only once the open goes ahead: past "Unsaved
   *        changes", and for openFile once a file is chosen)
   * @param {Window} [o.win]
   */
  constructor({ store, host, win = window }) {
    this.store = store;
    this.host = host;
    this.win = win;
    // A link asked for a project before the folder was ready: opened once it is.
    this.pending = null;
    this._renderSeq = 0;
    // The link panel on screen, if any: a second link replaces it.
    this._linkClose = null;
  }

  /**
   * Chrome or Edge on a computer. A phone or a tablet never opens the folder,
   * even where its browser has showDirectoryPicker (Chrome for Android 132+):
   * it is told to pick the file in the OneDrive app (UNSUPPORTED), and a
   * #plans link shows its panel.
   */
  supported() { return canOpenArchiveFolder(this.win); }

  /** Every folder this device knows, with whether the browser lets it be read now. */
  async folders() {
    const all = await this.store.list();
    return Promise.all(all.map(async rec => ({ rec, perm: await permissionOf(rec.handle) })));
  }

  /**
   * The folders that can be read now. Once plans come from the folder, only
   * the OneDrive Plans Archive counts (it holds the marker): a remembered folder
   * that is SharePoint's synced twin is never browsed or saved into.
   */
  async readyFolders() {
    const strict = this.host.mode() === 'folder';
    const out = [];
    for (const f of await this.folders()) {
      if (f.perm !== 'granted') continue;
      if (strict && !(await isOneDriveArchive(f.rec.handle))) continue;
      out.push(f.rec);
    }
    return out;
  }

  /** Where a file handle sits inside one of the folders, or null. */
  async locate(handle) {
    if (!handle) return null;
    const strict = this.host.mode() === 'folder';
    for (const rec of await this.store.list()) {
      if (strict && !(await isOneDriveArchive(rec.handle))) continue;     // the synced twin: not the archive
      try {
        const parts = await rec.handle.resolve(handle);
        if (Array.isArray(parts) && parts.length) {
          // The folder the file sits in, for Save As to start in.
          let dir = rec.handle;
          try {
            for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
          } catch { dir = null; }
          return {
            folderId: rec.id, folderName: rec.name, parts, dir,
            code: projectCodeOf(parts[0]), project: parts.length > 1 ? parts[0] : '',
            path: parts.slice(1, -1).join(' / '),
          };
        }
      } catch { /* not inside this one, or the browser will not say */ }
    }
    return null;
  }

  // ── the start screen ────────────────────────────────────────────────────

  /**
   * Fill the start screen's Plans Archive section. In the SharePoint way of
   * working it shows only once someone has chosen a folder on this device —
   * trying it out is opt-in until the switch.
   */
  async renderStart(box) {
    if (!box) return;
    const seq = ++this._renderSeq;
    const mode = this.host.mode();
    const supported = this.supported();
    const states = supported ? await this.folders() : [];
    const recent = supported && states.length ? await this.store.recent() : [];
    if (seq !== this._renderSeq) return;          // a newer render is on its way

    if (!supported) {
      box.hidden = mode !== 'folder';
      box.replaceChildren();
      if (mode === 'folder') {
        box.appendChild(head());
        box.appendChild(D.el('p', 'es-arch-note', UNSUPPORTED));
      }
      return;
    }
    if (mode !== 'folder' && !states.length) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }

    // After the switch a remembered folder without the marker (SharePoint's
    // synced twin, chosen while trying the folder out) is said, never used.
    const twins = [];
    if (mode === 'folder') {
      for (const st of states) {
        if (st.perm === 'granted' && !(await isOneDriveArchive(st.rec.handle))) twins.push(st);
      }
      if (seq !== this._renderSeq) return;
    }
    const parts = [head(states.length ? () => this.manage() : null)];
    for (const t of twins) {
      parts.push(D.el('p', 'es-arch-note',
        `${t.rec.name} on this device is not the OneDrive Plans Archive, so it is not used. `
        + 'Remove it under Folders and choose the OneDrive one. ' + NOT_ONEDRIVE));
    }
    if (states.length === twins.length) {
      parts.push(D.el('p', 'es-arch-note',
        'Plan files are kept in the Plans Archive folder in OneDrive. Choose it '
        + 'once on this computer and every plan opens from here — and saves back '
        + 'into it.'));
      const b = D.el('button', 'es-btn primary es-arch-btn', 'Choose your Plans Archive folder');
      b.type = 'button';
      b.addEventListener('click', () => { void this.choose(); });
      parts.push(b);
    } else {
      const waiting = states.filter(s => s.perm !== 'granted');
      const ready = states.filter(s => s.perm === 'granted' && !twins.includes(s));
      if (ready.length) {
        const row = D.el('div', 'es-arch-row');
        const find = D.input('', 'search', {
          placeholder: 'Project number or name', 'aria-label': 'Find a project in the Plans Archive',
        });
        find.className = 'es-arch-find';
        find.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') { ev.preventDefault(); void this.browse({ query: find.value }); }
        });
        const b = D.el('button', 'es-btn primary es-arch-btn', 'Browse the Plans Archive');
        b.type = 'button';
        b.addEventListener('click', () => { void this.browse({ query: find.value }); });
        row.append(find, b);
        parts.push(row);
      }
      for (const s of waiting) {
        const b = D.el('button', `es-btn es-arch-btn${ready.length ? '' : ' primary'}`,
          `Reconnect to ${s.rec.name}`);
        b.type = 'button';
        b.addEventListener('click', () => { void this.reconnect(s.rec); });
        parts.push(b);
      }
      if (waiting.length) {
        parts.push(D.el('p', 'es-arch-note',
          'The browser asks once each time it starts. Choose “Allow on every '
          + 'visit” when it offers, and this step goes away.'));
      }
      // never a recent file of a folder that is not used (SharePoint's synced twin)
      const shown = recent.filter(r => !twins.some(t => t.rec.id === r.folderId));
      if (shown.length) {
        const list = D.el('div', 'es-lib-list es-arch-recent');
        for (const r of shown.slice(0, 6)) list.appendChild(this._recentItem(r));
        parts.push(D.el('div', 'es-arch-sub', 'Recently opened'), list);
      }
    }
    box.replaceChildren(...parts);
    box.hidden = false;

    function head(onFolders) {
      const h = D.el('div', 'es-lib-head');
      h.appendChild(D.el('span', null, 'Plans Archive'));
      if (onFolders) {
        const m = D.el('button', 'es-lib-manage', 'Folders');
        m.type = 'button';
        m.addEventListener('click', onFolders);
        h.appendChild(m);
      }
      return h;
    }
  }

  _recentItem(r) {
    const b = D.el('button', 'es-lib-item');
    b.type = 'button';
    b.appendChild(D.el('span', 'es-lib-title', r.code ? `${r.code} — ${r.name}` : r.name));
    const where = [r.folderName, r.project && r.project !== r.code ? r.project : '', r.path]
      .filter(Boolean).join(' / ');
    if (where) b.appendChild(D.el('span', 'es-lib-file', where));
    const facts = [fmtSize(r.size), r.openedAt ? `opened ${fmtDay(r.openedAt)}` : '']
      .filter(Boolean).join(' · ');
    if (facts) {
      const meta = D.el('span', 'es-lib-meta');
      meta.appendChild(D.el('span', null, facts));
      b.appendChild(meta);
    }
    b.addEventListener('click', () => { void this.openRecent(r); });
    return b;
  }

  async openRecent(r) {
    // The folder's own permission first — one "allow" then covers every file
    // in it — and only then the file's, both while this click still counts.
    const root = (await this.store.list()).find(f => f.id === r.folderId);
    if (root && (await permissionOf(root.handle)) !== 'granted') await askPermission(root.handle);
    if (this.host.mode() === 'folder' && !(root && (await isOneDriveArchive(root.handle)))) {
      await D.alertDialog('Not the OneDrive Plans Archive',
        `${r.name} was opened from a folder that is not the OneDrive Plans Archive, `
        + 'so it is not opened from there now.\n\n' + NOT_ONEDRIVE);
      return;
    }
    let perm = await permissionOf(r.handle);
    if (perm !== 'granted') perm = await askPermission(r.handle);
    if (perm !== 'granted') {
      this.host.status(`The browser was not allowed to open ${r.name}.`);
      return;
    }
    try {
      await r.handle.getFile();
    } catch {
      await this.store.dropRecent(r.id);
      await D.alertDialog('Not in the folder any more',
        `${r.name} is no longer where it was — it may have been moved, renamed `
        + 'or deleted, or OneDrive is still bringing it down. Browse the Plans '
        + 'Archive to find it again.');
      this.host.refreshStart();
      return;
    }
    await this.host.openTakeoff({
      handle: r.handle, dir: r.dir, name: r.name, kind: 'takeoff', path: r.path,
      code: r.code, project: r.project, folderId: r.folderId, folderName: r.folderName,
    });
  }

  // ── choosing and reconnecting ───────────────────────────────────────────

  /**
   * Choose a folder. Call it straight from a click: the picker is the first
   * thing it does. Resolves the folder record, or null when nothing was chosen.
   */
  async choose() {
    if (!this.supported()) {
      await D.alertDialog('Plans Archive', UNSUPPORTED);
      return null;
    }
    let handle;
    try {
      handle = await this.win.showDirectoryPicker({ id: 'ptt-plans-archive', mode: 'readwrite' });
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      await D.alertDialog('Could not use that folder',
        `${err && err.message ? err.message : err}\n\nSome folders — the whole `
        + 'drive, Windows, your user folder itself — cannot be chosen. Choose the '
        + 'Plans Archive folder inside your OneDrive.');
      return null;
    }

    let look;
    try { look = await describeChosenFolder(handle); } catch { look = { projects: 0 }; }
    if (!look.projects) {
      if (look.suggestion) {
        const ok = await D.confirmDialog('Use the folder inside it?',
          `${handle.name} holds no project folders itself, but ${look.suggestion.name} `
          + `inside it holds ${look.suggestion.projects}. Use ${look.suggestion.name}?`,
          { okLabel: `Use ${look.suggestion.name}` });
        if (ok) handle = look.suggestion.handle;
        else return null;
      } else {
        const ok = await D.confirmDialog('No project folders in it',
          (look.isProjectFolder
            ? `${handle.name} is one project's folder. `
            : `${handle.name} holds no folders named by a project number (A249, A250 …). `)
          + 'The Plans Archive is the folder that holds all the project folders.'
          + '\n\nUse this folder anyway?',
          { okLabel: 'Use it anyway' });
        if (!ok) return null;
      }
    }

    // The OneDrive Plans Archive holds the marker; SharePoint's synced folder
    // of the same name does not. After the switch the twin is refused; before
    // it, trying a folder out is still allowed, with the warning.
    if (!(await isOneDriveArchive(handle))) {
      if (this.host.mode() === 'folder') {
        await D.alertDialog('Not the OneDrive Plans Archive',
          `${handle.name} is not the company's Plans Archive in OneDrive (it does not hold the `
          + 'file “_DCR Plans Archive - OneDrive.txt”), so plans cannot be opened or saved there.\n\n' + NOT_ONEDRIVE);
        return null;
      }
      const ok = await D.confirmDialog('Not the OneDrive Plans Archive yet',
        `${handle.name} does not hold the file “_DCR Plans Archive - OneDrive.txt” that marks the `
        + 'OneDrive Plans Archive (the plans are copied there on the switch day).\n\n' + NOT_ONEDRIVE
        + '\n\nUse this folder only to try the app out?', { okLabel: 'Use it to try' });
      if (!ok) return null;
    }

    let added;
    try {
      added = await this.store.add(handle);
    } catch (err) {
      await D.alertDialog('Could not keep the folder', err.message || String(err));
      return null;
    }
    this.host.status(added.existed
      ? `${added.record.name} was already listed.`
      : `${added.record.name} is your Plans Archive on this computer now.`);
    this.host.refreshStart();
    await this._continuePending();
    return added.record;
  }

  /** Ask the browser to let this folder be read again. Straight from a click. */
  async reconnect(rec) {
    const st = await askPermission(rec.handle);
    if (st !== 'granted') {
      this.host.status(`The browser was not allowed to open ${rec.name}.`);
      this.host.refreshStart();
      return false;
    }
    this.host.refreshStart();
    await this._continuePending();
    return true;
  }

  async _continuePending() {
    if (!this.pending) return;
    if (!(await this.readyFolders()).length) return;
    const p = this.pending;
    this.pending = null;
    await this.browse({ code: p.code || '', query: p.code || '' });
  }

  /**
   * The File menu's "Plans Archive…": browse it, or get it ready first. From
   * a click, so a reconnect or the picker can still be asked for.
   */
  async open() {
    if (!this.supported()) { await D.alertDialog('Plans Archive', UNSUPPORTED); return; }
    const states = await this.folders();
    if (!states.length) { this.pending = { code: '' }; await this.choose(); return; }
    if (!states.some(s => s.perm === 'granted')) {
      if (!(await this.reconnect(states[0].rec))) { await this.manage(); return; }
    }
    await this.browse();
  }

  /**
   * A `#plans` / `#plans=A249` link. Opens the browser when the folder can be
   * read; otherwise says which step comes first and remembers the project.
   * Where no folder can be opened at all, the link panel (linkPanel).
   */
  async openLink(link) {
    const code = (link && link.code) || '';
    const invalid = !!(link && link.invalid);
    if (invalid) this.host.status(INVALID_LINK);
    if (!this.supported()) { await this.linkPanel({ code, invalid }); return; }
    const states = await this.folders();
    if (states.some(s => s.perm === 'granted')) { await this.browse({ code, query: code }); return; }
    this.pending = { code };
    const what = code ? `the plans for ${code}` : 'the Plans Archive';
    this.host.status(states.length
      ? `Press “Reconnect” below to open ${what}.`
      : `Choose your Plans Archive folder below to open ${what}.`);
    this.host.refreshStart();
  }

  /**
   * A link that landed where this browser cannot open a folder — Firefox or
   * Safari on a computer, any phone or tablet. "Plans for A249": that job's
   * plans already kept on this device, each opened by the start screen's own
   * open path; "Open a .takeoff project", with where to pick the file; and on
   * a computer, the link itself to copy into Edge or Chrome. A dialog, so a
   * link followed into a tab with a project open shows it too.
   */
  async linkPanel({ code = '', invalid = false } = {}) {
    if (this._linkClose) this._linkClose(null);
    let plans = { kept: [], portal: [] };
    try { plans = this.host.devicePlans() || plans; } catch { /* storage blocked: nothing listed */ }
    const handheld = isPhoneOrTablet(this.win);
    const m = linkPanelModel({
      code, invalid, handheld, kept: plans.kept, portal: plans.portal,
      pageHref: (this.win.location && this.win.location.href) || '',
    });
    let mine = null;
    await D.showDialog(close => {
      mine = close;
      this._linkClose = close;
      const body = D.el('div', 'pl');
      if (m.invalidNote) body.appendChild(D.el('p', 'pa-note pa-warn', m.invalidNote));

      const head = D.el('div', 'es-lib-head');
      head.appendChild(D.el('span', null, 'Plans on this device'));
      body.appendChild(head);
      if (m.count) {
        const list = D.el('div', 'es-lib-list pl-list');
        list.append(...this.host.devicePlanRows({ kept: m.kept, portal: m.portal }, { beforeOpen: () => close(null) }));
        body.appendChild(list);
      } else {
        body.appendChild(D.el('p', 'pa-note pl-empty', m.emptyText));
      }

      // Straight from the click, no await first: Firefox and Safari open the
      // file picker only while the tap still counts. The panel stays until a
      // file is chosen, so backing out of "Unsaved changes" or of the picker
      // comes back to it — the link it came from is gone from the address.
      const open = D.el('button', 'es-btn primary es-arch-btn pl-btn pl-open', 'Open a .takeoff project');
      open.type = 'button';
      open.addEventListener('click', () => { this.host.openFile({ beforeOpen: () => close(null) }); });
      body.append(open, D.el('p', 'pa-note pl-hint', m.openHint));

      if (m.browserNote) {
        const other = D.el('div', 'pl-other');
        other.appendChild(D.el('p', 'pa-note', m.browserNote));
        if (m.href) {
          const row = D.el('div', 'pl-copy');
          const copy = D.el('button', 'es-btn es-arch-btn pl-btn pl-copy-btn', 'Copy link');
          copy.type = 'button';
          let shown = null;
          const showLink = () => {
            // The clipboard said no: the link itself, selected, to copy by hand.
            if (!shown) {
              shown = D.input(m.href, 'text', { readonly: '', 'aria-label': 'The link to these plans', spellcheck: 'false' });
              shown.className = 'pl-link';
              shown.addEventListener('focus', () => shown.select());
              other.append(D.el('p', 'pa-note', 'Copy this link, then open it in Edge or Chrome:'), shown);
            }
            shown.focus();
            shown.select();
          };
          copy.addEventListener('click', async () => {
            if (await copyText(this.win.navigator, m.href)) {
              copy.textContent = 'Link copied';
              this.host.status('Link copied. Paste it into Edge or Chrome.');
            } else {
              showLink();
            }
          });
          row.appendChild(copy);
          other.appendChild(row);
        }
        body.appendChild(other);
      }

      const done = D.button('Close', 'pl-btn', () => close(null));
      done.type = 'button';
      return D.dlg({ title: m.title, body, buttons: [done] });
    });
    if (this._linkClose === mine) this._linkClose = null;
  }

  // ── the folders this device knows ───────────────────────────────────────

  async manage() {
    await D.showDialog(close => {
      const body = D.el('div', 'pa-folders');
      const paint = async () => {
        const states = await this.folders();
        const rows = [];
        if (!states.length) rows.push(D.el('p', 'pa-note', 'No folder chosen on this computer yet.'));
        for (const s of states) {
          const row = D.el('div', 'pa-folder');
          const txt = D.el('div', 'pa-ftxt');
          txt.appendChild(D.el('div', 'pa-fname', s.rec.name));
          txt.appendChild(D.el('div', 'pa-fmeta',
            (s.perm === 'granted' ? 'Open on this computer' : 'Needs “Reconnect” (the browser asks once a session)')
            + (states[0] === s ? ' · the Plans Archive' : '')));
          const acts = D.el('div', 'pa-acts');
          if (s.perm !== 'granted') {
            acts.appendChild(D.button('Reconnect', 'primary', async () => {
              await this.reconnect(s.rec);
              await paint();
            }));
          }
          acts.appendChild(D.button('Remove from this list', '', async () => {
            const ok = await D.confirmDialog('Remove this folder from the list?',
              `${s.rec.name} stops being listed in this app on this computer. `
              + 'Nothing in the folder itself changes — no file is moved or deleted.',
              { okLabel: 'Remove from the list' });
            if (!ok) return;
            await this.store.remove(s.rec.id);
            this.host.refreshStart();
            await paint();
          }));
          row.append(txt, acts);
          rows.push(row);
        }
        rows.push(D.el('p', 'pa-note',
          'The first folder is the Plans Archive. Add the projects folder of '
          + 'DCR Desktop 2 too to see new jobs’ floor plans beside the old ones.'));
        body.replaceChildren(...rows);
      };
      void paint();
      return D.dlg({
        title: 'Plan folders on this computer',
        body,
        buttons: [
          D.button('Add a folder…', '', async () => { await this.choose(); await paint(); }),
          D.el('span', 'spacer'),
          D.button('Close', 'primary', () => close(true)),
        ],
      });
    });
    this.host.refreshStart();
  }

  // ── the browser ─────────────────────────────────────────────────────────

  /**
   * Every project in the folders this device can read now, newest job first,
   * filtered as the person types; a project's plan files are read when it is
   * opened. `code` opens that one job straight away.
   */
  async browse({ query = '', code = '' } = {}) {
    const roots = await this.readyFolders();
    if (!roots.length) {
      this.host.status('Reconnect to your Plans Archive folder first.');
      this.host.refreshStart();
      return;
    }
    const want = parseProjectCode(code);
    await D.showDialog(close => {
      const body = D.el('div', 'pa');
      const bar = D.el('div', 'pa-bar');
      const search = D.input(String(query || ''), 'search', {
        placeholder: 'Project number or name', 'aria-label': 'Find a project',
      });
      search.className = 'pa-search';
      const count = D.el('span', 'pa-count', 'Reading the folder…');
      bar.append(search, count);
      const list = D.el('div', 'pa-list');
      body.append(bar, list);

      const groups = [];        // { key, code, label, folders: [{ rec, name, handle }], el, open }
      let otherSect = null;     // the "Other folders" heading, hidden when the filter empties it
      const host = this.host;

      const openEntry = async entry => {
        close(null);
        if (entry.kind === 'pdf') await host.startFromPdf(entry);
        else await host.openTakeoff(entry);
      };

      const fill = async () => {
        const byKey = new Map();
        const others = [];
        const problems = [];
        for (const rec of roots) {
          let top;
          try {
            top = await listTopFolders(rec.handle);
          } catch {
            problems.push(rec.name);
            continue;
          }
          for (const p of top.projects) {
            const g = byKey.get(p.code) || { key: p.code, code: p.code, names: [], folders: [] };
            g.names.push(p.name);
            g.folders.push({ rec, name: p.name, handle: p.handle });
            byKey.set(p.code, g);
          }
          for (const o of top.others) {
            others.push({ key: `${rec.id}|${o.name}`, code: '', names: [o.name],
              folders: [{ rec, name: o.name, handle: o.handle }] });
          }
          if (top.files.length) {
            others.push({ key: `${rec.id}|`, code: '', names: [`Loose in ${rec.name}`],
              folders: [{ rec, name: '', handle: rec.handle, looseOnly: true }] });
          }
        }
        const projects = [...byKey.values()].sort((a, b) => compareCodes(b.code, a.code));
        const multi = roots.length > 1;
        const rows = [];
        if (problems.length) {
          rows.push(D.el('p', 'pa-note pa-warn',
            `Could not read ${problems.join(', ')} — it may have been moved or renamed. `
            + 'Choose it again under Folders.'));
        }
        for (const g of projects) rows.push(this._groupRow(g, groups, multi, openEntry));
        if (others.length) {
          otherSect = D.el('div', 'pa-sect', 'Other folders');
          rows.push(otherSect);
          for (const g of others) rows.push(this._groupRow(g, groups, multi, openEntry));
        }
        if (!projects.length && !others.length && !problems.length) {
          rows.push(D.el('p', 'pa-note', 'This folder is empty.'));
        }
        list.replaceChildren(...rows);
        applyFilter(true);
      };

      const applyFilter = (first = false) => {
        const q = search.value.trim().toLowerCase();
        const qCode = parseProjectCode(search.value);
        let shown = 0;
        for (const g of groups) {
          const hit = !q
            || (qCode ? g.code === qCode || g.code.startsWith(qCode) : false)
            || g.names.some(n => n.toLowerCase().includes(q));
          g.el.hidden = !hit;
          if (hit) shown += 1;
        }
        if (otherSect) otherSect.hidden = !groups.some(g => !g.code && !g.el.hidden);
        const total = groups.length;
        count.textContent = q ? `${shown} of ${total}` : `${total} folder${total === 1 ? '' : 's'}`;
        // A link or a typed number that names exactly one job opens it.
        const target = first && want ? groups.find(g => g.code === want) : null;
        if (target) target.toggle(true);
        else if (first && want) {
          host.status(`No folder named ${want} in the Plans Archive.`);
        }
      };
      let t = 0;
      search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => applyFilter(), 120); });

      void fill().catch(err => {
        list.replaceChildren(D.el('p', 'pa-note pa-warn', `Could not read the folder: ${err.message || err}`));
      });

      return D.dlg({
        title: 'Plans Archive',
        body,
        wide: true,
        buttons: [
          D.button('Folders…', '', () => { close(null); void this.manage(); }),
          D.el('span', 'spacer'),
          D.button('Close', 'primary', () => close(null)),
        ],
      });
    });
  }

  /** One project (or other folder) in the browser: a header, its files on demand. */
  _groupRow(g, groups, multi, openEntry) {
    const wrap = D.el('div', 'pa-proj');
    const headBtn = D.el('button', 'pa-proj-head');
    headBtn.type = 'button';
    headBtn.setAttribute('aria-expanded', 'false');
    if (g.code) headBtn.appendChild(D.el('b', 'pa-code', g.code));
    const rest = g.code ? (g.names.map(restOfName).find(Boolean) || '') : g.names[0];
    if (rest) headBtn.appendChild(D.el('span', 'pa-pname', rest));
    if (multi) {
      for (const f of g.folders) headBtn.appendChild(D.el('span', 'pa-tag', f.rec.name));
    }
    const bodyEl = D.el('div', 'pa-proj-body');
    bodyEl.hidden = true;
    wrap.append(headBtn, bodyEl);

    let loaded = false;
    const toggle = async (force) => {
      const open = force === true ? true : bodyEl.hidden;
      bodyEl.hidden = !open;
      headBtn.setAttribute('aria-expanded', String(open));
      if (open && force === true) wrap.scrollIntoView?.({ block: 'nearest' });
      if (!open || loaded) return;
      loaded = true;
      bodyEl.replaceChildren(D.el('p', 'pa-note', 'Reading the plan files…'));
      const parts = [];
      for (const f of g.folders) {
        let tree;
        try {
          tree = await walkPlans(f.handle, { name: f.name, filesOnly: !!f.looseOnly });
        } catch (err) {
          parts.push(D.el('p', 'pa-note pa-warn', `Could not read ${f.name || f.rec.name}: ${err.message || err}`));
          continue;
        }
        const ctx = {
          folderId: f.rec.id, folderName: f.rec.name, code: g.code,
          project: f.name, projectDir: f.handle, openEntry,
        };
        if (multi) parts.push(D.el('div', 'pa-sub', `In ${f.rec.name}`));
        parts.push(...renderTree(tree, ctx));
      }
      bodyEl.replaceChildren(...parts);
    };
    headBtn.addEventListener('click', () => { void toggle(); });
    g.el = wrap;
    g.toggle = toggle;
    groups.push(g);
    return wrap;
  }
}

/** A project folder's tree as rows: its own files, then its folders' (drawings). */
function renderTree(tree, ctx) {
  const out = [];
  if (!tree.count) {
    out.push(D.el('p', 'pa-note', tree.truncated
      ? 'No plan files found in the part of this folder that was read.'
      : 'No plan files (.takeoff or .pdf) in this folder.'));
    return out;
  }
  const section = (node, into) => {
    if (node.files.length) {
      if (node.path) into.push(D.el('div', 'pa-sub', node.path));
      for (const f of node.files) into.push(fileRow(f, ctx));
    }
    for (const sub of node.folders) section(sub, into);
  };
  section(tree, out);
  if (tree.truncated) {
    out.push(D.el('p', 'pa-note',
      'Not everything in this folder was read — it holds a great many files or '
      + 'folders. Open it in File Explorer to see the rest.'));
  }
  return out;
}

function fileRow(f, ctx) {
  const row = D.el('div', 'pa-file');
  row.appendChild(D.el('span', 'pa-ic', f.kind === 'pdf' ? '📄' : '📐'));
  const txt = D.el('div', 'pa-ftxt');
  txt.appendChild(D.el('div', 'pa-fname', f.name));
  txt.appendChild(D.el('div', 'pa-fmeta',
    [fmtSize(f.size), f.lastModified ? `saved ${fmtWhen(f.lastModified)}` : ''].filter(Boolean).join(' · ')));
  const acts = D.el('div', 'pa-acts');
  const entry = {
    handle: f.handle, dir: f.dir, name: f.name, kind: f.kind, size: f.size,
    lastModified: f.lastModified, path: f.path, code: ctx.code, project: ctx.project,
    folderId: ctx.folderId, folderName: ctx.folderName, projectDir: ctx.projectDir,
  };
  if (f.kind === 'pdf') {
    acts.appendChild(D.button('View', '', () => { void viewPdf(f.handle); }));
    acts.appendChild(D.button('Start a takeoff', 'primary', () => { void ctx.openEntry(entry); }));
  } else {
    acts.appendChild(D.button('Open', 'primary', () => { void ctx.openEntry(entry); }));
  }
  row.append(txt, acts);
  return row;
}

/** The browser's own PDF viewer, in a new tab. The bytes never leave this computer. */
async function viewPdf(handle) {
  // Opened before the file is read, so the click still counts and no popup
  // blocker steps in; it is pointed at the PDF once the bytes are in hand.
  const tab = window.open('', '_blank');
  try {
    const file = await handle.getFile();
    const url = URL.createObjectURL(new Blob([file], { type: 'application/pdf' }));
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  } catch (err) {
    if (tab) tab.close();
    await D.alertDialog('Could not open the PDF', err.message || String(err));
  }
}

function fmtSize(bytes) {
  const n = Number(bytes);
  if (!(n > 0)) return '';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function fmtWhen(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDay(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

