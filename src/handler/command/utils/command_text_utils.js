const { normalize_command_name } = require('../command_registry');
const { normalize_player_name } = require('./permission_utils');

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

function get_session_key(msg) {
    const position = msg && msg.position ? msg.position : 'internal';
    const username = msg && msg.player && msg.player.username
        ? msg.player.username
        : 'system';
    return `${position}:${username}`.toLowerCase();
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

module.exports = {
    get_prefix,
    get_cancel_command,
    get_session_key,
    parse_command_text,
    is_command_position,
    is_bot_self_message,
};
