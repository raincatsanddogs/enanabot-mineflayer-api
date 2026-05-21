/**
 * @module websocket/server
 * @description WebSocket server bootstrap for external bot control.
 */

const WebSocket = require('ws');
const BotManager = require('./bot_manager');
const { create_handlers } = require('./handlers');
const { safe_send, build_error } = require('./utils');

/**
 * Normalize and validate WebSocket server config.
 * @param {object} config - Runtime config object.
 * @returns {{ host: string, port: number, token: string }}
 */
function normalize_server_config(config) {
    const connect = config && config.connect && typeof config.connect === 'object'
        ? config.connect
        : {};
    const host = String(connect.host || 'localhost');
    const port = Number(connect.port);
    const token = String(connect.token || '').trim();

    if (!token) {
        throw new Error('WebSocket connect.token 必须配置');
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error('WebSocket connect.port 必须是有效端口号');
    }

    return { host, port, token };
}

/**
 * Start the WebSocket server and bind request handlers.
 * @param {object} options - Server dependencies and config.
 * @param {object} options.config - Runtime config object.
 * @param {Function} options.create_bot - Bot factory exported by index.js.
 * @param {Function} options.build_login_options_from_preset - Preset login builder.
 * @returns {object} Running server handle.
 */
function start_websocket_server(options = {}) {
    const config = options.config || {};
    const server_config = normalize_server_config(config);
    const connections = new Set();
    const bot_manager = new BotManager({
        create_bot: options.create_bot,
        build_login_options_from_preset: options.build_login_options_from_preset,
        config,
        broadcast: (payload) => {
            for (const connection of connections) {
                if (connection.authenticated) {
                    safe_send(connection, payload);
                }
            }
        },
    });

    // 自动恢复之前已登录/持久化的机器人
    bot_manager.auto_restore();

    const handlers = create_handlers({
        bot_manager,
        token: server_config.token,
        config,
    });
    const server = new WebSocket.Server({
        host: server_config.host,
        port: server_config.port,
    });

    server.on('connection', (ws) => {
        const connection = {
            ws,
            authenticated: false,
            created_at: Date.now(),
        };
        connections.add(connection);

        ws.on('message', (raw) => {
            handlers.handle_message(connection, raw).catch((err) => {
                safe_send(connection, build_error(
                    err && err.error_type ? err.error_type : 'internal_error',
                    err && err.message ? err.message : String(err)
                ));
            });
        });
        ws.on('close', () => {
            connections.delete(connection);
        });
        ws.on('error', (err) => {
            console.warn('[websocket] client connection error:', err.message || err);
        });
    });

    server.on('listening', () => {
        console.log(`WebSocket 服务正在监听 ws://${server_config.host}:${server_config.port}`);
    });

    return {
        server,
        bot_manager,
        connections,
        config: server_config,
        close: () => close_websocket_server(server, bot_manager),
    };
}

/**
 * Close the WebSocket server and managed bots.
 * @param {object} server - ws Server instance.
 * @param {BotManager} bot_manager - Bot manager instance.
 * @returns {Promise<void>}
 */
async function close_websocket_server(server, bot_manager) {
    if (bot_manager) {
        await bot_manager.shutdown();
    }

    await new Promise((resolve, reject) => {
        if (!server || typeof server.close !== 'function') {
            resolve();
            return;
        }
        server.close((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

module.exports = {
    start_websocket_server,
    close_websocket_server,
    normalize_server_config,
};
