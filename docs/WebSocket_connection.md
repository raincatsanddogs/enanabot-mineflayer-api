# WebSocket 连接文档

## 简介

本项目计划使用 WebSocket 作为外部通信方式。项目本身作为 WebSocket 服务端，客户端连接后通过 JSON 消息控制 Mineflayer bot。

本文档定义新的 WebSocket 协议，不兼容旧 IPC 协议。旧 IPC 的 action 名称、字段名和 stdin/stdout 传输方式不再作为兼容目标。

一个客户端连接可以同时管理多个 bot 实例。服务端启动后只启动 WebSocket 服务，不应立即创建 bot；bot 应在收到 `login_account` 或 `login_preset` 请求后创建。

## 连接流程

1. 在 `configs/settings.yaml` 中配置 WebSocket 地址、端口和 token。
2. 启动项目后，服务端监听 WebSocket 连接。
3. 客户端建立连接后，第一条消息必须发送 `auth`。
4. 认证成功后，客户端可以发送 `login_account` 或 `login_preset` 创建 bot。
5. 服务端登录成功后回复 `bot_id`，后续 bot 相关请求都必须携带该 `bot_id`。
6. 客户端断开连接后，已登录 bot 默认继续在线。
7. 客户端重连后，可通过 `bot_list` 或 `bot_info` 查询已有 bot。
8. bot 掉线后，服务端按配置尝试重连，并通过 `event` 或 `error` 通知客户端。

建议配置：

```yaml
connect:
  host: "localhost"
  port: 3001
  token: "change-me"
  timeout: 10
  retry: 3
```

## 通用消息格式

所有 WebSocket 消息均为 JSON。

```json
{
  "type": "message",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_abcd",
  "bot_id": "bot_1",
  "data": {},
  "extra": {}
}
```

字段说明：

- `type`：消息类型。
- `timestamp`：消息发送时间，单位为毫秒。
- `need_reply`：是否需要请求级回复。
- `msg_id`：消息 ID。`need_reply=true` 时必填。
- `bot_id`：bot 实例 ID。创建 bot 的登录请求不需要携带；其他 bot 相关消息必须携带。
- `data`：消息主体。
- `extra`：可选扩展字段。

`msg_id` 约定格式：

```txt
msg_<timestamp_ms>_<4位随机字符串>
```

示例：

```txt
msg_1690000000000_abcd
```

## 请求与回复规则

### reply

`reply` 用于回复某一条 `need_reply=true` 的请求。

```json
{
  "type": "reply",
  "timestamp": 1690000000100,
  "need_reply": false,
  "bot_id": "bot_1",
  "data": {
    "msg_id": "msg_1690000000000_abcd",
    "status": "success",
    "result": null
  }
}
```

规则：

- `data.msg_id` 必须等于被回复请求的 `msg_id`。
- `data.status` 取值为 `success` 或 `error`。
- `data.result` 成功时可以为 `null`，也可以包含结果数据。
- 同一个 `msg_id` 可以收到多条 `reply`。这用于命令产生多段输出的情况。
- 单个请求失败时，应使用 `reply.status="error"`，而不是单独推送 `error`。

错误回复示例：

```json
{
  "type": "reply",
  "timestamp": 1690000000100,
  "need_reply": false,
  "bot_id": "bot_1",
  "data": {
    "msg_id": "msg_1690000000000_abcd",
    "status": "error",
    "result": {
      "error_type": "command_not_found",
      "error_message": "未知命令: unknown"
    }
  }
}
```

### error

`error` 用于状态错误、运行错误或协议错误等非单请求错误推送。

```json
{
  "type": "error",
  "timestamp": 1690000000000,
  "need_reply": false,
  "bot_id": "bot_1",
  "data": {
    "error_type": "bot_disconnected",
    "error_message": "Bot disconnected: timeout"
  }
}
```

建议错误码：

- `auth_required`：未认证。
- `auth_failed`：认证失败。
- `invalid_message`：消息格式非法。
- `missing_field`：缺少必要字段。
- `bot_not_found`：找不到指定 bot。
- `bot_offline`：指定 bot 存在但当前不在线，无法执行需要在线状态的操作。
- `bot_already_online`：bot 已在线。
- `login_failed`：登录失败。
- `command_not_found`：命令不存在。
- `command_failed`：命令执行失败。
- `send_failed`：消息发送失败。
- `internal_error`：服务端内部错误。

## 客户端到服务端

### auth

