/**
 * @module plugins/echo
 * @description Echo test command plugin.
 */

const { on_command } = require('../../handler/command');

let loaded = false;

/**
 * Register echo command.
 */
module.exports = function echo_plugin() {
    if (loaded) {
        return;
    }
    loaded = true;

    const echo_command = on_command('echo', {
        permission: 'guest',
        description: 'Echo 回显测试指令',
    });

    echo_command.handle(async (session) => {
        await session.finish(session.args.join(' '));
    });
};
