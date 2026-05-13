class Command {
    constructor(name, options = {}, order = 0) {
        this.name = normalize_command_name(name);
        this.aliases = new Set((options.aliases || []).map(normalize_command_name));
        this.rule = typeof options.rule === 'function' ? options.rule : (() => true);
        this.permission = options.permission || 'admin';
        this.priority = Number.isFinite(options.priority) ? options.priority : 1;
        this.block = options.block !== false;
        this.description = options.description || '';
        this.handler = null;
        this.order = order;
    }

    handle(fn) {
        this.handler = fn;
        return this;
    }

    match(name) {
        const normalized = normalize_command_name(name);
        return this.name === normalized || this.aliases.has(normalized);
    }
}

const commands = [];
let command_order = 0;

function normalize_command_name(name) {
    return String(name || '').trim().toLowerCase();
}

function sort_commands() {
    commands.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.order - b.order;
    });
}

function on_command(name, options = {}) {
    const command = new Command(name, options, command_order++);
    commands.push(command);
    sort_commands();
    return command;
}

function get_commands() {
    return commands.slice();
}

function clear_commands() {
    commands.length = 0;
    command_order = 0;
}

module.exports = {
    Command,
    on_command,
    get_commands,
    clear_commands,
    normalize_command_name,
};
