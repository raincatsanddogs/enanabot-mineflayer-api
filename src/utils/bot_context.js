/**
 * @module bot_context
 * @description Helpers for reading per-bot runtime metadata.
 */

/**
 * Get the runtime context attached by index.create_bot().
 * @param {object|null} bot - Mineflayer bot or bot-like object.
 * @returns {object} Runtime context object, or an empty object.
 */
function get_bot_context(bot) {
    return bot && bot.__enanabot_context && typeof bot.__enanabot_context === 'object'
        ? bot.__enanabot_context
        : {};
}

/**
 * Return the stable bot id used by WebSocket routing and command sessions.
 * @param {object|null} bot - Mineflayer bot or bot-like object.
 * @param {object} [msg] - Optional message object with bot_id.
 * @returns {string} Bot id, or "default" for legacy single-bot flows.
 */
function get_bot_id(bot, msg = {}) {
    const context = get_bot_context(bot);
    return String(
        context.bot_id
        || msg.bot_id
        || (msg.context && msg.context.bot_id)
        || 'default'
    );
}

/**
 * Sanitize a scope part so it can be safely used in filenames.
 * @param {string|number|null|undefined} value - Raw scope part.
 * @returns {string} Sanitized scope part.
 */
function sanitize_scope_part(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return text.trim().toLowerCase().replace(/[^a-z0-9_.-]+/gi, '_') || 'unknown';
}

/**
 * Build a stable bot scope from identity and server information.
 * @param {object} options - Scope options.
 * @param {string} [options.username] - Bot username/profile name.
 * @param {object} [options.server] - Server object containing host and port.
 * @param {string} [options.bot_id] - Fallback bot id.
 * @returns {string} Stable scope key.
 */
function build_bot_scope(options = {}) {
    const server = options.server || {};
    const username = sanitize_scope_part(options.username || options.bot_id || 'default');
    const host = sanitize_scope_part(server.host || server.url || 'unknown-host');
    const port = sanitize_scope_part(server.port || '25565');
    return `${username}_${host}_${port}`;
}

/**
 * Return the per-bot state scope, deriving one if the context does not contain it.
 * @param {object|null} bot - Mineflayer bot or bot-like object.
 * @returns {string} Scope key for per-bot runtime state.
 */
function get_bot_scope(bot) {
    const context = get_bot_context(bot);
    if (context.scope) {
        return String(context.scope);
    }

    return build_bot_scope({
        username: context.username || (bot && bot.username) || 'default',
        server: context.server || {},
        bot_id: context.bot_id || 'default',
    });
}

module.exports = {
    get_bot_context,
    get_bot_id,
    sanitize_scope_part,
    build_bot_scope,
    get_bot_scope,
};
