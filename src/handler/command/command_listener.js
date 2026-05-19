const { get_commands } = require('./command_registry');
const { get_message_permission, has_permission } = require('./utils/permission_utils');
const config = require('../../configs/config');
const permission_store = require('../../utils/permission_store');
const {
    get_prefix,
    get_cancel_command,
    get_session_key,
    parse_command_text,
    is_command_position,
    is_bot_self_message,
    attach_bot_id,
} = require('./utils/command_text_utils');
const {
    CommandSession,
    CommandFinishSignal,
    CommandTimeoutError,
    CommandCancelledError,
} = require('./command_session');

const waiting_sessions = new Map();

/**
 * Build default listener options from runtime config and persistent permissions.
 * @param {object} options - Explicit listener options.
 * @returns {object} Listener options.
 */
function build_default_options(options = {}) {
    permission_store.ensure_loaded(config);
    return {
        prefix: config.whisper_command_prefix || '#',
        cancel_command: '#cancel',
        default_permission: 'guest',
        ...options,
        permission_resolver: options.permission_resolver || ((msg) => {
            const username = msg && msg.player && msg.player.username;
            return permission_store.get_player_permission(username, msg);
        }),
    };
}

/**
 * 挂起当前执行的逻辑，等待对应用户的下一条消息
 * @param {CommandSession} session - 指令会话实例
 * @param {object} options - 等待配置 (包含 timeout、filter)
 * @returns {Promise<object>} 返回接收到的消息对象
 */
function wait_for_message(session, options = {}) {
    const timeout = Number.isFinite(options.timeout) ? options.timeout : 60000;
    const filter = typeof options.filter === 'function' ? options.filter : null;

    return new Promise((resolve, reject) => {
        const timer = timeout > 0
            ? setTimeout(() => {
                waiting_sessions.delete(session.session_key);
                reject(new CommandTimeoutError());
            }, timeout)
            : null;

        waiting_sessions.set(session.session_key, {
            session,
            filter,
            resolve: (msg) => {
                if (timer) clearTimeout(timer);
                waiting_sessions.delete(session.session_key);
                session.update_msg(msg);
                resolve(msg);
            },
            reject: (err) => {
                if (timer) clearTimeout(timer);
                waiting_sessions.delete(session.session_key);
                reject(err);
            },
        });
    });
}

/**
 * 尝试将新消息推送给正在等待的会话
 * @param {object} msg - 接收到的消息
 * @param {object} options - 配置选项
 * @returns {Promise<boolean>} 如果消息被等待中的会话消费则返回 true
 */
async function feed_waiting_session(msg, options = {}) {
    const key = get_session_key(msg);
    const waiting = waiting_sessions.get(key);
    if (!waiting) return false;

    const cancel_text = get_cancel_command(options);
    if (String(msg.message || '').trim().toLowerCase() === cancel_text.toLowerCase()) {
        waiting.reject(new CommandCancelledError());
        return true;
    }

    if (waiting.filter && !await waiting.filter(msg, waiting.session)) {
        return false;
    }

    waiting.resolve(msg);
    return true;
}

/**
 * 执行指令的处理逻辑并捕获各种控制信号/错误
 * @param {Command} command - 指令对象
 * @param {CommandSession} session - 当前会话
 * @param {object} options - 选项配置
 */
async function run_handler(command, session, options = {}) {
    try {
        if (command.handler) {
            await command.handler(session);
        }
    } catch (err) {
        if (err instanceof CommandFinishSignal) {
            return;
        }
        if (err instanceof CommandCancelledError) {
            await session.send('已取消');
            return;
        }
        if (err instanceof CommandTimeoutError) {
            await session.send('等待超时');
            return;
        }
        if (typeof options.on_error === 'function') {
            options.on_error(err, session);
            return;
        }
        console.error(`指令 ${session.command_name} 执行异常:`, err);
        await session.send(`指令执行出错：${err.message || err}`);
    }
}

/**
 * 派发命令：检查消息是否符合命令格式并执行对应命令
 * @param {object} bot - 机器人实例
 * @param {object} msg - 收到的消息对象
 * @param {object} options - 执行选项
 * @returns {Promise<object>} 返回处理结果 (包含 handled, command, session, replies 等状态)
 */
