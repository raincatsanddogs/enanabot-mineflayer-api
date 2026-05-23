/**
 * @module utils
 * @description Minecraft JSON 消息解析工具函数
 *
 * 支持 CMI 插件和原版消息格式的解析。
 * 所有函数命名遵循 snake_case 规范。
 */

class chat_msg {
    /**
     * @param {player_info|Array<player_info>|null} player - Player info,可能为数组或单个对象或null
     * @param {string} message - 消息纯文本，有翻译键的消息放于data部分
     * @param {string} position - 消息位置，public（公屏）、private（私聊）、private_outgoing（私聊发出）、system（系统信息）、tpa（TPA相关）
     * @param {number} time - 消息接收的时间戳（毫秒）
     * @param {object} [data] - 其他信息，包括可能存在的翻译键、物品、怪物信息.
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

// ===== 基础文本提取 =====

/**
 * 递归提取 JSON 消息节点中的所有可见纯文本
 * 忽略 hover_event 和 click_event 内部文本
 * @param {object|string|null} node - Minecraft JSON 消息节点
 * @returns {string} 拼接后的纯文本
 */
function extract_plain_text(node) {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string') return node;
    if (typeof node !== 'object') return '';

    let result = '';
    if (typeof node.text === 'string') {
        result += node.text;
    } else if (typeof node[''] === 'string') {
        result += node[''];
    }
    if (typeof node.translate === 'string' && !result) {
        result += node.translate;
    }
    if (Array.isArray(node.extra)) {
        for (const child of node.extra) {
            result += extract_plain_text(child);
        }
    }
    if (Array.isArray(node.with)) {
        for (const child of node.with) {
            result += extract_plain_text(child);
        }
    }
    return result;
}

/**
 * 递归收集 JSON 消息节点中所有 click_event.command 字符串
 * @param {object|null} node - Minecraft JSON 消息节点
 * @returns {string[]} command 数组
 */
function find_click_commands(node) {
    let commands = [];
    if (node === null || node === undefined || typeof node !== 'object') return commands;
    const click_event = _get_click_event(node);
    if (click_event && typeof click_event.command === 'string') {
        commands.push(click_event.command);
    }
    if (Array.isArray(node.extra)) {
        for (const child of node.extra) {
            commands = commands.concat(find_click_commands(child));
        }
    }
    return commands;
}

// ===== 节点文本辅助 =====

function _node_text(node) {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return '';
    if (typeof node.text === 'string') return node.text;
    if (typeof node[''] === 'string') return node[''];
    return '';
}

function _to_binary(val) {
    return val ? 1 : 0;
}

// ===== displayName 提取 =====

/**
 * 从 bot.players[x] 的 displayName 中提取昵称的格式化节点数组
 * 去除尾部的 ping 后缀 "(xxms)"
 * @param {object} player_obj - bot.players 中的玩家对象
 * @returns {Array} 格式化节点数组
 */
function get_display_name_nodes(player_obj) {
    if (!player_obj || !player_obj.displayName) return [];
    const dn = player_obj.displayName;
    let raw_nodes = [];
    if (dn.json && Array.isArray(dn.json.extra)) {
        raw_nodes = dn.json.extra;
    } else if (Array.isArray(dn.extra)) {
        raw_nodes = dn.extra;
    }
    if (raw_nodes.length === 0) return [];

    // 找到 ping 后缀起始点: "(" + gray color
    let ping_start = -1;
    for (let i = 0; i < raw_nodes.length; i++) {
        const node = raw_nodes[i];
        if (node && typeof node === 'object') {
            const t = _node_text(node);
            if (t === '(' && (node.color === 'gray' || node.color === 'dark_gray')) {
                ping_start = i;
                break;
            }
        }
    }

    let nickname_nodes = ping_start > 0
        ? raw_nodes.slice(0, ping_start)
        : raw_nodes.slice();

    // 去除尾部空白节点
    while (nickname_nodes.length > 0) {
        const last_text = _node_text(nickname_nodes[nickname_nodes.length - 1]);
        if (last_text.trim() === '') {
            nickname_nodes.pop();
        } else {
            break;
        }
    }
    return nickname_nodes;
}

/**
 * 从 bot.players[x] 中提取 displayName 的纯文本（去除 ping 后缀）
 * @param {object} player_obj - bot.players 中的玩家对象
 * @returns {string} 昵称纯文本
 */
function get_display_name_text(player_obj) {
    const nodes = get_display_name_nodes(player_obj);
    let text = '';
    for (const node of nodes) {
        text += _node_text(node);
    }
    return text.trim();
}

// ===== 格式化节点提取（从聊天消息中） =====

/**
 * 从聊天消息的 extra 结构中提取昵称的格式化节点
 * 支持 CMI 公屏聊天 (<昵称>)、私聊 ([昵称 -> 我])、TPA 消息
 * @param {object} json_msg - 完整的 jsonMsg 对象
 * @returns {Array} 格式化节点数组
 */
function extract_nickname_nodes(json_msg) {
    const extras = json_msg.extra || (json_msg.json && json_msg.json.extra) || [];
    if (extras.length === 0) return [];

    const first = extras[0];
    if (!first || typeof first !== 'object') return [];

    const inner = first.extra || [];
    if (inner.length === 0) return [];

    const plain = inner.map(n => _node_text(n)).join('');

    // 公屏聊天: <昵称> 消息
    if (plain.match(/^<.*>/)) {
        return _extract_between_delimiters(inner, '<', '>');
    }

    // 私聊: [昵称 -> 我] 或 [我 -> 昵称]
    if (plain.includes('->') && plain.includes('[')) {
        return _extract_whisper_nickname(inner);
    }

    // TPA: 昵称 请求传送... / 昵称 请求你传送...
    if (plain.includes('请求传送') || plain.includes('请求你传送')) {
        return _extract_tpa_nickname(inner);
    }

    return [];
}

function _extract_between_delimiters(inner_nodes, open_char, close_char) {
    let start_idx = -1;
    let end_idx = -1;
    for (let i = 0; i < inner_nodes.length; i++) {
        const text = _node_text(inner_nodes[i]);
        if (start_idx < 0 && text.includes(open_char)) {
            start_idx = i;
            continue;
        }
        if (start_idx >= 0 && text.includes(close_char)) {
            end_idx = i;
            break;
        }
    }
    if (start_idx < 0) return [];
    if (end_idx < 0) end_idx = inner_nodes.length;
    return inner_nodes.slice(start_idx + 1, end_idx);
}

function _extract_whisper_nickname(inner_nodes) {
    let bracket_idx = -1;
    let arrow_idx = -1;
    let close_bracket_idx = -1;
    for (let i = 0; i < inner_nodes.length; i++) {
        const text = _node_text(inner_nodes[i]);
        if (bracket_idx < 0 && text.includes('[')) bracket_idx = i;
        if (text.includes('->')) arrow_idx = i;
        if (arrow_idx >= 0 && text.includes(']')) { close_bracket_idx = i; break; }
    }
    if (bracket_idx < 0 || arrow_idx < 0) return [];

    const before_arrow = inner_nodes.slice(bracket_idx + 1, arrow_idx);
    const after_end = close_bracket_idx >= 0 ? close_bracket_idx : inner_nodes.length;
    const after_arrow = inner_nodes.slice(arrow_idx + 1, after_end);

    const before_text = before_arrow.map(n => _node_text(n)).join('').trim();
    if (before_text === '我' || before_text.toLowerCase() === 'me') {
        return after_arrow.filter(n => _node_text(n).trim() !== '');
    }
    return before_arrow.filter(n => _node_text(n).trim() !== '');
}

function _extract_tpa_nickname(inner_nodes) {
    let result = [];
    for (const node of inner_nodes) {
        const text = _node_text(node);
        if (text.includes('请求') || text.includes('传送')) break;
        if (text.trim() === '' && result.length > 0) break;
        if (text.trim() !== '') result.push(node);
    }
    return result;
}

// ===== 格式化节点规范化与比对 =====

/**
 * 将格式化节点数组规范化为标准格式
 * 每个节点保留 {text, color, bold, italic, underlined, strikethrough, obfuscated}
 * @param {Array} nodes - 原始格式化节点数组
 * @returns {Array<{text: string, color: string, bold: number, italic: number, underlined: number, strikethrough: number, obfuscated: number}>}
 */
function normalize_nodes(nodes) {
    if (!Array.isArray(nodes)) return [];
    const result = [];
    for (const node of nodes) {
        const text = _node_text(node);
        if (!text) continue;
        const is_obj = node && typeof node === 'object';
        result.push({
            text: text,
            color: (is_obj && node.color) || 'default',
            bold: _to_binary(is_obj ? node.bold : 0),
            italic: _to_binary(is_obj ? node.italic : 0),
            underlined: _to_binary(is_obj ? node.underlined : 0),
            strikethrough: _to_binary(is_obj ? node.strikethrough : 0),
            obfuscated: _to_binary(is_obj ? node.obfuscated : 0),
        });
    }
    return result;
}

/**
 * 将规范化节点展开为逐字符带样式的数组
 */
function _to_styled_chars(normalized_nodes) {
    const chars = [];
    for (const node of normalized_nodes) {
        for (const ch of node.text) {
            chars.push({
                char: ch, color: node.color, bold: node.bold,
                italic: node.italic, underlined: node.underlined,
                strikethrough: node.strikethrough, obfuscated: node.obfuscated,
            });
        }
    }
    return chars;
}

/**
 * 比较两组格式化节点是否代表同一个玩家昵称
 * 使用逐字符比对，比较全部样式属性 (text, color, bold, italic, underlined, strikethrough, obfuscated)
 * @param {Array} nodes_a - 格式化节点数组 A
 * @param {Array} nodes_b - 格式化节点数组 B
 * @returns {boolean} 是否匹配
 */
function match_formatted_nodes(nodes_a, nodes_b) {
    const chars_a = _to_styled_chars(normalize_nodes(nodes_a));
    const chars_b = _to_styled_chars(normalize_nodes(nodes_b));
    if (chars_a.length !== chars_b.length) return false;
    if (chars_a.length === 0) return false;
    for (let i = 0; i < chars_a.length; i++) {
        const a = chars_a[i];
        const b = chars_b[i];
        if (a.char !== b.char || a.color !== b.color ||
            a.bold !== b.bold || a.italic !== b.italic ||
            a.underlined !== b.underlined || a.strikethrough !== b.strikethrough ||
            a.obfuscated !== b.obfuscated) {
            return false;
        }
    }
    return true;
}


/**
 * 递归收集消息中的 show_item 和 show_entity（非玩家）hover_event
 * @param {object} jsonMsg - 完整的 jsonMsg 对象
 * @returns {{ items: Array, entities: Array }}
 */
function _collect_hover_events(jsonMsg) {
    const items = [];
    const entities = [];

    // 优先使用 json.with / json.extra，无则退回顶层（避免重复扫描）
    const sources = [];
    const _with = (jsonMsg.json && Array.isArray(jsonMsg.json.with)) ? jsonMsg.json.with
        : (Array.isArray(jsonMsg.with) ? jsonMsg.with : []);
    const _extra = (jsonMsg.json && Array.isArray(jsonMsg.json.extra)) ? jsonMsg.json.extra
        : (Array.isArray(jsonMsg.extra) ? jsonMsg.extra : []);
    sources.push(..._with, ..._extra);

    for (const node of sources) {
        if (!node || typeof node !== 'object') continue;
        const he = _get_hover_event(node);
        if (!he || !he.action) continue;

        if (he.action === 'show_item') {
            const display_name = (he.components && he.components['minecraft:custom_name'])
                || extract_plain_text(node).replace(/^\[|\]$/g, '').trim()
                || '';
            items.push({
                id: he.id || '',
                count: he.count || 1,
                components: he.components || {},
                display_name: display_name,
            });
        } else if (he.action === 'show_entity' && he.id !== 'minecraft:player') {
            entities.push({
                id: he.id || '',
                uuid: he.uuid || null,
                name: he.name || '',
            });
        }
    }

    return { items, entities };
}

/**
 * 递归提取可见文本（不使用 translate 键作为回退）
 * @param {object|string|Array|null} node
 * @returns {string}
 */
function _extract_visible_text(node) {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(_extract_visible_text).join('');
    if (typeof node !== 'object') return '';

    let result = '';
    if (typeof node.text === 'string') {
        result += node.text;
    } else if (typeof node[''] === 'string') {
        result += node[''];
    }
    if (Array.isArray(node.extra)) {
        for (const child of node.extra) {
            result += _extract_visible_text(child);
        }
    }
    if (Array.isArray(node.with)) {
        for (const child of node.with) {
            result += _extract_visible_text(child);
        }
    }
    return result;
}

function _is_probable_username(name) {
    return typeof name === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(name);
}

function _get_hover_event(node) {
    if (!node || typeof node !== 'object') return null;
    return node.hover_event || node.hoverEvent || (node.json && (node.json.hover_event || node.json.hoverEvent)) || null;
}

function _get_click_event(node) {
    if (!node || typeof node !== 'object') return null;
    return node.click_event || node.clickEvent || (node.json && (node.json.click_event || node.json.clickEvent)) || null;
}

function _collect_translate_keys_from_node(node, keys_set) {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
        for (const child of node) _collect_translate_keys_from_node(child, keys_set);
        return;
    }
    if (typeof node !== 'object') return;

