/**
 * @module plugins/send
 * @description Send arbitrary text to public chat.
 */

const { on_command } = require('../../handler/command');

let loaded = false;

/**
 * Register send command.
 */
module.exports = function send_plugin() {
    if (loaded) {
        return;
    }
    loaded = true;

    const send_command = on_command('send', {
        permission: 'admin',
        description: '发送任意文本到聊天框',
    });

    send_command.handle(async (session) => {
        const text = session.args.join(' ');
        if (!text) {
            await session.finish('用法: #send <文本>');
        }

        await session.send(text, { channel: 'public' });
        await session.finish(`已发送: ${text}`);
    });
};
