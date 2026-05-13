/**
 * @module home_cache
 * @description Persistent in-memory cache for Minecraft home names.
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.resolve(__dirname, '../../../../../configs/home_cache.json');

/** @type {Set<string>} */
let homes = new Set();
let loaded_from_disk = false;

/**
 * Load cached homes from disk.
 */
function load() {
    try {
        if (!fs.existsSync(CACHE_FILE)) {
            homes = new Set();
            loaded_from_disk = false;
            return;
        }

        const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.homes)) {
            homes = new Set(
                parsed.homes
                    .filter((name) => typeof name === 'string' && name.trim())
                    .map((name) => name.trim())
            );
            loaded_from_disk = true;
            return;
        }

        homes = new Set();
        loaded_from_disk = false;
    } catch (err) {
        console.error(`[home_cache] load failed: ${err.message || err}`);
        homes = new Set();
        loaded_from_disk = false;
    }
}

/**
 * Save cached homes to disk.
 */
function save() {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const payload = {
            homes: [...homes],
            updated_at: new Date().toISOString(),
        };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
        console.error(`[home_cache] save failed: ${err.message || err}`);
    }
}

/**
 * Get cached home names.
 * @returns {string[]} Home names.
 */
function get_list() {
    return [...homes];
}

/**
 * Check whether a home exists in cache.
 * @param {string} name - Home name.
 * @returns {boolean} Whether the home exists.
 */
function has_home(name) {
    return typeof name === 'string' && homes.has(name.trim());
}

/**
 * Check whether the cache needs a first GUI sync.
 * @returns {boolean} Whether a GUI refresh is needed.
 */
function needs_refresh() {
    return !loaded_from_disk;
}

/**
 * Add a home to cache and persist it.
 * @param {string} name - Home name.
 */
function add_home(name) {
    if (typeof name !== 'string' || !name.trim()) {
        return;
    }
    homes.add(name.trim());
    save();
}

/**
 * Remove a home from cache and persist it.
 * @param {string} name - Home name.
 */
function remove_home(name) {
    if (typeof name !== 'string' || !name.trim()) {
        return;
    }
    homes.delete(name.trim());
    save();
}

/**
 * Replace cache with a GUI-synced list.
 * @param {string[]} names - Home names from GUI.
 */
function set_from_gui(names) {
    if (!Array.isArray(names)) {
        return;
    }
    homes = new Set(
        names
            .filter((name) => typeof name === 'string' && name.trim())
            .map((name) => name.trim())
    );
    loaded_from_disk = true;
    save();
}

/**
 * Mark the cache as requiring a GUI refresh.
 */
function invalidate() {
    loaded_from_disk = false;
}

module.exports = {
    CACHE_FILE,
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
