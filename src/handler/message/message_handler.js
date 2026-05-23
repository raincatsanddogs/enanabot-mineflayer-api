const mineflayer = require('mineflayer') // eslint-disable-line
const {
    extract_plain_text,
    find_click_commands,
    get_display_name_text,
    get_display_name_nodes,
    extract_nickname_nodes,
    match_formatted_nodes,
    _collect_hover_events,
    _extract_visible_text,
    _collect_player_names_from_node,
    _merge_player_result,
    _finalize_player_result,
    _normalize_translate_message,
    _build_translate_data,
    _get_primary_player,
    chat_msg,
    player_info
} = require('./utils');
const player_cache = require('../../utils/player_cache');
const { get_bot_scope } = require('../../utils/bot_context');

/**
 * Create isolated parser state for one bot instance.
 * @param {mineflayer.Bot} bot - Mineflayer bot instance.
 * @returns {{ bot: mineflayer.Bot, player_info_list: player_info[] }} Per-bot parser state.
 */
function create_message_context(bot) {
    const scope = get_bot_scope(bot);
    const cached = player_cache.get_all_cached_players(scope);
    const player_info_list = cached.map(p => new player_info(p.username, p.uuid, p.nickname));
    return {
        bot,
        player_info_list,
    };
}

/**
 * 根据 username 或昵称从 player_info_list / bot.players 中解析 player_info
 * @param {{ bot: mineflayer.Bot, player_info_list: player_info[] }} context - Per-bot parser state.
 * @param {string} name - username 或昵称纯文本
 * @param {Array|null} nickname_nodes - 可选，消息中提取的格式化昵称节点
 * @returns {player_info}
 */
function _resolve_player_info(context, name, nickname_nodes) {
    const bot = context.bot;
    const player_info_list = context.player_info_list;
    if (!name && (!nickname_nodes || nickname_nodes.length === 0)) {
        return new player_info('', '', {});
    }

    // 1. 缓存按 username 查找
    if (name) {
        for (const cached of player_info_list) {
            if (cached.username === name) return cached;
        }
    }

    // 2. bot.players 按 username key 直接查找
    if (name && bot && bot.players && bot.players[name]) {
        const p = bot.players[name];
        return new player_info(p.username, p.uuid || '', get_display_name_nodes(p));
    }

    // 3. 格式化节点比对（最精准，解决同名不同色问题）
    if (nickname_nodes && nickname_nodes.length > 0 && bot && bot.players) {
        for (const p_key in bot.players) {
            const p = bot.players[p_key];
            const dn_nodes = get_display_name_nodes(p);
            if (dn_nodes.length > 0 && match_formatted_nodes(nickname_nodes, dn_nodes)) {
                return new player_info(p.username, p.uuid || '', dn_nodes);
            }
        }
    }

    // 4. 纯文本 displayName 比对（兜底）
    if (name && bot && bot.players) {
        for (const p_key in bot.players) {
            const p = bot.players[p_key];
            const display_text = get_display_name_text(p);
            if (display_text && display_text === name) {
                return new player_info(p.username, p.uuid || '', get_display_name_nodes(p));
            }
        }
        for (const p_key in bot.players) {
            const p = bot.players[p_key];
            const display_text = get_display_name_text(p);
            if (display_text && (display_text.startsWith(name) || name.startsWith(display_text))) {
                return new player_info(p.username, p.uuid || '', get_display_name_nodes(p));
            }
        }
    }

    // 5. 兜底
    return new player_info(name || '', '', {});
}

/**传入message事件的jsonMsg，返回一个player_info对象
 * 具体处理方式为：1.若有原版翻译键则为原版消息，直接从hoverEvent中提取玩家信息；
 * 2.若无原版翻译键则为插件消息，尝试从extra中提取玩家信息，使用bot.player获取player信息并进行比对，若失败则返回空字符串
 * @param {{ bot: mineflayer.Bot, player_info_list: player_info[] }} context - Per-bot parser state.
 * @param {object} jsonMsg - 原版json格式聊天消息
 * @returns {player_info|player_info[]}
 */
