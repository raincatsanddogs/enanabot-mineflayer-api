/**
 * @module websocket/handlers
 * @description Request dispatchers for the WebSocket protocol.
 */

const { get_commands, trigger_command } = require('../handler/command');
const {
    build_command_text,
    build_error,
    build_error_reply,
    build_reply,
    collect_player_list,
    create_protocol_error,
    parse_json_message,
    require_bot_id,
    require_data_fields,
    safe_send,
    validate_base_envelope,
} = require('./utils');

const PUBLIC_TYPES = new Set(['auth', 'ping']);
const BOT_SCOPED_TYPES = new Set(['logout', 'message', 'command', 'player', 'bot_info']);
const CLIENT_EVENT_TYPES = new Set(['client.ready', 'client.notice', 'client.state']);

/**
 * Create the WebSocket request handler set.
 * @param {object} options - Handler dependencies.
 * @param {object} options.bot_manager - BotManager instance.
 * @param {string} options.token - Required auth token.
 * @returns {{ handle_message: Function }} Handler facade.
 */
function create_handlers(options = {}) {
    const bot_manager = options.bot_manager;
    const token = String(options.token || '');
    const command_prefix = String((options.config && options.config.command_prefix) || '#');

    /**
     * Parse, validate, authenticate, and dispatch one raw WebSocket message.
     * @param {object} connection - Connection state wrapper.
     * @param {Buffer|string} raw - Raw WebSocket payload.
     * @returns {Promise<void>}
     */
    async function handle_message(connection, raw) {
        let envelope = null;

        try {
            envelope = validate_base_envelope(parse_json_message(raw));
            enforce_auth_state(connection, envelope);
            await dispatch_message(connection, envelope);
        } catch (err) {
            respond_error(connection, envelope, err);
        }
    }

    /**
     * Dispatch an authenticated request by message type.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Validated request envelope.
     * @returns {Promise<void>}
     */
    async function dispatch_message(connection, envelope) {
        switch (envelope.type) {
        case 'auth':
            return handle_auth(connection, envelope);
        case 'login_account':
            return handle_login_account(connection, envelope);
        case 'login_preset':
            return handle_login_preset(connection, envelope);
        case 'logout':
            return handle_logout(connection, envelope);
        case 'message':
            return handle_send_message(connection, envelope);
        case 'command':
            return handle_command(connection, envelope);
        case 'ping':
            return handle_ping(connection, envelope);
        case 'player':
            return handle_player(connection, envelope);
        case 'bot_info':
            return handle_bot_info(connection, envelope);
        case 'bot_list':
            return handle_bot_list(connection, envelope);
        case 'event':
            return handle_client_event(connection, envelope);
        case 'reply':
            return;
        case 'error':
            console.warn('[websocket] client error:', envelope.data || {});
            return;
        default:
            throw create_protocol_error('invalid_message', `未知消息类型: ${envelope.type}`);
        }
    }

    /**
     * Handle connection authentication.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Auth request envelope.
     */
    function handle_auth(connection, envelope) {
        require_data_fields(envelope.data, ['token']);
        if (String(envelope.data.token) !== token) {
            safe_send(connection, build_error_reply(envelope, 'auth_failed', '认证失败'));
            setTimeout(() => {
                if (connection.ws && typeof connection.ws.close === 'function') {
                    connection.ws.close();
                }
            }, 30);
            return;
        }

        connection.authenticated = true;
        safe_send(connection, build_reply(envelope, 'success', { authenticated: true }));
    }

    /**
     * Handle explicit account login.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Login request envelope.
     * @returns {Promise<void>}
     */
    async function handle_login_account(connection, envelope) {
        require_login_reply(envelope);
        require_data_fields(envelope.data, ['account', 'login_type', 'server']);
        const info = await bot_manager.create_from_login_options(envelope.data);
        safe_send(connection, build_reply(envelope, 'success', info, info.bot_id));
    }

    /**
     * Handle preset account/server login.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Login preset request envelope.
     * @returns {Promise<void>}
     */
    async function handle_login_preset(connection, envelope) {
        require_login_reply(envelope);
        require_data_fields(envelope.data, ['account', 'server']);
        const info = await bot_manager.create_from_preset(
            Number(envelope.data.account),
            Number(envelope.data.server)
        );
        safe_send(connection, build_reply(envelope, 'success', info, info.bot_id));
    }

    /**
     * Handle logout for one bot.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Logout request envelope.
     * @returns {Promise<void>}
     */
    async function handle_logout(connection, envelope) {
        require_bot_id(envelope);
        const info = await bot_manager.logout(envelope.bot_id);
        safe_send(connection, build_reply(envelope, 'success', { state: info.state }, envelope.bot_id));
    }

    /**
     * Send a Minecraft chat or whisper message through a bot.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Message request envelope.
     */
    function handle_send_message(connection, envelope) {
        require_bot_id(envelope);
        require_data_fields(envelope.data, ['type', 'content']);
        const entry = bot_manager.get_entry(envelope.bot_id);
        const data = envelope.data || {};

        try {
            if (data.type === 'chat') {
                const prefix = data.prefix ? String(data.prefix) : '';
                entry.bot.chat(`${prefix}${data.content}`);
            } else if (data.type === 'whisper') {
                require_data_fields(data, ['target_player']);
                entry.bot.whisper(String(data.target_player), String(data.content));
            } else {
                throw create_protocol_error('invalid_message', `未知消息发送类型: ${data.type}`);
            }
        } catch (err) {
            throw create_protocol_error('send_failed', err.message || String(err));
        }

        safe_send(connection, build_reply(envelope, 'success', null, envelope.bot_id));
    }

    /**
     * Execute an internal command against a bot.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Command request envelope.
     * @returns {Promise<void>}
     */
    async function handle_command(connection, envelope) {
        require_bot_id(envelope);
        require_data_fields(envelope.data, ['command']);
        const entry = bot_manager.get_entry(envelope.bot_id);
        const data = envelope.data || {};
        const command_text = `${command_prefix}${build_command_text(data.command, data.args || [])}`;

        if (data.wait === false) {
            if (!command_exists(data.command)) {
                safe_send(connection, build_error_reply(envelope, 'command_not_found', `未知命令: ${data.command}`, envelope.bot_id));
                return;
            }

            safe_send(connection, build_reply(envelope, 'success', {
                command: data.command,
                accepted: true,
            }, envelope.bot_id));

            const result = await trigger_command(entry.bot, command_text, {
                bot_id: envelope.bot_id,
                msg_id: envelope.msg_id,
                await_handler: false,
                internal_permission: 'system',
                reply: async (text) => {
                    safe_send(connection, build_reply(envelope, 'success', {
                        command: data.command,
                        reply: text,
                    }, envelope.bot_id));
                },
            });

            if (!result.handled) {
                safe_send(connection, build_error_reply(envelope, 'command_not_found', `未知命令: ${data.command}`, envelope.bot_id));
            }
            return;
        }

        const result = await trigger_command(entry.bot, command_text, {
            bot_id: envelope.bot_id,
            msg_id: envelope.msg_id,
            internal_permission: 'system',
            reply: async () => {},
        });

        if (!result.handled) {
            safe_send(connection, build_error_reply(envelope, 'command_not_found', `未知命令: ${data.command}`, envelope.bot_id));
            return;
        }

        safe_send(connection, build_reply(envelope, 'success', {
            command: data.command,
            replies: result.replies || [],
            reply: (result.replies || []).join('\n'),
        }, envelope.bot_id));
    }

    /**
     * Reply with WebSocket or bot liveness.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Ping request envelope.
     */
    function handle_ping(connection, envelope) {
        if (!envelope.bot_id) {
            safe_send(connection, build_reply(envelope, 'success', { pong: true }));
            return;
        }

        const info = bot_manager.get_info(envelope.bot_id);
        safe_send(connection, build_reply(envelope, 'success', {
            pong: true,
            bot_id: envelope.bot_id,
            online: info.state === 'online',
            state: info.state,
        }, envelope.bot_id));
    }

    /**
     * Reply with the current player list for a bot.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Player request envelope.
     */
    function handle_player(connection, envelope) {
        require_bot_id(envelope);
        const entry = bot_manager.get_entry(envelope.bot_id);
        safe_send(connection, build_reply(envelope, 'success', collect_player_list(entry.bot), envelope.bot_id));
    }

    /**
     * Reply with current info for one bot.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Bot info request envelope.
     */
    function handle_bot_info(connection, envelope) {
        require_bot_id(envelope);
        safe_send(connection, build_reply(envelope, 'success', bot_manager.get_info(envelope.bot_id), envelope.bot_id));
    }

    /**
     * Reply with all known bots.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Bot list request envelope.
     */
    function handle_bot_list(connection, envelope) {
        safe_send(connection, build_reply(envelope, 'success', { bots: bot_manager.list() }));
    }

    /**
     * Accept known client event notifications.
     * @param {object} connection - Connection state wrapper.
     * @param {object} envelope - Client event envelope.
     */
    function handle_client_event(connection, envelope) {
        const data = envelope.data || {};
        if (!CLIENT_EVENT_TYPES.has(data.event_type)) {
            throw create_protocol_error('invalid_message', `未知客户端事件: ${data.event_type || ''}`);
        }
        if (envelope.need_reply) {
            safe_send(connection, build_reply(envelope, 'success', { accepted: true }, envelope.bot_id));
        }
    }

    return { handle_message };
}

