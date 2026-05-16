# WebSocket 连接文档

## 简介

此项目使用 WebSocket 技术实现通信功能。具体为：此项目作为 WebSocket 服务器，客户端通过 WebSocket 协议与服务器进行通信。
一个客户端可以同时连接服务端的多个bot实例。

## WebSocket 连接流程

在configs/settings.yaml中配置好地址、端口，启动服务器后，客户端可以建立 WebSocket 连接。

- 若客户端发送登录消息（type为login_account或login_preset），服务端会进行bot登录，成功后会回复登录成功消息。
- 服务端bot登录成功后掉线，会自动进行重新登录尝试（可在configs/accounts.yaml中配置），重连尝试失败达到最大次数，服务端会发送错误消息通知客户端。
- 服务端bot登录成功后客户端掉线，服务端会继续保持bot在线，等待客户端重新连接。

## api 参考

发送消息时，消息格式为 JSON，包含以下字段：

```json
{
    "type": "", // 消息类型，表示消息的具体含义，如登录、聊天等
    "timestamp": "", // 消息发送时间戳，单位为毫秒
    "need_reply": true, // 是否需要回复，true表示需要回复，false表示不需要回复
    "msg_id": "", // 消息ID，need_reply为true时必填，表示发送消息ID，回复时会带上这个ID
    "data": {
        // 具体数据内容，根据 type 不同而不同
    },
    "extra": {
        // 可选字段，包含一些额外信息
    }
}
```

msg_id 约定格式为 "msg_" + 当前时间戳（毫秒）+ "_" + 4位随机字符串，例如 "msg_1690000000000_abcd"。

### 客户端->服务端

以下为 type 字段 与 data 字段相对应的具体内容：

#### login_account（client）

表示登录消息，need_reply必须为true，data 字段包含以下内容：

```json
{
    "username": "", // 用户名
    "account": "", // 账号
    "password": "", // 密码（对的，明文传递，有需求的话可以自行修改代码对密码进行加密）
    "login_type": "", // 登录类型，取值为 "mojang" 或 "microsoft" 或 "third"
    "skin_server": "https://xxx/api/yggdrasil", // third登录时必填，表示 Yggdrasil 认证服务器地址
    "skin_auth_server": "", //视第三方皮肤站的具体情况，可能需要提供认证服务器地址
    "skin_session_server": ""
}
```

#### login_preset（client）

表示预设登录消息，need_reply必须为true，data 字段包含以下内容：

```json
{
    "account": 1 , // 预设账号ID（number），服务器会根据这个ID查找对应的账号信息进行登录
    "server": 1 // 预设服务器ID（number），服务器会根据这个ID查找对应的服务器信息进行登录
}
```

#### logout

表示登出消息，need_reply必须为true，data字段可以为空。

```json
{}
```

#### msg（client）

表示普通消息，need_reply必须为false，data 字段内容根据实际需求定义。

```json
{
    "time": "", // 消息构造时的时间，单位为毫秒
    "type": "chat",//消息类型，为"chat"时表示聊天消息，服务器会将消息内容发送至服务器公屏聊天；为whisper时表示私聊消息，服务器会将消息内容发送至指定玩家的私聊窗口
    "prefix": "", // 消息前缀，若为chat类型，bot收到后会在发送至服务器公屏聊天前加上这个前缀，无此项则默认为："[group]:"（为whisper类型时需为null）
    "target_player": "", // 消息目标，若为whisper类型，bot收到后会将消息内容发送至这个玩家的私聊窗口（为chat类型时需为null）
    "content": "" // 消息内容
}
```

#### command（client）

表示命令消息，发送至服务器后，服务器会检查命令内容是否存在于bot的命令列表中，若存在则执行这个命令，命令会以system权限执行。
need_reply必须为true，data字段包含以下内容：

```json
{
    "command": "", // 命令内容，若js内存在此命令，bot收到后会执行这个命令
    "args": [] // 命令参数，为数组
}
```

#### event（client）

表示事件消息，need_reply必须为true，data字段包含以下内容：

```json
{
    "event_type": "", // 事件类型
    "event_data": {
        // 事件相关数据，根据 event_type 不同而不同
    }
}
```