function player_info_handler(context, jsonMsg) {
    const players = [];

    // === 1. 原版消息解析：有 translate + with 数组 ===
    const translate = jsonMsg.translate || (jsonMsg.json && jsonMsg.json.translate) || null;
    const with_arr = (jsonMsg.json && jsonMsg.json.with) || jsonMsg.with || null;
    const nickname_nodes = extract_nickname_nodes(jsonMsg);

    if (translate && Array.isArray(with_arr) && with_arr.length > 0) {
        const names_set = new Set();
        _collect_player_names_from_node(with_arr, names_set);
        for (const name of names_set) {
            const resolved = _resolve_player_info(context, name, null);
            _merge_player_result(players, resolved, name);
        }
        if (players.length > 0) return _finalize_player_result(players);
    }

    // === 2. CMI 插件消息：格式化节点比对优先 ===
    if (nickname_nodes.length > 0) {
        const resolved = _resolve_player_info(context, null, nickname_nodes);
        _merge_player_result(players, resolved);
        if (players.length > 0) return _finalize_player_result(players);
    }

    // === 3. click_event 提取 + 格式化节点辅助比对 ===
    const commands = find_click_commands(jsonMsg);
    const cmd_patterns = [
        /^\/msg\s+(\S+)\s*$/,
        /^\/tell\s+(\S+)\s*$/,
        /^\/cmi\s+tpaccept\s+(\S+)/,
        /^\/cmi\s+tpdeny\s+(\S+)/,
        /^\/cmi\s+tpa(?:here)?\s+(\S+)/,
    ];
    for (const cmd of commands) {
        for (const pattern of cmd_patterns) {
            const match = cmd.match(pattern);
            if (match) {
                const resolved = _resolve_player_info(context, match[1], nickname_nodes);
                _merge_player_result(players, resolved, match[1]);
            }
        }
    }
    if (players.length > 0) return _finalize_player_result(players);

    // === 4. 纯文本中查找已知玩家名 ===
    const plain_text = extract_plain_text(jsonMsg);
    const bot = context.bot;
    if (bot && bot.players && plain_text) {
        for (const p_name in bot.players) {
            if (plain_text.includes(p_name)) {
                const resolved = _resolve_player_info(context, p_name, nickname_nodes);
                _merge_player_result(players, resolved, p_name);
            }
        }
    }

    return _finalize_player_result(players);
}

/**
 * @param {{ bot: mineflayer.Bot, player_info_list: player_info[] }} context - Per-bot parser state.
 * @param {object} jsonMsg - 原版json格式聊天消息
 * @returns {chat_msg} - 封装后的chat_msg对象
 * 处理方式：提取消息内容（为聊天、击杀、玩家加入退出、私聊类型）（若有翻译键直接使用翻译键，获得成就需特殊处理，消息需传翻译键的数组）为纯文本，提取消息位置（公屏/私聊），提取玩家信息（调用player_info_handler函数），将玩家信息、消息内容和消息位置封装成一个chat_msg对象并返回
 */
