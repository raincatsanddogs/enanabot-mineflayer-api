const mineflayer = require('mineflayer') // eslint-disable-line
const {
    extract_plain_text,
    find_click_commands,
    get_display_name_text,
    get_display_name_nodes,
    extract_nickname_nodes,
    match_formatted_nodes,
} = require('./utils');

/**
 * @param {mineflayer.Bot} bot // to enable intellisense
 */

let raw_msg = null;
let _bot = null; // 模块级 bot 引用，在 module.exports 中赋值

class chat_msg {
    /**
     * @param {player_info} player - Player info.
     * @param {string} message - Plain message text.
     * @param {string} position - Message position.
     * @param {number} time - Timestamp.
     * @param {object} [data] - Extra parsed metadata.
     */
    constructor(player, message, position, time, data = {}) {
        this.player = player;
        this.message = message;
        this.position = position;
        this.time = time;
        this.data = data;
    }
}

/**
 * 玩家信息类，包含玩家的username、uuid和nickname（若有）
 * 其中username为玩家的原版用户名，uuid为玩家的唯一标识符，nickname为玩家的昵称（若有）
 * nickname为一个对象，格式遵循minecraft消息中的extra，包含text、color、bold、italic、underlined、strikethrough、obfuscated等属性
 * 例如：{"text":"玩家昵称","color":"red","bold":true}
 */
class player_info {
    constructor(username, uuid, nickname) {
        this.username = username;
        this.uuid = uuid;
        this.nickname = nickname;
    }
}

let player_info_list = []; //存储玩家信息的数组，元素为player_info对象

// ===== 内部解析辅助 =====

/**
 * 根据 username 或昵称从 player_info_list / bot.players 中解析 player_info
 * @param {string} name - username 或昵称纯文本
 * @param {Array|null} nickname_nodes - 可选，消息中提取的格式化昵称节点
 * @returns {player_info}
 */