    if (typeof node.translate === 'string' && node.translate) {
        keys_set.add(node.translate);
    }
    if (Array.isArray(node.with)) {
        for (const child of node.with) _collect_translate_keys_from_node(child, keys_set);
    }
    if (Array.isArray(node.extra)) {
        for (const child of node.extra) _collect_translate_keys_from_node(child, keys_set);
    }
    if (node.json && typeof node.json === 'object') {
        _collect_translate_keys_from_node(node.json, keys_set);
    }

    const hover_event = _get_hover_event(node);
    if (hover_event && hover_event.action === 'show_text' && hover_event.value !== undefined) {
        _collect_translate_keys_from_node(hover_event.value, keys_set);
    }
}

function _collect_translate_keys(jsonMsg, fallback_translate) {
    const keys_set = new Set();
    _collect_translate_keys_from_node(jsonMsg, keys_set);
    if (keys_set.size === 0 && fallback_translate) keys_set.add(fallback_translate);
    return Array.from(keys_set);
}

function _collect_player_names_from_node(node, names_set) {
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) {
        for (const child of node) _collect_player_names_from_node(child, names_set);
        return;
    }
    if (typeof node !== 'object') return;

    const hover_event = _get_hover_event(node);
    const is_show_entity = !!(hover_event && hover_event.action === 'show_entity');
    const is_player_hover = !!(is_show_entity && hover_event.id === 'minecraft:player');
    const is_non_player_entity = !!(is_show_entity && hover_event.id && hover_event.id !== 'minecraft:player');

    if (is_player_hover && typeof hover_event.name === 'string' && hover_event.name) {
        names_set.add(hover_event.name);
    }

    const click_event = _get_click_event(node);
    let click_name = '';
    if (click_event && typeof click_event.command === 'string') {
        const match = click_event.command.match(/^\/(?:msg|tell)\s+(\S+)\s*$/i);
        if (match && _is_probable_username(match[1])) {
            click_name = match[1];
            names_set.add(click_name);
        }
    }

    const insertion_name = _is_probable_username(node.insertion) ? node.insertion : '';
    const has_player_hint = is_player_hover || !!click_name || !!insertion_name;

    if (!is_non_player_entity && has_player_hint) {
        if (insertion_name) names_set.add(insertion_name);
        if (_is_probable_username(node.text)) names_set.add(node.text);
        if (_is_probable_username(node[''])) names_set.add(node['']);
    }

    if (Array.isArray(node.with)) {
        for (const child of node.with) _collect_player_names_from_node(child, names_set);
    }
    if (Array.isArray(node.extra)) {
        for (const child of node.extra) _collect_player_names_from_node(child, names_set);
    }
    if (node.json && typeof node.json === 'object') {
        _collect_player_names_from_node(node.json, names_set);
    }
}

