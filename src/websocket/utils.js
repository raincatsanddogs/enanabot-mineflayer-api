/**
 * @module websocket/utils
 * @description Protocol helpers and small utilities for the WebSocket layer.
 */

const { get_display_name_nodes } = require('../handler/message/utils');

/**
 * Create an Error carrying a protocol error code.
 * @param {string} error_type - Stable protocol error code.
 * @param {string} error_message - Human readable error message.
 * @returns {Error} Error object with error_type attached.
 */
function create_protocol_error(error_type, error_message) {
    const error = new Error(error_message || error_type || 'protocol error');
    error.error_type = error_type || 'internal_error';
    return error;
}

/**
 * Parse a raw WebSocket message as a JSON object.
 * @param {Buffer|string} raw - Raw WebSocket payload.
 * @returns {object} Parsed message envelope.
 */
function parse_json_message(raw) {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
    let parsed = null;

    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw create_protocol_error('invalid_message', '消息必须是合法 JSON');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw create_protocol_error('invalid_message', '消息必须是 JSON 对象');
    }
    return parsed;
}

/**
 * Validate common envelope fields used by all request types.
 * @param {object} envelope - Parsed WebSocket envelope.
 * @returns {object} The same envelope when valid.
 */
function validate_base_envelope(envelope) {
    if (!envelope.type || typeof envelope.type !== 'string') {
        throw create_protocol_error('missing_field', '缺少必要字段: type');
    }

    if (envelope.need_reply === true && !envelope.msg_id) {
        throw create_protocol_error('missing_field', 'need_reply=true 时必须提供 msg_id');
    }

    if (envelope.data !== undefined
        && (envelope.data === null || typeof envelope.data !== 'object' || Array.isArray(envelope.data))) {
        throw create_protocol_error('invalid_message', 'data 必须是对象');
    }

    return envelope;
}

/**
 * Require a bot_id for bot-scoped request types.
 * @param {object} envelope - Request envelope.
 */
function require_bot_id(envelope) {
    if (!envelope.bot_id) {
        throw create_protocol_error('missing_field', '缺少必要字段: bot_id');
    }
}

/**
 * Require fields in a request data object.
 * @param {object} data - Request data object.
 * @param {string[]} fields - Required field names.
 */
function require_data_fields(data, fields) {
    const source = data || {};
    for (const field of fields) {
        if (source[field] === undefined || source[field] === null || source[field] === '') {
            throw create_protocol_error('missing_field', `缺少必要字段: data.${field}`);
        }
    }
}

/**
 * Build a protocol envelope.
 * @param {string} type - Message type.
 * @param {object} [options] - Envelope options.
 * @returns {object} Protocol envelope.
 */
function build_envelope(type, options = {}) {
    const envelope = {
        type,
        timestamp: options.timestamp || Date.now(),
        need_reply: options.need_reply === true,
        data: options.data === undefined ? {} : options.data,
    };

    if (options.msg_id) envelope.msg_id = options.msg_id;
    if (options.bot_id) envelope.bot_id = options.bot_id;
    if (options.extra !== undefined) envelope.extra = options.extra;

    return envelope;
}

/**
 * Build a reply envelope for a request.
 * @param {object} request - Original request envelope.
 * @param {'success'|'error'} status - Reply status.
 * @param {object|null} result - Reply result payload.
 * @param {string} [bot_id] - Optional bot id override.
 * @returns {object} Reply envelope.
 */
function build_reply(request, status, result, bot_id) {
    return build_envelope('reply', {
        bot_id: bot_id || request.bot_id,
        data: {
            msg_id: request.msg_id || '',
            status,
            result: result === undefined ? null : result,
        },
    });
}

/**
 * Build a request-scoped error reply.
 * @param {object} request - Original request envelope.
 * @param {string} error_type - Stable protocol error code.
 * @param {string} error_message - Human readable error message.
 * @param {string} [bot_id] - Optional bot id override.
 * @returns {object} Reply envelope.
 */
function build_error_reply(request, error_type, error_message, bot_id) {
    return build_reply(request || {}, 'error', {
        error_type,
        error_message,
    }, bot_id);
}