function _resolve_player_info(name, nickname_nodes) {
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
    if (name && _bot && _bot.players && _bot.players[name]) {
        const p = _bot.players[name];
        return new player_info(p.username, p.uuid || '', get_display_name_nodes(p));
    }

    // 3. 格式化节点比对（最精准，解决同名不同色问题）
    if (nickname_nodes && nickname_nodes.length > 0 && _bot && _bot.players) {
        for (const p_key in _bot.players) {
            const p = _bot.players[p_key];
            const dn_nodes = get_display_name_nodes(p);
            if (dn_nodes.length > 0 && match_formatted_nodes(nickname_nodes, dn_nodes)) {
                return new player_info(p.username, p.uuid || '', dn_nodes);
            }
        }
    }

    // 4. 纯文本 displayName 比对（兜底）
    if (name && _bot && _bot.players) {
        for (const p_key in _bot.players) {
            const p = _bot.players[p_key];
            const display_text = get_display_name_text(p);
            if (display_text && display_text === name) {
                return new player_info(p.username, p.uuid || '', get_display_name_nodes(p));
            }
        }
        for (const p_key in _bot.players) {
            const p = _bot.players[p_key];
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
 */
function player_info_handler(jsonMsg) {
    // === 1. 原版消息解析：有 translate + with 数组 ===
    const translate = jsonMsg.translate || (jsonMsg.json && jsonMsg.json.translate) || null;
    const with_arr = (jsonMsg.json && jsonMsg.json.with) || jsonMsg.with || null;

    if (translate && Array.isArray(with_arr) && with_arr.length > 0) {
        const first_with = with_arr[0];
        let username = '';
        if (first_with && typeof first_with === 'object') {
            if (typeof first_with.insertion === 'string' && first_with.insertion) {
                username = first_with.insertion;
            } else if (first_with.hover_event && typeof first_with.hover_event.name === 'string') {
                username = first_with.hover_event.name;
            } else if (typeof first_with.text === 'string' && first_with.text) {
                username = first_with.text;
            }
        } else if (typeof first_with === 'string') {
            username = first_with;
        }
        if (username) return _resolve_player_info(username, null);
    }

    // === 2. CMI 插件消息：格式化节点比对优先 ===
    const nickname_nodes = extract_nickname_nodes(jsonMsg);
    if (nickname_nodes.length > 0) {
        const resolved = _resolve_player_info(null, nickname_nodes);
        if (resolved.username) return resolved;
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
                const resolved = _resolve_player_info(match[1], nickname_nodes);
                if (resolved.username) return resolved;
            }
        }
    }

    // === 4. 纯文本中查找已知玩家名 ===
    const plain_text = extract_plain_text(jsonMsg);
    if (_bot && _bot.players && plain_text) {
        for (const p_name in _bot.players) {
            if (plain_text.includes(p_name)) {
                return _resolve_player_info(p_name, nickname_nodes);
            }
        }
    }

    return new player_info('', '', {});
}

function chat_msg_handler(jsonMsg) {//处理方式：提取消息内容（为聊天、击杀、玩家加入退出、私聊类型）（若有翻译键直接使用翻译键，获得成就需特殊处理，消息需传翻译键的数组）为纯文本，提取消息位置（公屏/私聊），提取玩家信息（调用player_info_handler函数），将玩家信息、消息内容和消息位置封装成一个chat_msg对象并返回
    const player = player_info_handler(jsonMsg);
    const plain_text = extract_plain_text(jsonMsg);
    let message = '';
    let position = 'public';

    const translate = jsonMsg.translate || (jsonMsg.json && jsonMsg.json.translate) || null;

    // === 原版消息 ===
    if (translate) {
        const with_arr = (jsonMsg.json && jsonMsg.json.with) || jsonMsg.with || [];

        if (translate === 'chat.type.text') {
            position = 'public';
            if (with_arr.length >= 2) message = extract_plain_text(with_arr[1]);
        } else if (translate === 'commands.message.display.incoming') {
            position = 'private';
            if (with_arr.length >= 2) message = extract_plain_text(with_arr[1]);
        } else if (translate === 'commands.message.display.outgoing') {
            position = 'private';
            if (with_arr.length >= 2) message = extract_plain_text(with_arr[1]);
        } else if (translate === 'multiplayer.player.joined' || translate === 'multiplayer.player.left') {
            position = 'system';
            message = translate;
        } else if (translate.startsWith('death.')) {
            position = 'system';
            let translate_keys = [translate];
            for (const w of with_arr) {
                if (w && typeof w === 'object' && typeof w.translate === 'string') {
                    translate_keys.push(w.translate);
                }
            }
            message = translate_keys.join(',');
        } else if (translate.startsWith('chat.type.advancement.')) {
            position = 'system';
            let translate_keys = [translate];
            for (const w of with_arr) {
                if (w && typeof w === 'object') {
                    if (typeof w.translate === 'string') translate_keys.push(w.translate);
                    if (Array.isArray(w.with)) {
                        for (const ww of w.with) {
                            if (ww && typeof ww === 'object' && typeof ww.translate === 'string') {
                                translate_keys.push(ww.translate);
                            }
                        }
                    }
                }
            }
            message = translate_keys.join(',');
        } else {
            position = 'system';
            message = plain_text || translate;
        }
        return new chat_msg(player, message, position, Date.now());
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
    return new chat_msg(player, message, position, Date.now());
}

/**
 * Parse TPA metadata from click commands and visible text.
 * @param {string[]} commands - Click commands in the message.
 * @param {string} plain_text - Visible message text.
 * @param {player_info} player - Resolved player info.
 * @returns {{ requester: string, tpa_type: string, accept_command: string } | null}
 */
function parse_tpa_info(commands, plain_text, player) {
    for (const command of commands) {
        const accept_match = command.match(/^\/((?:cmi\s+)?tp(?:accept|yes)|tpayes|tpyes)\b/i);
        if (!accept_match) {
            continue;
        }

        const requester_match = plain_text.match(/^(\S+)\s+请求/);
        const requester = (player && player.username)
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

function system_msg_handler(jsonMsg) {//处理方式：处理与玩家无关的消息（tp消息除外，算作系统信息）提取消息内容为纯文本，（tp消息应有player信息）若有将消息内容和消息位置封装成一个chat_msg对象并返回
    const plain_text = extract_plain_text(jsonMsg);
    let player = new player_info('', '', {});
    let position = 'system';
    let data = {};

    // TPA 消息
    const commands = find_click_commands(jsonMsg);
    player = player_info_handler(jsonMsg);
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

    return new chat_msg(player, plain_text, position, Date.now(), data);
}

function msg_handler(jsonMsg) {//处理方式：判断消息类型（聊天、击杀、玩家加入退出、私聊、系统信息），调用相应的处理函数进行处理并返回处理结果
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
            return chat_msg_handler(jsonMsg);
        }
        return system_msg_handler(jsonMsg);
    }

    // === 2. 无 translate（CMI 插件） ===
    const commands = find_click_commands(jsonMsg);
    for (const cmd of commands) {
        if (/^\/(?:(?:cmi\s+)?tp(?:accept|deny|a|ahere|yes)|tpayes|tpyes)\b/i.test(cmd)) {
            return system_msg_handler(jsonMsg);
        }
    }

    if (plain_text.match(/\[.*->\s*(我|me|\S+)\s*\]/i)) return chat_msg_handler(jsonMsg);
    if (plain_text.match(/^<.*>\s/)) return chat_msg_handler(jsonMsg);

    for (const cmd of commands) {
        if (cmd.match(/^\/msg\s+\S+\s*$/)) return chat_msg_handler(jsonMsg);
    }

    return system_msg_handler(jsonMsg);
}

function player_info_update_handler(player) {//处理方式：提取玩家的username、uuid和nickname（若有）封装成一个player_info对象并更新player_info数组
    const username = player.username || '';
    const uuid = player.uuid || '';
    const nickname = get_display_name_nodes(player);
    const info = new player_info(username, uuid, nickname);

    let found = false;
    for (let i = 0; i < player_info_list.length; i++) {
        if (player_info_list[i].username === username) {
            player_info_list[i] = info;
            found = true;
            break;
        }
    }
    if (!found) player_info_list.push(info);
    return info;
}

module.exports = bot => {
    _bot = bot;
    bot.on('message', (jsonMsg) => {
        raw_msg = jsonMsg;
        bot.emit('msg_obj', msg_handler(jsonMsg));
    });
    bot.on('playerUpdated', (player) => {
        player_info_update_handler(player);
    });
    bot.on('playerJoined', (player) => {
        player_info_update_handler(player);
    });
    bot.on('playerLeft', (player) => {
        const username = player.username || '';
        player_info_list = player_info_list.filter(p => p.username !== username);
    });
}
