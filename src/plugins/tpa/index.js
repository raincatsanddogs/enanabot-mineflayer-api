/**
 * @module plugins/tpa
 * @description TPA command and auto-accept plugin.
 */

const { on_command } = require('../../handler/command');
const { normalize_player_name } = require('../../handler/command/utils/permission_utils');
const home_cache = require('../../utils/home_cache');
const { stringify_error } = require('../../utils/error_utils');
const { get_bot_context, get_bot_scope } = require('../../utils/bot_context');
const tpa_state = require('./tpa_state');

const TPA_BACKUP_HOME = 'tpabackup';
const TPA_ACCEPT_DELAY_MS = 1000;
const TPA_BACK_WAIT_MS = 1500;
const TPA_BACK_SETTLE_MS = 300;

let commands_registered = false;
const attached_bots = new WeakSet();

/**
 * Delay execution for a number of milliseconds.
 * @param {number} ms - Milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a TPA event through the bot runtime context.
 * @param {object} bot - Mineflayer bot instance.
 * @param {string} event_type - WebSocket event type.
 * @param {object} event_data - Event payload.
 */
function send_tpa_event(bot, event_type, event_data) {
    const context = get_bot_context(bot);
    if (typeof context.push_event === 'function') {
        context.push_event(event_type, event_data, { bot, context });
        return;
    }
    console.log(`[tpa:${event_type}] ${JSON.stringify(event_data)}`);
}

/**
 * Format current TPA state for chat output.
 * @param {string} scope - Bot state scope.
 * @returns {string} State text.
 */
function format_tpa_status(scope) {
    const state = tpa_state.get_state(scope);
    const enabled_text = state.enabled ? '开启' : '关闭';
    const occupied_text = state.occupied
        ? `是（${state.occupied_by || '未知'}）`
        : '否';
    return `TPA 状态: 自动接受=${enabled_text}, 占用=${occupied_text}`;
}

/**
 * Execute the TPA back workflow and release the occupied lock.
 * @param {object} bot - mineflayer bot instance.
 * @param {string} [scope] - Bot state scope.
 * @returns {Promise<string>} Result text.
 */
async function execute_tpa_back(bot, scope = get_bot_scope(bot)) {
    const state = tpa_state.get_state(scope);
    if (!state.occupied) {
        return '当前没有占用，无需返回';
    }

    bot.chat(`/home ${TPA_BACKUP_HOME}`);

    await new Promise((resolve) => {
        let timer = null;
        const on_move = () => {
            if (timer) {
                clearTimeout(timer);
            }
            setTimeout(resolve, TPA_BACK_SETTLE_MS);
        };
        bot.once('forcedMove', on_move);
        timer = setTimeout(() => {
            bot.removeListener('forcedMove', on_move);
            resolve();
        }, TPA_BACK_WAIT_MS);
    });

    bot.chat(`/removehome ${TPA_BACKUP_HOME}`);
    home_cache.remove_home(TPA_BACKUP_HOME, scope);
    tpa_state.release(scope);

    return '已返回原位置';
}

/**
 * Handle one TPA auto-accept request.
 * @param {object} bot - mineflayer bot instance.
 * @param {{ requester?: string, tpa_type?: string, accept_command?: string }} tpa_info - TPA info.
 * @param {string} scope - Bot state scope.
 * @returns {Promise<void>}
 */
async function handle_tpa_auto_accept(bot, tpa_info, scope) {
    const requester = tpa_info.requester || '未知';
    const tpa_type = tpa_info.tpa_type || 'tpa';
    const accept_command = tpa_info.accept_command;

    if (!accept_command) {
        send_tpa_event(bot, 'tpa.notification', {
            message: `TPA 自动接受失败: 缺少接受指令 (${requester})`,
        });
        return;
    }

    tpa_state.occupy(requester, scope);
    bot.chat(`/sethome ${TPA_BACKUP_HOME}`);
    home_cache.add_home(TPA_BACKUP_HOME, scope);

    try {
        await delay(TPA_ACCEPT_DELAY_MS);
        bot.chat(accept_command);

        send_tpa_event(bot, 'tpa.notification', {
            message: `TPA 自动接受: ${requester} (${tpa_type})`,
        });
        console.log(`TPA auto-accepted: ${requester} (${tpa_type})`);
    } catch (err) {
        tpa_state.release(scope);
        console.error(`TPA auto-accept failed: ${err.message || err}`);
        send_tpa_event(bot, 'tpa.notification', {
            message: `TPA 自动接受失败: ${stringify_error(err)}`,
        });
    }
}

