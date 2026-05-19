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
    /*
    /**
     * Collect online players and send the list through IPC.
     *
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
    }仍有可以借鉴的部分，完成后删除
    */

    /*
     * 处理加入服务器时可能会遇到的资源包请求
     *
     */
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
        console.warn(`Bot disconnected: ${reason}`);
        process.exit(1);
    });
}

main().catch((err) => {
    console.error(`${err}`);
    process.exit(1);
});
