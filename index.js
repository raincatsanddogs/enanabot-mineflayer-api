// process.env.DEBUG = "minecraft-protocol"

/**
 * @module index
 * @description Mineflayer bootstrap entrypoint prepared for WebSocket-managed bots.
 */

const mineflayer = require('mineflayer');
const minecraftData = require('minecraft-data');
const config = require('./src/configs/config');
const { resolveSrv } = require('./src/login/srv');
const message_handler = require('./src/handler/message/message_handler');
const command_listener = require('./src/handler/command/command_listener');
const register_plugins = require('./src/plugins');
const { build_bot_scope } = require('./src/utils/bot_context');
const { start_websocket_server } = require('./src/websocket/server');

/**
 * Validate legacy CLI arguments without creating a bot.
 * @param {string[]} start_args - Process arguments after node/script name.
 * @returns {{ account: number, server: number }} One-based preset identifiers.
 */
function parse_start_args(start_args = []) {
    if (start_args.length === 0) {
        return { account: 1, server: 1 };
    }

    if (start_args.length > 5
        || start_args[0] !== '-p'
        || isNaN(start_args[1])
        || Number(start_args[1]) <= 0
        || start_args[2] !== '-s'
        || isNaN(start_args[3])
        || Number(start_args[3]) <= 0) {
        throw new Error('无效的配置参数,参数应为: -p <档案编号> -s <服务器编号>');
    }

    return {
        account: Number(start_args[1]),
        server: Number(start_args[3]),
    };
}

/**
 * Resolve a one-based preset id to a config array entry.
 * @param {Array} list - Preset list from YAML config.
 * @param {number} id - One-based preset identifier.
 * @param {string} label - Human readable preset label.
 * @returns {object} Preset config object.
 */
function get_preset_entry(list, id, label) {
    const index = Number(id) - 1;
    if (!Array.isArray(list) || !Number.isInteger(index) || index < 0 || index >= list.length) {
        throw new Error(`找不到${label}预设: ${id}`);
    }
    return list[index];
}

/**
 * Build login options from YAML presets. This mirrors the future login_preset
 * handler while keeping index.js independent from the WebSocket layer.
 * @param {number} account_id - One-based account preset id.
 * @param {number} server_id - One-based server preset id.
 * @returns {object} Login options accepted by {@link create_bot}.
 */
function build_login_options_from_preset(account_id = 1, server_id = 1) {
    const account = get_preset_entry(config.account, account_id, '账号');
    const server = get_preset_entry(config.server, server_id, '服务器');
    const skin = Array.isArray(config.skin)
        ? (config.skin[Number(account_id) - 1] || config.skin[0] || {})
        : {};
    const reconnect_config = config.reconnect && typeof config.reconnect === 'object'
        ? config.reconnect
        : {};

    return {
        username: account.name,
        account: account.email || account.account || account.name,
        password: account.password,
        login_type: account.authType,
        server: {
            host: server.url || server.host,
            port: server.port || 25565,
            version: server.version,
        },
        skin_server: skin.url || '',
        skin_auth_server: skin.authServer || '',
        skin_session_server: skin.sessionServer || '',
        reconnect: {
            enabled: reconnect_config.reconnect !== false && reconnect_config.enabled !== false,
            interval: reconnect_config.interval || 5,
            max_attempts: reconnect_config.max_attempts || reconnect_config.maxAttempts || 5,
        },
    };
}

/**
 * Normalize a configured Minecraft version before passing it to Mineflayer.
 * Empty values and "auto" intentionally leave version undefined so
 * minecraft-protocol can ping the server and choose the matching protocol.
 * @param {string|number|null|undefined} version - Configured version value.
 * @returns {string|undefined} Mineflayer version option.
 */
function normalize_minecraft_version(version) {
    if (version === undefined || version === null) {
        return undefined;
    }

    const normalized = String(version).trim();
    if (!normalized || normalized.toLowerCase() === 'auto') {
        return undefined;
    }

    const version_info = minecraftData.versionsByMinecraftVersion.pc[normalized];
    const data = minecraftData(normalized);
    if (!data || (version_info && version_info.version !== data.version.version)) {
        throw new Error(`不支持的 Minecraft 版本: ${normalized}，请更新依赖或将 version 设为 "auto"`);
    }

    return normalized;
}

/**
 * Add actionable context to common low-level minecraft-protocol parse errors.
 * @param {Error} error - Original bot error.
 * @param {object} context - Runtime bot context.
 * @returns {Error} Original or enriched error.
 */
function enrich_bot_error(error, context) {
    if (!error || typeof error !== 'object') {
        return error;
    }

    const message = String(error.message || '');
    const field = String(error.field || '');
    const is_metadata_parse_error = field.includes('packet_entity_metadata')
        || field.includes('entity_metadata')
        || message.includes('packet_entity_metadata')
        || message.includes('entityMetadata');

    if (!is_metadata_parse_error || !message.includes('Unexpected buffer end while reading VarInt')) {
        return error;
    }

    const configured_version = context && context.server ? context.server.version : undefined;
    const forced_version = configured_version
        && String(configured_version).trim()
        && String(configured_version).trim().toLowerCase() !== 'auto'
        ? String(configured_version).trim()
        : '';
    const hint = forced_version
        ? `当前强制版本为 ${forced_version}，请确认它和服务器实际协议一致；多版本/代理服务器建议把 version 设为 "auto"。`
        : '当前使用自动版本检测；如果服务器状态页返回了错误协议，请在配置中显式指定正确版本。';

    const enriched = new Error(`${message}。这通常是 Minecraft 协议版本不匹配导致的实体元数据解析失败。${hint}`);
    Object.assign(enriched, error);
    enriched.stack = error.stack;
    return enriched;
}

