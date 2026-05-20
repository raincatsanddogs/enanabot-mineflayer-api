# Command 指令组件

`handler/command` 是一个轻量的类 NoneBot 指令组件。它接收 `handler/message` 产生的 `msg_obj`，完成指令匹配、权限检查、规则判断、会话等待和处理函数执行。

组件只依赖统一后的消息对象：

```js
{
    player: { username, uuid, nickname },
    message: '#ping',
    position: 'private', // private | public | internal
    time: Date.now(),
    permission: 'guest', // 可选
}
```

默认行为：

- 只处理 `private`、`public`、`internal` 三类消息。
- 指令前缀默认是 `#`。
- 默认忽略 bot 自己发出的消息，通过 `bot.username` 和 `msg.player.username` 对照判断。
- 内部触发的指令使用 `position: 'internal'`，默认拥有 `system` 权限。

## 文件结构

- `index.js`：统一导出入口。
- `command_registry.js`：指令对象、注册表、`on_command()`。
- `command_session.js`：会话对象、`send()`、`finish()`、`receive()`。
- `command_listener.js`：监听 `msg_obj`、分发指令、内部触发。
- `command_register.js`：项目内置指令注册位置。
- `utils/command_text_utils.js`：指令文本、会话 key、自身消息判断。
- `utils/permission_utils.js`：权限等级和权限解析。
- `utils/rule_utils.js`：规则函数和规则组合。

## 注册指令

```js
const { on_command, rules } = require('./src/handler/command');

const ping = on_command('ping', {
    aliases: ['p'],
    permission: 'guest',
    rule: rules.position(['private', 'public', 'internal']),
    priority: 10,
    block: true,
    description: '测试指令',
});

ping.handle(async (session) => {
    await session.finish('pong');
});
```

### `on_command(name, options)`

注册一个指令并返回 `Command` 对象。

参数：

- `name: string`：主指令名，不包含前缀。
- `options.aliases?: string[]`：别名列表。
- `options.permission?: 'guest' | 'user' | 'admin' | 'system'`：最低权限，默认 `admin`。
- `options.rule?: (session) => boolean | Promise<boolean>`：触发规则，默认恒为 `true`。
- `options.priority?: number`：优先级，数字越大越先匹配，默认 `1`。
- `options.block?: boolean`：命中后是否阻止后续同名/同别名指令继续执行，默认 `true`。
- `options.description?: string`：指令说明。

返回：

- `Command`：包含 `handle(fn)` 和 `match(name)`。

### `command.handle(fn)`

设置指令处理函数。

参数：

- `fn: async (session) => void`

返回：

- 当前 `Command` 对象，可链式调用。

## 监听聊天指令

```js
const { listen_command } = require('./src/handler/command');

const stop = listen_command(bot, {
    prefix: '#',
    cancel_command: '#cancel',
    admin_players: ['AdminName'],
    user_players: ['UserName'],
});
```

### `listen_command(bot, options)`

监听 `bot.on('msg_obj')`，收到消息后自动派发指令。

常用参数：

- `prefix?: string`：指令前缀，默认 `#`。
- `cancel_command?: string`：取消等待会话的文本，默认 `#cancel`。
- `ignore_self?: boolean`：是否忽略 bot 自己的消息，默认 `true`。
- `admin_players?: string[]`
- `user_players?: string[]`
- `guest_players?: string[]`
- `default_permission?: string`：未命中名单时的默认权限，默认 `guest`。
- `permission_resolver?: (msg) => string`：自定义权限解析。
- `reply?: async (text, session) => void`：自定义回复方式。
- `on_error?: (err, session) => void`：自定义错误处理。

返回：

- `() => void`：调用后移除监听器。

## 内部触发指令

IPC 或未来 WS 收到指令请求时，使用 `trigger_command()`。它和聊天消息走同一套注册、权限、规则与 handler。

```js
const { trigger_command } = require('./src/handler/command');

const result = await trigger_command(bot, '#ping', {
    username: 'ipc',
    permission: 'admin',
});
```

### `trigger_command(bot, text, options)`

构造一条 `internal` 消息并派发。

参数：

- `bot`：mineflayer bot 实例。
- `text: string`：完整指令文本，例如 `#ping`。
- `options.username?: string`：内部请求来源名，默认 `system`。
- `options.permission?: string`：内部请求权限，默认 `system`。
- `options.player?: object`：自定义 player 对象。
- `options.reply?: async (text, session) => void`：接收指令回复。
- `options.await_handler?: boolean`：是否等待 handler 结束，默认 `true`。

