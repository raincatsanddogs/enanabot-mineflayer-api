const mineflayer = require('mineflayer') // eslint-disable-line

/**
 * @param {mineflayer.Bot} bot // to enable intellisense
 */

let raw_msg = null;

class chat_msg {
    constructor(player, message, position, time) {
        this.player = player;
        this.message = message;
        this.position = position;
        this.time = time;
    }
}

/**
 * 玩家信息类，包含玩家的username、uuid和nickname（若有）
 * 其中username为玩家的原版用户名，uuid为玩家的唯一标识符，nickname为玩家的昵称（若有）
 * nickname为一个对象，格式遵循minecraft消息中的extra，包含text、color、bold、italic、underlined、strikethrough、obfuscated等属性
 * 例如：{"text":"玩家昵称","color":"red","bold":true}
 */
class player_info {
    constructor(username, uuid, nickname) {
        this.username = username;
        this.uuid = uuid;
        this.nickname = nickname;
    }
}

let player_info = []; //存储玩家信息的数组，元素为player_info对象

/**传入message事件的jsonMsg，返回一个player_info.username
 */
function player_info_handler(jsonMsg) {//具体处理方式为：1.若有原版翻译键则为原版消息，直接从hoverEvent中提取玩家信息；2.若无原版翻译键则为插件消息，尝试从extra中提取玩家信息，使用bot.player获取player信息并进行比对，若失败则返回空字符串
    let player_info = new player_info('', [], {});
    //...
    return player_info;
}

function chat_msg_handler(jsonMsg) {//处理方式：提取消息内容（为聊天、击杀、玩家加入退出、私聊类型）（若有翻译键直接使用翻译键，获得成就需特殊处理，消息需传翻译键的数组）为纯文本，提取消息位置（公屏/私聊），提取玩家信息（调用player_info_handler函数），将玩家信息、消息内容和消息位置封装成一个chat_msg对象并返回
    let chat_msg = new chat_msg('', '', '', Date.now());
    //...
    return chat_msg;
}

function system_msg_handler(jsonMsg) {//处理方式：处理与玩家无关的消息（tp消息除外，算作系统信息）提取消息内容为纯文本，（tp消息应有player信息）若有将消息内容和消息位置封装成一个chat_msg对象并返回
    let system_msg = new chat_msg('', '', '', Date.now());
    //...
    return system_msg;
}

function msg_handler(jsonMsg) {//处理方式：判断消息类型（聊天、击杀、玩家加入退出、私聊、系统信息），调用相应的处理函数进行处理并返回处理结果
    let msg = null;
    //...
    return msg;
}

function player_info_update_handler(player) {//处理方式：提取玩家的username、uuid和nickname（若有）封装成一个player_info对象并更新player_info数组
    let player_info = new player_info(player.username, player.uuid, player.nickname);
    //...
    return player_info;
}

module.exports = bot => {
    bot.on('message', (jsonMsg) => {
        raw_msg = jsonMsg;
        bot.emit('msg_obj', msg_handler(jsonMsg));
    });
    bot.on('playerUpdated', (player) => {//玩家信息更新时，更新player_info

    });
}