连接认证。客户端建立连接后第一条消息必须为 `auth`。

```json
{
  "type": "auth",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_auth",
  "data": {
    "token": "change-me"
  }
}
```

认证成功回复：

```json
{
  "type": "reply",
  "timestamp": 1690000000100,
  "need_reply": false,
  "data": {
    "msg_id": "msg_1690000000000_auth",
    "status": "success",
    "result": {
      "authenticated": true
    }
  }
}
```

认证失败时，服务端回复 `reply.status="error"` 后关闭连接。

### login_account

使用请求内账号、服务器和重连配置创建 bot。

`need_reply` 必须为 `true`。创建 bot 时不传 `bot_id`。

```json
{
  "type": "login_account",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_login",
  "data": {
    "username": "profile_name",
    "account": "email@example.com",
    "password": "password",
    "login_type": "microsoft",
    "server": {
      "host": "example.com",
      "port": 25565,
      "version": "1.20.1"
    },
    "skin_server": "",
    "skin_auth_server": "",
    "skin_session_server": "",
    "reconnect": {
      "enabled": true,
      "interval": 5,
      "max_attempts": 5
    }
  }
}
```

字段说明：

- `username`：bot 档案名或显示名。
- `account`：登录账号。
- `password`：密码。
- `login_type`：登录类型，取值为 `mojang`、`microsoft` 或 `third`。
- `server.host`：Minecraft 服务器地址。
- `server.port`：Minecraft 服务器端口。
- `server.version`：Minecraft 协议版本。
- `skin_server`：第三方 Yggdrasil 服务器地址。`login_type="third"` 时必填。
- `skin_auth_server`：第三方认证服务器地址，可选。
- `skin_session_server`：第三方 session 服务器地址，可选。
- `reconnect.enabled`：是否启用掉线重连。
- `reconnect.interval`：重连间隔，单位为秒。
- `reconnect.max_attempts`：最大重连次数。`0` 表示无限重连。

登录成功回复：

```json
{
  "type": "reply",
  "timestamp": 1690000001000,
  "need_reply": false,
  "data": {
    "msg_id": "msg_1690000000000_login",
    "status": "success",
    "result": {
      "bot_id": "bot_1",
      "username": "BotName",
      "state": "online"
    }
  }
}
```

### login_preset

使用配置文件中的预设账号和服务器创建 bot。

`need_reply` 必须为 `true`。创建 bot 时不传 `bot_id`。

```json
{
  "type": "login_preset",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_login",
  "data": {
    "account": 1,
    "server": 1
  }
}
```

字段说明：

- `account`：预设账号 ID，从 `1` 开始。
- `server`：预设服务器 ID，从 `1` 开始。

回复格式同 `login_account`。

### logout

退出指定 bot。

```json
{
  "type": "logout",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_logout",
  "bot_id": "bot_1",
  "data": {}
}
```

成功回复：

```json
{
  "type": "reply",
  "timestamp": 1690000000100,
  "need_reply": false,
  "bot_id": "bot_1",
  "data": {
    "msg_id": "msg_1690000000000_logout",
    "status": "success",
    "result": {
      "state": "stopped"
    }
  }
}
```

### message

要求 bot 向 Minecraft 服务器发送消息。

客户端发送消息类型命名为 `message`，服务端向客户端推送 Minecraft 消息仍使用 `msg`。

```json
{
  "type": "message",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_message",
  "bot_id": "bot_1",
  "data": {
    "type": "chat",
    "prefix": "[group]:",
    "target_player": null,
    "content": "hello"
  }
}
```

字段说明：

- `data.type`：`chat` 或 `whisper`。
- `data.prefix`：公屏消息前缀。`chat` 时可选；`whisper` 时应为 `null`。
- `data.target_player`：私聊目标玩家。`whisper` 时必填；`chat` 时应为 `null`。
- `data.content`：消息内容。

规则：

- `chat` 会发送到 Minecraft 公屏。
- `whisper` 会发送到指定玩家的私聊。
- 客户端来源、群号、发送者、平台等信息由客户端自行处理；服务端只负责把最终内容发送给 Minecraft。

### command

要求 bot 执行服务端内部命令。

```json
{
  "type": "command",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_command",
  "bot_id": "bot_1",
  "data": {
    "command": "ping",
    "args": [],
    "wait": true
  }
}
```

字段说明：

- `data.command`：命令名，不包含指令前缀。
- `data.args`：命令参数数组。
- `data.wait`：是否等待命令执行完成。

