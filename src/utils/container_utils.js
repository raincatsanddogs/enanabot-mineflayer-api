/**
 * @module container_utils
 * @description Container GUI helpers for reading and interacting with home menus.
 */

const nbt = require('prismarine-nbt');

const HOME_PARSE_DEBUG = process.env.HOME_PARSE_DEBUG === '1';
const HOME_WINDOW_OPEN_TIMEOUT_MS = 4000;
const HOME_PAGE_SWITCH_DELAY_MS = 400;
const HOME_TP_CLICK_DELAY_MS = 350;

/**
 * Print debug output for home GUI parsing.
 * @param {string} message - Debug message.
 */
function debug_home_parse(message) {
    if (!HOME_PARSE_DEBUG) {
        return;
    }
    console.error(`[home_parse] ${message}`);
}

/**
 * Delay execution for a number of milliseconds.
 * @param {number} ms - Milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract plain text from a Minecraft JSON/NBT text component.
 * @param {unknown} obj - Text component.
 * @returns {string} Plain text.
 */
function extract_text_component(obj) {
    if (!obj) {
        return '';
    }
    if (typeof obj === 'string') {
        return obj;
    }
    if (typeof obj === 'number') {
        return String(obj);
    }

    let node = obj;
    if (node.type !== undefined && node.value !== undefined) {
        try {
            node = nbt.simplify(node);
        } catch {
            node = obj;
        }
    }

    if (typeof node === 'string') {
        return node;
    }

    let result = '';
    if (node && typeof node === 'object' && node.text !== undefined) {
        result += String(node.text);
    }
    if (node && typeof node === 'object' && Array.isArray(node.extra)) {
        for (const extra of node.extra) {
            result += extract_text_component(extra);
        }
    }
    return result;
}

/**
 * Get an item's display label.
 * @param {object|null} item - mineflayer item.
 * @returns {string} Display label.
 */
function get_item_label(item) {
    if (!item) {
        return '';
    }

    if (item.componentMap && item.componentMap.size > 0) {
        const custom_name_comp = item.componentMap.get('custom_name')
            || item.componentMap.get('minecraft:custom_name');
        if (custom_name_comp) {
            const data = custom_name_comp.data || custom_name_comp.value || custom_name_comp;
            const text = extract_text_component(data);
            if (text && text.trim()) {
                return text.trim();
            }
        }

        const item_name_comp = item.componentMap.get('item_name')
            || item.componentMap.get('minecraft:item_name');
        if (item_name_comp) {
            const data = item_name_comp.data || item_name_comp.value || item_name_comp;
            const text = extract_text_component(data);
            if (text && text.trim()) {
                return text.trim();
            }
        }
    }

    if (item.components && Array.isArray(item.components)) {
        for (const comp of item.components) {
            const type_name = comp.type || '';
            if (type_name === 'custom_name' || type_name === 'minecraft:custom_name') {
                const text = extract_text_component(comp.data || comp.value);
                if (text && text.trim()) {
                    return text.trim();
                }
            }
        }
        for (const comp of item.components) {
            const type_name = comp.type || '';
            if (type_name === 'item_name' || type_name === 'minecraft:item_name') {
                const text = extract_text_component(comp.data || comp.value);
                if (text && text.trim()) {
                    return text.trim();
                }
            }
        }
    }

    if (item.customName) {
        const custom_name = item.customName;
        if (typeof custom_name === 'string') {
            try {
                const parsed = JSON.parse(custom_name);
                if (parsed && typeof parsed === 'object') {
                    const text = extract_text_component(parsed);
                    if (text) {
                        return text;
                    }
                }
            } catch {
                return custom_name;
            }
            return custom_name;
        }
        if (typeof custom_name === 'object' && custom_name.toString) {
            return custom_name.toString();
        }
    }

    return item.displayName || item.name || '';
}

/**
 * Check whether an item is a navigation control.
 * @param {object|null} item - mineflayer item.
 * @param {string} [label_text] - Optional precomputed label.
 * @returns {boolean} Whether the item is a navigation control.
 */
