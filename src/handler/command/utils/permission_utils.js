const PERMISSION_LEVELS = {
    guest: 1,
    user: 2,
    admin: 3,
    system: 4,
};

function normalize_player_name(name) {
    return String(name || '').trim().toLowerCase();
}

function normalize_permission(permission) {
    const normalized = String(permission || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PERMISSION_LEVELS, normalized)
        ? normalized
        : 'guest';
}

function normalize_player_list(list) {
    if (!Array.isArray(list)) return [];
    return list
        .map(normalize_player_name)
        .filter((name) => name.length > 0);
}

function has_permission(actual, required) {
    const actual_level = PERMISSION_LEVELS[normalize_permission(actual)] || 0;
    const required_level = PERMISSION_LEVELS[normalize_permission(required)] || 0;
    return actual_level >= required_level;
}

function get_message_permission(msg, options = {}) {
    if (typeof options.permission_resolver === 'function') {
        const resolved = options.permission_resolver(msg);
        if (resolved) return normalize_permission(resolved);
    }

    if (msg && msg.permission) {
        return normalize_permission(msg.permission);
    }

    if (msg && msg.player && msg.player.permission) {
        return normalize_permission(msg.player.permission);
    }

    if (msg && msg.position === 'internal') {
        return normalize_permission(options.internal_permission || 'system');
    }

    const username = normalize_player_name(msg && msg.player && msg.player.username);
    const admins = normalize_player_list(options.admin_players);
    const users = normalize_player_list(options.user_players);
    const guests = normalize_player_list(options.guest_players);

    if (admins.includes(username)) return 'admin';
    if (users.includes(username)) return 'user';
    if (guests.includes(username)) return 'guest';

    return normalize_permission(options.default_permission || 'guest');
}

module.exports = {
    PERMISSION_LEVELS,
    normalize_player_name,
    normalize_permission,
    has_permission,
    get_message_permission,
};