#### ping（client）

表示ping消息，need_reply必须为true，data字段可以为空。

```json
{}
```

#### player（client）

表示玩家相关消息，need_reply必须为true，data字段可以为空。

```json
{}
```

#### bot_info（client）

表示机器人信息请求，need_reply必须为true，data字段可以为空。

```json
{}
```

#### reply（client）

表示回复消息，need_reply必须为false，data字段包含以下内容：

```json
{
    "msg_id": "", // 回复的消息ID，必须与服务端发送的消息中的 msg_id 相同
    "status": "success", // 回复状态，取值为 "success" 或 "error"
    "result": {
        // 回复结果内容，根据实际需求定义
    },
}
```

#### error（client）

表示错误消息，need_reply必须为false，data字段包含以下内容：

```json
{
    "error_type": "", // 错误代码
    "error_message": "" // 错误信息
}
```

### 服务端->客户端

以下为 type 字段 与 data 字段等相对应的具体内容：

#### reply（server）

表示回复消息，need_reply必须为false，data字段包含以下内容：

```json
{
    "msg_id": "", // 回复的消息ID，必须与客户端发送的消息中的 msg_id 相同
    "status": "success", // 回复状态，取值为 "success" 或 "error"
    "result": {
        // 失败时包含错误信息，成功时此字段可为null
    },
}
```

#### msg（server）

表示消息推送，need_reply必须为false，data字段包含以下内容：

```json
{
    "time": "", // 消息构造时的时间，单位为毫秒
    "player": [
        {
            "username": "", // 玩家用户名（1）
            "display_name": "" // 玩家显示名称
        },
        {
            "username": "", // 玩家用户名（2）
            "display_name": "" // 玩家显示名称
        }
    ], // 消息有关的玩家名称，为数组（因为可能消息内不止一个玩家）
    "entity": {
        "name": "", // 实体名称，如玩家的用户名、怪物的种类等
        "id": "" // 实体的ID，用于translate
    }, // 消息相关的实体（若消息中包含实体则放于此，可为空）
    "item": {
        "name": "", // 物品名称，如minecraft:stone
        "id": "", // 物品ID，用于translate
        "enhancements": [
            {
                "name": "", // 强化名称，如minecraft:sharpness
                "level": 1 // 强化等级
            }
        ] // 物品的强化信息，为数组，（可为null）
    } // 消息相关的物品（若消息中包含物品则放于此）
}
```

extra字段包含以下内容：

```json
{
    "translate": [
        {
            "key": "", // 翻译键，如 "chat.type.text""
        },
        {
            "key": "", // 翻译键，如 "chat.type.text""
        }
    ],//可为null
    "text": "" // 消息文本（可能会在无translate时使用）（可为null）
}
```

#### command（server）

表示命令消息，need_reply必须为true，data字段包含以下内容：

```json
{
    "command": "", // 命令内容，若客户端内存在此命令，客户端收到后会执行这个命令
    "args": [] // 命令参数，为数组
}
```

#### player（server）

表示玩家相关消息，need_reply必须为false，data字段包含以下内容：

```json
{
    "player": [
        {
            "username": "", // 玩家用户名
            "nickname": {}, // 玩家显示名称
            "uuid": "", // 玩家UUID
            "skin_url": "" // 玩家皮肤URL
        },
        {
            "username": "", // 玩家用户名
            "nickname": {}, // 玩家显示名称
            "uuid": "", // 玩家UUID
            "skin_url": "" // 玩家皮肤URL
        }//... 可能有多个在线的玩家
    ],
    "player_count": 0, // 当前在线玩家数量
    "bot_username": "", // 机器人用户名，用于客户端区分
}
```

#### event（server）

表示事件消息，need_reply必须为false，data字段包含以下内容：

```json
{
    "event_type": "", // 事件类型
    "event_data": {
        // 事件相关数据，根据 event_type 不同而不同
    }
}
```

#### error（server）

表示错误消息，need_reply必须为false，data字段包含以下内容：

```json
{
    "error_type": "", // 错误代码
    "error_message": "" // 错误信息
}
```