返回：

```js
{
    handled: true,
    command,
    session,
    replies: ['pong']
}
```

内部触发默认不会向游戏内发送 `system` 私聊；回复会保存在 `result.replies`，也可以通过 `options.reply` 接收。

## 手动派发

```js
const { dispatch_command } = require('./src/handler/command');

const result = await dispatch_command(bot, msg, {
    prefix: '#',
});
```

### `dispatch_command(bot, msg, options)`

直接派发一条消息对象。

返回：

- 未处理：

```js
{ handled: false, replies: [] }
```

- 忽略 bot 自身消息：

```js
{ handled: false, ignored: true, reason: 'self_message', replies: [] }
```

- 已处理：

```js
{
    handled: true,
    command,
    session,
    replies: ['回复文本']
}
```

- 消息被等待中的会话消费：

```js
{ handled: true, waiting: true, replies: [] }
```

## Session 用法

handler 收到的 `session` 包含：

- `session.bot`：bot 实例。
- `session.msg`：当前消息对象。
- `session.player`：触发者玩家信息。
- `session.message`：当前消息文本。
- `session.position`：消息位置。
- `session.args`：指令参数数组。
- `session.permission`：当前权限。
- `session.data`：本次会话的临时数据。
- `session.replies`：本次指令产生的回复数组。

### `session.send(text)`

发送一条回复，不中断 handler。

返回：

- `Promise<void>`

默认回复给触发者私聊；如果传入了 `reply` 回调，则使用回调；内部触发默认只记录到 `session.replies`。

### `session.finish(text)`

可选发送回复，然后结束 handler。

返回：

- 不正常返回；内部通过 `CommandFinishSignal` 结束流程。

用法：

```js
await session.finish('完成');
```

### `session.receive(options)`

等待同一玩家、同一位置的下一条消息。

参数：

- `options.timeout?: number`：超时时间，毫秒，默认 `60000`。
- `options.filter?: async (msg, session) => boolean`：过滤下一条消息。

返回：

- `Promise<msg>`：下一条消息对象。

示例：

```js
const ask = on_command('ask', { permission: 'guest' });

ask.handle(async (session) => {
    await session.send('请输入名字');
    const msg = await session.receive({ timeout: 30000 });
    await session.finish(`你好，${msg.message}`);
});
```

用户发送 `#cancel` 会取消等待；等待超时会自动清理会话并回复 `等待超时`。

## 权限

内置权限从低到高：

```txt
guest < user < admin < system
```

权限来源优先级：

1. `options.permission_resolver(msg)` 返回值。
2. `msg.permission`。
3. `msg.player.permission`。
4. `position === 'internal'` 时使用 `system`。
5. `admin_players/user_players/guest_players` 名单。
6. `default_permission`，默认 `guest`。

## 规则

从 `rules` 导入：

```js
const { rules } = require('./src/handler/command');
```

- `rules.always()`：始终通过。
- `rules.position(positions)`：限制消息位置。
- `rules.to_me(names)`：私聊和内部消息直接通过；公屏消息需要包含 bot 名称。
- `rules.and_rule(...rules)`：全部规则通过。
- `rules.or_rule(...rules)`：任意规则通过。
- `rules.not_rule(rule)`：规则取反。

## 内置指令注册

`command_register.js` 提供 `register_builtin_commands()`，目前示例注册了 `ping/p`：

```js
const { register_builtin_commands } = require('./src/handler/command/command_register');

register_builtin_commands();
```

## 运维指令

项目内置 `ops` 运维指令插件，但默认关闭。需要在 `configs/settings.yaml` 的 `connect` 下显式启用：

```yaml
connect:
  enable_ops_commands: true
```

启用后可由 `admin` 或 `system` 权限通过 MC 私聊或 WebSocket internal command 执行：

```txt
#ops restart
#ops update
```

- `#ops restart`：回复提示后延迟约 1 秒退出当前 Node 进程。
- `#ops update`：先执行 `git status --porcelain`，工作区存在未提交改动时拒绝更新；工作区干净时执行 `git pull --ff-only`，成功后退出当前 Node 进程。

注意：Node 进程无法可靠地“自我重启”。上述指令只会让当前进程正常退出，必须由 PM2、systemd、Docker restart policy 或其他外部守护进程负责重新拉起 `node index.js`。如果没有守护进程，执行后服务会停止，需要手动启动。
