// process.env.DEBUG = "minecraft-protocol"

/**
 * @module index
 * @description Mineflayer bootstrap, IPC bridge, and plugin loading entrypoint.
 */

const mineflayer = require('mineflayer');
const readline = require('node:readline');
const config = require('./src/configs/config');
const { resolveSrv } = require('./src/login/srv');
const message_handler = require('./src/handler/message/message_handler');
const command_listener = require('./src/handler/command/command_listener');
const { trigger_command } = require('./src/handler/command');
const register_plugins = require('./src/plugins');
const ipc = require('./src/ipc/ipc_protocol');

const QQ_FORWARD_PREFIX = (typeof config.forward_prefix === 'string' && config.forward_prefix.trim())
    ? config.forward_prefix.trim()
    : '[群聊]>>';

const start_args = process.argv.slice(2);

try {
    if (start_args.length === 0) {
        console.log('未指定配置文件，默认使用第一个配置');
    } else if (start_args.length > 0) {
        if (start_args.length > 5
            || start_args[0] !== '-p'
            || isNaN(start_args[1])
            || start_args[1] <= 0
            || start_args[2] !== '-s'
            || isNaN(start_args[3])
            || start_args[3] <= 0) {
            console.error('无效的配置参数,参数应为: -p <档案编号> -s <服务器编号>，错误参数如下：');
            throw new Error(start_args);
        }
    }
} catch (err) {
    console.error(err.message);
    process.exit(1);
}

const profile = (start_args[1] - 1) || 0;

/**
 * Build a QQ-forwarded message for public Minecraft chat.
 * @param {string} message - Raw QQ message.
 * @returns {string} Message sent to Minecraft.
 */
function build_forward_message(message) {
    const normalized = String(message || '').trim();
    if (!normalized) {
        return '';
    }
    if (normalized.startsWith(QQ_FORWARD_PREFIX)) {
        return normalized;
    }
    return `${QQ_FORWARD_PREFIX} ${normalized}`;
}

/**
 * Check whether a value is in an allow/deny list.
 * @param {unknown[]} list - List of ids.
 * @param {unknown} value - Candidate id.
 * @returns {boolean} Whether the value is included.
 */
function list_includes_id(list, value) {
    if (!Array.isArray(list)) {
        return false;
    }
    return list.includes(value);
}

/**
 * Convert a msg_obj into the legacy MC message payload consumed by Python.
 * @param {object} msg - msg_obj from message_handler.
 * @returns {object} IPC payload.
 */
function build_mc_message_payload(msg) {
    const type_map = {
        public: 'chat',
        private: 'whisper',
        private_outgoing: 'whisper',
        system: 'server_cmd',
        tpa: 'tpa',
    };

    return {
        time_stamp: new Date(msg.time || Date.now()).toISOString(),
        type: type_map[msg.position] || msg.position || 'server_cmd',
        text: msg.message || '',
        translate: '',
        params: msg.player ? [msg.player] : [],
    };
}

/**
 * Forward non-command Minecraft messages to Python.
 * @param {object} bot - mineflayer bot instance.
 * @param {object} msg - msg_obj from message_handler.
 */
function forward_unhandled_msg_obj(bot, msg) {
    if (!msg || msg.suppress_forward || msg.position === 'private' || msg.position === 'private_outgoing') {
        return;
    }

    if (bot
        && msg.player
        && typeof msg.player.username === 'string'
        && msg.player.username.toLowerCase() === String(bot.username || '').toLowerCase()) {
        return;
    }

    const encoded = ipc.encode(ipc.ACTION_MC_MESSAGE, build_mc_message_payload(msg));
    process.stdout.write(encoded);
}

/**
 * Execute a delegated command through the unified command system.
 * @param {object} bot - mineflayer bot instance.
 * @param {object} data - Delegate payload.
 * @returns {Promise<void>}
 */
async function handle_delegated_command(bot, data = {}) {
    const command = String(data.command || '').trim();
    const args = Array.isArray(data.args) ? data.args.map((item) => String(item)) : [];
    const reply_to = data.reply_to || '';

    if (!command) {
        process.stdout.write(ipc.encode(ipc.ACTION_DELEGATE_RESULT, {
            reply_to,
            command,
            args,
            result: '未知委托指令',
        }));
        return;
    }

    const prefix = config.whisper_command_prefix || '#';
    const text = `${prefix}${command}${args.length > 0 ? ` ${args.join(' ')}` : ''}`;
    const replies = [];

    try {
        const result = await trigger_command(bot, text, {
            username: reply_to || 'ipc',
            permission: data.permission || 'user',
            reply: async (reply_text) => {
                replies.push(String(reply_text));
            },
        });

        process.stdout.write(ipc.encode(ipc.ACTION_DELEGATE_RESULT, {
            reply_to,
            command,
            args,
            result: result.handled
                ? replies.join('\n')
                : `未知委托指令: ${command}`,
        }));
    } catch (err) {
        process.stdout.write(ipc.encode(ipc.ACTION_DELEGATE_RESULT, {
            reply_to,
            command,
            args,
            result: `指令执行失败: ${err.message || err}`,
        }));
    }
}