function is_navigation_item(item, label_text) {
    const label_raw = typeof label_text === 'string' ? label_text : get_item_label(item);
    const label = String(label_raw || '').toLowerCase().trim();
    const name = item && item.name ? item.name.toLowerCase() : '';

    const explicit_page_labels = new Set([
        '下一页',
        '上一页',
        'next',
        'prev',
        'next page',
        'prev page',
        'previous page',
        'back',
        '返回',
    ]);
    const is_explicit_page_label = explicit_page_labels.has(label);
    const has_page_keyword = /\b(next|prev|previous|page)\b/.test(label)
        || label.includes('下一页')
        || label.includes('上一页');

    return (name.includes('arrow') && (has_page_keyword || is_explicit_page_label))
        || is_explicit_page_label;
}

/**
 * Normalize a GUI label into a home name.
 * @param {string} label - Item label.
 * @returns {string} Home name.
 */
function normalize_home_name(label) {
    if (typeof label !== 'string') {
        return '';
    }

    const text = label.trim();
    if (!text) {
        return '';
    }

    const teleport_match = text.match(/点击传送至\s+([^|\s]+)/);
    if (teleport_match && teleport_match[1]) {
        return teleport_match[1].trim();
    }

    const first_segment = text.split('|')[0].trim();
    return first_segment.replace(/^点击传送至\s+/i, '').trim();
}

/**
 * Check whether an item is a decorative border item.
 * @param {object|null} item - mineflayer item.
 * @returns {boolean} Whether the item is decorative.
 */
function is_border_item(item) {
    if (!item) {
        return false;
    }
    const name = item.name || '';
    return name.includes('stained_glass_pane') || name === 'glass_pane';
}

/**
 * Check whether an item is a GUI button that is not a home entry.
 * @param {object|null} item - mineflayer item.
 * @returns {boolean} Whether the item is a GUI button.
 */
function is_gui_button(item) {
    if (!item) {
        return false;
    }

    const name = item.name || '';
    const label = get_item_label(item).toLowerCase();

    if (name === 'player_head' || name === 'barrier') {
        return true;
    }
    if (name === 'totem_of_undying') {
        return true;
    }
    if (label === '关闭' || label === 'close') {
        return true;
    }
    if (label === '死亡位置' || label === 'death location') {
        return true;
    }

    return false;
}

/**
 * Extract home names from a container window.
 * @param {object} window - mineflayer window.
 * @returns {string[]} Home names.
 */
function extract_homes(window) {
    const homes = [];
    if (!window || !Array.isArray(window.slots)) {
        return homes;
    }

    const total_slots = window.slots.length;
    const container_slots = Math.max(0, total_slots - 36);

    for (let index = 0; index < container_slots; index++) {
        const item = window.slots[index];
        if (!item) {
            continue;
        }

        const label = get_item_label(item);
        if (is_border_item(item)) {
            debug_home_parse(`skip border slot=${index}, name=${item.name || ''}, label=${label}`);
            continue;
        }
        if (is_gui_button(item)) {
            debug_home_parse(`skip gui slot=${index}, name=${item.name || ''}, label=${label}`);
            continue;
        }
        if (is_navigation_item(item, label)) {
            debug_home_parse(`skip nav slot=${index}, name=${item.name || ''}, label=${label}`);
            continue;
        }

        const home_name = normalize_home_name(label);
        if (home_name) {
            homes.push(home_name);
            debug_home_parse(`collect slot=${index}, name=${item.name || ''}, home=${home_name}`);
        }
    }

    debug_home_parse(`extract_homes collected=${homes.length}`);
    return homes;
}

/**
 * Find the next-page slot in a container window.
 * @param {object} window - mineflayer window.
 * @returns {number|null} Slot index.
 */
function find_next_slot(window) {
    if (!window || !Array.isArray(window.slots)) {
        return null;
    }

    for (let index = 0; index < window.slots.length; index++) {
        const item = window.slots[index];
        if (!item) {
            continue;
        }

        const label = get_item_label(item).toLowerCase();
        const name = item.name ? item.name.toLowerCase() : '';
        if (name.includes('arrow') && (label.includes('next') || label.includes('下一页'))) {
            return index;
        }
    }
    return null;
}