/**
 * Mark and process TPA request messages from message_handler.
 * @param {object} bot - mineflayer bot instance.
 * @param {object} msg - msg_obj.
 */
function handle_tpa_message(bot, msg) {
    if (!msg || msg.position !== 'tpa') {
        return;
    }

    msg.suppress_forward = true;
    msg.handled_by_tpa = true;

    const tpa_info = (msg.data && msg.data.tpa_info) || {};
    const requester = tpa_info.requester || (msg.player && msg.player.username) || '';
    const scope = get_bot_scope(bot);
    const state = tpa_state.get_state(scope);

    if (!state.enabled) {
        send_tpa_event(bot, 'tpa.request_detected', {
            requester,
            type: tpa_info.tpa_type || 'tpa',
            auto_accepted: false,
        });
        return;
    }

    if (state.occupied) {
        send_tpa_event(bot, 'tpa.notification', {
            message: `TPA 请求被拒绝（当前被 ${state.occupied_by || '未知'} 占用）: ${requester || '未知'}`,
        });
        return;
    }

    handle_tpa_auto_accept(bot, {
        ...tpa_info,
        requester,
    }, scope);
}

/**
 * Register the TPA command and TPA request listener.
 * @param {object} bot - mineflayer bot instance.
 */
module.exports = function tpa_plugin(bot) {
    const scope = get_bot_scope(bot);
    tpa_state.load(scope);
    home_cache.load(scope);

    // Listeners are per bot, while command definitions are process-global.
    if (!attached_bots.has(bot)) {
        attached_bots.add(bot);
        const add_listener = typeof bot.prependListener === 'function'
            ? bot.prependListener.bind(bot)
            : bot.on.bind(bot);

        add_listener('msg_obj', (msg) => handle_tpa_message(bot, msg));
    }

    if (commands_registered) {
        return;
    }
    commands_registered = true;

    const tpa_command = on_command('tpa', {
        permission: 'guest',
        description: 'TPA 控制',
    });

    tpa_command.handle(async (session) => {
        const session_scope = get_bot_scope(session.bot);
        const sub = String(session.args[0] || 'status').toLowerCase();
        const state = tpa_state.get_state(session_scope);

        if (sub === 'status') {
            await session.finish(format_tpa_status(session_scope));
        }

        if (sub === 'on') {
            if (session.permission !== 'admin' && session.permission !== 'system') {
                await session.finish('权限不足：需要管理员权限');
            }
            tpa_state.set_enabled(true, session_scope);
            await session.finish('TPA 自动接受已开启');
        }

        if (sub === 'off') {
            if (session.permission !== 'admin' && session.permission !== 'system') {
                await session.finish('权限不足：需要管理员权限');
            }
            if (state.occupied) {
                try {
                    await execute_tpa_back(session.bot, session_scope);
                } catch (err) {
                    await session.finish(`关闭失败: ${stringify_error(err)}`);
                }
            }
            tpa_state.reset(session_scope);
            await session.finish('TPA 自动接受已关闭');
        }

        if (sub === 'back') {
            if (!state.occupied) {
                await session.finish('当前没有占用，无需返回');
            }

            const sender_name = normalize_player_name(session.player && session.player.username);
            const occupied_by = normalize_player_name(state.occupied_by);
            const is_occupier = sender_name && occupied_by && sender_name === occupied_by;

            if (session.permission !== 'admin' && session.permission !== 'system' && !is_occupier) {
                await session.finish('权限不足：需要管理员权限或占用者本人');
            }

            let result = '';
            try {
                result = await execute_tpa_back(session.bot, session_scope);
            } catch (err) {
                await session.finish(`返回失败: ${stringify_error(err)}`);
            }
            await session.finish(result);
        }

        await session.finish(`未知子指令: ${sub}。可用: status, on, off, back`);
    });
};

module.exports.execute_tpa_back = execute_tpa_back;