规则：

- 权限、回复目标和发送方式由客户端或服务端各自处理，不在协议固定字段中定义。
- 如确有扩展需求，可通过 `args` 或 `extra` 承载。
- `wait=true` 时，服务端应等待命令执行完成后再回复结果。
- `wait=false` 时，服务端可先回复已接收；命令后续输出可继续用同一 `msg_id` 发送多条 `reply`。
- 命令不存在时，使用 `reply.status="error"` 返回 `command_not_found`。

命令成功回复示例：

```json
{
  "type": "reply",
  "timestamp": 1690000000100,
  "need_reply": false,
  "bot_id": "bot_1",
  "data": {
    "msg_id": "msg_1690000000000_command",
    "status": "success",
    "result": {
      "command": "ping",
      "reply": "pong"
    }
  }
}
```

多段输出可以发送多条同 `msg_id` 的 `reply`：

```json
{
  "type": "reply",
  "timestamp": 1690000000200,
  "need_reply": false,
  "bot_id": "bot_1",
  "data": {
    "msg_id": "msg_1690000000000_command",
    "status": "success",
    "result": {
      "command": "list",
      "reply": "第 1 行输出"
    }
  }
}
```

### event

客户端向服务端上报事件。

```json
{
  "type": "event",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_event",
  "bot_id": "bot_1",
  "data": {
    "event_type": "client.ready",
    "event_data": {}
  }
}
```

客户端事件类型：

- `client.ready`：客户端初始化完成。
- `client.notice`：客户端普通通知。
- `client.state`：客户端状态变化。

服务端收到未知 `event_type` 时，应返回 `reply.status="error"` 和 `invalid_message`。

### ping

连接或 bot 存活检查。

```json
{
  "type": "ping",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_ping",
  "bot_id": "bot_1",
  "data": {}
}
```

`bot_id` 可选：

- 不带 `bot_id` 时，只检查 WebSocket 连接。
- 带 `bot_id` 时，同时检查指定 bot 是否存在和在线。

### player

请求指定 bot 的在线玩家列表。

该消息为客户端主动请求，服务端只被动回复；服务端不主动推送玩家列表，不定义增量更新。

```json
{
  "type": "player",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_player",
  "bot_id": "bot_1",
  "data": {}
}
```

### bot_info

查询指定 bot 状态。

```json
{
  "type": "bot_info",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_bot_info",
  "bot_id": "bot_1",
  "data": {}
}
```

成功回复：

```json
{
  "type": "reply",
  "timestamp": 1690000000100,
  "need_reply": false,
  "bot_id": "bot_1",
  "data": {
    "msg_id": "msg_1690000000000_bot_info",
    "status": "success",
    "result": {
      "bot_id": "bot_1",
      "username": "BotName",
      "state": "online",
      "server": {
        "host": "example.com",
        "port": 25565,
        "version": "1.20.1"
      }
    }
  }
}
```

### bot_list

查询当前服务端已创建的 bot 列表。

```json
{
  "type": "bot_list",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_bot_list",
  "data": {}
}
```

成功回复：

```json
{
  "type": "reply",
  "timestamp": 1690000000100,
  "need_reply": false,
  "data": {
    "msg_id": "msg_1690000000000_bot_list",
    "status": "success",
    "result": {
      "bots": [
        {
          "bot_id": "bot_1",
          "username": "BotName",
          "state": "online"
        }
      ]
    }
  }
}
```

### reply

客户端对服务端请求的回复。

```json
{
  "type": "reply",
  "timestamp": 1690000000000,
  "need_reply": false,
  "data": {
    "msg_id": "msg_from_server",
    "status": "success",
    "result": {}
  }
}
```

### error

客户端向服务端推送非请求级错误。

```json
{
  "type": "error",
  "timestamp": 1690000000000,
  "need_reply": false,
  "data": {
    "error_type": "client_error",
    "error_message": "客户端运行错误"
  }
}
```

## 服务端到客户端

### reply

服务端对客户端请求的回复。格式见“请求与回复规则”。

### msg

Minecraft 消息推送。

```json
{
  "type": "msg",
  "timestamp": 1690000000000,
  "need_reply": false,
  "bot_id": "bot_1",
  "data": {
    "time": 1690000000000,
    "type": "chat",
    "position": "public",
    "text": "hello",
    "player": [
      {
        "username": "Steve",
        "display_name": {},
        "uuid": ""
      }
    ],
    "entity": null,
    "item": null
  },
  "extra": {
    "translate": [],
    "raw": null
  }
}
```

