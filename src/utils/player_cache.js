/**
 * @module player_cache
 * @description 按 bot scope 隔离的玩家信息持久化缓存。
 *
 * 缓存文件保存在 configs/player_cache.<scope>.json，每条记录包含
 * { username, uuid, nickname, last_seen }，其中 last_seen 为毫秒时间戳。
 * 加载时自动清理超过 TTL 的过期条目。
 */

const fs = require('fs');
const path = require('path');
const { sanitize_scope_part } = require('./bot_context');

const CACHE_DIR = path.resolve(__dirname, '../../configs');

/** 默认有效期：7 天（毫秒） */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @type {Map<string, { players: Map<string, object>, loaded: boolean }>} */
const scoped_caches = new Map();

// ===== 内部工具 =====

function _normalize_scope(scope) {
    return sanitize_scope_part(scope || 'default');
}

function _get_cache_file(scope) {
    return path.join(CACHE_DIR, `player_cache.${_normalize_scope(scope)}.json`);
}

function _get_record(scope) {
    const key = _normalize_scope(scope);
    if (!scoped_caches.has(key)) {
        scoped_caches.set(key, { players: new Map(), loaded: false });
    }
    return scoped_caches.get(key);
}

/**
 * 将内存 Map 写入磁盘。
 * @param {string} scope
 */
function _persist(scope) {
    const record = _get_record(scope);
    try {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
        const entries = [];
        for (const entry of record.players.values()) {
            entries.push(entry);
        }
        const payload = {
            updated_at: new Date().toISOString(),
            players: entries,
        };
        fs.writeFileSync(
            _get_cache_file(scope),
            JSON.stringify(payload, null, 2),
            'utf-8'
        );
    } catch (err) {
        console.error(`[player_cache:${_normalize_scope(scope)}] 持久化失败: ${err.message || err}`);
    }
}

// ===== 公开 API =====

/**
 * 从磁盘加载缓存并清理过期条目。
 * @param {string} [scope='default']
 * @param {number} [ttl_ms] - 自定义 TTL（毫秒），默认 7 天。
 */
function load_cache(scope, ttl_ms) {
    const normalized = _normalize_scope(scope);
    const record = _get_record(normalized);
    const ttl = typeof ttl_ms === 'number' && ttl_ms > 0 ? ttl_ms : DEFAULT_TTL_MS;
    const now = Date.now();

    record.players.clear();

    try {
        const file = _get_cache_file(normalized);
        if (!fs.existsSync(file)) {
            record.loaded = true;
            return;
        }

        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed.players)) {
            let expired_count = 0;
            for (const entry of parsed.players) {
                if (!entry || typeof entry.username !== 'string' || !entry.username) {
                    continue;
                }
                // 过期检查
                const last_seen = typeof entry.last_seen === 'number' ? entry.last_seen : 0;
                if (now - last_seen > ttl) {
                    expired_count++;
                    continue;
                }
                record.players.set(entry.username, {
                    username: entry.username,
                    uuid: entry.uuid || '',
                    nickname: entry.nickname || {},
                    last_seen: last_seen,
                });
            }
            if (expired_count > 0) {
                console.log(`[player_cache:${normalized}] 清理了 ${expired_count} 条过期缓存`);
                // 清理后重新持久化
                _persist(normalized);
            }
        }
    } catch (err) {
        console.error(`[player_cache:${normalized}] 加载失败: ${err.message || err}`);
    }

    record.loaded = true;
}

/**
 * 确保指定 scope 的缓存已加载。
 * @param {string} scope
 */
function ensure_loaded(scope) {
    const record = _get_record(scope);
    if (!record.loaded) {
        load_cache(scope);
    }
}

/**
 * 保存/更新一个玩家的信息到缓存并持久化到磁盘。
 * @param {string} scope - bot scope。
 * @param {{ username: string, uuid: string, nickname: object }} player_info
 */
function save_player(scope, player_info) {
    if (!player_info || typeof player_info.username !== 'string' || !player_info.username) {
        return;
    }
    ensure_loaded(scope);
    const record = _get_record(scope);
    record.players.set(player_info.username, {
        username: player_info.username,
        uuid: player_info.uuid || '',
        nickname: player_info.nickname || {},
        last_seen: Date.now(),
    });
    _persist(scope);
}

/**
 * 返回当前 scope 下所有有效的缓存玩家信息。
 * 返回格式与 player_info 类实例结构一致：{ username, uuid, nickname }。
 * @param {string} [scope='default']
 * @returns {Array<{ username: string, uuid: string, nickname: object }>}
 */
function get_all_cached_players(scope) {
    ensure_loaded(scope);
    const record = _get_record(scope);
    const result = [];
    for (const entry of record.players.values()) {
        result.push({
            username: entry.username,
            uuid: entry.uuid || '',
            nickname: entry.nickname || {},
        });
    }
    return result;
}

module.exports = {
    CACHE_DIR,
    DEFAULT_TTL_MS,
    load_cache,
    ensure_loaded,
    save_player,
    get_all_cached_players,
};
