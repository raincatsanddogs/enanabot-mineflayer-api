# WebSocket 服务实现计划

## 当前准备状态

`index.js` 已改为 WebSocket 时代的启动入口准备层：进程启动时不再立即创建 Mineflayer bot，而是导出 `create_bot(loginOptions, runtimeContext)` 和 `build_login_options_from_preset(accountId, serverId)` 供后续 WebSocket handler 调用。

每个由 `create_bot()` 创建的 bot 都会带有 `bot.__enanabot_context`。后续 WebSocket 和 bot 管理代码应把它作为单个 bot 的运行时上下文，至少包含：

- `bot_id`
- `username`
- `state`
- `server`
- `reconnect`
- `scope`
- `created_at`
- `push_event` / `push_reply` / `on_status` / `on_error` 等可选回调

`scope` 用于隔离 TPA、home、Wordle 等插件状态，默认由 `username + server.host + server.port` 派生。

## 后续模块边界

建议新增 `src/websocket/server.js`：

- 读取 `config.connect.host`、`config.connect.port`、`config.connect.token`。
- 若 `connect.token` 缺失，应直接启动失败。
- 启动 `ws` WebSocket server。
- 维护每个连接的认证状态。
- 认证前仅允许 `auth` 和不带 `bot_id` 的 `ping`。
- 提供统一发送函数：`send_reply()`、`send_event()`、`send_error()`、`send_msg()`。

建议新增 `src/websocket/bot_manager.js`：

- 维护 `bot_id -> bot context` 映射。
- 创建 bot 时调用 `create_bot(loginOptions, runtimeContext)`。
- `runtimeContext` 中注入 WebSocket 推送回调，使插件和命令输出能通过当前协议推送。
- `logout` 时设置 context state 为 `stopping`，调用 `bot.quit()`，并从管理层移除或标记 stopped。
- `bot_list` 和 `bot_info` 只读取管理层上下文，不依赖单个连接状态。

建议新增 `src/websocket/handlers.js`：

- `auth`：校验 token，失败时回复 error 后关闭连接。
- `login_preset`：调用 `build_login_options_from_preset()`，再通过 bot manager 创建 bot。
- `login_account`：将请求体标准化为 `create_bot()` 入参。
- `message`：按 `bot_id` 找 bot，`chat` 调 `bot.chat()`，`whisper` 调 `bot.whisper()`。
- `command`：按 `bot_id` 找 bot，通过 `trigger_command()` 执行；`wait=false` 先回复 accepted，后续输出继续使用同一 `msg_id`。
- `player`：被动收集指定 bot 的 `bot.players` 并通过 `reply` 返回。
- `bot_info` / `bot_list`：从 bot manager 返回状态。
- `ping`：无 `bot_id` 时检查连接；有 `bot_id` 时同时检查 bot 是否存在与在线。

## 登录成功语义

`login_account` 和 `login_preset` 的成功回复应等待 Mineflayer `spawn` 事件。`create_bot()` 会在 `spawn` 时把 context state 更新为 `online`，WebSocket handler 可以通过一次性监听 `spawn/error/end` 来决定登录请求的最终 `reply`。

建议状态流：

- 创建后立即发送 `event.bot.status: logging_in`。
- `spawn` 后回复登录请求 success，并发送 `event.bot.status: online`。
- `error` 或登录前 `end` 时回复登录请求 error，错误码为 `login_failed`。

## 多 Bot 隔离约束

当前代码已经为多 bot 做了以下准备：

- `message_handler` 的 bot 引用和玩家缓存是每 bot 独立闭包。
- 命令等待会话 key 包含 `bot_id`，避免同名玩家跨 bot 串线。
- `home_cache`、`tpa_state`、`wordle_state` 使用 bot scope 隔离。
- TPA 和 home 的消息监听器按 bot 单独挂载，命令定义仍全局注册一次。

后续 WebSocket 实现必须遵守：

- 所有 bot 相关请求都通过 `bot_id` 路由。
- 所有服务端推送都带 `bot_id`。
- 客户端断开不应导致 bot 退出。
- 重连后的客户端通过 `bot_list` 查询已存在 bot。

## 依赖

当前 `package.json` 还没有 WebSocket server 依赖。实现 `src/websocket/server.js` 时需要增加 `ws` 或等价服务端库，并同步更新 lockfile。
