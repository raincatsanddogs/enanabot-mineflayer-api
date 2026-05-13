/**
 * @module plugins/hint
 * @description Wordle hint command plugin.
 */

const { on_command } = require('../../handler/command');
const wordle_state = require('../wordle/wordle_state');

let loaded = false;

/**
 * Register hint command.
 */
module.exports = function hint_plugin() {
    if (loaded) {
        return;
    }
    loaded = true;

    const hint_command = on_command('hint', {
        permission: 'guest',
        description: '获取wordle提示',
    });

    hint_command.handle(async (session) => {
        await session.send(wordle_state.get_hint(), { channel: 'public' });
    });
};
