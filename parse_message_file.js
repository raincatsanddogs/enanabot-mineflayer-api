const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const message_handler = require('./src/handler/message/message_handler');

class MockBot extends EventEmitter {
    constructor() {
        super();
        this.players = {};
    }
}

function print_usage() {
    console.error('用法: node parse_message_file.js <json文件路径>');
}

const input_path = process.argv[2];
if (!input_path) {
    print_usage();
    process.exit(1);
}

const resolved_path = path.isAbsolute(input_path)
    ? input_path
    : path.resolve(process.cwd(), input_path);

if (!fs.existsSync(resolved_path)) {
    console.error(`文件不存在: ${resolved_path}`);
    process.exit(1);
}

let raw_text = '';
try {
    raw_text = fs.readFileSync(resolved_path, 'utf8');
} catch (err) {
    console.error(`读取文件失败: ${err.message}`);
    process.exit(1);
}

let parsed = null;
try {
    parsed = JSON.parse(raw_text);
} catch (err) {
    console.error(`JSON 解析失败: ${err.message}`);
    process.exit(1);
}

const bot = new MockBot();
message_handler(bot);

bot.on('msg_obj', (obj) => {
    console.log(JSON.stringify(obj, null, 2));
});

function emit_message(candidate, index) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        console.error(`第 ${index + 1} 条不是消息对象，已跳过`);
        return;
    }
    bot.emit('message', candidate);
}

if (Array.isArray(parsed)) {
    parsed.forEach((item, idx) => emit_message(item, idx));
} else {
    emit_message(parsed, 0);
}
