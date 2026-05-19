/**
 * @module websocket/bot_manager
 * @description Runtime registry and lifecycle manager for WebSocket-created bots.
 */

const {
    build_error,
    build_event,
    build_minecraft_msg,
    build_reply,
    create_protocol_error,
    get_timeout_ms,
    normalize_reconnect_options,
    wait_for_bot_login,
} = require('./utils');

/**
 * Manage Mineflayer bots created by WebSocket requests.
 */
class BotManager {
    /**
     * @param {object} options - Manager options.
     * @param {Function} options.create_bot - Factory exported by index.js.
     * @param {Function} options.build_login_options_from_preset - Preset login builder.
     * @param {Function} options.broadcast - Broadcast function for authenticated clients.
     * @param {object} options.config - Runtime config.
     */
    constructor(options = {}) {
        this.create_bot = options.create_bot;
        this.build_login_options_from_preset = options.build_login_options_from_preset;
        this.broadcast = typeof options.broadcast === 'function' ? options.broadcast : () => {};
        this.config = options.config || {};
        this.bots = new Map();
        this.next_id = 1;

        if (typeof this.create_bot !== 'function') {
            throw new Error('BotManager requires create_bot');
        }
        if (typeof this.build_login_options_from_preset !== 'function') {
            throw new Error('BotManager requires build_login_options_from_preset');
        }
    }

    /**
     * Create a bot from explicit login options and wait until spawn.
     * @param {object} login_options - Login options accepted by create_bot().
     * @returns {Promise<object>} Public bot info.
     */
    async create_from_login_options(login_options) {
        const bot_id = this._generate_bot_id();
        const entry = {
            bot_id,
            bot: null,
            context: null,
            login_options: login_options || {},
            state: 'logging_in',
            created_at: Date.now(),
            reconnect_attempts: 0,
            reconnect_timer: null,
            manual_stop: false,
            login_completed: false,
            last_error: null,
        };

        this.bots.set(bot_id, entry);
        this._send_status(entry, { state: 'logging_in' });

        try {
            await this._replace_bot(entry);
            await wait_for_bot_login(entry.bot, get_timeout_ms(this.config));
            entry.login_completed = true;
            entry.reconnect_attempts = 0;
            entry.state = 'online';
            if (entry.context) entry.context.state = 'online';
            return this.get_info(bot_id);
        } catch (err) {
            entry.state = 'failed';
            entry.last_error = err;
            this._send_status(entry, { state: 'failed', reason: err.message || String(err) });
            this._safe_quit(entry.bot);
            this.bots.delete(bot_id);
            throw err.error_type ? err : create_protocol_error('login_failed', err.message || String(err));
        }
    }

    /**
     * Create a bot from configured account/server preset ids.
     * @param {number} account_id - One-based account preset id.
     * @param {number} server_id - One-based server preset id.
     * @returns {Promise<object>} Public bot info.
     */
    async create_from_preset(account_id, server_id) {
        const login_options = this.build_login_options_from_preset(account_id, server_id);
        return this.create_from_login_options(login_options);
    }

    /**
     * Stop a managed bot without removing its final status from the registry.
     * @param {string} bot_id - Bot id.
     * @returns {Promise<object>} Public bot info after stop request.
     */
    async logout(bot_id) {
        const entry = this.get_entry(bot_id);
        entry.manual_stop = true;
        this._clear_reconnect_timer(entry);
        entry.state = 'stopping';
        if (entry.context) entry.context.state = 'stopping';
        this._send_status(entry, { state: 'stopping' });

        this._safe_quit(entry.bot);
        entry.state = 'stopped';
        if (entry.context) entry.context.state = 'stopped';
        this._send_status(entry, { state: 'stopped' });
        return this.get_info(bot_id);
    }

    /**
     * Return a managed bot entry or throw a protocol error.
     * @param {string} bot_id - Bot id.
     * @returns {object} Managed bot entry.
     */
    get_entry(bot_id) {
        const entry = this.bots.get(String(bot_id || ''));
        if (!entry) {
            throw create_protocol_error('bot_not_found', `找不到指定 bot: ${bot_id || ''}`);
        }
        return entry;
    }

    /**
     * Return public info for one bot.
     * @param {string} bot_id - Bot id.
     * @returns {object} Public bot info.
     */
    get_info(bot_id) {
        return this._format_info(this.get_entry(bot_id));
    }

    /**
     * Return public info for all known bots.
     * @returns {object[]} Public bot list.
     */
    list() {
        return Array.from(this.bots.values()).map((entry) => this._format_info(entry));
    }

    /**
     * Close all managed bots and clear reconnect timers.
     * @returns {Promise<void>}
     */
    async shutdown() {
        for (const entry of this.bots.values()) {
            entry.manual_stop = true;
            this._clear_reconnect_timer(entry);
            this._safe_quit(entry.bot);
        }
    }

    _generate_bot_id() {
        let bot_id = `bot_${this.next_id++}`;
        while (this.bots.has(bot_id)) {
            bot_id = `bot_${this.next_id++}`;
        }
        return bot_id;
    }