/**
 * Find the slot for a named home.
 * @param {object} window - mineflayer window.
 * @param {string} home_name - Home name.
 * @returns {number|null} Slot index.
 */
function find_home_slot(window, home_name) {
    if (!window || !Array.isArray(window.slots)) {
        return null;
    }

    const target_name = String(home_name || '').trim();
    if (!target_name) {
        return null;
    }

    const total_slots = window.slots.length;
    const container_slots = Math.max(0, total_slots - 36);

    for (let index = 0; index < container_slots; index++) {
        const item = window.slots[index];
        if (!item) {
            continue;
        }

        const raw_label = get_item_label(item);
        if (is_border_item(item) || is_gui_button(item) || is_navigation_item(item, raw_label)) {
            continue;
        }

        const label = normalize_home_name(raw_label);
        if (label === target_name || label.toLowerCase() === target_name.toLowerCase()) {
            return index;
        }
    }

    return null;
}

/**
 * Wait for a container window to open.
 * @param {object} bot - mineflayer bot instance.
 * @param {number} timeout_ms - Timeout in milliseconds.
 * @returns {Promise<object>} Opened window.
 */
function wait_for_window_open(bot, timeout_ms) {
    return new Promise((resolve, reject) => {
        let timer = null;

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer);
            }
            bot.removeListener('windowOpen', on_open);
        };

        const on_open = (window) => {
            cleanup();
            resolve(window);
        };

        const on_timeout = () => {
            cleanup();
            reject(new Error('Timed out waiting for window to open.'));
        };

        bot.once('windowOpen', on_open);
        timer = setTimeout(on_timeout, timeout_ms);
    });
}

/**
 * List homes from the home GUI, including one next page if present.
 * @param {object} bot - mineflayer bot instance.
 * @returns {Promise<string[]>} Home names.
 */
async function list_homes(bot) {
    bot.chat('/home');
    const window = await wait_for_window_open(bot, HOME_WINDOW_OPEN_TIMEOUT_MS);
    const homes = new Set(extract_homes(window));

    const next_slot = find_next_slot(window);
    if (next_slot !== null) {
        bot.clickWindow(next_slot, 0, 0);
        await delay(HOME_PAGE_SWITCH_DELAY_MS);
        const updated_window = bot.currentWindow || window;
        for (const home of extract_homes(updated_window)) {
            homes.add(home);
        }
    }

    if (bot.currentWindow) {
        bot.closeWindow(bot.currentWindow);
    }

    debug_home_parse(`list_homes final_count=${homes.size}, homes=${JSON.stringify([...homes])}`);
    return [...homes];
}

/**
 * Click a home entry in the home GUI.
 * @param {object} bot - mineflayer bot instance.
 * @param {string} home_name - Home name.
 * @returns {Promise<boolean>} Whether the click was sent.
 */
async function tp_to_home(bot, home_name) {
    bot.chat('/home');
    const window = await wait_for_window_open(bot, HOME_WINDOW_OPEN_TIMEOUT_MS);

    let home_slot = find_home_slot(window, home_name);
    if (home_slot === null) {
        const next_slot = find_next_slot(window);
        if (next_slot !== null) {
            bot.clickWindow(next_slot, 0, 0);
            await delay(HOME_PAGE_SWITCH_DELAY_MS);
            const updated_window = bot.currentWindow || window;
            home_slot = find_home_slot(updated_window, home_name);
        }
    }

    if (home_slot === null) {
        if (bot.currentWindow) {
            bot.closeWindow(bot.currentWindow);
        }
        throw new Error(`Home not found: ${home_name}`);
    }

    bot.clickWindow(home_slot, 0, 0);
    await delay(HOME_TP_CLICK_DELAY_MS);
    return true;
}

module.exports = {
    delay,
    extract_text_component,
    get_item_label,
    is_navigation_item,
    normalize_home_name,
    is_border_item,
    is_gui_button,
    extract_homes,
    find_next_slot,
    find_home_slot,
    wait_for_window_open,
    list_homes,
    tp_to_home,
};
