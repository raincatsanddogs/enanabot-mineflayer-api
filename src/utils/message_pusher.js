/**
 * @module message_pusher
 * @description Unified message push helper for private, public, and IPC replies.
 */

const ipc = require('../ipc/ipc_protocol');

/**
 * Send text through the selected channel.
 * @param {object} bot - mineflayer bot instance.
 * @param {object} session - Command session or session-like object.
 * @param {string} text - Text to send.
 * @param {object} [options] - Push options.
 * @param {'private'|'public'|'ipc'} [options.channel='private'] - Target channel.
 * @param {string} [options.target] - Private message target player.
 * @param {string} [options.action] - IPC action name.
 * @param {object} [options.data] - Extra IPC payload fields.
 * @returns {Promise<void>}
 */
async function push_message(bot, session, text, options = {}) {
    if (text === undefined || text === null) {
        return;
    }

    const content = String(text);
    const channel = options.channel || 'private';

    if (channel === 'public') {
        if (bot && typeof bot.chat === 'function') {
            bot.chat(content);
        }
        return;
    }

    if (channel === 'ipc') {
        const action = options.action || ipc.ACTION_DELEGATE_RESULT;
        const data = {
            reply_to: options.reply_to || (session && session.player && session.player.username) || '',
            command: options.command || (session && session.command_name) || '',
            result: content,
            ...(options.data || {}),
        };
        process.stdout.write(ipc.encode(action, data));
        return;
    }

    const target = options.target || (session && session.player && session.player.username);
    if (bot && target && typeof bot.whisper === 'function') {
        bot.whisper(target, content);
        return;
    }

    if (bot && typeof bot.chat === 'function') {
        bot.chat(content);
    }
}

module.exports = {
    push_message,
};
