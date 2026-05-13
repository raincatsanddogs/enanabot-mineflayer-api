/**
 * @module plugins/wordle
 * @description Wordle start/stop command plugin.
 */

const { on_command } = require('../../handler/command');
const wordle_state = require('./wordle_state');

let loaded = false;

/**
 * Send a Wordle message to public chat.
 * @param {object} session - Command session.
 * @param {string} text - Text to send.
 * @returns {Promise<void>}
 */
async function send_wordle_public(session, text) {
    await session.send(text, { channel: 'public' });
}

/**
 * Register wordle command.
 */
module.exports = function wordle_plugin() {
    if (loaded) {
        return;
    }
    loaded = true;

    wordle_state.ensure_initialized();

    const wordle_command = on_command('wordle', {
        permission: 'guest',
        description: 'wordle游戏指令',
    });

    wordle_command.handle(async (session) => {
        const sub = String(session.args[0] || '').toLowerCase();
        if (sub === 'start') {
            await send_wordle_public(session, wordle_state.start_game().message);
            return;
        }

        if (sub === 'stop') {
            await send_wordle_public(session, wordle_state.stop_game().message);
            return;
        }

        await send_wordle_public(session, '用法: #wordle <start|stop>');
    });
};