/**
 * Build a non-request-scoped protocol error push.
 * @param {string} error_type - Stable protocol error code.
 * @param {string} error_message - Human readable error message.
 * @param {string} [bot_id] - Optional bot id.
 * @returns {object} Error envelope.
 */
function build_error(error_type, error_message, bot_id) {
    return build_envelope('error', {
        bot_id,
        data: {
            error_type,
            error_message,
        },
    });
}

/**
 * Build a server event push.
 * @param {string} event_type - Event type name.
 * @param {object} event_data - Event payload.
 * @param {string} [bot_id] - Optional bot id.
 * @returns {object} Event envelope.
 */
function build_event(event_type, event_data, bot_id) {
    return build_envelope('event', {
        bot_id,
        data: {
            event_type,
            event_data: event_data || {},
        },
    });
}

/**
 * Send a protocol envelope to a WebSocket connection if it is open.
 * @param {object} connection_or_ws - Connection wrapper or raw WebSocket.
 * @param {object} payload - Protocol payload.
 * @returns {boolean} Whether the payload was queued for sending.
 */
function safe_send(connection_or_ws, payload) {
    const ws = connection_or_ws && connection_or_ws.ws
        ? connection_or_ws.ws
        : connection_or_ws;

    if (!ws || ws.readyState !== 1) {
        return false;
    }

    ws.send(JSON.stringify(payload));
    return true;
}

/**
 * Return the configured operation timeout in milliseconds.
 * @param {object} config - Runtime config object.
 * @param {number} [fallback_ms=10000] - Fallback timeout.
 * @returns {number} Timeout in milliseconds.
 */
function get_timeout_ms(config, fallback_ms = 10000) {
    const connect = config && config.connect && typeof config.connect === 'object'
        ? config.connect
        : {};
    const seconds = Number(connect.timeout);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback_ms;
}

/**
 * Reject a promise if it does not settle before the timeout.
 * @param {Promise} promise - Promise to wrap.
 * @param {number} timeout_ms - Timeout in milliseconds.
 * @param {string} message - Timeout error message.
 * @returns {Promise<*>} Wrapped promise.
 */
function with_timeout(promise, timeout_ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(create_protocol_error('internal_error', message || '操作超时'));
        }, timeout_ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

/**
 * Wait for a Mineflayer bot to finish its login attempt.
 * @param {object} bot - Mineflayer bot instance.
 * @param {number} timeout_ms - Login timeout in milliseconds.
 * @returns {Promise<void>} Resolves on spawn, rejects on error/end/timeout.
 */
function wait_for_bot_login(bot, timeout_ms) {
    return with_timeout(new Promise((resolve, reject) => {
        const cleanup = () => {
            bot.removeListener('spawn', on_spawn);
            bot.removeListener('error', on_error);
            bot.removeListener('end', on_end);
        };
        const on_spawn = () => {
            cleanup();
            resolve();
        };
        const on_error = (err) => {
            cleanup();
            const context_error = bot && bot.__enanabot_context && bot.__enanabot_context.last_error;
            const effective_error = context_error || err;
            reject(create_protocol_error(
                'login_failed',
                effective_error && effective_error.message ? effective_error.message : String(effective_error)
            ));
        };
        const on_end = (reason) => {
            cleanup();
            reject(create_protocol_error('login_failed', reason ? `登录连接结束: ${reason}` : '登录连接结束'));
        };

        bot.once('spawn', on_spawn);
        bot.once('error', on_error);
        bot.once('end', on_end);
    }), timeout_ms, '登录超时');
}

/**
 * Normalize reconnect settings from login options and global config.
 * @param {object} reconnect - Per-bot reconnect options.
 * @param {object} config - Runtime config object.
 * @returns {{ enabled: boolean, interval: number, max_attempts: number }}
 */
function normalize_reconnect_options(reconnect, config) {
    const connect = config && config.connect && typeof config.connect === 'object'
        ? config.connect
        : {};
    const source = reconnect && typeof reconnect === 'object' ? reconnect : {};

    const raw_interval = source.interval ?? connect.interval ?? 5;
    const raw_max_attempts = source.max_attempts ?? source.maxAttempts ?? connect.retry ?? 5;

    return {
        enabled: source.enabled !== false && source.reconnect !== false,
        interval: Number(raw_interval) || 5,
        max_attempts: Number.isFinite(Number(raw_max_attempts)) ? Number(raw_max_attempts) : 5,
    };
}

