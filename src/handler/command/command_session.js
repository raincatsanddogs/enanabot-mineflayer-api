const { push_message } = require('../../utils/message_pusher');

class CommandFinishSignal extends Error {
    constructor() {
        super('Command finished');
        this.name = 'CommandFinishSignal';
    }
}

class CommandTimeoutError extends Error {
    constructor() {
        super('Command receive timeout');
        this.name = 'CommandTimeoutError';
    }
}

class CommandCancelledError extends Error {
    constructor() {
        super('Command cancelled');
        this.name = 'CommandCancelledError';
    }
}

class CommandSession {
    constructor(options = {}) {
        this.bot = options.bot || null;
        this.msg = options.msg || {};
        this.player = this.msg.player || {};
        this.message = this.msg.message || '';
        this.position = this.msg.position || 'internal';
        this.time = this.msg.time || Date.now();
        this.command = options.command || null;
        this.command_name = options.command_name || '';
        this.matched = options.matched || '';
        this.args = options.args || [];
        this.permission = options.permission || 'guest';
        this.session_key = options.session_key || '';
        this.data = {};
        this.replies = [];
        this._reply = typeof options.reply === 'function' ? options.reply : null;
        this._wait_for_message = options.wait_for_message || null;
    }

    update_msg(msg) {
        this.msg = msg || {};
        this.player = this.msg.player || {};
        this.message = this.msg.message || '';
        this.position = this.msg.position || this.position;
        this.time = this.msg.time || Date.now();
    }

    /**
     * Send a reply through the configured channel.
     * @param {string} text - Text to send.
     * @param {object} [options] - Push options, including channel.
     * @returns {Promise<void>}
     */
    async send(text, options = {}) {
        if (text === undefined || text === null) return;
        const content = String(text);
        this.replies.push(content);

        if (this._reply && !options.channel) {
            await this._reply(content, this, options);
            return;
        }

        await push_message(this.bot, this, content, options);
    }

    /**
     * Send an optional final reply and stop command execution.
     * @param {string} text - Optional text to send.
     * @param {object} [options] - Push options, including channel.
     * @returns {Promise<void>}
     */
    async finish(text, options = {}) {
        if (text !== undefined && text !== null) {
            await this.send(text, options);
        }
        throw new CommandFinishSignal();
    }

    receive(options = {}) {
        if (!this._wait_for_message) {
            throw new Error('receive() is unavailable without a command listener');
        }
        return this._wait_for_message(this, options);
    }
}

module.exports = {
    CommandSession,
    CommandFinishSignal,
    CommandTimeoutError,
    CommandCancelledError,
};
