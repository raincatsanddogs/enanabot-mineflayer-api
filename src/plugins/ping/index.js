/**
 * @module plugins/ping
 * @description Ping command for command system health checks.
 */

const { on_command } = require('../../handler/command');

let loaded = false;

/**
 * Register ping command.
 */
module.exports = function ping_plugin() {
    if (loaded) {
        return;
    }
    loaded = true;

    const ping_command = on_command('ping', {
        aliases: ['p'],
        permission: 'guest',
        description: '测试 command 系统是否可用',
    });

    ping_command.handle(async (session) => {
        await session.finish('pong');
    });
};