/**
 * Normalize WebSocket login options to Mineflayer createBot options.
 * @param {object} login_options - External login options.
 * @returns {Promise<{ mineflayer_options: object, server: object }>} Mineflayer options and resolved server info.
 */
async function build_mineflayer_options(login_options) {
    const server = login_options.server || {};
    const original_host = server.host || server.url;
    if (!original_host) {
        throw new Error('缺少服务器地址');
    }

    const resolved_srv = await resolveSrv(original_host);
    const resolved_server = resolved_srv
        ? { ...server, host: resolved_srv.host, port: resolved_srv.port }
        : { ...server, host: original_host, port: server.port || 25565 };

    if (resolved_srv) {
        console.log(`SRV record found: ${resolved_srv.host}:${resolved_srv.port}`);
    } else {
        console.log(`No SRV record found for ${original_host}, using original host and port.`);
    }

    return {
        server: resolved_server,
        mineflayer_options: {
            host: resolved_server.host,
            port: resolved_server.port,
            username: login_options.username || login_options.account,
            password: login_options.password,
            auth: login_options.login_type === 'third' ? 'mojang' : login_options.login_type,
            version: normalize_minecraft_version(resolved_server.version),
            authServer: login_options.skin_auth_server,
            sessionServer: login_options.skin_session_server,
        },
    };
}

/**
 * Install resource-pack auto-accept handlers for one Mineflayer bot.
 * @param {object} bot - Mineflayer bot instance.
 */
function setup_resource_pack_handlers(bot) {
    if (!bot || !bot._client) {
        return;
    }

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
}

/**
 * Attach lifecycle handlers that update bot context instead of killing the process.
 * @param {object} bot - Mineflayer bot instance.
 * @param {object} context - Runtime bot context stored on the bot.
 */
function setup_lifecycle_handlers(bot, context) {
    bot.once('spawn', () => {
        context.state = 'online';
        context.spawned_at = Date.now();
        if (typeof context.on_status === 'function') {
            context.on_status(context, { state: 'online' });
        }
    });

    bot.on('death', () => {
        bot.chat('/dback');
        console.warn(`[${context.bot_id}] bot died, sent /dback command`);
    });

    bot.on('error', (error) => {
        error = enrich_bot_error(error, context);
        context.state = 'failed';
        context.last_error = error;
        console.error(`[${context.bot_id}] Bot error:`, error);
        if (typeof context.on_error === 'function') {
            context.on_error(context, error);
        }
    });

    bot.on('end', (reason) => {
        context.state = context.state === 'stopping' ? 'stopped' : 'offline';
        context.last_end_reason = reason;
        console.warn(`[${context.bot_id}] Bot disconnected: ${reason}`);
        if (typeof context.on_status === 'function') {
            context.on_status(context, { state: context.state, reason });
        }
    });
}

/**
 * Create a Mineflayer bot without binding it to process startup.
 * @param {object} login_options - Account, server, skin, and reconnect options.
 * @param {object} [runtime_context] - Runtime metadata and push callbacks.
 * @returns {Promise<object>} Created Mineflayer bot instance.
 */
async function create_bot(login_options, runtime_context = {}) {
    const { mineflayer_options, server } = await build_mineflayer_options(login_options || {});
    const username = mineflayer_options.username || login_options.username || login_options.account;
    const bot_id = runtime_context.bot_id || `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const context = {
        ...runtime_context,
        bot_id,
        username,
        state: 'logging_in',
        server,
        reconnect: login_options.reconnect || {},
        created_at: Date.now(),
    };

    context.scope = runtime_context.scope || build_bot_scope({
        username,
        server,
        bot_id,
    });

    const bot = mineflayer.createBot(mineflayer_options);

    // The context is intentionally stored on the bot so existing plugin APIs can
    // remain lightweight while still distinguishing concurrent bot instances.
    bot.__enanabot_context = context;

    // Register error and status handlers immediately to catch synchronous/early connection errors
    setup_lifecycle_handlers(bot, context);

    bot.loadPlugin(message_handler);
    bot.loadPlugin(register_plugins);
    bot.loadPlugin(command_listener);

    setup_resource_pack_handlers(bot);

    return bot;
}

/**
 * Entrypoint used when this file is executed directly.
 * @returns {Promise<void>}
 */
async function main() {
    start_websocket_server({
        config,
        create_bot,
        build_login_options_from_preset,
    });
}

if (require.main === module) {
    // 注册全局未捕获异常和未处理 Promise 拒绝处理器，防止进程因连接超时等错误退出
    process.on('uncaughtException', (err) => {
        console.error('【系统全局未捕获异常】:', err);
    });
    process.on('unhandledRejection', (reason) => {
        console.error('【系统全局未处理 Promise 拒绝】:', reason);
    });

    main().catch((err) => {
        console.error(`${err.message || err}`);
        process.exit(1);
    });
}

module.exports = {
    parse_start_args,
    build_login_options_from_preset,
    build_mineflayer_options,
    normalize_minecraft_version,
    enrich_bot_error,
    create_bot,
    start_websocket_server,
    main,
};
