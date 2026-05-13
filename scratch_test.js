/**
 * 静态数据验证脚本 (v2)：使用 .players.json 的完整格式化数据
 */
const Module = require('module');
const original_resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
    if (request === 'mineflayer') return '__mineflayer_mock__';
    return original_resolve.call(this, request, parent, isMain, options);
};
require.cache['__mineflayer_mock__'] = {
    id: '__mineflayer_mock__', filename: '__mineflayer_mock__', loaded: true,
    exports: { Bot: class {} }
};

const handler_module = require('./src/handler/message/message_handler.js');
Module._resolveFilename = original_resolve;

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// 使用 .players.json（包含完整格式化 displayName）
const mock_players = JSON.parse(fs.readFileSync(path.join(__dirname, 'test', '.players.json'), 'utf-8'));
const mock_bot = new EventEmitter();
mock_bot.players = mock_players;
handler_module(mock_bot);

let last_result = null;
mock_bot.on('msg_obj', (result) => { last_result = result; });

let pass_count = 0;
let fail_count = 0;

function test_file(filename, desc, checks) {
    const json_data = JSON.parse(fs.readFileSync(path.join(__dirname, 'test', filename), 'utf-8'));
    last_result = null;
    mock_bot.emit('message', json_data);
    console.log(`\n===== ${filename} =====`);
    console.log(`期望: ${desc}`);
    if (!last_result) { console.log('  ❌ 结果为 null'); fail_count++; return; }
    console.log(`  player: "${last_result.player.username}" | pos: "${last_result.position}" | msg: "${last_result.message}"`);
    if (!checks) { pass_count++; return; }
    let ok = true;
    for (const [k, v] of Object.entries(checks)) {
        const actual = k === 'username' ? last_result.player.username : last_result[k];
        if (actual !== v) { console.log(`  ❌ ${k}: 期望 "${v}" 得到 "${actual}"`); ok = false; }
    }
    if (ok) { console.log('  ✅ 通过'); pass_count++; } else { fail_count++; }
}

// 公屏聊天
test_file('chat.json', 'gugubird 公屏 "1"', { username: 'gugubird', position: 'public', message: '1' });
test_file('chat2.json', 'mengxincmm(橙猫猫-天安0好) 公屏 "2"', { username: 'mengxincmm', position: 'public', message: '2' });
test_file('chat3.json', 'agugubird(竟敢误食灯) 公屏 "1"', { username: 'agugubird', position: 'public', message: '1' });

// 原版
test_file('ori_chat.json', '原版 gugubird "aaaa"', { username: 'gugubird', position: 'public', message: 'aaaa' });

// 私聊
test_file('whisper_to_me.json', 'gugubird -> 我', { username: 'gugubird', position: 'private' });
test_file('whisper_to_player.json', '我 -> gugubird', { username: 'gugubird', position: 'private_outgoing' });
test_file('ori_whisper_to_me.json', '原版 gugubird -> 我', { username: 'gugubird', position: 'private', message: '1' });
test_file('ori_whisper_to_player.json', '原版 我 -> gugubird', { username: 'gugubird', position: 'private', message: '1' });

// 错误
test_file('whisper_error.json', '找不到玩家', { position: 'system' });
test_file('ori_whisper_error.json', '原版找不到玩家', { position: 'system' });

// TPA
test_file('tpa_to_me.json', 'TPA agugubird -> 我', { username: 'agugubird', position: 'tpa' });
test_file('tpa_to_player.json', 'TPA 我 -> doveoverthere', { username: 'doveoverthere', position: 'tpa' });
test_file('tpahere_to_me.json', 'TPAHere agugubird -> 我', { username: 'agugubird', position: 'tpa' });
test_file('tpahere_to_player.json', 'TPAHere 我 -> doveoverthere', { username: 'doveoverthere', position: 'tpa' });

// 系统
test_file('sethome.json', 'sethome', { position: 'system' });
test_file('remhome.json', 'remhome', { position: 'system' });
test_file('进度超越生死.json', '成就 mengxincmm', { username: 'mengxincmm' });

console.log(`\n===== 结果: ${pass_count} 通过, ${fail_count} 失败 =====`);
process.exit(fail_count > 0 ? 1 : 0);
