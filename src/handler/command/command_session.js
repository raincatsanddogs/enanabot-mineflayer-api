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

    async send(text) {
        if (text === undefined || text === null) return;
        const content = String(text);
        this.replies.push(content);

        if (this._reply) {
            await this._reply(content, this);
            return;
        }

        const username = this.player && this.player.username;
        if (this.bot && username && typeof this.bot.whisper === 'function') {
            this.bot.whisper(username, content);
            return;
        }

        if (this.bot && typeof this.bot.chat === 'function') {
            this.bot.chat(content);
        }
    }

    async finish(text) {
        if (text !== undefined && text !== null) {
            await this.send(text);
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
