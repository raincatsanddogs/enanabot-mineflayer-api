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
    is_self_message,
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
     * @param {string} [bot_id=null] - Optional specific bot ID to reuse (for persistence restore).
     * @param {object} [preset_info=null] - Optional preset metadata if created via preset.
     * @returns {Promise<object>} Public bot info.
     */
    async create_from_login_options(login_options, bot_id = null, preset_info = null) {
        const actual_bot_id = bot_id || this._generate_bot_id();
        if (this.bots.has(actual_bot_id)) {
            throw create_protocol_error('bot_already_exists', `机器人 ${actual_bot_id} 已经在运行`);
        }

        const entry = {
            bot_id: actual_bot_id,
            bot: null,
            context: null,
            login_options: login_options || {},
            preset_info,
            state: 'logging_in',
            created_at: Date.now(),
            reconnect_attempts: 0,
            reconnect_timer: null,
            manual_stop: false,
            login_completed: false,
            last_error: null,
        };

        this.bots.set(actual_bot_id, entry);
        this._send_status(entry, { state: 'logging_in' });

        try {
            await this._replace_bot(entry);
            await wait_for_bot_login(entry.bot, get_timeout_ms(this.config));
            entry.login_completed = true;
            entry.reconnect_attempts = 0;
            entry.state = 'online';
            if (entry.context) entry.context.state = 'online';
            this._save_persistence();
            return this.get_info(actual_bot_id);
        } catch (err) {
            entry.state = 'failed';
            entry.last_error = err;
            this._send_status(entry, { state: 'failed', reason: err.message || String(err) });
            this._cleanup_bot_entry(entry);
            throw err.error_type ? err : create_protocol_error('login_failed', err.message || String(err));
        }
    }

    /**
     * Create a bot from configured account/server preset ids.
     * @param {number} account_id - One-based account preset id.
     * @param {number} server_id - One-based server preset id.
     * @param {string} [bot_id=null] - Optional specific bot ID to reuse (for persistence restore).
     * @returns {Promise<object>} Public bot info.
     */
    async create_from_preset(account_id, server_id, bot_id = null) {
        const login_options = this.build_login_options_from_preset(account_id, server_id);
        return this.create_from_login_options(login_options, bot_id, { account_id, server_id });
    }

    /**
     * Stop a managed bot and remove it from the registry after reporting stopped.
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
        const info = this._format_info(entry);
        this._cleanup_bot_entry(entry, { quit: false });
        return info;
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
        for (const entry of Array.from(this.bots.values())) {
            entry.manual_stop = true;
            this._cleanup_bot_entry(entry, { save_persistence: false });
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
            if ((msg && msg.suppress_forward) || is_self_message(bot, msg)) {
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
            this._cleanup_bot_entry(entry, { quit: false });
            return;
        }

        if (reconnect.max_attempts > 0 && entry.reconnect_attempts >= reconnect.max_attempts) {
            this.broadcast(build_event('bot.reconnect', {
                state: 'failed',
                attempt: entry.reconnect_attempts,
                max_attempts: reconnect.max_attempts,
                reason,
            }, entry.bot_id));
            this._cleanup_bot_entry(entry, { quit: false });
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
            this._save_persistence();
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

    /**
     * Require a managed bot to be online before performing live bot operations.
     * @param {string} bot_id - Bot id.
     * @returns {object} Managed bot entry.
     */
    require_online_entry(bot_id) {
        const entry = this.get_entry(bot_id);
        const state = (entry.context && entry.context.state) || entry.state;
        if (state !== 'online') {
            throw create_protocol_error('bot_offline', `机器人当前不在线 (当前状态: ${state})`);
        }
        return entry;
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

    /**
     * Remove a bot entry and release listeners/timers owned by the manager.
     * @param {object} entry - Managed bot entry.
     * @param {object} [options] - Cleanup options.
     * @param {boolean} [options.quit=true] - Whether to call bot.quit().
     * @param {boolean} [options.save_persistence=true] - Whether to update persistence file after deletion.
     */
    _cleanup_bot_entry(entry, options = {}) {
        if (!entry) return;
        const quit = options.quit !== false;
        this._clear_reconnect_timer(entry);
        entry.manual_stop = true;

        if (entry.bot && typeof entry.bot.removeAllListeners === 'function') {
            entry.bot.removeAllListeners();
        }
        if (quit) {
            this._safe_quit(entry.bot);
        }

        this.bots.delete(entry.bot_id);

        if (options.save_persistence !== false) {
            this._save_persistence();
        }
    }

    /**
     * Save active bots to the persistence JSON file.
     * @private
     */
    _save_persistence() {
        try {
            const fs = require('fs');
            const path = require('path');
            const persistence_dir = path.resolve(__dirname, '../../configs');
            const file_path = path.join(persistence_dir, 'bot_persistence.json');

            const data = {
                bots: [],
            };

            for (const entry of this.bots.values()) {
                // Only persist bots that successfully logged in and are not manually stopped
                if (entry.login_completed && !entry.manual_stop) {
                    data.bots.push({
                        bot_id: entry.bot_id,
                        type: entry.preset_info ? 'preset' : 'account',
                        preset_info: entry.preset_info,
                        login_options: entry.login_options,
                    });
                }
            }

            if (!fs.existsSync(persistence_dir)) {
                fs.mkdirSync(persistence_dir, { recursive: true });
            }
            fs.writeFileSync(file_path, JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) {
            console.error('[BotManager] 保存机器人持久化配置失败:', err.message || err);
        }
    }

    /**
     * Load persisted bots on startup and attempt to log them in.
     * @returns {Promise<void>}
     */
    async auto_restore() {
        try {
            const fs = require('fs');
            const path = require('path');
            const persistence_dir = path.resolve(__dirname, '../../configs');
            const file_path = path.join(persistence_dir, 'bot_persistence.json');

            if (!fs.existsSync(file_path)) {
                return;
            }

            const raw = fs.readFileSync(file_path, 'utf-8');
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.bots) || data.bots.length === 0) {
                return;
            }

            console.log(`[BotManager] 检测到 ${data.bots.length} 个持久化挂载的机器人，开始自动恢复登录...`);

            const promises = data.bots.map(async (bot_data) => {
                try {
                    console.log(`[BotManager] 正在自动恢复机器人: ${bot_data.bot_id} (${bot_data.type})`);
                    if (bot_data.type === 'preset' && bot_data.preset_info) {
                        const { account_id, server_id } = bot_data.preset_info;
                        await this.create_from_preset(account_id, server_id, bot_data.bot_id);
                    } else if (bot_data.type === 'account' && bot_data.login_options) {
                        await this.create_from_login_options(bot_data.login_options, bot_data.bot_id);
                    } else {
                        console.warn(`[BotManager] 忽略格式不正确的持久化数据: ${bot_data.bot_id}`);
                    }
                    console.log(`[BotManager] 机器人恢复登录成功: ${bot_data.bot_id}`);
                } catch (err) {
                    console.error(`[BotManager] 自动恢复机器人 ${bot_data.bot_id} 失败:`, err.message || err);
                }
            });

            // Start in parallel in the background, don't block
            Promise.allSettled(promises).then(() => {
                console.log('[BotManager] 机器人自动恢复登录流程结束。');
            });
        } catch (err) {
            console.error('[BotManager] 加载机器人持久化配置失败:', err.message || err);
        }
    }
}

module.exports = BotManager;
