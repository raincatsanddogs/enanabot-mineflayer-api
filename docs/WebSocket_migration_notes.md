# WebSocket 协议变更与后续实现说明

## 本次文档变更

`docs/WebSocket_connection.md` 已按新的 WebSocket 协议方向重写。新文档不再把 WebSocket 作为旧 IPC 的字段兼容层，而是定义为新的外部控制协议。

主要变更：

- 明确项目启动后先启动 WebSocket 服务，不再启动即创建 bot。
- 明确 bot 由 `login_account` 或 `login_preset` 请求创建。
- 增加 `bot_id`，用于一个连接管理多个 bot 实例。
- 增加 `auth` 和 token 校验流程。
- 统一 `timestamp` 为毫秒时间戳。
- 将客户端发送 Minecraft 消息的类型从 `msg` 改为 `message`。
- 保留服务端 Minecraft 消息推送类型 `msg`。
- 增加 `bot_list`，用于客户端重连后查询已有 bot。
- `player` 明确为客户端主动请求、服务端通过 `reply` 被动返回。
- `command` 增加 `wait` 字段。
- `command` 不固定定义 `permission` 和 `reply_to`，这些由客户端或服务端各自处理。
- 同一 `msg_id` 允许多条 `reply`，用于命令多段输出。
- `event` 增加明确事件枚举，TPA 相关内容通过 `event` 表达。
- `error` 明确为非请求级状态错误、运行错误或协议错误推送。

## 旧 IPC 到新协议的概念映射

旧 IPC action 不再兼容，但功能概念可映射到新协议：

| 旧 IPC action | 新 WebSocket 表达 | 说明 |
| --- | --- | --- |
| `qq_message` | `message` | 客户端自行处理 QQ 来源、群号、发送者和前缀，服务端只负责发往 MC。 |
| `whisper_reply` | `message` | 使用 `data.type="whisper"` 和 `target_player`。 |
| `delegate_command` | `command` | 使用 `data.command`、`data.args`、`data.wait`。 |
| `delegate_result` | `reply` | 使用同一 `msg_id`；可多条回复。 |
| `mc_message` | `msg` | 服务端向客户端推送 Minecraft 消息。 |
| `player_list` | `player` 请求的 `reply` | 不再主动推送，客户端需要时主动请求。 |
| `tpa_request_detected` | `event` | `event_type="tpa.request_detected"`。 |
| `tpa_notification` | `event` | `event_type="tpa.notification"`。 |
| `whisper_command` | 暂不保留 | 当前代码仅定义未实际使用；新协议不单独定义。 |

## 后续代码应修改什么

### 1. 启动流程

当前 `index.js` 启动后会立即读取配置并创建 Mineflayer bot。后续应改为：

- `index.js` 启动 WebSocket server。
- 不在进程启动时创建 bot。
- 收到 `login_account` 或 `login_preset` 后再调用 bot 创建逻辑。
- 将现有 `main()` 拆成可复用的 `create_bot(loginOptions)`。

### 2. Bot 实例管理

新增 bot 管理层：

- 维护 `bot_id -> bot context` 映射。
- bot context 至少包含 `bot`、`bot_id`、`username`、`state`、`server`、`reconnect`、`created_at`。
- 登录成功后生成并返回 `bot_id`。
- `logout` 根据 `bot_id` 关闭并移除 bot。
- `bot_info` 和 `bot_list` 从管理层读取状态。

### 3. WebSocket 服务

新增 WebSocket 服务模块：

- 监听 `connect.host` 和 `connect.port`。
- 校验 `auth.data.token`。
- 保存连接认证状态。
- 解析通用 envelope。
- 按 `type` 分发到对应 handler。
- 提供发送 `reply`、`event`、`error`、`msg` 的统一方法。

项目当前依赖中没有明确的 WebSocket 服务端库，后续实现时需要增加类似 `ws` 的依赖。

### 4. 替换 IPC 输出

当前代码中多处使用：

```js
process.stdout.write(ipc.encode(...))
```

后续应替换为 WebSocket 推送：

- 普通 MC 消息：发送 `msg`。
- 命令结果：发送 `reply`。
- TPA 通知：发送 `event`。
- 运行错误：发送 `error`。

重点位置：

- `index.js` 中的 `forward_unhandled_msg_obj()`。
- `index.js` 中的 `handle_delegated_command()`。
- `index.js` 中的玩家列表收集逻辑。
- `src/plugins/tpa/index.js` 中的 TPA IPC 通知。
- `src/utils/message_pusher.js` 中的 IPC channel。

### 5. 消息发送

实现 `message` handler：

- 校验 `bot_id`。
- `data.type="chat"` 时调用 `bot.chat()`。
- `data.type="whisper"` 时调用 `bot.whisper(target_player, content)`。
- 发送成功返回 `reply.status="success"`。
- 发送失败返回 `reply.status="error"` 和 `send_failed`。

客户端来源、群号、权限、转发目标等信息不在服务端协议固定字段中处理。

### 6. 命令执行

实现 `command` handler：

- 校验 `bot_id`。
- 使用现有 `trigger_command()` 触发内部命令。
- `data.wait=true` 时等待执行完成，再返回结果。
- `data.wait=false` 时先回复已接收，后续输出可使用同一 `msg_id` 继续发送 `reply`。
- 未命中命令返回 `command_not_found`。

`permission` 和 `reply_to` 不作为固定协议字段；如果未来需要，可通过 `args` 或 `extra` 扩展。

### 7. 玩家列表

调整玩家列表逻辑：

- 移除或停用固定定时推送。
- 将当前 `collect_player_list()` 改为可被 `player` handler 调用的函数。
- `player` 请求通过 `reply` 返回完整列表。
- 增量更新由客户端自行完成。

### 8. 事件系统

实现统一事件发送：

- bot 登录中、在线、离线、停止、失败：`event_type="bot.status"`。
- bot 重连过程：`event_type="bot.reconnect"`。
- TPA 检测：`event_type="tpa.request_detected"`。
- TPA 通知：`event_type="tpa.notification"`。
- 普通服务端通知：`event_type="system.notice"`。

后续新增功能优先扩展 `event_type`，不要为每个插件新增顶层消息类型。

### 9. 配置文件

更新示例配置：

- `exampleconfigs/settings.yaml` 的 `connect` 增加 `token`。
- 明确 `host`、`port` 是 WebSocket 服务监听地址。
- 保留 `timeout`、`retry` 作为连接或内部操作默认配置。

### 10. 测试建议

实现后建议至少覆盖：

- 未认证发送业务消息会被拒绝。
- token 错误后连接关闭。
- `login_preset` 创建 bot 并返回 `bot_id`。
- 多 bot 同时在线时，`message`、`command`、`player` 都路由到正确 bot。
- 客户端断开后 bot 不下线。
- 客户端重连后 `bot_list` 可查到已有 bot。
- `command.wait=true` 返回最终结果。
- `command.wait=false` 允许后续多条同 `msg_id` 的 `reply`。
- 未知命令返回 `command_not_found`。
- TPA 插件通过 `event` 推送，不再写 IPC。
