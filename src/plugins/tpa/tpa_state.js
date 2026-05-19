/**
 * @module tpa_state
 * @description Scoped persistent state for TPA auto-accept workflow.
 */

const fs = require('fs');
const path = require('path');
const { sanitize_scope_part } = require('../../utils/bot_context');

const TPA_STATE_DIR = path.resolve(__dirname, '../../../configs');
const DEFAULT_SCOPE = 'default';

/** @type {Map<string, { enabled: boolean, occupied: boolean, occupied_by: string|null, loaded: boolean }>} */
const scoped_states = new Map();

/**
 * Create an empty TPA state record.
 * @returns {{ enabled: boolean, occupied: boolean, occupied_by: string|null, loaded: boolean }}
 */
function create_empty_state() {
    return {
        enabled: false,
        occupied: false,
        occupied_by: null,
        loaded: false,
    };
}

/**
 * Normalize a bot scope for use as a Map key and filename.
 * @param {string} scope - Raw bot scope.
 * @returns {string} Normalized scope.
 */
function normalize_scope(scope = DEFAULT_SCOPE) {
    return sanitize_scope_part(scope || DEFAULT_SCOPE);
}

/**
 * Get the state file for a bot scope.
 * @param {string} scope - Bot scope.
 * @returns {string} Absolute state file path.
 */
function get_state_file(scope = DEFAULT_SCOPE) {
    return path.join(TPA_STATE_DIR, `tpa_state.${normalize_scope(scope)}.json`);
}

/**
 * Get or create an in-memory state record.
 * @param {string} scope - Bot scope.
 * @returns {{ enabled: boolean, occupied: boolean, occupied_by: string|null, loaded: boolean }}
 */
function get_record(scope = DEFAULT_SCOPE) {
    const normalized = normalize_scope(scope);
    if (!scoped_states.has(normalized)) {
        scoped_states.set(normalized, create_empty_state());
    }
    return scoped_states.get(normalized);
}

/**
 * Load TPA state from disk for one bot scope.
 * @param {string} [scope='default'] - Bot scope.
 */
function load(scope = DEFAULT_SCOPE) {
    const normalized = normalize_scope(scope);
    const record = get_record(normalized);
    try {
        const state_file = get_state_file(normalized);
        if (!fs.existsSync(state_file)) {
            record.loaded = true;
            return;
        }
        const raw = fs.readFileSync(state_file, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.enabled === 'boolean') {
            record.enabled = parsed.enabled;
        }
        if (typeof parsed.occupied === 'boolean') {
            record.occupied = parsed.occupied;
        }
        if (parsed.occupied_by !== undefined) {
            record.occupied_by = parsed.occupied_by;
        }
        record.loaded = true;
    } catch (err) {
        console.error(`[tpa_state:${normalized}] load failed: ${err.message || err}`);
        record.loaded = true;
    }
}

/**
 * Ensure a bot scope has been loaded before use.
 * @param {string} scope - Bot scope.
 */
function ensure_loaded(scope = DEFAULT_SCOPE) {
    const record = get_record(scope);
    if (!record.loaded) {
        load(scope);
    }
}

/**
 * Save TPA state to disk for one bot scope.
 * @param {string} [scope='default'] - Bot scope.
 */
function save(scope = DEFAULT_SCOPE) {
    const normalized = normalize_scope(scope);
    const record = get_record(normalized);
    try {
        if (!fs.existsSync(TPA_STATE_DIR)) {
            fs.mkdirSync(TPA_STATE_DIR, { recursive: true });
        }
        fs.writeFileSync(get_state_file(normalized), JSON.stringify({
            enabled: record.enabled,
            occupied: record.occupied,
            occupied_by: record.occupied_by,
            updated_at: new Date().toISOString(),
        }, null, 2), 'utf-8');
    } catch (err) {
        console.error(`[tpa_state:${normalized}] save failed: ${err.message || err}`);
    }
}

/**
 * Get a copy of current TPA state.
 * @param {string} [scope='default'] - Bot scope.
 * @returns {{ enabled: boolean, occupied: boolean, occupied_by: string|null }}
 */
function get_state(scope = DEFAULT_SCOPE) {
    ensure_loaded(scope);
    const record = get_record(scope);
    return {
        enabled: record.enabled,
        occupied: record.occupied,
        occupied_by: record.occupied_by,
    };
}

/**
 * Set auto-accept enabled state.
 * @param {boolean} enabled - Whether auto-accept is enabled.
 * @param {string} [scope='default'] - Bot scope.
 */
function set_enabled(enabled, scope = DEFAULT_SCOPE) {
    ensure_loaded(scope);
    const record = get_record(scope);
    record.enabled = Boolean(enabled);
    save(scope);
}

/**
 * Mark TPA as occupied by a requester.
 * @param {string} requester - Requesting player.
 * @param {string} [scope='default'] - Bot scope.
 */
function occupy(requester, scope = DEFAULT_SCOPE) {
    ensure_loaded(scope);
    const record = get_record(scope);
    record.occupied = true;
    record.occupied_by = requester || null;
    save(scope);
}

/**
 * Release the TPA occupied lock.
 * @param {string} [scope='default'] - Bot scope.
 */
function release(scope = DEFAULT_SCOPE) {
    ensure_loaded(scope);
    const record = get_record(scope);
    record.occupied = false;
    record.occupied_by = null;
    save(scope);
}

/**
 * Reset all TPA state for one bot scope.
 * @param {string} [scope='default'] - Bot scope.
 */
function reset(scope = DEFAULT_SCOPE) {
    const record = get_record(scope);
    record.enabled = false;
    record.occupied = false;
    record.occupied_by = null;
    record.loaded = true;
    save(scope);
}

module.exports = {
    TPA_STATE_DIR,
    get_state_file,
    load,
    save,
    get_state,
    set_enabled,
    occupy,
    release,
    reset,
};