async function dispatch_command(bot, msg, options = {}) {
    attach_bot_id(bot, msg);

    if (!is_command_position(msg) || !msg.message) {
        return { handled: false, replies: [] };
    }

    if (is_bot_self_message(bot, msg, options)) {
        return { handled: false, ignored: true, reason: 'self_message', replies: [] };
    }

    if (await feed_waiting_session(msg, options)) {
        return { handled: true, waiting: true, replies: [] };
    }

    const parsed = parse_command_text(msg.message, get_prefix(options));
    if (!parsed) {
        return { handled: false, replies: [] };
    }

    const permission = get_message_permission(msg, options);
    const session_key = get_session_key(msg);
    const all_replies = [];
    let handled = false;
    let last_command = null;
    let last_session = null;

    for (const command of get_commands()) {
        if (!command.match(parsed.name)) continue;

        const session = new CommandSession({
            bot,
            msg,
            command,
            command_name: command.name,
            matched: parsed.name,
            args: parsed.args,
            permission,
            session_key,
            reply: options.reply,
            wait_for_message,
        });

        if (!await command.rule(session)) {
            continue;
        }

        if (!has_permission(permission, command.permission)) {
            await session.send(`权限不足：${command.name} 需要 ${command.permission} 权限`);
            return {
                handled: true,
                command,
                session,
                replies: session.replies,
            };
        }

        if (!command.handler) {
            return {
                handled: true,
                command,
                session,
                replies: session.replies,
            };
        }

        const handler_promise = run_handler(command, session, options);
        if (options.await_handler !== false) {
            await handler_promise;
        } else {
            handler_promise.catch((err) => {
                if (typeof options.on_error === 'function') {
                    options.on_error(err, session);
                } else {
                    console.error(`指令 ${session.command_name} 执行异常:`, err);
                }
            });
        }

        handled = true;
        last_command = command;
        last_session = session;
        all_replies.push(...session.replies);

        if (command.block) {
            return {
                handled: true,
                command,
                session,
                replies: all_replies,
            };
        }
    }

    return {
        handled,
        command: last_command,
        session: last_session,
        replies: all_replies,
    };
}

/**
 * 监听机器人的消息事件以处理指令
 * @param {object} bot - 机器人实例
 * @param {object} options - 全局指令配置
 * @returns {Function} 移除监听器的回调函数
 */
function listen_command(bot, options = {}) {
    const listener_options = build_default_options(options);
    const listener = async (msg) => {
        const result = await dispatch_command(bot, msg, {
            ...listener_options,
            await_handler: false,
        });
        bot.emit('command_result', msg, result);
        if (!result.handled && !result.ignored) {
            bot.emit('command_unhandled', msg, result);
        }
    };
    bot.on('msg_obj', listener);
    return () => bot.removeListener('msg_obj', listener);
}

/**
 * mineflayer plugin entry for command dispatching.
 * @param {object} bot - mineflayer bot instance.
 */
function command_listener_plugin(bot) {
    listen_command(bot);
}

/**
 * 内部手动触发一条指令的执行
 * @param {object} bot - 机器人实例
 * @param {string} text - 要执行的命令文本
 * @param {object} options - 触发配置，可重写 player、permission 和 reply 等信息
 * @returns {Promise<object>} 派发结果
 */
async function trigger_command(bot, text, options = {}) {
    const msg = {
        msg_id: options.msg_id,
        bot_id: options.bot_id,
        player: options.player || {
            username: options.username || 'system',
            uuid: options.uuid || '',
            nickname: options.nickname || {},
        },
        message: text,
        position: 'internal',
        time: Date.now(),
        permission: options.permission || options.internal_permission || 'system',
    };

    return dispatch_command(bot, msg, {
        ...options,
        reply: options.reply || (async () => {}),
        await_handler: options.await_handler !== false,
    });
}

module.exports = Object.assign(command_listener_plugin, {
    listen_command,
    dispatch_command,
    trigger_command,
    parse_command_text,
    get_session_key,
});
