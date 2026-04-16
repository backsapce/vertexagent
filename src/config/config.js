/**
 * Config Adapter for Vertex Agent.
 *
 * Central configuration proxy that reads/writes a `config.yaml` file in OPFS.
 * All modules access configuration through this adapter so that changes
 * propagate everywhere via a subscribe/notify pattern.
 *
 * YAML structure:
 *   llm:
 *     provider: openai
 *     apiKey: sk-...
 *     baseUrl: null
 *     model: gpt-4o
 *
 * Usage:
 *   import config from './config/config';
 *
 *   await config.init();                       // load from OPFS
 *   const val = config.get('llm.provider');     // read a value
 *   await config.set('llm.provider', 'openai'); // write + persist + notify
 *
 *   config.subscribe((cfg) => { ... });         // listen for any change
 */

import yaml from 'js-yaml';

// ─── OPFS helpers ───────────────────────────────────────────────────────────

const ROOT_DIR = 'vertex-agent';
const CONFIG_FILE = 'config.yaml';

async function getRootDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ROOT_DIR, { create: true });
}

async function readFile(dirHandle, filename) {
  try {
    const fh = await dirHandle.getFileHandle(filename);
    const file = await fh.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function writeFile(dirHandle, filename, text) {
  const fh = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fh.createWritable();
  await writable.write(text);
  await writable.close();
}

// ─── In-memory state ────────────────────────────────────────────────────────

let _data = {};                // full config object
let _listeners = new Set();    // subscriber callbacks
let _initialized = false;

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Deep-get a value by dot-separated path.
 *   getPath({ a: { b: 1 } }, 'a.b') → 1
 */
function getPath(obj, path) {
  if (!path) return obj;
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Deep-set a value by dot-separated path (immutable — returns new root).
 */
function setPath(obj, path, value) {
  if (!path) return value;
  const keys = path.split('.');
  const root = { ...obj };
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cur[k] = cur[k] != null && typeof cur[k] === 'object' ? { ...cur[k] } : {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return root;
}

/** Notify all subscribers with a frozen snapshot. */
function notify() {
  const snapshot = structuredClone(_data);
  for (const fn of _listeners) {
    try { fn(snapshot); } catch (e) { console.error('Config listener error:', e); }
  }
}

/** Persist current _data to OPFS as YAML. */
async function persist() {
  const dir = await getRootDir();
  const text = yaml.dump(_data, { lineWidth: 120, noRefs: true });
  await writeFile(dir, CONFIG_FILE, text);
}

// ─── Migrate legacy llm-settings.json → config.yaml ────────────────────────

async function migrateLegacy(dir) {
  try {
    const fh = await dir.getFileHandle('llm-settings.json');
    const file = await fh.getFile();
    const text = await file.text();
    const legacy = JSON.parse(text);
    if (legacy && typeof legacy === 'object') {
      _data.llm = { ..._data.llm, ...legacy };
      await persist();
      // Remove the old file after successful migration
      await dir.removeEntry('llm-settings.json');
    }
  } catch {
    // No legacy file — nothing to migrate
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

const config = {
  /**
   * Initialize: load config.yaml from OPFS (call once at app startup).
   * Automatically migrates legacy llm-settings.json if present.
   * @returns {Promise<Object>} the full config object
   */
  async init() {
    const dir = await getRootDir();
    const raw = await readFile(dir, CONFIG_FILE);
    if (raw) {
      try {
        _data = yaml.load(raw) || {};
      } catch {
        console.warn('Failed to parse config.yaml, starting fresh');
        _data = {};
      }
    } else {
      _data = {};
    }

    // One-time migration from legacy llm-settings.json
    await migrateLegacy(dir);

    _initialized = true;
    return structuredClone(_data);
  },

  /**
   * Whether init() has been called.
   */
  get initialized() {
    return _initialized;
  },

  /**
   * Get the entire config or a value by dot path.
   * @param {string} [path] - e.g. 'llm.provider' or 'llm'
   * @returns {*}
   */
  get(path) {
    const val = getPath(_data, path);
    // Return clones of objects so callers can't mutate internal state
    return val != null && typeof val === 'object' ? structuredClone(val) : val;
  },

  /**
   * Set a value by dot path, persist to OPFS, and notify subscribers.
   * @param {string} path  - e.g. 'llm.provider'
   * @param {*}      value
   */
  async set(path, value) {
    _data = setPath(_data, path, value);
    await persist();
    notify();
  },

  /**
   * Merge an object at the given path (shallow merge).
   * Useful for updating multiple fields at once:
   *   config.merge('llm', { provider: 'openai', apiKey: 'sk-...' })
   */
  async merge(path, obj) {
    const current = getPath(_data, path);
    const merged = current != null && typeof current === 'object'
      ? { ...current, ...obj }
      : obj;
    _data = setPath(_data, path, merged);
    await persist();
    notify();
  },

  /**
   * Replace the entire config object.
   * @param {Object} data
   */
  async setAll(data) {
    _data = structuredClone(data);
    await persist();
    notify();
  },

  /**
   * Subscribe to config changes. Returns an unsubscribe function.
   * The listener receives the full config snapshot on every change.
   * @param {Function} listener - (config: Object) => void
   * @returns {Function} unsubscribe
   */
  subscribe(listener) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  },

  /**
   * Delete the entire config.yaml from OPFS.
   */
  async clear() {
    _data = {};
    try {
      const dir = await getRootDir();
      await dir.removeEntry(CONFIG_FILE);
    } catch {
      // ignore
    }
    notify();
  },
};

export default config;
