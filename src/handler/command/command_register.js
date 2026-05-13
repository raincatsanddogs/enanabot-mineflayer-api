let registered = false;

/**
 * Register built-in commands.
 *
 * Commands now live under src/plugins and are loaded through the mineflayer
 * plugin aggregator. This function is kept as a compatibility no-op for older
 * callers that still import command_register.
 */
function register_builtin_commands() {
    if (registered) return;
    registered = true;
}

module.exports = {
    register_builtin_commands,
};
