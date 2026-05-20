/**
 * @module plugins/ops
 * @description Admin-only operational commands for process restart and git update.
 */

const { execFile } = require('child_process');
const path = require('path');
const { on_command, rules } = require('../../handler/command');
const config = require('../../configs/config');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_GIT_MIRROR_FROM = 'https://github.com/';
const RESTART_DELAY_MS = 1000;

let loaded = false;

function is_ops_enabled(runtime_config = config) {
    return runtime_config.enable_ops_commands === true
        || runtime_config.enableOpsCommands === true
        || runtime_config.connect && (
            runtime_config.connect.enable_ops_commands === true
            || runtime_config.connect.enableOpsCommands === true
        );
}

function exec_file(command, args, options) {
    return new Promise((resolve, reject) => {
        execFile(command, args, options, (err, stdout, stderr) => {
            if (err) {
                err.stdout = stdout;
                err.stderr = stderr;
                reject(err);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function compact_output(stdout = '', stderr = '') {
    const text = [stdout, stderr]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join('\n');

    if (!text) {
        return '无输出';
    }
    return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
}

function format_error(err) {
    const output = compact_output(err && err.stdout, err && err.stderr);
    return output === '无输出' ? (err && err.message ? err.message : String(err)) : output;
}

function schedule_process_exit(schedule_exit, exit_code = 0) {
    schedule_exit(() => process.exit(exit_code), RESTART_DELAY_MS);
}

async function run_git(args, repo_root, timeout) {
    return exec_file('git', args, {
        cwd: repo_root,
        windowsHide: true,
        timeout,
        maxBuffer: 1024 * 1024,
    });
}

function normalize_git_mirror_options(runtime_config = config) {
    const connect = runtime_config.connect && typeof runtime_config.connect === 'object'
        ? runtime_config.connect
        : {};
    const source = String(
        runtime_config.git_mirror_from
        || runtime_config.gitMirrorFrom
        || connect.git_mirror_from
        || connect.gitMirrorFrom
        || DEFAULT_GIT_MIRROR_FROM
    ).trim();
    const target = String(
        runtime_config.git_mirror_to
        || runtime_config.gitMirrorTo
        || connect.git_mirror_to
        || connect.gitMirrorTo
        || ''
    ).trim();

    if (!target) {
        return null;
    }

    return { source, target };
}

function build_git_pull_args(runtime_config = config) {
    const mirror = normalize_git_mirror_options(runtime_config);
    if (!mirror) {
        return { args: ['pull', '--ff-only'], mirror: null };
    }

    return {
        args: ['-c', `url.${mirror.target}.insteadOf=${mirror.source}`, 'pull', '--ff-only'],
        mirror,
    };
}

function create_ops_plugin(options = {}) {
    const runtime_config = options.config || config;
    const repo_root = options.repo_root || DEFAULT_REPO_ROOT;
    const schedule_exit = options.schedule_exit || setTimeout;
    const run_git_command = options.run_git || run_git;

    return function ops_plugin() {
        if (!is_ops_enabled(runtime_config)) {
            return;
        }
        if (loaded) {
            return;
        }
        loaded = true;

        const ops_command = on_command('ops', {
            permission: 'admin',
            rule: rules.position(['private', 'internal']),
            description: '运维指令',
        });

        ops_command.handle(async (session) => {
            const sub = String(session.args[0] || '').trim().toLowerCase();

            if (sub === 'restart') {
                await session.send('即将重启 Node 进程。');
                schedule_process_exit(schedule_exit, 0);
                await session.finish('如果进程没有自动回来，请检查 PM2/systemd/Docker restart policy。');
                return;
            }

            if (sub === 'update') {
                await handle_update(session, run_git_command, repo_root, schedule_exit, runtime_config);
                return;
            }

            await session.finish('用法: #ops <restart|update>');
        });
    };
}

async function handle_update(session, run_git_command, repo_root, schedule_exit, runtime_config) {
    let status = null;
    try {
        status = await run_git_command(['status', '--porcelain'], repo_root, 30000);
    } catch (err) {
        await session.finish(`检查工作区失败：${format_error(err)}`);
    }

    if (String(status.stdout || '').trim()) {
        await session.finish('工作区存在未提交改动，已拒绝 git pull。请先人工处理本地改动。');
    }

    const pull_options = build_git_pull_args(runtime_config);
    await session.send(
        pull_options.mirror
            ? '工作区干净，开始执行 git pull --ff-only（已启用镜像源）。'
            : '工作区干净，开始执行 git pull --ff-only。'
    );

    try {
        const pull = await run_git_command(pull_options.args, repo_root, 120000);
        await session.send(`git pull 成功：\n${compact_output(pull.stdout, pull.stderr)}`);
        schedule_process_exit(schedule_exit, 0);
        await session.finish('即将重启 Node 进程以加载更新。');
    } catch (err) {
        await session.finish(`git pull 失败，未重启：\n${format_error(err)}`);
    }
}

const default_plugin = create_ops_plugin();

module.exports = default_plugin;
module.exports.create_ops_plugin = create_ops_plugin;
module.exports.is_ops_enabled = is_ops_enabled;
module.exports.normalize_git_mirror_options = normalize_git_mirror_options;
module.exports.build_git_pull_args = build_git_pull_args;
module.exports._reset_for_tests = () => {
    loaded = false;
};