function chat_msg_handler(context, jsonMsg) {
    const player = player_info_handler(context, jsonMsg);
    const plain_text = extract_plain_text(jsonMsg);
    const visible_text = _extract_visible_text(jsonMsg).trim();
    let message = '';
    let position = 'public';

    const translate = jsonMsg.translate || (jsonMsg.json && jsonMsg.json.translate) || null;

    // === 原版消息 ===
    if (translate) {
        const with_arr = (jsonMsg.json && jsonMsg.json.with) || jsonMsg.with || [];

        if (translate === 'chat.type.text') {
            position = 'public';
            if (with_arr.length >= 2) message = _extract_visible_text(with_arr[1]).trim();
        } else if (translate === 'commands.message.display.incoming') {
            position = 'private';
            if (with_arr.length >= 2) message = _extract_visible_text(with_arr[1]).trim();
        } else if (translate === 'commands.message.display.outgoing') {
            position = 'private_outgoing';
            if (with_arr.length >= 2) message = _extract_visible_text(with_arr[1]).trim();
        } else if (translate === 'multiplayer.player.joined' || translate === 'multiplayer.player.left') {
            position = 'system_info';
            message = _extract_visible_text(with_arr).trim();
        } else if (translate.startsWith('death.')) {
            position = 'system_info';
            message = _extract_visible_text(with_arr).trim();
        } else if (translate.startsWith('chat.type.advancement.')) {
            position = 'system_info';
            message = _extract_visible_text(with_arr).trim();
        } else {
            position = 'system_info';
            message = visible_text;
        }
        const hover_data_v = _collect_hover_events(jsonMsg);
        const has_root_translate = typeof jsonMsg.translate === 'string';
        if (has_root_translate){
            message = ""
        }
        //message = _normalize_translate_message(message, plain_text, visible_text, translate);
        const data_v = { translate: _build_translate_data(jsonMsg, translate) };
        if (hover_data_v.items.length > 0) data_v.items = hover_data_v.items;
        if (hover_data_v.entities.length > 0) data_v.entities = hover_data_v.entities;
        return new chat_msg(player, message, position, Date.now(), data_v);
    }

    // === CMI 插件消息 ===
    if (plain_text.match(/\[.*->\s*(我|me)\s*\]/i)) {
        position = 'private';
        const close_bracket = plain_text.indexOf(']');
        message = close_bracket >= 0 ? plain_text.slice(close_bracket + 1).trim() : plain_text;
    } else if (plain_text.match(/\[(我|me)\s*->/i)) {
        position = 'private_outgoing';
        const close_bracket = plain_text.indexOf(']');
        message = close_bracket >= 0 ? plain_text.slice(close_bracket + 1).trim() : plain_text;
    } else if (plain_text.match(/^<.*>\s/)) {
        position = 'public';
        const gt_idx = plain_text.indexOf('> ');
        if (gt_idx >= 0) {
            message = plain_text.slice(gt_idx + 2).trim();
        } else {
            const gt_idx2 = plain_text.indexOf('>');
            message = gt_idx2 >= 0 ? plain_text.slice(gt_idx2 + 1).trim() : plain_text;
        }
    } else {
        position = 'public';
        message = plain_text;
    }
    const hover_data_c = _collect_hover_events(jsonMsg);
    const data_c = {};
    if (hover_data_c.items.length > 0) data_c.items = hover_data_c.items;
    if (hover_data_c.entities.length > 0) data_c.entities = hover_data_c.entities;
    return new chat_msg(player, message, position, Date.now(), Object.keys(data_c).length > 0 ? data_c : undefined);
}

/**
 * Parse TPA metadata from click commands and visible text.
 * @param {string[]} commands - Click commands in the message.
 * @param {string} plain_text - Visible message text.
 * @param {player_info} player - Resolved player info.
 * @returns {{ requester: string, tpa_type: string, accept_command: string } | null}
 */
function parse_tpa_info(commands, plain_text, player) {
    const primary_player = _get_primary_player(player);
    for (const command of commands) {
        const accept_match = command.match(/^\/((?:cmi\s+)?tp(?:accept|yes)|tpayes|tpyes)\b/i);
        if (!accept_match) {
            continue;
        }

        const requester_match = plain_text.match(/^(\S+)\s+请求/);
        const requester = (primary_player && primary_player.username)
            || (requester_match && requester_match[1])
            || '';
        const tpa_type = plain_text.includes('请求你传送')
            || plain_text.toLowerCase().includes('tpahere')
            ? 'tpahere'
            : 'tpa';

        return {
            requester,
            tpa_type,
            accept_command: command,
        };
    }

    return null;
}

/**
 * @param {{ bot: mineflayer.Bot, player_info_list: player_info[] }} context - Per-bot parser state.
 * @param {object} jsonMsg - 原版json格式聊天消息
 * @returns {chat_msg} - 封装后的chat_msg对象
 * 处理方式：处理与玩家无关的消息（tp消息除外，算作系统信息）提取消息内容为纯文本，（tp消息应有player信息）若有将消息内容和消息位置封装成一个chat_msg对象并返回
 */
function system_msg_handler(context, jsonMsg) {
    const plain_text = extract_plain_text(jsonMsg);
    const visible_text = _extract_visible_text(jsonMsg).trim();
    let player = new player_info('', '', {});
    let position = 'system';
    let message = plain_text;
    let data = {};

    // TPA 消息
    const commands = find_click_commands(jsonMsg);
    player = player_info_handler(context, jsonMsg);
    const tpa_info = parse_tpa_info(commands, plain_text, player);

    for (const cmd of commands) {
        const tpa_accept = cmd.match(/^\/((?:cmi\s+)?tp(?:accept|yes)|tpayes|tpyes)\b/i);
        if (tpa_accept) {
            position = 'tpa';
            data = { tpa_info };
            break;
        }
        const tpa_deny = cmd.match(/^\/(?:cmi\s+)?tpdeny\b/i);
        if (tpa_deny) {
            position = 'tpa';
            data = { tpa_info };
            break;
        }
        const tpa_cancel = cmd.match(/^\/(?:cmi\s+)?tpa(?:here)?\s+\S+\s+-cancel-/i);
        if (tpa_cancel) {
            position = 'tpa';
            data = { tpa_info };
            break;
        }
    }

    // 未知 translate 消息 → system_info
    const translate = jsonMsg.translate || (jsonMsg.json && jsonMsg.json.translate) || null;
    if (position === 'system' && translate) {
        position = 'system_info';
        const has_root_translate = typeof jsonMsg.translate === 'string';
        if (has_root_translate){
            message = ""
        }else{
            message = _normalize_translate_message(visible_text, plain_text, visible_text, translate);
        }
        data.translate = _build_translate_data(jsonMsg, translate);
    }

    // 收集物品/实体 hover 信息
    const hover_data_s = _collect_hover_events(jsonMsg);
    if (hover_data_s.items.length > 0) data.items = hover_data_s.items;
    if (hover_data_s.entities.length > 0) data.entities = hover_data_s.entities;

    return new chat_msg(player, message, position, Date.now(), data);
}

/**
 * @param {{ bot: mineflayer.Bot, player_info_list: player_info[] }} context - Per-bot parser state.
 * @param {object} jsonMsg - 原版json格式聊天消息
 * @returns {chat_msg} - 封装后的chat_msg对象
 * 处理方式：判断消息类型（聊天、击杀、玩家加入退出、私聊、系统信息），调用相应的处理函数进行处理并返回处理结果
 */
function msg_handler(context, jsonMsg) {
    const translate = jsonMsg.translate || (jsonMsg.json && jsonMsg.json.translate) || null;
    const plain_text = extract_plain_text(jsonMsg);

    // === 1. 有 translate 的消息 ===
    if (translate) {
        if (translate === 'chat.type.text' ||
            translate === 'commands.message.display.incoming' ||
            translate === 'commands.message.display.outgoing' ||
            translate === 'multiplayer.player.joined' ||
            translate === 'multiplayer.player.left' ||
            translate.startsWith('death.') ||
            translate.startsWith('chat.type.advancement.')) {
            return chat_msg_handler(context, jsonMsg);
        }
        return system_msg_handler(context, jsonMsg);
    }

    // === 2. 无 translate（CMI 插件） ===
    const commands = find_click_commands(jsonMsg);
    for (const cmd of commands) {
        if (/^\/(?:(?:cmi\s+)?tp(?:accept|deny|a|ahere|yes)|tpayes|tpyes)\b/i.test(cmd)) {
            return system_msg_handler(context, jsonMsg);
        }
    }

    if (plain_text.match(/\[.*->\s*(我|me|\S+)\s*\]/i)) return chat_msg_handler(context, jsonMsg);
    if (plain_text.match(/^<.*>\s/)) return chat_msg_handler(context, jsonMsg);

    for (const cmd of commands) {
        if (cmd.match(/^\/msg\s+\S+\s*$/)) return chat_msg_handler(context, jsonMsg);
    }

    return system_msg_handler(context, jsonMsg);
}

/**
 * Update the per-bot player cache from Mineflayer player events.
 * @param {{ bot: mineflayer.Bot, player_info_list: player_info[] }} context - Per-bot parser state.
 * @param {object} player - Mineflayer player object.
 * @returns {player_info} Normalized player info.
 */
function player_info_update_handler(context, player) {
    const username = player.username || '';
    const uuid = player.uuid || '';
    const nickname = get_display_name_nodes(player);
    const info = new player_info(username, uuid, nickname);
    const player_info_list = context.player_info_list;

    let found = false;
    for (let i = 0; i < player_info_list.length; i++) {
        if (player_info_list[i].username === username) {
            player_info_list[i] = info;
            found = true;
            break;
        }
    }
    if (!found) player_info_list.push(info);

    // 持久化缓存
    const scope = get_bot_scope(context.bot);
    player_cache.save_player(scope, info);

    return info;
}

/**
 * Mineflayer plugin entry that installs an isolated parser for one bot.
 * @param {mineflayer.Bot} bot - Mineflayer bot instance.
 */
module.exports = bot => {
    const context = create_message_context(bot);

    bot.on('message', (jsonMsg) => {
        const parsed = msg_handler(context, jsonMsg);
        parsed.bot_id = bot.__enanabot_context && bot.__enanabot_context.bot_id;
        bot.emit('msg_obj', parsed);
    });
    bot.on('playerUpdated', (player) => {
        player_info_update_handler(context, player);
    });
    bot.on('playerJoined', (player) => {
        player_info_update_handler(context, player);
    });
    bot.on('playerLeft', (player) => {
        const username = player.username || '';
        context.player_info_list = context.player_info_list.filter(p => p.username !== username);
    });
}
// 导出处理函数以供测试
module.exports.create_message_context = create_message_context;
module.exports.msg_handler = msg_handler;
