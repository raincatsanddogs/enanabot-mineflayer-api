/**
 * @module message_pusher
 * @description Unified message push helper for private, public, and external replies.
 */

const { get_bot_context } = require('./bot_context');

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
        const context = get_bot_context(bot);
        const data = {
            reply_to: options.reply_to || (session && session.player && session.player.username) || '',
            command: options.command || (session && session.command_name) || '',
            result: content,
            ...(options.data || {}),
        };

        // "ipc" is kept as a compatibility channel name for existing command
        // code, but the transport is now supplied by the WebSocket/runtime layer.
        if (typeof context.push_reply === 'function') {
            await context.push_reply(data, session, options);
            return;
        }
        if (typeof context.push_event === 'function') {
            await context.push_event('system.notice', data, session, options);
            return;
        }
        console.warn(`[message_pusher] external channel unavailable: ${content}`);
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
