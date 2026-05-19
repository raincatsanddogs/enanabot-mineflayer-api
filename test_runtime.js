const fs = require('fs');
const message_handler = require('./src/handler/message/message_handler');
const { extract_plain_text } = require('./src/handler/message/utils');

const EventEmitter = require('events');
class MockBot extends EventEmitter {
    constructor() {
        super();
        this.players = {};
    }
}

const bot = new MockBot();
message_handler(bot);

bot.on('msg_obj', (obj) => {
    console.log("Parsed msg_obj:", JSON.stringify(obj, null, 2));
});

console.log("=== Testing hoverEvent ===");
const testMsg1 = {
    translate: 'chat.type.text',
    with: [
        {
            hoverEvent: {
                action: 'show_entity',
                contents: { name: 'Player123' }
            },
            text: ''
        },
        'Hello world'
    ]
};
bot.emit('message', testMsg1);

console.log("=== Testing extract_plain_text pollution ===");
const testMsg2 = {
    translate: 'some.plugin.message',
    text: '',
    extra: [
        { text: 'Hello ' },
        { translate: 'translation.key' }
    ]
};
console.log("Extracted text:", extract_plain_text(testMsg2));

