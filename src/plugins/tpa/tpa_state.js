/**
 * @module tpa_state
 * @description Persistent state for TPA auto-accept workflow.
 */

const fs = require('fs');
const path = require('path');

const TPA_STATE_FILE = path.resolve(__dirname, '../../../../../../configs/tpa_state.json');

const tpa_state = {
    enabled: false,
    occupied: false,
    occupied_by: null,
};

/**
 * Load TPA state from disk.
 */
function load() {
    try {
        if (!fs.existsSync(TPA_STATE_FILE)) {
            return;
        }
        const raw = fs.readFileSync(TPA_STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.enabled === 'boolean') {
            tpa_state.enabled = parsed.enabled;
        }
        if (typeof parsed.occupied === 'boolean') {
            tpa_state.occupied = parsed.occupied;
        }
        if (parsed.occupied_by !== undefined) {
            tpa_state.occupied_by = parsed.occupied_by;
        }
    } catch (err) {
        console.error(`[tpa_state] load failed: ${err.message || err}`);
    }
}

/**
 * Save TPA state to disk.
 */
function save() {
    try {
        const dir = path.dirname(TPA_STATE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(TPA_STATE_FILE, JSON.stringify({
            ...tpa_state,
            updated_at: new Date().toISOString(),
        }, null, 2), 'utf-8');
    } catch (err) {
        console.error(`[tpa_state] save failed: ${err.message || err}`);
    }
}

/**
 * Get a copy of current TPA state.
 * @returns {{ enabled: boolean, occupied: boolean, occupied_by: string|null }}
 */
function get_state() {
    return { ...tpa_state };
}

/**
 * Set auto-accept enabled state.
 * @param {boolean} enabled - Whether auto-accept is enabled.
 */
function set_enabled(enabled) {
    tpa_state.enabled = Boolean(enabled);
    save();
}

/**
 * Mark TPA as occupied by a requester.
 * @param {string} requester - Requesting player.
 */
function occupy(requester) {
    tpa_state.occupied = true;
    tpa_state.occupied_by = requester || null;
    save();
}

/**
 * Release the TPA occupied lock.
 */
function release() {
    tpa_state.occupied = false;
    tpa_state.occupied_by = null;
    save();
}

/**
 * Reset all TPA state.
 */
function reset() {
    tpa_state.enabled = false;
    tpa_state.occupied = false;
    tpa_state.occupied_by = null;
    save();
}

module.exports = {
    TPA_STATE_FILE,
    load,
    save,
    get_state,
    set_enabled,
    occupy,
    release,
    reset,
};
