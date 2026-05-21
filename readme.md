# Enanabot Mineflayer API

基于 [mineflayer](https://github.com/PrismarineJS/mineflayer) 构建的 Minecraft 机器人 WebSocket 控制端 API 服务。

本项目允许通过外部 WebSocket 客户端（如 [nonebot 部分](https://github.com/raincatsanddogs/enanabot)）连接并对多个 Minecraft 机器人进行集中生命周期管理、消息收发、指令分发以及数据状态查询。

---

## 核心特性

- **多账号与多服务器支持**：支持配置多个账户和服务器预设，并可动态登录。
- **WebSocket 协议管理**：外部客户端通过 JSON 协议即可安全控制机器人（支持 Token 认证）。
- **极速指令拦截与分发**：内置轻量级类 Nonebot 风格指令系统，快速响应游戏内私聊指令，减少 IPC 通信开销。
- **断线自动重连**：配置化重连策略，支持重连上限与间隔时间设置。
- **机器人登录状态持久化 (New)**：
  - 自动将已登录且处于活动状态的机器人保存至 `configs/bot_persistence.json`。
  - 在服务重启后，自动在后台重新加载并尝试恢复这些机器人的 Minecraft 登录，确保无人值守下的高可用性。
  - 手动注销 (`logout`) 的机器人会自动从持久化配置中移除。

---

## 文件结构

- [index.js](index.js) — 项目启动入口，注册插件并初始化 WebSocket 服务。
- `configs/` — 配置文件存放目录（需复制 `exampleconfigs/` 自行配置）。
  - [accounts.yaml](configs/accounts.yaml) — 存放 Minecraft 账号档案、皮肤站配置以及断线重连规则。
  - [settings.yaml](configs/settings.yaml) — 存放 Minecraft 服务器列表、WebSocket 服务端口、Token 凭证以及玩家命令权限。
- `src/` — 核心源代码。
  - `src/websocket/` — WebSocket 服务端实现、连接验证、消息分发及机器人生命周期管理 (`BotManager`)。
  - `src/handler/` — 指令系统和聊天消息拦截处理器。
  - `src/plugins/` — 注册的 Mineflayer 插件。

---

## 配置指南

### 1. 账号配置 (`configs/accounts.yaml`)

```yaml
account:
  - name: "bot_name"             # 机器人的游戏内显示名（档案名）
    email: "example@example.com"  # 账号邮箱 (微软账号/第三方登录账号)
    password: "password"          # 密码
    authType: "third"             # 登录验证类型，可选: microsoft, mojang, third (第三方皮肤站)

skin:
  - url: "https://xxx/api/yggdrasil" # 皮肤站 yggdrasil API 地址
    authServer: ""
    sessionServer: ""

reconnect:
  reconnect: true   # 是否启用掉线重连
  interval: 5       # 掉线重连间隔时间（秒）
  max_attempts: 5   # 最大尝试重连次数，0 表示无限重连
```

### 2. 系统及连接配置 (`configs/settings.yaml`)

```yaml
server:
  - url: "xxx"  # 目标服务器地址
    port: xxxxx        # 目标服务器端口
    version: "xxx"  # 强制锁定的 Minecraft 版本

connect:
  timeout: 10          # 登录连接超时时间（秒）
  retry: 3             # 登录连接重试次数
  host: "localhost"    # WebSocket API 服务监听地址
  port: xxxxx          # WebSocket API 服务端口
  token: "xxxxx"      # 外部客户端连接所需的身份认证 Token
  command_prefix: "#"  # 游戏内私聊指令前缀
  admin_players: []    # 管理员玩家列表 (允许私聊执行所有指令)
  user_players: []     # 普通玩家列表 (允许私聊执行安全指令)
  guest_players: []    # 访客玩家列表
```

---

## 运行与测试

### 启动 API 服务
```bash
node index.js
```
服务启动后将在控制台输出 `WebSocket 服务正在监听 ws://localhost:12345`。

### 运行单元测试
项目包含针对指令分发、WebSocket 协议通信以及持久化流程的完整测试用例：
```bash
npm run test
```

---

## WebSocket API 协议说明

客户端建立 WebSocket 连接后，必须首先发送 `auth` 类型消息进行认证，方可调用其他机器人控制指令。

所有通信均采用 JSON 格式，基础数据包结构（Envelope）如下：

```json
{
  "type": "消息类型",
  "msg_id": "消息唯一标识(可选)",
  "need_reply": true,
  "bot_id": "目标机器人标识(如 bot_1, 可选)",
  "data": {}
}
```

### 客户端发送消息类型

| 类型 | 说明 | 参数示例 (`data`) |
| :--- | :--- | :--- |
| `auth` | 连接身份认证（必须首包发送） | `{"token": "xxxxx"}` |
| `login_preset` | 基于 YAML 配置的索引快速登录机器人 | `{"account": 1, "server": 1}` |
| `login_account` | 显式提供账号及服务器配置动态登录机器人 | `{"account": "...", "login_type": "...", "server": {...}}` |
| `logout` | 注销并断开指定机器人的连接 | （无需 data，使用外层 `bot_id`） |
| `message` | 让指定机器人发送游戏内公聊或私聊消息 | `{"type": "chat", "content": "Hello"}` 或 `{"type": "whisper", "target_player": "Steve", "content": "..."}` |
| `command` | 触发机器人的内置 JS 指令 | `{"command": "tpa", "args": ["Steve"], "wait": true}` |
| `ping` | 心跳及服务存活检查 | `bot_id` 可空（检查服务）或指定（检查机器人是否在线） |
| `player` | 查询机器人当前所在的服务器玩家列表 | （无需 data） |
| `bot_info` | 查询指定机器人的详细状态信息 | （无需 data） |
| `bot_list` | 获取所有已登录/正在登录机器人的列表 | （无需 data） |

### 服务端推送消息事件

| 事件类型 (`type`) | 说明 |
| :--- | :--- |
| `reply` | 对客户端带 `msg_id` 和 `need_reply: true` 请求的直接应答响应 |
| `msg` | 机器人接收到游戏内公聊/私聊消息后的实时转发推送 |
| `event` | 状态变更事件，目前支持：<br> - `bot.status`: 机器人状态（`online`/`failed`/`offline`/`reconnecting`/`stopped` 等）<br> - `bot.reconnect`: 重连状态推送 |
| `error` | 服务端内部异常时的通用报错推送 |
