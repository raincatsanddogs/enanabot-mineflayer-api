/**
 * @module plugins/help
 * @description Help command plugin.
 */

const { on_command } = require('../../handler/command');

let loaded = false;

const HELP_TEXT = {
    tpa: 'tpa 指令: 查看 TPA 状态\n用法: #tpa [status|on|off|back]\nstatus: 查看状态；on: 开启自动接受；off: 关闭自动接受；back: 返回并释放占用。',
    home: 'home 指令: 管理 home。\n用法: #home <list|tp|set|remove> [名称]\n非 admin 仅可使用 list。',
    echo: 'echo 指令: 回显测试。用法: #echo <文本>',
    help: 'help 指令: 显示帮助信息。用法: #help <指令名>',
    perm: 'perm 指令: 权限管理。用法: #perm 或 #perm <list|get|set|remove> <玩家> [guest|user|admin]',
    send: 'send 指令: 发送任意文本到聊天框。用法: #send <文本>',
    wordle: 'wordle 指令: 玩一个单词猜谜游戏。用法:\n#wordle [start|stop]\n#guess <单词>\n#hint',
    ping: 'ping 指令: 测试指令系统。用法: #ping',
};

/**
 * Register help command.
 */
module.exports = function help_plugin() {
    if (loaded) {
        return;
    }
    loaded = true;

    const help_command = on_command('help', {
        permission: 'guest',
        description: '显示帮助信息',
    });

    help_command.handle(async (session) => {
        const sub = String(session.args[0] || '').toLowerCase();
        if (!sub) {
            await session.finish('可用指令: tpa, home, echo, help, perm, send, wordle, guess, hint, ping。使用 "#help <指令名>" 查看详情。');
        }

        await session.finish(HELP_TEXT[sub] || `未知指令: ${sub}`);
    });
};
