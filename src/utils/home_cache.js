/**
 * @module home_cache
 * @description Scoped persistent in-memory cache for Minecraft home names.
 */

const fs = require('fs');
const path = require('path');
const { sanitize_scope_part } = require('./bot_context');

const CACHE_DIR = path.resolve(__dirname, '../../configs');
const DEFAULT_SCOPE = 'default';

/** @type {Map<string, { homes: Set<string>, loaded_from_disk: boolean, loaded: boolean }>} */
const scoped_caches = new Map();

/**
 * Normalize a bot scope for use as a cache key and filename.
 * @param {string} scope - Raw bot scope.
 * @returns {string} Normalized scope.
 */
function normalize_scope(scope = DEFAULT_SCOPE) {
    return sanitize_scope_part(scope || DEFAULT_SCOPE);
}

/**
 * Get the cache file path for one bot scope.
 * @param {string} scope - Bot scope.
 * @returns {string} Absolute cache file path.
 */
function get_cache_file(scope = DEFAULT_SCOPE) {
    return path.join(CACHE_DIR, `home_cache.${normalize_scope(scope)}.json`);
}

/**
 * Create an empty cache record.
 * @returns {{ homes: Set<string>, loaded_from_disk: boolean, loaded: boolean }}
 */
function create_empty_cache() {
    return {
        homes: new Set(),
        loaded_from_disk: false,
        loaded: false,
    };
}

/**
 * Get or create the in-memory cache for one bot scope.
 * @param {string} scope - Bot scope.
 * @returns {{ homes: Set<string>, loaded_from_disk: boolean, loaded: boolean }}
 */
function get_record(scope = DEFAULT_SCOPE) {
    const normalized = normalize_scope(scope);
    if (!scoped_caches.has(normalized)) {
        scoped_caches.set(normalized, create_empty_cache());
    }
    return scoped_caches.get(normalized);
}

/**
 * Load cached homes from disk for one bot scope.
 * @param {string} [scope='default'] - Bot scope.
 */
function load(scope = DEFAULT_SCOPE) {
    const normalized = normalize_scope(scope);
    const record = get_record(normalized);
    try {
        const cache_file = get_cache_file(normalized);
        if (!fs.existsSync(cache_file)) {
            record.homes = new Set();
            record.loaded_from_disk = false;
            record.loaded = true;
            return;
        }

        const raw = fs.readFileSync(cache_file, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.homes)) {
            record.homes = new Set(
                parsed.homes
                    .filter((name) => typeof name === 'string' && name.trim())
                    .map((name) => name.trim())
            );
            record.loaded_from_disk = true;
            record.loaded = true;
            return;
        }

        record.homes = new Set();
        record.loaded_from_disk = false;
        record.loaded = true;
    } catch (err) {
        console.error(`[home_cache:${normalized}] load failed: ${err.message || err}`);
        record.homes = new Set();
        record.loaded_from_disk = false;
        record.loaded = true;
    }
}

/**
 * Ensure a bot scope has been loaded before cache use.
 * @param {string} scope - Bot scope.
 */
function ensure_loaded(scope = DEFAULT_SCOPE) {
    const record = get_record(scope);
    if (!record.loaded) {
        load(scope);
    }
}

/**
 * Save cached homes to disk.
 * @param {string} [scope='default'] - Bot scope.
 */
function save(scope = DEFAULT_SCOPE) {
    const normalized = normalize_scope(scope);
    const record = get_record(normalized);
    try {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
        const payload = {
            homes: [...record.homes],
            updated_at: new Date().toISOString(),
        };
        fs.writeFileSync(get_cache_file(normalized), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
        console.error(`[home_cache:${normalized}] save failed: ${err.message || err}`);
    }
}

/**
 * Get cached home names.
 * @param {string} [scope='default'] - Bot scope.
 * @returns {string[]} Home names.
 */
function get_list(scope = DEFAULT_SCOPE) {
    ensure_loaded(scope);
    return [...get_record(scope).homes];
}

/**
 * Check whether a home exists in cache.
 * @param {string} name - Home name.
 * @param {string} [scope='default'] - Bot scope.
 * @returns {boolean} Whether the home exists.
 */
function has_home(name, scope = DEFAULT_SCOPE) {
    ensure_loaded(scope);
    return typeof name === 'string' && get_record(scope).homes.has(name.trim());
}

/**
 * Check whether the cache needs a first GUI sync.
 * @param {string} [scope='default'] - Bot scope.
 * @returns {boolean} Whether a GUI refresh is needed.
 */
function needs_refresh(scope = DEFAULT_SCOPE) {
    ensure_loaded(scope);
    return !get_record(scope).loaded_from_disk;
}

/**
 * Add a home to cache and persist it.
 * @param {string} name - Home name.
 * @param {string} [scope='default'] - Bot scope.
 */
function add_home(name, scope = DEFAULT_SCOPE) {
    if (typeof name !== 'string' || !name.trim()) {
        return;
    }
    ensure_loaded(scope);
    get_record(scope).homes.add(name.trim());
    save(scope);
}

/**
 * Remove a home from cache and persist it.
 * @param {string} name - Home name.
 * @param {string} [scope='default'] - Bot scope.
 */
function remove_home(name, scope = DEFAULT_SCOPE) {
    if (typeof name !== 'string' || !name.trim()) {
        return;
    }
    ensure_loaded(scope);
    get_record(scope).homes.delete(name.trim());
    save(scope);
}

/**
 * Replace cache with a GUI-synced list.
 * @param {string[]} names - Home names from GUI.
 * @param {string} [scope='default'] - Bot scope.
 */
function set_from_gui(names, scope = DEFAULT_SCOPE) {
    if (!Array.isArray(names)) {
        return;
    }
    const record = get_record(scope);
    record.homes = new Set(
        names
            .filter((name) => typeof name === 'string' && name.trim())
            .map((name) => name.trim())
    );
    record.loaded_from_disk = true;
    record.loaded = true;
    save(scope);
}

/**
 * Mark the cache as requiring a GUI refresh.
 * @param {string} [scope='default'] - Bot scope.
 */
function invalidate(scope = DEFAULT_SCOPE) {
    const record = get_record(scope);
    record.loaded_from_disk = false;
    record.loaded = true;
}

module.exports = {
    CACHE_DIR,
    get_cache_file,
    load,
    save,
    get_list,
    has_home,
    needs_refresh,
    add_home,
    remove_home,
    set_from_gui,
    invalidate,
};