    _format_info(entry) {
        const context = entry.context || {};
        return {
            bot_id: entry.bot_id,
            username: context.username || (entry.bot && entry.bot.username) || '',
            state: context.state || entry.state,
            server: context.server || (entry.login_options && entry.login_options.server) || {},
            created_at: entry.created_at,
        };
    }

    _build_runtime_context(bot_id) {
        return {
            bot_id,
            push_event: async (event_type, event_data) => {
                this.broadcast(build_event(event_type, event_data, bot_id));
            },
            push_reply: async (data, session, options = {}) => {
                const msg_id = options.msg_id || data.msg_id || (session && session.msg && session.msg.msg_id);
                if (!msg_id) {
                    this.broadcast(build_event('system.notice', data, bot_id));
                    return;
                }
                this.broadcast(build_reply({ msg_id, bot_id }, 'success', data, bot_id));
            },
            on_status: (context, status) => this._handle_status(bot_id, status || {}),
            on_error: (context, error) => this._handle_error(bot_id, error),
        };
    }

    async _replace_bot(entry) {
        const bot = await this.create_bot(entry.login_options, this._build_runtime_context(entry.bot_id));
        entry.bot = bot;
        entry.context = bot.__enanabot_context || {};
        entry.state = entry.context.state || 'logging_in';
        this._attach_bot_listeners(entry, bot);
        return bot;
    }

    _attach_bot_listeners(entry, bot) {
        bot.on('msg_obj', (msg) => {
            if (msg && msg.suppress_forward) {
                return;
            }
            this.broadcast(build_minecraft_msg(msg, entry.bot_id));
        });
    }

    _handle_status(bot_id, status) {
        const entry = this.bots.get(bot_id);
        if (!entry) return;

        entry.state = status.state || entry.state;
        this._send_status(entry, status);

        if (status.state === 'online') {
            entry.login_completed = true;
            entry.reconnect_attempts = 0;
            return;
        }

        if (status.state === 'offline' && entry.login_completed && !entry.manual_stop) {
            this._schedule_reconnect(entry, status.reason || 'disconnect');
        }
    }

    _handle_error(bot_id, error) {
        const entry = this.bots.get(bot_id);
        if (!entry) return;

        entry.last_error = error;
        this.broadcast(build_error(
            'internal_error',
            error && error.message ? error.message : String(error),
            bot_id
        ));
    }

    _send_status(entry, status) {
        const context = entry.context || {};
        this.broadcast(build_event('bot.status', {
            state: status.state || entry.state,
            username: context.username || (entry.bot && entry.bot.username) || '',
            reason: status.reason || '',
        }, entry.bot_id));
    }

    _schedule_reconnect(entry, reason) {
        const reconnect = normalize_reconnect_options(
            entry.login_options && entry.login_options.reconnect,
            this.config
        );

        if (!reconnect.enabled) {
            this.broadcast(build_event('bot.reconnect', {
                state: 'disabled',
                reason,
            }, entry.bot_id));
            return;
        }

        if (reconnect.max_attempts > 0 && entry.reconnect_attempts >= reconnect.max_attempts) {
            this.broadcast(build_event('bot.reconnect', {
                state: 'failed',
                attempt: entry.reconnect_attempts,
                max_attempts: reconnect.max_attempts,
                reason,
            }, entry.bot_id));
            return;
        }

        this._clear_reconnect_timer(entry);
        entry.reconnect_attempts += 1;
        entry.state = 'reconnecting';
        if (entry.context) entry.context.state = 'reconnecting';
        this._send_status(entry, { state: 'reconnecting', reason });
        this.broadcast(build_event('bot.reconnect', {
            state: 'retrying',
            attempt: entry.reconnect_attempts,
            max_attempts: reconnect.max_attempts,
            reason,
        }, entry.bot_id));

        entry.reconnect_timer = setTimeout(() => {
            this._run_reconnect(entry.bot_id, reason).catch((err) => {
                this._handle_error(entry.bot_id, err);
            });
        }, reconnect.interval * 1000);
    }

    async _run_reconnect(bot_id, reason) {
        const entry = this.bots.get(bot_id);
        if (!entry || entry.manual_stop) return;

        entry.login_completed = false;
        try {
            await this._replace_bot(entry);
            await wait_for_bot_login(entry.bot, get_timeout_ms(this.config));
            entry.login_completed = true;
            entry.reconnect_attempts = 0;
            entry.state = 'online';
            if (entry.context) entry.context.state = 'online';
            this.broadcast(build_event('bot.reconnect', {
                state: 'success',
                reason,
            }, bot_id));
        } catch (err) {
            entry.login_completed = true;
            entry.last_error = err;
            this.broadcast(build_event('bot.reconnect', {
                state: 'failed',
                attempt: entry.reconnect_attempts,
                reason: err.message || String(err),
            }, bot_id));
            this._schedule_reconnect(entry, err.message || String(err));
        }
    }

    _clear_reconnect_timer(entry) {
        if (entry && entry.reconnect_timer) {
            clearTimeout(entry.reconnect_timer);
            entry.reconnect_timer = null;
        }
    }

    _safe_quit(bot) {
        if (bot && typeof bot.quit === 'function') {
            try {
                bot.quit();
            } catch (err) {
                this.broadcast(build_error('internal_error', err.message || String(err)));
            }
        }
    }
}

module.exports = BotManager;