字段说明：

- `data.time`：Minecraft 消息构造时间，单位为毫秒。
- `data.type`：消息类型，如 `chat`、`whisper`、`server_cmd`、`system`、`tpa`。
- `data.position`：消息位置，如 `public`、`private`、`private_outgoing`、`system`、`tpa`。
- `data.text`：解析后的文本。
- `data.player`：消息相关玩家数组。
- `data.entity`：消息相关实体，可为 `null`。
- `data.item`：消息相关物品，可为 `null`。
- `extra.translate`：翻译键数组。
- `extra.raw`：原始消息对象，可为 `null`。

### command

服务端要求客户端执行命令。

```json
{
  "type": "command",
  "timestamp": 1690000000000,
  "need_reply": true,
  "msg_id": "msg_1690000000000_command",
  "data": {
    "command": "client_command",
    "args": []
  }
}
```

客户端执行后应发送 `reply`。

### player

`player` 请求的回复结果通常通过 `reply` 返回。

```json
{
  "type": "reply",
  "timestamp": 1690000000100,
  "need_reply": false,
  "bot_id": "bot_1",
  "data": {
    "msg_id": "msg_1690000000000_player",
    "status": "success",
    "result": {
      "player": [
        {
          "username": "Steve",
          "nickname": {},
          "uuid": "",
          "skin_url": ""
        }
      ],
      "player_count": 1,
      "bot_username": "BotName"
    }
  }
}
```

### event

服务端事件推送。

```json
{
  "type": "event",
  "timestamp": 1690000000000,
  "need_reply": false,
  "bot_id": "bot_1",
  "data": {
    "event_type": "bot.status",
    "event_data": {
      "state": "online",
      "username": "BotName",
      "reason": ""
    }
  }
}
```

服务端事件类型：

- `bot.status`：bot 生命周期状态变化。
- `bot.reconnect`：bot 掉线重连状态。
- `tpa.request_detected`：检测到 TPA 请求。
- `tpa.notification`：TPA 相关通知。
- `system.notice`：服务端普通通知。

#### bot.status

```json
{
  "event_type": "bot.status",
  "event_data": {
    "state": "online",
    "username": "BotName",
    "reason": ""
  }
}
```

`state` 取值：

- `logging_in`
- `online`
- `reconnecting`
- `offline`
- `stopped`
- `failed`

#### bot.reconnect

```json
{
  "event_type": "bot.reconnect",
  "event_data": {
    "state": "retrying",
    "attempt": 1,
    "max_attempts": 5,
    "reason": "disconnect"
  }
}
```

`state` 取值：

- `retrying`
- `success`
- `failed`
- `disabled`

#### tpa.request_detected

```json
{
  "event_type": "tpa.request_detected",
  "event_data": {
    "requester": "Steve",
    "type": "tpa",
    "auto_accepted": false
  }
}
```

#### tpa.notification

```json
{
  "event_type": "tpa.notification",
  "event_data": {
    "message": "TPA 自动接受: Steve (tpa)"
  }
}
```

#### system.notice

```json
{
  "event_type": "system.notice",
  "event_data": {
    "message": "服务端通知"
  }
}
```

### error

服务端向客户端推送非请求级错误。格式见“请求与回复规则”。

## type 汇总

客户端到服务端：

- `auth`
- `login_account`
- `login_preset`
- `logout`
- `message`
- `command`
- `event`
- `ping`
- `player`
- `bot_info`
- `bot_list`
- `reply`
- `error`

服务端到客户端：

- `reply`
- `msg`
- `command`
- `event`
- `error`

`player` 请求的结果通过 `reply` 返回，不作为服务端主动推送类型。

## 实现约束

- 认证成功前，客户端只能发送 `auth` 和不带 `bot_id` 的 `ping`。
- 除登录、认证、`bot_list` 和连接级 `ping` 外，bot 相关消息必须携带 `bot_id`。
- 服务端收到未知 `type` 应返回 `reply.status="error"` 或推送 `error.invalid_message`。
- 服务端收到未知 `event_type` 应返回 `reply.status="error"`。
- 服务端收到未知 `bot_id` 应返回 `bot_not_found`。
- 客户端断开不代表 bot 下线。
- 客户端应自行处理外部平台来源、权限、转发目标、增量玩家列表等客户端侧逻辑。