/**
 * Handle one decoded IPC envelope from Python.
 * @param {object} bot - mineflayer bot instance.
 * @param {object} envelope - Decoded IPC envelope.
 */
function handle_incoming_ipc(bot, envelope) {
    const { action, data } = envelope;

    switch (action) {
        case ipc.ACTION_QQ_MESSAGE: {
            const incoming = {
                msg: String((data && data.msg) || '').trim(),
                group_id: data && data.group_id,
                sender_id: data && data.sender_id,
            };

            if (!incoming.msg) {
                return;
            }
            if (!list_includes_id(config.send_group, incoming.group_id)) {
                return;
            }
            if (list_includes_id(config.ignore_user, incoming.sender_id)) {
                return;
            }

            const outgoing_text = build_forward_message(incoming.msg);
            if (outgoing_text) {
                bot.chat(outgoing_text);
            }
            break;
        }

        case ipc.ACTION_WHISPER_REPLY: {
            const target_player = data && data.target_player;
            const reply_msg = data && data.msg;
            if (typeof target_player === 'string'
                && target_player
                && typeof reply_msg === 'string'
                && reply_msg) {
                bot.whisper(target_player, reply_msg);
            }
            break;
        }

        case ipc.ACTION_DELEGATE_COMMAND:
            handle_delegated_command(bot, data);
            break;

        default:
            console.warn(`未知的 IPC action: ${action}`);
    }
}

/**
 * Setup stdin IPC bridge from Python to JS.
 * @param {object} bot - mineflayer bot instance.
 */
function setup_readline_bridge(bot) {
    const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
        try {
            const envelope = ipc.decode(line);
            if (!envelope) {
                return;
            }
            handle_incoming_ipc(bot, envelope);
        } catch (err) {
            console.error(`处理 stdin 消息失败: ${err.message || err}`);
        }
    });

    rl.on('close', () => {
        console.warn('stdin 已关闭，readline 停止监听');
    });
}

/**
 * Main bootstrap routine.
 * @returns {Promise<void>}
 */
async function main() {
    const srv_host = await resolveSrv(config.server[profile].url);
    if (srv_host) {
        console.log(`SRV record found: ${srv_host.host}:${srv_host.port}`);
        config.server[profile].url = srv_host.host;
        config.server[profile].port = srv_host.port;
    } else {
        console.log(`No SRV record found for ${config.server[profile].url}, using original host and port.`);
    }

    const bot = mineflayer.createBot({
        host: config.server[profile].url,
        port: config.server[profile].port,
        username: config.account[profile].name,
        password: config.account[profile].password,
        auth: config.account[profile].authType,
        version: config.server[profile].version,
        authServer: config.skin[profile].authServer,
        sessionServer: config.skin[profile].sessionServer,
    });

    bot.loadPlugin(message_handler);
    bot.loadPlugin(register_plugins);
    bot.loadPlugin(command_listener);

    setup_readline_bridge(bot);

    bot.on('command_unhandled', (msg) => {
        forward_unhandled_msg_obj(bot, msg);
    });

    let player_list_interval = null;

    /**
     * Collect online players and send the list through IPC.
     */
    function collect_player_list() {
        const player_list = [];

        for (const name in bot.players) {
            const player = bot.players[name];
            if (!player || player.username === bot.username) {
                continue;
            }

            const skin_url = player.skinData && player.skinData.url
                ? player.skinData.url
                : `https://crafatar.com/avatars/${player.uuid}?size=32&overlay`;

            player_list.push({
                name: player.username,
                uuid: player.uuid || '',
                skin_url,
            });
        }

        process.stdout.write(ipc.encode(ipc.ACTION_PLAYER_LIST, {
            players: player_list,
            count: player_list.length,
            timestamp: new Date().toISOString(),
            bot_username: bot.username,
        }));
    }

    bot.once('spawn', () => {
        collect_player_list();
        player_list_interval = setInterval(collect_player_list, 5 * 60 * 1000);
    });

    bot._client.on('add_resource_pack', (packet) => {
        const uuid = packet.uuid || packet.packId || '00000000-0000-0000-0000-000000000000';
        bot._client.write('resource_pack_receive', { uuid, result: 0 });
        setTimeout(() => {
            bot._client.write('resource_pack_receive', { uuid, result: 3 });
        }, 30);
    });

    bot._client.on('resource_pack_send', () => {
        bot._client.write('resource_pack_receive', { result: 0 });
        setTimeout(() => {
            bot._client.write('resource_pack_receive', { result: 3 });
        }, 300);
    });

    bot.on('death', () => {
        bot.chat('/dback');
        console.warn('bot died, sent /dback command');
    });

    bot.on('error', (error) => {
        console.error('Bot error:', error);
    });

    bot.on('end', (reason) => {
        if (player_list_interval) {
            clearInterval(player_list_interval);
            player_list_interval = null;
        }
        console.warn(`Bot disconnected: ${reason}`);
        process.exit(1);
    });
}

main().catch((err) => {
    console.error(`${err}`);
    process.exit(1);
});
