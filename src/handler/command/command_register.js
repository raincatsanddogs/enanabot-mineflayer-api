const { on_command } = require('./index');

let registered = false;

/**
 * 注册内置指令，如测试指令 'ping'
 * 防止重复注册
 */
function register_builtin_commands() {
    if (registered) return;
    registered = true;

    const ping = on_command('ping', {
        aliases: ['p'],
        permission: 'guest',
        description: '测试 command 系统是否可用',
    });

    ping.handle(async (session) => {
        await session.finish('pong');
    });
}

module.exports = {
    register_builtin_commands,
};
