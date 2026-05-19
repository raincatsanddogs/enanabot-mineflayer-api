const { normalize_command_name } = require('../command_registry');
const { normalize_player_name } = require('./permission_utils');
const { get_bot_id } = require('../../../utils/bot_context');

function get_prefix(options = {}) {
    return typeof options.prefix === 'string' && options.prefix.length > 0
        ? options.prefix
        : '#';
}

function get_cancel_command(options = {}) {
    return typeof options.cancel_command === 'string' && options.cancel_command.length > 0
        ? options.cancel_command
        : '#cancel';
}

/**
 * Build a command session key that is unique across concurrent bot instances.
 * @param {object} msg - Command message object.
 * @returns {string} Session key.
 */
function get_session_key(msg) {
    const bot_id = msg && msg.bot_id ? String(msg.bot_id) : 'default';
    const position = msg && msg.position ? msg.position : 'internal';
    const username = msg && msg.player && msg.player.username
        ? msg.player.username
        : 'system';
    return `${bot_id}:${position}:${username}`.toLowerCase();
}

function parse_command_text(text, prefix) {
    const raw = String(text || '').trim();
    if (!raw.startsWith(prefix)) return null;

    const body = raw.slice(prefix.length).trim();
    if (!body) return null;

    const parts = body.split(/\s+/);
    return {
        raw,
        name: normalize_command_name(parts[0]),
        args: parts.slice(1),
    };
}

function is_command_position(msg) {
    return msg && (msg.position === 'private' || msg.position === 'public' || msg.position === 'internal');
}

function is_bot_self_message(bot, msg, options = {}) {
    if (options.ignore_self === false) return false;
    if (!bot || !msg || msg.position === 'internal') return false;

    const bot_name = normalize_player_name(bot.username);
    const sender_name = normalize_player_name(msg.player && msg.player.username);

    return bot_name.length > 0 && sender_name.length > 0 && bot_name === sender_name;
}

/**
 * Copy the active bot id into a message before command routing.
 * @param {object} bot - Mineflayer bot instance.
 * @param {object} msg - Message object to enrich.
 * @returns {object} The same message object with bot_id set.
 */
function attach_bot_id(bot, msg) {
    if (!msg || typeof msg !== 'object') {
        return msg;
    }
    msg.bot_id = get_bot_id(bot, msg);
    return msg;
}

module.exports = {
    get_prefix,
    get_cancel_command,
    get_session_key,
    parse_command_text,
    is_command_position,
    is_bot_self_message,
    attach_bot_id,
};
