/**
 * @module permission_store
 * @description Persistent player permission store with YAML config as baseline.
 */

const fs = require('fs');
const path = require('path');
const {
    normalize_permission,
    normalize_player_name,
} = require('../handler/command/utils/permission_utils');

const CONFIG_DIR = path.resolve(__dirname, '../../../../../configs');
const PERMISSION_FILE = path.join(CONFIG_DIR, 'permission_config.json');
const ASSIGNABLE_PERMISSIONS = new Set(['guest', 'user', 'admin']);

let loaded = false;
let base_permissions = {};
let persisted_permissions = {};

/**
 * Normalize a list of player names from config.
 * @param {unknown} list_like - Config list-like value.
 * @returns {string[]} Normalized player names.
 */
function normalize_player_list(list_like) {
    if (!Array.isArray(list_like)) {
        return [];
    }
    return list_like
        .map((item) => normalize_player_name(item))
        .filter((name) => name.length > 0);
}

/**
 * Build baseline permissions from YAML-derived runtime config.
 * @param {object} config - Runtime config object.
 * @returns {Record<string, string>} Baseline permission map.
 */
function build_base_permissions(config = {}) {
    const result = {};
    for (const name of normalize_player_list(config.guest_players)) {
        result[name] = 'guest';
    }
    for (const name of normalize_player_list(config.user_players)) {
        result[name] = 'user';
    }
    for (const name of normalize_player_list(config.admin_players)) {
        result[name] = 'admin';
    }
    return result;
}

/**
 * Read persisted JSON overrides from disk.
 * @returns {Record<string, string>} Persisted permission overrides.
 */
function read_persisted_permissions() {
    try {
        if (!fs.existsSync(PERMISSION_FILE)) {
            return {};
        }
        const raw = fs.readFileSync(PERMISSION_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        const players = parsed && typeof parsed.players === 'object' ? parsed.players : {};
        const result = {};
        for (const [name, permission] of Object.entries(players)) {
            const normalized_name = normalize_player_name(name);
            const normalized_permission = normalize_permission(permission);
            if (normalized_name && ASSIGNABLE_PERMISSIONS.has(normalized_permission)) {
                result[normalized_name] = normalized_permission;
            }
        }
        return result;
    } catch (err) {
        console.error(`[permission_store] load failed: ${err.message || err}`);
        return {};
    }
}

/**
 * Persist runtime overrides to disk.
 */
function save() {
    try {
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }
        const payload = {
            players: persisted_permissions,
            updated_at: new Date().toISOString(),
        };
        fs.writeFileSync(PERMISSION_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
        console.error(`[permission_store] save failed: ${err.message || err}`);
    }
}

/**
 * Load baseline config and persisted overrides.
 * @param {object} config - Runtime config object.
 */
function load(config = {}) {
    base_permissions = build_base_permissions(config);
    persisted_permissions = read_persisted_permissions();
    loaded = true;
}

/**
 * Ensure the store has been loaded once.
 * @param {object} config - Runtime config object.
 */
function ensure_loaded(config = {}) {
    if (!loaded) {
        load(config);
    }
}

/**
 * Get the effective permission for a player.
 * @param {string} player_name - Player username.
 * @param {object} [msg] - Optional msg_obj for internal/system overrides.
 * @returns {'guest'|'user'|'admin'|'system'} Effective permission.
 */
function get_player_permission(player_name, msg = {}) {
    if (msg && msg.permission) {
        return normalize_permission(msg.permission);
    }

    if (msg && msg.position === 'internal') {
        return 'system';
    }

    const normalized_name = normalize_player_name(player_name);
    if (!normalized_name) {
        return 'guest';
    }

    return persisted_permissions[normalized_name]
        || base_permissions[normalized_name]
        || 'guest';
}

/**
 * Set a persistent permission override.
 * @param {string} player_name - Player username.
 * @param {string} permission - guest, user, or admin.
 * @returns {{ ok: boolean, error?: string }}
 */
function set_player_permission(player_name, permission) {
    const normalized_name = normalize_player_name(player_name);
    const normalized_permission = normalize_permission(permission);

    if (!normalized_name) {
        return { ok: false, error: '缺少玩家名' };
    }
    if (!ASSIGNABLE_PERMISSIONS.has(normalized_permission)) {
        return { ok: false, error: '权限必须是 guest、user 或 admin' };
    }

    persisted_permissions[normalized_name] = normalized_permission;
    save();
    return { ok: true };
}

/**
 * Remove a persistent permission override.
 * @param {string} player_name - Player username.
 * @returns {boolean} Whether an override was removed.
 */
function remove_player_permission(player_name) {
    const normalized_name = normalize_player_name(player_name);
    if (!normalized_name) {
        return false;
    }
    const existed = Object.prototype.hasOwnProperty.call(persisted_permissions, normalized_name);
    delete persisted_permissions[normalized_name];
    save();
    return existed;
}

/**
 * Return all effective permissions.
 * @returns {Record<string, string>} Merged permission map.
 */
function list_permissions() {
    return {
        ...base_permissions,
        ...persisted_permissions,
    };
}

module.exports = {
    ASSIGNABLE_PERMISSIONS,
    PERMISSION_FILE,
    ensure_loaded,
    load,
    save,
    get_player_permission,
    set_player_permission,
    remove_player_permission,
    list_permissions,
};
