/**
 * Command 模块入口
 * 聚合了指令、监听器、会话、权限和规则的导出
 */
const listener = require('./command_listener');
const registry = require('./command_registry');
const session = require('./command_session');
const permission = require('./utils/permission_utils');
const rules = require('./utils/rule_utils');

module.exports = {
    ...registry,
    ...listener,
    ...session,
    ...permission,
    rules,
};
