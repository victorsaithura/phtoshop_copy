import { serializeDocumentAsync, parseProject } from './project.js';
import { openModal } from './ui/dialogs.js';
import { h } from './ui/dom.js';
import { debounce } from './core/utils.js';

/*
 * Autosave: documents with unsaved changes are kept in the browser's
 * IndexedDB a moment after each change. If the tab closes or crashes, the
 * next visit offers to recover them. Each open tab holds a Web Lock, so
 * documents still open in another tab are never offered.
 */

const DB_NAME = 'photoforge';
const STORE = 'autosave';
const SESSION = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const lockName = (session) => `photoforge-session-${session}`;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('storage is not available'));
  });
}

/** Run fn(store) in a transaction; resolves with the request's result once committed. */
function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('storage is full'));
  });
}

let dbPromise = null;
const db = () => {
  dbPromise ||= openDB();
  return dbPromise;
};

/** Every autosaved document: [{ key, session, name, savedAt, text }]. */
export async function listAutosaves() {
  return run(await db(), 'readonly', (s) => s.getAll());
}

async function removeAutosave(key) {
  return run(await db(), 'readwrite', (s) => s.delete(key));
}

/** Saves from tabs that are no longer open. */
async function orphans() {
  const all = await listAutosaves();
  let held = null;
  try {
    if (navigator.locks?.query) held = new Set((await navigator.locks.query()).held.map((l) => l.name));
  } catch {
    held = null;
  }
  // Without Web Locks, only offer saves that have not been updated for a while.
  return all.filter((r) => r.session !== SESSION && (held ? !held.has(lockName(r.session)) : Date.now() - r.savedAt > 60_000));
}

function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleString();
}

export function setupAutosave(app) {
  if (!('indexedDB' in window)) return;
  // Held until the tab closes: tells other tabs this session is alive.
  navigator.locks?.request(lockName(SESSION), () => new Promise(() => {})).catch(() => {});

  const savedEntry = new WeakMap(); // session -> { entry, state } last autosaved
  const keys = new Map(); // session -> record key
  let off = false;
  const keyOf = (s) => {
    if (!keys.has(s)) keys.set(s, `${SESSION}:${s.doc.id}`);
    return keys.get(s);
  };

  async function save(s) {
    // The history step and whether it is saved (Save marks the same step as saved).
    const state = `${s.history.entries.indexOf(s.history.current)}:${s.history.entries.length}:${s.history.dirty}`;
    const last = savedEntry.get(s);
    if (off || (last && last.entry === s.history.current && last.state === state)) return;
    savedEntry.set(s, { entry: s.history.current, state });
    try {
      if (!s.history.dirty) {
        await removeAutosave(keyOf(s));
        return;
      }
      const text = JSON.stringify(await serializeDocumentAsync(s.doc));
      const record = { key: keyOf(s), session: SESSION, name: s.doc.name, savedAt: Date.now(), text };
      await run(await db(), 'readwrite', (st) => st.put(record));
    } catch (err) {
      savedEntry.delete(s);
      off = true;
      app.toast(`Autosave is off: ${err?.message || 'the browser’s storage is not available'}.`);
    }
  }

  async function saveAll() {
    for (const s of app.sessions) await save(s);
    // Documents closed since: forget them.
    for (const [s, key] of keys) {
      if (app.sessions.includes(s)) continue;
      keys.delete(s);
      removeAutosave(key).catch(() => {});
    }
  }

  // One save at a time, so an older snapshot never lands after a newer one.
  let queue = Promise.resolve();
  const saveNow = () => {
    queue = queue.then(saveAll, saveAll);
    return queue;
  };
  const later = debounce(saveNow, 2000);
  app.on('history', later);
  app.on('document', later);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });

  db().then(offerRecovery).catch(() => { off = true; });

  async function offerRecovery() {
    const found = await orphans();
    if (!found.length) return;
    found.sort((a, b) => b.savedAt - a.savedAt);
    const list = h('ul', { class: 'recover-list' },
      found.map((r) => h('li', {}, h('strong', {}, r.name), h('span', { class: 'recover-time' }, ` — ${ago(r.savedAt)}`))));
    openModal({
      title: 'Recover unsaved work',
      body: h('div', {},
        h('p', { style: { margin: '0 0 8px' } }, 'PhotoForge closed before these documents were saved:'),
        list,
        h('p', { class: 'recover-hint' }, 'Recovered documents open in new tabs. Save them to keep them.')),
      buttons: [
        { label: 'Discard', onClick: () => { for (const r of found) removeAutosave(r.key).catch(() => {}); } },
        {
          label: 'Recover',
          primary: true,
          onClick: () => {
            recover(found);
          },
        },
      ],
    });
  }

  async function recover(records) {
    for (const r of records) {
      try {
        const doc = await parseProject(r.text);
        const session = app.addDocument(doc, 'Recovered');
        // Still unsaved: keep the tab marked and autosave it under this tab.
        session.history.savedEntry = null;
        session.history.onChange();
        await save(session);
        await removeAutosave(r.key);
      } catch (err) {
        app.toast(`Could not recover ${r.name}: ${err.message}.`);
      }
    }
  }
}
