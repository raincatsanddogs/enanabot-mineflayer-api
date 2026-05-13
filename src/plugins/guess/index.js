/**
 * @module plugins/guess
 * @description Wordle guess command plugin.
 */

const { on_command } = require('../../handler/command');
const wordle_state = require('../wordle/wordle_state');

let loaded = false;

/**
 * Register guess command.
 */
module.exports = function guess_plugin() {
    if (loaded) {
        return;
    }
    loaded = true;

    const guess_command = on_command('guess', {
        permission: 'guest',
        description: '猜wordle词',
    });

    guess_command.handle(async (session) => {
        const result = wordle_state.guess_word(session.args[0]);
        for (const message of result.messages) {
            await session.send(message, { channel: 'public' });
        }
    });
};
