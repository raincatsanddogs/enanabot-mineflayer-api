/**
 * @module plugins/perm
 * @description Persistent permission management command.
 */

const { on_command } = require('../../handler/command');
const permission_store = require('../../utils/permission_store');
const config = require('../../configs/config');

let loaded = false;

/**
 * Check whether a permission can manage persisted permissions.
 * @param {string} permission - Current session permission.
 * @returns {boolean} Whether management is allowed.
 */
function can_manage_permissions(permission) {
    return permission === 'admin' || permission === 'system';
}

/**
 * Format the effective permission list.
 * @returns {string} Permission list text.
 */
function format_permission_list() {
    const entries = Object.entries(permission_store.list_permissions())
        .sort(([name_a], [name_b]) => name_a.localeCompare(name_b));
    if (entries.length === 0) {
        return '当前没有配置玩家权限';
    }
    return entries
        .map(([name, permission]) => `${name}: ${permission}`)
        .join('\n');
}

/**
 * Register perm command.
 */
module.exports = function perm_plugin() {
    if (loaded) {
        return;
    }
    loaded = true;

    permission_store.ensure_loaded(config);

    const perm_command = on_command('perm', {
        permission: 'guest',
        description: '权限管理指令',
    });

    perm_command.handle(async (session) => {
        const sub = String(session.args[0] || '').toLowerCase();
        if (!sub) {
            await session.finish(`当前权限: ${session.permission}`);
        }

        if (!can_manage_permissions(session.permission)) {
            await session.finish('权限不足：需要管理员权限');
        }

        if (sub === 'list') {
            await session.finish(format_permission_list());
        }

        if (sub === 'get') {
            const player_name = session.args[1];
            if (!player_name) {
                await session.finish('用法: #perm get <玩家>');
            }
            const permission = permission_store.get_player_permission(player_name);
            await session.finish(`${player_name}: ${permission}`);
        }

        if (sub === 'set') {
            const player_name = session.args[1];
            const permission = session.args[2];
            if (!player_name || !permission) {
                await session.finish('用法: #perm set <玩家> <guest|user|admin>');
            }
            const result = permission_store.set_player_permission(player_name, permission);
            if (!result.ok) {
                await session.finish(result.error);
            }
            await session.finish(`已设置 ${player_name} 为 ${permission}`);
        }

        if (sub === 'remove') {
            const player_name = session.args[1];
            if (!player_name) {
                await session.finish('用法: #perm remove <玩家>');
            }
            const removed = permission_store.remove_player_permission(player_name);
            const effective = permission_store.get_player_permission(player_name);
            await session.finish(removed
                ? `已移除 ${player_name} 的持久化权限，当前有效权限: ${effective}`
                : `${player_name} 没有持久化权限，当前有效权限: ${effective}`);
        }

        await session.finish('用法: #perm [list|get|set|remove] <玩家> [guest|user|admin]');
    });
};
