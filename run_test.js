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

const bot = new MockBot();
message_handler(bot);

bot.on('msg_obj', (obj) => {
    // console.log(obj);
});

const testDir = path.join(__dirname, 'test');
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.json'));

for (const file of files) {
    try {
        const filePath = path.join(testDir, file);
        const data = fs.readFileSync(filePath, 'utf8');
        let jsonMsg;
        try {
            jsonMsg = JSON.parse(data);
        } catch(e) {
            continue; // Not a valid json array/object or maybe players list.
        }
        
        // Some might be array of messages, some single message
        if (Array.isArray(jsonMsg)) {
            // It might be a players.json
        } else {
            console.log(`Testing ${file}...`);
            bot.emit('message', jsonMsg);
            console.log(`Success ${file}`);
        }
    } catch (err) {
        console.error(`Error processing ${file}:`, err);
    }
}
