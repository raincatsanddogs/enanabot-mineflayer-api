/**
 * @module plugins
 * @description mineflayer plugin aggregator for all command plugins.
 */

const plugin_list = [
    require('./ping'),
    require('./echo'),
    require('./send'),
    require('./help'),
    require('./perm'),
    require('./home'),
    require('./tpa'),
    require('./wordle'),
    require('./guess'),
    require('./hint'),
    require('./ops'),
];

/**
 * Load all command plugins into a mineflayer bot.
 * @param {object} bot - mineflayer bot instance.
 */
function register_plugins(bot) {
    for (const plugin of plugin_list) {
        bot.loadPlugin(plugin);
    }
}

module.exports = register_plugins;
module.exports.register_plugins = register_plugins;