/**
 * Convert a Mineflayer player object to a protocol player payload.
 * @param {object} player - Mineflayer player object.
 * @returns {object} Protocol player payload.
 */
function format_player(player) {
    const nickname_nodes = get_display_name_nodes(player);
    return {
        username: (player && player.username) || '',
        nickname: nickname_nodes.length > 0 ? nickname_nodes : {},
        uuid: (player && player.uuid) || '',
        skin_url: (player && player.skinData && player.skinData.url) || '',
    };
}

/**
 * Check whether a parsed message was sent by the current bot itself.
 * @param {object} bot - Mineflayer bot instance.
 * @param {object} msg - Parsed msg_obj emitted by message_handler.
 * @returns {boolean} Whether the message sender is the bot.
 */
function is_self_message(bot, msg) {
    if (msg && msg.position === 'private_outgoing') {
        return true;
    }

    const bot_username = normalize_username(bot && bot.username);
    if (!bot_username || !msg || !msg.player) {
        return false;
    }

    const players = Array.isArray(msg.player) ? msg.player : [msg.player];
    return players.some((player) => normalize_username(player && player.username) === bot_username);
}

/**
 * Collect the current player list from a Mineflayer bot.
 * @param {object} bot - Mineflayer bot instance.
 * @returns {{ player: object[], player_count: number, bot_username: string }}
 */
function collect_player_list(bot) {
    const players = Object.values((bot && bot.players) || {})
        .filter(Boolean)
        .map(format_player);

    return {
        player: players,
        player_count: players.length,
        bot_username: (bot && bot.username) || '',
    };
}

/**
 * Convert an internal parsed Minecraft message to the public WebSocket shape.
 * @param {object} msg - Internal msg_obj emitted by message_handler.
 * @param {string} bot_id - Bot id.
 * @returns {object} Message envelope.
 */
function build_minecraft_msg(msg, bot_id) {
    const data = msg && msg.data && typeof msg.data === 'object' ? msg.data : {};
    const position = (msg && msg.position) || 'public';
    const message_type = position === 'private' || position === 'private_outgoing'
        ? 'whisper'
        : (position === 'tpa' ? 'tpa' : (position.startsWith('system') ? 'system' : 'chat'));

    return build_envelope('msg', {
        bot_id,
        data: {
            time: (msg && msg.time) || Date.now(),
            type: message_type,
            position,
            text: (msg && msg.message) || '',
            player: (msg && msg.player) || [],
            entity: data.entities || null,
            item: data.items || null,
        },
        extra: {
            translate: data.translate ? [].concat(data.translate) : [],
            raw: data.raw || null,
        },
    });
}

/**
 * Build command text accepted by the internal command dispatcher.
 * @param {string} command - Command name without prefix.
 * @param {string[]|string} args - Command arguments.
 * @returns {string} Full internal command text.
 */
function build_command_text(command, args) {
    const normalized_command = String(command || '').trim();
    if (Array.isArray(args)) {
        const suffix = args.map((arg) => String(arg)).join(' ').trim();
        return suffix ? `${normalized_command} ${suffix}` : normalized_command;
    }
    const suffix = args === undefined || args === null ? '' : String(args).trim();
    return suffix ? `${normalized_command} ${suffix}` : normalized_command;
}

function normalize_username(username) {
    return String(username || '').trim().toLowerCase();
}

module.exports = {
    create_protocol_error,
    parse_json_message,
    validate_base_envelope,
    require_bot_id,
    require_data_fields,
    build_envelope,
    build_reply,
    build_error_reply,
    build_error,
    build_event,
    safe_send,
    get_timeout_ms,
    with_timeout,
    wait_for_bot_login,
    normalize_reconnect_options,
    collect_player_list,
    build_minecraft_msg,
    build_command_text,
    is_self_message,
};
