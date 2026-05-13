/**
 * @module plugins/home
 * @description Home management command plugin.
 */

const { on_command } = require('../../handler/command');
const home_cache = require('../../utils/home_cache');
const {
    execute_home_operation,
    format_home_result_message,
    is_home_related_message,
} = require('./home_service');

let loaded = false;

/**
 * Register the home command and home GUI suppression hook.
 * @param {object} bot - mineflayer bot instance.
 */
module.exports = function home_plugin(bot) {
    if (loaded) {
        return;
    }
    loaded = true;

    home_cache.load();

    const add_listener = typeof bot.prependListener === 'function'
        ? bot.prependListener.bind(bot)
        : bot.on.bind(bot);

    add_listener('msg_obj', (msg) => {
        if (home_cache.needs_refresh() && is_home_related_message(msg)) {
            msg.suppress_forward = true;
        }
    });

    const home_command = on_command('home', {
        permission: 'guest',
        description: 'Home 管理指令',
    });

    home_command.handle(async (session) => {
        const usage = '用法: #home <list|tp|set|remove> [名称]';
        const sub = String(session.args[0] || '').toLowerCase();
        const name = session.args[1];
        const all_subcommands = new Set(['list', 'tp', 'set', 'remove']);
        const user_allowed = new Set(['list']);

        if (!sub) {
            await session.finish(usage);
        }

        if (!all_subcommands.has(sub)) {
            await session.finish(session.permission === 'admin' ? usage : `权限不足：home ${sub}`);
        }

        if (session.permission !== 'admin' && !user_allowed.has(sub)) {
            await session.finish(`权限不足：home ${sub}`);
        }

        if (sub === 'tp' && !name) {
            const operation = await execute_home_operation(session.bot, 'list');
            await session.finish(format_home_result_message('list', operation.success, operation.result, operation.error, ''));
        }

        if ((sub === 'set' || sub === 'remove') && !name) {
            await session.finish(`用法: #home ${sub} <名称>`);
        }

        try {
            const operation = await execute_home_operation(session.bot, sub, name);
            await session.finish(format_home_result_message(sub, operation.success, operation.result, operation.error, name));
        } catch (err) {
            await session.finish(format_home_result_message(sub, false, '', err, name));
        }
    });
};