function _merge_player_result(target, resolved, fallback_name = '') {
    const username = (resolved && resolved.username) || fallback_name || '';
    if (!username) return;

    const key = username;
    for (const p of target) {
        if (p.username === key) return;
    }

    if (resolved && resolved.username) {
        target.push(resolved);
    } else {
        target.push(new player_info(username, '', {}));
    }
}

function _finalize_player_result(players) {
    if (players.length === 0) return new player_info('', '', {});
    if (players.length === 1) return players[0];
    return players;
}

function _normalize_translate_message(message, plain_text, visible_text, translate) {
    const fallback_text = plain_text || translate || '';
    if (!message) return fallback_text;

    const norm_message = message.replace(/\s+/g, '');
    const norm_visible = (visible_text || '').replace(/\s+/g, '');
    const norm_fallback = fallback_text.replace(/\s+/g, '');

    if (norm_message && norm_visible && norm_message === norm_visible && norm_fallback && norm_fallback !== norm_visible) {
        return fallback_text;
    }
    return message;
}

function _build_translate_data(jsonMsg, translate) {
    const translate_keys = _collect_translate_keys(jsonMsg, translate);
    if (translate_keys.length <= 1) return translate_keys[0] || translate;
    return translate_keys;
}

function _get_primary_player(player) {
    if (Array.isArray(player)) {
        return player.length > 0 ? player[0] : new player_info('', '', {});
    }
    return player || new player_info('', '', {});
}

module.exports = {
    extract_plain_text,
    find_click_commands,
    get_display_name_text,
    get_display_name_nodes,
    extract_nickname_nodes,
    normalize_nodes,
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
};