/**
 * Enforce the authentication gate for one incoming envelope.
 * @param {object} connection - Connection state wrapper.
 * @param {object} envelope - Parsed request envelope.
 */
function enforce_auth_state(connection, envelope) {
    if (!connection.authenticated) {
        const allowed_ping = envelope.type === 'ping' && !envelope.bot_id;
        if (!PUBLIC_TYPES.has(envelope.type) || !allowed_ping && envelope.type !== 'auth') {
            throw create_protocol_error('auth_required', '请先发送 auth 完成认证');
        }
    }

    if (BOT_SCOPED_TYPES.has(envelope.type)) {
        require_bot_id(envelope);
    }
}

/**
 * Send an error as a request reply when possible, otherwise as an error push.
 * @param {object} connection - Connection state wrapper.
 * @param {object|null} envelope - Original request envelope when available.
 * @param {Error} err - Error to send.
 */
function respond_error(connection, envelope, err) {
    const error_type = err && err.error_type ? err.error_type : 'internal_error';
    const error_message = err && err.message ? err.message : String(err);

    if (envelope && envelope.need_reply === true && envelope.msg_id) {
        safe_send(connection, build_error_reply(envelope, error_type, error_message, envelope.bot_id));
        return;
    }
    safe_send(connection, build_error(error_type, error_message, envelope && envelope.bot_id));
}

/**
 * Ensure a login request can receive a final success/error reply.
 * @param {object} envelope - Login request envelope.
 */
function require_login_reply(envelope) {
    if (envelope.need_reply !== true || !envelope.msg_id) {
        throw create_protocol_error('missing_field', '登录请求必须设置 need_reply=true 并提供 msg_id');
    }
}

/**
 * Check whether a command or alias is currently registered.
 * @param {string} command_name - Requested command name.
 * @returns {boolean} Whether the command exists.
 */
function command_exists(command_name) {
    return get_commands().some((command) => command.match(command_name));
}

module.exports = {
    create_handlers,
    enforce_auth_state,
    respond_error,
};
