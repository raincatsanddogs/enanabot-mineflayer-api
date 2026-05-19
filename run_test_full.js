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

const results = [];
bot.on('msg_obj', (obj) => {
    results.push(obj);
});

const testDir = path.join(__dirname, 'test');
const files = fs.readdirSync(testDir).filter(f =>
    f.endsWith('.json') &&
    !f.startsWith('players') &&
    !f.startsWith('.players')
);

let pass = 0;
let fail = 0;

for (const file of files) {
    try {
        const data = fs.readFileSync(path.join(testDir, file), 'utf8');
        let jsonMsg;
        try { jsonMsg = JSON.parse(data); } catch(e) { continue; }
        if (Array.isArray(jsonMsg)) continue;

        results.length = 0;
        bot.emit('message', jsonMsg);
        const obj = results[0];

        if (!obj) {
            console.log(`FAIL ${file}: no output`);
            fail++;
            continue;
        }

        // Print compact summary
        const summary = {
            position: obj.position,
            message: obj.message ? obj.message.substring(0, 60) : '',
            player: Array.isArray(obj.player)
                ? obj.player.map(p => p && p.username).filter(Boolean).join(',')
                : (obj.player ? obj.player.username : ''),
            data: obj.data || {},
        };
        console.log(`OK   ${file.padEnd(42)} pos=${summary.position.padEnd(18)} player=${summary.player.padEnd(15)} msg=${summary.message}`);
        if (summary.data && Object.keys(summary.data).length > 0) {
            const d = summary.data;
            if (d.translate) console.log(`     -> translate: ${d.translate}`);
            if (d.items) console.log(`     -> items: ${JSON.stringify(d.items.map(i => ({id:i.id, name:i.display_name})))}`);
            if (d.entities) console.log(`     -> entities: ${JSON.stringify(d.entities.map(e => ({id:e.id, name: typeof e.name === 'object' ? e.name.translate : e.name})))}`);
            if (d.tpa_info) console.log(`     -> tpa_info: ${JSON.stringify(d.tpa_info)}`);
        }
        pass++;
    } catch (err) {
        console.log(`FAIL ${file}: ${err.message}`);
        fail++;
    }
}
console.log(`\n=== ${pass} passed, ${fail} failed, ${pass+fail} total ===`);
