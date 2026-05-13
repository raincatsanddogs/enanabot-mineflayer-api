function always() {
    return () => true;
}

function position(positions) {
    const allowed = new Set(Array.isArray(positions) ? positions : [positions]);
    return (session) => allowed.has(session.position);
}

function to_me(names = []) {
    const bot_names = Array.isArray(names) ? names : [names];
    return (session) => {
        if (session.position === 'private' || session.position === 'internal') return true;
        const text = String(session.message || '').toLowerCase();
        return bot_names
            .map((name) => String(name || '').trim().toLowerCase())
            .filter((name) => name.length > 0)
            .some((name) => text.includes(`@${name}`) || text.includes(name));
    };
}

function and_rule(...rules) {
    return async (session) => {
        for (const rule of rules) {
            if (typeof rule === 'function' && !await rule(session)) return false;
        }
        return true;
    };
}

function or_rule(...rules) {
    return async (session) => {
        for (const rule of rules) {
            if (typeof rule === 'function' && await rule(session)) return true;
        }
        return false;
    };
}

function not_rule(rule) {
    return async (session) => !(await rule(session));
}

module.exports = {
    always,
    position,
    to_me,
    and_rule,
    or_rule,
    not_rule,
};
